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
 * Чого тут свідомо немає і чому:
 *   • Midjourney — не має офіційного публічного API; існують лише сторонні
 *     мости через Discord, які порушують його ToS і ризикують акаунтом.
 *   • DALL·E 3   — видалена з OpenAI API.
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
import { SEEDREAM_FAL_MODEL } from './pricing';

export type ImageEngineId = 'nano-banana-2-lite' | 'nano-banana-2' | 'nano-banana-pro' | 'seedream';

export interface ImageEngineInfo {
  id: ImageEngineId;
  /** Назва, яку бачить користувач. */
  label: string;
  /** Ідентифікатор моделі у провайдера. */
  modelId: string;
  provider: 'google' | 'bytedance';
  /** Найбільший розмір, який приймає модель. */
  maxSize: '1K' | '2K' | '4K';
}

export const IMAGE_ENGINES: Record<ImageEngineId, ImageEngineInfo> = {
  'nano-banana-2-lite': {
    id: 'nano-banana-2-lite',
    label: 'Nano Banana 2 Lite',
    modelId: process.env.NANO_BANANA_LITE_MODEL || 'gemini-3.1-flash-lite-image',
    provider: 'google',
    // Lite підтримує лише 1K.
    maxSize: '1K',
  },
  'nano-banana-2': {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    modelId: process.env.NANO_BANANA_MODEL || 'gemini-3.1-flash-image',
    provider: 'google',
    maxSize: '4K',
  },
  'nano-banana-pro': {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    modelId: process.env.NANO_BANANA_PRO_MODEL || 'gemini-3-pro-image',
    provider: 'google',
    maxSize: '4K',
  },
  seedream: {
    id: 'seedream',
    label: 'Seedream (ByteDance)',
    modelId: process.env.SEEDREAM_MODEL || 'seedream-4-0-250828',
    provider: 'bytedance',
    maxSize: '4K',
  },
};

export const DEFAULT_ENGINE: ImageEngineId = 'nano-banana-2';

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

/** Співвідношення сторін, які приймають ці моделі. */
const SUPPORTED_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;
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

function humanMessage(kind: ImageErrorKind, engineLabel: string, provider: 'google' | 'bytedance' = 'google'): string {
  switch (kind) {
    case 'no_key':
      // Раніше повідомлення завжди називало провайдера «Gemini», навіть
      // якщо автор явно обрав «Nano Banana 2» чи «Nano Banana Pro» — ці
      // моделі технічно ПРАЦЮЮТЬ через Gemini API (той самий GEMINI_API_KEY),
      // але користувачу, що свідомо обрав інший пункт у списку, це читалось
      // як «викликали не той рушій». Тепер назва обраного двигуна лишається
      // на першому місці, а Gemini згадується лише як ключ, який для нього
      // потрібен.
      return provider === 'bytedance'
        ? `Двигун ${engineLabel} не налаштований: додайте ARK_API_KEY (ByteDance Seedream) у змінні оточення, або перевірте власний ключ у розділі «Ключі API».`
        : `Двигун ${engineLabel} не налаштований: додайте GEMINI_API_KEY (усі моделі Nano Banana працюють через Gemini API) у змінні оточення, або перевірте власний ключ у розділі «Ключі API».`;
    case 'safety':
      return 'Модель відхилила запит через фільтри безпеки. Спробуйте пом’якшити опис сцени або персонажа.';
    case 'quota':
      return provider === 'bytedance'
        ? 'Вичерпано ліміт запитів до Seedream. Спробуйте за кілька хвилин або перевірте квоти у консолі BytePlus ModelArk.'
        : 'Вичерпано ліміт запитів до моделі. Спробуйте за кілька хвилин або перевірте квоти у Google AI Studio.';
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
  imageSize: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const { width, height } = seedreamPixelDims(aspectRatio, imageSize);

  let res: Response;
  try {
    res = await fetch(`${FAL_BASE_URL}/${SEEDREAM_FAL_MODEL}`, {
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
  };
}

/** Виклик ByteDance Seedream через OpenAI-сумісний Ark REST API (images/generations). */
async function generateWithSeedream(
  engine: ImageEngineInfo,
  apiKey: string,
  prompt: string,
  aspectRatio: SupportedRatio,
  imageSize: string,
  negativePrompt?: string
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

/** Виклик моделі сімейства Nano Banana через Interactions API. */
async function generateWithNanoBanana(
  ai: GoogleGenAI,
  engine: ImageEngineInfo,
  prompt: string,
  aspectRatio: SupportedRatio,
  imageSize: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const interaction = await ai.interactions.create({
    model: engine.modelId,
    input: prompt,
    response_format: {
      type: 'image',
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    },
  } as never);

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
  // текстових рушіях: платить той, чий ключ підставлено.
  const seedreamKey = options.apiKeyOverride?.trim() || seedreamConfig.apiKey;

  if (engine.provider === 'google' && !ai) {
    throw new ImageGenerationError('no_key', humanMessage('no_key', engine.label, 'google'), engine.id);
  }
  if (engine.provider === 'bytedance' && !seedreamKey) {
    throw new ImageGenerationError('no_key', humanMessage('no_key', engine.label, 'bytedance'), engine.id);
  }
  if (!options.prompt || !options.prompt.trim()) {
    throw new ImageGenerationError('unknown', 'Порожній промпт для генерації зображення.', engine.id);
  }

  const aspectRatio = normalizeAspectRatio(options.aspectRatio);
  // Lite не вміє більше за 1K — мовчки опускаємо запит до можливостей моделі.
  const requestedSize = options.imageSize === '1K' ? '1K' : '2K';
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
          ? await generateWithFal(engine, seedreamKey, prompt, aspectRatio, imageSize)
          : await generateWithSeedream(engine, seedreamKey, prompt, aspectRatio, imageSize, options.negativePrompt)
        : await generateWithNanoBanana(ai as GoogleGenAI, engine, prompt, aspectRatio, imageSize);
    return {
      ...generated,
      engine,
      aspectRatio,
      modelId: viaFal ? SEEDREAM_FAL_MODEL : engine.modelId,
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
export function listEngines(availability: { google: boolean; bytedance: boolean }) {
  return Object.values(IMAGE_ENGINES).map((engine) => ({
    id: engine.id,
    label: engine.label,
    modelId: engine.modelId,
    provider: engine.provider,
    available: engine.provider === 'bytedance' ? availability.bytedance : availability.google,
  }));
}
