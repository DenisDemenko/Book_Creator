/**
 * Розділ «Пам'ять» у профілі героя (Т2.6 В6, `PLAN_CHARACTER_MEMORY.md`).
 *
 * Шари пам'яті героя окремо: світ (що підтверджено сталося), знання, переконання
 * (зокрема хибні), спогади (як він витлумачив пережите), наслідки (довіра, страх,
 * цілі). У кожного спогаду — звідки він (теги / AI-2 / автор / прогін), сцена й
 * абзаци-докази з переходом у редактор, статус. Пропозиції AI-2 і «перевірити»
 * (після правки сцени) — окремо вгорі: автор підтверджує («досі так»),
 * відхиляє чи оновлює з тегів. Автор може вписати спогад сам (приватний —
 * лише власник книги) і попросити AI-2 витлумачити розділ очима героя.
 * У знімок героя (рішення Jev, допит) іде лише підтверджене.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Check, ExternalLink, Loader2, Lock, Plus, RefreshCw, Sparkles, Tags, X } from 'lucide-react';
import type { Book } from '../types';

type MemoryType = 'world_fact' | 'knowledge' | 'belief' | 'recollection' | 'consequence';
type Status = 'suggested' | 'confirmed' | 'needs_review' | 'rejected' | 'superseded';

interface Place {
  paragraphId: string;
  editorPid: string;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterNumber: number | null;
  excerpt: string;
}
interface Memory {
  id: string;
  memoryType: MemoryType;
  layer: 'world_truth' | 'character_belief' | 'reader_knowledge';
  content: string;
  about: { id: string; name: string }[];
  effects: { trust: { towards: string; name: string; delta: number }[]; fear: number | null; goals: string[] };
  beliefStatus: 'knows' | 'believes' | 'doubts' | 'abandoned';
  truth: 'true' | 'false' | 'unknown';
  source: { kind: string; id: string | null; name: string | null };
  places: (Place | null)[];
  scene: { id: string; title: string; chapterNumber: number | null; time: string | null } | null;
  status: Status;
  origin: 'tag' | 'ai' | 'author' | 'simulation';
  visibility: 'project' | 'author' | 'hidden';
  reviewNote: string | null;
}

interface Props {
  book: Book;
  entityId: string;
  heroName: string;
  /** «Стан на главі N» зі сторінки героя. */
  upto: number | null;
  onOpenParagraph: (t: { chapterId: string; sectionId: string; editorPid: string; text: string }) => void;
}

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

const GROUPS: { type: MemoryType; title: string; hint: string }[] = [
  { type: 'world_fact', title: 'Світ', hint: 'що підтверджено сталося при героєві' },
  { type: 'knowledge', title: 'Знання', hint: 'що герой дізнався' },
  { type: 'belief', title: 'Переконання', hint: 'у що вірить — зокрема помилково' },
  { type: 'recollection', title: 'Спогади', hint: 'як витлумачив пережите' },
  { type: 'consequence', title: 'Наслідки', hint: 'як змінились довіра, страх, цілі' },
];
const ORIGIN: Record<Memory['origin'], string> = { tag: 'з тегів', ai: 'AI-2', author: 'автор', simulation: 'прогін' };
const STATUS: Record<Status, string> = { suggested: 'пропозиція', confirmed: 'підтверджено', needs_review: 'перевірити', rejected: 'відхилено', superseded: 'замінено' };
const STATUS_TONE: Record<Status, string> = {
  suggested: 'border-violet-500/40 text-violet-200',
  confirmed: 'border-emerald-500/40 text-emerald-200',
  needs_review: 'border-amber-500/50 text-amber-200',
  rejected: 'border-slate-600 text-slate-400',
  superseded: 'border-slate-700 text-slate-500',
};

export const CharacterMemoryPanel: React.FC<Props> = ({ book, entityId, heroName, upto, onOpenParagraph }) => {
  const base = `/api/projects/${encodeURIComponent(book.id)}/characters/${encodeURIComponent(entityId)}/memories`;
  const [memories, setMemories] = useState<Memory[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [canSeePrivate, setCanSeePrivate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [aiSection, setAiSection] = useState('');
  const [aiRunning, setAiRunning] = useState(false);
  const [form, setForm] = useState({ open: false, type: 'recollection' as MemoryType, content: '', sceneId: '', hidden: false });
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const sections = useMemo(
    () => (book.chapters ?? []).flatMap((c, ci) => (c.sections ?? []).map((s) => ({ id: s.id, label: `Гл. ${ci + 1} · ${s.title || 'розділ'}` }))),
    [book],
  );

  const load = useCallback(async () => {
    const my = ++seq.current;
    const res = await api(`${base}${upto ? `?chapter=${upto}` : ''}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (my !== seq.current) return;
    if (!res || !res.ok) setError(res?.status === 503 ? 'Семантичне ядро зараз недоступне.' : body.error || 'Не вдалося завантажити пам\'ять героя.');
    else {
      setError(null);
      setMemories(body.memories ?? []);
      setCanEdit(!!body.canEdit);
      setCanSeePrivate(!!body.canSeePrivate);
    }
    setLoading(false);
  }, [base, upto]);

  useEffect(() => {
    void load();
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [load]);

  const post = async (url: string, body: unknown) => {
    const res = await api(url, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    return { ok: !!res?.ok, status: res?.status ?? 0, body: json as any };
  };

  const collect = async () => {
    setBusy('collect');
    const r = await post(`${base}/collect`, {});
    setMessage(r.ok ? (r.body.created ? `Із тегів додано спогадів: ${r.body.created}.` : 'Нового в тегах немає — усе вже в пам\'яті.') : r.body.error || 'Не вдалося.');
    setBusy(null);
    await load();
  };

  const review = async (m: Memory, action: 'confirm' | 'reject' | 'refresh') => {
    setBusy(m.id);
    const r = await post(`${base}/${m.id}/review`, { action });
    if (!r.ok) setMessage(r.body.error || 'Не вдалося.');
    else if (action === 'refresh') setMessage(r.body.replacement ? 'Оновлено з тегів.' : 'Тегу вже немає — спогад замінено без нового.');
    setBusy(null);
    await load();
  };

  const add = async () => {
    if (!form.content.trim()) return;
    setBusy('add');
    const r = await post(base, { memoryType: form.type, content: form.content.trim(), sceneId: form.sceneId || null, visibility: form.hidden ? 'hidden' : 'project' });
    if (!r.ok) setMessage(r.body.error || 'Не вдалося.');
    else {
      setMessage('Спогад додано.');
      setForm((f) => ({ ...f, open: false, content: '' }));
    }
    setBusy(null);
    await load();
  };

  const runAi = async () => {
    if (!aiSection) return;
    setAiRunning(true);
    setMessage(null);
    const r = await post(`${base}/ai`, { sectionId: aiSection });
    if (!r.ok) {
      setAiRunning(false);
      setMessage(r.body.error || 'Не вдалося запустити AI-2.');
      return;
    }
    const jobUrl = `/api/projects/${encodeURIComponent(book.id)}/jobs/${r.body.jobId}`;
    const tick = async () => {
      const res = await api(jobUrl).catch(() => null);
      const j = res?.ok ? await res.json() : null;
      if (j && (j.status === 'queued' || j.status === 'running')) {
        poll.current = setTimeout(tick, 1500);
        return;
      }
      setAiRunning(false);
      if (j?.status === 'succeeded') setMessage(j.result?.proposals ? `AI-2 запропонував спогадів: ${j.result.proposals} — перевірте й підтвердіть.` : 'AI-2 нічого нового не запропонував.');
      else setMessage(j?.error || 'AI-2 не впорався.');
      await load();
    };
    poll.current = setTimeout(tick, 1200);
  };

  const attention = memories.filter((m) => m.status === 'suggested' || m.status === 'needs_review');
  const settled = memories.filter((m) => m.status === 'confirmed' || (showRejected && m.status === 'rejected'));
  const rejectedCount = memories.filter((m) => m.status === 'rejected').length;

  // Функція, а не компонент усередині рендеру: інакше кожне оновлення перемонтовує всі картки.
  const card = (m: Memory) => (
    <li
      key={m.id}
      className={`min-w-0 rounded-lg border bg-slate-950/40 p-2.5 ${m.status === 'needs_review' ? 'border-amber-500/40' : m.status === 'suggested' ? 'border-violet-500/30' : 'border-slate-800'}`}
      data-memory={m.id}
      data-memory-type={m.memoryType}
      data-memory-status={m.status}
      data-memory-origin={m.origin}
    >
      <p className="break-words text-[12px] text-slate-100" data-memory-content>
        {m.visibility === 'hidden' && <Lock size={11} className="mr-1 inline text-slate-400" aria-label="приватне" />}
        {m.content}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
        <span className={`rounded border px-1.5 py-px ${STATUS_TONE[m.status]}`} data-memory-status-label>{STATUS[m.status]}</span>
        <span className="rounded border border-slate-700 px-1.5 py-px text-slate-400">{ORIGIN[m.origin]}</span>
        {m.source.kind === 'simulation_event' && <span className="rounded border border-violet-500/40 px-1.5 py-px text-violet-200" data-memory-from-interview>з допиту</span>}
        {m.visibility === 'hidden' && <span className="rounded border border-slate-600 px-1.5 py-px text-slate-300" data-memory-private>приватне</span>}
        {m.layer === 'reader_knowledge' && <span className="rounded border border-sky-600/50 px-1.5 py-px text-sky-300">знає читач, не герой</span>}
        {m.memoryType === 'belief' && m.truth === 'false' && <span className="rounded border border-rose-500/40 px-1.5 py-px text-rose-300" data-memory-false>хибне</span>}
        {m.beliefStatus === 'doubts' && <span className="rounded border border-slate-600 px-1.5 py-px text-slate-300">сумнівається</span>}
        {m.scene && (
          <span className="min-w-0 truncate text-slate-500" data-memory-scene={m.scene.id}>
            · {m.scene.chapterNumber ? `гл. ${m.scene.chapterNumber}, ` : ''}«{m.scene.title}»{m.scene.time ? ` (${m.scene.time})` : ''}
          </span>
        )}
      </div>
      {(m.effects.trust.length > 0 || m.effects.goals.length > 0 || m.effects.fear) && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-slate-300" data-memory-effects>
          {m.effects.trust.map((t) => (
            <li key={t.towards}>довіра до {t.name}: {t.delta > 0 ? `+${t.delta}` : t.delta}</li>
          ))}
          {m.effects.fear ? <li>страх: {m.effects.fear > 0 ? `+${m.effects.fear}` : m.effects.fear}</li> : null}
          {m.effects.goals.map((g) => (
            <li key={g}>мета: {g}</li>
          ))}
        </ul>
      )}
      {m.about.length > 0 && <p className="mt-1 text-[10px] text-slate-500">про: {m.about.map((a) => a.name).join(', ')}</p>}
      {m.reviewNote && <p className="mt-1 text-[10px] text-amber-300/90" data-memory-note>{m.reviewNote}</p>}
      {m.places.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {m.places.map((p, i) =>
            p ? (
              <li key={p.paragraphId} className="flex min-w-0 items-start gap-1 text-[11px] text-slate-400">
                <button
                  type="button"
                  data-memory-open={p.paragraphId}
                  title="Відкрити в тексті"
                  onClick={() => p.chapterId && onOpenParagraph({ chapterId: p.chapterId, sectionId: p.sectionId, editorPid: p.editorPid, text: p.excerpt })}
                  className="mt-px shrink-0 text-sky-300 hover:text-sky-200"
                >
                  <ExternalLink size={11} />
                </button>
                <span className="min-w-0 break-words">«{p.excerpt}»</span>
              </li>
            ) : (
              <li key={`gone-${i}`} className="text-[11px] text-slate-500">абзацу-доказу вже немає в книзі</li>
            ),
          )}
        </ul>
      )}
      {canEdit && (m.status === 'suggested' || m.status === 'needs_review') && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button type="button" disabled={busy === m.id || m.places.some((p) => p === null)} data-memory-confirm onClick={() => void review(m, 'confirm')} className="flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40">
            <Check size={11} /> {m.status === 'needs_review' ? 'Досі так' : 'Підтвердити'}
          </button>
          {m.status === 'needs_review' && m.origin === 'tag' && (
            <button type="button" disabled={busy === m.id} data-memory-refresh onClick={() => void review(m, 'refresh')} className="flex items-center gap-1 rounded border border-sky-500/40 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-500/10">
              <RefreshCw size={11} /> Оновити з тегів
            </button>
          )}
          <button type="button" disabled={busy === m.id} data-memory-reject onClick={() => void review(m, 'reject')} className="flex items-center gap-1 rounded border border-rose-500/40 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/10">
            <X size={11} /> Відхилити
          </button>
        </div>
      )}
    </li>
  );

  return (
    <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-4" data-profile-section="memory" data-memory-panel>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          <Brain size={13} /> Пам'ять героя
        </h3>
        <span className="text-[10px] text-slate-500">у знімок героя (рішення, допит) іде лише підтверджене</span>
      </div>
      {canEdit && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={busy === 'collect'} onClick={() => void collect()} data-memory-collect className="flex max-w-full items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-sky-500 disabled:opacity-50">
            {busy === 'collect' ? <Loader2 size={11} className="animate-spin" /> : <Tags size={11} />} Зібрати з тегів
          </button>
          <select value={aiSection} onChange={(e) => setAiSection(e.target.value)} data-memory-ai-section className="max-w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200">
            <option value="">Розділ для AI-2…</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <button type="button" disabled={!aiSection || aiRunning} onClick={() => void runAi()} data-memory-run-ai className="flex max-w-full items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-bold text-violet-200 hover:bg-violet-500/20 disabled:opacity-50">
            {aiRunning ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} AI-2: очима {heroName}
          </button>
          <button type="button" onClick={() => setForm((f) => ({ ...f, open: !f.open }))} data-memory-new className="flex max-w-full items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-emerald-500">
            <Plus size={11} /> Свій спогад
          </button>
        </div>
      )}
      {form.open && canEdit && (
        <div className="mb-2 space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2" data-memory-form>
          <div className="flex flex-wrap gap-1.5">
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as MemoryType }))} data-memory-new-type className="max-w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200">
              {GROUPS.map((g) => (
                <option key={g.type} value={g.type}>{g.title}</option>
              ))}
            </select>
            <select value={form.sceneId} onChange={(e) => setForm((f) => ({ ...f, sceneId: e.target.value }))} data-memory-new-scene className="max-w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200">
              <option value="">Без сцени (передісторія)</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            {canSeePrivate && (
              <label className="flex items-center gap-1 text-[11px] text-slate-300">
                <input type="checkbox" checked={form.hidden} onChange={(e) => setForm((f) => ({ ...f, hidden: e.target.checked }))} data-memory-new-private /> приватне
              </label>
            )}
          </div>
          <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} maxLength={2000} rows={2} placeholder={`Що пам'ятає ${heroName}…`} data-memory-new-content className="w-full rounded border border-slate-700 bg-slate-950 p-1.5 text-[12px] text-slate-100" />
          <button type="button" disabled={busy === 'add' || !form.content.trim()} onClick={() => void add()} data-memory-add className="rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40">
            Додати
          </button>
        </div>
      )}
      {message && <p className="mb-2 text-[11px] text-amber-300" data-memory-message>{message}</p>}
      {loading ? (
        <p className="text-[11px] text-slate-500"><Loader2 size={11} className="mr-1 inline animate-spin" />Завантаження…</p>
      ) : error ? (
        <p className="text-[11px] text-rose-300" data-memory-error>{error}</p>
      ) : (
        <>
          {attention.length > 0 && (
            <div className="mb-3" data-memory-attention>
              <p className="mb-1 text-[11px] font-bold text-amber-300">На розгляд автору: {attention.length}</p>
              <ul className="space-y-1.5">{attention.map(card)}</ul>
            </div>
          )}
          {GROUPS.map((g) => {
            const list = settled.filter((m) => m.memoryType === g.type);
            if (!list.length) return null;
            return (
              <div key={g.type} className="mb-2" data-memory-group={g.type}>
                <p className="mb-1 text-[11px] font-bold text-slate-300">
                  {g.title} <span className="font-normal text-slate-500">— {g.hint}</span>
                </p>
                <ul className="space-y-1.5">{list.map(card)}</ul>
              </div>
            );
          })}
          {!memories.length && <p className="text-[11px] text-slate-500" data-memory-empty>Пам'яті ще немає. {canEdit ? '«Зібрати з тегів» — події, розкриття й переконання героя з тексту.' : ''}</p>}
          {rejectedCount > 0 && (
            <button type="button" onClick={() => setShowRejected((v) => !v)} className="text-[11px] text-slate-500 hover:underline" data-memory-toggle-rejected>
              {showRejected ? 'Сховати відхилені' : `Показати відхилені (${rejectedCount})`}
            </button>
          )}
        </>
      )}
    </section>
  );
};

export default CharacterMemoryPanel;
