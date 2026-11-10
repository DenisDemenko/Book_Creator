/**
 * Моделі для проходів 2–3 «чернеток за фото» (GrabFusion): які з них справді можна обрати і
 * скільки балів це коштує (журнал #530, рішення власника 09.11.2026).
 *
 * Досі прохід ішов на ту модель, яку адмін привʼязав до модуля, а на екрані застосунку про це не
 * було нічого: ключ міг бути відсутній чи прострочений, і автор бачив «ключ недійсний» уже ПІСЛЯ
 * натискання. Тут це перевіряється ДО запуску: за кожною моделлю з `CHAT_MODELS` дивимось, чи є ключ
 * у «Ключах API» (чи змінній оточення), і одним дешевим запитом — чи провайдер його приймає й чи є на
 * ньому кошти. Результат кешується, щоб екран не бив провайдера на кожне відкриття.
 *
 * Модуль не знає про маршрути: їх інтерфейс `PassModels` лежить у photoDraftRoutes.ts, а сюди
 * підставляються справжні ключі, ціни й гаманець. Усе зовнішнє — через `Deps`, щоб тести не ходили в мережу.
 */

import type { Request } from 'express';
import { AiTimeoutError, dispatch } from '../aiCore';
import {
  CHAT_MODELS,
  ENGINE_LABELS,
  engineConfigured,
  resolveEngine,
  type ChatModelInfo,
  type EngineId,
} from '../chatProviders';
import { resolveEngineKey } from '../platformKeys';
import { resolveModuleModelId } from '../coreModuleModels';
import { priceRateForModel, type TextEngine } from '../pricing';
import { creditsForCostUsd } from '../creditPricing';
import { beginTextCharge, creditStatus } from '../creditGate';
import type { PassModelStatus } from '../../shared/photoDraftContract';
import type { PassCharge, PassModelProbe, PassModels, PassQuote } from './photoDraftRoutes';
import { passUsd, type PassTokenEstimate } from './photoDraftEstimate';
import { visionFallbackModels } from './visionFailover';
import { visionCreditsBlock } from './visionBilling';

/** Скільки живе результат перевірки: робоча модель — довго, відмова ключа — коротше, перевантаження — хвилину. */
export const PROBE_TTL_OK_MS = 5 * 60_000;
export const PROBE_TTL_FAIL_MS = 2 * 60_000;
export const PROBE_TTL_BUSY_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const PROBE_PARALLEL = 4;

/** Модуль ядра, чия привʼязка задає типову модель проходів (див. photoDraftWriter.ts). */
export const PASS_MODULE_KEY = 'instructionElaboration' as const;

export interface ProbeResult {
  status: PassModelStatus;
  note: string | null;
}

const NOTES: Record<Exclude<PassModelStatus, 'ok'>, string> = {
  no_key: 'Ключ цього провайдера не введено в адмінці Studio.',
  key_rejected: 'Провайдер відхилив ключ з адмінки — оновіть його в розділі «Ключі API».',
  no_funds: 'На ключі немає коштів або вичерпано квоту провайдера.',
  model_missing: 'Провайдер не знає цієї моделі.',
  price_unknown: 'Ціну моделі в адмінці не звірено — бали порахувати не можна.',
  busy: 'Модель зараз перевантажена або не відповідає.',
};

/** Що саме означає відмова провайдера на пробний запит. */
export function classifyProbeFailure(err: unknown): ProbeResult {
  if (err instanceof AiTimeoutError || (err as Error)?.name === 'AbortError') {
    return { status: 'busy', note: NOTES.busy };
  }
  const e = err as { status?: unknown; message?: unknown };
  const status = Number(e?.status ?? 0);
  const msg = String(e?.message ?? err ?? '');
  const money = /insufficient|billing|credit balance|credits|quota|exceeded your current|RESOURCE_EXHAUSTED|payment|balance|out of/i;
  const badKey = /API_KEY_INVALID|api key not valid|invalid api key|incorrect api key|invalid x-api-key|authentication|unauthorized|api key expired/i;
  if (status === 402 || ((status === 429 || status === 403 || status === 400) && money.test(msg) && !badKey.test(msg))) {
    return { status: 'no_funds', note: NOTES.no_funds };
  }
  if (status === 401 || status === 403 || badKey.test(msg)) return { status: 'key_rejected', note: NOTES.key_rejected };
  if (status === 404 || /model.*(not found|does not exist|not supported)|unknown model|no such model/i.test(msg)) {
    return { status: 'model_missing', note: NOTES.model_missing };
  }
  return { status: 'busy', note: NOTES.busy };
}

export interface ModelsDeps {
  models: () => ChatModelInfo[];
  /** Ключ рушія для цього автора (платформний → власний), або undefined. Викликається раз на рушій. */
  resolveKey: (ownerId: string, engine: EngineId) => Promise<string | undefined>;
  engineReady: (engine: EngineId) => boolean;
  /** Пробний запит до моделі: кидає, якщо ключ чи модель не працюють. */
  ping: (modelId: string, engine: EngineId, key: string | undefined, signal: AbortSignal) => Promise<void>;
  /** Модель, привʼязана адміном до проходів (модуль ядра), якщо є. */
  boundModel: () => Promise<string | undefined>;
  /** Запасні моделі Gemini, на які прохід перейде сам (photoDraftWriter); інших рушіїв не підміняємо. */
  fallbackModels: () => string[];
  rate: (engine: EngineId, modelId: string) => { inputPerMillionUsd: number | null; outputPerMillionUsd: number | null };
  now: () => number;
}

const realDeps: ModelsDeps = {
  models: () => CHAT_MODELS,
  resolveKey: (ownerId, engine) => resolveEngineKey(ownerId, engine, 'photo-draft-options', true),
  engineReady: engineConfigured,
  ping: async (modelId, engine, key, signal) => {
    await dispatch(engine, modelId, 'ping', 'Reply with the single word: pong.', key, undefined, false, { maxTokens: 32, signal });
  },
  boundModel: () => resolveModuleModelId(PASS_MODULE_KEY),
  fallbackModels: () => visionFallbackModels().filter((m) => resolveEngine(m) === 'gemini'),
  rate: (engine, modelId) => priceRateForModel(engine as TextEngine, modelId),
  now: () => Date.now(),
};

interface CacheEntry {
  at: number;
  ttl: number;
  result: ProbeResult;
}
const probeCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ProbeResult>>();

export function resetModelProbeCache(): void {
  probeCache.clear();
  inFlight.clear();
}

/** Відбиток ключа в кеші: зміна ключа в адмінці одразу скидає «ключ відхилено». */
function keyTag(key: string | undefined): string {
  if (!key) return 'env';
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return `${key.length}:${(h >>> 0).toString(36)}`;
}

async function probe(modelId: string, engine: EngineId, key: string | undefined, deps: ModelsDeps): Promise<ProbeResult> {
  const cacheKey = `${modelId}|${keyTag(key)}`;
  const hit = probeCache.get(cacheKey);
  if (hit && deps.now() - hit.at < hit.ttl) return hit.result;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;
  const run = (async (): Promise<ProbeResult> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    let result: ProbeResult;
    try {
      await deps.ping(modelId, engine, key, ctrl.signal);
      result = { status: 'ok', note: null };
    } catch (err) {
      result = classifyProbeFailure(err);
    } finally {
      clearTimeout(timer);
    }
    const ttl = result.status === 'ok' ? PROBE_TTL_OK_MS : result.status === 'busy' ? PROBE_TTL_BUSY_MS : PROBE_TTL_FAIL_MS;
    probeCache.set(cacheKey, { at: deps.now(), ttl, result });
    return result;
  })().finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, run);
  return run;
}

/** Виконує задачі з обмеженням паралельності — інакше перевірка всіх моделей розкрила б десяток запитів одразу. */
async function inPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface ModelListing {
  models: PassModelProbe[];
  defaultModelId: string | null;
  checkedAt: string;
}

const RANK: Record<PassModelStatus, number> = { ok: 0, busy: 1, no_funds: 2, key_rejected: 3, model_missing: 4, price_unknown: 5, no_key: 6 };

export async function listPassModels(ownerId: string, deps: ModelsDeps = realDeps): Promise<ModelListing> {
  const bound = await deps.boundModel();
  const candidates: ChatModelInfo[] = [...deps.models()];
  // Модель, яку адмін привʼязав до модуля, може бути поза переліком чату — вона теж кандидат.
  if (bound && !candidates.some((m) => m.id === bound)) {
    const engine = resolveEngine(bound);
    candidates.push({ id: bound, engine, label: bound, provider: ENGINE_LABELS[engine], contextWindow: '', vision: false });
  }

  const engines = [...new Set(candidates.map((m) => m.engine))];
  const keys = new Map<EngineId, string | undefined>();
  for (const engine of engines) keys.set(engine, await deps.resolveKey(ownerId, engine));
  const hasKey = (engine: EngineId) => Boolean(keys.get(engine)) || deps.engineReady(engine);

  const probed = await inPool(candidates, PROBE_PARALLEL, async (m): Promise<PassModelProbe> => {
    const base = { modelId: m.id, label: m.label, provider: m.provider };
    let result: ProbeResult;
    if (!hasKey(m.engine)) {
      result = { status: 'no_key', note: NOTES.no_key };
    } else {
      const rate = deps.rate(m.engine, m.id);
      // Без ціни бали не порахувати — модель не пропонуємо й не витрачаємо на неї пробний запит.
      result =
        rate.inputPerMillionUsd === null || rate.outputPerMillionUsd === null
          ? { status: 'price_unknown', note: NOTES.price_unknown }
          : await probe(m.id, m.engine, keys.get(m.engine), deps);
      // Основна модель Gemini недоступна (перевантажена чи вичерпано її квоту), а запасна, на яку
      // прохід перейде сам, відповідає — рушій придатний, просто не на першій моделі.
      if ((result.status === 'busy' || result.status === 'no_funds') && m.engine === 'gemini') {
        const was = result.status === 'no_funds' ? 'Ліміт цієї моделі вичерпано' : 'Модель зараз перевантажена';
        for (const fb of deps.fallbackModels()) {
          if (fb === m.id) continue;
          if ((await probe(fb, m.engine, keys.get(m.engine), deps)).status === 'ok') {
            result = { status: 'busy', note: `${was} — Studio перейде на запасну модель ${fb}.` };
            break;
          }
        }
      }
    }
    return { ...base, status: result.status, usable: result.status === 'ok' || result.status === 'busy', note: result.note };
  });

  const usable = probed.filter((m) => m.usable);
  let defaultModelId: string | null = null;
  if (bound && usable.some((m) => m.modelId === bound)) defaultModelId = bound;
  else defaultModelId = (usable.find((m) => m.status === 'ok') ?? usable[0])?.modelId ?? null;

  // Типова — першою, далі за придатністю; усередині групи порядок CHAT_MODELS не змінюємо.
  const sorted = probed
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (a.m.modelId === defaultModelId) return -1;
      if (b.m.modelId === defaultModelId) return 1;
      return RANK[a.m.status] - RANK[b.m.status] || a.i - b.i;
    })
    .map((x) => x.m);
  return { models: sorted, defaultModelId, checkedAt: new Date(deps.now()).toISOString() };
}

/** Бали за прохід на моделі; `null` — ціну не звірено або вона нульова. */
export function quotePass(modelId: string, est: PassTokenEstimate, deps: Pick<ModelsDeps, 'rate'> = realDeps): PassQuote | null {
  const usd = passUsd(deps.rate(resolveEngine(modelId), modelId), est);
  if (!usd) return null;
  return {
    expectedUsd: usd.expectedUsd,
    maxUsd: usd.maxUsd,
    expectedCredits: creditsForCostUsd(usd.expectedUsd),
    maxCredits: creditsForCostUsd(usd.maxUsd),
  };
}

/** Справжня реалізація для server.ts: ключі й ціни адмінки, гаманець балів. */
export const passModels: PassModels = {
  list: (ownerId) => listPassModels(ownerId),
  quote: (modelId, est) => quotePass(modelId, est),
  async balance(req: Request) {
    const p = req.principal as { id?: unknown; role?: unknown } | undefined;
    if (!p?.id) return { unlimited: true, balance: null };
    const status = await creditStatus(String(p.id), String(p.role || 'writer'));
    return status.unlimited || !status.balance
      ? { unlimited: true, balance: null }
      : { unlimited: false, balance: status.balance.available };
  },
  visionBlock: (req, kind) => visionCreditsBlock(req, kind),
  async begin(req: Request, quote: PassQuote): Promise<PassCharge | null> {
    const job = await beginTextCharge(req, quote.maxUsd);
    return job
      ? { reservedCredits: job.reservedCredits, settleUsd: (usd) => job.settleUsd(usd), release: (reason) => job.release(reason) }
      : null;
  },
};
