import { Droplets, Sparkles, Waves } from 'lucide-react';
import type { WaterCausticsSettings } from './WaterCausticsCanvas';

const LEVELS: WaterCausticsSettings['level'][] = ['low', 'medium', 'high', 'ultra'];

/**
 * Повний пульт керування «Вода і відблиски» — 1:1 за складом контролів з
 * мокапу "FusionWrite — Water & Caustics" (швидкість, рівень каустики,
 * частота, Shimmer, Splash), лише перекладено на класи проєкту
 * (.glass-panel/.glass-pill/.water-range-slider з index.css).
 */
export function WaterCausticsPanel({
  settings,
  onChange,
  onSplash,
  labels,
}: {
  settings: WaterCausticsSettings;
  onChange: (next: WaterCausticsSettings) => void;
  onSplash: () => void;
  labels: {
    title: string;
    enabled: string;
    speed: string;
    level: string;
    levelLabels: Record<WaterCausticsSettings['level'], string>;
    frequency: string;
    shimmer: string;
    splash: string;
  };
}) {
  return (
    <div className="glass-panel p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3 shadow-md">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Waves className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="font-bold text-slate-100 text-sm truncate">{labels.title}</span>
        </div>
        <button
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
          className={`glass-pill px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${
            settings.enabled ? 'glass-pill-active' : 'text-slate-400'
          }`}
        >
          {labels.enabled}
        </button>
      </div>

      <div className={settings.enabled ? '' : 'opacity-40 pointer-events-none'}>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>{labels.speed}</span>
            <span className="font-mono">{settings.speed.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={settings.speed}
            onChange={(e) => onChange({ ...settings, speed: Number(e.target.value) })}
            className="water-range-slider w-full"
            aria-label={labels.speed}
          />
        </div>

        <div className="space-y-1 mt-3">
          <div className="text-[10px] text-slate-400">{labels.level}</div>
          <div className="grid grid-cols-4 gap-1.5">
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                onClick={() => onChange({ ...settings, level: lvl })}
                className={`glass-pill py-1 rounded-lg text-[10px] font-bold transition-all ${
                  settings.level === lvl ? 'glass-pill-active' : 'text-slate-400'
                }`}
              >
                {labels.levelLabels[lvl]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1 mt-3">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>{labels.frequency}</span>
            <span className="font-mono">{settings.frequency.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={settings.frequency}
            onChange={(e) => onChange({ ...settings, frequency: Number(e.target.value) })}
            className="water-range-slider w-full"
            aria-label={labels.frequency}
          />
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> {labels.shimmer}
          </span>
          <button
            onClick={() => onChange({ ...settings, shimmer: !settings.shimmer })}
            className={`relative w-9 h-5 rounded-full transition-colors ${settings.shimmer ? 'bg-cyan-500' : 'bg-slate-700'}`}
            aria-pressed={settings.shimmer}
            aria-label={labels.shimmer}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.shimmer ? 'translate-x-4' : ''
              }`}
            />
          </button>
        </div>

        <button
          onClick={onSplash}
          className="btn-action-glow w-full mt-3 flex items-center justify-center gap-1.5 py-2 rounded-xl text-white text-[11px] font-bold"
        >
          <Droplets className="w-3.5 h-3.5" /> {labels.splash}
        </button>
      </div>
    </div>
  );
}
