import React, { useState } from 'react';
import { Check, TrendingUp, ListChecks } from 'lucide-react';
import type { HeroArcState } from '../types';
import {
  HERO_ARC_STEPS,
  HERO_ARC_BEATS,
  HERO_ARC_PHASE_LABELS,
  catmullRomPath,
  valenceColor,
  heroArcProgress,
  normalizeHeroArcState,
} from '../data/heroArc';

/**
 * «Крива головного героя» — конструктор шляху героя (мономіф Кемпбелла) +
 * узгоджена з ним емоційна крива. Два таби, як у референсному прикладі
 * (`hero-journey`); третій таб оригіналу, «Підсумок» (копіювання запиту
 * для AI-наставника), тут навмисно ВІДСУТНІЙ — за прямою вказівкою в ТЗ.
 *
 * Той самий компонент монтується у двох місцях:
 *  - ExpressWizardView.tsx (крок «Герої») — заповнюється одразу під час
 *    п'ятихвилинного майстра;
 *  - EditorView.tsx (панель «Персонажі і сцена») — щоб дугу героя можна
 *    було звірити чи доправити, не виходячи з написання тексту.
 * Дані (`value`/`onChange`) — завжди `book.heroArc`, тож правка в одному
 * місці одразу видно в другому.
 */
export interface HeroArcPanelProps {
  value: HeroArcState | undefined;
  onChange: (next: HeroArcState) => void;
  /** Ім'я протагоніста для заголовка — необов'язкове, панель працює і без нього. */
  heroName?: string;
  /** Компактний режим — вужчі відступи для вузької бічної панелі редактора. */
  compact?: boolean;
}

export const HeroArcPanel: React.FC<HeroArcPanelProps> = ({ value, onChange, heroName, compact }) => {
  const [tab, setTab] = useState<'constructor' | 'curve'>('constructor');
  const [activeStep, setActiveStep] = useState(0);
  const state = normalizeHeroArcState(value);
  const progress = heroArcProgress(state);

  const setAnswer = (stepId: string, text: string) => {
    onChange({ ...state, answers: { ...state.answers, [stepId]: text } });
  };
  const setIntensity = (i: number, v: number) => {
    const intensities = state.intensities.slice();
    intensities[i] = v;
    onChange({ ...state, intensities });
  };

  const step = HERO_ARC_STEPS[activeStep];

  // ---- Крива: геометрія SVG ----
  const W = 460;
  const H = compact ? 200 : 260;
  const padX = 28;
  const padTop = 18;
  const padBottom = 26;
  const zeroY = padTop + (H - padTop - padBottom) / 2;
  const scaleY = (H - padTop - padBottom) / 2 / 10;
  const xFor = (i: number) => padX + (i * (W - 2 * padX)) / (HERO_ARC_BEATS.length - 1);
  const yFor = (v: number) => zeroY - v * scaleY;
  const points: Array<[number, number]> = state.intensities.map((v, i) => [xFor(i), yFor(v)]);
  const pathD = catmullRomPath(points);
  const fillD = `${pathD} L${xFor(HERO_ARC_BEATS.length - 1).toFixed(1)},${zeroY.toFixed(1)} L${xFor(0).toFixed(1)},${zeroY.toFixed(1)} Z`;
  const bandStarts = [0, 5, 11, 14];
  const bandFills = ['rgba(52,211,153,0.06)', 'rgba(244,63,94,0.05)', 'rgba(96,165,250,0.06)'];

  return (
    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
        <div className="min-w-0">
          <span className="font-bold text-slate-100 text-sm block truncate">
            Крива головного героя{heroName ? `: ${heroName}` : ''}
          </span>
          <span className="text-[10px] text-slate-500">Шлях героя — {progress}/{HERO_ARC_STEPS.length} кроків заповнено</span>
        </div>
      </div>

      {/* Два таби — навмисно без "Підсумку" з референсу */}
      <div className="flex items-center gap-1 px-3.5 mt-2 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setTab('constructor')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border-b-2 -mb-px transition-colors ${
            tab === 'constructor' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <ListChecks className="w-3.5 h-3.5" /> Конструктор
        </button>
        <button
          type="button"
          onClick={() => setTab('curve')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border-b-2 -mb-px transition-colors ${
            tab === 'curve' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" /> Крива сюжету
        </button>
      </div>

      {tab === 'constructor' ? (
        <div className="p-3.5 space-y-2.5">
          {/* Компактний рядок кроків — вертикальний список зайняв би забагато
              висоти в бічній панелі редактора, тож тут ті самі 13 кроків
              показані рядком нумерованих кружечків (той самий патерн, що
              й смуга кроків самого експрес-майстра). */}
          <div className="flex flex-wrap gap-1">
            {HERO_ARC_STEPS.map((s, i) => {
              const filled = (state.answers[s.id] || '').trim().length > 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  title={s.title}
                  onClick={() => setActiveStep(i)}
                  className={`grid place-items-center w-6 h-6 rounded-full text-[10px] font-mono border transition-colors ${
                    i === activeStep
                      ? 'border-amber-400 text-amber-300 bg-amber-400/10'
                      : filled
                        ? 'border-emerald-600/60 text-emerald-400 bg-emerald-500/5'
                        : 'border-slate-700 text-slate-500'
                  }`}
                >
                  {filled && i !== activeStep ? <Check className="w-3 h-3" /> : i + 1}
                </button>
              );
            })}
          </div>

          <div>
            <p className="text-xs font-bold text-slate-100">{step.title}</p>
            <p className="mt-0.5 text-[11px] text-slate-400 leading-relaxed">{step.question}</p>
          </div>
          <textarea
            value={state.answers[step.id] || ''}
            onChange={(e) => setAnswer(step.id, e.target.value)}
            placeholder={step.placeholder}
            rows={compact ? 3 : 4}
            className="w-full resize-y rounded-xl bg-slate-950 border border-slate-800 px-2.5 py-2 text-xs text-slate-200 leading-relaxed outline-none focus:border-amber-400"
          />
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              disabled={activeStep === 0}
              onClick={() => setActiveStep((s) => Math.max(0, s - 1))}
              className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-default"
            >
              ← Попередній
            </button>
            <button
              type="button"
              disabled={activeStep === HERO_ARC_STEPS.length - 1}
              onClick={() => setActiveStep((s) => Math.min(HERO_ARC_STEPS.length - 1, s + 1))}
              className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 disabled:opacity-30 disabled:cursor-default"
            >
              Наступний крок →
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3.5">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
            {bandStarts.slice(0, 3).map((start, ph) => {
              const x1 = xFor(start) - (ph === 0 ? padX - 4 : 10);
              const x2Raw = xFor(bandStarts[ph + 1] - 1) + 10;
              const x2 = ph === 2 ? W - padX + (padX - 4) : x2Raw;
              return (
                <rect
                  key={ph}
                  x={x1}
                  y={padTop}
                  width={Math.max(0, x2 - x1)}
                  height={H - padTop - padBottom}
                  fill={bandFills[ph]}
                />
              );
            })}
            <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="#334155" strokeDasharray="2,4" />
            <path d={fillD} fill="#f59e0b" opacity={0.12} />
            <path d={pathD} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeLinecap="round" />
            {points.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={4.5} fill={valenceColor(state.intensities[i])} stroke="#0f172a" strokeWidth={1.5} />
            ))}
          </svg>
          <div className="flex text-[9px] font-mono text-slate-500 -mt-1 px-1">
            {HERO_ARC_PHASE_LABELS.map((label) => (
              <span key={label} className="flex-1 text-center uppercase tracking-wide">
                {label}
              </span>
            ))}
          </div>

          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {HERO_ARC_BEATS.map((b, i) => (
              <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5">
                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <span className="text-slate-300 truncate">{i + 1}. {b.title}</span>
                  <span className="font-mono text-slate-500 shrink-0">{state.intensities[i]}</span>
                </div>
                <input
                  type="range"
                  min={-10}
                  max={10}
                  step={1}
                  value={state.intensities[i]}
                  onChange={(e) => setIntensity(i, Number(e.target.value))}
                  className="w-full accent-amber-400"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
