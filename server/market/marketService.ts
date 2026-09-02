/**
 * Оркестратор King Market Intelligence: кеш → скринінг → історизація →
 * рахунок → звіт.
 *
 * Форму цього файлу задали дві вимоги ТЗ і одна обставина середовища.
 *
 *  • ТЗ 8 («попередні значення не перезаписуються»): свіжий скринінг ДОДАЄ
 *    зріз кожному товару. Без цього наступний звіт мав би рівно одну точку
 *    на товар, і вся динаміка з розділу 9 була б порожньою назавжди.
 *  • ТЗ 6 (кеш): повторний запит теми в межах вікна віддає збережений звіт
 *    і не витрачає ані виклику моделі, ані грошей автора.
 *  • Обставина: Etsy API тут не налаштований, тож джерело — мовна модель.
 *    Виклик моделі впорскується як `deps.screen`, а не імпортується: інакше
 *    жоден тест не пройшов би весь конвеєр без мережі й ключів. Це не
 *    декоративна ін'єкція — на ній тримається можливість тестувати модуль
 *    узагалі, тож замінювати її прямим викликом не можна.
 *
 * Сам виклик моделі живе в server/marketRoutes.ts: йому потрібен `req` для
 * запису витрати в usage_log, а сервіс про HTTP нічого не знає.
 */

import { normalizeTopicKey } from '../etsy/etsyResearch';
import { buildMarketReport, normalizeWeights, productKeyFor } from './marketScoring';
import {
  getLatestReport,
  getWeights,
  listSnapshotsForProduct,
  saveReport,
  saveSnapshots,
} from './marketStore';
import type { MarketListing, MarketReport, MarketSnapshot, ScreenResult } from './marketTypes';

/** Скільки годин звіт вважається свіжим. Те саме вікно, що й у дослідженні тем. */
export const MARKET_CACHE_HOURS = Number(process.env.MARKET_CACHE_HOURS || 24);

export type ScreenFn = (params: {
  topic: string;
  count: number;
  modelId?: string;
  req: any;
}) => Promise<ScreenResult>;

export interface MarketServiceDeps {
  screen: ScreenFn;
  now?: () => Date;
  cacheHours?: number;
  log?: (msg: string) => void;
}

export interface MarketRunResult {
  report: MarketReport;
  /** true — віддано збережений звіт, жодного виклику моделі не зроблено. */
  fromCache: boolean;
  cachedAt?: string;
}

function isFresh(collectedAt: string, nowMs: number, cacheHours: number): boolean {
  const collected = Date.parse(collectedAt);
  if (Number.isNaN(collected)) return false;
  return nowMs - collected < cacheHours * 3600_000;
}

/**
 * MarketListing → MarketSnapshot. Перекладаються лише ті поля, що змінюються
 * з часом: назва, ціна, відгуки, вподобання, рейтинг, доступність. Теги,
 * матеріали й URL у ряд не йдуть — вони не показник, а опис товару, і
 * дублювати їх у кожному рядку журналу означало б роздути таблицю без
 * жодної нової відповіді на питання «що змінилось».
 *
 * `source` і `confidence` беруться з походження САМОГО лістингу, а не з
 * набору: у змішаному наборі (частина з Etsy API, частина від моделі)
 * достовірність у товарів різна, і зводити її до одного числа означало б
 * приписати оцінці моделі впевненість факту.
 */
function listingToSnapshot(listing: MarketListing, topicKey: string, collectedAt: string, index: number): MarketSnapshot {
  const productKey = listing.productKey || productKeyFor(topicKey, listing.externalId, listing.title);
  return {
    id: `mks-${Date.parse(collectedAt) || Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    productKey,
    topicKey,
    collectedAt,
    priceUsd: listing.priceUsd,
    reviewCount: listing.reviewCount,
    favorers: listing.favorers,
    rating: listing.rating,
    availability: listing.availability,
    title: listing.title,
    source: listing.provenance.source,
    confidence: listing.provenance.confidence,
  };
}

/**
 * Повний прогін теми. Повертає готовий звіт разом із чесною позначкою, чи
 * він щойно зібраний, чи взятий із журналу.
 */
export async function runMarketScreen(
  params: { topic: string; count: number; userId: string | null; modelId?: string; force?: boolean; req: any },
  deps: MarketServiceDeps
): Promise<MarketRunResult> {
  const now = deps.now || (() => new Date());
  const cacheHours = deps.cacheHours ?? MARKET_CACHE_HOURS;
  const log = deps.log || ((msg: string) => console.log(msg));
  const topicKey = normalizeTopicKey(params.topic);

  const cached = await getLatestReport(topicKey);
  if (cached && !params.force && isFresh(cached.collectedAt, now().getTime(), cacheHours)) {
    log(`[market] «${params.topic}» віддано з журналу від ${cached.collectedAt} — модель не викликалась`);
    return { report: cached.report, fromCache: true, cachedAt: cached.collectedAt };
  }

  const screened = await deps.screen({
    topic: params.topic,
    count: params.count,
    modelId: params.modelId,
    req: params.req,
  });

  const collectedAt = now().toISOString();

  // Історизація ПЕРЕД рахунком: динаміка нинішнього звіту має враховувати і
  // сьогоднішній зріз теж, інакше найсвіжіша точка ряду щоразу губилась би
  // і «зростання» відставало б на один прогін.
  const snapshots = screened.listings.map((l, i) => listingToSnapshot(l, topicKey, collectedAt, i));
  await saveSnapshots(snapshots);

  // Історія по кожному товару окремо, а не одним запитом по темі: запит по
  // темі довелося б обмежувати спільною стелею рядків, і в темі з 25
  // товарами глибока історія одного витіснила б історію решти.
  const snapshotsByProduct = new Map<string, MarketSnapshot[]>();
  for (const listing of screened.listings) {
    const productKey = listing.productKey || productKeyFor(topicKey, listing.externalId, listing.title);
    snapshotsByProduct.set(productKey, await listSnapshotsForProduct(productKey));
  }

  const weights = normalizeWeights(await getWeights());
  const report = buildMarketReport({
    topic: params.topic,
    topicKey,
    listings: screened.listings,
    snapshotsByProduct,
    weights,
    collectedAt,
    provenance: screened.provenance,
    requestedCount: params.count,
    modelId: screened.modelId,
    engine: screened.engine,
  });

  await saveReport(report, params.userId);
  log(
    `[market] «${params.topic}»: ${report.items.length} товарів, джерело ${report.provenance.source}, ` +
      `модель ${report.modelId || 'не вказана'}`
  );
  return { report, fromCache: false };
}

/**
 * Часовий ряд одного товару для графіків картки (ТЗ 7). Віддається у
 * хронологічному порядку — так його малює графік, і так його не доведеться
 * перевертати на клієнті.
 */
export async function productTrend(productKey: string, limit = 200): Promise<MarketSnapshot[]> {
  const history = await listSnapshotsForProduct(productKey, limit);
  return history.slice().sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}
