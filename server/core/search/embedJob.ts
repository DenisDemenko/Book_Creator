/**
 * Фонова задача `core_embed` (Т1.2): вектори для пошуку за змістом.
 *
 * Рахує ембединги ЛИШЕ тих абзаців, у яких вектора ще немає або текст
 * змінився відтоді (відбиток `embeddingContentHash` — від моделі й тексту
 * без тегів). Тож повторний запуск над незміненою книгою нічого не
 * викликає й нічого не коштує. Задачу ставить синхронізація книги (Т0.6),
 * коли в книзі з'явились нові чи змінені абзаци, і сам пошук, якщо бачить,
 * що вектори поточної моделі покривають не всю книгу (наприклад, адмін
 * змінив модель ембедингів).
 *
 * Бюджет: токени й запити йдуть у бюджет проєкту черги (Т0.7), вартість —
 * у журнал витрат (`recordCost`) з міткою «Ядро: ембединги пошуку».
 */

import type { CoreRepository, DocumentRow, ParagraphRow } from '../types';
import { EMBED_BATCH, EmbeddingUnavailableError, type Embedder } from './embedder';
import { embeddingContentHash, embeddingText, isSearchableKind } from './text';

export const CORE_EMBED_KIND = 'core_embed';

/** Абзац коротший за це (після зняття тегів) не має змісту для пошуку за змістом. */
export const MIN_EMBED_CHARS = 3;

export interface CoreEmbedDeps {
  repo: () => CoreRepository | null;
  embedder: Embedder;
  /** Поточна модель ембедингів (вибір адміна або дефолт пошуку). */
  model: () => Promise<string>;
  /** Запис витрати в журнал (usage_log); не кидає. */
  recordCost?: (u: { projectId: string; model: string; tokens: number; texts: number }) => Promise<void>;
}

export interface EmbedPlan {
  model: string;
  /** Абзаци, яким потрібен новий вектор: id, відбиток, текст для моделі. */
  todo: { paragraphId: string; contentHash: string; text: string }[];
  /** Живих абзаців із текстом усього. */
  total: number;
}

/** Що треба (пере)рахувати для книги цією моделлю — з уже прочитаних даних (так робить і пошук). */
export function planEmbeddingsFrom(
  paragraphs: ParagraphRow[],
  documents: DocumentRow[],
  existing: { paragraphId: string; contentHash: string }[],
  model: string,
): EmbedPlan {
  const liveDocs = new Set(documents.filter((d) => !d.deletedAt).map((d) => d.id));
  const have = new Map(existing.map((e) => [e.paragraphId, e.contentHash]));
  const todo: EmbedPlan['todo'] = [];
  let total = 0;
  for (const p of paragraphs) {
    if (p.deletedAt || !liveDocs.has(p.documentId) || !isSearchableKind(p.kind)) continue;
    const text = embeddingText(p.text);
    if (text.length < MIN_EMBED_CHARS) continue;
    total++;
    const hash = embeddingContentHash(model, text);
    if (have.get(p.id) !== hash) todo.push({ paragraphId: p.id, contentHash: hash, text });
  }
  return { model, todo, total };
}

/** Що треба (пере)рахувати для книги цією моделлю. */
export async function planEmbeddings(repo: CoreRepository, projectId: string, model: string): Promise<EmbedPlan> {
  const [paragraphs, documents, existing] = await Promise.all([
    repo.listAllParagraphs(projectId),
    repo.listDocuments(projectId),
    repo.listEmbeddingHashes(projectId, model),
  ]);
  return planEmbeddingsFrom(paragraphs, documents, existing, model);
}

export function coreEmbedJobKind(deps: CoreEmbedDeps) {
  return {
    maxAttempts: 3,
    // Задачу ставлять автоматично (синхронізація, пошук) — обмеження від циклу.
    rateLimit: { max: 20, windowMs: 60_000 },
    handler: async (ctx: {
      job: { projectId: string };
      signal: AbortSignal;
      checkpoint(): Promise<void>;
      setProgress(p: Record<string, unknown>): Promise<void>;
      recordUsage(u: { tokens?: number; requests?: number }): Promise<void>;
    }) => {
      const repo = deps.repo();
      if (!repo) throw new Error('Ядро недоступне');
      const projectId = ctx.job.projectId;
      const model = await deps.model();
      const plan = await planEmbeddings(repo, projectId, model);
      let done = 0;
      let tokens = 0;
      await ctx.setProgress({ step: 'embed', model, done, todo: plan.todo.length, total: plan.total });
      for (let i = 0; i < plan.todo.length; i += EMBED_BATCH) {
        // Контрольна точка перед кожним платним викликом: скасування й бюджет.
        await ctx.checkpoint();
        const batch = plan.todo.slice(i, i + EMBED_BATCH);
        let res;
        try {
          res = await deps.embedder(model, batch.map((b) => b.text), 'document', ctx.signal);
        } catch (err) {
          // Немає ключа — не збій: пошук працює за словами, повтор нічого не змінить.
          if (err instanceof EmbeddingUnavailableError) {
            // Вектори попередньої моделі НЕ прибираємо: без ключа нової адмін,
            // найімовірніше, повернеться до старої — і вони знову знадобляться.
            return { model, skipped: 'unavailable', reason: err.message, embedded: done, pruned: 0, total: plan.total };
          }
          throw err;
        }
        await ctx.recordUsage({ tokens: res.tokens, requests: 1 });
        await deps.recordCost?.({ projectId, model, tokens: res.tokens, texts: batch.length });
        await repo.upsertParagraphEmbeddings(
          projectId,
          model,
          batch.map((b, k) => ({ paragraphId: b.paragraphId, contentHash: b.contentHash, vector: res.vectors[k] })),
        );
        done += batch.length;
        tokens += res.tokens;
        await ctx.setProgress({ step: 'embed', model, done, todo: plan.todo.length, total: plan.total });
      }
      // Лише коли книга повністю покрита новою моделлю: вектори інших моделей
      // і видалених абзаців більше не потрібні.
      const pruned = await repo.pruneParagraphEmbeddings(projectId, model);
      return { model, embedded: done, unchanged: plan.total - plan.todo.length, pruned, total: plan.total, tokens };
    },
  };
}

/**
 * Поставити `core_embed` для книги, якщо така задача ще не чекає в черзі.
 * Не кидає: збій черги не має ламати ні синхронізацію, ні пошук.
 */
export async function scheduleCoreEmbed(
  queue: {
    enqueue(input: { projectId: string; kind: string; payload?: Record<string, unknown>; delayMs?: number; createdBy: string }): Promise<unknown>;
    store: { list(projectId: string, filter?: { kind?: string; status?: 'queued'; limit?: number }): Promise<unknown[]> };
  } | null,
  projectId: string,
  createdBy: string,
  delayMs = 2_000,
): Promise<'scheduled' | 'already_queued' | 'skipped'> {
  if (!queue) return 'skipped';
  try {
    const waiting = await queue.store.list(projectId, { kind: CORE_EMBED_KIND, status: 'queued', limit: 1 });
    if (waiting.length) return 'already_queued';
    await queue.enqueue({ projectId, kind: CORE_EMBED_KIND, payload: {}, delayMs, createdBy });
    return 'scheduled';
  } catch (err) {
    console.warn(`[core] ембединги книги ${projectId} не поставлено: ${(err as Error).message}`);
    return 'skipped';
  }
}
