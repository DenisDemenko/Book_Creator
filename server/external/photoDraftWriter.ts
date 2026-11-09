/**
 * Справжній текстовий прохід 2–3 «чернеток за фото» (A2): текстова модель ядра
 * AI. Окремий файл від маршрутів і від запису результату: маршрути й тести не
 * тягнуть за собою мережевих провайдерів.
 *
 * ОПЛАТА. До 1.4.0 (рішення власника 28.10.2026) — тариф викладача: generateText
 * сам перевіряє грошовий ліміт текстового ШІ автора (checkChatQuota) і записує
 * витрату на нього, бо `req.principal` — викладач, якому належить токен.
 * З 1.4.0 (журнал #530, 09.11.2026) прохід оплачується БАЛАМИ: маршрут резервує їх
 * до запуску, а сюди приходить `creditBilled` — тоді грошовий ліміт не чіпаємо, а
 * фактичну собівартість повертаємо в `costUsd`, з якої маршрут списує бали.
 */

import { GEMINI_MODEL } from '../aiCore';
import { resolveEngine } from '../chatProviders';
import { priceForTextEngine } from '../pricing';
import { resolveModuleModelId } from '../coreModuleModels';
import { generateVisionWithFailover, visionFallbackModels } from './visionFailover';
import type { WriteTextParams, WriteTextResult } from './photoDraftRoutes';

/** Ліміт часу на ПЕРШІ моделі ланцюга: довша відповідь — привід перейти на запасну, а не чекати 170 с. */
const PASS_ATTEMPT_TIMEOUT_MS = 75_000;
/** Остання модель ланцюга (або єдина) має час на повні 8192 токени. */
const PASS_LAST_TIMEOUT_MS = 170_000;

export async function writeWithCoreText(p: WriteTextParams): Promise<WriteTextResult> {
  // З 1.4.0 модель обирає автор із GET …/ai-options; без вибору — модуль «Розгортання інструкції»
  // (звичайна текстова модель, яку обирає адмін; власної привʼязки проходи GrabFusion не мають).
  const modelId = p.modelId?.trim() || (await resolveModuleModelId('instructionElaboration')) || GEMINI_MODEL;
  // Запасні — лише серед Gemini: авторові, що обрав Claude чи GPT, іншого провайдера й іншу ціну не підсовуємо.
  const fallbackModels = resolveEngine(modelId) === 'gemini' ? visionFallbackModels().filter((m) => resolveEngine(m) === 'gemini') : [];
  const out = await generateVisionWithFailover({
    primaryModelId: modelId,
    ownerId: p.ownerId,
    keyLabel: 'photo-draft',
    requireVision: false,
    logTag: 'photo-pass',
    fallbackModels,
    timeoutMs: PASS_ATTEMPT_TIMEOUT_MS,
    lastTimeoutMs: PASS_LAST_TIMEOUT_MS,
    baseGeneration: { temperature: 0.4, maxTokens: p.maxTokens },
    params: {
      prompt: p.prompt,
      systemInstruction: p.system,
      json: true,
      skipBudgetCheck: p.creditBilled,
      countThinkingTokens: true,
      req: p.req,
      label: `${p.label} ${p.draftId}`,
    },
  });
  // Фактична собівартість за моделлю, що справді відповіла (запасна може бути іншою): з неї списуються бали.
  const costUsd = priceForTextEngine(resolveEngine(out.modelId), out.inputTokens, out.outputTokens, out.modelId);
  return { text: out.text, modelId: out.modelId, costUsd };
}
