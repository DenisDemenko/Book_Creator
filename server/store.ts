/**
 * Сховище серверного стану NOVA STUDIO.
 *
 * Основний бекенд — SQLite через вбудований `node:sqlite` (server/db.ts).
 * Якщо він недоступний (Node старіший за 22.5), модуль прозоро відкочується
 * на попереднє файлове сховище (server/storeJson.ts) — застосунок працює
 * в обох випадках, просто в другому без переваг бази.
 *
 * Публічний API навмисно не змінився з часів файлової версії: усе інше
 * (auth.ts, adminRoutes.ts, server.ts) не знає, що саме під ним.
 *
 * При першому запуску з наявними JSON-файлами дані переносяться в базу
 * автоматично; вихідні файли не видаляються й лишаються як резервна копія.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb, isAvailable, initDb, DATA_DIR, DB_PATH } from './db';
import * as jsonStore from './storeJson';

export { DATA_DIR, DB_PATH };

export type StoredRole =
  | 'admin'
  | 'writer'
  | 'designer'
  | 'translator'
  | 'publisher'
  | 'reader'
  | 'guest';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  role: StoredRole;
  /** @deprecated Мертве поле з часів власного входу поштою (Фаза G1). Лишається на прочитання старих рядків, нові його не записують. */
  passwordHash?: string;
  /** @deprecated Мертве поле з часів власного Google OAuth (Фаза G1). */
  googleId?: string;
  /** UID, виданий Firebase — спосіб впізнати користувача при повторному вході (Фаза G1). */
  firebaseUid?: string;
  avatarUrl?: string;
  disabled?: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface StoredSession {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface UsageRecord {
  id: string;
  timestamp: string;
  userId: string | null;
  userEmail: string;
  role: StoredRole;
  kind: 'image' | 'text' | 'storage' | 'audio';
  engineId: string;
  modelId: string;
  imageSize?: string;
  costUsd: number;
  context?: string;
  bookId?: string;
  success: boolean;
  /** Розмір у байтах — заповнюється лише для kind='storage' (фотоальбом). */
  bytes?: number;
}

export interface StoredCollabInvite {
  id: string;
  bookId: string;
  bookTitle: string;
  inviterUserId: string;
  inviteeEmail: string;
  role: 'designer' | 'publisher' | 'translator';
  token: string;
  status: 'pending' | 'accepted' | 'revoked';
  emailSent: boolean;
  createdAt: string;
  acceptedAt?: string;
  acceptedUserId?: string;
}

/** Файл «ім'я_автора.md» — AI-аналіз авторського стилю (Фаза 1, 1.1). */
export interface StoredUserStyle {
  userId: string;
  contentMd: string;
  autoUseStyle: boolean;
  sourceChars: number;
  createdAt: string;
  updatedAt: string;
}

export type RolePermissionOverrides = Record<string, Record<string, unknown>>;

export interface StoredSubscription {
  userId: string;
  plan: string;
  billingCycle: 'monthly' | 'annual';
  status: 'active' | 'cancelled' | 'pending';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  provider?: 'liqpay' | 'paypal';
  providerRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPayment {
  id: string;
  userId: string;
  provider: 'liqpay' | 'paypal';
  plan: string;
  billingCycle: 'monthly' | 'annual';
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Скільки записів витрат тримати, щоб таблиця не росла без меж. */
const MAX_USAGE_RECORDS = 50000;

// ---------------------------------------------------------------------------
// Перетворення рядків бази у доменні обʼєкти
// ---------------------------------------------------------------------------

interface UserRow {
  id: string; email: string; name: string; role: string;
  password_hash: string | null; google_id: string | null; firebase_uid: string | null;
  avatar_url: string | null;
  disabled: number; created_at: string; last_login_at: string | null;
}

function rowToUser(row: UserRow): StoredUser {
  const user: StoredUser = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as StoredRole,
    disabled: row.disabled === 1,
    createdAt: row.created_at,
  };
  if (row.password_hash) user.passwordHash = row.password_hash;
  if (row.google_id) user.googleId = row.google_id;
  if (row.firebase_uid) user.firebaseUid = row.firebase_uid;
  if (row.avatar_url) user.avatarUrl = row.avatar_url;
  if (row.last_login_at) user.lastLoginAt = row.last_login_at;
  return user;
}

interface UsageRow {
  id: string; timestamp: string; user_id: string | null; user_email: string; role: string;
  kind: string; engine_id: string; model_id: string; image_size: string | null;
  cost_usd: number; context: string | null; book_id: string | null; success: number;
  bytes: number | null;
}

function rowToUsage(row: UsageRow): UsageRecord {
  const record: UsageRecord = {
    id: row.id,
    timestamp: row.timestamp,
    userId: row.user_id,
    userEmail: row.user_email,
    role: row.role as StoredRole,
    kind: row.kind as 'image' | 'text' | 'storage' | 'audio',
    engineId: row.engine_id,
    modelId: row.model_id,
    costUsd: row.cost_usd,
    success: row.success === 1,
  };
  if (row.image_size) record.imageSize = row.image_size;
  if (row.context) record.context = row.context;
  if (row.book_id) record.bookId = row.book_id;
  if (row.bytes != null) record.bytes = row.bytes;
  return record;
}

// ---------------------------------------------------------------------------
// Одноразова міграція з JSON-файлів
// ---------------------------------------------------------------------------

let migrationChecked = false;

function migrateJsonIfNeeded(): void {
  if (migrationChecked) return;
  migrationChecked = true;

  const database = getDb();
  if (!database) return;

  // Мігруємо лише в порожню базу, щоб не дублювати дані при перезапусках.
  const existing = database.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  const marker = path.join(DATA_DIR, '.migrated-to-sqlite');
  if (existing.n > 0 || fs.existsSync(marker)) return;

  const readJson = <T>(name: string, fallback: T): T => {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')) as T;
    } catch {
      return fallback;
    }
  };

  const users = readJson<StoredUser[]>('users.json', []);
  const sessions = readJson<StoredSession[]>('sessions.json', []);
  const usage = readJson<UsageRecord[]>('usage.json', []);
  const overrides = readJson<RolePermissionOverrides>('role-overrides.json', {});

  if (users.length === 0 && sessions.length === 0 && usage.length === 0) {
    try {
      fs.writeFileSync(marker, new Date().toISOString());
    } catch {
      /* не критично */
    }
    return;
  }

  console.log(
    `[db] Переносимо дані з JSON у SQLite: користувачів ${users.length}, сесій ${sessions.length}, записів витрат ${usage.length}`
  );

  for (const u of users) insertUserRow(u);
  for (const s of sessions) insertSessionRow(s);
  for (const r of usage) insertUsageRow(r);
  for (const [role, perms] of Object.entries(overrides)) writeRoleOverride(role, perms);

  try {
    fs.writeFileSync(marker, new Date().toISOString());
  } catch {
    /* не критично */
  }
  console.log('[db] Міграцію завершено. Вихідні JSON-файли залишено як резервну копію.');
}

/** Готує сховище: відкриває базу і за потреби переносить старі JSON-дані. */
export async function initStore(): Promise<{ backend: 'sqlite' | 'json'; path: string }> {
  await initDb();
  if (isAvailable()) {
    migrateJsonIfNeeded();
    return { backend: 'sqlite', path: DB_PATH };
  }
  return { backend: 'json', path: DATA_DIR };
}

function useJson(): boolean {
  return !isAvailable();
}

// ---------------------------------------------------------------------------
// Внутрішні записи в SQLite
// ---------------------------------------------------------------------------

function insertUserRow(user: StoredUser): void {
  getDb()!
    .prepare(
      `INSERT INTO users (id, email, name, role, password_hash, google_id, firebase_uid, avatar_url, disabled, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email, name = excluded.name, role = excluded.role,
         password_hash = excluded.password_hash, google_id = excluded.google_id,
         firebase_uid = excluded.firebase_uid,
         avatar_url = excluded.avatar_url, disabled = excluded.disabled,
         last_login_at = excluded.last_login_at`
    )
    .run(
      user.id,
      user.email,
      user.name,
      user.role,
      user.passwordHash ?? null,
      user.googleId ?? null,
      user.firebaseUid ?? null,
      user.avatarUrl ?? null,
      user.disabled ? 1 : 0,
      user.createdAt,
      user.lastLoginAt ?? null
    );
}

function insertSessionRow(session: StoredSession): void {
  getDb()!
    .prepare(
      `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET expires_at = excluded.expires_at`
    )
    .run(session.token, session.userId, session.createdAt, session.expiresAt);
}

function insertUsageRow(record: UsageRecord): void {
  getDb()!
    .prepare(
      `INSERT INTO usage_log (id, timestamp, user_id, user_email, role, kind, engine_id, model_id, image_size, cost_usd, context, book_id, success, bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(
      record.id,
      record.timestamp,
      record.userId,
      record.userEmail,
      record.role,
      record.kind,
      record.engineId,
      record.modelId,
      record.imageSize ?? null,
      record.costUsd,
      record.context ?? null,
      record.bookId ?? null,
      record.success ? 1 : 0,
      record.bytes ?? null
    );
}

function writeRoleOverride(role: string, permissions: Record<string, unknown>): void {
  getDb()!
    .prepare(
      `INSERT INTO role_overrides (role, permissions) VALUES (?, ?)
       ON CONFLICT(role) DO UPDATE SET permissions = excluded.permissions`
    )
    .run(role, JSON.stringify(permissions));
}

// ---------------------------------------------------------------------------
// Користувачі
// ---------------------------------------------------------------------------

export async function listUsers(): Promise<StoredUser[]> {
  if (useJson()) return jsonStore.listUsers();
  const rows = getDb()!.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[];
  return rows.map(rowToUser);
}

export async function findUserByEmail(email: string): Promise<StoredUser | undefined> {
  if (useJson()) return jsonStore.findUserByEmail(email);
  const row = getDb()!
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    .get(email.trim()) as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export async function findUserById(id: string): Promise<StoredUser | undefined> {
  if (useJson()) return jsonStore.findUserById(id);
  const row = getDb()!.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export async function findUserByFirebaseUid(firebaseUid: string): Promise<StoredUser | undefined> {
  if (useJson()) return jsonStore.findUserByFirebaseUid(firebaseUid);
  const row = getDb()!
    .prepare('SELECT * FROM users WHERE firebase_uid = ?')
    .get(firebaseUid) as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export async function saveUser(user: StoredUser): Promise<StoredUser> {
  if (useJson()) return jsonStore.saveUser(user as jsonStore.StoredUser) as Promise<StoredUser>;
  insertUserRow(user);
  return user;
}

export async function deleteUser(id: string): Promise<boolean> {
  if (useJson()) return jsonStore.deleteUser(id);
  const db = getDb()!;
  const before = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(id) as { n: number }).n;
  if (before === 0) return false;
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return true;
}

// ---------------------------------------------------------------------------
// Сесії
// ---------------------------------------------------------------------------

export async function createSession(session: StoredSession): Promise<void> {
  if (useJson()) return jsonStore.createSession(session);
  insertSessionRow(session);
}

export async function findSession(token: string): Promise<StoredSession | undefined> {
  if (useJson()) return jsonStore.findSession(token);
  const row = getDb()!.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as
    | { token: string; user_id: string; created_at: string; expires_at: string }
    | undefined;
  if (!row) return undefined;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await deleteSession(token);
    return undefined;
  }
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function deleteSession(token: string): Promise<void> {
  if (useJson()) return jsonStore.deleteSession(token);
  getDb()!.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  if (useJson()) return jsonStore.deleteSessionsForUser(userId);
  getDb()!.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export async function purgeExpiredSessions(): Promise<number> {
  if (useJson()) return jsonStore.purgeExpiredSessions();
  const db = getDb()!;
  const now = new Date().toISOString();
  const before = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  const after = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  return before - after;
}

// ---------------------------------------------------------------------------
// Журнал витрат
// ---------------------------------------------------------------------------

export async function recordUsage(record: UsageRecord): Promise<void> {
  if (useJson()) return jsonStore.recordUsage(record);
  const db = getDb()!;
  insertUsageRow(record);

  // Обрізаємо найстаріші записи, коли таблиця переростає ліміт.
  const total = (db.prepare('SELECT COUNT(*) AS n FROM usage_log').get() as { n: number }).n;
  if (total > MAX_USAGE_RECORDS) {
    db.prepare(
      `DELETE FROM usage_log WHERE id IN (
         SELECT id FROM usage_log ORDER BY timestamp ASC LIMIT ?
       )`
    ).run(total - MAX_USAGE_RECORDS);
  }
}

export async function listUsage(): Promise<UsageRecord[]> {
  if (useJson()) return jsonStore.listUsage();
  const rows = getDb()!
    .prepare('SELECT * FROM usage_log ORDER BY timestamp ASC')
    .all() as UsageRow[];
  return rows.map(rowToUsage);
}

/**
 * Витрати за період — рахуються запитом до бази, а не читанням усього
 * журналу в памʼять. Саме заради цього й потрібна була база.
 */
export async function listUsageSince(sinceIso: string): Promise<UsageRecord[]> {
  if (useJson()) {
    const all = await jsonStore.listUsage();
    return all.filter((r) => r.timestamp >= sinceIso);
  }
  const rows = getDb()!
    .prepare('SELECT * FROM usage_log WHERE timestamp >= ? ORDER BY timestamp ASC')
    .all(sinceIso) as UsageRow[];
  return rows.map(rowToUsage);
}

/**
 * Скільки байтів фотоальбому вже завантажив користувач — за весь час,
 * сумарно для всіх його книг (не за період, на відміну від imageQuota).
 */
export async function totalStorageBytesForUser(userId: string): Promise<number> {
  if (useJson()) {
    const all = await jsonStore.listUsage();
    return all
      .filter((r) => r.userId === userId && r.kind === 'storage' && r.success)
      .reduce((sum, r) => sum + (r.bytes || 0), 0);
  }
  const row = getDb()!
    .prepare(
      `SELECT COALESCE(SUM(bytes), 0) AS total FROM usage_log WHERE user_id = ? AND kind = 'storage' AND success = 1`
    )
    .get(userId) as { total: number };
  return row.total;
}

/** Загальна сума за весь час — одним агрегатом замість вивантаження таблиці. */
export async function totalSpendUsd(): Promise<number> {
  if (useJson()) {
    const all = await jsonStore.listUsage();
    return all.filter((r) => r.success).reduce((sum, r) => sum + r.costUsd, 0);
  }
  const row = getDb()!
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_log WHERE success = 1')
    .get() as { total: number };
  return row.total;
}

/** Витрати кожного користувача — теж агрегатом на боці бази. */
export async function spendByUser(): Promise<Map<string, { count: number; costUsd: number }>> {
  const result = new Map<string, { count: number; costUsd: number }>();
  if (useJson()) {
    for (const r of await jsonStore.listUsage()) {
      if (!r.userId || !r.success) continue;
      const row = result.get(r.userId) || { count: 0, costUsd: 0 };
      row.count += 1;
      row.costUsd += r.costUsd;
      result.set(r.userId, row);
    }
    return result;
  }
  const rows = getDb()!
    .prepare(
      `SELECT user_id, COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS total
       FROM usage_log WHERE success = 1 AND user_id IS NOT NULL GROUP BY user_id`
    )
    .all() as { user_id: string; n: number; total: number }[];
  for (const row of rows) result.set(row.user_id, { count: row.n, costUsd: row.total });
  return result;
}

export async function clearUsage(): Promise<void> {
  if (useJson()) return jsonStore.clearUsage();
  getDb()!.prepare('DELETE FROM usage_log').run();
}

// ---------------------------------------------------------------------------
// Перевизначення дозволів ролей
// ---------------------------------------------------------------------------

export async function getRoleOverrides(): Promise<RolePermissionOverrides> {
  if (useJson()) return jsonStore.getRoleOverrides();
  const rows = getDb()!.prepare('SELECT role, permissions FROM role_overrides').all() as {
    role: string;
    permissions: string;
  }[];
  const out: RolePermissionOverrides = {};
  for (const row of rows) {
    try {
      out[row.role] = JSON.parse(row.permissions);
    } catch {
      out[row.role] = {};
    }
  }
  return out;
}

export async function setRoleOverride(
  role: string,
  permissions: Record<string, unknown>
): Promise<void> {
  if (useJson()) return jsonStore.setRoleOverride(role, permissions);
  const current = (await getRoleOverrides())[role] || {};
  writeRoleOverride(role, { ...current, ...permissions });
}

export async function resetRoleOverrides(role?: string): Promise<void> {
  if (useJson()) return jsonStore.resetRoleOverrides(role);
  const db = getDb()!;
  if (role) db.prepare('DELETE FROM role_overrides WHERE role = ?').run(role);
  else db.prepare('DELETE FROM role_overrides').run();
}

// ---------------------------------------------------------------------------
// Підписки та оплати
// ---------------------------------------------------------------------------

interface SubscriptionRow {
  user_id: string; plan: string; billing_cycle: string; status: string;
  current_period_start: string | null; current_period_end: string | null;
  provider: string | null; provider_ref: string | null;
  created_at: string; updated_at: string;
}

function rowToSubscription(row: SubscriptionRow): StoredSubscription {
  return {
    userId: row.user_id,
    plan: row.plan,
    billingCycle: row.billing_cycle as 'monthly' | 'annual',
    status: row.status as StoredSubscription['status'],
    currentPeriodStart: row.current_period_start || row.created_at,
    currentPeriodEnd: row.current_period_end || row.created_at,
    provider: (row.provider as StoredSubscription['provider']) || undefined,
    providerRef: row.provider_ref || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertSubscriptionRow(sub: StoredSubscription): void {
  getDb()!
    .prepare(
      `INSERT INTO subscriptions (user_id, plan, billing_cycle, status, current_period_start, current_period_end, provider, provider_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         plan = excluded.plan, billing_cycle = excluded.billing_cycle, status = excluded.status,
         current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
         provider = excluded.provider, provider_ref = excluded.provider_ref, updated_at = excluded.updated_at`
    )
    .run(
      sub.userId,
      sub.plan,
      sub.billingCycle,
      sub.status,
      sub.currentPeriodStart,
      sub.currentPeriodEnd,
      sub.provider ?? null,
      sub.providerRef ?? null,
      sub.createdAt,
      sub.updatedAt
    );
}

export async function getSubscription(userId: string): Promise<StoredSubscription | undefined> {
  if (useJson()) return jsonStore.getSubscription(userId);
  const row = getDb()!
    .prepare('SELECT * FROM subscriptions WHERE user_id = ?')
    .get(userId) as SubscriptionRow | undefined;
  return row ? rowToSubscription(row) : undefined;
}

export async function upsertSubscription(sub: StoredSubscription): Promise<StoredSubscription> {
  if (useJson()) return jsonStore.upsertSubscription(sub as jsonStore.StoredSubscription) as Promise<StoredSubscription>;
  insertSubscriptionRow(sub);
  return sub;
}

interface PaymentRow {
  id: string; user_id: string; provider: string; plan: string; billing_cycle: string;
  amount: number; currency: string; status: string; external_id: string | null;
  created_at: string; updated_at: string;
}

function rowToPayment(row: PaymentRow): StoredPayment {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider as StoredPayment['provider'],
    plan: row.plan,
    billingCycle: row.billing_cycle as 'monthly' | 'annual',
    amount: row.amount,
    currency: row.currency,
    status: row.status as StoredPayment['status'],
    externalId: row.external_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function recordPayment(payment: StoredPayment): Promise<void> {
  if (useJson()) return jsonStore.recordPayment(payment as jsonStore.StoredPayment);
  getDb()!
    .prepare(
      `INSERT INTO payments (id, user_id, provider, plan, billing_cycle, amount, currency, status, external_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(
      payment.id,
      payment.userId,
      payment.provider,
      payment.plan,
      payment.billingCycle,
      payment.amount,
      payment.currency,
      payment.status,
      payment.externalId ?? null,
      payment.createdAt,
      payment.updatedAt
    );
}

export async function updatePaymentStatus(
  id: string,
  status: StoredPayment['status'],
  externalId?: string
): Promise<StoredPayment | undefined> {
  if (useJson()) return jsonStore.updatePaymentStatus(id, status, externalId);
  const db = getDb()!;
  const updatedAt = new Date().toISOString();
  db.prepare('UPDATE payments SET status = ?, updated_at = ?, external_id = COALESCE(?, external_id) WHERE id = ?')
    .run(status, updatedAt, externalId ?? null, id);
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as PaymentRow | undefined;
  return row ? rowToPayment(row) : undefined;
}

export async function findPaymentByExternalId(externalId: string): Promise<StoredPayment | undefined> {
  if (useJson()) return jsonStore.findPaymentByExternalId(externalId);
  const row = getDb()!
    .prepare('SELECT * FROM payments WHERE external_id = ?')
    .get(externalId) as PaymentRow | undefined;
  return row ? rowToPayment(row) : undefined;
}

export async function listPaymentsForUser(userId: string): Promise<StoredPayment[]> {
  if (useJson()) return jsonStore.listPaymentsForUser(userId);
  const rows = getDb()!
    .prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as PaymentRow[];
  return rows.map(rowToPayment);
}

/** Усі платежі з певної дати — для графіків доходу в адмінці (server/adminRoutes.ts). */
export async function listPaymentsSince(sinceIso: string): Promise<StoredPayment[]> {
  if (useJson()) return jsonStore.listPaymentsSince(sinceIso);
  const rows = getDb()!
    .prepare('SELECT * FROM payments WHERE created_at >= ? ORDER BY created_at ASC')
    .all(sinceIso) as PaymentRow[];
  return rows.map(rowToPayment);
}

/** Активні підписки всіх користувачів — MRR і розподіл по планах. */
export async function listActiveSubscriptions(): Promise<StoredSubscription[]> {
  if (useJson()) return jsonStore.listActiveSubscriptions();
  const rows = getDb()!
    .prepare("SELECT * FROM subscriptions WHERE status = 'active'")
    .all() as SubscriptionRow[];
  return rows.map(rowToSubscription);
}

// ---------------------------------------------------------------------------
// Cowork-запрошення (дизайнер/видавець/перекладач до конкретної книги)
// ---------------------------------------------------------------------------

interface InviteRow {
  id: string; book_id: string; book_title: string; inviter_user_id: string;
  invitee_email: string; role: string; token: string; status: string;
  email_sent: number; created_at: string; accepted_at: string | null; accepted_user_id: string | null;
}

function rowToInvite(row: InviteRow): StoredCollabInvite {
  const invite: StoredCollabInvite = {
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    inviterUserId: row.inviter_user_id,
    inviteeEmail: row.invitee_email,
    role: row.role as StoredCollabInvite['role'],
    token: row.token,
    status: row.status as StoredCollabInvite['status'],
    emailSent: row.email_sent === 1,
    createdAt: row.created_at,
  };
  if (row.accepted_at) invite.acceptedAt = row.accepted_at;
  if (row.accepted_user_id) invite.acceptedUserId = row.accepted_user_id;
  return invite;
}

function insertInviteRow(invite: StoredCollabInvite): void {
  getDb()!
    .prepare(
      `INSERT INTO book_collab_invites (id, book_id, book_title, inviter_user_id, invitee_email, role, token, status, email_sent, created_at, accepted_at, accepted_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status, email_sent = excluded.email_sent,
         accepted_at = excluded.accepted_at, accepted_user_id = excluded.accepted_user_id`
    )
    .run(
      invite.id,
      invite.bookId,
      invite.bookTitle,
      invite.inviterUserId,
      invite.inviteeEmail,
      invite.role,
      invite.token,
      invite.status,
      invite.emailSent ? 1 : 0,
      invite.createdAt,
      invite.acceptedAt ?? null,
      invite.acceptedUserId ?? null
    );
}

export async function createCollabInvite(invite: StoredCollabInvite): Promise<StoredCollabInvite> {
  if (useJson()) return jsonStore.createCollabInvite(invite as jsonStore.StoredCollabInvite) as Promise<StoredCollabInvite>;
  insertInviteRow(invite);
  return invite;
}

export async function findCollabInviteByToken(token: string): Promise<StoredCollabInvite | undefined> {
  if (useJson()) return jsonStore.findCollabInviteByToken(token);
  const row = getDb()!.prepare('SELECT * FROM book_collab_invites WHERE token = ?').get(token) as InviteRow | undefined;
  return row ? rowToInvite(row) : undefined;
}

export async function findCollabInviteById(id: string): Promise<StoredCollabInvite | undefined> {
  if (useJson()) return jsonStore.findCollabInviteById(id);
  const row = getDb()!.prepare('SELECT * FROM book_collab_invites WHERE id = ?').get(id) as InviteRow | undefined;
  return row ? rowToInvite(row) : undefined;
}

export async function listCollabInvitesForBook(bookId: string): Promise<StoredCollabInvite[]> {
  if (useJson()) return jsonStore.listCollabInvitesForBook(bookId);
  const rows = getDb()!
    .prepare('SELECT * FROM book_collab_invites WHERE book_id = ? ORDER BY created_at DESC')
    .all(bookId) as InviteRow[];
  return rows.map(rowToInvite);
}

export async function updateCollabInvite(
  id: string,
  patch: Partial<StoredCollabInvite>
): Promise<StoredCollabInvite | undefined> {
  if (useJson()) return jsonStore.updateCollabInvite(id, patch);
  const db = getDb()!;
  const row = db.prepare('SELECT * FROM book_collab_invites WHERE id = ?').get(id) as InviteRow | undefined;
  if (!row) return undefined;
  const current = rowToInvite(row);
  const updated = { ...current, ...patch };
  insertInviteRow(updated);
  return updated;
}

interface BookOwnerRow {
  book_id: string;
  owner_user_id: string;
  created_at: string;
}

export async function getBookOwner(bookId: string): Promise<{ bookId: string; ownerUserId: string; createdAt: string } | undefined> {
  if (useJson()) {
    const owner = await jsonStore.getBookOwner(bookId);
    return owner ? { bookId: owner.bookId, ownerUserId: owner.ownerUserId, createdAt: owner.createdAt } : undefined;
  }
  const row = getDb()!.prepare('SELECT * FROM book_collab_owners WHERE book_id = ?').get(bookId) as BookOwnerRow | undefined;
  return row ? { bookId: row.book_id, ownerUserId: row.owner_user_id, createdAt: row.created_at } : undefined;
}

/** Ідемпотентно закріплює власника книги за першим, хто торкнувся cowork для цього bookId. */
export async function setBookOwnerIfAbsent(
  bookId: string,
  ownerUserId: string
): Promise<{ bookId: string; ownerUserId: string; createdAt: string }> {
  if (useJson()) {
    const owner = await jsonStore.setBookOwnerIfAbsent(bookId, ownerUserId);
    return { bookId: owner.bookId, ownerUserId: owner.ownerUserId, createdAt: owner.createdAt };
  }
  const db = getDb()!;
  const existing = db.prepare('SELECT * FROM book_collab_owners WHERE book_id = ?').get(bookId) as BookOwnerRow | undefined;
  if (existing) return { bookId: existing.book_id, ownerUserId: existing.owner_user_id, createdAt: existing.created_at };
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO book_collab_owners (book_id, owner_user_id, created_at) VALUES (?, ?, ?)').run(
    bookId,
    ownerUserId,
    createdAt
  );
  return { bookId, ownerUserId, createdAt };
}

// ---------------------------------------------------------------------------
// Файл стилю автора («ім'я_автора.md») — Фаза 1, 1.1
// ---------------------------------------------------------------------------

interface UserStyleRow {
  user_id: string;
  content_md: string;
  auto_use_style: number;
  source_chars: number;
  created_at: string;
  updated_at: string;
}

function rowToUserStyle(row: UserStyleRow): StoredUserStyle {
  return {
    userId: row.user_id,
    contentMd: row.content_md,
    autoUseStyle: row.auto_use_style === 1,
    sourceChars: row.source_chars,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getUserStyle(userId: string): Promise<StoredUserStyle | undefined> {
  if (useJson()) return jsonStore.getUserStyle(userId);
  const row = getDb()!.prepare('SELECT * FROM user_styles WHERE user_id = ?').get(userId) as UserStyleRow | undefined;
  return row ? rowToUserStyle(row) : undefined;
}

export async function upsertUserStyle(style: StoredUserStyle): Promise<StoredUserStyle> {
  if (useJson()) return jsonStore.upsertUserStyle(style as jsonStore.StoredUserStyle);
  getDb()!
    .prepare(
      `INSERT INTO user_styles (user_id, content_md, auto_use_style, source_chars, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         content_md = excluded.content_md, auto_use_style = excluded.auto_use_style,
         source_chars = excluded.source_chars, updated_at = excluded.updated_at`
    )
    .run(style.userId, style.contentMd, style.autoUseStyle ? 1 : 0, style.sourceChars, style.createdAt, style.updatedAt);
  return style;
}

export async function deleteUserStyle(userId: string): Promise<boolean> {
  if (useJson()) return jsonStore.deleteUserStyle(userId);
  const result = getDb()!.prepare('DELETE FROM user_styles WHERE user_id = ?').run(userId) as unknown as { changes?: number };
  return (result?.changes || 0) > 0;
}

// ---------------------------------------------------------------------------
// Шаблони промтів («Конструктор промтів»)
//
// Два шари в різних місцях і це навмисно: авторський — рядок на
// користувача в user_prompt_templates, адмінський — ОДИН запис у `meta`,
// бо він один на всю систему. Обидва зберігаються як JSON-рядок: набір
// шаблонів завжди читається й пишеться цілком (server/promptTemplates.ts).
// ---------------------------------------------------------------------------

export async function getUserPromptTemplates(userId: string): Promise<string | undefined> {
  if (useJson()) return jsonStore.getUserPromptTemplates(userId);
  const row = getDb()!
    .prepare('SELECT templates FROM user_prompt_templates WHERE user_id = ?')
    .get(userId) as { templates: string } | undefined;
  return row?.templates;
}

export async function upsertUserPromptTemplates(userId: string, templates: string): Promise<void> {
  if (useJson()) return jsonStore.upsertUserPromptTemplates(userId, templates);
  getDb()!
    .prepare(
      `INSERT INTO user_prompt_templates (user_id, templates, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET templates = excluded.templates, updated_at = excluded.updated_at`
    )
    .run(userId, templates, new Date().toISOString());
}

/** Прибирає ВЕСЬ авторський шар — саме це робить кнопка «Відновити налаштування адміна». */
export async function deleteUserPromptTemplates(userId: string): Promise<boolean> {
  if (useJson()) return jsonStore.deleteUserPromptTemplates(userId);
  const result = getDb()!
    .prepare('DELETE FROM user_prompt_templates WHERE user_id = ?')
    .run(userId) as unknown as { changes?: number };
  return (result?.changes || 0) > 0;
}

export async function getAppSetting(key: string): Promise<string | undefined> {
  if (useJson()) return jsonStore.getAppSetting(key);
  const row = getDb()!.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  if (useJson()) return jsonStore.setAppSetting(key, value);
  getDb()!
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// ---------------------------------------------------------------------------
// Чат-сесії AI-асистента письменника
// ---------------------------------------------------------------------------

export interface StoredChatSession {
  id: string;
  userId: string;
  title: string;
  bookId?: string;
  modelId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

interface ChatSessionRow {
  id: string;
  user_id: string;
  title: string;
  book_id: string | null;
  model_id: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

function rowToChatSession(row: ChatSessionRow): StoredChatSession {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    bookId: row.book_id || undefined,
    modelId: row.model_id,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCostUsd: row.total_cost_usd,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToChatMessage(row: ChatMessageRow): StoredChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}

export async function createChatSession(session: StoredChatSession): Promise<StoredChatSession> {
  if (useJson()) return jsonStore.createChatSession(session as jsonStore.StoredChatSession);
  getDb()!
    .prepare(
      `INSERT INTO chat_sessions (id, user_id, title, book_id, model_id, total_input_tokens,
         total_output_tokens, total_cost_usd, message_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      session.id,
      session.userId,
      session.title,
      session.bookId ?? null,
      session.modelId,
      session.totalInputTokens,
      session.totalOutputTokens,
      session.totalCostUsd,
      session.messageCount,
      session.createdAt,
      session.updatedAt
    );
  return session;
}

export async function getChatSession(id: string): Promise<StoredChatSession | undefined> {
  if (useJson()) return jsonStore.getChatSession(id);
  const row = getDb()!.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as ChatSessionRow | undefined;
  return row ? rowToChatSession(row) : undefined;
}

export async function listChatSessions(userId: string): Promise<StoredChatSession[]> {
  if (useJson()) return jsonStore.listChatSessions(userId);
  const rows = getDb()!
    .prepare('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as ChatSessionRow[];
  return rows.map(rowToChatSession);
}

/** Усі сесії всіх користувачів — для адмінської аналітики чату. */
export async function listAllChatSessions(): Promise<StoredChatSession[]> {
  if (useJson()) return jsonStore.listAllChatSessions();
  const rows = getDb()!
    .prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC')
    .all() as ChatSessionRow[];
  return rows.map(rowToChatSession);
}

export async function updateChatSession(session: StoredChatSession): Promise<StoredChatSession> {
  if (useJson()) return jsonStore.updateChatSession(session as jsonStore.StoredChatSession);
  getDb()!
    .prepare(
      `UPDATE chat_sessions SET title = ?, model_id = ?, total_input_tokens = ?, total_output_tokens = ?,
         total_cost_usd = ?, message_count = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      session.title,
      session.modelId,
      session.totalInputTokens,
      session.totalOutputTokens,
      session.totalCostUsd,
      session.messageCount,
      session.updatedAt,
      session.id
    );
  return session;
}

export async function deleteChatSession(id: string): Promise<boolean> {
  if (useJson()) return jsonStore.deleteChatSession(id);
  const db = getDb()!;
  db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id);
  const result = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id) as unknown as { changes?: number };
  return (result?.changes || 0) > 0;
}

export async function addChatMessage(message: StoredChatMessage): Promise<StoredChatMessage> {
  if (useJson()) return jsonStore.addChatMessage(message as jsonStore.StoredChatMessage);
  getDb()!
    .prepare(
      `INSERT INTO chat_messages (id, session_id, role, content, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.id,
      message.sessionId,
      message.role,
      message.content,
      message.inputTokens,
      message.outputTokens,
      message.costUsd,
      message.createdAt
    );
  return message;
}

export async function listChatMessages(sessionId: string): Promise<StoredChatMessage[]> {
  if (useJson()) return jsonStore.listChatMessages(sessionId);
  const rows = getDb()!
    .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as ChatMessageRow[];
  return rows.map(rowToChatMessage);
}

/** Усі репліки всіх сесій — для адмінської аналітики токенів/витрат чату. */
export async function listAllChatMessages(): Promise<StoredChatMessage[]> {
  if (useJson()) return jsonStore.listAllChatMessages();
  const rows = getDb()!
    .prepare('SELECT * FROM chat_messages ORDER BY created_at ASC')
    .all() as ChatMessageRow[];
  return rows.map(rowToChatMessage);
}

// ---------------------------------------------------------------------------
// Власні ключі API користувача (Pro/Ultra override для чат-сесій)
// ---------------------------------------------------------------------------

export interface StoredUserApiKey {
  userId: string;
  engine: string;
  encryptedKey: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

interface UserApiKeyRow {
  user_id: string;
  engine: string;
  encrypted_key: string;
  fingerprint: string;
  created_at: string;
  updated_at: string;
}

function rowToUserApiKey(row: UserApiKeyRow): StoredUserApiKey {
  return {
    userId: row.user_id,
    engine: row.engine,
    encryptedKey: row.encrypted_key,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertUserApiKey(key: StoredUserApiKey): Promise<StoredUserApiKey> {
  if (useJson()) return jsonStore.upsertUserApiKey(key as jsonStore.StoredUserApiKey);
  getDb()!
    .prepare(
      `INSERT INTO user_api_keys (user_id, engine, encrypted_key, fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, engine) DO UPDATE SET
         encrypted_key = excluded.encrypted_key, fingerprint = excluded.fingerprint,
         updated_at = excluded.updated_at`
    )
    .run(key.userId, key.engine, key.encryptedKey, key.fingerprint, key.createdAt, key.updatedAt);
  return key;
}

export async function getUserApiKey(userId: string, engine: string): Promise<StoredUserApiKey | undefined> {
  if (useJson()) return jsonStore.getUserApiKey(userId, engine);
  const row = getDb()!
    .prepare('SELECT * FROM user_api_keys WHERE user_id = ? AND engine = ?')
    .get(userId, engine) as UserApiKeyRow | undefined;
  return row ? rowToUserApiKey(row) : undefined;
}

export async function listUserApiKeys(userId: string): Promise<StoredUserApiKey[]> {
  if (useJson()) return jsonStore.listUserApiKeys(userId);
  const rows = getDb()!
    .prepare('SELECT * FROM user_api_keys WHERE user_id = ?')
    .all(userId) as UserApiKeyRow[];
  return rows.map(rowToUserApiKey);
}

export async function deleteUserApiKey(userId: string, engine: string): Promise<boolean> {
  if (useJson()) return jsonStore.deleteUserApiKey(userId, engine);
  const result = getDb()!
    .prepare('DELETE FROM user_api_keys WHERE user_id = ? AND engine = ?')
    .run(userId, engine) as unknown as { changes?: number };
  return (result?.changes || 0) > 0;
}

/** Лише для тестів. */
export function __resetCacheForTests(): void {
  jsonStore.__resetCacheForTests();
  migrationChecked = false;
}
