import React, { useState } from "react";
import { gs } from "./gsApi";
interface Props {
  projectId: string;
  workflowId: string;
  canEvaluate: boolean;
}
/** Explicit book scope: feedback text is never loaded on selecting a global run. */
export const WorkflowInsightsPanel: React.FC<Props> = ({
  projectId,
  workflowId,
  canEvaluate,
}) => {
  const [data, setData] = useState<any>(null),
    [rows, setRows] = useState<any[] | null>(null),
    [cases, setCases] = useState("[]"),
    [evaluation, setEvaluation] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const query = new URLSearchParams({
    projectId,
    ...(workflowId ? { workflowId } : {}),
  });
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  React.useEffect(() => {
    setData(null);
    setRows(null);
    setEvaluation(null);
    setCases("[]");
    setError("");
  }, [projectId, workflowId]);
  return (
    <section
      data-workflow-insights
      className="space-y-2 rounded-xl border border-slate-700 p-2 text-xs"
    >
      <p className="font-semibold">Аналітика, feedback та оптимізатор</p>
      <p>
        Книга: {projectId || "оберіть запуск книги"} · процес:{" "}
        {workflowId || "усі"}. Рекомендації не змінюють production; самонавчання
        вимкнено.
      </p>
      <button
        data-insights-load
        disabled={busy || !projectId}
        className="rounded border border-sky-600 px-2 py-1"
        onClick={() =>
          void action(async () => {
            setData(
              await gs("GET", `/api/core/workflow-runs/analytics?${query}`),
            );
          })
        }
      >
        Показати аналітику
      </button>
      {error && (
        <p role="alert" className="break-words text-rose-300">
          {error}
        </p>
      )}
      {data && (
        <div data-insights-metrics className="space-y-1 break-words">
          <p>
            Вибірка: {data.metrics.runs} запусків (до {data.window.maxRuns}),{" "}
            {data.metrics.reviewed} перевірених пропозицій.
          </p>
          <p>
            Прийнято: {data.metrics.accepted}; відхилено:{" "}
            {data.metrics.rejected}; з виправленнями: {data.metrics.corrected}.
          </p>
          <p>
            Acceptance: {percent(data.metrics.acceptanceRate)} · Rejection:{" "}
            {percent(data.metrics.rejectionRate)} · Correction:{" "}
            {percent(data.metrics.correctionRate)}.
          </p>
          <p>
            Середня впевненість:{" "}
            {data.metrics.averageConfidence ?? "немає даних"} (
            {data.metrics.confidenceSamples} оцінок); вартість: $
            {data.metrics.averageCost?.toFixed(6) ?? "—"}; затримка:{" "}
            {data.metrics.averageLatency?.toFixed(0) ?? "—"} мс.
          </p>
          <p>
            Помилки: {data.metrics.failures}; повтори: {data.metrics.retries}.
          </p>
          <div data-optimizer-suggestions>
            {data.suggestions.length ? (
              data.suggestions.map((s: any, i: number) => (
                <p key={i}>
                  Пропозиція: {s.reason} Доказів: {s.evidence.runIds.length}{" "}
                  запусків / {s.evidence.proposalIds.length} пропозицій.
                </p>
              ))
            ) : (
              <p>Недостатньо підстав для рекомендацій.</p>
            )}
          </div>
          <button
            data-feedback-load
            disabled={busy}
            className="rounded border border-slate-600 px-2 py-1"
            onClick={() =>
              void action(async () => {
                setRows(
                  (
                    await gs<any>(
                      "GET",
                      `/api/core/workflow-runs/feedback?${query}`,
                    )
                  ).rows,
                );
              })
            }
          >
            Показати авторські виправлення
          </button>
        </div>
      )}
      {rows && (
        <div data-feedback-dataset>
          <p>
            Набір: {rows.length} прикладів. Контекст і правки — лише з доступом
            власника/адміністратора книги.
          </p>
          {rows.map((r) => (
            <details key={r.proposalId}>
              <summary>
                {r.authorAction} · {r.proposalId} ·{" "}
                {r.complete
                  ? "контекст і канон збережено"
                  : "неповний / без канону"}
              </summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px]">
                {JSON.stringify(r, null, 2)}
              </pre>
            </details>
          ))}
          {canEvaluate && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  setEvaluation(
                    await gs(
                      "POST",
                      `/api/core/workflow-runs/feedback/evaluate?${query}`,
                      { cases: JSON.parse(cases) },
                    ),
                  );
                });
              }}
              className="space-y-1"
            >
              <p>
                Регресійне оцінювання готових результатів: [
                {'{"proposalId":"…","payload":{…}}'}]. Точне порівняння з
                погодженим каноном; моделі не викликаються.
              </p>
              <textarea
                data-feedback-cases
                className="w-full rounded bg-slate-950 p-2 font-mono"
                rows={3}
                value={cases}
                onChange={(e) => setCases(e.target.value)}
              />
              <button
                data-feedback-evaluate
                disabled={busy}
                className="rounded border border-slate-600 px-2 py-1"
              >
                Порівняти результати
              </button>
            </form>
          )}
          {evaluation && (
            <p data-feedback-evaluation>
              Перевірено: {evaluation.evaluated}; точний збіг:{" "}
              {percent(evaluation.exactMatchRate)}. Production не змінено.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
const percent = (n: number | null) =>
  n == null ? "немає даних" : `${(n * 100).toFixed(1)}%`;
