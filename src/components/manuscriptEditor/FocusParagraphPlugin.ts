import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface FocusParagraphOptions {
  /**
   * Читається заново при КОЖНІЙ транзакції, а не один раз при створенні
   * редактора: extensions-масив збирається через `useRef([...])` в
   * EditorView.tsx і живе, не перестворюючись, усю сесію редагування
   * розділу (той самий підхід, що вже описаний біля bookRef.current для
   * getPageContentWidthMm тощо) — тож перемикач має бути функцією, що
   * читає `.current` React-рефа, а не замкненим значенням `boolean`.
   */
  enabled: () => boolean;
  /** CSS-клас, яким позначається кожен НЕфокусний блок — сама стилістика (opacity/transition) живе в index.css. */
  dimClass: string;
}

const focusParagraphKey = new PluginKey('novaFocusParagraph');

/**
 * Розставляє декорацію `dimClass` на кожен ВЕРХНЬОРІВНЕВИЙ блок документа
 * (абзац/цитата/картинка — усе, що є прямою дитиною кореня), КРІМ того,
 * що містить позицію курсора. Порожній документ чи виділення на межі
 * блоків — не окремі випадки: `selFrom >= from && selFrom <= to` включно
 * з обома кінцями, тож курсор рівно на стику двох абзаців лишає підсвіченим
 * той, у який ProseMirror фактично розташував $from.
 */
function buildDecorations(doc: PMNode, selFrom: number, dimClass: string): DecorationSet {
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    const from = offset;
    const to = offset + node.nodeSize;
    const isFocused = selFrom >= from && selFrom <= to;
    if (!isFocused) {
      decorations.push(Decoration.node(from, to, { class: dimClass }));
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * «Курсор-фокус на абзаці» — приглушує решту тексту, лишаючи чітким лише
 * абзац, у якому зараз курсор (той самий принцип, що й «фокус-режим» у
 * iA Writer/Ulysses). Вимкнено за замовчуванням (`enabled()` повертає
 * false) — на відміну від PaginationPlugin, який рахує розриви сторінок
 * завжди, це суто косметичний режим читання, який автор вмикає сам.
 *
 * Свідомо БЕЗ вимірювання DOM (на відміну від PaginationPlugin.ts вище) —
 * декорації тут залежать лише від документа й позиції курсора, тож
 * рахуються заново при КОЖНІЙ транзакції напряму в `apply`, без окремого
 * `view()`/таймера. Документ розділу книги — не тисячі вузлів, тож це
 * дешевше й простіше, ніж захищати ще один цикл вимірювання від
 * перегонів.
 */
export const FocusParagraphPlugin = Extension.create<FocusParagraphOptions>({
  name: 'novaFocusParagraph',

  addOptions() {
    return {
      enabled: () => false,
      dimClass: 'nova-focus-dimmed',
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: focusParagraphKey,
        state: {
          init: (_config, state) =>
            options.enabled()
              ? buildDecorations(state.doc, state.selection.from, options.dimClass)
              : DecorationSet.empty,
          apply: (tr, _old, _oldState, newState) => {
            if (!options.enabled()) return DecorationSet.empty;
            return buildDecorations(newState.doc, newState.selection.from, options.dimClass);
          },
        },
        props: {
          decorations(state) {
            return focusParagraphKey.getState(state);
          },
        },
      }),
    ];
  },
});
