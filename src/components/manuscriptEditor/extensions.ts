import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { FontSpanMark } from './FontSpanMark';
import { FontSizeMark } from './FontSizeMark';
import { WrappedImageNode, type WrappedImageOptions } from './WrappedImageNode';
import { AiDraftBlockNode } from './AiDraftBlockNode';
import { FocusParagraphPlugin } from './FocusParagraphPlugin';
import { CharacterMentionPlugin, type CharacterMentionEntry } from './CharacterMentionPlugin';
import { ReadabilityHighlightPlugin } from './ReadabilityHighlightPlugin';

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
 * inline-теги на кшталт списків/заголовків/посилань навмисно вимкнені,
 * бо серіалізатор не вміє записати їх назад у формат маркерів книги.
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
  isReadabilityHighlightEnabled?: () => boolean
) {
  return [
    StarterKit.configure({
      heading: false,
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
  ];
}
