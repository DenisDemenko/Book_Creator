/**
 * Посилання на файл власної медіатеки Студії (`/api/media/file/<id>`).
 *
 * Чиста функція без залежностей — щоб її могли викликати і правила подання
 * курсу (клієнт + сервер), і збирач payload, і синхронізація фото з вітриною,
 * не тягнучи за собою сховище. Префікс той самий, що `MEDIA_URL_PREFIX` у
 * `server/media/mediaLibraryStore.ts` (тест `test:course-media` звіряє їх).
 */
export const LIBRARY_MEDIA_PREFIX = '/api/media/file';

/** Id активу медіатеки або `null`, якщо це не посилання на медіатеку. */
export function libraryAssetId(url: string | undefined | null): string | null {
  const raw = String(url ?? '').trim();
  if (!raw.startsWith(`${LIBRARY_MEDIA_PREFIX}/`)) return null;
  const id = raw.slice(LIBRARY_MEDIA_PREFIX.length + 1).split(/[?#]/)[0];
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
}

/** Ознака, під якою фото іде у вітрину в кошику змісту: `media:<id активу>`. */
export const MEDIA_TOKEN_PREFIX = 'media:';

export const mediaToken = (assetId: string): string => `${MEDIA_TOKEN_PREFIX}${assetId}`;
