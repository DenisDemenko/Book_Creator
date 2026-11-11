/**
 * Маршрути локальних серверів приватного сховища (журнал #549).
 *
 *   адмінпанель (лише адміністратор):  /api/admin/private-stores…   — створити підключення, підтвердити пошту, призначити користувачів
 *   локальний сервер (виклик ззовні):  /api/private-store/pair, /heartbeat — одноразовий код і підписаний пульс
 *   користувач:                        /api/private-store/mine, /:id/token — які сервери доступні й токен для браузера
 *
 * Матеріали сюди НЕ потрапляють: браузер користувача працює з локальним сервером напряму (запит власника: «суворо локально»);
 * Studio лише знає, які сервери є, і видає підписані короткі токени тим, кому сервер призначено. Хмарне збереження лишається
 * типовим — приватне вмикається галочкою на конкретному матеріалі.
 *
 * РОЗГОРТАННЯ ЛИШЕ ЗА ПІДТВЕРДЖЕННЯМ ПОШТОЮ Й КОДОМ: створення запису не дає коду підключення. На пошту облікового запису
 * адміністратора йде код підтвердження (8 символів, 15 хв, 5 спроб); лише його введення в адмінпанелі видає одноразовий код
 * підключення (PS-XXXX-XXXX-XXXX, 15 хв) і команду розгортання. Якщо пошта на сервері Studio не налаштована, сервер створити не вийде.
 */
import type { Express, Request, Response } from 'express';
import { requireAdmin, requireAuth } from './auth';
import { mailConfig, sendMail as realSendMail } from './mail';
import { findUserById, listUsers } from './store';
import { listTokens } from './external/externalApiStore';
import {
  HEARTBEAT_SECONDS,
  PAIRING_TTL_MS,
  VERIFY_TTL_MS,
  acceptHeartbeat,
  confirmVerification,
  createStore,
  deleteStore,
  getStore,
  issueAccessToken,
  listStores,
  listStoresForUser,
  pairStore,
  revokeTokens,
  setRevoked,
  signingKey,
  startVerification,
  updateStore,
} from './privateStore/store';
import { PRIVATE_KINDS, type PrivateKind } from './privateStore/token';
import { dropInboxOfStore, inboxStats } from './privateStore/inbox';
import { registerInboxVaultRoutes } from './privateStore/inboxRoutes';

export interface PrivateStoreRouteDeps {
  sendMail?: (input: { to: string; subject: string; html: string; text: string }) => Promise<{ ok: boolean; error?: string }>;
  mailEnabled?: () => boolean;
}

/** Простий ліміт частоти на ключ — проти підбору коду підключення й засипання листами. */
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

const clientIp = (req: Request) => String(req.ip || req.socket.remoteAddress || 'unknown');

function badInput(res: Response, err: unknown): void {
  res.status(400).json({ error: String((err as Error)?.message || 'Некоректні дані.'), kind: 'bad_input' });
}

function stringList(value: unknown, max = 50, itemMax = 300): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max || value.some((v) => typeof v !== 'string' || v.length > itemMax)) throw new Error('Очікується короткий список рядків.');
  return value as string[];
}

function kindList(value: unknown): PrivateKind[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((k) => !(PRIVATE_KINDS as readonly unknown[]).includes(k))) throw new Error(`Види матеріалів: ${PRIVATE_KINDS.join(', ')}.`);
  return value as PrivateKind[];
}

/** Сторінка Studio, з якої адмін створює підключення, — природне значення за замовчуванням для дозволеної сторінки. */
function suggestedOrigins(req: Request): string[] {
  const out = new Set<string>();
  const origin = req.get('origin');
  if (origin) out.add(origin);
  const pub = process.env.STUDIO_PUBLIC_URL;
  if (pub) {
    try {
      out.add(new URL(pub).origin);
    } catch {
      /* некоректна змінна — пропускаємо */
    }
  }
  return [...out];
}

/** «anna@gmail.com» → «a***@gmail.com»: адмінці показуємо, куди пішов лист, не розкриваючи адреси повністю. */
export function maskEmail(email: string): string {
  const [name, domain] = String(email).split('@');
  return domain ? `${name.slice(0, 1)}***@${domain}` : '***';
}

export function verificationEmailContent(p: { code: string; minutes: number; storeName: string; userName?: string }): { subject: string; html: string; text: string } {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const greeting = p.userName ? `Вітаємо, ${esc(p.userName)}!` : 'Вітаємо!';
  return {
    subject: 'Код підтвердження: локальний сервер приватного сховища',
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#2b1a10">
      <p>${greeting}</p>
      <p>Хтось (імовірно, ви) підключає до Studio локальний сервер приватного сховища «${esc(p.storeName)}». Щоб отримати код підключення й команду розгортання, введіть у адмінпанелі цей код:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;background:#f6e3d4;padding:14px 18px;border-radius:12px;display:inline-block">${esc(p.code)}</p>
      <p>Код діє ${p.minutes} хвилин і спрацює лише раз. Нікому його не передавайте. Якщо ви цього не запитували — проігноруйте лист: без коду сервер підключити неможливо.</p>
    </div>`,
    text: `${greeting}\n\nКод підтвердження підключення локального сервера «${p.storeName}»: ${p.code}\nКод діє ${p.minutes} хвилин і спрацює лише раз. Нікому його не передавайте. Якщо ви цього не запитували — проігноруйте лист.`,
  };
}

export function registerPrivateStoreRoutes(app: Express, deps: PrivateStoreRouteDeps = {}): void {
  const sendMail = deps.sendMail ?? realSendMail;
  const mailEnabled = deps.mailEnabled ?? (() => mailConfig.enabled);
  const pairLimiter = makeLimiter(10, 60_000);
  const heartbeatLimiter = makeLimiter(30, 60_000);
  const tokenLimiter = makeLimiter(60, 60_000);
  const mailPerStore = makeLimiter(3, 30 * 60_000);
  const mailPerAdmin = makeLimiter(8, 60 * 60_000);
  const verifyPerAdmin = makeLimiter(30, 60 * 60_000);

  /** Надсилає код підтвердження на пошту адміністратора. Повертає текст помилки або null. */
  async function mailVerification(req: Request, storeId: string): Promise<{ error: string | null; status?: number; kind?: string }> {
    const store = getStore(storeId);
    if (!store) return { error: 'Сервера не знайдено.', status: 404, kind: 'not_found' };
    if (!mailEnabled()) return { error: 'Надсилання листів на сервері Studio не налаштовано: підтвердити підключення неможливо.', status: 503, kind: 'mail_unavailable' };
    if (!mailPerStore(storeId) || !mailPerAdmin(req.principal!.id)) return { error: 'Забагато листів із кодом. Зачекайте і спробуйте пізніше.', status: 429, kind: 'too_many_attempts' };
    const user = await findUserById(req.principal!.id);
    const email = user?.email;
    if (!email) return { error: 'У вашого облікового запису немає пошти для підтвердження.', status: 400, kind: 'bad_input' };
    const code = startVerification(storeId);
    if (!code) return { error: 'Сервера не знайдено.', status: 404, kind: 'not_found' };
    const content = verificationEmailContent({ code, minutes: VERIFY_TTL_MS / 60000, storeName: store.name, userName: user?.name });
    const sent = await sendMail({ to: email, ...content });
    if (!sent.ok) {
      console.error('[private-store] лист із кодом не надіслано:', String(sent.error ?? '').slice(0, 200));
      return { error: 'Не вдалося надіслати лист із кодом. Спробуйте ще раз трохи пізніше.', status: 502, kind: 'mail_failed' };
    }
    return { error: null };
  }

  // ── адмінпанель ──────────────────────────────────────────────────────────

  app.get('/api/admin/private-stores', requireAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const users = (await listUsers()).filter((u) => !u.disabled).map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role }));
      // Синхронізація з GrabFusion: скільки призначених користувачів уже підключили телефон (чинний токен `photo-drafts`).
      const connected = new Map<string, boolean>();
      for (const u of users) {
        try {
          connected.set(u.id, (await listTokens(u.id)).some((t) => !t.revokedAt && t.scope === 'photo-drafts'));
        } catch {
          connected.set(u.id, false);
        }
      }
      const stores = listStores().map((s) => ({ ...s, grabfusion: { assignedUsers: s.userIds.length, connectedUsers: s.userIds.filter((id) => connected.get(id)).length }, inbox: inboxStats(s.id) }));
      res.json({
        stores,
        users,
        kinds: PRIVATE_KINDS,
        suggestedOrigins: suggestedOrigins(req),
        signingKeyFingerprint: signingKey().fingerprint,
        pairingTtlMinutes: PAIRING_TTL_MS / 60000,
        verificationTtlMinutes: VERIFY_TTL_MS / 60000,
        heartbeatSeconds: HEARTBEAT_SECONDS,
        mailEnabled: mailEnabled(),
      });
    } catch (err) {
      console.error('[private-store]', err);
      res.status(500).json({ error: 'Не вдалося отримати перелік серверів.', kind: 'server_error' });
    }
  });

  app.post('/api/admin/private-stores', requireAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!mailEnabled()) return void res.status(503).json({ error: 'Надсилання листів на сервері Studio не налаштовано: підтвердити підключення неможливо.', kind: 'mail_unavailable' });
    let storeId: string | null = null;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const origins = stringList(body.origins);
      const store = createStore({
        name: String(body.name ?? ''),
        endpoint: String(body.endpoint ?? 'http://127.0.0.1:8787'),
        origins: origins.length ? origins : suggestedOrigins(req),
        kinds: kindList(body.kinds),
        userIds: stringList(body.userIds, 200, 128),
        createdBy: req.principal!.id,
      });
      storeId = store.id;
    } catch (err) {
      return void badInput(res, err);
    }
    const mailed = await mailVerification(req, storeId);
    if (mailed.error) {
      deleteStore(storeId); // сервер без підтвердження не залишаємо
      return void res.status(mailed.status ?? 500).json({ error: mailed.error, kind: mailed.kind ?? 'server_error' });
    }
    const user = await findUserById(req.principal!.id);
    res.status(201).json({ store: getStore(storeId), verification: { sent: true, emailMasked: maskEmail(user?.email ?? ''), expiresAt: getStore(storeId)!.verificationExpiresAt } });
  });

  app.put('/api/admin/private-stores/:id', requireAdmin, (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const store = updateStore(String(req.params.id), {
        name: body.name === undefined ? undefined : String(body.name),
        endpoint: body.endpoint === undefined ? undefined : String(body.endpoint),
        origins: body.origins === undefined ? undefined : stringList(body.origins),
        kinds: kindList(body.kinds),
        userIds: body.userIds === undefined ? undefined : stringList(body.userIds, 200, 128),
      });
      if (!store) return void res.status(404).json({ error: 'Сервера не знайдено.', kind: 'not_found' });
      res.json({ store });
    } catch (err) {
      badInput(res, err);
    }
  });

  /** Новий лист із кодом: для першого підключення, що застрягло, або для перепідключення (дані на сервері лишаються). */
  app.post('/api/admin/private-stores/:id/verification', requireAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const mailed = await mailVerification(req, String(req.params.id));
    if (mailed.error) return void res.status(mailed.status ?? 500).json({ error: mailed.error, kind: mailed.kind ?? 'server_error' });
    const user = await findUserById(req.principal!.id);
    res.status(201).json({ store: getStore(String(req.params.id)), verification: { sent: true, emailMasked: maskEmail(user?.email ?? ''), expiresAt: getStore(String(req.params.id))!.verificationExpiresAt } });
  });

  /** Код з пошти → одноразовий код підключення й дані для розгортання. */
  app.post('/api/admin/private-stores/:id/verify', requireAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!verifyPerAdmin(req.principal!.id)) return void res.status(429).json({ error: 'Забагато спроб. Зачекайте.', kind: 'too_many_attempts' });
    const id = String(req.params.id);
    const result = confirmVerification(id, String((req.body ?? {}).code ?? ''));
    if (!result.ok) {
      const messages: Record<string, string> = {
        not_found: 'Сервера не знайдено.',
        no_request: 'Код підтвердження не запитано. Натисніть «Надіслати код на пошту».',
        expired: 'Код підтвердження прострочений. Надішліть новий на пошту.',
        locked: 'Забагато хибних спроб. Надішліть новий код на пошту.',
        bad_code: `Код невірний. Лишилось спроб: ${result.attemptsLeft ?? 0}.`,
      };
      return void res.status(result.reason === 'not_found' ? 404 : 400).json({ error: messages[result.reason ?? 'bad_code'], kind: result.reason === 'not_found' ? 'not_found' : result.reason === 'bad_code' ? 'invalid_code' : 'code_unavailable', attemptsLeft: result.attemptsLeft });
    }
    const store = getStore(id)!;
    res.json({
      store,
      pairing: { code: result.pairingCode, expiresAt: result.pairingExpiresAt },
      deploy: {
        studioUrl: process.env.STUDIO_PUBLIC_URL ?? null,
        publicUrl: store.endpoint,
        env: { STUDIO_URL: process.env.STUDIO_PUBLIC_URL ?? '<адреса Studio>', PAIRING_CODE: result.pairingCode, PRIVATE_STORE_PUBLIC_URL: store.endpoint, PRIVATE_STORE_NAME: store.name },
      },
    });
  });

  for (const [action, revoked] of [['revoke', true], ['restore', false]] as const) {
    app.post(`/api/admin/private-stores/:id/${action}`, requireAdmin, (req, res) => {
      const store = setRevoked(String(req.params.id), revoked);
      if (!store) return void res.status(404).json({ error: 'Сервера не знайдено.', kind: 'not_found' });
      if (revoked) dropInboxOfStore(store.id); // відкликаний сервер знімків уже не забере: шифротекст у черзі зайвий
      res.json({ store });
    });
  }

  app.post('/api/admin/private-stores/:id/revoke-tokens', requireAdmin, (req, res) => {
    const store = revokeTokens(String(req.params.id));
    if (!store) return void res.status(404).json({ error: 'Сервера не знайдено.', kind: 'not_found' });
    res.json({ store });
  });

  app.delete('/api/admin/private-stores/:id', requireAdmin, (req, res) => {
    if (!deleteStore(String(req.params.id))) return void res.status(404).json({ error: 'Сервера не знайдено.', kind: 'not_found' });
    dropInboxOfStore(String(req.params.id));
    res.json({ ok: true });
  });

  // ── виклики локального сервера ────────────────────────────────────────────

  app.post('/api/private-store/pair', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!pairLimiter(clientIp(req))) return void res.status(429).json({ error: 'Забагато спроб. Зачекайте хвилину.', kind: 'too_many_attempts' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = pairStore({ code: String(body.code ?? ''), publicKey: String(body.publicKey ?? '') });
    if (!result.ok) {
      // Однакова відповідь для невідомого, простроченого, уже використаного й непідтвердженого коду.
      return void res.status(result.reason === 'bad_key' ? 400 : 404).json({
        error: result.reason === 'bad_key' ? 'Некоректний публічний ключ сервера.' : 'Код підключення недійсний або прострочений. Створіть новий в адмінпанелі.',
        kind: result.reason === 'bad_key' ? 'bad_input' : 'invalid_code',
      });
    }
    res.status(201).json({ vaultId: result.vaultId, studioPublicKey: result.studioPublicKey, studioOrigins: result.studioOrigins, heartbeatSeconds: result.heartbeatSeconds });
  });

  // Підписані запити сервера до черги запечатаних знімків із телефона (журнал #550).
  registerInboxVaultRoutes(app);

  app.post('/api/private-store/heartbeat', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const vaultId = String(req.get('x-private-store-id') ?? '');
    if (!heartbeatLimiter(`${clientIp(req)}:${vaultId}`)) return void res.status(429).json({ error: 'Забагато запитів.', kind: 'rate_limited' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : null;
    const result = body
      ? acceptHeartbeat({
          vaultId,
          timeSec: Number(req.get('x-private-store-time')),
          signature: String(req.get('x-private-store-signature') ?? ''),
          bodyText: JSON.stringify(body),
          info: body,
        })
      : { ok: false };
    if (!result.ok) return void res.status(401).json({ error: 'Підпис не прийнято.', kind: 'unauthenticated' });
    const hb = result as ReturnType<typeof acceptHeartbeat>;
    res.json({ ok: true, status: hb.status, revokeTokensBefore: hb.revokeTokensBefore, studioOrigins: hb.studioOrigins, heartbeatSeconds: hb.heartbeatSeconds });
  });

  // ── користувач ────────────────────────────────────────────────────────────

  app.get('/api/private-store/mine', requireAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      stores: listStoresForUser(req.principal!.id).map((s) => ({ id: s.id, name: s.name, endpoint: s.endpoint, kinds: s.kinds, online: s.online, lastSeen: s.lastSeen })),
    });
  });

  app.post('/api/private-store/:id/token', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!tokenLimiter(req.principal!.id)) return void res.status(429).json({ error: 'Забагато запитів токена.', kind: 'rate_limited' });
    const user = await findUserById(req.principal!.id);
    if (!user || user.disabled) return void res.status(403).json({ error: 'Обліковий запис недоступний.', kind: 'forbidden' });
    const result = issueAccessToken(String(req.params.id), req.principal!.id);
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : result.reason === 'forbidden' ? 403 : 409;
      const message = { not_found: 'Сервера не знайдено.', forbidden: 'Цей сервер вам не призначено.', inactive: 'Сервер відкликано або ще не підключено.' }[result.reason ?? 'not_found'];
      return void res.status(status).json({ error: message, kind: result.reason === 'inactive' ? 'store_inactive' : result.reason });
    }
    res.json({ token: result.token, expiresAt: result.expiresAt, endpoint: result.endpoint, kinds: result.kinds });
  });
}
