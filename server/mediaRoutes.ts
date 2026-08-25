/**
 * Маршрути фотоальбому: перевірка та облік ліміту сховища (МБ) на завантаження
 * файлів з компʼютера у «Медіатеку». Самі файли лишаються на клієнті (як
 * data URL у книзі, що зберігається в IndexedDB браузера — див.
 * src/utils/storage.ts) — сервер лише рахує байти й веде тарифний лічильник.
 */

import type { Express } from 'express';
import { requireAuth } from './auth';
import { checkAndRecordStorageUpload, getStorageUsage } from './mediaStorage';

const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024; // 50 МБ — запобіжник від абсурдно великих файлів одразу.

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
}
