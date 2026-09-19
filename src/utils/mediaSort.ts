/**
 * Способи сортування медіатеки.
 *
 * Доти порядок у галереї був один — за форматом файлу
 * (`compareByImageFormat` із `imageFormat.ts`). Для відео він майже
 * безглуздий: Leonardo.Ai віддає тільки MP4, тож усі кліпи опинялися в
 * одній нерозрізненній купі, а номер кадру в серії важливіший за
 * розширення. Тепер порядок обирає автор, а за замовчуванням медіатека
 * показує файли в порядку появи — «від першої генерації до останньої».
 *
 * Дату знає лише серверна медіатека (`MediaAsset.createdAt`, ISO-рядок,
 * `listAssets` віддає її разом із файлом). Посилання, вбудовані просто в
 * книгу, дати не мають зовсім — тому тут не припущення, а чесна межа:
 * файли без дати завжди йдуть у кінці, і коли сортуємо від першої, і коли
 * від останньої. Поставити «невідомо коли» на початок означало б вигадати
 * факт, якого в даних немає.
 */

import { compareByImageFormat } from './imageFormat';

export type MediaSortMethod = 'generationAsc' | 'generationDesc' | 'format' | 'title' | 'size';

/** Порядок методів у списку вибору — від найпотрібнішого до найрідшого. */
export const MEDIA_SORT_METHODS: readonly MediaSortMethod[] = [
  'generationAsc',
  'generationDesc',
  'format',
  'title',
  'size',
];

/**
 * «Від першої генерації до останньої» — те, що автор просив побачити
 * першим: у медіатеці лічильник кадрів важить більше за розширення файлу.
 */
export const DEFAULT_MEDIA_SORT: MediaSortMethod = 'generationAsc';

/**
 * Найменший спільний знаменник картки галереї. Саме за цими полями
 * сортуються і фото, і відео — картка `MediaCard` у `MediaLibraryView`
 * задовольняє цей тип.
 */
export interface SortableMedia {
  url?: string;
  title?: string;
  /** ISO-дата створення файлу; у посилань із книги її немає. */
  createdAt?: string;
  /** Вага файлу в байтах; сервер знає її лише для своїх файлів. */
  sizeBytes?: number;
}

/** Час створення в мілісекундах; `null` — дати немає або вона нечитабельна. */
export function mediaCreatedTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Порядок генерації. `direction = 1` — від першої до останньої,
 * `-1` — від останньої до першої. Файли без дати — завжди в кінці;
 * рівні між собою лишаються в тому порядку, у якому прийшли з джерела
 * (`Array.prototype.sort` стабільний), тож перелік не «стрибає».
 */
function compareByGeneration(a: SortableMedia, b: SortableMedia, direction: 1 | -1): number {
  const ta = mediaCreatedTime(a.createdAt);
  const tb = mediaCreatedTime(b.createdAt);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return (ta - tb) * direction;
}

/** За назвою, українською абеткою — так само, як усередині формату в `compareByImageFormat`. */
function compareByTitle(a: SortableMedia, b: SortableMedia): number {
  return (a.title || '').localeCompare(b.title || '', 'uk');
}

/**
 * За розміром: спершу найважчі. Вагу знає лише серверна медіатека, тож
 * посилання з книги знову опиняються в кінці — не тому, що легкі, а тому
 * що їхньої ваги ніхто не міряв.
 */
function compareBySize(a: SortableMedia, b: SortableMedia): number {
  const sa = a.sizeBytes;
  const sb = b.sizeBytes;
  const hasA = typeof sa === 'number' && Number.isFinite(sa);
  const hasB = typeof sb === 'number' && Number.isFinite(sb);
  if (!hasA && !hasB) return 0;
  if (!hasA) return 1;
  if (!hasB) return -1;
  if (sa === sb) return 0;
  return sb! - sa!;
}

/** Компаратор для обраного способу сортування. */
export function mediaComparator(method: MediaSortMethod): (a: SortableMedia, b: SortableMedia) => number {
  switch (method) {
    case 'generationDesc':
      return (a, b) => compareByGeneration(a, b, -1);
    case 'format':
      return (a, b) => compareByImageFormat(a, b);
    case 'title':
      return compareByTitle;
    case 'size':
      return compareBySize;
    case 'generationAsc':
    default:
      return (a, b) => compareByGeneration(a, b, 1);
  }
}

/**
 * Дата для підпису на картці: `12.09.2026 14:32`. Порожній рядок — дати
 * немає, і тоді підпису не малюємо зовсім (прочерк на кожній старій
 * ілюстрації був би шумом, а не інформацією).
 */
export function formatMediaDate(iso: string | null | undefined): string {
  const ms = mediaCreatedTime(iso);
  if (ms === null) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Чи показує обраний спосіб саме хронологію (для підказки під списком). */
export function mediaSortIsChronological(method: MediaSortMethod): boolean {
  return method === 'generationAsc' || method === 'generationDesc';
}
