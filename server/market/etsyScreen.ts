/**
 * Скринінг ринку з офіційного Etsy Open API v3 — реальні дані замість оцінки
 * моделі.
 *
 * ЧОМУ ЦЕ ЛИШЕ АДАПТЕР, А НЕ НОВИЙ ЗБИРАЧ. Уся мережева частина в проєкті
 * вже написана й працює в модулі публікації: `findAllActiveListings()` б'є в
 * `/application/listings/active` на самому `x-api-key` (OAuth для публічного
 * пошуку не потрібен), `collectTopicResearch()` гортає сторінки, `TokenBucket`
 * тримає 8 запитів/с при стелі Etsy у 10, клієнт сам повторює спроби з
 * експоненційною затримкою. Другий збирач розійшовся б із першим на першій же
 * зміні Etsy. Тут — тільки переклад `ListingSignal` у `MarketListing`.
 *
 * Сервіс приймає скринінг ззовні (`runMarketScreen(params, { screen })`), тож
 * цей шлях вбудовується поруч із AI-скринінгом, нічого не переписуючи.
 *
 * ТРИ ПРАВИЛА ЧЕСНОСТІ, ЯКИХ КОД ДОТРИМУЄТЬСЯ БУКВАЛЬНО.
 *
 * 1. ЩО API НЕ ДАВ — ЛИШАЄТЬСЯ null І ПОТРАПЛЯЄ В `unavailable`. Спокуса
 *    «дозаповнити прогалини моделлю» тут особливо сильна: рейтингу й
 *    відгуків у видачі немає, і поруч є готовий AI-скринінг. Робити цього
 *    не можна — у одному рядку опинилися б факт і вигадка під однією
 *    позначкою `etsy_api`, і відрізнити їх стало б неможливо назавжди.
 *
 * 2. ЦІНА БЕЗ ПЕРЕРАХУНКУ ВАЛЮТ. Etsy віддає ціну у валюті крамниці разом із
 *    `currency_code`. Наявний `priceToUsd()` у `etsyResearch.ts` ділить
 *    `amount/divisor` і код валюти ІГНОРУЄ — для дослідження ключових слів це
 *    неважливо, а тут ціна йде в медіану ніші, у компонент margin і в
 *    калькулятор маржі. Записати 30 євро як «$30» означало б зіпсувати всі
 *    три. Курсів у системі немає (з тієї ж причини калькулятор комісій не
 *    перераховує валюту), тож не-доларова ціна лишається null.
 *
 * 3. ПОЗИЦІЯ У ВИДАЧІ — СПРАВЖНІЙ СИГНАЛ. Ми просимо `sort_on=score`, тобто
 *    власне ранжування Etsy за цим запитом. Порядок у результаті — це
 *    реальна пошукова позиція, а не наша вигадка, і саме він живить індекс
 *    популярності.
 */

import { normalizeTopicKey } from '../etsy/etsyResearch';
import { findAllActiveListings, listingUrl, type EtsyClient } from '../etsy/etsyClient';
import { productKeyFor } from './marketScoring';
import type { FieldStatus, MarketListing, Provenance, ScreenResult } from './marketTypes';

/**
 * Поля, яких публічна видача Etsy не містить у принципі.
 *
 * Це не «ми не встигли їх зібрати», а властивість джерела: у відповіді
 * `/listings/active` немає ані рейтингу лістинга, ані кількості відгуків, ані
 * назви крамниці, ані людської назви категорії (лише числовий `taxonomy_id`).
 * Перелік винесений сюди, щоб той, хто додаватиме збагачення (крок 0.3
 * плану), одразу бачив, що саме треба дібрати окремими викликами.
 */
export const ETSY_SEARCH_MISSING_FIELDS = ['rating', 'reviewCount', 'shopName', 'category'] as const;

/**
 * Ціна в доларах — або null.
 *
 * Свідомо НЕ використовуємо `priceToUsd()` з `etsyResearch.ts`: він ігнорує
 * код валюти (див. правило 2 у шапці файлу).
 */
export function priceUsdStrict(raw: any): number | null {
  const price = raw?.price;
  if (!price) return null;
  const currency = String(price.currency_code || '').toUpperCase();
  if (currency && currency !== 'USD') return null;
  const amount = Number(price.amount);
  // Дільник відсутній — беремо звичні для Etsy 100 (ціна в центах). Але
  // дільник ПРИСУТНІЙ і при цьому нульовий чи від'ємний — це зіпсована
  // відповідь, і підставляти 100 не можна: `{amount: 100, divisor: 0}`
  // перетворилося б на впевнені $1.00, яких ніхто не називав.
  const divisor = price.divisor === undefined || price.divisor === null ? 100 : Number(price.divisor);
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || !(divisor > 0)) return null;
  return Math.round((amount / divisor) * 100) / 100;
}

/** ISO-дата створення лістингу з unix-мітки Etsy. */
export function createdAtOf(raw: any): string | null {
  const ts = Number(raw?.creation_timestamp ?? raw?.original_creation_timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const date = new Date(ts * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Невідʼємне ціле або null. Нуль тут — справжній нуль, а не «не знаю». */
function intOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter((v) => v.length > 0) : [];
}

/**
 * Один сирий лістинг Etsy → `MarketListing`.
 *
 * Позиція у видачі окремим полем не передається: порядок масиву і Є позиція,
 * і саме з нього `buildMarketReport` рахує індекс популярності. Перекладати
 * порядок у число тут означало б завести другу правду про те саме.
 */
export function toMarketListing(params: {
  raw: any;
  topicKey: string;
  collectedAt: string;
}): MarketListing {
  const { raw, topicKey, collectedAt } = params;
  const title = String(raw?.title || '').trim();

  const externalId = String(raw?.listing_id ?? '').trim() || null;
  const priceUsd = priceUsdStrict(raw);
  const favorers = intOrNull(raw?.num_favorers);
  const tags = stringsOf(raw?.tags);
  const materials = stringsOf(raw?.materials);
  const availability = raw?.state ? String(raw.state) : null;
  const createdAt = createdAtOf(raw);

  const unavailable = [...ETSY_SEARCH_MISSING_FIELDS] as string[];
  if (priceUsd === null) unavailable.push('priceUsd');
  if (favorers === null) unavailable.push('favorers');
  if (tags.length === 0) unavailable.push('tags');
  if (createdAt === null) unavailable.push('createdAt');

  const provenance: Provenance = {
    source: 'etsy_api',
    // Дані з офіційного API — це факт про лістинг, а не оцінка. Але статус
    // ставимо VERIFIED лише коли щось справді перевірено: у лістингу без
    // жодного корисного поля перевіряти нічого.
    status: (priceUsd !== null || favorers !== null ? 'VERIFIED' : 'UNAVAILABLE') as FieldStatus,
    // API не «оцінює» — він або віддав значення, або ні. Самооцінки, як у
    // моделі, тут немає й бути не може.
    confidence: 1,
    unavailable,
  };

  return {
    productKey: productKeyFor(topicKey, externalId, title),
    externalId,
    // Головна перевага реального джерела: посилання можна відкрити й звірити.
    url: externalId ? listingUrl(externalId) : null,
    title,
    shopName: null,
    priceUsd,
    currency: 'USD',
    rating: null,
    reviewCount: null,
    favorers,
    tags,
    category: null,
    materials,
    availability,
    createdAt,
    firstSeenAt: collectedAt,
    provenance,
  };
}

/** Походження набору: скільки полів джерело не дало жодному товару. */
function provenanceForSet(listings: MarketListing[]): Provenance {
  const counted = new Map<string, number>();
  for (const listing of listings) {
    for (const field of listing.provenance.unavailable) {
      counted.set(field, (counted.get(field) ?? 0) + 1);
    }
  }
  // У `unavailable` набору потрапляє лише те, чого немає в УСІХ товарів:
  // одна крамниця без тегів не робить тег недоступним для всієї ніші.
  const unavailable = [...counted.entries()]
    .filter(([, times]) => times === listings.length && listings.length > 0)
    .map(([field]) => field)
    .sort();

  return {
    source: 'etsy_api',
    status: (listings.length > 0 ? 'VERIFIED' : 'UNAVAILABLE') as FieldStatus,
    confidence: 1,
    unavailable,
  };
}

/** Стеля сторінки Etsy. Більше за один запит не віддає в будь-якому разі. */
const PAGE_LIMIT = 100;

export interface EtsyScreenDeps {
  /** null — ключа немає, скринінг через API неможливий. */
  getClient: () => EtsyClient | null;
  now?: () => Date;
  log?: (line: string) => void;
}

export class EtsyScreenUnavailable extends Error {
  constructor(message: string, readonly kind = 'no_key') {
    super(message);
  }
}

/**
 * Збирає зріз ринку з Etsy. Підпис збігається зі `ScreenFn`, тож підставляється
 * в `runMarketScreen` замість AI-скринінгу без жодних змін у сервісі.
 */
export async function screenViaEtsyApi(
  deps: EtsyScreenDeps,
  params: { topic: string; count: number }
): Promise<ScreenResult> {
  const client = deps.getClient();
  if (!client) {
    throw new EtsyScreenUnavailable(
      'Скринінг через Etsy Open API недоступний: не налаштований ETSY_API_KEY. ' +
        'Оберіть джерелом мовну модель або додайте ключ у .env сервера.',
      'no_key'
    );
  }

  const topicKey = normalizeTopicKey(params.topic);
  const collectedAt = (deps.now?.() ?? new Date()).toISOString();

  // ЧОМУ НЕ `collectTopicResearch`. Той збирач віддає `ListingSignal` —
  // навмисно вузький тип під добування ключових слів, без тегів, матеріалів і
  // стану, які потрібні звіту. Але й гортання сторінок звідти нам не
  // потрібне: стеля скринінгу — 25 товарів, сторінка Etsy — 100, тобто запит
  // завжди рівно один. Дублювати цикл гортання заради цього було б гірше, ніж
  // не дублювати його зовсім.
  const limit = Math.max(1, Math.min(params.count, PAGE_LIMIT));
  const page = await findAllActiveListings(client, {
    keywords: params.topic,
    limit,
    offset: 0,
    // Власне ранжування Etsy за запитом: порядок у відповіді — справжня
    // пошукова позиція, а не наш здогад.
    sortOn: 'score',
    sortOrder: 'desc',
  });

  const results = Array.isArray(page?.results) ? page.results : [];
  const listings = results
    .slice(0, params.count)
    .map((raw) => toMarketListing({ raw, topicKey, collectedAt }));

  const totalActive = Number(page?.count);
  deps.log?.(
    `[market] Etsy API «${params.topic}»: ${listings.length} лістингів із ` +
      `${Number.isFinite(totalActive) ? totalActive : '?'} активних за запитом`
  );

  return {
    listings,
    provenance: provenanceForSet(listings),
    // Справжній обсяг пропозиції — те, чого мовна модель не знає в принципі.
    // Нуль лишаємо нулем: «за запитом немає жодного товару» — це факт, а не
    // відсутність даних.
    totalActive: Number.isFinite(totalActive) && totalActive >= 0 ? totalActive : null,
  };
}
