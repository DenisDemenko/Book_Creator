import React, { useState } from 'react';
import { 
  BookPlus, 
  Sparkles, 
  X, 
  Fingerprint, 
  Tag, 
  ShieldCheck, 
  Feather, 
  Building2, 
  Layers, 
  Check, 
  Shuffle, 
  ArrowRight 
} from 'lucide-react';
import { UserRole } from '../types';
import { ALL_ROLES, getRoleInfo } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';

interface CreateBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRole: UserRole;
  onCreateBook: (
    title: string,
    author: string,
    genre: string,
    bookId: string,
    initialVersion: string,
    creatorRole: UserRole,
    initialNote?: string
  ) => void;
}

export const CreateBookModal: React.FC<CreateBookModalProps> = ({
  isOpen,
  onClose,
  currentRole,
  onCreateBook,
}) => {
  const { lang, t } = useLanguage();
  const roleName = (info: ReturnType<typeof getRoleInfo>) => (lang === 'en' ? info.nameEn : info.nameUk);

  const generateRandomBookId = () => {
    const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
    const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `BK-${timestamp}-${randomHex}`;
  };

  const [title, setTitle] = useState<string>('');
  const [author, setAuthor] = useState<string>('Олександр Радченко');
  const [genre, setGenre] = useState<string>('Кіберпанк / Наукова фантастика');
  const [bookId, setBookId] = useState<string>(generateRandomBookId());
  const [initialVersion, setInitialVersion] = useState<string>('v1.0.0');
  const [creatorRole, setCreatorRole] = useState<UserRole>(currentRole);
  const [initialNote, setInitialNote] = useState<string>(t('bookModals.defaultInitialNote'));

  if (!isOpen) return null;

  const handleRegenerateId = () => {
    setBookId(generateRandomBookId());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreateBook(
      title.trim(),
      author.trim() || t('bookModals.unknownAuthor'),
      genre,
      bookId.trim() || generateRandomBookId(),
      initialVersion.trim() || 'v1.0.0',
      creatorRole,
      initialNote.trim()
    );
    onClose();
  };

  const creatorRoleInfo = getRoleInfo(creatorRole);

  const genrePresets = [
    'Кіберпанк / Наукова фантастика',
    'Міське фентезі / Urban Fantasy',
    'Детективний нуар / Трилер',
    'Космічна опера / Sci-Fi',
    'Історичний роман',
    'Психологічна драма',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div 
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 font-sans"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <BookPlus className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('bookModals.createHeading')}</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('bookModals.createDesc')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs overflow-y-auto max-h-[75vh]">
          
          {/* Unique Book ID & Initial Version Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-slate-950 border border-slate-800">
            <div>
              <label className="text-slate-300 font-bold block mb-1.5 flex items-center gap-1.5">
                <Fingerprint className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t('bookModals.bookIdLabel')}</span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={bookId}
                  onChange={(e) => setBookId(e.target.value.toUpperCase())}
                  className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-cyan-300 font-mono font-bold text-xs focus:border-amber-400 focus:outline-hidden uppercase"
                  required
                />
                <button
                  type="button"
                  onClick={handleRegenerateId}
                  className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shrink-0"
                  title={t('bookModals.regenerateId')}
                >
                  <Shuffle className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">{t('bookModals.bookIdHint')}</p>
            </div>

            <div>
              <label className="text-slate-300 font-bold block mb-1.5 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-amber-400" />
                <span>{t('bookModals.initialVersionLabel')}</span>
              </label>
              <input
                type="text"
                value={initialVersion}
                onChange={(e) => setInitialVersion(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-amber-300 font-mono font-bold text-xs focus:border-amber-400 focus:outline-hidden"
                required
              />
              <p className="text-[10px] text-slate-500 mt-1">{t('bookModals.initialVersionHint')}</p>
            </div>
          </div>

          {/* Book Title */}
          <div>
            <label className="text-slate-300 font-bold block mb-1.5">
              {t('bookModals.titleLabel')} <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('bookModals.titlePlaceholder')}
              className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white font-semibold text-sm focus:outline-hidden"
              required
            />
          </div>

          {/* Author & Genre */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-slate-300 font-medium block mb-1.5">{t('bookModals.authorLabel')}</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder={t('bookModals.authorPlaceholder')}
                className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-hidden"
                required
              />
            </div>

            <div>
              <label className="text-slate-300 font-medium block mb-1.5">{t('bookModals.genreLabel')}</label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-hidden"
              >
                {genrePresets.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Creator Role */}
          <div>
            <label className="text-slate-300 font-medium block mb-1.5">
              {t('bookModals.creatorRoleLabel')}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALL_ROLES.map((r) => {
                const isSel = creatorRole === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setCreatorRole(r.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                      isSel
                        ? 'bg-amber-500/20 border-amber-500/80 text-white ring-1 ring-amber-400/40'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-base">{r.badgeEmoji}</span>
                      <span className="font-semibold text-xs truncate">{roleName(r)}</span>
                    </div>
                    {isSel && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Initial Log Note */}
          <div>
            <label className="text-slate-400 font-medium block mb-1.5">
              {t('bookModals.logEntryLabel')}
            </label>
            <textarea
              value={initialNote}
              onChange={(e) => setInitialNote(e.target.value)}
              rows={2}
              className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:border-amber-400 focus:outline-hidden resize-none"
            />
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-colors"
            >
              {t('bookModals.cancel')}
            </button>

            <button
              type="submit"
              disabled={!title.trim()}
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-colors flex items-center gap-2 disabled:opacity-50 shadow-md"
            >
              <BookPlus className="w-4 h-4 stroke-[2.5]" />
              <span>{t('bookModals.createSubmit')}</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
