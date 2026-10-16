import React, { useEffect, useMemo, useState } from 'react';
import { 
  FileDown, 
  Printer, 
  FileText, 
  BookOpen, 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle,
  Sparkles, 
  Download, 
  Share2,
  HardDrive,
  Zap,
  ShieldCheck,
  PackageCheck,
  Layers,
  ExternalLink,
  Loader2
} from 'lucide-react';
import { Book, AuthUser } from '../types';
import { generateBookExportHtml, downloadTextFile, estimatePageCount } from '../utils/helpers';
import { 
  validateKdpCompliance, 
  generateKdpMetadataReport, 
  getKdpMinimumGutterMm 
} from '../utils/kdpHelpers';
import { exportBookToDocx, exportBookToEpub, bookToPlainText } from '../utils/fileExporters';
import { KdpPublishingModal } from './KdpPublishingModal';
import { useLanguage } from '../i18n/LanguageContext';

interface ExportViewProps {
  book: Book;
  onUpdateBook?: (updatedBook: Book, action?: string, details?: string) => void;
  totalWords: number;
  authUser?: AuthUser | null;
  onGoToSubscription?: () => void;
}

interface PdfEngineOption {
  id: string;
  label: string;
  available: boolean;
  supportsPrint?: boolean;
  reasonUk?: string;
  badgeUk?: string;
}

const DEFAULT_PDF_ENGINE_ID = 'nova';

function decodePdfNote(res: Response): string {
  const raw = res.headers.get('X-Pdf-Note') || '';
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function filenameFromDisposition(res: Response, fallback: string): string {
  const raw = res.headers.get('Content-Disposition') || '';
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(raw)?.[1];
  if (utf) {
    try {
      return decodeURIComponent(utf);
    } catch {
      return utf;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(raw)?.[1];
  return plain || fallback;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const ExportView: React.FC<ExportViewProps> = ({ book, onUpdateBook, totalWords, authUser, onGoToSubscription }) => {
  const { t } = useLanguage();
  const [isExporting, setIsExporting] = useState(false);
  const [exportType, setExportType] = useState<string | null>(null);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);
  const [exportErrorMsg, setExportErrorMsg] = useState<string | null>(null);
  const [showKdpModal, setShowKdpModal] = useState(false);
  const [pdfEngines, setPdfEngines] = useState<PdfEngineOption[]>([]);

  const preferredPdfEngineId = book.layoutConfig.preferredPdfEngineId || DEFAULT_PDF_ENGINE_ID;
  const selectedPdfEngine = useMemo(
    () => pdfEngines.find((engine) => engine.id === preferredPdfEngineId) || null,
    [pdfEngines, preferredPdfEngineId]
  );
  const selectedPdfLabel = selectedPdfEngine?.label || preferredPdfEngineId;
  const selectedPdfAvailable = selectedPdfEngine ? selectedPdfEngine.available : true;
  const selectedSupportsPrint = selectedPdfEngine?.supportsPrint === true;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/pdf/engines', { credentials: 'include' })
      .then(async (res) => (res.ok ? res.json() : Promise.reject(new Error('engine_list_failed'))))
      .then((payload) => {
        if (!cancelled) setPdfEngines(Array.isArray(payload?.engines) ? payload.engines : []);
      })
      .catch(() => {
        if (!cancelled) setPdfEngines([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPages = estimatePageCount(
    totalWords,
    book.layoutConfig.formatPreset,
    book.layoutConfig.typography.fontSizePt,
    book.layoutConfig.typography.lineHeight
  );

  const kdpReport = validateKdpCompliance(book, totalWords);
  const gutterSpec = getKdpMinimumGutterMm(totalPages);

  /**
   * Production PDF export. Uses the same server renderer registry as preview
   * and publish, so the downloaded PDF is produced by exactly one selected
   * engine. There is no silent renderer fallback here.
   */
  const handleExportServerPdf = async (format: 'digital' | 'print', engineId = preferredPdfEngineId) => {
    const busyKey = `pdf-${format}-${engineId}`;
    setIsExporting(true);
    setExportType(busyKey);
    setExportErrorMsg(null);
    setExportSuccessMsg(null);
    try {
      const res = await fetch('/api/pdf/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book,
          format,
          engineId,
          hasBleed: format === 'print' && Number(book.layoutConfig.margins.bleedMm || 0) > 0,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(String(payload?.error || 'Не вдалося згенерувати PDF.'));
      }

      const blob = await res.blob();
      const actualEngine = res.headers.get('X-Pdf-Engine') || engineId;
      const pageCount = res.headers.get('X-Pdf-Pages');
      const note = decodePdfNote(res);
      const fallback = `${book.title.replace(/\s+/g, '_')}_${format}_${actualEngine}.pdf`;
      downloadBlob(blob, filenameFromDisposition(res, fallback));
      setExportSuccessMsg(
        `PDF готовий: ${actualEngine}${pageCount ? ` · ${pageCount} стор.` : ''}${note ? ` · ${note}` : ''}`
      );
    } catch (err) {
      setExportErrorMsg(String((err as Error)?.message || err));
    } finally {
      setIsExporting(false);
      setExportType(null);
    }
  };

  // Legacy browser print is intentionally preserved as an advanced fallback.
  const handleLegacyBrowserPrint = () => {
    setIsExporting(true);
    setExportType('legacy-pdf');
    setExportErrorMsg(null);
    const htmlContent = generateBookExportHtml(book);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        setIsExporting(false);
        setExportType(null);
      }, 500);
    } else {
      downloadTextFile(`${book.title.replace(/\s+/g, '_')}_Print.html`, htmlContent, 'text/html');
      setIsExporting(false);
      setExportType(null);
      setExportSuccessMsg(t('exportView.toastPrintDownloaded'));
    }
  };

  const handleExportDocx = async () => {
    setIsExporting(true);
    setExportType('docx');
    try {
      await exportBookToDocx(book, { isEnglish: false });
      setExportSuccessMsg(t('exportView.toastDocxGenerated'));
    } catch (err: any) {
      console.error('Error generating DOCX:', err);
      downloadTextFile(
        `${book.title.replace(/\s+/g, '_')}.docx.txt`,
        bookToPlainText(book, { isEnglish: false }),
        'text/plain'
      );
      setExportSuccessMsg(t('exportView.toastDocxFallback'));
    } finally {
      setIsExporting(false);
      setExportType(null);
    }
  };

  const handleExportEnglishEdition = async () => {
    setIsExporting(true);
    setExportType('en_docx');
    try {
      await exportBookToDocx(book, { isEnglish: true });
      setExportSuccessMsg(t('exportView.toastEnDocxGenerated'));
    } catch (err: any) {
      console.error('Error generating English DOCX:', err);
      downloadTextFile(
        `${(book.titleEn || book.title).replace(/\s+/g, '_')}_English_Edition.docx.txt`,
        bookToPlainText(book, { isEnglish: true }),
        'text/plain'
      );
      setExportSuccessMsg(t('exportView.toastEnDocxFallback'));
    } finally {
      setIsExporting(false);
      setExportType(null);
    }
  };

  const handleExportEpub = async (isEnglish: boolean = false) => {
    setIsExporting(true);
    setExportType(isEnglish ? 'en_epub' : 'epub');
    try {
      await exportBookToEpub(book, { isEnglish });
      setExportSuccessMsg(t('exportView.toastEpubGenerated'));
    } catch (err: any) {
      console.error('Error generating EPUB:', err);
      const epubHtml = generateBookExportHtml(book);
      downloadTextFile(`${book.title.replace(/\s+/g, '_')}.epub.html`, epubHtml, 'text/html');
      setExportSuccessMsg(t('exportView.toastEpubFallback'));
    } finally {
      setIsExporting(false);
      setExportType(null);
    }
  };

  const handleExportKdpSpec = () => {
    const spec = generateKdpMetadataReport(book, totalWords);
    downloadTextFile(`${book.title.replace(/\s+/g, '_')}_Amazon_KDP_Spec.txt`, spec, 'text/plain');
    setExportSuccessMsg(t('exportView.toastKdpSpecDownloaded'));
  };

  const checklist = [
    {
      title: t('exportView.checklistKdpTitle'),
      status: kdpReport.overallScore >= 85,
      desc: t('exportView.checklistKdpDesc', {
        score: String(kdpReport.overallScore),
        issues: kdpReport.issues.length === 0 ? t('exportView.checklistKdpIdeal') : t('exportView.checklistKdpIssuesCount', { n: String(kdpReport.issues.length) }),
      }),
    },
    {
      title: t('exportView.checklistFormatTitle'),
      status: true,
      desc: t('exportView.checklistFormatDesc', {
        preset: book.layoutConfig.formatPreset,
        w: String(book.layoutConfig.pageWidthMm),
        h: String(book.layoutConfig.pageHeightMm),
        pages: String(totalPages),
      }),
    },
    {
      title: t('exportView.checklistGutterTitle'),
      status: book.layoutConfig.margins.insideMm >= gutterSpec.minMm,
      desc: t('exportView.checklistGutterDesc', { n: String(book.layoutConfig.margins.insideMm), min: String(gutterSpec.minMm) }),
    },
    {
      title: t('exportView.checklistFrontMatterTitle'),
      status: book.layoutConfig.frontMatter.showTitlePage,
      desc: t('exportView.checklistFrontMatterDesc'),
    },
    {
      title: t('exportView.checklistCoverTitle'),
      status: !!book.coverConfig.frontArtUrl,
      desc: t('exportView.checklistCoverDesc', {
        barcode: book.coverConfig.barcode || t('exportView.checklistCoverBarcodeFallback'),
        spine: kdpReport.calculatedSpineMm.toFixed(1),
      }),
    },
    {
      title: t('exportView.checklistVisualBibleTitle'),
      status: !!book.visualBible.artStyle,
      desc: `${book.visualBible.artStyle}`,
    },
  ];

  const digitalBusy = exportType === `pdf-digital-${preferredPdfEngineId}`;
  const printEngineId = selectedSupportsPrint ? preferredPdfEngineId : DEFAULT_PDF_ENGINE_ID;
  const printBusy = exportType === `pdf-print-${printEngineId}`;

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">{t('exportView.headerBadge')}</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1"><Zap className="w-3 h-3" /><span>{t('exportView.kdpReadyBadge')}</span></span>
            <span className="text-xs text-slate-400">{t('exportView.headerSubBadge')}</span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">{t('exportView.headerTitle')}</h1>
        </div>
        <button onClick={() => setShowKdpModal(true)} data-tour="export__1" className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-lg transition-all active:scale-95 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /><span>{t('exportView.kdpWizardBtn')}</span></button>
      </div>

      {exportSuccessMsg && <div className="p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center justify-between"><div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span>{exportSuccessMsg}</span></div><button onClick={() => setExportSuccessMsg(null)} className="text-emerald-400 font-bold">✕</button></div>}
      {exportErrorMsg && <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-medium flex items-center justify-between gap-3"><div className="flex items-center gap-2 min-w-0"><AlertCircle className="w-4 h-4 text-rose-400 shrink-0" /><span>{exportErrorMsg}</span></div><button onClick={() => setExportErrorMsg(null)} className="text-rose-300 font-bold shrink-0">✕</button></div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-4">
          <div className="p-6 rounded-2xl bg-gradient-to-br from-amber-950/40 via-slate-950/90 to-slate-900 border-2 border-amber-500/40 space-y-4 shadow-xl relative overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="p-3.5 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-inner"><PackageCheck className="w-7 h-7" /></div><div><div className="flex items-center gap-2"><h3 className="text-base font-bold text-white">{t('exportView.featuredHeading')}</h3><span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500 text-slate-950">{t('exportView.featuredStandardBadge', { n: String(kdpReport.overallScore) })}</span></div><p className="text-xs text-slate-300 mt-1 max-w-xl">{t('exportView.featuredDesc', { gutter: String(book.layoutConfig.margins.insideMm), spine: kdpReport.calculatedSpineMm.toFixed(1) })}</p></div></div><button onClick={() => setShowKdpModal(true)} className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg transition-all active:scale-95 shrink-0 flex items-center gap-2"><Zap className="w-4 h-4" /><span>{t('exportView.openKdpWizardBtn')}</span></button></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800">
              <button onClick={() => handleExportServerPdf('print', 'nova')} disabled={isExporting} className="p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-700/80 text-left transition-all text-xs flex flex-col justify-between disabled:opacity-60"><span className="font-bold text-slate-100 flex items-center gap-1.5 mb-1">{exportType === 'pdf-print-nova' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" /> : <Printer className="w-3.5 h-3.5 text-rose-400" />}{t('exportView.kdpPaperbackPdfLabel')}</span><span className="text-[11px] text-slate-400">Nova · {t('exportView.kdpPaperbackPdfDesc')}</span></button>
              <button onClick={() => handleExportEpub(false)} disabled={isExporting} className="p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-700/80 text-left transition-all text-xs flex flex-col justify-between"><span className="font-bold text-slate-100 flex items-center gap-1.5 mb-1">{isExporting && exportType === 'epub' ? <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" /> : <BookOpen className="w-3.5 h-3.5 text-emerald-400" />}{t('exportView.kindleEpubLabel')}</span><span className="text-[11px] text-slate-400">{t('exportView.kindleEpubDesc')}</span></button>
              <button onClick={handleExportKdpSpec} className="p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-700/80 text-left transition-all text-xs flex flex-col justify-between"><span className="font-bold text-slate-100 flex items-center gap-1.5 mb-1"><FileText className="w-3.5 h-3.5 text-amber-400" />{t('exportView.kdpSpecLabel')}</span><span className="text-[11px] text-slate-400">{t('exportView.kdpSpecDesc')}</span></button>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-slate-950/90 border border-cyan-500/30 space-y-4 hover:border-cyan-500/60 transition-all">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="p-3.5 rounded-2xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"><FileDown className="w-6 h-6" /></div><div><div className="flex items-center gap-2 flex-wrap"><h3 className="text-sm font-bold text-white">PDF — фінальний файл</h3><span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-bold">{selectedPdfEngine?.badgeUk || selectedPdfLabel}</span>{!selectedPdfAvailable && <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/15 text-rose-300 border border-rose-500/30 font-bold">недоступний</span>}</div><p className="text-xs text-slate-400 mt-1">Digital PDF створюється обраним у «Дизайні книги» рушієм: <b className="text-slate-200">{selectedPdfLabel}</b>.</p>{!selectedPdfAvailable && selectedPdfEngine?.reasonUk && <p className="text-[11px] text-rose-300 mt-1">{selectedPdfEngine.reasonUk}</p>}</div></div></div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
              <button onClick={() => handleExportServerPdf('digital')} disabled={isExporting || !selectedPdfAvailable} data-tour="export__2" className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:hover:bg-cyan-600 text-white text-xs font-bold shadow-lg transition-all active:scale-95 flex items-center gap-2">{digitalBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}<span>Digital PDF · {selectedPdfLabel}</span></button>
              <button onClick={() => handleExportServerPdf('print', printEngineId)} disabled={isExporting} className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg transition-all active:scale-95 flex items-center gap-2">{printBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}<span>{selectedSupportsPrint ? `Print PDF · ${selectedPdfLabel}` : 'Print PDF · явно через Nova'}</span></button>
              <button onClick={handleLegacyBrowserPrint} disabled={isExporting} className="px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 text-[11px] font-bold transition-all flex items-center gap-1.5" title="Старий browser-print шлях. Не є канонічним PDF renderer Studio.">{exportType === 'legacy-pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}Legacy / Browser Print</button>
            </div>
            {!selectedSupportsPrint && <p className="text-[11px] text-amber-300/90">{selectedPdfLabel} не заявляє production-print/KDP. Studio не підмінює рушій мовчки: кнопка Print окремо й явно використовує Nova.</p>}
          </div>

          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-indigo-500/50 transition-all"><div className="flex items-center gap-4"><div className="p-3.5 rounded-2xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"><FileText className="w-6 h-6" /></div><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">{t('exportView.docxHeading')}</h3><span className="px-2 py-0.5 rounded-full text-[10px] bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">Binary OpenXML</span></div><p className="text-xs text-slate-400 mt-1">{t('exportView.docxDesc')}</p></div></div><button onClick={handleExportDocx} disabled={isExporting} data-tour="export__3" className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg transition-all active:scale-95 shrink-0 flex items-center gap-2">{isExporting && exportType === 'docx' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}<span>{isExporting && exportType === 'docx' ? t('exportView.docxGeneratingBtn') : t('exportView.docxExportBtn')}</span></button></div>
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-emerald-500/50 transition-all"><div className="flex items-center gap-4"><div className="p-3.5 rounded-2xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"><BookOpen className="w-6 h-6" /></div><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">{t('exportView.epubHeading')}</h3><span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">Standard Archive</span></div><p className="text-xs text-slate-400 mt-1">{t('exportView.epubDesc')}</p></div></div><button onClick={() => handleExportEpub(false)} disabled={isExporting} data-tour="export__4" className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg transition-all active:scale-95 shrink-0 flex items-center gap-2">{isExporting && exportType === 'epub' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}<span>{isExporting && exportType === 'epub' ? t('exportView.epubPackagingBtn') : t('exportView.epubExportBtn')}</span></button></div>
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-amber-500/60 transition-all"><div className="flex items-center gap-4"><div className="p-3.5 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30"><FileText className="w-6 h-6" /></div><div><h3 className="text-sm font-bold text-white flex items-center gap-2"><span>{t('exportView.englishEditionHeading')}</span><span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">{t('exportView.englishEditionBadge')}</span></h3><p className="text-xs text-slate-400">{t('exportView.englishEditionDesc')}</p></div></div><div className="flex items-center gap-2 shrink-0"><button onClick={handleExportEnglishEdition} disabled={isExporting} className="px-3.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-lg transition-all active:scale-95 flex items-center gap-1.5">{isExporting && exportType === 'en_docx' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}<span>EN DOCX</span></button><button onClick={() => handleExportEpub(true)} disabled={isExporting} className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg transition-all active:scale-95 flex items-center gap-1.5">{isExporting && exportType === 'en_epub' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}<span>EN EPUB</span></button></div></div>
        </div>

        <div className="lg:col-span-4 space-y-4"><div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4" data-tour="export__5"><h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />{t('exportView.checklistHeading')}</h3><div className="space-y-3">{checklist.map((item, idx) => <div key={idx} className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1"><div className="flex items-center gap-2">{item.status ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}<span className="text-xs font-bold text-slate-200">{item.title}</span></div><p className="text-[11px] text-slate-400 pl-6">{item.desc}</p></div>)}</div><div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center justify-between"><span>{t('exportView.kdpReadinessLabel')}<b>{kdpReport.overallScore}%</b></span><button onClick={() => setShowKdpModal(true)} className="underline hover:text-white font-bold">{t('exportView.configureBtn')}</button></div></div></div>
      </div>

      {showKdpModal && onUpdateBook && <KdpPublishingModal isOpen={showKdpModal} onClose={() => setShowKdpModal(false)} book={book} onUpdateBook={onUpdateBook} totalWords={totalWords} authUser={authUser} onGoToSubscription={onGoToSubscription} />}
    </div>
  );
};
