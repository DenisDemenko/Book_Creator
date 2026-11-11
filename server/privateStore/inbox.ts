/**
 * Черга запечатаних конвертів «телефон → локальний сервер» у Studio (журнал #550).
 *
 * Studio тут лише ПЕРЕНОСИТЬ байти: телефон шифрує знімок відкритим ключем сервера автора (services/private-store/src/envelope.mjs),
 * тож прочитати його може тільки локальний сервер. Studio знає номер елемента, розмір, хто й коли поклав, але не вміст.
 * Сервер сам забирає конверт вихідним запитом, підтверджує отримання — і Studio видаляє байти. Невзятий конверт зникає за
 * `INBOX_TTL_MS` (типово 72 години). Метадані про вже доставлений чи прострочений елемент лишаються 7 днів — щоб телефон
 * міг показати «забрано».
 *
 * Байти лежать файлами в DATA_DIR/private-inbox/<сервер>/<номер>.bin, опис — у SQLite.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getDb } from '../db';

type Row = Record<string, any>;

const MB = 1024 * 1024;
const envInt = (name: string, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** Знімок до 10 МБ (межа контракту чернеток) + заголовок і службові байти конверта. */
export const INBOX_MAX_ITEM_BYTES = 12 * MB;
export const INBOX_TTL_MS = envInt('PRIVATE_INBOX_TTL_HOURS', 72, 1, 24 * 14) * 3600 * 1000;
export const INBOX_META_KEEP_MS = 7 * 24 * 3600 * 1000;
/** Скільки невзятого один користувач може тримати в черзі: захист тому Studio від засмічення. */
export const INBOX_USER_MAX_BYTES = envInt('PRIVATE_INBOX_USER_MAX_MB', 300, 10, 4096) * MB;
export const INBOX_USER_MAX_ITEMS = 500;
export const INBOX_TOTAL_MAX_BYTES = envInt('PRIVATE_INBOX_MAX_TOTAL_MB', 3072, 50, 102400) * MB;
export const INBOX_LIST_LIMIT = 200;

export const ITEM_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export type InboxState = 'queued' | 'delivered' | 'expired';

function database() {
  const db = getDb();
  if (!db) throw new Error('SQLite недоступна.');
  db.exec(`CREATE TABLE IF NOT EXISTS private_inbox (
    store_id TEXT NOT NULL, id TEXT NOT NULL, user_id TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, delivered_at TEXT, state TEXT NOT NULL,
    PRIMARY KEY (store_id, id)
  );
  CREATE INDEX IF NOT EXISTS private_inbox_state ON private_inbox(state, expires_at);
  CREATE INDEX IF NOT EXISTS private_inbox_user ON private_inbox(user_id, state);`);
  return db;
}

const root = () => path.join(DATA_DIR, 'private-inbox');
const fileOf = (storeId: string, itemId: string) => path.join(root(), storeId, `${itemId}.bin`);
const safeStoreId = (storeId: string) => /^[A-Za-z0-9_-]{6,80}$/.test(storeId);

function removeFile(storeId: string, itemId: string): void {
  try {
    fs.rmSync(fileOf(storeId, itemId), { force: true });
  } catch {
    /* файл уже прибрано */
  }
}

let lastMetaSweepMs = 0;

/**
 * Прострочене — у «прострочено» (байти геть), давні метадані — геть. Викликається перед записом і переліком; це лише прибирання,
 * тож збій (напр. база зайнята іншим записом) запит не ламає. Писати в базу без потреби не намагаємось: спершу читаємо.
 */
export function sweepInbox(now = new Date()): number {
  try {
    const db = database();
    const nowIso = now.toISOString();
    const stale = db.prepare("SELECT store_id, id FROM private_inbox WHERE state = 'queued' AND expires_at <= ?").all(nowIso) as Row[];
    for (const r of stale) removeFile(r.store_id, r.id);
    if (stale.length) db.prepare("UPDATE private_inbox SET state = 'expired' WHERE state = 'queued' AND expires_at <= ?").run(nowIso);
    if (now.getTime() - lastMetaSweepMs > 10 * 60 * 1000) {
      lastMetaSweepMs = now.getTime();
      const cutoff = new Date(now.getTime() - INBOX_META_KEEP_MS).toISOString();
      db.prepare("DELETE FROM private_inbox WHERE state != 'queued' AND (COALESCE(delivered_at, expires_at) <= ?)").run(cutoff);
    }
    return stale.length;
  } catch (err) {
    console.error('[privateInbox] прибирання черги не вдалося:', String((err as Error)?.message || err).slice(0, 160));
    return 0;
  }
}

/** Один тип з необов'язковими полями (tsconfig без strict не звужує об'єднання за `ok`). */
export interface PutResult {
  ok: boolean;
  duplicate?: boolean;
  state?: InboxState;
  expiresAt?: string;
  reason?: 'bad_id' | 'too_large' | 'empty' | 'conflict' | 'quota_user' | 'quota_total' | 'write_failed';
}

export function putInboxItem(input: { storeId: string; userId: string; itemId: string; bytes: Buffer; now?: Date }): PutResult {
  const { storeId, userId, itemId, bytes } = input;
  const now = input.now ?? new Date();
  if (!ITEM_ID_RE.test(itemId) || !safeStoreId(storeId)) return { ok: false, reason: 'bad_id' };
  if (!bytes.length) return { ok: false, reason: 'empty' };
  if (bytes.length > INBOX_MAX_ITEM_BYTES) return { ok: false, reason: 'too_large' };
  const db = database();
  sweepInbox(now);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const existing = db.prepare('SELECT * FROM private_inbox WHERE store_id = ? AND id = ?').get(storeId, itemId) as Row | undefined;
  if (existing) {
    // Повтор із черги телефона (зв'язок обірвався після відправки) — не дубль; той самий номер із іншим вмістом — відмова.
    if (existing.user_id === userId && existing.sha256 === hash) return { ok: true, duplicate: true, state: existing.state, expiresAt: existing.expires_at };
    return { ok: false, reason: 'conflict' };
  }
  const user = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM private_inbox WHERE user_id = ? AND state = 'queued'").get(userId) as Row;
  if (Number(user.n) >= INBOX_USER_MAX_ITEMS || Number(user.bytes) + bytes.length > INBOX_USER_MAX_BYTES) return { ok: false, reason: 'quota_user' };
  const total = db.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM private_inbox WHERE state = 'queued'").get() as Row;
  if (Number(total.bytes) + bytes.length > INBOX_TOTAL_MAX_BYTES) return { ok: false, reason: 'quota_total' };
  const file = fileOf(storeId, itemId);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.part`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  } catch {
    return { ok: false, reason: 'write_failed' };
  }
  const expiresAt = new Date(now.getTime() + INBOX_TTL_MS).toISOString();
  db.prepare("INSERT INTO private_inbox (store_id, id, user_id, size, sha256, created_at, expires_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')").run(
    storeId,
    itemId,
    userId,
    bytes.length,
    hash,
    now.toISOString(),
    expiresAt
  );
  return { ok: true, duplicate: false, state: 'queued', expiresAt };
}

export interface PendingItem {
  id: string;
  userId: string;
  size: number;
  createdAt: string;
}

export function listInboxPending(storeId: string, now = new Date()): PendingItem[] {
  const db = database();
  sweepInbox(now);
  return (db.prepare("SELECT id, user_id, size, created_at FROM private_inbox WHERE store_id = ? AND state = 'queued' ORDER BY created_at LIMIT ?").all(storeId, INBOX_LIST_LIMIT) as Row[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    size: Number(r.size),
    createdAt: r.created_at,
  }));
}

export function readInboxItem(storeId: string, itemId: string, now = new Date()): Buffer | null {
  if (!ITEM_ID_RE.test(itemId) || !safeStoreId(storeId)) return null;
  const db = database();
  const row = db.prepare("SELECT expires_at FROM private_inbox WHERE store_id = ? AND id = ? AND state = 'queued'").get(storeId, itemId) as Row | undefined;
  if (!row || Date.parse(row.expires_at) <= now.getTime()) return null;
  try {
    return fs.readFileSync(fileOf(storeId, itemId));
  } catch {
    return null;
  }
}

/** Сервер підтвердив отримання: байти видаляються, лишається запис «доставлено». Повторне підтвердження — не помилка. */
export function ackInboxItem(storeId: string, itemId: string, now = new Date()): boolean {
  if (!ITEM_ID_RE.test(itemId) || !safeStoreId(storeId)) return false;
  const db = database();
  const row = db.prepare('SELECT state FROM private_inbox WHERE store_id = ? AND id = ?').get(storeId, itemId) as Row | undefined;
  if (!row) return false;
  removeFile(storeId, itemId);
  if (row.state === 'queued') db.prepare("UPDATE private_inbox SET state = 'delivered', delivered_at = ? WHERE store_id = ? AND id = ?").run(now.toISOString(), storeId, itemId);
  return true;
}

/** Для телефона: що з його елементом. Чужого елемента чи невідомого не відрізнити — для обох 'unknown'. */
export function inboxStatus(storeId: string, userId: string, itemId: string, now = new Date()): InboxState | 'unknown' {
  if (!ITEM_ID_RE.test(itemId) || !safeStoreId(storeId)) return 'unknown';
  const db = database();
  const row = db.prepare('SELECT user_id, state, expires_at FROM private_inbox WHERE store_id = ? AND id = ?').get(storeId, itemId) as Row | undefined;
  if (!row || row.user_id !== userId) return 'unknown';
  if (row.state === 'queued' && Date.parse(row.expires_at) <= now.getTime()) return 'expired';
  return row.state;
}

/** Для адмінпанелі: скільки лежить у черзі цього сервера (байтів вмісту Studio не бачить). */
export function inboxStats(storeId: string): { pending: number; bytes: number } {
  const row = database().prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM private_inbox WHERE store_id = ? AND state = 'queued'").get(storeId) as Row;
  return { pending: Number(row.n), bytes: Number(row.bytes) };
}

/** Сервер відкликано чи видалено: невзяті байти зайві. */
export function dropInboxOfStore(storeId: string): void {
  if (!safeStoreId(storeId)) return;
  const db = database();
  db.prepare("DELETE FROM private_inbox WHERE store_id = ? AND state = 'queued'").run(storeId);
  try {
    fs.rmSync(path.join(root(), storeId), { recursive: true, force: true });
  } catch {
    /* немає теки */
  }
}
