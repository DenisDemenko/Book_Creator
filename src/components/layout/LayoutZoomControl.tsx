import React from 'react';
import { ZoomIn } from 'lucide-react';

export const LAYOUT_ZOOM_PRESETS = Array.from({ length: 15 }, (_, index) => (index + 1) * 10);

interface LayoutZoomControlProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}

/**
 * Масштаб змінює лише viewport превʼю. Він не змінює формат сторінки,
 * поля, кегль або параметри PDF/друку.
 */
export const LayoutZoomControl: React.FC<LayoutZoomControlProps> = ({
  value,
  onChange,
  label = 'Масштаб',
}) => {
  const normalized = LAYOUT_ZOOM_PRESETS.includes(value) ? value : 100;

  return (
    <div className="flex items-center justify-center gap-2 w-full text-xs">
      <ZoomIn className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
      <span className="text-slate-400">{label}</span>
      <select
        aria-label={label}
        value={normalized}
        onChange={(event) => onChange(Number(event.target.value))}
        className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
      >
        {LAYOUT_ZOOM_PRESETS.map((zoom) => (
          <option key={zoom} value={zoom}>
            {zoom}%
          </option>
        ))}
      </select>
    </div>
  );
};
