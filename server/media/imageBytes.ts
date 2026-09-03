/**
 * Читання байтів зображення за будь-яким посиланням, яке трапляється в книзі.
 *
 * ЧОМУ ОКРЕМИЙ ФАЙЛ. Раніше ця логіка жила всередині `textFromImage.ts` —
 * модуля про ШІ-текст за ілюстрацією. Коли по ті самі байти прийшли рушії
 * PDF (#101), вибір був: тягнути AI-модуль у верстку або винести спільне.
 * Винесено, бо інакше залежність ішла б у зворотний бік — верстка книги від
 * генерації тексту, — і будь-яка зміна в одному тягла б перевірку іншого.
 *
 * ЧОТИРИ ФОРМАТИ, І ВСІ ЧОТИРИ РЕАЛЬНІ:
 *   • `/api/media/file/<id>` — медіатека автора на сервері (#100);
 *   • `/generated/<file>`    — згенероване до #100 і згенероване гостями;
 *   • `data:` URL            — завантажене до #100, ще живе в старих книгах;
 *   • `http(s)`              — старі приклади персонажів.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { GENERATED_DIR, GENERATED_URL_PREFIX } from '../imageGeneration';
import { assetIdFromUrl, readAsset } from './mediaLibraryStore';

export class ImageBytesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageBytesError';
  }
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/**
 * `ownerId` потрібен ЛИШЕ для посилань медіатеки: файл автора читає сам
 * автор. Без цього достатньо було б підставити чужий id у власну книгу, щоб
 * чуже зображення потрапило у твій PDF або в переказ моделі.
 */
export async function loadImageBytes(
  imageUrl: string,
  ownerId?: string | null
): Promise<{ mimeType: string; bytes: Buffer }> {
  const url = String(imageUrl || '');
  if (!url) throw new ImageBytesError('Немає посилання на зображення.');

  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) throw new ImageBytesError('Непідтримуваний формат завантаженого файлу.');
    return { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') };
  }

  const assetId = assetIdFromUrl(url);
  if (assetId) {
    const found = await readAsset(assetId);
    if (!found || !ownerId || found.record.ownerId !== String(ownerId)) {
      throw new ImageBytesError('Файл медіатеки не знайдено на сервері.');
    }
    return { mimeType: found.record.mimeType, bytes: Buffer.from(found.bytes) };
  }

  if (url.startsWith(`${GENERATED_URL_PREFIX}/`)) {
    // Захист від виходу за межі каталогу згенерованих файлів.
    const safeName = path.basename(url.slice(GENERATED_URL_PREFIX.length + 1));
    try {
      const bytes = await fs.readFile(path.join(GENERATED_DIR, safeName));
      const ext = path.extname(safeName).slice(1).toLowerCase();
      return { mimeType: EXT_MIME[ext] || 'image/png', bytes };
    } catch {
      throw new ImageBytesError('Файл зображення не знайдено на сервері.');
    }
  }

  if (/^https?:\/\//.test(url)) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
      return { mimeType, bytes: Buffer.from(await res.arrayBuffer()) };
    } catch (err) {
      throw new ImageBytesError(
        `Не вдалося завантажити зображення за посиланням: ${(err as Error).message}`
      );
    }
  }

  throw new ImageBytesError('Невідомий формат посилання на зображення.');
}

/** Розширення файлу за типом — для рушіїв, яким потрібен файл на диску. */
export function extensionForMime(mimeType: string): string {
  const found = Object.entries(EXT_MIME).find(([, mime]) => mime === mimeType);
  return found ? found[0] : 'png';
}
