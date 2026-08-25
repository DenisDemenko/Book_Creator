import type { Chapter } from '../types';
import { calculateWordCount } from './helpers';

export interface AppendTextResult {
  /** Оновлений масив розділів книги — лише цільова секція змінена. */
  chapters: Chapter[];
  /** Секція, куди дописано текст (остання за `order` в розділі). */
  sectionId: string;
  /** Позиція в новому content, де починається вставлений текст. */
  start: number;
  /** Позиція, де вставлений текст закінчується (start + text.length). */
  end: number;
}

/**
 * Дописує `text` у кінець ОСТАННЬОЇ (за `order`) секції розділу `chapterId`.
 * Використовується для «Передати текст у книгу» (QuickAiModal.tsx →
 * App.tsx handleSendChatTextToChapter) — винесено в чисту функцію, щоб
 * тестувати без React (scripts/test-bookText.mts).
 */
export function appendTextToChapterEnd(
  chapters: Chapter[],
  chapterId: string,
  text: string
): AppendTextResult | null {
  if (!text.trim()) return null;
  const chapter = chapters.find((c) => c.id === chapterId);
  if (!chapter || chapter.sections.length === 0) return null;

  const sortedSections = [...chapter.sections].sort((a, b) => a.order - b.order);
  const lastSection = sortedSections[sortedSections.length - 1];

  const separator = lastSection.content ? '\n\n' : '';
  const start = lastSection.content.length + separator.length;
  const newContent = `${lastSection.content}${separator}${text}`;

  const updatedChapters = chapters.map((chap) => {
    if (chap.id !== chapterId) return chap;
    return {
      ...chap,
      sections: chap.sections.map((sec) =>
        sec.id !== lastSection.id
          ? sec
          : { ...sec, content: newContent, wordCount: calculateWordCount(newContent), lastModified: new Date().toISOString() }
      ),
    };
  });

  return { chapters: updatedChapters, sectionId: lastSection.id, start, end: start + text.length };
}
