/**
 * Клієнт локального сервера приватного сховища (журнал #549, запит власника 11.11.2026).
 *
 * Приватні книги, курси й інструкції браузер автора зберігає НАПРЯМУ на його локальному сервері (Docker, services/private-store):
 * Studio видає лише короткий підписаний токен (`POST /api/private-store/:id/token`) і більше нічого про вміст не знає.
 * Хмара лишається типовим сховищем — сюди потрапляє лише матеріал із позначкою `privateStore`.
 *
 * Модуль без залежностей від решти застосунку: його викликають сховище книг, дашборд і курси.
 */

export type PrivateKind = 'book' | 'course' | 'instruction' | 'scan';

export interface PrivateStoreInfo {
  id: string;
  name: string;
  endpoint: string;
  kinds: PrivateKind[];
  /** Студія бачить пульс сервера (він «в мережі»). */
  online: boolean;
  lastSeen: string | null;
  /** Цей браузер справді дістається сервера (перевірено запитом /v1/health). */
  reachable?: boolean;
}

export interface PrivateDocSummary {
  id: string;
  kind: PrivateKind;
  revision: number;
  createdAt: string;
  updatedAt: string;
  size: number;
  meta: { title?: string; [key: string]: unknown };
}

export type PrivateErrorKind = 'unreachable' | 'unauthorized' | 'conflict' | 'not_found' | 'rejected' | 'server';

export class PrivateStoreError extends Error {
  constructor(public kind: PrivateErrorKind, message: string, public status = 0, public current?: number) {
    super(message);
    this.name = 'PrivateStoreError';
  }
}

const UNREACHABLE = 'Локальний сервер недоступний. Перевірте, що контейнер запущено на цьому комп’ютері (docker compose ps).';

// ---------------------------------------------------------------------------
// Токени
// ---------------------------------------------------------------------------

interface Access {
  token: string;
  endpoint: string;
  expMs: number;
}
const tokens = new Map<string, Access>();

async function accessFor(storeId: string, force = false): Promise<Access> {
  const hit = tokens.get(storeId);
  if (!force && hit && hit.expMs - Date.now() > 60_000) return hit;
  let res: Response;
  try {
    res = await fetch(`/api/private-store/${encodeURIComponent(storeId)}/token`, { method: 'POST', credentials: 'same-origin' });
  } catch {
    throw new PrivateStoreError('unreachable', 'Немає звʼязку зі Studio, щоб отримати доступ до локального сервера.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PrivateStoreError(res.status === 401 || res.status === 403 ? 'unauthorized' : res.status === 409 ? 'rejected' : 'server', data?.error || 'Studio не видала доступ до локального сервера.', res.status);
  }
  const entry: Access = { token: String(data.token), endpoint: String(data.endpoint).replace(/\/$/, ''), expMs: Date.parse(data.expiresAt) };
  tokens.set(storeId, entry);
  return entry;
}

/** Запит до локального сервера: токен підставляється й оновлюється сам (один повтор після 401). */
async function vaultFetch(storeId: string, method: string, path: string, body?: unknown, raw?: { blob: Blob; type: string }): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const access = await accessFor(storeId, attempt === 1);
    const headers: Record<string, string> = { Authorization: `Bearer ${access.token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (raw) headers['Content-Type'] = raw.type;
    let res: Response;
    try {
      res = await fetch(`${access.endpoint}${path}`, {
        method,
        headers,
        body: raw ? raw.blob : body !== undefined ? JSON.stringify(body) : undefined,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new PrivateStoreError('unreachable', UNREACHABLE);
    }
    if (res.status === 401 && attempt === 0) continue;
    return res;
  }
  throw new PrivateStoreError('unauthorized', 'Локальний сервер не прийняв доступ. Оновіть сторінку.', 401);
}

async function expectJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data as T;
  const message = String(data?.error || `Помилка локального сервера (${res.status}).`);
  if (res.status === 409 && data?.kind === 'revision_conflict') throw new PrivateStoreError('conflict', message, 409, data.current);
  if (res.status === 404) throw new PrivateStoreError('not_found', message, 404);
  if (res.status === 401) throw new PrivateStoreError('unauthorized', message, 401);
  if (res.status === 403 || res.status === 503) throw new PrivateStoreError('rejected', message, res.status);
  throw new PrivateStoreError('server', message, res.status);
}

// ---------------------------------------------------------------------------
// Перелік серверів користувача
// ---------------------------------------------------------------------------

/** Сервери, призначені цьому користувачеві (Studio). Гість чи збій — порожній перелік. */
export async function fetchMyPrivateStores(): Promise<PrivateStoreInfo[]> {
  try {
    const res = await fetch('/api/private-store/mine', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.stores) ? (data.stores as PrivateStoreInfo[]) : [];
  } catch {
    return [];
  }
}

/** Чи дістається ЦЕЙ браузер сервера: health відкритий, але перевіряє Host і Origin — тож помилка тут означає й неправильні налаштування. */
export async function probePrivateStore(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, '')}/v1/health`, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.ok === true && data?.status === 'active';
  } catch {
    return false;
  }
}

/** Сервери, на які цей користувач справді може писати зараз: призначені, «в мережі» за пульсом і досяжні з цього браузера. */
export async function usablePrivateStores(kind?: PrivateKind): Promise<PrivateStoreInfo[]> {
  const all = (await fetchMyPrivateStores()).filter((s) => s.online && (!kind || s.kinds.includes(kind)));
  return Promise.all(all.map(async (s) => ({ ...s, reachable: await probePrivateStore(s.endpoint) })));
}

// ---------------------------------------------------------------------------
// Записи
// ---------------------------------------------------------------------------

export async function listPrivateDocs(storeId: string, kind?: PrivateKind): Promise<PrivateDocSummary[]> {
  const res = await vaultFetch(storeId, 'GET', `/v1/docs${kind ? `?kind=${kind}` : ''}`);
  return (await expectJson<{ docs: PrivateDocSummary[] }>(res)).docs;
}

export interface PrivateDoc extends PrivateDocSummary {
  payload: Record<string, unknown>;
}

export async function getPrivateDoc(storeId: string, id: string): Promise<PrivateDoc> {
  const res = await vaultFetch(storeId, 'GET', `/v1/docs/${encodeURIComponent(id)}`);
  const doc = (await expectJson<{ doc: PrivateDoc }>(res)).doc;
  revisions.set(`${storeId}:${id}`, doc.revision);
  return doc;
}

/** Остання відома ревізія запису (у памʼяті вкладки): наступний запис іде з очікуваною ревізією, тож чужа правка не затреться мовчки. */
const revisions = new Map<string, number>();

export async function putPrivateDoc(storeId: string, doc: { id: string; kind: PrivateKind; meta: Record<string, unknown>; payload: Record<string, unknown> }): Promise<number> {
  const key = `${storeId}:${doc.id}`;
  const expectedRevision = revisions.get(key);
  const res = await vaultFetch(storeId, 'PUT', `/v1/docs/${encodeURIComponent(doc.id)}`, { kind: doc.kind, meta: doc.meta, payload: doc.payload, ...(expectedRevision ? { expectedRevision } : {}) });
  try {
    const out = await expectJson<{ revision: number }>(res);
    revisions.set(key, out.revision);
    return out.revision;
  } catch (err) {
    // Конфлікт: приймаємо поточну ревізію (наступне збереження пройде), але запис не втрачається мовчки — викликач показує попередження.
    if (err instanceof PrivateStoreError && err.kind === 'conflict' && typeof err.current === 'number') revisions.set(key, err.current);
    throw err;
  }
}

export async function deletePrivateDoc(storeId: string, id: string): Promise<void> {
  const res = await vaultFetch(storeId, 'DELETE', `/v1/docs/${encodeURIComponent(id)}`);
  if (res.status === 404) return; // уже немає — мета досягнута
  await expectJson(res);
  revisions.delete(`${storeId}:${id}`);
}

// ---------------------------------------------------------------------------
// «Вхідні з телефона» (журнал #550): знімки, запечатані на телефоні й розпечатані лише сервером; розпізнавання теж на сервері
// ---------------------------------------------------------------------------

export type ScanEngine = 'tesseract' | 'ollama';
export type ScanQuality = 'good' | 'fair' | 'poor' | 'unknown';

export interface ScanOcr {
  status: 'idle' | 'queued' | 'running' | 'done' | 'failed';
  engine?: ScanEngine;
  model?: string;
  text?: string;
  /** Текст, як його розпізнав рушій (до ручної правки). */
  original?: string;
  confidence?: number | null;
  quality?: ScanQuality;
  /** Слова, у яких рушій не впевнений (для підсвічування). */
  uncertain?: string[];
  usedPrep?: boolean;
  angle?: number | null;
  ms?: number;
  error?: string | null;
  unreadable?: number;
  at?: string;
}

export interface ScanPage {
  pageId: string;
  order: number;
  assetId: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  receivedAt: string;
  note?: string;
  textEdited: boolean;
  ocr: ScanOcr;
}

export interface ScanDraft {
  v: 1;
  draftId: string;
  kind: 'course' | 'instruction' | 'manuscript';
  courseSource?: 'photos' | 'document' | null;
  instructionMode?: 'assembly' | 'operation' | null;
  modelCode?: string;
  title?: string;
  craft?: string;
  audience?: string;
  newBookTitle?: string;
  createdAt: string;
  updatedAt: string;
  pages: ScanPage[];
  consumed?: { kind: 'book' | 'course' | 'instruction'; id: string; at: string };
}

export interface ScanEngines {
  tesseract: { available: boolean; reason?: string; langs?: string[] };
  ollama: { configured: boolean; available: boolean; model: string; models: string[]; modelReady?: boolean; reason?: string };
}

export async function fetchScanEngines(storeId: string): Promise<ScanEngines> {
  return expectJson<ScanEngines>(await vaultFetch(storeId, 'GET', '/v1/engines'));
}

/** Поставити сторінку в чергу розпізнавання на сервері; результат з'явиться в чернетці (опитуйте її). */
export async function recognizeScanPage(storeId: string, docId: string, pageId: string, engine: ScanEngine, model?: string): Promise<void> {
  await expectJson(await vaultFetch(storeId, 'POST', `/v1/scans/${encodeURIComponent(docId)}/recognize`, { pageId, engine, ...(model ? { model } : {}) }));
}

export async function saveScanPageText(storeId: string, docId: string, pageId: string, text: string): Promise<void> {
  await expectJson(await vaultFetch(storeId, 'PUT', `/v1/scans/${encodeURIComponent(docId)}/pages/${encodeURIComponent(pageId)}/text`, { text }));
}

export async function deleteScanPage(storeId: string, docId: string, pageId: string): Promise<void> {
  await expectJson(await vaultFetch(storeId, 'DELETE', `/v1/scans/${encodeURIComponent(docId)}/pages/${encodeURIComponent(pageId)}`));
}

/** Шапка чернетки: назва, вид, джерело, позначка «створено матеріал». */
export async function editScanDraft(
  storeId: string,
  docId: string,
  patch: Partial<Pick<ScanDraft, 'title' | 'kind' | 'courseSource' | 'instructionMode' | 'modelCode' | 'craft' | 'audience' | 'newBookTitle'>> & { consumed?: { kind: 'book' | 'course' | 'instruction'; id: string } | null }
): Promise<void> {
  await expectJson(await vaultFetch(storeId, 'POST', `/v1/scans/${encodeURIComponent(docId)}/edit`, patch));
}

export async function putPrivateAsset(storeId: string, id: string, docId: string, blob: Blob): Promise<void> {
  const res = await vaultFetch(storeId, 'PUT', `/v1/assets/${encodeURIComponent(id)}?doc=${encodeURIComponent(docId)}`, undefined, { blob, type: blob.type || 'image/png' });
  await expectJson(res);
}

export async function getPrivateAsset(storeId: string, id: string): Promise<Blob> {
  const res = await vaultFetch(storeId, 'GET', `/v1/assets/${encodeURIComponent(id)}`);
  if (!res.ok) await expectJson(res);
  return res.blob();
}

// ---------------------------------------------------------------------------
// Вибір «приватне» на час створення
// ---------------------------------------------------------------------------

/**
 * Галочка «Приватне збереження» стоїть у вікні вибору способу створення, а сам матеріал створює інший компонент (візард, чиста
 * книга, майстер курсу). Щоб не пробрасувати прапорець крізь усі пропси, вибір лежить тут до першого створення: той, хто створює,
 * забирає його одноразово (`takePendingPrivateStore`), а закриття вікна його скидає.
 */
let pendingStoreId: string | null = null;
export function setPendingPrivateStore(storeId: string | null): void {
  pendingStoreId = storeId;
}
export function takePendingPrivateStore(): string | null {
  const id = pendingStoreId;
  pendingStoreId = null;
  return id;
}

/**
 * «Відкрити» приватну інструкцію з дашборда: розділ-одержувач (конструктор) монтується вже після переходу, тож адресу
 * він забирає з цього слота одноразово — так само, як `takePendingPrivateStore` для галочки при створенні.
 */
let pendingOpen: { kind: PrivateKind; storeId: string; id: string } | null = null;
export function setPendingPrivateOpen(value: { kind: PrivateKind; storeId: string; id: string } | null): void {
  pendingOpen = value;
}
export function takePendingPrivateOpen(kind: PrivateKind): { storeId: string; id: string } | null {
  if (!pendingOpen || pendingOpen.kind !== kind) return null;
  const hit = { storeId: pendingOpen.storeId, id: pendingOpen.id };
  pendingOpen = null;
  return hit;
}

// ---------------------------------------------------------------------------
// Стан синхронізації для інтерфейсу
// ---------------------------------------------------------------------------

export type PrivateSyncStatus = 'synced' | 'offline' | 'conflict' | 'error';
export interface PrivateSyncEvent {
  storeId: string;
  id: string;
  status: PrivateSyncStatus;
  message?: string;
  at: string;
}
const EVENT = 'nova:private-sync';

export function emitPrivateSync(ev: Omit<PrivateSyncEvent, 'at'>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PrivateSyncEvent>(EVENT, { detail: { ...ev, at: new Date().toISOString() } }));
}

export function onPrivateSync(handler: (ev: PrivateSyncEvent) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (e: Event) => handler((e as CustomEvent<PrivateSyncEvent>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** Записує приватний матеріал і повідомляє інтерфейс про результат. Помилка не кидається: локальна копія в браузері вже збережена. */
export async function syncPrivateDoc(storeId: string, doc: { id: string; kind: PrivateKind; meta: Record<string, unknown>; payload: Record<string, unknown> }): Promise<boolean> {
  try {
    await putPrivateDoc(storeId, doc);
    emitPrivateSync({ storeId, id: doc.id, status: 'synced' });
    return true;
  } catch (err) {
    const e = err as PrivateStoreError;
    if (e.kind === 'conflict') emitPrivateSync({ storeId, id: doc.id, status: 'conflict', message: 'Матеріал на локальному сервері змінено з іншого місця. Збережено вашу версію після оновлення ревізії.' });
    else if (e.kind === 'unreachable') emitPrivateSync({ storeId, id: doc.id, status: 'offline', message: e.message });
    else emitPrivateSync({ storeId, id: doc.id, status: 'error', message: e.message });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Охоронець: приватний матеріал не йде в хмару
// ---------------------------------------------------------------------------

/**
 * Поки відкрито приватний матеріал, запити до серверних маршрутів, що ПРИЙМАЮТЬ вміст (ШІ, PDF, медіатека, публікація, чат,
 * співавтори…), блокуються: інакше кнопка ШІ чи експорту послала б текст у Studio й до моделі. Це страховка поверх прихованих кнопок:
 * надійніше за перелік місць, де про це можна забути. GET-запити не чіпаємо — вони вміст не передають.
 */
const BLOCKED_PREFIXES = [
  '/api/ai', '/api/publishing', '/api/express', '/api/core', '/api/books', '/api/thresholds', '/api/avoided-thresholds', '/api/pdf', '/api/style',
  '/api/media', '/api/gamma', '/api/courses', '/api/market', '/api/etsy', '/api/collaboration', '/api/chat', '/api/knowledge', '/api/table-ai',
  '/api/sync', '/api/scans', '/api/character', '/api/projects', '/api/realtime', '/api/geohome', '/api/narration', '/api/external',
];

/** Відкритих приватних матеріалів може бути кілька одразу (книга в редакторі, курс у студії курсів), тож слот на кожен вид. */
const activePrivate = new Map<PrivateKind, string>();

export function setActivePrivateMaterial(kind: PrivateKind, id: string | null): void {
  if (id) activePrivate.set(kind, id);
  else activePrivate.delete(kind);
}
export const isPrivateMaterialActive = (): boolean => activePrivate.size > 0;

export function blockedByPrivacy(method: string, pathname: string): boolean {
  if (activePrivate.size === 0) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false;
  const p = pathname.replace(/^\/studio(?=\/api\/)/, '');
  return BLOCKED_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

let guardInstalled = false;
/** Один раз із main.tsx, ПІСЛЯ installApiBasePath: загортає window.fetch. */
export function installPrivacyGuard(): void {
  if (guardInstalled || typeof window === 'undefined') return;
  guardInstalled = true;
  const inner = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, window.location.origin);
      const method = init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET');
      if (url.origin === window.location.origin && blockedByPrivacy(method, url.pathname)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: 'Недоступно для приватного матеріалу: він зберігається лише на вашому локальному сервері й не передається в хмару (ШІ, PDF, медіатека, публікація).',
              kind: 'private_blocked',
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
    } catch {
      /* незрозумілий вхід — пропускаємо до справжнього fetch */
    }
    return inner(input, init);
  };
}
