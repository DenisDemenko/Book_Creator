/**
 * Файлове сховище — запасний варіант.
 *
 * Основне сховище тепер SQLite (server/db.ts). Цей модуль лишається
 * для середовищ зі старим Node, де вбудований node:sqlite недоступний,
 * і як джерело даних для одноразової міграції в базу.
 *
 * Оригінальний опис:
 *
 * У проєкті поки немає бази даних (див. C-5 в аудиті), тож користувачі,
 * сесії, журнал витрат і перевизначення ролей зберігаються у JSON-файлах.
 * Запис атомарний: спершу у тимчасовий файл, потім rename — щоб падіння
 * посеред збереження не залишило обрізаний файл.
 *
 * Для одного інстансу цього достатньо. При переході на кілька реплік або
 * на ефемерний хостинг (Cloud Run) цей модуль треба замінити на SQLite чи
 * Postgres — інтерфейс навмисно вузький, щоб заміна була локальною.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

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
  /** Відображуване імʼя. */
  name: string;
  role: StoredRole;
  /** @deprecated scrypt-хеш з часів власного входу поштою (Фаза G1). */
  passwordHash?: string;
  /** @deprecated ідентифікатор Google з часів власного OAuth (Фаза G1). */
  googleId?: string;
  /** UID, виданий Firebase — спосіб впізнати користувача при повторному вході (Фаза G1). */
  firebaseUid?: string;
  avatarUrl?: string;
  /** Заблокований адміністратором користувач не може увійти. */
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

/** Один факт звернення до платної моделі (або завантаження у фотоальбом). */
export interface UsageRecord {
  id: string;
  timestamp: string;
  userId: string | null;
  userEmail: string;
  role: StoredRole;
  kind: 'image' | 'text' | 'storage';
  engineId: string;
  modelId: string;
  imageSize?: string;
  /** Розрахункова вартість у доларах США. */
  costUsd: number;
  /** Що саме генерували — для впізнаваності у звіті. */
  context?: string;
  bookId?: string;
  success: boolean;
  /** Розмір у байтах — заповнюється лише для kind='storage' (фотоальбом). */
  bytes?: number;
}

/** Запрошення дизайнера/видавця/перекладача до конкретної книги поштою. */
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

/** book_id -> власник (письменник), який має право запрошувати. */
export interface StoredBookOwner {
  bookId: string;
  ownerUserId: string;
  createdAt: string;
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

/** Чат-сесія AI-асистента письменника (історія в БД замість localStorage). */
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

/** Одна репліка в чат-сесії. Вартість непорожня лише в реплік асистента. */
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

/** Власний ключ API користувача для одного провайдера (override серверного). */
export interface StoredUserApiKey {
  userId: string;
  engine: string;
  encryptedKey: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

/** Часткове перевизначення дозволів ролі, зроблене адміністратором. */
export type RolePermissionOverrides = Record<string, Record<string, unknown>>;

/** Підписка користувача — один запис на userId. */
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

/** Одна спроба оплати — і LiqPay, і PayPal пишуть сюди. */
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

interface StoreShape {
  users: StoredUser[];
  sessions: StoredSession[];
  usage: UsageRecord[];
  roleOverrides: RolePermissionOverrides;
  subscriptions: Record<string, StoredSubscription>;
  payments: StoredPayment[];
  collabInvites: StoredCollabInvite[];
  bookOwners: Record<string, StoredBookOwner>;
  userStyles: Record<string, StoredUserStyle>;
  chatSessions: Record<string, StoredChatSession>;
  chatMessages: StoredChatMessage[];
  /** Ключ запису — `${userId}:${engine}`. */
  userApiKeys: Record<string, StoredUserApiKey>;
  /** Шаблони промтів автора — JSON-рядок на користувача ("Конструктор промтів"). */
  userPromptTemplates: Record<string, string>;
  /** Загальносистемні налаштування «ключ → значення» — дзеркало таблиці meta в SQLite. */
  appSettings: Record<string, string>;
}

const EMPTY: StoreShape = {
  users: [],
  sessions: [],
  usage: [],
  roleOverrides: {},
  subscriptions: {},
  payments: [],
  collabInvites: [],
  bookOwners: {},
  userStyles: {},
  chatSessions: {},
  chatMessages: [],
  userApiKeys: {},
  userPromptTemplates: {},
  appSettings: {},
};

/** Скільки записів витрат тримати (щоб файл не ріс безмежно). */
const MAX_USAGE_RECORDS = 20000;

const FILES: Record<keyof StoreShape, string> = {
  users: 'users.json',
  sessions: 'sessions.json',
  usage: 'usage.json',
  roleOverrides: 'role-overrides.json',
  subscriptions: 'subscriptions.json',
  payments: 'payments.json',
  collabInvites: 'collab-invites.json',
  bookOwners: 'book-owners.json',
  userStyles: 'user-styles.json',
  chatSessions: 'chat-sessions.json',
  chatMessages: 'chat-messages.json',
  userApiKeys: 'user-api-keys.json',
  userPromptTemplates: 'user-prompt-templates.json',
  appSettings: 'app-settings.json',
};

let cache: StoreShape | null = null;
/** Черга записів, щоб паралельні збереження не перетирали одне одного. */
let writeChain: Promise<unknown> = Promise.resolve();

async function readFileSafe<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, name), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeAtomic(name: string, value: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = path.join(DATA_DIR, name);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temp, target);
}

export async function loadStore(): Promise<StoreShape> {
  if (cache) return cache;
  const [users, sessions, usage, roleOverrides, subscriptions, payments, collabInvites, bookOwners, userStyles, chatSessions, chatMessages, userApiKeys, userPromptTemplates, appSettings] = await Promise.all([
    readFileSafe<StoredUser[]>(FILES.users, []),
    readFileSafe<StoredSession[]>(FILES.sessions, []),
    readFileSafe<UsageRecord[]>(FILES.usage, []),
    readFileSafe<RolePermissionOverrides>(FILES.roleOverrides, {}),
    readFileSafe<Record<string, StoredSubscription>>(FILES.subscriptions, {}),
    readFileSafe<StoredPayment[]>(FILES.payments, []),
    readFileSafe<StoredCollabInvite[]>(FILES.collabInvites, []),
    readFileSafe<Record<string, StoredBookOwner>>(FILES.bookOwners, {}),
    readFileSafe<Record<string, StoredUserStyle>>(FILES.userStyles, {}),
    readFileSafe<Record<string, StoredChatSession>>(FILES.chatSessions, {}),
    readFileSafe<StoredChatMessage[]>(FILES.chatMessages, []),
    readFileSafe<Record<string, StoredUserApiKey>>(FILES.userApiKeys, {}),
    readFileSafe<Record<string, string>>(FILES.userPromptTemplates, {}),
    readFileSafe<Record<string, string>>(FILES.appSettings, {}),
  ]);
  cache = { users, sessions, usage, roleOverrides, subscriptions, payments, collabInvites, bookOwners, userStyles, chatSessions, chatMessages, userApiKeys, userPromptTemplates, appSettings };
  return cache;
}

function persist(key: keyof StoreShape): Promise<void> {
  writeChain = writeChain
    .then(() => writeAtomic(FILES[key], (cache as StoreShape)[key]))
    .catch((err) => console.error(`[store] Не вдалося зберегти ${key}:`, err));
  return writeChain as Promise<void>;
}

// ---------------------------------------------------------------------------
// Користувачі
// ---------------------------------------------------------------------------

export async function listUsers(): Promise<StoredUser[]> {
  return (await loadStore()).users;
}

export async function findUserByEmail(email: string): Promise<StoredUser | undefined> {
  const store = await loadStore();
  const needle = email.trim().toLowerCase();
  return store.users.find((u) => u.email.toLowerCase() === needle);
}

export async function findUserById(id: string): Promise<StoredUser | undefined> {
  return (await loadStore()).users.find((u) => u.id === id);
}

export async function findUserByFirebaseUid(firebaseUid: string): Promise<StoredUser | undefined> {
  return (await loadStore()).users.find((u) => u.firebaseUid === firebaseUid);
}

export async function saveUser(user: StoredUser): Promise<StoredUser> {
  const store = await loadStore();
  const index = store.users.findIndex((u) => u.id === user.id);
  if (index === -1) store.users.push(user);
  else store.users[index] = user;
  await persist('users');
  return user;
}

export async function deleteUser(id: string): Promise<boolean> {
  const store = await loadStore();
  const before = store.users.length;
  store.users = store.users.filter((u) => u.id !== id);
  store.sessions = store.sessions.filter((s) => s.userId !== id);
  if (store.users.length === before) return false;
  await persist('users');
  await persist('sessions');
  return true;
}

// ---------------------------------------------------------------------------
// Сесії
// ---------------------------------------------------------------------------

export async function createSession(session: StoredSession): Promise<void> {
  const store = await loadStore();
  store.sessions.push(session);
  await persist('sessions');
}

export async function findSession(token: string): Promise<StoredSession | undefined> {
  const store = await loadStore();
  const session = store.sessions.find((s) => s.token === token);
  if (!session) return undefined;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await deleteSession(token);
    return undefined;
  }
  return session;
}

export async function deleteSession(token: string): Promise<void> {
  const store = await loadStore();
  store.sessions = store.sessions.filter((s) => s.token !== token);
  await persist('sessions');
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  const store = await loadStore();
  store.sessions = store.sessions.filter((s) => s.userId !== userId);
  await persist('sessions');
}

/** Прибирає протухлі сесії — викликається під час старту сервера. */
export async function purgeExpiredSessions(): Promise<number> {
  const store = await loadStore();
  const now = Date.now();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((s) => new Date(s.expiresAt).getTime() >= now);
  const removed = before - store.sessions.length;
  if (removed) await persist('sessions');
  return removed;
}

// ---------------------------------------------------------------------------
// Журнал витрат
// ---------------------------------------------------------------------------

export async function recordUsage(record: UsageRecord): Promise<void> {
  const store = await loadStore();
  store.usage.push(record);
  if (store.usage.length > MAX_USAGE_RECORDS) {
    store.usage = store.usage.slice(-MAX_USAGE_RECORDS);
  }
  await persist('usage');
}

export async function listUsage(): Promise<UsageRecord[]> {
  return (await loadStore()).usage;
}

export async function clearUsage(): Promise<void> {
  const store = await loadStore();
  store.usage = [];
  await persist('usage');
}

// ---------------------------------------------------------------------------
// Перевизначення дозволів ролей
// ---------------------------------------------------------------------------

export async function getRoleOverrides(): Promise<RolePermissionOverrides> {
  return (await loadStore()).roleOverrides;
}

export async function setRoleOverride(
  role: string,
  permissions: Record<string, unknown>
): Promise<void> {
  const store = await loadStore();
  store.roleOverrides[role] = { ...(store.roleOverrides[role] || {}), ...permissions };
  await persist('roleOverrides');
}

export async function resetRoleOverrides(role?: string): Promise<void> {
  const store = await loadStore();
  if (role) delete store.roleOverrides[role];
  else store.roleOverrides = {};
  await persist('roleOverrides');
}

// ---------------------------------------------------------------------------
// Підписки та оплати
// ---------------------------------------------------------------------------

export async function getSubscription(userId: string): Promise<StoredSubscription | undefined> {
  return (await loadStore()).subscriptions[userId];
}

export async function upsertSubscription(sub: StoredSubscription): Promise<StoredSubscription> {
  const store = await loadStore();
  store.subscriptions[sub.userId] = sub;
  await persist('subscriptions');
  return sub;
}

export async function recordPayment(payment: StoredPayment): Promise<void> {
  const store = await loadStore();
  store.payments.push(payment);
  await persist('payments');
}

export async function updatePaymentStatus(
  id: string,
  status: StoredPayment['status'],
  externalId?: string
): Promise<StoredPayment | undefined> {
  const store = await loadStore();
  const record = store.payments.find((p) => p.id === id);
  if (!record) return undefined;
  record.status = status;
  record.updatedAt = new Date().toISOString();
  if (externalId) record.externalId = externalId;
  await persist('payments');
  return record;
}

export async function findPaymentByExternalId(externalId: string): Promise<StoredPayment | undefined> {
  const store = await loadStore();
  return store.payments.find((p) => p.externalId === externalId);
}

export async function listPaymentsForUser(userId: string): Promise<StoredPayment[]> {
  const store = await loadStore();
  return store.payments.filter((p) => p.userId === userId);
}

/** Усі платежі (будь-якого користувача) з певної дати — для бізнес-графіків адмінки. */
export async function listPaymentsSince(sinceIso: string): Promise<StoredPayment[]> {
  const store = await loadStore();
  return store.payments.filter((p) => p.createdAt >= sinceIso);
}

/** Активні підписки всіх користувачів — для MRR та розрізу за планами. */
export async function listActiveSubscriptions(): Promise<StoredSubscription[]> {
  const store = await loadStore();
  return Object.values(store.subscriptions).filter((s) => s.status === 'active');
}

// ---------------------------------------------------------------------------
// Cowork-запрошення (дизайнер/видавець/перекладач до конкретної книги)
// ---------------------------------------------------------------------------

export async function createCollabInvite(invite: StoredCollabInvite): Promise<StoredCollabInvite> {
  const store = await loadStore();
  store.collabInvites.push(invite);
  await persist('collabInvites');
  return invite;
}

export async function findCollabInviteByToken(token: string): Promise<StoredCollabInvite | undefined> {
  const store = await loadStore();
  return store.collabInvites.find((i) => i.token === token);
}

export async function findCollabInviteById(id: string): Promise<StoredCollabInvite | undefined> {
  const store = await loadStore();
  return store.collabInvites.find((i) => i.id === id);
}

export async function listCollabInvitesForBook(bookId: string): Promise<StoredCollabInvite[]> {
  const store = await loadStore();
  return store.collabInvites.filter((i) => i.bookId === bookId);
}

export async function updateCollabInvite(
  id: string,
  patch: Partial<StoredCollabInvite>
): Promise<StoredCollabInvite | undefined> {
  const store = await loadStore();
  const invite = store.collabInvites.find((i) => i.id === id);
  if (!invite) return undefined;
  Object.assign(invite, patch);
  await persist('collabInvites');
  return invite;
}

export async function getBookOwner(bookId: string): Promise<StoredBookOwner | undefined> {
  const store = await loadStore();
  return store.bookOwners[bookId];
}

export async function setBookOwnerIfAbsent(bookId: string, ownerUserId: string): Promise<StoredBookOwner> {
  const store = await loadStore();
  if (!store.bookOwners[bookId]) {
    store.bookOwners[bookId] = { bookId, ownerUserId, createdAt: new Date().toISOString() };
    await persist('bookOwners');
  }
  return store.bookOwners[bookId];
}

// ---------------------------------------------------------------------------
// Файл стилю автора («ім'я_автора.md»)
// ---------------------------------------------------------------------------

export async function getUserStyle(userId: string): Promise<StoredUserStyle | undefined> {
  const store = await loadStore();
  return store.userStyles[userId];
}

export async function upsertUserStyle(style: StoredUserStyle): Promise<StoredUserStyle> {
  const store = await loadStore();
  store.userStyles[style.userId] = style;
  await persist('userStyles');
  return style;
}

export async function deleteUserStyle(userId: string): Promise<boolean> {
  const store = await loadStore();
  const existed = !!store.userStyles[userId];
  delete store.userStyles[userId];
  if (existed) await persist('userStyles');
  return existed;
}

// ---------------------------------------------------------------------------
// Чат-сесії AI-асистента
// ---------------------------------------------------------------------------

export async function createChatSession(session: StoredChatSession): Promise<StoredChatSession> {
  const store = await loadStore();
  store.chatSessions[session.id] = session;
  await persist('chatSessions');
  return session;
}

export async function getChatSession(id: string): Promise<StoredChatSession | undefined> {
  const store = await loadStore();
  return store.chatSessions[id];
}

export async function listChatSessions(userId: string): Promise<StoredChatSession[]> {
  const store = await loadStore();
  return Object.values(store.chatSessions)
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Усі сесії всіх користувачів — для адмінської аналітики чату. */
export async function listAllChatSessions(): Promise<StoredChatSession[]> {
  const store = await loadStore();
  return Object.values(store.chatSessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function updateChatSession(session: StoredChatSession): Promise<StoredChatSession> {
  const store = await loadStore();
  store.chatSessions[session.id] = session;
  await persist('chatSessions');
  return session;
}

export async function deleteChatSession(id: string): Promise<boolean> {
  const store = await loadStore();
  const existed = !!store.chatSessions[id];
  delete store.chatSessions[id];
  const before = store.chatMessages.length;
  store.chatMessages = store.chatMessages.filter((m) => m.sessionId !== id);
  if (existed) await persist('chatSessions');
  if (store.chatMessages.length !== before) await persist('chatMessages');
  return existed;
}

export async function addChatMessage(message: StoredChatMessage): Promise<StoredChatMessage> {
  const store = await loadStore();
  store.chatMessages.push(message);
  await persist('chatMessages');
  return message;
}

export async function listChatMessages(sessionId: string): Promise<StoredChatMessage[]> {
  const store = await loadStore();
  return store.chatMessages
    .filter((m) => m.sessionId === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Усі репліки всіх сесій — для адмінської аналітики токенів/витрат чату. */
export async function listAllChatMessages(): Promise<StoredChatMessage[]> {
  const store = await loadStore();
  return [...store.chatMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ---------------------------------------------------------------------------
// Власні ключі API користувача (Pro/Ultra override для чат-сесій)
// ---------------------------------------------------------------------------

function apiKeyId(userId: string, engine: string): string {
  return `${userId}:${engine}`;
}

export async function upsertUserApiKey(key: StoredUserApiKey): Promise<StoredUserApiKey> {
  const store = await loadStore();
  store.userApiKeys[apiKeyId(key.userId, key.engine)] = key;
  await persist('userApiKeys');
  return key;
}

export async function getUserApiKey(userId: string, engine: string): Promise<StoredUserApiKey | undefined> {
  const store = await loadStore();
  return store.userApiKeys[apiKeyId(userId, engine)];
}

export async function listUserApiKeys(userId: string): Promise<StoredUserApiKey[]> {
  const store = await loadStore();
  return Object.values(store.userApiKeys).filter((k) => k.userId === userId);
}

export async function deleteUserApiKey(userId: string, engine: string): Promise<boolean> {
  const store = await loadStore();
  const id = apiKeyId(userId, engine);
  const existed = !!store.userApiKeys[id];
  delete store.userApiKeys[id];
  if (existed) await persist('userApiKeys');
  return existed;
}

/** Лише для тестів: скидає кеш, щоб перечитати файли з диска. */
export function __resetCacheForTests(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Шаблони промтів і загальносистемні налаштування («Конструктор промтів»)
// ---------------------------------------------------------------------------

export async function getUserPromptTemplates(userId: string): Promise<string | undefined> {
  const store = await loadStore();
  return store.userPromptTemplates[userId];
}

export async function upsertUserPromptTemplates(userId: string, templates: string): Promise<void> {
  const store = await loadStore();
  store.userPromptTemplates[userId] = templates;
  await persist('userPromptTemplates');
}

export async function deleteUserPromptTemplates(userId: string): Promise<boolean> {
  const store = await loadStore();
  const existed = !!store.userPromptTemplates[userId];
  delete store.userPromptTemplates[userId];
  if (existed) await persist('userPromptTemplates');
  return existed;
}

export async function getAppSetting(key: string): Promise<string | undefined> {
  const store = await loadStore();
  return store.appSettings[key];
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const store = await loadStore();
  store.appSettings[key] = value;
  await persist('appSettings');
}
