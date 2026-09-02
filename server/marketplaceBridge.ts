/**
 * Міст «Nova → вітрина Fusion Lab».
 *
 * У маркетплейсі вже є приймач — `POST /bridge/books`, який створює або
 * оновлює лістинг книги за парою (джерело, externalId) і авторизується
 * спільним секретом у заголовку `x-bridge-key` (ADR 0001 маркетплейсу).
 * Бракувало саме цієї половини: з боку Nova мосту не існувало.
 *
 * Чому адреса й ключ живуть у БД, а не в змінних оточення: власник
 * платформи має міняти їх з адмінпанелі, не передеплоюючи Railway — так
 * прямо й було замовлено. Ключ при цьому не лежить відкритим текстом: він
 * шифрується тим самим AES-контуром, що й ключі API користувачів
 * (server/userApiKeyCrypto.ts, секрет USER_API_KEY_SECRET). Якщо секрет
 * шифрування не налаштований, міст свідомо відмовляється зберігати ключ —
 * краще чесна помилка, ніж секрет у відкритому вигляді в `meta`.
 */

import {
  encryptApiKey,
  decryptApiKey,
  apiKeyFingerprint,
  isApiKeyCryptoConfigured,
} from './userApiKeyCrypto';
import { getAppSetting, setAppSetting } from './store';

/** Ключі в таблиці `meta`. */
export const BRIDGE_URL_KEY = 'marketplace_bridge_url';
export const BRIDGE_SECRET_KEY = 'marketplace_bridge_key';

export class MarketplaceBridgeError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'not_configured'
      | 'crypto_unavailable'
      | 'unauthorized'
      | 'rejected'
      | 'unreachable'
      | 'bad_url',
    readonly status = 500,
    readonly details?: string
  ) {
    super(message);
  }
}

export interface BridgeSettings {
  url: string;
  /** Розшифрований секрет. Ніколи не виходить за межі сервера. */
  key: string;
}

export interface BridgeSettingsView {
  url: string;
  keySet: boolean;
  /** Короткий відбиток — щоб адмін бачив, ЧИ ТОЙ ключ, не показуючи сам ключ. */
  keyFingerprint?: string;
  cryptoConfigured: boolean;
}

/**
 * Адреса приймається лише як абсолютний https-URL (або http для localhost —
 * розробка). Це не косметика: у цей URL піде секрет у заголовку, і
 * помилковий `http://` на публічний домен віддав би його відкритим текстом.
 */
export function normalizeBridgeUrl(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new MarketplaceBridgeError('Адреса API маркетплейсу має бути повним URL.', 'bad_url', 400);
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    throw new MarketplaceBridgeError(
      'Адреса має починатись з https:// — інакше ключ мосту піде мережею відкритим текстом.',
      'bad_url',
      400
    );
  }
  return trimmed;
}

export async function readBridgeSettingsView(): Promise<BridgeSettingsView> {
  const url = (await getAppSetting(BRIDGE_URL_KEY)) || '';
  const stored = await getAppSetting(BRIDGE_SECRET_KEY);
  const cryptoConfigured = isApiKeyCryptoConfigured();

  let keyFingerprint: string | undefined;
  if (stored && cryptoConfigured) {
    try {
      keyFingerprint = apiKeyFingerprint(decryptApiKey(stored));
    } catch {
      // Ключ є, але не розшифровується (змінили USER_API_KEY_SECRET) —
      // показуємо «є, але зіпсований», а не падаємо всією сторінкою.
      keyFingerprint = undefined;
    }
  }

  return { url, keySet: Boolean(stored), keyFingerprint, cryptoConfigured };
}

export async function readBridgeSettings(): Promise<BridgeSettings> {
  const url = (await getAppSetting(BRIDGE_URL_KEY)) || '';
  const stored = await getAppSetting(BRIDGE_SECRET_KEY);
  if (!url || !stored) {
    // Називаємо саме ту половину, якої бракує. Спільне «задайте адресу та
    // ключ» після успішного збереження ключа читається як «нічого не
    // збереглося» і відправляє шукати проблему не там — на цьому вже
    // згаяно час (log.md #70).
    const missing = !url && !stored
      ? 'не задано ані адресу API, ані ключ'
      : !url
        ? 'ключ збережено, але НЕ задано адресу API маркетплейсу'
        : 'адресу задано, але ключ не збережено';
    throw new MarketplaceBridgeError(
      `Міст до вітрини не налаштований: ${missing}.`,
      'not_configured',
      409
    );
  }
  if (!isApiKeyCryptoConfigured()) {
    throw new MarketplaceBridgeError(
      'USER_API_KEY_SECRET не налаштований — ключ мосту неможливо розшифрувати.',
      'crypto_unavailable',
      503
    );
  }
  return { url, key: decryptApiKey(stored) };
}

export async function saveBridgeSettings(input: { url?: string; key?: string }): Promise<BridgeSettingsView> {
  if (typeof input.url === 'string') {
    await setAppSetting(BRIDGE_URL_KEY, normalizeBridgeUrl(input.url));
  }

  if (typeof input.key === 'string') {
    const key = input.key.trim();
    if (key) {
      if (!isApiKeyCryptoConfigured()) {
        throw new MarketplaceBridgeError(
          'Не можу зберегти ключ: не налаштований USER_API_KEY_SECRET для шифрування.',
          'crypto_unavailable',
          503
        );
      }
      await setAppSetting(BRIDGE_SECRET_KEY, encryptApiKey(key));
    } else {
      // Порожній рядок — свідоме прибирання ключа, а не «нічого не міняти»:
      // поле в формі надсилається лише коли адмін його торкався.
      await setAppSetting(BRIDGE_SECRET_KEY, '');
    }
  }

  return readBridgeSettingsView();
}

/** Формат товару у вітрині: одна книга дає два лістинги з різною ціною. */
export type MarketplaceFormat = 'digital' | 'print';

export interface PublishBookInput {
  /** Ідентифікатор книги в Nova — основа для externalId, тому публікація ідемпотентна. */
  bookId: string;
  format: MarketplaceFormat;
  title: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  /** Ціна в копійках — маркетплейс тримає гроші лише в мінорних одиницях. */
  priceMinor: number;
  coverUrl?: string;
  highlights?: string[];
  sellerSlug?: string;
}

export interface PublishBookResult {
  externalId: string;
  format: MarketplaceFormat;
  listing: unknown;
}

/**
 * `externalId` містить формат: інакше другий виклик (друкована версія)
 * оновив би той самий лістинг, що й перший, замість створити сусідній —
 * приймач у маркетплейсі ідемпотентний саме за цим полем.
 */
export function bridgeExternalId(bookId: string, format: MarketplaceFormat): string {
  return `${bookId}:${format}`;
}

const TIMEOUT_MS = 20000;

/**
 * Тестова книга мосту. Живе тут, а не в інтерфейсі, щоб публікація і
 * прибирання говорили про один і той самий `externalId`: інакше кнопка
 * «прибрати» одного дня почала б цілитись не в той лістинг.
 *
 * `bookId` навмисно не схожий на справжній ідентифікатор книги Nova, а
 * назва прямо каже, що це тест і його можна видаляти — вітрина публічна, і
 * якщо про цей лістинг забудуть, він має пояснювати себе сам.
 */
export const BRIDGE_TEST_BOOK_ID = 'nova-bridge-test';

export function bridgeTestBook(): Omit<PublishBookInput, 'format' | 'priceMinor'> {
  return {
    bookId: BRIDGE_TEST_BOOK_ID,
    title: 'Тестова книга мосту NOVA — можна видаляти',
    subtitle: "Технічна публікація для перевірки зв'язку Студії з вітриною",
    summary:
      'Це не справжнє видання. Лістинг створено кнопкою «тестова публікація» в адмінпанелі NOVA STUDIO, ' +
      'щоб перевірити весь конвеєр: Студія → міст → каталог маркетплейсу. Його можна безпечно видалити.',
    description:
      'Технічний запис. Якщо ви бачите його у вітрині — значить міст «Nova → Fusion Lab» працює: ' +
      'книга з видавничої майстерні дійшла до каталогу магазину.\n\n' +
      'Прибрати: адмінпанель NOVA → «Міст до вітрини» → «Прибрати тестову книгу».',
    highlights: [
      'Технічна перевірка мосту, не товар',
      'Створено з адмінпанелі NOVA STUDIO',
      'Безпечно видаляти',
    ],
  };
}

/**
 * Зняти книгу з вітрини. Маркетплейс не видаляє лістинг фізично, а переводить
 * у `archived` — історія замовлень на нього могла б лишитись, тож знищувати
 * рядок не можна.
 *
 * 404 тут не помилка, а нормальний кінець: лістинга вже немає, мета досягнута.
 * Саме тому функція повертає `{ removed: false }`, а не кидає — інакше
 * повторне натискання кнопки лякало б користувача червоним.
 */
export async function unpublishBookFromMarketplace(
  input: { bookId: string; format: MarketplaceFormat },
  deps: { fetch?: typeof fetch; settings?: BridgeSettings } = {}
): Promise<{ removed: boolean; externalId: string; format: MarketplaceFormat }> {
  const settings = deps.settings ?? (await readBridgeSettings());
  const doFetch = deps.fetch ?? fetch;
  const externalId = bridgeExternalId(input.bookId, input.format);

  let response: Response;
  try {
    response = await doFetch(`${settings.url}/bridge/books/${encodeURIComponent(externalId)}`, {
      method: 'DELETE',
      headers: { 'x-bridge-key': settings.key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: any) {
    throw new MarketplaceBridgeError(
      'Маркетплейс не відповідає — перевірте адресу API мосту.',
      'unreachable',
      502,
      err?.message
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new MarketplaceBridgeError(
      'Маркетплейс відхилив ключ мосту. Звірте BRIDGE_API_KEY з обох боків.',
      'unauthorized',
      401
    );
  }
  if (response.status === 404) {
    return { removed: false, externalId, format: input.format };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new MarketplaceBridgeError(
      `Маркетплейс відхилив зняття лістинга (HTTP ${response.status}).`,
      'rejected',
      response.status,
      text.slice(0, 400)
    );
  }
  return { removed: true, externalId, format: input.format };
}

/**
 * Ідентифікатор для перевірки ключа. Формат `bookId:format` збігається з
 * `bridgeExternalId`, але жоден справжній лістинг такого мати не може:
 * `bookId` тут — зарезервований рядок, а `format` не є ані `digital`, ані
 * `print`. Випадковий хвіст додано на випадок, якщо колись хтось руками
 * заведе лістинг із таким id — тоді проба не зачепить його.
 */
function probeExternalId(): string {
  return `nova-bridge-selftest-${Math.random().toString(36).slice(2, 10)}:probe`;
}

export interface BridgeTestResult {
  /** Чи відповідає адреса взагалі. */
  reachable: boolean;
  healthStatus?: number;
  healthBody?: string;
  /** true — ключ прийнято, false — відхилено, null — визначити не вдалося. */
  keyAccepted: boolean | null;
  probeStatus?: number;
  tone: 'ok' | 'warn' | 'err';
  messageUk: string;
}

/**
 * Перевірка мосту, що справді перевіряє КЛЮЧ, а не лише доступність адреси.
 *
 * Раніше тут був самий `GET /health`, і зелений результат не означав нічого
 * про ключ: розбіжність спливала аж при першій справжній публікації. Тепер
 * після /health робиться проба `DELETE /bridge/books/<неіснуючий id>`.
 *
 * Чому саме DELETE, а не POST: у маркетплейсі `assertBridgeKey` стоїть ПЕРЕД
 * тілом обробника, тож ключ перевіряється раніше, ніж щось відбудеться. При
 * правильному ключі обробник шукає лістинг, не знаходить і віддає 404 —
 * тобто 404 і є доказом, що ключ прийнято. POST створив би справжній
 * лістинг, а це перевірка, яка не має лишати слідів.
 *
 * Розрізнення:
 *   401/403 → ключ не той (або на приймачі BRIDGE_API_KEY не заданий);
 *   404     → ключ прийнято, лістинга немає — саме те, чого чекаємо;
 *   200     → ключ прийнято, але щось архівовано: не мало статись, кажемо
 *             про це вголос, а не мовчки зараховуємо як успіх;
 *   решта   → висновку немає, віддаємо код як є.
 */
export async function testBridgeConnection(
  deps: { fetch?: typeof fetch; settings?: BridgeSettings } = {}
): Promise<BridgeTestResult> {
  const settings = deps.settings ?? (await readBridgeSettings());
  const doFetch = deps.fetch ?? fetch;

  let healthStatus: number | undefined;
  let healthBody: string | undefined;
  try {
    const health = await doFetch(`${settings.url}/health`, {
      signal: AbortSignal.timeout(15000),
    });
    healthStatus = health.status;
    healthBody = (await health.text().catch(() => '')).slice(0, 300);
  } catch (err: any) {
    return {
      reachable: false,
      keyAccepted: null,
      tone: 'err',
      messageUk:
        'Маркетплейс не відповідає — перевірте адресу API мосту. ' +
        'Вона має вказувати на API напряму (https://api.fusionlab.in.ua), не на сайт.',
    };
  }

  let probe: Response;
  try {
    probe = await doFetch(`${settings.url}/bridge/books/${encodeURIComponent(probeExternalId())}`, {
      method: 'DELETE',
      headers: { 'x-bridge-key': settings.key },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err: any) {
    return {
      reachable: true,
      healthStatus,
      healthBody,
      keyAccepted: null,
      tone: 'warn',
      messageUk: `Адреса жива (HTTP ${healthStatus}), але сам міст не відповів — ключ перевірити не вдалося.`,
    };
  }

  const probeStatus = probe.status;
  const base = { reachable: true, healthStatus, healthBody, probeStatus } as const;

  if (probeStatus === 401 || probeStatus === 403) {
    return {
      ...base,
      keyAccepted: false,
      tone: 'err',
      messageUk:
        'Адреса жива, але ключ мосту відхилено. Значення в цьому полі має збігатися ' +
        'з BRIDGE_API_KEY у змінних сервісу API на Railway — байт у байт, без лапок і ' +
        'пробілів. Якщо змінну щойно додали, перевірте, що сервіс після цього передеплоївся.',
    };
  }

  if (probeStatus === 404) {
    return {
      ...base,
      keyAccepted: true,
      tone: 'ok',
      messageUk:
        'Ключ прийнято, міст працює. Перевірка зроблена запитом на видалення неіснуючого ' +
        'лістинга, тож у каталозі нічого не створено й не змінено.',
    };
  }

  if (probe.ok) {
    return {
      ...base,
      keyAccepted: true,
      tone: 'warn',
      messageUk:
        `Ключ прийнято, але маркетплейс відповів HTTP ${probeStatus} замість 404 — ` +
        'тобто знайшов лістинг із тестовим ідентифікатором і міг його архівувати. ' +
        'Такого лістинга бути не мало; перевірте каталог.',
    };
  }

  return {
    ...base,
    keyAccepted: null,
    tone: 'warn',
    messageUk:
      `Адреса жива, але міст відповів HTTP ${probeStatus} — про ключ це нічого не каже. ` +
      'Перевірте журнал сервісу API.',
  };
}

export async function publishBookToMarketplace(
  input: PublishBookInput,
  deps: { fetch?: typeof fetch; settings?: BridgeSettings } = {}
): Promise<PublishBookResult> {
  const settings = deps.settings ?? (await readBridgeSettings());
  const doFetch = deps.fetch ?? fetch;
  const externalId = bridgeExternalId(input.bookId, input.format);

  const body = {
    externalId,
    title: input.title,
    subtitle: input.subtitle,
    summary: input.summary,
    description: input.description,
    priceMinor: Math.round(input.priceMinor),
    coverUrl: input.coverUrl,
    highlights: input.highlights,
    sellerSlug: input.sellerSlug,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await doFetch(`${settings.url}/bridge/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-key': settings.key },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new MarketplaceBridgeError(
      'Маркетплейс не відповідає — перевірте адресу API мосту.',
      'unreachable',
      502,
      err?.message
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => '');
  if (response.status === 401) {
    throw new MarketplaceBridgeError(
      'Маркетплейс відхилив ключ мосту. Звірте BRIDGE_API_KEY з обох боків.',
      'unauthorized',
      401,
      text.slice(0, 400)
    );
  }
  if (!response.ok) {
    throw new MarketplaceBridgeError(
      `Маркетплейс відхилив публікацію (HTTP ${response.status}).`,
      'rejected',
      502,
      text.slice(0, 400)
    );
  }

  let listing: unknown = undefined;
  try {
    listing = text ? JSON.parse(text) : undefined;
  } catch {
    listing = { raw: text.slice(0, 400) };
  }

  return { externalId, format: input.format, listing };
}

/**
 * Публікація КУРСУ у вітрину — окремий тип товару, не формат книги
 * (як print/digital). Курс має власну структуру (модулі/уроки, а не
 * сторінки), тож і лістинг у маркетплейсі логічно інший, ніж лістинг
 * книги, — звідси окремий шлях `/bridge/courses`, а не третій `format`
 * у `/bridge/books`.
 *
 * ВАЖЛИВО (чесне застереження, а не замовчування): на відміну від
 * `/bridge/books`, приймач `/bridge/courses` на боці Fusion Lab НЕ
 * підтверджений — цей репозиторій не містить коду вітрини, і його
 * неможливо перевірити звідси. Ця функція будує СВОЮ половину контракту
 * за тим самим взірцем (ідемпотентний externalId, той самий заголовок
 * `x-bridge-key`, той самий формат помилок), готову до підключення, коли
 * на боці маркетплейсу з'явиться відповідний ендпоінт. До того моменту
 * виклик повертатиме `unreachable`/`rejected` — це очікувано, не баг.
 */
export interface PublishCourseInput {
  /** Ідентифікатор книги-джерела — курс завжди прив'язаний до конкретної книги. */
  bookId: string;
  title: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  /** Ціна в копійках — та сама мінорна одиниця, що й у книг. */
  priceMinor: number;
  coverUrl?: string;
  /** Наприклад, назви модулів або «12 уроків» — вітрина показує їх як переваги товару. */
  highlights?: string[];
  sellerSlug?: string;
  moduleCount?: number;
  lessonCount?: number;
}

export interface PublishCourseResult {
  externalId: string;
  listing: unknown;
}

/** На відміну від книги — без формату: курс завжди один товар на книгу. */
export function courseExternalId(bookId: string): string {
  return `${bookId}:course`;
}

export async function publishCourseToMarketplace(
  input: PublishCourseInput,
  deps: { fetch?: typeof fetch; settings?: BridgeSettings } = {}
): Promise<PublishCourseResult> {
  const settings = deps.settings ?? (await readBridgeSettings());
  const doFetch = deps.fetch ?? fetch;
  const externalId = courseExternalId(input.bookId);

  const body = {
    externalId,
    title: input.title,
    subtitle: input.subtitle,
    summary: input.summary,
    description: input.description,
    priceMinor: Math.round(input.priceMinor),
    coverUrl: input.coverUrl,
    highlights: input.highlights,
    sellerSlug: input.sellerSlug,
    moduleCount: input.moduleCount,
    lessonCount: input.lessonCount,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await doFetch(`${settings.url}/bridge/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-key': settings.key },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new MarketplaceBridgeError(
      'Маркетплейс не відповідає — перевірте адресу API мосту.',
      'unreachable',
      502,
      err?.message
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => '');
  if (response.status === 401) {
    throw new MarketplaceBridgeError(
      'Маркетплейс відхилив ключ мосту. Звірте BRIDGE_API_KEY з обох боків.',
      'unauthorized',
      401,
      text.slice(0, 400)
    );
  }
  if (!response.ok) {
    throw new MarketplaceBridgeError(
      `Маркетплейс відхилив публікацію курсу (HTTP ${response.status}).`,
      'rejected',
      502,
      text.slice(0, 400)
    );
  }

  let listing: unknown = undefined;
  try {
    listing = text ? JSON.parse(text) : undefined;
  } catch {
    listing = { raw: text.slice(0, 400) };
  }

  return { externalId, listing };
}
