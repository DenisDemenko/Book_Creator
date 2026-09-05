/**
 * OCR для Бази знань: розпізнавання тексту з завантажених зображень
 * (скани/фото документів) через Tesseract.
 *
 * Використовується tesseract.js — WASM-порт двигуна Tesseract
 * (https://github.com/tesseract-ocr/tesseract), те саме сімейство, що й
 * класичний `tesseract` CLI. Порядок за документацією tesseract.js:
 * один worker на запит, `worker.recognize(bytes)` → `data.text`, потім
 * `worker.terminate()`. Мови: українська + англійська (`ukr+eng`) —
 * мовні моделі качаються з CDN tessdata при першому використанні й
 * кешуються в тимчасовій теці.
 *
 * Підтримуються растрові формати, які розуміє Tesseract/leptonica:
 * png, jpg/jpeg, bmp, webp, gif, tif/tiff, pbm/pgm/ppm. PDF сюди НЕ
 * входить — tesseract.js PDF не підтримує за межами свого скоупу
 * (для PDF у студії є окремий конвеєр server/pdfRoutes.ts).
 */

import type { Express } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWorker } from 'tesseract.js';
import { requireAuth } from './auth';

/** Розпаковані байти: більше нема сенсу годувати одним знімком (WASM у памʼяті). */
const OCR_MAX_BYTES = 15 * 1024 * 1024;

const OCR_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/x-portable-bitmap',
  'image/x-portable-graymap',
  'image/x-portable-pixmap',
]);

/** Розбирає `data:`-URL або голий base64. Повертає null, якщо формат не для OCR. */
function decodeOcrPayload(raw: unknown): { bytes: Buffer } | null {
  if (typeof raw !== 'string' || !raw) return null;
  const match = raw.match(/^data:([^;,]+);base64,(.*)$/s);
  let base64 = raw;
  if (match) {
    const mimeType = match[1].toLowerCase();
    if (!OCR_MIME_TYPES.has(mimeType)) return null;
    base64 = match[2];
  }
  try {
    const bytes = Buffer.from(base64, 'base64');
    return bytes.length > 0 ? { bytes } : null;
  } catch {
    return null;
  }
}

export function registerKnowledgeRoutes(app: Express): void {
  app.post('/api/knowledge/ocr', requireAuth, async (req, res) => {
    const decoded = decodeOcrPayload(req.body?.image);
    if (!decoded) {
      return res.status(400).json({
        error:
          'Некоректне зображення для розпізнавання. Підтримуються png, jpg, bmp, webp, gif, tiff, pnm.',
      });
    }
    if (decoded.bytes.length > OCR_MAX_BYTES) {
      return res.status(413).json({
        error: `Зображення завелике для розпізнавання (максимум ${Math.round(OCR_MAX_BYTES / (1024 * 1024))} МБ).`,
      });
    }

    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      const cachePath = path.join(os.tmpdir(), 'nova-tessdata');
      fs.mkdirSync(cachePath, { recursive: true });

      worker = await createWorker('ukr+eng', 1, {
        cachePath,
        errorHandler: (err) => console.error('[knowledge] tesseract worker:', err),
      });
      const result = await worker.recognize(decoded.bytes);
      const text = (result?.data?.text || '').trim();
      if (!text) {
        return res.status(422).json({ error: 'Текст на зображенні не знайдено.' });
      }
      res.json({ text });
    } catch (err) {
      console.error('[knowledge] ocr:', err);
      res.status(500).json({ error: 'Не вдалося розпізнати текст із зображення.' });
    } finally {
      if (worker) {
        worker.terminate().catch(() => {
          /* worker і так помирає з процесом запиту */
        });
      }
    }
  });
}
