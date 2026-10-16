import type { ExpressPayload } from './expressStore';
import {
  HttpJevAdapter,
  jevModelFromEnv,
  type JevQuestion,
} from './ai/adapters/jev';

export const HERO_ARC_BEAT_TITLES = [
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

/**
 * System One score supports 2–10 ordered levels. Nine levels give a
 * symmetric scale with a true neutral midpoint, which is then mapped to
 * the Writer Studio range -10..+10.
 */
export const HERO_ARC_JEV_LEVELS = [
  'глибока криза, руйнування, максимальний негативний стан',
  'дуже сильний негативний стан',
  'виразно негативний стан',
  'помірно негативний стан',
  'нейтральний або перехідний стан',
  'помірно позитивний стан',
  'виразно позитивний стан',
  'дуже сильний позитивний стан',
  'гармонія, перемога, максимальний позитивний стан',
] as const;

export interface ExpressHeroArcPoint {
  beatIndex: number;
  jevValue: number;
  confidence?: number;
}

export interface ExpressHeroArcResult {
  source: 'jev';
  status: 'fresh';
  heroId: string;
  model: string;
  analyzedAt: string;
  points: ExpressHeroArcPoint[];
  usage: { input_tokens: number; output_tokens: number };
  latencyMs: number;
}

export function jevScoreToHeroArcValue(score: number, levels = HERO_ARC_JEV_LEVELS.length): number {
  const safeLevels = Math.max(2, Math.floor(levels));
  const position = Math.max(0, Math.min(safeLevels - 1, Number(score)));
  return Math.round((-10 + (position / (safeLevels - 1)) * 20) * 10) / 10;
}

export function heroArcJevQuestions(): JevQuestion[] {
  return HERO_ARC_BEAT_TITLES.map((title, beatIndex) => ({
    id: `hero_arc_${beatIndex}`,
    kind: 'score',
    instructions:
      `Оціни емоційний стан протагоніста у сюжетній точці «${title}». ` +
      'Спирайся лише на наданий канон: задум, підтверджених героїв, синопсис, ' +
      'структуру глав, мету, страх, мотивацію та внутрішній конфлікт героя. ' +
      'Не вигадуй нових подій для підсилення оцінки. Якщо даних мало — обирай ' +
      'найближчий до нейтрального обґрунтований рівень.',
    levels: [...HERO_ARC_JEV_LEVELS],
  }));
}

export function buildHeroArcJevState(payload: ExpressPayload, heroId: string): Record<string, unknown> {
  const cast = payload.cast ?? [];
  const hero = cast.find((member) => member.id === heroId);
  if (!hero) throw new Error('Протагоніста немає у підтвердженому складі героїв.');
  return {
    task: 'hero_arc_semantic_scoring',
    seed: payload.seed ?? '',
    genre: payload.genre ?? '',
    framework: payload.framework ?? '',
    story_world: payload.storyWorld ?? null,
    protagonist: hero,
    confirmed_cast: cast.filter((member) => member.approved !== false),
    hero_journey_answers: payload.heroArc?.answers ?? {},
    synopsis: payload.synopsis ?? '',
    parts: Array.isArray(payload.parts) ? payload.parts : [],
  };
}

function answerConfidence(answer: any): number | undefined {
  if (typeof answer?.confidence === 'number') {
    return Math.max(0, Math.min(1, answer.confidence));
  }
  const probabilities = answer?.probabilities;
  if (!probabilities || typeof probabilities !== 'object') return undefined;
  const values = Object.values(probabilities).map(Number).filter(Number.isFinite);
  if (!values.length) return undefined;
  return Math.max(0, Math.min(1, Math.max(...values)));
}

export async function analyzeExpressHeroArcWithJev(
  payload: ExpressPayload,
  heroId: string,
  apiKey: string,
): Promise<ExpressHeroArcResult> {
  const questions = heroArcJevQuestions();
  const adapter = new HttpJevAdapter(apiKey, { model: jevModelFromEnv() });
  if (!adapter.askState) throw new Error('JEV adapter does not support arbitrary state analysis.');
  const raw = await adapter.askState(buildHeroArcJevState(payload, heroId), questions);

  const points = questions.map((question, beatIndex) => {
    const answer = raw.answers?.[question.id];
    const score = Number(answer?.score);
    if (!Number.isFinite(score)) throw new Error(`JEV не повернув оцінку для точки ${beatIndex + 1}.`);
    const confidence = answerConfidence(answer);
    return {
      beatIndex,
      jevValue: jevScoreToHeroArcValue(score, HERO_ARC_JEV_LEVELS.length),
      ...(confidence !== undefined ? { confidence } : {}),
    };
  });

  return {
    source: 'jev',
    status: 'fresh',
    heroId,
    model: raw.model,
    analyzedAt: new Date().toISOString(),
    points,
    usage: raw.usage,
    latencyMs: raw.latency_ms,
  };
}
