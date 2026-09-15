import type { Book } from '../types';

/**
 * Авторство книги: хто насправді її автор.
 *
 * НАВІЩО ЧИСТА ФУНКЦІЯ. Поле `author` у книзі заповнюється з різних джерел, і
 * одне з них — службове: майстер перенесення .docx писав туди «Невідомий
 * автор», коли у файлі імені не було. Це значення потім їхало ВСЮДИ: у шапку
 * студії, у колонтитули PDF, на обкладинку, у картку товару у вітрині.
 *
 * Правило просте, але його треба застосувати однаково скрізь, тож воно живе
 * тут, а не в ефекті React: так його видно й перевірено тестом.
 */

/** Усе, що НЕ є іменем людини: порожньо або службове значення двома мовами. */
export const PLACEHOLDER_AUTHORS = ['', 'невідомий автор', 'unknown author'];

export function isPlaceholderAuthor(value?: string | null): boolean {
  return PLACEHOLDER_AUTHORS.includes((value || '').trim().toLowerCase());
}

export interface ResolvedAuthor {
  author: string;
  authorEn: string;
}

/**
 * Що підставити замість службового значення.
 *
 * Порядок джерел не випадковий:
 *  1. **Обкладинка книги** (`coverConfig.authorName`) — якщо автор уже вписав
 *     там себе, саме це імʼя й має стояти скрізь. У реальній книзі Дениса
 *     Деменка це «Деменко Денис» — те, що надруковано на титулі.
 *  2. **Імʼя залогіненого користувача** — для книг, де обкладинку ще не
 *     заповнювали: автором є той, хто книгу створив чи переніс.
 *
 * Повертає `null`, коли правка не потрібна: справжнього автора не чіпаємо
 * ніколи.
 */
export function resolveBookAuthor(
  book: Pick<Book, 'author' | 'authorEn' | 'coverConfig'>,
  userName?: string | null
): ResolvedAuthor | null {
  if (!isPlaceholderAuthor(book.author)) return null;

  const fromCover = (book.coverConfig?.authorName || '').trim();
  const next = !isPlaceholderAuthor(fromCover) ? fromCover : (userName || '').trim();
  if (!next) return null;

  return {
    author: next,
    // Англійська редакція бере `authorEn || author`, тож порожнє поле лишаємо
    // порожнім, а службове — замінюємо тим самим іменем.
    authorEn: isPlaceholderAuthor(book.authorEn) ? next : (book.authorEn as string),
  };
}
