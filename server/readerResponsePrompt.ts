/**
 * Промпт «Емоційний відгук читача» — на відміну від решти нових
 * персонажних модулів (characterConsistencyPrompt.ts, behaviorDriftPrompt.ts),
 * цей працює НЕ з карткою персонажа, а з текстом розділу/сцени напряму:
 * симулює живу емоційну реакцію читача-бета-рідера, що бачить фрагмент
 * ВПЕРШЕ, без знання решти сюжету — де виникає цікавість, напруга,
 * нудьга, де увага може провиснути. Це не літературна критика (як
 * /diagn) і не список порад — саме симуляція реакції. Та сама вага, що
 * й у /design: без сховища, кешу чи рейт-ліміту.
 */

export const REACTION_INTENSITIES = ['low', 'medium', 'high'] as const;
export type ReactionIntensity = (typeof REACTION_INTENSITIES)[number];

export interface ReaderResponseBeat {
  emotion: string;
  intensity: ReactionIntensity;
  location: string;
  quote: string;
  note: string;
}

export interface ReaderResponseResult {
  impression: string;
  beats: ReaderResponseBeat[];
  dropOffRisk: string;
}

/** Той самий принцип 413, що й у /diagn — читач-симуляція читає лише те, що влазить у вікно моделі. */
export const MAX_REACTION_INPUT_CHARS = 60_000;

const CONTRACT = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):';

export function readerResponseSystemInstruction(): string {
  return `Ти симулюєш звичайного читача-бета-рідера, який читає наданий фрагмент книги ВПЕРШЕ, без знання решти сюжету. Опиши, що читач РЕАЛЬНО відчуває під час читання — цікавість, напругу, нудьгу, розгубленість, емоційний відгук на діалог чи опис — і В ЯКИХ МІСЦЯХ тексту ці емоції виникають. Мова текстових полів відповіді — {МОВА}.

Це НЕ літературна критика і не список порад щодо покращення тексту — це симуляція живої емоційної реакції в процесі читання. Якщо десь читацька увага могла б провиснути (задовгий опис без дії, повторення вже сказаного, відсутність конфлікту чи ставок) — заяви це окремо, а не як загальну пораду.

${CONTRACT}
Поверни ЛИШЕ JSON, без markdown-огорожі й без вступного тексту:
{
  "impression": "2-4 речення загального враження читача від фрагмента",
  "beats": [
    {
      "emotion": "яку емоцію відчуває читач у цьому місці, напр. «цікавість», «тривога», «розгубленість»",
      "intensity": "low" | "medium" | "high",
      "location": "де саме в тексті — напр. «початок сцени», «діалог з N.»",
      "quote": "дослівна цитата з наданого фрагмента, що викликає цю реакцію",
      "note": "коротко чому саме тут виникає ця емоція"
    }
  ],
  "dropOffRisk": "де читач міг би відкласти книгу, якщо такий момент є в наданому фрагменті; порожній рядок, якщо нема"
}
beats — не більш як 8 записів, найпомітніші емоційні точки фрагмента.`;
}

export function factoryReaderResponseTemplate(): string {
  return ['Розділ: {РОЗДІЛ}', 'Жанр книги: {ЖАНР}', '', 'Фрагмент тексту (читай як читач, що бачить це вперше):', '{ФРАГМЕНТ}'].join('\n');
}

export interface ReaderResponsePromptValues {
  chapterTitle?: string;
  genre?: string;
  fragment: string;
  locale?: string;
}

export function renderReaderResponseSystemTemplate(template: string, v: ReaderResponsePromptValues): string {
  return template.replace(/\{МОВА\}/g, v.locale?.trim() || 'українська');
}

export function renderReaderResponseUserTemplate(template: string, v: ReaderResponsePromptValues): string {
  return template
    .replace(/\{РОЗДІЛ\}/g, v.chapterTitle?.trim() || 'не вказано')
    .replace(/\{ЖАНР\}/g, v.genre?.trim() || 'не вказано')
    .replace(/\{ФРАГМЕНТ\}/g, v.fragment);
}

/* ───────────────────────────  Нормалізація  ─────────────────────────────── */

const MAX_BEATS = 8;

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function intensityOf(v: unknown): ReactionIntensity {
  const s = String(v ?? '').toLowerCase();
  return (REACTION_INTENSITIES as readonly string[]).includes(s) ? (s as ReactionIntensity) : 'medium';
}

export function normalizeReaderResponse(raw: any): ReaderResponseResult {
  return {
    impression: str(raw?.impression, 'Модель не дала загального враження.'),
    beats: (Array.isArray(raw?.beats) ? raw.beats : [])
      .map((b: any) => ({
        emotion: str(b?.emotion, 'без назви'),
        intensity: intensityOf(b?.intensity),
        location: str(b?.location, 'не вказано'),
        quote: str(b?.quote),
        note: str(b?.note),
      }))
      .filter((b: ReaderResponseBeat) => b.note || b.quote)
      .slice(0, MAX_BEATS),
    dropOffRisk: str(raw?.dropOffRisk, ''),
  };
}

/** Модель усе одно час від часу загортає JSON в ```json — зривати дешевше, ніж втрачати результат. */
export function parseReaderResponse(text: string): any {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}
