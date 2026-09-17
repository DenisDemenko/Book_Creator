/**
 * Чисті формули модуля «Емоційна майстерність письменника» — 1:1 порт
 * Python-специфікації власника (MASTERY_WEIGHTS, CharacterEmotionAnalysis
 * .validate()/.mastery_score()/.mastery_level()) у TypeScript.
 *
 * Свідомо БЕЗ звернень до AI чи БД: ці функції лише рахують число з уже
 * готових даних. Так само, як server/wdi.ts не знає, звідки взявся доказ —
 * лише згортає журнал у бал, — тут ЖОДНА функція не знає, звідки взялись
 * бали критеріїв (AI, ручне редагування адміна, тест) і не має знати.
 *
 * Головний архітектурний принцип (ARCHITECTURE_EMOTION_THRESHOLD_MODULES.md,
 * розділ 4): AI повертає лише СИРІ бали 0..10 по кожному критерію.
 * mastery_score НІКОЛИ не приходить від AI — його завжди рахує цей файл.
 */

export const MASTERY_CRITERIA = [
  'trigger',
  'stakes',
  'body',
  'thoughts',
  'behavior',
  'specificity',
  'subtext',
  'dynamics',
  'individuality',
  'reader_effect',
] as const;

export type MasteryCriterion = (typeof MASTERY_CRITERIA)[number];

/** Ваги критеріїв — сума дорівнює 1.0 (перевіряється тестом). */
export const MASTERY_WEIGHTS: Record<MasteryCriterion, number> = {
  trigger: 0.08,
  stakes: 0.12,
  body: 0.08,
  thoughts: 0.1,
  behavior: 0.12,
  specificity: 0.1,
  subtext: 0.12,
  dynamics: 0.08,
  individuality: 0.1,
  reader_effect: 0.1,
};

export type MasteryScores = Record<MasteryCriterion, number>;

function clamp(v: number, lo: number, hi: number): number {
  const n = Number(v);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

/**
 * Порт `CharacterEmotionAnalysis.validate()` для блоку `mastery_scores`:
 * замість кидати виняток на зіпсований/відсутній бал (як у Python-версії,
 * де це поле власника-редактора), тут AI-відповідь ЗАВЖДИ можлива
 * зіпсованою чи неповною — тому відсутнє значення затискається до 0, а не
 * валить увесь аналіз. Той самий підхід, що й `clamp()` у server/wdiStore.ts.
 */
export function validateMasteryScores(raw: Partial<Record<string, unknown>> | null | undefined): MasteryScores {
  const out = {} as MasteryScores;
  for (const key of MASTERY_CRITERIA) {
    out[key] = clamp(raw?.[key] as number, 0, 10);
  }
  return out;
}

/** Порт `mastery_score()`: зважена сума × 10, округлена до 1 знаку — підсумок 0..100. */
export function computeMasteryScore(scores: MasteryScores): number {
  let x = 0;
  for (const key of MASTERY_CRITERIA) {
    x += (scores[key] ?? 0) * MASTERY_WEIGHTS[key];
  }
  return Math.round(x * 10 * 10) / 10;
}

/** Порт `mastery_level()` — ті самі пороги 20/40/60/75/90 з ТЗ. */
export function masteryLevelUk(score: number): string {
  const s = clamp(score, 0, 100);
  if (s <= 20) return 'дуже слабко';
  if (s <= 40) return 'слабко';
  if (s <= 60) return 'базовий рівень';
  if (s <= 75) return 'добре';
  if (s <= 90) return 'дуже добре';
  return 'майстерно';
}

/** Порт `intensity`/`threshold_impact`/`confidence` меж (п. 8 ТЗ: 0..10, 0..10, 0..1). */
export function clampIntensity(v: unknown): number {
  return clamp(v as number, 0, 10);
}
export function clampThresholdImpact(v: unknown): number {
  return clamp(v as number, 0, 10);
}
export function clampConfidence(v: unknown): number {
  return clamp(v as number, 0, 1);
}
export function clampProbability(v: unknown): number {
  return clamp(v as number, 0, 1);
}

/** Рівень довіри AI (п. 17 ТЗ): пороги 0.49/0.74/0.89. */
export function confidenceLevelUk(confidence: number): string {
  const c = clamp(confidence, 0, 1);
  if (c <= 0.49) return 'низька';
  if (c <= 0.74) return 'середня';
  if (c <= 0.89) return 'висока';
  return 'дуже висока';
}
