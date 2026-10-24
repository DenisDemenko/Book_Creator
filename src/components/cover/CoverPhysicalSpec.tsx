import React, { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { Book, CoverConfig } from '../../types';
import { coverSpreadDimensions, hasCoverTrim } from '../../utils/coverPhysical';
import { PickFromMediaLibraryModal } from '../PickFromMediaLibraryModal';

export interface CoverPhysicalFields {
  backArtUrl?: string;
  spineArtUrl?: string;
  wrapArtUrl?: string;
  useWrapArtwork?: boolean;
  coverMaterial?: 'coated-paper' | 'hard-board' | 'fabric' | 'textured-paper';
  lamination?: 'none' | 'matte' | 'gloss' | 'soft-touch';
}

export type CoverConfigWithPhysical = CoverConfig & CoverPhysicalFields;

/** Поля обкладинки, у які можна покласти зображення з медіатеки. */
type ArtField = 'frontArtUrl' | 'backArtUrl' | 'spineArtUrl' | 'wrapArtUrl';

const ART_FIELD_TITLE: Record<ArtField, string> = {
  frontArtUrl: 'Зображення передньої обкладинки',
  backArtUrl: 'Зображення задньої обкладинки',
  spineArtUrl: 'Зображення корінця',
  wrapArtUrl: 'Повна ілюстрація розгортки',
};

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
  const [pickerFor, setPickerFor] = useState<ArtField | null>(null);
  const layout = book.layoutConfig;
  const trimKnown = hasCoverTrim(layout);
  const dims = coverSpreadDimensions(
    { pageWidthMm: layout.pageWidthMm, pageHeightMm: layout.pageHeightMm, bleedMm: layout.margins.bleedMm },
    spineWidthMm,
  );
  const bleedMm = layout.margins.bleedMm || 0;

  /** Поле зображення: ручний ввід адреси АБО вибір із медіатеки студії. */
  const artRow = (field: ArtField, value: string | undefined, placeholder: string) => (
    <div className="space-y-1" data-cover-art-field={field}>
      <span className="block text-[11px] text-slate-400">{ART_FIELD_TITLE[field]}</span>
      <div className="flex gap-2">
        <input
          type="text"
          value={value ?? ''}
          onChange={(event) => onChange({ [field]: event.target.value } as Partial<CoverConfigWithPhysical>)}
          placeholder={placeholder}
          aria-label={ART_FIELD_TITLE[field]}
          className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 p-2 font-mono text-xs text-slate-200"
        />
        <button
          type="button"
          onClick={() => setPickerFor(field)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-700/50 bg-cyan-500/10 px-2.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/20"
        >
          <ImageIcon className="h-3.5 w-3.5" /> З медіатеки
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange({ [field]: '' } as Partial<CoverConfigWithPhysical>)}
            className="shrink-0 rounded-lg border border-slate-700 px-2.5 text-[11px] text-slate-400 hover:text-white"
            aria-label={`Прибрати: ${ART_FIELD_TITLE[field]}`}
          >
            Прибрати
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-slate-400 sm:grid-cols-4" data-cover-size>
        <div>
          <span className="block">Формат</span>
          <b className="text-slate-200">
            {trimKnown ? `${layout.pageWidthMm} × ${layout.pageHeightMm} мм` : 'не вказано'}
          </b>
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
          <b className="text-slate-200">{trimKnown ? `${dims.fullWidthMm} × ${dims.fullHeightMm} мм` : '—'}</b>
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
        {artRow('frontArtUrl', cover.frontArtUrl, 'URL або шлях із медіатеки')}
        {artRow('backArtUrl', cover.backArtUrl, 'URL або шлях із медіатеки')}
        {artRow('spineArtUrl', cover.spineArtUrl, 'URL або шлях із медіатеки')}

        <label className="flex items-center gap-2 text-[11px] text-slate-300">
          <input
            type="checkbox"
            checked={cover.useWrapArtwork === true}
            onChange={(event) => onChange({ useWrapArtwork: event.target.checked })}
            className="rounded text-cyan-500"
          />
          Одна ілюстрація на BACK + SPINE + FRONT
        </label>

        {cover.useWrapArtwork && artRow('wrapArtUrl', cover.wrapArtUrl, 'URL повної ілюстрації розгортки')}
      </div>

      {pickerFor && (
        <PickFromMediaLibraryModal
          title={ART_FIELD_TITLE[pickerFor]}
          onPick={(url) => {
            onChange({ [pickerFor]: url } as Partial<CoverConfigWithPhysical>);
            setPickerFor(null);
          }}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
};
