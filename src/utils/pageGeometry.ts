/**
 * Єдине джерело правди про геометрію аркуша: розмір сторінки, поля й
 * похідні від них розміри текстової зони — у міліметрах.
 *
 * НАВІЩО ОКРЕМИЙ МОДУЛЬ. До цього ті самі два віднімання були записані в
 * трьох місцях, і кожне зі своїми значеннями за замовчуванням:
 *   • `EditorView.tsx` — `getPageContentWidthMm` (152 мм),
 *     `getPageContentHeightMm` (229 мм) і `getVerticalMarginsMm` окремо;
 *   • `useRealBookPages.ts` — ті самі два рядки, але **без** запасних
 *     значень зовсім (книга без `pageWidthMm` давала `NaN` у ширині прихованого
 *     контейнера, тобто мовчазно зламану пагінацію «Розвороту книги»);
 *   • `PdfEditorView.tsx` — власні 148×210 і поля `?? 20/20/18/15`.
 *
 * Розбіжність була не косметична: одна й та сама книга без явного розміру
 * мірялась у редакторі як 6″×9″, а у верстці PDF — як A5, тож сторінки
 * ділились у різних місцях. Тепер розмір і поля рахуються тут, і всі
 * споживачі беруть готову геометрію.
 *
 * ЧОМУ A5 (148×210) ЗА ЗАМОВЧУВАННЯМ. Це формат, який застосунок сам
 * ставить новій книзі (`src/data/initialBook.ts`, `formatPreset: 'A5'`), і
 * той самий, який уже мав редактор PDF-верстки. Редактор «Книга і текст»
 * раніше підставляв 152×229 (округлене 6″×9″) — для книг **без** явного
 * розміру це давало іншу довжину рядка й інші розриви сторінок; тепер усі
 * екрани бачать той самий аркуш. Для книг із явним `pageWidthMm`
 * поведінка не змінюється взагалі.
 *
 * Це чиста функція без React і DOM — свідомо, щоб її можна було прогнати
 * тестом у Node (`npm run test:page-geometry`).
 */

import type { BookLayoutConfig } from '../types';

/** Формат аркуша за замовчуванням — A5, той самий, що в `initialBook.ts`. */
export const DEFAULT_PAGE_WIDTH_MM = 148;
export const DEFAULT_PAGE_HEIGHT_MM = 210;

export interface PageMarginsMm {
  topMm: number;
  bottomMm: number;
  insideMm: number;
  outsideMm: number;
}

export interface PageGeometry {
  pageWidthMm: number;
  pageHeightMm: number;
  /** Поля, приведені до чисел (відсутні й `NaN` → 0). */
  margins: PageMarginsMm;
  /** Ширина текстової зони: сторінка мінус внутрішнє й зовнішнє поле. Не менше 0. */
  contentWidthMm: number;
  /** Висота текстової зони: сторінка мінус верхнє й нижнє поле. Не менше 0. */
  contentHeightMm: number;
}

/** Розмір сторінки: додатне число, інакше — запасне значення. */
function pageSizeOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Поле: число, інакше 0. Саме `Number.isFinite`, а не `|| 0`: так `NaN`
 * перетворюється на 0 (як і раніше), а дійсне число лишається собою.
 * Від'ємні поля тут не «виправляються» — їх не пускає інтерфейс
 * «Верстка & Поля» (`MIN_MARGIN_MM`), а тихо переписувати чужі дані
 * цей модуль не має права.
 */
function marginOr(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Геометрія аркуша книги. Приймає `layoutConfig` (або будь-що схоже, якщо
 * книга стара й поля часткові) і повертає узгоджений набір розмірів.
 */
export function resolvePageGeometry(
  layout?: Partial<BookLayoutConfig> | null
): PageGeometry {
  const pageWidthMm = pageSizeOr(layout?.pageWidthMm, DEFAULT_PAGE_WIDTH_MM);
  const pageHeightMm = pageSizeOr(layout?.pageHeightMm, DEFAULT_PAGE_HEIGHT_MM);
  const source = layout?.margins;

  const margins: PageMarginsMm = {
    topMm: marginOr(source?.topMm),
    bottomMm: marginOr(source?.bottomMm),
    insideMm: marginOr(source?.insideMm),
    outsideMm: marginOr(source?.outsideMm),
  };

  return {
    pageWidthMm,
    pageHeightMm,
    margins,
    // Не менше нуля: поля, більші за сторінку, — це зіпсовані дані, і
    // від'ємна ширина колонки зламала б масштабування (usePageScale
    // рахує `widthMm * PX_PER_MM` і ділить на нього).
    contentWidthMm: Math.max(0, pageWidthMm - margins.insideMm - margins.outsideMm),
    contentHeightMm: Math.max(0, pageHeightMm - margins.topMm - margins.bottomMm),
  };
}
