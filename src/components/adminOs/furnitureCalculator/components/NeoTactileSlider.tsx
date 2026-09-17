import React from 'react';

interface NeoTactileSliderProps {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
  sublabel?: string;
}

export const NeoTactileSlider: React.FC<NeoTactileSliderProps> = ({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  sublabel,
}) => {
  const safeValue = typeof value === 'number' && !isNaN(value) ? value : min;
  const percentage = Math.min(100, Math.max(0, ((safeValue - min) / (max - min || 1)) * 100));

  const handleStep = (increment: boolean) => {
    const nextVal = increment ? safeValue + step : safeValue - step;
    const clamped = Math.min(max, Math.max(min, nextVal));
    onChange(Number(clamped.toFixed(3)));
  };

  return (
    <div id={id} className="w-full py-2">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-medium text-slate-200 tracking-wide">{label}</span>
          {sublabel && <p className="text-xs text-slate-400 mt-0.5">{sublabel}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleStep(false)}
            aria-label="Decrease"
            className="w-6 h-6 rounded-md neo-icon-btn flex items-center justify-center text-xs text-slate-300 active:scale-95 cursor-pointer"
          >
            -
          </button>
          <div className="min-w-[4.2rem] px-2.5 py-1 rounded-lg neo-inset text-right font-mono text-xs text-cyan-300 font-semibold border border-cyan-500/20">
            {safeValue.toLocaleString('uk-UA')} {unit}
          </div>
          <button
            type="button"
            onClick={() => handleStep(true)}
            aria-label="Increase"
            className="w-6 h-6 rounded-md neo-icon-btn flex items-center justify-center text-xs text-slate-300 active:scale-95 cursor-pointer"
          >
            +
          </button>
        </div>
      </div>

      <div className="relative flex items-center h-6">
        {/* Glow fill underneath track */}
        <div
          className="absolute left-0 h-1.5 rounded-full pointer-events-none transition-all duration-75"
          style={{
            width: `${percentage}%`,
            background: 'linear-gradient(90deg, #2563eb, #38bdf8)',
            boxShadow: '0 0 12px rgba(56, 189, 248, 0.7)',
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={safeValue}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full neo-range z-10"
        />
      </div>

      <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono px-0.5 mt-0.5">
        <span>
          {min} {unit}
        </span>
        <span>
          {max} {unit}
        </span>
      </div>
    </div>
  );
};
