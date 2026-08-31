import React, { useState } from 'react';
import { 
  LayoutTemplate, 
  BookOpen, 
  Type, 
  Sliders, 
  FileSpreadsheet, 
  Check, 
  Maximize2, 
  Layers, 
  Sparkles,
  Info,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Zap,
  HelpCircle,
  Printer
} from 'lucide-react';
import { Book, BookLayoutConfig, PageFormatPreset } from '../types';
import { estimatePageCount } from '../utils/helpers';
import { 
  KDP_TRIM_SIZES, 
  getKdpMinimumGutterMm, 
  validateKdpCompliance, 
  applyKdpOptimization 
} from '../utils/kdpHelpers';
import { KdpPublishingModal } from './KdpPublishingModal';
import { DesignSuggestionPanel } from './DesignSuggestionPanel';
import { useLanguage } from '../i18n/LanguageContext';

interface LayoutViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, action?: string, details?: string) => void;
  totalWords: number;
}

export const LayoutView: React.FC<LayoutViewProps> = ({ book, onUpdateBook, totalWords }) => {
  const { t } = useLanguage();
  const layout = book.layoutConfig;
  const [showKdpModal, setShowKdpModal] = useState<boolean>(false);

  // Calculate estimated total pages dynamically
  const estimatedPages = estimatePageCount(
    totalWords,
    layout.formatPreset,
    layout.typography.fontSizePt,
    layout.typography.lineHeight
  );

  // Amazon KDP compliance report
  const kdpReport = validateKdpCompliance(book, totalWords);
  const gutterSpec = getKdpMinimumGutterMm(estimatedPages);
  const isGutterCompliant = layout.margins.insideMm >= gutterSpec.minMm;

  const formatPresets: { id: PageFormatPreset; label: string; widthMm: number; heightMm: number; desc: string; kdpTag?: string }[] = [
    { id: '6x9', label: t('layoutView.preset6x9Label'), widthMm: 152.4, heightMm: 228.6, desc: t('layoutView.preset6x9Desc'), kdpTag: 'Amazon #1' },
    { id: '5.5x8.5', label: t('layoutView.preset55x85Label'), widthMm: 139.7, heightMm: 215.9, desc: t('layoutView.preset55x85Desc'), kdpTag: 'Amazon KDP' },
    { id: '5x8', label: t('layoutView.preset5x8Label'), widthMm: 127, heightMm: 203.2, desc: t('layoutView.preset5x8Desc'), kdpTag: 'Amazon KDP' },
    { id: '7x10', label: t('layoutView.preset7x10Label'), widthMm: 177.8, heightMm: 254, desc: t('layoutView.preset7x10Desc'), kdpTag: 'Amazon KDP' },
    { id: 'A5', label: t('layoutView.presetA5Label'), widthMm: 148, heightMm: 210, desc: t('layoutView.presetA5Desc') },
    { id: 'A4', label: t('layoutView.presetA4Label'), widthMm: 210, heightMm: 297, desc: t('layoutView.presetA4Desc') },
  ];

  const handleSelectPreset = (preset: PageFormatPreset) => {
    const found = formatPresets.find((p) => p.id === preset);
    if (!found) return;

    onUpdateBook(
      {
        ...book,
        layoutConfig: {
          ...layout,
          formatPreset: preset,
          pageWidthMm: found.widthMm,
          pageHeightMm: found.heightMm,
        },
      },
      'Зміна формату верстки',
      `Встановлено книжковий формат: ${found.label}`
    );
  };

  const handleUpdateLayout = (updated: Partial<BookLayoutConfig>) => {
    onUpdateBook({
      ...book,
      layoutConfig: {
        ...layout,
        ...updated,
      },
    });
  };

  const handleQuickKdpOptimize = () => {
    const updated = applyKdpOptimization(book, 'kdp-6x9', totalWords);
    onUpdateBook(
      updated,
      'Автооптимізація під Amazon KDP',
      `Встановлено золотий стандарт 6x9", корінцеве поле ${updated.layoutConfig.margins.insideMm} мм (для ~${estimatedPages} стор.), шрифт Literata 10.5pt`
    );
  };

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">

      {/* Скіл /design. Стоїть перед ручними налаштуваннями навмисно:
          спершу пропозиція під текст, далі — доведення руками. */}
      <DesignSuggestionPanel book={book} onUpdateBook={onUpdateBook} />

      {/* Top Banner */}
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {t('layoutView.headerBadge')}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
              <BookOpen className="w-3 h-3" />
              <span>{t('layoutView.kdpReadyBadge', { n: String(kdpReport.overallScore) })}</span>
            </span>
            <span className="text-xs text-slate-400">
              {t('layoutView.headerSubBadge')}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">
            {t('layoutView.headerTitle')}
          </h1>
        </div>

        {/* Action Controls & Dynamic Page Counter Badge */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowKdpModal(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-lg transition-all active:scale-95 flex items-center gap-2"
            title={t('layoutView.kdpWizardTooltip')}
            data-tour="layout__1"
          >
            <Zap className="w-4 h-4" />
            <span>{t('layoutView.kdpWizardBtn')}</span>
          </button>

          <div className="px-4 py-2.5 rounded-xl bg-slate-950/80 border border-cyan-500/40 flex items-center gap-3">
            <div className="text-right">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                {t('layoutView.estimatedVolumeLabel')}
              </span>
              <span className="text-base font-bold text-cyan-300 font-mono-code">
                {t('layoutView.pagesCountLabel', { n: String(estimatedPages) })}
              </span>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <div className="text-xs text-slate-400">
              {t('layoutView.gutterLabel')}<b>{(estimatedPages * 0.055).toFixed(1)} {t('layoutView.mmUnit')}</b>
            </div>
          </div>
        </div>
      </div>

      {/* Amazon KDP Smart Compliance Quick Bar */}
      <div className={`p-4 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs transition-all ${
        kdpReport.overallScore >= 90
          ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
          : 'bg-amber-950/20 border-amber-500/40 text-amber-200'
      }`}>
        <div className="flex items-center gap-3">
          {kdpReport.overallScore >= 90 ? (
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          ) : (
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
          )}
          <div>
            <div className="font-bold flex items-center gap-2">
              <span>{t('layoutView.complianceLabel', { n: String(kdpReport.overallScore) })}</span>
              <span className="text-[10px] font-mono opacity-80">
                {t('layoutView.formatGutterInfo', { w: String(layout.pageWidthMm), h: String(layout.pageHeightMm), g: String(layout.margins.insideMm) })}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5">
              {isGutterCompliant ? (
                <span>{t('layoutView.compliantMsg', { n: String(layout.margins.insideMm), pages: String(estimatedPages) })}</span>
              ) : (
                <span className="text-amber-300 font-semibold">
                  {t('layoutView.nonCompliantMsg', { pages: String(estimatedPages), min: String(gutterSpec.minMm), cur: String(layout.margins.insideMm) })}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleQuickKdpOptimize}
            className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-all active:scale-95 flex items-center gap-1.5 shadow-sm"
            data-tour="layout__2"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{t('layoutView.oneClickOptimizeBtn')}</span>
          </button>
          <button
            onClick={() => setShowKdpModal(true)}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs transition-colors"
          >
            {t('layoutView.detailedAuditBtn', { n: String(kdpReport.issues.length) })}
          </button>
        </div>
      </div>

      {/* Main Grid: Left Controls (7 cols), Right Visual Page Sheet (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Config Controls (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Formats Selection */}
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4" data-tour="layout__3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <LayoutTemplate className="w-3.5 h-3.5" />
                {t('layoutView.section1Heading')}
              </h3>
              <span className="text-[11px] text-amber-300/80 font-mono">
                {t('layoutView.recommendedNote')}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {formatPresets.map((preset) => {
                const isSel = layout.formatPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`p-3.5 rounded-xl border text-left transition-all relative ${
                      isSel
                        ? 'bg-cyan-500/20 border-cyan-500 text-white shadow-md'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold">{preset.label}</span>
                        {preset.kdpTag && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            {preset.kdpTag}
                          </span>
                        )}
                      </div>
                      {isSel && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-tight">
                      {preset.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Margins & Gutter (Поля та корінець) */}
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4" data-tour="layout__4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" />
                {t('layoutView.section2Heading')}
              </h3>
              <div className="text-[11px] text-slate-400">
                {t('layoutView.amazonNormLabel', { n: String(estimatedPages) })}<b className="text-cyan-300">{t('layoutView.amazonNormValue', { min: String(gutterSpec.minMm) })}</b>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">{t('layoutView.topLabel')}</label>
                <input
                  type="number"
                  min={10}
                  max={50}
                  value={layout.margins.topMm}
                  onChange={(e) =>
                    handleUpdateLayout({
                      margins: { ...layout.margins, topMm: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{t('layoutView.bottomLabel')}</label>
                <input
                  type="number"
                  min={10}
                  max={50}
                  value={layout.margins.bottomMm}
                  onChange={(e) =>
                    handleUpdateLayout({
                      margins: { ...layout.margins, bottomMm: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400">{t('layoutView.insideLabel')}</label>
                </div>
                <input
                  type="number"
                  min={10}
                  max={60}
                  value={layout.margins.insideMm}
                  onChange={(e) =>
                    handleUpdateLayout({
                      margins: { ...layout.margins, insideMm: Number(e.target.value) },
                    })
                  }
                  className={`w-full p-2 rounded-lg bg-slate-900 border font-mono font-bold ${
                    isGutterCompliant
                      ? 'border-cyan-500/50 text-cyan-300'
                      : 'border-rose-500 text-rose-300 ring-1 ring-rose-500/50'
                  }`}
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{t('layoutView.outsideLabel')}</label>
                <input
                  type="number"
                  min={10}
                  max={50}
                  value={layout.margins.outsideMm}
                  onChange={(e) =>
                    handleUpdateLayout({
                      margins: { ...layout.margins, outsideMm: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono"
                />
              </div>
            </div>

            {/* Bleed & Mirrored Margins Switches */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-200 block">{t('layoutView.bleedLabel')}</span>
                  <span className="text-[11px] text-slate-400">{t('layoutView.bleedDesc')}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={layout.margins.bleedMm || 0}
                  onChange={(e) =>
                    handleUpdateLayout({
                      margins: { ...layout.margins, bleedMm: Number(e.target.value) },
                    })
                  }
                  className="w-20 p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-amber-300 font-mono text-center"
                />
              </div>

              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-200 block">{t('layoutView.mirroredLabel')}</span>
                  <span className="text-[11px] text-slate-400">{t('layoutView.mirroredDesc')}</span>
                </div>
                <input
                  type="checkbox"
                  checked={layout.margins.mirrored !== false}
                  onChange={(e) =>
                    handleUpdateLayout({
                      margins: { ...layout.margins, mirrored: e.target.checked },
                    })
                  }
                  className="w-4 h-4 rounded text-cyan-500 focus:ring-0"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 text-xs text-slate-400">
              <Info className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>
                {t('layoutView.kdpMirrorNote')}
              </span>
            </div>
          </div>

          {/* Typography Controls */}
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4" data-tour="layout__5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5" />
              {t('layoutView.section3Heading')}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">{t('layoutView.bodyFontLabel')}</label>
                <select
                  value={layout.typography.bodyFont}
                  onChange={(e) =>
                    handleUpdateLayout({
                      typography: { ...layout.typography, bodyFont: e.target.value },
                    })
                  }
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                >
                  <option value="Literata">{t('layoutView.fontLiterataOpt')}</option>
                  <option value="Cormorant Garamond">{t('layoutView.fontCormorantOpt')}</option>
                  <option value="Outfit">{t('layoutView.fontOutfitOpt')}</option>
                  <option value="Plus Jakarta Sans">{t('layoutView.fontPlusJakartaOpt')}</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{t('layoutView.fontSizeLabel')}</label>
                <select
                  value={layout.typography.fontSizePt}
                  onChange={(e) =>
                    handleUpdateLayout({
                      typography: { ...layout.typography, fontSizePt: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                >
                  <option value={9.5}>{t('layoutView.fontSize95Opt')}</option>
                  <option value={10}>{t('layoutView.fontSize10Opt')}</option>
                  <option value={10.5}>{t('layoutView.fontSize105Opt')}</option>
                  <option value={11}>{t('layoutView.fontSize11Opt')}</option>
                  <option value={12}>{t('layoutView.fontSize12Opt')}</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{t('layoutView.lineHeightLabel')}</label>
                <select
                  value={layout.typography.lineHeight}
                  onChange={(e) =>
                    handleUpdateLayout({
                      typography: { ...layout.typography, lineHeight: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                >
                  <option value={1.3}>{t('layoutView.lineHeight13Opt')}</option>
                  <option value={1.45}>{t('layoutView.lineHeight145Opt')}</option>
                  <option value={1.6}>{t('layoutView.lineHeight16Opt')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2">
              <div>
                <label className="text-slate-400 block mb-1">{t('layoutView.indentLabel')}</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={layout.typography.firstLineIndentMm}
                  onChange={(e) =>
                    handleUpdateLayout({
                      typography: { ...layout.typography, firstLineIndentMm: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{t('layoutView.textAlignLabel')}</label>
                <select
                  value={layout.typography.textAlign}
                  onChange={(e) =>
                    handleUpdateLayout({
                      typography: { ...layout.typography, textAlign: e.target.value as any },
                    })
                  }
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                >
                  <option value="justify">{t('layoutView.textAlignJustifyOpt')}</option>
                  <option value="left">{t('layoutView.textAlignLeftOpt')}</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{t('layoutView.headingsFontLabel')}</label>
                <select
                  value={layout.typography.headingsFont}
                  onChange={(e) =>
                    handleUpdateLayout({
                      typography: { ...layout.typography, headingsFont: e.target.value },
                    })
                  }
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                >
                  <option value="Outfit">{t('layoutView.fontOutfitOpt')}</option>
                  <option value="Literata">{t('layoutView.fontLiterataOpt')}</option>
                  <option value="Cormorant Garamond">{t('layoutView.fontCormorantOpt')}</option>
                  <option value="Plus Jakarta Sans">{t('layoutView.fontPlusJakartaOpt')}</option>
                  <option value="Fraunces">Fraunces (Editorial display serif)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Design Theme (Classic / Editorial) */}
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              {t('layoutView.designThemeSectionHeading')}
            </h3>
            <p className="text-xs text-slate-400">{t('layoutView.designThemeSectionDesc')}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { id: 'classic' as const, label: t('layoutView.designThemeClassicLabel'), desc: t('layoutView.designThemeClassicDesc') },
                { id: 'editorial' as const, label: t('layoutView.designThemeEditorialLabel'), desc: t('layoutView.designThemeEditorialDesc') },
              ]).map((theme) => {
                const isSel = (layout.designTheme || 'classic') === theme.id;
                return (
                  <div
                    key={theme.id}
                    onClick={() => handleUpdateLayout({ designTheme: theme.id })}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                      isSel
                        ? 'bg-rose-500/10 border-rose-500/80 shadow-lg ring-1 ring-rose-500/50'
                        : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-white text-xs">{theme.label}</span>
                      {isSel && <Check className="w-4 h-4 text-rose-400" />}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{theme.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Front Matter Controls */}
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              {t('layoutView.section4Heading')}
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layout.frontMatter.showTitlePage}
                  onChange={(e) =>
                    handleUpdateLayout({
                      frontMatter: { ...layout.frontMatter, showTitlePage: e.target.checked },
                    })
                  }
                  className="rounded text-cyan-500"
                />
                <span>{t('layoutView.titlePageLabel')}</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layout.frontMatter.showCopyright}
                  onChange={(e) =>
                    handleUpdateLayout({
                      frontMatter: { ...layout.frontMatter, showCopyright: e.target.checked },
                    })
                  }
                  className="rounded text-cyan-500"
                />
                <span>{t('layoutView.copyrightLabel')}</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layout.frontMatter.showDedication}
                  onChange={(e) =>
                    handleUpdateLayout({
                      frontMatter: { ...layout.frontMatter, showDedication: e.target.checked },
                    })
                  }
                  className="rounded text-cyan-500"
                />
                <span>{t('layoutView.dedicationLabel')}</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layout.frontMatter.showTableOfContents}
                  onChange={(e) =>
                    handleUpdateLayout({
                      frontMatter: { ...layout.frontMatter, showTableOfContents: e.target.checked },
                    })
                  }
                  className="rounded text-cyan-500"
                />
                <span>{t('layoutView.tocLabel')}</span>
              </label>
            </div>
          </div>

        </div>

        {/* Right Column: Visual Print Simulation Sheet (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="sticky top-20 p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4 flex flex-col items-center">
            <div className="flex items-center justify-between w-full">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                {t('layoutView.previewHeading', { preset: layout.formatPreset })}
              </h3>
              <span className="text-[10px] font-mono text-cyan-400">
                {layout.pageWidthMm} × {layout.pageHeightMm} {t('layoutView.mmUnit')}
              </span>
            </div>

            {/* Simulated Paper Sheet */}
            <div className="relative w-64 h-96 bg-white text-slate-900 rounded shadow-2xl p-4 flex flex-col justify-between overflow-hidden border border-slate-300">
              
              {/* Margins box guide overlay */}
              <div
                className="absolute border border-dashed border-cyan-500/60 pointer-events-none"
                style={{
                  top: `${(layout.margins.topMm / layout.pageHeightMm) * 100}%`,
                  bottom: `${(layout.margins.bottomMm / layout.pageHeightMm) * 100}%`,
                  left: `${(layout.margins.insideMm / layout.pageWidthMm) * 100}%`,
                  right: `${(layout.margins.outsideMm / layout.pageWidthMm) * 100}%`,
                }}
              >
                <div className="absolute top-0.5 right-0.5 text-[7px] text-cyan-600 font-mono">
                  {t('layoutView.liveAreaLabel')}
                </div>
              </div>

              {/* Header Kolontytul */}
              <div className="text-center border-b border-slate-200 pb-1 text-[8px] text-slate-400 uppercase tracking-wider font-mono">
                {book.title}
              </div>

              {/* Sample Body Text rendered in selected font & size */}
              <div
                className="flex-1 overflow-hidden py-2"
                style={{
                  fontFamily: layout.typography.bodyFont === 'Literata' ? 'Literata, serif' : 'sans-serif',
                  fontSize: `${layout.typography.fontSizePt * 0.75}px`,
                  lineHeight: layout.typography.lineHeight,
                  textAlign: layout.typography.textAlign,
                }}
              >
                <h4 className="text-[10px] font-bold text-center mb-1">{t('layoutView.sampleChapterHeading')}</h4>
                <p style={{ textIndent: `${layout.typography.firstLineIndentMm * 1.5}px` }}>
                  {t('layoutView.sampleParagraph1')}
                </p>
                <p style={{ textIndent: `${layout.typography.firstLineIndentMm * 1.5}px` }}>
                  {t('layoutView.sampleParagraph2')}
                </p>
              </div>

              {/* Footer Kolontytul / Page Number */}
              <div className="text-center border-t border-slate-200 pt-1 text-[8px] text-slate-500 font-mono">
                — 15 —
              </div>
            </div>

            <div className="space-y-1 text-center">
              <p className="text-[11px] text-slate-400">
                {t('layoutView.captionText', { n: String(layout.margins.insideMm) })}
              </p>
              <div className="text-[10px] text-amber-300 font-mono">
                {t('layoutView.kdpStatusLabel')}{isGutterCompliant ? t('layoutView.kdpStatusOk') : t('layoutView.kdpStatusWarn', { n: String(gutterSpec.minMm) })}
              </div>
            </div>

            <button
              onClick={() => setShowKdpModal(true)}
              className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-300 font-bold text-xs transition-colors flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{t('layoutView.checkInKdpInspectorBtn')}</span>
            </button>
          </div>
        </div>

      </div>

      {/* KDP Publishing & Compliance Modal */}
      {showKdpModal && (
        <KdpPublishingModal
          isOpen={showKdpModal}
          onClose={() => setShowKdpModal(false)}
          book={book}
          onUpdateBook={onUpdateBook}
          totalWords={totalWords}
        />
      )}

    </div>
  );
};
