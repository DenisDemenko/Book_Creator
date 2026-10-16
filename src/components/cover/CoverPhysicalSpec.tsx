import React from 'react';
import type { Book, CoverConfig } from '../../types';

export interface CoverPhysicalFields {
  backArtUrl?: string;
  spineArtUrl?: string;
  wrapArtUrl?: string;
  useWrapArtwork?: boolean;
  coverMaterial?: 'coated-paper' | 'hard-board' | 'fabric' | 'textured-paper';
  lamination?: 'none' | 'matte' | 'gloss' | 'soft-touch';
}

export type CoverConfigWithPhysical = CoverConfig & CoverPhysicalFields;

interface CoverPhysicalSpecProps {
  book: Book;
  cover: CoverConfigWithPhysical;
  spineWidthMm: number;
  onChange: (patch: Partial<CoverConfigWithPhysical>) => void;
}

export const CoverPhysicalSpec: React.FC<CoverPhysicalSpecProps> = ({
  book,
  cover,
  spineWidthMm,
  onChange,
}) => {
  const layout = book.layoutConfig;
  const bleedMm = layout.margins.bleedMm || 0;
  const fullWidthMm = Number((layout.pageWidthMm * 2 + spineWidthMm + bleedMm * 2).toFixed(1));
  const fullHeightMm = Number((layout.pageHeightMm + bleedMm * 2).toFixed(1));

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400 sm:grid-cols-4">
        <div>
          <span className="block">Формат</span>
          <b className="text-slate-200">{layout.pageWidthMm} × {layout.pageHeightMm} мм</b>
        </div>
        <div>
          <span className="block">Корінець</span>
          <b className="text-slate-200">{spineWidthMm} мм</b>
        </div>
        <div>
          <span className="block">Bleed</span>
          <b className="text-slate-200">{bleedMm} мм</b>
        </div>
        <div>
          <span className="block">Розгортка</span>
          <b className="text-slate-200">{fullWidthMm} × {fullHeightMm} мм</b>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-[11px] text-slate-400">
          <span className="mb-1 block">Матеріал обкладинки</span>
          <select
            value={cover.coverMaterial ?? 'coated-paper'}
            onChange={(event) => onChange({ coverMaterial: event.target.value as CoverPhysicalFields['coverMaterial'] })}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs text-slate-200"
          >
            <option value="coated-paper">Крейдований папір</option>
            <option value="hard-board">Твердий картон</option>
            <option value="fabric">Тканинна обкладинка</option>
            <option value="textured-paper">Фактурний дизайнерський папір</option>
          </select>
        </label>

        <label className="text-[11px] text-slate-400">
          <span className="mb-1 block">Фініш / ламінація</span>
          <select
            value={cover.lamination ?? 'none'}
            onChange={(event) => onChange({ lamination: event.target.value as CoverPhysicalFields['lamination'] })}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs text-slate-200"
          >
            <option value="none">Без ламінації</option>
            <option value="matte">Матова</option>
            <option value="gloss">Глянцева</option>
            <option value="soft-touch">Soft-touch</option>
          </select>
        </label>
      </div>

      <div className="space-y-2 border-t border-slate-800 pt-3">
        <label className="block text-[11px] text-slate-400">
          <span className="mb-1 block">Зображення задньої обкладинки</span>
          <input
            type="text"
            value={cover.backArtUrl ?? ''}
            onChange={(event) => onChange({ backArtUrl: event.target.value })}
            placeholder="URL або шлях із медіатеки"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs text-slate-200 font-mono"
          />
        </label>

        <label className="block text-[11px] text-slate-400">
          <span className="mb-1 block">Зображення корінця</span>
          <input
            type="text"
            value={cover.spineArtUrl ?? ''}
            onChange={(event) => onChange({ spineArtUrl: event.target.value })}
            placeholder="URL або шлях із медіатеки"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs text-slate-200 font-mono"
          />
        </label>

        <label className="flex items-center gap-2 text-[11px] text-slate-300">
          <input
            type="checkbox"
            checked={cover.useWrapArtwork === true}
            onChange={(event) => onChange({ useWrapArtwork: event.target.checked })}
            className="rounded text-cyan-500"
          />
          Одна ілюстрація на BACK + SPINE + FRONT
        </label>

        {cover.useWrapArtwork && (
          <input
            type="text"
            value={cover.wrapArtUrl ?? ''}
            onChange={(event) => onChange({ wrapArtUrl: event.target.value })}
            placeholder="URL повної ілюстрації розгортки"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs text-slate-200 font-mono"
          />
        )}
      </div>
    </div>
  );
};
