import React, { useMemo } from 'react';
import type { BookPageMap } from '../utils/bookPageMap';
import { spreadIndexForPage } from '../utils/bookPageMap';

export interface ChapterPaginationSliderProps {
  pageMap: BookPageMap;
  currentPageIndex: number;
  onChange: (leftPageIndex: number) => void;
}

export const ChapterPaginationSlider: React.FC<ChapterPaginationSliderProps> = ({
  pageMap,
  currentPageIndex,
  onChange,
}) => {
  const max = Math.max(0, pageMap.totalPages - 2);
  const currentChapter = useMemo(() => {
    let active = pageMap.chapterMilestones[0];
    for (const milestone of pageMap.chapterMilestones) {
      if (milestone.pageIndex <= currentPageIndex + 1) active = milestone;
      else break;
    }
    return active;
  }, [pageMap.chapterMilestones, currentPageIndex]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-xs" data-chapter-page-slider>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-mono text-slate-400">1</span>
        <span className="min-w-0 truncate text-center text-[11px] font-semibold text-cyan-300">
          {currentChapter ? `Глава ${currentChapter.chapterIndex} · ${currentChapter.title}` : 'Початок книги'}
        </span>
        <span className="font-mono text-slate-400">{pageMap.totalPages}</span>
      </div>

      <div className="relative pb-8 pt-1">
        <input
          type="range"
          min={0}
          max={max}
          step={2}
          value={Math.min(currentPageIndex, max)}
          onChange={(event) => onChange(Number(event.target.value))}
          className="relative z-10 w-full cursor-pointer accent-cyan-400"
          data-tour="preview__4"
          aria-label="Перейти до розвороту книги"
        />

        <div className="pointer-events-none absolute inset-x-[7px] top-[13px] h-5">
          {pageMap.chapterMilestones.map((milestone, index) => {
            const denominator = Math.max(1, pageMap.totalPages - 1);
            const left = (milestone.pageIndex / denominator) * 100;
            return (
              <button
                key={milestone.chapterId}
                type="button"
                className="pointer-events-auto absolute top-0 -translate-x-1/2 group"
                style={{ left: `${left}%` }}
                onClick={() => onChange(spreadIndexForPage(milestone.pageIndex, pageMap.totalPages))}
                title={`Глава ${milestone.chapterIndex}: ${milestone.title} · стор. ${milestone.pageNumber}`}
                aria-label={`Перейти до глави ${milestone.chapterIndex}: ${milestone.title}`}
              >
                <span className="block h-3 w-3 rounded-full border-2 border-slate-950 bg-cyan-400 shadow-sm ring-1 ring-cyan-300/50" />
                <span
                  className={`absolute top-4 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] text-slate-300 shadow-lg ${
                    index === 0 ? 'left-0' : index === pageMap.chapterMilestones.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                  } opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100`}
                >
                  {milestone.chapterIndex}. {milestone.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500">
        <span>{pageMap.chapterMilestones.length} глав</span>
        <span className="font-mono">PageMap · {pageMap.source}</span>
      </div>
    </div>
  );
};
