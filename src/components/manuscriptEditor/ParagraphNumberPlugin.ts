import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { buildEntityTag } from '../../utils/coreEntities';
import {
  PARAGRAPH_TAG_SLUG,
  analyzeParagraph,
  paragraphNumberTagText,
  type ParagraphAnalysis,
} from '../../utils/paragraphNumbers';

/**
 * Тег номера абзацу `[/paragraph:#N]` ведеться сам (постановка власника
 * 03.11.2026): у новому непорожньому абзаці він з'являється, у порожньому
 * («без тексту, без картинок») — зникає.
 *
 * ЩО САМЕ РОБИТЬ ПЛАГІН, ПІСЛЯ КОЖНОЇ ПРАВКИ, ЩО ЗАЧЕПИЛА АБЗАЦ:
 *   • непорожній абзац без тега — дістає `#max+1`, після тегів, що вже стоять на
 *     його початку (перший тег лишається першим);
 *   • порожній абзац — втрачає тег. Порожній — це без видимого тексту (теги не
 *     в рахунок) і без вставних вузлів;
 *   • два теги в одному абзаці (після злиття двох) — лишається перший;
 *   • повторений номер (скопійований абзац) — дістає новий; незачеплений абзац
 *     свого номера не втрачає ніколи.
 *
 * ЧОМУ НОМЕР НЕ ПЕРЕНОМЕРОВУЄТЬСЯ. Новий номер — це max+1 серед УСІХ абзаців
 * книги, а не порядковий номер у розділі. Номер, що вже стоїть, не змінюється,
 * доки абзац непорожній: на `#412` можна посилатись у розмові з ШІ, і через
 * тиждень це той самий абзац. Ціна: після видалення абзацу його номер не
 * використовується вдруге.
 *
 * ЩО ПЛАГІН ЧІПАЄ. Лише абзаци верхнього рівня (`paragraph`): заголовки,
 * таблиці, цитати, чернетки ШІ й ілюстрації — блоки, чий текст читає власний
 * розбір маркерів, і тег усередині зламав би їх. Лише абзаци, яких торкнулась
 * правка: відкриття розділу (`setContent` без події оновлення) не нумерує
 * нічого, інакше розділ змінювався б від самого відкриття.
 *
 * ЧОМУ ЗМІНИ НЕ ПОТРАПЛЯЮТЬ В «СКАСУВАТИ». Як і роздача `pid`
 * (`ParagraphIdExtension`), це не дія автора. Скасування набору тексту
 * спорожнить абзац, і плагін сам зніме тег — тож історія лишається чистою.
 *
 * ЧОГО ПЛАГІН НЕ ВМІЄ, і про це чесно. Під час введення з IME (композиція)
 * він мовчить до наступної правки, бо зміна тексту посеред композиції ламає
 * введення. Українська й англійська розкладки цього не торкаються; китайську
 * чи японську я не перевіряв.
 *
 * Вимкнено типово: плагін працює лише коли книга має `autoParagraphNumbers`
 * (див. `LayoutView`). Книга без цього налаштування не змінюється ні на символ.
 */
export const paragraphNumberKey = new PluginKey('novaParagraphNumber');

export interface ParagraphNumberOptions {
  /** Чи ведеться нумерація в цій книзі. Замикання: перемикач може змінитись посеред сесії. */
  isEnabled: () => boolean;
  /**
   * Номери в ІНШИХ розділах книги: найбільший і набір використаних. Поточний
   * розділ сюди не входить — його читає сам плагін з живого документа.
   */
  getOtherNumbers: () => { max: number; used: ReadonlySet<number> };
}

/**
 * Позиція в документі для зміщення в тексті абзацу (`node.textContent`).
 *
 * НА МЕЖІ «текст | вставний вузол | текст» зміщення однакове з обох боків
 * вузла, а позиції в документі — різні. Тому край обирається явно:
 * `left` — кінець попереднього тексту (до вузла), `right` — початок
 * наступного (після нього). Початок діапазону видалення беремо `right`, а
 * кінець — `left`: інакше видалення тега, що стоїть одразу після розриву
 * рядка, зачепило б і сам розрив (це й показав тест).
 */
function textOffsetToPos(node: PMNode, nodePos: number, offset: number, edge: 'left' | 'right'): number {
  let pos = nodePos + 1;
  let chars = 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.isText) {
      const len = child.text!.length;
      if (offset < chars + len) return pos + (offset - chars);
      if (offset === chars + len && edge === 'left') return pos + len;
      chars += len;
      pos += len;
    } else {
      pos += child.nodeSize;
    }
  }
  return pos;
}

/** Вставний вузол, що робить абзац непорожнім (зображення тощо); розрив рядка — ні. */
function hasInlineContent(node: PMNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (!child.isText && child.type.name !== 'hardBreak') found = true;
  });
  return found;
}

/** Діапазони документа після всіх транзакцій, яких торкнулась правка. */
function changedRanges(transactions: readonly Transaction[], include: (tr: Transaction) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  transactions.forEach((tr, ti) => {
    if (!include(tr)) return;
    tr.mapping.maps.forEach((map, mi) => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        let from = newStart;
        let to = newEnd;
        for (let k = mi + 1; k < tr.mapping.maps.length; k++) {
          from = tr.mapping.maps[k].map(from, -1);
          to = tr.mapping.maps[k].map(to, 1);
        }
        for (let t = ti + 1; t < transactions.length; t++) {
          for (const m of transactions[t].mapping.maps) {
            from = m.map(from, -1);
            to = m.map(to, 1);
          }
        }
        out.push([from, to]);
      });
    });
  });
  return out;
}

/**
 * Чи зачепила правка `[from, to)` абзац `[pos, end)`. Перетин СТРОГИЙ:
 * вставлений поруч абзац, що закінчується рівно там, де починається сусід, цього
 * сусіда не зачіпає. Нестрога перевірка («<=») мала саме цей дефект: копія,
 * вставлена над абзацом, забирала в нього номер. Правка нульової довжини
 * (видалення всередині) зачіпає абзац, лише якщо вона всередині нього.
 */
function touches(from: number, to: number, pos: number, end: number): boolean {
  if (from === to) return from > pos && from < end;
  return from < end && to > pos;
}

interface ParagraphInfo {
  node: PMNode;
  pos: number;
  end: number;
  text: string;
  analysis: ParagraphAnalysis;
  touched: boolean;
}

interface Edit {
  from: number;
  to: number;
  text: string;
}

/** Транзакція, що веде теги номерів після правки; `null`, якщо робити нічого. */
export function paragraphNumberTransaction(
  state: EditorState,
  transactions: readonly Transaction[],
  options: ParagraphNumberOptions
): Transaction | null {
  if (!options.isEnabled()) return null;

  // Відкриття розділу (`setContent` без події) і власні зміни плагіна — не правка автора.
  const counts = (tr: Transaction) =>
    tr.docChanged && !tr.getMeta(paragraphNumberKey) && !tr.getMeta('preventUpdate') && tr.getMeta('composition') == null;
  if (!transactions.some(counts)) return null;

  const ranges = changedRanges(transactions, counts);
  const paragraphs: ParagraphInfo[] = [];
  state.doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph') return;
    const text = node.textContent;
    const end = offset + node.nodeSize;
    paragraphs.push({
      node,
      pos: offset,
      end,
      text,
      analysis: analyzeParagraph(text, hasInlineContent(node)),
      touched: ranges.some(([from, to]) => touches(from, to, offset, end)),
    });
  });
  if (!paragraphs.some((p) => p.touched)) return null;

  const other = options.getOtherNumbers();
  let max = other.max;

  // Хто тримає номер. Серед повторів у цьому розділі лишається незачеплений
  // абзац, а коли зачеплені всі — перший за порядком: правка ніколи не забирає
  // номер у абзацу, якого не торкалась.
  const keeper = new Map<number, number>();
  paragraphs.forEach((p, i) => {
    for (const tag of p.analysis.tags) {
      if (tag.number === null) continue;
      max = Math.max(max, tag.number);
      const current = keeper.get(tag.number);
      if (current === undefined || (paragraphs[current].touched && !p.touched)) keeper.set(tag.number, i);
    }
  });

  const edits: Edit[] = [];
  const allocate = () => ++max;

  paragraphs.forEach((p, i) => {
    if (!p.touched) return;
    const { analysis } = p;
    const at = (offset: number, edge: 'left' | 'right') => textOffsetToPos(p.node, p.pos, offset, edge);

    if (analysis.empty) {
      for (const tag of analysis.tags) edits.push({ from: at(tag.start, 'right'), to: at(tag.removeEnd, 'left'), text: '' });
      return;
    }

    if (analysis.tags.length === 0) {
      const lead = analysis.leadEnd;
      const spaceBefore = lead > 0 && !/\s$/.test(p.text.slice(0, lead));
      const spaceAfter = !/^\s/.test(p.text.slice(lead));
      edits.push({ from: at(lead, 'left'), to: at(lead, 'left'), text: paragraphNumberTagText(allocate(), { spaceBefore, spaceAfter }) });
      return;
    }

    const [first, ...extra] = analysis.tags;
    for (const tag of extra) edits.push({ from: at(tag.start, 'right'), to: at(tag.removeEnd, 'left'), text: '' });
    const conflict = first.number !== null && (keeper.get(first.number) !== i || other.used.has(first.number));
    if (first.number === null || conflict) {
      edits.push({ from: at(first.start, 'right'), to: at(first.end, 'left'), text: buildEntityTag(PARAGRAPH_TAG_SLUG, `#${allocate()}`) });
    }
  });

  if (edits.length === 0) return null;

  // Від кінця документа до початку: правка нижче не зсуває позицій вище.
  edits.sort((a, b) => b.from - a.from);
  const tr = state.tr;
  for (const edit of edits) {
    if (edit.text) tr.replaceWith(edit.from, edit.to, state.schema.text(edit.text));
    else tr.delete(edit.from, edit.to);
  }
  tr.setMeta('addToHistory', false);
  tr.setMeta(paragraphNumberKey, true);
  return tr;
}

export function createParagraphNumberPlugin(options: ParagraphNumberOptions): Plugin {
  return new Plugin({
    key: paragraphNumberKey,
    appendTransaction(transactions, _oldState, newState) {
      return paragraphNumberTransaction(newState, transactions, options);
    },
  });
}

export const ParagraphNumberPlugin = Extension.create<ParagraphNumberOptions>({
  name: 'novaParagraphNumber',

  addOptions() {
    return {
      isEnabled: () => false,
      getOtherNumbers: () => ({ max: 0, used: new Set<number>() }),
    };
  },

  addProseMirrorPlugins() {
    return [createParagraphNumberPlugin(this.options)];
  },
});
