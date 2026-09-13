import { useEffect, useRef, useState } from 'react';
import { Book, Chapter, Section } from '../types';
import { BookPage, buildBookPages, renderSectionBlocksHtml } from './helpers';
import { computeBreaksFromBounds } from './pageBreaker';
import { PX_PER_MM } from './mmUnits';
import { resolvePageGeometry } from './pageGeometry';
import { bodyFontStack, paragraphCssVars, resolveParagraphGeometry } from './typography';

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
      // Геометрія аркуша — з єдиного джерела (utils/pageGeometry.ts). Раніше
      // тут стояли ті самі два віднімання, але БЕЗ запасного розміру взагалі:
      // книга без `pageWidthMm` давала `NaN` у ширині прихованого контейнера,
      // і пагінація «Розвороту книги» ламалась мовчки.
      const geometry = resolvePageGeometry(layout);
      const contentHeightPx = geometry.contentHeightMm * PX_PER_MM;

      // Типографіка й абзацна геометрія — ті самі, що в живому редакторі:
      // той самий клас `.nova-manuscript-blocks` і ті самі CSS-змінні
      // (utils/typography.ts). До цього цей контейнер був голий, а Tailwind-ів
      // preflight знімає поля абзаців до нуля — тому сторінок виходило менше,
      // ніж показував редактор, і ті самі абзаци лягали інакше.
      const typography = resolveParagraphGeometry(layout);
      container.className = 'nova-manuscript-blocks';
      Object.entries(paragraphCssVars(typography)).forEach(([name, value]) =>
        container.style.setProperty(name, value)
      );
      // Ширина — точно текстова зона аркуша (без жодних внутрішніх відступів):
      // саме ця ширина визначає, де переносяться рядки, а отже й розбиття.
      container.style.width = `${geometry.contentWidthMm}mm`;
      container.style.fontFamily = bodyFontStack(layout.typography.bodyFont);
      container.style.fontSize = `${typography.fontSizePx}px`;
      container.style.lineHeight = String(typography.lineHeight);

      const allFootnotes = book.footnotes || [];

      const sectionPager = (sec: Section, chap: Chapter, chapterIndex: number): BookPage[] => {
        const secFootnotes = allFootnotes.filter((f) => f.sectionId === sec.id);
        const html = renderSectionBlocksHtml(sec.content, book, secFootnotes, allFootnotes);
        container.innerHTML = html || '';

        const children = Array.from(container.children) as HTMLElement[];
        // Порожній розділ — жодної сторінки, так само як стара евристика в
        // buildBookPages (яка теж нічого не додає, якщо currentChunk.trim() порожній).
        if (children.length === 0) return [];

        // Вимірюємо МЕЖІ блоків (як живий редактор), а не їхні власні висоти:
        // сума висот не враховує відступів між абзацами й обтікання, тому
        // сторінок виходило більше, ніж уміщається в аркуш. `top` рахуємо від
        // верху контейнера — він у нас прихований і зсунутий за екран, але
        // різниця координат від цього не залежить.
        const containerTop = container.getBoundingClientRect().top;
        const bounds = children.map((child) => {
          const r = child.getBoundingClientRect();
          return { top: r.top - containerTop, bottom: r.bottom - containerTop };
        });
        // Обтічне фото не має лишатися останнім на сторінці — те саме правило
        // й той самий алгоритм, що в живому редакторі (PaginationPlugin.ts).
        const keepWithNext = children.map((child) => getComputedStyle(child).float !== 'none');
        const breaks = computeBreaksFromBounds(bounds, contentHeightPx, keepWithNext);
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
