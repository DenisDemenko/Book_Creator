/**
 * Специфікація макета книги — спільна мова двох варіантів верстки.
 *
 * НАВІЩО ОКРЕМИЙ ТИП. Власник просив два способи зробити PDF: макет від
 * моделі й макет від коду. Якби кожен сам малював PDF, ми мали б два рушії,
 * два набори багів і дві якості. Тому спосіб рівно один: обидва варіанти
 * віддають ОЦЮ специфікацію, а рендерить її один код. Різниця між
 * варіантами чесна й вузька — хто вирішує макет, а не хто робить файл.
 *
 * Одиниці — типографські пункти (1/72 дюйма), як у самому PDF. Жодних
 * пікселів: у файлі, який піде в друк, піксель нічого не означає.
 */

export type PageSizeName = 'A4' | 'A5' | 'B5' | 'Letter';

/** Розміри в пунктах. A5 — типовий кишеньковий формат книги. */
export const PAGE_SIZES: Record<PageSizeName, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  B5: { width: 498.9, height: 708.66 },
  Letter: { width: 612, height: 792 },
};

export type FontChoice = 'serif' | 'sans';
export type Align = 'left' | 'center' | 'justify';

export type PageNumberPosition =
  | 'bottom-center'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'top-left'
  | 'top-right';

export interface HeadingStyle {
  fontSize: number;
  /** Відступ згори перед заголовком, пункти. */
  spaceBefore: number;
  /** Відступ знизу після заголовка, пункти. */
  spaceAfter: number;
  align: Align;
  font: FontChoice;
  uppercase: boolean;
}

export interface PdfLayoutSpec {
  pageSize: PageSizeName;
  margins: { top: number; right: number; bottom: number; left: number };

  /** Кегль основного тексту. */
  baseFontSize: number;
  /** Інтерліньяж як множник кегля (1.4 = 140%). */
  lineHeight: number;
  /** Відступ між абзацами, пункти. 0 — абзаци розділяє лише червоний рядок. */
  paragraphSpacing: number;
  /** Червоний рядок, пункти. 0 — без відступу. */
  paragraphIndent: number;
  bodyAlign: Align;
  bodyFont: FontChoice;

  chapterTitle: HeadingStyle;
  /** Кожна глава з нової сторінки. Для збірок оповідань — так, для довідника часто ні. */
  chapterStartsNewPage: boolean;
  sectionTitle: HeadingStyle;

  titlePage: {
    show: boolean;
    titleSize: number;
    subtitleSize: number;
    authorSize: number;
  };

  pageNumber: {
    show: boolean;
    position: PageNumberPosition;
    fontSize: number;
    /** Номер, з якого починається нумерація видимих сторінок. */
    startAt: number;
    /** Не нумерувати титул і сторінки до першої глави. */
    skipFrontMatter: boolean;
  };

  runningHead: {
    show: boolean;
    /** Що виводити у верхньому колонтитулі. */
    content: 'title' | 'chapter' | 'author';
    fontSize: number;
  };

  /**
   * Пояснення макета людською мовою. Для варіанта «дизайн від моделі» — це
   * її обґрунтування, яке показується автору: макет, який не можна
   * оскаржити, гірший за макет, який можна.
   */
  designerNoteUk?: string;
}

/** Заводський макет: спокійна книжкова верстка, з якої безпечно починати. */
export const DEFAULT_LAYOUT_SPEC: PdfLayoutSpec = {
  pageSize: 'A5',
  margins: { top: 56, right: 48, bottom: 56, left: 48 },
  baseFontSize: 11,
  lineHeight: 1.45,
  paragraphSpacing: 0,
  paragraphIndent: 16,
  bodyAlign: 'justify',
  bodyFont: 'serif',
  chapterTitle: {
    fontSize: 20,
    spaceBefore: 24,
    spaceAfter: 20,
    align: 'left',
    font: 'serif',
    uppercase: false,
  },
  chapterStartsNewPage: true,
  sectionTitle: {
    fontSize: 13,
    spaceBefore: 16,
    spaceAfter: 8,
    align: 'left',
    font: 'serif',
    uppercase: false,
  },
  titlePage: { show: true, titleSize: 28, subtitleSize: 14, authorSize: 12 },
  pageNumber: {
    show: true,
    position: 'bottom-center',
    fontSize: 9,
    startAt: 1,
    skipFrontMatter: true,
  },
  runningHead: { show: false, content: 'title', fontSize: 8 },
};

/** Мінімальний зріз книги, потрібний рендереру. */
export interface PdfBookInput {
  title: string;
  subtitle?: string;
  author?: string;
  chapters: Array<{
    title: string;
    sections: Array<{ title?: string; content: string }>;
  }>;
}
