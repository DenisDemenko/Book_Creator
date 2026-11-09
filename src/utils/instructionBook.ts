import type { Book, BookVersionSnapshot, Section, UserRole } from '../types';
import { initialBookData } from '../data/initialBook';
import { applyBookDesignTheme, type BookDesignThemeId } from '../data/bookDesignThemeCatalog';
import { withoutDemoContent } from './starterBook';
import { calculateWordCount } from './helpers';
import type { InstructionBookCreationPayload } from './instructionBookDraft';

/**
 * Книга з документа інструкції — ОДНЕ місце, де вона складається. Раніше це жило всередині
 * `App.handleInstructionBookCreated`; тепер те саме складання потрібне й для PDF-верстки просто з
 * конструктора (вибір шаблону й рушія, див. instructionPdf.ts): PDF-рушій приймає цілу книгу, а створювати її в
 * «Книга & Текст» заради перегляду PDF не треба. Функція чиста: id й час приходять ззовні.
 */

export interface InstructionBookBuildOptions {
  /** Час у мс: з нього ж робляться id книги, глави й розділів. */
  now: number;
  author: string;
  authorRole: UserRole;
  /** Шаблон верстки (`BookDesignThemeId`), обраний у документі інструкції; без нього — типовий для книги. */
  designThemeId?: string;
}

export interface InstructionBookBuild {
  book: Book;
  chapterId: string;
  sections: Section[];
}

export function buildBookFromInstructionPayload(payload: InstructionBookCreationPayload, opts: InstructionBookBuildOptions): InstructionBookBuild {
  const { now, author, authorRole } = opts;
  const iso = new Date(now).toISOString();
  const bookId = `BK-${now.toString(36).toUpperCase()}`;
  const title = payload.title.trim() || 'Нова інструкція';
  const note = 'Книга створена з майстра «Інструкція» — з поглибленнями кроків від ШІ.';
  const initialSnapshot: BookVersionSnapshot = {
    id: `snap-init-${now}`,
    bookId,
    versionNumber: 'v1.0.0',
    revisionNumber: 1,
    timestamp: iso,
    author,
    authorName: author,
    authorRole,
    label: 'Ініціалізація та старт проекту',
    comment: note,
    note,
    tags: ['Створення', 'Інструкція', 'Express Wizard'],
    wordCount: 0,
    chapterCount: 1,
    pageCount: 1,
  };
  const chapterId = `chap-${now}-1`;
  const drafts = payload.sections.length ? payload.sections : [{ title: 'Розділ', content: '' }];
  const sections: Section[] = drafts.map((s, i) => ({
    id: `sec-${now}-${i + 1}`,
    chapterId,
    title: s.title,
    order: i + 1,
    content: s.content,
    wordCount: calculateWordCount(s.content),
    lastModified: iso,
  }));
  const book: Book = withoutDemoContent(
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
      versionHistory: [initialSnapshot],
      status: 'draft',
      visualBible: { ...initialBookData.visualBible, id: `vb-${now}`, bookId },
      chapters: [{ id: chapterId, bookId, title, order: 1, sections }],
    },
    { title, author }
  );

  // Кадри кроків: `withoutDemoContent` обнуляє альбом, тож додаємо їх після. id збігаються з маркерами [IMG: …] у тексті кроків.
  if (payload.illustrations?.length) {
    book.illustrations = payload.illustrations.map((il) => ({
      id: il.id,
      chapterId,
      url: il.url,
      caption: il.caption,
      aspectRatio: '16:9',
      style: 'Медіатека',
      source: 'upload' as const,
      createdAt: iso,
    }));
  }
  if (opts.designThemeId) {
    book.layoutConfig = applyBookDesignTheme(book.layoutConfig, opts.designThemeId as BookDesignThemeId);
  }
  return { book, chapterId, sections };
}
