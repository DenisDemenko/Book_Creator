import { AiWorkflowHint } from './roleStudio/AiWorkflowHint';
import React, { useEffect, useMemo, useState } from 'react';
import { Barcode, BookOpen, Image as ImageIcon, Sliders, Sparkles } from 'lucide-react';
import { Book, CoverConfig } from '../types';
import { estimatePageCount } from '../utils/helpers';
import { useLanguage } from '../i18n/LanguageContext';
import {
  calculateCoverGeometry,
  coverSurfaceBackground,
  coverSurfaceTextColor,
  type CoverFinish,
  type CoverMaterial,
  type CoverPaperStock,
} from '../utils/coverProduction';

export type CoverEngine = 'nano-banana-2-lite' | 'nano-banana-2' | 'nano-banana-pro' | 'seedream';

interface CoverDesignerViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book) => void;
  totalWords: number;
}

const PAPER_OPTIONS: Array<{ id: CoverPaperStock; label: string }> = [
  { id: 'white', label: 'Білий папір' },
  { id: 'cream', label: 'Кремовий папір' },
  { id: 'coated-matte', label: 'Крейдований матовий' },
  { id: 'coated-gloss', label: 'Крейдований глянцевий' },
];

const MATERIAL_OPTIONS: Array<{ id: CoverMaterial; label: string }> = [
  { id: 'matte-card', label: 'Картон · матовий' },
  { id: 'gloss-card', label: 'Картон · глянцевий' },
  { id: 'soft-touch-card', label: 'Картон · Soft Touch' },
  { id: 'cloth', label: 'Тканина' },
  { id: 'case-laminate', label: 'Case laminate' },
];

const FINISH_OPTIONS: Array<{ id: CoverFinish; label: string }> = [
  { id: 'none', label: 'Без покриття' },
  { id: 'matte', label: 'Матова ламінація' },
  { id: 'gloss', label: 'Глянцева ламінація' },
  { id: 'soft-touch', label: 'Soft Touch' },
];

export const CoverDesignerView: React.FC<CoverDesignerViewProps> = ({ book, onUpdateBook, totalWords }) => {
  const { t } = useLanguage();
  const cover = book.coverConfig;
  const layout = book.layoutConfig;

  const totalPages = estimatePageCount(
    totalWords,
    layout.formatPreset,
    layout.typography.fontSizePt,
    layout.typography.lineHeight,
  );

  const geometry = useMemo(
    () => calculateCoverGeometry({
      pageWidthMm: layout.pageWidthMm,
      pageHeightMm: layout.pageHeightMm,
      bleedMm: layout.margins.bleedMm,
      pageCount: totalPages,
      coverType: cover.coverType,
      paperStock: cover.paperStock,
    }),
    [layout.pageWidthMm, layout.pageHeightMm, layout.margins.bleedMm, totalPages, cover.coverType, cover.paperStock],
  );

  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [view3D, setView3D] = useState<'wrap' | 'front' | '3d'>('3d');
  const [selectedEngine, setSelectedEngine] = useState<CoverEngine>('nano-banana-2');

  const engineOptions: { id: CoverEngine; name: string; tag: string }[] = [
    { id: 'nano-banana-2-lite', name: t('coverDesignerView.engineLiteName'), tag: t('coverDesignerView.engineLiteTag') },
    { id: 'nano-banana-2', name: t('coverDesignerView.engineStandardName'), tag: t('coverDesignerView.engineStandardTag') },
    { id: 'nano-banana-pro', name: t('coverDesignerView.engineProName'), tag: t('coverDesignerView.engineProTag') },
    { id: 'seedream', name: t('coverDesignerView.engineSeedreamName'), tag: t('coverDesignerView.engineSeedreamTag') },
  ];

  const handleUpdateCover = (updated: Partial<CoverConfig>) => {
    onUpdateBook({
      ...book,
      coverConfig: {
        ...cover,
        ...updated,
      },
    });
  };

  useEffect(() => {
    if (Math.abs((cover.spineWidthMm || 0) - geometry.spineWidthMm) < 0.05) return;
    handleUpdateCover({ spineWidthMm: geometry.spineWidthMm });
    // Spine is derived from page count, binding and stock; syncing it keeps exports consistent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry.spineWidthMm]);

  const handleAiGenerateCover = async () => {
    setIsGeneratingAi(true);
    try {
      const res = await fetch('/api/ai/generate-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: book.title,
          genre: book.genre,
          synopsis: book.synopsis,
          author: book.author,
          visualBible: book.visualBible,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t('coverDesignerView.errConceptFailed'));

      if (data.frontTitle) {
        handleUpdateCover({
          subtitle: data.subtitle || cover.subtitle,
          tagline: data.tagline || cover.tagline,
          backDescription: data.backDescription || cover.backDescription,
          authorBio: data.authorBio || cover.authorBio,
          palette: data.palette || cover.palette,
          spineWidthMm: geometry.spineWidthMm,
        });
      }

      const artRes = await fetch('/api/ai/generate-cover-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visualPrompt: data.visualPrompt,
          title: book.title,
          genre: book.genre,
          visualBible: book.visualBible,
          aspectRatio: '3:4',
          model: selectedEngine,
        }),
      });
      const artData = await artRes.json();
      if (!artRes.ok) throw new Error(artData?.error || t('coverDesignerView.errArtFailed'));
      if (artData.imageUrl) handleUpdateCover({ frontArtUrl: artData.imageUrl, coverImageUrl: artData.imageUrl });
      setAiError(null);
    } catch (err: any) {
      console.error('Error generating cover:', err);
      setAiError(err?.message || t('coverDesignerView.errGenericFailed'));
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const frontHasArt = Boolean(cover.frontArtUrl?.trim());
  const backHasArt = Boolean(cover.backArtUrl?.trim());
  const frontBg = coverSurfaceBackground(cover.frontArtUrl);
  const frontText = coverSurfaceTextColor(cover.frontArtUrl);
  const backBg = coverSurfaceBackground(cover.backArtUrl);
  const backText = coverSurfaceTextColor(cover.backArtUrl);

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {t('coverDesignerView.headerBadge')}
            </span>
            <span className="text-xs text-slate-400">
              {layout.pageWidthMm} × {layout.pageHeightMm} мм · корінець <b>{geometry.spineWidthMm} мм</b>
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">{t('coverDesignerView.headerTitle')}</h1>
          <AiWorkflowHint projectId={book.id} task="cover" className="mt-1" />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {(['3d', 'wrap', 'front'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView3D(mode)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                view3D === mode ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {mode === '3d' ? '3D' : mode === 'wrap' ? 'Розгортка' : 'Передня'}
            </button>
          ))}
          <button
            onClick={handleAiGenerateCover}
            disabled={isGeneratingAi}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 text-xs font-bold text-white shadow-lg disabled:opacity-60"
            data-tour="cover__1"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isGeneratingAi ? t('coverDesignerView.aiGeneratingBtn') : t('coverDesignerView.aiGenerateBtn')}</span>
          </button>
        </div>
      </div>

      {aiError && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2" role="alert">
          <span className="font-bold shrink-0">{t('coverDesignerView.errorPrefix')}</span>
          <span className="flex-1">{aiError}</span>
          <button onClick={() => setAiError(null)} className="px-2 rounded hover:bg-white/10 shrink-0" aria-label={t('coverDesignerView.hideAriaLabel')}>✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-4">
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5" />
              {t('coverDesignerView.configHeading')}
            </h3>

            <div data-tour="cover__3">
              <label className="text-xs text-slate-400 block mb-1">{t('coverDesignerView.engineLabel')}</label>
              <div className="grid grid-cols-2 gap-2">
                {engineOptions.map((eng) => {
                  const isSelected = eng.id === selectedEngine;
                  return (
                    <button
                      key={eng.id}
                      type="button"
                      onClick={() => setSelectedEngine(eng.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        isSelected ? 'bg-cyan-500/10 border-cyan-500 text-white shadow-sm' : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-[11px] font-bold truncate">{eng.name}</div>
                      <div className={`text-[9px] mt-0.5 ${isSelected ? 'text-cyan-300' : 'text-slate-500'}`}>{eng.tag}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div data-tour="cover__4">
              <label className="text-xs text-slate-400 block mb-1">{t('coverDesignerView.coverTypeLabel')}</label>
              <div className="grid grid-cols-3 gap-2">
                {(['paperback', 'hardcover', 'ebook'] as const).map((ct) => (
                  <button
                    key={ct}
                    type="button"
                    onClick={() => handleUpdateCover({ coverType: ct })}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all ${
                      cover.coverType === ct ? 'bg-cyan-500/20 border-cyan-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    {ct === 'paperback' ? t('coverDesignerView.paperbackOpt') : ct === 'hardcover' ? t('coverDesignerView.hardcoverOpt') : t('coverDesignerView.ebookOpt')}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                <BookOpen className="w-3.5 h-3.5 text-cyan-400" /> Фізичний розмір книги
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg bg-slate-950 p-2"><span className="text-slate-500 block">Сторінка</span><b>{geometry.pageWidthMm} × {geometry.pageHeightMm} мм</b></div>
                <div className="rounded-lg bg-slate-950 p-2"><span className="text-slate-500 block">Корінець</span><b>{geometry.spineWidthMm} мм</b></div>
                <div className="rounded-lg bg-slate-950 p-2"><span className="text-slate-500 block">Bleed</span><b>{geometry.bleedMm} мм</b></div>
                <div className="rounded-lg bg-slate-950 p-2"><span className="text-slate-500 block">Повна розгортка</span><b>{geometry.fullWrapWidthMm} × {geometry.fullWrapHeightMm} мм</b></div>
              </div>
              <p className="text-[10px] text-slate-500">Розмір береться з «Верстка & Поля», тому обкладинка й внутрішній блок не можуть розійтися.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="text-[11px] text-slate-400">
                Папір
                <select
                  value={cover.paperStock ?? 'white'}
                  onChange={(e) => handleUpdateCover({ paperStock: e.target.value as CoverPaperStock })}
                  className="mt-1 w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                >
                  {PAPER_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-slate-400">
                Матеріал
                <select
                  value={cover.coverMaterial ?? 'matte-card'}
                  onChange={(e) => handleUpdateCover({ coverMaterial: e.target.value as CoverMaterial })}
                  className="mt-1 w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                >
                  {MATERIAL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-slate-400">
                Покриття
                <select
                  value={cover.finish ?? 'matte'}
                  onChange={(e) => handleUpdateCover({ finish: e.target.value as CoverFinish })}
                  className="mt-1 w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                >
                  {FINISH_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-800">
              <span className="text-xs font-bold text-slate-300 block">{t('coverDesignerView.frontCoverLabel')}</span>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.subtitleLabel')}</label>
                <input type="text" value={cover.subtitle} onChange={(e) => handleUpdateCover({ subtitle: e.target.value })} className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200" />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.taglineLabel')}</label>
                <input type="text" value={cover.tagline ?? ''} onChange={(e) => handleUpdateCover({ tagline: e.target.value })} className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200" />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">Зображення передньої обкладинки</label>
                <div className="relative">
                  <ImageIcon className="absolute left-2 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input type="text" value={cover.frontArtUrl ?? ''} onChange={(e) => handleUpdateCover({ frontArtUrl: e.target.value })} placeholder="URL або /generated/..." className="w-full pl-8 pr-2 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 font-mono" />
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-800">
              <span className="text-xs font-bold text-slate-300 block">{t('coverDesignerView.backCoverLabel')}</span>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">Зображення задньої обкладинки</label>
                <div className="relative">
                  <ImageIcon className="absolute left-2 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input type="text" value={cover.backArtUrl ?? ''} onChange={(e) => handleUpdateCover({ backArtUrl: e.target.value })} placeholder="URL або /generated/..." className="w-full pl-8 pr-2 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 font-mono" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.blurbLabel')}</label>
                <textarea rows={3} value={cover.backDescription} onChange={(e) => handleUpdateCover({ backDescription: e.target.value })} className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200" />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.authorBioLabel')}</label>
                <input type="text" value={cover.authorBio ?? ''} onChange={(e) => handleUpdateCover({ authorBio: e.target.value })} className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200" />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.isbnLabel')}</label>
                <input type="text" value={cover.barcode} onChange={(e) => handleUpdateCover({ barcode: e.target.value })} className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 font-mono" />
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 space-y-4">
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col items-center justify-center min-h-[500px]" data-tour="cover__5">
            {view3D === '3d' && (
              <div className="relative group perspective-1000 py-8">
                <div
                  className="w-72 h-[420px] rounded-r-2xl overflow-hidden shadow-[20px_20px_50px_rgba(0,0,0,0.8)] border-r-4 border-b-4 border-slate-300 flex flex-col justify-between p-6 relative"
                  style={{ backgroundColor: frontBg, color: frontText }}
                >
                  {frontHasArt && <img src={cover.frontArtUrl} alt="Front art" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />}
                  {frontHasArt && <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent pointer-events-none" />}
                  <div className="relative z-10 space-y-2">
                    <span className={`text-[10px] uppercase font-bold tracking-widest block ${frontHasArt ? 'text-cyan-300' : 'text-slate-700'}`}>{cover.tagline}</span>
                    <h3 className={`text-xs uppercase font-extrabold tracking-widest ${frontHasArt ? 'text-white/85' : 'text-slate-700'}`}>{book.author}</h3>
                  </div>
                  <div className="relative z-10 space-y-2 pt-12">
                    <div className={`w-10 h-1 rounded-full mb-2 ${frontHasArt ? 'bg-cyan-300' : 'bg-slate-900'}`} />
                    <h2 className={`text-2xl font-black font-heading tracking-tight leading-none ${frontHasArt ? 'text-white drop-shadow-md' : 'text-slate-950'}`}>{book.title}</h2>
                    <p className={frontHasArt ? 'text-xs text-white/80' : 'text-xs text-slate-600'}>{cover.subtitle}</p>
                  </div>
                  <div className="absolute left-0 inset-y-0 w-3 bg-gradient-to-r from-black/15 via-transparent to-black/10 pointer-events-none" />
                </div>
              </div>
            )}

            {view3D === 'front' && (
              <div
                className="relative w-80 aspect-[2/3] overflow-hidden border border-slate-300 shadow-2xl p-7 flex flex-col justify-between"
                style={{ backgroundColor: frontBg, color: frontText }}
              >
                {frontHasArt && <img src={cover.frontArtUrl} alt="Front" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />}
                {frontHasArt && <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/15" />}
                <div className="relative z-10 text-xs font-bold uppercase tracking-wider">{book.author}</div>
                <div className="relative z-10"><h2 className="text-3xl font-black leading-none">{book.title}</h2><p className="mt-2 text-sm opacity-80">{cover.subtitle}</p></div>
              </div>
            )}

            {view3D === 'wrap' && (
              <div className="w-full max-w-3xl border-2 border-slate-700 rounded-xl p-3 shadow-2xl flex relative bg-slate-900">
                <div
                  className="flex-1 p-4 flex flex-col justify-between border-r border-slate-300 text-[10px] space-y-3 relative overflow-hidden min-h-[300px]"
                  style={{ backgroundColor: backBg, color: backText }}
                >
                  {backHasArt && <img src={cover.backArtUrl} alt="Back" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />}
                  {backHasArt && <div className="absolute inset-0 bg-black/55" />}
                  <div className="relative z-10 space-y-2">
                    <span className={`font-bold uppercase tracking-wider block ${backHasArt ? 'text-cyan-300' : 'text-slate-800'}`}>{t('coverDesignerView.aboutNovelLabel')}</span>
                    <p className={backHasArt ? 'text-white/90 leading-relaxed' : 'text-slate-700 leading-relaxed'}>{cover.backDescription}</p>
                  </div>
                  <div className={`relative z-10 space-y-2 border-t pt-2 ${backHasArt ? 'border-white/30' : 'border-slate-300'}`}>
                    <p className={backHasArt ? 'text-white/75 italic' : 'text-slate-600 italic'}>{cover.authorBio}</p>
                    <div className="flex items-center justify-between pt-1"><span className="font-mono">{cover.barcode}</span><Barcode className="w-12 h-6" /></div>
                  </div>
                </div>

                <div
                  className="bg-white flex flex-col justify-between items-center py-4 px-2 border-r border-slate-300 text-[9px] font-mono text-slate-700 font-bold"
                  style={{ width: `${Math.max(36, geometry.spineWidthMm * 2.5)}px` }}
                >
                  <span className="truncate rotate-90 my-auto">{book.author}</span>
                  <span className="truncate rotate-90 my-auto">{book.title}</span>
                  <span className="truncate rotate-90 my-auto">NOVA</span>
                </div>

                <div
                  className="flex-1 p-4 flex flex-col justify-between relative overflow-hidden text-xs min-h-[300px]"
                  style={{ backgroundColor: frontBg, color: frontText }}
                >
                  {frontHasArt && <img src={cover.frontArtUrl} alt="Front" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />}
                  {frontHasArt && <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-black/15 pointer-events-none" />}
                  <div className="relative z-10"><span className="text-[9px] uppercase font-bold block">{book.author}</span></div>
                  <div className="relative z-10 space-y-1"><h3 className="text-base font-black">{book.title}</h3><p className="text-[10px] opacity-80">{cover.subtitle}</p></div>
                </div>
              </div>
            )}

            <div className="mt-4 text-center space-y-1">
              <p className="text-[11px] text-slate-400">{geometry.pageCount} стор. · {geometry.pageWidthMm} × {geometry.pageHeightMm} мм · корінець <b>{geometry.spineWidthMm} мм</b></p>
              <p className="text-[10px] text-cyan-300 font-mono">Розгортка з bleed: {geometry.fullWrapWidthMm} × {geometry.fullWrapHeightMm} мм</p>
              <p className="text-[10px] text-slate-500">{PAPER_OPTIONS.find((x) => x.id === (cover.paperStock ?? 'white'))?.label} · {MATERIAL_OPTIONS.find((x) => x.id === (cover.coverMaterial ?? 'matte-card'))?.label} · {FINISH_OPTIONS.find((x) => x.id === (cover.finish ?? 'matte'))?.label}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
