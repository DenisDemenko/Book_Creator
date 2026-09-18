/**
 * Генерація відео — Leonardo.Ai Production API (задача #201, продовження
 * #199/#200: «Леонардо для фото і відео разом, повний обсяг зараз»).
 *
 * ЧОМУ ОКРЕМИЙ МОДУЛЬ, А НЕ ГІЛКА В imageGeneration.ts. Відео — інший
 * контракт результату (тривалість, роздільність замість розміру
 * зображення), інший діапазон часу очікування (документація Leonardo не
 * дає секундної оцінки для відео, як для фото — практика підказує від
 * десятків секунд до кількох хвилин, особливо для Veo3/Kling на 1080p/10с)
 * і, найголовніше, ЖОДНОГО іншого провайдера, крім Leonardo, — дублювати
 * структуру imageGeneration.ts (реєстр engine.provider на 4+ гілки) заради
 * одного провайдера означало б вигадану абстракцію під фічі, яких ще нема.
 *
 * ЯКИЙ САМЕ ЕНДПОЇНТ. Спершу план був «згенерувати картинку → приліпити
 * відео до її imageId» (image-to-video, як і задумано в коментарі
 * generateWithLeonardo() у imageGeneration.ts). Звірка з офіційною
 * документацією (docs.leonardo.ai, вересень 2026) показала простіший і
 * ПОВНІШЕ задокументований шлях: усі шість моделей (Motion 2.0(Fast),
 * Veo3(Fast), Kling 2.1/2.5) мають ПРЯМИЙ text-to-video ендпоїнт
 * (`POST /generations-text-to-video`) — жодного проміжного зображення,
 * жодного невизначеного «завантажити своє зображення в Leonardo» кроку
 * (`imageType: 'UPLOADED'`), чия саме форма запиту лишається
 * непідтвердженою). Це й обрано тут: чесніший шлях — той, що справді
 * підтверджений документацією, а не той, що був задуманий першим.
 *
 * Джерела (звірено вересень 2026, з живої документації Leonardo.Ai):
 *  - Motion 2.0 / 2.0 Fast: docs.leonardo.ai/docs/generate-with-motion-2-motion-2-fast-using-text-prompts
 *  - Veo3 / Veo3 Fast:      docs.leonardo.ai/docs/generate-with-veo3-veo3-fast-using-text-prompts
 *  - Kling 2.5 Turbo:       docs.leonardo.ai/docs/generate-with-kling-2-5-turbo-using-text-prompts
 *  - Kling 2.1 Pro:         docs.leonardo.ai/docs/kling-2-1-pro
 *
 * СВІДОМО НЕПІДТВЕРДЖЕНО (задокументовано, а не замовчано):
 *  - Форма ВІДПОВІДІ на опитування статусу відеозавдання. Документація
 *    не показує приклад відповіді для відеогенерацій (лише для фото:
 *    `generations_by_pk.generated_images`). Опитування тут іде на ТОЙ
 *    САМИЙ `GET /generations/{id}`, що й для фото (обидва типи завдань —
 *    один і той самий `generationId`-механізм платформи), а результат
 *    читається з кількох правдоподібних шляхів (`generated_videos[0].url`
 *    насамперед) — якщо жоден не знайдено, кидається чітка помилка
 *    замість мовчазного падіння. Перше ж реальне звернення з ключем
 *    адміністратора або підтвердить це, або покаже точну назву поля —
 *    тоді значення поля стане одним рядком-правкою, а не переписуванням.
 *  - Офіційний FAQ Leonardo (`docs.leonardo.ai/docs/api-faq`) прямо радить
 *    НЕ опитувати статус, а підписатись на webhook. Тут лишено
 *    опитування — той самий свідомий компроміс, що й для фото
 *    (generateWithLeonardo() у imageGeneration.ts), тільки РИЗИКОВАНІШИЙ:
 *    відео документовано довше за фото, а HTTP-запит просто «висить»
 *    ці хвилини. Повноцінна відповідь — фонова черга завдань і
 *    webhook-колбек — свідомо поза межами цієї задачі; за нинішньої
 *    архітектури (один синхронний виклик = один HTTP-запит) це
 *    найбільший ризик слабкого місця.
 */

import { leonardoConfig } from './imageGeneration';

// ---------------------------------------------------------------------------
// Реєстр двигунів
// ---------------------------------------------------------------------------

export type VideoEngineId =
  | 'leonardo-motion2'
  | 'leonardo-motion2-fast'
  | 'leonardo-veo3'
  | 'leonardo-veo3-fast'
  | 'leonardo-kling2-1'
  | 'leonardo-kling2-5';

export type VideoResolutionTier = '480' | '720' | '1080';
export type VideoAspectRatio = '16:9' | '9:16' | '1:1';

export interface VideoEngineInfo {
  id: VideoEngineId;
  label: string;
  provider: 'leonardo';
  /** Точне значення поля `model` у тілі запиту Leonardo (docs.leonardo.ai, вересень 2026). */
  leonardoModel: string;
  /** null — Leonardo не документує вибір тривалості для цієї моделі, поле `duration` не надсилається. */
  durationsSec: number[] | null;
  defaultDurationSec: number | null;
  resolutions: readonly VideoResolutionTier[];
  defaultResolution: VideoResolutionTier;
  aspectRatios: readonly VideoAspectRatio[];
  defaultAspectRatio: VideoAspectRatio;
}

export const VIDEO_ENGINES: Record<VideoEngineId, VideoEngineInfo> = {
  'leonardo-motion2': {
    id: 'leonardo-motion2',
    label: 'Leonardo Motion 2.0',
    provider: 'leonardo',
    leonardoModel: 'MOTION2',
    // Тривалість і вибір роздільності для Motion документація не показує
    // (лише один приклад — 832×480/RESOLUTION_480) — не вигадуємо інших.
    durationsSec: null,
    defaultDurationSec: null,
    resolutions: ['480'],
    defaultResolution: '480',
    aspectRatios: ['16:9'],
    defaultAspectRatio: '16:9',
  },
  'leonardo-motion2-fast': {
    id: 'leonardo-motion2-fast',
    label: 'Leonardo Motion 2.0 Fast',
    provider: 'leonardo',
    leonardoModel: 'MOTION2FAST',
    durationsSec: null,
    defaultDurationSec: null,
    resolutions: ['480'],
    defaultResolution: '480',
    aspectRatios: ['16:9'],
    defaultAspectRatio: '16:9',
  },
  'leonardo-veo3': {
    id: 'leonardo-veo3',
    label: 'Google Veo 3 (через Leonardo.Ai)',
    provider: 'leonardo',
    leonardoModel: 'VEO3',
    durationsSec: [4, 6, 8],
    defaultDurationSec: 8,
    resolutions: ['720', '1080'],
    defaultResolution: '720',
    // 9:16 для портретних роликів документація прямо не показує (приклад
    // лише 16:9) — дозволяємо як симетричну перестановку сторін, типову
    // для решти відеодвигунів Leonardo (Kling це підтверджує явно).
    aspectRatios: ['16:9', '9:16'],
    defaultAspectRatio: '16:9',
  },
  'leonardo-veo3-fast': {
    id: 'leonardo-veo3-fast',
    label: 'Google Veo 3 Fast (через Leonardo.Ai)',
    provider: 'leonardo',
    leonardoModel: 'VEO3FAST',
    durationsSec: [4, 6, 8],
    defaultDurationSec: 8,
    resolutions: ['720', '1080'],
    defaultResolution: '720',
    aspectRatios: ['16:9', '9:16'],
    defaultAspectRatio: '16:9',
  },
  'leonardo-kling2-1': {
    id: 'leonardo-kling2-1',
    label: 'Kling 2.1 Pro (через Leonardo.Ai)',
    provider: 'leonardo',
    leonardoModel: 'KLING2_1',
    durationsSec: [5, 10],
    defaultDurationSec: 5,
    // Документація Kling 2.1 показує лише RESOLUTION_1080.
    resolutions: ['1080'],
    defaultResolution: '1080',
    aspectRatios: ['16:9', '9:16'],
    defaultAspectRatio: '16:9',
  },
  'leonardo-kling2-5': {
    id: 'leonardo-kling2-5',
    label: 'Kling 2.5 Turbo (через Leonardo.Ai)',
    provider: 'leonardo',
    leonardoModel: 'KLING2_5',
    durationsSec: [5, 10],
    defaultDurationSec: 5,
    resolutions: ['1080'],
    defaultResolution: '1080',
    // Єдина з шести моделей, де документація прямо показує ще й 1:1 (1440×1440).
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
  },
};

export const DEFAULT_VIDEO_ENGINE: VideoEngineId = 'leonardo-motion2';

export function resolveVideoEngine(requested?: string): VideoEngineInfo {
  if (requested && requested in VIDEO_ENGINES) {
    return VIDEO_ENGINES[requested as VideoEngineId];
  }
  return VIDEO_ENGINES[DEFAULT_VIDEO_ENGINE];
}

function normalizeResolution(engine: VideoEngineInfo, requested?: string): VideoResolutionTier {
  if (requested && (engine.resolutions as readonly string[]).includes(requested)) {
    return requested as VideoResolutionTier;
  }
  return engine.defaultResolution;
}

function normalizeAspectRatio(engine: VideoEngineInfo, requested?: string): VideoAspectRatio {
  if (requested && (engine.aspectRatios as readonly string[]).includes(requested)) {
    return requested as VideoAspectRatio;
  }
  return engine.defaultAspectRatio;
}

function normalizeDuration(engine: VideoEngineInfo, requested?: number): number | null {
  if (engine.durationsSec === null) return null;
  if (typeof requested === 'number' && engine.durationsSec.includes(requested)) return requested;
  return engine.defaultDurationSec;
}

/**
 * Пікселі під пару (роздільність, співвідношення сторін). Базові пари —
 * ТОЧНО ті, що документація показує для 16:9 (832×480 / 1280×720 /
 * 1920×1080); 9:16 — ті самі числа, сторони поміняно місцями (підтверджено
 * явно лише для Kling, для решти — усталений і безпечний прийом); 1:1 —
 * єдина підтверджена пара 1440×1440 (лише Kling 2.5 її й пропонує).
 */
function pixelDims(resolution: VideoResolutionTier, aspectRatio: VideoAspectRatio): { width: number; height: number } {
  if (aspectRatio === '1:1') return { width: 1440, height: 1440 };
  const base: Record<VideoResolutionTier, { w: number; h: number }> = {
    '480': { w: 832, h: 480 },
    '720': { w: 1280, h: 720 },
    '1080': { w: 1920, h: 1080 },
  };
  const { w, h } = base[resolution];
  return aspectRatio === '9:16' ? { width: h, height: w } : { width: w, height: h };
}

function leonardoResolutionField(resolution: VideoResolutionTier): string {
  return `RESOLUTION_${resolution}`;
}

// ---------------------------------------------------------------------------
// Помилки — той самий контракт kind, що й ImageGenerationError, з тим самим
// сенсом (no_key/safety/quota/empty/unknown), навмисно ОКРЕМИЙ клас: видова
// помилка не повинна пройти крізь `catch (err instanceof ImageGenerationError)`
// фото-пайплайну й навпаки.
// ---------------------------------------------------------------------------

export type VideoErrorKind = 'no_key' | 'safety' | 'quota' | 'empty' | 'unknown';

export class VideoGenerationError extends Error {
  kind: VideoErrorKind;
  engine?: VideoEngineId;
  cause?: unknown;

  constructor(kind: VideoErrorKind, message: string, engine?: VideoEngineId, cause?: unknown) {
    super(message);
    this.name = 'VideoGenerationError';
    this.kind = kind;
    this.engine = engine;
    this.cause = cause;
  }
}

function classifyLeonardoVideoError(status: number, message: string): VideoErrorKind {
  if (status === 401 || status === 403) return 'no_key';
  if (status === 429) return 'quota';
  const m = message.toLowerCase();
  if (m.includes('safety') || m.includes('moderation') || m.includes('nsfw') || m.includes('blocked')) return 'safety';
  if (m.includes('quota') || m.includes('rate limit') || m.includes('credit')) return 'quota';
  return 'unknown';
}

export function humanVideoMessage(kind: VideoErrorKind, engineLabel: string): string {
  switch (kind) {
    case 'no_key':
      return `Немає ключа API для ${engineLabel} — адміністратор має вставити його в розділі «Ключі API» (двигун Leonardo.Ai обслуговує і фото, і відео одним ключем).`;
    case 'safety':
      return `${engineLabel}: запит відхилено фільтром безпеки. Спробуйте переформулювати опис.`;
    case 'quota':
      return `${engineLabel}: вичерпано ліміт або перевищено швидкість запитів. Спробуйте пізніше.`;
    case 'empty':
      return `${engineLabel}: генерація не повернула відео.`;
    default:
      return `${engineLabel}: не вдалося згенерувати відео. Спробуйте ще раз.`;
  }
}

// ---------------------------------------------------------------------------
// Опитування статусу — довше вікно, ніж для фото (див. коментар модуля).
// ---------------------------------------------------------------------------

const LEONARDO_VIDEO_POLL_INTERVAL_MS = 5000;
/** ~6 хвилин (72 × 5с) — запас під 1080p/10с Kling, найповільніший варіант із шести. */
const LEONARDO_VIDEO_POLL_MAX_ATTEMPTS = 72;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Дістає URL готового відео з відповіді опитування. Форма відповіді для
 * ВІДЕО-завдань не підтверджена документацією (див. коментар модуля) —
 * тому перевіряємо кілька правдоподібних шляхів замість одного, і кидаємо
 * чітку помилку, якщо жоден не спрацював, а не падаємо на `undefined`.
 */
function extractVideoUrl(gen: Record<string, unknown> | undefined): string | undefined {
  if (!gen) return undefined;
  const videos = gen.generated_videos as { url?: string }[] | undefined;
  if (Array.isArray(videos) && videos[0]?.url) return videos[0].url;

  const images = gen.generated_images as { url?: string; motionMP4URL?: string }[] | undefined;
  if (Array.isArray(images) && images[0]) {
    if (images[0].motionMP4URL) return images[0].motionMP4URL;
    if (images[0].url) return images[0].url;
  }

  if (typeof gen.motionVideoURL === 'string') return gen.motionVideoURL;
  if (typeof gen.videoUrl === 'string') return gen.videoUrl;
  return undefined;
}

export interface GenerateVideoOptions {
  /** Власний ключ автора або платформний ключ адміністратора («Ключі API», рушій 'leonardo'). */
  apiKeyOverride?: string;
  prompt: string;
  engine?: string;
  resolution?: string;
  aspectRatio?: string;
  durationSec?: number;
}

export interface GeneratedVideoResult {
  buffer: Buffer;
  mimeType: string;
  engine: VideoEngineInfo;
  modelId: string;
  resolution: VideoResolutionTier;
  aspectRatio: VideoAspectRatio;
  durationSec: number | null;
}

/** Генерує одне відео обраним двигуном Leonardo.Ai. Єдина публічна точка входу модуля. */
export async function generateVideo(options: GenerateVideoOptions): Promise<GeneratedVideoResult> {
  const engine = resolveVideoEngine(options.engine);
  const apiKey = options.apiKeyOverride?.trim() || leonardoConfig.apiKey;

  if (!apiKey) {
    throw new VideoGenerationError('no_key', humanVideoMessage('no_key', engine.label), engine.id);
  }
  if (!options.prompt || !options.prompt.trim()) {
    throw new VideoGenerationError('unknown', 'Порожній промпт для генерації відео.', engine.id);
  }

  const resolution = normalizeResolution(engine, options.resolution);
  const aspectRatio = normalizeAspectRatio(engine, options.aspectRatio);
  const durationSec = normalizeDuration(engine, options.durationSec);
  const { width, height } = pixelDims(resolution, aspectRatio);

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const body: Record<string, unknown> = {
    prompt: options.prompt.trim().slice(0, 1500), // та сама межа промпту, що й у фото-двигуні Leonardo.
    model: engine.leonardoModel,
    resolution: leonardoResolutionField(resolution),
    width,
    height,
    isPublic: false,
  };
  if (durationSec !== null) body.duration = durationSec;

  let submitRes: Response;
  try {
    submitRes = await fetch(`${leonardoConfig.baseUrl}/generations-text-to-video`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new VideoGenerationError('unknown', `Leonardo.Ai недоступний: ${(err as Error).message}`, engine.id, err);
  }

  const submitJson = (await submitRes.json().catch(() => null)) as
    | { sdGenerationJob?: { generationId?: string }; generationId?: string; error?: string }
    | null;

  if (!submitRes.ok) {
    const message = submitJson?.error || `HTTP ${submitRes.status}`;
    throw new VideoGenerationError(classifyLeonardoVideoError(submitRes.status, message), `Leonardo.Ai: ${message}`, engine.id);
  }

  const generationId = submitJson?.sdGenerationJob?.generationId || submitJson?.generationId;
  if (!generationId) {
    throw new VideoGenerationError('empty', humanVideoMessage('empty', engine.label), engine.id);
  }

  let videoUrl: string | undefined;
  for (let attempt = 0; attempt < LEONARDO_VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(LEONARDO_VIDEO_POLL_INTERVAL_MS);
    let pollRes: Response;
    try {
      pollRes = await fetch(`${leonardoConfig.baseUrl}/generations/${generationId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
    } catch (err) {
      throw new VideoGenerationError(
        'unknown',
        `Leonardo.Ai недоступний під час очікування відео: ${(err as Error).message}`,
        engine.id,
        err
      );
    }
    const pollJson = (await pollRes.json().catch(() => null)) as
      | { generations_by_pk?: Record<string, unknown> & { status?: string } }
      | null;
    if (!pollRes.ok) {
      const message = `HTTP ${pollRes.status}`;
      throw new VideoGenerationError(classifyLeonardoVideoError(pollRes.status, message), `Leonardo.Ai: ${message}`, engine.id);
    }
    const gen = pollJson?.generations_by_pk;
    if (gen?.status === 'COMPLETE') {
      videoUrl = extractVideoUrl(gen);
      if (!videoUrl) {
        // Статус готовий, а очікуваного поля з URL немає — саме той
        // непідтверджений випадок з коментаря модуля. Пишемо сиру
        // відповідь у лог сервера (не користувачу) — це єдиний спосіб
        // дізнатись справжню назву поля з першого реального виклику.
        console.error('[videoGeneration] Leonardo.Ai: статус COMPLETE, але відео не знайдено у відповіді:', JSON.stringify(gen));
        throw new VideoGenerationError(
          'unknown',
          `${engine.label}: відео згенеровано, але сервер не зміг прочитати посилання на результат (невідома форма відповіді Leonardo.Ai). Повідомлення передано в лог сервера.`,
          engine.id
        );
      }
      break;
    }
    if (gen?.status === 'FAILED') {
      throw new VideoGenerationError('unknown', `${engine.label}: генерацію відхилено (status FAILED).`, engine.id);
    }
    // PENDING — пробуємо далі.
  }

  if (!videoUrl) {
    throw new VideoGenerationError(
      'unknown',
      `${engine.label} не встиг завершити генерацію відео за відведений час (${Math.round((LEONARDO_VIDEO_POLL_MAX_ATTEMPTS * LEONARDO_VIDEO_POLL_INTERVAL_MS) / 60000)} хв). Спробуйте ще раз.`,
      engine.id
    );
  }

  let downloadRes: Response;
  try {
    downloadRes = await fetch(videoUrl);
  } catch (err) {
    throw new VideoGenerationError('unknown', `Не вдалося завантажити відео Leonardo.Ai: ${(err as Error).message}`, engine.id, err);
  }
  if (!downloadRes.ok) {
    throw new VideoGenerationError('unknown', `Не вдалося завантажити відео Leonardo.Ai (HTTP ${downloadRes.status}).`, engine.id);
  }
  const arrayBuffer = await downloadRes.arrayBuffer();
  const mimeType = downloadRes.headers.get('content-type')?.split(';')[0]?.trim() || 'video/mp4';

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType,
    engine,
    modelId: engine.leonardoModel,
    resolution,
    aspectRatio,
    durationSec,
  };
}

/** Перелік двигунів для інтерфейсу — щоб клієнт не хардкодив назви моделей. */
export function listVideoEngines(availability: { leonardo: boolean }) {
  return Object.values(VIDEO_ENGINES).map((engine) => ({
    id: engine.id,
    label: engine.label,
    provider: engine.provider,
    durationsSec: engine.durationsSec,
    defaultDurationSec: engine.defaultDurationSec,
    resolutions: engine.resolutions,
    defaultResolution: engine.defaultResolution,
    aspectRatios: engine.aspectRatios,
    defaultAspectRatio: engine.defaultAspectRatio,
    available: availability.leonardo,
  }));
}
