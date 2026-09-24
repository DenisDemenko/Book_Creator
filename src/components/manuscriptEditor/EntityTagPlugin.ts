import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  entityTooltip,
  entityValueTooltip,
  parseAnyEntityTags,
  textColorOnWhite,
  type CoreEntity,
} from '../../utils/coreEntities';
import { positionAfterHidden, textInsertionPoint, type HiddenRange } from '../../utils/entityTagHiding';

export interface EntityTagOptions {
  /**
   * Усі 118 сутностей реєстру. Передаються ЗАМИКАННЯМ (`() => …`), а не
   * масивом: розширення збирається один раз на сесію редагування розділу
   * (`useRef([...]).current` у EditorView.tsx), тож масив, переданий
   * значенням, застиг би назавжди — той самий підхід, що й у
   * CharacterMentionPlugin.ts та FocusParagraphPlugin.ts.
   */
  getEntities: () => CoreEntity[];
  /**
   * Чи показувати сутності авторові. Кнопка приховування (постановка, п. 5)
   * перемикає саме це: коли вимкнено — жодного чипа й жодного тла, а САМ ТЕГ
   * зникає з канви, тож лишається тільки текст книги (див. `hiddenClass`).
   */
  isVisible: () => boolean;
  /** CSS-клас чипа тега — сама стилістика живе в index.css. */
  chipClass: string;
  /**
   * CSS-клас прихованого тега. Саме `display: none` ховає текст тега, а не
   * лише його колір: до 23.09.2026 кнопка «Сховати сутності» прибирала тільки
   * фарбування, і власник побачив у книзі не текст, а `[/character:Олена]`
   * сірим — це і був баг, через який з'явився цей режим.
   */
  hiddenClass: string;
  /**
   * Мова підказки про сутність (постановка, п. 4: підказка мовою набору).
   * Замикання, а не значення — мова може перемкнутись у розмові, а масив
   * розширень збирається один раз на сесію редагування.
   */
  isEnglishUi: () => boolean;
}

export const entityTagKey = new PluginKey('novaEntityTag');

/** Клас абзацу, якому підсвітку вимкнено явно — щоб CSS міг її зняти. */
export const ENTITY_QUIET_PARAGRAPH_ATTR = 'data-entity-quiet';

interface BuiltDecorations {
  set: DecorationSet;
  /** Скільки сутностей на абзац — ключ: індекс абзацу в документі. */
  perParagraph: { index: number; slugs: string[] }[];
  /**
   * Діапазони ПРИХОВАНИХ тегів (порожній масив, коли сутності показані). Потрібні
   * не для малювання, а для поведінки курсора: у ці межі не можна пускати
   * ні клік, ні стрілки, ні набраний текст — інакше тег зіпсується непомітно
   * (див. `src/utils/entityTagHiding.ts`).
   */
  hiddenRanges: HiddenRange[];
}

/**
 * Обхід документа й побудова декорацій: чип на кожен тег, тло на кожен абзац
 * із сутностями.
 *
 * ЧОМУ ВСЕ В ОДНОМУ ПРОХОДІ. Тло абзацу визначає ПЕРША сутність абзацу
 * (постановка, п. 4), а чипи — усі теги в ньому. Якби це були дві окремі
 * функції, вони б двічі обходили документ і — гірше — могли б розійтися в
 * тому, що вважати абзацом: автор бачив би тло на одному абзаці, а чипи на
 * іншому.
 *
 * Тло ставиться `Decoration.node`, тобто на САМ блок абзацу, а не на
 * діапазон тексту всередині нього: інакше тло обривалося б там, де
 * закінчується текст (короткий абзац виглядав би залитим лише до половини
 * рядка).
 */
export function buildDecorations(
  doc: PMNode,
  entities: CoreEntity[],
  options: Pick<EntityTagOptions, 'isVisible' | 'chipClass' | 'hiddenClass' | 'isEnglishUi'>
): BuiltDecorations {
  const bySlug = new Map(entities.map((e) => [e.slug, e]));
  const decorations: Decoration[] = [];
  const perParagraph: { index: number; slugs: string[] }[] = [];
  const hiddenRanges: HiddenRange[] = [];
  const visible = options.isVisible();
  let paragraphIndex = 0;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const index = paragraphIndex++;

    /*
     * ІСТОРІЯ ЦЬОГО ОБХОДУ — дві помилки, обидві знайдені живим прогоном.
     *
     * СПЕРШУ версію я написав так: склеював текст абзацу в один рядок, шукав
     * теги в ньому, а потім перераховував зсуви назад у позиції документа.
     * На папері це правильно, у канві — ні: чип з'являвся в ОДНОМУ абзаці зі
     * ста вісімнадцяти, решта тегів лишалися сирим текстом. Живий прогін
     * показав це відразу (118 абзаців із тлом, 36 чипів), а модульні тести —
     * ні, бо ті перевіряють розбір рядка, а не позиції в документі.
     *
     * Далі була версія «по КОЖНОМУ текстовому вузлу окремо» — вона полагодила
     * позиції, але розбивала теги, розрізані форматуванням; її замінено
     * розбором по склеєному тексту абзацу з точним переносом назад (див.
     * коментар «ТЕГ РОЗБИРАЄТЬСЯ ПО ВСЬОМУ АБЗАЦУ…» нижче, запис #236).
     */
    /*
     * ПОЗИЦІЇ — тут була найдорожча помилка цієї задачі, знайдена живим
     * прогоном. `node.descendants()` для ВКЛАДЕНОГО вузла віддає зсуви
     * ВІДНОСНО САМОГО АБЗАЦУ, а не документа: перший його символ — це 0, а не
     * позиція в книзі. Перша версія брала `childPos` як абсолютну позицію, і
     * чипи ВСІХ 118 абзаців лягали на початок документа: у канві світився
     * самий перший абзац, порізаний на односимвольні шматки чужого кольору, а
     * решта тегів лишалися сирим текстом (118 абзаців із тлом, 36 чипів).
     *
     * Тому абсолютна позиція символу — це `pos + 1 + childPos`: позиція
     * абзацу, плюс один крок усередину блоку, плюс зсув усередині абзацу.
     * Модульні тести цього не бачили б узагалі: вони перевіряють розбір
     * рядка, а не систему координат ProseMirror.
     */
    /*
     * ТЕГ РОЗБИРАЄТЬСЯ ПО ВСЬОМУ АБЗАЦУ, А МАЛЮЄТЬСЯ ПО ШМАТКАХ (запис #236).
     *
     * Доти теги шукалися в КОЖНОМУ текстовому вузлі окремо. Але абзац ділиться
     * на вузли не за змістом, а за форматуванням: досить, щоб `[` і `]`
     * лишились без кольору, а `/character:Олена` був пофарбований (або щоб
     * значення тега було жирним), — і тег розпадається на три вузли. Тоді:
     *   • у середньому вузлі спрацьовував «сирий» розбір без дужок, і режим
     *     «Сховати сутності» ховав лише `/character:Олена`, а `[` і `]`
     *     лишались у тексті книги — саме це й побачив власник;
     *   • тег, у якому жирне лише значення (`[/emotion:**страх**]`), не
     *     розпізнавався зовсім і не ховався взагалі.
     *
     * Тепер розбір іде по склеєному тексту абзацу (як і для лічильника
     * сутностей), а кожен знайдений тег перекладається назад на ті вузли, які
     * він покриває: одна декорація на кожен шматок. Нетекстові вузли всередині
     * абзацу (розрив рядка, зображення) вставляються в склеєний текст як `\n`
     * — тег не може «перестрибнути» через них, так само як не може через
     * перенос рядка.
     */
    const segments: { text: string; start: number; offset: number; virtual: boolean }[] = [];
    let joinedLength = 0;
    node.descendants((child, childPos) => {
      if (child.isText && child.text) {
        segments.push({ text: child.text, start: pos + 1 + childPos, offset: joinedLength, virtual: false });
        joinedLength += child.text.length;
      } else if (child.isInline && child.isLeaf) {
        segments.push({ text: '\n', start: pos + 1 + childPos, offset: joinedLength, virtual: true });
        joinedLength += 1;
      }
      return true;
    });
    if (!segments.some((s) => !s.virtual)) return;

    const paragraphText = segments.map((s) => s.text).join('');
    const tags = parseAnyEntityTags(paragraphText);
    if (tags.length === 0) return;

    // Сутність — за реєстром із урахуванням українських ключів
    // (`/персонаж:` → character): `tag.entity` уже розв'язаний парсером.
    const resolved = tags
      .map((tag) => ({ tag, entity: bySlug.get(tag.entity?.slug ?? tag.slug) }))
      .filter((t): t is { tag: (typeof tags)[number]; entity: CoreEntity } => !!t.entity);
    if (resolved.length === 0) return;

    perParagraph.push({ index, slugs: resolved.map((r) => r.entity.slug) });

    /** Діапазон тега в склеєному тексті → шматки в координатах документа. */
    const piecesOf = (from: number, to: number): { from: number; to: number }[] => {
      const out: { from: number; to: number }[] = [];
      for (const seg of segments) {
        if (seg.virtual) continue;
        const a = Math.max(from, seg.offset);
        const b = Math.min(to, seg.offset + seg.text.length);
        if (a < b) out.push({ from: seg.start + (a - seg.offset), to: seg.start + (b - seg.offset) });
      }
      return out;
    };

    for (const { tag, entity } of resolved) {
      const pieces = piecesOf(tag.start, tag.end);
      if (pieces.length === 0) continue;

      /*
       * ПРИХОВАНИЙ РЕЖИМ: ТЕГ ЗНИКАЄ З КАНВИ ПОВНІСТЮ — разом із дужками.
       * `display: none` ховає текст лише з очей: у документі тег лишається
       * тим самим рядком (він серіалізується в книгу, `manuscriptDoc.ts`).
       * Діапазон цілого тега йде в `hiddenRanges` — за ним курсор не
       * пускають усередину невидимого тега.
       */
      if (!visible) {
        for (const piece of pieces) {
          decorations.push(Decoration.inline(piece.from, piece.to, { class: options.hiddenClass }));
        }
        hiddenRanges.push({ from: pieces[0].from, to: pieces[pieces.length - 1].to });
        continue;
      }

      /*
       * ТІЛЬКИ КОЛІР ТЕКСТУ — БЕЗ ЗАЛИВКИ (рішення власника 23.09.2026):
       * абзац не фарбується, мітку видно кольором самого тега. Колір проходить
       * через `textColorOnWhite`: `#FACC15` на білому аркуші не читався б.
       */
      for (const piece of pieces) {
        decorations.push(
          Decoration.inline(piece.from, piece.to, {
            class: options.chipClass,
            style: `color:${textColorOnWhite(entity.color)};`,
            ['data-entity-slug']: entity.slug,
            title: [entityTooltip(entity, options.isEnglishUi() ? 'en' : 'uk'), entityValueTooltip(entity, tag.value, options.isEnglishUi() ? 'en' : 'uk')]
              .filter(Boolean)
              .join('\n'),
          })
        );
      }
    }
  });

  return { set: DecorationSet.create(doc, decorations), perParagraph, hiddenRanges };
}

export interface EntityTagState extends BuiltDecorations {
  visible: boolean;
}

/** Діапазони прихованих тегів поточного стану — порожні, коли сутності показані. */
function hiddenRangesOf(state: EditorState): HiddenRange[] {
  const value = entityTagKey.getState(state) as EntityTagState | undefined;
  return value?.hiddenRanges ?? [];
}

/**
 * Підсвітка тегів сутностей у канві книги.
 *
 * ЩО РОБИТЬ ПЛАГІН І ЧОГО НЕ РОБИТЬ. Він ЛИШЕ малює: чипи на тегах і тло на
 * абзацах. Він не чіпає текст документа — тег лишається тим самим
 * `[/character:Serhii]`, яким його записано в книзі. Це принципово: текст
 * розділу серіалізується в книгу як є (`manuscriptDoc.ts`), і будь-яка
 * спроба «сховати» тег через зміну документа губила б його при
 * copy-paste, а при приховуванні (п. 5) — ще й назавжди.
 *
 * ПЕРЕРАХУНОК. Декорації будуються при зміні документа і при зміні самого
 * тоглу видимості (він приходить як meta транзакції — так EditorView.tsx
 * повідомляє плагіну про натискання кнопки без перестворення розширень).
 */
export const EntityTagPlugin = Extension.create<EntityTagOptions>({
  name: 'novaEntityTag',

  addOptions() {
    return {
      getEntities: () => [],
      isVisible: () => true,
      chipClass: 'nova-entity-chip',
      hiddenClass: 'nova-entity-tag-hidden',
      isEnglishUi: () => false,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: entityTagKey,
        state: {
          init: (_config, state) => ({
            ...buildDecorations(state.doc, options.getEntities(), options),
            visible: options.isVisible(),
          }),
          apply: (tr, old, _oldState, newState) => {
            const visible = options.isVisible();
            if (!tr.docChanged && !tr.getMeta(entityTagKey) && visible === old.visible) return old;
            return {
              ...buildDecorations(newState.doc, options.getEntities(), options),
              visible,
            };
          },
        },
        props: {
          decorations(state) {
            const value = entityTagKey.getState(state) as EntityTagState | undefined;
            /*
             * Повертаємо набір ЗАВЖДИ. Доти тут стояло `value.visible ? … :
             * DecorationSet.empty`, і саме це робило прихований режим
             * «перефарбовуванням»: коли декорацій немає зовсім, тег показує
             * сам ProseMirror — сірим текстом поміж прози. Тепер у
             * прихованому режимі в наборі лежать декорації `display: none`,
             * тож канва показує лише текст книги.
             */
            return value?.set ?? DecorationSet.empty;
          },

          /**
           * Клік усередину прихованого тега переносимо за його межі. Без цього
           * каретка ставала між `[/` і `character:…]`, і подальший набір
           * псував тег — невидимо для автора.
           */
          handleClick(view, pos) {
            const ranges = hiddenRangesOf(view.state);
            const fixed = positionAfterHidden(pos, ranges);
            if (fixed === pos) return false;
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, fixed)));
            return true;
          },

          /**
           * Набраний текст ніколи не замінює прихований тег. Той випадок, який
           * це рятує: автор виділив фрагмент, у виділення попав невидимий тег,
           * і почав писати — звичайна вставка знищила б тег мовчки.
           */
          handleTextInput(view, from, to, text) {
            const ranges = hiddenRangesOf(view.state);
            const point = textInsertionPoint(from, to, ranges);
            if (point === from && to === from) return false;
            view.dispatch(view.state.tr.insertText(text, point));
            return true;
          },
        },

        /**
         * Остання лінія оборони: якщо каретка все ж опинилася в прихованому
         * тегу (стрілки, Home/End, виділення мишею, програмна установка —
         * усе, що не проходить через `handleClick`), виносимо її за межі
         * тега наступною транзакцією.
         *
         * Це саме хук ПЛАГІНА, а не `props`: у ProseMirror `props` описує
         * поведінку редактора, а `appendTransaction` — доопрацювання вже
         * застосованих транзакцій, і жити в `props` він не може (перевірено
         * компілятором: `tsc` цю структуру не приймає).
         */
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null;
          const ranges = hiddenRangesOf(newState);
          if (ranges.length === 0) return null;
          const { from, to } = newState.selection;
          const fixedFrom = positionAfterHidden(from, ranges);
          const fixedTo = positionAfterHidden(to, ranges);
          if (fixedFrom === from && fixedTo === to) return null;
          return newState.tr.setSelection(TextSelection.create(newState.doc, fixedFrom, fixedTo));
        },
      }),
    ];
  },
});
