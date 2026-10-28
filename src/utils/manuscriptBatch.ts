/**
 * Пакет сторінок рукопису з GrabFusion (A5, етап 6 «Набір книги») → глава книги.
 *
 * Сторінки приходять у «Вхідні» окремими записами, але з однаковим `batchId` і
 * номером `batchOrder`. Тут — чисті функції, які склеюють їх у текст глави й
 * вставляють цілою главою (новою або в кінець наявної). Вставка йде тим самим
 * шляхом, що й одиночний скан (`insertDescriptionIntoBook`): текст приїздить
 * AI-чернеткою, яку автор приймає чи відхиляє в редакторі.
 */

import type { Book, Chapter } from '../types';
import { instructionUid } from './instructionDraft';
import { insertDescriptionIntoBook, type DescriptionBookInsert } from './describeCharacterTransfer';

export interface BatchScanLike {
  scanId: string;
  batchId?: string | null;
  batchOrder?: number | null;
  batchBookTitle?: string | null;
  bookId: string;
  chapterTitle: string | null;
  text: string;
  recognizedText: string;
  createdAt: string;
}

export interface ScanBatch<T extends BatchScanLike = BatchScanLike> {
  batchId: string;
  /** Сторінки за номером у пакеті. */
  pages: T[];
  chapterTitle: string;
  /** Назва нової книги, якщо пакет надіслано без існуючої. */
  bookTitle: string | null;
  /** Порожній `bookId` у пакеті: він призначений для книги, якої ще немає на сервері. */
  forNewBook: boolean;
}

/** Записи «Вхідних» → пакети (у порядку першої появи) та решта одиночних сканів. */
export function groupScanBatches<T extends BatchScanLike>(scans: T[]): { batches: ScanBatch<T>[]; singles: T[] } {
  const byId = new Map<string, T[]>();
  const singles: T[] = [];
  for (const s of scans) {
    if (s.batchId) {
      const list = byId.get(s.batchId) ?? [];
      list.push(s);
      byId.set(s.batchId, list);
    } else singles.push(s);
  }
  const batches: ScanBatch<T>[] = [...byId.entries()].map(([batchId, list]) => {
    const pages = [...list].sort((a, b) => (a.batchOrder ?? 0) - (b.batchOrder ?? 0) || a.createdAt.localeCompare(b.createdAt));
    return {
      batchId,
      pages,
      chapterTitle: pages.find((p) => p.chapterTitle)?.chapterTitle || '',
      bookTitle: pages.find((p) => p.batchBookTitle)?.batchBookTitle || null,
      forNewBook: pages.every((p) => !p.bookId),
    };
  });
  return { batches, singles };
}

/** Текст сторінки скану: правка автора, а коли її немає — те, що розпізнала модель. */
export const scanPageText = (s: Pick<BatchScanLike, 'text' | 'recognizedText'>): string => (s.text || s.recognizedText || '').trim();

const SENTENCE_END = /[.!?…»"”’)\]:;]$/;

/**
 * Склеює тексти сторінок у текст глави. Між сторінками — порожній рядок (новий
 * абзац), крім випадку, коли сторінка обірвалась посеред речення: тоді наступна
 * (з малої літери) продовжує той самий абзац. Слово, перенесене через сторінку
 * дефісом, склеюється назад. Порожні сторінки пропускаються.
 */
export function joinManuscriptPages(texts: string[]): string {
  let out = '';
  for (const raw of texts) {
    const page = raw.replace(/\r\n/g, '\n').trim();
    if (!page) continue;
    if (!out) {
      out = page;
      continue;
    }
    const startsLower = /^\p{Ll}/u.test(page);
    if (startsLower && /\p{L}-$/u.test(out)) out = `${out.slice(0, -1)}${page}`;
    else if (startsLower && !SENTENCE_END.test(out)) out = `${out} ${page}`;
    else out = `${out}\n\n${page}`;
  }
  return out;
}

export interface BatchInsertOptions {
  /** Існуюча глава, у кінець якої лягає текст; порожньо — створити нову главу в кінці книги. */
  chapterId?: string | null;
  /** Назва нової глави (або розділу, під яким текст ляже в наявну). */
  title: string;
  /** Фіксовані id для тестів. */
  newChapterId?: string;
  now?: string;
}

/**
 * Вставляє главу з пакета. `null` — нічого вставляти (порожній текст). Нова глава
 * отримує наступний `order` у книзі й одну секцію з текстом.
 */
export function insertBatchIntoBook(book: Book, text: string, options: BatchInsertOptions): DescriptionBookInsert | null {
  const body = text.trim();
  if (!body) return null;
  const title = options.title.trim() || 'Глава з телефона';
  const now = options.now || new Date().toISOString();
  const chapters = [...(book.chapters || [])];
  const existing = options.chapterId ? chapters.find((c) => c.id === options.chapterId) : undefined;
  let working: Book = book;
  let chapterId = existing?.id ?? '';
  if (!existing) {
    chapterId = options.newChapterId || instructionUid('chap');
    const next: Chapter = {
      id: chapterId,
      bookId: book.id,
      title,
      order: chapters.reduce((max, c) => Math.max(max, c.order), 0) + 1,
      sections: [],
    } as Chapter;
    working = { ...book, chapters: [...chapters, next] };
  }
  return insertDescriptionIntoBook(working, { title, text: body, chapterId }, { chapterId, withPhoto: false, now });
}
