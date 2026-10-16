import type { CanonicalPageLandmark, CanonicalPageMap } from '../../../shared/canonicalPageMap';
import type { PdfBookInput } from '../pdfTypes';

export interface DesigncraftTocEntry {
  level?: unknown;
  text?: unknown;
  /** DesignCraft `toc.entries.page`: printed page name, not physical PDF index. */
  page?: unknown;
}

export interface DesigncraftPageMapInput {
  book: PdfBookInput;
  toc: DesigncraftTocEntry[];
  chapterToc: DesigncraftTocEntry[];
  pageCount: number;
  /** 1-based DesignCraft page where the manuscript body starts. */
  bodyPage: number;
  /** Printed number assigned to `bodyPage` by `layout.section`. */
  bodyStartNumber: number;
}

/** Must mirror bookToMarkdown.headingText + the TOC diagnostic normalization. */
function normalizedHeading(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[#*_`\[\]]/g, '')
    .trim()
    .toLocaleLowerCase('uk-UA');
}

function pageNameToNumber(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function fileIndexForDisplayPage(
  displayPage: number,
  bodyPage: number,
  bodyStartNumber: number,
  pageCount: number,
): number | null {
  const bodyStartIndex = Math.max(0, Math.round(bodyPage) - 1);
  const index = bodyStartIndex + (displayPage - Math.max(1, Math.round(bodyStartNumber)));
  if (!Number.isSafeInteger(index) || index < bodyStartIndex || index >= pageCount) return null;
  return index;
}

function exactLandmark(
  kind: 'chapter' | 'section',
  id: string,
  title: string,
  chapterId: string,
  entry: DesigncraftTocEntry,
  input: DesigncraftPageMapInput,
): CanonicalPageLandmark | null {
  const displayPageNumber = pageNameToNumber(entry.page);
  if (displayPageNumber == null) return null;
  const filePageIndex = fileIndexForDisplayPage(
    displayPageNumber,
    input.bodyPage,
    input.bodyStartNumber,
    input.pageCount,
  );
  if (filePageIndex == null) return null;
  return {
    kind,
    id,
    title,
    chapterId,
    filePageIndex,
    filePageNumber: filePageIndex + 1,
    displayPageNumber,
  };
}

/**
 * Convert DesignCraft's final TOC query into physical PDF coordinates.
 *
 * `toc.entries` deliberately exposes a page *name* (`Document::page_name`),
 * not an absolute file index. The engine creates one Arabic numbering section
 * at the first body page, so the physical index is deterministic:
 *
 *   bodyFileIndex + (printedPage - bodyStartNumber)
 *
 * The manuscript converter sorts chapters and sections by `order`; this helper
 * mirrors that exact order before assigning stable source ids. We reject the
 * map rather than guess when a heading or printed page cannot be matched.
 */
export function buildDesigncraftCanonicalPageMap(input: DesigncraftPageMapInput): CanonicalPageMap | null {
  const pageCount = Math.max(0, Math.round(Number(input.pageCount) || 0));
  const bodyStartPageIndex = Math.max(0, Math.round(input.bodyPage) - 1);
  const chapters = (input.book.chapters || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (!pageCount || bodyStartPageIndex >= pageCount) return null;
  if (input.chapterToc.length !== chapters.length) return null;

  const landmarks: CanonicalPageLandmark[] = [];

  for (let i = 0; i < chapters.length; i += 1) {
    const chapter = chapters[i];
    const entry = input.chapterToc[i];
    const title = String(chapter.title || '').trim();
    if (!title || normalizedHeading(entry.text) !== normalizedHeading(title)) return null;
    const chapterId = String(chapter.id || `chapter-${i + 1}`);
    const landmark = exactLandmark('chapter', chapterId, title, chapterId, entry, input);
    if (!landmark) return null;
    landmarks.push(landmark);
  }

  let chapterIndex = -1;
  let sectionIndex = 0;

  for (const entry of input.toc) {
    const level = Number(entry.level);
    const text = String(entry.text || '').trim();
    if (!text) continue;

    if (level === 1) {
      chapterIndex += 1;
      sectionIndex = 0;
      const chapter = chapters[chapterIndex];
      if (!chapter || normalizedHeading(chapter.title) !== normalizedHeading(text)) return null;
      continue;
    }

    if (level !== 2 || chapterIndex < 0) continue;
    const chapter = chapters[chapterIndex];
    const sections = (chapter.sections || [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Untitled sections do not create Heading 2 in bookToMarkdown, so skip them.
    while (sectionIndex < sections.length && !normalizedHeading(sections[sectionIndex].title)) {
      sectionIndex += 1;
    }
    const section = sections[sectionIndex];
    if (!section || normalizedHeading(section.title) !== normalizedHeading(text)) return null;
    sectionIndex += 1;

    const chapterId = String(chapter.id || `chapter-${chapterIndex + 1}`);
    const sectionId = String(section.id || `section-${chapterIndex + 1}-${sectionIndex}`);
    const landmark = exactLandmark('section', sectionId, String(section.title || text), chapterId, entry, input);
    if (!landmark) return null;
    landmarks.push(landmark);
  }

  return {
    version: 1,
    source: 'designcraft-toc',
    engineId: 'designcraft',
    precision: 'exact',
    pageCount,
    bodyStartPageIndex,
    landmarks,
  };
}
