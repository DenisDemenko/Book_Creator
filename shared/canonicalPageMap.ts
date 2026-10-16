export type CanonicalPageMapSource =
  | 'nova-pdf'
  | 'designcraft-toc'
  | 'chromium-pdf'
  | 'pandoc-toc'
  | 'external-pdf';

export type CanonicalPageMapPrecision = 'exact' | 'page-count-only';

export interface CanonicalPageLandmark {
  kind: 'chapter' | 'section';
  /** Stable source id from the Book model when available. */
  id: string;
  title: string;
  /** Zero-based physical index inside the final PDF file. */
  filePageIndex: number;
  /** One-based physical page number inside the final PDF file. */
  filePageNumber: number;
  /** Printed folio. Null means that this physical page intentionally has no visible page number. */
  displayPageNumber: number | null;
  chapterId?: string;
}

/**
 * One normalized pagination contract for every PDF renderer.
 *
 * The selected engine is authoritative for pagination. Different engines are
 * allowed to paginate the same manuscript differently; consumers must use the
 * map returned by the SAME render as the PDF they show/export and must never
 * merge landmarks from different engines.
 */
export interface CanonicalPageMap {
  version: 1;
  source: CanonicalPageMapSource;
  engineId: string;
  /** Exact when the engine exposed final chapter/section coordinates. */
  precision: CanonicalPageMapPrecision;
  pageCount: number;
  /** Zero-based first body page when known. Null for engines that only expose total pages. */
  bodyStartPageIndex: number | null;
  landmarks: CanonicalPageLandmark[];
  /** Human-readable reason why exact landmarks are unavailable. */
  noteUk?: string;
}

export interface PdfPaginationTraceSection {
  id?: string;
  title: string;
  /** Page index before generated TOC pages are inserted. */
  pageIndex: number;
}

export interface PdfPaginationTraceChapter {
  id?: string;
  title: string;
  /** Page index before generated TOC pages are inserted. */
  pageIndex: number;
  sections: PdfPaginationTraceSection[];
}

export interface BuildCanonicalPdfPageMapInput {
  chapters: PdfPaginationTraceChapter[];
  pageCount: number;
  /** Final body-start index AFTER generated TOC pages were inserted. */
  bodyStartPageIndex: number;
  /** Number of generated TOC pages inserted immediately before the body. */
  insertedTocPages: number;
  pageNumber: {
    show: boolean;
    startAt: number;
    skipFrontMatter: boolean;
  };
  engineId?: string;
  source?: CanonicalPageMapSource;
}

function safePageIndex(value: number, pageCount: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.max(0, pageCount - 1), Math.round(value)));
}

function printedPageNumber(
  finalIndex: number,
  bodyStartPageIndex: number,
  pageNumber: BuildCanonicalPdfPageMapInput['pageNumber'],
): number | null {
  if (!pageNumber.show) return null;
  if (pageNumber.skipFrontMatter && finalIndex < bodyStartPageIndex) return null;
  const firstNumbered = pageNumber.skipFrontMatter ? bodyStartPageIndex : 0;
  return pageNumber.startAt + (finalIndex - firstNumbered);
}

/**
 * Convert an engine's pre-TOC pagination trace into FINAL PDF coordinates.
 * Nova lays out the body first and inserts generated TOC pages before it
 * afterwards, so every body landmark is shifted by insertedTocPages.
 */
export function buildCanonicalPdfPageMap(input: BuildCanonicalPdfPageMapInput): CanonicalPageMap {
  const pageCount = Math.max(0, Math.round(Number(input.pageCount) || 0));
  const insertedTocPages = Math.max(0, Math.round(Number(input.insertedTocPages) || 0));
  const bodyStartPageIndex = safePageIndex(input.bodyStartPageIndex, Math.max(1, pageCount));
  const landmarks: CanonicalPageLandmark[] = [];

  input.chapters.forEach((chapter, chapterIndex) => {
    const chapterId = chapter.id || `chapter-${chapterIndex + 1}`;
    const chapterFinalIndex = safePageIndex(chapter.pageIndex + insertedTocPages, Math.max(1, pageCount));
    landmarks.push({
      kind: 'chapter',
      id: chapterId,
      chapterId,
      title: chapter.title,
      filePageIndex: chapterFinalIndex,
      filePageNumber: chapterFinalIndex + 1,
      displayPageNumber: printedPageNumber(chapterFinalIndex, bodyStartPageIndex, input.pageNumber),
    });

    chapter.sections.forEach((section, sectionIndex) => {
      const sectionFinalIndex = safePageIndex(section.pageIndex + insertedTocPages, Math.max(1, pageCount));
      landmarks.push({
        kind: 'section',
        id: section.id || `section-${chapterIndex + 1}-${sectionIndex + 1}`,
        chapterId,
        title: section.title,
        filePageIndex: sectionFinalIndex,
        filePageNumber: sectionFinalIndex + 1,
        displayPageNumber: printedPageNumber(sectionFinalIndex, bodyStartPageIndex, input.pageNumber),
      });
    });
  });

  return {
    version: 1,
    source: input.source || 'nova-pdf',
    engineId: input.engineId || 'nova',
    precision: 'exact',
    pageCount,
    bodyStartPageIndex,
    landmarks,
  };
}

/** Honest fallback for engines that currently expose only final pageCount. */
export function pageCountOnlyMap(
  engineId: string,
  source: CanonicalPageMapSource,
  pageCount: number,
  noteUk: string,
): CanonicalPageMap {
  return {
    version: 1,
    source,
    engineId,
    precision: 'page-count-only',
    pageCount: Math.max(0, Math.round(Number(pageCount) || 0)),
    bodyStartPageIndex: null,
    landmarks: [],
    noteUk,
  };
}
