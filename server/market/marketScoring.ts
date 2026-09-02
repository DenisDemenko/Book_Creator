/**
 * King Market Intelligence — рахунок: динаміка, оцінна швидкість продажів,
 * Opportunity Score, агрегати, збірка звіту.
 *
 * ЧОМУ ТУТ НЕМАЄ ЖОДНОГО ВВОДУ-ВИВОДУ. Це єдиний шар модуля, який можна
 * перевірити очима: усі функції чисті, час подається ззовні (`now`), а
 * кожен доданок Opportunity Score несе текстове пояснення, з чого він
 * порахований. ТЗ 28 вимагає буквально цього: «Opportunity Score
 * відтворюється з видимих компонентів і ваг» — не «є пояснення десь у
 * документації», а відтворюється руками з того, що показано в інтерфейсі.
 *
 * ДРУГЕ ПРАВИЛО, ЯКЕ ТУТ ДОТРИМАНО БУКВАЛЬНО (ТЗ 2, 28). Відсутнє поле
 * НІКОЛИ не стає нулем. Нуль — це твердження «показник виміряно, і він
 * дорівнює нулю»; ми такого твердження зробити не можемо. Тому відсутнє
 * значення — це `null` у динаміці й НЕЙТРАЛЬНІ 50 у score з занесенням
 * компонента в `missing`. Нуль у score мовчки карав би товар за НАШЕ
 * незнання, а не за його реальну слабкість.
 *
 * Аналітику, яка вже написана для Etsy-дослідження, тут НЕ переписано:
 * `median`, `popularityIndex`, `normalizeTopicKey`, `tokenize` і
 * `extractKeywordCandidates` імпортуються з `../etsy/etsyResearch`.
 */

import {
  bigrams,
  median,
  popularityIndex,
  normalizeTopicKey,
  tokenize,
  extractKeywordCandidates,
  type ListingSignal,
} from '../etsy/etsyResearch';
import {
  DEFAULT_SCORE_WEIGHTS,
  MARKET_DISCLAIMER_AI_UK,
  MARKET_DISCLAIMER_API_UK,
  type EstimatedSalesVelocity,
  type MarketAggregate,
  type MarketListing,
  type MarketReport,
  type MarketReportItem,
  type MarketSnapshot,
  type OpportunityScore,
  type ProductDynamics,
  type Provenance,
  type ScoreComponent,
  type ScoreComponentBreakdown,
  type ScoreWeights,
} from './marketTypes';

/* ────────────────────────────  Дрібні утиліти  ──────────────────────────── */

const MS_PER_DAY = 86_400_000;

/** Число або null. Порожній рядок, NaN, Infinity — це «немає значення», а не 0. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Час зрізу в мс. Некоректна дата = «зріз без часу», його не можна порівнювати. */
function snapshotTime(snapshot: MarketSnapshot): number | null {
  const t = Date.parse(String(snapshot?.collectedAt ?? ''));
  return Number.isFinite(t) ? t : null;
}

/* ──────────────────────────────  productKey  ────────────────────────────── */

/** Скільки символів назви лишаємо в ключі, перш ніж дописати хеш. */
const SLUG_MAX = 60;

/**
 * FNV-1a, 32 біти. Потрібен лише для «хвоста» довгих назв, тож криптостійкість
 * тут ні до чого — важлива стабільність між запусками, а вона є.
 */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 6);
}

function slugify(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Стабільний ключ товару в наших таблицях: `<topicKey>::<externalId|slug(title)>`.
 *
 * Etsy listing id при AI-скринінгу невідомий (і вигадувати його заборонено —
 * див. marketScreenPrompt.ts), тому в переважній більшості випадків ключем стає
 * назва. Звідси й компроміс: коротка назва дає рівно той слаг, що описаний у
 * типах, а от довгу доводиться обрізати — і дві різні назви з однаковим
 * початком злилися б в один товар, тобто їхні історії перемішалися б. Тому
 * обрізаній назві дописується хеш ПОВНОЇ назви. Ключ лишається читабельним у
 * типовому випадку й однозначним у складному.
 */
export function productKeyFor(topicKey: string, externalId: string | null, title: string): string {
  const prefix = String(topicKey || '').trim() || 'unknown';
  const id = String(externalId ?? '').trim();
  if (id) return `${prefix}::${id}`;

  const slug = slugify(title);
  if (!slug) return `${prefix}::untitled-${shortHash(String(title || ''))}`;
  if (slug.length <= SLUG_MAX) return `${prefix}::${slug}`;
  return `${prefix}::${slug.slice(0, SLUG_MAX)}-${shortHash(slug)}`;
}

/* ───────────────────────────────  Динаміка  ─────────────────────────────── */

/**
 * Пороги напрямку тренду (ТЗ 9). Вибрані так, щоб «rising» означав живий
 * товар, а не шум вимірювання:
 *
 *  • RISING_VELOCITY = 0.2 відгуку на день — це ~6 відгуків на місяць. За
 *    типовою для Etsy часткою покупців, які взагалі лишають відгук, це вже
 *    десятки продажів, тобто товар справді рухається.
 *  • DECLINING_VELOCITY = 0 з одночасною втратою «улюблених». Окремо
 *    зупинка відгуків нічого не доводить (люди просто мовчать), а от
 *    зупинка ПЛЮС відписки від «улюблених» — уже сигнал спаду.
 *  • від'ємний приріст відгуків — завжди спад: на Etsy відгуки лише
 *    накопичуються, тож мінус означає, що лістинг ховають або чистять.
 */
const RISING_VELOCITY = 0.2;

/**
 * Динаміка між НАЙСВІЖІШИМ і НАЙСТАРІШИМ доступними зрізами (ТЗ 9).
 *
 * Порівнюємо крайні, а не два останні, навмисно: зрізи знімаються
 * нерегулярно, і два сусідні можуть виявитись за годину один від одного —
 * тоді швидкість «відгуків на день» вибухає до сотень. Крайні зрізи дають
 * найдовшу базу, а `daysBetween` показує, наскільки їй можна вірити.
 *
 * `now` подається ззовні (як у rateLimiter.ts) — і не лише заради
 * детермінованих тестів: зріз із датою В МАЙБУТНЬОМУ — це збій годинника
 * або зіпсований запис, і він викидається, а не тягне за собою від'ємну
 * кількість днів.
 */
export function computeDynamics(snapshots: MarketSnapshot[], now?: Date): ProductDynamics {
  const nowMs = (now ?? new Date()).getTime();

  const usable = (Array.isArray(snapshots) ? snapshots : [])
    .map((s) => ({ snapshot: s, time: snapshotTime(s) }))
    .filter((x): x is { snapshot: MarketSnapshot; time: number } => x.time !== null && x.time <= nowMs)
    .sort((a, b) => a.time - b.time);

  const empty: ProductDynamics = {
    reviewGrowth: null,
    reviewGrowthPct: null,
    reviewVelocity: null,
    priceChange: null,
    priceChangePct: null,
    favoriteGrowth: null,
    trend: 'unknown',
    daysBetween: null,
    snapshotCount: usable.length,
  };

  // Один зріз — порівнювати нема з чим. Саме тут найлегше збрехати нулем
  // («змін немає»), тому всі поля лишаються null, а тренд — 'unknown',
  // не 'stable': «не знаю» і «стабільно» — різні твердження.
  if (usable.length < 2) return empty;

  const oldest = usable[0].snapshot;
  const newest = usable[usable.length - 1].snapshot;
  const daysBetween = round((usable[usable.length - 1].time - usable[0].time) / MS_PER_DAY, 3);

  const prevReviews = num(oldest.reviewCount);
  const curReviews = num(newest.reviewCount);
  const prevPrice = num(oldest.priceUsd);
  const curPrice = num(newest.priceUsd);
  const prevFav = num(oldest.favorers);
  const curFav = num(newest.favorers);

  const reviewGrowth = prevReviews !== null && curReviews !== null ? curReviews - prevReviews : null;
  // Ділення на нуль дало б Infinity, а «зростання на нескінченність %» —
  // це не показник, а сміття в інтерфейсі. Нема бази — нема відсотка.
  const reviewGrowthPct =
    reviewGrowth !== null && prevReviews !== null && prevReviews > 0
      ? round((reviewGrowth / prevReviews) * 100, 2)
      : null;
  // Той самий захист і для швидкості: два зрізи в один день (daysBetween≈0)
  // не дають права ділити — база занадто коротка.
  const reviewVelocity =
    reviewGrowth !== null && daysBetween >= 0.5 ? round(reviewGrowth / daysBetween, 4) : null;

  const priceChange = prevPrice !== null && curPrice !== null ? round(curPrice - prevPrice, 2) : null;
  const priceChangePct =
    priceChange !== null && prevPrice !== null && prevPrice > 0
      ? round((priceChange / prevPrice) * 100, 2)
      : null;

  const favoriteGrowth = prevFav !== null && curFav !== null ? curFav - prevFav : null;

  let trend: ProductDynamics['trend'] = 'unknown';
  if (reviewGrowth !== null && reviewGrowth < 0) {
    trend = 'declining';
  } else if (reviewVelocity !== null && reviewVelocity >= RISING_VELOCITY) {
    trend = 'rising';
  } else if (favoriteGrowth !== null && favoriteGrowth > 0 && (reviewVelocity ?? 0) > 0) {
    trend = 'rising';
  } else if ((reviewVelocity !== null && reviewVelocity <= 0) && favoriteGrowth !== null && favoriteGrowth < 0) {
    trend = 'declining';
  } else if (reviewVelocity !== null || favoriteGrowth !== null) {
    trend = 'stable';
  }

  return {
    reviewGrowth,
    reviewGrowthPct,
    reviewVelocity,
    priceChange,
    priceChangePct,
    favoriteGrowth,
    trend,
    daysBetween,
    snapshotCount: usable.length,
  };
}

/* ──────────────────────  Оцінна швидкість продажів  ─────────────────────── */

/**
 * Скільки продажів припадає на ОДИН відгук.
 *
 * Формула в типах (`marketTypes.ts`) записана як
 * `estimatedMonthly = reviewVelocity * 30 * reviewToSaleRatio`, тобто
 * коефіцієнт множиться — отже, це «продажів на відгук», а не «частка
 * покупців, що лишають відгук» (як читається підпис поля там же). Ми
 * реалізуємо формулу, а не підпис: підпис не змінює арифметики, а
 * розбіжність винесена в звіт. 10 — консервативна середина ходових
 * оцінок «1 відгук на 10–20 покупок».
 */
export const DEFAULT_REVIEW_TO_SALE_RATIO = 10;

export const SALES_VELOCITY_DISCLAIMER_UK =
  'ESTIMATED — НЕ реальні продажі Etsy. Число виведене з приросту відгуків і коефіцієнта «продажів на відгук», який ми задали самі. Etsy не надає стороннім застосункам продажів чужого лістингу, тому перевірити цю оцінку нічим.';

/**
 * Оцінка продажів на місяць (ТЗ 10). Окремий тип із власним дисклеймером —
 * щоб число фізично не можна було показати без застереження.
 */
export function estimateSalesVelocity(
  dynamics: ProductDynamics,
  reviewToSaleRatio: number = DEFAULT_REVIEW_TO_SALE_RATIO,
): EstimatedSalesVelocity {
  const ratio = Number.isFinite(reviewToSaleRatio) && reviewToSaleRatio > 0
    ? reviewToSaleRatio
    : DEFAULT_REVIEW_TO_SALE_RATIO;
  const velocity = dynamics?.reviewVelocity ?? null;

  return {
    // Немає швидкості відгуків — немає й оцінки. Нуль тут означав би
    // «товар не продається», а ми знаємо лише те, що історії замало.
    estimatedMonthly: velocity === null ? null : round(Math.max(0, velocity) * 30 * ratio, 1),
    reviewToSaleRatio: ratio,
    disclaimerUk: SALES_VELOCITY_DISCLAIMER_UK,
  };
}

/* ────────────────────────────────  Ваги  ────────────────────────────────── */

const WEIGHT_KEYS: ScoreComponent[] = [
  'demand',
  'growth',
  'competition',
  'pricePotential',
  'engagement',
  'saturation',
  'margin',
];

/**
 * Зводить ваги до суми рівно 100 (ТЗ 11).
 *
 * Ваги редагуються в Settings, тобто приходять від людини — і ніколи не
 * кидаємо виняток: зіпсовані ваги не мають робити score недоступним. Від'ємне
 * значення — це «мінус-вага», якої у формулі немає, тож воно стає нулем;
 * усе разом масштабується до 100. Нулі по всіх семи — єдиний випадок, коли
 * масштабувати нема що: тоді повертаємо заводські ваги.
 */
export function normalizeWeights(weights: Partial<ScoreWeights> | null | undefined): ScoreWeights {
  const raw = {} as Record<ScoreComponent, number>;
  let sum = 0;
  for (const key of WEIGHT_KEYS) {
    const value = num(weights?.[key]);
    const safe = value === null ? DEFAULT_SCORE_WEIGHTS[key] : Math.max(0, value);
    raw[key] = safe;
    sum += safe;
  }
  if (sum <= 0) return { ...DEFAULT_SCORE_WEIGHTS };

  const out = {} as ScoreWeights;
  let running = 0;
  let heaviest: ScoreComponent = WEIGHT_KEYS[0];
  for (const key of WEIGHT_KEYS) {
    const share = round((raw[key] / sum) * 100, 2);
    out[key] = share;
    running = round(running + share, 2);
    if (share > out[heaviest]) heaviest = key;
  }
  // Округлення семи часток майже завжди дає 99.99 або 100.01, а «сума ваг =
  // 100» має лишатись правдою. Залишок віддаємо НАЙБІЛЬШІЙ вазі: для неї ті
  // самі 0.01 — найменше відносне спотворення. Віддавати останній у списку
  // (margin, за замовчуванням 5%) було б помітнішим перекосом.
  out[heaviest] = round(out[heaviest] + (100 - running), 2);
  return out;
}

/* ────────────────────────  Opportunity Score  ───────────────────────────── */

/**
 * Нейтральне значення компонента, для якого немає даних.
 *
 * Свідомо 50, а не 0. Нуль означав би «компонент виміряно, і він найгірший
 * можливий» — тобто товар мовчки карався б за те, що МИ чогось не знаємо.
 * 50 не додає товару переваги й не забирає її; сам факт незнання видно в
 * `missing` і в `basisUk`, тож людина бачить, що саме не пораховано.
 */
const NEUTRAL_RAW = 50;

/** Вибірка, за якої ніша вважається щільно зайнятою (компонент competition). */
const COMPETITION_FULL_SAMPLE = 60;
/** Скільки відгуків у лідера ніші означає, що ніша вже насичена (saturation). */
const SATURATION_FULL_REVIEWS = 2000;
/** Приріст відгуків на день, який дає компоненту growth повні 100. */
const GROWTH_FULL_VELOCITY = 0.5;
/** Ціна, вище якої компонент margin уже не росте. */
const MARGIN_FULL_PRICE_USD = 60;

/** Логарифмічна нормалізація: у нішах розкид відгуків на порядки, лінійна шкала чавила б усіх, крім лідера. */
function logNorm(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return clamp((Math.log1p(Math.max(0, value)) / Math.log1p(max)) * 100, 0, 100);
}

/**
 * Opportunity Score 0..100 (ТЗ 11).
 *
 * Кожен із семи компонентів нормалізується в 0..100, множиться на свою вагу
 * й додається. `breakdown` навмисно містить УСЕ, що потрібно для перевірки
 * руками: нормалізоване значення, вагу, добуток і текстову підставу — сума
 * показаних `contribution` дорівнює показаному `score` (ТЗ 28).
 *
 * Три компоненти (competition, saturation) описують НІШУ, а не окремий
 * товар, тож у межах одного звіту вони однакові для всіх позицій. Це не
 * помилка: ТЗ 11 змішує в одній формулі товарні й ринкові чинники, і чесніше
 * показати це прямо в `basisUk`, ніж імітувати різницю там, де її немає.
 */
export function computeOpportunityScore(
  input: {
    listing: MarketListing;
    dynamics: ProductDynamics;
    popularity: number;
    context: { medianPriceUsd: number; maxReviewCount: number; maxFavorers: number; sampleSize: number };
  },
  weights: ScoreWeights,
): OpportunityScore {
  const { listing, dynamics, context } = input;
  const popularity = clamp(num(input.popularity) ?? 0, 0, 100);
  const w = normalizeWeights(weights);

  const missing: ScoreComponent[] = [];
  const breakdown: ScoreComponentBreakdown[] = [];

  function put(component: ScoreComponent, raw: number | null, basisUk: string): void {
    const known = raw !== null;
    if (!known) missing.push(component);
    const value = round(known ? clamp(raw, 0, 100) : NEUTRAL_RAW, 1);
    const weight = w[component];
    breakdown.push({
      component,
      raw: value,
      weight,
      contribution: round((value * weight) / 100, 2),
      basisUk: known ? basisUk : `${basisUk} Даних немає — узято нейтральні ${NEUTRAL_RAW}, а не 0.`,
    });
  }

  // 1. Demand — скільки людей уже дійшли до покупки настільки, щоб лишити
  //    відгук. Домішка popularity (індекс з etsyResearch: «улюблені» +
  //    позиція у вибірці) додає сигнал уваги там, де відгуків ще мало.
  const reviews = num(listing.reviewCount);
  if (reviews === null) {
    put('demand', null, 'Попит рахується з кількості відгуків відносно лідера вибірки.');
  } else {
    const reviewPart = logNorm(reviews, Math.max(1, context.maxReviewCount));
    const raw = 0.75 * reviewPart + 0.25 * popularity;
    put(
      'demand',
      raw,
      `0.75 × ${round(reviewPart, 1)} (log-нормалізовані ${reviews} відгуків проти ${context.maxReviewCount} у лідера) + 0.25 × ${round(popularity, 1)} (індекс популярності).`,
    );
  }

  // 2. Growth — приріст відгуків за день. Це єдиний компонент, який
  //    потребує ІСТОРІЇ: на першому зборі його чесно немає.
  const velocity = dynamics?.reviewVelocity ?? null;
  if (velocity === null) {
    put('growth', null, `Динаміка потребує щонайменше двох зрізів (зараз ${dynamics?.snapshotCount ?? 0}).`);
  } else {
    const raw = clamp((velocity / GROWTH_FULL_VELOCITY) * 100, 0, 100);
    put(
      'growth',
      raw,
      `${velocity} відгуку/день ÷ ${GROWTH_FULL_VELOCITY} (приріст, що дає 100) × 100, обрізано до 0..100. База — ${dynamics.daysBetween} дн. між зрізами.`,
    );
  }

  // 3. Competition — чим більше товарів вибірка знайшла за темою, тим
  //    щільніше зайнята ніша, тим менше балів. Показник ніші.
  const sample = num(context.sampleSize);
  if (sample === null || sample <= 0) {
    put('competition', null, 'Конкуренція оцінюється за обсягом вибірки за темою.');
  } else {
    const raw = (1 - Math.min(1, sample / COMPETITION_FULL_SAMPLE)) * 100;
    put(
      'competition',
      raw,
      `(1 − ${sample}/${COMPETITION_FULL_SAMPLE}) × 100: що більше товарів у вибірці за темою, то щільніша ніша. Показник ніші, однаковий для всіх позицій звіту.`,
    );
  }

  // 4. Price Potential — наскільки ціна стоїть ВИЩЕ медіани ніші. Вище
  //    медіани означає, що ринок приймає таку ціну; нижче — торгівля ціною.
  const price = num(listing.priceUsd);
  const medianPrice = num(context.medianPriceUsd);
  if (price === null || medianPrice === null || medianPrice <= 0) {
    put('pricePotential', null, 'Потрібні ціна товару й медіанна ціна ніші.');
  } else {
    const deviation = clamp((price - medianPrice) / medianPrice, -1, 1);
    const raw = 50 + deviation * 50;
    put(
      'pricePotential',
      raw,
      `50 + 50 × ((${price} − ${medianPrice}) ÷ ${medianPrice}), відхилення обрізане до ±100%. Рівно медіана = 50.`,
    );
  }

  // 5. Engagement — «улюблені» плюс рейтинг. Обидва сигнали окремо слабкі,
  //    разом показують, чи товар взагалі чіпляє.
  const favorers = num(listing.favorers);
  const rating = num(listing.rating);
  if (favorers === null && rating === null) {
    put('engagement', null, 'Потрібні «улюблені» або рейтинг.');
  } else if (favorers !== null && rating !== null) {
    const favPart = logNorm(favorers, Math.max(1, context.maxFavorers));
    const ratingPart = clamp((rating / 5) * 100, 0, 100);
    put(
      'engagement',
      0.7 * favPart + 0.3 * ratingPart,
      `0.7 × ${round(favPart, 1)} (log-нормалізовані ${favorers} «улюблених» проти ${context.maxFavorers}) + 0.3 × ${round(ratingPart, 1)} (рейтинг ${rating} з 5).`,
    );
  } else if (favorers !== null) {
    const favPart = logNorm(favorers, Math.max(1, context.maxFavorers));
    put('engagement', favPart, `Лише «улюблені»: log-нормалізовані ${favorers} проти ${context.maxFavorers}. Рейтингу джерело не дало.`);
  } else {
    const ratingPart = clamp(((rating as number) / 5) * 100, 0, 100);
    put('engagement', ratingPart, `Лише рейтинг ${rating} з 5 × 20. «Улюблених» джерело не дало.`);
  }

  // 6. Saturation — скільки відгуків набрав ЛІДЕР ніші. Тисячі відгуків у
  //    верхівці означають, що новачку там нічого ловити. Показник ніші.
  const maxReviews = num(context.maxReviewCount);
  // Порожня вибірка — не «ніша без відгуків», а відсутність спостереження.
  // maxReviewCount === 0 при НЕпорожній вибірці, навпаки, факт: ніхто в ніші
  // ще не набрав відгуків, і місця там справді багато.
  if (maxReviews === null || maxReviews < 0 || sample === null || sample <= 0) {
    put('saturation', null, 'Насиченість оцінюється за кількістю відгуків у лідера ніші, а вибірка порожня.');
  } else {
    const raw = (1 - Math.min(1, maxReviews / SATURATION_FULL_REVIEWS)) * 100;
    put(
      'saturation',
      raw,
      `(1 − ${maxReviews}/${SATURATION_FULL_REVIEWS}) × 100: що більше відгуків у лідера, то менше вільного місця. Показник ніші, однаковий для всіх позицій звіту.`,
    );
  }

  // 7. Margin — найслабший компонент формули, і саме тому в ТЗ у нього
  //    вага 5%. Собівартості чужого товару ми не знаємо в принципі, тож
  //    єдине, що лишається, — рівень ціни: дорожчий товар МОЖЕ мати більший
  //    запас, але це припущення, а не розрахунок маржі.
  if (price === null) {
    put('margin', null, 'Потрібна ціна товару.');
  } else {
    const raw = clamp((price / MARGIN_FULL_PRICE_USD) * 100, 0, 100);
    put(
      'margin',
      raw,
      `$${price} ÷ $${MARGIN_FULL_PRICE_USD} × 100, обрізано до 100. Собівартість чужого товару невідома — це припущення про запас, а не розрахунок маржі.`,
    );
  }

  const score = round(
    breakdown.reduce((sum, part) => sum + part.contribution, 0),
    2,
  );

  return { score: clamp(score, 0, 100), breakdown, missing };
}

/* ────────────────────────────────  Агрегати  ────────────────────────────── */

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Зведення по звіту (ТЗ 5 — плитки Dashboard).
 *
 * Середні рахуються ЛИШЕ по тих позиціях, де показник справді є. Порожній
 * набір дає null, а не 0: «середня ціна 0$» — це неправда, «середньої ціни
 * немає» — правда.
 */
export function buildAggregate(items: MarketReportItem[]): MarketAggregate {
  const list = Array.isArray(items) ? items : [];
  const prices = list.map((i) => num(i.listing?.priceUsd)).filter((v): v is number => v !== null);
  const reviews = list.map((i) => num(i.listing?.reviewCount)).filter((v): v is number => v !== null);
  const scores = list.map((i) => num(i.opportunity?.score)).filter((v): v is number => v !== null);

  const avgPrice = avg(prices);
  const avgReviews = avg(reviews);
  const avgScore = avg(scores);

  return {
    itemCount: list.length,
    avgPriceUsd: avgPrice === null ? null : round(avgPrice, 2),
    medianPriceUsd: prices.length ? round(median(prices), 2) : null,
    minPriceUsd: prices.length ? Math.min(...prices) : null,
    maxPriceUsd: prices.length ? Math.max(...prices) : null,
    avgReviewCount: avgReviews === null ? null : round(avgReviews, 1),
    avgOpportunity: avgScore === null ? null : round(avgScore, 1),
    risingCount: list.filter((i) => i.dynamics?.trend === 'rising').length,
    decliningCount: list.filter((i) => i.dynamics?.trend === 'declining').length,
    // «Новий» = ми бачимо його вперше, тобто в історії рівно один зріз (або
    // жодного). Дату створення на Etsy сюди не беремо: при AI-скринінгу вона
    // сама лише оцінка, і будувати на ній плитку Dashboard було б хибно.
    newCount: list.filter((i) => (i.dynamics?.snapshotCount ?? 0) <= 1).length,
  };
}

/* ──────────────────────────────  Збірка звіту  ──────────────────────────── */

/** MarketListing → ListingSignal, щоб перевикористати аналіз ключових слів з etsyResearch. */
function toSignal(listing: MarketListing, position: number): ListingSignal {
  return {
    listingId: listing.externalId ?? listing.productKey,
    title: String(listing.title || ''),
    tags: Array.isArray(listing.tags) ? listing.tags.map((t) => String(t)) : [],
    // popularityIndex і частотний аналіз оперують числами; тут — єдине місце,
    // де null доводиться звести до 0, і це усвідомлено: у ЦИХ формулах нуль
    // означає «сигналу немає», і на результат він впливає рівно так само.
    numFavorers: num(listing.favorers) ?? 0,
    priceUsd: num(listing.priceUsd) ?? 0,
    createdAt: listing.createdAt ?? undefined,
    position,
  };
}

/**
 * Повний звіт по темі: динаміка кожного товару, Opportunity Score, зведення
 * і кандидати в ключові слова.
 *
 * Позиція товару — це порядок, у якому його повернуло ДЖЕРЕЛО (модель), а не
 * позиція у пошуковій видачі Etsy: видачі ми не бачимо. Індекс популярності
 * рахує позицію як сигнал, тож пам'ятайте, що при AI-скринінгу це сигнал
 * впевненості моделі, не ринку. Дисклеймер набору обирається за походженням.
 */
export function buildMarketReport(params: {
  topic: string;
  topicKey: string;
  listings: MarketListing[];
  snapshotsByProduct: Map<string, MarketSnapshot[]>;
  weights: ScoreWeights;
  collectedAt: string;
  provenance: Provenance;
  requestedCount: number;
  modelId?: string;
  engine?: string;
}): MarketReport {
  const listings = Array.isArray(params.listings) ? params.listings : [];
  const weights = normalizeWeights(params.weights);
  const snapshots = params.snapshotsByProduct ?? new Map<string, MarketSnapshot[]>();
  const now = new Date(Date.parse(params.collectedAt) || Date.now());

  const prices = listings.map((l) => num(l.priceUsd)).filter((v): v is number => v !== null);
  const context = {
    medianPriceUsd: prices.length ? round(median(prices), 2) : 0,
    maxReviewCount: listings.reduce((max, l) => Math.max(max, num(l.reviewCount) ?? 0), 0),
    maxFavorers: listings.reduce((max, l) => Math.max(max, num(l.favorers) ?? 0), 0),
    sampleSize: listings.length,
  };

  const items: MarketReportItem[] = listings.map((listing, index) => {
    const dynamics = computeDynamics(snapshots.get(listing.productKey) ?? [], now);
    const popularity = popularityIndex(
      { numFavorers: num(listing.favorers) ?? 0, position: index + 1 },
      { maxFavorers: context.maxFavorers, sampleSize: Math.max(1, listings.length) },
    );
    return {
      listing,
      dynamics,
      opportunity: computeOpportunityScore({ listing, dynamics, popularity, context }, weights),
      salesVelocity: estimateSalesVelocity(dynamics),
      popularity,
    };
  });

  items.sort((a, b) => b.opportunity.score - a.opportunity.score);

  // Слова самої теми виключаємо: вони є в кожній назві за побудовою і нічого
  // не додають до розуміння ніші. Разом зі словами прибираємо й біграми теми —
  // інакше «paracord bracelet» за темою «paracord bracelet» опинявся б у
  // верхівці списку кандидатів як «відкриття».
  const topicTokens = tokenize(params.topic);
  const keywordCandidates = extractKeywordCandidates(
    listings.map((l, i) => toSignal(l, i + 1)),
    { excludeTerms: [...topicTokens, ...bigrams(topicTokens)] },
  ).map((c) => ({ phrase: c.phrase, listings: c.listings, score: c.score }));

  return {
    topic: params.topic,
    topicKey: String(params.topicKey || '').trim() || normalizeTopicKey(params.topic),
    collectedAt: params.collectedAt,
    requestedCount: params.requestedCount,
    items,
    aggregate: buildAggregate(items),
    weights,
    provenance: params.provenance,
    modelId: params.modelId,
    engine: params.engine,
    keywordCandidates,
    disclaimerUk:
      params.provenance?.source === 'etsy_api' ? MARKET_DISCLAIMER_API_UK : MARKET_DISCLAIMER_AI_UK,
  };
}
