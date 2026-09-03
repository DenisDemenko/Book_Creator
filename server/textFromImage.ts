/**
 * ШІ-текст «за мотивами» зображення — письменницький модуль, окремий від
 * генерації самих ілюстрацій (server/imageGeneration.ts).
 *
 * Ідея: автор дивиться на згенеровану чи завантажену ілюстрацію й хоче,
 * щоб ШІ, як співавтор-письменник, запропонував текст сцени українською —
 * а не просто підпис. Результат завжди редагований, ніколи не вставляється
 * в книгу автоматично.
 *
 * Два двигуни на вибір:
 *   • Gemini — той самий ключ GEMINI_API_KEY, модель бачить зображення
 *     нативно (multimodal generateContent).
 *   • GPT — окремий ключ OPENAI_API_KEY, Chat Completions з image_url
 *     у вмісті повідомлення (vision-модель, типово gpt-4o).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { GoogleGenAI } from '@google/genai';
import { GENERATED_DIR, GENERATED_URL_PREFIX } from './imageGeneration';
import { assetIdFromUrl, readAsset } from './media/mediaLibraryStore';
import { buildTextFromImagePrompt, textFromImageSystemInstruction } from './textFromImagePrompt';

export type TextEngine = 'gemini' | 'gpt';

export type TextFromImageErrorKind = 'no_key' | 'safety' | 'quota' | 'bad_image' | 'unknown';

export class TextFromImageError extends Error {
  kind: TextFromImageErrorKind;
  engine: TextEngine;
  constructor(kind: TextFromImageErrorKind, message: string, engine: TextEngine) {
    super(message);
    this.name = 'TextFromImageError';
    this.kind = kind;
    this.engine = engine;
  }
}

// ---------------------------------------------------------------------------
// Завантаження байтів зображення з будь-якого формату посилання, який
// використовує книга: data: URL (старі завантажені файли), /api/media/file/…
// (медіатека автора на сервері, задача #100), /generated/... (згенероване до
// #100 і згенероване гостями) або звичайний http(s) URL (старі приклади
// персонажів). Усі чотири читаються з диска або мережі ТУТ, щоб решта коду
// не знала про формат посилання.
// ---------------------------------------------------------------------------

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * `ownerId` потрібен ЛИШЕ для посилань на медіатеку: файл автора читає сам
 * автор. Без цього достатньо було б підставити чужий id у книгу, щоб
 * розпізнавання тексту прочитало чуже зображення й переказало його вміст.
 */
export async function resolveImageBytes(
  imageUrl: string,
  ownerId?: string | null
): Promise<{ mimeType: string; base64: string }> {
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new TextFromImageError('bad_image', 'Немає зображення для аналізу.', 'gemini');
  }

  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new TextFromImageError('bad_image', 'Непідтримуваний формат завантаженого файлу.', 'gemini');
    return { mimeType: match[1], base64: match[2] };
  }

  const assetId = assetIdFromUrl(imageUrl);
  if (assetId) {
    const found = await readAsset(assetId);
    if (!found || !ownerId || found.record.ownerId !== String(ownerId)) {
      throw new TextFromImageError('bad_image', 'Файл медіатеки не знайдено на сервері.', 'gemini');
    }
    return {
      mimeType: found.record.mimeType,
      base64: Buffer.from(found.bytes).toString('base64'),
    };
  }

  if (imageUrl.startsWith(`${GENERATED_URL_PREFIX}/`)) {
    const filename = imageUrl.slice(GENERATED_URL_PREFIX.length + 1);
    // Захист від виходу за межі каталогу згенерованих файлів.
    const safeName = path.basename(filename);
    const filePath = path.join(GENERATED_DIR, safeName);
    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(safeName).slice(1).toLowerCase();
      return { mimeType: EXT_MIME[ext] || 'image/png', base64: buffer.toString('base64') };
    } catch {
      throw new TextFromImageError('bad_image', 'Файл зображення не знайдено на сервері.', 'gemini');
    }
  }

  if (/^https?:\/\//.test(imageUrl)) {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
      const buffer = Buffer.from(await res.arrayBuffer());
      return { mimeType, base64: buffer.toString('base64') };
    } catch (err) {
      throw new TextFromImageError('bad_image', `Не вдалося завантажити зображення за посиланням: ${(err as Error).message}`, 'gemini');
    }
  }

  throw new TextFromImageError('bad_image', 'Невідомий формат посилання на зображення.', 'gemini');
}

// ---------------------------------------------------------------------------
// Спільний промпт
// ---------------------------------------------------------------------------

export interface GenerateTextFromImageOptions {
  engine: TextEngine;
  imageUrl: string;
  bookTitle?: string;
  genre?: string;
  chapterTitle?: string;
  captionHint?: string;
  /** Хто питає — для перевірки права на файл медіатеки (див. resolveImageBytes). */
  ownerId?: string | null;
}

/**
 * Побудова промту винесена в server/textFromImagePrompt.ts — чистий файл
 * без роутів/стану (за принципом manuscriptImagePrompt.ts), щоб «Ядро AI»
 * могло показувати й редагувати той самий текст, що реально йде в модель.
 */
function buildPrompt(opts: GenerateTextFromImageOptions): string {
  return buildTextFromImagePrompt(opts);
}

function classifyGenericError(kind: 'gemini' | 'gpt', message: string): TextFromImageErrorKind {
  const m = message.toLowerCase();
  if (m.includes('api key') || m.includes('unauthenticated') || m.includes('401') || m.includes('403') || m.includes('permission')) {
    return 'no_key';
  }
  if (m.includes('safety') || m.includes('blocked') || m.includes('content_policy') || m.includes('prohibited')) {
    return 'safety';
  }
  if (m.includes('quota') || m.includes('rate limit') || m.includes('429') || m.includes('resource_exhausted')) {
    return 'quota';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

async function generateWithGemini(
  ai: GoogleGenAI | null,
  model: string,
  opts: GenerateTextFromImageOptions
): Promise<{ text: string; usage: TokenUsage }> {
  if (!ai) {
    throw new TextFromImageError('no_key', 'Ключ Gemini не налаштований (GEMINI_API_KEY).', 'gemini');
  }
  const { mimeType, base64 } = await resolveImageBytes(opts.imageUrl, opts.ownerId);

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: buildPrompt(opts) }, { inlineData: { mimeType, data: base64 } }],
        },
      ],
      config: {
        systemInstruction: textFromImageSystemInstruction(),
        temperature: 0.85,
      },
    });
    const text = (response.text || '').trim();
    if (!text) throw new Error('Порожня відповідь моделі.');
    return {
      text,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  } catch (err) {
    if (err instanceof TextFromImageError) throw err;
    const kind = classifyGenericError('gemini', String((err as Error)?.message || err));
    const message =
      kind === 'no_key'
        ? 'Ключ Gemini не має доступу до цієї моделі.'
        : kind === 'safety'
        ? 'Gemini відхилив зображення через фільтри безпеки.'
        : kind === 'quota'
        ? 'Вичерпано ліміт запитів до Gemini. Спробуйте пізніше.'
        : `Gemini не зміг обробити зображення: ${(err as Error)?.message || err}`;
    throw new TextFromImageError(kind, message, 'gemini');
  }
}

// ---------------------------------------------------------------------------
// GPT (OpenAI Chat Completions, vision)
// ---------------------------------------------------------------------------

async function generateWithGpt(opts: GenerateTextFromImageOptions): Promise<{ text: string; usage: TokenUsage }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new TextFromImageError('no_key', 'Ключ OpenAI не налаштований (OPENAI_API_KEY).', 'gpt');
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const { mimeType, base64 } = await resolveImageBytes(opts.imageUrl, opts.ownerId);

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.85,
        messages: [
          {
            role: 'system',
            content: textFromImageSystemInstruction(),
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: buildPrompt(opts) },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    throw new TextFromImageError('unknown', `GPT недоступний: ${(err as Error).message}`, 'gpt');
  }

  const json = (await res.json().catch(() => null)) as
    | {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string; code?: string };
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }
    | null;

  if (!res.ok) {
    const message = json?.error?.message || `HTTP ${res.status}`;
    const kind =
      res.status === 401 || res.status === 403
        ? 'no_key'
        : res.status === 429
        ? 'quota'
        : classifyGenericError('gpt', message);
    throw new TextFromImageError(kind, `GPT: ${message}`, 'gpt');
  }

  const text = (json?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new TextFromImageError('unknown', 'GPT повернув порожню відповідь.', 'gpt');
  return {
    text,
    usage: {
      inputTokens: json?.usage?.prompt_tokens || 0,
      outputTokens: json?.usage?.completion_tokens || 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Публічна точка входу
// ---------------------------------------------------------------------------

export async function generateTextFromImage(
  ai: GoogleGenAI | null,
  geminiModel: string,
  opts: GenerateTextFromImageOptions
): Promise<{ text: string; engine: TextEngine; model: string; usage: TokenUsage }> {
  if (opts.engine === 'gpt') {
    const { text, usage } = await generateWithGpt(opts);
    return { text, engine: 'gpt', model: process.env.OPENAI_MODEL || 'gpt-4o', usage };
  }
  const { text, usage } = await generateWithGemini(ai, geminiModel, opts);
  return { text, engine: 'gemini', model: geminiModel, usage };
}

export function engineAvailability(hasGeminiKey: boolean): { gemini: boolean; gpt: boolean } {
  return { gemini: hasGeminiKey, gpt: !!process.env.OPENAI_API_KEY };
}
