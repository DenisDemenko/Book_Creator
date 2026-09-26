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
import { listBooks } from './bookStore';
import {
  deleteAsset,
  getAssetPassport,
  latestVersionsOnly,
  listAssets,
  MediaPassportError,
  readAsset,
  saveAsset,
  updateAssetPassport,
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

/**
 * Типи, які приймає ЦЕЙ маршрут (і чат підтримки — `supportChatRoutes.ts`
 * теж кличе `decodeImagePayload`). Свідомо ВУЖЧий підмножина за
 * `MEDIA_MIME_EXTENSIONS`: та таблиця з задачі #201 додала 'video/mp4' —
 * потрібне для того, щоб `saveAsset()` приймав байти згенерованого
 * Leonardo.Ai відео (server/aiCore.ts кладе їх напряму, минаючи цей
 * маршрут). Але «завантажити картинку» тут і «вкладення у підтримку» —
 * обидва звані «зображення» в помилках і коді нижче (`supportMessagePreview`
 * малює 📎 як «Зображення»), і жоден не готовий показати відео. Якби
 * decodeImagePayload читав MEDIA_MIME_EXTENSIONS напряму, відео
 * прослизнуло б крізь ОБИДВА маршрути мовчки, щойно з'явився запис
 * 'video/mp4' у спільній таблиці.
 */
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

/** Розбирає `data:`-URL або голий base64. Повертає null, якщо це не зображення. */
export function decodeImagePayload(raw: unknown): { mimeType: string; bytes: Buffer } | null {
  if (typeof raw !== 'string' || !raw) return null;
  const match = raw.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mimeType)) return null;
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
      const { dataUrl, filename, bookId, kind, prompt, model, parentId, passport } = req.body || {};

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
        // Т2.3 В1: «замінити новою версією» і паспорт одразу при завантаженні.
        parentId: typeof parentId === 'string' && parentId ? parentId : null,
        passport: passport && typeof passport === 'object' ? passport : undefined,
        actor: `user:${principal.id}`,
      });

      res.json({ asset, storage: quota });
    } catch (err) {
      if (err instanceof MediaPassportError) return res.status(400).json({ error: err.message, kind: 'bad_passport' });
      if (err instanceof Error && /Попередню версію/.test(err.message)) return res.status(404).json({ error: err.message });
      console.error('[media] upload:', err);
      res.status(500).json({ error: 'Не вдалося зберегти файл у медіатеці.' });
    }
  });

  /** Перелік медіафайлів автора. Тільки СВОЇ — чужих тут не існує. */
  app.get('/api/media/list', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const bookId = typeof req.query.bookId === 'string' ? req.query.bookId : null;
      const all = await listAssets(principal.id as string, { bookId });
      // `?latest=1` — лише останні версії (галерея); без нього — усе, як і раніше.
      const assets = req.query.latest === '1' ? latestVersionsOnly(all) : all;
      res.json({ assets });
    } catch (err) {
      console.error('[media] list:', err);
      res.status(500).json({ error: 'Не вдалося прочитати медіатеку.' });
    }
  });

  /**
   * Розділи медіатеки — по одному на книгу.
   *
   * Розділ — це НЕ окремий запис у базі, а група файлів за `book_id`, який
   * проставляє кожне завантаження. Тому він з'являється сам, щойно в книгу
   * покладено перший файл (зокрема й майстром перенесення), і не потребує
   * ні міграції, ні окремого «створити розділ». Файли без книги
   * (`book_id = null`) віддаються окремою групою з `bookId: null`.
   */
  app.get('/api/media/sections', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const ownerId = principal.id as string;
      const [assets, books] = await Promise.all([listAssets(ownerId), listBooks(ownerId)]);

      const titles = new Map<string, string>();
      for (const b of books) titles.set(b.id, b.title);

      const groups = new Map<string, { bookId: string | null; title: string | null; count: number; sizeBytes: number }>();
      let totalBytes = 0;
      for (const asset of assets) {
        totalBytes += asset.sizeBytes;
        const key = asset.bookId ?? '';
        const row = groups.get(key) ?? {
          bookId: asset.bookId ?? null,
          title: asset.bookId ? titles.get(asset.bookId) ?? null : null,
          count: 0,
          sizeBytes: 0,
        };
        row.count += 1;
        row.sizeBytes += asset.sizeBytes;
        groups.set(key, row);
      }

      res.json({ sections: [...groups.values()].sort((a, b) => b.sizeBytes - a.sizeBytes), totalBytes });
    } catch (err) {
      console.error('[media] sections:', err);
      res.status(500).json({ error: 'Не вдалося прочитати розділи медіатеки.' });
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

  /**
   * Паспорт зображення (Т2.3 В1): сам файл, усі версії й історія.
   * Чужий файл — 404, як і скрізь у медіатеці.
   */
  app.get('/api/media/:id/passport', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const found = await getAssetPassport(String(req.params.id || ''), principal.id as string);
      if (!found) return res.status(404).json({ error: 'Файл не знайдено.' });
      res.json(found);
    } catch (err) {
      console.error('[media] passport:', err);
      res.status(500).json({ error: 'Не вдалося прочитати паспорт файлу.' });
    }
  });

  /** Змінити паспорт: назва, опис, джерело, автор, ліцензія, посилання, статус. */
  app.patch('/api/media/:id', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const asset = await updateAssetPassport(String(req.params.id || ''), principal.id as string, req.body || {}, `user:${principal.id}`);
      if (!asset) return res.status(404).json({ error: 'Файл не знайдено.' });
      res.json({ asset });
    } catch (err) {
      if (err instanceof MediaPassportError) return res.status(400).json({ error: err.message, kind: 'bad_passport' });
      console.error('[media] patch:', err);
      res.status(500).json({ error: 'Не вдалося зберегти паспорт файлу.' });
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
