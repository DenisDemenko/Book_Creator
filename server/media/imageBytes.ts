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
 *
 * ТИП ФОРМАТУ ТУТ НЕ БЕРУТЬ НА ВІРУ (див. `imageMimeFromBytes`): заявлений
 * тип приходить із чужого коду — mammoth, браузера, чужого сервера — і
 * помиляється настільки, що картинка не вбудовується в PDF зовсім.
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
 * Справжній формат картинки за підписом байтів, а не за тим, що про неї
 * сказали.
 *
 * НАВІЩО. Заявлений тип приходить із трьох різних місць і жодне з них не
 * перевіряє вміст: із `data:`-URL його взяв mammoth (тип у документі Word), із
 * запису медіатеки — те, що надіслав браузер, із `http` — заголовок
 * `content-type`. Верстальник PDF довіряв цьому й діставав відмову
 * `pdf-lib` — «SOI not found in JPEG» — на картинці, яка насправді PNG.
 * Знайдено живим прогоном рукопису з .docx (13.09.2026): дві з 42 картинок
 * не вбудовувались зовсім.
 *
 * Повертає `null`, якщо підпис невідомий (SVG, TIFF, битий файл) — тоді
 * лишається заявлений тип, а рішення ухвалює той, хто вбудовує.
 */
export function imageMimeFromBytes(bytes: Buffer | Uint8Array): string | null {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.subarray(0, 6).toString('latin1') === 'GIF87a' || buf.subarray(0, 6).toString('latin1') === 'GIF89a') {
    return 'image/gif';
  }
  return null;
}

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
    const bytes = Buffer.from(match[2], 'base64');
    return { mimeType: imageMimeFromBytes(bytes) ?? match[1], bytes: tightImageBytes(bytes) };
  }

  const assetId = assetIdFromUrl(url);
  if (assetId) {
    const found = await readAsset(assetId);
    if (!found || !ownerId || found.record.ownerId !== String(ownerId)) {
      throw new ImageBytesError('Файл медіатеки не знайдено на сервері.');
    }
    const bytes = Buffer.from(found.bytes);
    return { mimeType: imageMimeFromBytes(bytes) ?? found.record.mimeType, bytes: tightImageBytes(bytes) };
  }

  if (url.startsWith(`${GENERATED_URL_PREFIX}/`)) {
    // Захист від виходу за межі каталогу згенерованих файлів.
    const safeName = path.basename(url.slice(GENERATED_URL_PREFIX.length + 1));
    try {
      const bytes = await fs.readFile(path.join(GENERATED_DIR, safeName));
      const ext = path.extname(safeName).slice(1).toLowerCase();
      return { mimeType: imageMimeFromBytes(bytes) ?? EXT_MIME[ext] ?? 'image/png', bytes: tightImageBytes(bytes) };
    } catch {
      throw new ImageBytesError('Файл зображення не знайдено на сервері.');
    }
  }

  if (/^https?:\/\//.test(url)) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      // Заголовок `content-type` з чужого сервера перевіряється байтами:
      // він часто каже `application/octet-stream` або взагалі бреше.
      const mimeType = imageMimeFromBytes(bytes) || res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
      return { mimeType, bytes: tightImageBytes(bytes) };
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

/**
 * Байти як буфер із НУЛЬОВИМ зсувом — і чому це не дрібниця.
 *
 * `pdf-lib` читає підпис формату так: `new DataView(imageData.buffer)`
 * (`JpegEmbedder.for`) — тобто `byteOffset` ІГНОРУЄТЬСЯ. А `Buffer.from(
 * base64, 'base64')` для картинки, меншої за половину пулу Node (у Node 24
 * пул — 64 КБ, тобто картинки до 32 КБ), віддає **вікно в СПІЛЬНОМУ пулі**.
 * Перші байти пулу — це чужа память, і pdf-lib бачить не той файл:
 * `SOI not found in JPEG` на цілком справній картинці. PNG-вбудовувач у
 * pdf-lib читає байти напряму, тому йому зсув байдужий, — але покладатись на
 * цю різницю між двома вбудовувачами не варто.
 *
 * ЗНАЙДЕНО ЖИВИМ ПРОГОНОМ #169 (13.09.2026): з 42 картинок рукопису, зібраного
 * з .docx, не вбудовувались рівно дві — найменші (18 і 20 КБ), причому
 * НЕ ЩОРАЗУ: усе залежало від того, куди саме в пулі лягла память. Саме тому
 * дефект виглядав «плаваючим» і не давався на синтетичних даних.
 */
export function tightImageBytes(bytes: Buffer | Uint8Array): Buffer {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) return buf;
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return Buffer.from(copy.buffer);
}
