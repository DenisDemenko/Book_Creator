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

/**
 * 'video' — задача Leonardo.Ai (журнал #201): один вид на БУДЬ-яке
 * згенероване відео незалежно від того, де саме його створено (медіатека,
 * картка товару, персонаж) — так само, як 'illustration' один на всі
 * ілюстрації книги. Окремого 'product_video'/'character_video' немає:
 * власника видно з `bookId`/контексту виклику, а не з виду файлу.
 */
export type MediaKind = 'upload' | 'illustration' | 'character_art' | 'cover_art' | 'video';

const KINDS: readonly MediaKind[] = ['upload', 'illustration', 'character_art', 'cover_art', 'video'];

/**
 * Що приймаємо. Розширення на диску визначається ТИПОМ, а не імʼям файлу.
 *
 * 'video/mp4' — єдиний контейнер, який Leonardo.Ai віддає для всіх шести
 * відеодвигунів (server/videoGeneration.ts). Довільне завантажене відео
 * з компʼютера автора цей запис так само прийме (UPLOAD_KINDS у
 * mediaRoutes.ts цього не забороняє) — окремого обмеження «лише
 * згенероване» тут немає, як і для зображень.
 */
export const MEDIA_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
};

// ---------------------------------------------------------------------------
// Паспорт зображення (Т2.3 В1, PLAN_VISUAL_LIBRARY.md §2)
// ---------------------------------------------------------------------------

/** Звідки зображення. */
export type MediaSource = 'upload' | 'ai' | 'stock' | 'commission' | 'scan';
export const MEDIA_SOURCES: readonly MediaSource[] = ['upload', 'ai', 'stock', 'commission', 'scan'];

/** Ліцензія (перелік погоджено власником 25.09.2026). */
export type MediaLicense = 'own' | 'cc-by' | 'cc-by-sa' | 'cc0' | 'licensed' | 'unknown';
export const MEDIA_LICENSES: readonly MediaLicense[] = ['own', 'cc-by', 'cc-by-sa', 'cc0', 'licensed', 'unknown'];

export type MediaStatus = 'draft' | 'final';
export const MEDIA_STATUSES: readonly MediaStatus[] = ['draft', 'final'];

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
  /** Паспорт: назва для людей ('' — показується filename). */
  title: string;
  /** Опис зображення для читача (alt). */
  altText: string;
  source: MediaSource;
  author: string;
  license: MediaLicense;
  licenseUrl: string;
  status: MediaStatus;
  /** Версії: попередня версія, перша версія групи (ключ), номер у групі. */
  parentId: string | null;
  rootId: string;
  version: number;
  updatedAt: string;
}

/** Що автор може змінити в паспорті. */
export interface MediaPassportPatch {
  title?: string;
  altText?: string;
  source?: MediaSource;
  author?: string;
  license?: MediaLicense;
  licenseUrl?: string;
  status?: MediaStatus;
}

export type MediaHistoryAction = 'created' | 'version' | 'passport' | 'deleted';

export interface MediaHistoryEntry {
  id: number;
  assetId: string;
  rootId: string;
  ownerId: string;
  at: string;
  /** `user:<id>`, `ai:<модель>` чи `system:…`. */
  actor: string;
  action: MediaHistoryAction;
  details: Record<string, unknown>;
}

/** Помилка перевірки паспорта — маршрут перетворює її на 400. */
export class MediaPassportError extends Error {}

const PASSPORT_TEXT_LIMITS: Record<'title' | 'altText' | 'author' | 'licenseUrl', number> = {
  title: 200,
  altText: 1000,
  author: 200,
  licenseUrl: 500,
};

/**
 * Перевіряє й нормалізує зміни паспорта. Невідоме поле ігнорується, неправильне
 * значення — MediaPassportError з поясненням (а не мовчазна заміна).
 */
export function normalizePassportPatch(raw: unknown): MediaPassportPatch {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: MediaPassportPatch = {};
  for (const key of ['title', 'altText', 'author', 'licenseUrl'] as const) {
    if (src[key] === undefined) continue;
    if (src[key] !== null && typeof src[key] !== 'string') throw new MediaPassportError(`Поле «${key}» має бути текстом.`);
    const v = String(src[key] ?? '').trim();
    if (v.length > PASSPORT_TEXT_LIMITS[key]) throw new MediaPassportError(`Поле «${key}» задовге (до ${PASSPORT_TEXT_LIMITS[key]} знаків).`);
    out[key] = v;
  }
  if (out.licenseUrl && !/^https?:\/\/\S+$/i.test(out.licenseUrl)) {
    throw new MediaPassportError('Посилання на ліцензію має починатися з http:// або https://.');
  }
  if (src.source !== undefined) {
    if (!MEDIA_SOURCES.includes(src.source as MediaSource)) throw new MediaPassportError(`Невідоме джерело «${String(src.source)}».`);
    out.source = src.source as MediaSource;
  }
  if (src.license !== undefined) {
    if (!MEDIA_LICENSES.includes(src.license as MediaLicense)) throw new MediaPassportError(`Невідома ліцензія «${String(src.license)}».`);
    out.license = src.license as MediaLicense;
  }
  if (src.status !== undefined) {
    if (!MEDIA_STATUSES.includes(src.status as MediaStatus)) throw new MediaPassportError(`Невідомий статус «${String(src.status)}».`);
    out.status = src.status as MediaStatus;
  }
  return out;
}

// ---------------------------------------------------------------------------
// JSON-бекенд (коли SQLite недоступний)
// ---------------------------------------------------------------------------

const JSON_FILE = 'media-assets.json';

interface JsonShape {
  assets: MediaAsset[];
  /** Історія зображень (Т2.3 В1); у старих файлах поля немає. */
  history: MediaHistoryEntry[];
}

let jsonCache: JsonShape | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

async function loadJson(): Promise<JsonShape> {
  if (jsonCache) return jsonCache;
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, JSON_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Partial<JsonShape>;
    jsonCache = {
      // Старі записи JSON-файлу — без паспорта: доповнюємо тими самими правилами, що й рядки SQLite.
      assets: Array.isArray(parsed.assets) ? parsed.assets.map((a) => withPassportDefaults(a)) : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    jsonCache = { assets: [], history: [] };
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

/**
 * Паспорт для запису, у якого його ще немає (рядок до Т2.3 чи новий файл без
 * указаних полів). Правила — одні для SQLite і JSON:
 *   джерело — «ШІ», якщо є промпт чи модель, інакше «завантажено»;
 *   ліцензія — «своя» для згенерованого, «невідома» для завантаженого
 *     (про чуже фото ми нічого не знаємо — чесніше так і сказати);
 *   статус — «готове»; версія — 1, група — сам файл.
 */
function withPassportDefaults(a: Partial<MediaAsset> & { id: string; createdAt: string }): MediaAsset {
  const source: MediaSource = MEDIA_SOURCES.includes(a.source as MediaSource) ? (a.source as MediaSource) : a.prompt || a.model ? 'ai' : 'upload';
  return {
    ...(a as MediaAsset),
    title: a.title ?? '',
    altText: a.altText ?? '',
    source,
    author: a.author ?? '',
    license: MEDIA_LICENSES.includes(a.license as MediaLicense) ? (a.license as MediaLicense) : source === 'ai' ? 'own' : 'unknown',
    licenseUrl: a.licenseUrl ?? '',
    status: MEDIA_STATUSES.includes(a.status as MediaStatus) ? (a.status as MediaStatus) : 'final',
    parentId: a.parentId ?? null,
    rootId: a.rootId || a.id,
    version: Number(a.version) > 0 ? Number(a.version) : 1,
    updatedAt: a.updatedAt || a.createdAt,
  };
}

function rowToAsset(row: any): MediaAsset {
  const id = String(row.id);
  return withPassportDefaults({
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
    title: row.title ?? undefined,
    altText: row.alt_text ?? undefined,
    source: row.source ?? undefined,
    author: row.author ?? undefined,
    license: row.license ?? undefined,
    licenseUrl: row.license_url ?? undefined,
    status: row.status ?? undefined,
    parentId: row.parent_id ?? null,
    rootId: row.root_id ?? undefined,
    version: row.version ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  });
}

function rowToHistory(row: any): MediaHistoryEntry {
  let details: Record<string, unknown> = {};
  try {
    details = JSON.parse(String(row.details || '{}'));
  } catch {
    /* зіпсований JSON — порожні подробиці, запис лишається */
  }
  return {
    id: Number(row.id),
    assetId: String(row.asset_id),
    rootId: String(row.root_id),
    ownerId: String(row.owner_id),
    at: String(row.at),
    actor: String(row.actor),
    action: String(row.action) as MediaHistoryAction,
    details,
  };
}

/** Записати подію в історію зображення (група — `rootId`). */
export async function recordAssetHistory(entry: Omit<MediaHistoryEntry, 'id' | 'at'> & { at?: string }): Promise<void> {
  const at = entry.at ?? new Date().toISOString();
  if (useJson()) {
    const data = await loadJson();
    const id = data.history.reduce((m, h) => Math.max(m, h.id), 0) + 1;
    data.history.push({ ...entry, id, at });
    await persistJson();
    return;
  }
  getDb()!
    .prepare('INSERT INTO media_asset_history (asset_id, root_id, owner_id, at, actor, action, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(entry.assetId, entry.rootId, entry.ownerId, at, entry.actor, entry.action, JSON.stringify(entry.details ?? {}));
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
  /** Нова версія наявного зображення (Т2.3 В1): id попередньої версії того ж власника. */
  parentId?: string | null;
  /** Паспорт одразу при збереженні; не вказане — як у попередньої версії або за правилами за замовчуванням. */
  passport?: MediaPassportPatch;
  /** Хто зберіг — для історії; типово `user:<власник>`. */
  actor?: string;
}): Promise<MediaAsset> {
  const ownerId = String(params.ownerId || '').trim();
  if (!ownerId) throw new Error('Медіафайл без власника — зберігати нікуди.');
  if (!params.bytes || params.bytes.length === 0) throw new Error('Порожній медіафайл.');

  const mimeType = String(params.mimeType || '').toLowerCase();
  if (!MEDIA_MIME_EXTENSIONS[mimeType]) {
    throw new Error(`Непідтримуваний тип файлу: ${mimeType || 'невідомий'}.`);
  }

  // Нова версія: попередня має бути своєю; група, книга, вид і паспорт — від неї.
  let parent: MediaAsset | null = null;
  if (params.parentId) {
    parent = await getAsset(String(params.parentId));
    if (!parent || parent.ownerId !== ownerId) throw new Error('Попередню версію зображення не знайдено.');
  }
  const passport = normalizePassportPatch(params.passport ?? {});
  const nowIso = (params.now?.() ?? new Date()).toISOString();
  const id = newAssetId();
  let version = 1;
  if (parent) {
    const group = (await listAssets(ownerId)).filter((a) => a.rootId === parent!.rootId);
    version = Math.max(parent.version, ...group.map((a) => a.version)) + 1;
  }

  const record: MediaAsset = withPassportDefaults({
    id,
    ownerId,
    bookId: params.bookId ? String(params.bookId) : parent?.bookId ?? null,
    kind: KINDS.includes(params.kind) ? params.kind : parent?.kind ?? 'upload',
    filename: String(params.filename || 'image').slice(0, 200),
    mimeType,
    sizeBytes: params.bytes.length,
    prompt: params.prompt ? String(params.prompt).slice(0, 4000) : null,
    model: params.model ? String(params.model).slice(0, 200) : null,
    createdAt: nowIso,
    url: '',
    title: passport.title ?? parent?.title,
    altText: passport.altText ?? parent?.altText,
    source: passport.source,
    author: passport.author ?? parent?.author,
    license: passport.license ?? (parent && !params.prompt && !params.model ? parent.license : undefined),
    licenseUrl: passport.licenseUrl ?? parent?.licenseUrl,
    status: passport.status ?? parent?.status,
    parentId: parent?.id ?? null,
    rootId: parent?.rootId ?? id,
    version,
    updatedAt: nowIso,
  });
  record.url = urlForAsset(record.id);

  // Спершу файл, потім опис: опис без файлу — це «битий рядок» у переліку,
  // а файл без опису — просто сміття, яке нікому не показується.
  await fs.mkdir(userDir(ownerId), { recursive: true });
  await fs.writeFile(assetPath(record), params.bytes);

  if (useJson()) {
    const data = await loadJson();
    data.assets.push(record);
    await persistJson();
  } else {
    getDb()!
      .prepare(
        `INSERT INTO media_assets
           (id, owner_id, book_id, kind, filename, mime_type, size_bytes, prompt, model, created_at,
            title, alt_text, source, author, license, license_url, status, parent_id, root_id, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        record.createdAt,
        record.title,
        record.altText,
        record.source,
        record.author,
        record.license,
        record.licenseUrl,
        record.status,
        record.parentId,
        record.rootId,
        record.version,
        record.updatedAt
      );
  }
  await recordAssetHistory({
    assetId: record.id,
    rootId: record.rootId,
    ownerId,
    at: nowIso,
    actor: params.actor || `user:${ownerId}`,
    action: parent ? 'version' : 'created',
    details: parent
      ? { version: record.version, from: parent.id, filename: record.filename }
      : { source: record.source, kind: record.kind, filename: record.filename, ...(record.model ? { model: record.model } : {}) },
  });
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

  // Історія лишається: вона пояснює, куди подівся файл і яка версія стала останньою.
  await recordAssetHistory({
    assetId: record.id,
    rootId: record.rootId,
    ownerId: record.ownerId,
    actor: `user:${record.ownerId}`,
    action: 'deleted',
    details: { version: record.version, filename: record.filename },
  });

  if (useJson()) {
    const data = await loadJson();
    data.assets = data.assets.filter((a) => a.id !== record.id);
    await persistJson();
    return true;
  }

  getDb()!.prepare('DELETE FROM media_assets WHERE id = ?').run(record.id);
  return true;
}

/**
 * Змінити паспорт зображення. `null` — файлу немає або він чужий (як 404).
 * Нічого не змінилось — запис лишається як був, в історію нічого не йде.
 */
export async function updateAssetPassport(
  id: string,
  ownerId: string,
  rawPatch: unknown,
  actor?: string,
  now: () => Date = () => new Date()
): Promise<MediaAsset | null> {
  const patch = normalizePassportPatch(rawPatch);
  const current = await getAsset(id);
  if (!current || current.ownerId !== String(ownerId)) return null;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(patch) as [keyof MediaPassportPatch, unknown][]) {
    if (v !== undefined && current[k] !== v) changes[k] = { from: current[k], to: v };
  }
  if (!Object.keys(changes).length) return current;
  const updatedAt = now().toISOString();
  const next: MediaAsset = { ...current, ...patch, updatedAt } as MediaAsset;
  if (useJson()) {
    const data = await loadJson();
    data.assets = data.assets.map((a) => (a.id === current.id ? next : a));
    await persistJson();
  } else {
    getDb()!
      .prepare(
        `UPDATE media_assets SET title = ?, alt_text = ?, source = ?, author = ?, license = ?, license_url = ?, status = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(next.title, next.altText, next.source, next.author, next.license, next.licenseUrl, next.status, updatedAt, current.id);
  }
  await recordAssetHistory({
    assetId: current.id,
    rootId: current.rootId,
    ownerId: current.ownerId,
    at: updatedAt,
    actor: actor || `user:${current.ownerId}`,
    action: 'passport',
    details: { changes },
  });
  return next;
}

/**
 * Паспорт повністю: сам файл, усі його версії (від першої) і історія групи
 * (новіші події першими). `null` — чужий чи неіснуючий файл.
 */
export async function getAssetPassport(
  id: string,
  ownerId: string
): Promise<{ asset: MediaAsset; versions: MediaAsset[]; history: MediaHistoryEntry[] } | null> {
  const asset = await getAsset(id);
  if (!asset || asset.ownerId !== String(ownerId)) return null;
  const versions = (await listAssets(asset.ownerId))
    .filter((a) => a.rootId === asset.rootId)
    .sort((a, b) => a.version - b.version);
  let history: MediaHistoryEntry[];
  if (useJson()) {
    history = (await loadJson()).history.filter((h) => h.rootId === asset.rootId && h.ownerId === asset.ownerId);
  } else {
    history = (getDb()!
      .prepare('SELECT * FROM media_asset_history WHERE root_id = ? AND owner_id = ? ORDER BY id')
      .all(asset.rootId, asset.ownerId) as any[]).map(rowToHistory);
  }
  return { asset, versions, history: history.sort((a, b) => b.id - a.id) };
}

/**
 * Лише останні версії: кожна група версій — одним записом (найбільший номер).
 * Для галереї: попередні версії видно в паспорті, а не окремими картками.
 */
export function latestVersionsOnly(assets: MediaAsset[]): MediaAsset[] {
  const best = new Map<string, MediaAsset>();
  for (const a of assets) {
    const cur = best.get(a.rootId);
    if (!cur || a.version > cur.version) best.set(a.rootId, a);
  }
  return assets.filter((a) => best.get(a.rootId) === a);
}

/** Сумарний обсяг медіатеки автора — для звірки з лічильником тарифу. */
export async function totalBytesForOwner(ownerId: string): Promise<number> {
  const all = await listAssets(ownerId);
  return all.reduce((sum, a) => sum + a.sizeBytes, 0);
}
