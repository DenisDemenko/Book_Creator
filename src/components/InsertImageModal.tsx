import React, { useMemo, useState } from 'react';
import { X, ImagePlus, Search } from 'lucide-react';
import { Book } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import {
  ImageFormat,
  IMAGE_FORMAT_LABEL,
  IMAGE_FORMAT_ORDER,
  compareByImageFormat,
  detectImageFormat,
} from '../utils/imageFormat';

interface InsertImageModalProps {
  book: Book;
  onInsert: (illustrationId: string, caption: string) => void;
  onClose: () => void;
}

type GalleryItem = {
  id: string;
  url: string;
  title: string;
  kind: 'illustration' | 'portrait' | 'cover';
};

/**
 * Вибір зображення з галереї книги для вставки в текст.
 *
 * Показує ті самі джерела, що й «Медіатека»: ілюстрації книги, портрети
 * героїв та обкладинку. Перелік згрупований за форматом файлу (JPG, PNG,
 * WEBP…) — і всередині вікна, і в самій медіатеці порядок однаковий, бо
 * сортування живе в спільній утиліті `utils/imageFormat.ts`.
 */
export const InsertImageModal: React.FC<InsertImageModalProps> = ({ book, onInsert, onClose }) => {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<ImageFormat | 'all'>('all');
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const [caption, setCaption] = useState('');

  /** Усі зображення книги, зібрані з тих самих джерел, що й медіатека. */
  const items: GalleryItem[] = useMemo(() => {
    const list: GalleryItem[] = [];

    (book.illustrations || []).forEach((ill) => {
      list.push({ id: ill.id, url: ill.url, title: ill.caption || t('editor.imgUntitled'), kind: 'illustration' });
    });

    book.characters.forEach((c) => {
      if (c.avatarUrl) {
        list.push({
          id: `char-${c.id}`,
          url: c.avatarUrl,
          title: `${c.name} ${c.surname || ''}`.trim(),
          kind: 'portrait',
        });
      }
    });

    if (book.coverConfig?.frontArtUrl) {
      list.push({
        id: 'cover-front',
        url: book.coverConfig.frontArtUrl,
        title: t('editor.imgCover'),
        kind: 'cover',
      });
    }

    return list;
  }, [book.illustrations, book.characters, book.coverConfig?.frontArtUrl, t]);

  /** Які формати реально є в цій книзі — показуємо лише їх. */
  const presentFormats = useMemo(() => {
    const set = new Set(items.map((i) => detectImageFormat(i.url)));
    return IMAGE_FORMAT_ORDER.filter((f) => set.has(f));
  }, [items]);

  /** Відфільтровані та відсортовані за форматом зображення. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => (formatFilter === 'all' ? true : detectImageFormat(i.url) === formatFilter))
      .filter((i) => (q ? i.title.toLowerCase().includes(q) : true))
      .sort(compareByImageFormat);
  }, [items, formatFilter, query]);

  const handleInsert = () => {
    if (!selected) return;
    onInsert(selected.id, caption.trim() || selected.title);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl glass-panel-elevated shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2">
            <ImagePlus className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100">{t('editor.imgModalTitle')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={t('editor.fontModalClose')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Пошук та фільтр за форматом */}
        <div className="p-3 border-b border-white/[0.06] shrink-0 space-y-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('editor.imgSearchPlaceholder')}
              className="flex-1 min-w-0 bg-transparent text-xs text-slate-100 outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFormatFilter('all')}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                formatFilter === 'all'
                  ? 'bg-amber-500/25 text-amber-200'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('editor.imgFormatAll')}
            </button>
            {presentFormats.map((f) => (
              <button
                key={f}
                onClick={() => setFormatFilter(f)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold font-mono transition-all ${
                  formatFilter === f
                    ? 'bg-amber-500/25 text-amber-200'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                {IMAGE_FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        {/* Сітка зображень */}
        <div className="flex-1 overflow-y-auto p-3">
          {visible.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic text-center py-8">{t('editor.imgEmpty')}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
              {visible.map((item) => {
                const fmt = detectImageFormat(item.url);
                const isSel = selected?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelected(item);
                      setCaption(item.title);
                    }}
                    className={`group relative rounded-xl overflow-hidden border text-left transition-all ${
                      isSel ? 'border-amber-400 ring-2 ring-amber-400/40' : 'border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <img src={item.url} alt={item.title} className="w-full h-24 object-cover bg-slate-900" />
                    <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-slate-950/85 text-[9px] font-mono font-bold text-cyan-300">
                      {IMAGE_FORMAT_LABEL[fmt]}
                    </span>
                    <div className="p-1.5 bg-slate-950">
                      <div className="text-[10px] text-slate-200 truncate">{item.title}</div>
                      <div className="text-[9px] text-slate-500">{t(`editor.imgKind_${item.kind}`)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Підпис та вставка */}
        <div className="p-3 border-t border-white/[0.06] shrink-0 space-y-2">
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            disabled={!selected}
            placeholder={t('editor.imgCaptionPlaceholder')}
            className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 field-glow disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-slate-500 leading-relaxed flex-1">{t('editor.imgInsertNote')}</p>
            <button
              onClick={handleInsert}
              disabled={!selected}
              className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-bold transition-colors shrink-0"
            >
              {t('editor.imgInsertBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
