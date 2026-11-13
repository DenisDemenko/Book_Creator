/**
 * Оцінка розміру проходів 2–3 «чернеток за фото» — з неї виходить і підказка «≈ N балів» у
 * GrabFusion, і резерв балів до запуску (журнал #530). Модуль чистий: без мережі, бази й цін —
 * ціну моделі накладає photoDraftAiModels.ts.
 *
 * Оцінка свідомо груба, бо вихід моделі наперед невідомий. Тому резерв береться з запасом, а
 * списується фактична вартість (не більше за резерв): помилка оцінки тут коштує авторові тимчасово
 * заблокованих балів, а не зайвого списання.
 */

/** Символів кирилиці на токен — те саме 2,5, що для Jev (server/core/ai/jevBilling.ts): занижувати не можна. */
export const CHARS_PER_TOKEN = 2.5;
/**
 * Запас резерву над очікуваним входом і виходом. Вихід — з подвійним запасом: «думаючі» моделі
 * (Gemini 3.x, GPT-5.x) додають до виходу токени міркування, яких наперед не видно. Резерв лише
 * блокується, а списується фактичне, тож запас авторові нічого не коштує, поки вистачає балів.
 */
export const INPUT_RESERVE_BUFFER = 1.25;
export const OUTPUT_RESERVE_BUFFER = 2;

/*
 * Очікуваний вихід виміряно 09.11.2026 на справжній моделі (gemini-3.5-flash-lite, інструкція зі
 * складання столу): прохід 2 — 244 / 441 / 713 токенів на 3 / 6 / 12 кадрів (≈ 90 + 55·кадрів),
 * прохід 3 — 575 токенів на модуль із 3 кроків (≈ 190 на крок). Нижче — те саме із запасом ≈ 1,5×:
 * багатослівніші моделі (Claude, GPT) пишуть довше за Gemini.
 */
/** Службові токени виходу, що не залежать від розміру чернетки (назва, обгортка JSON, припущення). */
const STRUCTURE_OUTPUT_BASE = 200;
/** Токенів виходу на один кадр у проході 2: рядок уроку (назва, мета) і id кадру. */
const STRUCTURE_OUTPUT_PER_PHOTO = 80;
const GENERATE_OUTPUT_BASE = 200;
/** Токенів виходу на один урок у проході 3: текст кроку чи уроку, мета, теми. */
const GENERATE_OUTPUT_PER_LESSON = 250;

export interface PassTokenEstimate {
  inputTokens: number;
  /** Очікуваний вихід. */
  outputTokens: number;
  /** Стеля виходу, яку взагалі дозволяє запит (`maxTokens`). */
  maxOutputTokens: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil([...text].length / CHARS_PER_TOKEN);
}

function build(system: string, prompt: string, expectedOutput: number, maxOutputTokens: number): PassTokenEstimate {
  return {
    inputTokens: estimateTokens(system) + estimateTokens(prompt),
    outputTokens: Math.min(expectedOutput, maxOutputTokens),
    maxOutputTokens,
  };
}

/** Прохід 2 («Розкласти»): вихід росте з кількістю кадрів. */
export function estimateStructurePass(system: string, prompt: string, photoCount: number, maxOutputTokens: number): PassTokenEstimate {
  return build(system, prompt, STRUCTURE_OUTPUT_BASE + STRUCTURE_OUTPUT_PER_PHOTO * Math.max(0, photoCount), maxOutputTokens);
}

/** Прохід 3 («Написати» один модуль): вихід росте з кількістю уроків модуля. */
export function estimateGeneratePass(system: string, prompt: string, lessonCount: number, maxOutputTokens: number): PassTokenEstimate {
  return build(system, prompt, GENERATE_OUTPUT_BASE + GENERATE_OUTPUT_PER_LESSON * Math.max(1, lessonCount), maxOutputTokens);
}

/**
 * Прохід «підказати» (один урок, з 1.7.0): вихід обмежено 500 символами, тож він НЕ росте ні з
 * кадрами, ні з уроками — на відміну від проходів 2–3. Беремо за межею пропозиції (500 символів
 * ≈ 200 токенів) із тим самим запасом ≈1,5×, що й вище: модель часто пише трохи довше, а зайве
 * сервер обріже.
 */
const SUGGEST_OUTPUT_TOKENS = 300;

export function estimateSuggestPass(system: string, prompt: string, maxOutputTokens: number): PassTokenEstimate {
  return build(system, prompt, SUGGEST_OUTPUT_TOKENS, maxOutputTokens);
}

/** Тариф моделі: долари за мільйон токенів. `null` — «не звірено», не «безкоштовно». */
export interface TokenRate {
  inputPerMillionUsd: number | null;
  outputPerMillionUsd: number | null;
}

export interface PassUsd {
  expectedUsd: number;
  /** Верхня межа резерву. */
  maxUsd: number;
}

/** Собівартість проходу за тарифом; `null`, якщо будь-яку з двох цін не звірено. */
export function passUsd(rate: TokenRate, est: PassTokenEstimate): PassUsd | null {
  const { inputPerMillionUsd: i, outputPerMillionUsd: o } = rate;
  if (i === null || o === null || !(i >= 0) || !(o >= 0)) return null;
  const usd = (inTok: number, outTok: number) => (inTok / 1_000_000) * i + (outTok / 1_000_000) * o;
  const expectedUsd = usd(est.inputTokens, est.outputTokens);
  const maxUsd = usd(
    Math.ceil(est.inputTokens * INPUT_RESERVE_BUFFER),
    Math.min(est.maxOutputTokens, Math.ceil(est.outputTokens * OUTPUT_RESERVE_BUFFER))
  );
  if (!(expectedUsd > 0)) return null;
  return { expectedUsd, maxUsd: Math.max(maxUsd, expectedUsd) };
}
