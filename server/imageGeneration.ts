/**
 * Реальна генерація зображень для NOVA STUDIO.
 *
 * Раніше ендпоінти /api/ai/generate-*-art лише вдавали роботу: повертали
 * випадкове фото з десятка захардкоджених посилань на Unsplash, підписуючи
 * його «Midjourney v6.1» чи «DALL-E 3». Тут — справжні виклики моделей.
 *
 * Три двигуни сімейства Nano Banana працюють на тому самому GEMINI_API_KEY
 * і через той самий Interactions API:
 *   • Nano Banana 2 Lite — gemini-3.1-flash-lite-image, чернетки, 1K;
 *   • Nano Banana 2      — gemini-3.1-flash-image, робочий стандарт;
 *   • Nano Banana Pro    — gemini-3-pro-image, фінальна якість під друк.
 *
 * Четвертий двигун — ByteDance Seedream, окремий провайдер поза Google:
 *   • Seedream — виклик через OpenAI-сумісний Ark REST API (BytePlus
 *     ModelArk / Volcengine Ark), ключ ARK_API_KEY, ендпоінт
 *     POST {ARK_BASE_URL}/images/generations. Повертає b64_json, як і
 *     Gemini-шлях, тож решта пайплайну (збереження файлу, книга, витрати)
 *     лишається спільною для обох провайдерів.
 *
 * П'ятий двигун — GPT Image (OpenAI), задача «фото персонажа тим самим
 * провайдером, що й обраний текст»:
 *   • GPT Image — POST https://api.openai.com/v1/images/generations,
 *     той самий OPENAI_API_KEY (панель «Ключі API», рушій 'gpt'), що вже
 *     обслуговує GPT-4o в чаті/тексті ядра — окремого ключа для картинок
 *     не заводимо. За замовчуванням модель gpt-image-1.5 (звірено вересень
 *     2026: gpt-image-1 позначено deprecated на сторінці моделі,
 *     gpt-image-2 вже тарифікується інакше — за токенами, а не фіксованою
 *     ціною за зображення, що не лягає в ImagePriceTable нижче без
 *     окремого лічильника токенів). OPENAI_IMAGE_MODEL перемикає модель
 *     без правок коду, коли лінійка піде далі. GPT-моделі завжди
 *     повертають b64_json (response_format — параметр лише DALL·E,
 *     якої тут немає) — той самий формат, що й у Gemini/Seedream.
 *
 * Чого тут свідомо немає і чому:
 *   • Midjourney — не має офіційного публічного API; існують лише сторонні
 *     мости через Discord, які порушують його ToS і ризикують акаунтом.
 *   • DALL·E 3   — видалена з OpenAI API (замінена лінійкою GPT Image).
 *   • Imagen 4   — моделі imagen-4.0-* вимкнено Google 17 серпня 2026,
 *     а метод models.generateImages оголошено застарілим.
 *   • Seedance   — це модель ByteDance для ВІДЕО (text/image-to-video), не
 *     для статичних зображень; для ілюстрацій/обкладинок/портретів
 *     персонажів потрібна саме лінійка Seedream, яку й підключено нижче.
 *
 * Зображення зберігаються файлами на диск і віддаються статикою. Тримати
 * base64 усередині книги не можна — це роздуло б запис у сховищі так само,
 * як колись робили вбудовані зліпки версій.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { GoogleGenAI } from '@google/genai';
import { SEEDREAM_FAL_MODEL, SEEDREAM_FAL_EDIT_MODEL } from './pricing';
import {
  LEONARDO_V2_PHOTO_SPECS,
  leonardoV2PhotoMaxReferences,
  generateLeonardoV2Photo,
  LeonardoV2PhotoError,
  type LeonardoPhotoEngineId,
  type LeonardoV2PhotoSpec,
} from './leonardoPhotoGeneration';

/**
 * Максимум референсних зображень для мультиреференсної генерації
 * (задача #52). Google Interactions API перевірено до 10; Ark і fal
 * технічно приймають більше (до 14/15 разом із результатом), але 10 —
 * спільна межа, однакова для всіх трьох транспортів, щоб автор не
 * вгадував, скільки саме дозволено під обраний двигун.
 */
export const MAX_REFERENCE_IMAGES = 10;

export type ImageEngineId =
  | 'nano-banana-2-lite'
  | 'nano-banana-2'
  | 'nano-banana-pro'
  | 'seedream'
  | 'gpt-image'
  | 'leonardo'
  // Задача #203 — 6 фото-двигунів Leonardo v2 API з нативною підтримкою
  // референсних зображень (див. server/leonardoPhotoGeneration.ts).
  | LeonardoPhotoEngineId;

export interface ImageEngineInfo {
  id: ImageEngineId;
  /** Назва, яку бачить користувач. */
  label: string;
  /** Ідентифікатор моделі у провайдера. */
  modelId: string;
  provider: 'google' | 'bytedance' | 'openai' | 'leonardo';
  /** Найбільший розмір, який приймає модель. */
  maxSize: '1K' | '2K' | '4K';
  /**
   * `generation_config.thinking_level` в Interactions API — офіційно
   * документований лише для лінійки Gemini 3.1 Flash Image («minimal» —
   * швидший чорновий прохід, «high» — повільніше, але точніше дотримання
   * промпту). Nano Banana Pro — інша модель (gemini-3-pro-image), і в
   * документації цей параметр для неї не згаданий, тож панель його там не
   * пропонує, а не мовчки ігнорує непідтримуване значення.
   * Джерело: ai.google.dev/gemini-api/docs/image-generation (звірено
   * вересень 2026).
   */
  supportsQualityControl: boolean;
  /**
   * `response_format.mime_type` (JPEG/PNG) — документований для
   * Interactions API загалом, не прив'язаний до конкретної моделі Gemini.
   * Seedream (Ark) свого `output_format` тут НЕ отримує: він задокументований
   * лише для гілки 5.0/5.0-pro, а закріплена модель — 4.0, тож обіцяти вибір
   * формату означало б обіцяти те, що не перевірено для цієї версії.
   */
  supportsFormatChoice: boolean;
}

export const IMAGE_ENGINES: Record<ImageEngineId, ImageEngineInfo> = {
  'nano-banana-2-lite': {
    id: 'nano-banana-2-lite',
    label: 'Nano Banana 2 Lite',
    modelId: process.env.NANO_BANANA_LITE_MODEL || 'gemini-3.1-flash-lite-image',
    provider: 'google',
    // Lite підтримує лише 1K.
    maxSize: '1K',
    supportsQualityControl: true,
    supportsFormatChoice: true,
  },
  'nano-banana-2': {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    modelId: process.env.NANO_BANANA_MODEL || 'gemini-3.1-flash-image',
    provider: 'google',
    maxSize: '4K',
    supportsQualityControl: true,
    supportsFormatChoice: true,
  },
  'nano-banana-pro': {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    modelId: process.env.NANO_BANANA_PRO_MODEL || 'gemini-3-pro-image',
    provider: 'google',
    maxSize: '4K',
    supportsQualityControl: false,
    supportsFormatChoice: true,
  },
  seedream: {
    id: 'seedream',
    label: 'Seedream (ByteDance)',
    modelId: process.env.SEEDREAM_MODEL || 'seedream-4-0-250828',
    provider: 'bytedance',
    maxSize: '4K',
    supportsQualityControl: false,
    supportsFormatChoice: false,
  },
  'gpt-image': {
    id: 'gpt-image',
    label: 'GPT Image (OpenAI)',
    modelId: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5',
    provider: 'openai',
    // Реальний розмір рахується з aspectRatio окремою функцією
    // (openaiSizeFor) — цей маркер тут лише обирає ЦІНОВИЙ рядок у
    // IMAGE_PRICING (server/pricing.ts), як і для Lite/Seedream: OpenAI
    // тарифікує здебільшого за ЯКІСТЮ (low/medium/high), а не за
    // роздільністю, тож єдина фіксована '1K'-ціна — за замовчуванням
    // «medium»-якість — чесніша, ніж вигадувати три ціни під токен,
    // якого запит навіть не просить.
    maxSize: '1K',
    // 'minimal'/'high' мапляться на 'low'/'high' якості OpenAI; типовий
    // запит без явного quality йде як 'medium' (сама ціна в pricing.ts —
    // саме під це значення).
    supportsQualityControl: true,
    // output_format (png/jpeg/webp) — документований для GPT-моделей
    // (developers.openai.com/api/reference, звірено вересень 2026).
    supportsFormatChoice: true,
  },
  leonardo: {
    id: 'leonardo',
    label: 'Leonardo.Ai',
    // Leonardo модель — не назва рядком, а UUID конкретної платформної
    // моделі (Production API); LEONARDO_MODEL_ID лишено порожнім за
    // замовчуванням, і якщо адміністратор його не задав, запит іде БЕЗ
    // modelId — Leonardo сама застосовує свою платформну модель за
    // замовчуванням, а не помилку. Це свідомо, бо жодного UUID моделі
    // не підтверджено документацією без реального ключа (журнал #199/#200).
    modelId: process.env.LEONARDO_MODEL_ID || '',
    provider: 'leonardo',
    // Leonardo Production API документує ширину/висоту 32-1024px, кратні
    // 8 (generations, text-to-image) — це нижче за 4K/2K решти двигунів,
    // тож '1K' тут чесний, а не занижений маркер.
    maxSize: '1K',
    // alchemy/photoReal — інша вісь якості Leonardo, не той самий
    // 'minimal'/'high' перемикач, що в Nano Banana/GPT Image — не мапимо,
    // щоб не обіцяти невідповідність.
    supportsQualityControl: false,
    supportsFormatChoice: false,
  },

  // --- Задача #203: 6 фото-двигунів Leonardo v2 API з нативною підтримкою ---
  // --- референсних зображень. Специфіка кожної моделі (розміри, межа  ---
  // --- референсів) — у server/leonardoPhotoGeneration.ts.             ---
  'leonardo-gpt-image-25-flare': {
    id: 'leonardo-gpt-image-25-flare',
    label: 'GPT Image 2.5 Flare (через Leonardo.Ai)',
    modelId: 'openai/gpt-image-2.5-flare',
    provider: 'leonardo',
    maxSize: '1K',
    supportsQualityControl: false,
    supportsFormatChoice: false,
  },
  'leonardo-gpt-image-25-sunburst': {
    id: 'leonardo-gpt-image-25-sunburst',
    label: 'GPT Image 2.5 Sunburst (через Leonardo.Ai)',
    modelId: 'openai/gpt-image-2.5-sunburst',
    provider: 'leonardo',
    maxSize: '1K',
    supportsQualityControl: false,
    supportsFormatChoice: false,
  },
  'leonardo-nano-banana-2-lite': {
    id: 'leonardo-nano-banana-2-lite',
    // НЕ плутати з ГУГЛІВСЬКИМ 'nano-banana-2-lite' вище (gemini-3.1-flash-
    // lite-image) — та сама назва моделі, інший провайдер/ключ/API, тому
    // підпис явно каже «через Leonardo.Ai».
    label: 'Nano Banana 2 Lite (через Leonardo.Ai)',
    modelId: 'nano-banana-2-lite',
    provider: 'leonardo',
    maxSize: '1K',
    supportsQualityControl: false,
    supportsFormatChoice: false,
  },
  'leonardo-seedream-4-5': {
    id: 'leonardo-seedream-4-5',
    label: 'Seedream 4.5 (через Leonardo.Ai)',
    modelId: 'seedream-4.5',
    provider: 'leonardo',
    maxSize: '1K',
    supportsQualityControl: false,
    supportsFormatChoice: false,
  },
  'leonardo-seedream-5-pro': {
    id: 'leonardo-seedream-5-pro',
    label: 'Seedream 5.0 Pro (через Leonardo.Ai)',
    modelId: 'seedream-5.0-pro',
    provider: 'leonardo',
    // Документований дефолт моделі — 2048x2048, реально вище за решту
    // цієї шістки, тож '2K' тут чесний маркер, а не занижений.
    maxSize: '2K',
    supportsQualityControl: false,
    supportsFormatChoice: false,
  },
  'leonardo-flux-dev': {
    id: 'leonardo-flux-dev',
    label: 'FLUX Dev (через Leonardo.Ai)',
    modelId: 'flux-dev',
    provider: 'leonardo',
    maxSize: '2K',
    supportsQualityControl: false,
    supportsFormatChoice: false,
  },
};

export const DEFAULT_ENGINE: ImageEngineId = 'nano-banana-2';

/** Спека v2-двигуна Leonardo для цього ImageEngineId, якщо він — один із 6 нових (задача #203). */
function leonardoV2SpecFor(engineId: ImageEngineId): LeonardoV2PhotoSpec | undefined {
  return (LEONARDO_V2_PHOTO_SPECS as Record<string, LeonardoV2PhotoSpec>)[engineId];
}

/**
 * Конфігурація ByteDance Seedream — окремий провайдер поза Gemini.
 * ARK_API_KEY — офіційна назва змінної оточення для ключа BytePlus ModelArk
 * / Volcengine Ark (той самий ключ, що використовує офіційний OpenAI-сумісний
 * SDK-клієнт ByteDance); SEEDREAM_API_KEY лишено як зрозуміліший синонім.
 * ARK_BASE_URL за замовчуванням — міжнародний контур BytePlus ModelArk;
 * для акаунтів на материковому Volcengine (ark.cn-beijing.volces.com)
 * достатньо переозначити цю змінну, код лишається той самий.
 */
/**
 * Як саме ми ходимо до Seedream.
 *
 * 'ark' — напряму в BytePlus ModelArk. 'fal' — через fal.ai, який хостить
 * ту саму модель ByteDance за ту саму ціну ($0.03/зображення).
 *
 * Транспорт існує не заради вибору, а тому що ModelArk відмовляє в
 * реєстрації цілим країнам (серед них Україна), і прямий ключ там просто
 * неможливо отримати. fal лишається єдиним робочим шляхом до Seedream для
 * таких авторів.
 */
export type SeedreamTransport = 'ark' | 'fal';

/** Синхронний REST fal: віддає результат у тій самій відповіді. */
const FAL_BASE_URL = (process.env.FAL_BASE_URL || 'https://fal.run').replace(/\/+$/, '');

/**
 * Ключ fal видається у форматі "<id>:<secret>"; ключ Ark — суцільний токен
 * без двокрапки. Це єдина видима різниця між ними, і вона стабільна, тож
 * автор просто вставляє свій ключ у панель, не вибираючи транспорт руками.
 * SEEDREAM_TRANSPORT лишається аварійним перемикачем.
 */
export function seedreamTransportFor(apiKey: string): SeedreamTransport {
  const forced = (process.env.SEEDREAM_TRANSPORT || '').trim().toLowerCase();
  if (forced === 'fal' || forced === 'ark') return forced;
  return apiKey.includes(':') ? 'fal' : 'ark';
}

export const seedreamConfig = {
  apiKey: process.env.ARK_API_KEY || process.env.SEEDREAM_API_KEY || process.env.FAL_KEY || '',
  baseUrl: (process.env.ARK_BASE_URL || process.env.SEEDREAM_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/+$/, ''),
  get enabled(): boolean {
    return !!this.apiKey;
  },
};

/**
 * Конфігурація GPT Image (OpenAI) — навмисно ТОЙ САМИЙ OPENAI_API_KEY, що
 * server/chatProviders.ts вже використовує для рушія 'gpt' (текст/чат):
 * один ключ OpenAI покриває і GPT-4o, і зображення, тож окремого секрету
 * автор чи адміністратор не вставляє. Ключ, вставлений адміністратором у
 * розділі «Ключі API» під рушієм 'gpt' (platformKeyFor('gpt')), має
 * пріоритет і приходить сюди через apiKeyOverride (server/aiCore.ts) —
 * так само, як Seedream отримує свій override.
 */
export const openaiImageConfig = {
  apiKey: process.env.OPENAI_API_KEY || '',
  get enabled(): boolean {
    return !!this.apiKey;
  },
};

/**
 * Конфігурація Leonardo.Ai Production API — один ключ обслуговує і фото
 * (тут), і відео (server/videoGeneration.ts). LEONARDO_API_KEY — офіційна
 * назва змінної оточення провайдера; той самий ключ, вставлений
 * адміністратором у «Ключах API» під рушієм 'leonardo', приходить сюди
 * через apiKeyOverride (server/aiCore.ts), за тим самим шляхом, що й
 * Seedream/GPT Image.
 */
export const leonardoConfig = {
  apiKey: process.env.LEONARDO_API_KEY || '',
  baseUrl: (process.env.LEONARDO_BASE_URL || 'https://cloud.leonardo.ai/api/rest/v1').replace(/\/+$/, ''),
  modelId: process.env.LEONARDO_MODEL_ID || '',
  get enabled(): boolean {
    return !!this.apiKey;
  },
};

/**
 * Задача #206. Leonardo v2 (`POST /v2/generations`) інколи повертає
 * HTTP 200 з ТІЛОМ у формі GraphQL-помилки — масив об'єктів
 * `{message, extensions:{code, statusCode, details:{errors:[{message}]}}}`
 * — замість очікуваного `{sdGenerationJob:...}`/`{id:...}`. Підтверджено
 * РЕАЛЬНИМ продакшн-збоєм 18.09.2026 (Seedream 5.0 Pro, задача #204→#206):
 * `submitRes.ok` було true (HTTP 200), а тіло — саме такий масив із
 * validation-помилкою `parameters.prompt_enhance must be one of: OFF`.
 * Без цієї перевірки помилка виглядала б як «HTTP 200, відповідь без
 * розпізнаного id» — технічно правда, але марна для діагностики.
 *
 * Спільна для фото (leonardoPhotoGeneration.ts) і відео (videoGeneration.ts)
 * v2-логіки — обидва модулі б'ють у той самий `/v2/generations` шлюз, тож
 * форма помилки та сама для обох. Повертає null, якщо відповідь НЕ схожа
 * на цей конверт (звичайна успішна відповідь чи інша форма помилки).
 */
export function extractLeonardoV2ValidationMessage(json: unknown): string | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const messages: string[] = [];
  for (const entry of json) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as {
      message?: string;
      extensions?: { details?: { errors?: { message?: string }[]; message?: string } };
    };
    const nested = e.extensions?.details?.errors;
    if (Array.isArray(nested) && nested.length > 0) {
      for (const item of nested) {
        if (item?.message) messages.push(item.message);
      }
    } else if (e.extensions?.details?.message) {
      messages.push(e.extensions.details.message);
    } else if (e.message) {
      messages.push(e.message);
    }
  }
  return messages.length > 0 ? messages.join('; ') : null;
}

/**
 * Співвідношення сторін. Раніше тут було лише 5 значень (здогад із того,
 * що реально використовувалось у промптах книги) — звірка з офіційною
 * документацією Interactions API (ai.google.dev/gemini-api/docs/image-generation,
 * вересень 2026) показала, що `response_format.aspect_ratio` приймає
 * рівно 10 значень. Seedream/Ark не обмежений токенами — рахує точні
 * пікселі під будь-яке співвідношення (`seedreamPixelDims` нижче), тож
 * ширший список так само коректний і для нього.
 */
export const SUPPORTED_RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;
export type SupportedRatio = (typeof SUPPORTED_RATIOS)[number];

export type ImageErrorKind = 'no_key' | 'safety' | 'quota' | 'empty' | 'unknown';

export class ImageGenerationError extends Error {
  kind: ImageErrorKind;
  engine?: ImageEngineId;
  cause?: unknown;

  constructor(kind: ImageErrorKind, message: string, engine?: ImageEngineId, cause?: unknown) {
    super(message);
    this.name = 'ImageGenerationError';
    this.kind = kind;
    this.engine = engine;
    this.cause = cause;
  }
}

/** Приводить довільне співвідношення до найближчого підтримуваного. */
export function normalizeAspectRatio(input?: string): SupportedRatio {
  if (!input) return '1:1';
  const trimmed = String(input).trim();
  if ((SUPPORTED_RATIOS as readonly string[]).includes(trimmed)) {
    return trimmed as SupportedRatio;
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return '1:1';

  const target = Number(match[1]) / Number(match[2]);
  if (!Number.isFinite(target) || target <= 0) return '1:1';

  let best: SupportedRatio = '1:1';
  let bestDelta = Infinity;
  for (const ratio of SUPPORTED_RATIOS) {
    const [w, h] = ratio.split(':').map(Number);
    const delta = Math.abs(w / h - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = ratio;
    }
  }
  return best;
}

export function resolveEngine(requested?: string): ImageEngineInfo {
  if (requested && requested in IMAGE_ENGINES) {
    return IMAGE_ENGINES[requested as ImageEngineId];
  }
  // Старі значення з попередньої версії інтерфейсу тихо мапимо на робочий двигун.
  return IMAGE_ENGINES[DEFAULT_ENGINE];
}

export interface GenerateImageOptions {
  /**
   * Власний ключ автора для провайдера зображень (розділ «Ключі API»).
   * Стосується лише ByteDance/Seedream: Gemini працює через SDK-клієнт,
   * який створюється один раз на серверному ключі.
   */
  apiKeyOverride?: string;
  prompt: string;
  engine?: string;
  aspectRatio?: string;
  /** '1K' | '2K'; за замовчуванням 2K для друкованої якості. */
  imageSize?: string;
  negativePrompt?: string;
  /**
   * `generation_config.thinking_level` — лише для двигунів із
   * `supportsQualityControl`. Для решти мовчки ігнорується (а не кидає
   * помилку), щоб клієнт міг слати те саме поле незалежно від обраного
   * двигуна.
   */
  quality?: 'minimal' | 'high';
  /** `response_format.mime_type` — лише для двигунів із `supportsFormatChoice`. */
  outputFormat?: 'png' | 'jpeg';
  /**
   * Референсні зображення для мультиреференсної генерації (задача #52) —
   * до `MAX_REFERENCE_IMAGES` штук. Кожне вже ПУБЛІЧНА URL-адреса:
   * маршрут (`server.ts`), а не це ядро, відповідає за перетворення
   * завантаженого файлу на URL (через `saveGeneratedImage`) — так усі
   * три транспорти (Google `uri`, Ark `image`, fal `image_urls`)
   * приймають ОДНЕ представлення замість трьох різних форматів даних.
   */
  referenceImageUrls?: string[];
}

export interface GeneratedImageResult {
  buffer: Buffer;
  mimeType: string;
  engine: ImageEngineInfo;
  aspectRatio: SupportedRatio;
  /**
   * Модель, якою зображення СПРАВДІ згенеровано. Для Seedream вона не
   * збігається з `engine.modelId`, коли запит пішов через fal, — а від
   * неї залежить тариф.
   */
  modelId: string;
}

function classifyProviderError(err: unknown): ImageErrorKind {
  const message = String((err as Error)?.message || err || '').toLowerCase();
  // SDK часто віддає лише «Status 401/403» без пояснення — для користувача
  // це той самий випадок: ключ відсутній, недійсний або без потрібного доступу.
  if (
    message.includes('api key') ||
    message.includes('unauthenticated') ||
    message.includes('permission') ||
    message.includes('401') ||
    message.includes('403')
  ) {
    return 'no_key';
  }
  if (message.includes('safety') || message.includes('blocked') || message.includes('prohibited')) {
    return 'safety';
  }
  if (message.includes('quota') || message.includes('rate limit') || message.includes('resource_exhausted') || message.includes('429')) {
    return 'quota';
  }
  return 'unknown';
}

function humanMessage(
  kind: ImageErrorKind,
  engineLabel: string,
  provider: 'google' | 'bytedance' | 'openai' | 'leonardo' = 'google'
): string {
  switch (kind) {
    case 'no_key':
      // Раніше повідомлення завжди називало провайдера «Gemini», навіть
      // якщо автор явно обрав «Nano Banana 2» чи «Nano Banana Pro» — ці
      // моделі технічно ПРАЦЮЮТЬ через Gemini API (той самий GEMINI_API_KEY),
      // але користувачу, що свідомо обрав інший пункт у списку, це читалось
      // як «викликали не той рушій». Тепер назва обраного двигуна лишається
      // на першому місці, а Gemini згадується лише як ключ, який для нього
      // потрібен.
      if (provider === 'bytedance') {
        return `Двигун ${engineLabel} не налаштований: додайте ARK_API_KEY (ByteDance Seedream) у змінні оточення, або перевірте власний ключ у розділі «Ключі API».`;
      }
      if (provider === 'openai') {
        return `Двигун ${engineLabel} не налаштований: додайте OPENAI_API_KEY (той самий ключ, що й для GPT у чаті) у змінні оточення, або перевірте власний ключ у розділі «Ключі API».`;
      }
      if (provider === 'leonardo') {
        return `Двигун ${engineLabel} не налаштований: додайте LEONARDO_API_KEY у змінні оточення, або перевірте власний ключ у розділі «Ключі API».`;
      }
      return `Двигун ${engineLabel} не налаштований: додайте GEMINI_API_KEY (усі моделі Nano Banana працюють через Gemini API) у змінні оточення, або перевірте власний ключ у розділі «Ключі API».`;
    case 'safety':
      return 'Модель відхилила запит через фільтри безпеки. Спробуйте пом’якшити опис сцени або персонажа.';
    case 'quota':
      if (provider === 'bytedance') {
        return 'Вичерпано ліміт запитів до Seedream. Спробуйте за кілька хвилин або перевірте квоти у консолі BytePlus ModelArk.';
      }
      if (provider === 'openai') {
        return 'Вичерпано ліміт запитів до OpenAI. Спробуйте за кілька хвилин або перевірте квоти й ліміти витрат у платформі OpenAI.';
      }
      if (provider === 'leonardo') {
        return 'Вичерпано ліміт запитів або кредитів Leonardo.Ai (Pay-As-You-Go). Поповніть баланс або спробуйте за кілька хвилин.';
      }
      return 'Вичерпано ліміт запитів до моделі. Спробуйте за кілька хвилин або перевірте квоти у Google AI Studio.';
    case 'empty':
      return `Двигун ${engineLabel} не повернув зображення. Спробуйте ще раз або оберіть інший двигун.`;
    default:
      return `Не вдалося згенерувати зображення двигуном ${engineLabel}.`;
  }
}

function classifySeedreamError(status: number, message: string): ImageErrorKind {
  if (status === 401 || status === 403) return 'no_key';
  if (status === 429) return 'quota';
  const m = message.toLowerCase();
  if (m.includes('safety') || m.includes('sensitive') || m.includes('blocked') || m.includes('moderation')) return 'safety';
  if (m.includes('quota') || m.includes('rate limit')) return 'quota';
  return 'unknown';
}

/**
 * Найближчий безпечний розмір у пікселях для заданого співвідношення сторін
 * і рівня якості — Ark/Seedream приймає або токени «1K»/«2K»/«4K», або точні
 * WxH, а не всі акаунти/версії моделі однаково підтримують перші, тож тут
 * рахуємо точні пікселі (кратні 32, як заведено для дифузійних моделей).
 */
function seedreamPixelDims(aspectRatio: SupportedRatio, imageSize: string): { width: number; height: number } {
  const base = imageSize === '4K' ? 4096 : imageSize === '1K' ? 1024 : 2048;
  const [rw, rh] = aspectRatio.split(':').map(Number);
  const longSide = base;
  const shortSide = Math.round((base * Math.min(rw, rh)) / Math.max(rw, rh) / 32) * 32;
  return rw >= rh
    ? { width: longSide, height: shortSide }
    : { width: shortSide, height: longSide };
}

function seedreamPixelSize(aspectRatio: SupportedRatio, imageSize: string): string {
  const { width, height } = seedreamPixelDims(aspectRatio, imageSize);
  return `${width}x${height}`;
}

/**
 * Виклик тієї самої моделі Seedream через fal.ai.
 *
 * Дві відмінності від Ark, які й змушують писати окрему функцію:
 * заголовок «Key», а не «Bearer», і результат приходить ПОСИЛАННЯМ на файл,
 * а не base64 — тож байти доводиться забирати другим запитом.
 *
 * negative_prompt у схемі fal для цієї моделі відсутній, тому він тут не
 * приймається: мовчки проковтнути його означало б обіцяти вплив, якого нема.
 */
async function generateWithFal(
  engine: ImageEngineInfo,
  apiKey: string,
  prompt: string,
  aspectRatio: SupportedRatio,
  imageSize: string,
  referenceImageUrls?: string[]
): Promise<{ buffer: Buffer; mimeType: string; modelId: string }> {
  const { width, height } = seedreamPixelDims(aspectRatio, imageSize);
  const hasRefs = !!referenceImageUrls?.length;
  // edit — окремий ендпоїнт fal, не прапорець на text-to-image: у нього
  // інша обов’язкова схема полів (image_urls замість самого лише prompt).
  const modelId = hasRefs ? SEEDREAM_FAL_EDIT_MODEL : SEEDREAM_FAL_MODEL;

  let res: Response;
  try {
    res = await fetch(`${FAL_BASE_URL}/${modelId}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: { width, height },
        num_images: 1,
        enable_safety_checker: true,
        ...(hasRefs ? { image_urls: referenceImageUrls } : {}),
      }),
    });
  } catch (err) {
    throw new ImageGenerationError('unknown', `fal.ai недоступний: ${(err as Error).message}`, engine.id, err);
  }

  const json = (await res.json().catch(() => null)) as
    | { images?: { url?: string; content_type?: string }[]; detail?: unknown; error?: string }
    | null;

  if (!res.ok) {
    // fal кладе причину у detail — рядком або масивом об'єктів валідації.
    const detail = json?.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || JSON.stringify(d)).join('; ')
          : json?.error || `HTTP ${res.status}`;
    throw new ImageGenerationError(
      classifySeedreamError(res.status, message),
      `Seedream (fal): ${message}`,
      engine.id
    );
  }

  const first = json?.images?.[0];
  if (!first?.url) {
    throw new ImageGenerationError('empty', humanMessage('empty', engine.label), engine.id);
  }

  let fileRes: Response;
  try {
    fileRes = await fetch(first.url);
  } catch (err) {
    throw new ImageGenerationError(
      'unknown',
      `fal.ai: не вдалося забрати згенерований файл: ${(err as Error).message}`,
      engine.id,
      err
    );
  }
  if (!fileRes.ok) {
    throw new ImageGenerationError('unknown', `fal.ai: файл недоступний (HTTP ${fileRes.status}).`, engine.id);
  }

  return {
    buffer: Buffer.from(await fileRes.arrayBuffer()),
    mimeType: first.content_type || 'image/png',
    modelId,
  };
}

/** Виклик ByteDance Seedream через OpenAI-сумісний Ark REST API (images/generations). */
async function generateWithSeedream(
  engine: ImageEngineInfo,
  apiKey: string,
  prompt: string,
  aspectRatio: SupportedRatio,
  imageSize: string,
  negativePrompt?: string,
  referenceImageUrls?: string[]
): Promise<{ buffer: Buffer; mimeType: string }> {
  let res: Response;
  try {
    res = await fetch(`${seedreamConfig.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: engine.modelId,
        prompt,
        size: seedreamPixelSize(aspectRatio, imageSize),
        response_format: 'b64_json',
        watermark: false,
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        // Мультиреференсна генерація (задача #52) — «image» приймає
        // масив URL (base64 data: теж підтримується офіційним Ark REST,
        // але URL простіше й перевіряється тим самим кодом валідації,
        // що й для завантажених файлів — усі вони вже перетворені на
        // публічну адресу маршрутом, а не цим ядром).
        ...(referenceImageUrls?.length ? { image: referenceImageUrls } : {}),
      }),
    });
  } catch (err) {
    throw new ImageGenerationError('unknown', `Seedream API недоступний: ${(err as Error).message}`, engine.id, err);
  }

  const json = (await res.json().catch(() => null)) as
    | { data?: { url?: string; b64_json?: string }[]; error?: { message?: string; code?: string } }
    | null;

  if (!res.ok) {
    const message = json?.error?.message || `HTTP ${res.status}`;
    const kind = classifySeedreamError(res.status, message);
    throw new ImageGenerationError(kind, `Seedream: ${message}`, engine.id);
  }

  const first = json?.data?.[0];
  if (!first?.b64_json) {
    throw new ImageGenerationError('empty', humanMessage('empty', engine.label), engine.id);
  }
  return {
    buffer: Buffer.from(first.b64_json, 'base64'),
    mimeType: 'image/png',
  };
}

/**
 * Найближчий розмір із фіксованого набору gpt-image (1024x1024 /
 * 1536x1024 / 1024x1536) для заданого співвідношення сторін. GPT-моделі
 * приймають і 'auto', але тоді ціна й фактичний розмір лишаються
 * непередбачувані для тарифу нижче, тож тут завжди обираємо конкретне
 * значення — квадрат/альбом/портрет за тим самим принципом, що вже
 * використовує normalizeAspectRatio() для решти двигунів.
 */
function openaiSizeFor(aspectRatio: SupportedRatio): '1024x1024' | '1536x1024' | '1024x1536' {
  const [rw, rh] = aspectRatio.split(':').map(Number);
  if (rw === rh) return '1024x1024';
  return rw > rh ? '1536x1024' : '1024x1536';
}

/**
 * Виклик GPT Image (OpenAI) через /v1/images/generations. На відміну від
 * Seedream/Ark, тут немає окремого `negative_prompt` — виклик generateImage()
 * нижче вже дописує його текстом у сам prompt (та сама гілка, що й для
 * Google). Референсні зображення (мультиреференсна генерація, задача #52)
 * для GPT Image йдуть окремим ендпоінтом /images/edits із multipart-файлами,
 * а не JSON-полем у /generations — підключення цього шляху лишається поза
 * межами поточної задачі, тож із референсами двигун чесно відмовляє, а не
 * мовчки їх ігнорує.
 */
async function generateWithOpenAI(
  engine: ImageEngineInfo,
  apiKey: string,
  prompt: string,
  aspectRatio: SupportedRatio,
  quality?: 'minimal' | 'high',
  outputFormat?: 'png' | 'jpeg',
  referenceImageUrls?: string[]
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (referenceImageUrls?.length) {
    throw new ImageGenerationError(
      'unknown',
      `Двигун ${engine.label} поки не підтримує референсні зображення — оберіть інший двигун або приберіть референси.`,
      engine.id
    );
  }

  const size = openaiSizeFor(aspectRatio);
  const mappedQuality = quality === 'high' ? 'high' : quality === 'minimal' ? 'low' : 'medium';

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: engine.modelId,
        prompt,
        size,
        quality: mappedQuality,
        n: 1,
        ...(outputFormat && engine.supportsFormatChoice ? { output_format: outputFormat } : {}),
      }),
    });
  } catch (err) {
    throw new ImageGenerationError('unknown', `OpenAI API недоступний: ${(err as Error).message}`, engine.id, err);
  }

  const json = (await res.json().catch(() => null)) as
    | { data?: { b64_json?: string }[]; error?: { message?: string; code?: string; type?: string } }
    | null;

  if (!res.ok) {
    const message = json?.error?.message || `HTTP ${res.status}`;
    const kind = classifySeedreamError(res.status, message);
    throw new ImageGenerationError(kind, `OpenAI: ${message}`, engine.id);
  }

  const first = json?.data?.[0];
  if (!first?.b64_json) {
    throw new ImageGenerationError('empty', humanMessage('empty', engine.label), engine.id);
  }
  return {
    buffer: Buffer.from(first.b64_json, 'base64'),
    mimeType: outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
  };
}

/** Ширина/висота під Leonardo (32-1024px, кратні 8) з обраного співвідношення сторін. */
function leonardoPixelDims(aspectRatio: SupportedRatio): { width: number; height: number } {
  const base = 1024;
  const [rw, rh] = aspectRatio.split(':').map(Number);
  const longSide = base;
  const shortSide = Math.max(32, Math.round((base * Math.min(rw, rh)) / Math.max(rw, rh) / 8) * 8);
  return rw >= rh ? { width: longSide, height: shortSide } : { width: shortSide, height: longSide };
}

function classifyLeonardoError(status: number, message: string): ImageErrorKind {
  if (status === 401 || status === 403) return 'no_key';
  if (status === 429) return 'quota';
  const m = message.toLowerCase();
  if (m.includes('safety') || m.includes('moderation') || m.includes('nsfw') || m.includes('blocked')) return 'safety';
  if (m.includes('quota') || m.includes('rate limit') || m.includes('credit')) return 'quota';
  return 'unknown';
}

/** Скільки разів опитати статус генерації Leonardo, перш ніж здатися (кожні LEONARDO_POLL_INTERVAL_MS). */
const LEONARDO_POLL_INTERVAL_MS = 2500;
const LEONARDO_POLL_MAX_ATTEMPTS = 48; // ~2 хвилини — Leonardo документує фото як секунди, а не хвилини, тож запас із надлишком.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Виклик Leonardo.Ai Production API — ЄДИНИЙ асинхронний двигун у цьому
 * реєстрі (решта повертають байти в тій самій відповіді). Leonardo API
 * повертає лише `generationId` одразу, а сам результат зʼявляється тільки
 * після опитування `GET /generations/{id}` (`status: PENDING → COMPLETE`
 * чи `FAILED`) — тому виклик приховує це очікування всередині функції й
 * повертає готові байти, як і решта двигунів: решта пайплайну
 * (server/aiCore.ts generateImage(), збереження файлу, лог витрат,
 * усі три UI-поверхні через /api/ai/image-engines) лишається незмінною,
 * не знає й не має знати, що цей конкретний двигун — асинхронний.
 *
 * Свідомо поза межами: справжнього фонового job-черги тут немає — HTTP-
 * запит просто «висить», доки опитування не завершиться чи не вичерпає
 * LEONARDO_POLL_MAX_ATTEMPTS. Для одного зображення (секунди, за
 * документацією Leonardo) це прийнятно; для набагато довшого відео той
 * самий прийом уже ризикованіший — див. server/videoGeneration.ts.
 */
/**
 * Розподіляє виклик між класичним v1-двигуном 'leonardo' і 6 новими
 * v2-двигунами (задача #203) — залежно від того, який саме ImageEngineId
 * обрано. Решта generateImage() про цю різницю не знає: обидві гілки
 * повертають однакову форму { buffer, mimeType }.
 */
async function generateWithLeonardoDispatch(
  engine: ImageEngineInfo,
  apiKey: string,
  prompt: string,
  aspectRatio: SupportedRatio,
  negativePrompt?: string,
  referenceImageUrls?: string[]
): Promise<{ buffer: Buffer; mimeType: string }> {
  const v2Spec = leonardoV2SpecFor(engine.id);
  if (!v2Spec) {
    return generateWithLeonardo(engine, apiKey, prompt, aspectRatio, negativePrompt, referenceImageUrls);
  }
  try {
    return await generateLeonardoV2Photo({
      engineId: engine.id as LeonardoPhotoEngineId,
      apiKey,
      prompt,
      aspectRatio,
      referenceImageUrls,
    });
  } catch (err) {
    if (err instanceof LeonardoV2PhotoError) {
      throw new ImageGenerationError(err.kind, `Leonardo.Ai (${engine.label}): ${err.message}`, engine.id, err);
    }
    throw err;
  }
}

async function generateWithLeonardo(
  engine: ImageEngineInfo,
  apiKey: string,
  prompt: string,
  aspectRatio: SupportedRatio,
  negativePrompt?: string,
  referenceImageUrls?: string[]
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (referenceImageUrls?.length) {
    // Задача #203: раніше це повідомлення звучало так, ніби Leonardo.Ai
    // взагалі не вміє референсів — автор вказав, що це вводить в оману:
    // не вміє САМЕ ЦЕЙ (класичний v1) двигун; 6 новіших моделей нижче
    // (v2 API) підтримують референси нативно.
    throw new ImageGenerationError(
      'unknown',
      `Двигун ${engine.label} (класичний v1 API) не підтримує референсні зображення. Оберіть один із рушіїв «GPT Image 2.5 Flare/Sunburst», «Nano Banana 2 Lite», «Seedream 4.5/5.0 Pro» чи «FLUX Dev» (через Leonardo.Ai) — вони приймають референси нативно, або приберіть референси.`,
      engine.id
    );
  }

  const { width, height } = leonardoPixelDims(aspectRatio);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  let submitRes: Response;
  try {
    submitRes = await fetch(`${leonardoConfig.baseUrl}/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: prompt.slice(0, 1500), // жорсткий ліміт промпту в Leonardo Production API
        ...(engine.modelId ? { modelId: engine.modelId } : {}),
        width,
        height,
        num_images: 1,
        ...(negativePrompt?.trim() ? { negative_prompt: negativePrompt.trim() } : {}),
      }),
    });
  } catch (err) {
    throw new ImageGenerationError('unknown', `Leonardo.Ai недоступний: ${(err as Error).message}`, engine.id, err);
  }

  const submitJson = (await submitRes.json().catch(() => null)) as
    | { sdGenerationJob?: { generationId?: string }; generationId?: string; error?: string }
    | null;

  if (!submitRes.ok) {
    const message = submitJson?.error || `HTTP ${submitRes.status}`;
    const kind = classifyLeonardoError(submitRes.status, message);
    throw new ImageGenerationError(kind, `Leonardo.Ai: ${message}`, engine.id);
  }

  const generationId = submitJson?.sdGenerationJob?.generationId || submitJson?.generationId;
  if (!generationId) {
    throw new ImageGenerationError('empty', humanMessage('empty', engine.label), engine.id);
  }

  let imageUrl: string | undefined;
  for (let attempt = 0; attempt < LEONARDO_POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(LEONARDO_POLL_INTERVAL_MS);
    let pollRes: Response;
    try {
      pollRes = await fetch(`${leonardoConfig.baseUrl}/generations/${generationId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
    } catch (err) {
      throw new ImageGenerationError('unknown', `Leonardo.Ai недоступний під час очікування: ${(err as Error).message}`, engine.id, err);
    }
    const pollJson = (await pollRes.json().catch(() => null)) as
      | { generations_by_pk?: { status?: string; generated_images?: { url?: string }[] } }
      | null;
    if (!pollRes.ok) {
      const message = `HTTP ${pollRes.status}`;
      throw new ImageGenerationError(classifyLeonardoError(pollRes.status, message), `Leonardo.Ai: ${message}`, engine.id);
    }
    const gen = pollJson?.generations_by_pk;
    if (gen?.status === 'COMPLETE') {
      imageUrl = gen.generated_images?.[0]?.url;
      break;
    }
    if (gen?.status === 'FAILED') {
      throw new ImageGenerationError('unknown', `Leonardo.Ai: генерацію відхилено (status FAILED).`, engine.id);
    }
    // PENDING — пробуємо далі.
  }

  if (!imageUrl) {
    throw new ImageGenerationError(
      'unknown',
      `Leonardo.Ai не встиг завершити генерацію за відведений час. Спробуйте ще раз.`,
      engine.id
    );
  }

  let downloadRes: Response;
  try {
    downloadRes = await fetch(imageUrl);
  } catch (err) {
    throw new ImageGenerationError('unknown', `Не вдалося завантажити результат Leonardo.Ai: ${(err as Error).message}`, engine.id, err);
  }
  if (!downloadRes.ok) {
    throw new ImageGenerationError('unknown', `Не вдалося завантажити результат Leonardo.Ai (HTTP ${downloadRes.status}).`, engine.id);
  }
  const arrayBuffer = await downloadRes.arrayBuffer();
  const mimeType = downloadRes.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

/** Виклик моделі сімейства Nano Banana через Interactions API. */
async function generateWithNanoBanana(
  ai: GoogleGenAI,
  engine: ImageEngineInfo,
  prompt: string,
  aspectRatio: SupportedRatio,
  imageSize: string,
  quality?: 'minimal' | 'high',
  outputFormat?: 'png' | 'jpeg',
  referenceImageUrls?: string[]
): Promise<{ buffer: Buffer; mimeType: string }> {
  const responseFormat: Record<string, unknown> = {
    type: 'image',
    aspect_ratio: aspectRatio,
    image_size: imageSize,
  };
  // mime_type — необов'язкове поле: не передаємо його взагалі, якщо автор
  // не обрав формат явно, щоб модель лишалась на своєму дефолті.
  if (outputFormat && engine.supportsFormatChoice) {
    responseFormat.mime_type = outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  }

  // Референси перетворюють вхід із простого рядка на масив Content —
  // текстова частина ({type:'text'}) і по одній {type:'image', uri} на
  // кожен референс. Google САМ забирає файл за URI (не потребує
  // base64), тому маршрут заздалегідь перетворює завантажені файли на
  // публічні URL, а не шле сюди сирі байти.
  const input: unknown = referenceImageUrls?.length
    ? [{ type: 'text', text: prompt }, ...referenceImageUrls.map((uri) => ({ type: 'image', uri }))]
    : prompt;

  const request: Record<string, unknown> = {
    model: engine.modelId,
    input,
    response_format: responseFormat,
  };
  // thinking_level — задокументований лише для лінійки 3.1 Flash Image;
  // engine.supportsQualityControl уже це відсіює на рівні виклику
  // generateImage(), тут — друга лінія оборони на випадок прямого виклику.
  if (quality && engine.supportsQualityControl) {
    request.generation_config = { thinking_level: quality };
  }

  const interaction = await ai.interactions.create(request as never);

  const image = (interaction as { output_image?: { data?: string; mime_type?: string } })
    .output_image;

  if (!image?.data) {
    throw new ImageGenerationError('empty', humanMessage('empty', engine.label), engine.id);
  }
  return {
    buffer: Buffer.from(image.data, 'base64'),
    mimeType: image.mime_type || 'image/png',
  };
}

/** Генерує одне зображення обраним двигуном. */
export async function generateImage(
  ai: GoogleGenAI | null,
  options: GenerateImageOptions
): Promise<GeneratedImageResult> {
  const engine = resolveEngine(options.engine);

  // Власний ключ автора («Ключі API») має пріоритет над серверним, як і в
  // текстових рушіях: платить той, чий ключ підставлено. Той самий override
  // стосується рівно ОДНОГО провайдера за виклик — той, що відповідає
  // обраному двигуну (server/aiCore.ts підставляє платформний ключ саме
  // під нього), тож тут просто розкладаємо його по двох гілках.
  const overrideKey = options.apiKeyOverride?.trim();
  const seedreamKey = overrideKey || seedreamConfig.apiKey;
  const openaiKey = overrideKey || openaiImageConfig.apiKey;
  const leonardoKey = overrideKey || leonardoConfig.apiKey;

  if (engine.provider === 'google' && !ai) {
    throw new ImageGenerationError('no_key', humanMessage('no_key', engine.label, 'google'), engine.id);
  }
  if (engine.provider === 'bytedance' && !seedreamKey) {
    throw new ImageGenerationError('no_key', humanMessage('no_key', engine.label, 'bytedance'), engine.id);
  }
  if (engine.provider === 'openai' && !openaiKey) {
    throw new ImageGenerationError('no_key', humanMessage('no_key', engine.label, 'openai'), engine.id);
  }
  if (engine.provider === 'leonardo' && !leonardoKey) {
    throw new ImageGenerationError('no_key', humanMessage('no_key', engine.label, 'leonardo'), engine.id);
  }
  if (!options.prompt || !options.prompt.trim()) {
    throw new ImageGenerationError('unknown', 'Порожній промпт для генерації зображення.', engine.id);
  }
  const refCount = options.referenceImageUrls?.length || 0;
  if (refCount > 0) {
    // Задача #203: у 6 нових Leonardo v2 двигунів своя, задокументована
    // межа референсів (2-16, залежно від моделі) — НЕ той самий
    // MAX_REFERENCE_IMAGES=10, що для решти (Google/ByteDance/OpenAI).
    // Перевіряємо саме межу ОБРАНОГО двигуна, а не універсальну.
    const v2Spec = leonardoV2SpecFor(engine.id);
    const perEngineMax = v2Spec ? leonardoV2PhotoMaxReferences(v2Spec) : MAX_REFERENCE_IMAGES;
    if (refCount > perEngineMax) {
      throw new ImageGenerationError(
        'unknown',
        `Занадто багато референсних зображень для двигуна «${engine.label}»: максимум ${perEngineMax}.`,
        engine.id
      );
    }
  }

  const aspectRatio = normalizeAspectRatio(options.aspectRatio);
  // Lite не вміє більше за 1K — мовчки опускаємо запит до можливостей моделі.
  // РАНІШЕ тут будь-яке значення, окрім '1K', мовчки згорталось до '2K' —
  // навіть якщо автор явно просив '4K' у двигуна, що його підтримує
  // (maxSize: '4K' у трьох з чотирьох двигунів). Панель генерації в
  // медіатеці вперше робить розмір видимим і клікабельним параметром,
  // тож цю обмежувальну помилку довелось виправити тут же — інакше вибір
  // «4K» у новій панелі мовчки повертав би 2K.
  const requestedSize: '1K' | '2K' | '4K' =
    options.imageSize === '1K' || options.imageSize === '4K' ? options.imageSize : '2K';
  const imageSize = engine.maxSize === '1K' ? '1K' : requestedSize;

  // Негативний промпт окремим полем моделі не приймають (крім Seedream, де
  // це офіційне поле запиту) — для решти дописуємо текстом у сам промпт.
  const prompt =
    options.negativePrompt?.trim() && engine.provider !== 'bytedance'
      ? `${options.prompt.trim()}\n\nAvoid: ${options.negativePrompt.trim()}`
      : options.prompt.trim();

  try {
    const viaFal = engine.provider === 'bytedance' && seedreamTransportFor(seedreamKey) === 'fal';
    const generated =
      engine.provider === 'bytedance'
        ? viaFal
          ? await generateWithFal(engine, seedreamKey, prompt, aspectRatio, imageSize, options.referenceImageUrls)
          : await generateWithSeedream(
              engine,
              seedreamKey,
              prompt,
              aspectRatio,
              imageSize,
              options.negativePrompt,
              options.referenceImageUrls
            )
        : engine.provider === 'openai'
          ? await generateWithOpenAI(
              engine,
              openaiKey,
              prompt,
              aspectRatio,
              options.quality,
              options.outputFormat,
              options.referenceImageUrls
            )
          : engine.provider === 'leonardo'
            ? await generateWithLeonardoDispatch(engine, leonardoKey, prompt, aspectRatio, options.negativePrompt, options.referenceImageUrls)
            : await generateWithNanoBanana(
              ai as GoogleGenAI,
              engine,
              prompt,
              aspectRatio,
              imageSize,
              options.quality,
              options.outputFormat,
              options.referenceImageUrls
            );
    return {
      ...generated,
      engine,
      aspectRatio,
      modelId: viaFal ? (generated as { modelId?: string }).modelId || SEEDREAM_FAL_MODEL : engine.modelId,
    };
  } catch (err) {
    if (err instanceof ImageGenerationError) throw err;
    const kind = classifyProviderError(err);
    throw new ImageGenerationError(kind, humanMessage(kind, engine.label, engine.provider), engine.id, err);
  }
}

// ---------------------------------------------------------------------------
// Збереження на диск
// ---------------------------------------------------------------------------

/** Каталог для згенерованих файлів. Для хмарного хостингу варто підмінити на об'єктне сховище. */
export const GENERATED_DIR =
  process.env.GENERATED_IMAGES_DIR || path.join(process.cwd(), 'assets', 'generated');

/** Публічний префікс, під яким каталог віддається статикою. */
export const GENERATED_URL_PREFIX = '/generated';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export async function ensureGeneratedDir(): Promise<void> {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
}

/** Записує зображення у файл і повертає URL, придатний для збереження в книзі. */
export async function saveGeneratedImage(
  buffer: Buffer,
  mimeType: string,
  hint = 'art'
): Promise<{ url: string; filename: string; bytes: number }> {
  await ensureGeneratedDir();

  const ext = MIME_EXTENSIONS[mimeType] || 'png';
  // Кирилиця в іменах файлів на різних ФС поводиться по-різному, тож
  // лишаємо лише ASCII і згортаємо порожні залишки.
  const safeHint =
    hint
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'art';
  const filename = `${safeHint}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

  await fs.writeFile(path.join(GENERATED_DIR, filename), buffer);

  return {
    url: `${GENERATED_URL_PREFIX}/${filename}`,
    filename,
    bytes: buffer.byteLength,
  };
}

/** Перелік двигунів для інтерфейсу — щоб клієнт не хардкодив назви моделей. */
export function listEngines(availability: { google: boolean; bytedance: boolean; openai: boolean; leonardo: boolean }) {
  return Object.values(IMAGE_ENGINES).map((engine) => {
    const v2Spec = leonardoV2SpecFor(engine.id);
    return {
      id: engine.id,
      label: engine.label,
      modelId: engine.modelId,
      provider: engine.provider,
      maxSize: engine.maxSize,
      supportsQualityControl: engine.supportsQualityControl,
      supportsFormatChoice: engine.supportsFormatChoice,
      /**
       * Задача #203. Раніше панель медіатеки показувала завантаження
       * референсів ОДНАКОВО для всіх двигунів (клієнтський хардкод
       * MAX_REFERENCE_IMAGES=10) і дізнавалась, що конкретний двигун їх
       * не приймає, лише з помилки сервера ПІСЛЯ спроби генерації — саме
       * це й спричинило хибне враження «Leonardo.Ai взагалі не вміє
       * референсів». Тепер клієнт бачить підтримку і реальну межу
       * ЗАЗДАЛЕГІДЬ, для кожного двигуна окремо.
       */
      supportsReferenceImages: engine.provider === 'leonardo' ? !!v2Spec : true,
      maxReferenceImages: v2Spec
        ? leonardoV2PhotoMaxReferences(v2Spec)
        : engine.provider === 'leonardo'
          ? 0
          : MAX_REFERENCE_IMAGES,
      available:
        engine.provider === 'bytedance'
          ? availability.bytedance
          : engine.provider === 'openai'
            ? availability.openai
            : engine.provider === 'leonardo'
              ? availability.leonardo
              : availability.google,
    };
  });
}
