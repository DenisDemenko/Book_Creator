import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Позначка "колір тексту для фрагмента" — живий аналог маркера
 * `[COLOR="#rrggbb"]…[/COLOR]` (див. utils/manuscriptDoc.ts,
 * utils/helpers.ts renderTextColorMarkers). Ставиться через
 * applyTextColorToSelection в EditorView.tsx при виборі кольору з палітри
 * «Colors» — точна копія FontSpanMark.ts, лише замість гарнітури керує
 * кольором (hex).
 */
export const TextColorMark = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-text-color'),
        renderHTML: (attrs) => ({ 'data-text-color': attrs.color }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-text-color]' }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        style: `color:${mark.attrs.color};`,
      }),
      0,
    ];
  },
});
