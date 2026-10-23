import React from 'react';
import { BrainCircuit, Gauge, ShieldCheck, TriangleAlert } from 'lucide-react';
import { AttentionAurora } from './AttentionAurora';

export type JevQuestionType = 'choice' | 'score' | 'noul';

export interface JevEvaluationResult {
  questionId: string;
  type: JevQuestionType;
  label: string;
  value: string | number | boolean;
  confidence?: number;
  probabilities?: Array<{ label: string; value: number }>;
  requiresHumanReview?: boolean;
}

interface JevEvaluationResultCardProps {
  result: JevEvaluationResult;
  fresh?: boolean;
  onOpenDetails?: () => void;
  onAcknowledge?: () => void;
}

export const JevEvaluationResultCard: React.FC<JevEvaluationResultCardProps> = ({
  result,
  fresh = false,
  onOpenDetails,
  onAcknowledge,
}) => {
  const confidence = result.confidence == null ? null : Math.round(result.confidence * 100);

  return (
    <AttentionAurora active={fresh || !!result.requiresHumanReview} intensity={result.requiresHumanReview ? 'strong' : 'soft'}>
      <article className="rounded-2xl border border-violet-500/25 bg-slate-950 p-4 text-slate-100" data-story-experience="jev-evaluation-result">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><BrainCircuit className="h-4 w-4" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">Jev AI · {result.type.toUpperCase()}</span>
                {result.requiresHumanReview && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-200">Потрібна увага людини</span>}
              </div>
              <h3 className="mt-1 text-sm font-bold text-white">{result.label}</h3>
            </div>
          </div>
          {confidence != null && (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-400"><Gauge className="h-3 w-3" /> {confidence}%</span>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Результат</div>
          <div className="mt-1 text-lg font-bold text-white">{String(result.value)}</div>
        </div>

        {!!result.probabilities?.length && (
          <div className="mt-3 space-y-2">
            {result.probabilities.map((item) => (
              <div key={item.label}>
                <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500"><span>{item.label}</span><span>{Math.round(item.value * 100)}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.max(2, Math.min(100, item.value * 100))}%` }} /></div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onOpenDetails} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"><ShieldCheck className="h-3.5 w-3.5" /> Деталі оцінки</button>
          {fresh && <button type="button" onClick={onAcknowledge} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950">Помічено</button>}
        </div>

        {result.requiresHumanReview && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] leading-4 text-amber-100/80"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Jev тут лише сигналізує про стан. Остаточне рішення лишається за користувачем або правилами продукту.</div>
        )}
      </article>
    </AttentionAurora>
  );
};
