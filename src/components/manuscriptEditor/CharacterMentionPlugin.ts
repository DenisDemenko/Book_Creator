import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface CharacterMentionEntry {
  id: string;
  name: string;
  surname?: string;
  alias?: string;
}

export interface CharacterMentionOptions {
  /**
   * Живий список персонажів книги — читається заново при КОЖНІЙ
   * транзакції, а не замкнений один раз при побудові масиву розширень
   * (той самий підхід, що й `enabled` у FocusParagraphPlugin.ts та
   * `getPageContentWidthMm` в EditorView.tsx: масив розширень збирається
   * ОДИН РАЗ через `useRef([...]).current` і живе без перестворення всю
   * сесію редагування розділу).
   */
  getCharacters: () => CharacterMentionEntry[];
  /** CSS-клас кожного знайденого згадування — сама стилістика (підкреслення) живе в index.css. */
  mentionClass: string;
  /** Атрибут DOM, у якому лежить id персонажа — саме за ним EditorView.tsx ловить mouseover/mouseout. */
  characterIdAttr: string;
}

/** Публічний, щоб EditorView.tsx міг примусово освіжити декорації через setMeta — напр., коли книга.characters змінився ЗЗОВНІ (редагування у вкладці «Персонажі»), а не через власну транзакцію ProseMirror. */
export const characterMentionKey = new PluginKey('novaCharacterMention');

/** Екранує спецсимволи регулярного виразу — імена персонажів можуть містити будь-що (лапки, дефіси). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ім'я/прізвище/псевдонім/«Ім'я Прізвище» — кожен варіант мінімум 3
 * символи (коротші за 3 символи дають забагато випадкових збігів
 * усередині звичайних слів). Найдовші варіанти йдуть першими в
 * альтернації регулярного виразу: «Оксана Петренко» має зловитись раніше
 * за просто «Оксана» в тому самому місці тексту.
 */
function buildNameEntries(characters: CharacterMentionEntry[]): { text: string; id: string }[] {
  const entries: { text: string; id: string }[] = [];
  const seen = new Set<string>();
  for (const c of characters) {
    const candidates = [c.name, c.surname, c.alias, c.name && c.surname ? `${c.name} ${c.surname}` : undefined].filter(
      (v): v is string => Boolean(v && v.trim().length >= 3)
    );
    for (const raw of candidates) {
      const text = raw.trim();
      // Той самий рядок від двох різних персонажів (тезки) — залишаємо
      // ПЕРШОГО в списку книги, а не мовчки переписуємо; передбачувано,
      // хай і не ідеально для рідкісного випадку тезок.
      if (seen.has(text)) continue;
      seen.add(text);
      entries.push({ text, id: c.id });
    }
  }
  entries.sort((a, b) => b.text.length - a.text.length);
  return entries;
}

/**
 * Проходить усі текстові вузли документа й позначає декорацією кожне
 * входження імені персонажа як ОКРЕМЕ СЛОВО (межі `\p{L}\p{N}_` з обох
 * боків, юнікод-клас — бо звичайний `\w` у JS не охоплює кирилицю), щоб
 * «Оксана» не зловила «Оксанопіль» чи середину іншого слова.
 */
function buildDecorations(doc: PMNode, characters: CharacterMentionEntry[], mentionClass: string, idAttr: string): DecorationSet {
  const entries = buildNameEntries(characters);
  if (entries.length === 0) return DecorationSet.empty;

  const pattern = entries.map((e) => escapeRegExp(e.text)).join('|');
  const regex = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, 'gu');
  const idByText = new Map(entries.map((e) => [e.text, e.id]));

  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) {
      const id = idByText.get(m[0]);
      if (id) {
        decorations.push(
          Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
            class: mentionClass,
            [idAttr]: id,
          })
        );
      }
      // Захист від зациклення на нульовій довжині збігу — теоретично
      // неможливо з нашим патерном (мінімум 3 символи), але дешева
      // страховка того варта.
      if (m[0].length === 0) regex.lastIndex += 1;
    }
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * «Картка персонажа при наведенні» — підкреслює згадування персонажів
 * книги прямо в тексті розділу; сам поповер (аватар + поведінкові
 * шаблони, клікабельні — вставляють шаблон у курсор) уже існує в
 * EditorView.tsx (`behaviorPopover`) для «учасників сцени» й підменю
 * «Вставити репліку героя» — тут лише додається ТРЕТІЙ спосіб його
 * відкрити: наведення на слово в самому тексті. Плагін сам нічого не
 * рендерить понад декорацію — mouseover/mouseout ловить EditorView.tsx
 * нативним слухачем на `editor.view.dom` (див. коментар там).
 *
 * Без вимірювання DOM (як і FocusParagraphPlugin.ts) — рахує заново в
 * `apply()` лише коли ЗМІНИВСЯ ДОКУМЕНТ (docChanged), бо на відміну від
 * фокус-режиму тут результат не залежить від позиції курсора взагалі —
 * перерахунок на кожен рух курсора був би зайвим.
 */
export const CharacterMentionPlugin = Extension.create<CharacterMentionOptions>({
  name: 'novaCharacterMention',

  addOptions() {
    return {
      getCharacters: () => [],
      mentionClass: 'nova-character-mention',
      characterIdAttr: 'data-character-id',
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: characterMentionKey,
        state: {
          init: (_config, state) =>
            buildDecorations(state.doc, options.getCharacters(), options.mentionClass, options.characterIdAttr),
          apply: (tr, old, _oldState, newState) => {
            if (!tr.docChanged && !tr.getMeta(characterMentionKey)) return old;
            return buildDecorations(newState.doc, options.getCharacters(), options.mentionClass, options.characterIdAttr);
          },
        },
        props: {
          decorations(state) {
            return characterMentionKey.getState(state);
          },
        },
      }),
    ];
  },
});
