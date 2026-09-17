/**
 * Чисті формули модуля «Поріг» — 1:1 порт Python-специфікації власника
 * (RiskProfile, Threshold.score()/strength()/is_real_threshold()/
 * feedback()) у TypeScript.
 *
 * Той самий принцип, що й у server/emotionMasteryScoring.ts: AI повертає
 * лише СИРІ поля кандидата (ризики, ціна, незворотність…), а рахує їх
 * завжди цей файл, ніколи AI. Жодного звернення до БД чи мережі тут немає —
 * усе тестується як чисті функції (scripts/test-thresholdScoring.mts).
 */

export type ThresholdType =
  | 'physical'
  | 'psychological'
  | 'social'
  | 'moral'
  | 'relationship'
  | 'professional'
  | 'intellectual'
  | 'spiritual'
  | 'existential';

export const THRESHOLD_TYPES: ThresholdType[] = [
  'physical',
  'psychological',
  'social',
  'moral',
  'relationship',
  'professional',
  'intellectual',
  'spiritual',
  'existential',
];

export type ThresholdStatus = 'planned' | 'approaching' | 'crossed' | 'avoided' | 'failed' | 'reversed';

export interface RiskProfile {
  physical: number;
  emotional: number;
  social: number;
  material: number;
  existential: number;
}

function clamp(v: unknown, lo: number, hi: number): number {
  const n = Number(v);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

/** Порт `RiskProfile.validate()`: кожна вісь затиснута до 1..10 (не кидає, як Python — вхід тут майже завжди від AI). */
export function validateRiskProfile(raw: Partial<Record<keyof RiskProfile, unknown>> | null | undefined): RiskProfile {
  return {
    physical: clamp(raw?.physical ?? 1, 1, 10),
    emotional: clamp(raw?.emotional ?? 1, 1, 10),
    social: clamp(raw?.social ?? 1, 1, 10),
    material: clamp(raw?.material ?? 1, 1, 10),
    existential: clamp(raw?.existential ?? 1, 1, 10),
  };
}

/** Порт `RiskProfile.maximum()`. */
export function riskMaximum(r: RiskProfile): number {
  return Math.max(r.physical, r.emotional, r.social, r.material, r.existential);
}

/** Порт `RiskProfile.average()`. */
export function riskAverage(r: RiskProfile): number {
  return (r.physical + r.emotional + r.social + r.material + r.existential) / 5;
}

/** Порт `RiskProfile.strongest()`. */
export function riskStrongest(r: RiskProfile): { name: keyof RiskProfile; value: number } {
  const entries = Object.entries(r) as [keyof RiskProfile, number][];
  const [name, value] = entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best), entries[0]);
  return { name, value };
}

export interface ThresholdCandidate {
  title: string;
  description: string;
  types: ThresholdType[];
  beforeState: string;
  choice: string;
  crossingAction: string;
  afterState: string;
  risks: RiskProfile;
  cost: number;
  irreversibility: number;
  transformation: number;
  awareness: number;
  agency: number;
}

type ThresholdNumericFields = Pick<ThresholdCandidate, 'cost' | 'irreversibility' | 'transformation' | 'awareness' | 'agency'>;

/**
 * Затискає всі 1..10-поля кандидата (порт `Threshold.validate()` числової
 * частини). Повертає `T & ThresholdNumericFields`, а не просто `T` — інакше
 * виклик із вужчим вхідним типом (наприклад, лише `{cost, irreversibility}`)
 * типово «губив» би awareness/agency, хоча вони завжди є в результаті.
 */
export function validateThresholdNumbers<T extends Partial<ThresholdCandidate>>(raw: T): T & ThresholdNumericFields {
  return {
    ...raw,
    cost: clamp(raw.cost ?? 1, 1, 10),
    irreversibility: clamp(raw.irreversibility ?? 1, 1, 10),
    transformation: clamp(raw.transformation ?? 1, 1, 10),
    awareness: clamp((raw as any).awareness ?? 5, 1, 10),
    agency: clamp((raw as any).agency ?? 5, 1, 10),
  } as T & ThresholdNumericFields;
}

/**
 * Порт `Threshold.score()` — формула п. 8 ТЗ «Поріг»:
 * 30% найсильніший ризик + 15% середній ризик + 15% ціна +
 * 20% незворотність + 15% трансформація + 5% агентність.
 * Максимум — рівно 10 (усі складові по 10, ваги в сумі = 1.0).
 */
export function thresholdScore(c: ThresholdCandidate): number {
  const value =
    riskMaximum(c.risks) * 0.3 +
    riskAverage(c.risks) * 0.15 +
    c.cost * 0.15 +
    c.irreversibility * 0.2 +
    c.transformation * 0.15 +
    c.agency * 0.05;
  return Math.round(value * 100) / 100;
}

/** Порт `Threshold.strength()` — пороги 3/5/7/9 з ТЗ. */
export function thresholdStrength(c: ThresholdCandidate): string {
  const v = thresholdScore(c);
  if (v < 3) return 'слабкий';
  if (v < 5) return 'помірний';
  if (v < 7) return 'сильний';
  if (v < 9) return 'дуже сильний';
  return 'критичний / трансформаційний';
}

/** Порт `Threshold.is_real_threshold()` — чотири незалежні умови, усі мають виконатись. */
export function isRealThreshold(c: ThresholdCandidate): boolean {
  const hasChoice = Boolean(c.choice?.trim());
  const changedState = c.beforeState?.trim().toLowerCase() !== c.afterState?.trim().toLowerCase();
  const hasStakes = c.cost >= 3 || riskMaximum(c.risks) >= 4;
  const hasIrreversibility = c.irreversibility >= 4;
  return hasChoice && changedState && hasStakes && hasIrreversibility;
}

/** Порт `Threshold.feedback()` — той самий порядок і ті самі пороги, що в Python. */
export function thresholdFeedback(c: ThresholdCandidate): string[] {
  const feedback: string[] = [];

  if (riskMaximum(c.risks) < 4) {
    feedback.push('Ставки низькі. Перевірте, що персонаж реально ризикує втратити.');
  }
  if (c.cost < 4) {
    feedback.push('Перехід майже не має ціни. Подумайте, що герой реально віддає.');
  }
  if (c.irreversibility < 5) {
    feedback.push('Поріг легко скасувати. Посильте незворотні наслідки.');
  }
  if (c.transformation < 5) {
    feedback.push('Подія мало змінює героя. Перевірте її роль у його арці.');
  }
  if (c.agency < 4) {
    feedback.push('Герой майже не здійснює власного вибору.');
  }
  if (c.beforeState?.trim().toLowerCase() === c.afterState?.trim().toLowerCase()) {
    feedback.push('Стан до і після однаковий. Можливо, це подія, але не поріг.');
  }
  if (feedback.length === 0) {
    feedback.push('Поріг має чіткий вибір, ставки, ціну та наслідки.');
  }
  return feedback;
}

/**
 * Доказ WDI (skill `character_craft`) рахується від ПОВНОТИ розкладки, а
 * не напряму від `thresholdScore()` — рішення архітектурного плану,
 * розділ 6.4: «сила сюжетної події» ≠ «майстерність письма». Кандидата, що
 * не є справжнім порогом, доказом не робимо взагалі (`null`).
 */
export function thresholdEvidenceOutcome(c: ThresholdCandidate): number | null {
  if (!isRealThreshold(c)) return null;
  const feedback = thresholdFeedback(c);
  // feedback() завжди повертає 1..6 пунктів (6 умов вище); чим коротший
  // список (менше зауважень), тим повніше автор уже сам розписав поріг.
  return Math.max(-1, Math.min(1, 1 - feedback.length / 6));
}

export interface AvoidedThresholdCandidate {
  developmentArea: string;
  thresholdDescription: string;
  fear: string;
  avoidanceBehavior: string;
  shortTermReward: string;
  longTermCost: string;
  repetitions: number;
  severity: number;
}

export const AVOIDED_THRESHOLD_AREAS = [
  'autonomy',
  'identity',
  'responsibility',
  'intimacy',
  'boundaries',
  'self_expression',
  'career',
  'parenthood',
  'separation',
  'moral_maturity',
  'self_acceptance',
  'grief_acceptance',
  'meaning',
  'spiritual_maturity',
] as const;

/** Порт `AvoidedThreshold.validate()`. */
export function validateAvoidedThreshold<T extends { severity?: unknown; repetitions?: unknown }>(raw: T): T {
  return {
    ...raw,
    severity: clamp(raw.severity ?? 5, 1, 10),
    repetitions: Math.max(1, Math.round(Number(raw.repetitions ?? 1) || 1)),
  } as T;
}
