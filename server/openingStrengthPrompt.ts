/**
 * «Сила початку» (pokraschennya-navychok.md, хвиля 2, задача 8) — окрема
 * перевірка ПЕРШОЇ сцени книги за фіксованим чек-листом: конфлікт, питання,
 * обіцянка, емоційна ставка. На відміну від решти модулів ядра
 * (server/coreAiRegistry.ts) цей НЕ реєструється там: чек-лист фіксований
 * (не потребує адмінського редагування тону, як chat чи kdp), а вага та
 * демо-режим без ключа — той самий принцип, що вже в
 * analyze-text-competences (server.ts) із тієї ж хвилі плану.
 */

export const OPENING_STRENGTH_CHECKLIST_ITEMS = [
  { id: 'conflict', labelUk: 'Конфлікт', labelEn: 'Conflict' },
  { id: 'question', labelUk: 'Питання', labelEn: 'Question' },
  { id: 'promise', labelUk: 'Обіцянка', labelEn: 'Promise' },
  { id: 'emotionalStake', labelUk: 'Емоційна ставка', labelEn: 'Emotional stake' },
] as const;

export type OpeningStrengthChecklistId = (typeof OPENING_STRENGTH_CHECKLIST_ITEMS)[number]['id'];

export interface OpeningStrengthChecklistItem {
  id: OpeningStrengthChecklistId;
  labelUk: string;
  labelEn: string;
  present: boolean;
  note: string;
  /** Дослівна цитата з наданого тексту — лишається порожньою, якщо модель її вигадала (перевіряється проти тексту). */
  quote?: string;
}

export interface OpeningStrengthResult {
  score: number;
  summary: string;
  checklist: OpeningStrengthChecklistItem[];
}

/** Той самий принцип 413, що й у /diagn і в reader-response — стеля на вхідний фрагмент. */
export const MAX_OPENING_TEXT_CHARS = 20_000;
/** Замало тексту — чек-лист про першу сцену, а не про репліку. */
export const MIN_OPENING_TEXT_CHARS = 200;

const CONTRACT = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ:';

export function openingStrengthSystemInstruction(locale?: string): string {
  const lang = locale?.trim() || 'українська';
  return `Ти — досвідчений літературний редактор, що оцінює ПЕРШУ СЦЕНУ книги — той фрагмент, який читач бачить першим і за яким вирішує, читати далі чи ні. Мова текстових полів відповіді — ${lang}.

Перевір фрагмент за чотирма пунктами чек-листа:
- conflict (конфлікт) — чи є протилежні цілі, перешкода або напруга з перших абзаців;
- question (питання) — чи виникає в читача питання, на яке хочеться дізнатися відповідь;
- promise (обіцянка) — чи дає початок обіцянку того, про що буде книга (тема, тон, ставки);
- emotionalStake (емоційна ставка) — чи зрозуміло, чому читачеві має бути не байдуже.

Для кожного пункту визнач present: true/false, дай коротку причину (note) і, якщо present === true, дослівну цитату з наданого тексту (quote) — без цитати, якщо present === false.

${CONTRACT}
Поверни ЛИШЕ JSON, без markdown-огорожі й без вступного тексту:
{
  "score": 0-100,
  "summary": "2-3 речення загальної оцінки початку",
  "checklist": [
    { "id": "conflict", "present": true, "note": "чому", "quote": "дослівна цитата або відсутня" },
    { "id": "question", "present": true, "note": "чому" },
    { "id": "promise", "present": true, "note": "чому" },
    { "id": "emotionalStake", "present": false, "note": "чому немає" }
  ]
}
checklist — рівно 4 записи, по одному на кожен id вище, у тому самому порядку.`;
}

export function buildOpeningStrengthUserPrompt(values: {
  bookTitle?: string;
  genre?: string;
  logline?: string;
  text: string;
}): string {
  return [
    `Книга: ${values.bookTitle?.trim() || 'без назви'}`,
    `Жанр: ${values.genre?.trim() || 'не вказано'}`,
    `Логлайн: ${values.logline?.trim() || 'не вказано'}`,
    '',
    'Перша сцена книги:',
    values.text,
  ].join('\n');
}

/** Модель усе одно час від часу загортає JSON в ```json — зривати дешевше, ніж втрачати результат. */
export function parseOpeningStrengthResponse(text: string): any {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Захист від «творчості» моделі (той самий принцип, що й в
 * analyze-text-competences): лишаються лише 4 відомі id чек-листа, у
 * фіксованому порядку, а цитата приймається, лише якщо вона СПРАВДІ є в
 * наданому тексті — інакше відкидається, а не показується як доказ.
 */
export function normalizeOpeningStrengthResult(raw: any, sourceText: string): OpeningStrengthResult {
  const byId = new Map<string, any>();
  if (Array.isArray(raw?.checklist)) {
    for (const item of raw.checklist) {
      if (item && typeof item.id === 'string') byId.set(item.id, item);
    }
  }

  const checklist: OpeningStrengthChecklistItem[] = OPENING_STRENGTH_CHECKLIST_ITEMS.map((spec) => {
    const item = byId.get(spec.id) || {};
    const present = item.present === true;
    const quote = typeof item.quote === 'string' && item.quote.trim() && sourceText.includes(item.quote)
      ? item.quote
      : undefined;
    return {
      id: spec.id,
      labelUk: spec.labelUk,
      labelEn: spec.labelEn,
      present,
      note: typeof item.note === 'string' ? item.note.trim() : '',
      quote: present ? quote : undefined,
    };
  });

  const rawScore = Number(raw?.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;

  return {
    score,
    summary: typeof raw?.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : 'Модель не дала загальної оцінки.',
    checklist,
  };
}
