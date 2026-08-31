/**
 * Модуль `/design` — оформлення набраного тексту перед показом у «Розвороті
 * книги».
 *
 * Що саме тут відбувається, і чому саме так. «Застосувати дизайн» у книжковій
 * верстці — це не довільний CSS, а набір рішень про типографіку й поля:
 * гарнітура, кегль, інтерліньяж, абзацний відступ, вирівнювання, положення
 * колонцифри, розміри полів із корінцем. Саме з цих значень складається
 * `book.layoutConfig`, за яким «Розворот книги» (BookPreviewView) і рахує
 * сторінки. Тому модель тут повертає СТРУКТУРУ (JSON за жорсткою схемою), а
 * не розмітку: інакше кожна генерація давала б несумісний із верстальником
 * результат, який нікуди прикласти.
 *
 * Друга причина — друк. Значення полів мають фізичні наслідки: замалий
 * внутрішній відступ у KDP означає текст, що заходить у корінець, і книгу,
 * яку не можна прочитати біля згину. Модель про це не знає й знати не
 * зобовʼязана, тож усе, що вона повертає, проходить через clampDesignPatch()
 * — межі беруться з реальних вимог, а не з уяви моделі.
 */

/** Мінімальні поля, з якими книга лишається придатною до друку (KDP, мм). */
export const MIN_MARGIN_MM = {
  top: 12,
  bottom: 12,
  /** Корінець: чим товща книга, тим більший, але нижче цього не опускаємось. */
  inside: 15,
  outside: 12,
} as const;

export const MAX_MARGIN_MM = 40;

export interface DesignLayoutPromptValues {
  bookTitle?: string;
  genre?: string;
  audience?: string;
  /** Формат сторінки словами — «152×229 мм (6×9″)». */
  pageFormat?: string;
  /** Гарнітури, які реально доступні книзі, — модель не має права вигадати свою. */
  availableFonts?: string;
  /** Фрагмент справжнього тексту: за ним видно довжину речень і щільність діалогів. */
  sampleText?: string;
}

const MAX_SAMPLE_CHARS = 4000;

/**
 * Схема відповіді. Живе в системній інструкції й НЕ редагується адміном —
 * її поля мають точно відповідати `BookLayoutConfig`, інакше застосувати
 * відповідь буде нікуди. Адмін править сам стиль міркування, не контракт.
 */
export const DESIGN_LAYOUT_SCHEMA = `⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):
Відповідай ЛИШЕ валідним JSON без markdown-обгортки й без пояснень до чи після:
{
  "typography": {
    "bodyFont": "рядок — рівно одна з доступних гарнітур",
    "headingsFont": "рядок — рівно одна з доступних гарнітур",
    "fontSizePt": число 8-14,
    "lineHeight": число 1.1-2.0,
    "firstLineIndentMm": число 0-15,
    "paragraphSpacingMm": число 0-8,
    "textAlign": "justify" | "left",
    "pageNumberPosition": "bottom-center" | "bottom-outside" | "top-outside",
    "showHeaders": true | false
  },
  "margins": {
    "topMm": число 12-40,
    "bottomMm": число 12-40,
    "insideMm": число 15-40,
    "outsideMm": число 12-40
  },
  "rationale": "рядок — 2-3 речення українською: чому саме такі рішення для цієї книги"
}`;

export function designLayoutSystemInstruction(): string {
  return [
    'Ти — книжковий дизайнер-верстальник із досвідом підготовки художніх книг до друку.',
    'Твоє завдання — підібрати типографіку й поля під конкретну книгу: жанр, аудиторію, формат сторінки та',
    'характер самого тексту (довжина речень, частка діалогів, наявність ілюстрацій).',
    'Рішення мають бути придатними до друку: текст не повинен заходити в корінець, кегль — читабельним для',
    'цільової аудиторії, інтерліньяж — співмірним із довжиною рядка.',
    '',
    DESIGN_LAYOUT_SCHEMA,
  ].join('\n');
}

/** Заводський шаблон користувацької половини промту. */
export function factoryDesignLayoutTemplate(): string {
  return [
    'Книга: «{НАЗВА_КНИГИ}».',
    'Жанр: {ЖАНР}.',
    'Цільова аудиторія: {АУДИТОРІЯ}.',
    'Формат сторінки: {ФОРМАТ_СТОРІНКИ}.',
    'Доступні гарнітури (обирай ЛИШЕ з цього переліку, точними назвами): {ШРИФТИ}.',
    'Фрагмент справжнього тексту книги — за ним оціни довжину речень, щільність діалогів і темп:\n"""\n{ФРАГМЕНТ}\n"""',
    'Підбери типографіку й поля для цієї книги і поверни їх у форматі, заданому системною інструкцією.',
  ].join('\n\n');
}

export function renderDesignLayoutTemplate(template: string, values: DesignLayoutPromptValues): string {
  const map: Record<string, string | undefined> = {
    '{НАЗВА_КНИГИ}': values.bookTitle?.trim() || 'без назви',
    '{ЖАНР}': values.genre?.trim() || undefined,
    '{АУДИТОРІЯ}': values.audience?.trim() || undefined,
    '{ФОРМАТ_СТОРІНКИ}': values.pageFormat?.trim() || undefined,
    '{ШРИФТИ}': values.availableFonts?.trim() || undefined,
    '{ФРАГМЕНТ}': values.sampleText?.trim().slice(0, MAX_SAMPLE_CHARS) || undefined,
  };

  const paragraphs = template.split(/\n{2,}/);
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    const tokens = Object.keys(map).filter((tk) => paragraph.includes(tk));
    const missing = tokens.filter((tk) => map[tk] === undefined);
    if (tokens.length > 0 && missing.length === tokens.length) continue;
    let text = paragraph;
    for (const tk of tokens) text = text.split(tk).join(map[tk] ?? '');
    kept.push(text.trim());
  }
  return kept.filter(Boolean).join('\n\n');
}

export interface DesignPatch {
  typography: {
    bodyFont?: string;
    headingsFont?: string;
    fontSizePt: number;
    lineHeight: number;
    firstLineIndentMm: number;
    paragraphSpacingMm: number;
    textAlign: 'justify' | 'left';
    pageNumberPosition: 'bottom-center' | 'bottom-outside' | 'top-outside';
    showHeaders: boolean;
  };
  margins: { topMm: number; bottomMm: number; insideMm: number; outsideMm: number };
  rationale: string;
  /** Що довелось виправити за моделлю — показуємо автору чесно, а не мовчки. */
  corrections: string[];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): { value: number; fixed: boolean } {
  // null/undefined/'' — це «модель поля не дала», а не «дала нуль». Без цієї
  // перевірки Number(null) === 0 перетворив би відсутнє значення на
  // найменше допустиме: книга з кеглем 8 pt там, де мав бути дефолтний 11.
  if (value === null || value === undefined || value === '') return { value: fallback, fixed: true };
  const n = Number(value);
  if (!Number.isFinite(n)) return { value: fallback, fixed: true };
  if (n < min) return { value: min, fixed: true };
  if (n > max) return { value: max, fixed: true };
  return { value: n, fixed: false };
}

/**
 * Приводить відповідь моделі до значень, придатних для друку.
 *
 * Це не «про всяк випадок»: модель регулярно віддає гарні на вигляд, але
 * непридатні числа — корінець у 8 мм, кегль 7 pt, гарнітуру, якої в книзі
 * немає. Мовчазне застосування такого дало б книгу, що не проходить
 * валідацію KDP уже після експорту, коли шукати причину найдорожче.
 */
export function clampDesignPatch(raw: any, availableFonts: string[]): DesignPatch {
  const corrections: string[] = [];
  const fonts = availableFonts.filter(Boolean);

  const pickFont = (value: unknown, label: string): string | undefined => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) return undefined;
    const exact = fonts.find((f) => f.toLowerCase() === name.toLowerCase());
    if (exact) return exact;
    corrections.push(`${label}: «${name}» немає серед доступних гарнітур — лишено поточну`);
    return undefined;
  };

  const t = raw?.typography || {};
  const m = raw?.margins || {};

  const fontSize = clampNumber(t.fontSizePt, 8, 14, 11);
  if (fontSize.fixed) corrections.push('кегль виправлено до діапазону 8–14 pt');
  const lineHeight = clampNumber(t.lineHeight, 1.1, 2, 1.45);
  if (lineHeight.fixed) corrections.push('інтерліньяж виправлено до діапазону 1.1–2.0');
  const indent = clampNumber(t.firstLineIndentMm, 0, 15, 5);
  if (indent.fixed) corrections.push('абзацний відступ виправлено до 0–15 мм');
  const spacing = clampNumber(t.paragraphSpacingMm, 0, 8, 0);
  if (spacing.fixed) corrections.push('відбивку між абзацами виправлено до 0–8 мм');

  const top = clampNumber(m.topMm, MIN_MARGIN_MM.top, MAX_MARGIN_MM, 20);
  const bottom = clampNumber(m.bottomMm, MIN_MARGIN_MM.bottom, MAX_MARGIN_MM, 20);
  const inside = clampNumber(m.insideMm, MIN_MARGIN_MM.inside, MAX_MARGIN_MM, 19);
  const outside = clampNumber(m.outsideMm, MIN_MARGIN_MM.outside, MAX_MARGIN_MM, 15);
  if (top.fixed || bottom.fixed || outside.fixed) corrections.push('поля приведено до друкарських меж 12–40 мм');
  if (inside.fixed) corrections.push(`корінець піднято до мінімальних ${MIN_MARGIN_MM.inside} мм — інакше текст заходить у згин`);

  const align = t.textAlign === 'left' ? 'left' : 'justify';
  const allowedPositions = ['bottom-center', 'bottom-outside', 'top-outside'] as const;
  const position = allowedPositions.includes(t.pageNumberPosition) ? t.pageNumberPosition : 'bottom-center';
  if (!allowedPositions.includes(t.pageNumberPosition)) {
    corrections.push('положення колонцифри приведено до «внизу по центру»');
  }

  const rationale = typeof raw?.rationale === 'string' ? raw.rationale.trim().slice(0, 600) : '';

  return {
    typography: {
      bodyFont: pickFont(t.bodyFont, 'Основна гарнітура'),
      headingsFont: pickFont(t.headingsFont, 'Гарнітура заголовків'),
      fontSizePt: Number(fontSize.value.toFixed(1)),
      lineHeight: Number(lineHeight.value.toFixed(2)),
      firstLineIndentMm: Number(indent.value.toFixed(1)),
      paragraphSpacingMm: Number(spacing.value.toFixed(1)),
      textAlign: align,
      pageNumberPosition: position,
      showHeaders: t.showHeaders !== false,
    },
    margins: {
      topMm: Number(top.value.toFixed(1)),
      bottomMm: Number(bottom.value.toFixed(1)),
      insideMm: Number(inside.value.toFixed(1)),
      outsideMm: Number(outside.value.toFixed(1)),
    },
    rationale,
    corrections,
  };
}

/**
 * Розбирає відповідь моделі. Моделі люблять обгортати JSON у ```json —
 * знімаємо обгортку замість того, щоб падати на цілком валідній відповіді.
 */
export function parseDesignResponse(text: string): any {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  return JSON.parse(cleaned);
}
