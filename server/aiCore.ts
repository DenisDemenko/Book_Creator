/**
 * Ядро АІ — єдиний технічний шар, через який проходять усі AI-виклики
 * продукту: чат, редагування тексту, персонажі (портрети, патерни
 * поведінки), ілюстрації, обкладинки, тренування/тести, KDP-форматування.
 *
 * До цього модуля існувало ДВІ окремі реалізації виклику Gemini —
 * SDK-based (`server.ts` → generateWithGemini, з підтримкою JSON-режиму,
 * використовувалась 24 нечат-текстовими інструментами) і REST-based
 * (`server/chatProviders.ts` → generateGemini, без JSON-режиму,
 * використовувалась лише чатом поряд з GPT/Claude/DeepSeek/Groq/Mistral).
 * Тому досі не існувало єдиного ядра: чат і решта фіч історично йшли
 * різними шляхами, і логування витрати токенів було розкидане по коду
 * server.ts як окрема, опційна дія (`logCtx?`) — звідси й баги на кшталт
 * "модель не тарифікується за свою конкретну версію" чи "фіча забула
 * передати logCtx".
 *
 * Дві відповідальності цього модуля:
 *
 *  1. dispatch() — єдина точка виклику будь-якого з 6 текстових провайдерів
 *     (це саме та функція, яку викликає і чат, і generateText() нижче).
 *     JSON-режим Gemini (dispatchGeminiSdk) лишається окремим шляхом
 *     всередині, бо REST-провайдер у chatProviders.ts responseMimeType
 *     не підтримує — так 24 структуровані виклики не ризикують регресією.
 *
 *  2. generateText()/generateImage() — dispatch() + ОБОВ'ЯЗКОВЕ логування
 *     в usage_log. Це канонічна точка входу для всіх НЕчат AI-інструментів.
 *     Чат (`server/chatRoutes.ts`) використовує dispatch() напряму й лишає
 *     своє власне надійне логування (перевірене 71 тестом,
 *     `npm run test:chat`) — так усунено ризик подвійного запису в
 *     usage_log без ризику для наявних тестів.
 */

import { GoogleGenAI } from '@google/genai';
import {
  PROVIDERS,
  resolveEngine as resolveChatEngine,
  type EngineId as ChatEngineId,
  type ImageAttachment,
} from './chatProviders';
import {
  generateImage as generateImageRaw,
  saveGeneratedImage,
  resolveEngine as resolveImageEngine,
} from './imageGeneration';
import {
  MEDIA_MIME_EXTENSIONS,
  saveAsset,
  type MediaKind,
} from './media/mediaLibraryStore';
import { recordUsage } from './store';
import { platformKeyFor } from './platformKeys';
import { priceForImage, priceForTextEngine } from './pricing';

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';

const geminiApiKey = process.env.GEMINI_API_KEY;
/** Єдиний клієнт Gemini SDK продукту — раніше жив у замиканні startServer(). */
export const geminiClient: GoogleGenAI | null = geminiApiKey
  ? new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    })
  : null;

export type AiTextEngine = ChatEngineId;
export { resolveChatEngine as resolveTextEngine };

interface UsageLogCtx {
  req: any;
  label: string;
  bookId?: string;
}

export async function logTextUsage(
  ctx: UsageLogCtx,
  modelId: string,
  engine: AiTextEngine,
  inputTokens: number,
  outputTokens: number,
  success: boolean
): Promise<void> {
  const principal = ctx.req?.principal;
  try {
    await recordUsage({
      id: `use-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      userId: principal?.isGuest ? null : principal?.id || null,
      userEmail: principal?.email || 'guest@local',
      role: principal?.role || 'guest',
      kind: 'text',
      engineId: engine,
      modelId,
      // На відміну за старого logTextUsage() у server.ts, тут ЗАВЖДИ
      // передається modelId — раніше Claude Opus/Haiku тарифікувались
      // як Sonnet за замовчуванням (priceForTextEngine приймає modelId
      // четвертим аргументом, але старий виклик його не давав).
      costUsd: success ? priceForTextEngine(engine, inputTokens, outputTokens, modelId) : 0,
      context: ctx.label,
      bookId: ctx.bookId,
      success,
    });
  } catch (err) {
    console.warn('[aiCore] Не вдалося записати витрату тексту:', err);
  }
}

async function logImageUsage(
  ctx: UsageLogCtx,
  engineId: string,
  modelId: string,
  imageSize: string,
  success: boolean
): Promise<void> {
  const principal = ctx.req?.principal;
  try {
    await recordUsage({
      id: `use-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      userId: principal?.isGuest ? null : principal?.id || null,
      userEmail: principal?.email || 'guest@local',
      role: principal?.role || 'guest',
      kind: 'image',
      engineId,
      modelId,
      imageSize,
      costUsd: success ? priceForImage(engineId, imageSize, modelId) : 0,
      context: ctx.label,
      bookId: ctx.bookId,
      success,
    });
  } catch (err) {
    console.warn('[aiCore] Не вдалося записати витрату:', err);
  }
}

/**
 * Логує вже отриманий результат текстової генерації, коли сам виклик
 * провайдера стався поза dispatch()/generateText() (server/textFromImage.ts,
 * server/claudeManuscript.ts — вони мають власну спеціалізовану логіку
 * формування запиту, зокрема vision-вхід і KDP-промпти). Рушій визначається
 * за modelId — та сама логіка, що раніше жила в server.ts як
 * `resolveChatEngine(modelId)` усередині логування чату.
 */
export async function recordTextUsageByModel(
  req: any,
  label: string,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  success: boolean,
  bookId?: string
): Promise<void> {
  const engine = resolveChatEngine(modelId);
  await logTextUsage({ req, label, bookId }, modelId, engine, inputTokens, outputTokens, success);
}

/**
 * Єдиний виклик текстового провайдера — БЕЗ логування. Викликається чатом
 * (через generateChatReply у server.ts) і генеруванням тексту нижче.
 */
export async function dispatch(
  engine: AiTextEngine,
  modelId: string,
  prompt: string,
  systemInstruction: string,
  apiKeyOverride?: string,
  images?: ImageAttachment[],
  json?: boolean
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  return PROVIDERS[engine](prompt, systemInstruction, modelId, apiKeyOverride, images, json);
}

/**
 * Виклик Gemini SDK у режимі структурованого JSON (`responseMimeType`) —
 * REST-шлях chatProviders.ts цього не підтримує, тож для інструментів
 * продукту, які просять AI повернути JSON, лишається саме SDK-клієнт.
 */
async function dispatchGeminiSdk(
  prompt: string,
  systemInstruction: string | undefined,
  json: boolean
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  if (!geminiClient) {
    throw new Error('GEMINI_API_KEY is not configured on server.');
  }
  const response = await geminiClient.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction:
        systemInstruction || 'Ти — професійний український літературний редактор, сценарист та видавничий експерт.',
      responseMimeType: json ? 'application/json' : undefined,
      temperature: 0.7,
    },
  });
  const usage = response.usageMetadata;
  return {
    text: response.text || '',
    inputTokens: usage?.promptTokenCount || 0,
    outputTokens: usage?.candidatesTokenCount || 0,
  };
}

interface GenerateTextParams {
  engine: AiTextEngine;
  /** За замовчуванням — GEMINI_MODEL для engine==='gemini'. Для решти рушіїв обов'язковий. */
  modelId?: string;
  prompt: string;
  systemInstruction?: string;
  /** Тільки engine==='gemini' підтримує структурований JSON-режим. */
  json?: boolean;
  apiKeyOverride?: string;
  images?: ImageAttachment[];
  req: any;
  label: string;
  bookId?: string;
}

/** Скільки РАЗІВ ПОВТОРИТИ виклик після тимчасової відмови (усього спроб — на одну більше). */
const TRANSIENT_RETRIES = 2;

/** Затримки перед повторами, мс. Ростуть, щоб не добивати вже перевантажений бік. */
const RETRY_DELAYS_MS = [900, 2700];

/**
 * Чи має сенс повторювати цей запит.
 *
 * Gemini регулярно віддає `503 UNAVAILABLE — "This model is currently
 * experiencing high demand"`. Це не помилка налаштування: той самий запит
 * через кілька секунд проходить. Без повтору кожен такий сплеск на боці
 * Google зупиняє експрес-майстер посеред кроку й виглядає для автора як
 * поламаний застосунок.
 *
 * Помилки ключа й промпту (400/401/403, API_KEY_INVALID) навмисно НЕ
 * повторюються: вони не самополагодяться, а повтор лише втричі подовжив
 * би очікування перед тим самим повідомленням.
 */
function isTransientAiError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err);
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
  return /UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    msg
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Текстова генерація з ОБОВ'ЯЗКОВИМ логуванням — канонічна точка входу для
 * всіх нечат-текстових інструментів продукту (редагування, переклад,
 * генерація персонажа, патерни поведінки, тренування тощо).
 *
 * Тимчасові відмови провайдера повторюються тут, а не в кожному виклику:
 * місць виклику десятки, і додавати повтор у кожне означало б і забути
 * його в половині, і розмножити той самий код.
 */
export async function generateText(
  p: GenerateTextParams
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const modelId = p.modelId || (p.engine === 'gemini' ? GEMINI_MODEL : '');
  const ctx: UsageLogCtx = { req: p.req, label: p.label, bookId: p.bookId };

  for (let attempt = 0; ; attempt++) {
    try {
      const result =
        p.engine === 'gemini' && p.json
          ? await dispatchGeminiSdk(p.prompt, p.systemInstruction, true)
          : await dispatch(p.engine, modelId, p.prompt, p.systemInstruction || '', p.apiKeyOverride, p.images, p.json);
      await logTextUsage(ctx, modelId, p.engine, result.inputTokens, result.outputTokens, true);
      return result;
    } catch (err) {
      const canRetry = attempt < TRANSIENT_RETRIES && isTransientAiError(err);
      if (!canRetry) {
        // Лог невдачі пишеться один раз — за підсумком, а не на кожну
        // спробу: інакше один клік автора давав би три записи «провал»
        // у бізнес-аналітиці й спотворював би статистику надійності.
        await logTextUsage(ctx, modelId, p.engine, 0, 0, false);
        throw err;
      }
      console.warn(
        `[aiCore] ${p.label}: тимчасова відмова ${p.engine} (спроба ${attempt + 1}/${TRANSIENT_RETRIES + 1}), ` +
          `повтор через ${RETRY_DELAYS_MS[attempt]} мс — ${String((err as Error)?.message ?? err).slice(0, 160)}`
      );
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Сумісна обгортка зі старою сигнатурою generateWithGemini() з server.ts —
 * так усі 24 наявні виклики мігрують на ядро без правок аргументів на
 * кожному місці виклику. Поведінка ідентична, окрім того, що логування й
 * ціноутворення тепер завжди йдуть через generateText().
 */
export async function generateWithGemini(
  prompt: string,
  systemInstruction?: string,
  isJson = false,
  logCtx?: { req: any; label: string; bookId?: string }
): Promise<string> {
  if (!logCtx) {
    // Без контексту логування виклик лишається "тихим" — так само, як і
    // раніше в server.ts. У продукті сьогодні всі 24 місця передають logCtx.
    const result = await dispatchGeminiSdk(prompt, systemInstruction, isJson);
    return result.text;
  }
  const result = await generateText({
    engine: 'gemini',
    modelId: GEMINI_MODEL,
    prompt,
    systemInstruction,
    json: isJson,
    req: logCtx.req,
    label: logCtx.label,
    bookId: logCtx.bookId,
  });
  return result.text;
}

interface GenerateImageParams {
  prompt: string;
  engine?: string;
  aspectRatio?: string;
  imageSize?: string;
  negativePrompt?: string;
  /** Прокидається у provider-виклик лише для двигунів, які це підтримують. */
  quality?: 'minimal' | 'high';
  outputFormat?: 'png' | 'jpeg';
  /**
   * Референсні зображення для мультиреференсної генерації (задача #52) —
   * уже публічні URL (маршрут перетворює завантажені файли на URL ДО
   * виклику цієї функції). Прокидається лише в `imageGeneration.ts`, тут
   * не інтерпретується.
   */
  referenceImageUrls?: string[];
  /** Короткий хінт для імені файлу (напр. "cover", "scene", "char-Юля"). */
  filenameHint: string;
  req: any;
  /** Людський контекст для usage_log при успіху (напр. "Обкладинка: Назва книги"). */
  label: string;
  bookId?: string;
}


/**
 * Куди лягає щойно згенероване зображення.
 *
 * Зареєстрованому авторові — у ЙОГО медіатеку на сервері (задача #100): з
 * власником, промптом і моделлю, у DATA_DIR, тобто там, де воно переживе
 * деплой. Гостеві власника немає, тож для нього лишається старий шлях —
 * файл у `assets/generated`, який віддається статикою.
 *
 * Старі книги з URL `/generated/...` продовжують працювати: та статика
 * нікуди не поділась, ми лише перестали класти туди НОВЕ.
 */
async function saveImageForOwner(
  p: GenerateImageParams,
  buffer: Buffer,
  mimeType: string,
  modelId: string
): Promise<{ url: string; filename: string; bytes: number }> {
  const ownerId = p.req?.principal?.id ? String(p.req.principal.id) : '';
  if (!ownerId) {
    return saveGeneratedImage(buffer, mimeType, p.filenameHint);
  }

  // Вид — з НАШОГО ж хінта імені файлу (їх задає код, не автор), тому це
  // не вгадування по чужих даних.
  const hint = String(p.filenameHint || '');
  const kind: MediaKind = hint.startsWith('cover')
    ? 'cover_art'
    : hint.startsWith('char')
      ? 'character_art'
      : 'illustration';

  try {
    const asset = await saveAsset({
      ownerId,
      bookId: p.bookId ?? null,
      kind,
      filename: `${hint || 'art'}.${MEDIA_MIME_EXTENSIONS[mimeType] || 'png'}`,
      mimeType,
      bytes: new Uint8Array(buffer),
      prompt: p.prompt,
      model: modelId,
    });
    return { url: asset.url, filename: asset.filename, bytes: asset.sizeBytes };
  } catch (err) {
    // Збій сховища не має губити вже ОПЛАЧЕНУ генерацію: віддаємо її
    // старим шляхом і пишемо в лог, щоб причина не зникла.
    console.error('[aiCore] Не вдалося покласти зображення в медіатеку, лишаємо у /generated:', err);
    return saveGeneratedImage(buffer, mimeType, p.filenameHint);
  }
}

/**
 * Генерація зображення + збереження файлу + ОБОВ'ЯЗКОВЕ логування — одним
 * викликом замість трьох ручних кроків, які раніше дублювались у трьох
 * місцях server.ts (портрет персонажа, ілюстрація, обкладинка).
 */
export async function generateImage(p: GenerateImageParams): Promise<{
  url: string;
  filename: string;
  bytes: number;
  engineId: string;
  engineLabel: string;
  modelId: string;
  maxSize: '1K' | '2K' | '4K';
  aspectRatio: string;
}> {
  const ctx: UsageLogCtx = { req: p.req, label: p.label, bookId: p.bookId };
  try {
    // Власний ключ автора для Seedream, якщо він його зберіг. Помилка
    // читання не має валити генерацію — тоді просто працює серверний ключ.
    // Ключ платформи, а не того, хто викликає: коди провайдерів вводить
    // лише адміністратор, і Nova обслуговує ним усіх авторів.
    const apiKeyOverride = await platformKeyFor('seedream');


    const generated = await generateImageRaw(geminiClient, {
      prompt: p.prompt,
      engine: p.engine,
      aspectRatio: p.aspectRatio,
      referenceImageUrls: p.referenceImageUrls,
      imageSize: p.imageSize,
      negativePrompt: p.negativePrompt,
      quality: p.quality,
      outputFormat: p.outputFormat,
      apiKeyOverride,
    });
    const saved = await saveImageForOwner(p, generated.buffer, generated.mimeType, generated.modelId);
    // Той самий діапазон, що й у imageGeneration.ts: 4K не згортаємо до 2K,
    // інакше тариф і usage_log брехали б про фактичний розмір генерації.
    const sizeLabel =
      generated.engine.maxSize === '1K' ? '1K' : p.imageSize === '1K' || p.imageSize === '4K' ? p.imageSize : '2K';
    await logImageUsage(ctx, generated.engine.id, generated.modelId, sizeLabel, true);
    return {
      url: saved.url,
      filename: saved.filename,
      bytes: saved.bytes,
      engineId: generated.engine.id,
      engineLabel: generated.engine.label,
      modelId: generated.modelId,
      maxSize: generated.engine.maxSize,
      aspectRatio: generated.aspectRatio,
    };
  } catch (err: any) {
    // Той самий формат мітки, який раніше писався вручну на кожному з 3
    // місць виклику: "Невдала спроба (<kind>)".
    const failedEngine = resolveImageEngine(p.engine);
    const sizeLabel =
      failedEngine.maxSize === '1K' ? '1K' : p.imageSize === '1K' || p.imageSize === '4K' ? p.imageSize : '2K';
    await logImageUsage(
      { req: p.req, label: `Невдала спроба (${err?.kind || 'unknown'})`, bookId: p.bookId },
      failedEngine.id,
      failedEngine.modelId,
      sizeLabel,
      false
    );
    throw err;
  }
}
