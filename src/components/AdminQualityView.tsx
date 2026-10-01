import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Loader2, Play, RefreshCw, XCircle } from 'lucide-react';

/**
 * «Якість персонажів» — розділ адмінпанелі (Т2.8 В4, `PLAN_QUALITY.md`;
 * рішення власника §2 п.3: файл + сторінка в адмінці).
 *
 * Контрольний набір «живих персонажів» проходить справжнім ходом допиту на
 * справжніх моделях — з Jev і без Jev — і дає числа для кожного виміру:
 * ізоляція знань, спойлери, точність пам'яті, різноманітність, сталість
 * характеру, характер і стиль за оцінкою судді, час і вартість. Тут — запуск
 * із лімітом витрат, історія прогонів і звіт кожного (з Jev / без Jev поруч).
 * Регресійні ворота на підставних моделях — `npm run test:living-characters`
 * (у ланцюзі `npm test`); тут — справжні числа.
 */

type Mode = 'with_jev' | 'without_jev';
interface Gate { id: string; title: string; kind: 'hard' | 'quality'; value: number | null; limit: string; passed: boolean; skipped?: boolean }
interface Metrics {
  turns: number;
  answered: number;
  isolation: { leaks: number; checked: number; examples: string[] };
  spoilers: { leaks: number; checked: number; examples: string[] };
  memory: { accuracy: number | null; hits: number; cases: number };
  diversity: { distinctActions: number; distinctBigramRatio: number | null; repetitionRate: number | null };
  consistency: { rate: number | null; consistent: number; pairs: number };
  judge: { judged: number; characterFitAvg: number | null; styleFitAvg: number | null; contradictionRate: number | null; sources: Record<string, number>; costUsd: number };
  style: { replySentenceWords: number | null; authorSentenceWords: number | null; replyDashShare: number | null; authorDashShare: number | null };
  performance: { latencyAvgMs: number; latencyP95Ms: number; voiceCostUsd: number; decisionCostUsd: number; totalCostUsd: number; costPerTurnUsd: number; fallbackShare: number | null; decisionCalls: number };
}
interface ModeSummary { mode: Mode; passed: boolean; metrics: Metrics; gates: Gate[]; durationMs: number }
interface Turn { caseId: string; dimension: string; question: string; status: string; reply: string; action: string | null; source: string | null; error: string | null; judge: { characterFit: number | null; styleFit: number | null } | null }
interface Run {
  id: string;
  setId: string;
  setVersion: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  label: string;
  passed: boolean | null;
  summary: { passed?: boolean; modes?: ModeSummary[] };
  report: { modes: (ModeSummary & { turns: Turn[] })[] } | null;
  models: Record<string, unknown>;
  costUsd: number;
  budgetUsd: number | null;
  error: string | null;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
}
interface SetInfo { id: string; version: number; title: string; heroes: string[]; cases: { id: string; hero: string; dimension: string; question: string }[]; gates: Record<string, number>; modes: Mode[] }

const MODE_TITLE: Record<Mode, string> = { with_jev: 'з Jev', without_jev: 'без Jev (запасний LLM)' };
const DIM_TITLE: Record<string, string> = { memory: 'пам\'ять', isolation: 'ізоляція', spoiler: 'спойлери', consistency: 'сталість', diversity: 'різноманітність', style: 'стиль' };
const STATUS: Record<Run['status'], string> = { queued: 'у черзі', running: 'іде', succeeded: 'завершено', failed: 'збій' };
const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 1000) / 10}%`);
const num = (x: number | null | undefined) => (x == null ? '—' : String(x));
const usd = (x: number | null | undefined) => (x == null ? '—' : `$${x.toFixed(x < 0.01 ? 5 : 3)}`);
const when = (iso: string) => new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });

const ROWS: { title: string; cell: (m: Metrics) => string; hint?: string }[] = [
  { title: 'кейсів / з відповіддю', cell: (m) => `${m.turns} / ${m.answered}` },
  { title: 'ізоляція знань: витоків', cell: (m) => `${m.isolation.leaks} з ${m.isolation.checked}`, hint: 'чуже приватне в запиті до голосу, у стані Jev чи у відповіді' },
  { title: 'спойлери: витоків', cell: (m) => `${m.spoilers.leaks} з ${m.spoilers.checked}`, hint: 'майбутнє після межі знань' },
  { title: 'точність пам\'яті', cell: (m) => `${pct(m.memory.accuracy)} (${m.memory.hits}/${m.memory.cases})` },
  { title: 'різних дій', cell: (m) => String(m.diversity.distinctActions) },
  { title: 'повторів відповіді', cell: (m) => pct(m.diversity.repetitionRate) },
  { title: 'сталість на перефразуваннях', cell: (m) => `${pct(m.consistency.rate)} (${m.consistency.consistent}/${m.consistency.pairs})` },
  { title: 'у характері героя, 0–10', cell: (m) => num(m.judge.characterFitAvg), hint: 'оцінка судді (Jev), не факт канону' },
  { title: 'у стилі автора, 0–10', cell: (m) => num(m.judge.styleFitAvg) },
  { title: 'суперечить стану героя', cell: (m) => pct(m.judge.contradictionRate) },
  { title: 'слів у реченні: відповіді / автор', cell: (m) => `${num(m.style.replySentenceWords)} / ${num(m.style.authorSentenceWords)}` },
  { title: 'запасний шлях рішень', cell: (m) => pct(m.performance.fallbackShare) },
  { title: 'затримка ходу, сер. / p95', cell: (m) => `${m.performance.latencyAvgMs} / ${m.performance.latencyP95Ms} мс` },
  { title: 'вартість на хід', cell: (m) => usd(m.performance.costPerTurnUsd) },
  { title: 'вартість разом', cell: (m) => usd(m.performance.totalCostUsd) },
];

export const AdminQualityView: React.FC = () => {
  const [set, setSet] = useState<SetInfo | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [budgetMax, setBudgetMax] = useState(20);
  const [budget, setBudget] = useState('1');
  const [modes, setModes] = useState<Record<Mode, boolean>>({ with_jev: true, without_jev: true });
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/quality/living-characters', { credentials: 'same-origin' }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setMessage({ tone: 'err', text: data.error || 'Не вдалося прочитати набір якості.' });
      return;
    }
    setSet(data.set);
    setRuns(data.runs ?? []);
    setBudgetMax(data.budget?.maxUsd ?? 20);
    if (poll.current) clearTimeout(poll.current);
    if (data.running) poll.current = setTimeout(() => void load(), 3000);
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [load]);

  useEffect(() => {
    if (!openId) {
      setOpen(null);
      return;
    }
    void (async () => {
      const res = await fetch(`/api/admin/quality/runs/${openId}`, { credentials: 'same-origin' }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      setOpen(res?.ok ? data.run : null);
    })();
  }, [openId, runs]);

  const start = async () => {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/admin/quality/runs', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budgetUsd: Number(budget), modes: (Object.keys(modes) as Mode[]).filter((m) => modes[m]) }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setMessage({ tone: 'err', text: data.error || 'Не вдалося запустити прогін.' });
      return;
    }
    setMessage({ tone: 'ok', text: 'Прогін запущено — числа з\'являться тут, щойно він завершиться.' });
    setOpenId(data.run.id);
    void load();
  };

  const running = runs.some((r) => r.status === 'queued' || r.status === 'running');
  const summaryOf = (r: Run) => r.summary?.modes ?? [];

  return (
    <div className="space-y-4" data-quality-view>
      <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-100">Якість живих персонажів</h3>
            <p className="text-[11px] text-slate-400 mt-0.5 max-w-2xl">
              Контрольний набір проходить справжнім ходом допиту на моделях Студії — з Jev і без Jev. Ізоляцію, спойлери, пам'ять і різноманітність рахують правила;
              характер і стиль оцінює Jev як суддя (оцінка — не факт канону). Регресійні ворота на підставних моделях — <code className="text-slate-300">npm run test:living-characters</code>.
            </p>
          </div>
          <button onClick={() => void load()} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400" title="Оновити">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {set && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3 text-[11px]" data-quality-set>
            <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-2.5">
              <p className="text-slate-500">Набір</p>
              <p className="text-slate-200 font-semibold">{set.title} · v{set.version}</p>
              <p className="text-slate-500">герої: {set.heroes.join(', ')}</p>
            </div>
            <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-2.5">
              <p className="text-slate-500">Кейси: {set.cases.length}</p>
              <p className="text-slate-300">
                {Object.entries(set.cases.reduce<Record<string, number>>((a, c) => ((a[c.dimension] = (a[c.dimension] ?? 0) + 1), a), {}))
                  .map(([d, n]) => `${DIM_TITLE[d] ?? d} ${n}`)
                  .join(' · ')}
              </p>
            </div>
            <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-2.5">
              <p className="text-slate-500">Ворота</p>
              <p className="text-slate-300">
                витоків 0 · пам'ять ≥ {pct(set.gates.memoryAccuracyMin)} · сталість ≥ {pct(set.gates.consistencyMin)} · характер ≥ {set.gates.characterFitMin} · стиль ≥ {set.gates.styleFitMin}
              </p>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2" data-quality-start>
          <label className="text-[11px] text-slate-400">
            Ліміт витрат, $
            <input
              type="number"
              min={0.01}
              max={budgetMax}
              step={0.1}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              data-quality-budget
              className="ml-1.5 w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
            />
          </label>
          {(Object.keys(MODE_TITLE) as Mode[]).map((m) => (
            <label key={m} className="flex items-center gap-1 text-[11px] text-slate-300">
              <input type="checkbox" checked={modes[m]} onChange={(e) => setModes((x) => ({ ...x, [m]: e.target.checked }))} data-quality-mode={m} />
              {MODE_TITLE[m]}
            </label>
          ))}
          <button
            onClick={() => void start()}
            disabled={busy || running || !(Number(budget) > 0) || !(modes.with_jev || modes.without_jev)}
            data-quality-run
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {busy || running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} {running ? 'Прогін іде…' : 'Прогнати набір'}
          </button>
          <span className="text-[10px] text-slate-500">справжні моделі — це коштує грошей; прогін зупиняється на ліміті</span>
        </div>

        {message && (
          <div className={`mt-3 p-2.5 rounded-xl text-xs ${message.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'}`} data-quality-message>
            {message.text}
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5" data-quality-runs>
        <h3 className="text-sm font-bold text-slate-100">Прогони</h3>
        {runs.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">Прогонів ще не було.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[11px]">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-2 font-medium">Коли</th>
                  <th className="py-1 pr-2 font-medium">Стан</th>
                  <th className="py-1 pr-2 font-medium">Ворота</th>
                  <th className="py-1 pr-2 font-medium">Пам'ять</th>
                  <th className="py-1 pr-2 font-medium">Витоки</th>
                  <th className="py-1 pr-2 font-medium">Характер / стиль</th>
                  <th className="py-1 pr-2 font-medium">Витрачено</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const main = summaryOf(r).find((m) => m.mode === 'with_jev') ?? summaryOf(r)[0];
                  const leaks = summaryOf(r).reduce((a, m) => a + m.metrics.isolation.leaks + m.metrics.spoilers.leaks, 0);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setOpenId(openId === r.id ? null : r.id)}
                      data-quality-row={r.id}
                      data-quality-status={r.status}
                      className={`cursor-pointer border-t border-slate-800 hover:bg-slate-800/40 ${openId === r.id ? 'bg-slate-800/50' : ''}`}
                    >
                      <td className="py-1.5 pr-2 text-slate-300">{when(r.createdAt)}</td>
                      <td className="py-1.5 pr-2 text-slate-300">{STATUS[r.status]}{r.status === 'running' && <Loader2 className="ml-1 inline w-3 h-3 animate-spin" />}</td>
                      <td className="py-1.5 pr-2">
                        {r.passed == null ? '—' : r.passed ? <span className="text-emerald-300"><CheckCircle2 className="inline w-3 h-3" /> так</span> : <span className="text-rose-300"><XCircle className="inline w-3 h-3" /> ні</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-300">{main ? pct(main.metrics.memory.accuracy) : '—'}</td>
                      <td className={`py-1.5 pr-2 ${leaks ? 'text-rose-300 font-bold' : 'text-slate-300'}`}>{main ? leaks : '—'}</td>
                      <td className="py-1.5 pr-2 text-slate-300">{main ? `${num(main.metrics.judge.characterFitAvg)} / ${num(main.metrics.judge.styleFitAvg)}` : '—'}</td>
                      <td className="py-1.5 pr-2 text-slate-300">{usd(r.costUsd)}{r.budgetUsd ? <span className="text-slate-500"> з {usd(r.budgetUsd)}</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5" data-quality-detail={open.id}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-100">Прогін {when(open.createdAt)} — {STATUS[open.status]}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5 break-words">{open.label || '—'}</p>
              {open.error && <p className="mt-1 text-[11px] text-rose-300 break-words" data-quality-error>{open.error}</p>}
            </div>
            {open.report && (
              <a href={`/api/admin/quality/runs/${open.id}/report.md`} className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700" data-quality-download>
                <Download className="w-3.5 h-3.5" /> Звіт .md
              </a>
            )}
          </div>
          {open.report ? (
            <>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-[11px]" data-quality-metrics>
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-1 pr-2 font-medium">Вимір</th>
                      {open.report.modes.map((m) => (
                        <th key={m.mode} className="py-1 pr-2 font-medium">{MODE_TITLE[m.mode]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => (
                      <tr key={row.title} className="border-t border-slate-800">
                        <td className="py-1 pr-2 text-slate-400" title={row.hint}>{row.title}</td>
                        {open.report!.modes.map((m) => (
                          <td key={m.mode} className="py-1 pr-2 text-slate-200">{row.cell(m.metrics)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {open.report.modes.map((m) => (
                  <div key={m.mode} className="rounded-xl bg-slate-950/50 border border-slate-800 p-2.5" data-quality-gates={m.mode}>
                    <p className="text-[11px] font-bold text-slate-200">Ворота — {MODE_TITLE[m.mode]}: {m.passed ? 'пройдено' : 'не пройдено'}</p>
                    <ul className="mt-1 space-y-0.5 text-[11px]">
                      {m.gates.map((g) => (
                        <li key={g.id} className={g.skipped ? 'text-slate-500' : g.passed ? 'text-emerald-300' : 'text-rose-300'}>
                          {g.skipped ? '–' : g.passed ? '✓' : '✗'} {g.title}: {num(g.value)} ({g.limit}){g.skipped ? ' — пропущено' : ''}
                        </li>
                      ))}
                    </ul>
                    {[...m.metrics.isolation.examples, ...m.metrics.spoilers.examples].length > 0 && (
                      <ul className="mt-1 text-[10px] text-rose-300">
                        {[...m.metrics.isolation.examples, ...m.metrics.spoilers.examples].map((e) => (
                          <li key={e} className="break-words">{e}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              {open.report.modes.map((m) => (
                <details key={m.mode} className="mt-3" data-quality-turns={m.mode}>
                  <summary className="cursor-pointer text-[11px] text-slate-300">Ходи — {MODE_TITLE[m.mode]} ({m.turns.length})</summary>
                  <div className="mt-1 overflow-x-auto">
                    <table className="w-full min-w-[640px] text-[11px]">
                      <tbody>
                        {m.turns.map((x) => (
                          <tr key={x.caseId} className="border-t border-slate-800 align-top">
                            <td className="py-1 pr-2 text-slate-400 whitespace-nowrap">{x.caseId}</td>
                            <td className="py-1 pr-2 text-slate-500">{DIM_TITLE[x.dimension] ?? x.dimension}</td>
                            <td className="py-1 pr-2 text-slate-400">{x.action ?? '—'} · {x.source ?? '—'}</td>
                            <td className="py-1 pr-2 text-slate-400 whitespace-nowrap">{x.judge ? `${num(x.judge.characterFit)} / ${num(x.judge.styleFit)}` : '—'}</td>
                            <td className="py-1 pr-2 text-slate-200 break-words">
                              <span className="text-slate-500">{x.question}</span>
                              <br />
                              {x.status === 'answered' ? x.reply : <span className="text-rose-300">[{x.status}] {x.error}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-500">{open.status === 'running' || open.status === 'queued' ? 'Прогін іде — звіт з\'явиться після завершення.' : 'Звіту немає.'}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminQualityView;
