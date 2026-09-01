import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { FontSpanMark } from './FontSpanMark';
import { FontSizeMark } from './FontSizeMark';
import { WrappedImageNode, type WrappedImageOptions } from './WrappedImageNode';
import { AiDraftBlockNode } from './AiDraftBlockNode';

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
  aiText: ManuscriptAiTextOptions
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
  ];
}
