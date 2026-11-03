/**
 * Ліміти відповіді чату ШІ — в одному місці для сервера й для вікна чату.
 *
 * ЧОМУ ТУТ. 03.11.2026 живий прогін із DeepSeek показав, що відповідь на 56 абзаців
 * обривається на 4096 вихідних токенах: це не стеля провайдера (DeepSeek дозволяє
 * до 384K), а наше `max_tokens: 4096` за замовчуванням (`server/modelQuirks.ts`), яке
 * чат нікуди не перевизначав, а причину зупинки ніхто не читав. Автор не міг ні
 * дізнатись про обрив, ні передбачити його заздалегідь.
 */

/** Стеля відповіді DeepSeek у чаті. Ціна росте лише за фактично згенеровані токени. */
export const DEEPSEEK_OUTPUT_CAP = 16_000;

/** Що отримує рушій без нашого втручання (`modelQuirks.ts`, `chatProviders.ts`). */
export const DEFAULT_OUTPUT_CAP = 4096;

/**
 * Скільки вихідних токенів іде на розбір одного абзацу, коли модель відповідає «по одному».
 * Виміряно на справжньому прогоні: 44 абзаци вмістились у 4096 токенів — ≈ 93 на абзац.
 */
export const REPLY_TOKENS_PER_PARAGRAPH = 95;

/**
 * Ліміт вихідних токенів, який чат передає моделі. `undefined` — не втручатись і лишити
 * типове значення рушія: підняти стелю всім рушіям без розбору небезпечно (у Groq
 * Llama 4 Scout вона нижча за 16 000, і запит було б відхилено).
 */
export function chatOutputCap(modelId?: string): number | undefined {
  return modelId && /^deepseek/i.test(modelId.trim()) ? DEEPSEEK_OUTPUT_CAP : undefined;
}

export interface BatchTokenReport {
  /** Оцінка токенів повідомлення з пачкою (≈ 4 символи на токен). */
  inputTokens: number;
  /** Скільки токенів відповіді потрібно, щоб розібрати всі абзаци по одному. */
  expectedReplyTokens: number;
  /** Стеля відповіді для обраної моделі. */
  cap: number;
  /** Чи вміщується очікувана відповідь у стелю. */
  fits: boolean;
  /** Скільки абзаців зазвичай вміщує одна відповідь. */
  maxParagraphs: number;
}

/**
 * Звіт для картки: скільки токенів піде в повідомленні й чи вмістить відповідь усі абзаци.
 * Для моделі без власної стелі беремо типові 4096 — це завищує тривогу для Gemini,
 * але не обіцяє зайвого.
 */
export function batchTokenReport(inputTokens: number, paragraphs: number, modelId?: string): BatchTokenReport {
  const cap = chatOutputCap(modelId) ?? DEFAULT_OUTPUT_CAP;
  const expectedReplyTokens = paragraphs * REPLY_TOKENS_PER_PARAGRAPH;
  return {
    inputTokens,
    expectedReplyTokens,
    cap,
    fits: expectedReplyTokens <= cap,
    maxParagraphs: Math.max(1, Math.floor(cap / REPLY_TOKENS_PER_PARAGRAPH)),
  };
}
