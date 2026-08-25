import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Позначка "гарнітура для фрагмента тексту" — живий аналог маркера
 * `[FONT="Назва"]…[/FONT]` (див. utils/manuscriptDoc.ts, utils/helpers.ts
 * renderFontMarkers). Ставиться через applyFontToSelection в EditorView.tsx
 * при виборі шрифту з палітри в renderFormatToolbar.
 */
export const FontSpanMark = Mark.create({
  name: 'fontSpan',

  addAttributes() {
    return {
      family: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-font-family'),
        renderHTML: (attrs) => ({ 'data-font-family': attrs.family }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-font-family]' }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const family = mark.attrs.family as string;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        style: `font-family:'${String(family || '').replace(/'/g, '')}', Georgia, serif;`,
      }),
      0,
    ];
  },
});
