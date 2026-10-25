import React, { useMemo, useState } from 'react';
import { BrainCircuit, CheckCircle2, CircleAlert, Cpu, DollarSign, Gauge, RotateCcw, ShieldAlert } from 'lucide-react';
import { AttentionAurora } from './AttentionAurora';

export type JevDecisionSource = 'jev' | 'mock' | 'llm_fallback';

export interface JevWorkflowAnswer {
  kind: 'choice' | 'score' | 'noul';
  selected?: string;
  distribution?: Record<string, number>;
  position?: number;
  levels?: number;
  value?: number;
  probability?: number;
  confidence: number | null;
  corrected?: boolean;
}

export interface JevWorkflowOutcome {
  source: JevDecisionSource;
  model: string;
  answers: Record<string, JevWorkflowAnswer>;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  fallbackReason: string | null;
}

export interface JevReviewState {
  required: boolean;
  reason?: string;
  threshold?: number;
  needsAttention?: boolean;
}

interface JevDecisionPanelProps {
  outcome: JevWorkflowOutcome | null;
  title?: string;
  fresh?: boolean;
  review?: JevReviewState;
  needsAttention?: boolean;
  onAcknowledge?: () => void;
  onOpenWorkflow?: () => void;
  onRequestReview?: () => void;
}

const sourceLabels: Record<JevDecisionSource, string> = {
  jev: 'Jev',
  mock: 'Контрольована модель',
  llm_fallback: 'Запасний ШІ',
};

const pct = (value: number | null | undefined) =>
  value == null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);

export const JevDecisionPanel: React.FC<JevDecisionPanelProps> = ({
  outcome,
  title = 'Оцінка стану',
  fresh = false,
  review = { required: false },
  needsAttention = false,
  onAcknowledge,
  onOpenWorkflow,
  onRequestReview,
}) => {
  const [expanded, setExpanded] = useState(false);

  const minConfidence = useMemo(() => {
    if (!outcome) return null;
    const values = Object.values(outcome.answers)
      .map((answer) => answer.confidence)
      .filter((value): value is number => typeof value === 'number');
    return values.length ? Math.min(...values) : null;
  }, [outcome]);

  // Confidence is display-only here. Product/workflow rules own thresholds and
  // communicate attention/review explicitly through `needsAttention`/review.
  const attentionActive = Boolean(needsAttention || review.needsAttention || review.required || fresh);

  if (!outcome) return null;

  return (
    <AttentionAurora active={attentionActive} intensity={review.required ? 'strong' : 'soft'}>
      <section className="rounded-2xl border border-violet-500/25 bg-slate-950 p-4 text-slate-100" data-story-experience="jev-decision-panel" data-jev-source={outcome.source}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
              <BrainCircuit className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">Decision layer</span>
                <span className="rounded-full border border-slate-800 bg-slate-900 px-2 py-0.5 text-[9px] font-semibold text-slate-400">{sourceLabels[outcome.source]}</span>
                {review.required && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-200">Потрібна перевірка людини</span>}
              </div>
              <h3 className="mt-1 text-sm font-bold text-white">{title}</h3>
              <p className="mt-1 text-[10px] text-slate-500">{outcome.model}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {minConfidence != null && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-400">
                <Gauge className="h-3 w-3" /> мін. впевненість {pct(minConfidence)}%
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] text-slate-500">
              <Cpu className="h-3 w-3" /> {outcome.tokensIn + outcome.tokensOut} токенів
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] text-slate-500">
              <DollarSign className="h-3 w-3" /> {outcome.costUsd.toFixed(6)}
            </span>
          </div>
        </div>

        {outcome.fallbackReason && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] leading-4 text-amber-100/80">
            <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span><strong>Використано fallback.</strong> {outcome.fallbackReason}</span>
          </div>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(outcome.answers).map(([id, answer]) => (
            <AnswerCard key={id} id={id} answer={answer} />
          ))}
        </div>

        {review.required && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] leading-4 text-amber-100/80">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{review.reason || 'Результат не повинен застосовуватися автоматично без підтвердження користувача.'}</span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setExpanded((value) => !value)} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">
            {expanded ? 'Сховати технічні дані' : 'Показати деталі'}
          </button>
          {onOpenWorkflow && <button type="button" onClick={onOpenWorkflow} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">Відкрити процес</button>}
          {review.required && onRequestReview && <button type="button" onClick={onRequestReview} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">Перевірити вручну</button>}
          {fresh && onAcknowledge && <button type="button" onClick={onAcknowledge} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950">Помічено</button>}
        </div>

        {expanded && (
          <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-800 bg-black/30 p-3 text-[10px] leading-4 text-slate-500">{JSON.stringify(outcome, null, 2)}</pre>
        )}
      </section>
    </AttentionAurora>
  );
};

const AnswerCard: React.FC<{ id: string; answer: JevWorkflowAnswer }> = ({ id, answer }) => {
  const confidence = pct(answer.confidence);
  const yesProbability = pct(answer.probability);
  const mainValue = answer.kind === 'choice'
    ? answer.selected || '—'
    : answer.kind === 'score'
      ? answer.value ?? answer.position ?? '—'
      : yesProbability == null
        ? '—'
        : `${yesProbability}% так`;

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">{answer.kind}</div>
          <div className="mt-1 text-xs font-semibold text-slate-300">{id.replaceAll('_', ' ')}</div>
        </div>
        {answer.corrected ? <CircleAlert className="h-3.5 w-3.5 text-amber-300" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />}
      </div>
      <div className="mt-3 text-lg font-bold text-white">{String(mainValue)}</div>
      {confidence != null && <div className="mt-1 text-[10px] text-slate-500">Впевненість {confidence}%</div>}
      {!!answer.distribution && Object.keys(answer.distribution).length > 0 && (
        <div className="mt-3 space-y-1.5">
          {Object.entries(answer.distribution).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label, value]) => (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between text-[9px] text-slate-600"><span className="truncate pr-2">{label}</span><span>{Math.round(value * 100)}%</span></div>
              <div className="h-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
};
