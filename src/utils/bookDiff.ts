/**
 * Визначення дрібних змін у книзі для економної передачі по WebSocket.
 *
 * Проблема, яку це вирішує: редактор на кожне натискання клавіші створював
 * новий об'єкт книги і надсилав його цілком. На романі в 1,2 МБ це означало
 * серіалізацію та відправку мегабайта на кожен символ.
 *
 * Тут ми з'ясовуємо, чи змінилася рівно одна секція рівно в текстових полях,
 * і якщо так — надсилаємо лише її. Порівняння йде **за посиланнями**:
 * React-код усюди створює нові об'єкти через spread, тож незмінені гілки
 * зберігають ідентичність. Це робить перевірку дешевою — жодного глибокого
 * порівняння рядків, крім самої зміненої секції.
 *
 * Будь-яка структурна зміна (додали главу, перейменували секцію, змінили
 * персонажів) діфу не піддається — тоді викликач надсилає книгу повністю.
 */

import type { Book, Chapter, Section } from '../types';

/** Поля секції, які редактор змінює під час набору тексту. */
const PATCHABLE_SECTION_FIELDS = ['content', 'contentEn', 'wordCount', 'lastModified'] as const;

/** Поля книги, яким дозволено змінюватися разом із правкою тексту. */
const IGNORED_BOOK_FIELDS = new Set(['chapters', 'updatedAt']);

export interface SectionPatch {
  chapterId: string;
  sectionId: string;
  content?: string;
  contentEn?: string;
  wordCount?: number;
  lastModified?: string;
}

/** Порівнює верхній рівень книги за посиланнями, ігноруючи chapters/updatedAt. */
function topLevelUnchanged(prev: Book, next: Book): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (IGNORED_BOOK_FIELDS.has(key)) continue;
    if ((prev as unknown as Record<string, unknown>)[key] !== (next as unknown as Record<string, unknown>)[key]) {
      return false;
    }
  }
  return true;
}

/** Знаходить єдиний елемент масиву, що змінився за посиланням. Інакше -1. */
function findSoleChangedIndex<T>(prev: T[], next: T[]): number {
  if (prev.length !== next.length) return -1;
  let found = -1;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== next[i]) {
      if (found !== -1) return -1; // змінилося більше одного — не наш випадок
      found = i;
    }
  }
  return found;
}

/** Перевіряє, що в главі змінився лише масив секцій. */
function chapterOnlySectionsChanged(prev: Chapter, next: Chapter): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (key === 'sections') continue;
    if ((prev as unknown as Record<string, unknown>)[key] !== (next as unknown as Record<string, unknown>)[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Повертає компактний патч, якщо між двома станами книги змінилися лише
 * текстові поля однієї секції. В усіх інших випадках — null.
 */
export function diffSectionChange(prev: Book, next: Book): SectionPatch | null {
  if (prev === next) return null;
  if (!prev?.chapters || !next?.chapters) return null;
  if (!topLevelUnchanged(prev, next)) return null;

  const chapterIndex = findSoleChangedIndex(prev.chapters, next.chapters);
  if (chapterIndex === -1) return null;

  const prevChapter = prev.chapters[chapterIndex];
  const nextChapter = next.chapters[chapterIndex];
  if (!prevChapter?.sections || !nextChapter?.sections) return null;
  if (!chapterOnlySectionsChanged(prevChapter, nextChapter)) return null;

  const sectionIndex = findSoleChangedIndex(prevChapter.sections, nextChapter.sections);
  if (sectionIndex === -1) return null;

  const prevSection = prevChapter.sections[sectionIndex];
  const nextSection = nextChapter.sections[sectionIndex];
  if (!prevSection || !nextSection) return null;
  if (prevSection.id !== nextSection.id) return null;

  // Переконуємось, що змінилися виключно текстові поля.
  const patchable = new Set<string>(PATCHABLE_SECTION_FIELDS);
  const keys = new Set([...Object.keys(prevSection), ...Object.keys(nextSection)]);
  for (const key of keys) {
    if (patchable.has(key)) continue;
    if (
      (prevSection as unknown as Record<string, unknown>)[key] !==
      (nextSection as unknown as Record<string, unknown>)[key]
    ) {
      return null;
    }
  }

  const patch: SectionPatch = {
    chapterId: nextChapter.id,
    sectionId: nextSection.id,
  };

  let hasChange = false;
  for (const field of PATCHABLE_SECTION_FIELDS) {
    if (prevSection[field] !== nextSection[field]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[field] = nextSection[field];
      hasChange = true;
    }
  }

  return hasChange ? patch : null;
}

/**
 * Застосовує патч до книги, створюючи нові об'єкти лише на шляху
 * до зміненої секції. Решта дерева зберігає ідентичність, тож React
 * не перерендерює непричетні частини інтерфейсу.
 *
 * Повертає ту саму книгу, якщо секцію не знайдено — щоб застарілий
 * патч від співавтора не зіпсував локальний стан.
 */
export function applySectionPatch(book: Book, patch: SectionPatch): Book {
  if (!book?.chapters || !patch) return book;

  const chapterIndex = book.chapters.findIndex((c) => c.id === patch.chapterId);
  if (chapterIndex === -1) return book;

  const chapter = book.chapters[chapterIndex];
  const sectionIndex = (chapter.sections || []).findIndex((s) => s.id === patch.sectionId);
  if (sectionIndex === -1) return book;

  const section = chapter.sections[sectionIndex];
  const updatedSection: Section = { ...section };

  let changed = false;
  for (const field of PATCHABLE_SECTION_FIELDS) {
    const incoming = patch[field];
    if (incoming !== undefined && incoming !== section[field]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (updatedSection as any)[field] = incoming;
      changed = true;
    }
  }
  if (!changed) return book;

  const updatedSections = [...chapter.sections];
  updatedSections[sectionIndex] = updatedSection;

  const updatedChapters = [...book.chapters];
  updatedChapters[chapterIndex] = { ...chapter, sections: updatedSections };

  return { ...book, chapters: updatedChapters, updatedAt: new Date().toISOString() };
}

/** Приблизний розмір патча в байтах — для діагностики та логів. */
export function patchSize(patch: SectionPatch): number {
  return new Blob([JSON.stringify(patch)]).size;
}
