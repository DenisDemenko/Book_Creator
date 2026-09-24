import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction, type EditorState } from '@tiptap/pm/state';
import { randomParagraphId } from '../../utils/paragraphIds';

/**
 * Постійний номер кожного блока верхнього рівня в редакторі — атрибут `pid`
 * (задача Т0.5, журнал #246; як номери зберігаються й звіряються —
 * `utils/paragraphIds.ts`).
 *
 * ЯК НОМЕР ПЕРЕЖИВАЄ ПРАВКИ. ProseMirror сам переносить атрибути вузла:
 *   • правка тексту всередині абзацу — вузол той самий, номер той самий;
 *   • злиття двох абзаців (Backspace на початку) — лишається перший вузол і
 *     його номер;
 *   • перетягування абзацу — вузол переїжджає разом із номером;
 *   • розбиття абзацу (Enter посередині) — ProseMirror копіює атрибути в
 *     обидві половини, тож номер двоїться; плагін нижче лишає його ПЕРШІЙ
 *     половині, а другій дає новий.
 * Вставка з буфера отримує нові номери: `parseHTML` навмисно не читає `pid`,
 * інакше скопійований абзац забрав би номер оригіналу.
 *
 * У текст розділу номер не пишеться — серіалізатор маркерів атрибутів `pid` не
 * знає, тож рукопис лишається байт-у-байт тим самим.
 */
export const PARAGRAPH_ID_NODE_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'table',
  'sceneDivider',
  'wrappedImage',
  'aiDraft',
];

export const paragraphIdKey = new PluginKey('novaParagraphId');

/** Транзакція, що роздає номери блокам верхнього рівня без номера чи з повтором. */
export function assignMissingParagraphIds(state: EditorState, genId: () => string = randomParagraphId): Transaction | null {
  // Спершу — хто претендує на кожен номер. Повтор виникає лише після
  // розбиття абзацу: номер лишається тій половині, де є текст (Enter на
  // самому початку абзацу не має забирати номер у тексту), а коли текст є в
  // обох — першій.
  const blocks: { pos: number; pid: string | null; empty: boolean; attrs: Record<string, unknown> }[] = [];
  state.doc.forEach((node, offset) => {
    if (!PARAGRAPH_ID_NODE_TYPES.includes(node.type.name) || !('pid' in node.attrs)) return;
    blocks.push({ pos: offset, pid: (node.attrs.pid as string | null) || null, empty: node.content.size === 0 && !node.isAtom, attrs: node.attrs });
  });
  const keeper = new Map<string, number>();
  blocks.forEach((b, i) => {
    if (!b.pid) return;
    const current = keeper.get(b.pid);
    if (current === undefined || (blocks[current].empty && !b.empty)) keeper.set(b.pid, i);
  });
  const seen = new Set<string>(keeper.keys());
  const fixes: { pos: number; attrs: Record<string, unknown> }[] = [];
  blocks.forEach((b, i) => {
    if (b.pid && keeper.get(b.pid) === i) return;
    let fresh = genId();
    while (seen.has(fresh)) fresh = genId();
    seen.add(fresh);
    fixes.push({ pos: b.pos, attrs: { ...b.attrs, pid: fresh } });
  });
  if (fixes.length === 0) return null;
  const tr = state.tr;
  for (const fix of fixes) tr.setNodeMarkup(fix.pos, undefined, fix.attrs);
  // Роздача номерів — не дія автора: не має з'являтися в «Скасувати».
  tr.setMeta('addToHistory', false);
  tr.setMeta(paragraphIdKey, true);
  return tr;
}

export function createParagraphIdPlugin(genId: () => string = randomParagraphId): Plugin {
  return new Plugin({
    key: paragraphIdKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      return assignMissingParagraphIds(newState, genId);
    },
  });
}

export const ParagraphIdExtension = Extension.create({
  name: 'novaParagraphId',

  addGlobalAttributes() {
    return [
      {
        types: PARAGRAPH_ID_NODE_TYPES,
        attributes: {
          pid: {
            default: null,
            keepOnSplit: true,
            // Навмисно не читаємо з HTML: вставлений з буфера абзац — новий абзац.
            parseHTML: () => null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.pid ? { 'data-pid': String(attributes.pid) } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [createParagraphIdPlugin()];
  },
});
