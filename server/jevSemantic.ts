import type { Express } from 'express';
import { requireAuth, requirePermission } from './auth';

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

type JevQuestion = {
  type: 'noul';
  instructions: string;
};

type JevResponse = {
  model?: string;
  answers?: Record<string, unknown>;
};

const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
const DEFAULT_MODEL = 'jev-latest';
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

export function readNoulProbability(answer: unknown): number | null {
  if (typeof answer === 'number' && Number.isFinite(answer)) return clamp01(answer);
  if (!answer || typeof answer !== 'object') return null;
  const record = answer as Record<string, unknown>;
  for (const key of ['noul', 'probability', 'confidence', 'value']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return clamp01(value);
  }
  return null;
}

function questionFor(candidate: JevEntityCandidate): JevQuestion {
  const context = candidate.description ? ` Context: ${candidate.description}` : '';
  return {
    type: 'noul',
    instructions: safeInstruction(
      `Is the existing book entity “${candidate.name}” (${candidate.slug}) materially present, referenced, or semantically active in this exact text? Answer yes only when the text supports this entity; do not infer unrelated entities.${context}`,
    ),
  };
}

export interface ClassifyWithJevOptions {
  text: string;
  candidates: JevEntityCandidate[];
  threshold?: number;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Classifies only entities already known to the book. JEV is a typed decision
 * model, not a generator, so this function deliberately never invents names.
 * Unknown/new entities stay an explicit future author-approved workflow.
 */
export async function classifyExistingEntitiesWithJev(
  options: ClassifyWithJevOptions,
): Promise<JevSemanticResult> {
  const text = options.text.trim();
  if (!text) return { matches: [], proposedNewEntities: [], provider: 'jev', model: options.model || DEFAULT_MODEL };

  const apiKey = options.apiKey ?? process.env.JEV_AI_API_KEY ?? process.env.JEV_API_KEY ?? '';
  if (!apiKey) throw new Error('JEV_NOT_CONFIGURED');

  const model = options.model ?? process.env.JEV_MODEL ?? DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? process.env.JEV_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const threshold = clamp01(options.threshold ?? DEFAULT_THRESHOLD);
  const fetchImpl = options.fetchImpl ?? fetch;
  const matches: JevEntityMatch[] = [];

  for (const batch of buildJevEntityBatches(options.candidates)) {
    const questions: Record<string, JevQuestion> = {};
    batch.forEach((candidate, index) => {
      questions[`entity_${index}`] = questionFor(candidate);
    });

    const response = await fetchImpl(`${baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state: text, model, questions }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`JEV_REQUEST_FAILED:${response.status}:${detail}`);
    }

    const payload = (await response.json()) as JevResponse;
    const answers = payload.answers ?? {};
    batch.forEach((candidate, index) => {
      const confidence = readNoulProbability(answers[`entity_${index}`]);
      if (confidence != null && confidence >= threshold) {
        matches.push({ ...candidate, confidence, source: 'jev' });
      }
    });
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return { matches, proposedNewEntities: [], provider: 'jev', model };
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
            error: 'JEV не налаштований на сервері. Потрібен JEV_AI_API_KEY або JEV_API_KEY.',
            kind: 'jev_not_configured',
          });
          return;
        }
        res.status(502).json({ error: message, kind: 'jev_failed' });
      }
    },
  );
}
