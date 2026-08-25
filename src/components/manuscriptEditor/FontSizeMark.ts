import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Позначка "кегль для фрагмента тексту" — живий аналог маркера
 * `[SIZE=14]…[/SIZE]` (див. utils/manuscriptDoc.ts, utils/helpers.ts
 * renderFontSizeMarkers). Ставиться через applyFontSizeToSelection в
 * EditorView.tsx при виборі розміру з панелі форматування — точна копія
 * FontSpanMark.ts, лише замість гарнітури керує кеглем (у пунктах).
 */
export const FontSizeMark = Mark.create({
  name: 'fontSize',

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-font-size');
          return v ? Number(v) : null;
        },
        renderHTML: (attrs) => ({ 'data-font-size': attrs.size }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-font-size]' }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        style: `font-size:${mark.attrs.size}pt;`,
      }),
      0,
    ];
  },
});
