import React, { useState } from 'react';
import { 
  Sparkles, 
  Download, 
  Image as ImageIcon, 
  Layers, 
  Barcode, 
  Palette, 
  Type, 
  BookOpen, 
  Sliders, 
  RotateCw,
  Eye,
  Check
} from 'lucide-react';
import { Book, CoverConfig } from '../types';
import { estimatePageCount } from '../utils/helpers';
import { useLanguage } from '../i18n/LanguageContext';

export type CoverEngine = 'nano-banana-2-lite' | 'nano-banana-2' | 'nano-banana-pro' | 'seedream';

interface CoverDesignerViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book) => void;
  totalWords: number;
}

export const CoverDesignerView: React.FC<CoverDesignerViewProps> = ({
  book,
  onUpdateBook,
  totalWords,
}) => {
  const { t } = useLanguage();
  const cover = book.coverConfig;
  const layout = book.layoutConfig;

  const totalPages = estimatePageCount(
    totalWords,
    layout.formatPreset,
    layout.typography.fontSizePt,
    layout.typography.lineHeight
  );

  // Approximate spine width in mm (paper bulk ~ 0.055mm per page + 1mm cardboard for hardcover)
  const calculatedSpineMm = Number((totalPages * (cover.coverType === 'hardcover' ? 0.06 : 0.052) + (cover.coverType === 'hardcover' ? 2 : 0)).toFixed(1));

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
          spineWidthMm: calculatedSpineMm,
        });
      }

      // Другим кроком малюємо саме зображення за промптом із концепції.
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

      if (artData.imageUrl) {
        handleUpdateCover({ frontArtUrl: artData.imageUrl, coverImageUrl: artData.imageUrl });
      }
      setAiError(null);
    } catch (err: any) {
      console.error('Error generating cover:', err);
      setAiError(err?.message || t('coverDesignerView.errGenericFailed'));
    } finally {
      setIsGeneratingAi(false);
    }
  };

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">
      
      {/* Top Banner */}
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {t('coverDesignerView.headerBadge')}
            </span>
            <span className="text-xs text-slate-400">
              {t('coverDesignerView.headerSubBadgePrefix')}<b>{calculatedSpineMm} {t('coverDesignerView.mmUnit')}</b>
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">
            {t('coverDesignerView.headerTitle')}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setView3D('3d')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              view3D === '3d' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
            data-tour="cover__2"
          >
            {t('coverDesignerView.view3dBtn')}
          </button>
          <button
            onClick={() => setView3D('wrap')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              view3D === 'wrap' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {t('coverDesignerView.viewWrapBtn')}
          </button>
          <button
            onClick={handleAiGenerateCover}
            disabled={isGeneratingAi}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 text-xs font-bold text-white shadow-lg"
            data-tour="cover__1"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isGeneratingAi ? t('coverDesignerView.aiGeneratingBtn') : t('coverDesignerView.aiGenerateBtn')}</span>
          </button>
        </div>
      </div>

      {/* Помилка генерації — показуємо, а не ховаємо в консоль */}
      {aiError && (
        <div
          className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2"
          role="alert"
        >
          <span className="font-bold shrink-0">{t('coverDesignerView.errorPrefix')}</span>
          <span className="flex-1">{aiError}</span>
          <button
            onClick={() => setAiError(null)}
            className="px-2 rounded hover:bg-white/10 shrink-0"
            aria-label={t('coverDesignerView.hideAriaLabel')}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Studio: Controls Left (5 cols), Live Viewport Right (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Controls Column */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5" />
              {t('coverDesignerView.configHeading')}
            </h3>

            {/* AI Engine Selector */}
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
                        isSelected
                          ? 'bg-cyan-500/10 border-cyan-500 text-white shadow-sm'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-[11px] font-bold truncate">{eng.name}</div>
                      <div className={`text-[9px] mt-0.5 ${isSelected ? 'text-cyan-300' : 'text-slate-500'}`}>{eng.tag}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Type */}
            <div data-tour="cover__4">
              <label className="text-xs text-slate-400 block mb-1">{t('coverDesignerView.coverTypeLabel')}</label>
              <div className="grid grid-cols-3 gap-2">
                {(['paperback', 'hardcover', 'ebook'] as const).map((ct) => (
                  <button
                    key={ct}
                    onClick={() => handleUpdateCover({ coverType: ct })}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all ${
                      cover.coverType === ct
                        ? 'bg-cyan-500/20 border-cyan-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    {ct === 'paperback' ? t('coverDesignerView.paperbackOpt') : ct === 'hardcover' ? t('coverDesignerView.hardcoverOpt') : t('coverDesignerView.ebookOpt')}
                  </button>
                ))}
              </div>
            </div>

            {/* Front text fields */}
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <span className="text-xs font-bold text-slate-300 block">
                {t('coverDesignerView.frontCoverLabel')}
              </span>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.subtitleLabel')}</label>
                <input
                  type="text"
                  value={cover.subtitle}
                  onChange={(e) => handleUpdateCover({ subtitle: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.taglineLabel')}</label>
                <input
                  type="text"
                  value={cover.tagline}
                  onChange={(e) => handleUpdateCover({ tagline: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.artUrlLabel')}</label>
                <input
                  type="text"
                  value={cover.frontArtUrl}
                  onChange={(e) => handleUpdateCover({ frontArtUrl: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 font-mono"
                />
              </div>
            </div>

            {/* Back text fields */}
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <span className="text-xs font-bold text-slate-300 block">
                {t('coverDesignerView.backCoverLabel')}
              </span>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.blurbLabel')}</label>
                <textarea
                  rows={3}
                  value={cover.backDescription}
                  onChange={(e) => handleUpdateCover({ backDescription: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.authorBioLabel')}</label>
                <input
                  type="text"
                  value={cover.authorBio}
                  onChange={(e) => handleUpdateCover({ authorBio: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-0.5">{t('coverDesignerView.isbnLabel')}</label>
                <input
                  type="text"
                  value={cover.barcode}
                  onChange={(e) => handleUpdateCover({ barcode: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 font-mono"
                />
              </div>
            </div>

          </div>
        </div>

        {/* Live Preview Viewport */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col items-center justify-center min-h-[500px]" data-tour="cover__5">
            
            {/* 3D Mockup Mode */}
            {view3D === '3d' && (
              <div className="relative group perspective-1000 py-8">
                <div className="w-72 h-[420px] rounded-r-2xl overflow-hidden shadow-[20px_20px_50px_rgba(0,0,0,0.8)] border-r-4 border-b-4 border-slate-800 flex flex-col justify-between p-6 relative bg-gradient-to-b from-slate-900 via-slate-950 to-black text-white">
                  {/* Background Artwork */}
                  <img
                    src={cover.frontArtUrl}
                    alt="Front art"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover opacity-45 mix-blend-luminosity pointer-events-none"
                  />

                  {/* Gradient Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent pointer-events-none" />

                  {/* Top: Tagline & Author */}
                  <div className="relative z-10 space-y-2">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-cyan-400 block">
                      {cover.tagline}
                    </span>
                    <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-300">
                      {book.author}
                    </h3>
                  </div>

                  {/* Bottom: Title & Subtitle */}
                  <div className="relative z-10 space-y-2 pt-12">
                    <div className="w-10 h-1 bg-cyan-400 rounded-full mb-2" />
                    <h2 className="text-2xl font-black font-heading tracking-tight leading-none text-white drop-shadow-md">
                      {book.title}
                    </h2>
                    <p className="text-xs text-slate-300 font-mono tracking-wider">
                      {cover.subtitle}
                    </p>
                    <div className="pt-4 flex items-center justify-between text-[10px] text-slate-400 font-mono border-t border-white/20">
                      <span>NOVA GLASS EDITION</span>
                      <span>2084</span>
                    </div>
                  </div>

                  {/* Left Spine 3D simulation reflection line */}
                  <div className="absolute left-0 inset-y-0 w-3 bg-gradient-to-r from-white/30 via-transparent to-black/50 pointer-events-none" />
                </div>
              </div>
            )}

            {/* Complete Full Wrap Mode */}
            {view3D === 'wrap' && (
              <div className="w-full max-w-2xl bg-slate-900 border-2 border-slate-700 rounded-xl p-3 shadow-2xl flex text-white relative">
                
                {/* Back Cover (Left) */}
                <div className="flex-1 p-4 bg-slate-950 flex flex-col justify-between border-r border-slate-800 text-[10px] space-y-3">
                  <div className="space-y-2">
                    <span className="font-bold text-cyan-400 uppercase tracking-wider block">
                      {t('coverDesignerView.aboutNovelLabel')}
                    </span>
                    <p className="text-slate-300 leading-relaxed">
                      {cover.backDescription}
                    </p>
                  </div>

                  <div className="space-y-2 border-t border-slate-800 pt-2">
                    <p className="text-slate-400 italic">{cover.authorBio}</p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="font-mono text-slate-400">{cover.barcode}</span>
                      <Barcode className="w-12 h-6 text-slate-300" />
                    </div>
                  </div>
                </div>

                {/* Spine (Middle) */}
                <div
                  className="bg-slate-950 flex flex-col justify-between items-center py-4 px-2 border-r border-slate-800 text-[9px] font-mono text-slate-300 font-bold"
                  style={{ width: `${Math.max(36, calculatedSpineMm * 2.5)}px` }}
                >
                  <span className="truncate rotate-90 my-auto">{book.author}</span>
                  <span className="truncate rotate-90 my-auto text-cyan-300">{book.title}</span>
                  <span className="truncate rotate-90 my-auto">NOVA</span>
                </div>

                {/* Front Cover (Right) */}
                <div className="flex-1 p-4 bg-slate-950 flex flex-col justify-between relative overflow-hidden text-xs">
                  <img
                    src={cover.frontArtUrl}
                    alt="Front"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-luminosity pointer-events-none"
                  />
                  <div className="relative z-10">
                    <span className="text-[9px] uppercase font-bold text-cyan-400 block">
                      {book.author}
                    </span>
                  </div>
                  <div className="relative z-10 space-y-1">
                    <h3 className="text-base font-black text-white">{book.title}</h3>
                    <p className="text-[10px] text-slate-300">{cover.subtitle}</p>
                  </div>
                </div>

              </div>
            )}

            <p className="text-[11px] text-slate-500 mt-4 text-center">
              {t('coverDesignerView.spineNotePrefix')}{totalPages}{t('coverDesignerView.spineNoteMiddle')}<b>{calculatedSpineMm} {t('coverDesignerView.mmUnit')}</b>
            </p>
          </div>
        </div>

      </div>

    </div>
  );
};
