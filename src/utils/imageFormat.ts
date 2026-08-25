/**
 * Визначення формату зображення та сортування за ним.
 *
 * У книзі зображення живуть двома способами: як звичайні посилання
 * (`https://…/photo.jpg`) і як вбудовані `data:`-URI після завантаження
 * файлу з диска. Тому «розширення» доводиться діставати з обох форм —
 * саме цим і займається `detectImageFormat`.
 */

export type ImageFormat = 'png' | 'jpg' | 'webp' | 'avif' | 'gif' | 'svg' | 'bmp' | 'other';

/**
 * Сталий порядок форматів для сортування. Спершу те, що найчастіше
 * трапляється в книзі, наприкінці — нерозпізнане.
 */
export const IMAGE_FORMAT_ORDER: ImageFormat[] = [
  'jpg',
  'png',
  'webp',
  'avif',
  'gif',
  'svg',
  'bmp',
  'other',
];

/** Людська назва формату для підписів і фільтрів. */
export const IMAGE_FORMAT_LABEL: Record<ImageFormat, string> = {
  jpg: 'JPG',
  png: 'PNG',
  webp: 'WEBP',
  avif: 'AVIF',
  gif: 'GIF',
  svg: 'SVG',
  bmp: 'BMP',
  other: '—',
};

/** Нормалізує різні написання одного формату до канонічного. */
function normalize(ext: string): ImageFormat {
  const e = ext.toLowerCase();
  if (e === 'jpeg' || e === 'jpg' || e === 'jfif') return 'jpg';
  if (e === 'png') return 'png';
  if (e === 'webp') return 'webp';
  if (e === 'avif') return 'avif';
  if (e === 'gif') return 'gif';
  if (e === 'svg' || e === 'svg+xml') return 'svg';
  if (e === 'bmp') return 'bmp';
  return 'other';
}

/**
 * Формат зображення за його URL.
 *
 * Обробляє три випадки: `data:image/png;base64,…` (беремо підтип MIME),
 * звичайний шлях із розширенням (відкидаємо `?query` і `#hash`, бо
 * посилання на кшталт `…/photo.jpg?w=600&q=80` інакше дали б розширення
 * «jpg?w=600»), і все інше — 'other'.
 */
export function detectImageFormat(url: string | undefined | null): ImageFormat {
  if (!url) return 'other';

  const dataMatch = /^data:image\/([a-zA-Z0-9.+-]+)[;,]/.exec(url.trim());
  if (dataMatch) return normalize(dataMatch[1]);

  const withoutQuery = url.split('?')[0].split('#')[0];
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(withoutQuery);
  if (extMatch) return normalize(extMatch[1]);

  // CDN-посилання часто не мають розширення у шляху, а віддають формат
  // параметром: Unsplash — `?fm=jpg`, інші — `?format=webp`. Без цього
  // більшість аватарів героїв опинилася б у групі «невідомо».
  const paramMatch = /[?&](?:fm|format)=([a-zA-Z0-9]+)/.exec(url);
  if (paramMatch) return normalize(paramMatch[1]);

  return 'other';
}

/**
 * Компаратор для сортування зображень за форматом. Усередині одного
 * формату порядок зберігається стабільним за переданим ключем (зазвичай
 * назвою), щоб перелік не «стрибав» між відкриттями.
 */
export function compareByImageFormat(
  a: { url?: string; title?: string },
  b: { url?: string; title?: string }
): number {
  const fa = IMAGE_FORMAT_ORDER.indexOf(detectImageFormat(a.url));
  const fb = IMAGE_FORMAT_ORDER.indexOf(detectImageFormat(b.url));
  if (fa !== fb) return fa - fb;
  return (a.title || '').localeCompare(b.title || '', 'uk');
}
