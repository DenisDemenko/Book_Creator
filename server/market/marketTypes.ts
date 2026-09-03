/**
 * King Market Intelligence — спільні типи модуля аналітики Etsy.
 *
 * ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ ОКРЕМО. Модуль складається з чотирьох шарів, які
 * пишуться й тестуються незалежно: скринінг (звідки беруться дані),
 * сховище (як вони історизуються), рахунок (динаміка й Opportunity Score)
 * та маршрути. Спільний словник тримається тут, щоб жоден шар не знав
 * внутрішностей іншого.
 *
 * ГОЛОВНЕ ПРАВИЛО МОДУЛЯ (ТЗ, розділи 2, 10, 25). Etsy Open API v3 не
 * віддає стороннім застосункам ані реальних продажів чужого лістингу, ані
 * позицій у пошуку. Понад те, у цьому середовищі Etsy API взагалі не
 * налаштований (немає ETSY_API_KEY), тож основне джерело — AI-скринінг
 * обраною в ядрі моделлю. Через це КОЖЕН показник несе `source` і
 * `status`, а інтерфейс зобов'язаний показати позначку. Число, отримане
 * від мовної моделі, ніколи не називається даними Etsy.
 */

/** Звідки взялося значення. Порядок = спадання достовірності. */
export type FieldSource =
  /** Офіційний Etsy Open API v3 (потребує ETSY_API_KEY). */
  | 'etsy_api'
  /** Скринінг мовною моделлю з ядра — оцінка, не факт. */
  | 'ai_screen'
  /** Введено людиною вручну. */
  | 'manual'
  /** Обчислено нами з інших полів (динаміка, score). */
  | 'derived';

/** Що саме показувати біля числа в інтерфейсі (ТЗ 25). */
export type FieldStatus = 'VERIFIED' | 'CALCULATED' | 'ESTIMATED' | 'UNAVAILABLE';

/** Позначка достовірності для показника або цілого набору. */
export interface Provenance {
  source: FieldSource;
  status: FieldStatus;
  /** 0..1. Для 'ai_screen' — самооцінка моделі, зведена в межі. */
  confidence: number;
  /** Поля, яких джерело не дало. Вони НЕ підмінюються нулем чи середнім. */
  unavailable: string[];
}

/** Один товар у полі зору. Ключ `productKey` наш, не Etsy. */
export interface MarketListing {
  /** Стабільний ключ у наших таблицях: `<topicKey>::<externalId|slug(title)>`. */
  productKey: string;
  /** Etsy listing id, якщо відомий. Для AI-скринінгу зазвичай null. */
  externalId: string | null;
  url: string | null;
  title: string;
  shopName: string | null;
  priceUsd: number | null;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  favorers: number | null;
  tags: string[];
  category: string | null;
  materials: string[];
  availability: string | null;
  /** ISO. Дата створення лістингу на Etsy, якщо відома. */
  createdAt: string | null;
  /** ISO. Коли МИ вперше побачили цей товар. */
  firstSeenAt: string | null;
  provenance: Provenance;
}

/**
 * Зріз показників товару в конкретний момент. Ніколи не перезаписується —
 * лише додається новий рядок (ТЗ 8).
 */
export interface MarketSnapshot {
  id: string;
  productKey: string;
  topicKey: string;
  collectedAt: string;
  priceUsd: number | null;
  reviewCount: number | null;
  favorers: number | null;
  rating: number | null;
  availability: string | null;
  title: string;
  source: FieldSource;
  confidence: number;
}

/** Динаміка між двома зрізами (ТЗ 9). null = недостатньо історії. */
export interface ProductDynamics {
  reviewGrowth: number | null;
  reviewGrowthPct: number | null;
  /** Відгуків на день. */
  reviewVelocity: number | null;
  priceChange: number | null;
  priceChangePct: number | null;
  favoriteGrowth: number | null;
  trend: 'rising' | 'stable' | 'declining' | 'unknown';
  /** Скільки днів між порівнюваними зрізами. */
  daysBetween: number | null;
  /** Скільки зрізів взагалі є на цей товар. 1 = порівнювати нема з чим. */
  snapshotCount: number;
}

/**
 * Оцінна швидкість продажів (ТЗ 10). Окремий тип, щоб її не можна було
 * випадково змішати з реальними продажами: поля названі так, що
 * «продажів» серед них нема.
 */
export interface EstimatedSalesVelocity {
  /** Оцінка продажів на місяць = reviewVelocity * 30 * reviewToSaleRatio. */
  estimatedMonthly: number | null;
  /**
   * Скільки продажів припадає на ОДИН відгук. Конфігурований коефіцієнт,
   * дефолт 10 (тобто відгук лишає приблизно кожен десятий покупець).
   * Саме множник, а не частка: формула вище множить на нього, і 0.1 дало б
   * 0.6 продажу на місяць там, де мало бути 60.
   */
  reviewToSaleRatio: number;
  /** Текст, який інтерфейс зобов'язаний показати поруч. */
  disclaimerUk: string;
}

/** Ваги Opportunity Score у відсотках. Сума має дорівнювати 100 (ТЗ 11). */
export interface ScoreWeights {
  demand: number;
  growth: number;
  competition: number;
  pricePotential: number;
  engagement: number;
  saturation: number;
  margin: number;
}

/** Дефолт із ТЗ 11. Редагується в Settings, тому це лише початкове значення. */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  demand: 25,
  growth: 20,
  competition: 20,
  pricePotential: 10,
  engagement: 10,
  saturation: 10,
  margin: 5,
};

export type ScoreComponent = keyof ScoreWeights;

/** Один доданок формули — щоб score можна було відтворити очима (ТЗ 11, 28). */
export interface ScoreComponentBreakdown {
  component: ScoreComponent;
  /** 0..100 — нормалізований сирий показник. */
  raw: number;
  /** Вага у відсотках. */
  weight: number;
  /** raw * weight / 100. */
  contribution: number;
  /** З чого порахований raw — людською мовою, для аудиту. */
  basisUk: string;
}

export interface OpportunityScore {
  /** 0..100. */
  score: number;
  breakdown: ScoreComponentBreakdown[];
  /** Компоненти, для яких не було даних і які довелось узяти нейтральними. */
  missing: ScoreComponent[];
}

export interface MarketReportItem {
  listing: MarketListing;
  dynamics: ProductDynamics;
  opportunity: OpportunityScore;
  salesVelocity: EstimatedSalesVelocity;
  /** 0..100, індекс популярності (перевикористовує etsyResearch.popularityIndex). */
  popularity: number;
}

export interface MarketAggregate {
  itemCount: number;
  avgPriceUsd: number | null;
  medianPriceUsd: number | null;
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  avgReviewCount: number | null;
  avgOpportunity: number | null;
  risingCount: number;
  decliningCount: number;
  newCount: number;
}

export interface MarketReport {
  topic: string;
  topicKey: string;
  collectedAt: string;
  requestedCount: number;
  items: MarketReportItem[];
  aggregate: MarketAggregate;
  weights: ScoreWeights;
  /** Спільне походження набору. */
  provenance: Provenance;
  /** Яка модель робила скринінг (для 'ai_screen'). */
  modelId?: string;
  engine?: string;
  /** Ключові слова, витягнуті з назв і тегів (перевикористовує etsyResearch). */
  keywordCandidates: Array<{ phrase: string; listings: number; score: number }>;
  disclaimerUk: string;
}

/** Що повертає шар скринінгу до того, як увімкнеться рахунок. */
export interface ScreenResult {
  listings: MarketListing[];
  provenance: Provenance;
  modelId?: string;
  engine?: string;
  /** Сире повідомлення моделі — зберігаємо для аудиту, в UI не показуємо. */
  rawResponse?: string;
  /**
   * Скільки активних лістингів існує за цим запитом ЗА ДАНИМИ ДЖЕРЕЛА.
   *
   * Etsy повертає це число (`count`) разом із видачею — і це справжній обсяг
   * пропозиції в ніші, а не розмір нашої вибірки. Мовна модель такого знати
   * не може, тож для AI-скринінгу поле лишається `null`, і компонент
   * competition чесно рахується з вибірки, як і раніше. Нуль тут заборонений
   * як заміна «не знаю»: 0 означало б порожню нішу.
   */
  totalActive?: number | null;
}

/**
 * Дисклеймер набору. Один текст на весь модуль: якщо його змінити, він
 * зміниться скрізь, і не буде версії звіту без застереження.
 */
export const MARKET_DISCLAIMER_AI_UK =
  'Дані зібрані мовною моделлю, а не з Etsy Open API. Це ОЦІНКА ринку за знаннями моделі, а не факти про конкретні лістинги Etsy: ціни, кількість відгуків і рейтинги можуть не відповідати дійсним. Не приймайте рішень про закупівлю чи ціноутворення лише за цими числами — звіряйте з Etsy вручну або підключіть офіційний API (ETSY_API_KEY).';

export const MARKET_DISCLAIMER_API_UK =
  'Дані з Etsy Open API v3. Реальні продажі чужих лістингів Etsy стороннім застосункам не надає — усе, що стосується продажів, лишається оцінкою за динамікою відгуків.';
