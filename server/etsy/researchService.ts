/**
 * Сервіс дослідження тем: кеш, історизація, планове оновлення.
 *
 * Аналітика живе в etsyResearch.ts (чисті функції), збір — там само
 * (`collectTopicResearch`). Тут — політика: коли можна віддати збережений
 * зріз, коли треба йти в Etsy, і що оновлювати за розкладом.
 *
 * Дві вимоги ТЗ, які визначили форму цього файлу:
 *  • 6.3 — «сервіс працює за розкладом, а не в реальному часі при кожному
 *    запиті користувача»: тому повторний запит теми впродовж вікна кешу
 *    повертає збережений зріз і не витрачає жодного виклику Etsy;
 *  • 6.2 — «історизація… щоб показувати динаміку»: тому кожен свіжий збір
 *    ДОДАЄ зріз, а не перезаписує попередній. Кеш і історія — одна таблиця,
 *    прочитана двома різними запитами.
 */

import { RESEARCH_CACHE_HOURS } from './etsyConfig';
import { buildResearchReport, collectTopicResearch, normalizeTopicKey, type ResearchReport } from './etsyResearch';
import {
  getLatestResearchSnapshot,
  listResearchHistory,
  listTrackedTopics,
  saveResearchSnapshot,
} from '../publishingStore';
import type { EtsyClient } from './etsyClient';

export interface ResearchServiceDeps {
  /** Клієнт із дослідницьким бакетом; null — ETSY_API_KEY не налаштований. */
  client: EtsyClient | null;
  now?: () => Date;
  cacheHours?: number;
  log?: (line: string) => void;
}

export interface ResearchResult {
  report: ResearchReport;
  /** true — віддано з кешу, жодного запиту в Etsy не зроблено. */
  fromCache: boolean;
  cachedAt?: string;
}

function snapshotToReport(snapshot: any): ResearchReport {
  const payload = (snapshot.payload || {}) as Partial<ResearchReport>;
  return {
    topic: snapshot.topic,
    topicKey: snapshot.topicKey,
    taxonomyId: snapshot.taxonomyId,
    collectedAt: snapshot.collectedAt,
    listingCount: snapshot.listingCount,
    totalActive: snapshot.totalActive,
    avgFavorers: snapshot.avgFavorers,
    medianPriceUsd: snapshot.medianPrice,
    topListings: payload.topListings || [],
    keywordCandidates: payload.keywordCandidates || [],
    suggestedTags: payload.suggestedTags || [],
    disclaimerUk: payload.disclaimerUk || '',
  };
}

function isFresh(collectedAt: string, nowMs: number, cacheHours: number): boolean {
  const collected = Date.parse(collectedAt);
  if (Number.isNaN(collected)) return false;
  return nowMs - collected < cacheHours * 3600_000;
}

export async function researchTopic(
  params: { topic: string; taxonomyId?: number; userId?: string; force?: boolean },
  deps: ResearchServiceDeps
): Promise<ResearchResult> {
  const now = deps.now || (() => new Date());
  const cacheHours = deps.cacheHours ?? RESEARCH_CACHE_HOURS;
  const log = deps.log || ((line: string) => console.log(line));
  const topicKey = normalizeTopicKey(params.topic, params.taxonomyId);

  const cached = await getLatestResearchSnapshot(topicKey);
  if (cached && !params.force && isFresh(cached.collectedAt, now().getTime(), cacheHours)) {
    log(`[research] «${params.topic}» віддано з кешу від ${cached.collectedAt}`);
    return { report: snapshotToReport(cached), fromCache: true, cachedAt: cached.collectedAt };
  }

  if (!deps.client) {
    // Ключа немає. Якщо є хоч якийсь старий зріз — краще показати його з
    // чесною датою, ніж порожній екран.
    if (cached) {
      return { report: snapshotToReport(cached), fromCache: true, cachedAt: cached.collectedAt };
    }
    throw new Error(
      'Дослідження тем недоступне: не налаштований ETSY_API_KEY. Решта модуля публікації працює без нього.'
    );
  }

  const { listings, totalActive } = await collectTopicResearch(deps.client, {
    topic: params.topic,
    taxonomyId: params.taxonomyId,
  });
  const report = buildResearchReport({
    topic: params.topic,
    taxonomyId: params.taxonomyId,
    totalActive,
    listings,
    collectedAt: now().toISOString(),
  });

  await saveResearchSnapshot({
    id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: params.userId,
    topicKey,
    topic: params.topic,
    taxonomyId: params.taxonomyId,
    collectedAt: report.collectedAt,
    listingCount: report.listingCount,
    totalActive: report.totalActive,
    avgFavorers: report.avgFavorers,
    medianPrice: report.medianPriceUsd,
    payload: {
      topListings: report.topListings,
      keywordCandidates: report.keywordCandidates,
      suggestedTags: report.suggestedTags,
      disclaimerUk: report.disclaimerUk,
    },
  });

  log(`[research] «${params.topic}»: зібрано ${report.listingCount} лістингів, пропозиція ${report.totalActive}`);
  return { report, fromCache: false };
}

export interface TrendPoint {
  collectedAt: string;
  totalActive: number;
  avgFavorers: number;
  medianPriceUsd: number;
  listingCount: number;
}

/** Часовий ряд для графіка динаміки теми (ТЗ 6.1, останній рядок таблиці). */
export async function topicTrend(
  topic: string,
  taxonomyId?: number,
  limit = 30
): Promise<TrendPoint[]> {
  const history = await listResearchHistory(normalizeTopicKey(topic, taxonomyId), limit);
  return history
    .map((s) => ({
      collectedAt: s.collectedAt,
      totalActive: s.totalActive,
      avgFavorers: s.avgFavorers,
      medianPriceUsd: s.medianPrice,
      listingCount: s.listingCount,
    }))
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}

/**
 * Планове оновлення вже досліджених тем. Саме воно перетворює набір
 * поодиноких запитів на часовий ряд: без нього «динаміка попиту» показувала б
 * рівно одну точку — ту, коли автор востаннє щось шукав.
 */
export function startResearchScheduler(
  deps: ResearchServiceDeps & { intervalMinutes: number; topicsPerRun?: number }
): { stop: () => void } {
  const log = deps.log || ((line: string) => console.log(line));
  if (!deps.intervalMinutes || deps.intervalMinutes <= 0 || !deps.client) {
    return { stop: () => {} };
  }
  const perRun = deps.topicsPerRun ?? 5;
  let stopped = false;
  let busy = false;

  const timer = setInterval(async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const topics = await listTrackedTopics(perRun);
      for (const topic of topics) {
        if (stopped) break;
        try {
          await researchTopic({ topic: topic.topic, taxonomyId: topic.taxonomyId, force: true }, deps);
        } catch (err) {
          // Одна невдала тема не має зупиняти обхід решти.
          log(`[research] Планове оновлення теми «${topic.topic}» не вдалося: ${(err as Error)?.message}`);
        }
      }
    } catch (err) {
      console.error('[research] Помилка планувальника:', err);
    } finally {
      busy = false;
    }
  }, deps.intervalMinutes * 60_000);
  (timer as any)?.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
