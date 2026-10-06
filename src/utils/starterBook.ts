import type { Book, BookVersionSnapshot, UserRole } from '../types';
import { initialBookData } from '../data/initialBook';

/** Чия це книга — цими підписами підписується обкладинка. */
export interface BookIdentity {
  title: string;
  author: string;
}

/**
 * Прибирає з нової книги демо-контент зразка (`src/data/initialBook.ts`).
 *
 * НАВІЩО. Демо-книга — зразок контенту, а не книга автора. Проте кожен шлях
 * створення книги брав її за основу (`...initialBookData`), і разом із нею в
 * книгу автора переходили чотири демо-персонажі зі стоковими портретами,
 * демо-обкладинка з чужим прізвищем на ній і текст зразка. Портрети — це
 * фото сторонніх людей, і вони одразу осідали в Медіатеці нового автора:
 * саме на це скаржився власник 06.10.2026 («ці фото попали при вході нового
 * користувача в медіатеку його; медіатека повинна бути пуста для нового
 * користувача»).
 *
 * ЩО ЧИСТИМО: персонажів, ілюстрації, зноски й QR-теги, тексти книги
 * (синопсис, логлайн, тему, підзаголовок, цільову аудиторію) та обкладинку —
 * її зображення й демо-підписи (назва, автор, анотація, біографія, ISBN).
 *
 * ЩО ЛИШАЄМО: `layoutConfig` — типові параметри друку A5, від яких залежить
 * `utils/pageGeometry.ts`, і `visualBible` — палітра та стиль зразка: це
 * налаштування вигляду, а не дані автора.
 *
 * `identity` передають, коли вже відомо, чия книга: тоді підписи обкладинки
 * стають справжніми. Без нього (заглушка чужої книги, запрошення) підписи
 * порожні — автора ще не знають, а назва береться з самої книги.
 */
export function withoutDemoContent(book: Book, identity?: BookIdentity): Book {
  return {
    ...book,
    subtitle: '',
    targetAudience: '',
    synopsis: '',
    logline: '',
    theme: '',
    characters: [],
    heroArc: undefined,
    mindBoard: undefined,
    illustrations: [],
    footnotes: [],
    qrTags: [],
    coverConfig: {
      ...book.coverConfig,
      frontTitle: identity?.title ?? book.title,
      subtitle: '',
      authorName: identity?.author ?? '',
      backDescription: '',
      authorBio: '',
      barcode: '',
      // Демо-обкладинка — теж фото зразка, а не малюнок автора.
      frontArtUrl: undefined,
      coverImageUrl: undefined,
    },
  };
}

export interface StarterBookOptions extends BookIdentity {
  bookId: string;
  /** Роль того, хто створює книгу: нею підписується початковий знімок версії. */
  role: UserRole;
  /** Момент створення; за замовчуванням — зараз (у тестах передають явно). */
  now?: number;
}

/**
 * Порожня книга — стартова для автора, у якого своєї ще немає.
 *
 * Це той самий «порожній аркуш», що й у кнопки «Нова книга» в Студії: одна
 * глава, один порожній розділ і жодного демо-контенту. З нього ж починає
 * зареєстрований автор, який уперше відкриває Студію (App.tsx, стартова
 * книга): демо-книга лишається зразком для гостя і в сховище автора не
 * потрапляє.
 */
export function buildStarterBook({ bookId, title, author, role, now = Date.now() }: StarterBookOptions): Book {
  const chapterId = `chap-${now}-1`;
  const sectionId = `sec-${now}-1`;
  const timestamp = new Date(now).toISOString();

  const initialSnapshot: BookVersionSnapshot = {
    id: `snap-init-${now}`,
    bookId,
    versionNumber: 'v1.0.0',
    revisionNumber: 1,
    timestamp,
    author,
    authorName: author,
    authorRole: role,
    label: 'Ініціалізація та старт проекту',
    comment: 'Порожній аркуш — книгу створено з нульової планки.',
    note: 'Порожній аркуш — книгу створено з нульової планки.',
    tags: ['Створення', 'З нульової планки'],
    wordCount: 0,
    chapterCount: 1,
    pageCount: 1,
  };

  const base: Book = {
    ...initialBookData,
    id: bookId,
    title,
    author,
    genre: '',
    version: 'v1.0.0',
    revisionNumber: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    versionHistory: [initialSnapshot],
    status: 'draft',
    visualBible: { ...initialBookData.visualBible, id: `vb-${now}`, bookId },
    chapters: [
      {
        id: chapterId,
        bookId,
        title: 'Глава 1: Новий початок',
        order: 1,
        sections: [
          {
            id: sectionId,
            chapterId,
            title: 'Пролог',
            order: 1,
            content: '',
            wordCount: 0,
            lastModified: timestamp,
          },
        ],
      },
    ],
  };

  return withoutDemoContent(base, { title, author });
}
