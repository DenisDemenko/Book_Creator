export type BookDesignThemeId =
  | 'classic'
  | 'modern-fiction'
  | 'sci-fi'
  | 'non-fiction'
  | 'children';

export type SemanticParagraphStyle =
  | 'Body'
  | 'Heading 1'
  | 'Heading 2'
  | 'Quote'
  | 'Epigraph'
  | 'Letter'
  | 'InnerThought'
  | 'ChatMessage'
  | 'SceneBreak'
  | 'Caption';

export interface BookDesignTheme {
  id: BookDesignThemeId;
  labelUk: string;
  descriptionUk: string;
  bodyFont: string;
  headingFont: string;
  bodyAlign: 'left' | 'justify';
  chapterAlign: 'left' | 'center';
  bodySizeDelta: number;
  chapterSizeDelta: number;
  sectionSizeDelta: number;
  paragraphIndentMultiplier: number;
  paragraphSpacingMultiplier: number;
  sceneBreak: string;
  chapterNumberStyle: 'quiet' | 'display' | 'technical';
}

/**
 * Phase 1 deliberately uses fonts already available in the current image.
 * The visual system is therefore safe before the OFL font-pack task lands.
 * Theme-specific OFL families can replace these fallbacks without changing
 * the public theme ids or stored book settings.
 */
export const BOOK_DESIGN_THEMES: Record<BookDesignThemeId, BookDesignTheme> = {
  classic: {
    id: 'classic',
    labelUk: 'Classic',
    descriptionUk: 'Традиційна книжкова верстка: спокійний ритм, виразні глави, мінімум декоративного шуму.',
    bodyFont: 'DejaVu Serif',
    headingFont: 'DejaVu Serif',
    bodyAlign: 'justify',
    chapterAlign: 'center',
    bodySizeDelta: 0,
    chapterSizeDelta: 1,
    sectionSizeDelta: 0,
    paragraphIndentMultiplier: 1,
    paragraphSpacingMultiplier: 1,
    sceneBreak: '* * *',
    chapterNumberStyle: 'quiet',
  },
  'modern-fiction': {
    id: 'modern-fiction',
    labelUk: 'Modern Fiction',
    descriptionUk: 'Повітряна сучасна проза: більше білого простору, менше формальності, сильний початок глави.',
    bodyFont: 'DejaVu Serif',
    headingFont: 'DejaVu Sans',
    bodyAlign: 'left',
    chapterAlign: 'left',
    bodySizeDelta: 0.35,
    chapterSizeDelta: 5,
    sectionSizeDelta: 1,
    paragraphIndentMultiplier: 0.6,
    paragraphSpacingMultiplier: 1.35,
    sceneBreak: '· · ·',
    chapterNumberStyle: 'display',
  },
  'sci-fi': {
    id: 'sci-fi',
    labelUk: 'Sci‑Fi',
    descriptionUk: 'Технологічна асиметрія: контрастні заголовки, компактні службові елементи, чіткі сценічні переходи.',
    bodyFont: 'DejaVu Serif',
    headingFont: 'DejaVu Sans',
    bodyAlign: 'left',
    chapterAlign: 'left',
    bodySizeDelta: 0,
    chapterSizeDelta: 3,
    sectionSizeDelta: 0.5,
    paragraphIndentMultiplier: 0.35,
    paragraphSpacingMultiplier: 1.15,
    sceneBreak: '◇',
    chapterNumberStyle: 'technical',
  },
  'non-fiction': {
    id: 'non-fiction',
    labelUk: 'Non‑fiction',
    descriptionUk: 'Довідкова й навчальна книга: проста ієрархія, щільна структура, зручне сканування сторінки.',
    bodyFont: 'DejaVu Serif',
    headingFont: 'DejaVu Sans',
    bodyAlign: 'left',
    chapterAlign: 'left',
    bodySizeDelta: -0.1,
    chapterSizeDelta: 2,
    sectionSizeDelta: 1,
    paragraphIndentMultiplier: 0,
    paragraphSpacingMultiplier: 1.6,
    sceneBreak: '—',
    chapterNumberStyle: 'quiet',
  },
  children: {
    id: 'children',
    labelUk: 'Children',
    descriptionUk: 'Великий дружній набір для дитячих книжок: короткі рядки, більше повітря, м’яка ієрархія.',
    bodyFont: 'DejaVu Sans',
    headingFont: 'DejaVu Sans',
    bodyAlign: 'left',
    chapterAlign: 'center',
    bodySizeDelta: 2,
    chapterSizeDelta: 4,
    sectionSizeDelta: 2,
    paragraphIndentMultiplier: 0,
    paragraphSpacingMultiplier: 1.8,
    sceneBreak: '✦',
    chapterNumberStyle: 'display',
  },
};

export function isBookDesignThemeId(value: unknown): value is BookDesignThemeId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BOOK_DESIGN_THEMES, value);
}

export function getBookDesignTheme(value: unknown): BookDesignTheme | null {
  return isBookDesignThemeId(value) ? BOOK_DESIGN_THEMES[value] : null;
}
