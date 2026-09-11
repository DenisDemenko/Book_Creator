/**
 * Вибір готового зображення з медіатеки студії — спливаюче вікно з
 * мініатюрами (задача власника: «Обрати картинку персонажа з медіотеки»).
 *
 * Свідомо НЕ вантажить нічого нового: це вибір із того, що вже лежить у
 * медіатеці (`GET /api/media/list`). Завантаження файлів має власне місце
 * — розділ «Медіатека», і дублювати його тут означало б два різні шляхи
 * додавання файлу з різними лімітами тарифу.
 *
 * `bookId` не передаємо навмисно: портрет героя цілком може бути взятий
 * із матеріалів іншої книги автора, і ховати їх тут не було б за що.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { X, Image as ImageIcon, Loader2, RefreshCw } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface MediaAsset {
  id: string;
  url: string;
  filename: string;
  kind: string;
  mimeType: string;
  createdAt: string;
}

export const PickFromMediaLibraryModal: React.FC<{
  onPick: (url: string) => void;
  onClose: () => void;
  /** Заголовок вікна — різні місця викликають його з різним приводом. */
  title?: string;
}> = ({ onPick, onClose, title }) => {
  const { t } = useLanguage();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/media/list', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t('mediaPicker.loadError'));
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch (err: any) {
      setError(err?.message || t('mediaPicker.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // Esc закриває — як і в решті модалок студії.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="token-module-scope rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <div className="shrink-0 p-4 nm-outset-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg nm-outset flex items-center justify-center text-[var(--primary)] shrink-0">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[14px] font-bold text-[var(--on-surface)] truncate">
                {title || t('mediaPicker.heading')}
              </h3>
              <p className="text-[11px] text-[var(--outline)] truncate">{t('mediaPicker.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={load} className="nm-btn p-2 rounded-lg text-[var(--on-surface-variant)]" title={t('mediaPicker.refresh')}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="nm-btn p-2 rounded-lg text-[var(--on-surface-variant)]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 nm-flat">
          {loading && (
            <div className="flex items-center justify-center py-14 text-[var(--outline)] text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('mediaPicker.loading')}
            </div>
          )}

          {!loading && error && (
            <div className="nm-inset p-3 rounded-xl border-l-2 border-rose-400/60 text-rose-200/90 text-[11px]">{error}</div>
          )}

          {!loading && !error && assets.length === 0 && (
            <p className="text-[11px] text-[var(--outline)] leading-relaxed py-10 text-center">
              {t('mediaPicker.empty')}
            </p>
          )}

          {!loading && !error && assets.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {assets.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    onPick(a.url);
                    onClose();
                  }}
                  className="nm-btn group rounded-xl overflow-hidden text-left flex flex-col"
                  title={a.filename}
                >
                  <span className="block w-full aspect-square nm-inset-deep overflow-hidden">
                    <img
                      src={a.url}
                      alt={a.filename}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </span>
                  <span className="block px-2 py-1.5 text-[10px] text-[var(--on-surface-variant)] truncate">
                    {a.filename}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
