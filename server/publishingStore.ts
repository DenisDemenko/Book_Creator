/**
 * Шар доступу до даних модуля публікації (KDP + Etsy).
 *
 * Чому окремий модуль, а не дописування в server/store.ts: публікація — це
 * закінчена підсистема з власним життєвим циклом (товар → публікація →
 * задача черги), і тримати її поруч із користувачами й підписками означало б
 * ростити файл, який уже перевалив за тисячу рядків. Контракт при цьому той
 * самий, що й у решти проєкту:
 *
 *   • основний бекенд — SQLite (`node:sqlite`, схема в server/db.ts);
 *   • якщо SQLite недоступний, ті самі функції прозоро працюють поверх
 *     JSON-файлів у DATA_DIR — застосунок не має падати лише тому, що
 *     середовище старіше за Node 22.5;
 *   • назовні віддаємо camelCase-об'єкти, SQL не витікає за межі файлу.
 *
 * Єдине місце, де ці два бекенди мають розходитись, — це нічого: усі тести
 * сховища ганяються по тому самому набору перевірок.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb, isAvailable, DATA_DIR } from './db';

// ---------------------------------------------------------------------------
// Типи
// ---------------------------------------------------------------------------

export type ProductType = 'book' | 'course' | 'methodology' | 'bundle';
export type PublicationPlatform = 'kdp' | 'etsy';
export type PublicationStatus =
  | 'not_started'
  | 'files_ready'
  | 'draft'
  | 'published'
  | 'failed';

/** Посилання на елемент бібліотеки автора, який увійшов до товару. */
export interface ProductComponentRef {
  id: string;
  /** workbook | slides | checklist | audio | certificate | manuscript | cover | other */
  kind: string;
  name: string;
  /** Розмір у байтах — потрібен пакувальнику для оцінки ліміту платформи. */
  bytes: number;
  mimeType?: string;
  /** Куди покласти всередині .zip (за замовчуванням — сама назва). */
  zipPath?: string;
}

export interface ProductExportFiles {
  epub?: string;
  pdfPrint?: string;
  docx?: string;
  bundleZip?: string;
}

export interface StoredProduct {
  id: string;
  authorId: string;
  bookId?: string;
  type: ProductType;
  title: string;
  description: string;
  priceUsd: number;
  tags: string[];
  components: ProductComponentRef[];
  exportFiles: ProductExportFiles;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPublication {
  id: string;
  productId: string;
  userId: string;
  platform: PublicationPlatform;
  status: PublicationStatus;
  externalId?: string;
  externalUrl?: string;
  lastSyncedAt?: string;
  errorLog?: string;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type JobStep =
  | 'create_listing'
  | 'upload_images'
  | 'upload_files'
  | 'activate'
  | 'done';

export interface StoredPublicationJob {
  id: string;
  publicationId: string;
  userId: string;
  status: JobStatus;
  step: JobStep;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError?: string;
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StoredEtsyAccount {
  userId: string;
  etsyUserId?: string;
  shopId?: string;
  shopName?: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: string;
  scopes: string;
  connectedAt: string;
  updatedAt: string;
}

export interface StoredOAuthState {
  state: string;
  userId: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: string;
}

export interface StoredResearchSnapshot {
  id: string;
  userId?: string;
  topicKey: string;
  topic: string;
  taxonomyId?: number;
  collectedAt: string;
  listingCount: number;
  totalActive: number;
  avgFavorers: number;
  medianPrice: number;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// JSON-бекенд (fallback)
// ---------------------------------------------------------------------------

interface JsonShape {
  products: StoredProduct[];
  publications: StoredPublication[];
  jobs: StoredPublicationJob[];
  etsyAccounts: Record<string, StoredEtsyAccount>;
  oauthStates: Record<string, StoredOAuthState>;
  research: StoredResearchSnapshot[];
}

const JSON_FILE = 'publishing.json';
const EMPTY: JsonShape = {
  products: [],
  publications: [],
  jobs: [],
  etsyAccounts: {},
  oauthStates: {},
  research: [],
};

let jsonCache: JsonShape | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

async function loadJson(): Promise<JsonShape> {
  if (jsonCache) return jsonCache;
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, JSON_FILE), 'utf8');
    jsonCache = { ...EMPTY, ...(JSON.parse(raw) as Partial<JsonShape>) };
  } catch {
    jsonCache = structuredClone(EMPTY);
  }
  return jsonCache;
}

function persistJson(): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const target = path.join(DATA_DIR, JSON_FILE);
      const temp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(jsonCache, null, 2), 'utf8');
      await fs.rename(temp, target);
    })
    .catch((err) => console.error('[publishingStore] Не вдалося зберегти publishing.json:', err));
  return writeChain as Promise<void>;
}

function useJson(): boolean {
  return !isAvailable();
}

// ---------------------------------------------------------------------------
// Перетворення рядків SQLite → об'єкти
// ---------------------------------------------------------------------------

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface ProductRow {
  id: string; author_id: string; book_id: string | null; type: string; title: string;
  description: string; price_usd: number; tags: string; components: string;
  export_files: string; created_at: string; updated_at: string;
}

function rowToProduct(row: ProductRow): StoredProduct {
  return {
    id: row.id,
    authorId: row.author_id,
    bookId: row.book_id || undefined,
    type: row.type as ProductType,
    title: row.title,
    description: row.description,
    priceUsd: row.price_usd,
    tags: parseJsonField<string[]>(row.tags, []),
    components: parseJsonField<ProductComponentRef[]>(row.components, []),
    exportFiles: parseJsonField<ProductExportFiles>(row.export_files, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface PublicationRow {
  id: string; product_id: string; user_id: string; platform: string; status: string;
  external_id: string | null; external_url: string | null; last_synced_at: string | null;
  error_log: string | null; created_at: string; updated_at: string;
}

function rowToPublication(row: PublicationRow): StoredPublication {
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id,
    platform: row.platform as PublicationPlatform,
    status: row.status as PublicationStatus,
    externalId: row.external_id || undefined,
    externalUrl: row.external_url || undefined,
    lastSyncedAt: row.last_synced_at || undefined,
    errorLog: row.error_log || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface JobRow {
  id: string; publication_id: string; user_id: string; status: string; step: string;
  attempts: number; max_attempts: number; next_attempt_at: string; last_error: string | null;
  payload: string; progress: string; created_at: string; updated_at: string;
}

function rowToJob(row: JobRow): StoredPublicationJob {
  return {
    id: row.id,
    publicationId: row.publication_id,
    userId: row.user_id,
    status: row.status as JobStatus,
    step: row.step as JobStep,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error || undefined,
    payload: parseJsonField<Record<string, unknown>>(row.payload, {}),
    progress: parseJsonField<Record<string, unknown>>(row.progress, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface AccountRow {
  user_id: string; etsy_user_id: string | null; shop_id: string | null; shop_name: string | null;
  access_token_enc: string; refresh_token_enc: string; expires_at: string; scopes: string;
  connected_at: string; updated_at: string;
}

function rowToAccount(row: AccountRow): StoredEtsyAccount {
  return {
    userId: row.user_id,
    etsyUserId: row.etsy_user_id || undefined,
    shopId: row.shop_id || undefined,
    shopName: row.shop_name || undefined,
    accessTokenEnc: row.access_token_enc,
    refreshTokenEnc: row.refresh_token_enc,
    expiresAt: row.expires_at,
    scopes: row.scopes,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

interface ResearchRow {
  id: string; user_id: string | null; topic_key: string; topic: string;
  taxonomy_id: number | null; collected_at: string; listing_count: number;
  total_active: number; avg_favorers: number; median_price: number; payload: string;
}

function rowToResearch(row: ResearchRow): StoredResearchSnapshot {
  return {
    id: row.id,
    userId: row.user_id || undefined,
    topicKey: row.topic_key,
    topic: row.topic,
    taxonomyId: row.taxonomy_id ?? undefined,
    collectedAt: row.collected_at,
    listingCount: row.listing_count,
    totalActive: row.total_active,
    avgFavorers: row.avg_favorers,
    medianPrice: row.median_price,
    payload: parseJsonField<Record<string, unknown>>(row.payload, {}),
  };
}

// ---------------------------------------------------------------------------
// Товари
// ---------------------------------------------------------------------------

export async function saveProduct(product: StoredProduct): Promise<StoredProduct> {
  if (useJson()) {
    const store = await loadJson();
    const idx = store.products.findIndex((p) => p.id === product.id);
    if (idx >= 0) store.products[idx] = product;
    else store.products.push(product);
    await persistJson();
    return product;
  }

  getDb()!
    .prepare(
      `INSERT INTO products (id, author_id, book_id, type, title, description, price_usd, tags, components, export_files, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         book_id = excluded.book_id, type = excluded.type, title = excluded.title,
         description = excluded.description, price_usd = excluded.price_usd,
         tags = excluded.tags, components = excluded.components,
         export_files = excluded.export_files, updated_at = excluded.updated_at`
    )
    .run(
      product.id,
      product.authorId,
      product.bookId ?? null,
      product.type,
      product.title,
      product.description,
      product.priceUsd,
      JSON.stringify(product.tags),
      JSON.stringify(product.components),
      JSON.stringify(product.exportFiles),
      product.createdAt,
      product.updatedAt
    );
  return product;
}

export async function getProduct(id: string): Promise<StoredProduct | undefined> {
  if (useJson()) return (await loadJson()).products.find((p) => p.id === id);
  const row = getDb()!.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
  return row ? rowToProduct(row) : undefined;
}

export async function listProducts(authorId: string): Promise<StoredProduct[]> {
  if (useJson()) {
    return (await loadJson()).products
      .filter((p) => p.authorId === authorId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const rows = getDb()!
    .prepare('SELECT * FROM products WHERE author_id = ? ORDER BY updated_at DESC')
    .all(authorId) as ProductRow[];
  return rows.map(rowToProduct);
}

export async function deleteProduct(id: string): Promise<boolean> {
  if (useJson()) {
    const store = await loadJson();
    const before = store.products.length;
    store.products = store.products.filter((p) => p.id !== id);
    const pubIds = store.publications.filter((p) => p.productId === id).map((p) => p.id);
    store.publications = store.publications.filter((p) => p.productId !== id);
    store.jobs = store.jobs.filter((j) => !pubIds.includes(j.publicationId));
    await persistJson();
    return store.products.length < before;
  }
  // Публікації підчищає ON DELETE CASCADE; задачі черги прибираємо явно,
  // бо вони посилаються на публікацію без зовнішнього ключа (щоб журнал
  // спроб переживав видалення товару, коли це потрібно для розбору збою).
  const pubRows = getDb()!
    .prepare('SELECT id FROM publications WHERE product_id = ?')
    .all(id) as { id: string }[];
  for (const p of pubRows) {
    getDb()!.prepare('DELETE FROM publication_jobs WHERE publication_id = ?').run(p.id);
  }
  const res = getDb()!.prepare('DELETE FROM products WHERE id = ?').run(id) as { changes?: number };
  return (res?.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Публікації
// ---------------------------------------------------------------------------

export async function savePublication(pub: StoredPublication): Promise<StoredPublication> {
  if (useJson()) {
    const store = await loadJson();
    const idx = store.publications.findIndex(
      (p) => p.productId === pub.productId && p.platform === pub.platform
    );
    if (idx >= 0) store.publications[idx] = { ...pub, id: store.publications[idx].id };
    else store.publications.push(pub);
    await persistJson();
    return idx >= 0 ? store.publications[idx] : pub;
  }

  getDb()!
    .prepare(
      `INSERT INTO publications (id, product_id, user_id, platform, status, external_id, external_url, last_synced_at, error_log, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id, platform) DO UPDATE SET
         status = excluded.status, external_id = excluded.external_id,
         external_url = excluded.external_url, last_synced_at = excluded.last_synced_at,
         error_log = excluded.error_log, updated_at = excluded.updated_at`
    )
    .run(
      pub.id,
      pub.productId,
      pub.userId,
      pub.platform,
      pub.status,
      pub.externalId ?? null,
      pub.externalUrl ?? null,
      pub.lastSyncedAt ?? null,
      pub.errorLog ?? null,
      pub.createdAt,
      pub.updatedAt
    );
  return (await getPublicationForProduct(pub.productId, pub.platform)) || pub;
}

export async function getPublicationForProduct(
  productId: string,
  platform: PublicationPlatform
): Promise<StoredPublication | undefined> {
  if (useJson()) {
    return (await loadJson()).publications.find(
      (p) => p.productId === productId && p.platform === platform
    );
  }
  const row = getDb()!
    .prepare('SELECT * FROM publications WHERE product_id = ? AND platform = ?')
    .get(productId, platform) as PublicationRow | undefined;
  return row ? rowToPublication(row) : undefined;
}

export async function getPublication(id: string): Promise<StoredPublication | undefined> {
  if (useJson()) return (await loadJson()).publications.find((p) => p.id === id);
  const row = getDb()!.prepare('SELECT * FROM publications WHERE id = ?').get(id) as
    | PublicationRow
    | undefined;
  return row ? rowToPublication(row) : undefined;
}

export async function listPublicationsForUser(userId: string): Promise<StoredPublication[]> {
  if (useJson()) {
    return (await loadJson()).publications
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const rows = getDb()!
    .prepare('SELECT * FROM publications WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as PublicationRow[];
  return rows.map(rowToPublication);
}

export async function listPublicationsForProduct(productId: string): Promise<StoredPublication[]> {
  if (useJson()) {
    return (await loadJson()).publications.filter((p) => p.productId === productId);
  }
  const rows = getDb()!
    .prepare('SELECT * FROM publications WHERE product_id = ?')
    .all(productId) as PublicationRow[];
  return rows.map(rowToPublication);
}

// ---------------------------------------------------------------------------
// Черга задач публікації
// ---------------------------------------------------------------------------

export async function saveJob(job: StoredPublicationJob): Promise<StoredPublicationJob> {
  if (useJson()) {
    const store = await loadJson();
    const idx = store.jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) store.jobs[idx] = job;
    else store.jobs.push(job);
    await persistJson();
    return job;
  }

  getDb()!
    .prepare(
      `INSERT INTO publication_jobs (id, publication_id, user_id, status, step, attempts, max_attempts, next_attempt_at, last_error, payload, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status, step = excluded.step, attempts = excluded.attempts,
         max_attempts = excluded.max_attempts, next_attempt_at = excluded.next_attempt_at,
         last_error = excluded.last_error, payload = excluded.payload,
         progress = excluded.progress, updated_at = excluded.updated_at`
    )
    .run(
      job.id,
      job.publicationId,
      job.userId,
      job.status,
      job.step,
      job.attempts,
      job.maxAttempts,
      job.nextAttemptAt,
      job.lastError ?? null,
      JSON.stringify(job.payload),
      JSON.stringify(job.progress),
      job.createdAt,
      job.updatedAt
    );
  return job;
}

export async function getJob(id: string): Promise<StoredPublicationJob | undefined> {
  if (useJson()) return (await loadJson()).jobs.find((j) => j.id === id);
  const row = getDb()!.prepare('SELECT * FROM publication_jobs WHERE id = ?').get(id) as
    | JobRow
    | undefined;
  return row ? rowToJob(row) : undefined;
}

export async function getJobForPublication(
  publicationId: string
): Promise<StoredPublicationJob | undefined> {
  if (useJson()) {
    const jobs = (await loadJson()).jobs
      .filter((j) => j.publicationId === publicationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jobs[0];
  }
  const row = getDb()!
    .prepare('SELECT * FROM publication_jobs WHERE publication_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(publicationId) as JobRow | undefined;
  return row ? rowToJob(row) : undefined;
}

/**
 * Найстаріша задача, якій вже настав час. Претендентів беремо по одному:
 * воркер однопотоковий, а Etsy все одно обмежує нас 10 запитами/сек — сенсу
 * в паралельних задачах немає, зате є ризик перевищити ліміт.
 */
export async function claimNextJob(nowIso: string): Promise<StoredPublicationJob | undefined> {
  if (useJson()) {
    const store = await loadJson();
    const job = store.jobs
      .filter((j) => j.status === 'queued' && j.nextAttemptAt <= nowIso)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))[0];
    if (!job) return undefined;
    job.status = 'running';
    job.updatedAt = nowIso;
    await persistJson();
    return job;
  }

  const row = getDb()!
    .prepare(
      `SELECT * FROM publication_jobs
        WHERE status = 'queued' AND next_attempt_at <= ?
        ORDER BY next_attempt_at ASC LIMIT 1`
    )
    .get(nowIso) as JobRow | undefined;
  if (!row) return undefined;
  getDb()!
    .prepare("UPDATE publication_jobs SET status = 'running', updated_at = ? WHERE id = ?")
    .run(nowIso, row.id);
  return rowToJob({ ...row, status: 'running', updated_at: nowIso });
}

/**
 * Після рестарту процесу задачі, які лишились у статусі `running`, нікому не
 * належать — попередній воркер помер разом із процесом. Повертаємо їх у
 * чергу: крок і `progress` збережені, тож робота продовжиться з місця обриву,
 * а не з початку.
 */
export async function requeueStuckJobs(nowIso: string): Promise<number> {
  if (useJson()) {
    const store = await loadJson();
    let n = 0;
    for (const job of store.jobs) {
      if (job.status === 'running') {
        job.status = 'queued';
        job.nextAttemptAt = nowIso;
        job.updatedAt = nowIso;
        n++;
      }
    }
    if (n) await persistJson();
    return n;
  }
  const res = getDb()!
    .prepare(
      "UPDATE publication_jobs SET status = 'queued', next_attempt_at = ?, updated_at = ? WHERE status = 'running'"
    )
    .run(nowIso, nowIso) as { changes?: number };
  return res?.changes ?? 0;
}

export async function listJobsForUser(userId: string): Promise<StoredPublicationJob[]> {
  if (useJson()) {
    return (await loadJson()).jobs
      .filter((j) => j.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const rows = getDb()!
    .prepare('SELECT * FROM publication_jobs WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as JobRow[];
  return rows.map(rowToJob);
}

// ---------------------------------------------------------------------------
// Etsy-акаунт
// ---------------------------------------------------------------------------

export async function upsertEtsyAccount(account: StoredEtsyAccount): Promise<StoredEtsyAccount> {
  if (useJson()) {
    const store = await loadJson();
    store.etsyAccounts[account.userId] = account;
    await persistJson();
    return account;
  }
  getDb()!
    .prepare(
      `INSERT INTO etsy_accounts (user_id, etsy_user_id, shop_id, shop_name, access_token_enc, refresh_token_enc, expires_at, scopes, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         etsy_user_id = excluded.etsy_user_id, shop_id = excluded.shop_id,
         shop_name = excluded.shop_name, access_token_enc = excluded.access_token_enc,
         refresh_token_enc = excluded.refresh_token_enc, expires_at = excluded.expires_at,
         scopes = excluded.scopes, updated_at = excluded.updated_at`
    )
    .run(
      account.userId,
      account.etsyUserId ?? null,
      account.shopId ?? null,
      account.shopName ?? null,
      account.accessTokenEnc,
      account.refreshTokenEnc,
      account.expiresAt,
      account.scopes,
      account.connectedAt,
      account.updatedAt
    );
  return account;
}

export async function getEtsyAccount(userId: string): Promise<StoredEtsyAccount | undefined> {
  if (useJson()) return (await loadJson()).etsyAccounts[userId];
  const row = getDb()!.prepare('SELECT * FROM etsy_accounts WHERE user_id = ?').get(userId) as
    | AccountRow
    | undefined;
  return row ? rowToAccount(row) : undefined;
}

export async function deleteEtsyAccount(userId: string): Promise<boolean> {
  if (useJson()) {
    const store = await loadJson();
    const existed = Boolean(store.etsyAccounts[userId]);
    delete store.etsyAccounts[userId];
    await persistJson();
    return existed;
  }
  const res = getDb()!.prepare('DELETE FROM etsy_accounts WHERE user_id = ?').run(userId) as {
    changes?: number;
  };
  return (res?.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// OAuth-стан (PKCE)
// ---------------------------------------------------------------------------

export async function saveOAuthState(state: StoredOAuthState): Promise<void> {
  if (useJson()) {
    const store = await loadJson();
    store.oauthStates[state.state] = state;
    await persistJson();
    return;
  }
  getDb()!
    .prepare(
      `INSERT INTO etsy_oauth_states (state, user_id, code_verifier, redirect_uri, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(state) DO UPDATE SET
         user_id = excluded.user_id, code_verifier = excluded.code_verifier,
         redirect_uri = excluded.redirect_uri, created_at = excluded.created_at`
    )
    .run(state.state, state.userId, state.codeVerifier, state.redirectUri, state.createdAt);
}

/**
 * Забирає стан «на один раз»: після обміну коду на токен той самий `state`
 * не повинен спрацювати вдруге (захист від повторного відтворення callback-у).
 */
export async function takeOAuthState(state: string): Promise<StoredOAuthState | undefined> {
  if (useJson()) {
    const store = await loadJson();
    const found = store.oauthStates[state];
    if (found) {
      delete store.oauthStates[state];
      await persistJson();
    }
    return found;
  }
  const row = getDb()!
    .prepare('SELECT * FROM etsy_oauth_states WHERE state = ?')
    .get(state) as
    | { state: string; user_id: string; code_verifier: string; redirect_uri: string; created_at: string }
    | undefined;
  if (!row) return undefined;
  getDb()!.prepare('DELETE FROM etsy_oauth_states WHERE state = ?').run(state);
  return {
    state: row.state,
    userId: row.user_id,
    codeVerifier: row.code_verifier,
    redirectUri: row.redirect_uri,
    createdAt: row.created_at,
  };
}

export async function purgeOldOAuthStates(olderThanIso: string): Promise<number> {
  if (useJson()) {
    const store = await loadJson();
    let n = 0;
    for (const [key, value] of Object.entries(store.oauthStates)) {
      if (value.createdAt < olderThanIso) {
        delete store.oauthStates[key];
        n++;
      }
    }
    if (n) await persistJson();
    return n;
  }
  const res = getDb()!
    .prepare('DELETE FROM etsy_oauth_states WHERE created_at < ?')
    .run(olderThanIso) as { changes?: number };
  return res?.changes ?? 0;
}

// ---------------------------------------------------------------------------
// Зрізи дослідження тем
// ---------------------------------------------------------------------------

export async function saveResearchSnapshot(
  snapshot: StoredResearchSnapshot
): Promise<StoredResearchSnapshot> {
  if (useJson()) {
    const store = await loadJson();
    store.research.push(snapshot);
    // Файл не має рости безмежно — тримаємо останні 500 зрізів.
    if (store.research.length > 500) store.research = store.research.slice(-500);
    await persistJson();
    return snapshot;
  }
  getDb()!
    .prepare(
      `INSERT INTO etsy_research_snapshots (id, user_id, topic_key, topic, taxonomy_id, collected_at, listing_count, total_active, avg_favorers, median_price, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      snapshot.id,
      snapshot.userId ?? null,
      snapshot.topicKey,
      snapshot.topic,
      snapshot.taxonomyId ?? null,
      snapshot.collectedAt,
      snapshot.listingCount,
      snapshot.totalActive,
      snapshot.avgFavorers,
      snapshot.medianPrice,
      JSON.stringify(snapshot.payload)
    );
  return snapshot;
}

export async function getLatestResearchSnapshot(
  topicKey: string
): Promise<StoredResearchSnapshot | undefined> {
  if (useJson()) {
    return (await loadJson()).research
      .filter((r) => r.topicKey === topicKey)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0];
  }
  const row = getDb()!
    .prepare('SELECT * FROM etsy_research_snapshots WHERE topic_key = ? ORDER BY collected_at DESC LIMIT 1')
    .get(topicKey) as ResearchRow | undefined;
  return row ? rowToResearch(row) : undefined;
}

export async function listResearchHistory(
  topicKey: string,
  limit = 30
): Promise<StoredResearchSnapshot[]> {
  if (useJson()) {
    return (await loadJson()).research
      .filter((r) => r.topicKey === topicKey)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
      .slice(0, limit);
  }
  const rows = getDb()!
    .prepare('SELECT * FROM etsy_research_snapshots WHERE topic_key = ? ORDER BY collected_at DESC LIMIT ?')
    .all(topicKey, limit) as ResearchRow[];
  return rows.map(rowToResearch);
}

/** Теми, які варто оновлювати за розкладом: ті, що їх уже досліджували. */
export async function listTrackedTopics(limit = 25): Promise<{ topicKey: string; topic: string; taxonomyId?: number }[]> {
  if (useJson()) {
    const seen = new Map<string, { topicKey: string; topic: string; taxonomyId?: number }>();
    for (const snap of (await loadJson()).research.slice().reverse()) {
      if (!seen.has(snap.topicKey)) {
        seen.set(snap.topicKey, { topicKey: snap.topicKey, topic: snap.topic, taxonomyId: snap.taxonomyId });
      }
      if (seen.size >= limit) break;
    }
    return [...seen.values()];
  }
  const rows = getDb()!
    .prepare(
      `SELECT topic_key, topic, taxonomy_id, MAX(collected_at) AS last_at
         FROM etsy_research_snapshots
        GROUP BY topic_key
        ORDER BY last_at DESC
        LIMIT ?`
    )
    .all(limit) as { topic_key: string; topic: string; taxonomy_id: number | null }[];
  return rows.map((r) => ({
    topicKey: r.topic_key,
    topic: r.topic,
    taxonomyId: r.taxonomy_id ?? undefined,
  }));
}

/** Лише для тестів: скидає кеш JSON-бекенду. */
export function __resetCacheForTests(): void {
  jsonCache = null;
}
