import React from 'react';
import type { Book } from '../types';
import { PdfEditorView as PdfEditorViewBase } from './PdfEditorViewBase';
import { AuthoritativePdfPreview } from './pdf/AuthoritativePdfPreview';

interface PdfEditorViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onSaveBook?: () => void;
}

/**
 * Keeps the existing editable WYSIWYG canvas intact and adds a second,
 * export-authoritative surface based on the actual generated PDF bytes.
 */
export const PdfEditorView: React.FC<PdfEditorViewProps> = (props) => (
  <div className="flex min-h-0 flex-1 flex-col bg-slate-900">
    <AuthoritativePdfPreview book={props.book} />
    <PdfEditorViewBase {...props} />
  </div>
);
