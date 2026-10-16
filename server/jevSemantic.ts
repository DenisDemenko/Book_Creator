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

export interface JevHeroArcResult {
  intensities: number[];
  confidences: Array<number | null>;
  provider: 'jev';
  model: string;
}

const BATCH_SIZE = 48;
const DEFAULT_THRESHOLD = 0.65;
const HERO_ARC_BEATS = [
  'Звичайний світ',
  'Поклик до пригоди',
  'Відмова від поклику',
  'Зустріч із наставником',
  'Перетин першого порогу',
  'Випробування',
  'Зустріч із найглибшим бажанням',
  'Спокуса',
  'Найголовніше випробування',
  'Символічна смерть',
  'Нагорода',
  'Шлях назад',
  'Останнє випробування',
  'Повернення з еліксиром',
] as const;
const HERO_ARC_LEVELS = [
  'крайній емоційний спад, руйнування, відчай',
  'дуже сильний негативний стан',
  'сильний негативний стан',
  'помірно негативний стан',
  'нейтральний або змішаний стан',
  'помірно позитивний стан',
  'сильний позитивний стан',
  'дуже сильний позитивний стан',
  'емоційний пік, гармонія або тріумф',
] as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function safeInstruction(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800);
}

function getAdapter(options: { apiKey?: string; model?: string; adapter?: JevAdapter; fetchImpl?: typeof fetch }) {
  const model = options.model ?? jevModelFromEnv();
  const apiKey = options.apiKey ?? jevKeyFromEnv() ?? '';
  const adapter = options.adapter ?? (apiKey ? new HttpJevAdapter(apiKey, { model, fetchImpl: options.fetchImpl }) : null);
  if (!adapter?.askState) throw new Error('JEV_NOT_CONFIGURED');
  return { adapter, model };
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
  for (let i = 0; i < unique.length; i += BATCH_SIZE) batches.push(unique.slice(i, i + BATCH_SIZE));
  return batches;
}

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

export async function classifyExistingEntitiesWithJev(options: ClassifyWithJevOptions): Promise<JevSemanticResult> {
  const text = options.text.trim();
  const model = options.model ?? jevModelFromEnv();
  if (!text) return { matches: [], proposedNewEntities: [], provider: 'jev', model };

  const resolved = getAdapter(options);
  const threshold = clamp01(options.threshold ?? DEFAULT_THRESHOLD);
  const matches: JevEntityMatch[] = [];
  let returnedModel = resolved.model || JEV_MODEL;

  for (const batch of buildJevEntityBatches(options.candidates)) {
    const questions = batch.map(questionFor);
    const raw = await resolved.adapter.askState!(
      { text, task: 'existing_book_entity_presence', constraint: 'never_invent_entities' },
      questions,
    );
    returnedModel = raw.model || returnedModel;
    batch.forEach((candidate, index) => {
      const confidence = noulProbability(raw.answers[`entity_${index}`]);
      if (confidence != null && confidence >= threshold) matches.push({ ...candidate, confidence, source: 'jev' });
    });
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return { matches, proposedNewEntities: [], provider: 'jev', model: returnedModel };
}

function scoreToArcIntensity(score: number): number {
  const max = HERO_ARC_LEVELS.length - 1;
  return Math.max(-10, Math.min(10, Math.round(((score / max) * 20 - 10) * 10) / 10));
}

export async function assessHeroArcWithJev(options: {
  heroName?: string;
  context: string;
  constructorAnswers?: Record<string, string>;
  apiKey?: string;
  model?: string;
  adapter?: JevAdapter;
  fetchImpl?: typeof fetch;
}): Promise<JevHeroArcResult> {
  const context = options.context.trim();
  if (!context) throw new Error('HERO_ARC_CONTEXT_REQUIRED');
  const resolved = getAdapter(options);
  const questions: JevQuestion[] = HERO_ARC_BEATS.map((beat, index) => ({
    id: `beat_${index}`,
    kind: 'score',
    instructions: safeInstruction(
      `Оціни емоційну валентність головного героя${options.heroName ? ` «${options.heroName}»` : ''} у сюжетній точці «${beat}». Спирайся лише на надані задум, синопсис, структуру, дані персонажів і відповіді конструктора. Не підганяй оцінку під типовий шаблон шляху героя, якщо текст цього не підтверджує.`,
    ),
    levels: [...HERO_ARC_LEVELS],
  }));

  const raw = await resolved.adapter.askState!(
    {
      task: 'hero_arc_emotional_valence',
      hero: options.heroName?.trim() || null,
      context: context.slice(0, 40_000),
      constructor_answers: options.constructorAnswers ?? {},
      constraint: 'use_only_provided_story_evidence',
    },
    questions,
  );

  const intensities = HERO_ARC_BEATS.map((_, index) => {
    const answer = raw.answers[`beat_${index}`];
    return typeof answer?.score === 'number' && Number.isFinite(answer.score) ? scoreToArcIntensity(answer.score) : 0;
  });
  const confidences = HERO_ARC_BEATS.map((_, index) => {
    const value = raw.answers[`beat_${index}`]?.confidence;
    return typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : null;
  });

  return { intensities, confidences, provider: 'jev', model: raw.model || resolved.model || JEV_MODEL };
}

function parseCandidates(value: unknown): JevEntityCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 240).map((item) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      id: typeof row.id === 'string' ? row.id : '',
      slug: typeof row.slug === 'string' ? row.slug : '',
      name: typeof row.name === 'string' ? row.name : '',
      description: typeof row.description === 'string' ? row.description : undefined,
    };
  }).filter((item) => item.id && item.slug && item.name);
}

function sendJevError(res: any, error: unknown) {
  const message = String((error as Error).message || error);
  if (message === 'JEV_NOT_CONFIGURED') {
    res.status(503).json({ error: 'JEV не налаштований на сервері. Потрібен JEV_API_KEY або TYPESAFE_API_KEY.', kind: 'jev_not_configured' });
    return;
  }
  res.status(502).json({ error: message, kind: 'jev_failed' });
}

export function registerJevSemanticRoutes(app: Express): void {
  app.post('/api/semantic/jev/entities', requireAuth, requirePermission('canUseAi'), async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const candidates = parseCandidates(req.body?.entities);
    const threshold = typeof req.body?.threshold === 'number' ? req.body.threshold : undefined;
    if (!text || text.length > 40_000) {
      res.status(400).json({ error: 'Текст має містити від 1 до 40000 символів.', kind: 'bad_input' }); return;
    }
    if (!candidates.length) {
      res.status(400).json({ error: 'Передайте хоча б одну існуючу сутність книги.', kind: 'bad_input' }); return;
    }
    try { res.json(await classifyExistingEntitiesWithJev({ text, candidates, threshold })); }
    catch (error) { sendJevError(res, error); }
  });

  app.post('/api/semantic/jev/hero-arc', requireAuth, requirePermission('canUseAi'), async (req, res) => {
    const context = typeof req.body?.context === 'string' ? req.body.context.trim() : '';
    const heroName = typeof req.body?.heroName === 'string' ? req.body.heroName.trim().slice(0, 200) : undefined;
    const constructorAnswers = req.body?.constructorAnswers && typeof req.body.constructorAnswers === 'object'
      ? req.body.constructorAnswers as Record<string, string>
      : {};
    if (!context || context.length > 40_000) {
      res.status(400).json({ error: 'Для JEV-кривої потрібен контекст від 1 до 40000 символів.', kind: 'bad_input' }); return;
    }
    try { res.json(await assessHeroArcWithJev({ heroName, context, constructorAnswers })); }
    catch (error) { sendJevError(res, error); }
  });
}
