import React from 'react';
import { Layers, X, Save, Check } from 'lucide-react';
import { Book } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface BookSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  onUpdateBook: (updated: Book) => void;
}

export const BookSettingsModal: React.FC<BookSettingsModalProps> = ({
  isOpen,
  onClose,
  book,
  onUpdateBook,
}) => {
  const { t } = useLanguage();
  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-950 border border-slate-800 rounded-2xl max-w-xl w-full p-6 text-white space-y-6 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-bold font-heading">
              {t('bookModals.settingsHeading')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <div>
            <label className="text-slate-400 block mb-1">{t('bookModals.titleLabel')}</label>
            <input
              type="text"
              value={book.title}
              onChange={(e) => onUpdateBook({ ...book, title: e.target.value })}
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">{t('bookModals.subtitleLabel')}</label>
            <input
              type="text"
              value={book.subtitle || ''}
              onChange={(e) => onUpdateBook({ ...book, subtitle: e.target.value })}
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">{t('bookModals.authorPseudonymLabel')}</label>
              <input
                type="text"
                value={book.author}
                onChange={(e) => onUpdateBook({ ...book, author: e.target.value })}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">{t('bookModals.genreLabel')}</label>
              <input
                type="text"
                value={book.genre}
                onChange={(e) => onUpdateBook({ ...book, genre: e.target.value })}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200"
              />
            </div>
          </div>

          <div>
            <label className="text-slate-400 block mb-1">{t('bookModals.audienceLabel')}</label>
            <input
              type="text"
              value={book.targetAudience}
              onChange={(e) => onUpdateBook({ ...book, targetAudience: e.target.value })}
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">{t('bookModals.bookLanguageLabel')}</label>
            <select
              value={book.language}
              onChange={(e) => onUpdateBook({ ...book, language: e.target.value })}
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200"
            >
              <option value="uk">Українська</option>
              <option value="en">English</option>
              <option value="pl">Polski</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs shadow-md"
          >
            {t('bookModals.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  );
};
