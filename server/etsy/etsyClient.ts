/**
 * HTTP-клієнт Etsy Open API v3.
 *
 * Один шар, який знає про транспорт усе, і решта модуля — нічого:
 *
 *  • **ліміт швидкості** — кожен виклик проходить через токен-бакет
 *    (10 запитів/сек на застосунок за ТЗ 4.1; бакетів два — публікаційний і
 *    дослідницький, див. rateLimiter.ts);
 *  • **повтори** — 429 і 5xx повторюються з експоненційним backoff, максимум
 *    5 спроб (ТЗ 4.5). 4xx, окрім 429, не повторюються ніколи: як би довго ми
 *    не чекали, «поле обов'язкове» само не виправиться;
 *  • **401** — один раз оновлюємо токен через `refreshToken` і повторюємо
 *    запит; якщо і після оновлення 401 — це вже не тимчасова проблема;
 *  • **журнал** — логуються метод, шлях, статус і тривалість. Токен у лог не
 *    потрапляє ніколи (ТЗ 8, «Спостережуваність… без чутливих даних токена»).
 *
 * `fetchImpl` і `sleep` впроваджуються ззовні — весь клієнт тестується без
 * мережі й без очікування реальних секунд.
 */

import { ETSY_API_BASE } from './etsyConfig';
import { computeBackoffDelayMs, isRetryableStatus, type TokenBucket } from './rateLimiter';
import type { FetchLike } from './etsyOAuth';

export class EtsyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Обрізане тіло відповіді — лише для серверного лога. */
    readonly rawBody = ''
  ) {
    super(message);
  }
}

export interface EtsyClientDeps {
  apiKey: string;
  fetchImpl: FetchLike;
  bucket: TokenBucket;
  /** Повертає чинний access-токен (клієнт сам його не зберігає). */
  getAccessToken: () => Promise<string>;
  /** Примусово оновлює токен після 401. null — оновити не вдалося. */
  refreshToken?: () => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  jitter?: () => number;
  /** Куди писати журнал викликів. За замовчуванням — console. */
  log?: (line: string) => void;
}

export interface EtsyRequestOptions {
  method?: string;
  /** JSON-тіло; взаємовиключне з `form`. */
  json?: unknown;
  /** Тіло multipart/form-data (завантаження файлів і зображень). */
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  /** Публічні ендпоінти дослідження працюють на самому лише x-api-key. */
  auth?: 'oauth' | 'apikey';
}

const DEFAULT_MAX_ATTEMPTS = 5;

function buildUrl(pathname: string, query?: EtsyRequestOptions['query']): string {
  const url = new URL(
    pathname.startsWith('http') ? pathname : `${ETSY_API_BASE}${pathname.startsWith('/') ? '' : '/'}${pathname}`
  );
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export interface EtsyClient {
  request<T = any>(pathname: string, options?: EtsyRequestOptions): Promise<T>;
}

export function createEtsyClient(deps: EtsyClientDeps): EtsyClient {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const log = deps.log ?? ((line: string) => console.log(line));

  async function request<T>(pathname: string, options: EtsyRequestOptions = {}): Promise<T> {
    const method = options.method || 'GET';
    const url = buildUrl(pathname, options.query);
    const useOAuth = (options.auth ?? 'oauth') === 'oauth';

    let token = useOAuth ? await deps.getAccessToken() : '';
    let refreshedOnce = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await deps.bucket.acquire();

      const headers: Record<string, string> = { 'x-api-key': deps.apiKey };
      if (useOAuth) headers.Authorization = `Bearer ${token}`;

      let body: unknown;
      if (options.form) {
        // Content-Type для multipart проставляє сам fetch — разом з boundary.
        body = options.form;
      } else if (options.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.json);
      }

      const startedAt = Date.now();
      let status = 0;
      let raw = '';
      try {
        const res = await deps.fetchImpl(url, { method, headers, body });
        status = res.status;
        raw = await res.text();
        const ms = Date.now() - startedAt;
        log(`[etsy] ${method} ${pathname} → ${status} за ${ms} мс (спроба ${attempt}/${maxAttempts})`);

        if (res.ok) {
          if (!raw) return undefined as T;
          try {
            return JSON.parse(raw) as T;
          } catch {
            throw new EtsyApiError('Etsy повернув відповідь, яку не вдалося прочитати як JSON.', status, raw.slice(0, 300));
          }
        }

        if (status === 401 && useOAuth && !refreshedOnce && deps.refreshToken) {
          // Рівно одна спроба оновлення: якщо свіжий токен теж дає 401,
          // проблема не в терміні дії, і крутити цикл далі безглуздо.
          refreshedOnce = true;
          const fresh = await deps.refreshToken();
          if (fresh) {
            token = fresh;
            continue;
          }
          throw new EtsyApiError(
            'Доступ до Etsy втрачено, і оновити його не вдалося. Підключіть крамницю ще раз на вкладці «Публікація».',
            401,
            raw.slice(0, 300)
          );
        }

        if (isRetryableStatus(status) && attempt < maxAttempts) {
          const delay = computeBackoffDelayMs(attempt, { jitter: deps.jitter });
          log(`[etsy] ${status} — повтор через ${delay} мс`);
          await sleep(delay);
          continue;
        }

        throw new EtsyApiError(describeStatus(status), status, raw.slice(0, 500));
      } catch (err) {
        if (err instanceof EtsyApiError) throw err;
        // Мережевий збій — теж привід повторити: обрив TCP нічим не кращий
        // за 503, і трапляється частіше.
        if (attempt < maxAttempts) {
          const delay = computeBackoffDelayMs(attempt, { jitter: deps.jitter });
          log(`[etsy] мережевий збій (${(err as Error)?.message}) — повтор через ${delay} мс`);
          await sleep(delay);
          continue;
        }
        throw new EtsyApiError(
          'Не вдалося зʼєднатися з Etsy. Перевірте мережу й спробуйте ще раз.',
          0,
          String((err as Error)?.message || err).slice(0, 300)
        );
      }
    }

    throw new EtsyApiError('Etsy не відповів після кількох спроб.', 504);
  }

  return { request };
}

function describeStatus(status: number): string {
  if (status === 400) return 'Etsy відхилив дані лістингу (400). Перевірте назву, ціну й категорію.';
  if (status === 403) return 'Etsy відмовив у доступі (403). Найімовірніше бракує дозволу listings_w для застосунку.';
  if (status === 404) return 'Etsy не знайшов ресурс (404). Можливо, лістинг або крамницю видалили.';
  if (status === 409) return 'Etsy повідомляє про конфлікт (409) — імовірно, такий лістинг уже існує.';
  if (status === 429) return 'Перевищено ліміт швидкості Etsy. Спробуйте ще раз за хвилину.';
  if (status >= 500) return 'Etsy тимчасово недоступний. Публікацію буде повторено автоматично.';
  return `Etsy повернув помилку ${status}.`;
}

// ---------------------------------------------------------------------------
// Тонкі обгортки над потрібними ендпоінтами
// ---------------------------------------------------------------------------

export interface EtsyShop {
  shop_id: number;
  shop_name: string;
}

export async function getMyShop(client: EtsyClient, etsyUserId: string): Promise<EtsyShop | undefined> {
  const res = await client.request<any>(`/application/users/${etsyUserId}/shops`);
  // Etsy повертає або один об'єкт, або сторінку з results — приймаємо обидва.
  if (res?.shop_id) return { shop_id: res.shop_id, shop_name: res.shop_name };
  const first = res?.results?.[0];
  return first ? { shop_id: first.shop_id, shop_name: first.shop_name } : undefined;
}

export interface CreateDraftListingInput {
  shopId: string;
  title: string;
  description: string;
  priceUsd: number;
  quantity?: number;
  taxonomyId?: number;
  tags?: string[];
  shopSectionId?: number;
}

/** ТЗ 4.3, крок [2]: createDraftListing з type="download". */
export async function createDraftListing(
  client: EtsyClient,
  input: CreateDraftListingInput
): Promise<{ listing_id: number; state: string; url?: string }> {
  const form = new FormData();
  form.set('quantity', String(input.quantity ?? 999));
  form.set('title', input.title);
  form.set('description', input.description);
  form.set('price', input.priceUsd.toFixed(2));
  form.set('who_made', 'i_did');
  form.set('when_made', 'made_to_order');
  form.set('taxonomy_id', String(input.taxonomyId ?? 6864)); // Digital Prints / Books за замовчуванням
  form.set('type', 'download');
  form.set('listing_type', 'download');
  if (input.shopSectionId) form.set('shop_section_id', String(input.shopSectionId));
  for (const tag of input.tags || []) form.append('tags', tag);

  return client.request(`/application/shops/${input.shopId}/listings`, { method: 'POST', form });
}

/** ТЗ 4.3, крок [3]: uploadListingImage. */
export async function uploadListingImage(
  client: EtsyClient,
  params: { shopId: string; listingId: string | number; fileName: string; bytes: Uint8Array; rank?: number }
): Promise<{ listing_image_id: number }> {
  const form = new FormData();
  form.set('image', new Blob([bufferOf(params.bytes)]), params.fileName);
  if (params.rank !== undefined) form.set('rank', String(params.rank));
  return client.request(
    `/application/shops/${params.shopId}/listings/${params.listingId}/images`,
    { method: 'POST', form }
  );
}

/** ТЗ 4.3, крок [4]: uploadListingFile. */
export async function uploadListingFile(
  client: EtsyClient,
  params: { shopId: string; listingId: string | number; fileName: string; bytes: Uint8Array; rank?: number }
): Promise<{ listing_file_id: number }> {
  const form = new FormData();
  form.set('file', new Blob([bufferOf(params.bytes)]), params.fileName);
  form.set('name', params.fileName);
  if (params.rank !== undefined) form.set('rank', String(params.rank));
  return client.request(
    `/application/shops/${params.shopId}/listings/${params.listingId}/files`,
    { method: 'POST', form }
  );
}

/** ТЗ 4.3, крок [5]: updateListing(state=active). */
export async function activateListing(
  client: EtsyClient,
  params: { shopId: string; listingId: string | number }
): Promise<{ listing_id: number; state: string; url?: string }> {
  const form = new FormData();
  form.set('state', 'active');
  return client.request(`/application/shops/${params.shopId}/listings/${params.listingId}`, {
    method: 'PATCH',
    form,
  });
}

export interface ActiveListingsQuery {
  keywords?: string;
  taxonomyId?: number;
  limit?: number;
  offset?: number;
  sortOn?: 'created' | 'price' | 'updated' | 'score';
  sortOrder?: 'asc' | 'desc';
}

/**
 * ТЗ 6.2 — публічний пошук активних лістингів. Працює на самому x-api-key,
 * без OAuth: дослідження теми має бути доступним і тим авторам, що ще не
 * підключили крамницю.
 */
export async function findAllActiveListings(
  client: EtsyClient,
  query: ActiveListingsQuery
): Promise<{ count: number; results: any[] }> {
  return client.request('/application/listings/active', {
    auth: 'apikey',
    query: {
      keywords: query.keywords,
      taxonomy_id: query.taxonomyId,
      limit: query.limit ?? 100,
      offset: query.offset ?? 0,
      sort_on: query.sortOn ?? 'score',
      sort_order: query.sortOrder ?? 'desc',
    },
  });
}

/** Etsy-лістинг має публічну адресу виду etsy.com/listing/<id>. */
export function listingUrl(listingId: string | number): string {
  return `https://www.etsy.com/listing/${listingId}`;
}

/**
 * Blob у Node приймає ArrayBuffer, а Uint8Array із node:fs може бути view на
 * більший буфер — копіюємо рівно потрібний шматок, щоб не відправити зайве.
 */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
