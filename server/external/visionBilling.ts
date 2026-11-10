/**
 * Прохід 1 «чернеток за фото» (опис кадру, розпізнавання сторінки рукопису) в БАЛАХ — разом із
 * проходами 2–3 (журнал #538). Досі прохід 1 ішов за грошовим лімітом тексту (рішення 28.10.2026),
 * а проходи 2–3 — за балами (#530): автор бачив два різні обліки за одну чернетку.
 *
 * Як це працює. Перед викликом моделі резервується верхня межа вартості (найдорожча модель
 * ланцюга «головна + запасні»), після відповіді списується фактична вартість моделі, що справді
 * відповіла (не більше резерву), при збої резерв повертається. Тобто так само, як у
 * photoDraftWriter.ts, лише оцінка токенів тут стала: розмір виходу проходу 1 від чернетки
 * не залежить, а кадр завжди один.
 *
 * Чого тут НЕ робиться:
 *  - WriterScan (скани без чернетки) лишається на грошовому ліміті — це інший застосунок, і рішення
 *    власника для нього не змінювалось (див. scanRecognizer.ts);
 *  - адмін, вимкнений облік балів (`AI_CREDITS_DISABLED`), недоступний гаманець і модель без
 *    звіреної ціни — як було: гейт не діє, працює грошовий ліміт. Не звірена ціна НЕ блокує
 *    завантаження кадру (на відміну від проходів 2–3, де автор сам обирає модель).
 *
 * Запобіжник: `PHOTO_DRAFT_PASS1_CREDITS=off` повертає прохід 1 на грошовий ліміт без передеплою
 * коду. Пара «оцінка токенів ↔ реальний рахунок» НЕ звірена з живим журналом витрат — оцінка
 * запасна (див. нижче), а списується фактичне.
 *
 * Усе зовнішнє — через `Deps`, щоб тести не ходили в мережу й не торкались гаманця.
 */

import type { Request } from 'express';
import { GEMINI_MODEL } from '../aiCore';
import { resolveEngine, type EngineId } from '../chatProviders';
import { resolveModuleModelId } from '../coreModuleModels';
import { beginVisionCharge, creditStatus } from '../creditGate';
import { creditsForCostUsd } from '../creditPricing';
import { priceForTextEngine, priceRateForModel, type TextEngine } from '../pricing';
import { passUsd, type PassTokenEstimate, type TokenRate } from './photoDraftEstimate';
import { visionFallbackModels } from './visionFailover';
import type { PassCharge, PassQuote } from './photoDraftRoutes';

export type VisionPassKind = 'describe' | 'recognize';

/*
 * Оцінка токенів одного виклику. Фото в застосунку стискається до 2048 px: Gemini бере 258 токенів
 * на плитку 768 px (до 3×3 = 2322), Claude — w·h/750 (після власного зменшення до ≈1568 px це
 * ≈1600), GPT — 170 на плитку 512 px + 85. 2600 — із запасом над найбільшим із цих значень.
 * Службовий текст (системна інструкція + промпт + нотатки) — до ≈1000 токенів.
 *
 * Вихід: опис кадру — 2–3 речення й теги JSON (≈150–300 токенів), сторінка рукопису — її дослівний
 * текст (≈ 500–1200 токенів на сторінку; максимум 20 000 символів ≈ 8000 токенів). Це ОЦІНКА, не
 * замір на живому ключі: резерв бере ×2 до виходу, а списується фактичне.
 */
export const VISION_IMAGE_TOKENS = 2_600;
export const VISION_PROMPT_TOKENS = 1_000;
export const DESCRIBE_OUTPUT_TOKENS = 350;
export const DESCRIBE_MAX_OUTPUT_TOKENS = 2_000;
export const RECOGNIZE_OUTPUT_TOKENS = 900;
export const RECOGNIZE_MAX_OUTPUT_TOKENS = 8_000;

export function estimateVisionPass(kind: VisionPassKind): PassTokenEstimate {
  return {
    inputTokens: VISION_IMAGE_TOKENS + VISION_PROMPT_TOKENS,
    outputTokens: kind === 'recognize' ? RECOGNIZE_OUTPUT_TOKENS : DESCRIBE_OUTPUT_TOKENS,
    maxOutputTokens: kind === 'recognize' ? RECOGNIZE_MAX_OUTPUT_TOKENS : DESCRIBE_MAX_OUTPUT_TOKENS,
  };
}

/** Прохід 1 в балах увімкнено, поки змінною не вимкнено явно. */
export function pass1CreditsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(0|off|false|no)$/i.test(String(env.PHOTO_DRAFT_PASS1_CREDITS ?? '').trim());
}

/**
 * Ціна проходу за найдорожчою моделлю ланцюга; `null`, якщо жодної моделі не звірено в адмінці.
 * Не звірена модель у ланцюзі просто не береться до уваги: вона не підвищує резерв, а коли
 * відповість, списання піде за очікуваною вартістю (див. `runBilledVision`).
 */
export function quoteVisionChain(
  kind: VisionPassKind,
  chain: string[],
  rate: (engine: EngineId, modelId: string) => TokenRate
): PassQuote | null {
  const est = estimateVisionPass(kind);
  let expectedUsd = 0;
  let maxUsd = 0;
  for (const modelId of chain) {
    const usd = passUsd(rate(resolveEngine(modelId), modelId), est);
    if (!usd) continue;
    expectedUsd = Math.max(expectedUsd, usd.expectedUsd);
    maxUsd = Math.max(maxUsd, usd.maxUsd);
  }
  if (!(maxUsd > 0)) return null;
  return { expectedUsd, maxUsd, expectedCredits: creditsForCostUsd(expectedUsd), maxCredits: creditsForCostUsd(maxUsd) };
}

export interface VisionBillingDeps {
  enabled: () => boolean;
  /** Модель модуля «Текст за фото» (головна), інакше типова. */
  primaryModel: () => Promise<string>;
  fallbackModels: () => string[];
  rate: (engine: EngineId, modelId: string) => TokenRate;
  /** Фактична собівартість виклику, долари. */
  costUsd: (modelId: string, inputTokens: number, outputTokens: number) => number;
  /** Резервує бали; `null` — гейт не діє. Бракує балів — кидає помилку з `kind: 'credits'`. */
  begin: (req: Request, maxUsd: number) => Promise<PassCharge | null>;
  status: (req: Request) => Promise<{ unlimited: boolean; balance: number | null }>;
}

const realDeps: VisionBillingDeps = {
  enabled: () => pass1CreditsEnabled(),
  primaryModel: async () => (await resolveModuleModelId('textFromImage')) || GEMINI_MODEL,
  fallbackModels: () => visionFallbackModels(),
  rate: (engine, modelId) => priceRateForModel(engine as TextEngine, modelId),
  costUsd: (modelId, inputTokens, outputTokens) => priceForTextEngine(resolveEngine(modelId), inputTokens, outputTokens, modelId),
  async begin(req, maxUsd) {
    const job = await beginVisionCharge(req, maxUsd);
    return job ? { reservedCredits: job.reservedCredits, settleUsd: (usd) => job.settleUsd(usd), release: (reason) => job.release(reason) } : null;
  },
  async status(req) {
    const p = req.principal as { id?: unknown; role?: unknown } | undefined;
    if (!p?.id) return { unlimited: true, balance: null };
    const st = await creditStatus(String(p.id), String(p.role || 'writer'));
    return st.unlimited || !st.balance ? { unlimited: true, balance: null } : { unlimited: false, balance: st.balance.available };
  },
};

async function chainFor(deps: VisionBillingDeps): Promise<string[]> {
  const primary = await deps.primaryModel();
  return [primary, ...deps.fallbackModels().filter((m) => m !== primary)];
}

export interface VisionBlock {
  /** true — цей автор платить балами: грошовий ліміт тексту тоді не питаємо. */
  billed: boolean;
  /** Чому прохід не стартує (бракує балів); `null` — можна. */
  reason: string | null;
}

/**
 * Швидка перевірка БЕЗ резерву — щоб завантаження кадру відмовило одразу (402), а не повідомило про
 * «невдалий опис» через секунди. Справжній резерв робить `runBilledVision` перед викликом моделі.
 * Помилка гаманця тут не блокує нікого: тоді `billed: false` і діє грошовий ліміт.
 */
export async function visionCreditsBlock(
  req: Request,
  kind: VisionPassKind,
  deps: VisionBillingDeps = realDeps
): Promise<VisionBlock> {
  const none: VisionBlock = { billed: false, reason: null };
  if (!deps.enabled()) return none;
  try {
    const st = await deps.status(req);
    if (st.unlimited || st.balance === null) return none;
    const quote = quoteVisionChain(kind, await chainFor(deps), deps.rate);
    if (!quote) return none;
    if (st.balance < quote.maxCredits) {
      return {
        billed: true,
        reason:
          `Недостатньо AI-балів: ${kind === 'recognize' ? 'розпізнавання сторінки' : 'опис кадру'} потребує до ${quote.maxCredits}, ` +
          `на балансі ${st.balance}. Поповніть підпискою на сторінці «Підписка».`,
      };
    }
    return { billed: true, reason: null };
  } catch (err) {
    console.warn('[visionBilling] не вдалося перевірити баланс, діє грошовий ліміт:', String((err as Error)?.message ?? err).slice(0, 200));
    return none;
  }
}

export interface BilledVisionArgs<T> {
  req: Request;
  kind: VisionPassKind;
  /** Сам виклик моделі. `billed` — бали вже зарезервовано: грошовий ліміт не питати, токени міркування рахувати. */
  run: (billed: boolean) => Promise<T & { modelId: string; inputTokens: number; outputTokens: number }>;
}

/**
 * Резерв → виклик → списання за фактом / повернення. Не змінює результату виклику. Помилка
 * `begin` (бракує балів) іде нагору як є: маршрут покаже її авторові текстом кадру.
 */
export async function runBilledVision<T>(
  args: BilledVisionArgs<T>,
  deps: VisionBillingDeps = realDeps
): Promise<T & { modelId: string; inputTokens: number; outputTokens: number }> {
  let quote: PassQuote | null = null;
  let charge: PassCharge | null = null;
  if (deps.enabled()) {
    quote = quoteVisionChain(args.kind, await chainFor(deps), deps.rate);
    if (quote) charge = await deps.begin(args.req, quote.maxUsd);
  }
  try {
    const out = await args.run(!!charge);
    if (charge && quote) {
      // Невідома ціна моделі, що відповіла, не робить виклик безкоштовним і не списує весь резерв: беремо очікувану.
      const actual = deps.costUsd(out.modelId, out.inputTokens, out.outputTokens);
      charge.settleUsd(actual > 0 ? actual : quote.expectedUsd);
    }
    return out;
  } catch (err) {
    charge?.release('Прохід 1 не дав результату');
    throw err;
  }
}
