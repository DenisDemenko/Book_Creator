import React from 'react';
import type { DesignerEntityStyle } from '../data/customBookDesignTheme';

interface Props {
  style: DesignerEntityStyle;
  onChange: (patch: Partial<DesignerEntityStyle>) => void;
}

type Edge = 'top' | 'right' | 'bottom' | 'left';

const EDGES: Array<{ id: Edge; label: string }> = [
  { id: 'top', label: 'Верх' },
  { id: 'right', label: 'Право' },
  { id: 'bottom', label: 'Низ' },
  { id: 'left', label: 'Ліво' },
];

function inputClass(): string {
  return 'w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500';
}

function numberOrUndefined(value: string): number | undefined {
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function spacingValue(
  spacing: DesignerEntityStyle['paddingMm'] | DesignerEntityStyle['marginMm'],
  edge: Edge
): number | '' {
  return spacing?.[edge] ?? '';
}

export const BookDesignBoxModelEditor: React.FC<Props> = ({ style, onChange }) => {
  const border = style.border || { style: 'none' as const, sides: [] };
  const sides = border.sides || [];

  function patchSpacing(kind: 'paddingMm' | 'marginMm', edge: Edge, raw: string) {
    const current = style[kind] || { top: 0, right: 0, bottom: 0, left: 0 };
    const value = numberOrUndefined(raw);
    onChange({
      [kind]: {
        ...current,
        [edge]: value ?? 0,
      },
    } as Partial<DesignerEntityStyle>);
  }

  function toggleSide(edge: Edge, enabled: boolean) {
    const next = enabled
      ? Array.from(new Set([...sides, edge]))
      : sides.filter((item) => item !== edge);
    onChange({ border: { ...border, sides: next } });
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Рамка</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-500">
            Стиль
            <select
              value={border.style}
              onChange={(event) => onChange({ border: { ...border, style: event.target.value as NonNullable<DesignerEntityStyle['border']>['style'] } })}
              className={`${inputClass()} mt-1`}
            >
              <option value="none">Без рамки</option>
              <option value="solid">Суцільна</option>
              <option value="double">Подвійна</option>
              <option value="dashed">Пунктир</option>
            </select>
          </label>
          <label className="text-[11px] text-slate-500">
            Товщина, pt
            <input
              type="number"
              min={0.25}
              max={12}
              step={0.25}
              value={border.widthPt ?? ''}
              onChange={(event) => onChange({ border: { ...border, widthPt: numberOrUndefined(event.target.value) } })}
              className={`${inputClass()} mt-1`}
            />
          </label>
        </div>
        <label className="mt-2 block text-[11px] text-slate-500">
          Колір рамки
          <input
            type="color"
            value={border.color || '#64748b'}
            onChange={(event) => onChange({ border: { ...border, color: event.target.value } })}
            className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950"
          />
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {EDGES.map((edge) => (
            <label key={edge.id} className="flex items-center gap-2 rounded-lg border border-slate-800 px-2.5 py-2 text-[11px] text-slate-300">
              <input
                type="checkbox"
                checked={sides.includes(edge.id)}
                onChange={(event) => toggleSide(edge.id, event.target.checked)}
              />
              {edge.label}
            </label>
          ))}
        </div>
        {border.style !== 'none' && border.style !== 'solid' && (
          <p className="mt-2 text-[10px] leading-relaxed text-amber-300/80">
            Тема зберігає цей стиль. Поточний DesignCraft PDF renderer гарантовано підтримує суцільну рамку; інші стилі залишаються для наступного renderer slice.
          </p>
        )}
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Внутрішні відступи, мм</div>
        <div className="grid grid-cols-2 gap-2">
          {EDGES.map((edge) => (
            <label key={edge.id} className="text-[11px] text-slate-500">
              {edge.label}
              <input
                type="number"
                min={0}
                max={40}
                step={0.5}
                value={spacingValue(style.paddingMm, edge.id)}
                onChange={(event) => patchSpacing('paddingMm', edge.id, event.target.value)}
                className={`${inputClass()} mt-1`}
              />
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Зовнішні відступи, мм</div>
        <div className="grid grid-cols-2 gap-2">
          {EDGES.map((edge) => (
            <label key={edge.id} className="text-[11px] text-slate-500">
              {edge.label}
              <input
                type="number"
                min={0}
                max={80}
                step={0.5}
                value={spacingValue(style.marginMm, edge.id)}
                onChange={(event) => patchSpacing('marginMm', edge.id, event.target.value)}
                className={`${inputClass()} mt-1`}
              />
            </label>
          ))}
        </div>
      </div>

      <label className="block text-[11px] text-slate-500">
        Заокруглення, мм
        <input
          type="number"
          min={0}
          max={30}
          step={0.5}
          value={style.radiusMm ?? ''}
          onChange={(event) => onChange({ radiusMm: numberOrUndefined(event.target.value) })}
          className={`${inputClass()} mt-1`}
        />
      </label>
    </div>
  );
};
