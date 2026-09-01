/**
 * Промпт «Хранитель цілісності персонажа» — AI шукає СУПЕРЕЧНОСТІ в тому,
 * як персонаж описаний у своїй картці (зовнішність, характер, біографія,
 * стосунки, патерни поведінки), порівняно з тим, як він насправді
 * зображений у тексті книги: колір очей, вік, стосунки, манера мовлення
 * можуть «розповзатись» між розділами, написаними в різний час.
 *
 * Той самий принцип нормалізації відповіді моделі, що й у /diagn
 * (diagnPrompt.ts) — кожне поле має запасне значення й межі, бо картка
 * персонажа малює список знахідок, а не показує сирий текст моделі.
 * На відміну від /diagn (спец. ТЗ v1.0, з рейт-лімітом і кешем на добу),
 * цей модуль ближчий за вагою до /design (designLayoutPrompt.ts) —
 * власний факторний шаблон + нормалізація, без окремого сховища.
 */

/** Стеля символів на текст зібраних згадувань персонажа — 413, а не тихе обрізання (той самий принцип, що й /diagn). Сама вибірка згадувань (characterMentions.ts) вже обмежена кількістю, тож на практиці ця стеля — останній рубіж, а не основний механізм. */
export const MAX_MENTIONS_CHARS = 40_000;

export const CONSISTENCY_SEVERITIES = ['low', 'medium', 'high'] as const;
export type ConsistencySeverity = (typeof CONSISTENCY_SEVERITIES)[number];

export interface CharacterConsistencyFinding {
  severity: ConsistencySeverity;
  field: string;
  location: string;
  quote: string;
  issue: string;
}

export interface CharacterConsistencyResult {
  summary: string;
  findings: CharacterConsistencyFinding[];
}

const CONTRACT = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):';

export function characterConsistencySystemInstruction(): string {
  return `Ти — уважний літературний редактор-фактчекер. Твоє завдання — знайти суперечності в тому, як персонаж описаний у своїй картці (зовнішність, характер, біографія, стосунки, патерни поведінки), порівняно з тим, як він насправді зображений у наданих уривках з тексту книги. Мова текстових полів відповіді — {МОВА}.

Шукай конкретне: колір очей чи волосся, що змінюється; вік, що не сходиться з хронологією; стосунки, що суперечать заявленим; манеру мовлення, що не схожа на заявлені патерни поведінки. НЕ повідомляй про звичайний розвиток персонажа чи художні прийоми (флешбеки, ненадійний оповідач, цитати інших персонажів ПРО нього) як про суперечність — лише про те, що виглядає як недогляд автора.

${CONTRACT}
Поверни ЛИШЕ JSON, без markdown-огорожі й без вступного тексту:
{
  "summary": "2-3 речення загального висновку",
  "findings": [
    {
      "severity": "low" | "medium" | "high",
      "field": "яке поле картки суперечність зачіпає, напр. «Очі» чи «Вік»",
      "location": "де саме в тексті — напр. «Розділ 3 → Ранок у порту»",
      "quote": "дослівна цитата з наданого фрагмента, де видно суперечність",
      "issue": "у чому саме суперечність, коротко"
    }
  ]
}
findings — порожній масив, якщо суперечностей не знайдено. severity — рівно одне зі значень low, medium, high.`;
}

export function factoryCharacterConsistencyTemplate(): string {
  return [
    'Картка персонажа:',
    "Ім'я: {ІМ_Я} {ПРІЗВИЩЕ} {ПСЕВДО}",
    'Роль: {РОЛЬ}, вік: {ВІК}, стать: {СТАТЬ}, професія: {ПРОФЕСІЯ}',
    'Зовнішність: {ЗОВНІШНІСТЬ}',
    'Характер: {ХАРАКТЕР}',
    'Біографія: {БІОГРАФІЯ}',
    'Стосунки: {СТОСУНКИ}',
    'Заявлені патерни поведінки: {ПАТЕРНИ_ПОВЕДІНКИ}',
    '',
    'Уривки з тексту книги, де персонаж згадується (позначено, де саме):',
    '{ЗГАДУВАННЯ_У_КНИЗІ}',
  ].join('\n');
}

export interface CharacterConsistencyPromptValues {
  name?: string;
  surname?: string;
  alias?: string;
  role?: string;
  age?: string;
  gender?: string;
  profession?: string;
  appearance?: string;
  personality?: string;
  biography?: string;
  relationships?: string;
  behaviorPatterns?: string;
  mentions: string;
  locale?: string;
}

export function renderCharacterConsistencySystemTemplate(template: string, v: CharacterConsistencyPromptValues): string {
  return template.replace(/\{МОВА\}/g, v.locale?.trim() || 'українська');
}

export function renderCharacterConsistencyUserTemplate(template: string, v: CharacterConsistencyPromptValues): string {
  return template
    .replace(/\{ІМ_Я\}/g, v.name?.trim() || '')
    .replace(/\{ПРІЗВИЩЕ\}/g, v.surname?.trim() || '')
    .replace(/\{ПСЕВДО\}/g, v.alias?.trim() ? `(«${v.alias.trim()}»)` : '')
    .replace(/\{РОЛЬ\}/g, v.role?.trim() || 'не вказано')
    .replace(/\{ВІК\}/g, v.age?.trim() || 'не вказано')
    .replace(/\{СТАТЬ\}/g, v.gender?.trim() || 'не вказано')
    .replace(/\{ПРОФЕСІЯ\}/g, v.profession?.trim() || 'не вказано')
    .replace(/\{ЗОВНІШНІСТЬ\}/g, v.appearance?.trim() || 'не описано в картці')
    .replace(/\{ХАРАКТЕР\}/g, v.personality?.trim() || 'не описано в картці')
    .replace(/\{БІОГРАФІЯ\}/g, v.biography?.trim() || 'не описано в картці')
    .replace(/\{СТОСУНКИ\}/g, v.relationships?.trim() || 'не описано в картці')
    .replace(/\{ПАТЕРНИ_ПОВЕДІНКИ\}/g, v.behaviorPatterns?.trim() || 'не задано')
    .replace(/\{ЗГАДУВАННЯ_У_КНИЗІ\}/g, v.mentions);
}

/* ───────────────────────────  Нормалізація  ─────────────────────────────── */

const MAX_FINDINGS = 20;

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function severityOf(v: unknown): ConsistencySeverity {
  const s = String(v ?? '').toLowerCase();
  return (CONSISTENCY_SEVERITIES as readonly string[]).includes(s) ? (s as ConsistencySeverity) : 'medium';
}

export function normalizeConsistencyResult(raw: any): CharacterConsistencyResult {
  return {
    summary: str(raw?.summary, 'Модель не дала загального висновку.'),
    findings: (Array.isArray(raw?.findings) ? raw.findings : [])
      .map((f: any) => ({
        severity: severityOf(f?.severity),
        field: str(f?.field, 'загальне'),
        location: str(f?.location, 'не вказано'),
        quote: str(f?.quote),
        issue: str(f?.issue),
      }))
      .filter((f: CharacterConsistencyFinding) => f.issue)
      .slice(0, MAX_FINDINGS),
  };
}

/** Модель усе одно час від часу загортає JSON в ```json — зривати дешевше, ніж втрачати результат. */
export function parseConsistencyResponse(text: string): any {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}
