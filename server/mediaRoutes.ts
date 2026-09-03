/**
 * Маршрути медіатеки.
 *
 * Історично тут було лише двоє: перевірка й облік ліміту сховища. Самі файли
 * лишались у книзі як `data:`-URL в IndexedDB одного браузера — сервер рахував
 * мегабайти, яких у нього не було.
 *
 * Задача #100 перенесла файли сюди: опис у базі, байти в DATA_DIR (див.
 * `server/media/mediaLibraryStore.ts`), а в книзі — короткий URL. Лічильник
 * тарифу лишився ТОЙ САМИЙ (`mediaStorage.ts`): два незалежні лічильники
 * місця розійшлися б на першому ж збої.
 *
 * `POST /api/media/check-upload` збережено: ним користуються екрани, які
 * питають дозвіл ДО читання файлу. Новий `POST /api/media/upload` робить ту
 * саму перевірку сам — двічі рахувати ті самі байти не можна.
 */

import type { Express } from 'express';
import { requireAuth } from './auth';
import { checkAndRecordStorageUpload, getStorageUsage } from './mediaStorage';
import {
  MEDIA_MIME_EXTENSIONS,
  deleteAsset,
  listAssets,
  readAsset,
  saveAsset,
  type MediaKind,
} from './media/mediaLibraryStore';

const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024; // 50 МБ — запобіжник від абсурдно великих файлів одразу.

/**
 * Для завантаження НА СЕРВЕР межа нижча: тіло приходить як base64 у JSON
 * (express.json({ limit: '40mb' }) у server.ts), а base64 більший за самі
 * байти на третину. 25 МБ → близько 34 МБ тіла, з запасом під ліміт.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const UPLOAD_KINDS: readonly MediaKind[] = ['upload', 'illustration', 'character_art', 'cover_art'];

/** Розбирає `data:`-URL або голий base64. Повертає null, якщо це не зображення. */
function decodeImagePayload(raw: unknown): { mimeType: string; bytes: Buffer } | null {
  if (typeof raw !== 'string' || !raw) return null;
  const match = raw.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  if (!MEDIA_MIME_EXTENSIONS[mimeType]) return null;
  try {
    const bytes = Buffer.from(match[2], 'base64');
    return bytes.length > 0 ? { mimeType, bytes } : null;
  } catch {
    return null;
  }
}

export function registerMediaRoutes(app: Express): void {
  /** Поточне використання фотоальбому — для індикатора у Медіатеці й на сторінці Підписка. */
  app.get('/api/media/storage', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const usage = await getStorageUsage(principal.id as string, principal.role);
      res.json(usage);
    } catch (err) {
      console.error('[media] storage:', err);
      res.status(500).json({ error: 'Не вдалося перевірити використання сховища.' });
    }
  });

  /**
   * Перевіряє ліміт ПЕРЕД тим, як клієнт додасть файл у книгу, і якщо
   * дозволено — одразу враховує його розмір у лічильнику (щоб паралельне
   * завантаження кількох файлів поспіль не проскочило повз ліміт).
   */
  app.post('/api/media/check-upload', requireAuth, async (req, res) => {
    try {
      const { bytes, bookId, fileName } = req.body || {};
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
        return res.status(400).json({ error: 'Некоректний розмір файлу.' });
      }
      if (bytes > MAX_SINGLE_FILE_BYTES) {
        return res.status(413).json({
          error: `Файл завеликий (максимум ${(MAX_SINGLE_FILE_BYTES / (1024 * 1024)).toFixed(0)} МБ за одне завантаження).`,
        });
      }

      const principal = req.principal!;
      const result = await checkAndRecordStorageUpload(
        principal.id as string,
        principal.email,
        principal.role,
        Math.round(bytes),
        typeof bookId === 'string' ? bookId : undefined,
        typeof fileName === 'string' ? fileName.slice(0, 200) : 'upload'
      );

      if (!result.allowed) {
        return res.status(402).json({
          error: result.reasonUk || 'Вичерпано ліміт сховища вашого тарифу.',
          kind: 'quota_exceeded',
          ...result,
        });
      }

      res.json(result);
    } catch (err) {
      console.error('[media] check-upload:', err);
      res.status(500).json({ error: 'Не вдалося перевірити ліміт сховища.' });
    }
  });

  /**
   * Покласти файл у медіатеку автора на сервері.
   *
   * Ліміт перевіряється ТУТ і лише тут для цього шляху — клієнт не має
   * викликати ще й check-upload, інакше ті самі байти спишуться двічі.
   */
  app.post('/api/media/upload', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const { dataUrl, filename, bookId, kind, prompt, model } = req.body || {};

      const payload = decodeImagePayload(dataUrl);
      if (!payload) {
        return res.status(400).json({
          error: 'Очікується зображення у форматі data:URL (PNG, JPEG, WEBP, GIF або SVG).',
        });
      }
      if (payload.bytes.length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({
          error: `Файл завеликий (максимум ${(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)} МБ за одне завантаження).`,
        });
      }

      const quota = await checkAndRecordStorageUpload(
        principal.id as string,
        principal.email,
        principal.role,
        payload.bytes.length,
        typeof bookId === 'string' ? bookId : undefined,
        typeof filename === 'string' ? filename.slice(0, 200) : 'upload'
      );
      if (!quota.allowed) {
        return res.status(402).json({
          error: quota.reasonUk || 'Вичерпано ліміт сховища вашого тарифу.',
          kind: 'quota_exceeded',
          ...quota,
        });
      }

      const asset = await saveAsset({
        ownerId: principal.id as string,
        bookId: typeof bookId === 'string' ? bookId : null,
        kind: UPLOAD_KINDS.includes(kind) ? (kind as MediaKind) : 'upload',
        filename: typeof filename === 'string' && filename ? filename : 'image',
        mimeType: payload.mimeType,
        bytes: payload.bytes,
        prompt: typeof prompt === 'string' ? prompt : null,
        model: typeof model === 'string' ? model : null,
      });

      res.json({ asset, storage: quota });
    } catch (err) {
      console.error('[media] upload:', err);
      res.status(500).json({ error: 'Не вдалося зберегти файл у медіатеці.' });
    }
  });

  /** Перелік медіафайлів автора. Тільки СВОЇ — чужих тут не існує. */
  app.get('/api/media/list', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const bookId = typeof req.query.bookId === 'string' ? req.query.bookId : null;
      const assets = await listAssets(principal.id as string, { bookId });
      res.json({ assets });
    } catch (err) {
      console.error('[media] list:', err);
      res.status(500).json({ error: 'Не вдалося прочитати медіатеку.' });
    }
  });

  /**
   * Байти файлу. Чужий файл — 404, а не 403: інакше перебором id можна
   * дізнатися, що саме є в іншого автора.
   */
  app.get('/api/media/file/:id', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const found = await readAsset(String(req.params.id || ''));
      if (!found || found.record.ownerId !== principal.id) {
        return res.status(404).json({ error: 'Файл не знайдено.' });
      }

      res.setHeader('Content-Type', found.record.mimeType);
      res.setHeader('Content-Length', String(found.bytes.length));
      // Тип не вгадувати: SVG зі скриптом всередині виконався б у нашому
      // ж origin, тому додатково забороняємо йому будь-які джерела.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (found.record.mimeType === 'image/svg+xml') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      }
      // Приватне: файл автора не має осідати в спільних кешах проксі.
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.end(Buffer.from(found.bytes));
    } catch (err) {
      console.error('[media] file:', err);
      res.status(500).json({ error: 'Не вдалося прочитати файл.' });
    }
  });

  /** Прибрати файл. Ліміт тарифу при цьому не звільняється — див. mediaStorage.ts. */
  app.delete('/api/media/:id', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const ok = await deleteAsset(String(req.params.id || ''), principal.id as string);
      if (!ok) return res.status(404).json({ error: 'Файл не знайдено.' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[media] delete:', err);
      res.status(500).json({ error: 'Не вдалося видалити файл.' });
    }
  });
}
