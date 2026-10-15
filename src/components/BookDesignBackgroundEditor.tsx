import { assetUrl, assetCssUrl } from '../utils/assetUrl';
import React, { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Loader2, RefreshCcw, Search, X } from 'lucide-react';
import type {
  DesignerBackground,
  DesignerBackgroundFadeDirection,
  DesignerBackgroundFit,
  DesignerBackgroundMediaAsset,
  DesignerBackgroundPosition,
} from '../data/customBookDesignTheme';

interface Props {
  bookId: string;
  background: DesignerBackground;
  paperColor?: string;
  onChange: (next: DesignerBackground) => void;
  compact?: boolean;
}

interface MediaAssetItem {
  id: string;
  bookId: string | null;
  filename: string;
  mimeType: string;
  url: string;
  title?: string;
  altText?: string;
  createdAt?: string;
}

const FITS: ReadonlyArray<{ value: DesignerBackgroundFit; label: string }> = [
  { value: 'cover', label: 'Заповнити' },
  { value: 'contain', label: 'Вмістити' },
  { value: 'stretch', label: 'Розтягнути' },
  { value: 'tile', label: 'Плитка' },
];

const POSITIONS: ReadonlyArray<{ value: DesignerBackgroundPosition; label: string }> = [
  { value: 'center', label: 'Центр' },
  { value: 'top', label: 'Верх' },
  { value: 'bottom', label: 'Низ' },
  { value: 'left', label: 'Ліворуч' },
  { value: 'right', label: 'Праворуч' },
  { value: 'top-left', label: 'Верх-ліворуч' },
  { value: 'top-right', label: 'Верх-праворуч' },
  { value: 'bottom-left', label: 'Низ-ліворуч' },
  { value: 'bottom-right', label: 'Низ-праворуч' },
];

const FADES: ReadonlyArray<{ value: DesignerBackgroundFadeDirection; label: string }> = [
  { value: 'top-to-bottom', label: 'Зверху вниз' },
  { value: 'bottom-to-top', label: 'Знизу вгору' },
  { value: 'left-to-right', label: 'Зліва направо' },
  { value: 'right-to-left', label: 'Справа наліво' },
  { value: 'radial-center', label: 'Від центру' },
  { value: 'radial-top', label: 'Від верхнього центру' },
  { value: 'radial-bottom', label: 'Від нижнього центру' },
];

function inputClass(): string {
  return 'w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500';
}

function clamp01(value: unknown, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function backgroundImageUrl(background: DesignerBackground): string {
  return background.mediaAsset?.url || background.imageUrl || '';
}

function cssPosition(value: DesignerBackgroundPosition | undefined): string {
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
    const url = backgroundImageUrl(background);
    if (!url) return {};
    return {
      backgroundImage: assetCssUrl(assetUrl(url)),
      backgroundPosition: cssPosition(background.position),
      backgroundRepeat: background.fit === 'tile' ? 'repeat' : 'no-repeat',
      backgroundSize: background.fit === 'contain' ? 'contain' : background.fit === 'stretch' ? '100% 100%' : background.fit === 'tile' ? 'auto' : 'cover',
    };
  }
  if (background.kind === 'color') return { background: background.color || '#ffffff' };
  return {};
}

function fadeColor(background: DesignerBackground, paperColor: string): string {
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
  const target = fadeColor(background, paperColor);
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

function effectsStyle(background: DesignerBackground): React.CSSProperties {
  const effects = background.effects;
  if (!effects) return {};
  const blur = Math.max(0, Math.min(24, Number(effects.blurPx) || 0));
  const brightness = Math.max(0.2, Math.min(2, Number(effects.brightness) || 1));
  const contrast = Math.max(0.2, Math.min(2, Number(effects.contrast) || 1));
  const grayscale = clamp01(effects.grayscale, 0);
  return { filter: `blur(${blur}px) brightness(${brightness}) contrast(${contrast}) grayscale(${grayscale})`, transform: blur ? 'scale(1.04)' : undefined };
}

function Preview({ background, paperColor }: { background: DesignerBackground; paperColor: string }) {
  return (
    <div className="relative h-32 overflow-hidden rounded-xl border border-slate-700" style={{ background: paperColor }}>
      <div className="absolute inset-0" style={{ ...sourceStyle(background), ...effectsStyle(background), opacity: clamp01(background.opacity, 1) }} />
      <div className="absolute inset-0" style={overlayStyle(background)} />
      <div className="absolute inset-0" style={fadeStyle(background, paperColor)} />
      <div className="absolute inset-x-5 top-5 rounded-md bg-white/75 px-3 py-2 shadow-sm backdrop-blur-[1px]">
        <div className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-500">Preview</div>
        <div className="mt-1 text-[11px] leading-relaxed text-slate-800">Текст книги залишається окремим foreground-шаром і не втрачає прозорість разом із фоном.</div>
      </div>
    </div>
  );
}

function MediaLibraryPicker({ bookId, selectedId, onPick, onClose }: { bookId: string; selectedId?: string; onPick: (asset: DesignerBackgroundMediaAsset) => void; onClose: () => void }) {
  const [assets, setAssets] = useState<MediaAssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ latest: '1' });
    if (bookId) params.set('bookId', bookId);
    void fetch(`/api/media/list?${params.toString()}`, { credentials: 'same-origin' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error || `Не вдалося прочитати медіатеку (${res.status}).`);
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        const list = Array.isArray(body?.assets) ? body.assets as MediaAssetItem[] : [];
        setAssets(list.filter((asset) => String(asset.mimeType || '').startsWith('image/') && Boolean(asset.url)));
      })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookId, reloadKey]);

  const filtered = useMemo(() => {
    const wanted = query.trim().toLocaleLowerCase('uk-UA');
    if (!wanted) return assets;
    return assets.filter((asset) => [asset.title, asset.filename, asset.altText].some((value) => String(value || '').toLocaleLowerCase('uk-UA').includes(wanted)));
  }, [assets, query]);

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-slate-950 p-3 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <div><div className="text-xs font-bold text-white">Медіатека книги</div><div className="text-[10px] text-slate-500">Лише зображення, уже збережені на сервері.</div></div>
        <div className="flex gap-1"><button type="button" onClick={() => setReloadKey((v) => v + 1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800" title="Оновити"><RefreshCcw className="h-3.5 w-3.5" /></button><button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800" title="Закрити"><X className="h-3.5 w-3.5" /></button></div>
      </div>
      <label className="relative mt-3 block"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-600" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Пошук у медіатеці" className={`${inputClass()} pl-8`} /></label>
      {loading && <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Завантаження…</div>}
      {error && <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/30 p-2 text-xs text-red-300">{error}</div>}
      {!loading && !error && filtered.length === 0 && <div className="py-8 text-center text-xs text-slate-500">У цій книзі ще немає зображень у медіатеці.</div>}
      {!loading && filtered.length > 0 && <div className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">{filtered.map((asset) => <button key={asset.id} type="button" onClick={() => onPick({ assetId: asset.id, url: asset.url, filename: asset.filename, mimeType: asset.mimeType, altText: asset.altText })} className={`overflow-hidden rounded-lg border text-left ${selectedId === asset.id ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-slate-800 hover:border-slate-600'}`}><div className="aspect-[4/3] bg-slate-900"><img src={assetUrl(asset.url)} alt={asset.altText || asset.title || asset.filename} className="h-full w-full object-cover" loading="lazy" /></div><div className="truncate px-2 py-1.5 text-[10px] text-slate-400">{asset.title || asset.filename}</div></button>)}</div>}
    </div>
  );
}

export const BookDesignBackgroundEditor: React.FC<Props> = ({ bookId, background, paperColor = '#fffdf8', onChange, compact = false }) => {
  const [showLibrary, setShowLibrary] = useState(false);
  const imageUrl = backgroundImageUrl(background);
  const fade = background.fade || { enabled: false, target: 'paper' as const, direction: 'top-to-bottom' as const, startPercent: 25, endPercent: 100, strength: 1 };
  const overlay = background.overlay || { enabled: false, kind: 'solid' as const, color: '#ffffff', opacity: 0.2 };
  const effects = background.effects || { blurPx: 0, brightness: 1, contrast: 1, grayscale: 0 };

  return (
    <div className="space-y-3" data-book-design-background-editor>
      {!compact && <Preview background={background} paperColor={paperColor} />}

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-slate-500">Тип фона<select value={background.kind} onChange={(e) => onChange({ ...background, kind: e.target.value as DesignerBackground['kind'] })} className={`${inputClass()} mt-1`}><option value="none">Немає</option><option value="color">Суцільний колір</option><option value="gradient">Градієнт</option><option value="image">Фото</option></select></label>
        <label className="text-[11px] text-slate-500">Прозорість <span className="text-slate-300">{Math.round(clamp01(background.opacity, 1) * 100)}%</span><input type="range" min={0} max={1} step={0.05} value={clamp01(background.opacity, 1)} onChange={(e) => onChange({ ...background, opacity: Number(e.target.value) })} className="mt-2 w-full" /></label>
      </div>

      {background.kind === 'color' && <label className="block text-[11px] text-slate-500">Колір фона<input type="color" value={background.color || '#fffdf8'} onChange={(e) => onChange({ ...background, color: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950" /></label>}
      {background.kind === 'gradient' && <label className="block text-[11px] text-slate-500">CSS-градієнт<input value={background.gradient || ''} onChange={(e) => onChange({ ...background, gradient: e.target.value })} placeholder="linear-gradient(180deg, #dbeafe, #ffffff)" className={`${inputClass()} mt-1`} /></label>}

      {background.kind === 'image' && <div className="space-y-2">
        <div className="grid grid-cols-[1fr_auto] gap-2"><input value={imageUrl} onChange={(e) => onChange({ ...background, imageUrl: e.target.value, mediaAsset: undefined })} placeholder="URL або виберіть фото з медіатеки" className={inputClass()} /><button type="button" onClick={() => setShowLibrary((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700 px-3 py-2 text-xs font-semibold text-cyan-200"><ImageIcon className="h-3.5 w-3.5" /> Медіатека</button></div>
        {background.mediaAsset && <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2 text-[10px] text-slate-400"><span className="truncate">{background.mediaAsset.filename || background.mediaAsset.assetId}</span><button type="button" onClick={() => onChange({ ...background, mediaAsset: undefined, imageUrl: '' })} className="text-slate-500 hover:text-red-300">Відв’язати</button></div>}
        <div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-500">Масштаб<select value={background.fit || 'cover'} onChange={(e) => onChange({ ...background, fit: e.target.value as DesignerBackgroundFit })} className={`${inputClass()} mt-1`}>{FITS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="text-[11px] text-slate-500">Позиція<select value={background.position || 'center'} onChange={(e) => onChange({ ...background, position: e.target.value as DesignerBackgroundPosition })} className={`${inputClass()} mt-1`}>{POSITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
        {showLibrary && <MediaLibraryPicker bookId={bookId} selectedId={background.mediaAsset?.assetId} onClose={() => setShowLibrary(false)} onPick={(asset) => { onChange({ ...background, kind: 'image', imageUrl: asset.url, mediaAsset: asset, fit: background.fit || 'cover', position: background.position || 'center' }); setShowLibrary(false); }} />}
      </div>}

      <details className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
        <summary className="cursor-pointer text-xs font-semibold text-slate-300">Накладення поверх фона</summary>
        <div className="mt-3 space-y-2"><label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={overlay.enabled} onChange={(e) => onChange({ ...background, overlay: { ...overlay, enabled: e.target.checked } })} /> Увімкнути overlay</label>{overlay.enabled && <><select value={overlay.kind} onChange={(e) => onChange({ ...background, overlay: { ...overlay, kind: e.target.value as 'solid' | 'gradient' } })} className={inputClass()}><option value="solid">Суцільний</option><option value="gradient">Градієнт</option></select>{overlay.kind === 'solid' ? <input type="color" value={overlay.color || '#ffffff'} onChange={(e) => onChange({ ...background, overlay: { ...overlay, color: e.target.value } })} className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950" /> : <input value={overlay.gradient || ''} onChange={(e) => onChange({ ...background, overlay: { ...overlay, gradient: e.target.value } })} placeholder="linear-gradient(...)" className={inputClass()} />}<label className="block text-[11px] text-slate-500">Сила overlay: {Math.round(clamp01(overlay.opacity, .2) * 100)}%<input type="range" min={0} max={1} step={0.05} value={clamp01(overlay.opacity, .2)} onChange={(e) => onChange({ ...background, overlay: { ...overlay, opacity: Number(e.target.value) } })} className="mt-1 w-full" /></label></>}</div>
      </details>

      <details open className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
        <summary className="cursor-pointer text-xs font-semibold text-slate-300">Плавний перехід у папір</summary>
        <div className="mt-3 space-y-2"><label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={fade.enabled} onChange={(e) => onChange({ ...background, fade: { ...fade, enabled: e.target.checked } })} /> Увімкнути fade</label>{fade.enabled && <><div className="grid grid-cols-2 gap-2"><select value={fade.direction} onChange={(e) => onChange({ ...background, fade: { ...fade, direction: e.target.value as DesignerBackgroundFadeDirection } })} className={inputClass()}>{FADES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select value={fade.target} onChange={(e) => onChange({ ...background, fade: { ...fade, target: e.target.value as typeof fade.target } })} className={inputClass()}><option value="paper">У колір паперу</option><option value="white">У білий</option><option value="color">У свій колір</option><option value="transparent">У прозорий</option></select></div>{fade.target === 'color' && <input type="color" value={fade.targetColor || '#ffffff'} onChange={(e) => onChange({ ...background, fade: { ...fade, targetColor: e.target.value } })} className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950" />}<div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-500">Початок {fade.startPercent}%<input type="range" min={0} max={100} step={1} value={fade.startPercent} onChange={(e) => onChange({ ...background, fade: { ...fade, startPercent: Math.min(Number(e.target.value), fade.endPercent) } })} className="w-full" /></label><label className="text-[10px] text-slate-500">Кінець {fade.endPercent}%<input type="range" min={0} max={100} step={1} value={fade.endPercent} onChange={(e) => onChange({ ...background, fade: { ...fade, endPercent: Math.max(Number(e.target.value), fade.startPercent) } })} className="w-full" /></label></div><label className="block text-[10px] text-slate-500">Сила {Math.round(clamp01(fade.strength, 1) * 100)}%<input type="range" min={0} max={1} step={0.05} value={clamp01(fade.strength, 1)} onChange={(e) => onChange({ ...background, fade: { ...fade, strength: Number(e.target.value) } })} className="w-full" /></label></>}</div>
      </details>

      <details className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
        <summary className="cursor-pointer text-xs font-semibold text-slate-300">Ефекти фото</summary>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-slate-500"><label>Blur {effects.blurPx || 0}px<input type="range" min={0} max={20} step={1} value={effects.blurPx || 0} onChange={(e) => onChange({ ...background, effects: { ...effects, blurPx: Number(e.target.value) } })} className="w-full" /></label><label>Яскравість {Number(effects.brightness || 1).toFixed(2)}<input type="range" min={0.3} max={1.7} step={0.05} value={effects.brightness || 1} onChange={(e) => onChange({ ...background, effects: { ...effects, brightness: Number(e.target.value) } })} className="w-full" /></label><label>Контраст {Number(effects.contrast || 1).toFixed(2)}<input type="range" min={0.3} max={1.7} step={0.05} value={effects.contrast || 1} onChange={(e) => onChange({ ...background, effects: { ...effects, contrast: Number(e.target.value) } })} className="w-full" /></label><label>Ч/б {Math.round(clamp01(effects.grayscale, 0) * 100)}%<input type="range" min={0} max={1} step={0.05} value={clamp01(effects.grayscale, 0)} onChange={(e) => onChange({ ...background, effects: { ...effects, grayscale: Number(e.target.value) } })} className="w-full" /></label></div>
      </details>
    </div>
  );
};
