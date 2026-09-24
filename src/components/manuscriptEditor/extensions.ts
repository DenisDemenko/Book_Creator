import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { FontSpanMark } from './FontSpanMark';
import { FontSizeMark } from './FontSizeMark';
import { TextColorMark } from './TextColorMark';
import { HighlightMark } from './HighlightMark';
import { LinkMark } from './LinkMark';
import { DividerNode } from './DividerNode';
import { WrappedImageNode, type WrappedImageOptions } from './WrappedImageNode';
import { AiDraftBlockNode } from './AiDraftBlockNode';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCellAlign, TableHeaderAlign } from './TableAlignCell';
import { FocusParagraphPlugin } from './FocusParagraphPlugin';
import { ParagraphIdExtension } from './ParagraphIdExtension';
import { CharacterMentionPlugin, type CharacterMentionEntry } from './CharacterMentionPlugin';
import { ReadabilityHighlightPlugin } from './ReadabilityHighlightPlugin';
import { EntityTagPlugin } from './EntityTagPlugin';
import { TagPlugin } from './TagPlugin';
import type { CoreEntity } from '../../utils/coreEntities';

export interface ManuscriptAiTextOptions {
  onRequestAiText?: WrappedImageOptions['onRequestAiText'];
  isGeneratingAiText?: WrappedImageOptions['isGeneratingAiText'];
  aiDraftLabel: string;
  aiDraftReviewLabel: string;
  aiDraftRejectLabel: string;
}

/**
 * Набір розширень для UA/EN редакторів тексту розділу (EditorView.tsx).
 * StarterKit звужений до того, що реально розуміє utils/manuscriptDoc.ts —
 * списки навмисно лишаються вимкненими (серіалізатор ще не вміє записати
 * їх назад у формат маркерів книги). Заголовки (рівні 1-3) і посилання —
 * УВІМКНЕНІ: manuscriptDoc.ts вміє їх серіалізувати (heading → `# Текст`,
 * посилання — власний LinkMark нижче, а не вбудований StarterKit `link`,
 * бо той пише markdown-синтаксис `[text](url)`, не сумісний з дужковим
 * форматом книги).
 */
export function buildManuscriptExtensions(
  resolveImageUrl: (id: string) => string | undefined,
  getPageContentWidthMm: () => number,
  placeholder: string,
  aiText: ManuscriptAiTextOptions,
  /**
   * Необов'язково (сумісність зі старими викликами): читається заново при
   * кожній транзакції ProseMirror, а не один раз при побудові масиву
   * розширень — див. коментар у FocusParagraphPlugin.ts.
   */
  isFocusParagraphModeEnabled?: () => boolean,
  /** Необов'язково: живий список персонажів книги — див. коментар у CharacterMentionPlugin.ts. */
  getCharacters?: () => CharacterMentionEntry[],
  /** Необов'язково: тогл підсвітки задовгих речень — див. коментар у ReadabilityHighlightPlugin.ts. */
  isReadabilityHighlightEnabled?: () => boolean,
  /**
   * Необов'язково: реєстр сутностей ядра (118 типів) — читається заново при
   * кожній транзакції, той самий підхід, що й `getCharacters` вище.
   */
  getCoreEntities?: () => CoreEntity[],
  /** Необов'язково: чи показувати сутності в канві (кнопка приховування, п. 5). */
  isEntityTagsVisible?: () => boolean,
  /** Необов'язково: мова підказок про сутності (п. 4 постановки 23.09.2026). */
  isEnglishUi?: () => boolean
) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
      underline: false,
      strike: false,
      dropcursor: false,
      gapcursor: false,
    }),
    FontSpanMark,
    FontSizeMark,
    TextColorMark,
    HighlightMark,
    LinkMark,
    DividerNode,
    WrappedImageNode.configure({
      resolveImageUrl,
      getPageContentWidthMm,
      onRequestAiText: aiText.onRequestAiText,
      isGeneratingAiText: aiText.isGeneratingAiText,
    }),
    AiDraftBlockNode.configure({
      label: aiText.aiDraftLabel,
      reviewLabel: aiText.aiDraftReviewLabel,
      rejectLabel: aiText.aiDraftRejectLabel,
    }),
    // Таблиці (запис #193) — utils/tableMarkers.ts/manuscriptDoc.ts вміють
    // серіалізувати назад у маркери лише РІВНО цей набір: table/tableRow/
    // tableCell(+tableHeader, той самий align — insertTable завжди кличеться
    // без заголовка, див. EditorView.tsx#insertBlankTable). Без
    // columnResizing/tableResizing: автор просив вставляти й редагувати
    // рядки/стовпці та вирівнювання, не ширину колонок.
    Table.configure({ resizable: false }),
    TableRow,
    TableHeaderAlign,
    TableCellAlign,
    Placeholder.configure({ placeholder }),
    FocusParagraphPlugin.configure({
      enabled: isFocusParagraphModeEnabled || (() => false),
      dimClass: 'nova-focus-dimmed',
    }),
    CharacterMentionPlugin.configure({
      getCharacters: getCharacters || (() => []),
      mentionClass: 'nova-character-mention',
      characterIdAttr: 'data-character-id',
    }),
    ReadabilityHighlightPlugin.configure({
      enabled: isReadabilityHighlightEnabled || (() => false),
      longSentenceClass: 'nova-readability-long-sentence',
      longSentenceThreshold: 30,
    }),
    // Сутності ядра (задача #227): чипи на тегах і тло абзаців. Плагін лише
    // МАЛЮЄ — текст розділу він не чіпає взагалі, тож теги лишаються в книзі
    // такими, якими їх записано, і зникають лише на експорті.
    EntityTagPlugin.configure({
      getEntities: getCoreEntities || (() => []),
      isVisible: isEntityTagsVisible || (() => true),
      chipClass: 'nova-entity-chip',
      hiddenClass: 'nova-entity-tag-hidden',
      isEnglishUi: isEnglishUi || (() => false),
    }),
    TagPlugin,
    // Постійні номери абзаців (Т0.5, журнал #246) — лише атрибут вузла, у текст
    // розділу не пишеться.
    ParagraphIdExtension,
  ];
}
