/**
 * Зовнішній API Студії — перший споживач: WriterScan (iOS, фото сторінки
 * рукопису → розпізнаний текст → книга).
 *
 * ДВІ ПОЛОВИНИ, І ВОНИ АВТЕНТИФІКУЮТЬСЯ ПО-РІЗНОМУ НАВМИСНО:
 *   • `/api/external/v1/*` — ЛИШЕ особистий токен у `Authorization: Bearer`.
 *     Cookie-сесія тут не приймається: застосунок не браузер, а сторонній
 *     сайт не повинен мати змоги дістатись цих маршрутів чужою cookie.
 *   • `/api/external-tokens*` і `/api/scans/*` — ЛИШЕ cookie-сесія Студії.
 *     Токен не може створити інший токен чи вирішити долю скану: витік
 *     токена з телефона не має перетворитись на повний доступ до акаунта.
 *
 * ЧОМУ СКАН НЕ ПИШЕ В КНИГУ САМ (головне рішення цього модуля). Книга
 * живе в браузері автора (IndexedDB); серверна копія — лише дзеркало
 * (src/utils/storage.ts → mirrorBookToServer), яке наступне збереження з
 * браузера перезапише, прийнявши 409 як «оновити ревізію». Запис секції
 * прямо в серверну копію мовчки зник би за першим же натисканням клавіші в
 * Студії. Тому скан лягає у «Вхідні» медіатеки, а вставляє його в главу
 * вже Студія — тим самим шляхом, що й опис фото (#224): AI-чернетка в
 * кінці вибраної глави з кнопками «прийняти/відхилити».
 *
 * ЧОМУ РОЗПІЗНАВАННЯ У ФОНІ (202 + опитування). Той самий урок, що й
 * #210/#215: проксі хостингу обриває довгі запити на ~90-й секунді, а
 * модель зору на щільній сторінці може думати десятки секунд.
 */

import type { Express, NextFunction, Request, Response } from 'express';
import { requireAuth, requirePermission } from '../auth';
import { findUserById } from '../store';
import { getBook, listBooks } from '../bookStore';
import { readAsset, saveAsset } from '../media/mediaLibraryStore';
import {
  countScansSince,
  createScan,
  createToken,
  findActiveTokenBySecret,
  getScan,
  listScans,
  listTokens,
  publicToken,
  revokeToken,
  touchToken,
  updateScan,
  type ExternalScan,
} from './externalApiStore';
import { cleanOcrText } from './scanOcrPrompt';

/** Межі — однакові для застосунку й тестів, тому експортовані. */
export const EXTERNAL_LIMITS = {
  /** Байти фото після декодування. MVP стискав до 5 МБ; беремо із запасом. */
  maxImageBytes: 10 * 1024 * 1024,
  maxTextChars: 100_000,
  maxTitleChars: 160,
  /** Скільки сканів на годину — захист від зациклення застосунку й від рахунку за модель. */
  scansPerHour: 60,
  /** Скільки чинних токенів може мати один автор. */
  maxActiveTokens: 10,
} as const;

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface RecognizeParams {
  mimeType: string;
  base64: string;
  ownerId: string;
  bookId: string;
  req: Request;
}

export interface ExternalApiDeps {
  /** Розпізнавання тексту на фото. У продукті — модель зору ядра AI (scanRecognizer.ts). */
  recognize: (p: RecognizeParams) => Promise<{ text: string; modelId: string }>;
  /** Перевірка й облік ліміту сховища (у продукті — mediaStorage.checkAndRecordStorageUpload). */
  checkStorage?: (p: {
    userId: string;
    email: string;
    role: any;
    bytes: number;
    bookId: string;
    filename: string;
  }) => Promise<{ allowed: boolean; reasonUk?: string }>;
  /**
   * Як запустити фонову роботу. У продукті — «не чекаючи» (відповідь 202
   * іде одразу); тести передають власний планувальник, щоб дочекатись.
   */
  schedule?: (task: () => Promise<void>) => void;
  now?: () => Date;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      externalTokenId?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Допоміжне
// ---------------------------------------------------------------------------

function fail(res: Response, status: number, kind: string, error: string): void {
  res.status(status).json({ error, kind });
}

function optionalTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, EXTERNAL_LIMITS.maxTitleChars) : null;
}

/**
 * Фото з тіла запиту: або `data:`-URL, або голий base64 разом із `mimeType`.
 * Повертає `null`, якщо це не одне з підтримуваних зображень.
 */
export function decodeScanImage(image: unknown, mimeType: unknown): { mimeType: string; bytes: Buffer } | null {
  if (typeof image !== 'string' || !image) return null;
  let mime = typeof mimeType === 'string' ? mimeType.toLowerCase().trim() : '';
  let data = image;
  const match = image.match(/^data:([^;,]+);base64,(.*)$/s);
  if (match) {
    mime = match[1].toLowerCase();
    data = match[2];
  }
  if (!IMAGE_MIME.has(mime)) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(data.replace(/\s+/g, ''), 'base64');
  } catch {
    return null;
  }
  if (!bytes.length) return null;
  // Сигнатури: base64 «проковтне» що завгодно, тож перевіряємо, що це справді картинка.
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP';
  const ok = (mime === 'image/jpeg' && isJpeg) || (mime === 'image/png' && isPng) || (mime === 'image/webp' && isWebp);
  return ok ? { mimeType: mime, bytes } : null;
}

/** Що бачить застосунок. Внутрішні id власника й токена назовні не йдуть. */
export function publicScan(scan: ExternalScan) {
  return {
    scanId: scan.id,
    bookId: scan.bookId,
    status: scan.status,
    recognizedText: scan.recognizedText,
    text: scan.text,
    chapterId: scan.chapterId,
    chapterTitle: scan.chapterTitle,
    sectionTitle: scan.sectionTitle,
    modelId: scan.modelId,
    error: scan.error,
    imageUrl: scan.imageUrl,
    createdAt: scan.createdAt,
    updatedAt: scan.updatedAt,
  };
}

/**
 * Причина невдачі — такою, яку можна показати автору на телефоні. Відмови
 * провайдера вже приходять людськими (humanizeAiError у aiCore), а от
 * мережеві збої Node дають голе «fetch failed» — з ним автор нічого не зробить.
 */
export function humanizeOcrError(err: unknown): string {
  const raw = String((err as Error)?.message || err || '').trim();
  if (!raw || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|network/i.test(raw)) {
    return 'Сервіс розпізнавання зараз недоступний. Спробуйте ще раз («Повторити») або введіть текст вручну.';
  }
  return raw.slice(0, 500);
}

/** Книга, яку власник токена справді має право бачити. Чужа — `null` (→ 404). */
async function ownBook(bookId: string, userId: string) {
  const stored = await getBook(bookId);
  if (!stored || stored.ownerId !== userId) return null;
  return stored;
}

/** Не частіше ніж раз на 5 хвилин — інакше кожен запит застосунку писав би в базу. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Автентифікація застосунку: `Authorization: Bearer nst_…`.
 * Встановлює `req.principal` — далі працюють ті самі requirePermission і
 * логування витрат, що й для Студії.
 */
export function requireExternalToken(now: () => Date = () => new Date()) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = String(req.headers.authorization || '');
      const match = header.match(/^Bearer\s+(\S+)\s*$/i);
      if (!match) {
        return fail(res, 401, 'unauthenticated', 'Потрібен токен застосунку: заголовок Authorization: Bearer <токен>.');
      }
      const token = await findActiveTokenBySecret(match[1]);
      if (!token) {
        return fail(res, 401, 'invalid_token', 'Токен недійсний або відкликаний. Створіть новий у Студії (Медіатека → Скани з телефону).');
      }
      const user = await findUserById(token.userId);
      if (!user || user.disabled) {
        return fail(res, 401, 'invalid_token', 'Обліковий запис, якому належить токен, недоступний.');
      }
      req.principal = { ...user, isGuest: false };
      req.externalTokenId = token.id;
      const last = token.lastUsedAt ? Date.parse(token.lastUsedAt) : 0;
      if (!last || now().getTime() - last > TOUCH_INTERVAL_MS) {
        await touchToken(token.id, now).catch(() => undefined);
      }
      next();
    } catch (err) {
      console.error('[externalApi] auth:', err);
      fail(res, 500, 'server_error', 'Не вдалося перевірити токен.');
    }
  };
}

// ---------------------------------------------------------------------------
// Реєстрація маршрутів
// ---------------------------------------------------------------------------

export function registerExternalApiRoutes(app: Express, deps: ExternalApiDeps): void {
  const now = deps.now || (() => new Date());
  const schedule =
    deps.schedule ||
    ((task: () => Promise<void>) => {
      void task();
    });
  const externalAuth = requireExternalToken(now);

  /** Розпізнавання у фоні: результат або причина відмови лягають у сам скан. */
  const runRecognition = (scan: ExternalScan, mimeType: string, base64: string, req: Request) => {
    schedule(async () => {
      try {
        const result = await deps.recognize({ mimeType, base64, ownerId: scan.ownerId, bookId: scan.bookId, req });
        const text = cleanOcrText(result.text);
        await updateScan(scan.id, scan.ownerId, { status: 'recognized', recognizedText: text, modelId: result.modelId || null, error: null }, now);
      } catch (err) {
        console.warn('[externalApi] OCR:', String((err as Error)?.message || err).slice(0, 300));
        await updateScan(scan.id, scan.ownerId, { status: 'failed', error: humanizeOcrError(err) }, now).catch(() => undefined);
      }
    });
  };

  // ── Студія: токени ──────────────────────────────────────────────────────

  app.get('/api/external-tokens', requireAuth, requirePermission('canEditContent'), async (req, res) => {
    try {
      const tokens = await listTokens(req.principal!.id as string);
      res.json({ tokens: tokens.map(publicToken) });
    } catch (err) {
      console.error('[externalApi] list tokens:', err);
      fail(res, 500, 'server_error', 'Не вдалося прочитати токени.');
    }
  });

  app.post('/api/external-tokens', requireAuth, requirePermission('canEditContent'), async (req, res) => {
    try {
      const userId = req.principal!.id as string;
      const active = (await listTokens(userId)).filter((t) => !t.revokedAt);
      if (active.length >= EXTERNAL_LIMITS.maxActiveTokens) {
        return fail(
          res,
          409,
          'too_many_tokens',
          `Уже є ${active.length} чинних токенів — відкличте непотрібний, перш ніж створювати новий.`
        );
      }
      const { record, token } = await createToken({ userId, name: String(req.body?.name || ''), now });
      // Токен у відкритому вигляді — ЄДИНИЙ раз. Далі в базі лише хеш.
      res.status(201).json({ token, record: publicToken(record) });
    } catch (err) {
      console.error('[externalApi] create token:', err);
      fail(res, 500, 'server_error', 'Не вдалося створити токен.');
    }
  });

  app.delete('/api/external-tokens/:id', requireAuth, requirePermission('canEditContent'), async (req, res) => {
    try {
      const ok = await revokeToken(String(req.params.id), req.principal!.id as string, now);
      if (!ok) return fail(res, 404, 'not_found', 'Токен не знайдено.');
      res.json({ ok: true });
    } catch (err) {
      console.error('[externalApi] revoke token:', err);
      fail(res, 500, 'server_error', 'Не вдалося відкликати токен.');
    }
  });

  // ── Студія: вхідні скани ────────────────────────────────────────────────

  app.get('/api/scans/inbox', requireAuth, requirePermission('canEditContent'), async (req, res) => {
    try {
      const bookId = typeof req.query.bookId === 'string' && req.query.bookId ? req.query.bookId : null;
      const scans = await listScans(req.principal!.id as string, { statuses: ['submitted'], bookId });
      res.json({ scans: scans.map(publicScan) });
    } catch (err) {
      console.error('[externalApi] inbox:', err);
      fail(res, 500, 'server_error', 'Не вдалося прочитати вхідні скани.');
    }
  });

  app.post('/api/scans/:id/resolve', requireAuth, requirePermission('canEditContent'), async (req, res) => {
    try {
      const action = req.body?.action;
      if (action !== 'inserted' && action !== 'dismissed') {
        return fail(res, 400, 'bad_input', 'Дія має бути «inserted» або «dismissed».');
      }
      const ownerId = req.principal!.id as string;
      const scan = await getScan(String(req.params.id), ownerId);
      if (!scan) return fail(res, 404, 'not_found', 'Скан не знайдено.');
      if (scan.status === action) return res.json({ scan: publicScan(scan) });
      if (scan.status !== 'submitted') {
        return fail(res, 409, 'wrong_status', `Скан у стані «${scan.status}» — вирішувати нічого.`);
      }
      const updated = await updateScan(scan.id, ownerId, { status: action }, now);
      res.json({ scan: publicScan(updated!) });
    } catch (err) {
      console.error('[externalApi] resolve:', err);
      fail(res, 500, 'server_error', 'Не вдалося оновити скан.');
    }
  });

  // ── Застосунок (Bearer) ─────────────────────────────────────────────────

  app.get('/api/external/v1/me', externalAuth, (req, res) => {
    const p = req.principal as any;
    res.json({ user: { id: p.id, name: p.name, email: p.email, role: p.role } });
  });

  app.get('/api/external/v1/books', externalAuth, async (req, res) => {
    try {
      const books = await listBooks(req.principal!.id as string);
      res.json({ books: books.map((b) => ({ id: b.id, title: b.title || 'Без назви', updatedAt: b.updatedAt })) });
    } catch (err) {
      console.error('[externalApi] books:', err);
      fail(res, 500, 'server_error', 'Не вдалося прочитати перелік книг.');
    }
  });

  app.get('/api/external/v1/books/:bookId/chapters', externalAuth, async (req, res) => {
    try {
      const stored = await ownBook(String(req.params.bookId), req.principal!.id as string);
      if (!stored) return fail(res, 404, 'book_not_found', 'Книгу не знайдено.');
      const chapters = Array.isArray((stored.book as any).chapters) ? ((stored.book as any).chapters as any[]) : [];
      res.json({
        chapters: chapters
          .map((c, index) => ({
            id: String(c?.id || ''),
            title: String(c?.title || `Глава ${index + 1}`),
            order: Number(c?.order ?? index + 1),
            sectionCount: Array.isArray(c?.sections) ? c.sections.length : 0,
          }))
          .filter((c) => c.id)
          .sort((a, b) => a.order - b.order),
      });
    } catch (err) {
      console.error('[externalApi] chapters:', err);
      fail(res, 500, 'server_error', 'Не вдалося прочитати глави.');
    }
  });

  /**
   * Нове фото сторінки. Одразу: перевірка, збереження фото в медіатеку книги,
   * запис скану зі станом `processing` і відповідь 202. Розпізнавання — у фоні;
   * застосунок опитує `GET /scans/:id`.
   */
  app.post('/api/external/v1/books/:bookId/scans', externalAuth, requirePermission('canUseAi'), async (req, res) => {
    try {
      const principal = req.principal as any;
      const ownerId = principal.id as string;
      const bookId = String(req.params.bookId);
      const stored = await ownBook(bookId, ownerId);
      if (!stored) return fail(res, 404, 'book_not_found', 'Книгу не знайдено.');

      const decoded = decodeScanImage(req.body?.image, req.body?.mimeType);
      if (!decoded) {
        return fail(res, 400, 'bad_image', 'Очікується фото JPEG, PNG або WEBP (data:URL або base64 разом із mimeType).');
      }
      if (decoded.bytes.length > EXTERNAL_LIMITS.maxImageBytes) {
        return fail(res, 413, 'image_too_large', 'Фото завелике (максимум 10 МБ). Зменште роздільність або якість.');
      }

      const hourAgo = new Date(now().getTime() - 3600_000).toISOString();
      if ((await countScansSince(ownerId, hourAgo)) >= EXTERNAL_LIMITS.scansPerHour) {
        return fail(res, 429, 'rate_limited', `Не більше ${EXTERNAL_LIMITS.scansPerHour} сканів на годину. Спробуйте трохи пізніше.`);
      }

      const stamp = now().toISOString().replace(/[:.]/g, '-');
      const ext = decoded.mimeType === 'image/png' ? 'png' : decoded.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const filename = optionalTitle(req.body?.filename) || `scan-${stamp}.${ext}`;

      if (deps.checkStorage) {
        const quota = await deps.checkStorage({
          userId: ownerId,
          email: principal.email,
          role: principal.role,
          bytes: decoded.bytes.length,
          bookId,
          filename,
        });
        if (!quota.allowed) {
          return fail(res, 402, 'quota_exceeded', quota.reasonUk || 'Вичерпано ліміт сховища вашого тарифу.');
        }
      }

      const asset = await saveAsset({
        ownerId,
        bookId,
        kind: 'upload',
        filename,
        mimeType: decoded.mimeType,
        bytes: decoded.bytes,
        now,
      });
      const scan = await createScan({
        ownerId,
        bookId,
        assetId: asset.id,
        imageUrl: asset.url,
        tokenId: req.externalTokenId ?? null,
        now,
      });

      runRecognition(scan, decoded.mimeType, decoded.bytes.toString('base64'), req);

      res.status(202).json({ scan: publicScan(scan) });
    } catch (err) {
      console.error('[externalApi] create scan:', err);
      fail(res, 500, 'server_error', 'Не вдалося прийняти фото.');
    }
  });

  app.get('/api/external/v1/scans/:scanId', externalAuth, async (req, res) => {
    try {
      const scan = await getScan(String(req.params.scanId), req.principal!.id as string);
      if (!scan) return fail(res, 404, 'scan_not_found', 'Скан не знайдено.');
      res.json({ scan: publicScan(scan) });
    } catch (err) {
      console.error('[externalApi] get scan:', err);
      fail(res, 500, 'server_error', 'Не вдалося прочитати скан.');
    }
  });

  /**
   * Повторити розпізнавання після невдачі (модель перевантажена, мережа).
   * Фото вже в медіатеці — застосунку не треба надсилати його вдруге.
   */
  app.post('/api/external/v1/scans/:scanId/retry', externalAuth, requirePermission('canUseAi'), async (req, res) => {
    try {
      const ownerId = req.principal!.id as string;
      const scan = await getScan(String(req.params.scanId), ownerId);
      if (!scan) return fail(res, 404, 'scan_not_found', 'Скан не знайдено.');
      if (scan.status !== 'failed') {
        return fail(res, 409, 'wrong_status', 'Повторити можна лише невдале розпізнавання.');
      }
      const file = await readAsset(scan.assetId);
      if (!file || file.record.ownerId !== ownerId) return fail(res, 404, 'image_not_found', 'Фото скану не знайдено.');
      const updated = await updateScan(scan.id, ownerId, { status: 'processing', error: null }, now);
      runRecognition(updated!, file.record.mimeType, Buffer.from(file.bytes).toString('base64'), req);
      res.status(202).json({ scan: publicScan(updated!) });
    } catch (err) {
      console.error('[externalApi] retry:', err);
      fail(res, 500, 'server_error', 'Не вдалося повторити розпізнавання.');
    }
  });

  /** Фото скану — для застосунку, у якого немає cookie для /api/media/file. */
  app.get('/api/external/v1/scans/:scanId/image', externalAuth, async (req, res) => {
    try {
      const ownerId = req.principal!.id as string;
      const scan = await getScan(String(req.params.scanId), ownerId);
      if (!scan) return fail(res, 404, 'scan_not_found', 'Скан не знайдено.');
      const file = await readAsset(scan.assetId);
      if (!file || file.record.ownerId !== ownerId) return fail(res, 404, 'image_not_found', 'Фото скану не знайдено.');
      res.setHeader('Content-Type', file.record.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(Buffer.from(file.bytes));
    } catch (err) {
      console.error('[externalApi] scan image:', err);
      fail(res, 500, 'server_error', 'Не вдалося віддати фото.');
    }
  });

  /**
   * Автор перевірив текст на телефоні й надсилає його в Студію. Повторний
   * виклик до вставки просто оновлює текст і главу — нового скану не буде.
   */
  app.post('/api/external/v1/scans/:scanId/submit', externalAuth, async (req, res) => {
    try {
      const ownerId = req.principal!.id as string;
      const scan = await getScan(String(req.params.scanId), ownerId);
      if (!scan) return fail(res, 404, 'scan_not_found', 'Скан не знайдено.');
      if (scan.status === 'processing') {
        return fail(res, 409, 'not_ready', 'Текст ще розпізнається — зачекайте кілька секунд.');
      }
      if (scan.status === 'inserted' || scan.status === 'dismissed') {
        return fail(res, 409, 'already_resolved', 'Цей скан уже вставлено в книгу або відхилено в Студії.');
      }

      const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\r\n/g, '\n').trim() : '';
      if (!text) return fail(res, 400, 'bad_input', 'Текст порожній — нема чого передавати в книгу.');
      if (text.length > EXTERNAL_LIMITS.maxTextChars) {
        return fail(res, 413, 'text_too_long', `Текст задовгий (максимум ${EXTERNAL_LIMITS.maxTextChars} символів).`);
      }

      const chapterId = optionalTitle(req.body?.chapterId);
      let chapterTitle = optionalTitle(req.body?.chapterTitle);
      if (chapterId) {
        const stored = await ownBook(scan.bookId, ownerId);
        const chapters = stored && Array.isArray((stored.book as any).chapters) ? ((stored.book as any).chapters as any[]) : [];
        const found = chapters.find((c) => String(c?.id) === chapterId);
        if (!found) return fail(res, 400, 'chapter_not_found', 'Главу не знайдено в цій книзі.');
        chapterTitle = String(found.title || chapterTitle || '');
      }

      const updated = await updateScan(
        scan.id,
        ownerId,
        {
          status: 'submitted',
          text,
          chapterId,
          chapterTitle,
          sectionTitle: optionalTitle(req.body?.sectionTitle),
        },
        now
      );
      res.json({ scan: publicScan(updated!) });
    } catch (err) {
      console.error('[externalApi] submit:', err);
      fail(res, 500, 'server_error', 'Не вдалося передати скан у Студію.');
    }
  });
}
