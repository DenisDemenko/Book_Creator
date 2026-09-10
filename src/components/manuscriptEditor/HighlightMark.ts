import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Позначка "виділення (highlight) фрагмента тексту кольором" — живий
 * аналог маркера `[HL="#rrggbb"]…[/HL]` (див. utils/manuscriptDoc.ts,
 * utils/helpers.ts renderHighlightMarkers). Ставиться через
 * applyHighlightToSelection в EditorView.tsx при виборі кольору з панелі
 * «Highlight» — точна копія TextColorMark.ts, лише малює фон замість
 * кольору символів.
 */
export const HighlightMark = Mark.create({
  name: 'highlight',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-highlight-color'),
        renderHTML: (attrs) => ({ 'data-highlight-color': attrs.color }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-highlight-color]' }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        style: `background-color:${mark.attrs.color}; border-radius:2px;`,
      }),
      0,
    ];
  },
});
