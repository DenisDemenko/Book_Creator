/**
 * Виклик моделі ембедингів (Т1.2): текст → вектор довжини 768.
 *
 * Ключ провайдера — платформний («Ключі API» адміна), інакше змінна
 * оточення сервера; саму функцію пошуку ключа передає server.ts, тож цей
 * модуль не тягне за собою сховище й легко підміняється в тестах.
 *
 * Типи завдань. Вектор абзацу й вектор запиту рахуються по-різному
 * (RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY) — так модель краще зіставляє
 * коротке питання з довгим абзацом. Gemini Embedding 2 параметр taskType
 * ігнорує: там завдання задається префіксом у самому тексті
 * (`task: search result | query: …`), як радить документація Google.
 */

import { GoogleGenAI } from '@google/genai';
import { embeddingModelInfo, type EmbeddingModelInfo } from './embeddingModels';
import { EMBEDDING_DIMENSIONS } from './text';

export type EmbedKind = 'document' | 'query';

export interface EmbedResult {
  vectors: number[][];
  /** Вхідні токени. Gemini їх не повертає — тоді оцінка (`estimated`). */
  tokens: number;
  estimated: boolean;
}

export type Embedder = (model: string, texts: string[], kind: EmbedKind, signal?: AbortSignal) => Promise<EmbedResult>;

/** Немає ключа провайдера або модель невідома — смислова частина пошуку вимкнена. */
export class EmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

/** Скільки текстів в одному запиті до провайдера (межа batchEmbedContents — 100). */
export const EMBED_BATCH = 100;
/** Довший абзац обрізається: модель усе одно бачить лише початок (≈2048 токенів у gemini-embedding-001). */
export const EMBED_MAX_CHARS = 6000;

/** Грубо: для кирилиці ≈3 символи на токен. Лише для бюджету, коли провайдер токенів не дає. */
export function estimateTokens(texts: string[]): number {
  return texts.reduce((n, t) => n + Math.ceil(t.length / 3), 0);
}

/** Нормування до одиничної довжини: укорочений (768 з 3072) вектор Gemini не нормований. */
export function normalizeVector(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm > 0 ? v.map((x) => x / norm) : v;
}

export interface PlatformEmbedderDeps {
  /** Ключ рушія ('gemini' | 'gpt'): платформний, інакше змінна оточення; undefined — ключа немає. */
  keyFor: (engine: 'gemini' | 'gpt') => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
}

function geminiInput(info: EmbeddingModelInfo, text: string, kind: EmbedKind): string {
  if (info.id.startsWith('gemini-embedding-2')) {
    return kind === 'query' ? `task: search result | query: ${text}` : `title: none | text: ${text}`;
  }
  return text;
}

export function createPlatformEmbedder(deps: PlatformEmbedderDeps): Embedder {
  const geminiClients = new Map<string, GoogleGenAI>();
  const doFetch = deps.fetchImpl ?? fetch;

  return async (model, texts, kind, signal) => {
    const info = embeddingModelInfo(model);
    if (!info) throw new EmbeddingUnavailableError(`Невідома модель ембедингів: ${model}`);
    const key = (await deps.keyFor(info.engine))?.trim();
    if (!key) {
      throw new EmbeddingUnavailableError(
        `Немає ключа ${info.engine === 'gemini' ? 'Gemini' : 'OpenAI'} для моделі ембедингів «${info.label}» — пошук працює лише за словами.`,
      );
    }
    const inputs = texts.map((t) => t.slice(0, EMBED_MAX_CHARS));
    const vectors: number[][] = [];
    let tokens = 0;
    let estimated = false;

    for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
      signal?.throwIfAborted();
      const batch = inputs.slice(i, i + EMBED_BATCH);
      if (info.provider === 'gemini') {
        let client = geminiClients.get(key);
        if (!client) {
          client = new GoogleGenAI({ apiKey: key });
          geminiClients.set(key, client);
        }
        const res = await client.models.embedContent({
          model: info.id,
          contents: batch.map((t) => geminiInput(info, t, kind)),
          config: {
            outputDimensionality: EMBEDDING_DIMENSIONS,
            ...(info.id.startsWith('gemini-embedding-2') ? {} : { taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' }),
            abortSignal: signal,
          },
        });
        const got = res.embeddings ?? [];
        if (got.length !== batch.length) throw new Error(`Gemini повернув ${got.length} векторів замість ${batch.length}`);
        for (const e of got) vectors.push(normalizeVector(e.values ?? []));
        tokens += estimateTokens(batch);
        estimated = true;
      } else {
        const res = await doFetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: info.id, input: batch, dimensions: EMBEDDING_DIMENSIONS }),
          signal,
        });
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`OpenAI ембединги: ${body?.error?.message ?? res.status}`);
        const data = [...(body.data ?? [])].sort((a: any, b: any) => a.index - b.index);
        if (data.length !== batch.length) throw new Error(`OpenAI повернув ${data.length} векторів замість ${batch.length}`);
        for (const d of data) vectors.push(normalizeVector(d.embedding));
        tokens += Number(body.usage?.prompt_tokens) || estimateTokens(batch);
      }
    }
    for (const v of vectors) {
      if (v.length !== EMBEDDING_DIMENSIONS) throw new Error(`Вектор довжини ${v.length}, очікувалось ${EMBEDDING_DIMENSIONS}`);
    }
    return { vectors, tokens, estimated };
  };
}
