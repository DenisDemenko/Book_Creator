/**
 * Тарифи Google Gemini API та розрахунок вартості генерацій.
 *
 * Ціни взяті з офіційної сторінки тарифів (стандартний, не пакетний рівень)
 * станом на серпень 2026. Вони змінюються, тож кожен запис має поле
 * `updatedAt`, а адміністратор бачить цю дату в панелі й може перевизначити
 * тариф через змінні оточення, не чекаючи оновлення коду.
 *
 * Джерело: https://ai.google.dev/gemini-api/docs/pricing
 */

export const PRICING_UPDATED_AT = '2026-08-18';

/** Вартість однієї згенерованої картинки в доларах, за роздільністю. */
export interface ImagePriceTable {
  modelId: string;
  label: string;
  /** Ключ — роздільність ('1K' | '2K' | '4K'). */
  perImageUsd: Record<string, number>;
}

/**
 * Ідентифікатори моделей Seedream. Живуть тут, бо тариф прив’язаний
 * саме до моделі: v4.0 і v4.5 на fal коштують по-різному, і логувати
 * витрату під назвою двигуна означало б занижувати рахунок на чверть,
 * щойно хтось перемкнеться на 4.5.
 */
export const SEEDREAM_ARK_MODEL = process.env.SEEDREAM_MODEL || 'seedream-4-0-250828';
export const SEEDREAM_FAL_MODEL =
  process.env.SEEDREAM_FAL_MODEL || 'fal-ai/bytedance/seedream/v4.5/text-to-image';

export const IMAGE_PRICING: Record<string, ImagePriceTable> = {
  'nano-banana-2-lite': {
    modelId: 'gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite',
    perImageUsd: { '1K': 0.0336 },
  },
  'nano-banana-2': {
    modelId: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2',
    perImageUsd: { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  },
  'nano-banana-pro': {
    modelId: 'gemini-3-pro-image',
    label: 'Nano Banana Pro',
    perImageUsd: { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  },
  seedream: {
    modelId: SEEDREAM_ARK_MODEL,
    label: 'Seedream 4.0 (ByteDance, Ark)',
    // Офіційна ціна BytePlus ModelArk — флет $0.03/зображення незалежно
    // від роздільності (1K–4K). Джерело: docs.byteplus.com/en/docs/ModelArk/1544106
    // (звірено серпень 2026). До цього запису тут не було — engine_id
    // 'seedream' коректно писався в usage_log, але priceForImage()
    // мовчки повертав 0, бо не знаходив тариф.
    perImageUsd: { '1K': 0.03 },
  },

  // Та сама модель ByteDance, але через fal.ai. Ціни різні за версіями,
  // і саме fal лишається єдиним доступом до Seedream для країн, яким
  // ModelArk відмовляє в реєстрації.
  'fal-ai/bytedance/seedream/v4/text-to-image': {
    modelId: 'fal-ai/bytedance/seedream/v4/text-to-image',
    label: 'Seedream 4.0 (ByteDance, fal.ai)',
    perImageUsd: { '1K': 0.03 },
  },
  'fal-ai/bytedance/seedream/v4.5/text-to-image': {
    modelId: 'fal-ai/bytedance/seedream/v4.5/text-to-image',
    label: 'Seedream 4.5 (ByteDance, fal.ai)',
    // $0.04 — дорожче за 4.0 на чверть. Джерело: сторінка моделі на
    // fal.ai, звірено серпень 2026.
    perImageUsd: { '1K': 0.04 },
  },
};

/** Тариф текстової моделі, долари за мільйон токенів. */
export const TEXT_PRICING = {
  modelId: process.env.GEMINI_MODEL || 'gemini-3.7-flash',
  inputPerMillionUsd: Number(process.env.GEMINI_INPUT_PRICE) || 0.75,
  outputPerMillionUsd: Number(process.env.GEMINI_OUTPUT_PRICE) || 3.75,
  note: 'Ціна діє до 31 грудня 2026; з 1 січня 2027 подвоюється.',
};

/**
 * Тариф GPT (OpenAI), долари за мільйон токенів. Використовується лише
 * двигуном «ШІ-текст за зображенням» (server/textFromImage.ts) — там,
 * де письменник сам обирає GPT замість Gemini. Значення за замовчуванням
 * орієнтовані на gpt-4o; якщо OPENAI_MODEL змінили на іншу модель,
 * звірте ціну на https://openai.com/api/pricing і задайте через env.
 */
export const GPT_TEXT_PRICING = {
  modelId: process.env.OPENAI_MODEL || 'gpt-4o',
  inputPerMillionUsd: Number(process.env.OPENAI_INPUT_PRICE) || 2.5,
  outputPerMillionUsd: Number(process.env.OPENAI_OUTPUT_PRICE) || 10,
  note: 'Орієнтовний тариф для gpt-4o (vision). Якщо OPENAI_MODEL інша — перевірте ціну вручну.',
};

/**
 * Тариф Anthropic Claude, долари за мільйон токенів. Використовується лише
 * інструментом «Форматування готового файлу під Amazon KDP» (доступний
 * підписникам Pro/Ultra) — server/claudeManuscript.ts. За замовчуванням
 * Claude Sonnet 5 (офіційна ціна станом на серпень 2026, платформа
 * platform.claude.com/docs/en/about-claude/pricing): $2 / $10 за млн
 * вхідних/вихідних токенів. Якщо ANTHROPIC_MODEL змінили — звірте ціну
 * там само і задайте через env.
 */
export const CLAUDE_TEXT_PRICING = {
  modelId: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  inputPerMillionUsd: Number(process.env.ANTHROPIC_INPUT_PRICE) || 2,
  outputPerMillionUsd: Number(process.env.ANTHROPIC_OUTPUT_PRICE) || 10,
  note: 'Офіційна ціна Claude Sonnet 5 (серпень 2026). Якщо ANTHROPIC_MODEL інша — перевірте ціну на platform.claude.com вручну.',
};

/**
 * Тарифи ВСІХ моделей Claude, доступних у селекторі чату (server/chatProviders.ts
 * CHAT_MODELS) — на відміну від CLAUDE_TEXT_PRICING вище (одна модель для
 * інструменту форматування KDP), тут потрібна ціна саме тієї моделі Claude,
 * яку автор обрав для розмови: Opus дорожчий за Sonnet, Haiku дешевший.
 * Звірено на platform.claude.com/docs/en/about-claude/pricing (22 серпня 2026).
 */
export const CLAUDE_MODEL_PRICING: Record<
  string,
  { inputPerMillionUsd: number; outputPerMillionUsd: number; note: string }
> = {
  'claude-sonnet-5': {
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 10,
    note: 'Claude Sonnet 5 — базова модель для більшості задач.',
  },
  'claude-opus-5': {
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 25,
    note: 'Claude Opus 5 — найпотужніша модель, для складних задач.',
  },
  'claude-haiku-4-5-20251001': {
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 5,
    note: 'Claude Haiku 4.5 — найшвидша й найдешевша модель Claude.',
  },
};

/** Вартість генерації Claude з урахуванням КОНКРЕТНОЇ моделі (Sonnet/Opus/Haiku). */
export function priceForClaudeModel(modelId: string, inputTokens: number, outputTokens: number): number {
  const rate = CLAUDE_MODEL_PRICING[modelId] || CLAUDE_TEXT_PRICING;
  return (inputTokens / 1_000_000) * rate.inputPerMillionUsd + (outputTokens / 1_000_000) * rate.outputPerMillionUsd;
}

/**
 * Тариф DeepSeek, долари за мільйон токенів. Для чат-сесій (новий
 * провайдер мультимодельного чату). Орієнтир звірено на офіційній
 * документації api-docs.deepseek.com у серпні 2026: DeepSeek-V4-Flash
 * коштує $0.22 / $0.66 за млн вхідних/вихідних токенів у «позапіковий»
 * час; у пік — удвічі дорожче ($0.44 / $1.32). Беремо позапікову ціну
 * (консервативно: краще недооцінити, ніж завищити рахунок).
 */
export const DEEPSEEK_TEXT_PRICING = {
  modelId: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  inputPerMillionUsd: Number(process.env.DEEPSEEK_INPUT_PRICE) || 0.22,
  outputPerMillionUsd: Number(process.env.DEEPSEEK_OUTPUT_PRICE) || 0.66,
  note: 'DeepSeek V4 Flash, позапіковий тариф (серпень 2026, api-docs.deepseek.com). У пік — вдвічі дорожче. Якщо DEEPSEEK_MODEL інша — перевірте ціну вручну.',
};

/**
 * Тариф Groq (Llama), долари за мільйон токенів. Для чат-сесій. За
 * замовчуванням llama-3.3-70b-versatile ($0.59 / $0.79 за млн). Ціну
 * звірено з офіційною сторінкою groq.com та даними Modul_token
 * (серпень 2026); перед зміною моделі перевірте ціну вручну.
 */
export const GROQ_TEXT_PRICING = {
  modelId: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  inputPerMillionUsd: Number(process.env.GROQ_INPUT_PRICE) || 0.59,
  outputPerMillionUsd: Number(process.env.GROQ_OUTPUT_PRICE) || 0.79,
  note: 'Llama 3.3 70B через Groq (серпень 2026). Якщо GROQ_MODEL інша — перевірте ціну на groq.com вручну.',
};

/**
 * Тариф Mistral, долари за мільйон токенів. Для чат-сесій. За замовчуванням
 * mistral-large-latest: офіційна сторінка mistral.ai/pricing (серпень 2026)
 * наводить $0.5 / $1.5 за млн вхідних/вихідних токенів.
 */
export const MISTRAL_TEXT_PRICING = {
  modelId: process.env.MISTRAL_MODEL || 'mistral-large-latest',
  inputPerMillionUsd: Number(process.env.MISTRAL_INPUT_PRICE) || 0.5,
  outputPerMillionUsd: Number(process.env.MISTRAL_OUTPUT_PRICE) || 1.5,
  note: 'Mistral Large (серпень 2026, mistral.ai/pricing). Якщо MISTRAL_MODEL інша — перевірте ціну вручну.',
};

/** Вартість текстової генерації DeepSeek. */
export function priceForDeepSeekText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * DEEPSEEK_TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * DEEPSEEK_TEXT_PRICING.outputPerMillionUsd
  );
}

/** Вартість текстової генерації Groq. */
export function priceForGroqText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * GROQ_TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * GROQ_TEXT_PRICING.outputPerMillionUsd
  );
}

/** Вартість текстової генерації Mistral. */
export function priceForMistralText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * MISTRAL_TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * MISTRAL_TEXT_PRICING.outputPerMillionUsd
  );
}

/**
 * Вартість одного зображення. Якщо для запитаної роздільності тарифу немає,
 * беремо найближчу меншу — краще недооцінити на копійку, ніж вигадати число.
 */
/**
 * `modelId` має пріоритет над `engineId`: один двигун може ходити до
 * різних моделей із різними цінами (Seedream через Ark і через fal).
 */
export function priceForImage(engineId: string, imageSize = '2K', modelId?: string): number {
  const table = (modelId && IMAGE_PRICING[modelId]) || IMAGE_PRICING[engineId];
  if (!table) return 0;

  const exact = table.perImageUsd[imageSize];
  if (typeof exact === 'number') return exact;

  const known = Object.keys(table.perImageUsd);
  if (known.length === 0) return 0;
  // Єдиний доступний тариф (як у Lite) або найдешевший із наявних.
  return Math.min(...known.map((k) => table.perImageUsd[k]));
}

export function priceForText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * TEXT_PRICING.outputPerMillionUsd
  );
}

export function priceForGptText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * GPT_TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * GPT_TEXT_PRICING.outputPerMillionUsd
  );
}

export function priceForClaudeText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * CLAUDE_TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * CLAUDE_TEXT_PRICING.outputPerMillionUsd
  );
}

/** Рушії текстової генерації, які розуміє priceForTextEngine. */
export type TextEngine = 'gemini' | 'gpt' | 'claude' | 'deepseek' | 'groq' | 'mistral';

/**
 * Вартість текстової генерації для конкретного двигуна (gemini, gpt, claude,
 * deepseek, groq, mistral). `modelId` — опційний: для claude визначає, яка
 * саме модель (Sonnet/Opus/Haiku) рахується за CLAUDE_MODEL_PRICING; без
 * нього claude падає на CLAUDE_TEXT_PRICING (типово Sonnet 5).
 */
export function priceForTextEngine(
  engine: TextEngine,
  inputTokens: number,
  outputTokens: number,
  modelId?: string
): number {
  if (engine === 'gpt') return priceForGptText(inputTokens, outputTokens);
  if (engine === 'claude') {
    return modelId
      ? priceForClaudeModel(modelId, inputTokens, outputTokens)
      : priceForClaudeText(inputTokens, outputTokens);
  }
  if (engine === 'deepseek') return priceForDeepSeekText(inputTokens, outputTokens);
  if (engine === 'groq') return priceForGroqText(inputTokens, outputTokens);
  if (engine === 'mistral') return priceForMistralText(inputTokens, outputTokens);
  return priceForText(inputTokens, outputTokens);
}

/** Тариф (вхід/вихід за млн) для конкретної моделі — для відображення в селекторі чату. */
export function priceRateForModel(
  engine: TextEngine,
  modelId: string
): { inputPerMillionUsd: number; outputPerMillionUsd: number } {
  if (engine === 'claude') return CLAUDE_MODEL_PRICING[modelId] || CLAUDE_TEXT_PRICING;
  const snap = pricingSnapshot().textEngines;
  return snap[engine as keyof typeof snap] || TEXT_PRICING;
}

/** Прайс у зручному для інтерфейсу вигляді. */
export function pricingSnapshot() {
  return {
    updatedAt: PRICING_UPDATED_AT,
    currency: 'USD',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    images: Object.entries(IMAGE_PRICING).map(([engineId, table]) => ({
      engineId,
      modelId: table.modelId,
      label: table.label,
      perImageUsd: table.perImageUsd,
    })),
    text: TEXT_PRICING,
    textEngines: {
      gemini: TEXT_PRICING,
      gpt: GPT_TEXT_PRICING,
      claude: CLAUDE_TEXT_PRICING,
      deepseek: DEEPSEEK_TEXT_PRICING,
      groq: GROQ_TEXT_PRICING,
      mistral: MISTRAL_TEXT_PRICING,
    },
  };
}
