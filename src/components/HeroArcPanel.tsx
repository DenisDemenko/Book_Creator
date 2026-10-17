import React, { useEffect, useRef, useState } from 'react';
import { Check, TrendingUp, ListChecks, RotateCcw } from 'lucide-react';
import {
  HERO_ARC_STEPS,
  HERO_ARC_BEATS,
  HERO_ARC_PHASE_LABELS,
  catmullRomPath,
  valenceColor,
  heroArcProgress,
  normalizeHeroArcState,
} from '../data/heroArc';
import {
  applyHeroArcOverride,
  clearHeroArcOverride,
  displayHeroArcIntensities,
  markHeroArcAnalysisStale,
  type HeroArcStateWithAnalysis,
} from '../utils/heroArcAnalysis';
import {
  EXPRESS_DRAFT_VIEW_EVENT,
  wizardApi,
  type ExpressDraftViewEventDetail,
} from '../utils/expressDraftSession';

interface WizardCastMember {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * «Крива головного героя» — конструктор шляху героя + емоційна крива.
 * JEV-аналіз є базовою семантичною оцінкою, а ручний рух повзунка —
 * явним authorOverride. Старі книги без analysis продовжують працювати.
 *
 * У Express Wizard протагоніст завжди обирається автором за stable CharacterID.
 * Порядок cast ніколи не використовується як неявне визначення головного героя.
 */
export interface HeroArcPanelProps {
  value: HeroArcStateWithAnalysis | undefined;
  onChange: (next: HeroArcStateWithAnalysis) => void;
  heroName?: string;
  compact?: boolean;
}

export const HeroArcPanel: React.FC<HeroArcPanelProps> = ({ value, onChange, heroName, compact }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const sawLiveWizardEvent = useRef(false);
  const [tab, setTab] = useState<'constructor' | 'curve'>('constructor');
  const [activeStep, setActiveStep] = useState(0);
  const [inWizard, setInWizard] = useState(false);
  const [wizardCast, setWizardCast] = useState<WizardCastMember[] | null>(null);

  const normalized = normalizeHeroArcState(value);
  const extended = value as HeroArcStateWithAnalysis | undefined;
  const state: HeroArcStateWithAnalysis = {
    ...normalized,
    ...(extended?.selectedHeroId ? { selectedHeroId: extended.selectedHeroId } : {}),
    ...(extended?.analysis ? { analysis: extended.analysis } : {}),
  };
  const displayIntensities = displayHeroArcIntensities(state);
  const progress = heroArcProgress(state);

  useEffect(() => {
    const insideWizard = Boolean(rootRef.current?.closest('[data-book-wizard]'));
    setInWizard(insideWizard);
    if (!insideWizard || typeof window === 'undefined') return;

    const applyCast = (cast: unknown) => {
      if (!Array.isArray(cast)) return;
      const normalizedCast = cast
        .filter((member): member is Record<string, unknown> => Boolean(member && typeof member === 'object'))
        .filter((member) => typeof member.id === 'string' && member.id.trim().length > 0)
        .map((member) => ({
          id: String(member.id).trim(),
          firstName: typeof member.firstName === 'string' ? member.firstName : '',
          lastName: typeof member.lastName === 'string' ? member.lastName : '',
        }));
      setWizardCast(normalizedCast);
    };

    const onWizardView = (event: Event) => {
      sawLiveWizardEvent.current = true;
      const detail = (event as CustomEvent<ExpressDraftViewEventDetail>).detail;
      applyCast(detail?.cast);
    };
    window.addEventListener(EXPRESS_DRAFT_VIEW_EVENT, onWizardView as EventListener);

    // Fallback for the first render: the session may have emitted its latest
    // snapshot before this panel mounted. Any later live event wins over GET.
    let active = true;
    let draftId = '';
    try { draftId = localStorage.getItem('nova_express_draft_id') ?? ''; } catch { /* optional storage */ }
    if (draftId) {
      void wizardApi<{ payload?: { cast?: unknown } }>(`/api/express/draft/${encodeURIComponent(draftId)}`)
        .then((draft) => {
          if (active && !sawLiveWizardEvent.current) applyCast(draft.payload?.cast);
        })
        .catch(() => undefined);
    }

    return () => {
      active = false;
      window.removeEventListener(EXPRESS_DRAFT_VIEW_EVENT, onWizardView as EventListener);
    };
  }, []);

  const setAnswer = (stepId: string, text: string) => {
    const next: HeroArcStateWithAnalysis = {
      ...state,
      answers: { ...state.answers, [stepId]: text },
    };
    onChange(markHeroArcAnalysisStale(next) ?? next);
  };

  const setIntensity = (i: number, v: number) => {
    onChange(applyHeroArcOverride(state, i, v));
  };

  const resetIntensity = (i: number) => {
    onChange(clearHeroArcOverride(state, i));
  };

  const selectHero = (selectedHeroId: string) => {
    const id = selectedHeroId.trim() || undefined;
    const analysis = state.analysis && state.analysis.heroId !== id
      ? { ...state.analysis, status: 'stale' as const }
      : state.analysis;
    onChange({
      ...state,
      selectedHeroId: id,
      ...(analysis ? { analysis } : {}),
    });
  };

  const selectedHero = wizardCast?.find((member) => member.id === state.selectedHeroId);
  const displayedHeroName = inWizard
    ? selectedHero
      ? `${selectedHero.firstName} ${selectedHero.lastName}`.trim()
      : ''
    : heroName ?? '';

  const step = HERO_ARC_STEPS[activeStep];
  const W = 460;
  const H = compact ? 200 : 260;
  const padX = 28;
  const padTop = 18;
  const padBottom = 26;
  const zeroY = padTop + (H - padTop - padBottom) / 2;
  const scaleY = (H - padTop - padBottom) / 2 / 10;
  const xFor = (i: number) => padX + (i * (W - 2 * padX)) / (HERO_ARC_BEATS.length - 1);
  const yFor = (v: number) => zeroY - v * scaleY;
  const points: Array<[number, number]> = displayIntensities.map((v, i) => [xFor(i), yFor(v)]);
  const pathD = catmullRomPath(points);
  const fillD = `${pathD} L${xFor(HERO_ARC_BEATS.length - 1).toFixed(1)},${zeroY.toFixed(1)} L${xFor(0).toFixed(1)},${zeroY.toFixed(1)} Z`;
  const bandStarts = [0, 5, 11, 14];
  const bandFills = ['rgba(52,211,153,0.06)', 'rgba(244,63,94,0.05)', 'rgba(96,165,250,0.06)'];
  const analysis = state.analysis;
  const analysisLabel = !analysis
    ? 'JEV: ще не аналізовано'
    : analysis.status === 'fresh'
      ? `JEV: актуально${analysis.model ? ` · ${analysis.model}` : ''}`
      : analysis.status === 'stale'
        ? 'JEV: потрібен повторний аналіз'
        : analysis.status === 'pending'
          ? 'JEV: аналіз…'
          : 'JEV: помилка аналізу';

  return (
    <div ref={rootRef} className="rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
        <div className="min-w-0">
          <span className="font-bold text-slate-100 text-sm block truncate">
            Крива головного героя{displayedHeroName ? `: ${displayedHeroName}` : ''}
          </span>
          <span className="text-[10px] text-slate-500">Шлях героя — {progress}/{HERO_ARC_STEPS.length} кроків заповнено</span>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-mono ${
          analysis?.status === 'fresh'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : analysis?.status === 'stale'
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              : 'border-slate-700 bg-slate-950 text-slate-500'
        }`}>
          {analysisLabel}
        </span>
      </div>

      {inWizard && wizardCast && wizardCast.length > 0 && (
        <div className="mx-3.5 mt-3 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.06] p-3">
          <label className="block text-[11px] font-semibold text-cyan-200">
            Головний герой
            <select
              value={state.selectedHeroId ?? ''}
              onChange={(event) => selectHero(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-cyan-500"
            >
              <option value="">— оберіть протагоніста —</option>
              {wizardCast.map((member, index) => {
                const name = `${member.firstName} ${member.lastName}`.trim() || `Герой ${index + 1}`;
                return <option key={member.id} value={member.id}>{name}</option>;
              })}
            </select>
          </label>
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
            {state.selectedHeroId
              ? 'JEV автоматично перерахує емоційну криву після підтвердження синопсису та повної структури.'
              : 'Протагоніст не визначається за порядком персонажів: його обирає автор.'}
          </p>
        </div>
      )}

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
              <circle key={i} cx={x} cy={y} r={4.5} fill={valenceColor(displayIntensities[i])} stroke="#0f172a" strokeWidth={1.5} />
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
            {HERO_ARC_BEATS.map((b, i) => {
              const analysisPoint = analysis?.points.find((point) => point.beatIndex === i);
              const hasOverride = typeof analysisPoint?.authorOverride === 'number';
              return (
                <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5">
                  <div className="flex items-start justify-between gap-2 text-[10px]">
                    <span className="text-slate-300 truncate">{i + 1}. {b.title}</span>
                    <div className="shrink-0 text-right font-mono">
                      {analysisPoint ? (
                        <span className="text-slate-500">
                          JEV: {analysisPoint.jevValue}
                          {hasOverride && <span className="text-amber-300"> / Автор: {analysisPoint.authorOverride}</span>}
                        </span>
                      ) : (
                        <span className="text-slate-500">{displayIntensities[i]}</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      type="range"
                      min={-10}
                      max={10}
                      step={1}
                      value={displayIntensities[i]}
                      onChange={(e) => setIntensity(i, Number(e.target.value))}
                      className="min-w-0 flex-1 accent-amber-400"
                    />
                    {hasOverride && (
                      <button
                        type="button"
                        onClick={() => resetIntensity(i)}
                        title="Скинути авторську правку до значення JEV"
                        aria-label={`Скинути авторську правку точки ${i + 1}`}
                        className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-amber-300"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {analysisPoint?.dominantEmotion && (
                    <div className="mt-1 truncate text-[9px] text-slate-600" title={analysisPoint.explanation}>
                      {analysisPoint.dominantEmotion}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
