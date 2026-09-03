/**
 * NOVA STUDIO — шар персистентності.
 *
 * Чому IndexedDB, а не localStorage:
 *   localStorage має квоту ~5 МБ на походження і синхронний API, який блокує
 *   головний потік. Роман на 90 000 слів у кирилиці серіалізується приблизно
 *   в 1,2 МБ JSON, а кожен знімок версії донедавна зберігав повну копію глав
 *   усередині того самого запису — квота вичерпувалась на четвертому коміті,
 *   після чого запис мовчки падав, а інтерфейс усе одно рапортував «збережено».
 *
 * Тут:
 *   • книга, знімки та службові ключі лежать в окремих сховищах IndexedDB;
 *   • важкі дані знімків (`snapshotData`) винесені з об'єкта книги;
 *   • помилки не проковтуються — виклик кидає StorageError із полем `kind`,
 *     щоб інтерфейс міг відрізнити переповнене сховище від інших збоїв;
 *   • є автоматична міграція зі старих ключів localStorage;
 *   • якщо IndexedDB недоступний (приватний режим у деяких браузерах),
 *     шар прозоро відкочується на localStorage зі збереженням async-API.
 */

import type { Book, BookVersionSnapshot } from '../types';

const DB_NAME = 'nova_studio';
const DB_VERSION = 1;

const STORE_BOOKS = 'books';
const STORE_SNAPSHOTS = 'snapshots';
const STORE_META = 'meta';

/** Ключі у сховищі meta. */
export const META_CHANGELOG = 'changelog';
export const META_ROLE = 'user_role';
export const META_ACTIVE_BOOK = 'active_book_id';
/** Роль, зафіксована прийнятим cowork-запрошенням для конкретної книги (App.tsx). */
export const META_COWORK_LOCK = 'cowork_lock';

/** Старі ключі localStorage — читаються один раз під час міграції. */
const LEGACY_BOOK = 'nova_glass_book';
const LEGACY_CHANGELOG = 'nova_glass_changelog';
const LEGACY_ROLE = 'nova_glass_user_role';
const LEGACY_MIGRATED_FLAG = 'nova_glass_migrated_to_idb';

export type StorageErrorKind = 'quota' | 'unavailable' | 'unknown';

export class StorageError extends Error {
  kind: StorageErrorKind;
  cause?: unknown;

  constructor(kind: StorageErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.kind = kind;
    this.cause = cause;
  }
}

/** Розпізнає переповнення сховища серед різних діалектів помилок браузерів. */
function classifyError(err: unknown): StorageErrorKind {
  const e = err as { name?: string; code?: number; message?: string } | null;
  if (!e) return 'unknown';
  const name = e.name || '';
  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  ) {
    return 'quota';
  }
  return 'unknown';
}

function humanMessage(kind: StorageErrorKind): string {
  switch (kind) {
    case 'quota':
      return 'Сховище браузера переповнене — зміни не збережено. Експортуйте книгу у файл і звільніть місце.';
    case 'unavailable':
      return 'Сховище браузера недоступне (можливо, увімкнено приватний режим).';
    default:
      return 'Не вдалося зберегти зміни у сховище браузера.';
  }
}

// ---------------------------------------------------------------------------
// Низькорівневий доступ до IndexedDB
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;
/** Стає true, якщо IndexedDB не відкрився і ми працюємо через localStorage. */
let usingFallback = false;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('unavailable', humanMessage('unavailable')));
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(new StorageError('unavailable', humanMessage('unavailable'), err));
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const store = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
        store.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new StorageError('unavailable', humanMessage('unavailable'), request.error));
    request.onblocked = () =>
      reject(new StorageError('unavailable', 'Сховище заблоковане іншою вкладкою.', null));
  });

  return dbPromise;
}

function idbPut(storeName: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(storeName, 'readwrite');
        } catch (err) {
          reject(new StorageError('unknown', humanMessage('unknown'), err));
          return;
        }
        tx.objectStore(storeName).put(value);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => {
          const kind = classifyError(tx.error);
          reject(new StorageError(kind, humanMessage(kind), tx.error));
        };
      })
  );
}

function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(new StorageError('unknown', humanMessage('unknown'), req.error));
      })
  );
}

function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(new StorageError('unknown', humanMessage('unknown'), tx.error));
      })
  );
}

function idbGetAll<T>(storeName: string): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve((req.result || []) as T[]);
        req.onerror = () => reject(new StorageError('unknown', humanMessage('unknown'), req.error));
      })
  );
}

function idbGetAllByIndex<T>(storeName: string, indexName: string, key: IDBValidKey): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).index(indexName).getAll(key);
        req.onsuccess = () => resolve((req.result || []) as T[]);
        req.onerror = () => reject(new StorageError('unknown', humanMessage('unknown'), req.error));
      })
  );
}

// ---------------------------------------------------------------------------
// Відкат на localStorage
// ---------------------------------------------------------------------------

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    const kind = classifyError(err);
    throw new StorageError(kind, humanMessage(kind), err);
  }
}

function lsGet<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Перевіряє IndexedDB один раз і вмикає відкат, якщо він недоступний. */
async function ensureBackend(): Promise<void> {
  if (usingFallback) return;
  try {
    await openDb();
  } catch (err) {
    usingFallback = true;
    console.warn('[storage] IndexedDB недоступний, працюємо через localStorage', err);
  }
}

// ---------------------------------------------------------------------------
// Публічний API
// ---------------------------------------------------------------------------

interface BookRecord {
  id: string;
  data: Book;
  updatedAt: string;
}

interface SnapshotRecord {
  id: string;
  bookId: string;
  data: Partial<Book>;
}

/** Прибирає важкий `snapshotData` з історії версій перед записом книги. */
function stripSnapshotPayloads(book: Book): Book {
  if (!book.versionHistory || book.versionHistory.length === 0) return book;
  const lean = book.versionHistory.map((snap) => {
    if (!snap.snapshotData) return snap;
    const { snapshotData, ...rest } = snap;
    return rest as BookVersionSnapshot;
  });
  return { ...book, versionHistory: lean };
}

/**
 * Зберігає книгу. Важкі дані знімків до запису не потрапляють — вони живуть
 * в окремому сховищі й підвантажуються лише в момент відновлення версії.
 */
export async function saveBook(book: Book): Promise<void> {
  await ensureBackend();
  const id = book.id || 'default';
  const lean = stripSnapshotPayloads(book);

  if (usingFallback) {
    lsSet(`nova_book_${id}`, lean);
    lsSet(`nova_meta_${META_ACTIVE_BOOK}`, id);
    return;
  }

  const record: BookRecord = { id, data: lean, updatedAt: new Date().toISOString() };
  await idbPut(STORE_BOOKS, record);
  await saveMeta(META_ACTIVE_BOOK, id);
  void mirrorBookToServer(lean);
}

/**
 * Ревізії книг на сервері: id → остання відома нам ревізія.
 *
 * Тримаємо в памʼяті вкладки, а не в IndexedDB: ревізія має значення лише в
 * межах сеансу роботи. Після перезавантаження перший запис піде без ревізії,
 * сервер відповість конфліктом, і ми дізнаємось поточну — це правильна
 * поведінка, а не збій: вкладка, яка щойно відкрилась, справді не знає, що
 * там сталося без неї.
 */
const serverRevisions = new Map<string, number>();

/**
 * Копія книги на сервері.
 *
 * НАВІЩО. Досі рукопис жив лише в IndexedDB одного браузера: очищене
 * сховище, інший компʼютер, приватне вікно — і книги немає ніде. Тепер
 * кожне збереження надсилає ту саму книгу на сервер, звідки її можна
 * відновити й, головне, опублікувати без цього браузера.
 *
 * ЧОМУ ТИХО Й НЕ БЛОКУЮЧИ. Локальний запис уже стався — книга в безпеці на
 * цьому компʼютері. Якщо мережі немає або сервер відмовив, автор не має
 * побачити помилку посеред набору тексту: наступне збереження спробує
 * знову. Мовчить лише УСПІХ і мережевий збій; конфлікт ревізій пишемо в
 * консоль, бо він означає, що книгу правлять ще десь.
 */
async function mirrorBookToServer(book: Book): Promise<void> {
  const id = book.id;
  if (!id) return;
  try {
    const known = serverRevisions.get(id);
    const res = await fetch(`/api/books/${encodeURIComponent(id)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book, expectedRevision: known }),
    });
    if (res.ok) {
      const meta = await res.json();
      if (typeof meta?.revision === 'number') serverRevisions.set(id, meta.revision);
      return;
    }
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      // Приймаємо ревізію сервера, але НЕ перезаписуємо його даних мовчки:
      // наступне збереження піде з правильною ревізією й пройде. Автор при
      // цьому міг затерти чужі правки — тому подія лишається в консолі.
      if (typeof data?.current === 'number') serverRevisions.set(id, data.current);
      console.warn('[storage] книгу правлять ще десь; ревізію оновлено на', data?.current);
      return;
    }
    if (res.status === 401 || res.status === 403) return; // гість — копії на сервері не буде
    console.warn('[storage] серверна копія не збереглась:', res.status);
  } catch {
    // Мережі немає — локальний запис уже відбувся, спробуємо наступного разу.
  }
}

/** Завантажує книгу за id; без id — останню активну. */
export async function loadBook(bookId?: string): Promise<Book | undefined> {
  await ensureBackend();
  const id = bookId || (await loadMeta<string>(META_ACTIVE_BOOK));
  if (!id) return undefined;

  if (usingFallback) {
    return lsGet<Book>(`nova_book_${id}`);
  }

  const rec = await idbGet<BookRecord>(STORE_BOOKS, id);
  return rec?.data;
}

/**
 * Список усіх книг письменника (метадані — не повні дані, щоб не тягнути
 * важкі глави в пам'ять лише заради хаб-сторінки/списку). Раніше такої
 * функції не існувало — застосунок завжди працював з однією активною
 * книгою (META_ACTIVE_BOOK), без огляду списку інших.
 */
export interface BookSummary {
  id: string;
  title: string;
  status: Book['status'];
  updatedAt: string;
}

export async function listBooks(): Promise<BookSummary[]> {
  await ensureBackend();
  if (usingFallback) {
    const summaries: BookSummary[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('nova_book_')) continue;
      const book = lsGet<Book>(key);
      if (!book) continue;
      summaries.push({
        id: book.id || key.slice('nova_book_'.length),
        title: book.title || 'Без назви',
        status: book.status,
        updatedAt: book.updatedAt || '',
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const records = await idbGetAll<BookRecord>(STORE_BOOKS);
  return records
    .map((r) => ({
      id: r.data.id || r.id,
      title: r.data.title || 'Без назви',
      status: r.data.status,
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Зберігає повний зліпок стану книги окремо від самої книги. */
export async function saveSnapshotData(
  snapshotId: string,
  bookId: string,
  data: Partial<Book>
): Promise<void> {
  await ensureBackend();
  if (usingFallback) {
    lsSet(`nova_snap_${snapshotId}`, { id: snapshotId, bookId, data });
    return;
  }
  const record: SnapshotRecord = { id: snapshotId, bookId, data };
  await idbPut(STORE_SNAPSHOTS, record);
}

/** Підвантажує зліпок у момент відновлення версії. */
export async function loadSnapshotData(snapshotId: string): Promise<Partial<Book> | undefined> {
  await ensureBackend();
  if (usingFallback) {
    return lsGet<SnapshotRecord>(`nova_snap_${snapshotId}`)?.data;
  }
  const rec = await idbGet<SnapshotRecord>(STORE_SNAPSHOTS, snapshotId);
  return rec?.data;
}

export async function deleteSnapshotData(snapshotId: string): Promise<void> {
  await ensureBackend();
  if (usingFallback) {
    try {
      localStorage.removeItem(`nova_snap_${snapshotId}`);
    } catch {
      /* ігноруємо */
    }
    return;
  }
  await idbDelete(STORE_SNAPSHOTS, snapshotId);
}

export async function listSnapshotIds(bookId: string): Promise<string[]> {
  await ensureBackend();
  if (usingFallback) return [];
  const rows = await idbGetAllByIndex<SnapshotRecord>(STORE_SNAPSHOTS, 'bookId', bookId);
  return rows.map((r) => r.id);
}

export async function saveMeta(key: string, value: unknown): Promise<void> {
  await ensureBackend();
  if (usingFallback) {
    lsSet(`nova_meta_${key}`, value);
    return;
  }
  await idbPut(STORE_META, { key, value });
}

export async function loadMeta<T>(key: string): Promise<T | undefined> {
  await ensureBackend();
  if (usingFallback) {
    return lsGet<T>(`nova_meta_${key}`);
  }
  const rec = await idbGet<{ key: string; value: T }>(STORE_META, key);
  return rec?.value;
}

/**
 * Одноразовий перенос даних зі старих ключів localStorage.
 * Старі ключі не видаляються — залишаються як аварійна копія доти,
 * доки користувач сам не очистить дані сайту.
 */
export async function migrateFromLocalStorage(): Promise<boolean> {
  await ensureBackend();
  if (usingFallback) return false;

  try {
    if (localStorage.getItem(LEGACY_MIGRATED_FLAG) === 'done') return false;
  } catch {
    return false;
  }

  const legacyBook = lsGet<Book>(LEGACY_BOOK);
  if (!legacyBook) {
    try {
      localStorage.setItem(LEGACY_MIGRATED_FLAG, 'done');
    } catch {
      /* ігноруємо */
    }
    return false;
  }

  // Зліпки зі старої книги переносимо в окреме сховище.
  for (const snap of legacyBook.versionHistory || []) {
    if (snap.snapshotData) {
      await saveSnapshotData(snap.id, legacyBook.id || 'default', snap.snapshotData);
    }
  }

  await saveBook(legacyBook);

  const legacyLog = lsGet<unknown[]>(LEGACY_CHANGELOG);
  if (legacyLog) await saveMeta(META_CHANGELOG, legacyLog);

  try {
    const legacyRole = localStorage.getItem(LEGACY_ROLE);
    if (legacyRole) await saveMeta(META_ROLE, legacyRole);
    localStorage.setItem(LEGACY_MIGRATED_FLAG, 'done');
  } catch {
    /* ігноруємо */
  }

  return true;
}

/** Оцінка зайнятого місця для індикатора в налаштуваннях. */
export async function estimateUsage(): Promise<{ usedBytes: number; quotaBytes: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    return { usedBytes: est.usage || 0, quotaBytes: est.quota || 0 };
  } catch {
    return null;
  }
}

/** Чи працює шар у режимі відкату (для діагностики в UI). */
export function isUsingFallback(): boolean {
  return usingFallback;
}
