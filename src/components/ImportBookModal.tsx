import React, { useRef, useState } from 'react';
import {
  FolderOpen,
  X,
  UploadCloud,
  FileArchive,
  AlertTriangle,
  CheckCircle2,
  BookOpenCheck,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { Book, UserRole } from '../types';
import { hasPermission } from '../utils/rbac';
import { readBookBackupZip, BookBackupError, BookBackupManifest } from '../utils/bookBackup';
import { useLanguage } from '../i18n/LanguageContext';

interface ImportBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRole: UserRole;
  onImportBook: (book: Book, manifest: BookBackupManifest | null) => void;
}

type Stage = 'pick' | 'loading' | 'preview' | 'error';

export const ImportBookModal: React.FC<ImportBookModalProps> = ({
  isOpen,
  onClose,
  currentRole,
  onImportBook,
}) => {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('pick');
  const [fileName, setFileName] = useState<string>('');
  const [pendingBook, setPendingBook] = useState<Book | null>(null);
  const [manifest, setManifest] = useState<BookBackupManifest | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const allowed = hasPermission(currentRole, 'canImportBook');

  if (!isOpen) return null;

  const reset = () => {
    setStage('pick');
    setFileName('');
    setPendingBook(null);
    setManifest(null);
    setErrorMessage('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileSelected = async (file: File) => {
    setFileName(file.name);
    setStage('loading');
    try {
      const { book, manifest: m } = await readBookBackupZip(file);
      setPendingBook(book);
      setManifest(m);
      setStage('preview');
    } catch (err) {
      const message =
        err instanceof BookBackupError
          ? err.message
          : t('importBookModal.unknownError');
      setErrorMessage(message);
      setStage('error');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelected(file);
  };

  const handleConfirm = () => {
    if (!pendingBook) return;
    onImportBook(pendingBook, manifest);
    reset();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div
        className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 font-sans"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('importBookModal.heading')}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{t('importBookModal.desc')}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-xs overflow-y-auto max-h-[70vh]">
          {!allowed && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-300">{t('importBookModal.accessDeniedHeading')}</p>
                <p className="text-rose-200/80 mt-1">{t('importBookModal.accessDeniedDesc')}</p>
              </div>
            </div>
          )}

          {allowed && stage === 'pick' && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-cyan-400/60 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors bg-slate-950/50"
            >
              <UploadCloud className="w-9 h-9 text-cyan-400" />
              <p className="text-slate-200 font-semibold text-center">{t('importBookModal.dropHint')}</p>
              <p className="text-slate-500 text-center">{t('importBookModal.dropSubHint')}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={handleInputChange}
              />
            </div>
          )}

          {allowed && stage === 'loading' && (
            <div className="p-8 flex flex-col items-center justify-center gap-3 text-slate-300">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              <p className="font-mono">{fileName}</p>
              <p>{t('importBookModal.loading')}</p>
            </div>
          )}

          {allowed && stage === 'error' && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-amber-300 font-mono">{fileName}</p>
                  <p className="text-amber-100/90 mt-1 leading-relaxed">{errorMessage}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={reset}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition-colors"
              >
                {t('importBookModal.tryAnother')}
              </button>
            </div>
          )}

          {allowed && stage === 'preview' && pendingBook && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-emerald-300">{t('importBookModal.readyHeading')}</p>
                  <p className="text-emerald-100/80 mt-1 font-mono">{fileName}</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-slate-100 font-bold">
                  <BookOpenCheck className="w-4 h-4 text-cyan-400" />
                  <span className="truncate">{pendingBook.title}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-400">
                  <div>
                    <span className="text-slate-500">{t('importBookModal.authorLabel')}: </span>
                    <span className="text-slate-200">{pendingBook.author}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">{t('importBookModal.chaptersLabel')}: </span>
                    <span className="text-slate-200">{pendingBook.chapters.length}</span>
                  </div>
                  {manifest?.wordCount != null && (
                    <div>
                      <span className="text-slate-500">{t('importBookModal.wordsLabel')}: </span>
                      <span className="text-slate-200">{manifest.wordCount.toLocaleString('uk-UA')}</span>
                    </div>
                  )}
                  {manifest?.exportedAt && (
                    <div>
                      <span className="text-slate-500">{t('importBookModal.exportedAtLabel')}: </span>
                      <span className="text-slate-200">
                        {new Date(manifest.exportedAt).toLocaleString('uk-UA')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t('importBookModal.overwriteWarning')}</span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={reset}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-colors"
                >
                  {t('importBookModal.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-colors flex items-center gap-2 shadow-md"
                >
                  <FileArchive className="w-4 h-4 stroke-[2.5]" />
                  <span>{t('importBookModal.confirmSubmit')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
