import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wand2,
  Upload,
  FileText,
  Loader2,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Download,
  Crown,
  Lock,
  Info,
  Trash2,
  BookOpenCheck,
} from 'lucide-react';
import type { AuthUser } from '../types';
import { KDP_TRIM_SIZES } from '../utils/kdpHelpers';
import { calculateWordCount, downloadTextFile } from '../utils/helpers';
import { generateFormattedManuscriptExportHtml, type FormattedChapter } from '../utils/manuscriptExportHtml';
import { useLanguage } from '../i18n/LanguageContext';

interface ManuscriptFormatterViewProps {
  authUser?: AuthUser | null;
  onGoToSubscription?: () => void;
}

interface SubscriptionMeInfo {
  subscription: { plan: string };
  plan: { id: string; nameUk: string; nameEn: string };
}

const ALLOWED_PLANS = new Set(['pro', 'ultra']);

/** Читає .txt як звичайний текст, .docx — через mammoth (виключно в браузері, динамічний імпорт). */
async function extractTextFromFile(file: File, unsupportedMsg: string): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || file.type === 'text/plain') {
    return await file.text();
  }
  if (name.endsWith('.docx')) {
    const mod: any = await import('mammoth');
    const mammoth = mod.default || mod;
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value as string;
  }
  throw new Error(unsupportedMsg);
}

export const ManuscriptFormatterView: React.FC<ManuscriptFormatterViewProps> = ({ authUser, onGoToSubscription }) => {
  const { lang, t } = useLanguage();
  const locale = lang === 'en' ? 'en-US' : 'uk-UA';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isRegistered = !!authUser && !authUser.isGuest;
  const isAdmin = authUser?.role === 'admin';

  const [subInfo, setSubInfo] = useState<SubscriptionMeInfo | null>(null);
  const [subLoading, setSubLoading] = useState(isRegistered);
  const [claudeAvailable, setClaudeAvailable] = useState<{ available: boolean; maxChars: number } | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [manuscriptText, setManuscriptText] = useState('');
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState(authUser?.name || '');
  const [genre, setGenre] = useState('');
  const [trimId, setTrimId] = useState('kdp-6x9');

  const [formatting, setFormatting] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<FormattedChapter[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/ai/claude-engine')
      .then((r) => r.json())
      .then((d) => setClaudeAvailable(d))
      .catch(() => setClaudeAvailable({ available: false, maxChars: 400000 }));
  }, []);

  useEffect(() => {
    if (!isRegistered) {
      setSubLoading(false);
      return;
    }
    fetch('/api/subscription/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSubInfo(d))
      .catch(() => undefined)
      .finally(() => setSubLoading(false));
  }, [isRegistered]);

  const currentPlanId = subInfo?.plan?.id || 'free';
  const hasAccess = isAdmin || ALLOWED_PLANS.has(currentPlanId);

  const handleFile = useCallback(async (file: File) => {
    setExtractError(null);
    setExtracting(true);
    setChapters(null);
    setNotes([]);
    setFormatError(null);
    try {
      const text = await extractTextFromFile(file, t('manuscriptFormatter.unsupportedFile'));
      if (!text.trim()) {
        throw new Error(t('manuscriptFormatter.noTextFound'));
      }
      setManuscriptText(text);
      setFileName(file.name);
      if (!title) setTitle(file.name.replace(/\.(docx|txt)$/i, ''));
    } catch (err: any) {
      setExtractError(err?.message || t('manuscriptFormatter.readFailed'));
      setManuscriptText('');
      setFileName(null);
    } finally {
      setExtracting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const clearFile = () => {
    setFileName(null);
    setManuscriptText('');
    setChapters(null);
    setNotes([]);
    setExtractError(null);
    setFormatError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFormat = async () => {
    if (!manuscriptText.trim()) return;
    setFormatting(true);
    setFormatError(null);
    try {
      const res = await fetch('/api/ai/format-manuscript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text: manuscriptText, bookTitle: title, author, genre }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormatError(data.error || t('manuscriptFormatter.formatFailed'));
        return;
      }
      setChapters(data.chapters || []);
      setNotes(data.notes || []);
    } catch {
      setFormatError(t('manuscriptFormatter.serverUnavailable'));
    } finally {
      setFormatting(false);
    }
  };

  const updateChapter = (idx: number, patch: Partial<FormattedChapter>) => {
    setChapters((prev) => (prev ? prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)) : prev));
  };

  const removeChapter = (idx: number) => {
    setChapters((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev));
  };

  const handleExportPdf = () => {
    if (!chapters || chapters.length === 0) return;
    const html = generateFormattedManuscriptExportHtml(chapters, trimId, {
      title: title || t('manuscriptFormatter.untitledTitle'),
      author: author || t('manuscriptFormatter.defaultAuthor'),
      genre,
    });
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 500);
    } else {
      downloadTextFile(`${(title || 'manuscript').replace(/\s+/g, '_')}_KDP.html`, html, 'text/html');
    }
  };

  const totalWords = chapters ? chapters.reduce((s, c) => s + calculateWordCount(c.text), 0) : 0;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-6 lg:p-8 space-y-6">
      <div className="relative overflow-hidden p-6 rounded-2xl glass-panel-elevated">
        <div className="absolute -top-20 -right-12 w-64 h-64 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <div className="p-2.5 rounded-xl badge-glass text-violet-300">
            <Wand2 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl lg:text-2xl font-bold font-heading">{t('manuscriptFormatter.heading')}</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-violet-500/20 text-violet-300 border border-violet-500/40 uppercase tracking-wide">
                {t('manuscriptFormatter.tagBadge')}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('manuscriptFormatter.intro')}
            </p>
          </div>
        </div>
      </div>

      {subLoading ? (
        <div className="p-10 text-center text-sm text-slate-400">{t('manuscriptFormatter.checkingPlan')}</div>
      ) : !isRegistered ? (
        <div className="p-6 rounded-2xl glass-panel space-y-3 text-center">
          <Lock className="w-8 h-8 text-slate-500 mx-auto" />
          <h3 className="text-sm font-bold text-slate-100">{t('manuscriptFormatter.needRegHeading')}</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {t('manuscriptFormatter.needRegDesc', { pro: 'Pro', ultra: 'Ultra' })}
          </p>
          {onGoToSubscription && (
            <button
              onClick={onGoToSubscription}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-white font-bold text-xs shadow-md transition-all"
            >
              {t('manuscriptFormatter.viewPlans')}
            </button>
          )}
        </div>
      ) : !hasAccess ? (
        <div className="p-6 rounded-2xl glass-panel space-y-3 text-center">
          <Crown className="w-8 h-8 text-amber-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-100">{t('manuscriptFormatter.upgradeHeading')}</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {t('manuscriptFormatter.upgradeDesc', {
              plan: (lang === 'en' ? subInfo?.plan?.nameEn : subInfo?.plan?.nameUk) || t('manuscriptFormatter.freePlanName'),
            })}
          </p>
          {onGoToSubscription && (
            <button
              onClick={onGoToSubscription}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-md transition-all"
            >
              {t('manuscriptFormatter.upgradeCta')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {claudeAvailable && !claudeAvailable.available && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t('manuscriptFormatter.noKeyWarning')}</span>
            </div>
          )}

          {/* Завантаження файлу */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Upload className="w-4 h-4 text-violet-400" />
              {t('manuscriptFormatter.step1Heading')}
            </h2>

            {!fileName ? (
              <div
                data-tour="kdp-format__1"
                onDrop={onDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-violet-500/60 rounded-2xl p-10 text-center cursor-pointer transition-all bg-slate-950/40"
              >
                <FileText className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                <p className="text-xs text-slate-300 font-semibold">{t('manuscriptFormatter.dropHint')}</p>
                <p className="text-[11px] text-slate-500 mt-1">{t('manuscriptFormatter.dropFormats')}</p>
                <input ref={fileInputRef} type="file" accept=".docx,.txt,text/plain" onChange={onFileInputChange} className="hidden" />
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-white/[0.06]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-4 h-4 text-violet-300 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-200 truncate">{fileName}</div>
                    <div className="text-[11px] text-slate-500">{t('manuscriptFormatter.wordsInFile', { n: calculateWordCount(manuscriptText).toLocaleString(locale) })}</div>
                  </div>
                </div>
                <button onClick={clearFile} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-rose-300 transition-colors shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}

            {extracting && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('manuscriptFormatter.reading')}
              </div>
            )}
            {extractError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px] flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{extractError}</span>
              </div>
            )}

            {claudeAvailable && manuscriptText.length > claudeAvailable.maxChars && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px] flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  {t('manuscriptFormatter.tooLarge', {
                    len: manuscriptText.length.toLocaleString(locale),
                    max: claudeAvailable.maxChars.toLocaleString(locale),
                  })}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1.5">{t('manuscriptFormatter.titleLabel')}</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200"
                  placeholder={t('manuscriptFormatter.titlePlaceholder')}
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1.5">{t('manuscriptFormatter.authorLabel')}</label>
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200"
                  placeholder={t('manuscriptFormatter.authorPlaceholder')}
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1.5">{t('manuscriptFormatter.genreLabel')}</label>
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200"
                  placeholder={t('manuscriptFormatter.genrePlaceholder')}
                />
              </div>
            </div>

            <button
              data-tour="kdp-format__2"
              onClick={handleFormat}
              disabled={!manuscriptText.trim() || formatting || (claudeAvailable ? !claudeAvailable.available : false)}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {formatting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{formatting ? t('manuscriptFormatter.formatting') : chapters ? t('manuscriptFormatter.reformat') : t('manuscriptFormatter.formatCta')}</span>
            </button>

            {formatError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px] flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{formatError}</span>
              </div>
            )}
          </div>

          {/* Результат */}
          {chapters && chapters.length > 0 && (
            <div className="p-6 rounded-2xl glass-panel space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <BookOpenCheck className="w-4 h-4 text-emerald-400" />
                  {t('manuscriptFormatter.step2Heading', {
                    n: chapters.length,
                    chapterWord: chapters.length === 1 ? t('manuscriptFormatter.chapterOne') : t('manuscriptFormatter.chapterMany'),
                    words: totalWords.toLocaleString(locale),
                  })}
                </h2>
                <span className="text-[11px] text-slate-500">{t('manuscriptFormatter.step2Hint')}</span>
              </div>

              {notes.length > 0 && (
                <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-300">
                    <Info className="w-3.5 h-3.5" /> {t('manuscriptFormatter.claudeNotes')}
                  </div>
                  <ul className="text-[11px] text-slate-300 space-y-1 list-disc pl-4">
                    {notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {chapters.map((c, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-slate-950/50 border border-white/[0.06] space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={c.title}
                        onChange={(e) => updateChapter(idx, { title: e.target.value })}
                        className="field-glow flex-1 p-2 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-100 text-xs font-bold"
                      />
                      <span className="text-[10px] text-slate-500 shrink-0">{t('manuscriptFormatter.wordsShort', { n: calculateWordCount(c.text).toLocaleString(locale) })}</span>
                      <button onClick={() => removeChapter(idx)} title={t('manuscriptFormatter.removeChapter')} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-rose-300 transition-colors shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <textarea
                      rows={5}
                      value={c.text}
                      onChange={(e) => updateChapter(idx, { text: e.target.value })}
                      className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 leading-relaxed focus:border-violet-400 focus:outline-hidden"
                    />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/[0.06]">
                <div data-tour="kdp-format__3" className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">{t('manuscriptFormatter.trimFormatLabel')}</span>
                  <select
                    value={trimId}
                    onChange={(e) => setTrimId(e.target.value)}
                    className="field-glow p-2 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200"
                  >
                    {KDP_TRIM_SIZES.map((size) => (
                      <option key={size.id} value={size.id}>{size.nameUk}</option>
                    ))}
                  </select>
                </div>

                <button
                  data-tour="kdp-format__4"
                  onClick={handleExportPdf}
                  className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all active:scale-95"
                >
                  <Download className="w-4 h-4" />
                  {t('manuscriptFormatter.downloadPdf')}
                </button>
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                {t('manuscriptFormatter.pdfHint')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
