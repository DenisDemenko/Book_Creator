import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  parseAnyEntityTags,
  paragraphBackgroundOnDarkCanvas,
  readableTextOn,
  type CoreEntity,
} from '../../utils/coreEntities';

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
   * перемикає саме це: коли вимкнено — жодного чипа й жодного тла, текст
   * розділу виглядає так, як виглядав би без розмітки взагалі.
   */
  isVisible: () => boolean;
  /** CSS-клас чипа тега — сама стилістика живе в index.css. */
  chipClass: string;
  /** CSS-клас абзацу з сутностями. */
  paragraphClass: string;
}

export const entityTagKey = new PluginKey('novaEntityTag');

/** Клас абзацу, якому підсвітку вимкнено явно — щоб CSS міг її зняти. */
export const ENTITY_QUIET_PARAGRAPH_ATTR = 'data-entity-quiet';

interface BuiltDecorations {
  set: DecorationSet;
  /** Скільки сутностей на абзац — ключ: індекс абзацу в документі. */
  perParagraph: { index: number; slugs: string[] }[];
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

    if (!options.isVisible()) return;

    const first = resolved[0].entity;
    const background = paragraphBackgroundOnDarkCanvas(first.color);
    if (background) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: options.paragraphClass,
          style: `background-color:${background};`,
          ['data-entity-first']: first.slug,
        })
      );
    }

    // Чипи — по кожному текстовому вузлу. Тег, розірваний межею вузлів
    // (усередині нього автор поставив наголос), лишається без чипа: це
    // видимий, але рідкісний край, і краще пропустити чип, ніж поставити
    // його на чужий діапазон.
    for (const segment of segments) {
      for (const tag of parseAnyEntityTags(segment.text)) {
        const entity = bySlug.get(tag.slug);
        if (!entity) continue;
        decorations.push(
          Decoration.inline(segment.start + tag.start, segment.start + tag.end, {
            class: options.chipClass,
            style: `background-color:${entity.color};color:${readableTextOn(entity.color)};`,
            ['data-entity-slug']: entity.slug,
            title: `${entity.tag}:${tag.value}`,
          })
        );
      }
    }
  });

  return { set: DecorationSet.create(doc, decorations), perParagraph };
}

export interface EntityTagState extends BuiltDecorations {
  visible: boolean;
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
      paragraphClass: 'nova-entity-paragraph',
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
            return value?.visible ? value.set : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
