/**
 * Розділ «Допит» у профілі героя (Т2.7 В5, `PLAN_INTERVIEW.md`; рішення
 * власника §6 п.1 — на сторінці героя, поруч із «Пам'яттю»).
 *
 * «AI-персонаж» і рівень автономності (вимкнено / допит / учасник сцени —
 * останній поки лише записується, Magic Scene); нова розмова з межею знань
 * (сцена чи глава); питання й відповіді героя від першої особи; біля кожної
 * відповіді — рішення Jev (дія, джерело, запасний шлях); «чекає автора» —
 * варіанти, автор вирішує за героя; «не вдалося» — «повторити». Під
 * відповіддю — пропозиції в канон: спогад, факт-гіпотеза, фрагмент (у
 * вибраний розділ як «AI-чернетка», теги П7 — окремо, галочками чи пізніше);
 * кожну — прийняти (з правкою) чи відхилити. Застарілий допит (сцену
 * змінено) — без нових питань, пропозиції — лише явним «усе одно прийняти».
 * Історія допитів героя з кількістю неприйнятих пропозицій.
 *
 * Допит — дослідницька розмова, не канон: канон змінюють лише прийняті
 * автором пропозиції. Бачать і ведуть — ті, хто пише історію.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, Loader2, MessageSquare, Pause, Pencil, Play, Plus, RotateCcw, Send, X, XCircle } from 'lucide-react';
import type { Book } from '../types';
import { applyInterviewInsert, type InterviewInsert } from '../utils/interviewInsert';

type Level = 'off' | 'interview' | 'scene';
type SimStatus = 'active' | 'paused' | 'closed' | 'stale';

interface Agent {
  enabled: boolean;
  autonomyLevel: Level;
  config: { asOfChapter?: number | null; sceneId?: string | null; note?: string; maxTurns?: number };
}
interface Sim {
  id: string;
  title: string;
  status: SimStatus;
  sceneId: string | null;
  asOfChapter: number | null;
  currentTurn: number;
  config: { maxTurns?: number };
  createdAt: string;
  pending?: number;
}
interface SimEvent {
  id: string;
  turnIndex: number;
  eventType: 'question' | 'answer' | 'awaiting' | 'failed' | 'note';
  publicPayload: Record<string, any>;
}
interface Proposal {
  id: string;
  kind: 'memory' | 'fact' | 'fragment' | 'tag';
  status: 'pending' | 'accepted' | 'rejected';
  turn: number | null;
  change: Record<string, any>;
  result: Record<string, any>;
  tags?: Proposal[];
}
interface Labels {
  actions: Record<string, string>;
  levels: Record<string, string>;
  sources: Record<string, string>;
}

interface Props {
  book: Book;
  entityId: string;
  heroName: string;
  onUpdateBook?: (book: Book, logAction?: string, logDetails?: string) => void;
  /** Після прийняття спогаду чи факту — оновити профіль і пам'ять. */
  onCanonChanged?: () => void;
}

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

const LEVELS: { key: Level; title: string; hint: string }[] = [
  { key: 'off', title: 'Вимкнено', hint: 'героя не допитують' },
  { key: 'interview', title: 'Допит', hint: 'відповідає на ваші питання від першої особи' },
  { key: 'scene', title: 'Учасник сцени', hint: 'діє по черзі з іншими героями в Magic Scene; допит — теж' },
];
const SIM_STATUS: Record<SimStatus, string> = { active: 'триває', paused: 'на паузі', closed: 'закрито', stale: 'застарів' };
const KIND: Record<Proposal['kind'], string> = { memory: 'Спогад', fact: 'Факт (гіпотеза)', fragment: 'Фрагмент для книги', tag: 'Тег' };
const MEMORY_TYPE: Record<string, string> = { recollection: 'спогад', belief: 'переконання', consequence: 'наслідок' };
const FIELD: Record<string, string> = {
  appearance: 'Зовнішність', personality: 'Характер', biography: 'Біографія', goal: 'Цілі', need: 'Потреби', belief: 'Переконання', fear: 'Страхи', relationship: 'Стосунки', skill: 'Уміння', other: 'Інше',
};
const btn = 'flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] disabled:opacity-40';
const REASON: Record<string, string> = {
  low_confidence: 'Jev не певний у рішенні',
  no_alternative: 'жодна дозволена дія не проходить обмежень',
  unavailable: 'Jev і запасний шлях недоступні',
};
const reasonText = (r: unknown) => (typeof r === 'string' ? REASON[r] ?? r : '');

export const CharacterInterviewPanel: React.FC<Props> = ({ book, entityId, heroName, onUpdateBook, onCanonChanged }) => {
  const project = `/api/projects/${encodeURIComponent(book.id)}`;
  const hero = `${project}/characters/${encodeURIComponent(entityId)}`;
  const [agent, setAgent] = useState<Agent | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [sims, setSims] = useState<Sim[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [labels, setLabels] = useState<Labels>({ actions: {}, levels: {}, sources: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [note, setNote] = useState('');
  const [boundary, setBoundary] = useState('');
  const [title, setTitle] = useState('');
  const [staleOk, setStaleOk] = useState(false);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<Record<string, string>>({});
  const [tagPick, setTagPick] = useState<Record<string, boolean>>({});
  const endRef = useRef<HTMLDivElement | null>(null);
  const seq = useRef(0);

  const sections = useMemo(
    () => (book.chapters ?? []).flatMap((c, ci) => (c.sections ?? []).map((s) => ({ id: s.id, chapter: ci + 1, label: `Гл. ${ci + 1} · ${s.title || 'розділ'}` }))),
    [book],
  );
  const chapters = useMemo(() => (book.chapters ?? []).map((c, i) => ({ n: i + 1, title: c.title || `Глава ${i + 1}` })), [book]);
  const sectionLabel = (id: string | null) => sections.find((s) => s.id === id)?.label ?? id ?? '';

  const post = async (url: string, body: unknown) => {
    const res = await api(url, { method: 'POST', body: JSON.stringify(body ?? {}) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    return { ok: !!res?.ok, status: res?.status ?? 0, body: json as any };
  };

  const loadList = useCallback(async () => {
    const [a, l] = await Promise.all([api(`${hero}/agent`).catch(() => null), api(`${hero}/interviews`).catch(() => null)]);
    const ab = a ? await a.json().catch(() => ({})) : {};
    if (!a || !a.ok) {
      setError(a?.status === 503 ? 'Семантичне ядро зараз недоступне.' : ab.error || 'Не вдалося завантажити «AI-персонажа».');
      setLoading(false);
      return;
    }
    setError(null);
    setAgent(ab.agent);
    setNote(ab.agent?.config?.note ?? '');
    setCanEdit(!!ab.canEdit);
    if (l?.ok) setSims(((await l.json().catch(() => ({}))).simulations ?? []) as Sim[]);
    setLoading(false);
  }, [hero]);

  const loadSim = useCallback(async (id: string) => {
    const my = ++seq.current;
    const res = await api(`${project}/simulations/${encodeURIComponent(id)}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (my !== seq.current) return;
    if (!res?.ok) {
      setMessage(body.error || 'Не вдалося відкрити допит.');
      return;
    }
    setSim(body.simulation);
    setEvents(body.events ?? []);
    setProposals(body.proposals ?? []);
    if (body.labels) setLabels(body.labels);
  }, [project]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    setStaleOk(false);
    if (openId) void loadSim(openId);
    else {
      setSim(null);
      setEvents([]);
      setProposals([]);
    }
  }, [openId, loadSim]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [events.length]);

  const refresh = async () => {
    if (openId) await loadSim(openId);
    await loadList();
  };

  // ── «AI-персонаж» ─────────────────────────────────────────────────────────
  const saveAgent = async (level: Level) => {
    setBusy('agent');
    const r = await post(`${hero}/agent`, { autonomyLevel: level, config: { note } });
    if (!r.ok) setMessage(r.body.error || 'Не вдалося змінити «AI-персонажа».');
    else {
      setAgent(r.body.agent);
      setMessage(level === 'off' ? 'AI-персонажа вимкнено.' : 'Збережено.');
    }
    setBusy(null);
  };

  // ── Допит ───────────────────────────────────────────────────────────────
  const start = async () => {
    setBusy('start');
    const [kind, value] = boundary.split(':');
    const body: Record<string, unknown> = { title: title.trim() || undefined };
    if (kind === 'scene') {
      body.sceneId = value;
      body.asOfChapter = sections.find((s) => s.id === value)?.chapter ?? null;
    } else if (kind === 'chapter') {
      body.sceneId = null;
      body.asOfChapter = Number(value);
    }
    const r = await post(`${hero}/interview`, body);
    setBusy(null);
    if (!r.ok) {
      setMessage(r.body.error || 'Не вдалося почати допит.');
      return;
    }
    setTitle('');
    setMessage(null);
    await loadList();
    setOpenId(r.body.simulation.id);
  };

  const ask = async () => {
    if (!sim || !question.trim()) return;
    setBusy('ask');
    setMessage(null);
    const r = await post(`${project}/simulations/${sim.id}/turn`, { question: question.trim() });
    setBusy(null);
    if (!r.ok) setMessage(r.body.error || 'Не вдалося поставити питання.');
    else {
      setQuestion('');
      if (r.body.status === 'failed') setMessage('Модель не відповіла — питання збережено, можна повторити.');
    }
    await refresh();
  };

  const retry = async () => {
    if (!sim) return;
    setBusy('retry');
    const r = await post(`${project}/simulations/${sim.id}/retry`, {});
    setBusy(null);
    if (!r.ok) setMessage(r.body.error || 'Не вдалося повторити.');
    await refresh();
  };

  const decideFor = async (decisionId: string, action: string) => {
    if (!sim) return;
    setBusy(decisionId);
    const r = await post(`${hero}/decisions/${encodeURIComponent(decisionId)}/resolve`, { action });
    if (!r.ok) {
      setBusy(null);
      setMessage(r.body.error || 'Не вдалося записати рішення.');
      return;
    }
    const again = await post(`${project}/simulations/${sim.id}/retry`, {});
    setBusy(null);
    if (!again.ok) setMessage(again.body.error || 'Не вдалося продовжити.');
    await refresh();
  };

  const setStatus = async (status: 'active' | 'paused' | 'closed') => {
    if (!sim) return;
    setBusy('status');
    const r = await post(`${project}/simulations/${sim.id}/status`, { status });
    setBusy(null);
    if (!r.ok) setMessage(r.body.error || 'Не вдалося змінити стан допиту.');
    await refresh();
  };

  // ── Пропозиції ───────────────────────────────────────────────────────────
  const insertIntoBook = (insert: InterviewInsert, fragmentText?: string): boolean => {
    if (!onUpdateBook) return false;
    const r = applyInterviewInsert(book, insert, fragmentText);
    if (!r) return false;
    onUpdateBook(r.book, 'Допит героя', insert.mode === 'ai_draft' ? `Фрагмент із допиту «${heroName}» — AI-чернеткою в «${sectionLabel(insert.sectionId)}»` : `Тег ${insert.snippet} до фрагмента допиту`);
    return true;
  };

  const accept = async (p: Proposal, parent?: Proposal) => {
    setBusy(p.id);
    setMessage(null);
    const body: Record<string, unknown> = { acknowledgeStale: sim?.status === 'stale' ? staleOk : undefined };
    if (edit[p.id] !== undefined && edit[p.id].trim()) body.content = edit[p.id];
    if (p.kind === 'fragment') {
      body.sectionId = target[p.id] || sim?.sceneId || '';
      body.tagIds = (p.tags ?? []).filter((t) => t.status === 'pending' && tagPick[t.id]).map((t) => t.id);
    }
    if(p.kind==='fragment') {
      try {
        const url=`/api/core/projects/${encodeURIComponent(book.id)}/branches`;
        const stateResponse=await fetch(url,{credentials:'same-origin'});const state=await stateResponse.json();
        if(!stateResponse.ok)throw new Error(state.error);
        const response=await fetch(`${url}/from-proposal`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,proposalId:p.id,expectedRevision:state.revision})});
        const result=await response.json();if(!response.ok)throw new Error(result.error);
        setMessage(`Створено ізольовану гілку «${result.branch.name}». Перевірте й підтвердьте фрагмент на сторінці «Гілки сценарію».`);
      }catch(error){setMessage(error instanceof Error?error.message:'Не вдалося створити гілку.');}
      setBusy(null);return;
    }
    const r = await post(`${project}/proposals/${encodeURIComponent(p.id)}/accept`, body);
    setBusy(null);
    if (!r.ok) {
      setMessage(r.body.error || 'Не вдалося прийняти.');
      return;
    }
    setEdit((e) => {
      const n = { ...e };
      delete n[p.id];
      return n;
    });
    if (r.body.insert) {
      const fragmentText = p.kind === 'tag' ? String(parent?.result?.text ?? parent?.change?.text ?? '') : undefined;
      const ok = insertIntoBook(r.body.insert, fragmentText);
      setMessage(
        ok
          ? r.body.insert.mode === 'ai_draft'
            ? `Фрагмент вставлено AI-чернеткою в «${sectionLabel(r.body.insert.sectionId)}» — прийміть чи перепишіть його в редакторі.`
            : 'Тег дописано до фрагмента.'
          : r.body.insert.mode === 'append_tag'
            ? `Фрагмента в розділі вже немає — допишіть тег вручну: ${r.body.insert.snippet}`
            : 'Прийнято, але вставити в книгу тут не вдалося — розділу немає.',
      );
    } else {
      setMessage(p.kind === 'memory' ? 'Спогад додано в пам\'ять героя.' : 'Факт додано в профіль як гіпотезу — підтвердіть його в «Фактах», коли будете певні.');
      onCanonChanged?.();
    }
    await refresh();
  };

  const reject = async (p: Proposal) => {
    setBusy(p.id);
    const r = await post(`${project}/proposals/${encodeURIComponent(p.id)}/reject`, {});
    setBusy(null);
    if (!r.ok) setMessage(r.body.error || 'Не вдалося відхилити.');
    await refresh();
  };

  // ── Показ ───────────────────────────────────────────────────────────────
  const actionLabel = (a: string) => labels.actions[a] ?? a;
  const stale = sim?.status === 'stale';
  const lastTurn = sim ? events.filter((e) => e.turnIndex === sim.currentTurn).at(-1) : undefined;
  const waiting = !!lastTurn && lastTurn.eventType !== 'answer' && lastTurn.eventType !== 'question';
  const maxTurns = Number(sim?.config?.maxTurns) || 30;
  const canAsk = !!sim && sim.status === 'active' && !waiting && sim.currentTurn < maxTurns;

  const proposalCard = (p: Proposal, parent?: Proposal) => {
    const pending = p.status === 'pending';
    const text = p.kind === 'memory' ? p.change.content : p.kind === 'fact' ? p.change.statement : p.kind === 'fragment' ? p.change.text : p.change.tag;
    const parentOk = p.kind !== 'tag' || parent?.status === 'accepted';
    return (
      <li key={p.id} className={`min-w-0 rounded-lg border p-2 ${pending ? 'border-violet-500/30 bg-violet-500/5' : p.status === 'accepted' ? 'border-emerald-500/30' : 'border-slate-800 opacity-60'}`} data-proposal={p.id} data-proposal-kind={p.kind} data-proposal-status={p.status}>
        <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px]">
          <span className="rounded border border-slate-700 px-1.5 py-px text-slate-300">{KIND[p.kind]}</span>
          {p.kind === 'memory' && <span className="text-slate-500">{MEMORY_TYPE[p.change.memoryType] ?? p.change.memoryType}</span>}
          {p.kind === 'fact' && <span className="text-slate-500">{FIELD[p.change.field] ?? p.change.field}</span>}
          {p.status !== 'pending' && <span className={p.status === 'accepted' ? 'text-emerald-300' : 'text-slate-500'}>{p.status === 'accepted' ? 'прийнято' : 'відхилено'}{p.result?.stale ? ' (із застарілого)' : ''}</span>}
        </div>
        {edit[p.id] !== undefined ? (
          <textarea value={edit[p.id]} onChange={(e) => setEdit((x) => ({ ...x, [p.id]: e.target.value }))} rows={p.kind === 'fragment' ? 4 : 2} data-proposal-edit className="w-full rounded border border-slate-700 bg-slate-950 p-1.5 text-[12px] text-slate-100" />
        ) : (
          <p className={`whitespace-pre-wrap break-words text-[12px] ${p.kind === 'fragment' ? 'font-serif text-slate-200' : 'text-slate-100'}`} data-proposal-text>
            {p.status === 'accepted' && p.result?.text ? p.result.text : text}
          </p>
        )}
        {p.kind === 'fragment' && (p.tags?.length ?? 0) > 0 && (
          <ul className="mt-1.5 space-y-1" data-proposal-tags>
            {p.tags!.map((t) =>
              pending ? (
                <li key={t.id} className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-300" data-proposal={t.id} data-proposal-kind="tag" data-proposal-status={t.status}>
                  <input type="checkbox" checked={!!tagPick[t.id]} onChange={(e) => setTagPick((x) => ({ ...x, [t.id]: e.target.checked }))} data-proposal-tag-pick={t.id} disabled={t.status !== 'pending'} />
                  <code className="min-w-0 break-all text-sky-300">{t.change.tag}</code>
                  {t.status !== 'pending' && <span className="text-slate-500">{t.status === 'accepted' ? 'прийнято' : 'відхилено'}</span>}
                </li>
              ) : (
                // Фрагмент уже вирішено: тег — компактним рядком; ще не вирішений — «дописати» окремо чи відхилити.
                <li key={t.id} className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-slate-300" data-proposal={t.id} data-proposal-kind="tag" data-proposal-status={t.status}>
                  <code className={`min-w-0 break-all ${t.status === 'rejected' ? 'text-slate-500 line-through' : 'text-sky-300'}`}>{t.change.tag}</code>
                  {t.status !== 'pending' ? (
                    <span className={t.status === 'accepted' ? 'text-emerald-300' : 'text-slate-500'}>{t.status === 'accepted' ? 'прийнято' : 'відхилено'}</span>
                  ) : canEdit && p.status === 'accepted' ? (
                    <>
                      <button type="button" disabled={busy === t.id || (stale && !staleOk)} data-proposal-accept onClick={() => void accept(t, p)} className={`${btn} border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10`}>
                        <Check size={11} /> Дописати до фрагмента
                      </button>
                      <button type="button" disabled={busy === t.id} data-proposal-reject onClick={() => void reject(t)} className={`${btn} border-rose-500/40 text-rose-300 hover:bg-rose-500/10`}>
                        <X size={11} />
                      </button>
                    </>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        )}
        {canEdit && pending && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {p.kind === 'fragment' && (
              <select value={target[p.id] ?? sim?.sceneId ?? ''} onChange={(e) => setTarget((x) => ({ ...x, [p.id]: e.target.value }))} data-proposal-section className="max-w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-200">
                <option value="">Розділ для вставки…</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={busy === p.id || !parentOk || (stale && !staleOk) || (p.kind === 'fragment' && !(target[p.id] ?? sim?.sceneId))}
              data-proposal-accept
              onClick={() => void accept(p, parent)}
              className={`${btn} border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10`}
              title={!parentOk ? 'Спершу прийміть фрагмент' : undefined}
            >
              <Check size={11} /> {p.kind === 'fragment' ? 'До ізольованої гілки' : p.kind === 'tag' ? 'Дописати до фрагмента' : 'Прийняти'}
            </button>
            {p.kind !== 'tag' && edit[p.id] === undefined && (
              <button type="button" onClick={() => setEdit((x) => ({ ...x, [p.id]: String(text ?? '') }))} data-proposal-edit-open className={`${btn} border-slate-700 text-slate-300 hover:border-sky-500`}>
                <Pencil size={11} /> Виправити
              </button>
            )}
            <button type="button" disabled={busy === p.id} data-proposal-reject onClick={() => void reject(p)} className={`${btn} border-rose-500/40 text-rose-300 hover:bg-rose-500/10`}>
              <X size={11} /> Відхилити
            </button>
          </div>
        )}
      </li>
    );
  };

  const turnView = (turn: number) => {
    const evs = events.filter((e) => e.turnIndex === turn);
    const q = evs.find((e) => e.eventType === 'question');
    const last = evs.filter((e) => e.eventType !== 'question').at(-1);
    const props = proposals.filter((p) => p.turn === turn);
    const pl = last?.publicPayload ?? {};
    return (
      <li key={turn} className="min-w-0 space-y-1.5" data-interview-turn={turn}>
        {q && (
          <div className="ml-auto w-fit max-w-[90%] rounded-xl rounded-br-sm bg-sky-500/15 px-2.5 py-1.5 text-[12px] text-sky-100" data-interview-question>
            {q.publicPayload.text}
          </div>
        )}
        {last?.eventType === 'answer' && (
          <div className="max-w-[95%] rounded-xl rounded-bl-sm border border-slate-800 bg-slate-950/60 px-2.5 py-1.5" data-interview-answer>
            <p className="mb-0.5 text-[10px] font-bold text-slate-400">{heroName}</p>
            <p className="whitespace-pre-wrap break-words text-[12px] text-slate-100">{pl.text}</p>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px]" data-interview-decision>
              <span className="rounded border border-violet-500/30 px-1.5 py-px text-violet-200" title="Рішення Jev на цей хід">дія: {actionLabel(pl.action)}</span>
              <span className={`rounded border px-1.5 py-px ${pl.source === 'jev' ? 'border-slate-700 text-slate-400' : 'border-amber-500/40 text-amber-200'}`} data-interview-source={pl.source}>
                {labels.sources[pl.source] ?? pl.source}
              </span>
              {pl.fallbackReason && <span className="min-w-0 break-words text-amber-300/80">({pl.fallbackReason})</span>}
              {pl.intent && <span className="min-w-0 break-words text-slate-500">· намір: {pl.intent}</span>}
            </div>
          </div>
        )}
        {last?.eventType === 'awaiting' && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-100" data-interview-awaiting>
            <p className="mb-1">
              Рішення героя чекає на вас ({labels.levels[pl.level] ?? pl.level} рівень){pl.reason ? `: ${reasonText(pl.reason)}` : ''}. Що обере {heroName}?
            </p>
            {canEdit && sim?.status === 'active' && turn === sim.currentTurn && (
              <div className="flex flex-wrap gap-1.5">
                {(pl.options ?? []).map((o: string) => (
                  <button key={o} type="button" disabled={busy === pl.decisionId} data-interview-option={o} onClick={() => void decideFor(pl.decisionId, o)} className={`${btn} border-amber-500/40 text-amber-200 hover:bg-amber-500/10`}>
                    {actionLabel(o)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {last?.eventType === 'failed' && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/5 p-2 text-[11px] text-rose-200" data-interview-failed>
            <XCircle size={12} /> {pl.stage === 'decision' ? 'Рішення героя не вдалося' : 'Модель голосу не відповіла'} — питання збережено.
            {canEdit && sim?.status === 'active' && turn === sim.currentTurn && (
              <button type="button" disabled={busy === 'retry'} data-interview-retry onClick={() => void retry()} className={`${btn} border-rose-500/40 text-rose-200 hover:bg-rose-500/10`}>
                {busy === 'retry' ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Повторити
              </button>
            )}
          </div>
        )}
        {props.length > 0 && <ul className="space-y-1.5 pl-2" data-interview-proposals>{props.map((p) => proposalCard(p))}</ul>}
      </li>
    );
  };

  const turns = [...new Set(events.map((e) => e.turnIndex))].sort((a, b) => a - b);
  const on = !!agent && agent.autonomyLevel !== 'off';

  return (
    <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-4" data-profile-section="interview" data-interview-panel>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          <MessageSquare size={13} /> Допит героя
        </h3>
        <span className="text-[10px] text-slate-500">дослідницька розмова, не канон — у книгу йде лише прийняте вами</span>
      </div>
      {loading ? (
        <p className="text-[11px] text-slate-500"><Loader2 size={11} className="mr-1 inline animate-spin" />Завантаження…</p>
      ) : error ? (
        <p className="text-[11px] text-rose-300" data-interview-error>{error}</p>
      ) : !canEdit ? (
        <p className="text-[11px] text-slate-500" data-interview-readonly>
          {on ? `${heroName} — AI-персонаж (${LEVELS.find((l) => l.key === agent!.autonomyLevel)?.title}). ` : ''}Допитують героя власник, співавтор, редактор і адміністратор.
        </p>
      ) : (
        <>
          {/* «AI-персонаж» і рівень автономності */}
          <div className="mb-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2" data-interview-agent data-interview-level={agent?.autonomyLevel}>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-bold text-slate-300"><Bot size={12} /> AI-персонаж</p>
            <div className="flex flex-wrap gap-1.5">
              {LEVELS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  disabled={busy === 'agent'}
                  data-interview-set-level={l.key}
                  title={l.hint}
                  onClick={() => void saveAgent(l.key)}
                  className={`rounded-lg border px-2 py-1 text-[11px] ${agent?.autonomyLevel === l.key ? 'border-violet-500 bg-violet-500/15 text-violet-100' : 'border-slate-700 text-slate-300 hover:border-violet-500/60'}`}
                >
                  {l.title}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-500">{LEVELS.find((l) => l.key === agent?.autonomyLevel)?.hint}</p>
            {on && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Як говорить герой (нотатка для голосу)…" data-interview-note className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-100" />
                <button type="button" disabled={busy === 'agent' || note === (agent?.config?.note ?? '')} onClick={() => void saveAgent(agent!.autonomyLevel)} data-interview-note-save className={`${btn} border-slate-700 text-slate-300 hover:border-emerald-500`}>
                  <Check size={11} /> Зберегти
                </button>
              </div>
            )}
          </div>

          {message && <p className="mb-2 break-words text-[11px] text-amber-300" data-interview-message>{message}</p>}

          {on && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5" data-interview-new>
              <select value={boundary} onChange={(e) => setBoundary(e.target.value)} data-interview-boundary className="max-w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200">
                <option value="">Межа знань: з налаштувань героя</option>
                <optgroup label="Станом на сцену">
                  {sections.map((s) => (
                    <option key={s.id} value={`scene:${s.id}`}>{s.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Станом на главу">
                  {chapters.map((c) => (
                    <option key={c.n} value={`chapter:${c.n}`}>{c.n}. {c.title}</option>
                  ))}
                </optgroup>
              </select>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Назва (необов'язково)" data-interview-title className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-100 sm:max-w-[200px]" />
              <button type="button" disabled={busy === 'start'} onClick={() => void start()} data-interview-start className="flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-bold text-violet-200 hover:bg-violet-500/20 disabled:opacity-50">
                {busy === 'start' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Нова розмова
              </button>
            </div>
          )}

          {sims.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5" data-interview-list>
              {sims.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === s.id ? null : s.id)}
                    data-interview-open={s.id}
                    data-interview-status={s.status}
                    className={`flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${openId === s.id ? 'border-sky-500 bg-sky-500/10 text-sky-100' : 'border-slate-700 text-slate-300 hover:border-sky-500/60'}`}
                  >
                    <span className="max-w-[180px] truncate">{s.title}</span>
                    <span className={`text-[10px] ${s.status === 'stale' ? 'text-amber-300' : 'text-slate-500'}`}>· {SIM_STATUS[s.status]} · {s.currentTurn}</span>
                    {(s.pending ?? 0) > 0 && <span className="rounded-full bg-violet-500/30 px-1.5 text-[10px] text-violet-100" data-interview-pending>{s.pending}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!on && !sims.length && <p className="text-[11px] text-slate-500" data-interview-off>Увімкніть рівень «Допит», щоб розпитати {heroName} від першої особи — станом на вибрану сцену, без майбутнього й чужих таємниць.</p>}

          {sim && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-2" data-interview-open-sim={sim.id} data-interview-sim-status={sim.status}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <b className="min-w-0 truncate text-slate-200">{sim.title}</b>
                <span className="text-slate-500">
                  · {sim.sceneId ? `станом на «${sectionLabel(sim.sceneId)}»` : sim.asOfChapter ? `станом на главу ${sim.asOfChapter}` : 'уся книга'} · хід {sim.currentTurn}/{maxTurns} · {SIM_STATUS[sim.status]}
                </span>
                <span className="ml-auto flex gap-1">
                  {sim.status === 'active' && (
                    <button type="button" disabled={busy === 'status'} onClick={() => void setStatus('paused')} data-interview-pause className={`${btn} border-slate-700 text-slate-300`}><Pause size={11} /> Пауза</button>
                  )}
                  {sim.status === 'paused' && (
                    <button type="button" disabled={busy === 'status'} onClick={() => void setStatus('active')} data-interview-resume className={`${btn} border-slate-700 text-slate-300`}><Play size={11} /> Продовжити</button>
                  )}
                  {sim.status !== 'closed' && (
                    <button type="button" disabled={busy === 'status'} onClick={() => void setStatus('closed')} data-interview-close className={`${btn} border-slate-700 text-slate-400`}><X size={11} /> Закрити</button>
                  )}
                </span>
              </div>
              {stale && (
                <div className="mb-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-100" data-interview-stale>
                  <p className="flex items-start gap-1"><AlertTriangle size={12} className="mt-px shrink-0" /> Сцену цього допиту змінено — розмова застаріла: нових питань немає, відповіді могли спиратися на старий текст.</p>
                  <label className="mt-1 flex items-center gap-1.5">
                    <input type="checkbox" checked={staleOk} onChange={(e) => setStaleOk(e.target.checked)} data-interview-stale-ok /> Я знаю — усе одно дозволити приймати пропозиції
                  </label>
                </div>
              )}
              {turns.length ? <ol className="space-y-2.5" data-interview-turns>{turns.map(turnView)}</ol> : <p className="text-[11px] text-slate-500">Поставте перше питання — {heroName} відповість від першої особи.</p>}
              <div ref={endRef} />
              {sim.status === 'active' && (
                <form
                  className="mt-2 flex min-w-0 gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask();
                  }}
                >
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    maxLength={2000}
                    disabled={!canAsk || busy === 'ask'}
                    placeholder={waiting ? 'Спершу — рішення чи «повторити» вище' : sim.currentTurn >= maxTurns ? 'Ліміт ходів — почніть нову розмову' : `Питання до ${heroName}…`}
                    data-interview-question-input
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100"
                  />
                  <button type="submit" disabled={!canAsk || busy === 'ask' || !question.trim()} data-interview-ask className="flex shrink-0 items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 text-[11px] font-bold text-sky-200 hover:bg-sky-500/20 disabled:opacity-40">
                    {busy === 'ask' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  </button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default CharacterInterviewPanel;
