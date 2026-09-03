/**
 * Медіатека автора на сервері (задача #100).
 *
 * ЩО БУЛО НЕ ТАК. Зображення жили у двох ненадійних місцях:
 *   • завантажені з компʼютера — як `data:`-URL ВСЕРЕДИНІ обʼєкта книги в
 *     IndexedDB одного браузера. Очищене сховище — і альбому немає ніде.
 *     Гірше: після появи дзеркалення книги на сервер (#94) кожне збереження
 *     тягло ці мегабайти base64 через мережу цілком, на кожен правлений
 *     абзац;
 *   • згенеровані ШІ — файлами в `assets/generated` поруч із кодом, без
 *     власника й без жодного рядка в базі. На хостингу з ефемерним диском
 *     вони зникають при деплої, і дізнатися, що саме зникло, нема з чого.
 *
 * ЯК ТЕПЕР. Той самий поділ, що й у `bookStore.ts`: ОПИС у базі, БАЙТИ у
 * `DATA_DIR/media/<user>/`. Опис малий і транзакційний, файли великі й
 * двійкові — у базі їм робити нічого.
 *
 * `prompt` і `model` зберігаються обовʼязково для всього, що згенеровано:
 * без них вдале зображення неможливо ні повторити, ні пояснити.
 *
 * Контракт як у решті сховищ проєкту: SQLite основний, JSON у DATA_DIR —
 * запасний, назовні лише camelCase-обʼєкти, SQL не витікає.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, isAvailable, DATA_DIR } from '../db';

export const MEDIA_ROOT = path.join(DATA_DIR, 'media');

/** Публічний префікс, під яким віддаються файли медіатеки. */
export const MEDIA_URL_PREFIX = '/api/media/file';

export type MediaKind = 'upload' | 'illustration' | 'character_art' | 'cover_art';

const KINDS: readonly MediaKind[] = ['upload', 'illustration', 'character_art', 'cover_art'];

/** Що приймаємо. Розширення на диску визначається ТИПОМ, а не імʼям файлу. */
export const MEDIA_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

export interface MediaAsset {
  id: string;
  ownerId: string;
  bookId: string | null;
  kind: MediaKind;
  /** Як назвав автор — лише для показу й для завантаження назад. */
  filename: string;
  mimeType: string;
  sizeBytes: number;
  prompt: string | null;
  model: string | null;
  createdAt: string;
  /** Похідне: те, що йде в книгу замість мегабайтів base64. */
  url: string;
}

// ---------------------------------------------------------------------------
// JSON-бекенд (коли SQLite недоступний)
// ---------------------------------------------------------------------------

const JSON_FILE = 'media-assets.json';

interface JsonShape {
  assets: MediaAsset[];
}

let jsonCache: JsonShape | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

async function loadJson(): Promise<JsonShape> {
  if (jsonCache) return jsonCache;
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, JSON_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Partial<JsonShape>;
    jsonCache = { assets: Array.isArray(parsed.assets) ? parsed.assets : [] };
  } catch {
    jsonCache = { assets: [] };
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
    .catch((err) => console.error('[mediaLibrary] Не вдалося зберегти media-assets.json:', err));
  return writeChain as Promise<void>;
}

function useJson(): boolean {
  return !isAvailable();
}

/** Лише для тестів: скидає кеш JSON-бекенду. */
export function __resetMediaCacheForTests(): void {
  jsonCache = null;
}

// ---------------------------------------------------------------------------
// Шляхи
// ---------------------------------------------------------------------------

/**
 * Імʼя теки — тільки безпечні символи id користувача, а не сам id: він
 * приходить іззовні, і «../» у ньому не має вивести запис за межі DATA_DIR.
 */
function userDir(ownerId: string): string {
  return path.join(MEDIA_ROOT, String(ownerId).replace(/[^A-Za-z0-9._-]/g, '_'));
}

/** Імʼя файлу на диску походить від id активу, а не від імені, яке ввів автор. */
function diskName(asset: Pick<MediaAsset, 'id' | 'mimeType'>): string {
  const ext = MEDIA_MIME_EXTENSIONS[asset.mimeType] || 'bin';
  return `${asset.id}.${ext}`;
}

export function assetPath(asset: Pick<MediaAsset, 'id' | 'ownerId' | 'mimeType'>): string {
  return path.join(userDir(asset.ownerId), diskName(asset));
}

export function urlForAsset(id: string): string {
  return `${MEDIA_URL_PREFIX}/${id}`;
}

/**
 * Розпізнає власний URL медіатеки. Потрібно там, де сервер має ПРОЧИТАТИ
 * зображення з книги (референси, розпізнавання тексту, верстка PDF).
 */
export function assetIdFromUrl(url: string): string | null {
  const raw = String(url || '');
  if (!raw.startsWith(`${MEDIA_URL_PREFIX}/`)) return null;
  const id = raw.slice(MEDIA_URL_PREFIX.length + 1).split(/[?#]/)[0];
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Запис і читання
// ---------------------------------------------------------------------------

function rowToAsset(row: any): MediaAsset {
  const id = String(row.id);
  return {
    id,
    ownerId: String(row.owner_id),
    bookId: row.book_id ? String(row.book_id) : null,
    kind: (KINDS.includes(row.kind) ? row.kind : 'upload') as MediaKind,
    filename: String(row.filename || ''),
    mimeType: String(row.mime_type || 'application/octet-stream'),
    sizeBytes: Number(row.size_bytes) || 0,
    prompt: row.prompt ? String(row.prompt) : null,
    model: row.model ? String(row.model) : null,
    createdAt: String(row.created_at),
    url: urlForAsset(id),
  };
}

export function newAssetId(): string {
  return `md-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
}

export async function saveAsset(params: {
  ownerId: string;
  bookId?: string | null;
  kind: MediaKind;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  prompt?: string | null;
  model?: string | null;
  now?: () => Date;
}): Promise<MediaAsset> {
  const ownerId = String(params.ownerId || '').trim();
  if (!ownerId) throw new Error('Медіафайл без власника — зберігати нікуди.');
  if (!params.bytes || params.bytes.length === 0) throw new Error('Порожній медіафайл.');

  const mimeType = String(params.mimeType || '').toLowerCase();
  if (!MEDIA_MIME_EXTENSIONS[mimeType]) {
    throw new Error(`Непідтримуваний тип файлу: ${mimeType || 'невідомий'}.`);
  }

  const record: MediaAsset = {
    id: newAssetId(),
    ownerId,
    bookId: params.bookId ? String(params.bookId) : null,
    kind: KINDS.includes(params.kind) ? params.kind : 'upload',
    filename: String(params.filename || 'image').slice(0, 200),
    mimeType,
    sizeBytes: params.bytes.length,
    prompt: params.prompt ? String(params.prompt).slice(0, 4000) : null,
    model: params.model ? String(params.model).slice(0, 200) : null,
    createdAt: (params.now?.() ?? new Date()).toISOString(),
    url: '',
  };
  record.url = urlForAsset(record.id);

  // Спершу файл, потім опис: опис без файлу — це «битий рядок» у переліку,
  // а файл без опису — просто сміття, яке нікому не показується.
  await fs.mkdir(userDir(ownerId), { recursive: true });
  await fs.writeFile(assetPath(record), params.bytes);

  if (useJson()) {
    const data = await loadJson();
    data.assets.push(record);
    await persistJson();
    return record;
  }

  getDb()!
    .prepare(
      `INSERT INTO media_assets
         (id, owner_id, book_id, kind, filename, mime_type, size_bytes, prompt, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.ownerId,
      record.bookId,
      record.kind,
      record.filename,
      record.mimeType,
      record.sizeBytes,
      record.prompt,
      record.model,
      record.createdAt
    );
  return record;
}

export async function getAsset(id: string): Promise<MediaAsset | null> {
  const assetId = String(id || '').trim();
  if (!assetId) return null;
  if (useJson()) {
    return (await loadJson()).assets.find((a) => a.id === assetId) ?? null;
  }
  const row = getDb()!.prepare('SELECT * FROM media_assets WHERE id = ?').get(assetId);
  return row ? rowToAsset(row) : null;
}

export async function listAssets(
  ownerId: string,
  opts: { bookId?: string | null } = {}
): Promise<MediaAsset[]> {
  const owner = String(ownerId || '').trim();
  if (!owner) return [];
  if (useJson()) {
    return (await loadJson()).assets
      .filter((a) => a.ownerId === owner)
      .filter((a) => (opts.bookId ? a.bookId === opts.bookId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const rows = opts.bookId
    ? getDb()!
        .prepare(
          'SELECT * FROM media_assets WHERE owner_id = ? AND book_id = ? ORDER BY created_at DESC'
        )
        .all(owner, opts.bookId)
    : getDb()!
        .prepare('SELECT * FROM media_assets WHERE owner_id = ? ORDER BY created_at DESC')
        .all(owner);
  return (rows as any[]).map(rowToAsset);
}

/** Байти файлу. `null` — опису немає або файл зник із диска. */
export async function readAsset(
  id: string
): Promise<{ record: MediaAsset; bytes: Uint8Array } | null> {
  const record = await getAsset(id);
  if (!record) return null;
  try {
    const bytes = await fs.readFile(assetPath(record));
    return { record, bytes: new Uint8Array(bytes) };
  } catch {
    // Опис є, файла немає — стан «диск підмінили/очистили», а не помилка коду.
    return null;
  }
}

/**
 * Видалення. `ownerId` обовʼязковий: чужий файл має бути НЕ ЗНАЙДЕНИЙ, а не
 * «заборонений» — інакше перебором id можна дізнатися, що в когось є.
 *
 * Ліміт сховища при цьому НЕ звільняється — так само, як не звільняється
 * лічильник генерацій при видаленні ілюстрації (див. server/mediaStorage.ts).
 * Це свідома, вже прийнята в проєкті домовленість, а не недогляд.
 */
export async function deleteAsset(id: string, ownerId: string): Promise<boolean> {
  const record = await getAsset(id);
  if (!record || record.ownerId !== String(ownerId)) return false;

  try {
    await fs.unlink(assetPath(record));
  } catch {
    // Файла вже немає — опис усе одно прибираємо.
  }

  if (useJson()) {
    const data = await loadJson();
    data.assets = data.assets.filter((a) => a.id !== record.id);
    await persistJson();
    return true;
  }

  getDb()!.prepare('DELETE FROM media_assets WHERE id = ?').run(record.id);
  return true;
}

/** Сумарний обсяг медіатеки автора — для звірки з лічильником тарифу. */
export async function totalBytesForOwner(ownerId: string): Promise<number> {
  const all = await listAssets(ownerId);
  return all.reduce((sum, a) => sum + a.sizeBytes, 0);
}
