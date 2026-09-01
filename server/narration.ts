/**
 * Озвучення тексту книги/курсу через ElevenLabs Text-to-Speech.
 *
 * Ключ — платформний (server/platformKeys.ts): вставляє лише адміністратор
 * у «Ключі API» → «Озвучення», решта авторів користуються ним спільно.
 * Функція навмисно НЕ знає нічого про підписку чи кеш — це відповідальність
 * server/narrationRoutes.ts (гейт по тарифу) і server/narrationStore.ts
 * (кеш за хешем тексту). Тут лише сам виклик провайдера.
 */

import { ELEVENLABS_MODEL, ELEVENLABS_VOICE_ID } from './pricing';

export type NarrationLang = 'uk' | 'en';

export const NARRATION_LANGS: NarrationLang[] = ['uk', 'en'];

/** Скільки символів ElevenLabs приймає за один запит (документований ліміт запиту REST API). */
export const NARRATION_MAX_CHARS = 5000;

const ELEVEN_BASE_URL = (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/+$/, '');

export class NarrationError extends Error {
  constructor(
    message: string,
    public readonly kind: 'no_key' | 'too_long' | 'empty' | 'provider' | 'unknown' = 'unknown'
  ) {
    super(message);
    this.name = 'NarrationError';
  }
}

/**
 * ISO 639-1 код мови — ElevenLabs приймає його як `language_code`, щоб
 * не вгадувати вимову за текстом (короткі фрази однією-двома мовами
 * інакше визначаються моделлю ненадійно).
 */
function languageCode(lang: NarrationLang): string {
  return lang === 'en' ? 'en' : 'uk';
}

export interface SynthesizeResult {
  /** audio/mpeg, base64. */
  audioBase64: string;
  mimeType: string;
  charCount: number;
}

/**
 * Синтезує один фрагмент тексту в mp3. Фрагмент цілеспрямовано обмежений
 * NARRATION_MAX_CHARS вище — виклик, що озвучує цілу книгу, розбиває її
 * на розділи ще до цієї функції (server/narrationRoutes.ts), а не тут:
 * так кеш працює по розділах, і зміна одного абзацу не змушує
 * перегенеровувати вже оплачені сусідні.
 */
export async function synthesizeNarration(
  text: string,
  lang: NarrationLang,
  apiKey: string,
  voiceId: string = ELEVENLABS_VOICE_ID
): Promise<SynthesizeResult> {
  const clean = text.trim();
  if (!clean) {
    throw new NarrationError('Немає тексту для озвучення.', 'empty');
  }
  if (clean.length > NARRATION_MAX_CHARS) {
    throw new NarrationError(
      `Фрагмент задовгий для одного запиту озвучення (${clean.length} символів, ліміт ${NARRATION_MAX_CHARS}). Розбийте на менші частини.`,
      'too_long'
    );
  }
  if (!apiKey) {
    throw new NarrationError('Ключ ElevenLabs не налаштований. Зверніться до адміністратора.', 'no_key');
  }

  let res: Response;
  try {
    res = await fetch(`${ELEVEN_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: clean,
        model_id: ELEVENLABS_MODEL,
        language_code: languageCode(lang),
        output_format: 'mp3_44100_128',
      }),
    });
  } catch (err) {
    throw new NarrationError(`ElevenLabs недоступний: ${(err as Error).message}`, 'unknown');
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body: any = await res.json();
      message = body?.detail?.message || body?.detail || body?.error || message;
    } catch {
      /* тіло не JSON — лишаємо статус-код */
    }
    throw new NarrationError(`ElevenLabs: ${message}`, 'provider');
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    audioBase64: buffer.toString('base64'),
    mimeType: 'audio/mpeg',
    charCount: clean.length,
  };
}
