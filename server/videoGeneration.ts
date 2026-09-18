/**
 * Генерація відео — Leonardo.Ai Production API (задача #201, продовження
 * #199/#200: «Леонардо для фото і відео разом, повний обсяг зараз»).
 *
 * ЧОМУ ОКРЕМИЙ МОДУЛЬ, А НЕ ГІЛКА В imageGeneration.ts. Відео — інший
 * контракт результату (тривалість, роздільність замість розміру
 * зображення), інший діапазон часу очікування (документація Leonardo не
 * дає секундної оцінки для відео, як для фото — практика підказує від
 * десятків секунд до кількох хвилин) і, найголовніше, ЖОДНОГО іншого
 * провайдера, крім Leonardo, — дублювати структуру imageGeneration.ts
 * (реєстр engine.provider на 4+ гілки) заради одного провайдера означало б
 * вигадану абстракцію під фічі, яких ще нема.
 *
 * ДВА ПОКОЛІННЯ API В ОДНОМУ МОДУЛІ. Перші шість двигунів (Motion 2.0(Fast),
 * Veo3(Fast), Kling 2.1/2.5) ідуть через ЄДИНИЙ REST v1
 * `POST /generations-text-to-video`, де кожна модель має СВІЙ набір полів
 * (плоскі `resolution`/`duration`/`width`/`height`, значення `model` —
 * `MOTION2`, `VEO3`, `KLING2_1` тощо). Чотири нові двигуни (задача #202:
 * Seedance 2.5, Wan 3.0, Kling O3, FLUX 3 Video) ідуть через новіший
 * `POST /v2/generations` з ІНШОЮ формою тіла — `{model: "<vendor>/<slug>",
 * public, parameters: {...}}`, де `parameters` теж не уніфіковані між
 * моделями (Seedance взагалі не має поля роздільності — лише width/height;
 * Wan і FLUX 3 Video звуть його `resolution` зі значенням `"720p"`; Kling O3
 * зве його `mode` зі значенням `"RESOLUTION_720"`, як у v1). Тому
 * `VideoEngineInfo` — дискримінована унія `apiVersion: 'v1' | 'v2'`, а не
 * єдина плоска форма: змушувати чотири нові моделі підробляти під формат
 * перших шести означало б або вигадувати поля, яких немає в документації,
 * або губити ті, що є.
 *
 * Джерела (звірено вересень 2026, з живої документації Leonardo.Ai):
 *  - Motion 2.0 / 2.0 Fast: docs.leonardo.ai/docs/generate-with-motion-2-motion-2-fast-using-text-prompts
 *  - Veo3 / Veo3 Fast:      docs.leonardo.ai/docs/generate-with-veo3-veo3-fast-using-text-prompts
 *  - Kling 2.5 Turbo:       docs.leonardo.ai/docs/generate-with-kling-2-5-turbo-using-text-prompts
 *  - Kling 2.1 Pro:         docs.leonardo.ai/docs/kling-2-1-pro
 *  - Seedance 2.5:          docs.leonardo.ai/docs/seedance-25
 *  - Wan 3.0:               docs.leonardo.ai/docs/wan-30 (+ приклад запиту, наданий власником напряму)
 *  - Kling O3:               docs.leonardo.ai/docs/kling-o3 (+ приклад запиту, наданий власником напряму)
 *  - FLUX 3 Video:          docs.leonardo.ai/docs/flux-3-video (+ приклад запиту, наданий власником напряму)
 *
 * СВІДОМО НЕПІДТВЕРДЖЕНО (задокументовано, а не замовчано):
 *  - Форма ВІДПОВІДІ на опитування статусу для ОБОХ поколінь API.
 *    Документація не показує приклад відповіді ні для v1-, ні для
 *    v2-відеозавдань (лише для v1-фото: `generations_by_pk.generated_images`).
 *    Опитування v1-двигунів іде на `GET /generations/{id}`; для
 *    v2-двигунів — на `GET /v2/generations/{id}` (та сама логіка версій, що
 *    й у POST) — жодна з двох гілок офіційно не задокументована для відео.
 *    Результат читається з кількох правдоподібних шляхів і форм обгортки
 *    (`generations_by_pk.generated_videos[0].url` насамперед, потім кілька
 *    запасних) — якщо жоден не знайдено, кидається чітка помилка замість
 *    мовчазного падіння. Перше ж реальне звернення з ключем адміністратора
 *    або підтвердить це, або покаже точну назву поля — тоді значення поля
 *    стане одним рядком-правкою, а не переписуванням. Для v2 це РИЗИКОВАНІШЕ
 *    за v1, бо взагалі ЖОДНОГО підтвердження форми відповіді (навіть для
 *    фото) в документації не знайдено — лише форма ЗАПИТУ.
 *  - Офіційний FAQ Leonardo (`docs.leonardo.ai/docs/api-faq`) прямо радить
 *    НЕ опитувати статус, а підписатись на webhook. Тут лишено опитування —
 *    той самий свідомий компроміс, що й для фото (generateWithLeonardo() у
 *    imageGeneration.ts), тільки РИЗИКОВАНІШИЙ: відео документовано довше за
 *    фото, а HTTP-запит просто «висить» ці хвилини. Повноцінна відповідь —
 *    фонова черга завдань і webhook-колбек — свідомо поза межами цієї
 *    задачі.
 *  - Референсні зображення/відео (`guidances.start_frame`/`end_frame`/
 *    `image_reference`/`video_reference_base` — усі чотири нові моделі їх
 *    документують) НЕ підключені: потребують Leonardo-нативного `imageId`,
 *    а крок «завантажити своє зображення в Leonardo» (`imageType:
 *    'UPLOADED'`) лишається непідтвердженим — той самий свідомий виняток,
 *    що вже є для перших шести двигунів.
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
  | 'leonardo-kling2-5'
  | 'leonardo-seedance-2-5'
  | 'leonardo-wan-3'
  | 'leonardo-kling-o3'
  | 'leonardo-flux-3-video';

export type VideoResolutionTier = '480' | '720' | '1080';
export type VideoAspectRatio = '16:9' | '9:16' | '1:1';

interface VideoEngineBase {
  id: VideoEngineId;
  label: string;
  provider: 'leonardo';
  resolutions: readonly VideoResolutionTier[];
  defaultResolution: VideoResolutionTier;
  aspectRatios: readonly VideoAspectRatio[];
  defaultAspectRatio: VideoAspectRatio;
}

/** Перші шість двигунів — REST v1, `POST /generations-text-to-video`. */
export interface V1VideoEngineInfo extends VideoEngineBase {
  apiVersion: 'v1';
  /** Точне значення поля `model` у тілі запиту (docs.leonardo.ai, вересень 2026). */
  leonardoModel: string;
  /** null — Leonardo не документує вибір тривалості для цієї моделі, поле `duration` не надсилається. */
  durationsSec: number[] | null;
  defaultDurationSec: number | null;
}

/**
 * Нові чотири двигуни (задача #202) — REST v2, `POST /v2/generations`,
 * тіло `{model, public, parameters}`. На відміну від v1, тривалість тут
 * документована як БЕЗПЕРЕРВНИЙ діапазон (наприклад, Seedance 2.5 —
 * «4–30 секунд, цілими кроками»), а не перелік — тому `durationMinSec`/
 * `durationMaxSec`, а не масив.
 */
export interface V2VideoEngineInfo extends VideoEngineBase {
  apiVersion: 'v2';
  /** Рядок вендора/моделі в полі `model` тіла запиту, напр. "bytedance/seedance-2.5". */
  modelSlug: string;
  durationMinSec: number;
  durationMaxSec: number;
  defaultDurationSec: number;
  /**
   * Кожна v2-модель зве поле роздільності по-своєму (або не має його
   * взагалі) — звідси явний дескриптор замість єдиної форматуючої функції.
   * null — лише `width`/`height`, без окремого поля роздільності (Seedance 2.5).
   */
  resolutionField: null | { key: 'resolution'; format: (tier: VideoResolutionTier) => string } | { key: 'mode'; format: (tier: VideoResolutionTier) => string };
  /** Усі чотири підтверджені моделі приймають лише `quantity: 1` — тому прапорець, не діапазон. */
  supportsQuantity: boolean;
}

export type VideoEngineInfo = V1VideoEngineInfo | V2VideoEngineInfo;

export const VIDEO_ENGINES: Record<VideoEngineId, VideoEngineInfo> = {
  'leonardo-motion2': {
    apiVersion: 'v1',
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
    apiVersion: 'v1',
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
    apiVersion: 'v1',
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
    apiVersion: 'v1',
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
    apiVersion: 'v1',
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
    apiVersion: 'v1',
    id: 'leonardo-kling2-5',
    label: 'Kling 2.5 Turbo (через Leonardo.Ai)',
    provider: 'leonardo',
    leonardoModel: 'KLING2_5',
    durationsSec: [5, 10],
    defaultDurationSec: 5,
    resolutions: ['1080'],
    defaultResolution: '1080',
    // Єдина з перших шести моделей, де документація прямо показує ще й 1:1 (1440×1440).
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
  },

  // -- Задача #202: REST v2, POST /v2/generations ---------------------------

  'leonardo-seedance-2-5': {
    apiVersion: 'v2',
    id: 'leonardo-seedance-2-5',
    label: 'Seedance 2.5 (ByteDance, через Leonardo.Ai)',
    provider: 'leonardo',
    modelSlug: 'bytedance/seedance-2.5',
    // docs.leonardo.ai/docs/seedance-25: "duration: 4–30 seconds (whole increments)".
    durationMinSec: 4,
    durationMaxSec: 30,
    defaultDurationSec: 8,
    // Документація явно каже: лише `width`/`height` (за замовчуванням
    // 1280×720), окремого поля роздільності чи таблиці інших тарифів НЕМАЄ —
    // тому єдина пропонована роздільність/пропорція, а не вигадана друга.
    resolutions: ['720'],
    defaultResolution: '720',
    aspectRatios: ['16:9'],
    defaultAspectRatio: '16:9',
    resolutionField: null,
    supportsQuantity: true,
  },
  'leonardo-wan-3': {
    apiVersion: 'v2',
    id: 'leonardo-wan-3',
    label: 'Wan 3.0 (Alibaba, через Leonardo.Ai)',
    provider: 'leonardo',
    modelSlug: 'alibaba/wan-3.0',
    // docs.leonardo.ai/docs/wan-30: "duration: 2-30 (default: 5)".
    durationMinSec: 2,
    durationMaxSec: 30,
    defaultDurationSec: 5,
    // "resolution: 480p/720p/1080p (default 480p)" — той самий набір тарифів,
    // що й у наших VideoResolutionTier, тому пікселі беремо зі спільної
    // pixelDims(), а не вигадуємо окрему таблицю.
    resolutions: ['480', '720', '1080'],
    defaultResolution: '480',
    // Документація згадує ще й 4:3/3:4 — точних пікселів під них ніде не
    // наведено (лише «дивись таблицю пропорцій»), тому свідомо НЕ додаємо:
    // краще менший, але підтверджений список.
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
    resolutionField: { key: 'resolution', format: (tier) => `${tier}p` },
    supportsQuantity: true,
  },
  'leonardo-kling-o3': {
    apiVersion: 'v2',
    id: 'leonardo-kling-o3',
    label: 'Kling O3 (через Leonardo.Ai)',
    provider: 'leonardo',
    modelSlug: 'kling-video-o-3',
    // docs.leonardo.ai/docs/kling-o3: "duration: 3 to 15 (or max 10 seconds
    // with video reference)" — верхню межу з відео-референсом не рахуємо:
    // відео-референс (guidances.video_reference_base) тут не підключено.
    durationMinSec: 3,
    durationMaxSec: 15,
    defaultDurationSec: 5,
    // "mode: RESOLUTION_720 or RESOLUTION_1080" + таблиця пікселів
    // (1280×720/960×960/720×1280 та 1920×1080/1440×1440/1080×1920) —
    // ТОЧНО ті самі пари, що вже дає pixelDims() для 16:9/1:1/9:16.
    resolutions: ['720', '1080'],
    defaultResolution: '720',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
    resolutionField: { key: 'mode', format: (tier) => `RESOLUTION_${tier}` },
    supportsQuantity: false,
  },
  'leonardo-flux-3-video': {
    apiVersion: 'v2',
    id: 'leonardo-flux-3-video',
    label: 'FLUX 3 Video (Black Forest Labs, через Leonardo.Ai)',
    provider: 'leonardo',
    modelSlug: 'bfl/flux-3-video',
    // docs.leonardo.ai/docs/flux-3-video: "duration: 5-20 seconds (default 8)".
    durationMinSec: 5,
    durationMaxSec: 20,
    defaultDurationSec: 8,
    // "resolution: 720p, 1080p (default 720p)".
    resolutions: ['720', '1080'],
    defaultResolution: '720',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
    resolutionField: { key: 'resolution', format: (tier) => `${tier}p` },
    supportsQuantity: true,
  },
};

export const DEFAULT_VIDEO_ENGINE: VideoEngineId = 'leonardo-motion2';

export function resolveVideoEngine(requested?: string): VideoEngineInfo {
  if (requested && requested in VIDEO_ENGINES) {
    return VIDEO_ENGINES[requested as VideoEngineId];
  }
  return VIDEO_ENGINES[DEFAULT_VIDEO_ENGINE];
}

/** `model`(v1)/`modelSlug`(v2) в одному місці — щоб виклики поза модулем (aiCore.ts) не розгалужували apiVersion самі. */
export function engineModelId(engine: VideoEngineInfo): string {
  return engine.apiVersion === 'v1' ? engine.leonardoModel : engine.modelSlug;
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

/** v1 — тривалість лише з переліку (або взагалі не надсилається). */
function normalizeV1Duration(engine: V1VideoEngineInfo, requested?: number): number | null {
  if (engine.durationsSec === null) return null;
  if (typeof requested === 'number' && engine.durationsSec.includes(requested)) return requested;
  return engine.defaultDurationSec;
}

/** v2 — тривалість документована як діапазон, а не перелік (напр. Seedance 2.5: «4–30с»). */
function normalizeV2Duration(engine: V2VideoEngineInfo, requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    const rounded = Math.round(requested);
    if (rounded >= engine.durationMinSec && rounded <= engine.durationMaxSec) return rounded;
  }
  return engine.defaultDurationSec;
}

/**
 * Пікселі під пару (роздільність, співвідношення сторін). Базові пари —
 * ТОЧНО ті, що документація показує для 16:9 (832×480 / 1280×720 /
 * 1920×1080 — останню пару незалежно підтверджують і Kling 2.1, і Kling O3,
 * і Wan 3.0); 9:16 — ті самі числа, сторони поміняно місцями (підтверджено
 * явно для Kling — для решти усталений і безпечний прийом); 1:1 —
 * підтверджена пара 1440×1440 (Kling 2.5, Kling O3 і таблиця пропорцій Wan
 * 3.0/FLUX 3 Video її показують).
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
/** ~6 хвилин (72 × 5с) — запас під найповільніші відомі варіанти (1080p/10-20с). */
const LEONARDO_VIDEO_POLL_MAX_ATTEMPTS = 72;

/**
 * Базовий URL v2 API — похідний від leonardoConfig.baseUrl (звичайно
 * закінчується на `/v1`), а не окрема змінна оточення за замовчуванням:
 * той самий ключ і той самий хост обслуговують обидва покоління API,
 * різниться лише сегмент версії в шляху (підтверджено прикладами запитів
 * від власника — усі на `/api/rest/v2/generations`). LEONARDO_V2_BASE_URL
 * лишається аварійним перемикачем, як і LEONARDO_BASE_URL для v1.
 */
const LEONARDO_V2_BASE_URL = (
  process.env.LEONARDO_V2_BASE_URL ||
  (leonardoConfig.baseUrl.endsWith('/v1') ? leonardoConfig.baseUrl.replace(/\/v1$/, '/v2') : `${leonardoConfig.baseUrl}/../v2`)
).replace(/\/+$/, '');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Дістає URL готового відео з відповіді опитування. Форма відповіді НЕ
 * підтверджена документацією для жодного з двох поколінь API (див.
 * коментар модуля) — тому перевіряємо кілька правдоподібних шляхів і форм
 * обгортки замість одної, і кидаємо чітку помилку, якщо жоден не
 * спрацював, а не падаємо на `undefined`.
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
  if (typeof gen.url === 'string') return gen.url;
  return undefined;
}

/**
 * Читає статус/дані завдання з відповіді опитування — форма обгортки не
 * підтверджена ні для v1, ні тим паче для v2 (у v1 фото це
 * `generations_by_pk`, для відео нізвідки не підтверджено, для v2 не
 * підтверджено взагалі нічого). Пробуємо стандартну v1-обгортку, а якщо
 * її немає — сам верхній рівень відповіді як плаский обʼєкт.
 */
function extractGenerationStatus(json: unknown): (Record<string, unknown> & { status?: string }) | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const wrapped = (json as Record<string, unknown>).generations_by_pk;
  if (wrapped && typeof wrapped === 'object') return wrapped as Record<string, unknown> & { status?: string };
  return json as Record<string, unknown> & { status?: string };
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

/**
 * Спільний хвіст пайплайну для обох поколінь API: відправлення вже готове
 * (тіло і URL — різні для v1/v2, будуються в generateVideo() нижче), а
 * опитування статусу й завантаження готового файлу — та сама логіка
 * незалежно від того, яким запитом завдання було створено.
 */
async function submitPollAndDownload(
  engine: VideoEngineInfo,
  apiKey: string,
  submitUrl: string,
  pollBaseUrl: string,
  body: Record<string, unknown>
): Promise<{ buffer: Buffer; mimeType: string }> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  let submitRes: Response;
  try {
    submitRes = await fetch(submitUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (err) {
    throw new VideoGenerationError('unknown', `Leonardo.Ai недоступний: ${(err as Error).message}`, engine.id, err);
  }

  const submitJson = (await submitRes.json().catch(() => null)) as
    | { sdGenerationJob?: { generationId?: string }; generationId?: string; id?: string; error?: string }
    | null;

  if (!submitRes.ok) {
    const message = submitJson?.error || `HTTP ${submitRes.status}`;
    throw new VideoGenerationError(classifyLeonardoVideoError(submitRes.status, message), `Leonardo.Ai: ${message}`, engine.id);
  }

  // v1 повертає generationId у sdGenerationJob; форма v2-відповіді не
  // підтверджена документацією — пробуємо ті самі шляхи й додатково
  // голий `id` (типовий для REST-створення ресурсу).
  const generationId = submitJson?.sdGenerationJob?.generationId || submitJson?.generationId || submitJson?.id;
  if (!generationId) {
    throw new VideoGenerationError('empty', humanVideoMessage('empty', engine.label), engine.id);
  }

  let videoUrl: string | undefined;
  for (let attempt = 0; attempt < LEONARDO_VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(LEONARDO_VIDEO_POLL_INTERVAL_MS);
    let pollRes: Response;
    try {
      pollRes = await fetch(`${pollBaseUrl}/generations/${generationId}`, {
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
    if (!pollRes.ok) {
      const message = `HTTP ${pollRes.status}`;
      throw new VideoGenerationError(classifyLeonardoVideoError(pollRes.status, message), `Leonardo.Ai: ${message}`, engine.id);
    }
    const pollJson = await pollRes.json().catch(() => null);
    const gen = extractGenerationStatus(pollJson);
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
    // PENDING (або будь-який інший непідтверджений «ще не готово» статус) — пробуємо далі.
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
  return { buffer: Buffer.from(arrayBuffer), mimeType };
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
  const { width, height } = pixelDims(resolution, aspectRatio);
  const prompt = options.prompt.trim().slice(0, 1500); // та сама межа промпту, що й у фото-двигуні Leonardo.

  let durationSec: number | null;
  let downloaded: { buffer: Buffer; mimeType: string };

  if (engine.apiVersion === 'v1') {
    durationSec = normalizeV1Duration(engine, options.durationSec);
    const body: Record<string, unknown> = {
      prompt,
      model: engine.leonardoModel,
      resolution: `RESOLUTION_${resolution}`,
      width,
      height,
      isPublic: false,
    };
    if (durationSec !== null) body.duration = durationSec;
    downloaded = await submitPollAndDownload(engine, apiKey, `${leonardoConfig.baseUrl}/generations-text-to-video`, leonardoConfig.baseUrl, body);
  } else {
    durationSec = normalizeV2Duration(engine, options.durationSec);
    const parameters: Record<string, unknown> = {
      prompt,
      duration: durationSec,
      width,
      height,
      motion_has_audio: true,
    };
    if (engine.resolutionField) parameters[engine.resolutionField.key] = engine.resolutionField.format(resolution);
    if (engine.supportsQuantity) parameters.quantity = 1;
    const body: Record<string, unknown> = { model: engine.modelSlug, public: false, parameters };
    downloaded = await submitPollAndDownload(engine, apiKey, `${LEONARDO_V2_BASE_URL}/generations`, LEONARDO_V2_BASE_URL, body);
  }

  return {
    buffer: downloaded.buffer,
    mimeType: downloaded.mimeType,
    engine,
    modelId: engineModelId(engine),
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
    apiVersion: engine.apiVersion,
    durationsSec: engine.apiVersion === 'v1' ? engine.durationsSec : null,
    defaultDurationSec: engine.apiVersion === 'v1' ? engine.defaultDurationSec : engine.defaultDurationSec,
    durationMinSec: engine.apiVersion === 'v2' ? engine.durationMinSec : null,
    durationMaxSec: engine.apiVersion === 'v2' ? engine.durationMaxSec : null,
    resolutions: engine.resolutions,
    defaultResolution: engine.defaultResolution,
    aspectRatios: engine.aspectRatios,
    defaultAspectRatio: engine.defaultAspectRatio,
    available: availability.leonardo,
  }));
}
