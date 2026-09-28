/**
 * Вставка результату допиту в книгу (Т2.7 В5, `PLAN_INTERVIEW.md`).
 *
 * Сервер, приймаючи фрагмент допиту, рукопис не змінює — повертає, ЩО й
 * КУДИ вставити (`insert`). Тут — чисті функції, які кладуть це в книгу:
 *   • `ai_draft`   — блок `[AI-DRAFT]…[/AI-DRAFT]` у кінець вибраного
 *                    розділу (той самий шлях, що й решта AI-чернеток:
 *                    `appendTextToChapterEnd`; у редакторі — «прийняти /
 *                    відхилити»);
 *   • `append_tag` — тег (П7), прийнятий окремо після фрагмента: дописати
 *                    одразу за текстом фрагмента (після тегів, що вже там),
 *                    — і в чернетці, і після того, як автор її прийняв.
 * Фрагмента в розділі вже немає (переписано чи видалено) — null: виклик
 * пояснює автору й не кладе тег кудись навмання.
 */

import type { Book } from '../types';
import { appendTextToChapterEnd } from './bookText';
import { calculateWordCount } from './helpers';

export interface InterviewInsert {
  sectionId: string;
  mode: 'ai_draft' | 'append_tag';
  snippet: string;
}

export interface InterviewInsertResult {
  book: Book;
  chapterId: string;
  sectionId: string;
}

const chapterOf = (book: Book, sectionId: string) => (book.chapters ?? []).find((c) => (c.sections ?? []).some((s) => s.id === sectionId)) ?? null;

/** Де закінчується фрагмент у тексті розділу разом із тегами, що стоять одразу за ним; -1 — фрагмента немає. */
export function fragmentEnd(content: string, fragmentText: string): number {
  const text = fragmentText.trim();
  if (!text) return -1;
  const at = content.indexOf(text);
  if (at < 0) return -1;
  let end = at + text.length;
  const tail = /^[ \t]*\[\/[a-z0-9Ѐ-ӿ-]+:[^\]\n]*\]/;
  for (let m = tail.exec(content.slice(end)); m; m = tail.exec(content.slice(end))) end += m[0].length;
  return end;
}

export function applyInterviewInsert(book: Book, insert: InterviewInsert, fragmentText?: string): InterviewInsertResult | null {
  const chapter = chapterOf(book, insert.sectionId);
  if (!chapter || !insert.snippet.trim()) return null;
  if (insert.mode === 'ai_draft') {
    const r = appendTextToChapterEnd(book.chapters, chapter.id, insert.snippet, insert.sectionId);
    return r ? { book: { ...book, chapters: r.chapters }, chapterId: chapter.id, sectionId: r.sectionId } : null;
  }
  const section = chapter.sections.find((s) => s.id === insert.sectionId)!;
  const end = fragmentEnd(section.content, fragmentText ?? '');
  if (end < 0) return null;
  // Рядками, а не String.replace: у тексті книги може бути «$», який replace тлумачить.
  const content = `${section.content.slice(0, end)} ${insert.snippet.trim()}${section.content.slice(end)}`;
  const chapters = book.chapters.map((c) =>
    c.id !== chapter.id
      ? c
      : { ...c, sections: c.sections.map((s) => (s.id !== section.id ? s : { ...s, content, wordCount: calculateWordCount(content), lastModified: new Date().toISOString() })) },
  );
  return { book: { ...book, chapters }, chapterId: chapter.id, sectionId: section.id };
}
