/**
 * Версія книги для синхронізації між сесіями.
 *
 * Навіщо окремий файл. Nova синхронізує книгу між вкладками, браузерами й
 * пристроями через WebSocket-кімнату. Доти «правильною» вважалась та копія,
 * що прийшла останньою, — а це означало тихе затирання: автор, який відкрив
 * книгу на другому пристрої зі старим станом, перезаписував ним свіжий текст,
 * і жодне повідомлення про це не показувалось.
 *
 * Тут — єдине джерело правди про те, ЯКА копія новіша. Порівняння свідомо
 * побудоване на `book.updatedAt`, а не на лічильнику ревізій: поле вже існує
 * в типі `Book`, тож старі книги (створені до цієї правки) не ламаються — у
 * них просто дата створення, і будь-яка нова правка їх обійде.
 *
 * Що це НЕ вирішує: одночасне редагування того самого абзацу двома людьми.
 * Це задача CRDT-злиття, і вдавати її розвʼязаною тут було б гірше, ніж
 * чесно лишити «перемагає новіший» — але вже без мовчазної втрати.
 */

import type { Book } from '../types';

/** Позначка версії в мілісекундах. Невідома або зіпсована дата — 0 (найстаріша). */
export function bookRevisionMs(book: Pick<Book, 'updatedAt'> | null | undefined): number {
  const raw = book?.updatedAt;
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Чи копія `incoming` новіша за `current`.
 *
 * Рівні позначки — НЕ новіше: за такої умови два клієнти з однаковим станом
 * не ганяли б книгу по колу, перезаписуючи один одного одним і тим самим.
 */
export function isNewerBook(
  incoming: Pick<Book, 'updatedAt'> | null | undefined,
  current: Pick<Book, 'updatedAt'> | null | undefined
): boolean {
  return bookRevisionMs(incoming) > bookRevisionMs(current);
}

/**
 * Ставить книзі свіжу позначку версії.
 *
 * Час береться з клієнта, тож годинники двох пристроїв можуть розійтися.
 * Тому позначка ще й монотонна: якщо системний час відстає від уже наявної
 * позначки, беремо попередню плюс мілісекунду. Без цього пристрій із
 * годинником на хвилину позаду «омолоджував» би книгу й програвав кожну
 * наступну синхронізацію, хоча правка в нього найсвіжіша.
 */
export function stampBookRevision<T extends Pick<Book, 'updatedAt'>>(book: T): T {
  const previous = bookRevisionMs(book);
  const now = Date.now();
  const next = now > previous ? now : previous + 1;
  return { ...book, updatedAt: new Date(next).toISOString() };
}

/** Людський опис розбіжності — для повідомлення авторові, а не для логіки. */
export function describeRevisionGap(
  incoming: Pick<Book, 'updatedAt'> | null | undefined,
  current: Pick<Book, 'updatedAt'> | null | undefined
): string {
  const diffMs = Math.abs(bookRevisionMs(current) - bookRevisionMs(incoming));
  if (diffMs < 60_000) return 'менш ніж хвилину';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes} хв`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} год`;
  return `${Math.round(hours / 24)} дн`;
}
