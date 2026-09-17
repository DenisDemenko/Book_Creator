/**
 * Промпт «Поріг» — за тим самим зразком, що й server/emotionMasteryPrompt.ts.
 * AI лише ПРОПОНУЄ кандидата в поріг (структуровані поля + докази), автор
 * підтверджує/редагує (ARCHITECTURE_EMOTION_THRESHOLD_MODULES.md, розділ
 * 6.3) — ніщо звідси не пишеться в БД автоматично. `score()`/`strength()`/
 * `is_real_threshold()`/`feedback()` рахує лише server/thresholdScoring.ts,
 * ніколи AI.
 */

import { THRESHOLD_TYPES } from './thresholdScoring';

export const MAX_THRESHOLD_FRAGMENT_CHARS = 20_000;

const CONTRACT = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):';

export function thresholdSystemInstruction(): string {
  return `Ти — літературний аналітик, що шукає в наданому фрагменті ПОРІГ — момент, коли персонаж робить значущий вибір, приймає ризик, платить (чи ризикує заплатити) ціну, переходить у новий стан і не може легко повернутись до попереднього. Мова текстових полів відповіді — {МОВА}.

Це не будь-яка важлива подія: якщо персонаж лише говорить про можливий вибір, але нічого не робить і не змінюється — це НЕ поріг, і ти маєш чесно повернути is_threshold_candidate: false, а не натягувати кандидата на будь-яку сцену.

Якщо поріг є — визнач: стан ДО, сам вибір, дію переходу, стан ПІСЛЯ, до 3 типів порогу (physical/psychological/social/moral/relationship/professional/intellectual/spiritual/existential), профіль ризику за 5 осями (physical/emotional/social/material/existential, 1..10 кожна), ціну (cost), незворотність (irreversibility), трансформаційний потенціал (transformation), усвідомленість героя (awareness) і добровільність його дії (agency) — усі 1..10. НЕ рахуй підсумковий бал — лише сирі поля.

${CONTRACT}
Поверни ЛИШЕ JSON, без markdown-огорожі й без вступного тексту:
{
  "is_threshold_candidate": true | false,
  "character": "ім'я персонажа",
  "title": "коротка назва порогу (3-6 слів)",
  "description": "1-2 речення опису порогу",
  "types": ["до 3 значень з: physical|psychological|social|moral|relationship|professional|intellectual|spiritual|existential"],
  "before_state": "стан персонажа ДО",
  "choice": "сам вибір персонажа",
  "crossing_action": "дія переходу",
  "after_state": "стан персонажа ПІСЛЯ",
  "risks": {"physical": 1..10, "emotional": 1..10, "social": 1..10, "material": 1..10, "existential": 1..10},
  "cost": 1..10,
  "irreversibility": 1..10,
  "transformation": 1..10,
  "awareness": 1..10,
  "agency": 1..10,
  "evidence_quote": "дослівна цитата з фрагмента, що показує цей поріг",
  "confidence": "0..1 — твоя впевненість, що це справжній поріг"
}
Якщо is_threshold_candidate: false — усі інші поля, крім character і description (коротко поясни чому це не поріг), можуть бути порожніми/нульовими.`;
}

export function factoryThresholdTemplate(): string {
  return [
    'Книга: «{НАЗВА_КНИГИ}», жанр: {ЖАНР}.',
    'Персонаж: {ПЕРСОНАЖ}.',
    'Профіль персонажа (контекст, не переказувати): {ПРОФІЛЬ_ПЕРСОНАЖА}',
    'Опис сцени: {ОПИС_СЦЕНИ}',
    '',
    'Фрагмент, що аналізується (виділений автором):',
    '"""{ФРАГМЕНТ}"""',
  ].join('\n');
}

export interface ThresholdPromptValues {
  bookTitle?: string;
  genre?: string;
  characterName: string;
  characterProfile?: string;
  sceneSummary?: string;
  fragment: string;
  locale?: string;
}

export function renderThresholdSystemTemplate(template: string, v: ThresholdPromptValues): string {
  return template.replace(/\{МОВА\}/g, v.locale?.trim() || 'українська');
}

export function renderThresholdUserTemplate(template: string, v: ThresholdPromptValues): string {
  return template
    .replace(/\{НАЗВА_КНИГИ\}/g, v.bookTitle?.trim() || 'без назви')
    .replace(/\{ЖАНР\}/g, v.genre?.trim() || 'не вказано')
    .replace(/\{ПЕРСОНАЖ\}/g, v.characterName?.trim() || 'не визначено автором')
    .replace(/\{ПРОФІЛЬ_ПЕРСОНАЖА\}/g, v.characterProfile?.trim() || '(не надано)')
    .replace(/\{ОПИС_СЦЕНИ\}/g, v.sceneSummary?.trim() || '(не надано)')
    .replace(/\{ФРАГМЕНТ\}/g, v.fragment);
}

/* ───────────────────────────  Нормалізація  ─────────────────────────────── */

export interface NormalizedThresholdCandidate {
  isThresholdCandidate: boolean;
  character: string;
  title: string;
  description: string;
  types: string[];
  beforeState: string;
  choice: string;
  crossingAction: string;
  afterState: string;
  risks: { physical: number; emotional: number; social: number; material: number; existential: number };
  cost: number;
  irreversibility: number;
  transformation: number;
  awareness: number;
  agency: number;
  evidenceQuote: string;
  confidence: number;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function num(v: unknown, lo: number, hi: number, fallback = lo): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

export function normalizeThresholdCandidate(raw: any): NormalizedThresholdCandidate {
  const types = (Array.isArray(raw?.types) ? raw.types : [])
    .map((t: unknown) => String(t))
    .filter((t: string) => (THRESHOLD_TYPES as string[]).includes(t))
    .slice(0, 3);

  return {
    isThresholdCandidate: Boolean(raw?.is_threshold_candidate),
    character: str(raw?.character, 'не визначено'),
    title: str(raw?.title),
    description: str(raw?.description),
    types,
    beforeState: str(raw?.before_state),
    choice: str(raw?.choice),
    crossingAction: str(raw?.crossing_action),
    afterState: str(raw?.after_state),
    risks: {
      physical: num(raw?.risks?.physical, 1, 10, 1),
      emotional: num(raw?.risks?.emotional, 1, 10, 1),
      social: num(raw?.risks?.social, 1, 10, 1),
      material: num(raw?.risks?.material, 1, 10, 1),
      existential: num(raw?.risks?.existential, 1, 10, 1),
    },
    cost: num(raw?.cost, 1, 10, 1),
    irreversibility: num(raw?.irreversibility, 1, 10, 1),
    transformation: num(raw?.transformation, 1, 10, 1),
    awareness: num(raw?.awareness, 1, 10, 5),
    agency: num(raw?.agency, 1, 10, 5),
    evidenceQuote: str(raw?.evidence_quote),
    confidence: num(raw?.confidence, 0, 1, 0.5),
  };
}

/** Модель усе одно час від часу загортає JSON у ```json — зривати дешевше, ніж втрачати результат. */
export function parseThresholdResponse(text: string): any {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}
