import { useEffect, useRef, useState } from 'react';
import { Book, Chapter, Section } from '../types';
import { BookPage, buildBookPages, renderSectionBlocksHtml } from './helpers';
import { computeBreaks } from './pageBreaker';
import { PX_PER_MM } from './mmUnits';

/**
 * Реальна (не евристична) пагінація книги для «Розворот книги» — вимірює
 * справжню відрендерену висоту насиченого HTML (той самий
 * renderSectionContentHtml, що й HTML/PDF-експорт) проти реального формату
 * сторінки й ділить на сторінки рівно там, де контент перестає влазити —
 * той самий алгоритм (computeBreaks), що й живі розриви сторінок у
 * редакторі (PaginationPlugin.ts).
 *
 * TOC і «Верстка PDF» і далі використовують стару швидку евристику в
 * buildBookPages (850 символів на сторінку, без DOM) — свідомо не чіпаємо,
 * бо конвертація тих екранів на реальний вимір означала б робити їх
 * асинхронними, а це вже інший, набагато більший за обсягом захід.
 *
 * Дебаунс 300мс: `book` міняється за кожним натисканням клавіші деінде в
 * застосунку (спільний стан), а вимір усієї книги — не дешева операція.
 */
export function useRealBookPages(book: Book): BookPage[] {
  const [pages, setPages] = useState<BookPage[]>(() => buildBookPages(book));
  const hiddenElRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(el);
    hiddenElRef.current = el;
    return () => {
      el.remove();
      hiddenElRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const container = hiddenElRef.current;
      if (!container) return;

      const layout = book.layoutConfig;
      const margins = layout.margins;
      const contentWidthMm = layout.pageWidthMm - (margins?.insideMm || 0) - (margins?.outsideMm || 0);
      const contentHeightMm = layout.pageHeightMm - (margins?.topMm || 0) - (margins?.bottomMm || 0);
      const contentHeightPx = contentHeightMm * PX_PER_MM;

      container.style.width = `${contentWidthMm}mm`;
      container.style.fontFamily = layout.typography.bodyFont === 'Literata' ? 'Literata, Georgia, serif' : 'sans-serif';
      container.style.fontSize = `${layout.typography.fontSizePt}pt`;
      container.style.lineHeight = String(layout.typography.lineHeight);

      const allFootnotes = book.footnotes || [];

      const sectionPager = (sec: Section, chap: Chapter, chapterIndex: number): BookPage[] => {
        const secFootnotes = allFootnotes.filter((f) => f.sectionId === sec.id);
        const html = renderSectionBlocksHtml(sec.content, book, secFootnotes, allFootnotes);
        container.innerHTML = html || '';

        const children = Array.from(container.children) as HTMLElement[];
        // Порожній розділ — жодної сторінки, так само як стара евристика в
        // buildBookPages (яка теж нічого не додає, якщо currentChunk.trim() порожній).
        if (children.length === 0) return [];

        const heights = children.map((c) => c.getBoundingClientRect().height);
        const breaks = computeBreaks(heights, contentHeightPx);
        const chunkBounds = [0, ...breaks, children.length];

        const result: BookPage[] = [];
        for (let i = 0; i < chunkBounds.length - 1; i++) {
          const from = chunkBounds[i];
          const to = chunkBounds[i + 1];
          if (from === to) continue;
          const chunkHtml = children
            .slice(from, to)
            .map((c) => c.outerHTML)
            .join('');
          result.push({
            type: 'body-page',
            title: sec.title,
            content: chunkHtml,
            chapterIndex,
            chapterId: chap.id,
            sectionId: sec.id,
          });
        }
        return result;
      };

      setPages(buildBookPages(book, sectionPager));
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [book]);

  return pages;
}
