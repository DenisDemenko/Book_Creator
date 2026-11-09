/**
 * Виклик моделі зору з обмеженням часу й запасними моделями — спільний для
 * розпізнавання сторінок (scanRecognizer.ts) і опису кадрів (photoDraftDescriber.ts).
 *
 * Навіщо. 09.11.2026 розпізнавання трьох сторінок займало 5–6 хвилин. Заміри на
 * живому ключі: модель модуля «Текст за фото» (gemini-3.7-flash) із вечора
 * віддає 503 «high demand» або мовчить без відповіді, а запиту без ліміту часу
 * цього не видно: fetch чекає 300 с (headersTimeout undici), падає з «fetch failed»,
 * aiCore вважає це тимчасовою відмовою й повторює — і так до трьох разів. Інші
 * моделі лінійки на тій самій сторінці відповідають за 2–6 с із нульовою
 * помилкою в тексті, тож проблема не в коді розпізнавання, а в тому, що жоден
 * виклик не вмів покинути мовчазну модель.
 *
 * Що робить. Кожна спроба має власний ліміт часу (SCAN_VISION_TIMEOUT_MS, 30 с).
 * Модель, яку адмін привʼязав до модуля, лишається ПЕРШОЮ; якщо вона не
 * відповіла за ліміт або віддала тимчасову відмову, пробуємо запасні з
 * SCAN_VISION_FALLBACK_MODELS (за замовчуванням дві швидкі моделі лінійки). Той,
 * хто відповів, повертається в `modelId` і лягає в сам кадр — видно, чий це текст.
 * Для Gemini 3 ставиться `thinkingLevel: low`: переписувати текст думати нема про що.
 *
 * Пауза. Модель, яка щойно не відповіла (тайм-аут чи тимчасова відмова), на
 * VISION_COOLDOWN_MS пропускається: інакше кожен пакет сторінок платив би повний
 * ліміт часу за те, що головна модель лежить годинами (так було 09.11.2026 — 37 с
 * замість 3 с). Після паузи вона пробується знову й, відповівши, повертає собі
 * першість. Стан — у памʼяті процесу, на перезапуск обнуляється; єдину модель
 * ланцюжка пропустити не можна, тож вона пробується завжди.
 *
 * Чого не робить: не змінює вибір моделі адміном і не ховає збій — коли
 * відмовили всі, кидається остання помилка.
 */

import { AiTimeoutError, generateText } from '../aiCore';
import { ChatProviderError, ENGINE_ENV_KEY, engineConfigured, modelSupportsVision, resolveEngine } from '../chatProviders';
import { resolveEngineKey } from '../platformKeys';

type GenerateParams = Parameters<typeof generateText>[0];

export const VISION_TIMEOUT_MS_DEFAULT = 30_000;
/** Скільки модель, що не відповіла, пропускається перед наступною пробою. */
export const VISION_COOLDOWN_MS = 180_000;
const cooldownUntil = new Map<string, number>();
/** Лише для тестів: забути, які моделі зараз «на паузі». */
export function resetVisionCooldowns(): void {
  cooldownUntil.clear();
}
/** Швидкі моделі, що на замірі 09.11.2026 відповідали за 2–5 с і переписали сторінки без помилок. */
export const VISION_FALLBACK_MODELS_DEFAULT = ['gemini-3.5-flash-lite', 'gemini-3-flash-preview'];

export function visionTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SCAN_VISION_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 3000 ? Math.round(n) : VISION_TIMEOUT_MS_DEFAULT;
}

/** Не задано — типові; `off`/`none`/`-` — без запасних; інакше — перелік через кому. */
export function visionFallbackModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.SCAN_VISION_FALLBACK_MODELS;
  if (raw === undefined) return [...VISION_FALLBACK_MODELS_DEFAULT];
  const items = raw.split(',').map((m) => m.trim()).filter(Boolean);
  if (items.length === 0 || (items.length === 1 && /^(off|none|-)$/i.test(items[0]))) return [];
  return items;
}

/** Чи варто пробувати наступну модель: тайм-аут, тимчасова відмова провайдера, «моделі немає», мережа. */
export function shouldFailOver(err: unknown): boolean {
  if (err instanceof AiTimeoutError) return true;
  if (err instanceof ChatProviderError) return [404, 408, 425, 429, 500, 502, 503, 504].includes(err.status);
  return true;
}

const rejectsThinking = (err: unknown) => err instanceof ChatProviderError && err.status === 400 && /thinking/i.test(err.message);

export interface VisionFailoverArgs {
  /** Модель, привʼязана адміном до модуля — пробується першою. */
  primaryModelId: string;
  ownerId: string;
  /** Мітка для вибору ключа (resolveEngineKey): `scan-ocr`, `photo-draft`. */
  keyLabel: string;
  /** Усе, що generateText приймає, окрім моделі, ключа й `generation` (їх веде ця функція). */
  params: Omit<GenerateParams, 'engine' | 'modelId' | 'apiKeyOverride' | 'generation'>;
  timeoutMs?: number;
  /** Ліміт для ОСТАННЬОЇ моделі ланцюга (її повтори не обриваємо так рано, як перших). За замовчуванням — `timeoutMs`. */
  lastTimeoutMs?: number;
  fallbackModels?: string[];
  /**
   * false — текстовий прохід без зображень (проходи 2–3 чернеток): моделі не мусять «бачити», а в
   * журналі й помилках не йдеться про зір. За замовчуванням true — як для розпізнавання сторінок.
   */
  requireVision?: boolean;
  /** Тег у рядках логу: `vision` для зору, інший — для текстових проходів. */
  logTag?: string;
  /** Температура й ліміт вихідних токенів — для кожної спроби ланцюга. */
  baseGeneration?: { temperature?: number; maxTokens?: number };
}

export interface FailoverResult {
  text: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}

export interface VisionFailoverDeps {
  generate: typeof generateText;
  resolveKey: (ownerId: string, engine: ReturnType<typeof resolveEngine>, label: string) => Promise<string | undefined>;
  engineReady: (engine: ReturnType<typeof resolveEngine>) => boolean;
  supportsVision: (modelId: string) => boolean;
  warn: (msg: string) => void;
  now: () => number;
}

const realDeps: VisionFailoverDeps = {
  generate: generateText,
  resolveKey: resolveEngineKey,
  engineReady: engineConfigured,
  supportsVision: modelSupportsVision,
  warn: (m) => console.warn(m),
  now: () => Date.now(),
};

export async function generateVisionWithFailover(
  args: VisionFailoverArgs,
  deps: VisionFailoverDeps = realDeps
): Promise<FailoverResult> {
  const { primaryModelId, ownerId, keyLabel, params } = args;
  const timeoutMs = args.timeoutMs ?? visionTimeoutMs();
  const requireVision = args.requireVision !== false;
  if (requireVision && !deps.supportsVision(primaryModelId)) {
    throw new Error(
      `Модель «${primaryModelId}», привʼязана до модуля «Текст за фото», не бачить зображень — оберіть модель із зором в «Ядрі AI».`
    );
  }
  const primaryEngine = resolveEngine(primaryModelId);
  if (!(await deps.resolveKey(ownerId, primaryEngine, keyLabel)) && !deps.engineReady(primaryEngine)) {
    throw new Error(`Модель не налаштована: потрібен ${ENGINE_ENV_KEY[primaryEngine]} на сервері або власний ключ автора.`);
  }

  // Запасні: без повторів головної, без моделей без зору й без рушіїв, до яких немає ключа.
  const chain: Array<{ modelId: string; engine: ReturnType<typeof resolveEngine>; userKey?: string }> = [];
  for (const modelId of [primaryModelId, ...(args.fallbackModels ?? visionFallbackModels())]) {
    if (chain.some((c) => c.modelId === modelId)) continue;
    if (chain.length > 0 && requireVision && !deps.supportsVision(modelId)) continue;
    const engine = resolveEngine(modelId);
    const userKey = await deps.resolveKey(ownerId, engine, keyLabel);
    if (chain.length > 0 && !userKey && !deps.engineReady(engine)) continue;
    chain.push({ modelId, engine, userKey });
  }

  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const { modelId, engine, userKey } = chain[i];
    const isLast = i === chain.length - 1;
    const started = deps.now();
    if (!isLast && (cooldownUntil.get(modelId) ?? 0) > started) continue;
    // Перевантажену модель не добиваємо повторами, якщо є до кого перейти; остання (або єдина) повторює як завжди.
    const generation = { ...args.baseGeneration, timeoutMs: isLast ? (args.lastTimeoutMs ?? timeoutMs) : timeoutMs, ...(isLast ? {} : { transientRetries: 0 }) };
    try {
      let result;
      try {
        result = await deps.generate({
          ...params,
          engine,
          modelId,
          apiKeyOverride: userKey,
          generation: { ...generation, ...(engine === 'gemini' ? { thinkingLevel: 'low' as const } : {}) },
        });
      } catch (err) {
        if (engine !== 'gemini' || !rejectsThinking(err)) throw err;
        // Модель не знає thinkingLevel — та сама модель ще раз, без нього.
        result = await deps.generate({ ...params, engine, modelId, apiKeyOverride: userKey, generation });
      }
      cooldownUntil.delete(modelId);
      if (i > 0) deps.warn(`[${args.logTag ?? 'vision'}] ${params.label}: відповіла запасна модель ${modelId} за ${deps.now() - started} мс`);
      return { text: result.text, modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    } catch (err) {
      lastErr = err;
      if (isLast || !shouldFailOver(err)) throw err;
      cooldownUntil.set(modelId, deps.now() + VISION_COOLDOWN_MS);
      deps.warn(
        `[${args.logTag ?? 'vision'}] ${params.label}: ${modelId} не відповіла за ${deps.now() - started} мс (${String((err as Error)?.message ?? err).slice(0, 120)}) — пробую ${chain[i + 1].modelId}`
      );
    }
  }
  throw lastErr;
}
