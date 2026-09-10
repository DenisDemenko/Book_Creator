import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Позначка "посилання для фрагмента тексту" — живий аналог маркера
 * `[LINK="https://…"]…[/LINK]` (див. utils/manuscriptDoc.ts,
 * utils/helpers.ts renderLinkMarkers). Власний, а не вбудований Link
 * StarterKit'у — той очікує іншу серіалізацію (markdown `[text](url)`),
 * не сумісну з дужковим форматом книги; той самий підхід, що й
 * FontSpanMark.ts/TextColorMark.ts.
 */
export const LinkMark = Mark.create({
  name: 'nlink',

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (el) => el.getAttribute('href'),
        renderHTML: (attrs) => ({ href: attrs.href }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[href][data-nova-link]' }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        href: mark.attrs.href,
        target: '_blank',
        rel: 'noopener noreferrer',
        'data-nova-link': '',
        style: 'color:#0284c7; text-decoration:underline; text-underline-offset:2px;',
      }),
      0,
    ];
  },
});
