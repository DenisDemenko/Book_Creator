/**
 * Промпт «Емоційна майстерність письменника» — за зразком
 * server/readerResponsePrompt.ts: аналізує ОДИН виділений автором фрагмент,
 * визначає емоції персонажа (основну, вторинні, приховані) і 10 критеріїв
 * майстерності передачі (докази — цитатами), а не просто рахує згадки слів
 * на позначення емоцій (п. 4 ТЗ власника). Підсумковий `mastery_score`
 * (0..100) AI НІКОЛИ не повертає — його рахує server/emotionMasteryScoring.ts
 * із сирих балів 0..10 по кожному критерію (ARCHITECTURE_EMOTION_
 * THRESHOLD_MODULES.md, розділ 4).
 */

import { MASTERY_CRITERIA, type MasteryCriterion } from './emotionMasteryScoring';

export const MAX_EMOTION_FRAGMENT_CHARS = 20_000;

const CONTRACT = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):';

export function emotionMasterySystemInstruction(): string {
  return `Ти — літературний аналітик емоцій персонажів у художній прозі. Твоя задача — НЕ клінічна діагностика й не підрахунок того, скільки разів автор НАЗВАВ емоцію словом. Фраза може не містити слова «страх», але поведінка, думки, тіло, уникнення й контекст можуть показувати страх — шукай САМЕ ЦЕ. В одному уривку можуть змішуватись кілька емоцій (напр. любов+страх, радість+провина). Мова текстових полів відповіді — {МОВА}.

Визнач ОСНОВНУ емоцію персонажа, до трьох ВТОРИННИХ (супутніх) і до двох ПРИХОВАНИХ/підтекстових. Окремо оціни 10 критеріїв МАЙСТЕРНОСТІ передачі емоції (0..10 кожен, НЕ підсумковий бал — його рахує сервер): trigger (причина емоції), stakes (ставки), body (тілесні прояви), thoughts (думки), behavior (поведінка), specificity (конкретність, а не загальні фрази), subtext (підтекст), dynamics (розвиток емоції в межах фрагмента), individuality (голос/реакція саме ЦЬОГО персонажа, а не будь-кого), reader_effect (чи дозволяє текст читачеві пережити емоцію, а не лише дізнатись про неї).

Кожен критерій підкріпи доказом: коротка дослівна цитата з наданого фрагмента + пояснення. Не вигадуй оцінку без доказу.

Розрізняй три рівні (не змішуй): емоція ПЕРСОНАЖА (те, що відчуває герой), тон ОПОВІДАЧА і очікувана емоція ЧИТАЧА — оцінюй саме емоцію персонажа.

Якщо фрагмент довгий і в ньому є розвиток емоції (напр. тривога → страх → рішучість), додай timeline — послідовність емоцій з інтенсивністю. Для короткого фрагмента без розвитку — порожній масив.

${CONTRACT}
Поверни ЛИШЕ JSON, без markdown-огорожі й без вступного тексту:
{
  "character": "ім'я персонажа, чию емоцію аналізуємо",
  "primary_emotion": {"name": "машинний код емоції англійською, напр. fear|guilt|joy|grief", "probability": 0..1, "intensity": 0..10},
  "secondary_emotions": [{"name": "...", "probability": 0..1, "intensity": 0..10}],
  "hidden_emotions": [{"name": "...", "probability": 0..1, "intensity": 0..10}],
  "mastery": {"trigger": 0..10, "stakes": 0..10, "body": 0..10, "thoughts": 0..10, "behavior": 0..10, "specificity": 0..10, "subtext": 0..10, "dynamics": 0..10, "individuality": 0..10, "reader_effect": 0..10},
  "evidence": [{"criterion": "один із кодів mastery вище", "quote": "дослівна цитата з фрагмента", "explanation": "1 речення чому це доказ саме цього критерію"}],
  "threshold_impact": "0..10 — наскільки ця емоція впливає на вибір/поріг персонажа, якщо видно з фрагмента, інакше 0",
  "timeline": [{"emotion": "машинний код", "intensity": 0..10}],
  "confidence": "0..1 — твоя впевненість у цьому аналізі"
}
secondary_emotions — до 3 записів, hidden_emotions — до 2, evidence — по одному запису МІНІМУМ на кожен критерій mastery з балом вище 0.`;
}

export function factoryEmotionMasteryTemplate(): string {
  return [
    'Книга: «{НАЗВА_КНИГИ}», жанр: {ЖАНР}.',
    'Персонаж: {ПЕРСОНАЖ}.',
    'Профіль персонажа (контекст, не переказувати): {ПРОФІЛЬ_ПЕРСОНАЖА}',
    'Стосунки персонажа, важливі для сцени: {СТОСУНКИ}',
    'Опис сцени: {ОПИС_СЦЕНИ}',
    'Поточний поріг персонажа (якщо є, контекст): {ПОТОЧНИЙ_ПОРІГ}',
    'Попередній абзац (контекст): {КОНТЕКСТ_ДО}',
    '',
    'Фрагмент, що аналізується (виділений автором):',
    '"""{ФРАГМЕНТ}"""',
    '',
    'Наступний абзац (контекст): {КОНТЕКСТ_ПІСЛЯ}',
  ].join('\n');
}

export interface EmotionMasteryPromptValues {
  bookTitle?: string;
  genre?: string;
  characterName: string;
  characterProfile?: string;
  relationshipContext?: string;
  sceneSummary?: string;
  currentThreshold?: string;
  previousParagraph?: string;
  nextParagraph?: string;
  fragment: string;
  locale?: string;
}

export function renderEmotionMasterySystemTemplate(template: string, v: EmotionMasteryPromptValues): string {
  return template.replace(/\{МОВА\}/g, v.locale?.trim() || 'українська');
}

export function renderEmotionMasteryUserTemplate(template: string, v: EmotionMasteryPromptValues): string {
  return template
    .replace(/\{НАЗВА_КНИГИ\}/g, v.bookTitle?.trim() || 'без назви')
    .replace(/\{ЖАНР\}/g, v.genre?.trim() || 'не вказано')
    .replace(/\{ПЕРСОНАЖ\}/g, v.characterName?.trim() || 'не визначено автором')
    .replace(/\{ПРОФІЛЬ_ПЕРСОНАЖА\}/g, v.characterProfile?.trim() || '(не надано)')
    .replace(/\{СТОСУНКИ\}/g, v.relationshipContext?.trim() || '(не надано)')
    .replace(/\{ОПИС_СЦЕНИ\}/g, v.sceneSummary?.trim() || '(не надано)')
    .replace(/\{ПОТОЧНИЙ_ПОРІГ\}/g, v.currentThreshold?.trim() || '(не надано)')
    .replace(/\{КОНТЕКСТ_ДО\}/g, v.previousParagraph?.trim() || '(немає)')
    .replace(/\{ФРАГМЕНТ\}/g, v.fragment)
    .replace(/\{КОНТЕКСТ_ПІСЛЯ\}/g, v.nextParagraph?.trim() || '(немає)');
}

/* ───────────────────────────  Нормалізація  ─────────────────────────────── */

export interface NormalizedEmotionCandidate {
  name: string;
  probability: number;
  intensity: number;
}

export interface NormalizedEvidence {
  criterion: MasteryCriterion | string;
  quote: string;
  explanation: string;
}

export interface NormalizedEmotionAnalysis {
  character: string;
  primaryEmotion: NormalizedEmotionCandidate;
  secondaryEmotions: NormalizedEmotionCandidate[];
  hiddenEmotions: NormalizedEmotionCandidate[];
  mastery: Record<MasteryCriterion, number>;
  evidence: NormalizedEvidence[];
  thresholdImpact: number;
  timeline: { emotion: string; intensity: number }[];
  confidence: number;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function num(v: unknown, lo: number, hi: number, fallback = lo): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

function normalizeCandidate(raw: any): NormalizedEmotionCandidate | null {
  const name = str(raw?.name);
  if (!name) return null;
  return {
    name,
    probability: num(raw?.probability, 0, 1, 0.5),
    intensity: num(raw?.intensity, 0, 10, 0),
  };
}

const MAX_SECONDARY = 3;
const MAX_HIDDEN = 2;
const MAX_EVIDENCE = 20;
const MAX_TIMELINE = 20;

export function normalizeEmotionAnalysis(raw: any): NormalizedEmotionAnalysis {
  const mastery = {} as Record<MasteryCriterion, number>;
  for (const key of MASTERY_CRITERIA) {
    mastery[key] = num(raw?.mastery?.[key], 0, 10, 0);
  }

  const primary = normalizeCandidate(raw?.primary_emotion) || { name: 'undefined', probability: 0.5, intensity: 0 };

  return {
    character: str(raw?.character, 'не визначено'),
    primaryEmotion: primary,
    secondaryEmotions: (Array.isArray(raw?.secondary_emotions) ? raw.secondary_emotions : [])
      .map(normalizeCandidate)
      .filter((c: NormalizedEmotionCandidate | null): c is NormalizedEmotionCandidate => c !== null)
      .slice(0, MAX_SECONDARY),
    hiddenEmotions: (Array.isArray(raw?.hidden_emotions) ? raw.hidden_emotions : [])
      .map(normalizeCandidate)
      .filter((c: NormalizedEmotionCandidate | null): c is NormalizedEmotionCandidate => c !== null)
      .slice(0, MAX_HIDDEN),
    mastery,
    evidence: (Array.isArray(raw?.evidence) ? raw.evidence : [])
      .map((e: any) => ({ criterion: str(e?.criterion), quote: str(e?.quote), explanation: str(e?.explanation) }))
      .filter((e: NormalizedEvidence) => e.criterion && (e.quote || e.explanation))
      .slice(0, MAX_EVIDENCE),
    thresholdImpact: num(raw?.threshold_impact, 0, 10, 0),
    timeline: (Array.isArray(raw?.timeline) ? raw.timeline : [])
      .map((t: any) => ({ emotion: str(t?.emotion), intensity: num(t?.intensity, 0, 10, 0) }))
      .filter((t: { emotion: string; intensity: number }) => t.emotion)
      .slice(0, MAX_TIMELINE),
    confidence: num(raw?.confidence, 0, 1, 0.5),
  };
}

/** Модель усе одно час від часу загортає JSON у ```json — зривати дешевше, ніж втрачати результат. */
export function parseEmotionMasteryResponse(text: string): any {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}
