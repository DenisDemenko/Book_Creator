/**
 * Підсистема 4: Etsy Keyword & Trend Research.
 *
 * ГОЛОВНЕ, ЩО ТРЕБА РОЗУМІТИ ПРО ЦЕЙ ФАЙЛ (ТЗ 6.1):
 * Etsy Open API v3 **не віддає** ані кількості продажів чужого товару, ані
 * позицій у пошуковій видачі, ані готового підбору SEO-слів. Тому все, що
 * тут рахується, — це власна аналітична надбудова над публічними полями
 * (`num_favorers`, `tags`, `title`, `price`, `creation_timestamp`).
 *
 * З цього випливають два правила, яких код дотримується буквально:
 *  1. жодне число звідси не називається «продажами» чи «бестселером» —
 *     тільки «оцінний показник» (за це відповідає поле `disclaimerUk`,
 *     яке інтерфейс зобов'язаний показати поруч із цифрами);
 *  2. похибка завжди в бік «недооцінити»: якщо поля немає, вважаємо нуль,
 *     а не домальовуємо середнє.
 *
 * Чистий аналіз (токенізація, біграми, індекс популярності) відокремлений від
 * збору даних: перше тестується без мережі, друге — з підставним клієнтом.
 */

import {
  MAX_TAGS,
  normalizeTag,
} from './etsyListingRules';
import { findAllActiveListings, type EtsyClient } from './etsyClient';

/** Скільки лістингів збираємо за темою (ТЗ 6.2: 100–200). */
export const RESEARCH_TARGET_LISTINGS = 150;
/** Розмір сторінки Etsy. */
const PAGE_SIZE = 100;

export const RESEARCH_DISCLAIMER_UK =
  'Показники оцінні. Etsy не надає стороннім застосункам ані статистики продажів, ані позицій у пошуку, тому «популярність» рахується за публічно видимими сигналами (кількість «улюблених», порядок у видачі, вік лістингу) і не є офіційними даними про продажі.';

// ---------------------------------------------------------------------------
// Чистий аналіз тексту
// ---------------------------------------------------------------------------

/**
 * Стоп-слова. Etsy — переважно англомовний ринок (ТЗ 6.3), тож основа
 * англійська; українські додані тому, що автор може ввести тему рідною мовою,
 * і тоді сміття на кшталт «для» не має потрапити в теги.
 */
export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'without', 'of', 'in', 'on', 'at', 'to', 'from',
  'by', 'your', 'you', 'my', 'our', 'this', 'that', 'these', 'those', 'it', 'is', 'are', 'be',
  'as', 'into', 'per', 'via', 'new', 'best', 'top', 'set', 'pack', 'pdf', 'digital', 'download',
  'downloadable', 'instant', 'printable', 'file', 'files', 'product', 'item',
  'і', 'та', 'й', 'у', 'в', 'на', 'для', 'з', 'із', 'до', 'по', 'про', 'як', 'що', 'це', 'the',
]);

export function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

export function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

export interface KeywordCandidate {
  phrase: string;
  /** У скількох лістингах трапляється (не скільки разів усього). */
  listings: number;
  /** Скільки разів слово стоїть саме тегом — тег вагоміший за слово в назві. */
  asTag: number;
  score: number;
  /** Готовий до вставки тег Etsy: ≤20 символів, без розділових знаків. */
  tag: string;
}

export interface ListingSignal {
  listingId: string;
  title: string;
  tags: string[];
  numFavorers: number;
  priceUsd: number;
  createdAt?: string;
  /** Позиція у видачі на момент запиту (1 — найвище). */
  position: number;
}

/**
 * Частотний аналіз заголовків і тегів (ТЗ 6.2).
 *
 * Рахуємо не «скільки разів слово трапилось», а «у скількох різних лістингах
 * воно є»: один продавець, що напхав слово 8 разів у назву, інакше
 * перекошував би всю вибірку.
 *
 * Тег важить утричі більше за слово в назві: тег — це усвідомлений вибір
 * продавця для пошуку, назва часто містить описове сміття.
 */
export function extractKeywordCandidates(
  listings: ListingSignal[],
  options: { limit?: number; excludeTerms?: string[] } = {}
): KeywordCandidate[] {
  const limit = options.limit ?? MAX_TAGS;
  const exclude = new Set((options.excludeTerms || []).map((t) => t.toLowerCase()));

  const inListings = new Map<string, number>();
  const asTag = new Map<string, number>();

  for (const listing of listings) {
    const titleTokens = tokenize(listing.title);
    const phrases = new Set<string>([...titleTokens, ...bigrams(titleTokens)]);

    for (const rawTag of listing.tags || []) {
      const normalized = String(rawTag).toLowerCase().trim();
      if (!normalized) continue;
      phrases.add(normalized);
      asTag.set(normalized, (asTag.get(normalized) || 0) + 1);
    }

    for (const phrase of phrases) {
      if (exclude.has(phrase)) continue;
      inListings.set(phrase, (inListings.get(phrase) || 0) + 1);
    }
  }

  const candidates: KeywordCandidate[] = [];
  for (const [phrase, count] of inListings) {
    // Одиничне входження — шум, а не патерн ринку.
    if (count < 2) continue;
    const tag = normalizeTag(phrase);
    if (!tag) continue;
    const tagCount = asTag.get(phrase) || 0;
    candidates.push({
      phrase,
      listings: count,
      asTag: tagCount,
      score: count + tagCount * 2,
      tag,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.phrase.localeCompare(b.phrase));

  // Прибираємо дублі після нормалізації: «watercolor journal» і
  // «watercolor journals» дають різні фрази, але той самий обрізаний тег.
  const seen = new Set<string>();
  const unique: KeywordCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.tag)) continue;
    seen.add(candidate.tag);
    unique.push(candidate);
    if (unique.length >= limit) break;
  }
  return unique;
}

/**
 * Індекс популярності (ТЗ 6.2).
 *
 * Зважена комбінація двох сигналів: скільки людей додали товар в «улюблені»
 * (нормалізовано до максимуму по вибірці — абсолютні числа в різних нішах
 * непорівнянні) і наскільки високо він стоїть у видачі за темою.
 *
 * Вага 0.65 на «улюблені» проти 0.35 на позицію — навмисна: позиція
 * відображає ще й рекламу та свіжість, тобто шумніша за пряме вподобання.
 */
export function popularityIndex(
  listing: { numFavorers: number; position: number },
  context: { maxFavorers: number; sampleSize: number }
): number {
  const maxFav = Math.max(1, context.maxFavorers);
  const favComponent = Math.min(1, (Number(listing.numFavorers) || 0) / maxFav);
  const size = Math.max(1, context.sampleSize);
  const positionComponent = Math.max(0, 1 - (Math.max(1, listing.position) - 1) / size);
  return Math.round((favComponent * 0.65 + positionComponent * 0.35) * 100);
}

export function median(values: number[]): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Ключ кешу та історизації: тема + категорія, згорнуті в стабільний рядок. */
export function normalizeTopicKey(topic: string, taxonomyId?: number): string {
  const flat = String(topic || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return taxonomyId ? `${flat}#${taxonomyId}` : flat;
}

/** Ціна Etsy приходить як {amount, divisor}: 1250/100 = 12.50. */
export function priceToUsd(price: any): number {
  if (!price) return 0;
  if (typeof price === 'number') return price;
  const amount = Number(price.amount);
  const divisor = Number(price.divisor) || 100;
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount / divisor) * 100) / 100;
}

export function toListingSignal(raw: any, position: number): ListingSignal {
  return {
    listingId: String(raw?.listing_id ?? ''),
    title: String(raw?.title || ''),
    tags: Array.isArray(raw?.tags) ? raw.tags.map((t: unknown) => String(t)) : [],
    numFavorers: Number(raw?.num_favorers) || 0,
    priceUsd: priceToUsd(raw?.price),
    createdAt: raw?.creation_timestamp
      ? new Date(Number(raw.creation_timestamp) * 1000).toISOString()
      : undefined,
    position,
  };
}

export interface ResearchReport {
  topic: string;
  topicKey: string;
  taxonomyId?: number;
  collectedAt: string;
  /** Скільки лістингів реально проаналізовано. */
  listingCount: number;
  /** `count` із відповіді Etsy — обсяг пропозиції за темою. */
  totalActive: number;
  avgFavorers: number;
  medianPriceUsd: number;
  topListings: (ListingSignal & { popularity: number })[];
  keywordCandidates: KeywordCandidate[];
  suggestedTags: string[];
  disclaimerUk: string;
}

export function buildResearchReport(params: {
  topic: string;
  taxonomyId?: number;
  totalActive: number;
  listings: ListingSignal[];
  collectedAt?: string;
  topLimit?: number;
}): ResearchReport {
  const listings = params.listings || [];
  const maxFavorers = listings.reduce((max, l) => Math.max(max, l.numFavorers), 0);
  const withPopularity = listings
    .map((listing) => ({
      ...listing,
      popularity: popularityIndex(listing, { maxFavorers, sampleSize: listings.length }),
    }))
    .sort((a, b) => b.popularity - a.popularity);

  const keywordCandidates = extractKeywordCandidates(listings, {
    excludeTerms: tokenize(params.topic),
  });

  return {
    topic: params.topic,
    topicKey: normalizeTopicKey(params.topic, params.taxonomyId),
    taxonomyId: params.taxonomyId,
    collectedAt: params.collectedAt || new Date().toISOString(),
    listingCount: listings.length,
    totalActive: params.totalActive,
    avgFavorers: listings.length
      ? Math.round((listings.reduce((s, l) => s + l.numFavorers, 0) / listings.length) * 10) / 10
      : 0,
    medianPriceUsd: median(listings.map((l) => l.priceUsd)),
    topListings: withPopularity.slice(0, params.topLimit ?? 20),
    keywordCandidates,
    suggestedTags: keywordCandidates.map((c) => c.tag).slice(0, MAX_TAGS),
    disclaimerUk: RESEARCH_DISCLAIMER_UK,
  };
}

// ---------------------------------------------------------------------------
// Збір даних
// ---------------------------------------------------------------------------

/**
 * Робить кілька послідовних запитів сторінками, поки не набере потрібну
 * кількість лістингів. Послідовно, а не паралельно — навмисно: паралельні
 * сторінки миттєво з'їли б увесь дослідницький бакет і вперлися б у 429.
 */
export async function collectTopicResearch(
  client: EtsyClient,
  params: { topic: string; taxonomyId?: number; target?: number }
): Promise<{ listings: ListingSignal[]; totalActive: number }> {
  const target = Math.min(params.target ?? RESEARCH_TARGET_LISTINGS, 500);
  const listings: ListingSignal[] = [];
  let totalActive = 0;
  let offset = 0;

  while (listings.length < target) {
    const page = await findAllActiveListings(client, {
      keywords: params.topic,
      taxonomyId: params.taxonomyId,
      limit: Math.min(PAGE_SIZE, target - listings.length),
      offset,
      sortOn: 'score',
      sortOrder: 'desc',
    });
    totalActive = Number(page?.count) || totalActive;
    const results = Array.isArray(page?.results) ? page.results : [];
    if (!results.length) break;

    for (const raw of results) {
      listings.push(toListingSignal(raw, listings.length + 1));
    }
    offset += results.length;
    if (results.length < PAGE_SIZE) break;
  }

  return { listings, totalActive };
}
