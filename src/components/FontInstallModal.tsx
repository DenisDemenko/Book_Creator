import React, { useState } from 'react';
import { X, Type, Loader2, AlertTriangle, Trash2, ExternalLink } from 'lucide-react';
import { CustomFont } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface FontInstallModalProps {
  installedFonts: CustomFont[];
  onInstall: (font: CustomFont) => void;
  onRemove: (family: string) => void;
  onClose: () => void;
}

/** Хост, з якого дозволено підключати шрифти. */
const GOOGLE_CSS_HOST = 'fonts.googleapis.com';
/** Хост сторінки перегляду шрифтів (звідки користувачі найчастіше копіюють посилання). */
const GOOGLE_SPECIMEN_HOST = 'fonts.google.com';

/**
 * Витягує назву сімейства з того, що вставив користувач.
 *
 * Приймає всі звичні варіанти: посилання на сторінку шрифту
 * (`https://fonts.google.com/specimen/Roboto+Slab`), пряме посилання на
 * таблицю стилів (`https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400`)
 * і просто назву («Roboto Slab»). Повертає null, якщо розібрати не вдалося.
 */
export function parseFontFamily(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (raw.includes('fonts.googleapis.com')) {
    try {
      const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      if (url.hostname !== GOOGLE_CSS_HOST) return null;
      const family = url.searchParams.get('family');
      if (!family) return null;
      // «Roboto+Slab:wght@400;700» → «Roboto Slab»
      return family.split(':')[0].replace(/\+/g, ' ').trim() || null;
    } catch {
      return null;
    }
  }

  if (raw.includes('fonts.google.com')) {
    try {
      const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      if (url.hostname !== GOOGLE_SPECIMEN_HOST) return null;
      // /specimen/Playwrite+DE+LA+Guides?preview → «Playwrite DE LA Guides»
      const match = url.pathname.match(/\/specimen\/([^/]+)/);
      if (!match) return null;
      const family = decodeURIComponent(match[1]).replace(/\+/g, ' ').trim();
      return family || null;
    } catch {
      return null;
    }
  }

  // Проста назва: лишаємо літери, цифри, пробіли й дефіси
  if (!/^[\p{L}\p{N} \-]+$/u.test(raw)) return null;
  return raw.replace(/\s+/g, ' ');
}

/** Назва сімейства → канонічне посилання на таблицю стилів Google Fonts. */
export function buildGoogleFontHref(family: string): string {
  const param = family.trim().replace(/\s+/g, '+');
  return `https://${GOOGLE_CSS_HOST}/css2?family=${param}:ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap`;
}

/**
 * Вікно підключення шрифту з Google Fonts.
 *
 * Користувач знаходить шрифт на fonts.google.com і вставляє сюди або
 * посилання, або просто назву. Ми будуємо канонічний css2-URL, підвантажуємо
 * його і показуємо живий зразок — тож видно одразу, чи шрифт справді
 * підхопився, ще до збереження.
 */
export const FontInstallModal: React.FC<FontInstallModalProps> = ({
  installedFonts,
  onInstall,
  onRemove,
  onClose,
}) => {
  const { t } = useLanguage();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [preview, setPreview] = useState<{ family: string; href: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = async () => {
    const family = parseFontFamily(input);
    if (!family) {
      setStatus('error');
      setPreview(null);
      setError(t('editor.fontModalParseError'));
      return;
    }
    if (installedFonts.some((f) => f.family.toLowerCase() === family.toLowerCase())) {
      setStatus('error');
      setPreview(null);
      setError(t('editor.fontModalDuplicate', { family }));
      return;
    }

    setStatus('loading');
    setError(null);
    const href = buildGoogleFontHref(family);

    // Підвантажуємо таблицю стилів і чекаємо, поки шрифт стане доступним:
    // document.fonts.load() відповідає, чи гарнітура реально завантажилась.
    if (!document.querySelector(`link[data-nova-font="${family}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.novaFont = family;
      document.head.appendChild(link);
    }

    try {
      await document.fonts.load(`16px "${family}"`);
      const ok = document.fonts.check(`16px "${family}"`);
      if (!ok) throw new Error('not available');
      setPreview({ family, href });
      setStatus('ready');
    } catch {
      setStatus('error');
      setPreview(null);
      setError(t('editor.fontModalLoadError', { family }));
    }
  };

  const handleInstall = () => {
    if (!preview) return;
    onInstall({ family: preview.family, href: preview.href, addedAt: new Date().toISOString() });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl glass-panel-elevated shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2">
            <Type className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100">{t('editor.fontModalTitle')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={t('editor.fontModalClose')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {t('editor.fontModalHint')}{' '}
            <a
              href="https://fonts.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-0.5"
            >
              fonts.google.com <ExternalLink className="w-3 h-3" />
            </a>
          </p>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setStatus('idle');
                setError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
              placeholder={t('editor.fontModalPlaceholder')}
              className="flex-1 min-w-0 p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 field-glow"
            />
            <button
              onClick={handleCheck}
              disabled={status === 'loading' || !input.trim()}
              className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0"
            >
              {status === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t('editor.fontModalCheckBtn')}</span>
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {status === 'ready' && preview && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {t('editor.fontModalPreviewLabel')} — {preview.family}
              </div>
              <div
                className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-base leading-relaxed"
                style={{ fontFamily: `"${preview.family}", serif` }}
              >
                {t('editor.fontModalPreviewText')}
              </div>
              <button
                onClick={handleInstall}
                className="w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-colors"
              >
                {t('editor.fontModalInstallBtn', { family: preview.family })}
              </button>
            </div>
          )}

          {installedFonts.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {t('editor.fontModalInstalledLabel')}
              </div>
              {installedFonts.map((f) => (
                <div
                  key={f.family}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800"
                >
                  <span className="text-xs text-slate-200 truncate" style={{ fontFamily: `"${f.family}", serif` }}>
                    {f.family}
                  </span>
                  <button
                    onClick={() => onRemove(f.family)}
                    className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 transition-colors shrink-0"
                    title={t('editor.fontModalRemoveTitle')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
