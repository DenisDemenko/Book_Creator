/**
 * Безкоштовний уривок книги для вітрини — перші N сторінок готового PDF.
 *
 * НАВІЩО. Покупець довіряє не опису, а тексту: він хоче прочитати перші
 * сторінки й вирішити сам. Опис і обкладинка кажуть, ПРО ЩО книга; уривок
 * показує, ЯК вона написана — а саме це й вирішує покупку.
 *
 * ЧОМУ РІЖЕМО ГОТОВИЙ PDF, А НЕ ВЕРСТАЄМО ОКРЕМО. «Перші десять сторінок» —
 * не властивість тексту, а наслідок верстки: та сама глава дає різну
 * кількість сторінок при іншому кеглі чи полях. Якби уривок верстався
 * окремим прогоном, він міг би обірватися не там, де обривається десята
 * сторінка книги, і покупець отримав би не те, що купує. Тому джерело одне:
 * той самий файл, що йде в лістинг, з якого копіюються перші сторінки.
 *
 * Наслідок, який варто знати: уривок несе титул. Він же йде першою
 * сторінкою книги, тож із десяти сторінок одна-дві — титул і зміст. Це не
 * втрата: читач бачить оформлення, яке отримає.
 */

import { PDFDocument } from 'pdf-lib';

/** Скільки сторінок пропонуємо у вітрині за замовчуванням. */
export const SAMPLE_DEFAULT_PAGES = 10;
/** Межі вибору автора. Менше за 5 не показує стилю, більше за 10 — це вже книга. */
export const SAMPLE_MIN_PAGES = 5;
export const SAMPLE_MAX_PAGES = 10;

/** Затискає бажану кількість сторінок у дозволені межі. */
export function clampSamplePages(requested: unknown): number {
  const n = Number(requested);
  if (!Number.isFinite(n)) return SAMPLE_DEFAULT_PAGES;
  return Math.min(SAMPLE_MAX_PAGES, Math.max(SAMPLE_MIN_PAGES, Math.round(n)));
}

export interface SampleResult {
  bytes: Uint8Array;
  /** Скільки сторінок реально потрапило в уривок. */
  pageCount: number;
  /** Скільки сторінок у повній книзі — щоб показати «10 із 214». */
  totalPages: number;
  /**
   * Заповнене, коли уривок довелося скоротити або він не має сенсу.
   * Порожнє — усе за задумом.
   */
  noteUk?: string;
}

/**
 * Перші `pages` сторінок із готового PDF окремим документом.
 *
 * Повертає `null`, коли уривок робити НЕ треба: у книзі не більше сторінок,
 * ніж просять показати. Безкоштовно віддати книгу цілком під виглядом
 * уривка — гірше за відсутність уривка, і мовчки цього робити не можна.
 */
export async function extractSamplePages(
  sourceBytes: Uint8Array,
  pages: number
): Promise<SampleResult | null> {
  const wanted = clampSamplePages(pages);
  const source = await PDFDocument.load(sourceBytes);
  const totalPages = source.getPageCount();

  if (totalPages <= wanted) {
    return null;
  }

  const sample = await PDFDocument.create();
  // Метадані копіюються не всі: назва потрібна (вкладка браузера покупця),
  // а решта — це вже поля книги, яких в уривку немає сенсу обіцяти.
  const title = source.getTitle();
  if (title) sample.setTitle(`${title} — уривок`);
  sample.setProducer('NOVA STUDIO');

  const copied = await sample.copyPages(source, Array.from({ length: wanted }, (_, i) => i));
  for (const page of copied) sample.addPage(page);

  const bytes = await sample.save();
  return {
    bytes,
    pageCount: wanted,
    totalPages,
    noteUk:
      wanted !== Number(pages) && Number.isFinite(Number(pages))
        ? `Кількість сторінок уривка затиснуто до ${wanted} (дозволено ${SAMPLE_MIN_PAGES}–${SAMPLE_MAX_PAGES}).`
        : undefined,
  };
}
