/**
 * Реєстр локальних серверів приватного сховища в Studio (журнал #549): які сервери підключено, кому вони призначені, коли
 * виходили на зв'язок. САМИХ МАТЕРІАЛІВ тут немає — вони лежать лише на локальному сервері (запит власника: «суворо локально»).
 * Збереження в хмарі лишається типовим: приватне — лише за галочкою на конкретному матеріалі.
 *
 *   private_stores        — сервери: назва, адреса для браузера, дозволені сторінки (origins), стан, публічний ключ сервера
 *   private_store_users   — кому призначено (користувач бачить галочку «Приватне збереження» лише за наявності сервера)
 *   private_store_signing — ключова пара Ed25519, якою Studio підписує токени доступу (можна задати змінною PRIVATE_STORE_SIGNING_KEY)
 *
 * Розгортання локального сервера пропонується ЛИШЕ після підтвердження поштою й кодом: адмін створює запис → на пошту його
 * облікового запису йде код підтвердження → лише після введення коду Studio видає одноразовий код підключення й команду розгортання.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, timingSafeEqual, verify } from 'node:crypto';
import { getDb } from '../db';
import { HEARTBEAT_PREFIX, PRIVATE_KINDS, REQUEST_PREFIX, signAccessToken, type PrivateKind } from './token';

type Row = Record<string, any>;

export const PAIRING_TTL_MS = 15 * 60 * 1000;
export const VERIFY_TTL_MS = 15 * 60 * 1000;
export const VERIFY_MAX_ATTEMPTS = 5;
export const HEARTBEAT_SECONDS = 60;
/** Сервер вважається «в мережі», якщо пульс був не пізніше ніж 3 інтервали тому. */
export const ONLINE_WINDOW_MS = HEARTBEAT_SECONDS * 3 * 1000;
export const HEARTBEAT_SKEW_SEC = 120;

export type StoreStatus = 'pending' | 'active' | 'revoked';

export interface PrivateStoreRecord {
  id: string;
  name: string;
  endpoint: string;
  origins: string[];
  kinds: PrivateKind[];
  status: StoreStatus;
  userIds: string[];
  createdAt: string;
  pairedAt: string | null;
  lastSeen: string | null;
  online: boolean;
  info: Record<string, unknown> | null;
  /** Пошту підтверджено кодом: лише тоді можна отримати код підключення. */
  verified: boolean;
  /** Код підтвердження вже надіслано й ще дійсний. */
  verificationPending: boolean;
  verificationExpiresAt: string | null;
  pairingExpiresAt: string | null;
  revokeTokensBefore: string | null;
  /** Відкритий ключ «скриньки» сервера (P-256, base64url): ним телефон запечатує знімки (журнал #550). Приватного в Studio немає. */
  inboxKey: string | null;
}

let migrated = false;

function database() {
  const db = getDb();
  if (!db) throw new Error('SQLite недоступна.');
  db.exec(`CREATE TABLE IF NOT EXISTS private_stores (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL, origins_json TEXT NOT NULL, kinds_json TEXT NOT NULL,
    status TEXT NOT NULL, vault_public_key TEXT, pairing_hash TEXT, pairing_expires_at TEXT,
    verify_hash TEXT, verify_expires_at TEXT, verify_attempts INTEGER NOT NULL DEFAULT 0, verified_at TEXT,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, paired_at TEXT, last_seen TEXT, last_heartbeat_sec INTEGER,
    info_json TEXT, revoke_tokens_before TEXT
  );
  CREATE TABLE IF NOT EXISTS private_store_users (
    store_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (store_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS private_store_users_user ON private_store_users(user_id);
  CREATE TABLE IF NOT EXISTS private_store_signing (
    id INTEGER PRIMARY KEY CHECK (id = 1), public_spki TEXT NOT NULL, private_pkcs8 TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
  if (!migrated) {
    // Стовпець ключа скриньки (журнал #550) для баз, створених до нього.
    const columns = (db.prepare('PRAGMA table_info(private_stores)').all() as Row[]).map((c) => c.name);
    if (!columns.includes('inbox_public_key')) db.exec('ALTER TABLE private_stores ADD COLUMN inbox_public_key TEXT');
    migrated = true;
  }
  return db;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Межа відкликання токенів: найближча ПОВНА секунда після `now`, бо `iat` у токені — цілі секунди (інакше токен, виданий у ту саму секунду, пережив би відкликання). */
const revokeCutoff = (now: Date) => new Date(Math.ceil(now.getTime() / 1000) * 1000).toISOString();

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Ключ підпису токенів
// ---------------------------------------------------------------------------

export interface SigningKey {
  publicSpki: string;
  privatePkcs8: string;
  fingerprint: string;
}

let cachedKey: SigningKey | null = null;
export function resetSigningKeyCache(): void {
  cachedKey = null;
}

function describeKey(publicSpki: string, privatePkcs8: string): SigningKey {
  return { publicSpki, privatePkcs8, fingerprint: sha256(publicSpki).slice(0, 16) };
}

/** Ключ підпису: змінна середовища (PKCS8 base64) має перевагу; інакше створюється один раз і лежить у базі. */
export function signingKey(): SigningKey {
  if (cachedKey) return cachedKey;
  const fromEnv = (process.env.PRIVATE_STORE_SIGNING_KEY || '').trim();
  if (fromEnv) {
    const priv = createPrivateKey({ key: Buffer.from(fromEnv, 'base64'), format: 'der', type: 'pkcs8' });
    const pub = createPublicKey(priv).export({ type: 'spki', format: 'der' }).toString('base64');
    cachedKey = describeKey(pub, fromEnv);
    return cachedKey;
  }
  const db = database();
  const row = db.prepare('SELECT public_spki, private_pkcs8 FROM private_store_signing WHERE id = 1').get() as Row | undefined;
  if (row) {
    cachedKey = describeKey(row.public_spki, row.private_pkcs8);
    return cachedKey;
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  db.prepare('INSERT OR IGNORE INTO private_store_signing (id, public_spki, private_pkcs8, created_at) VALUES (1, ?, ?, ?)').run(pub, priv, new Date().toISOString());
  const stored = db.prepare('SELECT public_spki, private_pkcs8 FROM private_store_signing WHERE id = 1').get() as Row;
  cachedKey = describeKey(stored.public_spki, stored.private_pkcs8);
  return cachedKey;
}

// ---------------------------------------------------------------------------
// Допоміжне
// ---------------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без O/0/I/1, щоб код легко набирати

function randomChars(n: number): string {
  return Array.from(randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Код підключення локального сервера: PS-XXXX-XXXX-XXXX (60 біт), одноразовий, 15 хвилин. */
export function newPairingCode(): string {
  const c = randomChars(12);
  return `PS-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}

/** Код підтвердження пошти: 8 символів, 5 спроб, 15 хвилин. */
export function newVerificationCode(): string {
  return randomChars(8);
}

function parseList(json: unknown): string[] {
  try {
    const value = JSON.parse(String(json ?? '[]'));
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function toRecord(row: Row, userIds: string[], nowMs: number): PrivateStoreRecord {
  const lastSeen = (row.last_seen as string | null) ?? null;
  const verifyLive = !!row.verify_hash && !!row.verify_expires_at && Date.parse(row.verify_expires_at) > nowMs;
  const pairingLive = !!row.pairing_hash && !!row.pairing_expires_at && Date.parse(row.pairing_expires_at) > nowMs;
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    origins: parseList(row.origins_json),
    kinds: parseList(row.kinds_json).filter((k): k is PrivateKind => (PRIVATE_KINDS as readonly string[]).includes(k)),
    status: row.status,
    userIds,
    createdAt: row.created_at,
    pairedAt: row.paired_at ?? null,
    lastSeen,
    online: row.status === 'active' && !!lastSeen && nowMs - Date.parse(lastSeen) <= ONLINE_WINDOW_MS,
    info: row.info_json ? JSON.parse(row.info_json) : null,
    verified: !!row.verified_at,
    verificationPending: verifyLive,
    verificationExpiresAt: verifyLive ? row.verify_expires_at : null,
    pairingExpiresAt: pairingLive ? row.pairing_expires_at : null,
    revokeTokensBefore: row.revoke_tokens_before ?? null,
    inboxKey: row.inbox_public_key ?? null,
  };
}

function usersOf(db: ReturnType<typeof database>, storeId: string): string[] {
  return (db.prepare('SELECT user_id FROM private_store_users WHERE store_id = ? ORDER BY user_id').all(storeId) as Row[]).map((r) => r.user_id);
}

/** Адреса, за якою браузер звертається до сервера: http(s), без шляху, запиту й облікових даних. */
export function normalizeEndpoint(raw: unknown): string {
  let url: URL;
  try {
    url = new URL(String(raw ?? ''));
  } catch {
    throw new Error('Адреса сервера має бути на кшталт http://127.0.0.1:8787');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Адреса сервера — лише http(s)://хост:порт, без шляху, запиту й облікових даних.');
  }
  return url.origin;
}

/** Дозволена сторінка Studio: рівно origin (схема + хост + порт). */
export function normalizeOrigin(raw: unknown): string {
  let url: URL;
  try {
    url = new URL(String(raw ?? ''));
  } catch {
    throw new Error(`«${String(raw).slice(0, 80)}» — не адреса сторінки.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Дозволена сторінка має бути http(s)://хост[:порт].');
  return url.origin;
}

// ---------------------------------------------------------------------------
// Керування серверами (адмінпанель)
// ---------------------------------------------------------------------------

export interface CreateStoreInput {
  name: string;
  endpoint: string;
  origins: string[];
  kinds?: PrivateKind[];
  userIds: string[];
  createdBy: string;
}

/** Створює запис БЕЗ коду підключення: його видають лише після підтвердження пошти (див. startVerification / confirmVerification). */
export function createStore(input: CreateStoreInput, now = new Date()): PrivateStoreRecord {
  const db = database();
  const name = String(input.name ?? '').trim();
  if (!name || name.length > 80) throw new Error('Назва сервера — від 1 до 80 символів.');
  const endpoint = normalizeEndpoint(input.endpoint);
  const origins = [...new Set(input.origins.map(normalizeOrigin))];
  if (!origins.length) throw new Error('Потрібна хоча б одна дозволена сторінка Studio.');
  const kinds = (input.kinds?.length ? input.kinds : [...PRIVATE_KINDS]).filter((k) => (PRIVATE_KINDS as readonly string[]).includes(k));
  const id = `pstore_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  db.prepare(`INSERT INTO private_stores (id, name, endpoint, origins_json, kinds_json, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`).run(id, name, endpoint, JSON.stringify(origins), JSON.stringify(kinds), input.createdBy, now.toISOString());
  setUsers(id, input.userIds);
  return getStore(id, now)!;
}

export function getStore(id: string, now = new Date()): PrivateStoreRecord | null {
  const db = database();
  const row = db.prepare('SELECT * FROM private_stores WHERE id = ?').get(id) as Row | undefined;
  return row ? toRecord(row, usersOf(db, id), now.getTime()) : null;
}

export function listStores(now = new Date()): PrivateStoreRecord[] {
  const db = database();
  return (db.prepare('SELECT * FROM private_stores ORDER BY created_at DESC').all() as Row[]).map((r) => toRecord(r, usersOf(db, r.id), now.getTime()));
}

export function listStoresForUser(userId: string, now = new Date()): PrivateStoreRecord[] {
  const db = database();
  const ids = (db.prepare('SELECT store_id FROM private_store_users WHERE user_id = ?').all(userId) as Row[]).map((r) => r.store_id);
  return ids.map((id) => getStore(id, now)).filter((s): s is PrivateStoreRecord => !!s && s.status === 'active');
}

export function setUsers(storeId: string, userIds: string[]): void {
  const db = database();
  const unique = [...new Set(userIds.filter((u) => typeof u === 'string' && u))];
  db.prepare('DELETE FROM private_store_users WHERE store_id = ?').run(storeId);
  for (const userId of unique) db.prepare('INSERT OR IGNORE INTO private_store_users (store_id, user_id) VALUES (?, ?)').run(storeId, userId);
}

export interface UpdateStoreInput {
  name?: string;
  endpoint?: string;
  origins?: string[];
  kinds?: PrivateKind[];
  userIds?: string[];
}

export function updateStore(id: string, patch: UpdateStoreInput): PrivateStoreRecord | null {
  const db = database();
  if (!getStore(id)) return null;
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name || name.length > 80) throw new Error('Назва сервера — від 1 до 80 символів.');
    db.prepare('UPDATE private_stores SET name = ? WHERE id = ?').run(name, id);
  }
  if (patch.endpoint !== undefined) db.prepare('UPDATE private_stores SET endpoint = ? WHERE id = ?').run(normalizeEndpoint(patch.endpoint), id);
  if (patch.origins !== undefined) {
    const origins = [...new Set(patch.origins.map(normalizeOrigin))];
    if (!origins.length) throw new Error('Потрібна хоча б одна дозволена сторінка Studio.');
    db.prepare('UPDATE private_stores SET origins_json = ? WHERE id = ?').run(JSON.stringify(origins), id);
  }
  if (patch.kinds !== undefined) {
    const kinds = patch.kinds.filter((k) => (PRIVATE_KINDS as readonly string[]).includes(k));
    if (!kinds.length) throw new Error('Оберіть хоча б один вид матеріалів.');
    db.prepare('UPDATE private_stores SET kinds_json = ? WHERE id = ?').run(JSON.stringify(kinds), id);
  }
  if (patch.userIds !== undefined) setUsers(id, patch.userIds);
  return getStore(id);
}

// ---------------------------------------------------------------------------
// Підтвердження поштою й кодом: без нього код підключення не видається
// ---------------------------------------------------------------------------

/**
 * Починає підтвердження: скидає попереднє (код підключення теж) і повертає ОДНОРАЗОВИЙ код, який маршрут надсилає на пошту
 * адміністратора. У базі лишається лише SHA-256 коду. Повторний запит замінює код і обнуляє лічильник спроб.
 */
export function startVerification(id: string, now = new Date()): string | null {
  const db = database();
  if (!getStore(id, now)) return null;
  const code = newVerificationCode();
  db.prepare('UPDATE private_stores SET verify_hash = ?, verify_expires_at = ?, verify_attempts = 0, verified_at = NULL, pairing_hash = NULL, pairing_expires_at = NULL WHERE id = ?')
    .run(sha256(code), new Date(now.getTime() + VERIFY_TTL_MS).toISOString(), id);
  return code;
}

export type VerifyResult = {
  ok: boolean;
  reason?: 'not_found' | 'no_request' | 'expired' | 'locked' | 'bad_code';
  attemptsLeft?: number;
  /** Одноразовий код підключення для локального сервера — показується один раз. */
  pairingCode?: string;
  pairingExpiresAt?: string;
};

/** Перевіряє код з пошти. Успіх видає код підключення (15 хв); 5 хибних спроб скасовують код підтвердження. */
export function confirmVerification(id: string, rawCode: string, now = new Date()): VerifyResult {
  const db = database();
  const row = db.prepare('SELECT verify_hash, verify_expires_at, verify_attempts FROM private_stores WHERE id = ?').get(id) as Row | undefined;
  if (!row) return { ok: false, reason: 'not_found' };
  if (!row.verify_hash) return { ok: false, reason: 'no_request' };
  if (!row.verify_expires_at || Date.parse(row.verify_expires_at) <= now.getTime()) return { ok: false, reason: 'expired' };
  if (Number(row.verify_attempts) >= VERIFY_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  const code = String(rawCode ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z2-9]{8}$/.test(code) || !sameHash(sha256(code), row.verify_hash)) {
    const attempts = Number(row.verify_attempts) + 1;
    if (attempts >= VERIFY_MAX_ATTEMPTS) db.prepare('UPDATE private_stores SET verify_attempts = ?, verify_hash = NULL, verify_expires_at = NULL WHERE id = ?').run(attempts, id);
    else db.prepare('UPDATE private_stores SET verify_attempts = ? WHERE id = ?').run(attempts, id);
    return { ok: false, reason: attempts >= VERIFY_MAX_ATTEMPTS ? 'locked' : 'bad_code', attemptsLeft: Math.max(0, VERIFY_MAX_ATTEMPTS - attempts) };
  }
  const pairingCode = newPairingCode();
  const pairingExpiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
  db.prepare('UPDATE private_stores SET verify_hash = NULL, verify_expires_at = NULL, verify_attempts = 0, verified_at = ?, pairing_hash = ?, pairing_expires_at = ? WHERE id = ?')
    .run(now.toISOString(), sha256(pairingCode), pairingExpiresAt, id);
  return { ok: true, pairingCode, pairingExpiresAt };
}

/** Відкликати (`revoked`) або повернути (`active`, якщо сервер уже підключався). Відкликання скасовує й уже видані токени. */
export function setRevoked(id: string, revoked: boolean, now = new Date()): PrivateStoreRecord | null {
  const db = database();
  const row = db.prepare('SELECT status, vault_public_key FROM private_stores WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  if (revoked) {
    db.prepare("UPDATE private_stores SET status = 'revoked', revoke_tokens_before = ? WHERE id = ?").run(revokeCutoff(now), id);
  } else {
    db.prepare('UPDATE private_stores SET status = ? WHERE id = ?').run(row.vault_public_key ? 'active' : 'pending', id);
  }
  return getStore(id, now);
}

/** Скасувати всі токени, видані до цього моменту (сервер дізнається з наступного пульсу). */
export function revokeTokens(id: string, now = new Date()): PrivateStoreRecord | null {
  const db = database();
  if (!getStore(id, now)) return null;
  db.prepare('UPDATE private_stores SET revoke_tokens_before = ? WHERE id = ?').run(revokeCutoff(now), id);
  return getStore(id, now);
}

export function deleteStore(id: string): boolean {
  const db = database();
  db.prepare('DELETE FROM private_store_users WHERE store_id = ?').run(id);
  return Number((db.prepare('DELETE FROM private_stores WHERE id = ?').run(id) as { changes?: number }).changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Підключення й пульс (виклики локального сервера)
// ---------------------------------------------------------------------------

export interface PairInput {
  code: string;
  publicKey: string;
}

export interface PairResult {
  ok: boolean;
  reason?: 'bad_code' | 'bad_key';
  vaultId?: string;
  studioPublicKey?: string;
  studioOrigins?: string[];
  heartbeatSeconds?: number;
}

/** Обмін одноразового коду на підключення. Код стає недійсним одразу; публічний ключ сервера запам'ятовується. */
export function pairStore(input: PairInput, now = new Date()): PairResult {
  const db = database();
  const code = String(input.code ?? '').trim().toUpperCase();
  if (!/^PS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) return { ok: false, reason: 'bad_code' };
  let spki: string;
  try {
    spki = createPublicKey({ key: Buffer.from(String(input.publicKey ?? ''), 'base64'), format: 'der', type: 'spki' }).export({ type: 'spki', format: 'der' }).toString('base64');
  } catch {
    return { ok: false, reason: 'bad_key' };
  }
  // Код підключення існує лише після підтвердження пошти (verified_at); до того pairing_hash порожній.
  const row = db.prepare("SELECT * FROM private_stores WHERE pairing_hash = ? AND pairing_expires_at > ? AND verified_at IS NOT NULL AND status != 'revoked'").get(sha256(code), now.toISOString()) as Row | undefined;
  if (!row) return { ok: false, reason: 'bad_code' };
  db.prepare("UPDATE private_stores SET status = 'active', vault_public_key = ?, pairing_hash = NULL, pairing_expires_at = NULL, paired_at = ?, last_seen = ?, last_heartbeat_sec = ? WHERE id = ?")
    .run(spki, now.toISOString(), now.toISOString(), Math.floor(now.getTime() / 1000), row.id);
  return { ok: true, vaultId: row.id, studioPublicKey: signingKey().publicSpki, studioOrigins: parseList(row.origins_json), heartbeatSeconds: HEARTBEAT_SECONDS };
}

export interface HeartbeatResult {
  ok: boolean;
  reason?: 'unknown_store' | 'bad_signature' | 'stale';
  status?: 'active' | 'revoked';
  revokeTokensBefore?: string | null;
  studioOrigins?: string[];
  heartbeatSeconds?: number;
}

/** Несжатий публічний ключ P-256: 65 байтів, перший — 0x04. Валідність точки перевіряє той, хто ним шифрує. */
export function isInboxPublicKey(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{86,90}$/.test(value)) return false;
  const raw = Buffer.from(value, 'base64url');
  return raw.length === 65 && raw[0] === 0x04;
}

/**
 * Підписаний запит сервера до черги конвертів (формат — services/private-store/src/studioLink.mjs, `signedRequestHeaders`).
 * Повторний запит у межах хвилини повертає те саме (перелік номерів чи шифротекст), тож лічильник часу, як у пульсі, не ведемо.
 */
export function acceptSignedRequest(
  input: { vaultId: string; timeSec: number; signature: string; method: string; path: string; bodySha: string },
  now = new Date()
): { ok: boolean; store?: PrivateStoreRecord; reason?: 'unknown_store' | 'stale' | 'bad_signature' | 'inactive' } {
  const db = database();
  const row = db.prepare('SELECT * FROM private_stores WHERE id = ?').get(input.vaultId) as Row | undefined;
  if (!row || !row.vault_public_key) return { ok: false, reason: 'unknown_store' };
  const nowSec = Math.floor(now.getTime() / 1000);
  if (!Number.isInteger(input.timeSec) || Math.abs(nowSec - input.timeSec) > 60) return { ok: false, reason: 'stale' };
  let valid = false;
  try {
    valid = verify(
      null,
      Buffer.from(`${REQUEST_PREFIX}${input.vaultId}\n${input.method.toUpperCase()}\n${input.path}\n${input.timeSec}\n${input.bodySha}`, 'utf8'),
      createPublicKey({ key: Buffer.from(row.vault_public_key, 'base64'), format: 'der', type: 'spki' }),
      Buffer.from(input.signature, 'base64url')
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  if (row.status !== 'active') return { ok: false, reason: 'inactive' };
  return { ok: true, store: toRecord(row, usersOf(db, input.vaultId), now.getTime()) };
}

/** Перевірка підписаного пульсу (формат — services/private-store/src/studioLink.mjs). */
export function acceptHeartbeat(input: { vaultId: string; timeSec: number; signature: string; bodyText: string; info: Record<string, unknown> }, now = new Date()): HeartbeatResult {
  const db = database();
  const row = db.prepare('SELECT * FROM private_stores WHERE id = ?').get(input.vaultId) as Row | undefined;
  if (!row || !row.vault_public_key) return { ok: false, reason: 'unknown_store' };
  const nowSec = Math.floor(now.getTime() / 1000);
  if (!Number.isInteger(input.timeSec) || Math.abs(nowSec - input.timeSec) > HEARTBEAT_SKEW_SEC) return { ok: false, reason: 'stale' };
  if (row.last_heartbeat_sec && input.timeSec < row.last_heartbeat_sec) return { ok: false, reason: 'stale' };
  let valid = false;
  try {
    valid = verify(
      null,
      Buffer.from(`${HEARTBEAT_PREFIX}${input.vaultId}\n${input.timeSec}\n${sha256(input.bodyText)}`, 'utf8'),
      createPublicKey({ key: Buffer.from(row.vault_public_key, 'base64'), format: 'der', type: 'spki' }),
      Buffer.from(input.signature, 'base64url')
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  const info = { version: input.info.version, docs: input.info.docs, assets: input.info.assets, bytes: input.info.bytes, endpoint: input.info.endpoint, uptimeSec: input.info.uptimeSec };
  db.prepare('UPDATE private_stores SET last_seen = ?, last_heartbeat_sec = ?, info_json = ? WHERE id = ?').run(now.toISOString(), input.timeSec, JSON.stringify(info), input.vaultId);
  // Ключ скриньки сервер повідомляє в підписаному пульсі: телефон бере його звідси (журнал #550).
  const inboxKey = typeof input.info.inboxKey === 'string' ? input.info.inboxKey : null;
  if (inboxKey && isInboxPublicKey(inboxKey)) db.prepare('UPDATE private_stores SET inbox_public_key = ? WHERE id = ?').run(inboxKey, input.vaultId);
  return {
    ok: true,
    status: row.status === 'revoked' ? 'revoked' : 'active',
    revokeTokensBefore: row.revoke_tokens_before ?? null,
    studioOrigins: parseList(row.origins_json),
    heartbeatSeconds: HEARTBEAT_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Токени для браузера
// ---------------------------------------------------------------------------

export interface TokenResult {
  ok: boolean;
  reason?: 'not_found' | 'forbidden' | 'inactive';
  token?: string;
  expiresAt?: string;
  endpoint?: string;
  kinds?: PrivateKind[];
}

export function issueAccessToken(storeId: string, userId: string, now = new Date()): TokenResult {
  const store = getStore(storeId, now);
  if (!store) return { ok: false, reason: 'not_found' };
  if (!store.userIds.includes(userId)) return { ok: false, reason: 'forbidden' };
  if (store.status !== 'active') return { ok: false, reason: 'inactive' };
  const { token, expiresAt } = signAccessToken(signingKey().privatePkcs8, { vaultId: store.id, userId, kinds: store.kinds, nowSec: Math.floor(now.getTime() / 1000) });
  return { ok: true, token, expiresAt, endpoint: store.endpoint, kinds: store.kinds };
}
