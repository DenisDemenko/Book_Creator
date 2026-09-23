import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  entityTooltip,
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
function buildDecorations(doc: PMNode, entities: CoreEntity[], options: EntityTagOptions): BuiltDecorations {
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
     * ДВА ПРОХОДИ, І ЦЕ НАВМИСНО — тут була помилка, знайдена живим прогоном.
     *
     * СПЕРШУ версію я написав так: склеював текст абзацу в один рядок, шукав
     * теги в ньому, а потім перераховував зсуви назад у позиції документа.
     * На папері це правильно, у канві — ні: чип з'являвся в ОДНОМУ абзаці зі
     * ста вісімнадцяти, решта тегів лишалися сирим текстом. Живий прогін
     * показав це відразу (118 абзаців із тлом, 36 чипів), а модульні тести —
     * ні, бо ті перевіряють розбір рядка, а не позиції в документі.
     *
     * ТЕПЕР: чипи (те, що має лягти на точний діапазон) ставляться по
     * КОЖНОМУ текстовому вузлу окремо — зсув усередині вузла плюс позиція
     * вузла, без жодного перерахунку через межу абзацу. Тло абзацу
     * (властивість блоку, а не діапазону) рахується зі склеєного тексту, бо
     * для нього точні позиції не потрібні взагалі.
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
    const segments: { text: string; start: number }[] = [];
    node.descendants((child, childPos) => {
      if (child.isText && child.text) {
        segments.push({ text: child.text, start: pos + 1 + childPos });
      }
      return true;
    });
    if (segments.length === 0) return;

    const paragraphText = segments.map((s) => s.text).join('');
    const tags = parseAnyEntityTags(paragraphText);
    if (tags.length === 0) return;

    const resolved = tags
      .map((tag) => ({ tag, entity: bySlug.get(tag.slug) }))
      .filter((t): t is { tag: (typeof tags)[number]; entity: CoreEntity } => !!t.entity);
    if (resolved.length === 0) return;

    perParagraph.push({ index, slugs: resolved.map((r) => r.entity.slug) });

    /*
     * ПРИХОВАНИЙ РЕЖИМ: ТЕГ ЗНИКАЄ З КАНВИ ПОВНІСТЮ.
     *
     * Тут була вада, яку власник знайшов 23.09.2026: кнопка «Сховати
     * сутності» прибирала ЛИШЕ фарбування, а сам текст тега лишався — сірим,
     * поміж прозою. Виглядало це як «сутності не зникли, а лише змінили
     * колір», і саме так власник і сказав.
     *
     * Тепер на кожен тег ставиться декорація з класом `display: none`: текст
     * зникає з очей, але в ДОКУМЕНТІ лишається тим самим рядком. Це і є
     * вимога постановки: «залишитися лише текст книги» — тег не можна
     * видаляти, бо він серіалізується в книгу (`manuscriptDoc.ts`) і без нього
     * зникла б уся розмітка.
     *
     * Діапазони збираються в `hiddenRanges` — ними потім коригується
     * поведінка курсора, щоб набраний символ не ліг у середину невидимого
     * тега.
     */
    if (!visible) {
      for (const segment of segments) {
        for (const tag of parseAnyEntityTags(segment.text)) {
          if (!bySlug.get(tag.slug)) continue;
          const from = segment.start + tag.start;
          const to = segment.start + tag.end;
          hiddenRanges.push({ from, to });
          decorations.push(Decoration.inline(from, to, { class: options.hiddenClass }));
        }
      }
      return;
    }

    /*
     * ТІЛЬКИ КОЛІР ТЕКСТУ — БЕЗ ЗАЛИВКИ (зміна дизайну, рішення власника
     * 23.09.2026: «міняєм лише в колір текст, а задній фон завжди залишаємо в
     * канві білим»).
     *
     * ДО ЦЬОГО тут стояла ще й `Decoration.node` із тлом абзацу — тим самим
     * кольором сутності, лише затемненим. На білій сторінці канви
     * (`PageColumn` малює аркуш `#fffefc`) це виглядало як темна смуга через
     * увесь абзац, і власник відхилив саме це. Тепер абзац не чіпається
     * взагалі: мітку видно кольором самого тега.
     *
     * Колір тексту береться не з документа як є, а проходить через
     * `textColorOnWhite`: палітра реєстру містить і `#FACC15`, який на білому
     * не читався б узагалі.
     */
    for (const segment of segments) {
      for (const tag of parseAnyEntityTags(segment.text)) {
        const entity = bySlug.get(tag.slug);
        if (!entity) continue;
        decorations.push(
          Decoration.inline(segment.start + tag.start, segment.start + tag.end, {
            class: options.chipClass,
            style: `color:${textColorOnWhite(entity.color)};`,
            ['data-entity-slug']: entity.slug,
            title: entityTooltip(entity, options.isEnglishUi() ? 'en' : 'uk'),
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
