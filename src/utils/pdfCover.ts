/**
 * Обкладинка книги для вітрини.
 *
 * КАНОНІЧНЕ ДЖЕРЕЛО — `book.coverConfig`, тобто той самий фронт, який автор
 * бачить у розділі «Обкладинка»: artwork (якщо є), автор, назва та підзаголовок.
 * Історично тут раструвалась перша сторінка внутрішнього PDF. Цей шлях
 * збережено лише як legacy fallback для довільного PDF в адмінпанелі або
 * старого файла, який неможливо безпечно зіставити з активною книгою.
 *
 * ЧОМУ В БРАУЗЕРІ. Marketplace приймає для картки растр
 * (`image/jpeg|png|webp|avif`). Canvas уже є в браузері, а `pdfjs-dist`
 * використовується для fallback і для перевірки, що PDF належить активній
 * книзі. Серверу не потрібен окремий нативний rasterizer.
 */

import type { Book } from '../types';
import { loadBook } from './storage';

let workerConfigured = false;

async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist');
  if (!workerConfigured) {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    workerConfigured = true;
  }
  return pdfjsLib;
}

/** Довша сторона картинки обкладинки. */
export const COVER_TARGET_LONG_SIDE = 1600;
/** Мінімальний корисний розмір raster cover. */
export const COVER_MIN_BYTES = 3000;

export function coverScaleFor(
  width: number,
  height: number,
  targetLongSide: number = COVER_TARGET_LONG_SIDE
): number {
  const longSide = Math.max(width, height);
  if (!Number.isFinite(longSide) || longSide <= 0) return 1;
  return Math.min(4, Math.max(0.1, targetLongSide / longSide));
}

/** Скільки байтів у base64-рядку. Без декодування — лише арифметика. */
export function base64Bytes(dataUrl: string): number {
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export class CoverRenderError extends Error {}

function normalized(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function pdfBelongsToBook(book: Book, pageText: string): boolean {
  const title = normalized(book.title);
  const text = normalized(pageText);
  // Короткі назви на кшталт «Я» дають забагато випадкових збігів.
  if (title.length < 3 || !text) return false;
  return text.includes(title);
}

function coverDimensions(book: Book, targetLongSide: number): { width: number; height: number } {
  const widthMm = Math.max(1, Number(book.layoutConfig?.pageWidthMm) || 152.4);
  const heightMm = Math.max(1, Number(book.layoutConfig?.pageHeightMm) || 228.6);
  const ratio = widthMm / heightMm;
  if (ratio >= 1) {
    return { width: targetLongSide, height: Math.max(1, Math.round(targetLongSide / ratio)) };
  }
  return { width: Math.max(1, Math.round(targetLongSide * ratio)), height: targetLongSide };
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const next = `${line} ${word}`;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

async function loadCoverImage(url: string): Promise<ImageBitmap | HTMLImageElement> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image decode failed'));
        img.src = objectUrl;
      });
      return img;
    } finally {
      // HTMLImageElement уже декодований; браузер тримає pixels у самому image.
      URL.revokeObjectURL(objectUrl);
    }
  } catch (err) {
    throw new CoverRenderError(
      `Не вдалося завантажити artwork передньої обкладинки: ${(err as Error)?.message || err}. ` +
        'Публікацію з неправильною обкладинкою зупинено.'
    );
  }
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap | HTMLImageElement,
  width: number,
  height: number
): void {
  const iw = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const ih = 'naturalHeight' in image ? image.naturalHeight : image.height;
  if (!iw || !ih) return;
  const scale = Math.max(width / iw, height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(image as CanvasImageSource, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

/**
 * Раструє фронт Cover Designer. Композиція відповідає режиму «Передня»:
 * opaque white або artwork object-cover, затемнення для artwork, автор угорі,
 * назва + підзаголовок унизу. Це саме зображення призначене для картки
 * Fusion Lab Marketplace.
 */
export async function renderBookFrontCoverToPng(
  book: Book,
  targetLongSide: number = COVER_TARGET_LONG_SIDE
): Promise<string> {
  if (typeof document === 'undefined') {
    throw new CoverRenderError('Обкладинку Marketplace можна раструвати лише у браузері.');
  }

  const { width, height } = coverDimensions(book, targetLongSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new CoverRenderError('Браузер не дав полотна для малювання обкладинки (canvas 2d).');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const artUrl = String(book.coverConfig?.frontArtUrl || book.coverConfig?.coverImageUrl || '').trim();
  if (artUrl) {
    const image = await loadCoverImage(artUrl);
    try {
      drawCoverImage(ctx, image, width, height);
    } finally {
      if ('close' in image && typeof image.close === 'function') image.close();
    }

    // Аналог Tailwind gradient-to-t у Cover Designer: низ темніший, центр
    // майже прозорий, угорі невелике затемнення для автора.
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0.72)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.10)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  const pad = Math.max(32, Math.round(width * 0.085));
  const textColor = artUrl ? '#ffffff' : '#0f172a';
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'top';

  const author = String(book.author || '').trim();
  if (author) {
    ctx.font = `700 ${Math.max(18, Math.round(width * 0.035))}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(author, pad, pad, width - pad * 2);
  }

  const title = String(book.title || 'Без назви').trim();
  const subtitle = String(book.coverConfig?.subtitle || book.subtitle || '').trim();
  const titleSize = Math.max(42, Math.round(width * 0.105));
  const subtitleSize = Math.max(22, Math.round(width * 0.045));
  const maxTextWidth = width - pad * 2;

  ctx.font = `900 ${titleSize}px system-ui, -apple-system, sans-serif`;
  const titleLines = wrapLines(ctx, title, maxTextWidth).slice(0, 4);
  const titleLineHeight = Math.round(titleSize * 1.02);
  const subtitleHeight = subtitle ? Math.round(subtitleSize * 1.4) : 0;
  const blockHeight = titleLines.length * titleLineHeight + (subtitle ? Math.round(subtitleSize * 1.8) : 0);
  let y = Math.max(pad * 2, height - pad - blockHeight);

  // Невелика тінь лише на artwork, як drop-shadow у preview.
  if (artUrl) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = Math.max(4, Math.round(width * 0.008));
  }
  for (const line of titleLines) {
    ctx.fillText(line, pad, y, maxTextWidth);
    y += titleLineHeight;
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  if (subtitle) {
    y += Math.round(subtitleSize * 0.35);
    ctx.globalAlpha = artUrl ? 0.82 : 0.68;
    ctx.font = `500 ${subtitleSize}px system-ui, -apple-system, sans-serif`;
    const subtitleLines = wrapLines(ctx, subtitle, maxTextWidth).slice(0, 3);
    for (const line of subtitleLines) {
      ctx.fillText(line, pad, y, maxTextWidth);
      y += Math.round(subtitleSize * 1.25);
    }
    ctx.globalAlpha = 1;
  }

  const dataUrl = canvas.toDataURL('image/png');
  if (base64Bytes(dataUrl) < COVER_MIN_BYTES) {
    throw new CoverRenderError('Обкладинка намалювалась підозріло малою — у Marketplace її не надсилаємо.');
  }
  return dataUrl;
}

/**
 * Канонічний cover для Marketplace, сумісний зі старими call sites.
 *
 * 1. PDF читається pdfjs, щоб перевірити, що це саме PDF активної книги.
 * 2. Якщо назва збігається — раструється Cover Designer з актуальної книги.
 * 3. Якщо це довільний PDF (наприклад ручний admin upload) — стара перша
 *    сторінка лишається fallback, щоб не підставити обкладинку іншої книги.
 */
export async function renderPdfFirstPageToPng(
  source: Blob | ArrayBuffer,
  targetLongSide: number = COVER_TARGET_LONG_SIDE
): Promise<string> {
  const buffer = source instanceof Blob ? await source.arrayBuffer() : source;
  if (!buffer || buffer.byteLength === 0) {
    throw new CoverRenderError('PDF порожній — малювати обкладинку нема з чого.');
  }

  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;
  try {
    if (doc.numPages < 1) throw new CoverRenderError('У PDF немає жодної сторінки.');

    const page = await doc.getPage(1);
    try {
      const textContent = await page.getTextContent();
      const pageText = (textContent.items || [])
        .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
        .join(' ');
      const activeBook = await loadBook().catch(() => undefined);
      if (activeBook && pdfBelongsToBook(activeBook, pageText)) {
        return await renderBookFrontCoverToPng(activeBook, targetLongSide);
      }
    } catch (err) {
      if (err instanceof CoverRenderError) throw err;
      // Не змогли ідентифікувати активну книгу — нижче лишається legacy
      // fallback для довільного PDF. Сам fallback не приховує помилки
      // artwork: CoverRenderError вище завжди пробрасывається.
    }

    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: coverScaleFor(base.width, base.height, targetLongSide) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new CoverRenderError('Браузер не дав полотна для малювання (canvas 2d).');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport } as never).promise;

    const dataUrl = canvas.toDataURL('image/png');
    if (base64Bytes(dataUrl) < COVER_MIN_BYTES) {
      throw new CoverRenderError(
        'Сторінка намалювалась порожньою — обкладинку не надсилаємо, щоб у вітрині не зʼявився білий прямокутник.'
      );
    }
    return dataUrl;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}
