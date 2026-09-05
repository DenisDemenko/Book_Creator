import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { TAG_LINE_RE } from '../../utils/bookTags';

export const tagPluginKey = new PluginKey('novaTags');

/**
 * Підсвічує теги-вставки в рукописі: абзац «тега: назва» рендериться
 * зеленим класом `.nova-chapter-tag` (той самий смарагдовий, що вже є в
 * студії на панелях). Текст у документі лишається звичайним — плагін лише
 * малює декорацію, як і CharacterMentionPlugin.
 *
 * Сховати/показати — клас `.nova-hide-tags` на корені поверхні редактора
 * (кнопка «Сховати теги» в EditorView.tsx): CSS ховає декорації, не
 * чіпаючи сам текст і позиції курсора.
 */
export const TagPlugin = Extension.create({
  name: 'novaTags',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tagPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => (tr.docChanged ? old.map(tr.mapping, tr.doc) : old),
        },
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isTextblock || !node.textContent) return;
              const match = node.textContent.match(TAG_LINE_RE);
              if (!match) return;
              // Текстовий блок починається з pos+1; тег — від початку рядка.
              const from = pos + 1 + (match.index || 0);
              const to = from + match[0].length;
              decorations.push(Decoration.inline(from, to, { class: 'nova-chapter-tag' }));
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
