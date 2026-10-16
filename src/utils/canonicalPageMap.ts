import type { Book } from '../types';
import type { BookPage } from './helpers';

export type CanonicalPageType =
  | 'title'
  | 'copyright'
  | 'dedication'
  | 'epigraph'
  | 'toc'
  | 'chapter-start'
  | 'content'
  | 'blank'
  | 'other';

export interface CanonicalPageMapEntry {
  pageNumber: number;
  pageIndex: number;
  pageType: CanonicalPageType;
  chapterId?: string;
  chapterTitle?: string;
  chapterIndex?: number;
  sectionId?: string;
  sectionTitle?: string;
  isChapterStart?: boolean;
}

export interface PaginationResult {
  engineId: string;
  engineLabel: string;
  engineVersion?: string;
  totalPages: number;
  pageMap: CanonicalPageMapEntry[];
  generatedAt: string;
  /** true only when this engine is also the source of final export pagination. */
  exportAuthoritative: boolean;
}

function canonicalPageType(page: BookPage): CanonicalPageType {
  switch (page.type) {
    case 'title-page': return 'title';
    case 'copyright-page': return 'copyright';
    case 'dedication-page': return 'dedication';
    case 'epigraph-page': return 'epigraph';
    case 'toc-page': return 'toc';
    case 'chapter-title': return 'chapter-start';
    case 'body-page': return 'content';
    default: return 'other';
  }
}

/**
 * Converts the actual page array returned by a layout engine into a stable map.
 * It never estimates or repaginates content on its own.
 */
export function buildCanonicalPageMap(
  book: Book,
  pages: BookPage[],
  engine: {
    id: string;
    label: string;
    version?: string;
    exportAuthoritative?: boolean;
  }
): PaginationResult {
  const chapterById = new Map(
    book.chapters.map((chapter, index) => [
      chapter.id,
      { chapter, chapterIndex: index + 1 },
    ] as const)
  );
  const sectionById = new Map(
    book.chapters.flatMap((chapter) =>
      chapter.sections.map((section) => [section.id, section] as const)
    )
  );

  const pageMap: CanonicalPageMapEntry[] = pages.map((page, pageIndex) => {
    const chapterMeta = page.chapterId ? chapterById.get(page.chapterId) : undefined;
    const section = page.sectionId ? sectionById.get(page.sectionId) : undefined;
    return {
      pageNumber: pageIndex + 1,
      pageIndex,
      pageType: canonicalPageType(page),
      ...(page.chapterId ? { chapterId: page.chapterId } : {}),
      ...(chapterMeta ? {
        chapterTitle: chapterMeta.chapter.title,
        chapterIndex: chapterMeta.chapterIndex,
      } : {}),
      ...(page.sectionId ? { sectionId: page.sectionId } : {}),
      ...(section ? { sectionTitle: section.title } : {}),
      ...(page.type === 'chapter-title' ? { isChapterStart: true } : {}),
    };
  });

  return {
    engineId: engine.id,
    engineLabel: engine.label,
    ...(engine.version ? { engineVersion: engine.version } : {}),
    totalPages: pages.length,
    pageMap,
    generatedAt: new Date().toISOString(),
    exportAuthoritative: engine.exportAuthoritative === true,
  };
}

export function chapterMilestones(result: PaginationResult): CanonicalPageMapEntry[] {
  return result.pageMap.filter((entry) => entry.isChapterStart === true);
}

/** Normalizes any page index to the left page of its spread. */
export function spreadStartIndexForPage(pageIndex: number, totalPages: number): number {
  const safe = Math.max(0, Math.min(pageIndex, Math.max(0, totalPages - 1)));
  return safe % 2 === 0 ? safe : safe - 1;
}
