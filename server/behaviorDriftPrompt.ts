/**
 * Промпт «Детектор дрейфу поведінки» — на відміну від «Хранителя
 * цілісності» (characterConsistencyPrompt.ts), який звіряє ВСЮ картку
 * персонажа з текстом і повертає довільний список знахідок, цей модуль
 * вужчий і навпаки — відштовхується САМЕ від заявлених
 * `behaviorPatterns` (характерні шаблони поведінки в діалогах) і для
 * КОЖНОГО з них окремо перевіряє: чи текст книги його підтверджує.
 * Один запис відповіді на один заявлений патерн — а не довільна
 * кількість знахідок, як у «Хранителі». Та сама вага, що й у /design:
 * без окремого сховища, кешу чи рейт-ліміту.
 */

export const DRIFT_STATUSES = ['consistent', 'drift', 'unclear'] as const;
export type DriftStatus = (typeof DRIFT_STATUSES)[number];

export interface BehaviorDriftPatternResult {
  pattern: string;
  status: DriftStatus;
  location: string;
  quote: string;
  note: string;
}

export interface BehaviorDriftResult {
  summary: string;
  patterns: BehaviorDriftPatternResult[];
}

const CONTRACT = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):';

export function behaviorDriftSystemInstruction(): string {
  return `Ти — уважний літературний редактор. Твоє завдання — для КОЖНОГО заявленого патерну поведінки персонажа перевірити, чи текст книги йому відповідає. Патерн поведінки — це те, ЯК персонаж типово діє, говорить чи реагує (наприклад: «дивиться прямо в очі й говорить прямо»). Мова текстових полів відповіді — {МОВА}.

Для кожного патерну визнач: чи текст його ПІДТВЕРДЖУЄ (consistent), чи явно йому СУПЕРЕЧИТЬ бодай в одному епізоді (drift), чи в наданих уривках просто замало сцен, де видно поведінку персонажа, щоб судити (unclear). НЕ позначай як drift звичайний розвиток персонажа під тиском сюжетних обставин (криза, втрата, ріст, свідома зміна) — лише те, що виглядає як недогляд автора, а не свідомий сюжетний поворот.

${CONTRACT}
Поверни ЛИШЕ JSON, без markdown-огорожі й без вступного тексту:
{
  "summary": "2-3 речення загального висновку",
  "patterns": [
    {
      "pattern": "текст патерну як він поданий у списку (дослівно)",
      "status": "consistent" | "drift" | "unclear",
      "location": "де саме в тексті видно підтвердження або суперечність — напр. «Розділ 3 → Ранок у порту»",
      "quote": "дослівна цитата з наданого фрагмента, що ілюструє висновок",
      "note": "коротке пояснення висновку"
    }
  ]
}
patterns — рівно один запис на кожен заявлений патерн поведінки, у тому самому порядку, що й у списку.`;
}

export function factoryBehaviorDriftTemplate(): string {
  return [
    "Персонаж: {ІМ_Я} {ПРІЗВИЩЕ}",
    '',
    'Заявлені патерни поведінки (перевір КОЖЕН окремо):',
    '{ПАТЕРНИ_ПОВЕДІНКИ}',
    '',
    'Уривки з тексту книги, де персонаж згадується (позначено, де саме):',
    '{ЗГАДУВАННЯ_У_КНИЗІ}',
  ].join('\n');
}

export interface BehaviorDriftPromptValues {
  name?: string;
  surname?: string;
  behaviorPatterns: string;
  mentions: string;
  locale?: string;
}

export function renderBehaviorDriftSystemTemplate(template: string, v: BehaviorDriftPromptValues): string {
  return template.replace(/\{МОВА\}/g, v.locale?.trim() || 'українська');
}

export function renderBehaviorDriftUserTemplate(template: string, v: BehaviorDriftPromptValues): string {
  return template
    .replace(/\{ІМ_Я\}/g, v.name?.trim() || '')
    .replace(/\{ПРІЗВИЩЕ\}/g, v.surname?.trim() || '')
    .replace(/\{ПАТЕРНИ_ПОВЕДІНКИ\}/g, v.behaviorPatterns.trim() || 'не задано')
    .replace(/\{ЗГАДУВАННЯ_У_КНИЗІ\}/g, v.mentions);
}

/* ───────────────────────────  Нормалізація  ─────────────────────────────── */

const MAX_PATTERNS = 20;

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function statusOf(v: unknown): DriftStatus {
  const s = String(v ?? '').toLowerCase();
  return (DRIFT_STATUSES as readonly string[]).includes(s) ? (s as DriftStatus) : 'unclear';
}

/**
 * `declaredPatterns` — заявлений список з картки персонажа, переданий
 * НАЗАД сюди: якщо модель загубила текст патерну в полі `pattern`
 * (порожній рядок чи щось не те), підставляємо ОРИГІНАЛЬНИЙ заявлений
 * текст за позицією в масиві — автор має бачити СВІЙ патерн, а не
 * перефразовану моделлю версію чи порожнє поле.
 */
export function normalizeDriftResult(raw: any, declaredPatterns: string[]): BehaviorDriftResult {
  const rawPatterns: any[] = Array.isArray(raw?.patterns) ? raw.patterns : [];
  const patterns: BehaviorDriftPatternResult[] = rawPatterns.slice(0, MAX_PATTERNS).map((p: any, idx: number) => ({
    pattern: str(p?.pattern) || declaredPatterns[idx] || str(p?.pattern, 'патерн без опису'),
    status: statusOf(p?.status),
    location: str(p?.location, 'не вказано'),
    quote: str(p?.quote),
    note: str(p?.note),
  }));
  return {
    summary: str(raw?.summary, 'Модель не дала загального висновку.'),
    patterns,
  };
}

/** Модель усе одно час від часу загортає JSON в ```json — зривати дешевше, ніж втрачати результат. */
export function parseDriftResponse(text: string): any {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}
