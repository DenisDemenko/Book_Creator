import React, { useState } from 'react';
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  BookOpen,
  Printer,
  FileDown,
  Sliders,
  Maximize2,
  Info,
  Check,
  Download,
  Share2,
  ShieldCheck,
  HelpCircle,
  ChevronRight,
  Zap,
  ArrowRight,
  Wand2,
  Loader2,
  Trash2,
  Lock,
  Crown,
  FileArchive
} from 'lucide-react';
import { Book, AuthUser } from '../types';
import {
  KDP_TRIM_SIZES,
  getKdpMinimumGutterMm,
  getKdpMinimumOutsideMarginsMm,
  calculateKdpSpineThicknessMm,
  validateKdpCompliance,
  applyKdpOptimization,
  KdpComplianceIssue
} from '../utils/kdpHelpers';
import { generateBookExportHtml, downloadTextFile, calculateWordCount } from '../utils/helpers';
import { exportBookToEpub, exportBookToDocx } from '../utils/fileExporters';
import { exportBookToBackupZip } from '../utils/bookBackup';
import { buildChaptersFromClaudeFormat } from '../utils/manuscriptImport';
import type { FormattedChapter } from '../utils/manuscriptExportHtml';
import { useLanguage } from '../i18n/LanguageContext';

interface KdpPublishingModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  onUpdateBook: (updatedBook: Book, action?: string, details?: string) => void;
  totalWords: number;
  authUser?: AuthUser | null;
  onGoToSubscription?: () => void;
}

/** Зшиває всі глави й розділи книги в один текст рукопису для передачі Claude. */
function bookToManuscriptText(book: Book): string {
  return book.chapters
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((chapter) => {
      const body = chapter.sections
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s) => s.content)
        .join('\n\n');
      return `${chapter.title}\n\n${body}`;
    })
    .join('\n\n\n');
}

export const KdpPublishingModal: React.FC<KdpPublishingModalProps> = ({
  isOpen,
  onClose,
  book,
  onUpdateBook,
  totalWords,
  authUser,
  onGoToSubscription,
}) => {
  const [activeTab, setActiveTab] = useState<'claude' | 'audit' | 'autoprep' | 'rules' | 'export'>('autoprep');
  const [selectedPreset, setSelectedPreset] = useState<'kdp-6x9' | 'kdp-5.5x8.5' | 'kdp-5x8' | 'kdp-7x10' | 'kdp-ebook'>('kdp-6x9');
  const [appliedSuccessMsg, setAppliedSuccessMsg] = useState<string | null>(null);
  const [isExportingEpub, setIsExportingEpub] = useState(false);
  const { t } = useLanguage();

  // --- Форматування рукопису через Claude (за вибором письменика) ---
  const [claudeFormatting, setClaudeFormatting] = useState(false);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [claudePreview, setClaudePreview] = useState<FormattedChapter[] | null>(null);
  const [claudeNotes, setClaudeNotes] = useState<string[]>([]);
  const [claudeConfirmed, setClaudeConfirmed] = useState(false);
  const [claudeApplied, setClaudeApplied] = useState(false);

  if (!isOpen) return null;

  const isGuestUser = !authUser || authUser.isGuest;

  const handleClaudeFormat = async () => {
    setClaudeFormatting(true);
    setClaudeError(null);
    setClaudePreview(null);
    setClaudeNotes([]);
    setClaudeConfirmed(false);
    setClaudeApplied(false);
    try {
      const res = await fetch('/api/ai/format-manuscript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          text: bookToManuscriptText(book),
          bookTitle: book.title,
          author: book.author,
          genre: book.genre,
          bookId: book.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setClaudeError(data.error || t('kdpPublishingModal.claudeErrorGeneric'));
        return;
      }
      setClaudePreview(data.chapters || []);
      setClaudeNotes(data.notes || []);
    } catch {
      setClaudeError(t('kdpPublishingModal.claudeErrorNetwork'));
    } finally {
      setClaudeFormatting(false);
    }
  };

  const handleClaudeDownloadBackup = () => {
    exportBookToBackupZip(book).catch((err) => console.error('Backup export failed:', err));
  };

  const handleClaudeApply = () => {
    if (!claudePreview || claudePreview.length === 0 || !claudeConfirmed) return;
    const { chapters: newChapters, totalWords: newWords } = buildChaptersFromClaudeFormat(claudePreview, book.id);
    const updated: Book = { ...book, chapters: newChapters };
    onUpdateBook(
      updated,
      'Форматування рукопису через Claude',
      `Claude переформатував книгу перед вивантаженням на KDP: ${newChapters.length} глав, ${newWords.toLocaleString('uk-UA')} слів${claudeNotes.length ? `. Нотатки: ${claudeNotes.join(' ')}` : ''}`
    );
    setClaudeApplied(true);
    setClaudePreview(null);
    setClaudeConfirmed(false);
    setAppliedSuccessMsg(t('kdpPublishingModal.claudeAppliedMsg', { n: String(newChapters.length) }));
    setTimeout(() => setAppliedSuccessMsg(null), 4000);
  };

  const handleClaudeDiscard = () => {
    setClaudePreview(null);
    setClaudeNotes([]);
    setClaudeConfirmed(false);
    setClaudeError(null);
  };

  const claudePreviewWords = claudePreview
    ? claudePreview.reduce((s, c) => s + calculateWordCount(c.text), 0)
    : 0;

  const report = validateKdpCompliance(book, totalWords);
  const gutterSpec = getKdpMinimumGutterMm(report.estimatedPages);

  const handleApplyPreset = (presetId: 'kdp-6x9' | 'kdp-5.5x8.5' | 'kdp-5x8' | 'kdp-7x10' | 'kdp-ebook') => {
    const updated = applyKdpOptimization(book, presetId, totalWords);
    const chosenTrim = KDP_TRIM_SIZES.find((t) => t.id === presetId);
    
    onUpdateBook(
      updated,
      'Підготовка до Amazon KDP',
      `Застосовано стандарти Amazon KDP: Формат ${chosenTrim?.nameUk || '6x9'}, Корінцеве поле ${updated.layoutConfig.margins.insideMm} мм, Типографіка Literata 10.5pt`
    );

    setAppliedSuccessMsg(t('kdpPublishingModal.appliedMsg', { preset: chosenTrim?.nameUk || '6x9' }));
    setTimeout(() => setAppliedSuccessMsg(null), 4000);
  };

  // Export KDP Metadata Sheet (TXT / Markdown)
  const handleExportKdpMetadata = () => {
    const metadataText = `# AMAZON KDP PUBLISHING METADATA SHEET
===================================================
Назва книги (Book Title): ${book.title}
Англійська назва (Title EN): ${book.titleEn || 'N/A'}
Підзаголовок (Subtitle): ${book.subtitle || 'N/A'}
Підзаголовок EN: ${book.subtitleEn || 'N/A'}
Автор (Primary Author): ${book.author} (EN: ${book.authorEn || book.author})
Жанр (Genre / Primary BISAC): ${book.genre}
Цільова аудиторія: ${book.targetAudience || 'General Adult / Fiction'}
Мова видання (Language): ${book.language === 'uk' ? 'Ukrainian (uk)' : 'English (en)'}
ISBN / ASIN: ${book.coverConfig.barcode || 'Free KDP ISBN'}

---------------------------------------------------
ТЕХНІЧНІ ПАРАМЕТРИ ДРУКУ (PAPERBACK PRINT SPECS)
---------------------------------------------------
Обрізний формат (Trim Size): ${book.layoutConfig.formatPreset === '6x9' ? '6" x 9" (15.24 x 22.86 cm)' : `${book.layoutConfig.pageWidthMm} x ${book.layoutConfig.pageHeightMm} mm`}
Розрахунковий обсяг сторінок (Page Count): ~${report.estimatedPages} сторінок
Внутрішнє поле (Gutter / Inside Margin): ${book.layoutConfig.margins.insideMm} мм (Мін. норма KDP: ${gutterSpec.minMm} мм)
Зовнішнє поле (Outside Margin): ${book.layoutConfig.margins.outsideMm} мм
Верхнє / Нижнє поля (Top / Bottom): ${book.layoutConfig.margins.topMm} мм / ${book.layoutConfig.margins.bottomMm} мм
Виліт під обріз (Bleed): ${book.layoutConfig.margins.bleedMm > 0 ? `${book.layoutConfig.margins.bleedMm} мм (0.125")` : 'No Bleed (Текстовий блок)'}
Товщина корінця (Spine Width): ${report.calculatedSpineMm} мм
Текст на корінці: ${report.canHaveSpineText ? 'Дозволено (≥79 сторінок)' : 'Заборонено (<79 сторінок)'}
Шрифт основного тексту: ${book.layoutConfig.typography.bodyFont}, ${book.layoutConfig.typography.fontSizePt} pt

---------------------------------------------------
ОПИС ДЛЯ КРАМНИЦІ AMAZON (BOOK DESCRIPTION / BLURB)
---------------------------------------------------
${book.synopsis || book.logline || 'Опис книги...'}

---------------------------------------------------
АНГЛОМОВНИЙ СИНОПСИС (ENGLISH SYNOPSIS FOR AMAZON.COM)
---------------------------------------------------
${book.synopsisEn || 'English synopsis...'}
`;

    downloadTextFile(`${book.title.replace(/\s+/g, '_')}_Amazon_KDP_Metadata.txt`, metadataText, 'text/plain');
  };

  // Export KDP Print-Ready PDF
  const handleExportKdpPrintPdf = () => {
    const htmlContent = generateBookExportHtml(book);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 500);
    } else {
      downloadTextFile(`${book.title.replace(/\s+/g, '_')}_KDP_Print_6x9.html`, htmlContent, 'text/html');
    }
  };

  // Export KDP Kindle EPUB binary
  const handleExportKindleEpub = async () => {
    setIsExportingEpub(true);
    try {
      await exportBookToEpub(book, { isEnglish: false });
      setAppliedSuccessMsg(t('kdpPublishingModal.epubGeneratedMsg'));
      setTimeout(() => setAppliedSuccessMsg(null), 4000);
    } catch (err) {
      console.error(err);
      const epubHtml = generateBookExportHtml(book);
      downloadTextFile(`${book.title.replace(/\s+/g, '_')}_Kindle_KDP_eBook.html`, epubHtml, 'text/html');
    } finally {
      setIsExportingEpub(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-auto text-slate-100">
        
        {/* Modal Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/40 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 text-slate-950 shadow-lg shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase tracking-wide">
                  {t('kdpPublishingModal.kdpSuiteBadge')}
                </span>
                <span className="text-xs text-slate-400">
                  {t('kdpPublishingModal.kdpSuiteSub')}
                </span>
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-white font-heading mt-0.5">
                {t('kdpPublishingModal.modalHeading')}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Compliance Summary Banner */}
        <div className="px-6 py-3.5 bg-slate-900/90 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">{t('kdpPublishingModal.readinessLabel')}</span>
              <span className={`font-mono-code font-bold px-2 py-0.5 rounded-md ${
                report.overallScore >= 90
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : report.overallScore >= 70
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              }`}>
                {report.overallScore}%
              </span>
            </div>

            <div className="h-4 w-px bg-slate-800" />

            <div className="text-slate-300">
              {t('kdpPublishingModal.formatLabel')}<b className="text-white">{book.layoutConfig.pageWidthMm}×{book.layoutConfig.pageHeightMm} мм</b> ({book.layoutConfig.formatPreset})
            </div>

            <div className="h-4 w-px bg-slate-800" />

            <div className="text-slate-300">
              {t('kdpPublishingModal.volumeLabel')}<b className="text-amber-300 font-mono">{t('kdpPublishingModal.volumeValue', { n: String(report.estimatedPages) })}</b>
            </div>

            <div className="h-4 w-px bg-slate-800" />

            <div className="text-slate-300">
              {t('kdpPublishingModal.minGutterLabel')}<b className="text-cyan-300 font-mono">{t('kdpPublishingModal.minGutterValue', { n: String(gutterSpec.minMm) })}</b>{t('kdpPublishingModal.currentSuffix', { n: String(book.layoutConfig.margins.insideMm) })}
            </div>
          </div>

          <button
            onClick={() => handleApplyPreset('kdp-6x9')}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{t('kdpPublishingModal.oneClickBtn')}</span>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950 px-6 gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('claude')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 shrink-0 ${
              activeTab === 'claude'
                ? 'border-violet-400 text-violet-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wand2 className="w-4 h-4" />
            <span>{t('kdpPublishingModal.tabClaude')}</span>
          </button>

          <button
            onClick={() => setActiveTab('autoprep')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'autoprep'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>{t('kdpPublishingModal.tabAutoprep')}</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'audit'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{t('kdpPublishingModal.tabAudit', { n: String(report.issues.length) })}</span>
          </button>

          <button
            onClick={() => setActiveTab('rules')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'rules'
                ? 'border-purple-400 text-purple-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            <span>{t('kdpPublishingModal.tabRules')}</span>
          </button>

          <button
            onClick={() => setActiveTab('export')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'export'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>{t('kdpPublishingModal.tabExport')}</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {appliedSuccessMsg && (
            <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center justify-between animate-fade-in">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>{appliedSuccessMsg}</span>
              </div>
              <button onClick={() => setAppliedSuccessMsg(null)} className="text-emerald-400 font-bold">✕</button>
            </div>
          )}

          {/* TAB 0: CLAUDE MANUSCRIPT FORMATTING (за вибором письменика) */}
          {activeTab === 'claude' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-violet-400" />
                  {t('kdpPublishingModal.claudeHeading')}
                </h3>
                <p className="text-xs text-slate-400 max-w-2xl">
                  {t('kdpPublishingModal.claudeDesc')}
                </p>
              </div>

              {isGuestUser ? (
                <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 text-center space-y-3">
                  <Lock className="w-7 h-7 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">{t('kdpPublishingModal.claudeNeedRegDesc')}</p>
                  {onGoToSubscription && (
                    <button
                      onClick={onGoToSubscription}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-white font-bold text-xs shadow-md transition-all"
                    >
                      {t('kdpPublishingModal.claudeViewPlansBtn')}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="p-4 rounded-2xl bg-violet-500/[0.06] border border-violet-500/25 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                    <div className="flex items-start gap-2.5 text-[11px] text-slate-300">
                      <Info className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" />
                      <span>{t('kdpPublishingModal.claudeBackupHint')}</span>
                    </div>
                    <button
                      onClick={handleClaudeDownloadBackup}
                      className="shrink-0 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-100 font-bold text-[11px] transition-colors flex items-center gap-1.5 border border-slate-700"
                    >
                      <FileArchive className="w-3.5 h-3.5 text-cyan-300" />
                      {t('kdpPublishingModal.claudeBackupBtn')}
                    </button>
                  </div>

                  <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-slate-300">
                        {t('kdpPublishingModal.claudeCurrentBookLabel', {
                          n: String(book.chapters.length),
                          words: totalWords.toLocaleString('uk-UA'),
                        })}
                      </div>
                      <button
                        onClick={handleClaudeFormat}
                        disabled={claudeFormatting || book.chapters.length === 0}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {claudeFormatting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        <span>{claudeFormatting ? t('kdpPublishingModal.claudeRunningBtn') : claudePreview ? t('kdpPublishingModal.claudeRerunBtn') : t('kdpPublishingModal.claudeRunBtn')}</span>
                      </button>
                    </div>

                    {claudeError && (
                      <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px] flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{claudeError}</span>
                        {onGoToSubscription && (
                          <button onClick={onGoToSubscription} className="ml-auto underline font-bold shrink-0 flex items-center gap-1">
                            <Crown className="w-3 h-3" />
                            {t('kdpPublishingModal.claudeViewPlansBtn')}
                          </button>
                        )}
                      </div>
                    )}

                    {claudeApplied && !claudePreview && (
                      <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-200 text-[11px] flex items-start gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{t('kdpPublishingModal.claudeAlreadyAppliedNote')}</span>
                      </div>
                    )}
                  </div>

                  {claudePreview && claudePreview.length > 0 && (
                    <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="text-xs font-bold text-slate-200">
                          {t('kdpPublishingModal.claudePreviewHeading', {
                            n: String(claudePreview.length),
                            words: claudePreviewWords.toLocaleString('uk-UA'),
                          })}
                        </h4>
                      </div>

                      {claudeNotes.length > 0 && (
                        <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-300">
                            <Info className="w-3.5 h-3.5" /> {t('kdpPublishingModal.claudeNotesHeading')}
                          </div>
                          <ul className="text-[11px] text-slate-300 space-y-1 list-disc pl-4">
                            {claudeNotes.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                        {claudePreview.map((c, idx) => (
                          <div key={idx} className="p-3 rounded-xl bg-slate-950/50 border border-white/[0.06] flex items-center justify-between gap-3">
                            <span className="text-xs font-semibold text-slate-200 truncate">{idx + 1}. {c.title}</span>
                            <span className="text-[10px] text-slate-500 shrink-0">{t('kdpPublishingModal.claudeWordsShort', { n: calculateWordCount(c.text).toLocaleString('uk-UA') })}</span>
                          </div>
                        ))}
                      </div>

                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{t('kdpPublishingModal.claudeReplaceWarning')}</span>
                      </div>

                      <label className="flex items-start gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={claudeConfirmed}
                          onChange={(e) => setClaudeConfirmed(e.target.checked)}
                          className="mt-0.5 accent-violet-500"
                        />
                        <span>{t('kdpPublishingModal.claudeConfirmLabel')}</span>
                      </label>

                      <div className="flex items-center gap-3 pt-1">
                        <button
                          onClick={handleClaudeApply}
                          disabled={!claudeConfirmed}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {t('kdpPublishingModal.claudeApplyBtn')}
                        </button>
                        <button
                          onClick={handleClaudeDiscard}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {t('kdpPublishingModal.claudeDiscardBtn')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB 1: 1-CLICK AUTO-PREPARATION */}
          {activeTab === 'autoprep' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">
                  {t('kdpPublishingModal.chooseFormatHeading')}
                </h3>
                <p className="text-xs text-slate-400">
                  {t('kdpPublishingModal.chooseFormatDesc')}
                </p>
              </div>

              {/* Presets Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {KDP_TRIM_SIZES.slice(0, 4).map((trim) => {
                  const isSelected = selectedPreset === trim.id;
                  return (
                    <div
                      key={trim.id}
                      onClick={() => setSelectedPreset(trim.id as any)}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500/80 shadow-lg ring-1 ring-amber-500/50'
                          : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-xl ${isSelected ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
                            <BookOpen className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="font-bold text-white text-xs block">{trim.name}</span>
                            <span className="text-[10px] text-amber-300/90 font-mono">{trim.nameUk}</span>
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-amber-400" />}
                      </div>

                      <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                        {trim.popularFor}
                      </p>

                      <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>{t('kdpPublishingModal.minGutterCardLabel', { n: String(gutterSpec.minMm) })}</span>
                        <span>{t('kdpPublishingModal.marginsCardLabel')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Applied Settings Preview Breakdown */}
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
                <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  {t('kdpPublishingModal.optimizedParamsHeading')}
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">{t('kdpPublishingModal.gutterCardLabel')}</span>
                    <span className="text-sm font-bold text-amber-300 font-mono">
                      {t('kdpPublishingModal.gutterCardValue', { n: String(Math.max(gutterSpec.minMm + 1.5, 14.0)) })}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">{t('kdpPublishingModal.gutterCardNote', { n: String(report.estimatedPages) })}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">{t('kdpPublishingModal.outsideMarginsCardLabel')}</span>
                    <span className="text-sm font-bold text-cyan-300 font-mono">{t('kdpPublishingModal.outsideMarginsValue')}</span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">{t('kdpPublishingModal.outsideMarginsNote')}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">{t('kdpPublishingModal.typographyCardLabel')}</span>
                    <span className="text-sm font-bold text-purple-300">{t('kdpPublishingModal.typographyValue')}</span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">{t('kdpPublishingModal.typographyNote')}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">{t('kdpPublishingModal.spineCardLabel')}</span>
                    <span className="text-sm font-bold text-emerald-300 font-mono">{t('kdpPublishingModal.spineValue', { n: String(report.calculatedSpineMm) })}</span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      {report.canHaveSpineText ? t('kdpPublishingModal.spineTextAllowed') : t('kdpPublishingModal.spineTextDisallowed')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>{t('kdpPublishingModal.mirroredTocNote')}</span>
                  </div>

                  <button
                    onClick={() => handleApplyPreset(selectedPreset)}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-lg active:scale-95 transition-all flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{t('kdpPublishingModal.applyNowBtn')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: COMPLIANCE AUDIT INSPECTOR */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {t('kdpPublishingModal.auditHeading')}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {t('kdpPublishingModal.auditDesc')}
                  </p>
                </div>

                <button
                  onClick={() => handleApplyPreset('kdp-6x9')}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 text-xs font-bold transition-all"
                >
                  {t('kdpPublishingModal.autoFixAllBtn')}
                </button>
              </div>

              <div className="space-y-3">
                {report.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      issue.severity === 'error'
                        ? 'bg-rose-950/20 border-rose-500/40'
                        : issue.severity === 'warning'
                        ? 'bg-amber-950/20 border-amber-500/40'
                        : 'bg-slate-900/60 border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          {issue.severity === 'error' ? (
                            <AlertCircle className="w-5 h-5 text-rose-400" />
                          ) : issue.severity === 'warning' ? (
                            <AlertTriangle className="w-5 h-5 text-amber-400" />
                          ) : (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                          )}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs text-white">{issue.title}</span>
                            <span className={`px-2 py-0.2 rounded text-[9px] font-bold uppercase ${
                              issue.severity === 'error'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : issue.severity === 'warning'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}>
                              {issue.severity === 'error' ? t('kdpPublishingModal.severityError') : issue.severity === 'warning' ? t('kdpPublishingModal.severityWarning') : t('kdpPublishingModal.severityOk')}
                            </span>
                          </div>

                          <p className="text-xs text-slate-300 leading-relaxed">{issue.message}</p>

                          <div className="flex items-center gap-4 text-[11px] pt-1 text-slate-400 font-mono">
                            {issue.currentValue && <span>{t('kdpPublishingModal.currentLabel')}<b className="text-slate-200">{issue.currentValue}</b></span>}
                            {issue.requiredValue && <span>{t('kdpPublishingModal.requiredLabel')}<b className="text-amber-300">{issue.requiredValue}</b></span>}
                          </div>

                          <p className="text-[11px] text-slate-400 italic pt-1">
                            {t('kdpPublishingModal.recommendationPrefix')}{issue.recommendation}
                          </p>
                        </div>
                      </div>

                      {issue.autoFixable && (
                        <button
                          onClick={() => handleApplyPreset('kdp-6x9')}
                          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shrink-0 transition-all shadow-sm"
                        >
                          {t('kdpPublishingModal.fixBtn')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: OFFICIAL KDP GUIDELINES & SPECIFICATIONS TABLE */}
          {activeTab === 'rules' && (
            <div className="space-y-6 text-xs text-slate-300">
              
              {/* Section 1: Paperback Print Requirements */}
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
                <div className="flex items-center gap-2">
                  <Printer className="w-4 h-4 text-amber-400" />
                  <h3 className="font-bold text-sm text-white">
                    {t('kdpPublishingModal.rulesSection1Heading')}
                  </h3>
                </div>

                <div className="space-y-3">
                  <p>
                    <b>{t('kdpPublishingModal.trimSizesLabel')}</b>{t('kdpPublishingModal.trimSizesPart1')}<b>6" × 9" (152.4 × 228.6 мм)</b>{t('kdpPublishingModal.trimSizesPart2')}
                  </p>

                  {/* Gutter Table */}
                  <div>
                    <h4 className="font-bold text-slate-200 mb-2">
                      {t('kdpPublishingModal.gutterTableHeading')}
                    </h4>
                    <div className="overflow-x-auto rounded-xl border border-slate-800">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                            <th className="p-2.5">{t('kdpPublishingModal.tableColPages')}</th>
                            <th className="p-2.5">{t('kdpPublishingModal.tableColMinInches')}</th>
                            <th className="p-2.5">{t('kdpPublishingModal.tableColMinMm')}</th>
                            <th className="p-2.5">{t('kdpPublishingModal.tableColStatus')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80">
                          <tr className={report.estimatedPages <= 150 ? 'bg-amber-500/10 font-bold text-amber-300' : ''}>
                            <td className="p-2.5">{t('kdpPublishingModal.pagesRange1')}</td>
                            <td className="p-2.5">0.375 in</td>
                            <td className="p-2.5">9.6 мм</td>
                            <td className="p-2.5">{report.estimatedPages <= 150 ? t('kdpPublishingModal.yourVolumeLabel') : '—'}</td>
                          </tr>
                          <tr className={report.estimatedPages > 150 && report.estimatedPages <= 300 ? 'bg-amber-500/10 font-bold text-amber-300' : ''}>
                            <td className="p-2.5">{t('kdpPublishingModal.pagesRange2')}</td>
                            <td className="p-2.5">0.500 in</td>
                            <td className="p-2.5">12.7 мм</td>
                            <td className="p-2.5">{report.estimatedPages > 150 && report.estimatedPages <= 300 ? t('kdpPublishingModal.yourVolumeLabel') : '—'}</td>
                          </tr>
                          <tr className={report.estimatedPages > 300 && report.estimatedPages <= 500 ? 'bg-amber-500/10 font-bold text-amber-300' : ''}>
                            <td className="p-2.5">{t('kdpPublishingModal.pagesRange3')}</td>
                            <td className="p-2.5">0.625 in</td>
                            <td className="p-2.5">15.9 мм</td>
                            <td className="p-2.5">{report.estimatedPages > 300 && report.estimatedPages <= 500 ? t('kdpPublishingModal.yourVolumeLabel') : '—'}</td>
                          </tr>
                          <tr className={report.estimatedPages > 500 && report.estimatedPages <= 700 ? 'bg-amber-500/10 font-bold text-amber-300' : ''}>
                            <td className="p-2.5">{t('kdpPublishingModal.pagesRange4')}</td>
                            <td className="p-2.5">0.750 in</td>
                            <td className="p-2.5">19.1 мм</td>
                            <td className="p-2.5">{report.estimatedPages > 500 && report.estimatedPages <= 700 ? t('kdpPublishingModal.yourVolumeLabel') : '—'}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="font-bold text-slate-200 block mb-1">{t('kdpPublishingModal.outsideMarginsLabel')}</span>
                      <span>{t('kdpPublishingModal.outsideMarginsText1')}<b>6.4 мм (0.25")</b>{t('kdpPublishingModal.outsideMarginsText2')}<b>9.6 мм (0.375")</b>{t('kdpPublishingModal.outsideMarginsText3')}</span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="font-bold text-slate-200 block mb-1">{t('kdpPublishingModal.bleedLabel')}</span>
                      <span>{t('kdpPublishingModal.bleedText1')}<b>3.2 мм (0.125")</b>{t('kdpPublishingModal.bleedText2')}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Kindle eBook Requirements */}
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-cyan-400" />
                  <h3 className="font-bold text-sm text-white">
                    {t('kdpPublishingModal.rulesSection2Heading')}
                  </h3>
                </div>

                <ul className="space-y-2 list-disc pl-5 leading-relaxed">
                  <li>
                    <b>{t('kdpPublishingModal.kindleCoverLabel')}</b>{t('kdpPublishingModal.kindleCoverText1')}<b>2560 × 1600 px</b>{t('kdpPublishingModal.kindleCoverText2')}
                  </li>
                  <li>
                    <b>{t('kdpPublishingModal.paragraphIndentLabel')}</b>{t('kdpPublishingModal.paragraphIndentText1')}<code>text-indent: 5–8mm</code>{t('kdpPublishingModal.paragraphIndentText2')}<b>{t('kdpPublishingModal.paragraphIndentForbidden')}</b>{t('kdpPublishingModal.paragraphIndentText3')}
                  </li>
                  <li>
                    <b>{t('kdpPublishingModal.chapterHeadingsLabel')}</b>{t('kdpPublishingModal.chapterHeadingsText1')}<code>&lt;h1&gt;</code>{t('kdpPublishingModal.chapterHeadingsText2')}<code>&lt;h2&gt;</code>{t('kdpPublishingModal.chapterHeadingsText3')}
                  </li>
                  <li>
                    <b>{t('kdpPublishingModal.tocLabel')}</b>{t('kdpPublishingModal.tocText')}
                  </li>
                  <li>
                    <b>{t('kdpPublishingModal.encodingLabel')}</b>{t('kdpPublishingModal.encodingText')}
                  </li>
                </ul>
              </div>

            </div>
          )}

          {/* TAB 4: DIRECT KDP EXPORTS */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">
                  {t('kdpPublishingModal.exportHeading')}
                </h3>
                <p className="text-xs text-slate-400">
                  {t('kdpPublishingModal.exportDesc')}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Print PDF Card */}
                <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="p-3 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/30 w-fit">
                      <Printer className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-white text-xs">
                      {t('kdpPublishingModal.printPdfCardTitle')}
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t('kdpPublishingModal.printPdfCardDesc', { preset: book.layoutConfig.formatPreset, n: String(book.layoutConfig.margins.insideMm) })}
                    </p>
                  </div>

                  <button
                    onClick={handleExportKdpPrintPdf}
                    className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>{t('kdpPublishingModal.downloadPrintPdfBtn')}</span>
                  </button>
                </div>

                {/* Kindle EPUB / HTML Card */}
                <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 w-fit">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-white text-xs">
                      {t('kdpPublishingModal.kindleEpubCardTitle')}
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t('kdpPublishingModal.kindleEpubCardDesc')}
                    </p>
                  </div>

                  <button
                    onClick={handleExportKindleEpub}
                    disabled={isExportingEpub}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>{isExportingEpub ? t('kdpPublishingModal.generatingEpubBtn') : t('kdpPublishingModal.downloadKindleEpubBtn')}</span>
                  </button>
                </div>

                {/* KDP Metadata Sheet Card */}
                <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="p-3 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 w-fit">
                      <Sliders className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-white text-xs">
                      {t('kdpPublishingModal.metadataCardTitle')}
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t('kdpPublishingModal.metadataCardDesc')}
                    </p>
                  </div>

                  <button
                    onClick={handleExportKdpMetadata}
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>{t('kdpPublishingModal.downloadKdpSheetBtn')}</span>
                  </button>
                </div>

              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 bg-slate-900/90 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="text-slate-400 text-[11px]">
            {t('kdpPublishingModal.footerNote')}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-colors"
            >
              {t('kdpPublishingModal.closeBtn')}
            </button>

            <button
              onClick={() => {
                handleApplyPreset('kdp-6x9');
                setActiveTab('audit');
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold shadow-md transition-all active:scale-95"
            >
              {t('kdpPublishingModal.optimizeBtn')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
