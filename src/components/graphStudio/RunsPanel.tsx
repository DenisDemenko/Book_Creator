/**
 * Graph Studio → «Запуски» (Т5.4 В3, `PLAN_WORKFLOW_ENGINE.md`; ТЗ Graph
 * Studio §27 Workflow Observability, §31, §39 №24): журнал запусків
 * опублікованих процесів ШІ і трасування кожного — рішення вузлів,
 * впевненість, затримка, токени, вартість, попередження й помилки.
 *
 * Керування (рішення власника §2 п.3 — адмін і право публікації схем):
 * PAUSE / RESUME / CANCEL, REPLAY (та сама версія й вхід), FORK (від кроку),
 * ручний запуск. Сервер перевіряє кожну дію.
 *
 * Т5.5: вузли Jev — джерело рішення (Jev, запасний LLM), розподіл,
 * маршрутизація за впевненістю, друга перевірка й узгодження моделей;
 * підпроцеси — посилання на дочірній запуск.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitFork, Loader2, Pause, Play, PlayCircle, RefreshCcw, RotateCcw, Square } from 'lucide-react';
import { gs, type GsAbilities } from './gsApi';

interface Run {
  id: string;
  workflowId: string;
  versionId: string;
  version: number;
  projectId: string | null;
  status: 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
  mode: 'normal' | 'replay' | 'fork' | 'subgraph';
  parentRunId: string | null;
  forkStep: number | null;
  trigger: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  currentNode: string | null;
  pauseRequested: boolean;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  startedBy: string;
  createdAt: string;
  finishedAt: string | null;
}
interface Step {
  id: string;
  seq: number;
  nodeId: string;
  nodeType: string;
  status: 'succeeded' | 'failed' | 'paused';
  retryCount: number;
  branch: string | null;
  latencyMs: number;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  decision: string | null;
  confidence: number | null;
  validationResult: string | null;
  humanResult: string | null;
  error: string | null;
  warnings: string[];
  details: Record<string, unknown>;
}
interface Detail {
  run: Run;
  steps: Step[];
  version: { id: string; version: number; environment: string; definition: { nodes: { id: string; type: string; label?: string }[] } | null } | null;
  parent: { id: string; workflowId?: string; status: string; mode: string } | null;
  children: { id: string; workflowId?: string; mode: string; status: string; createdAt: string }[];
}

const STATUS: Record<Run['status'], { label: string; cls: string }> = {
  running: { label: 'Running (Виконується)', cls: 'border-sky-500/50 bg-sky-500/15 text-sky-200' },
  paused: { label: 'Paused (Призупинено)', cls: 'border-amber-500/50 bg-amber-500/15 text-amber-200' },
  succeeded: { label: 'Succeeded (Успішно)', cls: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200' },
  failed: { label: 'Failed (Помилка)', cls: 'border-rose-500/50 bg-rose-500/15 text-rose-200' },
  cancelled: { label: 'Cancelled (Скасовано)', cls: 'border-slate-600 bg-slate-800 text-slate-300' },
};
const STEP_CLS: Record<Step['status'], string> = { succeeded: 'text-emerald-300', failed: 'text-rose-300', paused: 'text-amber-300' };
const MODE: Record<Run['mode'], string> = { normal: '', replay: 'REPLAY (Повтор)', fork: 'FORK (Відгалуження)', subgraph: 'SUBGRAPH (Підпроцес)' };
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('uk-UA') : '—');
/**
 * Ціна запуску. Суми, менші за десятитисячну долара, досі друкувались як
 * «$0.0000» — тобто як нуль, хоч токени витрачено (один хід Jev коштує
 * ≈$0.00003 при $0.042 за 1 млн вхідних токенів). Для таких сум показуємо
 * шість знаків; для решти — як було.
 */
const fmtCost = (v: number) => (v && Math.abs(v) < 0.0001 ? `$${v.toFixed(6)}` : `$${v.toFixed(v < 0.01 ? 4 : 3)}`);
const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} с` : `${v} мс`);
const sel = 'min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100';

const SOURCE: Record<string, string> = { jev: 'Jev', llm_fallback: 'Fallback LLM (запасний LLM)', mock: 'Mock Jev (тестовий)' };
const ACTION: Record<string, string> = { AUTO_ROUTE: 'Автоматично', SECOND_OPINION: 'Друга перевірка', HUMAN_REVIEW: 'Перевірка людиною', FALLBACK: 'Резервний маршрут' };
const TIER: Record<string, string> = { high: 'висока', medium: 'середня', low: 'низька' };

/** Т5.5: рішення вузла Jev і підпроцес — що відповіло, з яким розподілом і куди повело. */
const JevStepDetails: React.FC<{ s: Step; onOpenRun: (id: string) => void }> = ({ s, onOpenRun }) => {
  const d = s.details as {
    source?: string; fallbackReason?: string; answers?: Record<string, { kind: string; selected?: string; distribution?: Record<string, number>; value?: number; probability?: number; confidence: number | null }>;
    routing?: { tier: string; action: string; by?: string }; consensus?: { policy?: string; agree?: boolean; jev?: Record<string, unknown>; a?: { model?: string; answers?: Record<string, unknown>; error?: string }; b?: { model?: string; answers?: Record<string, unknown>; error?: string } };
    secondOpinion?: { model?: string; agree?: boolean; error?: string }; subgraph?: { runId: string; workflowId: string; version: number; status: string };
  };
  const isJev = s.nodeType.startsWith('JEV_');
  if (!isJev && !d.subgraph) return null;
  return (
    <div className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2" data-run-jev={s.nodeId}>
      {isJev && (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-amber-500/40 px-1.5 text-amber-200" data-run-jev-source={d.source ?? 'none'}>{d.source ? SOURCE[d.source] ?? d.source : 'без відповіді'}</span>
          {d.fallbackReason && <span className="text-slate-400">чому запасний: {d.fallbackReason}</span>}
          {d.routing && <span className="text-slate-300" data-run-jev-routing={d.routing.action}>впевненість {TIER[d.routing.tier] ?? d.routing.tier} → {ACTION[d.routing.action] ?? d.routing.action}{d.routing.by === 'consensus' ? ' (за згодою моделей)' : ''}</span>}
        </p>
      )}
      {Object.entries(d.answers ?? {}).map(([qid, a]) => {
        const dist = Object.entries(a.distribution ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 6);
        return (
          <div key={qid} className="text-slate-300" data-run-jev-answer={qid}>
            <span className="font-mono text-slate-500">{qid}</span>{' '}
            {a.kind === 'choice' ? <b className="text-amber-200">{a.selected}</b> : a.kind === 'score' ? <b className="text-amber-200">{a.value}</b> : <b className="text-amber-200">p = {a.probability}</b>}
            {a.confidence != null && <span className="text-slate-500"> · впевненість {a.confidence.toFixed(2)}</span>}
            {dist.length > 0 && (
              <div className="mt-0.5 grid max-w-md gap-0.5" data-run-jev-dist={qid}>
                {dist.map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className="w-24 truncate text-right text-slate-400">{k}</span>
                    <span className="h-1.5 rounded bg-amber-400/70" style={{ width: `${Math.max(2, Math.round(v * 160))}px` }} />
                    <span className="text-slate-500">{v.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {d.secondOpinion && (
        <p className={d.secondOpinion.agree ? 'text-emerald-300' : 'text-rose-300'} data-run-jev-second={d.secondOpinion.agree ? 'agree' : 'disagree'}>
          Друга перевірка{d.secondOpinion.model ? ` (${d.secondOpinion.model})` : ''}: {d.secondOpinion.error ? `помилка — ${d.secondOpinion.error}` : d.secondOpinion.agree ? 'збіглась' : 'не збіглась → review'}
        </p>
      )}
      {d.consensus && d.consensus.agree !== undefined && (
        <p className={d.consensus.agree ? 'text-emerald-300' : 'text-rose-300'} data-run-jev-consensus={d.consensus.agree ? 'agree' : 'disagree'}>
          Узгодження ({d.consensus.policy}): Jev {JSON.stringify(d.consensus.jev)} · A{d.consensus.a?.model ? ` ${d.consensus.a.model}` : ''} {d.consensus.a?.error ?? JSON.stringify(d.consensus.a?.answers)} · B{d.consensus.b?.model ? ` ${d.consensus.b.model}` : ''} {d.consensus.b?.error ?? JSON.stringify(d.consensus.b?.answers)} → {d.consensus.agree ? 'згода' : 'розбіжність → review'}
        </p>
      )}
      {d.consensus && d.consensus.agree === undefined && d.consensus.policy && d.consensus.policy !== 'вимкнено' && <p className="text-slate-500">Узгодження не запускалось: {d.consensus.policy}</p>}
      {d.subgraph && (
        <button type="button" onClick={() => onOpenRun(d.subgraph!.runId)} className="text-violet-300 hover:underline" data-run-subgraph={d.subgraph.workflowId}>
          ↳ підпроцес {d.subgraph.workflowId} v{d.subgraph.version} — {d.subgraph.status} ({d.subgraph.runId.slice(0, 8)})
        </button>
      )}
    </div>
  );
};

const ContinuityStepDetails: React.FC<{ s: Step }> = ({ s }) => {
  const report = s.details.continuity as {
    passed: boolean;
    checks: string[];
    blockerCount: number;
    warningCount: number;
    blockers: { code: string; kind: string; summary: string; evidence?: string[] }[];
    warnings: { summary: string }[];
  } | undefined;
  if (!report) return null;
  return (
    <div data-run-continuity={s.nodeId} data-continuity-result={report.passed ? 'pass' : 'block'} className="space-y-1 break-words rounded border border-slate-700 p-2">
      <p className={report.passed ? 'text-emerald-300' : 'text-rose-300'}>
        Continuity Gate (Шлюз безперервності): {report.passed ? 'пройдено' : 'запис у канон заблоковано'}
      </p>
      <p>Перевірки: {report.checks.join(', ')} · Блокувань: {report.blockerCount} · Попереджень: {report.warningCount}</p>
      {report.blockers.map((issue, i) => (
        <p key={i} data-continuity-blocker>
          {issue.summary}{issue.evidence?.length ? ` · Докази: ${issue.evidence.join(', ')}` : ''}
        </p>
      ))}
      {report.warnings.map((issue, i) => <p key={i} className="text-amber-300">{issue.summary}</p>)}
    </div>
  );
};

export const RunsPanel: React.FC<{ abilities: GsAbilities }> = ({ abilities }) => {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [workflows, setWorkflows] = useState<{ id: string; name: string; production: number | null }[]>([]);
  const [filter, setFilter] = useState<{ workflowId: string; status: string }>({ workflowId: '', status: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewPayload,setReviewPayload]=useState('');
  const review=detail?.run.output?.review as {proposalId:string;expectedRevision:number;payload:Record<string,unknown>;evidence:string[];validation:{ok:boolean;errors:{message:string}[]}|null;confidence:number|null;provenance:Record<string,unknown>}|undefined;
  useEffect(()=>{setReviewPayload(review?JSON.stringify(review.payload,null,2):'');},[detail?.run.id,review?.expectedRevision]);
  const [forkStep, setForkStep] = useState<number | ''>('');
  const [manual, setManual] = useState<{ workflowId: string; projectId: string; input: string }>({ workflowId: '', projectId: '', input: '{}' });
  const canControl = abilities.canPublish;

  const loadRuns = useCallback(async () => {
    const q = new URLSearchParams({ limit: '100', ...(filter.workflowId ? { workflowId: filter.workflowId } : {}), ...(filter.status ? { status: filter.status } : {}) });
    const r = await gs<{ runs: Run[] }>('GET', `/api/core/workflow-runs?${q}`);
    setRuns(r.runs);
  }, [filter]);
  const loadDetail = useCallback(async (id: string) => {
    setDetail(await gs<Detail>('GET', `/api/core/workflow-runs/${id}`));
  }, []);

  useEffect(() => {
    void gs<{ workflows: { workflow: { id: string; name: { en: string; uk: string } }; production: { version: number } | null }[] }>('GET', '/api/core/workflows')
      .then((r) => setWorkflows(r.workflows.map((w) => ({ id: w.workflow.id, name: `${w.workflow.name.en} (${w.workflow.name.uk})`, production: w.production?.version ?? null }))))
      .catch(() => {});
  }, []);
  useEffect(() => {
    void loadRuns().catch((e) => setNotice({ kind: 'error', text: (e as Error).message }));
  }, [loadRuns]);
  useEffect(() => {
    if (selected) void loadDetail(selected).catch((e) => setNotice({ kind: 'error', text: (e as Error).message }));
  }, [selected, loadDetail]);
  // Поки щось виконується — оновлювати журнал і відкритий запуск.
  const live = useMemo(() => (runs ?? []).some((r) => r.status === 'running') || detail?.run.status === 'running', [runs, detail]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      void loadRuns().catch(() => {});
      if (selected) void loadDetail(selected).catch(() => {});
    }, 2500);
    return () => clearInterval(id);
  }, [live, selected, loadRuns, loadDetail]);

  const act = async (fn: () => Promise<{ run: Run }>, ok: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const { run } = await fn();
      setNotice({ kind: 'ok', text: ok });
      await loadRuns();
      setSelected(run.id);
      await loadDetail(run.id);
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const labelOf = (nodeId: string) => detail?.version?.definition?.nodes.find((n) => n.id === nodeId)?.label || nodeId;
  const warnings = detail ? detail.steps.reduce((a, s) => a + s.warnings.length, 0) : 0;
  const errors = detail ? detail.steps.filter((s) => s.status === 'failed').length : 0;
  const forkable = detail ? detail.steps.filter((s) => s.status === 'succeeded') : [];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]" data-gs-runs="ready">
      {/* Журнал */}
      <div className="min-w-0 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={filter.workflowId} onChange={(e) => setFilter((f) => ({ ...f, workflowId: e.target.value }))} className={`${sel} flex-1`} data-runs-filter-workflow>
            <option value="">Усі процеси</option>
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.id}</option>)}
          </select>
          <select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))} className={sel} data-runs-filter-status>
            <option value="">Усі стани</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button type="button" onClick={() => void loadRuns()} className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800" title="Оновити" data-runs-refresh><RefreshCcw className="h-3.5 w-3.5" /></button>
        </div>
        {!runs ? (
          <div className="grid place-items-center py-8 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : !runs.length ? (
          <p className="text-xs text-slate-500" data-runs-empty>Запусків ще немає. Опубліковані процеси запускаються задачами Студії (AI-1, AI-2), допитом героя або вручну.</p>
        ) : (
          <ul className="max-h-[32rem] space-y-1 overflow-y-auto pr-1">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r.id)}
                  className={`w-full rounded-xl border px-2.5 py-2 text-left text-[11px] ${selected === r.id ? 'border-amber-500/60 bg-amber-500/10' : 'border-slate-800 bg-slate-950/60 hover:border-slate-600'}`}
                  data-run-row={r.id}
                  data-run-status={r.status}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono font-bold text-slate-100">{r.workflowId}</span>
                    <span className="text-slate-500">v{r.version}</span>
                    <span className={`ml-auto shrink-0 rounded-full border px-1.5 text-[10px] ${STATUS[r.status].cls}`}>{STATUS[r.status].label.split(' ')[0]}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-slate-400">
                    <span>{r.trigger}</span>
                    {MODE[r.mode] && <span className="text-violet-300">{MODE[r.mode]}</span>}
                    <span>{fmtTime(r.createdAt)}</span>
                    <span>{r.tokensIn + r.tokensOut} ток.</span>
                    <span>{fmtCost(r.costUsd)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {canControl && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              let input: Record<string, unknown>;
              try {
                input = JSON.parse(manual.input || '{}');
              } catch {
                setNotice({ kind: 'error', text: 'Вхід — JSON-обʼєкт' });
                return;
              }
              void act(() => gs('POST', '/api/core/workflow-runs', { workflowId: manual.workflowId, projectId: manual.projectId || null, input }), 'Запуск створено — стан оновлюється в журналі.');
            }}
            className="space-y-1.5 border-t border-slate-800 pt-2"
            data-run-manual
          >
            <p className="flex items-center gap-1 text-[11px] font-bold text-slate-200"><PlayCircle className="h-3.5 w-3.5 text-amber-400" /> Manual run (Ручний запуск)</p>
            <select value={manual.workflowId} onChange={(e) => setManual((m) => ({ ...m, workflowId: e.target.value }))} className={`${sel} w-full`} data-run-manual-workflow>
              <option value="">Процес…</option>
              {workflows.filter((w) => w.production).map((w) => <option key={w.id} value={w.id}>{w.name} · v{w.production}</option>)}
            </select>
            <input value={manual.projectId} onChange={(e) => setManual((m) => ({ ...m, projectId: e.target.value }))} placeholder="id книги (необовʼязково)" className={`${sel} w-full`} data-run-manual-project />
            <textarea value={manual.input} onChange={(e) => setManual((m) => ({ ...m, input: e.target.value }))} rows={3} className={`${sel} w-full font-mono`} placeholder='{"paragraphIds": ["…"]}' data-run-manual-input />
            <button type="submit" disabled={busy || !manual.workflowId} className="flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 disabled:opacity-40" data-run-manual-start>
              <Play className="h-3 w-3" /> Запустити опубліковану версію
            </button>
          </form>
        )}
      </div>

      {/* Запуск і трасування */}
      <div className="min-w-0 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3" data-run-detail={detail?.run.id ?? ''}>
        {notice && <p className={`rounded-lg px-2.5 py-1.5 text-[11px] ${notice.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'}`} data-runs-notice={notice.kind}>{notice.text}</p>}
        {!detail ? (
          <p className="text-xs text-slate-500">Оберіть запуск у журналі — тут буде трасування: рішення вузлів, впевненість, затримка, токени, вартість і помилки (§27).</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm font-bold text-white">{detail.run.workflowId} <span className="font-normal text-slate-400">v{detail.run.version}{detail.version ? ` · ${detail.version.environment}` : ''}</span></p>
                <p className="text-[11px] text-slate-400">
                  {detail.run.trigger} · {detail.run.startedBy} · {fmtTime(detail.run.createdAt)}{detail.run.finishedAt ? ` → ${fmtTime(detail.run.finishedAt)}` : ''}
                  {detail.run.projectId ? ` · книга ${detail.run.projectId}` : ''}
                </p>
                {detail.parent && (
                  <button type="button" onClick={() => setSelected(detail.parent!.id)} className="text-[11px] text-violet-300 hover:underline" data-run-parent>
                    {MODE[detail.run.mode]} від запуску {detail.parent.workflowId && detail.run.mode === 'subgraph' ? `${detail.parent.workflowId} ` : ''}{detail.parent.id.slice(0, 8)}{detail.run.forkStep ? `, після кроку ${detail.run.forkStep}` : ''}
                  </button>
                )}
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS[detail.run.status].cls}`} data-run-detail-status={detail.run.status}>{STATUS[detail.run.status].label}</span>
            </div>

            {/* §27: TOKENS / COST / LATENCY / WARNINGS / ERRORS */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5" data-run-totals>
              {[
                ['TOKENS (Токени)', `${detail.run.tokensIn} → ${detail.run.tokensOut}`],
                ['COST (Вартість)', fmtCost(detail.run.costUsd)],
                ['LATENCY (Затримка)', fmtMs(detail.run.latencyMs)],
                ['WARNINGS (Попередження)', String(warnings)],
                ['ERRORS (Помилки)', String(errors)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-slate-800 bg-slate-950/60 px-2 py-1.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{k}</p>
                  <p className="text-xs font-bold text-slate-100">{v}</p>
                </div>
              ))}
            </div>
            {detail.run.error && <p className="flex items-start gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200" data-run-error><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {detail.run.error}</p>}

            {canControl && detail.run.status==='paused' && review && <section data-human-review className="space-y-2 rounded-xl border border-amber-500/50 p-3">
              <h3>Перевірка пропозиції людиною</h3><p className="text-xs">Перевірте зміст і докази. Лише ваше явне підтвердження дозволяє наступному вузлу запис у канон.</p>
              <button type="button" disabled={busy} data-review-refresh onClick={()=>void loadDetail(detail.run.id).catch(e=>setNotice({kind:'error',text:(e as Error).message}))} className="rounded border border-slate-600 px-2 py-1 text-xs">Перечитати пропозицію</button>
              <p className="text-xs">Докази: {review.evidence.join(', ')||'не вказані'}</p>
              <p className="text-xs">Впевненість: {review.confidence??"невідома"} · Перевірка: {review.validation?.ok?"пройдено":"потребує правок"}</p>
              {review.validation?.errors.map((e,i)=><p key={i} className="text-xs text-rose-300">{e.message}</p>)}
              <details className="text-xs"><summary>Походження пропозиції</summary><pre className="whitespace-pre-wrap">{JSON.stringify(review.provenance,null,2)}</pre></details>
              <textarea aria-label="Виправлений зміст пропозиції" className="w-full bg-slate-950 p-2 text-xs" rows={6} value={reviewPayload} onChange={e=>setReviewPayload(e.target.value)}/>
              <div className="flex gap-2">{(['accept','edit','reject'] as const).map(action=><button type="button" key={action} disabled={busy} className="rounded border border-amber-500/50 px-2 py-1 text-xs" onClick={()=>void act(async()=>{const decision={action,expectedRevision:review.expectedRevision,...(action==='edit'?{payload:JSON.parse(reviewPayload)}:{})};return gs('POST',`/api/core/workflow-runs/${detail.run.id}/resume`,{review:decision});},'Рішення передано до процесу.')}>{action==='accept'?'Прийняти':action==='edit'?'Прийняти з правками':'Відхилити'}</button>)}</div>
            </section>}
            {canControl && (
              <div className="flex flex-wrap items-center gap-1.5" data-run-actions>
                {detail.run.status === 'running' && (
                  <button type="button" disabled={busy || detail.run.pauseRequested} onClick={() => void act(() => gs('POST', `/api/core/workflow-runs/${detail.run.id}/pause`), 'Пауза — перед наступним вузлом.')} className="flex items-center gap-1 rounded-lg border border-amber-500/50 px-2 py-1 text-[11px] text-amber-200" data-run-action="pause">
                    <Pause className="h-3 w-3" /> {detail.run.pauseRequested ? 'Пауза запитана…' : 'PAUSE (Призупинити)'}
                  </button>
                )}
                {detail.run.status === 'paused' && (
                  <>
                    {!review && <button type="button" disabled={busy} onClick={() => void act(() => gs('POST', `/api/core/workflow-runs/${detail.run.id}/resume`), 'Продовжено з контрольної точки.')} className="flex items-center gap-1 rounded-lg border border-emerald-500/50 px-2 py-1 text-[11px] text-emerald-200" data-run-action="resume">
                      <Play className="h-3 w-3" /> RESUME (Продовжити)
                    </button>}
                    <button type="button" disabled={busy} onClick={() => void act(() => gs('POST', `/api/core/workflow-runs/${detail.run.id}/cancel`), 'Скасовано.')} className="flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-[11px] text-slate-300" data-run-action="cancel">
                      <Square className="h-3 w-3" /> CANCEL (Скасувати)
                    </button>
                  </>
                )}
                {detail.run.status !== 'running' && (
                  <button type="button" disabled={busy} onClick={() => void act(() => gs('POST', `/api/core/workflow-runs/${detail.run.id}/replay`), 'Повтор — та сама версія й вхід.')} className="flex items-center gap-1 rounded-lg border border-sky-500/50 px-2 py-1 text-[11px] text-sky-200" data-run-action="replay">
                    <RotateCcw className="h-3 w-3" /> REPLAY (Повторити)
                  </button>
                )}
                {detail.run.status !== 'running' && forkable.length > 0 && (
                  <span className="flex items-center gap-1">
                    <select value={forkStep} onChange={(e) => setForkStep(e.target.value ? Number(e.target.value) : '')} className={sel} data-run-fork-step>
                      <option value="">FORK після кроку…</option>
                      {detail.steps.filter((s) => s.status === 'succeeded').map((s, i) => <option key={s.id} value={i + 1}>{i + 1}. {labelOf(s.nodeId)}</option>)}
                    </select>
                    <button type="button" disabled={busy || forkStep === ''} onClick={() => void act(() => gs('POST', `/api/core/workflow-runs/${detail.run.id}/fork`, { afterStep: forkStep }), 'Відгалуження створено.')} className="flex items-center gap-1 rounded-lg border border-violet-500/50 px-2 py-1 text-[11px] text-violet-200 disabled:opacity-40" data-run-action="fork">
                      <GitFork className="h-3 w-3" /> FORK (Відгалузити)
                    </button>
                  </span>
                )}
              </div>
            )}

            {/* §27: RUN LOG / TRACE */}
            <div className="overflow-x-auto rounded-xl border border-slate-800" data-run-trace>
              {detail.steps.filter(s => s.details.continuity).map(s => (
                <div key={s.id} className="space-y-1 border-b border-slate-800 p-2 text-[11px]">
                  <p className="font-semibold text-slate-100">{labelOf(s.nodeId)}</p>
                  <ContinuityStepDetails s={s} />
                </div>
              ))}
              <table className="w-full min-w-[46rem] text-left text-[11px]">
                <thead className="bg-slate-950/80 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">Node (Вузол)</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5">Decision / branch</th>
                    <th className="px-2 py-1.5">Confidence</th>
                    <th className="px-2 py-1.5">Model</th>
                    <th className="px-2 py-1.5">Tokens</th>
                    <th className="px-2 py-1.5">Cost</th>
                    <th className="px-2 py-1.5">Latency</th>
                    <th className="px-2 py-1.5">Retries</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.steps.map((s) => (
                    <React.Fragment key={s.id}>
                      <tr className="border-t border-slate-800" data-run-step={s.nodeId} data-run-step-status={s.status}>
                        <td className="px-2 py-1.5 text-slate-500">{s.seq}</td>
                        <td className="px-2 py-1.5"><span className="font-semibold text-slate-100">{labelOf(s.nodeId)}</span> <span className="font-mono text-[10px] text-slate-500">{s.nodeType}</span></td>
                        <td className={`px-2 py-1.5 font-bold ${STEP_CLS[s.status]}`}>{s.status}</td>
                        <td className="px-2 py-1.5 text-slate-300">{[s.decision, s.validationResult, s.branch && s.branch !== s.decision && s.branch !== s.validationResult ? `→ ${s.branch}` : null].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-300">{s.confidence == null ? '—' : s.confidence.toFixed(2)}</td>
                        <td className="px-2 py-1.5 font-mono text-[10px] text-slate-300">{s.model ?? '—'}</td>
                        <td className="px-2 py-1.5 text-slate-300">{s.tokensIn || s.tokensOut ? `${s.tokensIn} → ${s.tokensOut}` : '—'}</td>
                        <td className="px-2 py-1.5 text-slate-300">{s.costUsd ? fmtCost(s.costUsd) : '—'}</td>
                        <td className="px-2 py-1.5 text-slate-300">{fmtMs(s.latencyMs)}</td>
                        <td className="px-2 py-1.5 text-slate-300">{s.retryCount || '—'}</td>
                      </tr>
                      {(s.error || (s.warnings.length > 0 && !s.details.continuity) || s.nodeType.startsWith('JEV_') || (s.details as { subgraph?: unknown }).subgraph) && (
                        <tr className="border-t border-slate-900/80">
                          <td />
                          <td colSpan={9} className="space-y-1 px-2 pb-1.5 text-[10px]">
                            <JevStepDetails s={s} onOpenRun={setSelected} />
                            {s.error && <p className="text-rose-300" data-run-step-error>✗ {s.error}</p>}
                            {!s.details.continuity && s.warnings.map((w, i) => <p key={i} className="text-amber-300">⚠ {w}</p>)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {!detail.steps.length && (
                    <tr><td colSpan={10} className="px-2 py-3 text-center text-slate-500">Кроків ще немає.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <details className="text-[11px] text-slate-400">
              <summary className="cursor-pointer">Input / output (Вхід і результат)</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-950 p-2 text-[10px] text-slate-300">{JSON.stringify({ input: detail.run.input, output: detail.run.output }, null, 1)}</pre>
            </details>
            {detail.children.length > 0 && (
              <p className="text-[11px] text-slate-400">Похідні запуски: {detail.children.map((c) => (
                <button key={c.id} type="button" onClick={() => setSelected(c.id)} className="mr-2 text-violet-300 hover:underline" data-run-child={c.mode}>{c.mode}{c.workflowId && c.mode === 'subgraph' ? ` ${c.workflowId}` : ''} {c.id.slice(0, 8)} ({c.status})</button>
              ))}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default RunsPanel;
