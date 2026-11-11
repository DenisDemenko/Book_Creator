/**
 * Маршрути черги запечатаних конвертів (журнал #550).
 *
 *   телефон (токен застосунку, область photo-drafts):
 *     PUT /api/external/v1/photo-drafts/private-inbox/:storeId/:itemId   — покласти запечатаний знімок (байти, application/octet-stream)
 *     GET /api/external/v1/photo-drafts/private-inbox/:storeId/:itemId   — стан: queued | delivered | expired | unknown
 *   локальний сервер (підпис Ed25519 його ключем, як у пульсу):
 *     GET  /api/private-store/inbox              — що чекає цей сервер
 *     GET  /api/private-store/inbox/:itemId      — байти конверта
 *     POST /api/private-store/inbox/:itemId/ack  — отримано: Studio видаляє байти
 *
 * Studio вмісту не бачить: конверт запечатано відкритим ключем сервера (services/private-store/src/envelope.mjs).
 */
import { createHash } from 'node:crypto';
import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import { listStoresForUser, acceptSignedRequest, type PrivateStoreRecord } from './store';
import {
  INBOX_MAX_ITEM_BYTES,
  ITEM_ID_RE,
  ackInboxItem,
  inboxStatus,
  listInboxPending,
  putInboxItem,
  readInboxItem,
} from './inbox';

const EMPTY_SHA = createHash('sha256').update('').digest('hex');

/** Підписується шлях API без префікса проксі (`/studio/api/…` → `/api/…`) і без запиту: сервер підписує те саме. */
function apiPath(originalUrl: string): string {
  const pathOnly = originalUrl.split('?')[0];
  const at = pathOnly.indexOf('/api/');
  return at >= 0 ? pathOnly.slice(at) : pathOnly;
}

function fail(res: Response, status: number, kind: string, error: string): void {
  res.status(status).json({ error, kind });
}

function makeLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()): boolean => {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 2000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

/** Сервер, на який цей користувач може класти знімки зараз: призначений, підключений, бере вид «scan» і має ключ скриньки. */
export function inboxStoreFor(userId: string, storeId: string): { ok: boolean; store?: PrivateStoreRecord; status?: number; kind?: string; error?: string } {
  const store = listStoresForUser(userId).find((s) => s.id === storeId);
  if (!store) return { ok: false, status: 404, kind: 'store_not_found', error: 'Локальний сервер не знайдено або він вам не призначений.' };
  if (!store.kinds.includes('scan') || !store.inboxKey) {
    return { ok: false, status: 409, kind: 'inbox_unavailable', error: 'Цей сервер ще не приймає знімки з телефона: оновіть його (docker compose up -d --build) і дочекайтеся пульсу.' };
  }
  return { ok: true, store };
}

/** Маршрути для телефона. `auth` — перевірка токена застосунку, `owner` — id користувача з неї (як у photoDraftRoutes). */
export function registerInboxPhoneRoutes(app: Express, auth: RequestHandler, owner: (req: Request) => string, base: string): void {
  const uploadLimiter = makeLimiter(240, 60 * 60_000);
  const raw = express.raw({ type: 'application/octet-stream', limit: INBOX_MAX_ITEM_BYTES });

  app.put(`${base}/private-inbox/:storeId/:itemId`, auth, raw, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const userId = owner(req);
    const storeId = String(req.params.storeId);
    const itemId = String(req.params.itemId);
    if (!ITEM_ID_RE.test(itemId)) return fail(res, 400, 'bad_input', 'Номер елемента: 16–64 символи (латиниця, цифри, _ і -).');
    if (!uploadLimiter(userId)) return fail(res, 429, 'rate_limited', 'Забагато знімків за годину. Зачекайте.');
    const found = inboxStoreFor(userId, storeId);
    if (!found.ok) return fail(res, found.status!, found.kind!, found.error!);
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!bytes.length) return fail(res, 400, 'bad_input', 'Очікується запечатаний конверт (application/octet-stream).');
    if (!bytes.subarray(0, 4).equals(Buffer.from('NSE1', 'ascii'))) return fail(res, 400, 'bad_input', 'Це не запечатаний конверт: Studio не приймає відкритих знімків у цю чергу.');
    const result = putInboxItem({ storeId, userId, itemId, bytes });
    if (!result.ok) {
      const map: Record<string, [number, string, string]> = {
        too_large: [413, 'too_large', 'Знімок завеликий (понад 12 МБ у конверті). Застосунок стискає знімки до 2048 px.'],
        conflict: [409, 'conflict', 'Елемент із цим номером уже є з іншим вмістом.'],
        quota_user: [429, 'quota_exceeded', 'У черзі забагато невзятого. Увімкніть компʼютер із локальним сервером — він забере знімки.'],
        quota_total: [503, 'quota_exceeded', 'Черга Studio тимчасово переповнена. Спробуйте пізніше.'],
        write_failed: [500, 'server_error', 'Не вдалося зберегти конверт. Спробуйте ще раз.'],
        bad_id: [400, 'bad_input', 'Некоректний номер.'],
        empty: [400, 'bad_input', 'Порожній конверт.'],
      };
      const [status, kind, message] = map[result.reason ?? ''] ?? [500, 'server_error', 'Помилка черги.'];
      return fail(res, status, kind, message);
    }
    res.status(result.duplicate ? 200 : 201).json({ itemId, state: result.state, expiresAt: result.expiresAt, duplicate: !!result.duplicate });
  }, (err: any, _req: Request, res: Response, next: (e?: unknown) => void) => {
    // Перевищено межу тіла (express.raw) — зрозуміла відповідь замість службової сторінки помилки.
    if (err && (err.type === 'entity.too.large' || err.status === 413)) return fail(res, 413, 'too_large', 'Знімок завеликий (понад 12 МБ у конверті). Застосунок стискає знімки до 2048 px.');
    next(err);
  });

  app.get(`${base}/private-inbox/:storeId/:itemId`, auth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const found = inboxStoreFor(owner(req), String(req.params.storeId));
    if (!found.ok) return fail(res, found.status!, found.kind!, found.error!);
    res.json({ itemId: String(req.params.itemId), state: inboxStatus(found.store!.id, owner(req), String(req.params.itemId)) });
  });
}

/** Маршрути локального сервера: усе під підписом його ключа. */
export function registerInboxVaultRoutes(app: Express): void {
  const limiter = makeLimiter(600, 60_000);

  const signed = (req: Request, res: Response): PrivateStoreRecord | null => {
    res.setHeader('Cache-Control', 'no-store');
    const vaultId = String(req.get('x-private-store-id') ?? '');
    if (!limiter(`${req.ip || req.socket.remoteAddress || 'unknown'}:${vaultId}`)) {
      fail(res, 429, 'rate_limited', 'Забагато запитів.');
      return null;
    }
    const result = acceptSignedRequest({
      vaultId,
      timeSec: Number(req.get('x-private-store-time')),
      signature: String(req.get('x-private-store-signature') ?? ''),
      method: req.method,
      path: apiPath(req.originalUrl),
      bodySha: EMPTY_SHA,
    });
    if (!result.ok) {
      fail(res, 401, 'unauthenticated', 'Підпис не прийнято.');
      return null;
    }
    return result.store ?? null;
  };

  app.get('/api/private-store/inbox', (req, res) => {
    const store = signed(req, res);
    if (!store) return;
    res.json({ items: listInboxPending(store.id) });
  });

  app.get('/api/private-store/inbox/:itemId', (req, res) => {
    const store = signed(req, res);
    if (!store) return;
    const bytes = readInboxItem(store.id, String(req.params.itemId));
    if (!bytes) return fail(res, 404, 'not_found', 'Елемента немає (доставлено, прострочено чи не існує).');
    res.status(200).type('application/octet-stream').send(bytes);
  });

  app.post('/api/private-store/inbox/:itemId/ack', (req, res) => {
    const store = signed(req, res);
    if (!store) return;
    if (!ackInboxItem(store.id, String(req.params.itemId))) return fail(res, 404, 'not_found', 'Елемента немає.');
    res.json({ ok: true });
  });
}
