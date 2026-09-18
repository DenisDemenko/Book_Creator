/**
 * Leonardo.Ai v2 API — фото-двигуни з нативною підтримкою референсних
 * зображень (задача #203).
 *
 * Контекст: єдиний двигун 'leonardo' у server/imageGeneration.ts працює
 * через СТАРИЙ v1 API (`POST /v1/generations`, плоский модельний UUID,
 * без референсів) і безумовно відхиляє запит із референсними
 * зображеннями («Двигун Leonardo.Ai поки не підтримує референсні
 * зображення»). Автор повідомив, що це повідомлення ВВОДИТЬ В ОМАНУ:
 * Leonardo підтримує референсне генерування, просто через НОВІШИЙ v2 API
 * (`POST /v2/generations`, модель — рядок `vendor/slug`, а не UUID) і не
 * для КОЖНОЇ моделі — лише для конкретних. Автор навів скриншот власного
 * випадаючого списку Leonardo (Photo Generation) і 6 конкретних моделей
 * із прямими посиланнями на документацію. Цей модуль підключає рівно ці
 * 6 моделей — старий v1-двигун 'leonardo' лишається без змін (він і
 * справді не підтримує референсів), лише його повідомлення про відмову
 * тепер підказує саме ці 6 нових пунктів замість голого «оберіть інший
 * двигун».
 *
 * Джерела (усі — docs.leonardo.ai, звірено вересень 2026):
 *   • GPT Image 2.5 Flare    — /docs/gpt-image-25-flare
 *   • GPT Image 2.5 Sunburst — /docs/gpt-image-25-sunburst
 *   • Nano Banana 2 Lite     — /docs/nano-banana-2-lite
 *   • Seedream 4.5           — /docs/seedream-4-5
 *   • Seedream 5.0 Pro       — /docs/seedream-50-pro
 *   • FLUX Dev               — /docs/flux-dev
 *   • Завантаження референсу — /docs/how-to-upload-an-image-using-a-presigned-url
 *     та /reference/uploadinitimage (POST /v1/init-image → presigned S3 POST
 *     → id референсу для guidances.image_reference[].image.id).
 *
 * ВАЖЛИВО — розбіжність із запитом автора: автор попросив «один чи до 12
 * штук» референсів для ВСІХ 6 моделей. Реальні задокументовані межі різні
 * й НЕ дорівнюють 12 для жодної моделі:
 *   • GPT Image 2.5 Flare / Sunburst — до 16 (guidances.image_reference);
 *   • Nano Banana 2 Lite / Seedream 4.5 — до 6;
 *   • Seedream 5.0 Pro — до 10;
 *   • FLUX Dev — СТРУКТУРНО інша схема (guidances.content, макс. 1, +
 *     guidances.style, макс. 1 — разом 2, а не масив «до N»).
 * Тут узято РЕАЛЬНІ задокументовані межі кожної моделі, а не універсальні
 * «12» — видавати можливість завантажити 12 референсів моделі, що
 * приймає лише 2 чи 6, означало б мовчки провалювати запит на кроці
 * Leonardo, а не тут.
 *
 * Що НЕ підтверджено документацією і тому НЕ використано:
 *   • `type: "URL"` / `type: "BASE64"` у guidances.image_reference[].image —
 *     ці значення enum згадані в схемі GPT Image 2.5 Flare/Sunburst, але
 *     жоден приклад запиту не показує, що саме тоді містить поле `id`
 *     (сирий URL? base64-рядок?) — покладатися на це означало б
 *     вгадувати формат наосліп. Натомість використано задокументований і
 *     показаний прикладами шлях: POST /v1/init-image → presigned S3 →
 *     id, з type:"UPLOADED" — той самий, що й офіційний Python SDK.
 *   • Точна форма відповіді статусу для v2-опитування (generations_by_pk
 *     чи без обгортки) — як і в server/videoGeneration.ts (#202),
 *     перевіряються обидва варіанти (extractGenerationRecord нижче).
 *   • quantity > 1 за один виклик — Leonardo дозволяє (1-8 залежно від
 *     моделі), але generateImage() у imageGeneration.ts повертає РІВНО
 *     одне зображення на виклик для всіх двигунів; лишено так само й
 *     тут (quantity:1), щоб не ламати цей контракт.
 *   • output_format (jpeg/png) для Seedream 5.0 Pro — документований, але
 *     не підключений: engine.supportsFormatChoice лишено false, щоб не
 *     обіцяти перемикач, який ніде не зчитується.
 */

import type { SupportedRatio } from './imageGeneration';
import { extractLeonardoV2ValidationMessage } from './imageGeneration';

export type LeonardoV2ImageErrorKind = 'no_key' | 'safety' | 'quota' | 'empty' | 'unknown';

export class LeonardoV2PhotoError extends Error {
  kind: LeonardoV2ImageErrorKind;
  cause?: unknown;
  constructor(kind: LeonardoV2ImageErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'LeonardoV2PhotoError';
    this.kind = kind;
    this.cause = cause;
  }
}

/** Ідентифікатори 6 нових фото-двигунів (додаються до ImageEngineId у imageGeneration.ts). */
export type LeonardoPhotoEngineId =
  | 'leonardo-gpt-image-25-flare'
  | 'leonardo-gpt-image-25-sunburst'
  | 'leonardo-nano-banana-2-lite'
  | 'leonardo-seedream-4-5'
  | 'leonardo-seedream-5-pro'
  | 'leonardo-flux-dev';

/**
 * Форма референсної підтримки. `image_reference` — масив «до N» штук
 * (більшість моделей); `content_style` — окрема схема FLUX Dev: макс. 1
 * контент-референс + макс. 1 стиль-референс (разом 2), інші поля.
 */
export type LeonardoReferenceCapability =
  | { kind: 'image_reference'; maxCount: number; supportsStrength: boolean }
  | { kind: 'content_style' };

export type LeonardoDimensionRule =
  | { kind: 'list'; values: readonly number[] }
  | { kind: 'range'; min: number; max: number; step: number };

export interface LeonardoV2PhotoSpec {
  modelSlug: string;
  dimensions: LeonardoDimensionRule;
  /** Довша сторона за замовчуванням (до приведення під аспект і межі моделі). */
  defaultLongSide: number;
  reference: LeonardoReferenceCapability;
  sourceDoc: string;
}

export const LEONARDO_V2_PHOTO_SPECS: Record<LeonardoPhotoEngineId, LeonardoV2PhotoSpec> = {
  'leonardo-gpt-image-25-flare': {
    modelSlug: 'openai/gpt-image-2.5-flare',
    dimensions: { kind: 'list', values: [768, 848, 896, 928, 1024, 1152, 1200, 1264, 1376] },
    defaultLongSide: 1024,
    reference: { kind: 'image_reference', maxCount: 16, supportsStrength: false },
    sourceDoc: 'https://docs.leonardo.ai/docs/gpt-image-25-flare',
  },
  'leonardo-gpt-image-25-sunburst': {
    modelSlug: 'openai/gpt-image-2.5-sunburst',
    dimensions: { kind: 'list', values: [768, 848, 896, 928, 1024, 1152, 1200, 1264, 1376] },
    defaultLongSide: 1024,
    reference: { kind: 'image_reference', maxCount: 16, supportsStrength: false },
    sourceDoc: 'https://docs.leonardo.ai/docs/gpt-image-25-sunburst',
  },
  'leonardo-nano-banana-2-lite': {
    // Не плутати з ГУГЛІВСЬКИМ 'nano-banana-2-lite' у IMAGE_ENGINES
    // (gemini-3.1-flash-lite-image) — та сама НАЗВА моделі, але цілком
    // інший провайдер/API/ключ; тому ярлик у панелі підписаний
    // «(через Leonardo.Ai)», а engine id тут — з префіксом 'leonardo-'.
    modelSlug: 'nano-banana-2-lite',
    dimensions: { kind: 'list', values: [768, 848, 896, 928, 1024, 1152, 1200, 1264, 1376] },
    defaultLongSide: 1024,
    reference: { kind: 'image_reference', maxCount: 6, supportsStrength: true },
    sourceDoc: 'https://docs.leonardo.ai/docs/nano-banana-2-lite',
  },
  'leonardo-seedream-4-5': {
    // Ширина/висота 256-1440 задокументовані як діапазон; крок (8px) НЕ
    // підтверджений документацією — узятий за аналогією з FLUX Dev
    // (єдина модель у цій шістці, де крок 8 підтверджено прямим текстом)
    // і з усталеною для дифузійних моделей практикою. Якщо Leonardo
    // насправді приймає довільні пікселі, округлення до кратних 8 просто
    // трохи звужує вибір, а не ламає запит.
    modelSlug: 'seedream-4.5',
    dimensions: { kind: 'range', min: 256, max: 1440, step: 8 },
    defaultLongSide: 1024,
    reference: { kind: 'image_reference', maxCount: 6, supportsStrength: true },
    sourceDoc: 'https://docs.leonardo.ai/docs/seedream-4-5',
  },
  'leonardo-seedream-5-pro': {
    modelSlug: 'seedream-5.0-pro',
    dimensions: { kind: 'range', min: 768, max: 2048, step: 8 },
    // Документований дефолт моделі — саме 2048×2048 (не 1024, як решта
    // цієї шістки) — навмисно лишено як defaultLongSide.
    defaultLongSide: 2048,
    reference: { kind: 'image_reference', maxCount: 10, supportsStrength: true },
    sourceDoc: 'https://docs.leonardo.ai/docs/seedream-50-pro',
  },
  'leonardo-flux-dev': {
    modelSlug: 'flux-dev',
    dimensions: { kind: 'range', min: 480, max: 2048, step: 8 },
    defaultLongSide: 1024,
    reference: { kind: 'content_style' },
    sourceDoc: 'https://docs.leonardo.ai/docs/flux-dev',
  },
};

/** Реальна межа референсів для моделі (2 для FLUX Dev — не «до N», а рівно content+style). */
export function leonardoV2PhotoMaxReferences(spec: LeonardoV2PhotoSpec): number {
  return spec.reference.kind === 'content_style' ? 2 : spec.reference.maxCount;
}

function snapToList(value: number, values: readonly number[]): number {
  let best = values[0];
  let bestDelta = Math.abs(values[0] - value);
  for (const v of values) {
    const delta = Math.abs(v - value);
    if (delta < bestDelta) {
      best = v;
      bestDelta = delta;
    }
  }
  return best;
}

function clampToRange(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round(clamped / step) * step;
}

/** Ширина/висота під конкретну модель Leonardo v2 з обраного співвідношення сторін. */
export function leonardoV2PhotoDims(
  spec: LeonardoV2PhotoSpec,
  aspectRatio: SupportedRatio
): { width: number; height: number } {
  const [rw, rh] = aspectRatio.split(':').map(Number);
  const longSide = spec.defaultLongSide;
  const shortSideIdeal = (longSide * Math.min(rw, rh)) / Math.max(rw, rh);
  let width: number;
  let height: number;
  if (rw >= rh) {
    width = longSide;
    height = shortSideIdeal;
  } else {
    height = longSide;
    width = shortSideIdeal;
  }
  if (spec.dimensions.kind === 'list') {
    width = snapToList(width, spec.dimensions.values);
    height = snapToList(height, spec.dimensions.values);
  } else {
    width = clampToRange(width, spec.dimensions.min, spec.dimensions.max, spec.dimensions.step);
    height = clampToRange(height, spec.dimensions.min, spec.dimensions.max, spec.dimensions.step);
  }
  return { width, height };
}

/** Базовий URL v1 (init-image завантаження живе лише тут, незалежно від того, якою версією API йде сама генерація). */
const LEONARDO_V1_BASE_URL = (
  process.env.LEONARDO_BASE_URL || 'https://cloud.leonardo.ai/api/rest/v1'
).replace(/\/+$/, '');

/**
 * Базовий URL v2 — той самий принцип, що й server/videoGeneration.ts:
 * Leonardo документує v2 як `/api/rest/v2/generations` (той самий хост,
 * інший префікс версії), тож замінюємо хвіст `/v1` на `/v2`, а не
 * вигадуємо окрему змінну оточення за замовчуванням.
 */
const LEONARDO_V2_BASE_URL = (
  process.env.LEONARDO_V2_BASE_URL || LEONARDO_V1_BASE_URL.replace(/\/v1$/, '/v2')
).replace(/\/+$/, '');

function classifyLeonardoV2Error(status: number, message: string): LeonardoV2ImageErrorKind {
  if (status === 401 || status === 403) return 'no_key';
  if (status === 429) return 'quota';
  const m = message.toLowerCase();
  if (m.includes('safety') || m.includes('moderation') || m.includes('nsfw') || m.includes('blocked')) return 'safety';
  if (m.includes('quota') || m.includes('rate limit') || m.includes('credit')) return 'quota';
  return 'unknown';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 48; // ~2 хвилини, той самий запас, що й у v1-фото та v2-відео.

function extFromContentType(ct: string | null): 'png' | 'jpg' | 'jpeg' | 'webp' {
  const t = (ct || '').toLowerCase();
  if (t.includes('webp')) return 'webp';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  return 'png';
}

/**
 * Завантажує ОДНЕ референсне зображення в Leonardo й повертає його id
 * (для guidances.image_reference[].image.id, type:"UPLOADED").
 * Кроки — підтверджені офіційним гайдом і Python SDK (див. коментар
 * модуля): POST /init-image → presigned S3 POST → id.
 */
export async function uploadReferenceImage(apiKey: string, imageUrl: string): Promise<string> {
  let sourceRes: Response;
  try {
    sourceRes = await fetch(imageUrl);
  } catch (err) {
    throw new LeonardoV2PhotoError(
      'unknown',
      `Не вдалося завантажити референсне зображення для Leonardo.Ai: ${(err as Error).message}`,
      err
    );
  }
  if (!sourceRes.ok) {
    throw new LeonardoV2PhotoError('unknown', `Не вдалося завантажити референсне зображення (HTTP ${sourceRes.status}).`);
  }
  const bytes = Buffer.from(await sourceRes.arrayBuffer());
  const extension = extFromContentType(sourceRes.headers.get('content-type'));

  let initRes: Response;
  try {
    initRes = await fetch(`${LEONARDO_V1_BASE_URL}/init-image`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ extension }),
    });
  } catch (err) {
    throw new LeonardoV2PhotoError('unknown', `Leonardo.Ai (init-image) недоступний: ${(err as Error).message}`, err);
  }
  const initJson = (await initRes.json().catch(() => null)) as
    | { uploadInitImage?: { id?: string; url?: string; fields?: string }; error?: string }
    | null;
  if (!initRes.ok) {
    const message = initJson?.error || `HTTP ${initRes.status}`;
    throw new LeonardoV2PhotoError(classifyLeonardoV2Error(initRes.status, message), `Leonardo.Ai (init-image): ${message}`);
  }
  const uploadInit = initJson?.uploadInitImage;
  if (!uploadInit?.id || !uploadInit.url || !uploadInit.fields) {
    throw new LeonardoV2PhotoError('empty', 'Leonardo.Ai не повернув дані для завантаження референсного зображення.');
  }

  let parsedFields: Record<string, string>;
  try {
    parsedFields = JSON.parse(uploadInit.fields);
  } catch (err) {
    throw new LeonardoV2PhotoError('unknown', 'Leonardo.Ai: пошкоджені дані presigned-завантаження референсу.', err);
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(parsedFields)) {
    form.append(key, value);
  }
  form.append('file', new Blob([bytes]), `reference.${extension}`);

  let uploadRes: Response;
  try {
    uploadRes = await fetch(uploadInit.url, { method: 'POST', body: form });
  } catch (err) {
    throw new LeonardoV2PhotoError('unknown', `Не вдалося передати референсне зображення в Leonardo.Ai: ${(err as Error).message}`, err);
  }
  if (!uploadRes.ok) {
    throw new LeonardoV2PhotoError('unknown', `Leonardo.Ai відхилив завантаження референсного зображення (HTTP ${uploadRes.status}).`);
  }

  return uploadInit.id;
}

/** Будує guidances під конкретну модель з уже завантажених id-референсів. */
function buildGuidances(spec: LeonardoV2PhotoSpec, uploadedIds: string[]): Record<string, unknown> | undefined {
  if (uploadedIds.length === 0) return undefined;
  if (spec.reference.kind === 'image_reference') {
    return {
      image_reference: uploadedIds.map((id) => ({
        image: { id, type: 'UPLOADED' },
        ...(spec.reference.kind === 'image_reference' && spec.reference.supportsStrength ? { strength: 'MID' } : {}),
      })),
    };
  }
  // FLUX Dev: перший референс — content (композиція), другий (якщо є) — style.
  const guidances: Record<string, unknown> = {};
  if (uploadedIds[0]) {
    guidances.content = [{ image: { id: uploadedIds[0], type: 'UPLOADED' }, strength: 'MID' }];
  }
  if (uploadedIds[1]) {
    guidances.style = [{ image: { id: uploadedIds[1], type: 'UPLOADED' }, strength: 'MID' }];
  }
  return guidances;
}

function extractGenerationRecord(json: unknown): (Record<string, unknown> & { status?: string }) | undefined {
  const root = json as { generations_by_pk?: Record<string, unknown>; status?: string } | null;
  if (root?.generations_by_pk) return root.generations_by_pk as Record<string, unknown> & { status?: string };
  if (root?.status) return root as Record<string, unknown> & { status?: string };
  return undefined;
}

/**
 * Id генерації з відповіді НА ВІДПРАВЛЕННЯ (submit) — окремо від
 * extractGenerationRecord() вище, бо відповідь на submit не завжди має
 * поле `status` (лише генерований id), тож вимагати status тут means
 * помилково відкидати РОБОЧУ відповідь без нього.
 */
function extractSubmittedGenerationId(json: unknown): string | undefined {
  const root = json as
    | { generations_by_pk?: { id?: string; generationId?: string }; id?: string; generationId?: string; sdGenerationJob?: { generationId?: string } }
    | null;
  return (
    root?.generations_by_pk?.id ||
    root?.generations_by_pk?.generationId ||
    root?.id ||
    root?.generationId ||
    root?.sdGenerationJob?.generationId
  );
}

function extractImageUrl(gen: Record<string, unknown>): string | undefined {
  const images = (gen.generated_images || gen.generatedImages || gen.images) as { url?: string }[] | undefined;
  return images?.[0]?.url || (gen.url as string | undefined);
}

export interface GenerateLeonardoV2PhotoOptions {
  engineId: LeonardoPhotoEngineId;
  apiKey: string;
  prompt: string;
  aspectRatio: SupportedRatio;
  referenceImageUrls?: string[];
}

/**
 * Генерує одне фото одним із 6 v2-двигунів Leonardo. Та сама асинхронна
 * схема submit → poll → download, що й v1-фото/v2-відео в цьому проєкті —
 * решта пайплайну (generateImage(), збереження файлу, лог витрат) не
 * знає й не має знати, що ця версія API інша.
 */
export async function generateLeonardoV2Photo(
  options: GenerateLeonardoV2PhotoOptions
): Promise<{ buffer: Buffer; mimeType: string }> {
  const spec = LEONARDO_V2_PHOTO_SPECS[options.engineId];
  const refUrls = options.referenceImageUrls || [];
  const maxRefs = leonardoV2PhotoMaxReferences(spec);
  if (refUrls.length > maxRefs) {
    throw new LeonardoV2PhotoError('unknown', `Занадто багато референсних зображень: максимум ${maxRefs}.`);
  }

  // Завантажуємо референси ПОСЛІДОВНО (не Promise.all) — кожен виклик
  // init-image видає ОДНОРАЗОВИЙ presigned URL з обмеженим часом дії;
  // паралельні запити не дають виграшу, який виправдав би ризик
  // впертись уліміт одночасних завантажень на акаунт.
  const uploadedIds: string[] = [];
  for (const url of refUrls) {
    uploadedIds.push(await uploadReferenceImage(options.apiKey, url));
  }

  const { width, height } = leonardoV2PhotoDims(spec, options.aspectRatio);
  const guidances = buildGuidances(spec, uploadedIds);

  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  let submitRes: Response;
  try {
    submitRes = await fetch(`${LEONARDO_V2_BASE_URL}/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: spec.modelSlug,
        public: false,
        parameters: {
          prompt: options.prompt.slice(0, 1500),
          quantity: 1,
          width,
          height,
          // Задача #206: НЕ надсилаємо prompt_enhance взагалі. Раніше тут
          // було жорстко закодовано 'AUTO' — реальний виклик Seedream 5.0
          // Pro впав з "parameters.prompt_enhance must be one of: OFF".
          // Документація (перевірена для всіх 6 моделей) стверджує
          // AUTO/ON/OFF — тобто СУПЕРЕЧИТЬ живій відповіді API для цієї
          // моделі. Поле скрізь позначене необов'язковим — пропускаємо
          // його, і Leonardo застосовує власний дефолт для кожної моделі
          // сам, замість здогаду з нашого боку, який уже підтверджено
          // хибний щонайменше для одного з 6 двигунів.
          ...(guidances ? { guidances } : {}),
        },
      }),
    });
  } catch (err) {
    throw new LeonardoV2PhotoError('unknown', `Leonardo.Ai недоступний: ${(err as Error).message}`, err);
  }

  const submitJson = (await submitRes.json().catch(() => null)) as unknown;

  // Задача #206: перевіряємо ПЕРШИМ — реальний продакшн-збій (Seedream 5.0
  // Pro, prompt_enhance) показав, що Leonardo повертає HTTP 200 з тілом у
  // формі GraphQL-помилки замість очікуваної відповіді. Без цієї перевірки
  // валідна причина збою ("prompt_enhance must be one of: OFF") тонула б у
  // загальному "відповідь без розпізнаного id" з #204.
  const validationMessage = extractLeonardoV2ValidationMessage(submitJson);
  if (validationMessage) {
    console.error(`Leonardo.Ai v2 (${options.engineId}): помилка валідації параметрів:`, validationMessage, submitJson);
    throw new LeonardoV2PhotoError(
      classifyLeonardoV2Error(submitRes.status, validationMessage),
      `Leonardo.Ai: ${validationMessage}`
    );
  }

  const generationId = extractSubmittedGenerationId(submitJson);

  if (!submitRes.ok || !generationId) {
    // 18.09.2026, продакшн: перший реальний виклик Seedream 5.0 Pro впав
    // тут із голим «Leonardo.Ai: HTTP 200» — відповідь БУЛА успішною
    // (submitRes.ok), але жодне з очікуваних полів (generations_by_pk.id,
    // .generationId, кореневий id/generationId, sdGenerationJob.generationId)
    // не знайшлось. Форма відповіді submit для v2 API НЕ задокументована
    // (див. коментар модуля вище) — тож замість мовчазної «HTTP 200»
    // повідомлення тепер несе СИРУ відповідь Leonardo (обрізану), а сервер
    // логує її повністю. Це дає змогу побачити РЕАЛЬНУ форму й виправити
    // extractSubmittedGenerationId() точково, а не вгадувати наосліп.
    let rawSnippet = '';
    try {
      rawSnippet = JSON.stringify(submitJson).slice(0, 500);
    } catch {
      rawSnippet = String(submitJson);
    }
    console.error(
      `Leonardo.Ai v2 (${options.engineId}): відповідь на відправлення генерації без розпізнаного id. HTTP ${submitRes.status}. Повна відповідь:`,
      submitJson
    );
    const message =
      (submitJson as { error?: string } | null)?.error ||
      `HTTP ${submitRes.status}, відповідь без розпізнаного id генерації: ${rawSnippet}`;
    throw new LeonardoV2PhotoError(classifyLeonardoV2Error(submitRes.status, message), `Leonardo.Ai: ${message}`);
  }

  let imageUrl: string | undefined;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    let pollRes: Response;
    try {
      pollRes = await fetch(`${LEONARDO_V2_BASE_URL}/generations/${generationId}`, {
        headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json' },
      });
    } catch (err) {
      throw new LeonardoV2PhotoError('unknown', `Leonardo.Ai недоступний під час очікування: ${(err as Error).message}`, err);
    }
    const pollJson = await pollRes.json().catch(() => null);
    if (!pollRes.ok) {
      throw new LeonardoV2PhotoError(classifyLeonardoV2Error(pollRes.status, `HTTP ${pollRes.status}`), `Leonardo.Ai: HTTP ${pollRes.status}`);
    }
    const gen = extractGenerationRecord(pollJson);
    if (gen?.status === 'COMPLETE') {
      imageUrl = extractImageUrl(gen);
      break;
    }
    if (gen?.status === 'FAILED') {
      throw new LeonardoV2PhotoError('unknown', 'Leonardo.Ai: генерацію відхилено (status FAILED).');
    }
    // PENDING — пробуємо далі.
  }

  if (!imageUrl) {
    throw new LeonardoV2PhotoError('unknown', 'Leonardo.Ai не встиг завершити генерацію за відведений час. Спробуйте ще раз.');
  }

  let downloadRes: Response;
  try {
    downloadRes = await fetch(imageUrl);
  } catch (err) {
    throw new LeonardoV2PhotoError('unknown', `Не вдалося завантажити результат Leonardo.Ai: ${(err as Error).message}`, err);
  }
  if (!downloadRes.ok) {
    throw new LeonardoV2PhotoError('unknown', `Не вдалося завантажити результат Leonardo.Ai (HTTP ${downloadRes.status}).`);
  }
  const arrayBuffer = await downloadRes.arrayBuffer();
  const mimeType = downloadRes.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}
