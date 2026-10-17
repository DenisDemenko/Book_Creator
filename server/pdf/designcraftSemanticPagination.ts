import type {
  CanonicalPageMapEntry,
  PaginationResult,
} from '../../src/utils/canonicalPageMap';
import type { PdfBookInput } from './pdfTypes';

type TocEntry = { level?: number; text?: string; page?: string | number };
type InspectPage = { index?: number; name?: string | number };
type InspectSpread = { pages?: InspectPage[] };
type DocumentInspect = { pageCount?: number; spreads?: InspectSpread[] };

function normalizedHeading(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[#*_`\[\]]/g, '')
    .trim() || 'Розділ';
}

function pageNameIndexes(inspect: DocumentInspect): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const spread of inspect.spreads || []) {
    for (const page of spread.pages || []) {
      const index = Number(page.index);
      const name = String(page.name ?? '');
      if (!Number.isInteger(index) || index < 0 || !name) continue;
      const indexes = out.get(name) || [];
      indexes.push(index);
      indexes.sort((a, b) => a - b);
      out.set(name, indexes);
    }
  }
  return out;
}

function resolvePageIndex(
  byName: Map<string, number[]>,
  pageName: string,
  minIndex: number,
  afterOrEqual: number
): number | undefined {
  const candidates = byName.get(pageName) || [];
  return candidates.find((index) => index >= minIndex && index >= afterOrEqual);
}

/**
 * Convert DesignCraft's visible TOC page names into physical zero-based page
 * indices using document.inspect. This is deliberately not Number(page)-1:
 * DesignCraft page names may be roman numerals, prefixed, restarted, or
 * repeated across sections/front matter.
 */
export function buildDesigncraftSemanticPagination(input: {
  book: PdfBookInput;
  tocEntries: TocEntry[];
  chapterEntries: TocEntry[];
  inspect: DocumentInspect;
  titlePageShown?: boolean;
  tocPageIndex?: number | null;
  /** First physical page that may contain manuscript headings. */
  contentStartPageIndex?: number;
}): PaginationResult {
  const totalPages = Math.max(0, Math.floor(Number(input.inspect.pageCount) || 0));
  const byName = pageNameIndexes(input.inspect);
  const contentStart = Math.max(0, Math.floor(Number(input.contentStartPageIndex) || 0));
  const pageMap: CanonicalPageMapEntry[] = Array.from(
    { length: totalPages },
    (_, pageIndex) => ({
      pageNumber: pageIndex + 1,
      pageIndex,
      pageType: 'content',
    })
  );

  const mark = (pageIndex: number, patch: Partial<CanonicalPageMapEntry>) => {
    if (pageIndex < 0 || pageIndex >= pageMap.length) {
      throw new Error(`DesignCraft semantic entry resolved outside PDF: pageIndex=${pageIndex}, totalPages=${totalPages}.`);
    }
    pageMap[pageIndex] = { ...pageMap[pageIndex], ...patch };
  };

  if (input.titlePageShown && totalPages > 0) mark(0, { pageType: 'title' });
  if (input.tocPageIndex != null && input.tocPageIndex >= 0 && input.tocPageIndex < totalPages) {
    mark(input.tocPageIndex, { pageType: 'toc' });
  }

  const chapters = input.book.chapters || [];
  if (input.chapterEntries.length !== chapters.length) {
    throw new Error(`DesignCraft chapter mapping mismatch: book=${chapters.length}, toc=${input.chapterEntries.length}.`);
  }

  const chapterPageIndexes: number[] = [];
  let chapterFloor = contentStart;
  input.chapterEntries.forEach((entry, chapterIndex) => {
    const chapter = chapters[chapterIndex];
    if (normalizedHeading(entry.text) !== normalizedHeading(chapter.title)) {
      throw new Error(
        `DesignCraft chapter order mismatch at ${chapterIndex + 1}: ` +
          `book=«${chapter.title}», toc=«${String(entry.text || '')}».`
      );
    }
    const pageName = String(entry.page ?? '');
    const pageIndex = resolvePageIndex(byName, pageName, contentStart, chapterFloor);
    if (pageIndex == null) throw new Error(`DesignCraft chapter «${chapter.title}» points to unresolved page name «${pageName}».`);
    chapterPageIndexes.push(pageIndex);
    chapterFloor = pageIndex;
    mark(pageIndex, {
      pageType: 'chapter-start',
      ...(chapter.id ? { chapterId: chapter.id } : {}),
      chapterTitle: chapter.title,
      chapterIndex: chapterIndex + 1,
      isChapterStart: true,
    });
  });

  let chapterCursor = -1;
  let sectionCursor = 0;
  let semanticFloor = contentStart;
  for (const entry of input.tocEntries) {
    const level = Number(entry.level);
    if (level === 1) {
      chapterCursor += 1;
      sectionCursor = 0;
      if (chapterCursor >= 0 && chapterCursor < chapterPageIndexes.length) {
        semanticFloor = chapterPageIndexes[chapterCursor];
      }
      continue;
    }
    if (level !== 2 || chapterCursor < 0 || chapterCursor >= chapters.length) continue;

    const chapter = chapters[chapterCursor];
    const titledSections = (chapter.sections || []).filter((section) => String(section.title || '').trim());
    const section = titledSections[sectionCursor++];
    if (!section) {
      throw new Error(`DesignCraft returned extra Heading 2 under chapter «${chapter.title}».`);
    }
    if (normalizedHeading(entry.text) !== normalizedHeading(section.title)) {
      throw new Error(
        `DesignCraft section order mismatch in «${chapter.title}»: ` +
          `book=«${String(section.title || '')}», toc=«${String(entry.text || '')}».`
      );
    }
    const pageName = String(entry.page ?? '');
    const pageIndex = resolvePageIndex(byName, pageName, contentStart, semanticFloor);
    if (pageIndex == null) {
      throw new Error(`DesignCraft section «${String(section.title || '')}» points to unresolved page name «${pageName}».`);
    }
    semanticFloor = pageIndex;
    const current = pageMap[pageIndex];
    mark(pageIndex, {
      ...(chapter.id ? { chapterId: chapter.id } : {}),
      chapterTitle: chapter.title,
      chapterIndex: chapterCursor + 1,
      ...(section.id ? { sectionId: section.id } : {}),
      sectionTitle: section.title,
      pageType: current.pageType === 'chapter-start' ? 'chapter-start' : 'content',
    });
  }

  return {
    engineId: 'designcraft',
    engineLabel: 'DesignCraft',
    totalPages,
    pageMap,
    generatedAt: new Date().toISOString(),
    exportAuthoritative: true,
    mappingLevel: 'semantic',
  };
}
