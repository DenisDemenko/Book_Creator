import React from 'react';
import type { Book } from '../../types';
import { assetUrl } from '../../utils/assetUrl';
import type { CoverConfigWithPhysical } from './CoverPhysicalSpec';

interface CoverPhysicalPreviewProps {
  book: Book;
  cover: CoverConfigWithPhysical;
  spineWidthMm: number;
}

function artworkStyle(url: string | undefined): React.CSSProperties {
  const resolved = assetUrl(url);
  return resolved
    ? {
        backgroundImage: `url("${resolved.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : {};
}

/**
 * Physical print preview. Unlike the legacy decorative 3D mockup this uses
 * the real trim ratio and is always opaque: missing artwork means white paper,
 * never a transparent/dark placeholder.
 */
export const CoverPhysicalPreview: React.FC<CoverPhysicalPreviewProps> = ({
  book,
  cover,
  spineWidthMm,
}) => {
  const { pageWidthMm, pageHeightMm, margins } = book.layoutConfig;
  const bleedMm = margins.bleedMm || 0;
  const spreadWidthMm = pageWidthMm * 2 + spineWidthMm + bleedMm * 2;
  const spreadHeightMm = pageHeightMm + bleedMm * 2;
  const backArt = cover.backArtUrl;
  const frontArt = cover.frontArtUrl || cover.coverImageUrl;
  const spineArt = cover.spineArtUrl;
  const wrapArt = cover.useWrapArtwork ? cover.wrapArtUrl : undefined;
  const spinePercent = Math.max(0.8, (spineWidthMm / Math.max(spreadWidthMm, 1)) * 100);
  const pagePercent = (pageWidthMm / Math.max(spreadWidthMm, 1)) * 100;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4 lg:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
            Фізичний preview обкладинки
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            BACK + SPINE + FRONT · реальні пропорції друку
          </p>
        </div>
        <div className="text-right font-mono text-[10px] text-slate-400">
          <div>{pageWidthMm} × {pageHeightMm} мм · корінець {spineWidthMm} мм</div>
          <div>{spreadWidthMm.toFixed(1)} × {spreadHeightMm.toFixed(1)} мм з bleed</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-slate-900 p-3">
        <div
          className="relative mx-auto overflow-hidden border border-slate-300 bg-white shadow-2xl"
          style={{
            width: 'min(100%, 860px)',
            aspectRatio: `${Math.max(spreadWidthMm, 1)} / ${Math.max(spreadHeightMm, 1)}`,
            minHeight: 180,
            ...artworkStyle(wrapArt),
          }}
          aria-label="Повна розгортка обкладинки"
        >
          <div className="absolute inset-0 flex bg-white" style={wrapArt ? { background: 'transparent' } : undefined}>
            <div
              className="relative h-full overflow-hidden border-r border-dashed border-slate-300 bg-white"
              style={{ width: `${pagePercent}%`, ...(!wrapArt ? artworkStyle(backArt) : {}) }}
            >
              {!wrapArt && !backArt && <div className="absolute inset-0 bg-white" />}
              <div className="absolute inset-x-0 top-2 text-center text-[9px] font-bold tracking-widest text-slate-500/70">BACK</div>
              <div className="absolute inset-x-[8%] bottom-[10%] rounded bg-white/80 p-2 text-[clamp(7px,1vw,11px)] leading-snug text-slate-800 backdrop-blur-[1px]">
                {cover.backDescription || 'Задня обкладинка'}
              </div>
            </div>

            <div
              className="relative h-full shrink-0 overflow-hidden border-r border-dashed border-slate-300 bg-white"
              style={{ width: `${spinePercent}%`, ...(!wrapArt ? artworkStyle(spineArt) : {}) }}
            >
              {!wrapArt && !spineArt && <div className="absolute inset-0 bg-white" />}
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                <span
                  className="whitespace-nowrap text-[clamp(7px,0.8vw,10px)] font-bold text-slate-800"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                >
                  {cover.frontTitle || book.title}
                </span>
              </div>
            </div>

            <div
              className="relative h-full flex-1 overflow-hidden bg-white"
              style={!wrapArt ? artworkStyle(frontArt) : undefined}
            >
              {!wrapArt && !frontArt && <div className="absolute inset-0 bg-white" />}
              <div className="absolute inset-x-0 top-2 text-center text-[9px] font-bold tracking-widest text-slate-500/70">FRONT</div>
              <div className="absolute inset-x-[8%] top-[12%] text-center drop-shadow-sm">
                <div className="rounded bg-white/80 px-2 py-1 text-[clamp(12px,2.5vw,26px)] font-black leading-tight text-slate-950 backdrop-blur-[1px]">
                  {cover.frontTitle || book.title}
                </div>
                {cover.subtitle && (
                  <div className="mx-auto mt-2 inline-block rounded bg-white/75 px-2 py-1 text-[clamp(8px,1.2vw,13px)] font-semibold text-slate-800">
                    {cover.subtitle}
                  </div>
                )}
              </div>
              <div className="absolute inset-x-[8%] bottom-[8%] text-center text-[clamp(8px,1.2vw,13px)] font-bold text-slate-900">
                <span className="rounded bg-white/80 px-2 py-1">{cover.authorName || book.author}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <span>Матеріал: {cover.coverMaterial ?? 'coated-paper'}</span>
        <span>Ламінація: {cover.lamination ?? 'none'}</span>
        <span className="text-emerald-400/80">Без дизайну фон завжди білий та непрозорий.</span>
      </div>
    </section>
  );
};
