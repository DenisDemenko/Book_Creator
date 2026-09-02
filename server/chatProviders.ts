/**
 * Єдині серверні виклики провайдерів ШІ для чат-сесій AI-асистента.
 *
 * До цього чат-сесії вміли лише один рушій (Gemini), зашитий на старті
 * сервера (server.ts → registerChatRoutes з одним `deps.generate`). Цей
 * модуль додає решту провайдерів (OpenAI, Anthropic, DeepSeek, Groq,
 * Mistral) під єдиною сигнатурою `Generate` — той самий набір реальних
 * викликів, що його використовує Modul_token/server.js, але викликається
 * безпосередньо з сервера Book_Creality (не через браузерний проксі).
 *
 * Роути чату нічого не знають про конкретного провайдера: вони отримують
 * `modelId` сесії, визначають рушій через `resolveEngine()` і викликають
 * відповідну функцію. Модель обирає користувач (мультимодельність).
 *
 * Ключі: серверні env-ключі (GEMINI_API_KEY, OPENAI_API_KEY,
 * ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY).
 */

export type EngineId = 'gemini' | 'gpt' | 'claude' | 'deepseek' | 'groq' | 'mistral';

export interface GenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** Одне прикріплене зображення — base64 без префіксу `data:...;base64,`. */
export interface ImageAttachment {
  mimeType: string;
  dataBase64: string;
}

/**
 * Рушії, чиї моделі в CHAT_MODELS справді «бачать» зображення (реальний
 * vision-запит, а не текстова заглушка) — за зразком Modul_token
 * (src/services/{gemini,openai,claude}Service.ts конвертують image_url у
 * свій нативний формат; DeepSeek/Groq/Mistral цього не роблять узагалі,
 * бо підключені тут моделі текстові).
 */
export const VISION_ENGINES: ReadonlySet<EngineId> = new Set(['gemini', 'gpt', 'claude']);

/**
 * Єдина сигнатура генератора для всіх провайдерів.
 * Третій аргумент — `modelId`, який користувач обрав для сесії.
 * Четвертий (необов'язковий) — власний ключ користувача (розділ «Ключі API»
 * в налаштуваннях), який іде в запит замість серверного env-ключа.
 * П'ятий (необов'язковий) — прикріплені зображення (jpg/png); мають сенс
 * лише для рушіїв із VISION_ENGINES, виклик відсікається раніше на рівні
 * роута (server/chatRoutes.ts), тож провайдери без vision цей аргумент
 * просто ніколи не отримують.
 */
export type Generate = (
  prompt: string,
  systemInstruction: string,
  modelId: string,
  apiKeyOverride?: string,
  images?: ImageAttachment[],
  /**
   * Структурований JSON-режим — раніше мали лише Gemini через SDK
   * (aiCore.ts::dispatchGeminiSdk, `responseMimeType`). Інструменти
   * ядра, переведені на «рушій, обраний у чаті» (Q18 grilling-сесії),
   * можуть просити JSON у БУДЬ-ЯКОГО рушія — без апаратної гарантії
   * модель іноді ламає синтаксис (літеральний перенос рядка в значенні,
   * зайвий текст навколо), тож там, де є реальна опора провайдера
   * (openAiCompatible: `response_format`, Claude: assistant-prefill),
   * використовуємо її, а не лише інструкцію в тексті промту.
   */
  json?: boolean
) => Promise<GenerateResult>;

export interface ChatModelInfo {
  id: string;
  engine: EngineId;
  label: string;
  provider: string;
  /** Звірено/орієнтовно; показується в селекторі моделей. */
  contextWindow?: string;
}

/** Моделі, які пропонуються користувачеві в селекторі чату. */
export const CHAT_MODELS: ChatModelInfo[] = [
  { id: 'gemini-3.7-flash', engine: 'gemini', label: 'Gemini 3.7 Flash', provider: 'Google', contextWindow: '1M' },
  { id: 'gpt-4o', engine: 'gpt', label: 'GPT-4o', provider: 'OpenAI', contextWindow: '128k' },
  { id: 'claude-haiku-4-5-20251001', engine: 'claude', label: 'Claude Haiku 4.5', provider: 'Anthropic', contextWindow: '200k' },
  { id: 'claude-sonnet-5', engine: 'claude', label: 'Claude Sonnet 5', provider: 'Anthropic', contextWindow: '200k' },
  { id: 'claude-opus-5', engine: 'claude', label: 'Claude Opus 5', provider: 'Anthropic', contextWindow: '200k' },
  { id: 'deepseek-chat', engine: 'deepseek', label: 'DeepSeek V4', provider: 'DeepSeek', contextWindow: '64k' },
  { id: 'llama-3.3-70b-versatile', engine: 'groq', label: 'Llama 3.3 70B (Groq)', provider: 'Groq', contextWindow: '128k' },
  { id: 'mistral-large-latest', engine: 'mistral', label: 'Mistral Large', provider: 'Mistral', contextWindow: '128k' },
];

export const ENGINE_LABELS: Record<EngineId, string> = {
  gemini: 'Google Gemini',
  gpt: 'OpenAI',
  claude: 'Anthropic Claude',
  deepseek: 'DeepSeek',
  groq: 'Groq (Llama)',
  mistral: 'Mistral',
};

/** env-ключ, від якого залежить наявність рушія. */
export const ENGINE_ENV_KEY: Record<EngineId, string> = {
  gemini: 'GEMINI_API_KEY',
  gpt: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

export function engineConfigured(engine: EngineId): boolean {
  return Boolean(process.env[ENGINE_ENV_KEY[engine]]?.trim());
}

/**
 * Визначає рушій за ідентифікатором моделі. Точні відомі id дають точний
 * рушій; невідомі — за префіксом (щоб зміна моделі на нову версію того ж
 * провайдера не потребувала правок коду). Невпізнане падає на gemini — це
 * поведінка до цієї зміни, тож старі сесії лишаються робочими.
 */
export function resolveEngine(modelId: string): EngineId {
  const id = (modelId || '').toLowerCase();
  if (!id) return 'gemini';
  if (id.startsWith('gemini')) return 'gemini';
  if (id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('chatgpt')) return 'gpt';
  if (id.startsWith('claude')) return 'claude';
  if (id.startsWith('deepseek')) return 'deepseek';
  if (id.startsWith('llama') || id.startsWith('meta-llama') || id.startsWith('mixtral')) return 'groq';
  if (id.startsWith('mistral')) return 'mistral';
  return 'gemini';
}

/** Чи відома модель (чи впізнається рушій) — для валідації на POST /sessions. */
export function isKnownModel(modelId: string): boolean {
  if (!modelId) return false;
  return CHAT_MODELS.some((m) => m.id === modelId) || resolveEngine(modelId) !== 'gemini';
}

export class ChatProviderError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ChatProviderError';
  }
}

function missingKeyError(envKey: string): ChatProviderError {
  return new ChatProviderError(
    503,
    `Провайдер не налаштований: додайте ${envKey} у .env сервера та перезапустіть його.`
  );
}

/** OpenAI-сумісний виклик (OpenAI, DeepSeek, Groq, Mistral) з реальним usage. */
async function openAiCompatible(
  url: string,
  envKey: string,
  modelId: string,
  prompt: string,
  systemInstruction: string,
  apiKeyOverride?: string,
  images?: ImageAttachment[],
  json?: boolean
): Promise<GenerateResult> {
  const key = apiKeyOverride?.trim() || process.env[envKey]?.trim();
  if (!key) throw missingKeyError(envKey);

  // Content-частини (image_url) розуміє лише OpenAI (GPT-4o) — сюди доходить
  // лише коли VISION_ENGINES дозволив це на рівні роута, тож для DeepSeek/
  // Groq/Mistral `images` завжди порожній.
  const userContent =
    images && images.length > 0
      ? [
          { type: 'text', text: prompt },
          ...images.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` },
          })),
        ]
      : prompt;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7,
      max_tokens: 4096,
      stream: false,
      // OpenAI-сумісний параметр (GPT/DeepSeek/Groq/Mistral усі дзеркалять
      // цей контракт) — гарантує СИНТАКСИЧНО валідний JSON, а не лише
      // «модель попросили ввічливо». Без нього JSON-модулі ядра (Q18
      // grilling-сесії) інколи ламались на моделях без апаратної опори:
      // літеральний перенос рядка в багатоабзацній біографії персонажа
      // ламає JSON.parse так само надійно, як і зайвий текст навколо.
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const message = data?.error?.message || `${envKey} провайдер повернув статус ${upstream.status}.`;
    throw new ChatProviderError(upstream.status, message);
  }

  const usage = data.usage || {};
  const content = data.choices?.[0]?.message?.content ?? '';
  return {
    text: content,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
  };
}

/** Google Gemini (generateContent REST) — реальні токени з usageMetadata. */
async function generateGemini(
  prompt: string,
  systemInstruction: string,
  modelId: string,
  apiKeyOverride?: string,
  images?: ImageAttachment[]
): Promise<GenerateResult> {
  const key = apiKeyOverride?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!key) throw missingKeyError('GEMINI_API_KEY');

  const imageParts = (images || []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.dataBase64 } }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'aistudio-build' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [...imageParts, { text: prompt }] }],
      generationConfig: { temperature: 0.7 },
    }),
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const message = data?.error?.message || `Gemini повернув статус ${upstream.status}.`;
    throw new ChatProviderError(upstream.status, message);
  }

  const text = (data.candidates || [])
    .map((c: any) => (c?.content?.parts || []).map((p: any) => p.text || '').join(''))
    .join('');
  const usage = data.usageMetadata || {};
  return {
    text,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
  };
}

/** Anthropic Claude (messages API) — реальні токени з usage. */
async function generateClaude(
  prompt: string,
  systemInstruction: string,
  modelId: string,
  apiKeyOverride?: string,
  images?: ImageAttachment[],
  json?: boolean
): Promise<GenerateResult> {
  const key = apiKeyOverride?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw missingKeyError('ANTHROPIC_API_KEY');

  const userContent =
    images && images.length > 0
      ? [
          ...images.map((img) => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mimeType, data: img.dataBase64 },
          })),
          { type: 'text', text: prompt },
        ]
      : prompt;

  // Claude не має параметра `response_format`, на відміну від
  // OpenAI-сумісних рушіїв. Замість цього — стандартний прийом
  // «assistant prefill»: підкладаємо репліку асистента, що вже
  // ПОЧИНАЄТЬСЯ з `{`, і Claude змушений продовжувати рівно як валідний
  // JSON-об'єкт, а не почати з преамбули на кшталт «Ось персонаж:».
  // Сам символ `{` у відповіді API не повертається (це наш префікс, а не
  // згенерований токен), тож дописуємо його назад перед парсингом.
  //
  // ПРИЙОМ ПРАЦЮЄ НЕ НА ВСІХ МОДЕЛЯХ. `claude-sonnet-5` відповідає
  // 400 invalid_request_error «This model does not support assistant message
  // prefill. The conversation must end with a user message.» — тобто запит
  // навіть не доходить до генерації. Виявлено живим прогоном скринінгу ринку
  // 02.09.2026 (запис #68 у log.md): усі наявні модулі з json:true ходили
  // через Gemini, тож ця гілка роками не виконувалась на Claude.
  //
  // Тому prefill — спроба, а не вимога: на цю конкретну відмову повторюємо
  // запит без нього. Втрати невеликі, бо жорсткий JSON-контракт кожен модуль
  // і так тримає в системній інструкції, а розбір усюди толерантний до
  // markdown-огорожі. Перевіряти список моделей замість тексту помилки не
  // варто: список застаріє з наступним релізом Anthropic, а поведінка
  // «спробувати й відкотитись» лишиться правильною.
  async function callClaude(withPrefill: boolean) {
    const messages = withPrefill
      ? [{ role: 'user', content: userContent }, { role: 'assistant', content: '{' }]
      : [{ role: 'user', content: userContent }];

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      // Без `temperature`: сучасні моделі Claude (Opus/Sonnet 5, Haiku 4.5)
      // повертають 400 invalid_request_error «temperature is deprecated for
      // this model», якщо параметр взагалі присутній у тілі запиту — навіть
      // зі значенням за замовчуванням.
      body: JSON.stringify({
        model: modelId,
        system: systemInstruction,
        messages,
        max_tokens: 4096,
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    return { upstream, data };
  }

  let prefilled = Boolean(json);
  let { upstream, data } = await callClaude(prefilled);

  if (
    !upstream.ok &&
    prefilled &&
    upstream.status === 400 &&
    /prefill/i.test(String(data?.error?.message || ''))
  ) {
    prefilled = false;
    ({ upstream, data } = await callClaude(false));
  }

  if (!upstream.ok) {
    const err = data?.error || {};
    const message = err.message || `Claude повернув статус ${upstream.status}.`;
    throw new ChatProviderError(upstream.status, `[${err.type || 'error'}] ${message}`);
  }

  const text = (data.content || [])
    .filter((c: any) => c && c.type === 'text')
    .map((c: any) => c.text)
    .join('');
  return {
    // Дописуємо `{` назад лише якщо prefill реально застосований: після
    // відкату модель повертає повний JSON сама, і зайва дужка зробила б
    // валідну відповідь невалідною.
    text: prefilled ? `{${text}` : text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

/** Всі рушії під єдиною сигнатурою. */
export const PROVIDERS: Record<EngineId, Generate> = {
  gemini: generateGemini,
  gpt: (p, s, m, k, img, json) => openAiCompatible('https://api.openai.com/v1/chat/completions', 'OPENAI_API_KEY', m, p, s, k, img, json),
  claude: generateClaude,
  deepseek: (p, s, m, k, img, json) => openAiCompatible('https://api.deepseek.com/chat/completions', 'DEEPSEEK_API_KEY', m, p, s, k, img, json),
  groq: (p, s, m, k, img, json) => openAiCompatible('https://api.groq.com/openai/v1/chat/completions', 'GROQ_API_KEY', m, p, s, k, img, json),
  mistral: (p, s, m, k, img, json) => openAiCompatible('https://api.mistral.ai/v1/chat/completions', 'MISTRAL_API_KEY', m, p, s, k, img, json),
};
