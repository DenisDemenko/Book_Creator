import { assetUrl, assetCssUrl } from '../utils/assetUrl';
import React from 'react';
import type { DesignerBackground, DesignerBackgroundPosition } from '../data/customBookDesignTheme';

interface Props {
  background: DesignerBackground;
  paperColor?: string;
  className?: string;
}

function clamp01(value: unknown, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function imageUrl(background: DesignerBackground): string {
  return background.mediaAsset?.url || background.imageUrl || '';
}

function position(value: DesignerBackgroundPosition | undefined): string {
  switch (value) {
    case 'top': return 'center top';
    case 'bottom': return 'center bottom';
    case 'left': return 'left center';
    case 'right': return 'right center';
    case 'top-left': return 'left top';
    case 'top-right': return 'right top';
    case 'bottom-left': return 'left bottom';
    case 'bottom-right': return 'right bottom';
    default: return 'center center';
  }
}

function sourceStyle(background: DesignerBackground): React.CSSProperties {
  if (background.kind === 'gradient' && background.gradient) return { background: background.gradient };
  if (background.kind === 'image') {
    const url = imageUrl(background);
    if (!url) return {};
    return {
      backgroundImage: assetCssUrl(assetUrl(url)),
      backgroundPosition: position(background.position),
      backgroundRepeat: background.fit === 'tile' ? 'repeat' : 'no-repeat',
      backgroundSize: background.fit === 'contain' ? 'contain' : background.fit === 'stretch' ? '100% 100%' : background.fit === 'tile' ? 'auto' : 'cover',
    };
  }
  if (background.kind === 'color') return { background: background.color || '#ffffff' };
  return {};
}

function effectsStyle(background: DesignerBackground): React.CSSProperties {
  const effects = background.effects;
  if (!effects) return {};
  const blur = Math.max(0, Math.min(24, Number(effects.blurPx) || 0));
  const brightness = Math.max(0.2, Math.min(2, Number(effects.brightness) || 1));
  const contrast = Math.max(0.2, Math.min(2, Number(effects.contrast) || 1));
  const grayscale = clamp01(effects.grayscale, 0);
  return {
    filter: `blur(${blur}px) brightness(${brightness}) contrast(${contrast}) grayscale(${grayscale})`,
    transform: blur ? 'scale(1.04)' : undefined,
  };
}

function overlayStyle(background: DesignerBackground): React.CSSProperties {
  const overlay = background.overlay;
  if (!overlay?.enabled) return {};
  return {
    background: overlay.kind === 'gradient'
      ? overlay.gradient || 'linear-gradient(180deg, transparent, rgba(0,0,0,.2))'
      : overlay.color || '#ffffff',
    opacity: clamp01(overlay.opacity, 0.25),
  };
}

function fadeTarget(background: DesignerBackground, paperColor: string): string {
  const fade = background.fade;
  if (!fade) return paperColor;
  if (fade.target === 'transparent') return 'rgba(255,255,255,0)';
  if (fade.target === 'color') return fade.targetColor || paperColor;
  if (fade.target === 'white') return '#ffffff';
  return paperColor;
}

function fadeStyle(background: DesignerBackground, paperColor: string): React.CSSProperties {
  const fade = background.fade;
  if (!fade?.enabled) return {};
  const start = Math.max(0, Math.min(100, Number(fade.startPercent) || 0));
  const end = Math.max(start, Math.min(100, Number(fade.endPercent) || 100));
  const target = fadeTarget(background, paperColor);
  const strength = clamp01(fade.strength, 1);
  const transparent = `rgba(255,255,255,${Math.max(0, 1 - strength)})`;

  switch (fade.direction) {
    case 'bottom-to-top': return { background: `linear-gradient(to top, ${target} ${100 - end}%, ${transparent} ${100 - start}%)` };
    case 'left-to-right': return { background: `linear-gradient(to right, ${transparent} ${start}%, ${target} ${end}%)` };
    case 'right-to-left': return { background: `linear-gradient(to left, ${transparent} ${start}%, ${target} ${end}%)` };
    case 'radial-center': return { background: `radial-gradient(circle at center, ${transparent} ${start}%, ${target} ${end}%)` };
    case 'radial-top': return { background: `radial-gradient(circle at top, ${transparent} ${start}%, ${target} ${end}%)` };
    case 'radial-bottom': return { background: `radial-gradient(circle at bottom, ${transparent} ${start}%, ${target} ${end}%)` };
    default: return { background: `linear-gradient(to bottom, ${transparent} ${start}%, ${target} ${end}%)` };
  }
}

/**
 * Background-only layers. Foreground text must be rendered as a sibling above
 * this component so opacity, filters and fades never make the manuscript text
 * transparent.
 */
export const BookDesignBackgroundLayers: React.FC<Props> = ({ background, paperColor = '#fffdf8', className = '' }) => (
  <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
    <div className="absolute inset-0" style={{ background: paperColor }} />
    <div className="absolute inset-0" style={{ ...sourceStyle(background), ...effectsStyle(background), opacity: clamp01(background.opacity, 1) }} />
    <div className="absolute inset-0" style={overlayStyle(background)} />
    <div className="absolute inset-0" style={fadeStyle(background, paperColor)} />
  </div>
);
