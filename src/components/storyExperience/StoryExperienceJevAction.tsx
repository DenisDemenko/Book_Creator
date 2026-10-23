import React, { useState } from 'react';
import { BrainCircuit, CircleAlert, Loader2, RefreshCw } from 'lucide-react';
import { JevDecisionPanel, type JevReviewState, type JevWorkflowOutcome } from './JevDecisionPanel';

export type StoryExperienceJevProfile =
  | 'screenplay_story_state'
  | 'mafia_gm_event'
  | 'constellation_session_status'
  | 'leela_route_status';

export interface StoryExperienceJevRequest {
  profile: StoryExperienceJevProfile;
  projectId: string;
  contextId?: string;
  state: Record<string, unknown>;
}

export interface StoryExperienceJevResponse {
  outcome: JevWorkflowOutcome;
  review?: JevReviewState;
}

export type StoryExperienceJevEvaluator = (
  request: StoryExperienceJevRequest,
) => Promise<StoryExperienceJevResponse>;

interface StoryExperienceJevActionProps {
  title: string;
  hint: string;
  request?: StoryExperienceJevRequest;
  onEvaluate?: StoryExperienceJevEvaluator;
  outcome?: JevWorkflowOutcome | null;
  fresh?: boolean;
  review?: JevReviewState;
  onAcknowledge?: () => void;
  onOpenWorkflow?: () => void;
  onRequestReview?: () => void;
}

/**
 * UX bridge між Story & Experience workspace та існуючим Jev decision layer.
 * Компонент НЕ знає URL/API і не реалізує backend. Технічний шар передає один
 * `onEvaluate(request)` callback; loading/error/result стани належать UI.
 */
export const StoryExperienceJevAction: React.FC<StoryExperienceJevActionProps> = ({
  title,
  hint,
  request,
  onEvaluate,
  outcome,
  fresh,
  review,
  onAcknowledge,
  onOpenWorkflow,
  onRequestReview,
}) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localOutcome, setLocalOutcome] = useState<JevWorkflowOutcome | null>(null);
  const [localReview, setLocalReview] = useState<JevReviewState | undefined>();

  const visibleOutcome = outcome ?? localOutcome;
  const visibleReview = review ?? localReview;
  const canEvaluate = Boolean(request && onEvaluate);

  const run = async () => {
    if (!request || !onEvaluate || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await onEvaluate(request);
      setLocalOutcome(result.outcome);
      setLocalReview(result.review);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося отримати оцінку Jev.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="border-b border-slate-800 bg-slate-950 px-4 py-3 lg:px-6" data-story-experience="jev-action">
      <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
            <BrainCircuit className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">Jev · Decision layer</div>
            <div className="mt-0.5 text-xs font-bold text-slate-100">{title}</div>
            <div className="mt-1 text-[10px] leading-4 text-slate-500">{hint}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={!canEvaluate || pending}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-bold text-violet-200 transition hover:bg-violet-500/15 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-600"
          title={!canEvaluate ? 'Очікує технічного підключення Jev callback' : undefined}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : visibleOutcome ? <RefreshCw className="h-3.5 w-3.5" /> : <BrainCircuit className="h-3.5 w-3.5" />}
          {pending ? 'Оцінюю…' : visibleOutcome ? 'Оцінити знову' : 'Оцінити Jev'}
        </button>
      </div>

      {!canEvaluate && !visibleOutcome && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-[10px] leading-4 text-slate-500">
          UI готовий. Для живої оцінки технічний шар має передати `onEvaluateWithJev(request)`; API, ключі та fallback тут не дублюються.
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[10px] leading-4 text-rose-100/80" role="alert">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {visibleOutcome && (
        <JevDecisionPanel
          outcome={visibleOutcome}
          title={title}
          fresh={fresh ?? Boolean(localOutcome)}
          review={visibleReview}
          onAcknowledge={onAcknowledge}
          onOpenWorkflow={onOpenWorkflow}
          onRequestReview={onRequestReview}
        />
      )}
    </div>
  );
};
