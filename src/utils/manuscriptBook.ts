import type { Book, BookVersionSnapshot, UserRole } from '../types';
import { initialBookData } from '../data/initialBook';
import { withoutDemoContent } from './starterBook';
import { insertBatchIntoBook } from './manuscriptBatch';

/**
 * Нова книга з пакета сторінок рукопису з GrabFusion («Набір книги», журнал #540).
 *
 * Раніше сторінки лягали лише у «Вхідні», і автор мусив сам створити книгу й вставити главу. Тепер Studio
 * складає книгу при відправленні: порожня книга з назвою з GrabFusion + одна глава з текстом сторінок. Текст
 * вставляється тим самим шляхом, що й з «Вхідних» (`insertBatchIntoBook` → AI-чернетка), тож автор так само
 * приймає чи відхиляє його в редакторі, а розпізнані помилки не видаються за остаточний текст.
 *
 * Функція чиста (id й час — ззовні), як `buildBookFromInstructionPayload`: її викликає сервер при `submit`.
 */

export interface ManuscriptBookOptions {
  /** Назва книги (з `newBookTitle` чернетки). */
  title: string;
  /** Назва глави (з назви чернетки); порожньо — назва книги. */
  chapterTitle?: string;
  /** Склеєний текст сторінок. */
  text: string;
  author: string;
  authorRole: UserRole;
  /** Час у мс: з нього робляться id книги й запису версії. */
  now: number;
  pageCount?: number;
}

export interface ManuscriptBookBuild {
  book: Book;
  chapterId: string;
  chapterTitle: string;
}

export function buildBookFromManuscript(opts: ManuscriptBookOptions): ManuscriptBookBuild | null {
  const { now, author, authorRole } = opts;
  const iso = new Date(now).toISOString();
  const title = opts.title.trim() || 'Нова книга з телефона';
  const chapterTitle = (opts.chapterTitle ?? '').trim() || title;
  const bookId = `BK-${now.toString(36).toUpperCase()}`;
  const note = `Книга створена автоматично з рукопису в GrabFusion${opts.pageCount ? ` (сторінок: ${opts.pageCount})` : ''}.`;
  const snapshot: BookVersionSnapshot = {
    id: `snap-init-${now}`,
    bookId,
    versionNumber: 'v1.0.0',
    revisionNumber: 1,
    timestamp: iso,
    author,
    authorName: author,
    authorRole,
    label: 'Створення з рукопису GrabFusion',
    comment: note,
    note,
    tags: ['Створення', 'GrabFusion', 'Рукопис'],
    wordCount: 0,
    chapterCount: 1,
    pageCount: opts.pageCount ?? 1,
  };
  const blank: Book = withoutDemoContent(
    {
      ...initialBookData,
      id: bookId,
      title,
      author,
      genre: '',
      version: 'v1.0.0',
      revisionNumber: 1,
      createdAt: iso,
      updatedAt: iso,
      versionHistory: [snapshot],
      status: 'draft',
      visualBible: { ...initialBookData.visualBible, id: `vb-${now}`, bookId },
      chapters: [],
    },
    { title, author }
  );
  const inserted = insertBatchIntoBook(blank, opts.text, { title: chapterTitle, newChapterId: `chap-${now}-1`, now: iso });
  if (!inserted) return null; // порожній текст: книги з нічого не робимо
  return { book: inserted.book, chapterId: inserted.chapterId, chapterTitle: inserted.chapterTitle };
}
