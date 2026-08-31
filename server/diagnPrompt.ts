/**
 * Модуль /diagn — AI-діагностика тексту й авторського профілю
 * (diagn-module-tech-spec-v1.0.md).
 *
 * Тут — усе, що можна перевірити без мережі: розбір команди, три промти
 * підмодулів і зведення відповіді моделі до форми, яку картка справді
 * може намалювати. Мережа, база й маршрути — у сусідніх файлах.
 *
 * Чому нормалізація займає більше місця, ніж промти. Картка малює
 * прогрес-бари, радар і кольорові бейджі severity. Модель, яка віддала
 * score 140, порожній масив метрик або severity «критично» замість
 * «high», не викликає жодної помилки — вона дає бар довжиною півтора
 * екрана і сірий бейдж без пояснення. Тому кожне поле схеми має тут
 * запасне значення й межі, а не сподівання на слухняність моделі.
 */

export const DIAGN_MODULES = ['style', 'structure', 'competency'] as const;
export type DiagnModule = (typeof DIAGN_MODULES)[number];

export const DIAGN_FORMATS = ['card', 'pdf', 'docx'] as const;
export type DiagnFormat = (typeof DIAGN_FORMATS)[number];

/** ТЗ §8: нижче 300 слів аналіз стилю й структури недостовірний. */
export const MIN_WORDS_FOR_ANALYSIS = 300;

/** ТЗ §4: 413 замість мовчазного обрізання — автор має знати, що текст не влазить. */
export const MAX_INPUT_CHARS = 60_000;

/** ТЗ §8: 10 діагностик на годину. Значення тут, бо це властивість модуля, а не маршруту. */
export const DIAGN_RATE_LIMIT_PER_HOUR = 10;

/** ТЗ §7: доба кешу — повторний запит на той самий текст не витрачає квоту. */
export const DIAGN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/* ────────────────────────────  Розбір команди  ──────────────────────────── */

export interface ParsedDiagnCommand {
  /** Текст або посилання на документ; порожній рядок — беремо поточний рукопис. */
  input: string;
  inputKind: 'raw_text' | 'document_ref';
  modules: DiagnModule[];
  format: DiagnFormat;
  /** Прапорці, які ми не впізнали, — показуємо автору, а не ковтаємо. */
  unknownFlags: string[];
}

/**
 * `/diagn [текст] [--module=…] [--format=…]`.
 *
 * Невідомий модуль не перетворюємо на `all`: ТЗ §4 вимагає 422 саме на
 * такий випадок, і мовчазна заміна на «усе» коштувала б три виклики
 * моделі там, де автор просто помилився в слові.
 */
export function parseDiagnCommand(raw: string): ParsedDiagnCommand {
  const text = String(raw ?? '').trim().replace(/^\/diagn\b/i, '').trim();

  const modules: DiagnModule[] = [];
  const unknownFlags: string[] = [];
  let format: DiagnFormat = 'card';
  let moduleSeen = false;

  const rest = text.replace(/--([a-z]+)=([^\s"']+)/gi, (_m, key: string, value: string) => {
    const k = key.toLowerCase();
    const v = value.toLowerCase();
    if (k === 'module' || k === 'modules') {
      moduleSeen = true;
      for (const part of v.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (part === 'all') modules.push(...DIAGN_MODULES);
        else if ((DIAGN_MODULES as readonly string[]).includes(part)) modules.push(part as DiagnModule);
        else unknownFlags.push(`--module=${part}`);
      }
    } else if (k === 'format') {
      if ((DIAGN_FORMATS as readonly string[]).includes(v)) format = v as DiagnFormat;
      else unknownFlags.push(`--format=${v}`);
    } else {
      unknownFlags.push(`--${key}=${value}`);
    }
    return ' ';
  });

  const input = rest.trim().replace(/^["'](.*)["']$/s, '$1').trim();
  const isDocRef = /^doc:[\w-]+$/i.test(input);

  // За замовчуванням — усі три (ТЗ §2). Але якщо автор написав --module і
  // жодне значення не впізнано, порожній список має дійти до маршруту й
  // стати 422, а не тихо перетворитись на «усе».
  const resolved = modules.length > 0 ? [...new Set(modules)] : moduleSeen ? [] : [...DIAGN_MODULES];

  return {
    input,
    inputKind: isDocRef ? 'document_ref' : 'raw_text',
    modules: resolved,
    format,
    unknownFlags,
  };
}

export function countWords(text: string): number {
  const t = String(text ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/* ─────────────────────────────  Схеми відповіді  ────────────────────────── */

const CONTRACT = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):';

export const DIAGN_SCHEMAS: Record<DiagnModule, string> = {
  style: `${CONTRACT}
Поверни ЛИШЕ JSON, без markdown-огорожі й без вступного тексту:
{
  "summary": "2-3 речення про авторський стиль",
  "metrics": {
    "sentence_rhythm":   { "score": 0-100, "label": "коротка характеристика" },
    "lexical_diversity": { "score": 0-100, "label": "коротка характеристика" },
    "dialogue_ratio":    { "score": 0-100, "label": "коротка характеристика" }
  },
  "highlights": [ { "excerpt": "цитата з тексту", "note": "чому вона показова" } ],
  "recommendations": ["що конкретно змінити", "..."]
}
score — ціле число 0-100. highlights — 2-4 елементи, excerpt береться з наданого тексту дослівно.`,

  structure: `${CONTRACT}
Поверни ЛИШЕ JSON, без markdown-огорожі й без вступного тексту:
{
  "summary": "2-3 речення про драматургію фрагмента",
  "detected_archetype": "номер і назва ситуації Польті, напр. «Польті 33: Помилкове судження»",
  "arc_position": "стадія шляху героя, напр. «Заклик до пригоди»",
  "deviations": [ { "type": "коротка назва", "description": "у чому саме", "severity": "low|medium|high" } ],
  "recommendations": ["що конкретно змінити", "..."]
}
severity — рівно одне зі значень low, medium, high.`,

  competency: `${CONTRACT}
Поверни ЛИШЕ JSON, без markdown-огорожі й без вступного тексту:
{
  "summary": "2-3 речення про рівень автора",
  "radar": [ { "skill": "назва компетенції зі списку", "score": 0-100 } ],
  "gaps": ["чого бракує"],
  "next_exercises": ["конкретна вправа"]
}
radar — рівно по одному запису на кожну компетенцію зі списку, у тому ж порядку.`,
};

/**
 * Компетенції платформи. Продубльовано з src/data/skillsData.ts свідомо:
 * жоден server/*.ts не читає з src/ (сервер збирається окремо). Розходження
 * ловить тест — інакше радар малював би вісі, яких немає в карті навичок
 * автора, і порівнювати діагностики в часі стало б неможливо.
 */
export const COMPETENCY_AXES = [
  'Мислення',
  'Ідея та концепція',
  'Сюжет та структура',
  'Персонажі',
  'Майстерність письма',
  'Емоційний вплив',
  'Редактура',
  'Підготовка книги',
  'Візуальна майстерність',
  'Автор та розвиток',
];

/* ──────────────────────────────  Промти  ────────────────────────────────── */

export function diagnSystemInstruction(module: DiagnModule): string {
  const base =
    'Ти — досвідчений літературний редактор. Відповідай ЛИШЕ у форматі JSON, без markdown-обгортки й без вступного тексту. ' +
    'Мова всіх текстових полів — {МОВА}. Стислість обовʼязкова: summary — 2-3 речення.';
  const tail: Record<DiagnModule, string> = {
    style: ' Аналізуй синтаксис, лексику, ритм і діалоги. Цитати бери дослівно з наданого тексту, не вигадуй їх.',
    structure:
      ' Аналізуй драматургію: 36 ситуацій Жоржа Польті та стадії шляху героя. Якщо фрагмент замалий для впевненого висновку — скажи про це в summary, а не вигадуй архетип.',
    competency:
      ' Оцінюй автора за наданою картою компетенцій. Оцінка спирається на текст, а не на побажання: слабке місце краще назвати прямо, ніж підбадьорити.',
  };
  // Схема — у системній інструкції, як у решти JSON-модулів ядра: саме
  // її конструктор промтів показує readonly після маркера контракту.
  return [base + tail[module], '', DIAGN_SCHEMAS[module]].join('\n');
}

export function factoryDiagnTemplate(module: DiagnModule): string {
  const head = `Книга: {НАЗВА_КНИГИ}\nЖанр: {ЖАНР}\n\n`;
  if (module === 'competency') {
    return (
      head +
      `Карта компетенцій платформи:\n{КОМПЕТЕНЦІЇ}\n\n` +
      `Текст автора для оцінювання:\n{ФРАГМЕНТ}\n\n` +
      `Оціни кожну компетенцію за текстом.`
    );
  }
  return head + `Текст для аналізу:\n{ФРАГМЕНТ}\n`;
}

export interface DiagnPromptValues {
  bookTitle?: string;
  genre?: string;
  fragment: string;
  competencies?: string;
  locale?: string;
}

export function renderDiagnTemplate(template: string, v: DiagnPromptValues): string {
  return String(template)
    .replace(/\{НАЗВА_КНИГИ\}/g, v.bookTitle?.trim() || 'без назви')
    .replace(/\{ЖАНР\}/g, v.genre?.trim() || 'не вказано')
    .replace(/\{КОМПЕТЕНЦІЇ\}/g, v.competencies?.trim() || COMPETENCY_AXES.join(', '))
    .replace(/\{МОВА\}/g, v.locale?.trim() || 'українська')
    .replace(/\{ФРАГМЕНТ\}/g, v.fragment);
}

/* ───────────────────────────  Нормалізація  ─────────────────────────────── */

export interface DiagnMetric { score: number; label: string }
export interface DiagnStyleResult {
  summary: string;
  metrics: Record<'sentence_rhythm' | 'lexical_diversity' | 'dialogue_ratio', DiagnMetric>;
  highlights: { excerpt: string; note: string }[];
  recommendations: string[];
}
export interface DiagnStructureResult {
  summary: string;
  detected_archetype: string;
  arc_position: string;
  deviations: { type: string; description: string; severity: 'low' | 'medium' | 'high' }[];
  recommendations: string[];
}
export interface DiagnCompetencyResult {
  summary: string;
  radar: { skill: string; score: number }[];
  gaps: string[];
  next_exercises: string[];
}

const MAX_LIST = 8;

function clampScore(v: unknown): number {
  // null/''/undefined — «модель поля не дала». Number(null) === 0 намалював
  // би нульовий бар, тобто твердження «нуль зі ста», якого модель не робила.
  if (v === null || v === undefined || v === '') return 50;
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function strList(v: unknown, limit = MAX_LIST): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter(Boolean).slice(0, limit);
}

function metric(v: any): DiagnMetric {
  return { score: clampScore(v?.score), label: str(v?.label, 'без характеристики') };
}

export function normalizeStyleResult(raw: any): DiagnStyleResult {
  const m = raw?.metrics ?? {};
  return {
    summary: str(raw?.summary, 'Модель не дала загального висновку.'),
    metrics: {
      sentence_rhythm: metric(m.sentence_rhythm),
      lexical_diversity: metric(m.lexical_diversity),
      dialogue_ratio: metric(m.dialogue_ratio),
    },
    highlights: (Array.isArray(raw?.highlights) ? raw.highlights : [])
      .map((h: any) => ({ excerpt: str(h?.excerpt), note: str(h?.note) }))
      .filter((h: any) => h.excerpt)
      .slice(0, 4),
    recommendations: strList(raw?.recommendations),
  };
}

const SEVERITIES = ['low', 'medium', 'high'] as const;

export function normalizeStructureResult(raw: any): DiagnStructureResult {
  return {
    summary: str(raw?.summary, 'Модель не дала загального висновку.'),
    detected_archetype: str(raw?.detected_archetype, 'не визначено'),
    arc_position: str(raw?.arc_position, 'не визначено'),
    deviations: (Array.isArray(raw?.deviations) ? raw.deviations : [])
      .map((d: any) => {
        const s = String(d?.severity ?? '').toLowerCase();
        return {
          type: str(d?.type, 'відхилення'),
          description: str(d?.description),
          // Невідома градація — «medium»: не тривожимо червоним і не
          // ховаємо зеленим те, про що модель нічого певного не сказала.
          severity: ((SEVERITIES as readonly string[]).includes(s) ? s : 'medium') as 'low' | 'medium' | 'high',
        };
      })
      .filter((d: any) => d.description)
      .slice(0, MAX_LIST),
    recommendations: strList(raw?.recommendations),
  };
}

/**
 * Радар зводимо до осей платформи: у тому ж порядку, без чужих осей і без
 * дірок. Радар зі змінним складом осей неможливо порівняти з попередньою
 * діагностикою — а порівняння в часі і є тим, заради чого ТЗ §7 просить
 * зберігати історію.
 */
export function normalizeCompetencyResult(raw: any, axes: string[] = COMPETENCY_AXES): DiagnCompetencyResult {
  const given = new Map<string, number>();
  if (Array.isArray(raw?.radar)) {
    for (const r of raw.radar) {
      const skill = str(r?.skill);
      if (skill) given.set(skill.toLowerCase(), clampScore(r?.score));
    }
  }
  return {
    summary: str(raw?.summary, 'Модель не дала загального висновку.'),
    radar: axes.map((skill) => ({
      skill,
      score: given.has(skill.toLowerCase()) ? given.get(skill.toLowerCase())! : 50,
    })),
    gaps: strList(raw?.gaps),
    next_exercises: strList(raw?.next_exercises),
  };
}

export function normalizeDiagnResult(module: DiagnModule, raw: any) {
  if (module === 'style') return normalizeStyleResult(raw);
  if (module === 'structure') return normalizeStructureResult(raw);
  return normalizeCompetencyResult(raw);
}

/** Модель усе одно час від часу загортає JSON в ```json — зривати дешевше, ніж втрачати діагностику. */
export function parseDiagnResponse(text: string): any {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}
