import React from 'react';
import type { Book } from '../types';
import { estimatePageCount } from '../utils/helpers';
import { CoverDesignerView as CoverDesignerViewBase } from './CoverDesignerViewBase';
import {
  CoverPhysicalSpec,
  type CoverConfigWithPhysical,
} from './cover/CoverPhysicalSpec';
import { CoverPhysicalPreview } from './cover/CoverPhysicalPreview';

export type { CoverEngine } from './CoverDesignerViewBase';

interface CoverDesignerViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book) => void;
  totalWords: number;
}

/**
 * Обгортка додає фізичні параметри друкованої обкладинки до чинного
 * дизайнера, не змінюючи його AI-генерацію та поля редагування.
 * Старий декоративний dark/transparent mockup прихований лише CSS-обгорткою:
 * його код збережено в CoverDesignerViewBase для backward compatibility.
 */
export const CoverDesignerView: React.FC<CoverDesignerViewProps> = ({
  book,
  onUpdateBook,
  totalWords,
}) => {
  const cover = book.coverConfig as CoverConfigWithPhysical;
  const totalPages = estimatePageCount(
    totalWords,
    book.layoutConfig.formatPreset,
    book.layoutConfig.typography.fontSizePt,
    book.layoutConfig.typography.lineHeight,
  );
  const calculatedSpineMm = Number((
    totalPages * (cover.coverType === 'hardcover' ? 0.06 : 0.052) +
    (cover.coverType === 'hardcover' ? 2 : 0)
  ).toFixed(1));

  const updatePhysicalCover = (patch: Partial<CoverConfigWithPhysical>) => {
    onUpdateBook({
      ...book,
      coverConfig: {
        ...book.coverConfig,
        ...patch,
      },
    } as Book);
  };

  return (
    <div className="cover-designer-physical flex min-h-0 flex-1 flex-col bg-slate-900">
      <style>{`
        .cover-designer-physical .cover-designer-legacy [data-tour="cover__5"] { display: none !important; }
        .cover-designer-physical .cover-designer-legacy [data-tour="cover__2"],
        .cover-designer-physical .cover-designer-legacy [data-tour="cover__2"] + button { display: none !important; }
      `}</style>

      <div className="shrink-0 space-y-4 px-4 pt-4 lg:px-6">
        <CoverPhysicalPreview
          book={book}
          cover={cover}
          spineWidthMm={calculatedSpineMm}
        />
        <CoverPhysicalSpec
          book={book}
          cover={cover}
          spineWidthMm={calculatedSpineMm}
          onChange={updatePhysicalCover}
        />
      </div>

      <div className="cover-designer-legacy min-h-0 flex-1">
        <CoverDesignerViewBase
          book={book}
          onUpdateBook={onUpdateBook}
          totalWords={totalWords}
        />
      </div>
    </div>
  );
};
