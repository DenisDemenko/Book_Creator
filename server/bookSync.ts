/**
 * Синхронізація версій книги між двома серверами: оркестрація.
 *
 * Тут немає Express і немає прямого доступу до бази — обидві сторони
 * (`BookSyncSide`) передаються ззовні. Через це весь сценарій (порівняти →
 * вирішити → перенести → перевірити) перевіряється тестом на підставних
 * сторонах. Рішення «що новіше» живе в `bookSyncPlan.ts`.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  planBookSync,
  summarizeBook,
  type BookSyncSummary,
  type PlanOptions,
  type SyncPlan,
} from './bookSyncPlan';

export interface SyncedBook {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  book: Record<string, unknown>;
}

/** Одна зі сторін: «ця Студія» або «віддалена». */
export interface BookSyncSide {
  getBook(id: string): Promise<SyncedBook | null>;
  /** Легкий опис без тексту. Якщо сторона його не вміє, береться з повної книги. */
  getSummary?(id: string): Promise<BookSyncSummary | null>;
  /** Записати книгу. `expectedRevision` — ревізія, яку ми бачили (для нової — undefined). */
  putBook(book: Record<string, unknown>, expectedRevision?: number): Promise<{ revision: number; updatedAt: string }>;
}

/** Хеш останньої узгодженої версії кожної книги (щоб помічати паралельні правки). */
export interface SyncStateStore {
  get(bookId: string): Promise<string | null>;
  set(bookId: string, hash: string): Promise<void>;
}

export class SyncBlockedError extends Error {
  constructor(readonly plan: SyncPlan) {
    super(plan.reason);
    this.name = 'SyncBlockedError';
  }
}

export class SyncVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncVerifyError';
  }
}

async function summaryOf(side: BookSyncSide, id: string): Promise<BookSyncSummary | null> {
  if (side.getSummary) return side.getSummary(id);
  const stored = await side.getBook(id);
  return stored ? summarizeBook(stored) : null;
}

export interface SyncStatus {
  bookId: string;
  local: BookSyncSummary | null;
  remote: BookSyncSummary | null;
  baseHash: string | null;
  plan: SyncPlan;
}

export async function syncStatus(
  local: BookSyncSide,
  remote: BookSyncSide,
  bookId: string,
  state: SyncStateStore,
  options: Pick<PlanOptions, 'skewMs'> = {},
): Promise<SyncStatus> {
  const [l, r, baseHash] = await Promise.all([summaryOf(local, bookId), summaryOf(remote, bookId), state.get(bookId)]);
  return { bookId, local: l, remote: r, baseHash, plan: planBookSync(l, r, { baseHash, skewMs: options.skewMs }) };
}

export interface SyncApplyResult {
  applied: boolean;
  direction: 'pull' | 'push' | null;
  plan: SyncPlan;
  /** Хеш, на якому тепер зійшлися обидві сторони. */
  hash: string | null;
}

/**
 * Виконати синхронізацію.
 *
 * `direction` задають лише явно (наприклад, коли план `blocked`): тоді правило
 * «новіша перемагає» не застосовується, рішення за людиною.
 * Кожен запис перевіряється: після перенесення хеш на приймачі мусить
 * збігатися з хешем джерела, інакше це збій, а не синхронізація.
 */
export async function syncApply(
  local: BookSyncSide,
  remote: BookSyncSide,
  bookId: string,
  state: SyncStateStore,
  options: Pick<PlanOptions, 'skewMs'> & { direction?: 'pull' | 'push' } = {},
): Promise<SyncApplyResult> {
  const status = await syncStatus(local, remote, bookId, state, options);
  const { plan } = status;

  let direction: 'pull' | 'push' | null;
  if (options.direction) {
    direction = options.direction;
  } else if (plan.blocked) {
    throw new SyncBlockedError(plan);
  } else {
    direction = plan.action === 'none' ? null : plan.action;
  }
  if (!direction) {
    if (status.local) await state.set(bookId, status.local.hash);
    return { applied: false, direction: null, plan, hash: status.local?.hash ?? null };
  }

  const from = direction === 'pull' ? remote : local;
  const to = direction === 'pull' ? local : remote;
  const source = await from.getBook(bookId);
  if (!source) throw new SyncVerifyError('Джерело зникло під час синхронізації — спробуйте ще раз.');
  const targetSummary = direction === 'pull' ? status.local : status.remote;

  await to.putBook(source.book, targetSummary ? targetSummary.revision : undefined);

  const sourceHash = summarizeBook(source).hash;
  const after = await summaryOf(to, bookId);
  if (!after || after.hash !== sourceHash) {
    throw new SyncVerifyError('Після перенесення версії не збігаються — синхронізацію не зараховано.');
  }
  await state.set(bookId, sourceHash);
  return { applied: true, direction, plan, hash: sourceHash };
}

// ---------------------------------------------------------------------------
// Доступ між серверами: спільний секрет із оточення
// ---------------------------------------------------------------------------

export interface SyncRemoteConfig {
  baseUrl: string;
  token: string;
}

export interface SyncReceiverConfig {
  token: string;
  /** Єдиний власник, чиї книги дозволено читати й писати цим токеном. */
  ownerId: string;
}

export interface SyncConfig {
  remote: SyncRemoteConfig | null;
  receiver: SyncReceiverConfig | null;
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/**
 * Налаштування з оточення. Без змінних усе вимкнено: ні віддаленої сторони,
 * ні приймача. URL лише https (локальний хост — і http, для тестів).
 */
export function readSyncConfig(env: Record<string, string | undefined>): SyncConfig {
  const token = (env.BOOK_SYNC_TOKEN || '').trim();
  const ownerId = (env.BOOK_SYNC_OWNER_ID || '').trim();
  const rawUrl = (env.BOOK_SYNC_REMOTE_URL || '').trim().replace(/\/+$/, '');

  let remote: SyncRemoteConfig | null = null;
  if (rawUrl && token) {
    let parsed: URL | null = null;
    try { parsed = new URL(rawUrl); } catch { parsed = null; }
    if (parsed && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalHost(parsed.hostname)))) {
      remote = { baseUrl: rawUrl, token };
    }
  }
  const receiver = token && ownerId ? { token, ownerId } : null;
  return { remote, receiver };
}

/** Порівняння токена за сталий час, незалежно від довжини. */
export function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!expected) return false;
  const match = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
  if (!match) return false;
  const a = createHash('sha256').update(match[1].trim()).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Віддалена сторона по HTTP
// ---------------------------------------------------------------------------

export class RemoteSyncError extends Error {
  constructor(message: string, readonly status: number, readonly current?: number) {
    super(message);
    this.name = 'RemoteSyncError';
  }
}

export function createRemoteSide(
  config: SyncRemoteConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): BookSyncSide {
  const call = async (method: string, pathname: string, body?: unknown) => {
    const res = await fetchImpl(`${config.baseUrl}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data: any = await res.json().catch(() => ({}));
    return { res, data };
  };
  const enc = (id: string) => encodeURIComponent(id);

  return {
    async getBook(id) {
      const { res, data } = await call('GET', `/api/sync/books/${enc(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new RemoteSyncError(data?.error || `Віддалений сервер відповів ${res.status}`, res.status);
      return data as SyncedBook;
    },
    async getSummary(id) {
      const { res, data } = await call('GET', `/api/sync/books/${enc(id)}/summary`);
      if (res.status === 404) return null;
      if (!res.ok) throw new RemoteSyncError(data?.error || `Віддалений сервер відповів ${res.status}`, res.status);
      return data as BookSyncSummary;
    },
    async putBook(book, expectedRevision) {
      const id = String((book as any).id || '');
      const { res, data } = await call('PUT', `/api/sync/books/${enc(id)}`, { book, expectedRevision });
      if (res.status === 409) throw new RemoteSyncError(data?.error || 'Книгу змінили на віддаленому сервері.', 409, data?.current);
      if (!res.ok) throw new RemoteSyncError(data?.error || `Віддалений сервер відповів ${res.status}`, res.status);
      return { revision: Number(data.revision), updatedAt: String(data.updatedAt) };
    },
  };
}

// ---------------------------------------------------------------------------
// Стан останньої узгодженої версії: невеликий JSON поруч із даними
// ---------------------------------------------------------------------------

export function createFileSyncState(dir: string): SyncStateStore {
  const file = path.join(dir, 'book-sync-state.json');
  let chain: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<Record<string, { hash: string; at: string }>> => {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      return {};
    }
  };
  return {
    async get(bookId) {
      return (await read())[bookId]?.hash ?? null;
    },
    async set(bookId, hash) {
      const run = chain.then(async () => {
        const all = await read();
        all[bookId] = { hash, at: new Date().toISOString() };
        await fs.mkdir(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
        await fs.rename(tmp, file);
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
