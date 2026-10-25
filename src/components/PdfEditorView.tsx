import React from 'react';
import type { Book } from '../types';
import { PdfEditorView as PdfEditorViewBase } from './PdfEditorViewBase';
import { AuthoritativePdfPreview } from './pdf/AuthoritativePdfPreview';
import { PublicationTemplatePanel } from './publication/PublicationTemplatePanel';
import { DesignCraftEditorPanel } from './publication/DesignCraftEditorPanel';
import { useLanguage } from '../i18n/LanguageContext';

interface PdfEditorViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onSaveBook?: () => void;
}

/**
 * «Верстка для публікації» — один конвеєр на одній сторінці:
 *   1. шаблон (ті самі поля, що й «Верстка & Поля»);
 *   2. рушій і точний PDF (байти справжнього файлу обраного рушія);
 *   3. графічний редактор DesignCraft на комп'ютері автора (через скрипт запуску);
 *   4. ручна верстка рамок і обтікання (колишня WYSIWYG-канва, без змін).
 */
export const PdfEditorView: React.FC<PdfEditorViewProps> = (props) => {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-900" data-publication-layout>
      <header className="mx-4 mt-4 lg:mx-6">
        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
          {t('pdfEditorView.headerBadge')}
        </span>
        <h1 className="mt-2 text-xl font-bold text-white font-heading">{t('pdfEditorView.pageTitle')}</h1>
        <p className="mt-1 text-[11px] text-slate-400">{t('pdfEditorView.pageSubtitle')}</p>
      </header>
      <PublicationTemplatePanel book={props.book} onUpdateBook={props.onUpdateBook} />
      <AuthoritativePdfPreview book={props.book} />
      <DesignCraftEditorPanel book={props.book} />
      <PdfEditorViewBase {...props} />
    </div>
  );
};
