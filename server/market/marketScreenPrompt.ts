/**
 * Промпт «Скринінг ринку Etsy» — джерело даних модуля King Market
 * Intelligence в тому середовищі, де Etsy Open API недоступний.
 *
 * ЧОМУ ЦЕ ВЗАГАЛІ МОДУЛЬ ЯДРА, А НЕ КЛІЄНТ ДО ETSY. ETSY_API_KEY у проєкті
 * немає, і за прямою вказівкою власника джерелом скринінгу є модель із
 * реєстру «Ядро AI». Наслідок треба назвати вголос: усе, що повертає цей
 * модуль, — ОЦІНКА за знаннями моделі, а не факт про конкретний лістинг
 * Etsy. Тому нормалізація нижче не просто чистить дані — вона примусово
 * ставить `status: 'ESTIMATED'` і зриває будь-які id та URL, які модель
 * могла «пригадати».
 *
 * Структурно файл повторює characterCodexPrompt.ts: заводські шаблони
 * system/user, рендер плейсхолдерів, розбір відповіді, нормалізація. Жорсткий
 * контракт JSON живе в SYSTEM після маркера — реєстр (coreAiRegistry.ts,
 * splitAtSchemaMarker/stripSchemaForStorage) саме за цим маркером відрізає
 * схему від редагованої адміном частини, тож переписати контракт через
 * конструктор промптів не вийде навіть прямим запитом до API.
 */

import { productKeyFor } from './marketScoring';
import type { MarketListing, Provenance } from './marketTypes';

const CONTRACT = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):';

/** Скільки товарів просимо за замовчуванням, якщо форма не дала числа. */
export const MARKET_SCREEN_DEFAULT_COUNT = 20;
/** Стеля вибірки: далі модель починає добирати «щоб було», а не згадувати. */
export const MARKET_SCREEN_MAX_COUNT = 60;

export function factoryMarketScreenSystemTemplate(): string {
  return `Ти — аналітик ринку ручних виробів на Etsy. Тобі дають тему (пошуковий запит) і кількість товарів, а ти складаєш зріз ринку за цією темою: типові товари, які на Etsy за такою темою існують, з їхніми типовими характеристиками — назва, магазин, ціна, рейтинг, кількість відгуків, «улюблені», теги, категорія, матеріали, наявність. Мова текстових полів відповіді — {{language}}; назви товарів, теги й матеріали лишай англійською, бо Etsy — англомовний ринок і саме так вони там і виглядають.

ГОЛОВНЕ, І ЦЕ ВАЖЛИВІШЕ ЗА ПОВНОТУ ВІДПОВІДІ. У тебе НЕМАЄ доступу до Etsy. Ти не бачиш ані реальної видачі, ані конкретних лістингів. Усе, що ти повертаєш, — це ОЦІНКА за твоїми знаннями про ринок, і вона буде показана людині саме як оцінка. Тому:

1. НЕ ВИГАДУЙ ідентифікатор лістингу Etsy і НЕ ВИГАДУЙ URL. Жодного listing_id, жодного посилання etsy.com/listing/..., навіть «приблизного», навіть «для прикладу». Вигаданий id виглядає як факт, і людина піде за ним як за фактом — це найгірше, що ти можеш тут зробити. У контракті для них немає полів; якщо ти допишеш їх сам, вони будуть відкинуті.
2. НЕ ВИГАДУЙ назву конкретного реального магазину, якщо не впевнений у ній. Краще null, ніж правдоподібне ім'я, якого не існує або яке торгує зовсім іншим.
3. Кожне поле, якого ти не можеш обґрунтувати, має бути null, а його ім'я — у масиві "unavailable" цього товару. Порожнє значення чесне; вигадане — ні. Нуль НЕ є заміною для «не знаю»: 0 відгуків означає «товар без жодного відгуку», а не «мені невідомо».
4. "confidence" — твоя чесна самооцінка від 0 до 1 саме для ЦЬОГО рядка. Товар із широковідомої ніші, де ти впевнений у порядку цін, — 0.7–0.9. Товар, який ти радше реконструюєш за логікою ринку, ніж пам'ятаєш, — 0.2–0.4. Не став 0.9 усім поспіль: занижена впевненість нічого не ламає, завищена — вводить людину в оману.
5. Числа мають бути правдоподібними РАЗОМ. Ціна $4.99 з рейтингом 4.9 і 12 000 відгуків для ручного виробу — це не зріз ринку, а шум. Тримай внутрішню логіку: дорожчі товари зазвичай мають менше відгуків, нові — менше і відгуків, і «улюблених».
6. Вибірка має відображати РОЗКИД ринку, а не сім однакових рядків: дешевий сегмент, середина, преміум; свіжі лістинги й давні.

${CONTRACT}
Поверни ЛИШЕ JSON — об'єкт з єдиним полем "listings", без markdown-огорожі, без коментарів і без вступного тексту:
{
"listings": [
  {
    "title": "назва товару англійською, як вона виглядала б на Etsy",
    "shopName": "назва магазину або null",
    "priceUsd": 24.5,
    "currency": "USD",
    "rating": 4.8,
    "reviewCount": 143,
    "favorers": 512,
    "tags": ["до 13 тегів англійською, як їх ставлять продавці"],
    "category": "категорія Etsy або null",
    "materials": ["матеріали англійською"],
    "availability": "active | sold_out | inactive | null",
    "estimatedListingAgeMonths": 18,
    "confidence": 0.6,
    "unavailable": ["імена полів, яких ти не знаєш і поставив null"]
  }
]
}
Чому об'єкт, а не голий масив: Anthropic не має параметра response_format, і
режим JSON там реалізований підкладанням репліки асистента, що починається з
«{». Голий масив у такій відповіді був би синтаксично неможливий. Розбір
приймає обидві форми, але контракт просить саме об'єкт — щоб відповідь була
валідною на всіх рушіях однаково.
Ціна — ЗАВЖДИ в доларах США, поле "currency" — завжди "USD": перерахунку валют у системі немає, і ціна в іншій валюті буде відкинута. Полів "listingId", "externalId", "url", "id" у контракті НЕМАЄ — не додавай їх.`;
}

export function factoryMarketScreenUserTemplate(): string {
  return [
    'Тема (пошуковий запит на Etsy): {{topic}}',
    '',
    'Скільки товарів повернути: {{count}}',
    '',
    'Склади зріз ринку за цією темою за контрактом вище. Мова текстових пояснень — {{language}}.',
    'Якщо тема надто вузька і стількох різних товарів на ринку просто немає — поверни менше, але не добирай вигаданими.',
  ].join('\n');
}

export function renderMarketScreenTemplate(
  template: { system: string; user: string },
  values: { topic: string; count: string; language: string },
): { system: string; user: string } {
  const topic = String(values?.topic ?? '').trim();
  const language = String(values?.language ?? '').trim() || 'українська';

  // Кількість приходить рядком із форми конструктора або з тіла запиту —
  // сміття не має перетворюватись на «NaN товарів» у промпті.
  const parsed = Number.parseInt(String(values?.count ?? ''), 10);
  const count = Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MARKET_SCREEN_MAX_COUNT)
    : MARKET_SCREEN_DEFAULT_COUNT;

  const apply = (text: string): string =>
    String(text ?? '')
      .replace(/\{\{topic\}\}/g, topic)
      .replace(/\{\{count\}\}/g, String(count))
      .replace(/\{\{language\}\}/g, language);

  return { system: apply(template?.system ?? ''), user: apply(template?.user ?? '') };
}

/* ───────────────────────────  Розбір відповіді  ─────────────────────────── */

/**
 * Модель час від часу загортає JSON у ```json — зривати огорожу дешевше, ніж
 * втрачати цілий збір. Той самий підхід, що в parseCodexResponse.
 */
export function parseMarketScreenResponse(text: string): unknown {
  const cleaned = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

/* ────────────────────────────  Нормалізація  ────────────────────────────── */

const MAX_TAGS_PER_LISTING = 13;
const MAX_MATERIALS_PER_LISTING = 10;
/** Впевненість, яку беремо, коли модель її не дала. Середина, а не 1. */
const FALLBACK_CONFIDENCE = 0.5;

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Модель інколи пише слово замість порожнього значення.
  if (/^(null|none|n\/a|unknown|невідомо)$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Число або null. Ключове: рядок «немає», порожнє значення й NaN дають null,
 * а не 0 — нуль тут був би твердженням про виміряне значення.
 */
function numOrNull(value: unknown, opts: { min?: number; max?: number; digits?: number } = {}): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const min = opts.min ?? Number.NEGATIVE_INFINITY;
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  const clamped = Math.min(max, Math.max(min, n));
  const digits = opts.digits ?? 2;
  const factor = 10 ** digits;
  return Math.round(clamped * factor) / factor;
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const s = str(item);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Масив лістингів може приїхати як голий масив або загорнутий у об'єкт. */
function pickArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown> | null;
  for (const key of ['listings', 'items', 'results', 'products', 'data']) {
    const candidate = obj?.[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

/**
 * Межа довіри модуля. Усе, що приходить від моделі, проходить рівно тут — і
 * саме тут ухвалюються три непопулярні рішення:
 *
 *  1. `externalId` і `url` ЗАВЖДИ null. Модель не має доступу до Etsy, тож
 *     будь-який id чи посилання в її відповіді — галюцинація. Не «сумнівні
 *     дані», а вигадка, яку людина прийме за факт і піде за нею. Викинути її
 *     мовчки — чесніше, ніж зберегти «про всяк випадок».
 *  2. Ціна не в USD відкидається разом із валютою: перерахунку курсів у
 *     системі немає, а $ і € в одній колонці — це вже не дані.
 *  3. Жодне відсутнє поле не стає нулем. Воно стає null, а його ім'я
 *     потрапляє в `unavailable` конкретного товару (ТЗ 2, 25, 28).
 */
export function normalizeMarketScreenResult(
  raw: unknown,
  params: { topicKey: string; collectedAt: string; limit: number },
): MarketListing[] {
  const limit = Number.isFinite(params?.limit) && params.limit > 0
    ? Math.min(Math.floor(params.limit), MARKET_SCREEN_MAX_COUNT)
    : MARKET_SCREEN_DEFAULT_COUNT;
  const topicKey = String(params?.topicKey ?? '').trim();
  const collectedAt = String(params?.collectedAt ?? '') || new Date().toISOString();

  const out: MarketListing[] = [];
  const seenKeys = new Set<string>();

  for (const entry of pickArray(raw)) {
    if (out.length >= limit) break;
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') continue;

    const title = str(item.title) ?? str(item.name);
    // Без назви товар неможливо ані показати, ані відстежити між зрізами:
    // productKey будується саме з неї. Такий рядок просто не існує.
    if (!title) continue;

    // Те, що модель сама визнала невідомим, — вихідна точка списку; далі
    // до нього додається все, що ми занулили при перевірці.
    const unavailable = new Set<string>(stringList(item.unavailable, 40).map((s) => s));

    const shopName = str(item.shopName) ?? str(item.shop);
    if (!shopName) unavailable.add('shopName');

    // Валюта: приймаємо тільки USD, бо поле в типах називається priceUsd і
    // перераховувати нема чим.
    const currencyRaw = (str(item.currency) ?? 'USD').toUpperCase();
    let priceUsd = numOrNull(item.priceUsd ?? item.price, { min: 0, digits: 2 });
    if (currencyRaw !== 'USD' && priceUsd !== null) {
      priceUsd = null;
      unavailable.add('priceUsd');
      unavailable.add('currency');
    }
    if (priceUsd === null) unavailable.add('priceUsd');

    const rating = numOrNull(item.rating, { min: 0, max: 5, digits: 2 });
    if (rating === null) unavailable.add('rating');

    const reviewCount = numOrNull(item.reviewCount ?? item.reviews, { min: 0, digits: 0 });
    if (reviewCount === null) unavailable.add('reviewCount');

    const favorers = numOrNull(item.favorers ?? item.favorites, { min: 0, digits: 0 });
    if (favorers === null) unavailable.add('favorers');

    const category = str(item.category);
    if (!category) unavailable.add('category');

    const availability = str(item.availability) ?? str(item.state);
    if (!availability) unavailable.add('availability');

    const tags = stringList(item.tags, MAX_TAGS_PER_LISTING);
    if (!tags.length) unavailable.add('tags');

    const materials = stringList(item.materials, MAX_MATERIALS_PER_LISTING);
    if (!materials.length) unavailable.add('materials');

    // Вік лістингу модель дає в місяцях — переводимо в дату створення.
    // Так, це оцінка, а не факт із Etsy; вона й лишається оцінкою, бо весь
    // запис несе provenance.status === 'ESTIMATED'. Без цього поля модуль
    // взагалі не мав би сигналу «свіжий лістинг» на першому зборі.
    const ageMonths = numOrNull(item.estimatedListingAgeMonths, { min: 0, max: 600, digits: 1 });
    let createdAt: string | null = null;
    if (ageMonths === null) {
      unavailable.add('createdAt');
    } else {
      const base = new Date(Date.parse(collectedAt) || Date.now());
      base.setMonth(base.getMonth() - Math.round(ageMonths));
      createdAt = base.toISOString();
    }

    const confidenceRaw = numOrNull(item.confidence, { min: 0, max: 1, digits: 3 });
    if (confidenceRaw === null) unavailable.add('confidence');
    const confidence = confidenceRaw === null ? FALLBACK_CONFIDENCE : confidenceRaw;

    const provenance: Provenance = {
      source: 'ai_screen',
      status: 'ESTIMATED',
      confidence,
      unavailable: [...unavailable],
    };

    const productKey = productKeyFor(topicKey, null, title);
    // Модель інколи повертає той самий товар двічі під трохи різними
    // назвами-синонімами; після productKeyFor вони збігаються. ТЗ 28:
    // повторний збір не створює дублікатів.
    if (seenKeys.has(productKey)) continue;
    seenKeys.add(productKey);

    out.push({
      productKey,
      externalId: null,
      url: null,
      title,
      shopName,
      priceUsd,
      currency: 'USD',
      rating,
      reviewCount,
      favorers,
      tags,
      category,
      materials,
      availability,
      createdAt,
      firstSeenAt: collectedAt,
      provenance,
    });
  }

  return out;
}
