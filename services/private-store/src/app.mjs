/**
 * HTTP-інтерфейс локального сервера (журнал #549): `GET /v1/health`, записи `/v1/docs`, зображення `/v1/assets`.
 *
 * Захист, шар за шаром (кожен відмовляє самостійно):
 *   1. Host: лише відомі адреси сервера — проти DNS-rebinding (сторінка зловмисника не «перейде» на 127.0.0.1).
 *   2. Origin: браузерні виклики лише з адрес Studio, які повідомила сама Studio; чужа сторінка — 403 без CORS-заголовків.
 *   3. Токен: підписаний Studio (Ed25519), для ЦЬОГО сервера (aud), живе до 15 хв, видача в минулому відкликається.
 *   4. Власник: кожен запит обмежений `sub` токена; чужі записи не видно.
 *   5. Ліміти: розмір тіла, частота запитів на IP, окремий ліміт помилок автентифікації.
 *   6. Content-Type JSON для записів (простий міжсайтовий запит без preflight не пройде) і заголовки, що забороняють кешування й сніфінг.
 * Вміст записів не потрапляє ні в журнал подій, ні в логи.
 */
import { randomUUID } from 'node:crypto';
import { KINDS, verifyToken } from './token.mjs';
import { RevisionConflict } from './db.mjs';

const ID_RE = /^[A-Za-z0-9_-]{6,80}$/;
const ASSET_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_META_BYTES = 8 * 1024;

class HttpError extends Error {
  constructor(status, kind, message, extra) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.extra = extra;
  }
}

export class PrivateStoreApp {
  /**
   * @param {{ config: ReturnType<import('./config.mjs').loadConfig>, db: import('./db.mjs').Db, state: { link: any, identity: any } , now?: () => number }} deps
   */
  constructor({ config, db, state, now = () => Date.now() }) {
    this.config = config;
    this.db = db;
    this.state = state; // { link, identity }: змінюється пульсом
    this.now = now;
    this.hits = new Map();
    this.authFails = new Map();
    this.handle = this.handle.bind(this);
  }

  // ---- допоміжне -------------------------------------------------------------------------------------------------------
  allowedOrigins() {
    return new Set([...(this.state.link?.studioOrigins ?? []), ...this.config.extraOrigins]);
  }

  clientIp(req) {
    return req.socket.remoteAddress || 'unknown';
  }

  throttle(map, ip, limit) {
    const t = this.now();
    const entry = map.get(ip);
    if (!entry || entry.resetAt <= t) {
      map.set(ip, { count: 1, resetAt: t + 60_000 });
      if (map.size > 5000) for (const [k, v] of map) if (v.resetAt <= t) map.delete(k);
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  send(res, status, body, extraHeaders = {}) {
    const json = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      ...extraHeaders,
    });
    res.end(json);
  }

  readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(new HttpError(413, 'too_large', `Запит завеликий (максимум ${Math.round(limit / 1048576)} МБ).`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async readJson(req) {
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      throw new HttpError(415, 'bad_input', 'Потрібен Content-Type: application/json.');
    }
    const raw = await this.readBody(req, this.config.maxBodyBytes);
    try {
      const value = JSON.parse(raw.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
      return value;
    } catch {
      throw new HttpError(400, 'bad_input', 'Тіло запиту має бути JSON-обʼєктом.');
    }
  }

  /** Перевіряє токен і повертає його властивості. Відмови рахуються окремо: підбір токенів упирається в 429. */
  authenticate(req) {
    const ip = this.clientIp(req);
    const link = this.state.link;
    if (!link) throw new HttpError(503, 'not_paired', 'Сервер ще не підключено до Studio.');
    if (link.status === 'revoked') throw new HttpError(503, 'revoked', 'Підключення цього сервера відкликано в адмінпанелі Studio.');
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const verdict = token
      ? verifyToken(token, { studioPublicKey: link.studioPublicKey, vaultId: link.vaultId, revokeTokensBefore: link.revokeTokensBefore, nowSec: Math.floor(this.now() / 1000) })
      : { ok: false, reason: 'missing' };
    if (!verdict.ok) {
      if (!this.throttle(this.authFails, ip, 30)) throw new HttpError(429, 'too_many_attempts', 'Забагато невдалих спроб. Зачекайте хвилину.');
      this.db.audit('auth_failed', { detail: verdict.reason, ref: ip });
      throw new HttpError(401, 'unauthenticated', verdict.reason === 'expired' ? 'Токен доступу прострочений. Оновіть сторінку.' : 'Потрібен чинний токен доступу від Studio.');
    }
    return verdict.claims;
  }

  kindOf(value, claims) {
    if (!KINDS.includes(value)) throw new HttpError(400, 'bad_input', `Вид запису має бути одним із: ${KINDS.join(', ')}.`);
    if (!claims.kinds.includes(value)) throw new HttpError(403, 'forbidden', 'Для цього виду записів доступу немає.');
    return value;
  }

  idOf(value) {
    if (typeof value !== 'string' || !ID_RE.test(value)) throw new HttpError(400, 'bad_input', 'Некоректний ідентифікатор (латиниця, цифри, _ і -, 6–80 символів).');
    return value;
  }

  // ---- обробник ------------------------------------------------------------------------------------------------------
  async handle(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://x');
      const host = String(req.headers.host || '').toLowerCase();
      if (!this.config.allowedHosts.has(host)) return this.send(res, 421, { error: 'Невідома адреса сервера.', kind: 'bad_host' });

      const origin = req.headers.origin;
      const cors = {};
      if (origin) {
        if (!this.allowedOrigins().has(String(origin))) return this.send(res, 403, { error: 'Цій сторінці доступ не дозволено.', kind: 'origin_not_allowed' });
        Object.assign(cors, { 'access-control-allow-origin': origin, vary: 'Origin' });
      }
      if (req.method === 'OPTIONS') {
        return this.send(res, 204, undefined, {
          ...cors,
          'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type',
          // Chrome: сторінка в інтернеті звертається до локальної мережі лише з цією згодою сервера (Private Network Access).
          ...(req.headers['access-control-request-private-network'] ? { 'access-control-allow-private-network': 'true' } : {}),
          'access-control-max-age': '600',
        });
      }
      if (!this.throttle(this.hits, this.clientIp(req), this.config.rateLimitPerMinute)) {
        return this.send(res, 429, { error: 'Забагато запитів. Зачекайте хвилину.', kind: 'rate_limited' }, cors);
      }
      const out = await this.route(req, url);
      if (out.raw) {
        res.writeHead(200, {
          'content-type': out.raw.mime,
          'content-length': out.raw.bytes.length,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
          'content-disposition': 'inline',
          ...cors,
        });
        return res.end(out.raw.bytes);
      }
      return this.send(res, out.status ?? 200, out.body, cors);
    } catch (err) {
      if (err instanceof HttpError) return this.send(res, err.status, { error: err.message, kind: err.kind, ...(err.extra ?? {}) }, this.corsFor(req));
      if (err instanceof RevisionConflict) return this.send(res, 409, { error: err.message, kind: 'revision_conflict', current: err.current }, this.corsFor(req));
      if (err && err.kind === 'id_taken') return this.send(res, 409, { error: err.message, kind: 'id_taken' }, this.corsFor(req));
      if (err && err.kind === 'kind_mismatch') return this.send(res, 409, { error: err.message, kind: 'kind_mismatch' }, this.corsFor(req));
      console.error('[private-store] помилка:', err && err.message ? String(err.message).slice(0, 200) : 'невідома');
      return this.send(res, 500, { error: 'Не вдалося виконати дію. Спробуйте ще раз.', kind: 'server_error' }, this.corsFor(req));
    }
  }

  corsFor(req) {
    const origin = req.headers.origin;
    return origin && this.allowedOrigins().has(String(origin)) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
  }

  async route(req, url) {
    const m = req.method;
    const p = url.pathname.replace(/\/+$/, '') || '/';

    if (m === 'GET' && p === '/v1/health') {
      const link = this.state.link;
      return { body: { ok: true, version: this.config.version, paired: !!link, status: link ? link.status : 'unpaired', vaultId: link ? link.vaultId : null, time: new Date(this.now()).toISOString() } };
    }

    const claims = this.authenticate(req);

    if (m === 'GET' && p === '/v1/info') {
      return { body: { vaultId: this.state.link.vaultId, version: this.config.version, ...this.db.stats(claims.sub) } };
    }
    if (m === 'GET' && p === '/v1/docs') {
      const kindParam = url.searchParams.get('kind');
      const kind = kindParam ? this.kindOf(kindParam, claims) : null;
      const docs = this.db.listDocs(claims.sub, kind).filter((d) => claims.kinds.includes(d.kind));
      return { body: { docs } };
    }
    let match = /^\/v1\/docs\/([^/]+)$/.exec(p);
    if (match) {
      const id = this.idOf(decodeURIComponent(match[1]));
      if (m === 'GET') {
        const doc = this.db.getDoc(claims.sub, id);
        if (!doc || !claims.kinds.includes(doc.kind)) throw new HttpError(404, 'not_found', 'Запису немає.');
        return { body: { doc } };
      }
      if (m === 'PUT') {
        const body = await this.readJson(req);
        const kind = this.kindOf(body.kind, claims);
        if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) throw new HttpError(400, 'bad_input', 'payload має бути JSON-обʼєктом.');
        const meta = body.meta ?? {};
        if (typeof meta !== 'object' || Array.isArray(meta) || JSON.stringify(meta).length > MAX_META_BYTES) throw new HttpError(400, 'bad_input', 'meta має бути невеликим JSON-обʼєктом.');
        const expected = body.expectedRevision === undefined || body.expectedRevision === null ? undefined : body.expectedRevision;
        if (expected !== undefined && !Number.isInteger(expected)) throw new HttpError(400, 'bad_input', 'expectedRevision має бути цілим числом.');
        const result = this.db.putDoc(claims.sub, { id, kind, meta, payload: body.payload, expectedRevision: expected });
        this.db.audit(result.created ? 'doc_created' : 'doc_saved', { subject: claims.sub, ref: id });
        return { status: result.created ? 201 : 200, body: { id, kind, revision: result.revision, updatedAt: result.updatedAt } };
      }
      if (m === 'DELETE') {
        const doc = this.db.getDoc(claims.sub, id);
        if (!doc || !claims.kinds.includes(doc.kind)) throw new HttpError(404, 'not_found', 'Запису немає.');
        this.db.deleteDoc(claims.sub, id);
        this.db.audit('doc_deleted', { subject: claims.sub, ref: id });
        return { body: { ok: true } };
      }
    }
    match = /^\/v1\/assets\/([^/]+)$/.exec(p);
    if (match) {
      const id = this.idOf(decodeURIComponent(match[1]));
      if (m === 'PUT') {
        const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!ASSET_MIME.has(mime)) throw new HttpError(415, 'bad_input', 'Зображення має бути PNG, JPEG, WEBP або GIF.');
        const bytes = await this.readBody(req, MAX_ASSET_BYTES);
        if (!bytes.length) throw new HttpError(400, 'bad_input', 'Порожнє зображення.');
        const docId = url.searchParams.get('doc');
        if (docId) this.idOf(docId);
        this.db.putAsset(claims.sub, { id, docId, mime, bytes });
        this.db.audit('asset_saved', { subject: claims.sub, ref: id });
        return { status: 201, body: { id, size: bytes.length } };
      }
      if (m === 'GET') {
        const asset = this.db.getAsset(claims.sub, id);
        if (!asset) throw new HttpError(404, 'not_found', 'Зображення немає.');
        return { raw: { mime: asset.mime, bytes: asset.bytes } };
      }
      if (m === 'DELETE') {
        if (!this.db.deleteAsset(claims.sub, id)) throw new HttpError(404, 'not_found', 'Зображення немає.');
        return { body: { ok: true } };
      }
    }
    throw new HttpError(404, 'not_found', 'Такого маршруту немає.');
  }
}

export const newId = (prefix = 'ps') => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
