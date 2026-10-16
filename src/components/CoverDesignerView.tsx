import React from 'react';
import type { Book } from '../types';
import { estimatePageCount } from '../utils/helpers';
import { CoverDesignerView as CoverDesignerViewBase } from './CoverDesignerViewBase';
import {
  CoverPhysicalSpec,
  type CoverConfigWithPhysical,
} from './cover/CoverPhysicalSpec';

export type { CoverEngine } from './CoverDesignerViewBase';

interface CoverDesignerViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book) => void;
  totalWords: number;
}

/**
 * Обгортка додає фізичні параметри друкованої обкладинки до чинного
 * дизайнера, не змінюючи його AI-генерацію та 3D-превʼю.
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
    <div className="flex min-h-0 flex-1 flex-col bg-slate-900">
      <div className="shrink-0 px-4 pt-4 lg:px-6">
        <CoverPhysicalSpec
          book={book}
          cover={cover}
          spineWidthMm={calculatedSpineMm}
          onChange={updatePhysicalCover}
        />
      </div>
      <CoverDesignerViewBase
        book={book}
        onUpdateBook={onUpdateBook}
        totalWords={totalWords}
      />
    </div>
  );
};
