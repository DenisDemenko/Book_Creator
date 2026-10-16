import React, { useMemo } from 'react';
import type { BookPage } from '../utils/helpers';
import {
  buildPreviewChapterMarkers,
  nearestPreviewChapter,
} from '../utils/previewPageMap';

interface PreviewChapterNavigatorProps {
  pages: BookPage[];
  currentPageIndex: number;
  onJump: (spreadStartPageIndex: number) => void;
}

export const PreviewChapterNavigator: React.FC<PreviewChapterNavigatorProps> = ({
  pages,
  currentPageIndex,
  onJump,
}) => {
  const markers = useMemo(() => buildPreviewChapterMarkers(pages), [pages]);
  const currentChapter = useMemo(
    () => nearestPreviewChapter(markers, currentPageIndex),
    [markers, currentPageIndex],
  );

  if (!pages.length) return null;

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px]">
        <span className="truncate font-semibold text-slate-300">
          {currentChapter ? currentChapter.title : 'Початок книги'}
        </span>
        <span className="shrink-0 font-mono text-slate-500">
          {currentPageIndex + 1} / {pages.length}
        </span>
      </div>

      <div className="relative h-7">
        <div className="absolute left-0 right-0 top-3 h-1 rounded-full bg-slate-800" />

        {markers.map((marker) => {
          const active = currentChapter?.chapterId === marker.chapterId;
          return (
            <button
              key={marker.chapterId}
              type="button"
              onClick={() => onJump(marker.spreadStartPageIndex)}
              className={`group absolute top-1 -translate-x-1/2 transition-transform hover:scale-125 focus:outline-none ${
                active ? 'z-20' : 'z-10'
              }`}
              style={{ left: `${marker.progress * 100}%` }}
              aria-label={`${marker.title}, сторінка ${marker.pageNumber}`}
              title={`${marker.title} · стор. ${marker.pageNumber}`}
            >
              <span
                className={`block h-5 w-2.5 rounded-full border ${
                  active
                    ? 'border-cyan-300 bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,.55)]'
                    : 'border-slate-500 bg-slate-700 group-hover:border-cyan-400 group-hover:bg-cyan-500'
                }`}
              />
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden max-w-52 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-200 shadow-xl group-hover:block group-focus:block">
                {marker.title} · стор. {marker.pageNumber}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
