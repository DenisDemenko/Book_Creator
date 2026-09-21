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

import {
  adaptQuirks,
  buildOpenAiBody,
  quirksFor,
  rememberQuirks,
  type ModelQuirks,
} from './modelQuirks';

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
/**
 * Рушії, чиї моделі в ЗАГАЛЬНОМУ випадку вміють приймати зображення.
 *
 * ЦЕ ЛИШЕ ЗАПАСНИЙ ПРАВИЛО ДЛЯ НЕВІДОМИХ id (див. `modelSupportsVision`):
 * насправді зір — властивість КОНКРЕТНОЇ моделі, а не рушія. У Groq поряд
 * лежать Llama 3.3 70B (текст) і Llama 4 Scout (text+image), у DeepSeek —
 * `deepseek-flash` (Vision ✓) і `deepseek-v4-pro` (Vision ✗ за офіційною
 * таблицею api-docs.deepseek.com/quick_start/pricing). Тому всі перевірки
 * «чи побачить модель фото» йдуть через `modelSupportsVision(modelId)`.
 */
export const VISION_ENGINES: ReadonlySet<EngineId> = new Set(['gemini', 'gpt', 'claude']);

/**
 * Рушії, які вміють приймати інлайн-аудіо в запиті на генерацію (не окремий
 * ендпойнт розшифровки на кшталт Whisper, а те саме `inlineData`, яким
 * generateGemini уже надсилає зображення — Gemini API трактує будь-який
 * бінарний контент однаково, байдуже, картинка це чи аудіо-семпл).
 *
 * Плагін «Імпорт нотаток» (запис #191) — перший і поки єдиний споживач:
 * автор диктує уривок книги в нотатки на телефоні, плагін розшифровує
 * запис і пропонує главу для вставки. GPT/Claude/DeepSeek/Groq/Mistral
 * тут не підключені: OpenAI вимагає окремий REST-ендпойнт Whisper (не
 * generateContent), Claude Messages API взагалі не приймає аудіо-блоки,
 * а решта рушіїв — текстові моделі без жодного мультимодального входу.
 * Якщо обраний автором рушій не входить у цей набір, роут (server.ts)
 * тихо переходить на Gemini лише для кроку розшифровки (і повідомляє про
 * це в відповіді), а не змушує автора вручну перемикати модель.
 */
export const AUDIO_ENGINES: ReadonlySet<EngineId> = new Set(['gemini']);

/**
 * Єдина сигнатура генератора для всіх провайдерів.
 * Третій аргумент — `modelId`, який користувач обрав для сесії.
 * Четвертий (необов'язковий) — власний ключ користувача (розділ «Ключі API»
 * в налаштуваннях), який іде в запит замість серверного env-ключа.
 * П'ятий (необов'язковий) — прикріплені зображення (jpg/png); мають сенс
 * лише для моделей із зором (`modelSupportsVision`), виклик відсікається
 * раніше на рівні роута, тож моделі без зору цей аргумент не отримують,
 * а ті, що отримують, конвертують його у свій нативний формат.
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
  /**
   * Чи модель СПРАВДІ приймає зображення на вході (документація провайдера,
   * не здогад). Показується клієнту в `/api/chat/models`, щоб у списку опису
   * фото не було моделей, які гарантовано відмовляться, і щоб не було
   * навпаки — текстової моделі, яку автор обере дарма.
   */
  vision: boolean;
}

/**
 * Імена моделей, які провайдер більше не приймає, АЛЕ вони лежать у
 * збережених книгах (`book.preferredAiModelId`).
 *
 * `deepseek-chat` — стара назва; у поточній документації DeepSeek моделей
 * лише дві: `deepseek-flash` і `deepseek-v4-pro`, і перша з них уміє Vision.
 * Мовчки надіслати провайдеру відправлене ім'я означало б повернути автору
 * 400 замість тексту, тому перекладаємо на найближчу живу модель — явно,
 * в одному місці й з поясненням.
 */
export const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'deepseek-chat': 'deepseek-flash',
};

/** Приводить збережене ім'я моделі до того, яке провайдер приймає сьогодні. */
export function normalizeModelId(modelId: string): string {
  const id = (modelId || '').trim();
  return LEGACY_MODEL_ALIASES[id] ?? id;
}

/**
 * Моделі, які пропонуються користувачеві в селекторі чату.
 *
 * Лінійка OpenAI (gpt-5.5 … gpt-5.6-luna) додана за переліком із
 * вкладки «Rate limits» власного акаунту власника (platform.openai.com/
 * settings/organization/limits, звірено вересень 2026) — саме ці 7
 * моделей там перелічені як «Models in use» / «Latest models», тобто
 * реально доступні цьому ключу OpenAI. `gpt-4o` лишається першим/типовим
 * пунктом для сумісності: книги, у яких вже збережено `preferredAiModelId:
 * 'gpt-4o'`, не повинні мовчки «осиротіти» через оновлення списку.
 */
export const CHAT_MODELS: ChatModelInfo[] = [
  // Gemini: мультимодальний (text+image+file+audio+video у кожній моделі лінійки).
  { id: 'gemini-3.7-flash', engine: 'gemini', label: 'Gemini 3.7 Flash', provider: 'Google', contextWindow: '1M', vision: true },
  // OpenAI: уся лінійка GPT-5.x і gpt-4o приймає зображення (text+image+file).
  { id: 'gpt-4o', engine: 'gpt', label: 'GPT-4o', provider: 'OpenAI', contextWindow: '128k', vision: true },
  { id: 'gpt-5.5', engine: 'gpt', label: 'GPT-5.5', provider: 'OpenAI', contextWindow: '1M', vision: true },
  { id: 'gpt-5.5-pro', engine: 'gpt', label: 'GPT-5.5 Pro', provider: 'OpenAI', contextWindow: '1M', vision: true },
  { id: 'gpt-5.4-mini', engine: 'gpt', label: 'GPT-5.4 Mini', provider: 'OpenAI', contextWindow: '400k', vision: true },
  { id: 'gpt-6-astra', engine: 'gpt', label: 'GPT-6 Astra', provider: 'OpenAI', contextWindow: '1M', vision: true },
  { id: 'gpt-5.6-sol', engine: 'gpt', label: 'GPT-5.6 Sol', provider: 'OpenAI', contextWindow: '1M', vision: true },
  { id: 'gpt-5.6-terra', engine: 'gpt', label: 'GPT-5.6 Terra', provider: 'OpenAI', contextWindow: '1M', vision: true },
  { id: 'gpt-5.6-luna', engine: 'gpt', label: 'GPT-5.6 Luna', provider: 'OpenAI', contextWindow: '1M', vision: true },
  // Claude: text+image+file у Haiku 4.5, Sonnet 5 і Opus 5.
  { id: 'claude-haiku-4-5-20251001', engine: 'claude', label: 'Claude Haiku 4.5', provider: 'Anthropic', contextWindow: '200k', vision: true },
  { id: 'claude-sonnet-5', engine: 'claude', label: 'Claude Sonnet 5', provider: 'Anthropic', contextWindow: '200k', vision: true },
  { id: 'claude-opus-5', engine: 'claude', label: 'Claude Opus 5', provider: 'Anthropic', contextWindow: '200k', vision: true },
  /*
    DeepSeek — єдиний рушій у списку, де зір залежить від моделі:
    `deepseek-flash` (DeepSeek-V4.1-Flash) має Vision ✓, `deepseek-v4-pro` —
    «Not supported» (таблиця «Model Details» на
    api-docs.deepseek.com/quick_start/pricing, звірено 21.09.2026).
  */
  { id: 'deepseek-flash', engine: 'deepseek', label: 'DeepSeek V4.1 Flash', provider: 'DeepSeek', contextWindow: '1M', vision: true },
  { id: 'deepseek-v4-pro', engine: 'deepseek', label: 'DeepSeek V4 Pro', provider: 'DeepSeek', contextWindow: '1M', vision: false },
  /*
    Groq — та сама історія: Llama 3.3 70B текстова, а Llama 4 Scout за
    карткою моделі Meta приймає до 5 зображень на запит
    (llama.com → Model Cards → Llama 4: «Multimodal — Input: Text + up to
    5 images»). Тому в списку обидві: текстова дешевша й швидша, а для
    опису фото автор має обрати Scout.

    ⚠ Ідентифікатор Scout узято з переліку Groq (`meta-llama/<модель>`), але
    САМЕ цим рядком він живим викликом ще не підтверджений: консоль Groq
    не читається зовні (CSP), а власного ключа Groq у розробці немає.
    Перевірити першим реальним запитом: якщо Groq знає модель під іншим
    ім'ям, він відповість 404 на неї — автор побачить це в повідомленні
    помилки (не мовчазну підміну), і рядок треба буде поправити тут.
  */
  { id: 'llama-3.3-70b-versatile', engine: 'groq', label: 'Llama 3.3 70B (Groq)', provider: 'Groq', contextWindow: '128k', vision: false },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', engine: 'groq', label: 'Llama 4 Scout (Groq)', provider: 'Groq', contextWindow: '1M', vision: true },
  // Mistral Large 3 (alias `-latest`) — text+image+file за docs.mistral.ai/capabilities/vision.
  { id: 'mistral-large-latest', engine: 'mistral', label: 'Mistral Large', provider: 'Mistral', contextWindow: '128k', vision: true },
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
 *
 * Старе ім'я моделі (`deepseek-chat`) спершу перекладається на живе
 * (`normalizeModelId`) — інакше рушій усе одно вгадався б за префіксом, але
 * в запит пішло б ім'я, якого провайдер більше не приймає.
 */
export function resolveEngine(modelId: string): EngineId {
  const id = normalizeModelId(modelId).toLowerCase();
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
  const id = normalizeModelId(modelId);
  return CHAT_MODELS.some((m) => m.id === id) || resolveEngine(id) !== 'gemini';
}

/**
 * Чи ЦЯ модель прийме зображення.
 *
 * Два ступені точності, саме в цьому порядку:
 *   1. модель є в реєстрі — відповідь беремо звідти (єдине місце правди);
 *   2. моделі немає (нова версія того ж провайдера) — питаємо РУШІЙ. Тут
 *      відповідь неминуче нерівна, і саме тому вона лишається так:
 *      у Gemini/GPT/Claude (`VISION_ENGINES`) усі актуальні моделі
 *      мультимодальні, тож невідомий `gpt-9-…` отримує `true` — інакше нова
 *      зряча модель була б заблокована до правки коду;
 *      у DeepSeek/Groq/Mistral моделі обох видів стоять поряд, тож невідомий
 *      `deepseek-…` отримує `false` — обіцяти зір навмання означало б
 *      віддати авторові помилку провайдера посеред роботи з фото замість
 *      чесної відмови з порадою обрати зрячу модель.
 *      (Цілком невідомий id `resolveEngine` трактує як gemini — так було й до
 *      цієї правки; такий виклик однаково впаде на самому імені моделі.)
 */
export function modelSupportsVision(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  const known = CHAT_MODELS.find((m) => m.id === id);
  if (known) return known.vision;
  const engine = resolveEngine(id);
  return VISION_ENGINES.has(engine);
}

/** Людська назва моделі за id — щоб відмова в роуті називала САМЕ ту модель, яку обрав автор. */
export function chatModelLabel(modelId: string): string {
  const id = normalizeModelId(modelId);
  return CHAT_MODELS.find((m) => m.id === id)?.label || id || 'невідома модель';
}

/**
 * Перелік рушіїв, у яких є хоч одна модель із зором — для підказки в
 * повідомленні-відмові. Обчислюється з `CHAT_MODELS`, а не пишеться руками:
 * додали мультимодальну модель новому провайдеру — підказка оновилась сама.
 */
export function visionEngineHint(): string {
  const withVision = new Set(CHAT_MODELS.filter((m) => m.vision).map((m) => m.engine));
  return (Object.keys(ENGINE_LABELS) as EngineId[])
    .filter((e) => withVision.has(e))
    .map((e) => ENGINE_LABELS[e])
    .join(', ');
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

  /*
    Старе ім'я моделі (`deepseek-chat`) провайдер більше не приймає —
    перекладаємо його на живе ДО запиту. Книги, збережені до цієї правки,
    тримають саме старий id у `preferredAiModelId`, і без перекладу автор
    отримував би 400 замість тексту.
  */
  const model = normalizeModelId(modelId);

  /*
    Зображення йдуть у тіло запиту для ВСІХ OpenAI-сумісних рушіїв (OpenAI,
    DeepSeek, Groq, Mistral): усі четверо приймають `image_url` у вмісті
    повідомлення. Чи дійде до цього коду картинка — вирішує не рушій, а
    КОНКРЕТНА модель (`modelSupportsVision`): у Groq поряд лежать текстова
    Llama 3.3 70B і мультимодальна Llama 4 Scout, у DeepSeek —
    `deepseek-flash` (Vision ✓) і `deepseek-v4-pro` (Vision ✗).

    Форма частини — об'єкт `{ url: 'data:...' }`, як описано в документації
    OpenAI Chat Completions; тієї самої форми вживає сумісний шар DeepSeek і
    Groq. Mistral у прикладах показує і рядок, і об'єкт (їхній SDK приймає
    обидві форми), тож об'єкт лишається спільним для всіх чотирьох.
  */
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

  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: userContent },
  ];

  // Набір параметрів більше не зашитий: він залежить від моделі й
  // ДОВЧУЄТЬСЯ з відповіді провайдера (server/modelQuirks.ts). Раніше тут
  // жорстко стояли max_tokens/temperature/response_format, і кожна модель,
  // яка їх не приймає, вилазила власнику сирою помилкою провайдера.
  // Режим гарантованого JSON (`response_format`) лишається тим самим
  // важливим параметром, що й був: без нього JSON-модулі ядра ламались на
  // літеральному переносі рядка в довгій біографії персонажа — тому він
  // вимикається лише тоді, коли модель прямо каже, що не вміє його.
  const attempt = async (quirks: ModelQuirks) => {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(buildOpenAiBody({ modelId: model, messages, json, quirks })),
    });
    const payload = await upstream.json().catch(() => ({}));
    return { upstream, payload };
  };

  let { upstream, payload: data } = await attempt(quirksFor(model));

  if (!upstream.ok) {
    // Провайдер сам називає, що саме не так із параметром — звужуємо набір
    // для цієї моделі й пробуємо ще РАЗ (саме один: якщо не допомогло,
    // причина не в параметрах, і цикл лише палив би квоту).
    const adapted = adaptQuirks(model, data?.error?.message || '');
    if (adapted) {
      rememberQuirks(model, adapted);
      ({ upstream, payload: data } = await attempt(adapted));
    }
  }

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
  // Старе ім'я моделі не приймається провайдером — те саме перекладання, що
  // в openAiCompatible.
  const model = normalizeModelId(modelId);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
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

  /** Старе ім'я моделі не приймається провайдером — див. `LEGACY_MODEL_ALIASES`. */
  const model = normalizeModelId(modelId);

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
        model,
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
