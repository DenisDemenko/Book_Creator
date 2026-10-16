import type { Express } from 'express';
import { requireAuth, requirePermission } from './auth';
import {
  HttpJevAdapter,
  JEV_MODEL,
  jevKeyFromEnv,
  jevModelFromEnv,
  noulProbability,
  type JevAdapter,
} from './ai/adapters/jev/index';
import type { JevQuestion } from './ai/contracts';

export interface JevEntityCandidate {
  id: string;
  slug: string;
  name: string;
  description?: string;
}

export interface JevEntityMatch extends JevEntityCandidate {
  confidence: number;
  source: 'jev';
}

export interface JevSemanticResult {
  matches: JevEntityMatch[];
  proposedNewEntities: [];
  provider: 'jev';
  model: string;
}

const BATCH_SIZE = 48;
const DEFAULT_THRESHOLD = 0.65;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function safeInstruction(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800);
}

export function buildJevEntityBatches(candidates: JevEntityCandidate[]): JevEntityCandidate[][] {
  const unique: JevEntityCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const id = candidate.id?.trim();
    const slug = candidate.slug?.trim();
    const name = candidate.name?.trim();
    if (!id || !slug || !name || seen.has(id)) continue;
    seen.add(id);
    unique.push({ ...candidate, id, slug, name });
  }

  const batches: JevEntityCandidate[][] = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }
  return batches;
}

/** Backward-compatible export used by the regression contract. */
export const readNoulProbability = noulProbability;

function questionFor(candidate: JevEntityCandidate, index: number): JevQuestion {
  const context = candidate.description ? ` Контекст: ${candidate.description}` : '';
  return {
    id: `entity_${index}`,
    kind: 'noul',
    instructions: safeInstruction(
      `Чи є наявна сутність книги «${candidate.name}» (${candidate.slug}) явно присутньою, згаданою або семантично активною саме в цьому тексті? Відповідай «так» лише коли текст підтримує цю сутність; не домислюй інші сутності.${context}`,
    ),
  };
}

export interface ClassifyWithJevOptions {
  text: string;
  candidates: JevEntityCandidate[];
  threshold?: number;
  apiKey?: string;
  model?: string;
  adapter?: JevAdapter;
  fetchImpl?: typeof fetch;
}

/**
 * Класифікує лише сутності, які вже існують у книзі.
 *
 * Transport не дублюється: тут використовується той самий `HttpJevAdapter`,
 * що Character Decision Engine (`server/core/jevLevels.ts`). Отже pinned
 * model, Noul parsing, timeout та TypeSafe REST contract єдині для героя,
 * workflow-вузлів і semantic tagging.
 */
export async function classifyExistingEntitiesWithJev(
  options: ClassifyWithJevOptions,
): Promise<JevSemanticResult> {
  const text = options.text.trim();
  const model = options.model ?? jevModelFromEnv();
  if (!text) return { matches: [], proposedNewEntities: [], provider: 'jev', model };

  const apiKey = options.apiKey ?? jevKeyFromEnv() ?? '';
  const adapter = options.adapter ?? (
    apiKey ? new HttpJevAdapter(apiKey, { model, fetchImpl: options.fetchImpl }) : null
  );
  if (!adapter?.askState) throw new Error('JEV_NOT_CONFIGURED');

  const threshold = clamp01(options.threshold ?? DEFAULT_THRESHOLD);
  const matches: JevEntityMatch[] = [];
  let returnedModel = model || JEV_MODEL;

  for (const batch of buildJevEntityBatches(options.candidates)) {
    const questions = batch.map(questionFor);
    const raw = await adapter.askState(
      { text, task: 'existing_book_entity_presence', constraint: 'never_invent_entities' },
      questions,
    );
    returnedModel = raw.model || returnedModel;

    batch.forEach((candidate, index) => {
      const confidence = noulProbability(raw.answers[`entity_${index}`]);
      if (confidence != null && confidence >= threshold) {
        matches.push({ ...candidate, confidence, source: 'jev' });
      }
    });
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return { matches, proposedNewEntities: [], provider: 'jev', model: returnedModel };
}

function parseCandidates(value: unknown): JevEntityCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 240)
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        id: typeof row.id === 'string' ? row.id : '',
        slug: typeof row.slug === 'string' ? row.slug : '',
        name: typeof row.name === 'string' ? row.name : '',
        description: typeof row.description === 'string' ? row.description : undefined,
      };
    })
    .filter((item) => item.id && item.slug && item.name);
}

export function registerJevSemanticRoutes(app: Express): void {
  app.post(
    '/api/semantic/jev/entities',
    requireAuth,
    requirePermission('canUseAi'),
    async (req, res) => {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const candidates = parseCandidates(req.body?.entities);
      const threshold = typeof req.body?.threshold === 'number' ? req.body.threshold : undefined;

      if (!text || text.length > 40_000) {
        res.status(400).json({ error: 'Текст має містити від 1 до 40000 символів.', kind: 'bad_input' });
        return;
      }
      if (!candidates.length) {
        res.status(400).json({ error: 'Передайте хоча б одну існуючу сутність книги.', kind: 'bad_input' });
        return;
      }

      try {
        const result = await classifyExistingEntitiesWithJev({ text, candidates, threshold });
        res.json(result);
      } catch (error) {
        const message = String((error as Error).message || error);
        if (message === 'JEV_NOT_CONFIGURED') {
          res.status(503).json({
            error: 'JEV не налаштований на сервері. Потрібен JEV_API_KEY або TYPESAFE_API_KEY.',
            kind: 'jev_not_configured',
          });
          return;
        }
        res.status(502).json({ error: message, kind: 'jev_failed' });
      }
    },
  );
}
