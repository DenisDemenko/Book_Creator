/**
 * Ембединги пошуку на ключах платформи (Т1.2): ембедер і запис витрат.
 * Окремо від `embedder.ts`, щоб тести могли брати ембедер без сховища.
 */

import { resolveEngineKey } from '../../platformKeys';
import { recordUsage } from '../../store';
import { createPlatformEmbedder } from './embedder';
import { embeddingCostUsd, embeddingModelInfo } from './embeddingModels';

const ENV_KEY = { gemini: 'GEMINI_API_KEY', gpt: 'OPENAI_API_KEY' } as const;

/** Ключ рушія: платформний («Ключі API» адміна), інакше змінна оточення сервера. */
export async function embeddingKeyFor(engine: 'gemini' | 'gpt'): Promise<string | undefined> {
  const platform = await resolveEngineKey(null, engine, 'core:embeddings').catch(() => undefined);
  return platform || process.env[ENV_KEY[engine]]?.trim() || undefined;
}

export const platformEmbedder = createPlatformEmbedder({ keyFor: embeddingKeyFor });

/** Рядок у usage_log: ембединги йдуть від імені системи, з `book_id` = книга. */
export async function recordEmbeddingCost(u: { projectId: string; model: string; tokens: number }, context: string): Promise<void> {
  const info = embeddingModelInfo(u.model);
  try {
    await recordUsage({
      id: `use-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      userId: null,
      userEmail: 'system@core',
      role: 'system' as any,
      kind: 'text',
      engineId: info?.engine ?? 'gemini',
      modelId: u.model,
      costUsd: embeddingCostUsd(u.model, u.tokens),
      context,
      bookId: u.projectId,
      success: true,
    });
  } catch (err) {
    console.warn('[core] не вдалося записати витрату на ембединги:', (err as Error).message);
  }
}
