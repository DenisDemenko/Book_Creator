/**
 * `externalId` мосту → що це за лістинг.
 *
 * Формати, які реально ходять (див. server/marketplaceBridge.ts):
 *   `bookId:digital` / `bookId:print`        — книга
 *   `bookId:digital:chromium`                — тестове видання рушієм
 *   `bookId:course`                          — курс
 *   `product:SKU`                            — фізичний виріб
 * Розбираємо за формою, а не «усе після останньої двокрапки»: той підхід
 * приймав `…:chromium` за формат і показував тестове видання як електронну
 * книгу, а курс і виріб — теж як «Електронний».
 */
export type ListingKind = 'digital' | 'print' | 'course' | 'product';

export interface ParsedExternalId {
  kind: ListingKind;
  /** bookId для книг і курсів, SKU для виробів. */
  id: string;
  /** Рушій тестового видання, якщо є. */
  engineId?: string;
}

export function parseExternalId(externalId: string): ParsedExternalId {
  const product = /^product:(.+)$/.exec(externalId);
  if (product) return { kind: 'product', id: product[1] };

  const course = /^(.+):course$/.exec(externalId);
  if (course) return { kind: 'course', id: course[1] };

  const book = /^(.+):(digital|print)(?::([A-Za-z0-9_-]+))?$/.exec(externalId);
  if (book) {
    return { kind: book[2] as 'digital' | 'print', id: book[1], engineId: book[3] || undefined };
  }
  return { kind: 'digital', id: externalId };
}

export const KIND_LABELS: Record<ListingKind, string> = {
  digital: 'Електронний',
  print: 'Друкований',
  course: 'Курс',
  product: 'Виріб',
};
