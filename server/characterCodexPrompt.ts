/**
 * Промпт «Автоматичний кодекс персонажа» — на відміну від «Хранителя
 * цілісності» (звіряє картку з текстом) і «Детектора дрейфу» (звіряє
 * заявлені патерни поведінки з текстом), цей модуль НІЧОГО не звіряє —
 * він КОМПІЛЮЄ з наданих згадувань персонажа в тексті книги структурований
 * перелік фактів, які текст фактично встановив про персонажа: зовнішність,
 * характер, стосунки, ключові події, інше. Корисно, щоб побачити, що
 * текст УЖЕ показав, а не лише те, що записано в картці. Та сама вага,
 * що й у /design: без окремого сховища, кешу чи рейт-ліміту.
 */

export const CODEX_CATEGORIES = ['appearance', 'personality', 'relationships', 'events', 'other'] as const;
export type CodexCategory = (typeof CODEX_CATEGORIES)[number];

export interface CharacterCodexEntry {
  category: CodexCategory;
  fact: string;
  location: string;
  quote: string;
}

export interface CharacterCodexResult {
  summary: string;
  entries: CharacterCodexEntry[];
}

const CONTRACT = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):';

export function characterCodexSystemInstruction(): string {
  return `Ти — уважний літературний редактор-архіваріус. Твоє завдання — прочитати надані уривки з тексту книги, де згадується персонаж, і скласти з них структурований кодекс: перелік конкретних фактів, які текст ФАКТИЧНО встановив про цього персонажа (а не те, що написано в довідкових полях картки — картка тобі не надається). Мова текстових полів відповіді — {МОВА}.

Кожен факт має спиратись на конкретний уривок тексту. Групуй факти за категоріями: зовнішність, характер, стосунки з іншими персонажами, ключові події за участю персонажа, інше. Не вигадуй і не домислюй — якщо в уривках немає прямих чи явно натякнутих фактів для якоїсь категорії, просто не додавай туди записів. Уникай дублювання — якщо той самий факт повторюється в кількох уривках, обери один найпоказовіший.

${CONTRACT}
Поверни ЛИШЕ JSON, без markdown-огорожі й без вступного тексту:
{
  "summary": "2-3 речення загального підсумку — яким персонаж постає з тексту",
  "entries": [
    {
      "category": "appearance" | "personality" | "relationships" | "events" | "other",
      "fact": "короткий конкретний факт, встановлений текстом",
      "location": "де саме в тексті — напр. «Розділ 3 → Ранок у порту»",
      "quote": "дослівна цитата з наданого фрагмента, що підтверджує факт"
    }
  ]
}
entries — до 40 записів, лише ті, що дійсно підтверджені уривками.`;
}

export function factoryCharacterCodexTemplate(): string {
  return [
    "Персонаж: {ІМ_Я} {ПРІЗВИЩЕ} {ПСЕВДО}",
    '',
    'Уривки з тексту книги, де персонаж згадується (позначено, де саме):',
    '{ЗГАДУВАННЯ_У_КНИЗІ}',
  ].join('\n');
}

export interface CharacterCodexPromptValues {
  name?: string;
  surname?: string;
  alias?: string;
  mentions: string;
  locale?: string;
}

export function renderCharacterCodexSystemTemplate(template: string, v: CharacterCodexPromptValues): string {
  return template.replace(/\{МОВА\}/g, v.locale?.trim() || 'українська');
}

export function renderCharacterCodexUserTemplate(template: string, v: CharacterCodexPromptValues): string {
  return template
    .replace(/\{ІМ_Я\}/g, v.name?.trim() || '')
    .replace(/\{ПРІЗВИЩЕ\}/g, v.surname?.trim() || '')
    .replace(/\{ПСЕВДО\}/g, v.alias?.trim() ? `(«${v.alias.trim()}»)` : '')
    .replace(/\{ЗГАДУВАННЯ_У_КНИЗІ\}/g, v.mentions);
}

/* ───────────────────────────  Нормалізація  ─────────────────────────────── */

const MAX_ENTRIES = 40;

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function categoryOf(v: unknown): CodexCategory {
  const s = String(v ?? '').toLowerCase();
  return (CODEX_CATEGORIES as readonly string[]).includes(s) ? (s as CodexCategory) : 'other';
}

export function normalizeCodexResult(raw: any): CharacterCodexResult {
  return {
    summary: str(raw?.summary, 'Модель не дала загального підсумку.'),
    entries: (Array.isArray(raw?.entries) ? raw.entries : [])
      .map((e: any) => ({
        category: categoryOf(e?.category),
        fact: str(e?.fact),
        location: str(e?.location, 'не вказано'),
        quote: str(e?.quote),
      }))
      .filter((e: CharacterCodexEntry) => e.fact)
      .slice(0, MAX_ENTRIES),
  };
}

/** Модель усе одно час від часу загортає JSON в ```json — зривати дешевше, ніж втрачати результат. */
export function parseCodexResponse(text: string): any {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}
