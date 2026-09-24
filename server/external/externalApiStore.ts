/**
 * Сховище зовнішнього API: особисті токени застосунків і скани сторінок.
 *
 * НАВІЩО. Зовнішній застосунок (WriterScan — iOS, фото сторінки рукопису →
 * розпізнаний текст) не може жити на cookie-сесії Студії: у нього немає
 * браузера, а вхід через Firebase у нативному застосунку — окремий великий
 * проєкт. Власник обрав особистий токен (як GitHub Personal Access Token):
 * автор створює його в Студії, вставляє в застосунок, і може відкликати.
 *
 * ЩО ЗБЕРІГАЄТЬСЯ. Від токена — лише SHA-256 хеш і короткий префікс для
 * впізнавання в списку. Сам токен показується один раз у момент створення.
 * Скан — опис: чиє, до якої книги, де фото (медіатека), що розпізнано, що
 * автор виправив, куди просить вставити і в якому стані.
 *
 * Контракт як у решті сховищ: SQLite основний, JSON у DATA_DIR — запасний,
 * назовні лише camelCase-обʼєкти.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, isAvailable, DATA_DIR } from '../db';

// ---------------------------------------------------------------------------
// Типи
// ---------------------------------------------------------------------------

export interface ExternalApiToken {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * Життєвий цикл скану:
 *   processing → recognized | failed      (сервер, розпізнавання у фоні)
 *   recognized → submitted                (застосунок: автор перевірив текст)
 *   submitted  → inserted | dismissed     (Студія: вставлено в главу / відхилено)
 */
export type ScanStatus = 'processing' | 'recognized' | 'failed' | 'submitted' | 'inserted' | 'dismissed';

const SCAN_STATUSES: readonly ScanStatus[] = ['processing', 'recognized', 'failed', 'submitted', 'inserted', 'dismissed'];

export interface ExternalScan {
  id: string;
  ownerId: string;
  bookId: string;
  assetId: string;
  imageUrl: string;
  status: ScanStatus;
  /** Що повернула модель — лишається незмінним, щоб було з чим порівняти правки. */
  recognizedText: string;
  /** Текст після перевірки автором на телефоні (порожній до submit). */
  text: string;
  chapterId: string | null;
  chapterTitle: string | null;
  sectionTitle: string | null;
  modelId: string | null;
  error: string | null;
  tokenId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Токени: генерація і хеш
// ---------------------------------------------------------------------------

/** Префікс робить токен впізнаваним у логах і сканерах секретів. */
export const TOKEN_PREFIX = 'nst_';

export function generateTokenSecret(): string {
  return `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// JSON-бекенд
// ---------------------------------------------------------------------------

const JSON_FILE = 'external-api.json';

interface JsonShape {
  tokens: ExternalApiToken[];
  scans: ExternalScan[];
}

let jsonCache: JsonShape | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

async function loadJson(): Promise<JsonShape> {
  if (jsonCache) return jsonCache;
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, JSON_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Partial<JsonShape>;
    jsonCache = {
      tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
      scans: Array.isArray(parsed.scans) ? parsed.scans : [],
    };
  } catch {
    jsonCache = { tokens: [], scans: [] };
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
    .catch((err) => console.error('[externalApi] Не вдалося зберегти external-api.json:', err));
  return writeChain as Promise<void>;
}

function useJson(): boolean {
  return !isAvailable();
}

/** Лише для тестів: скидає кеш JSON-бекенду. */
export function __resetExternalApiCacheForTests(): void {
  jsonCache = null;
}

// ---------------------------------------------------------------------------
// Токени
// ---------------------------------------------------------------------------

function rowToToken(row: any): ExternalApiToken {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name || ''),
    tokenHash: String(row.token_hash),
    prefix: String(row.prefix || ''),
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
  };
}

/**
 * Створює токен. Повертає і запис, і САМ токен — єдиний раз, коли він
 * існує у відкритому вигляді.
 */
export async function createToken(params: {
  userId: string;
  name: string;
  now?: () => Date;
}): Promise<{ record: ExternalApiToken; token: string }> {
  const userId = String(params.userId || '').trim();
  if (!userId) throw new Error('Токен без власника створювати не можна.');
  const token = generateTokenSecret();
  const record: ExternalApiToken = {
    id: newId('xtk'),
    userId,
    name: String(params.name || '').trim().slice(0, 80) || 'Застосунок',
    tokenHash: hashToken(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + 6),
    createdAt: (params.now?.() ?? new Date()).toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };

  if (useJson()) {
    const data = await loadJson();
    data.tokens.push(record);
    await persistJson();
    return { record, token };
  }
  getDb()!
    .prepare(
      `INSERT INTO external_api_tokens (id, user_id, name, token_hash, prefix, created_at, last_used_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
    )
    .run(record.id, record.userId, record.name, record.tokenHash, record.prefix, record.createdAt);
  return { record, token };
}

/** Чинний (не відкликаний) токен за самим секретом. */
export async function findActiveTokenBySecret(token: string): Promise<ExternalApiToken | null> {
  const raw = String(token || '').trim();
  if (!raw.startsWith(TOKEN_PREFIX) || raw.length < TOKEN_PREFIX.length + 20) return null;
  const hash = hashToken(raw);
  if (useJson()) {
    const found = (await loadJson()).tokens.find((t) => t.tokenHash === hash);
    return found && !found.revokedAt ? found : null;
  }
  const row = getDb()!.prepare('SELECT * FROM external_api_tokens WHERE token_hash = ?').get(hash);
  if (!row) return null;
  const record = rowToToken(row);
  return record.revokedAt ? null : record;
}

export async function listTokens(userId: string): Promise<ExternalApiToken[]> {
  const owner = String(userId || '').trim();
  if (!owner) return [];
  if (useJson()) {
    return (await loadJson()).tokens
      .filter((t) => t.userId === owner)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const rows = getDb()!
    .prepare('SELECT * FROM external_api_tokens WHERE user_id = ? ORDER BY created_at DESC')
    .all(owner);
  return (rows as any[]).map(rowToToken);
}

/** Відкликання. Чужий токен — `false`, так само як неіснуючий. */
export async function revokeToken(id: string, userId: string, now: () => Date = () => new Date()): Promise<boolean> {
  const at = now().toISOString();
  if (useJson()) {
    const data = await loadJson();
    const found = data.tokens.find((t) => t.id === id && t.userId === userId);
    if (!found) return false;
    if (!found.revokedAt) {
      found.revokedAt = at;
      await persistJson();
    }
    return true;
  }
  const result = getDb()!
    .prepare('UPDATE external_api_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND user_id = ?')
    .run(at, id, userId) as unknown as { changes?: number };
  return (result?.changes || 0) > 0;
}

export async function touchToken(id: string, now: () => Date = () => new Date()): Promise<void> {
  const at = now().toISOString();
  if (useJson()) {
    const data = await loadJson();
    const found = data.tokens.find((t) => t.id === id);
    if (found) {
      found.lastUsedAt = at;
      await persistJson();
    }
    return;
  }
  getDb()!.prepare('UPDATE external_api_tokens SET last_used_at = ? WHERE id = ?').run(at, id);
}

/** Публічний вигляд токена — без хеша. */
export function publicToken(t: ExternalApiToken) {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    createdAt: t.createdAt,
    lastUsedAt: t.lastUsedAt,
    revokedAt: t.revokedAt,
  };
}

// ---------------------------------------------------------------------------
// Скани
// ---------------------------------------------------------------------------

function rowToScan(row: any): ExternalScan {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    bookId: String(row.book_id),
    assetId: String(row.asset_id),
    imageUrl: String(row.image_url),
    status: (SCAN_STATUSES.includes(row.status) ? row.status : 'failed') as ScanStatus,
    recognizedText: String(row.recognized_text || ''),
    text: String(row.text || ''),
    chapterId: row.chapter_id ? String(row.chapter_id) : null,
    chapterTitle: row.chapter_title ? String(row.chapter_title) : null,
    sectionTitle: row.section_title ? String(row.section_title) : null,
    modelId: row.model_id ? String(row.model_id) : null,
    error: row.error ? String(row.error) : null,
    tokenId: row.token_id ? String(row.token_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function createScan(params: {
  ownerId: string;
  bookId: string;
  assetId: string;
  imageUrl: string;
  tokenId?: string | null;
  now?: () => Date;
}): Promise<ExternalScan> {
  const at = (params.now?.() ?? new Date()).toISOString();
  const scan: ExternalScan = {
    id: newId('scn'),
    ownerId: String(params.ownerId),
    bookId: String(params.bookId),
    assetId: String(params.assetId),
    imageUrl: String(params.imageUrl),
    status: 'processing',
    recognizedText: '',
    text: '',
    chapterId: null,
    chapterTitle: null,
    sectionTitle: null,
    modelId: null,
    error: null,
    tokenId: params.tokenId ? String(params.tokenId) : null,
    createdAt: at,
    updatedAt: at,
  };
  if (useJson()) {
    const data = await loadJson();
    data.scans.push(scan);
    await persistJson();
    return scan;
  }
  getDb()!
    .prepare(
      `INSERT INTO external_scans
         (id, owner_id, book_id, asset_id, image_url, status, recognized_text, text,
          chapter_id, chapter_title, section_title, model_id, error, token_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', '', NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`
    )
    .run(scan.id, scan.ownerId, scan.bookId, scan.assetId, scan.imageUrl, scan.status, scan.tokenId, at, at);
  return scan;
}

/** Скан власника. Чужий — `null`, тобто 404 назовні, а не 403. */
export async function getScan(id: string, ownerId: string): Promise<ExternalScan | null> {
  const scanId = String(id || '').trim();
  if (!scanId) return null;
  let scan: ExternalScan | null;
  if (useJson()) {
    scan = (await loadJson()).scans.find((s) => s.id === scanId) ?? null;
  } else {
    const row = getDb()!.prepare('SELECT * FROM external_scans WHERE id = ?').get(scanId);
    scan = row ? rowToScan(row) : null;
  }
  return scan && scan.ownerId === String(ownerId) ? scan : null;
}

export type ScanPatch = Partial<
  Pick<ExternalScan, 'status' | 'recognizedText' | 'text' | 'chapterId' | 'chapterTitle' | 'sectionTitle' | 'modelId' | 'error'>
>;

export async function updateScan(
  id: string,
  ownerId: string,
  patch: ScanPatch,
  now: () => Date = () => new Date()
): Promise<ExternalScan | null> {
  const current = await getScan(id, ownerId);
  if (!current) return null;
  const next: ExternalScan = { ...current, ...patch, updatedAt: now().toISOString() };
  if (useJson()) {
    const data = await loadJson();
    const index = data.scans.findIndex((s) => s.id === current.id);
    if (index >= 0) data.scans[index] = next;
    await persistJson();
    return next;
  }
  getDb()!
    .prepare(
      `UPDATE external_scans SET status = ?, recognized_text = ?, text = ?, chapter_id = ?, chapter_title = ?,
         section_title = ?, model_id = ?, error = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      next.status,
      next.recognizedText,
      next.text,
      next.chapterId,
      next.chapterTitle,
      next.sectionTitle,
      next.modelId,
      next.error,
      next.updatedAt,
      next.id
    );
  return next;
}

export async function listScans(
  ownerId: string,
  opts: { statuses?: ScanStatus[]; bookId?: string | null } = {}
): Promise<ExternalScan[]> {
  const owner = String(ownerId || '').trim();
  if (!owner) return [];
  let all: ExternalScan[];
  if (useJson()) {
    all = (await loadJson()).scans.filter((s) => s.ownerId === owner);
  } else {
    all = (getDb()!.prepare('SELECT * FROM external_scans WHERE owner_id = ?').all(owner) as any[]).map(rowToScan);
  }
  return all
    .filter((s) => (opts.statuses?.length ? opts.statuses.includes(s.status) : true))
    .filter((s) => (opts.bookId ? s.bookId === opts.bookId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Скільки сканів користувач створив від моменту `sinceIso` — для обмеження частоти. */
export async function countScansSince(ownerId: string, sinceIso: string): Promise<number> {
  const owner = String(ownerId || '').trim();
  if (useJson()) {
    return (await loadJson()).scans.filter((s) => s.ownerId === owner && s.createdAt >= sinceIso).length;
  }
  const row = getDb()!
    .prepare('SELECT COUNT(*) AS n FROM external_scans WHERE owner_id = ? AND created_at >= ?')
    .get(owner, sinceIso) as { n?: number } | undefined;
  return Number(row?.n || 0);
}
