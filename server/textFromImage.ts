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

import type { GoogleGenAI } from '@google/genai';
import { loadImageBytes } from './media/imageBytes';
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
// Завантаження байтів зображення
//
// Сама логіка живе в server/media/imageBytes.ts: по ті самі байти ходять і
// рушії PDF (#101), і тримати два розбирачі посилань означало б, що книга
// друкується з одного зображення, а модель бачить інше.
// ---------------------------------------------------------------------------

export async function resolveImageBytes(
  imageUrl: string,
  ownerId?: string | null
): Promise<{ mimeType: string; base64: string }> {
  try {
    const { mimeType, bytes } = await loadImageBytes(imageUrl, ownerId);
    return { mimeType, base64: bytes.toString('base64') };
  } catch (err) {
    throw new TextFromImageError('bad_image', (err as Error).message, 'gemini');
  }
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
