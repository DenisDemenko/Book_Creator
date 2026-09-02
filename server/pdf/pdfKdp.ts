/**
 * Макет для друку в Amazon KDP.
 *
 * ЧОМУ ЦЕ НЕ «ЩЕ ОДИН ФОРМАТ СТОРІНКИ». Друкована книга має корінець:
 * внутрішнє поле більше за зовнішнє, і на розвороті вони міняються місцями.
 * KDP не приймає макет, де внутрішнє поле замале для обсягу — і це не
 * прискіпливість: на товстій книзі текст біля згину або не читається, або
 * зникає в переплетенні.
 *
 * КУРКА Й ЯЙЦЕ. Мінімальний корінець залежить від кількості сторінок, а
 * кількість сторінок — від полів. Тому верстка йде в кілька проходів:
 * зверстали з поточним корінцем, подивились на обсяг, перерахували корінець,
 * повторили. Збіжність швидка (корінець росте ступенями), тож трьох проходів
 * вистачає з запасом; якщо не зійшлося — беремо більший корінець, бо
 * помилитись у бік ширшого поля безпечно, а у бік вужчого — ні.
 *
 * Таблиці KDP тут не дублюються: розміри обрізу лежать у server/kdpSpec.ts,
 * а норми полів — у src/utils/kdpHelpers.ts, і саме вони вже обслуговують
 * перевірку рукопису в інтерфейсі. Друга копія тих самих чисел рано чи
 * пізно розійшлася б із першою.
 */

import { KDP_TRIM_SIZES, MIN_PAGE_COUNT, type PaperType } from '../kdpSpec';
import { getKdpMinimumGutterMm, getKdpMinimumOutsideMarginsMm } from '../../src/utils/kdpHelpers';
import { renderBookPdf, type RenderResult } from './pdfRenderer';
import { DEFAULT_LAYOUT_SPEC, mm, type PdfBookInput, type PdfLayoutSpec } from './pdfTypes';

const PT_PER_INCH = 72;

export interface KdpLayoutOptions {
  /** Ідентифікатор розміру обрізу з KDP_TRIM_SIZES, напр. '6x9'. */
  trimId?: string;
  paper?: PaperType;
  /** Виліт під обріз — для книг із зображеннями «під зріз». */
  hasBleed?: boolean;
  /** Базовий макет, з якого беруться типографські рішення (кегль, шрифт). */
  base?: PdfLayoutSpec;
}

export interface KdpRenderResult extends RenderResult {
  spec: PdfLayoutSpec;
  trimId: string;
  gutterMm: number;
  /** Скільки проходів знадобилось, щоб корінець зійшовся з обсягом. */
  passes: number;
  /** Попередження, які автор має побачити ДО завантаження в KDP. */
  warningsUk: string[];
}

export function kdpSpec(
  options: KdpLayoutOptions & { pageCountEstimate: number }
): { spec: PdfLayoutSpec; gutterMm: number; trimId: string } {
  const trim =
    KDP_TRIM_SIZES.find((t) => t.id === options.trimId) ||
    KDP_TRIM_SIZES.find((t) => t.id === '6x9')!;

  const gutter = getKdpMinimumGutterMm(Math.max(MIN_PAGE_COUNT, options.pageCountEstimate));
  const outside = getKdpMinimumOutsideMarginsMm(Boolean(options.hasBleed));
  const base = options.base || DEFAULT_LAYOUT_SPEC;

  // Норми KDP — це ПІДЛОГА, а не макет. Мінімальне зовнішнє поле 0.25″ дає
  // книгу, де текст упирається в обріз, тож зовнішнє рахуємо від ширини
  // сторінки (≈8.5%), але ніколи не нижче за норму.
  const width = trim.widthInches * PT_PER_INCH;
  const height = trim.heightInches * PT_PER_INCH;
  const outsidePt = Math.max(mm(outside.minMm) + 4, width * 0.085);

  // Корінець = зовнішнє поле ПЛЮС припуск на переплетення. Без припуску
  // внутрішнє поле дорівнювало б зовнішньому, і після зшивання внутрішнє
  // виглядало б помітно вужчим — саме тому в друкованій книзі воно фізично
  // більше. Припуск беремо як половину норми KDP: вона сама росте з
  // товщиною книги, тож і припуск росте разом із нею.
  const gutterPt = Math.max(mm(gutter.minMm), outsidePt + mm(gutter.minMm) * 0.5);

  return {
    trimId: trim.id,
    gutterMm: gutter.minMm,
    spec: {
      ...base,
      pageWidthPt: trim.widthInches * PT_PER_INCH,
      pageHeightPt: trim.heightInches * PT_PER_INCH,
      mirrorMargins: true,
      margins: {
        // left = внутрішнє (корінець), right = зовнішнє. На парних сторінках
        // рендерер поміняє їх місцями сам.
        left: gutterPt,
        right: outsidePt,
        // Нижнє поле більше за верхнє: так сторінка виглядає врівноваженою,
        // а не сповзлою вниз, і лишається місце під номер.
        top: Math.max(mm(outside.minMm) + 6, height * 0.06),
        bottom: Math.max(mm(outside.minMm) + 10, height * 0.075),
      },
      // Колонтитул на друку доречний, а нумерація обовʼязкова.
      pageNumber: { ...base.pageNumber, show: true, position: 'bottom-center' },
      designerNoteUk:
        `Макет під друк Amazon KDP, обріз ${trim.label}. Внутрішнє поле (корінець) ` +
        `${Math.round((gutterPt / mm(1)) * 10) / 10} мм при мінімумі KDP ${gutter.minMm} мм для цього ` +
        `обсягу; зовнішнє ${Math.round((outsidePt / mm(1)) * 10) / 10} мм при мінімумі ${outside.minMm} мм. ` +
        'Норми KDP — це підлога: друк рівно по них дав би текст, що впирається в обріз. ' +
        (base.designerNoteUk ? `Типографіку взято з попереднього макета: ${base.designerNoteUk}` : ''),
    },
  };
}

/**
 * Верстка під KDP із узгодженням корінця й обсягу.
 */
export async function renderKdpInterior(
  book: PdfBookInput,
  options: KdpLayoutOptions = {}
): Promise<KdpRenderResult> {
  let estimate = MIN_PAGE_COUNT;
  let result: RenderResult | null = null;
  let built = kdpSpec({ ...options, pageCountEstimate: estimate });
  let passes = 0;

  for (let i = 0; i < 3; i += 1) {
    passes += 1;
    result = await renderBookPdf(book, built.spec);
    const needed = getKdpMinimumGutterMm(result.pageCount).minMm;
    if (needed === built.gutterMm) break;
    // Корінець тільки росте: якщо наступний прохід дав менший обсяг і
    // вужчий корінець, беремо ширший — вузьке поле KDP відхилить, широке ні.
    estimate = Math.max(result.pageCount, estimate);
    const next = kdpSpec({ ...options, pageCountEstimate: estimate });
    if (next.gutterMm <= built.gutterMm) break;
    built = next;
  }

  const warnings: string[] = [];
  if (result!.pageCount < MIN_PAGE_COUNT) {
    warnings.push(
      `У книзі ${result!.pageCount} сторінок, а KDP приймає від ${MIN_PAGE_COUNT}. ` +
        'Файл зібрано, але завантаження в KDP буде відхилено.'
    );
  }
  if (options.hasBleed) {
    warnings.push(
      'Виліт під обріз задано, але рендерер не малює нічого «під зріз»: ' +
        'поля пораховані з урахуванням вильоту, самі зображення на зріз не виводяться.'
    );
  }

  return {
    ...result!,
    spec: built.spec,
    trimId: built.trimId,
    gutterMm: built.gutterMm,
    passes,
    warningsUk: warnings,
  };
}
