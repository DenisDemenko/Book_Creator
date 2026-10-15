import { useEffect, useState } from 'react';
import type { Book } from '../types';
import { buildBookPages, renderSectionBlocksHtml, type BookPage } from './helpers';
import { measureBookPreview, type PreviewMeasurement } from './previewPagination';

/** Debounced, media-aware browser pagination. Each snapshot has its own DOM
 * and AbortController: an old image response cannot overwrite a newer book. */
export function useBookPreviewMeasurement(book: Book): PreviewMeasurement & { measuring: boolean } {
  const [result, setResult] = useState<PreviewMeasurement & { measuring: boolean }>(() => ({
    pages: buildBookPages(book, (section, chapter, chapterIndex) => section.content.trim() ? [{
      type: 'body-page', title: section.title, chapterId: chapter.id, sectionId: section.id, chapterIndex,
      content: renderSectionBlocksHtml(section.content, book, (book.footnotes || []).filter(f => f.sectionId === section.id), book.footnotes || []),
    }] : []), pendingImages: 0, failedImages: 0, measuring: true,
  }));
  useEffect(() => {
    const controller = new AbortController();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
    document.body.append(host);
    setResult(previous => ({ ...previous, measuring: true }));
    const timer = setTimeout(() => {
      void measureBookPreview(book, host, {
        signal: controller.signal,
        onUpdate: measurement => setResult({ ...measurement, measuring: false }),
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); host.remove(); };
  }, [book]);
  return result;
}

/** Existing editor consumers keep their pages-only contract. */
export function useRealBookPages(book: Book): BookPage[] {
  return useBookPreviewMeasurement(book).pages;
}
