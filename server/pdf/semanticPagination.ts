import type {
  CanonicalPageMapEntry,
  PaginationResult,
} from '../../src/utils/canonicalPageMap';

export interface RenderedSectionStart {
  id?: string;
  title: string;
  pageIndex: number;
}

export interface RenderedChapterStart {
  id?: string;
  title: string;
  chapterIndex: number;
  pageIndex: number;
  sections: RenderedSectionStart[];
}

export interface NovaSemanticPaginationInput {
  totalPages: number;
  chapterStarts: RenderedChapterStart[];
  /**
   * Index at which TOC pages were inserted into the already composed PDF.
   * Null when no TOC was inserted.
   */
  tocInsertIndex?: number | null;
  insertedTocPages?: number;
  titlePageShown?: boolean;
  copyrightPageIndex?: number | null;
  dedicationPageIndex?: number | null;
  epigraphPageIndex?: number | null;
}

function finalPageIndex(
  sourcePageIndex: number,
  tocInsertIndex: number | null,
  insertedTocPages: number
): number {
  if (tocInsertIndex == null || insertedTocPages <= 0) return sourcePageIndex;
  return sourcePageIndex >= tocInsertIndex
    ? sourcePageIndex + insertedTocPages
    : sourcePageIndex;
}

/**
 * Builds the semantic map from page-break positions measured by the same
 * pdf-lib compositor that produced the PDF. No browser pagination or content
 * estimation is allowed here.
 */
export function buildNovaSemanticPagination(
  input: NovaSemanticPaginationInput
): PaginationResult {
  const totalPages = Math.max(0, Math.floor(Number(input.totalPages) || 0));
  const tocInsertIndex = Number.isInteger(input.tocInsertIndex)
    ? Math.max(0, Number(input.tocInsertIndex))
    : null;
  const insertedTocPages = Math.max(0, Math.floor(Number(input.insertedTocPages) || 0));

  const pageMap: CanonicalPageMapEntry[] = Array.from(
    { length: totalPages },
    (_, pageIndex) => ({
      pageNumber: pageIndex + 1,
      pageIndex,
      pageType: 'content' as const,
    })
  );

  const mark = (pageIndex: number, patch: Partial<CanonicalPageMapEntry>) => {
    if (pageIndex < 0 || pageIndex >= pageMap.length) return;
    pageMap[pageIndex] = { ...pageMap[pageIndex], ...patch };
  };

  if (input.titlePageShown && totalPages > 0) {
    mark(0, { pageType: 'title' });
  }
  if (input.copyrightPageIndex != null) {
    mark(input.copyrightPageIndex, { pageType: 'copyright' });
  }
  if (input.dedicationPageIndex != null) {
    mark(input.dedicationPageIndex, { pageType: 'dedication' });
  }
  if (input.epigraphPageIndex != null) {
    mark(input.epigraphPageIndex, { pageType: 'epigraph' });
  }

  if (tocInsertIndex != null && insertedTocPages > 0) {
    for (let offset = 0; offset < insertedTocPages; offset += 1) {
      mark(tocInsertIndex + offset, { pageType: 'toc' });
    }
  }

  for (const chapter of input.chapterStarts) {
    const chapterPageIndex = finalPageIndex(
      chapter.pageIndex,
      tocInsertIndex,
      insertedTocPages
    );
    mark(chapterPageIndex, {
      pageType: 'chapter-start',
      ...(chapter.id ? { chapterId: chapter.id } : {}),
      chapterTitle: chapter.title,
      chapterIndex: chapter.chapterIndex,
      isChapterStart: true,
    });

    for (const section of chapter.sections) {
      const sectionPageIndex = finalPageIndex(
        section.pageIndex,
        tocInsertIndex,
        insertedTocPages
      );
      const current = pageMap[sectionPageIndex];
      if (!current) continue;
      mark(sectionPageIndex, {
        ...(chapter.id ? { chapterId: chapter.id } : {}),
        chapterTitle: chapter.title,
        chapterIndex: chapter.chapterIndex,
        ...(section.id ? { sectionId: section.id } : {}),
        sectionTitle: section.title,
        // A section can begin on the same physical page as its chapter.
        // Preserve chapter-start in that case.
        pageType: current.pageType === 'chapter-start' ? 'chapter-start' : 'content',
      });
    }
  }

  return {
    engineId: 'nova',
    engineLabel: 'Nova (власна верстка)',
    totalPages,
    pageMap,
    generatedAt: new Date().toISOString(),
    exportAuthoritative: true,
    mappingLevel: 'semantic',
  };
}
