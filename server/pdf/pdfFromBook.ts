/**
 * Варіант «макет від коду»: специфікація верстки будується з самої книги.
 *
 * ПРИНЦИП. Автор уже налаштував верстку на вкладці «Верстка PDF» — формат,
 * поля, кегль, інтерліньяж, червоний рядок, позицію номера, звідки
 * починається нумерація. Цей файл не вигадує макет, а ПЕРЕКЛАДАЄ ці
 * налаштування в мову рендерера. Якби він вирішував сам, автор побачив би
 * у вітрині книгу, не схожу на ту, що бачив у Студії, — і це була б не
 * стилістична розбіжність, а втрата його роботи.
 */

import type { Book } from '../../src/types';
import {
  DEFAULT_LAYOUT_SPEC,
  mm,
  type PageNumberPosition,
  type PdfBookInput,
  type PdfLayoutSpec,
} from './pdfTypes';

/**
 * Назви шрифтів у книзі — це імена Google Fonts, яких у нас немає: у PDF
 * шрифт вбудовується файлом, а качати довільний шрифт при генерації означало
 * б залежність від чужого сервера. Тому вибір зводиться до наявних двох
 * начертань — з засічками й без. Це чесне звуження, і воно назване в
 * `designerNoteUk`, а не сховане.
 */
function familyOf(fontName: string | undefined): 'serif' | 'sans' {
  const name = String(fontName || '').toLowerCase();
  if (/sans|inter|roboto|open|montserrat|lato|golos|unbounded|jetbrains|mono/.test(name)) {
    return 'sans';
  }
  return 'serif';
}

/**
 * Дві застарілі позиції зі старих версій верстки. Той самий мапінг, що вже
 * діє в інтерфейсі й експорті (log.md #2): «зовні» на непарній сторінці —
 * це праворуч, і без розворотів іншого значення воно не має.
 */
function positionOf(raw: string | undefined): PageNumberPosition {
  switch (raw) {
    case 'bottom-left':
    case 'bottom-right':
    case 'bottom-center':
    case 'top-left':
    case 'top-right':
    case 'top-center':
      return raw;
    case 'bottom-outside':
      return 'bottom-right';
    case 'top-outside':
      return 'top-right';
    default:
      return 'bottom-center';
  }
}

/** Текстовий зріз книги для рендерера: тільки те, що потрапляє на сторінку. */
export function bookToPdfInput(book: Book): PdfBookInput {
  return {
    title: book.title,
    subtitle: book.subtitle,
    author: book.author,
    chapters: (book.chapters || [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        sections: (chapter.sections || [])
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((section) => ({ title: section.title, content: section.content || '' })),
      })),
    illustrations: (book.illustrations || []).map((ill) => ({
      chapterId: ill.chapterId,
      url: ill.url,
      caption: ill.caption,
    })),
  };
}

export function specFromBook(book: Book): PdfLayoutSpec {
  const layout = book.layoutConfig;
  if (!layout) {
    return { ...DEFAULT_LAYOUT_SPEC, designerNoteUk: 'Книга без налаштувань верстки — узято заводський макет.' };
  }

  const typography = layout.typography || ({} as (typeof layout)['typography']);
  const margins = layout.margins || ({} as (typeof layout)['margins']);
  const bodyFont = familyOf(typography.bodyFont);
  const headingFont = familyOf(typography.headingsFont);
  const baseFontSize = Number(typography.fontSizePt) > 0 ? Number(typography.fontSizePt) : 11;

  // Режим початку нумерації — прямо з книги (log.md #1):
  //   title     — нумерується все з титульної;
  //   after-toc — передмова без номерів, тіло з першої;
  //   custom    — передмова без номерів, тіло з указаного числа.
  const startMode = typography.pageNumberStart?.mode || 'title';
  const startNumber = Number(typography.pageNumberStart?.startNumber);

  // Дзеркальні поля (корінець на розвороті) рендерер не підтримує: він
  // верстає стрічкою, а не розворотами. Беремо inside як ліве — для
  // цифрового PDF це нейтрально, а для друку розвороти й так робить
  // «Верстка PDF». Розбіжність названа в примітці нижче, а не прихована.
  const left = Number(margins.insideMm) >= 0 ? mm(Number(margins.insideMm)) : DEFAULT_LAYOUT_SPEC.margins.left;
  const right = Number(margins.outsideMm) >= 0 ? mm(Number(margins.outsideMm)) : DEFAULT_LAYOUT_SPEC.margins.right;

  const notes: string[] = ['Макет узято з налаштувань книги («Верстка PDF»).'];
  if (margins.mirrored) {
    notes.push('Дзеркальні поля не застосовані: PDF для вітрини верстається стрічкою, без розворотів.');
  }
  if (typography.bodyFont || typography.headingsFont) {
    notes.push(
      `Шрифти зведено до наявних начертань (${bodyFont === 'sans' ? 'без засічок' : 'із засічками'}): ` +
        'у PDF шрифт вбудовується файлом, а сторонні гарнітури в збірку не входять.'
    );
  }

  return {
    ...DEFAULT_LAYOUT_SPEC,
    pageWidthPt: Number(layout.pageWidthMm) > 0 ? mm(Number(layout.pageWidthMm)) : undefined,
    pageHeightPt: Number(layout.pageHeightMm) > 0 ? mm(Number(layout.pageHeightMm)) : undefined,
    margins: {
      top: Number(margins.topMm) >= 0 ? mm(Number(margins.topMm)) : DEFAULT_LAYOUT_SPEC.margins.top,
      bottom: Number(margins.bottomMm) >= 0 ? mm(Number(margins.bottomMm)) : DEFAULT_LAYOUT_SPEC.margins.bottom,
      left,
      right,
    },
    baseFontSize,
    lineHeight: Number(typography.lineHeight) > 0 ? Number(typography.lineHeight) : DEFAULT_LAYOUT_SPEC.lineHeight,
    paragraphSpacing: Number(typography.paragraphSpacingMm) > 0 ? mm(Number(typography.paragraphSpacingMm)) : 0,
    paragraphIndent: Number(typography.firstLineIndentMm) > 0 ? mm(Number(typography.firstLineIndentMm)) : 0,
    bodyAlign: typography.textAlign === 'left' ? 'left' : 'justify',
    bodyFont,
    chapterTitle: {
      ...DEFAULT_LAYOUT_SPEC.chapterTitle,
      font: headingFont,
      fontSize: Math.round(baseFontSize * 1.8),
    },
    sectionTitle: {
      ...DEFAULT_LAYOUT_SPEC.sectionTitle,
      font: headingFont,
      fontSize: Math.round(baseFontSize * 1.18),
    },
    titlePage: {
      ...DEFAULT_LAYOUT_SPEC.titlePage,
      titleSize: Math.round(baseFontSize * 2.5),
      subtitleSize: Math.round(baseFontSize * 1.25),
      authorSize: Math.round(baseFontSize * 1.1),
    },
    pageNumber: {
      show: typography.showPageNumbers !== false,
      position: positionOf(typography.pageNumberPosition),
      fontSize: Math.max(7, Math.round(baseFontSize * 0.8)),
      startAt: startMode === 'custom' && Number.isFinite(startNumber) && startNumber > 0 ? startNumber : 1,
      skipFrontMatter: startMode !== 'title',
    },
    runningHead: {
      ...DEFAULT_LAYOUT_SPEC.runningHead,
      show: Boolean(typography.showHeaders),
      fontSize: Math.max(6, Math.round(baseFontSize * 0.72)),
    },
    designerNoteUk: notes.join(' '),
  };
}
