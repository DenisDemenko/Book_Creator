import React from 'react';
import type { CanonicalPageMapEntry } from '../../utils/canonicalPageMap';

interface SpreadMilestonesProps {
  totalPages: number;
  currentPageIndex: number;
  milestones: CanonicalPageMapEntry[];
  onGoToPageIndex: (pageIndex: number) => void;
}

export const SpreadMilestones: React.FC<SpreadMilestonesProps> = ({
  totalPages,
  currentPageIndex,
  milestones,
  onGoToPageIndex,
}) => {
  if (totalPages <= 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-slate-400 font-mono text-xs">1</span>
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(0, totalPages - 1)}
            step={1}
            value={Math.min(currentPageIndex, Math.max(0, totalPages - 1))}
            onChange={(event) => onGoToPageIndex(Number(event.target.value))}
            aria-label="Перехід до сторінки книги"
            className="w-full accent-cyan-400 cursor-pointer"
          />
          {totalPages > 1 && milestones.map((entry) => (
            <button
              key={`${entry.chapterId ?? 'chapter'}-${entry.pageIndex}`}
              type="button"
              onClick={() => onGoToPageIndex(entry.pageIndex)}
              className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-amber-300 hover:h-4"
              style={{ left: `${(entry.pageIndex / (totalPages - 1)) * 100}%` }}
              title={`${entry.chapterIndex ? `Глава ${entry.chapterIndex}. ` : ''}${entry.chapterTitle ?? ''} — сторінка ${entry.pageNumber}`}
              aria-label={`${entry.chapterTitle ?? 'Глава'}, сторінка ${entry.pageNumber}`}
            />
          ))}
        </div>
        <span className="text-slate-400 font-mono text-xs">{totalPages}</span>
      </div>

      {milestones.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {milestones.map((entry) => {
            const active = currentPageIndex <= entry.pageIndex && currentPageIndex + 1 >= entry.pageIndex;
            return (
              <button
                key={`label-${entry.chapterId ?? 'chapter'}-${entry.pageIndex}`}
                type="button"
                onClick={() => onGoToPageIndex(entry.pageIndex)}
                title={`${entry.chapterTitle ?? 'Глава'} — сторінка ${entry.pageNumber}`}
                className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10px] transition-colors ${
                  active
                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-200'
                    : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                }`}
              >
                <span className="font-mono text-slate-500">с. {entry.pageNumber}</span>
                {' · '}
                {entry.chapterTitle ?? `Глава ${entry.chapterIndex ?? ''}`}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
