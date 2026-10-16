import React, { useMemo } from 'react';
import type { CanonicalPageMap } from '../../shared/canonicalPageMap';

interface CanonicalPageNavigatorProps {
  pageMap: CanonicalPageMap;
  currentPageIndex: number;
  onJump: (spreadStartPageIndex: number) => void;
}

export const CanonicalPageNavigator: React.FC<CanonicalPageNavigatorProps> = ({
  pageMap,
  currentPageIndex,
  onJump,
}) => {
  const chapters = useMemo(
    () => pageMap.landmarks.filter((landmark) => landmark.kind === 'chapter'),
    [pageMap],
  );

  const currentChapter = useMemo(() => {
    let best = chapters[0] ?? null;
    for (const chapter of chapters) {
      if (chapter.filePageIndex <= currentPageIndex) best = chapter;
      else break;
    }
    return best;
  }, [chapters, currentPageIndex]);

  if (pageMap.pageCount <= 0) return null;

  return (
    <div className="min-w-0 flex-1" data-canonical-page-navigator>
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px]">
        <span className="truncate font-semibold text-slate-300">
          {currentChapter?.title || 'Початок книги'}
        </span>
        <span className="shrink-0 font-mono text-slate-500">
          {currentPageIndex + 1} / {pageMap.pageCount}
        </span>
      </div>

      <div className="relative h-7">
        <div className="absolute left-0 right-0 top-3 h-1 rounded-full bg-slate-800" />
        {pageMap.precision === 'exact' && chapters.map((chapter) => {
          const spreadIndex = Math.floor(chapter.filePageIndex / 2) * 2;
          const progress = pageMap.pageCount > 1
            ? chapter.filePageIndex / (pageMap.pageCount - 1)
            : 0;
          const active = currentChapter?.id === chapter.id;
          const visibleNumber = chapter.displayPageNumber ?? chapter.filePageNumber;

          return (
            <button
              key={chapter.id}
              type="button"
              onClick={() => onJump(spreadIndex)}
              className={`group absolute top-1 -translate-x-1/2 transition-transform hover:scale-125 focus:outline-none ${active ? 'z-20' : 'z-10'}`}
              style={{ left: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
              aria-label={`${chapter.title}, сторінка ${visibleNumber}`}
              title={`${chapter.title} · стор. ${visibleNumber}`}
            >
              <span
                className={`block h-5 w-2.5 rounded-full border ${
                  active
                    ? 'border-cyan-300 bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,.55)]'
                    : 'border-slate-500 bg-slate-700 group-hover:border-cyan-400 group-hover:bg-cyan-500'
                }`}
              />
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden max-w-52 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-200 shadow-xl group-hover:block group-focus:block">
                {chapter.title} · стор. {visibleNumber}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
