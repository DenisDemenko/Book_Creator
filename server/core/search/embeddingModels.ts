/**
 * Модель ембедингів для пошуку за змістом (Т1.2).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ ВАЖЛИВО: `DEFAULT_EMBEDDING_MODEL` нижче — це модель за замовчуванням │
 * │ ЛИШЕ для ембедингів семантичного пошуку (сторінка «Пошук», ТЗ-H).    │
 * │ Вона НЕ є моделлю за замовчуванням для жодної іншої функції ШІ:      │
 * │ чат, ролі AI-1/2/3, генерація тексту й картинок мають свої моделі й  │
 * │ свої налаштування (`coreModuleModels.ts`, `aiCore.ts`) і від цього   │
 * │ вибору ніяк не залежать.                                              │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Чому Gemini, а не DeepSeek: власник хотів DeepSeek, але в DeepSeek немає
 * API ембедингів (лише чат), тож рахувати вектори він не може. Обрано
 * Gemini (рішення власника, 25.09.2026): ключ уже є в платформі, модель
 * загальнодоступна (GA) й добре знає українську.
 *
 * Адмін може змінити модель у панелі «Ядро AI» (блок «Модель ембедингів»).
 * Вектори різних моделей між собою не порівнюються, тож після зміни книги
 * поступово переобчислюються фоновою задачею `core_embed`, а доки цього не
 * сталося — пошук працює за словами й графом, без смислової частини.
 *
 * Список — лише моделі, які вміють віддати вектор довжини 768 (стільки
 * місця в колонці `paragraph_embeddings.embedding`).
 */

import { getAppSetting, setAppSetting } from '../../store';

export type EmbeddingProvider = 'gemini' | 'openai';

export interface EmbeddingModelInfo {
  id: string;
  label: string;
  provider: EmbeddingProvider;
  /** Рушій у «Ключах API» / змінній оточення, чиїм ключем іде виклик. */
  engine: 'gemini' | 'gpt';
  /** USD за 1 млн вхідних токенів (станом на 09.2026). */
  usdPerMTokens: number;
  note?: string;
}

/** Довжина вектора — однакова для всіх моделей (колонка `vector(768)`). */
export { EMBEDDING_DIMENSIONS } from './text';

export const EMBEDDING_MODELS: readonly EmbeddingModelInfo[] = [
  // Ціни: ai.google.dev/gemini-api/docs/pricing, openai.com/api/pricing (перевірено 25.09.2026).
  { id: 'gemini-embedding-001', label: 'Gemini Embedding 001', provider: 'gemini', engine: 'gemini', usdPerMTokens: 0.15 },
  {
    id: 'gemini-embedding-2-preview',
    label: 'Gemini Embedding 2 (preview)',
    provider: 'gemini',
    engine: 'gemini',
    usdPerMTokens: 0.2,
    note: 'Попередня версія: Google може змінити або прибрати її без попередження.',
  },
  { id: 'text-embedding-3-small', label: 'OpenAI text-embedding-3-small', provider: 'openai', engine: 'gpt', usdPerMTokens: 0.02 },
  { id: 'text-embedding-3-large', label: 'OpenAI text-embedding-3-large', provider: 'openai', engine: 'gpt', usdPerMTokens: 0.13 },
];

/**
 * Модель ембедингів за замовчуванням — ТІЛЬКИ для семантичного пошуку.
 * Інші функції ШІ цього значення не читають (див. рамку вгорі файлу).
 */
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

/** Ключ у таблиці `meta`: вибір адміна. Порожньо — діє `DEFAULT_EMBEDDING_MODEL`. */
export const EMBEDDING_MODEL_META_KEY = 'core_embedding_model';

export function embeddingModelInfo(id: string): EmbeddingModelInfo | undefined {
  return EMBEDDING_MODELS.find((m) => m.id === id);
}

export function isEmbeddingModel(id: unknown): id is string {
  return typeof id === 'string' && !!embeddingModelInfo(id);
}

/** Модель, якою зараз рахуються ембединги пошуку: вибір адміна або дефолт пошуку. */
export async function readEmbeddingModel(): Promise<string> {
  try {
    const raw = (await getAppSetting(EMBEDDING_MODEL_META_KEY))?.trim();
    return raw && isEmbeddingModel(raw) ? raw : DEFAULT_EMBEDDING_MODEL;
  } catch {
    return DEFAULT_EMBEDDING_MODEL;
  }
}

/** Порожнє значення — повернутися до дефолту пошуку. */
export async function setEmbeddingModel(modelId: string | null): Promise<string> {
  const trimmed = (modelId || '').trim();
  if (trimmed && !isEmbeddingModel(trimmed)) throw new Error(`Невідома модель ембедингів: ${trimmed}`);
  await setAppSetting(EMBEDDING_MODEL_META_KEY, trimmed);
  return trimmed || DEFAULT_EMBEDDING_MODEL;
}

/** Вартість ембедингів для журналу витрат. */
export function embeddingCostUsd(modelId: string, tokens: number): number {
  const info = embeddingModelInfo(modelId);
  return info ? (tokens / 1_000_000) * info.usdPerMTokens : 0;
}
