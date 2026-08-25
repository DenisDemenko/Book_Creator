import type { Book } from '../types';

/**
 * Одноразовий прохід по книзі: дописує `wrap=left` у маркери зображень,
 * написані ще до появи режимів обтікання.
 *
 * Навіщо взагалі чіпати вже написаний текст: раніше маркер без `wrap=`
 * означав «картинка блоком на всю ширину», і саме так відкривались усі
 * старі книги. Автор попросив, щоб такі фото відкривались обтічними
 * зліва. Самого лише дефолту в WrappedImageNode для цього достатньо
 * ВІЗУАЛЬНО, але тоді режим лишався б неявним: перший же експорт або
 * відкриття книги іншим інструментом читали б маркер по-старому. Тому
 * режим фіксується в тексті явно.
 *
 * Функція чиста — вона нічого не зберігає й не показує. Виклик у App.tsx
 * сам вирішує, чи робити знімок версії й запис у журналі змін.
 */

/** Той самий маркер, що читає manuscriptDoc.ts і рендерить helpers.ts. */
const IMG_MARKER_RE =
  /\[IMG:\s*([^\s\]"]+)\s*(?:"([^"]*)")?(?:\s+wrap=(\w+))?(?:\s+width=([\d.]+)mm)?(?:\s+height=([\d.]+)mm)?(?:\s+shape="([^"]*)")?\]/g;

function migrateText(text: string): { text: string; changed: number } {
  if (!text || !text.includes('[IMG:')) return { text, changed: 0 };

  let changed = 0;
  const next = text.replace(
    IMG_MARKER_RE,
    (full, id: string, caption: string | undefined, wrap: string | undefined, widthMm?: string, heightMm?: string, shape?: string) => {
      if (wrap) return full;
      changed += 1;
      const widthPart = widthMm ? ` width=${widthMm}mm` : '';
      const heightPart = heightMm ? ` height=${heightMm}mm` : '';
      const shapePart = shape ? ` shape="${shape}"` : '';
      return `[IMG: ${id} "${caption || ''}" wrap=left${widthPart}${heightPart}${shapePart}]`;
    }
  );

  return { text: next, changed };
}

export interface WrapMigrationResult {
  book: Book;
  /** Скільки маркерів отримало явний режим обтікання. 0 — книга вже мігрована, зберігати нічого не треба. */
  changed: number;
}

export function migrateImageWrapDefaults(book: Book): WrapMigrationResult {
  let changed = 0;

  const chapters = book.chapters.map((chapter) => ({
    ...chapter,
    sections: chapter.sections.map((section) => {
      const ua = migrateText(section.content || '');
      const en = migrateText(section.contentEn || '');
      changed += ua.changed + en.changed;
      if (!ua.changed && !en.changed) return section;
      return {
        ...section,
        content: ua.text,
        ...(section.contentEn !== undefined ? { contentEn: en.text } : {}),
      };
    }),
  }));

  if (!changed) return { book, changed: 0 };
  return { book: { ...book, chapters }, changed };
}
