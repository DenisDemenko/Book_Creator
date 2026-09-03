/**
 * Сховище King Market Intelligence: часовий ряд зрізів + журнал звітів.
 *
 * Контракт той самий, що й у server/publishingStore.ts, і не випадково:
 * основний бекенд — SQLite (`node:sqlite`, схема в server/db.ts), а якщо
 * його немає, ті самі функції прозоро працюють поверх JSON-файлу в
 * DATA_DIR. Модуль не має падати лише тому, що середовище старіше за
 * Node 22.5, — і, головне, тести сховища ганяються по обох бекендах
 * однаковим набором перевірок.
 *
 * ЧОМУ ТУТ НЕМАЄ ЖОДНОГО UPDATE ДЛЯ ЗРІЗІВ. ТЗ 8 вимагає append-only:
 * попередній зріз не перезаписується ніколи. Без цього модуль втрачає сенс
 * — Review Velocity, Price Change і взагалі вся динаміка рахуються лише з
 * різниці між рядками. Тому `saveSnapshots` уміє тільки INSERT, і жодного
 * `ON CONFLICT DO UPDATE` в цьому файлі немає навмисно.
 *
 * Звіти теж додаються, а не оновлюються: `getLatestReport` бере найсвіжіший
 * рядок теми. Так той самий журнал одночасно є кешем (свіжий рядок) і
 * історією (усі попередні).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb, isAvailable, DATA_DIR } from '../db';
import { getAppSetting, setAppSetting } from '../store';
import {
  DEFAULT_SCORE_WEIGHTS,
  type FieldSource,
  type MarketReport,
  type MarketSnapshot,
  type ScoreWeights,
} from './marketTypes';

// ---------------------------------------------------------------------------
// Ключі в таблиці `meta`
// ---------------------------------------------------------------------------

/** Ваги Opportunity Score, відредаговані адміном у Settings (ТЗ 11). */
export const MARKET_WEIGHTS_META_KEY = 'market_score_weights';

/** Модель, якою робиться скринінг. null = «хай вирішує прив'язка ядра». */
export const MARKET_SCREEN_MODEL_META_KEY = 'market_screen_model';
/** Джерело скринінгу, обране адміном: 'auto' | 'ai_screen' | 'etsy_api'. */
export const MARKET_SCREEN_SOURCE_META_KEY = 'market_screen_source';

// ---------------------------------------------------------------------------
// Внутрішній тип рядка журналу звітів
// ---------------------------------------------------------------------------

interface StoredMarketReport {
  id: string;
  userId?: string;
  topicKey: string;
  topic: string;
  collectedAt: string;
  itemCount: number;
  avgOpportunity: number | null;
  source: FieldSource;
  modelId?: string;
  /** MarketReport цілком — те, що віддається клієнту без перерахунку. */
  payload: MarketReport;
}

// ---------------------------------------------------------------------------
// JSON-бекенд (fallback)
// ---------------------------------------------------------------------------

interface JsonShape {
  snapshots: MarketSnapshot[];
  reports: StoredMarketReport[];
}

const JSON_FILE = 'market.json';
const EMPTY: JsonShape = { snapshots: [], reports: [] };

/**
 * Стеля обох масивів у файловому режимі. Те саме число, що й у
 * saveResearchSnapshot: файл читається цілком у пам'ять на кожен запит, тож
 * безмежно рости йому не можна. У SQLite стелі немає — там журнал тримає
 * повну історію, і саме він є «справжнім» бекендом.
 */
const JSON_MAX_ROWS = 500;

let jsonCache: JsonShape | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

async function loadJson(): Promise<JsonShape> {
  if (jsonCache) return jsonCache;
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, JSON_FILE), 'utf8');
    jsonCache = { ...EMPTY, ...(JSON.parse(raw) as Partial<JsonShape>) };
  } catch {
    jsonCache = structuredClone(EMPTY);
  }
  return jsonCache;
}

function persistJson(): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const target = path.join(DATA_DIR, JSON_FILE);
      const temp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(jsonCache, null, 2), 'utf8');
      await fs.rename(temp, target);
    })
    .catch((err) => console.error('[marketStore] Не вдалося зберегти market.json:', err));
  return writeChain as Promise<void>;
}

function useJson(): boolean {
  return !isAvailable();
}

// ---------------------------------------------------------------------------
// Перетворення рядків SQLite → об'єкти
// ---------------------------------------------------------------------------

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface SnapshotRow {
  id: string; product_key: string; topic_key: string; collected_at: string;
  price_usd: number | null; review_count: number | null; favorers: number | null;
  rating: number | null; availability: string | null; title: string;
  source: string; confidence: number;
}

function rowToSnapshot(row: SnapshotRow): MarketSnapshot {
  return {
    id: row.id,
    productKey: row.product_key,
    topicKey: row.topic_key,
    collectedAt: row.collected_at,
    // `?? null`, а не `|| null`: 0 відгуків і ціна 0 — це значення, а не
    // «джерело не дало». Різницю між нулем і NULL тут тримає ТЗ 2.
    priceUsd: row.price_usd ?? null,
    reviewCount: row.review_count ?? null,
    favorers: row.favorers ?? null,
    rating: row.rating ?? null,
    availability: row.availability ?? null,
    title: row.title,
    source: row.source as FieldSource,
    confidence: row.confidence,
  };
}

interface ReportRow {
  id: string; user_id: string | null; topic_key: string; topic: string;
  collected_at: string; item_count: number; avg_opportunity: number | null;
  source: string; model_id: string | null; payload: string;
}

function rowToReport(row: ReportRow): StoredMarketReport {
  return {
    id: row.id,
    userId: row.user_id || undefined,
    topicKey: row.topic_key,
    topic: row.topic,
    collectedAt: row.collected_at,
    itemCount: row.item_count,
    avgOpportunity: row.avg_opportunity ?? null,
    source: row.source as FieldSource,
    modelId: row.model_id || undefined,
    payload: parseJsonField<MarketReport>(row.payload, {} as MarketReport),
  };
}

// ---------------------------------------------------------------------------
// Зрізи (append-only)
// ---------------------------------------------------------------------------

/**
 * Додає пачку зрізів одним заходом. Пачкою, а не по одному, бо один
 * скринінг теми дає 10-25 товарів, і кожен із них — окремий рядок ряду.
 */
export async function saveSnapshots(snapshots: MarketSnapshot[]): Promise<void> {
  if (!snapshots.length) return;

  if (useJson()) {
    const store = await loadJson();
    store.snapshots.push(...snapshots);
    if (store.snapshots.length > JSON_MAX_ROWS) {
      store.snapshots = store.snapshots.slice(-JSON_MAX_ROWS);
    }
    await persistJson();
    return;
  }

  const stmt = getDb()!.prepare(
    `INSERT INTO market_snapshots (id, product_key, topic_key, collected_at, price_usd, review_count, favorers, rating, availability, title, source, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const s of snapshots) {
    stmt.run(
      s.id,
      s.productKey,
      s.topicKey,
      s.collectedAt,
      s.priceUsd,
      s.reviewCount,
      s.favorers,
      s.rating,
      s.availability,
      s.title,
      s.source,
      s.confidence
    );
  }
}

/**
 * Уся історія теми, найсвіжіше першим. Потрібна перерахунку динаміки: щоб
 * порівняти сьогоднішній зріз із торішнім, шар рахунку має отримати обидва.
 */
export async function listSnapshotsForTopic(topicKey: string, limit = 500): Promise<MarketSnapshot[]> {
  if (useJson()) {
    return (await loadJson()).snapshots
      .filter((s) => s.topicKey === topicKey)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
      .slice(0, limit);
  }
  const rows = getDb()!
    .prepare('SELECT * FROM market_snapshots WHERE topic_key = ? ORDER BY collected_at DESC LIMIT ?')
    .all(topicKey, limit) as SnapshotRow[];
  return rows.map(rowToSnapshot);
}

/** Історія одного товару — графіки ціни й відгуків у картці (ТЗ 7). */
export async function listSnapshotsForProduct(productKey: string, limit = 200): Promise<MarketSnapshot[]> {
  if (useJson()) {
    return (await loadJson()).snapshots
      .filter((s) => s.productKey === productKey)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
      .slice(0, limit);
  }
  const rows = getDb()!
    .prepare('SELECT * FROM market_snapshots WHERE product_key = ? ORDER BY collected_at DESC LIMIT ?')
    .all(productKey, limit) as SnapshotRow[];
  return rows.map(rowToSnapshot);
}

// ---------------------------------------------------------------------------
// Звіти
// ---------------------------------------------------------------------------

export async function saveReport(report: MarketReport, userId: string | null): Promise<void> {
  const row: StoredMarketReport = {
    id: `mkt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: userId || undefined,
    topicKey: report.topicKey,
    topic: report.topic,
    collectedAt: report.collectedAt,
    itemCount: report.aggregate?.itemCount ?? report.items.length,
    avgOpportunity: report.aggregate?.avgOpportunity ?? null,
    source: report.provenance.source,
    modelId: report.modelId,
    payload: report,
  };

  if (useJson()) {
    const store = await loadJson();
    store.reports.push(row);
    if (store.reports.length > JSON_MAX_ROWS) {
      store.reports = store.reports.slice(-JSON_MAX_ROWS);
    }
    await persistJson();
    return;
  }

  getDb()!
    .prepare(
      `INSERT INTO market_reports (id, user_id, topic_key, topic, collected_at, item_count, avg_opportunity, source, model_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.userId ?? null,
      row.topicKey,
      row.topic,
      row.collectedAt,
      row.itemCount,
      row.avgOpportunity,
      row.source,
      row.modelId ?? null,
      JSON.stringify(row.payload)
    );
}

/**
 * Найсвіжіший звіт теми. Це і є кеш: рішення «свіжий чи ні» приймає не
 * сховище, а marketService — тут лише факт «ось останній і ось коли».
 */
export async function getLatestReport(
  topicKey: string
): Promise<{ report: MarketReport; collectedAt: string } | null> {
  let found: StoredMarketReport | undefined;

  if (useJson()) {
    found = (await loadJson()).reports
      .filter((r) => r.topicKey === topicKey)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0];
  } else {
    const row = getDb()!
      .prepare('SELECT * FROM market_reports WHERE topic_key = ? ORDER BY collected_at DESC LIMIT 1')
      .get(topicKey) as ReportRow | undefined;
    found = row ? rowToReport(row) : undefined;
  }

  // Зіпсований payload (обірваний запис, ручна правка файлу) не має видавати
  // себе за звіт — краще «кешу немає» і чесний перезбір, ніж порожній екран.
  if (!found || !found.payload || !Array.isArray(found.payload.items)) return null;
  return { report: found.payload, collectedAt: found.collectedAt };
}

/** Теми, які вже досліджували, — вкладка Trends і планове оновлення. */
export async function listTrackedTopics(
  limit = 25
): Promise<Array<{ topicKey: string; topic: string; collectedAt: string; itemCount: number }>> {
  if (useJson()) {
    const seen = new Map<string, { topicKey: string; topic: string; collectedAt: string; itemCount: number }>();
    const sorted = (await loadJson()).reports
      .slice()
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
    for (const r of sorted) {
      if (!seen.has(r.topicKey)) {
        seen.set(r.topicKey, {
          topicKey: r.topicKey,
          topic: r.topic,
          collectedAt: r.collectedAt,
          itemCount: r.itemCount,
        });
      }
      if (seen.size >= limit) break;
    }
    return [...seen.values()];
  }

  // MAX(collected_at) у GROUP BY: SQLite гарантує, що решта колонок рядка
  // береться саме з того рядка, на якому спрацював MAX (bare columns), —
  // тож topic та item_count належать найсвіжішому звіту теми, а не
  // випадковому.
  const rows = getDb()!
    .prepare(
      `SELECT topic_key, topic, item_count, MAX(collected_at) AS last_at
         FROM market_reports
        GROUP BY topic_key
        ORDER BY last_at DESC
        LIMIT ?`
    )
    .all(limit) as { topic_key: string; topic: string; item_count: number; last_at: string }[];
  return rows.map((r) => ({
    topicKey: r.topic_key,
    topic: r.topic,
    collectedAt: r.last_at,
    itemCount: r.item_count,
  }));
}

// ---------------------------------------------------------------------------
// Налаштування модуля (таблиця `meta` через store.ts)
// ---------------------------------------------------------------------------

const WEIGHT_KEYS = Object.keys(DEFAULT_SCORE_WEIGHTS) as Array<keyof ScoreWeights>;

/**
 * Ваги Opportunity Score. Читання оборонне за зразком
 * coreModuleModels.readCoreModuleModels: крива або частково збережена мапа
 * не має валити весь звіт — бракуючі компоненти беруться із заводських.
 * Нормалізацію суми до 100 робить marketScoring.normalizeWeights, а не
 * сховище: там це чиста функція, покрита тестами.
 */
export async function getWeights(): Promise<ScoreWeights> {
  const raw = await getAppSetting(MARKET_WEIGHTS_META_KEY);
  if (!raw) return { ...DEFAULT_SCORE_WEIGHTS };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SCORE_WEIGHTS };
    const out: ScoreWeights = { ...DEFAULT_SCORE_WEIGHTS };
    for (const key of WEIGHT_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
    }
    return out;
  } catch {
    return { ...DEFAULT_SCORE_WEIGHTS };
  }
}

export async function setWeights(w: ScoreWeights): Promise<ScoreWeights> {
  const next: ScoreWeights = { ...DEFAULT_SCORE_WEIGHTS };
  for (const key of WEIGHT_KEYS) {
    const value = (w as unknown as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) next[key] = value;
  }
  await setAppSetting(MARKET_WEIGHTS_META_KEY, JSON.stringify(next));
  return next;
}

/**
 * Модель скринінгу, обрана адміном саме для цього модуля. null означає
 * «нічого не обрано» — тоді маршрут падає на прив'язку ядра
 * (coreModuleModels), а вже вона — на серверний дефолт.
 */
export async function getScreenModelId(): Promise<string | null> {
  const raw = await getAppSetting(MARKET_SCREEN_MODEL_META_KEY);
  const trimmed = (raw || '').trim();
  return trimmed || null;
}

export async function setScreenModelId(id: string | null): Promise<string | null> {
  const trimmed = (id || '').trim();
  // Порожній рядок — це «прибрати вибір», а не «зберегти порожнечу»:
  // той самий принцип, що й у setCoreModuleModel.
  await setAppSetting(MARKET_SCREEN_MODEL_META_KEY, trimmed);
  return trimmed || null;
}

/**
 * Джерело скринінгу.
 *
 * 'auto' (за замовчуванням) — офіційний API, якщо він налаштований, інакше
 * мовна модель. Адмін може прибити джерело жорстко: 'etsy_api' корисно, щоб
 * випадкова помилка конфігурації не перевела всю студію на оцінки моделі
 * непомітно, а 'ai_screen' — щоб не витрачати добову квоту Etsy, поки
 * налаштовується щось інше.
 */
export type ScreenSourceSetting = 'auto' | 'ai_screen' | 'etsy_api';

const SCREEN_SOURCE_VALUES: ScreenSourceSetting[] = ['auto', 'ai_screen', 'etsy_api'];

export async function getScreenSource(): Promise<ScreenSourceSetting> {
  const raw = ((await getAppSetting(MARKET_SCREEN_SOURCE_META_KEY)) || '').trim();
  return (SCREEN_SOURCE_VALUES as string[]).includes(raw) ? (raw as ScreenSourceSetting) : 'auto';
}

export async function setScreenSource(value: string | null): Promise<ScreenSourceSetting> {
  const trimmed = (value || '').trim();
  const next: ScreenSourceSetting = (SCREEN_SOURCE_VALUES as string[]).includes(trimmed)
    ? (trimmed as ScreenSourceSetting)
    : 'auto';
  await setAppSetting(MARKET_SCREEN_SOURCE_META_KEY, next);
  return next;
}

/** Лише для тестів: скидає кеш JSON-бекенду. */
export function __resetMarketCacheForTests(): void {
  jsonCache = null;
}
