import React, { useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  BookOpen, 
  Maximize2, 
  Minimize2, 
  Layers, 
  Sparkles,
  Search,
  Bookmark,
  QrCode
} from 'lucide-react';
import { Book } from '../types';
import { computeTableOfContents, getLeaderSymbol, getDisplayPageNumber } from '../utils/helpers';
import { useRealBookPages } from '../utils/useRealBookPages';
import { useLanguage } from '../i18n/LanguageContext';

interface BookPreviewViewProps {
  book: Book;
  totalWords: number;
}

export const BookPreviewView: React.FC<BookPreviewViewProps> = ({ book, totalWords }) => {
  const { t } = useLanguage();
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const layout = book.layoutConfig;
  const tocConfig = layout.tocConfig || {
    leaderStyle: 'dots',
    numberingStyle: 'arabic',
    showSectionSubitems: true,
    showFrontMatter: true,
    title: 'ЗМІСТ',
    customPrefix: 'Глава',
    pageNumberPosition: 'right',
  };

  const computedTocItems = computeTableOfContents(book);

  // Реальна пагінація: вимірює справжню відрендерену висоту насиченого
  // тексту (жирний/курсив/шрифт/кегль/картинки) проти реального формату
  // сторінки — не та сама евристика, що в «Змісті»/«Верстці PDF» (там усе
  // ще швидка оцінка на символах, свідомо не змінена цим заходом).
  const pages = useRealBookPages(book);

  const totalBookPages = pages.length;
  const leftPageIndex = currentPageIndex;
  const rightPageIndex = currentPageIndex + 1 < totalBookPages ? currentPageIndex + 1 : null;

  const handleNextSpread = () => {
    if (currentPageIndex + 2 < totalBookPages) {
      setCurrentPageIndex(currentPageIndex + 2);
    }
  };

  const handlePrevSpread = () => {
    if (currentPageIndex - 2 >= 0) {
      setCurrentPageIndex(currentPageIndex - 2);
    }
  };

  const renderPageContent = (page: (typeof pages)[0], pageNumber: number | null, isRight: boolean) => {
    if (!page) {
      return (
        <div className="w-full h-full bg-[#faf9f5] flex items-center justify-center text-slate-300 text-xs italic">
          {t('bookPreviewView.blankPage')}
        </div>
      );
    }

    if (page.type === 'title-page') {
      return (
        <div className="w-full h-full flex flex-col justify-between items-center text-center p-8 py-14 bg-[#fffefc] text-slate-900">
          <div className="space-y-3 pt-8">
            <span className="text-xs uppercase tracking-widest text-slate-400 font-mono">
              Художнє видання
            </span>
            <h1 className="text-3xl font-bold font-serif-book leading-tight text-slate-950">
              {page.title}
            </h1>
            {page.content && (
              <h2 className="text-base text-slate-600 font-serif-book italic">
                {page.content}
              </h2>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              {page.author}
            </p>
            <div className="w-8 h-0.5 bg-slate-300 mx-auto my-3" />
            <p className="text-[10px] text-slate-400 font-mono">
              Цифрова Майстерня Nova Glass • 2084
            </p>
          </div>
        </div>
      );
    }

    if (page.type === 'copyright-page') {
      return (
        <div className="w-full h-full flex flex-col justify-end p-8 pb-12 bg-[#fffefc] text-slate-800 text-[11px] font-serif-book leading-relaxed space-y-3">
          <p className="whitespace-pre-wrap">{page.content}</p>
          <div className="border-t border-slate-200 pt-3 text-[10px] text-slate-500 font-mono">
            <p>ISBN {book.coverConfig.barcode || '978-617-0000-00-0'}</p>
            <p>© {book.author}, 2084</p>
            <p>Усі права захищено законодавством України.</p>
          </div>
        </div>
      );
    }

    if (page.type === 'dedication-page') {
      return (
        <div className="w-full h-full flex items-center justify-center p-12 bg-[#fffefc] text-slate-900 text-center font-serif-book italic text-base">
          <p className="max-w-xs leading-relaxed">
            «{page.content}»
          </p>
        </div>
      );
    }

    if (page.type === 'epigraph-page') {
      return (
        <div className="w-full h-full flex flex-col justify-center items-end p-12 bg-[#fffefc] text-slate-900 text-right font-serif-book space-y-3">
          <blockquote className="text-sm italic max-w-xs leading-relaxed">
            «{page.content}»
          </blockquote>
          <p className="text-xs font-bold text-slate-700">
            — {page.author}
          </p>
        </div>
      );
    }

    // TABLE OF CONTENTS REALISTIC PRINT SPREAD
    if (page.type === 'toc-page') {
      return (
        <div className="w-full h-full p-8 py-10 bg-[#fffefc] text-slate-900 flex flex-col justify-between font-serif-book">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-center border-b-2 border-slate-900 pb-2 tracking-wider">
              {tocConfig.title || 'ЗМІСТ'}
            </h2>
            <div className="space-y-2 text-xs">
              {computedTocItems.map((item) => (
                <div key={item.id} className="flex items-baseline justify-between">
                  <span className={`shrink-0 flex items-center gap-1.5 ${item.type === 'section' ? 'pl-4 text-slate-700 text-[11px]' : 'font-bold text-slate-900'}`}>
                    {item.displayNumber && <span className="text-slate-600 font-mono">{item.displayNumber}.</span>}
                    <span>{item.title}</span>
                  </span>

                  <span className="flex-1 mx-1 overflow-hidden text-slate-400 select-none whitespace-nowrap text-[9px] font-mono leading-none tracking-widest text-center">
                    {getLeaderSymbol(tocConfig.leaderStyle)}
                  </span>

                  <span className="shrink-0 font-mono font-bold text-slate-900 text-[11px]">
                    {item.pageNumber ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {pageNumber !== null && (
            <div className="text-center text-[10px] font-mono text-slate-400">
              — {pageNumber} —
            </div>
          )}
        </div>
      );
    }

    if (page.type === 'chapter-title') {
      return (
        <div className="w-full h-full p-8 py-16 bg-[#fffefc] text-slate-900 flex flex-col justify-between text-center font-serif-book">
          <div className="space-y-4 pt-10">
            <span className="text-xs uppercase tracking-widest text-slate-400 font-mono">
              Глава {page.chapterIndex}
            </span>
            <h2 className="text-2xl font-bold text-slate-950">
              {page.title}
            </h2>
            <div className="w-10 h-0.5 bg-slate-300 mx-auto my-4" />
            {page.content && (
              <p className="text-xs text-slate-600 italic max-w-xs mx-auto">
                {page.content}
              </p>
            )}
          </div>
          {pageNumber !== null && (
            <div className="text-[10px] font-mono text-slate-400">
              — {pageNumber} —
            </div>
          )}
        </div>
      );
    }

    // Body text page with footnotes & QR codes
    const pageFootnotes = (book.footnotes || []).filter(f => f.sectionId === page.sectionId);
    const pageQrTags = (book.qrTags || []).filter(q => q.sectionId === page.sectionId);
    const pageIllustrations = (book.illustrations || []).filter(ill => ill.sectionId === page.sectionId);

    return (
      <div className="w-full h-full p-8 py-7 bg-[#fffefc] text-slate-900 flex flex-col justify-between font-serif-book">
        {/* Kolontytul */}
        <div className="flex items-center justify-between text-[9px] text-slate-400 uppercase tracking-widest font-mono border-b border-slate-100 pb-1.5">
          <span>{isRight ? page.title : book.title}</span>
          <span>{isRight ? 'Частина I' : book.author}</span>
        </div>

        {/* Text Body with indent & justify — насичений HTML (жирний/курсив/шрифт/кегль/картинки),
            реально відрендерений і розбитий по сторінках у utils/useRealBookPages.ts. */}
        <div
          className="flex-1 overflow-hidden py-3 text-justify text-xs leading-relaxed space-y-2 text-slate-800 [&_p]:m-0"
          style={{
            fontFamily: layout.typography.bodyFont === 'Literata' ? 'Literata, Georgia, serif' : 'sans-serif',
            fontSize: `${layout.typography.fontSizePt * 0.9}px`,
            lineHeight: layout.typography.lineHeight,
            textIndent: `${layout.typography.firstLineIndentMm * 2}px`,
          }}
          dangerouslySetInnerHTML={{ __html: page.content || '' }}
        />

        {/* Ілюстрації розділу (введені в «Книга & Текст») */}
        {pageIllustrations.length > 0 && (
          <div className="grid grid-cols-2 gap-2 py-2">
            {pageIllustrations.map((ill) => (
              <figure key={ill.id} className="m-0">
                <img src={ill.url} alt={ill.caption || ''} className="w-full h-24 object-cover rounded border border-slate-200" />
                {ill.caption && <figcaption className="text-[8px] text-slate-500 italic mt-0.5">{ill.caption}</figcaption>}
              </figure>
            ))}
          </div>
        )}

        {/* Footnotes & QR tags at bottom of page */}
        {(pageFootnotes.length > 0 || pageQrTags.length > 0) && (
          <div className="border-t border-slate-200 pt-2 space-y-1.5 text-[9px] text-slate-600">
            {pageQrTags.slice(0, 1).map((q) => (
              <div key={q.id} className="flex items-center gap-2 p-1 bg-slate-50 rounded border border-slate-200">
                {q.svgData && <img src={q.svgData} alt={q.title} className="w-6 h-6" />}
                <div className="truncate">
                  <span className="font-bold text-slate-900">📱 {q.title}</span>: <span className="font-mono text-[8px] text-slate-500">{q.payload}</span>
                </div>
              </div>
            ))}

            {pageFootnotes.slice(0, 2).map((fn) => (
              <div key={fn.id} className="flex items-baseline gap-1">
                <span className="font-bold font-mono">[{fn.marker}]</span>
                {fn.term && <span className="font-semibold text-slate-800">{fn.term}:</span>}
                <span className="truncate">{fn.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Page Folio Number */}
        {pageNumber !== null && (
          <div className="text-center text-[10px] font-mono text-slate-400 pt-1">
            — {pageNumber} —
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 flex flex-col space-y-6">
      
      {/* Top Controls Bar */}
      <div className="nova-glass-dark rounded-2xl p-4 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs uppercase tracking-wider text-cyan-400 font-bold block">
            {t('bookPreviewView.spreadLabel')}
          </span>
          <h1 className="text-lg font-bold text-white font-heading">
            {t('bookPreviewView.titleLine', { title: book.title, preset: layout.formatPreset, n: String(totalBookPages) })}
          </h1>
        </div>

        {/* Pagination navigator */}
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrevSpread}
            disabled={currentPageIndex === 0}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-bold text-slate-200 border border-slate-700 transition-all"
            data-tour="preview__2"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{t('bookPreviewView.prevBtn')}</span>
          </button>

          <span className="text-xs font-mono bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-cyan-300">
            {t('bookPreviewView.pageRangeLabel', { a: String(leftPageIndex + 1), b: String(rightPageIndex ? rightPageIndex + 1 : leftPageIndex + 1), c: String(totalBookPages) })}
          </span>

          <button
            onClick={handleNextSpread}
            disabled={currentPageIndex + 2 >= totalBookPages}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-bold text-slate-200 border border-slate-700 transition-all"
            data-tour="preview__3"
          >
            <span>{t('bookPreviewView.nextBtn')}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Book Spread Realistic Canvas */}
      <div className="flex-1 flex items-center justify-center p-2 sm:p-6 bg-slate-950 rounded-3xl border border-slate-800 shadow-2xl min-h-[560px]">
        
        {/* Book Container with 3D spine shadow */}
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-0 bg-[#e2ded6] rounded-2xl p-2 sm:p-3 shadow-2xl border-4 border-slate-800 relative" data-tour="preview__1">
          
          {/* Central Gutter / Spine Shadow */}
          <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-8 -translate-x-1/2 z-10 bg-gradient-to-r from-black/20 via-black/40 to-black/20 pointer-events-none" />

          {/* Left Page */}
          <div className="aspect-[1/1.45] bg-[#fffefc] rounded-l-xl shadow-md overflow-hidden border-r border-slate-200">
            {renderPageContent(pages[leftPageIndex], getDisplayPageNumber(book, leftPageIndex), false)}
          </div>

          {/* Right Page */}
          <div className="aspect-[1/1.45] bg-[#fffefc] rounded-r-xl shadow-md overflow-hidden border-l border-slate-200">
            {rightPageIndex !== null ? (
              renderPageContent(pages[rightPageIndex], getDisplayPageNumber(book, rightPageIndex), true)
            ) : (
              <div className="w-full h-full bg-[#faf9f5] flex items-center justify-center text-slate-300 text-xs italic">
                {t('bookPreviewView.blankPage')}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Quick Jump Pagination Slider */}
      <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-4 text-xs">
        <span className="text-slate-400 font-mono">1</span>
        <input
          type="range"
          min="0"
          max={Math.max(0, totalBookPages - 2)}
          step="2"
          value={currentPageIndex}
          onChange={(e) => setCurrentPageIndex(parseInt(e.target.value))}
          className="flex-1 accent-cyan-400 cursor-pointer"
          data-tour="preview__4"
        />
        <span className="text-slate-400 font-mono">{totalBookPages}</span>
      </div>

    </div>
  );
};
