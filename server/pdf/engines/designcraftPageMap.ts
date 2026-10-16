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

function normalizedHeading(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
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
 * We still reject the map unless every source chapter can be matched to the
 * final Heading 1 list and every TOC page name is a numeric page in that body
 * section. A partial/guessed map is worse than an honest page-count-only map.
 */
export function buildDesigncraftCanonicalPageMap(input: DesigncraftPageMapInput): CanonicalPageMap | null {
  const pageCount = Math.max(0, Math.round(Number(input.pageCount) || 0));
  const bodyStartPageIndex = Math.max(0, Math.round(input.bodyPage) - 1);
  const chapters = input.book.chapters || [];

  if (!pageCount || bodyStartPageIndex >= pageCount) return null;
  if (input.chapterToc.length !== chapters.length) return null;

  const landmarks: CanonicalPageLandmark[] = [];
  const chapterIdByHeading = new Map<string, string[]>();

  for (let i = 0; i < chapters.length; i += 1) {
    const chapter = chapters[i];
    const entry = input.chapterToc[i];
    const title = String(chapter.title || '').trim();
    if (!title || normalizedHeading(entry.text) !== normalizedHeading(title)) return null;
    const chapterId = String(chapter.id || `chapter-${i + 1}`);
    const landmark = exactLandmark('chapter', chapterId, title, chapterId, entry, input);
    if (!landmark) return null;
    landmarks.push(landmark);
    const key = normalizedHeading(title);
    chapterIdByHeading.set(key, [...(chapterIdByHeading.get(key) || []), chapterId]);
  }

  // Heading 2 entries are consumed in book order inside their current Heading 1.
  // This avoids assigning a same-named section from another chapter to the wrong id.
  let chapterIndex = -1;
  const nextSectionIndex = new Map<number, number>();
  const consumedChapterHeadings = new Map<string, number>();

  for (const entry of input.toc) {
    const level = Number(entry.level);
    const text = String(entry.text || '').trim();
    if (!text) continue;

    if (level === 1) {
      const key = normalizedHeading(text);
      const ids = chapterIdByHeading.get(key) || [];
      const occurrence = consumedChapterHeadings.get(key) || 0;
      const chapterId = ids[occurrence];
      consumedChapterHeadings.set(key, occurrence + 1);
      chapterIndex = chapters.findIndex((chapter) => String(chapter.id || '') === chapterId);
      if (chapterIndex < 0) {
        // Fallback for source chapters without explicit ids.
        chapterIndex = chapters.findIndex((chapter) => normalizedHeading(chapter.title) === key);
      }
      continue;
    }

    if (level !== 2 || chapterIndex < 0) continue;
    const chapter = chapters[chapterIndex];
    const sections = chapter.sections || [];
    let sectionIndex = nextSectionIndex.get(chapterIndex) || 0;

    while (sectionIndex < sections.length) {
      const candidate = sections[sectionIndex];
      sectionIndex += 1;
      if (normalizedHeading(candidate.title) !== normalizedHeading(text)) continue;
      nextSectionIndex.set(chapterIndex, sectionIndex);
      const chapterId = String(chapter.id || `chapter-${chapterIndex + 1}`);
      const sectionId = String(candidate.id || `section-${chapterIndex + 1}-${sectionIndex}`);
      const landmark = exactLandmark('section', sectionId, String(candidate.title || text), chapterId, entry, input);
      if (!landmark) return null;
      landmarks.push(landmark);
      break;
    }
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
