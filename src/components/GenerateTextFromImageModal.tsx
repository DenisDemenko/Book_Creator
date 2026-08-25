import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, Check, AlertTriangle, PenLine, Bot } from 'lucide-react';
import { isGuestRestriction } from '../utils/placeholders';
import { useLanguage } from '../i18n/LanguageContext';

interface GenerateTextFromImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  caption: string;
  bookTitle?: string;
  genre?: string;
  chapterTitle?: string;
  /** Початковий текст, якщо для цього зображення вже щось згенеровано раніше. */
  initialText?: string;
  initialEngine?: string;
  onSave: (text: string, engine: string) => void;
}

type TextEngine = 'gemini' | 'gpt';

const ENGINE_NAMES: Record<TextEngine, string> = {
  gemini: 'Gemini',
  gpt: 'GPT',
};

/**
 * Модалка «Написати текст сцени за зображенням».
 * ШІ виступає співавтором: пише чернетку, письменник завжди може її
 * відредагувати перед збереженням — нічого не потрапляє в книгу мовчки.
 */
export const GenerateTextFromImageModal: React.FC<GenerateTextFromImageModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  caption,
  bookTitle,
  genre,
  chapterTitle,
  initialText,
  initialEngine,
  onSave,
}) => {
  const { t } = useLanguage();
  const ENGINE_HINTS: Record<TextEngine, string> = {
    gemini: t('generateTextFromImage.geminiHint'),
    gpt: t('generateTextFromImage.gptHint'),
  };
  const [engine, setEngine] = useState<TextEngine>((initialEngine as TextEngine) || 'gemini');
  const [availability, setAvailability] = useState<{ gemini: boolean; gpt: boolean }>({ gemini: true, gpt: true });
  const [text, setText] = useState(initialText || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setText(initialText || '');
    setError(null);
    fetch('/api/ai/text-engines')
      .then((r) => r.json())
      .then((data) => setAvailability({ gemini: !!data.gemini, gpt: !!data.gpt }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, imageUrl]);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/generate-book-text-from-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ imageUrl, engine, bookTitle, genre, chapterTitle, captionHint: caption }),
      });
      const data = await res.json();

      if (isGuestRestriction(res.status, data)) {
        setText(t('generateTextFromImage.guestStub'));
        setError(data.error || null);
        return;
      }
      if (!res.ok) {
        setError(data.error || t('generateTextFromImage.genericFailError'));
        return;
      }
      setText(data.text || '');
    } catch (err) {
      setError(t('generateTextFromImage.serverUnavailableError'));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    onSave(text, engine);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl glass-panel-elevated p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300 shrink-0">
              <PenLine className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">{t('generateTextFromImage.heading')}</h3>
              <p className="text-[11px] text-slate-400">{caption || t('generateTextFromImage.illustrationFallback')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
          <div className="rounded-xl overflow-hidden border border-slate-700 bg-black h-40 md:h-full flex items-center justify-center">
            <img src={imageUrl} alt={caption} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 shrink-0">{t('generateTextFromImage.engineLabel')}</span>
              <div className="flex gap-1.5">
                {(['gemini', 'gpt'] as TextEngine[]).map((e) => (
                  <button
                    key={e}
                    onClick={() => setEngine(e)}
                    disabled={!availability[e]}
                    title={!availability[e] ? t('generateTextFromImage.notConfiguredSuffix', { hint: ENGINE_HINTS[e] }) : ENGINE_HINTS[e]}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${
                      engine === e
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <Bot className="w-3.5 h-3.5" />
                    {ENGINE_NAMES[e]}
                  </button>
                ))}
              </div>
              <button
                onClick={handleGenerate}
                disabled={busy}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-xs transition-all disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>{busy ? t('generateTextFromImage.writing') : text ? t('generateTextFromImage.writeAgain') : t('generateTextFromImage.writeText')}</span>
              </button>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px] flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                {t('generateTextFromImage.sceneTextLabel')}
              </label>
              <textarea
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('generateTextFromImage.textareaPlaceholder')}
                className="w-full p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 leading-relaxed focus:border-amber-400 focus:outline-hidden"
              />
              <div className="text-[10px] text-slate-500 mt-1">{text.trim().split(/\s+/).filter(Boolean).length} {t('generateTextFromImage.wordsCountSuffix')}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
          <button onClick={onClose} className="px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-200 transition-colors">
            {t('generateTextFromImage.cancelBtn')}
          </button>
          <button
            onClick={handleSave}
            disabled={!text.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs shadow-md transition-all"
          >
            <Check className="w-4 h-4" />
            {t('generateTextFromImage.saveTextBtn')}
          </button>
        </div>
      </div>
    </div>
  );
};
