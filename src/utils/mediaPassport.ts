/**
 * Паспорт зображення в Медіатеці (Т2.3 В1, PLAN_VISUAL_LIBRARY.md) — спільне
 * для клієнта: підписи, пошук серверного файлу за URL картки, заміна URL
 * у книзі після нової версії.
 *
 * Серверна частина — `server/media/mediaLibraryStore.ts` (там самі переліки й
 * правила перевірки); тут лише те, що потрібно показати й зробити в книзі.
 */

export type MediaSourceKey = 'upload' | 'ai' | 'stock' | 'commission' | 'scan';
export type MediaLicenseKey = 'own' | 'cc-by' | 'cc-by-sa' | 'cc0' | 'licensed' | 'unknown';
export type MediaStatusKey = 'draft' | 'final';

export const MEDIA_SOURCE_LABELS: Record<MediaSourceKey, { uk: string; en: string }> = {
  upload: { uk: 'Завантажено автором', en: 'Uploaded by the author' },
  ai: { uk: 'Згенеровано ШІ', en: 'AI-generated' },
  stock: { uk: 'Фотобанк', en: 'Stock' },
  commission: { uk: 'Замовлено в художника', en: 'Commissioned' },
  scan: { uk: 'Скан / фото сторінки', en: 'Scan / page photo' },
};

export const MEDIA_LICENSE_LABELS: Record<MediaLicenseKey, { uk: string; en: string }> = {
  own: { uk: 'Власна (права в автора)', en: 'Own (author holds rights)' },
  'cc-by': { uk: 'CC BY', en: 'CC BY' },
  'cc-by-sa': { uk: 'CC BY-SA', en: 'CC BY-SA' },
  cc0: { uk: 'CC0 (суспільне надбання)', en: 'CC0 (public domain)' },
  licensed: { uk: 'Придбана ліцензія', en: 'Purchased licence' },
  unknown: { uk: 'Невідома — з\'ясувати', en: 'Unknown — check' },
};

export const MEDIA_STATUS_LABELS: Record<MediaStatusKey, { uk: string; en: string }> = {
  draft: { uk: 'Чернетка', en: 'Draft' },
  final: { uk: 'Готове', en: 'Final' },
};

export const MEDIA_SOURCE_KEYS = Object.keys(MEDIA_SOURCE_LABELS) as MediaSourceKey[];
export const MEDIA_LICENSE_KEYS = Object.keys(MEDIA_LICENSE_LABELS) as MediaLicenseKey[];
export const MEDIA_STATUS_KEYS = Object.keys(MEDIA_STATUS_LABELS) as MediaStatusKey[];

/** Ліцензії, які вимагають зазначити автора при використанні. */
export const LICENSES_REQUIRE_AUTHOR: MediaLicenseKey[] = ['cc-by', 'cc-by-sa', 'licensed'];

const MEDIA_URL_PREFIX = '/api/media/file/';

/** id файлу серверної медіатеки з його URL; null — це не файл медіатеки (data:, зовнішній…). */
export function mediaIdFromUrl(url: string | null | undefined): string | null {
  const raw = String(url || '');
  if (!raw.startsWith(MEDIA_URL_PREFIX)) return null;
  const id = raw.slice(MEDIA_URL_PREFIX.length).split(/[?#]/)[0];
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** Що не так із паспортом — для позначки на картці (порожньо — усе гаразд). */
export function passportWarnings(a: { license?: string; author?: string; status?: string }): string[] {
  const out: string[] = [];
  if (!a.license || a.license === 'unknown') out.push('license');
  if (a.license && LICENSES_REQUIRE_AUTHOR.includes(a.license as MediaLicenseKey) && !String(a.author || '').trim()) out.push('author');
  return out;
}

/**
 * Замінити URL старої версії на нову всюди в книзі: портрети героїв,
 * обкладинка, ілюстрації, а також будь-які посилання в тексті. URL файлу
 * медіатеки не містить символів, які треба екранувати в JSON, тож заміна
 * в серіалізованій книзі точна й не зачіпає нічого іншого.
 * Повертає нову книгу й кількість замін (0 — книга та сама).
 */
export function replaceMediaUrlInBook<T>(book: T, oldUrl: string, newUrl: string): { book: T; count: number } {
  if (!oldUrl || !newUrl || oldUrl === newUrl || !mediaIdFromUrl(oldUrl) || !mediaIdFromUrl(newUrl)) return { book, count: 0 };
  const json = JSON.stringify(book);
  // Точний збіг цілого URL: `/api/media/file/md-1` не має зачепити `/api/media/file/md-10`.
  const pattern = new RegExp(`${oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`, 'g');
  let count = 0;
  const replaced = json.replace(pattern, () => {
    count++;
    return newUrl;
  });
  return count ? { book: JSON.parse(replaced) as T, count } : { book, count: 0 };
}
