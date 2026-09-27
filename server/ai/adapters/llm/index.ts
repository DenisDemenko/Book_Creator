/**
 * Адаптер LLM для Fusion Living Characters (ТЗ-H §7.2 `adapters/llm`; Т2.5
 * В1): один договір «системна інструкція + запит → текст JSON», за яким
 * стоїть будь-який рушій Студії. У Студії це `aiRoleGenerateViaCore` —
 * модуль ролі з «Ядра AI», облік витрат у `usage_log` з `book_id`
 * (`server.ts` збирає функцію `llmViaCore`); у тестах — підставна функція.
 *
 * Використовують його запасний шлях Jev (`LlmFallbackJevAdapter`, ТЗ-H №9) і
 * крок чернетки прототипу (Т1.6).
 */

export type LlmJson = (system: string, user: string) => Promise<{ text: string; modelId: string; inputTokens: number; outputTokens: number }>;

/** Те, що потрібно від ядра ШІ, — лише форма виклику ролі (без імпорту `aiCore` тут: адаптер не тягне сервер у тести). */
export type CoreRoleGenerate = (input: {
  module: 'coreAi2Analysis';
  modelId: string | undefined;
  system: string;
  user: string;
  projectId: string;
  actor: string;
}) => Promise<{ text: string; modelId: string; inputTokens: number; outputTokens: number }>;

/**
 * LLM для героя книги через ядро ШІ: модель ролі AI-2 (`coreAi2Analysis`),
 * витрата — на того, хто запустив, з `book_id` = проєкт.
 */
export function llmViaCore(generate: CoreRoleGenerate, resolveModel: () => Promise<string | undefined>, projectId: string, actor: string): LlmJson {
  return async (system, user) => {
    const out = await generate({ module: 'coreAi2Analysis', modelId: await resolveModel(), system, user, projectId, actor });
    return { text: out.text, modelId: out.modelId, inputTokens: out.inputTokens, outputTokens: out.outputTokens };
  };
}
