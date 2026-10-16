export type CanonicalPageMapSource = 'nova-pdf' | 'browser-measured' | 'external-pdf';

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
 * Exact pagination contract shared by PDF, TOC, spread preview and navigation.
 *
 * `pageCount` and all landmark coordinates refer to the FINAL file after
 * front matter / generated TOC pages have been inserted. Consumers must not
 * recompute page numbers from character counts once this map is available.
 */
export interface CanonicalPageMap {
  version: 1;
  source: CanonicalPageMapSource;
  engineId: string;
  pageCount: number;
  /** Zero-based index of the first body page in the final file. */
  bodyStartPageIndex: number;
  landmarks: CanonicalPageLandmark[];
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
 * Convert the renderer's pre-TOC pagination trace into FINAL PDF coordinates.
 * The renderer lays out the body first and inserts generated TOC pages before
 * it afterwards, so every body landmark must be shifted by insertedTocPages.
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
    source: 'nova-pdf',
    engineId: input.engineId || 'nova',
    pageCount,
    bodyStartPageIndex,
    landmarks,
  };
}
