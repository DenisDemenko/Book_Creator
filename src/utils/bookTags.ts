import type { Book } from '../types';
import { calculateWordCount } from './helpers';

/**
 * Теги-вставки в тексті книги: власний абзац, що починається з «тега: ».
 * Зберігаються як звичайний текст у `section.content` (жодної нової схеми),
 * рендеряться зеленим через TagPlugin.ts, шукаються/вставляються цим модулем.
 */
export const TAG_LINE_RE = /^тега:\s*(.+)$/;

export interface BookTag {
  name: string;
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
}

/** Усі теги книги — по всіх главах і розділах. */
export function collectBookTags(book: Book): BookTag[] {
  const tags: BookTag[] = [];
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      const paragraphs = (section.content || '').split(/\n{2,}/);
      for (const para of paragraphs) {
        const match = para.match(TAG_LINE_RE);
        if (match) {
          tags.push({
            name: match[1].trim(),
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            sectionId: section.id,
            sectionTitle: section.title,
          });
        }
      }
    }
  }
  return tags;
}

/**
 * Вставляє текст одразу ПІСЛЯ першого тегу з заданою назвою (окремим
 * блоком абзаців). Повертає null, якщо такого тегу в розділі немає.
 */
export function insertTextAfterTag(content: string, tagName: string, text: string): string | null {
  const paragraphs = content.split(/\n{2,}/);
  const index = paragraphs.findIndex((p) => {
    const match = p.match(TAG_LINE_RE);
    return !!match && match[1].trim() === tagName;
  });
  if (index === -1) return null;
  const next = [...paragraphs];
  next.splice(index + 1, 0, text);
  return next.join('\n\n');
}

/**
 * Вставляє `text` після тегу `tag` у відповідний розділ книги.
 *
 * На відміну від `insertTextAfterTag` (працює з сирим `content`), ця
 * функція приймає цілу книгу й повертає її оновлену копію з перерахованим
 * `wordCount` і `lastModified` у секції-приймачі. Використовується
 * тренажером «Стиль письменника»: відповідь автора додається в рукопис за
 * тегом, який письменник заздалегідь залишив у тексті (`тега: #...`).
 *
 * Повертає null, якщо тегу або секції вже немає (тег видалили після того,
 * як список був зібраний) — викликач показує помилку й не чіпає книгу.
 */
export function insertTextAfterTagInBook(book: Book, tag: BookTag, text: string): Book | null {
  if (!text.trim()) return null;
  const chapter = book.chapters.find((c) => c.id === tag.chapterId);
  const section = chapter?.sections.find((s) => s.id === tag.sectionId);
  if (!chapter || !section) return null;

  const newContent = insertTextAfterTag(section.content, tag.name, text);
  if (newContent === null) return null;

  const updatedChapters = book.chapters.map((c) => {
    if (c.id !== chapter.id) return c;
    return {
      ...c,
      sections: c.sections.map((s) =>
        s.id !== section.id
          ? s
          : {
              ...s,
              content: newContent,
              wordCount: calculateWordCount(newContent),
              lastModified: new Date().toISOString(),
            }
      ),
    };
  });

  return { ...book, chapters: updatedChapters, updatedAt: new Date().toISOString() };
}
