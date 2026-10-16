import type { BookPage } from './helpers';

export interface PreviewChapterMarker {
  chapterId: string;
  title: string;
  pageIndex: number;
  pageNumber: number;
  spreadIndex: number;
  spreadStartPageIndex: number;
  progress: number;
}

/**
 * Chapter landmarks for the *measured* browser page list used by
 * «Розворот книги». This deliberately does not call buildBookPages(): the
 * latter can use the fast character-count pagination, while preview pages
 * may already have been repaginated after fonts/images loaded.
 */
export function buildPreviewChapterMarkers(pages: BookPage[]): PreviewChapterMarker[] {
  if (!Array.isArray(pages) || pages.length === 0) return [];

  const denominator = Math.max(1, pages.length - 1);
  const seen = new Set<string>();
  const markers: PreviewChapterMarker[] = [];

  pages.forEach((page, pageIndex) => {
    if (page.type !== 'chapter-title' || !page.chapterId || seen.has(page.chapterId)) return;
    seen.add(page.chapterId);

    const spreadStartPageIndex = Math.floor(pageIndex / 2) * 2;
    markers.push({
      chapterId: page.chapterId,
      title: (page.title || `Глава ${page.chapterIndex ?? markers.length + 1}`).trim(),
      pageIndex,
      pageNumber: pageIndex + 1,
      spreadIndex: Math.floor(pageIndex / 2),
      spreadStartPageIndex,
      progress: Math.max(0, Math.min(1, pageIndex / denominator)),
    });
  });

  return markers;
}

export function nearestPreviewChapter(
  markers: PreviewChapterMarker[],
  currentPageIndex: number,
): PreviewChapterMarker | null {
  if (!markers.length) return null;
  let current = markers[0];
  for (const marker of markers) {
    if (marker.pageIndex > currentPageIndex) break;
    current = marker;
  }
  return current;
}
