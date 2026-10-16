import type { Book } from '../types';
import type { BookPage } from './helpers';

export interface ChapterPageMilestone {
  chapterId: string;
  chapterIndex: number;
  title: string;
  pageIndex: number;
  pageNumber: number;
}

export interface BookPageMapEntry {
  pageIndex: number;
  pageNumber: number;
  type: BookPage['type'];
  chapterId?: string;
  chapterIndex?: number;
  chapterTitle?: string;
  sectionId?: string;
}

export interface BookPageMap {
  source: 'measured-preview' | 'layout-engine';
  totalPages: number;
  pages: BookPageMapEntry[];
  chapterMilestones: ChapterPageMilestone[];
}

/**
 * Canonical navigation map over an already-paginated page sequence.
 *
 * It never estimates pagination itself. The selected pagination engine owns
 * the page sequence; this helper only gives all consumers (spread slider,
 * chapter milestones, future TOC/export adapters) the same coordinates.
 */
export function buildBookPageMap(
  book: Book,
  pages: BookPage[],
  source: BookPageMap['source'] = 'measured-preview',
): BookPageMap {
  const chapterById = new Map(book.chapters.map((chapter, index) => [chapter.id, { chapter, index }]));
  const entries: BookPageMapEntry[] = pages.map((page, pageIndex) => {
    const chapter = page.chapterId ? chapterById.get(page.chapterId) : undefined;
    return {
      pageIndex,
      pageNumber: pageIndex + 1,
      type: page.type,
      chapterId: page.chapterId,
      chapterIndex: page.chapterIndex ?? (chapter ? chapter.index + 1 : undefined),
      chapterTitle: chapter?.chapter.title,
      sectionId: page.sectionId,
    };
  });

  const chapterMilestones: ChapterPageMilestone[] = [];
  const seen = new Set<string>();
  for (const page of entries) {
    if (!page.chapterId || seen.has(page.chapterId)) continue;
    const chapter = chapterById.get(page.chapterId);
    if (!chapter) continue;
    seen.add(page.chapterId);
    chapterMilestones.push({
      chapterId: page.chapterId,
      chapterIndex: chapter.index + 1,
      title: chapter.chapter.title,
      pageIndex: page.pageIndex,
      pageNumber: page.pageNumber,
    });
  }

  return { source, totalPages: entries.length, pages: entries, chapterMilestones };
}

/** Range sliders move by spreads, so chapter starts snap to an even left page. */
export function spreadIndexForPage(pageIndex: number, totalPages: number): number {
  if (totalPages <= 1) return 0;
  const clamped = Math.max(0, Math.min(pageIndex, totalPages - 1));
  return clamped % 2 === 0 ? clamped : clamped - 1;
}
