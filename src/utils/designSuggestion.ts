/**
 * Клієнтська частина скіла /design (Завдання 3в).
 *
 * Серверний модуль (server/designLayoutPrompt.ts) уже вміє попросити
 * модель про типографіку й обрізати відповідь до друкарських меж. Бракувало
 * трьох речей, без яких тим модулем неможливо скористатися:
 *   • зібрати вхідні дані з книги — гарнітури й зразок тексту;
 *   • показати автору, ЩО саме зміниться, до того, як воно зміниться;
 *   • застосувати правку так, щоб не затерти поля, яких /design не чіпає.
 *
 * Головне рішення тут — друге. Оформлення, застосоване мовчки, автор
 * помічає вже на розвороті, коли не памʼятає, як було; повернути «як
 * було» стає окремою роботою. Тому панель показує «було → стане» списком
 * і застосовує лише за окремим натисканням.
 *
 * Модуль навмисно без React: сюди винесено рівно ту логіку, яку можна
 * перевірити тестом, і жодного рядка розмітки.
 */

import type { Book, BookLayoutConfig } from '../types';

/** Гарнітури, вшиті у верстку (див. селектор у LayoutView). */
export const BUILT_IN_FONTS = ['Literata', 'Cormorant Garamond', 'Outfit', 'Plus Jakarta Sans'];

/** Скільки тексту показуємо моделі. Більше — дорожче й без користі: */
/* стиль автора видно вже на кількох тисячах знаків. */
export const SAMPLE_LIMIT = 4000;

/** Мінімум, який вимагає сервер (менше — відмовить із not_enough_text). */
export const SAMPLE_MIN = 200;

export interface DesignPatch {
  typography: {
    bodyFont?: string;
    headingsFont?: string;
    fontSizePt: number;
    lineHeight: number;
    firstLineIndentMm: number;
    paragraphSpacingMm: number;
    textAlign: 'justify' | 'left';
    pageNumberPosition: string;
    showHeaders: boolean;
  };
  margins: { topMm: number; bottomMm: number; insideMm: number; outsideMm: number };
  rationale: string;
  corrections: string[];
}

/**
 * Гарнітури, доступні цій книзі: вшиті плюс довантажені автором з Google
 * Fonts. Порядок збережено, дублікати прибрано — модель отримує список,
 * з якого їй дозволено обирати, і вигадана нею гарнітура все одно буде
 * відкинута на сервері.
 */
export function availableFontFamilies(book: Pick<Book, 'layoutConfig'>): string[] {
  const custom = (book.layoutConfig.customFonts ?? []).map((f) => f.family).filter(Boolean);
  const seen = new Set<string>();
  return [...BUILT_IN_FONTS, ...custom].filter((f) => {
    const key = f.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Розмітка рукопису — це не текст книги. Маркери зображень, службові
 * блоки чернеток ШІ і вказівки гарнітури мають бути прибрані: інакше
 * модель вирішує, що книга написана квадратними дужками, і підбирає
 * оформлення під неї.
 */
export function stripManuscriptMarkup(raw: string): string {
  return raw
    .replace(/\[IMG:[^\]]*\]/g, ' ')
    .replace(/\[\/?AI-DRAFT\]/g, ' ')
    .replace(/\[FONT="[^"]*"\]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*\n\s*/g, '\n\n')
    .trim();
}

/**
 * Зразок тексту для моделі: початок книги в порядку глав і розділів.
 * Саме початок, а не випадкові шматки — оформлення підбирається під те,
 * як книга читається з першої сторінки.
 */
export function designSampleText(book: Pick<Book, 'chapters'>, limit = SAMPLE_LIMIT): string {
  const parts: string[] = [];
  let total = 0;
  const chapters = [...(book.chapters ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const ch of chapters) {
    const sections = [...(ch.sections ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const s of sections) {
      const text = stripManuscriptMarkup(s.content ?? '');
      if (!text) continue;
      parts.push(text);
      total += text.length;
      if (total >= limit) return parts.join('\n\n').slice(0, limit);
    }
  }
  return parts.join('\n\n').slice(0, limit);
}

export interface DesignChange {
  label: string;
  before: string;
  after: string;
}

const ALIGN_LABEL: Record<string, string> = { justify: 'по ширині', left: 'по лівому краю' };
const PAGE_NUM_LABEL: Record<string, string> = {
  'bottom-center': 'внизу по центру',
  'bottom-outside': 'внизу із зовнішнього боку',
  'top-outside': 'угорі із зовнішнього боку',
  'bottom-left': 'внизу ліворуч',
  'bottom-right': 'внизу праворуч',
  'top-left': 'угорі ліворуч',
  'top-right': 'угорі праворуч',
  'top-center': 'угорі по центру',
};

const mm = (n: number) => `${Number(n.toFixed(1))} мм`;

/**
 * Перелік відмінностей між теперішнім оформленням і пропозицією. Тільки
 * відмінності: список із двадцяти рядків, де змінилися три, автор не
 * читає — а саме читання цього списку і є тим захистом, заради якого
 * панель існує.
 */
export function describeDesignChanges(current: BookLayoutConfig, patch: DesignPatch): DesignChange[] {
  const out: DesignChange[] = [];
  const push = (label: string, before: unknown, after: unknown, fmt: (v: any) => string = String) => {
    if (after === undefined || after === null) return;
    if (String(before) === String(after)) return;
    out.push({ label, before: fmt(before), after: fmt(after) });
  };

  const t = current.typography;
  const p = patch.typography;
  push('Гарнітура тексту', t.bodyFont, p.bodyFont);
  push('Гарнітура заголовків', t.headingsFont, p.headingsFont);
  push('Кегль', t.fontSizePt, p.fontSizePt, (v) => `${v} pt`);
  push('Інтерліньяж', t.lineHeight, p.lineHeight);
  push('Абзацний відступ', t.firstLineIndentMm, p.firstLineIndentMm, mm);
  push('Відбивка між абзацами', t.paragraphSpacingMm, p.paragraphSpacingMm, mm);
  push('Вирівнювання', t.textAlign, p.textAlign, (v) => ALIGN_LABEL[v] ?? String(v));
  push('Номер сторінки', t.pageNumberPosition, p.pageNumberPosition, (v) => PAGE_NUM_LABEL[v] ?? String(v));
  push('Колонтитули', t.showHeaders, p.showHeaders, (v) => (v ? 'показувати' : 'сховати'));

  const m = current.margins;
  push('Верхнє поле', m.topMm, patch.margins.topMm, mm);
  push('Нижнє поле', m.bottomMm, patch.margins.bottomMm, mm);
  push('Корінцеве поле', m.insideMm, patch.margins.insideMm, mm);
  push('Зовнішнє поле', m.outsideMm, patch.margins.outsideMm, mm);

  return out;
}

/**
 * Застосування правки. Розлита по полях, а не `{...layout, ...patch}`:
 * /design відповідає за типографіку й чотири поля — формат сторінки,
 * виліт під обріз, дзеркальність, змісти, шрифти автора лишаються його
 * рішенням, і поверхневе злиття мовчки викинуло б їх.
 */
export function applyDesignPatch(book: Book, patch: DesignPatch): Book {
  const t = book.layoutConfig.typography;
  const p = patch.typography;
  return {
    ...book,
    layoutConfig: {
      ...book.layoutConfig,
      margins: {
        ...book.layoutConfig.margins,
        topMm: patch.margins.topMm,
        bottomMm: patch.margins.bottomMm,
        insideMm: patch.margins.insideMm,
        outsideMm: patch.margins.outsideMm,
      },
      typography: {
        ...t,
        bodyFont: p.bodyFont || t.bodyFont,
        headingsFont: p.headingsFont || t.headingsFont,
        fontSizePt: p.fontSizePt,
        lineHeight: p.lineHeight,
        firstLineIndentMm: p.firstLineIndentMm,
        paragraphSpacingMm: p.paragraphSpacingMm,
        textAlign: p.textAlign,
        pageNumberPosition: p.pageNumberPosition as BookLayoutConfig['typography']['pageNumberPosition'],
        showHeaders: p.showHeaders,
      },
    },
  };
}
