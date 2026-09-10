import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Блоковий вузол "розділювач сцени" — живий аналог маркера `[DIVIDER]`,
 * що стоїть окремим абзацом (той самий підхід, що й [IMG:…] у
 * WrappedImageNode.tsx / utils/manuscriptDoc.ts: маркер займає весь
 * абзац сам по собі). У мокапі «FusionWrite» — кнопка «Розділювач» у
 * панелі «Вставка».
 */
export const DividerNode = Node.create({
  name: 'sceneDivider',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'hr[data-nova-divider]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['hr', mergeAttributes(HTMLAttributes, { 'data-nova-divider': '' })];
  },
});
