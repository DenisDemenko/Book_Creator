/**
 * Книга на сервері: джерело окремо, зверстані файли окремо.
 *
 * ЧОМУ ЦЕ ЗʼЯВИЛОСЬ. Досі рукопис жив ЛИШЕ в IndexedDB одного браузера.
 * Очищене сховище, інший компʼютер, приватне вікно — і книги немає ніде.
 * Публікація теж ішла з браузера: клієнт надсилав увесь обʼєкт книги в тілі
 * запиту, тобто сервер ніколи не мав власної копії того, що продає, і
 * повторна публікація без того самого браузера була неможлива.
 *
 * ДВА СХОВИЩА, І ЦЕ НАВМИСНО.
 *   • ДЖЕРЕЛО (`books`) — той самий JSON, що й у браузері, без жодного
 *     рендера. Це те, з чого все відновлюється, і воно має бути в базі:
 *     маленьке, транзакційне, з ревізією.
 *   • ЗВЕРСТАНІ ФАЙЛИ (`DATA_DIR/books/<id>/`) — PDF, KDP, уривок,
 *     обкладинка. У базі їм робити нічого: вони великі, двійкові й
 *     перезбираються з джерела будь-коли. У базі лишається лише ОПИС:
 *     чим зібрано, скільки сторінок, з якої ревізії книги.
 *
 * Той самий контракт, що й у решті сховищ проєкту: SQLite основний, JSON у
 * DATA_DIR — запасний, назовні лише camelCase-обʼєкти, SQL не витікає.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb, isAvailable, DATA_DIR } from './db';

export const BOOK_FILES_ROOT = path.join(DATA_DIR, 'books');

/** Що саме зберігаємо поруч із книгою. */
export type ArtifactKind = 'pdf' | 'sample' | 'cover';
export type ArtifactFormat = 'digital' | 'print';

export interface StoredBook {
  id: string;
  ownerId: string | null;
  title: string;
  /** Зростає на кожен прийнятий запис. Клієнт має надіслати ту, яку бачив. */
  revision: number;
  book: Record<string, unknown>;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredArtifact {
  id: string;
  bookId: string;
  kind: ArtifactKind;
  format: ArtifactFormat;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  variant: string | null;
  /** З якої ревізії книги зібрано. Дає відповісти «файл застарів». */
  bookRevision: number;
  builtAt: string;
}

/**
 * Конфлікт ревізій — окремий тип, бо його треба показати автору інакше, ніж
 * будь-яку іншу помилку: це не збій, а «твоя копія застаріла».
 */
export class BookRevisionConflict extends Error {
  constructor(readonly current: number, readonly sent: number) {
    super(
      `Книгу вже змінили в іншому місці: на сервері ревізія ${current}, ` +
        `а надіслано ${sent}. Перезавантажте книгу, щоб не затерти чужі правки.`
    );
  }
}

// ---------------------------------------------------------------------------
// JSON-бекенд (коли SQLite недоступний)
// ---------------------------------------------------------------------------

const JSON_FILE = 'books.json';

interface JsonShape {
  books: StoredBook[];
  artifacts: StoredArtifact[];
}

const EMPTY: JsonShape = { books: [], artifacts: [] };

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
    .catch((err) => console.error('[bookStore] Не вдалося зберегти books.json:', err));
  return writeChain as Promise<void>;
}

function useJson(): boolean {
  return !isAvailable();
}

/** Лише для тестів: скидає кеш JSON-бекенду. */
export function __resetBookCacheForTests(): void {
  jsonCache = null;
}

// ---------------------------------------------------------------------------
// Джерело книги
// ---------------------------------------------------------------------------

function rowToBook(row: any): StoredBook {
  let book: Record<string, unknown> = {};
  try {
    book = JSON.parse(String(row.payload)) as Record<string, unknown>;
  } catch {
    // Пошкоджений JSON — віддаємо порожню книгу, але НЕ кидаємо: інакше
    // один зіпсований рядок робив би недоступним увесь перелік.
    book = {};
  }
  return {
    id: String(row.id),
    ownerId: row.owner_id ? String(row.owner_id) : null,
    title: String(row.title || ''),
    revision: Number(row.revision) || 1,
    book,
    sizeBytes: Number(row.size_bytes) || 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function getBook(id: string): Promise<StoredBook | null> {
  const bookId = String(id || '').trim();
  if (!bookId) return null;
  if (useJson()) {
    return (await loadJson()).books.find((b) => b.id === bookId) ?? null;
  }
  const row = getDb()!.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  return row ? rowToBook(row) : null;
}

export async function listBooks(ownerId?: string | null): Promise<
  Array<Omit<StoredBook, 'book'>>
> {
  const strip = (b: StoredBook) => {
    const { book: _ignored, ...rest } = b;
    return rest;
  };
  if (useJson()) {
    const all = (await loadJson()).books
      .filter((b) => (ownerId ? b.ownerId === ownerId : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return all.map(strip);
  }
  const rows = ownerId
    ? getDb()!
        .prepare('SELECT * FROM books WHERE owner_id = ? ORDER BY updated_at DESC')
        .all(ownerId)
    : getDb()!.prepare('SELECT * FROM books ORDER BY updated_at DESC').all();
  return (rows as any[]).map((r) => strip(rowToBook(r)));
}

/**
 * Зберегти книгу.
 *
 * `expectedRevision` — ревізія, яку клієнт бачив. `undefined` дозволено лише
 * для першого запису: інакше «я не знаю, що там було» ставало б способом
 * затерти чужу роботу, а саме від цього ревізія й захищає.
 */
export async function saveBook(params: {
  book: Record<string, unknown>;
  ownerId?: string | null;
  expectedRevision?: number;
  now?: () => Date;
}): Promise<StoredBook> {
  const book = params.book || {};
  const id = String((book as any).id || '').trim();
  if (!id) throw new Error('Книга без id — зберігати нікуди.');

  const title = String((book as any).title || '').slice(0, 300);
  const payload = JSON.stringify(book);
  const sizeBytes = Buffer.byteLength(payload, 'utf8');
  const at = (params.now?.() ?? new Date()).toISOString();

  const existing = await getBook(id);
  if (existing) {
    if (params.expectedRevision === undefined) {
      throw new BookRevisionConflict(existing.revision, 0);
    }
    if (Number(params.expectedRevision) !== existing.revision) {
      throw new BookRevisionConflict(existing.revision, Number(params.expectedRevision));
    }
  }

  const next: StoredBook = {
    id,
    // Власника не перезаписуємо чужим значенням: книга належить тому, хто її
    // створив, і «зберіг останнім» не робить нікого власником.
    ownerId: existing?.ownerId ?? (params.ownerId ? String(params.ownerId) : null),
    title,
    revision: existing ? existing.revision + 1 : 1,
    book,
    sizeBytes,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };

  if (useJson()) {
    const data = await loadJson();
    const at_i = data.books.findIndex((b) => b.id === id);
    if (at_i >= 0) data.books[at_i] = next;
    else data.books.push(next);
    await persistJson();
    return next;
  }

  getDb()!
    .prepare(
      `INSERT INTO books (id, owner_id, title, revision, payload, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         owner_id = excluded.owner_id,
         title = excluded.title,
         revision = excluded.revision,
         payload = excluded.payload,
         size_bytes = excluded.size_bytes,
         updated_at = excluded.updated_at`
    )
    .run(
      next.id,
      next.ownerId,
      next.title,
      next.revision,
      payload,
      next.sizeBytes,
      next.createdAt,
      next.updatedAt
    );
  return next;
}

// ---------------------------------------------------------------------------
// Зверстані файли
// ---------------------------------------------------------------------------

/** Імʼя без сюрпризів: у ключ артефакту йде id книги, а не введений текст. */
function artifactKey(bookId: string, kind: ArtifactKind, format: ArtifactFormat): string {
  return `${bookId}:${kind}:${format}`;
}

function bookDir(bookId: string): string {
  // Ім'я теки — тільки безпечні символи id: він приходить із клієнта, і
  // «../» у ньому не має вивести запис за межі DATA_DIR.
  return path.join(BOOK_FILES_ROOT, bookId.replace(/[^A-Za-z0-9._-]/g, '_'));
}

function rowToArtifact(row: any): StoredArtifact {
  return {
    id: String(row.id),
    bookId: String(row.book_id),
    kind: String(row.kind) as ArtifactKind,
    format: String(row.format) as ArtifactFormat,
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes) || 0,
    pageCount: row.page_count === null || row.page_count === undefined ? null : Number(row.page_count),
    variant: row.variant ? String(row.variant) : null,
    bookRevision: Number(row.book_revision) || 0,
    builtAt: String(row.built_at),
  };
}

/**
 * Покласти зверстаний файл поруч із книгою.
 *
 * Файл на диску перезаписується: артефакт одного виду й формату існує в
 * одному екземплярі — це завжди «поточний зібраний». Історія версій — це
 * інша задача, і робити її мовчазним побічним ефектом рендера не можна.
 */
export async function saveArtifact(params: {
  bookId: string;
  kind: ArtifactKind;
  format?: ArtifactFormat;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  pageCount?: number | null;
  variant?: string | null;
  bookRevision?: number;
  now?: () => Date;
}): Promise<StoredArtifact> {
  const bookId = String(params.bookId || '').trim();
  if (!bookId) throw new Error('Артефакт без id книги.');
  const format: ArtifactFormat = params.format === 'print' ? 'print' : 'digital';
  const at = (params.now?.() ?? new Date()).toISOString();

  const dir = bookDir(bookId);
  await fs.mkdir(dir, { recursive: true });
  const safeName = `${params.kind}-${format}${path.extname(params.filename) || ''}`;
  await fs.writeFile(path.join(dir, safeName), params.bytes);

  const record: StoredArtifact = {
    id: artifactKey(bookId, params.kind, format),
    bookId,
    kind: params.kind,
    format,
    filename: params.filename,
    mimeType: params.mimeType,
    sizeBytes: params.bytes.length,
    pageCount: params.pageCount ?? null,
    variant: params.variant ?? null,
    bookRevision: Number(params.bookRevision) || 0,
    builtAt: at,
  };

  if (useJson()) {
    const data = await loadJson();
    const i = data.artifacts.findIndex((a) => a.id === record.id);
    if (i >= 0) data.artifacts[i] = record;
    else data.artifacts.push(record);
    await persistJson();
    return record;
  }

  getDb()!
    .prepare(
      `INSERT INTO book_artifacts
         (id, book_id, kind, format, filename, mime_type, size_bytes, page_count, variant, book_revision, built_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         filename = excluded.filename,
         mime_type = excluded.mime_type,
         size_bytes = excluded.size_bytes,
         page_count = excluded.page_count,
         variant = excluded.variant,
         book_revision = excluded.book_revision,
         built_at = excluded.built_at`
    )
    .run(
      record.id,
      record.bookId,
      record.kind,
      record.format,
      record.filename,
      record.mimeType,
      record.sizeBytes,
      record.pageCount,
      record.variant,
      record.bookRevision,
      record.builtAt
    );
  return record;
}

/** Опис усіх зверстаних файлів книги. Самих байтів тут немає — див. readArtifact. */
export async function listArtifacts(bookId: string): Promise<StoredArtifact[]> {
  const id = String(bookId || '').trim();
  if (!id) return [];
  if (useJson()) {
    return (await loadJson()).artifacts.filter((a) => a.bookId === id);
  }
  const rows = getDb()!.prepare('SELECT * FROM book_artifacts WHERE book_id = ?').all(id);
  return (rows as any[]).map(rowToArtifact);
}

/** Байти зверстаного файла. `null` — опису немає або файл зник із диска. */
export async function readArtifact(
  bookId: string,
  kind: ArtifactKind,
  format: ArtifactFormat = 'digital'
): Promise<{ record: StoredArtifact; bytes: Uint8Array } | null> {
  const all = await listArtifacts(bookId);
  const record = all.find((a) => a.kind === kind && a.format === format);
  if (!record) return null;
  const safeName = `${kind}-${format}${path.extname(record.filename) || ''}`;
  try {
    const bytes = await fs.readFile(path.join(bookDir(bookId), safeName));
    return { record, bytes: new Uint8Array(bytes) };
  } catch {
    // Опис є, файла немає — це стан «треба перезібрати», а не помилка коду.
    return null;
  }
}
