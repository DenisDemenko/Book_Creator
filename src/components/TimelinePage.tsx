/**
 * Сторінка 6 — «Хронологія» (Т2.1, ТЗ-11 §7).
 *
 * Дві шкали одна над одною: угорі — порядок, у якому сцени розказано
 * читачеві; унизу — час у світі книги. Лінія з'єднує сцену на обох шкалах:
 * флешбек (сцена, що стається раніше за вже розказане) видно як лінію, що йде
 * назад, і окремим блоком «Флешбеки» — критерій сторінки 6. Час задає автор
 * (точний, приблизний, інтервал, невизначений) — з підтвердженням; порядок у
 * часі світу можна змінити перетягуванням, теж із підтвердженням. Фільтри за
 * героєм, місцем, сюжетною лінією; попередження про часові суперечності з
 * переходом до сцени; «що герой знав до цієї сцени».
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, ExternalLink, GripVertical, History, Loader2, X } from 'lucide-react';
import type { Book } from '../types';
import { STORY_TIME_KIND_UK, type StoryTimeKind } from '../utils/storyTime';

interface TimeValue {
  kind: StoryTimeKind;
  start: string | null;
  end: string | null;
  key: number | null;
  endKey: number | null;
  label: string;
  source: string;
}
interface Scene {
  sectionId: string;
  title: string;
  chapterId: string | null;
  chapterNumber: number | null;
  narrativeIndex: number;
  firstParagraphId: string | null;
  excerpt: string;
  time: TimeValue | null;
  flashback: boolean;
  flashbackAfter: string | null;
  characters: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  storylines: { id: string; name: string }[];
}
interface Event {
  entityId: string;
  name: string;
  type: string;
  sectionId: string | null;
  paragraphId: string | null;
  narrativeIndex: number | null;
  time: TimeValue | null;
}
interface Warning {
  kind: string;
  message: string;
  sectionId: string | null;
  chapterId: string | null;
  paragraphId: string | null;
}
interface TimelineData {
  synced: boolean;
  canEdit?: boolean;
  scenes: Scene[];
  events: Event[];
  warnings: Warning[];
  lanes: { id: string; name: string }[];
}
interface Knowledge {
  character: { name: string };
  scene: { title: string; time: string | null };
  known: { kind: string; name: string; detail: string; sectionId: string; paragraphId: string; time: string | null }[];
  later: number;
  rule: string;
}

interface Props {
  book: Book;
  onOpenParagraph: (t: { chapterId: string; sectionId: string; editorPid: string; text: string }) => void;
}

type Selected = { kind: 'scene'; id: string } | { kind: 'event'; id: string } | null;

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

const COL = 150;
const CHIP_W = 132;

export const TimelinePage: React.FC<Props> = ({ book, onOpenParagraph }) => {
  const base = `/api/projects/${encodeURIComponent(book.id)}`;
  const [filters, setFilters] = useState({ character: '', location: '', storyline: '' });
  const [data, setData] = useState<TimelineData | null>(null);
  const [all, setAll] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [form, setForm] = useState({ kind: 'exact' as StoryTimeKind, start: '', end: '', label: '' });
  const [pending, setPending] = useState<{ text: string; body: Record<string, unknown> } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Ref — щоб «кинути» бачило перетягуване одразу, навіть якщо стан ще не оновився.
  const dragRef = useRef<string | null>(null);
  const [hero, setHero] = useState('');
  const [knowledge, setKnowledge] = useState<Knowledge | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const [r1, r2] = await Promise.all([
      api(`${base}/timeline?${qs.toString()}`).catch(() => null),
      qs.toString() ? api(`${base}/timeline`).catch(() => null) : Promise.resolve(null),
    ]);
    const b1 = r1 ? await r1.json().catch(() => ({})) : {};
    if (!r1 || !r1.ok) setError(r1?.status === 403 ? 'Немає доступу до цієї книги.' : r1?.status === 503 ? 'Семантичне ядро зараз недоступне.' : b1.error || 'Не вдалося завантажити хронологію.');
    else {
      setError(null);
      setData(b1);
      setAll(r2?.ok ? await r2.json() : b1);
    }
    setLoading(false);
  }, [base, filters]);
  useEffect(() => {
    void load();
  }, [load]);

  const options = useMemo(() => {
    const src = all?.scenes ?? [];
    const uniq = (xs: { id: string; name: string }[]) => [...new Map(xs.map((x) => [x.id, x])).values()].sort((a, b) => a.name.localeCompare(b.name));
    return { character: uniq(src.flatMap((s) => s.characters)), location: uniq(src.flatMap((s) => s.locations)), storyline: uniq(src.flatMap((s) => s.storylines)) };
  }, [all]);

  const scenes = data?.scenes ?? [];
  const timed = scenes.filter((s) => s.time?.key != null);
  const keys = timed.map((s) => s.time!.key!);
  const minK = keys.length ? Math.min(...keys) : 0;
  const maxK = keys.length ? Math.max(...keys) : 1;
  const width = Math.max(640, scenes.length * COL + 40);
  const storyX = (k: number) => 20 + (maxK === minK ? (width - 40 - CHIP_W) / 2 : ((k - minK) / (maxK - minK)) * (width - 40 - CHIP_W));
  const narrX = (i: number) => 20 + (i - 1) * COL;
  // Близькі в часі сцени не накладаються: кожна наступна, що налазить, — рядком нижче.
  const storyRow = useMemo(() => {
    const rows: number[] = [];
    const out = new Map<string, number>();
    for (const s of [...timed].sort((a, b) => a.time!.key! - b.time!.key!)) {
      const x = storyX(s.time!.key!);
      let r = rows.findIndex((right) => x >= right + 6);
      if (r < 0) r = rows.length;
      rows[r] = x + CHIP_W;
      out.set(s.sectionId, r);
    }
    return { out, count: Math.max(1, rows.length) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed.map((s) => `${s.sectionId}:${s.time!.key}`).join(), width]);
  const storyY = (id: string) => 222 + (storyRow.out.get(id) ?? 0) * 30;
  const svgH = 260 + storyRow.count * 30;

  const selectedScene = selected?.kind === 'scene' ? scenes.find((s) => s.sectionId === selected.id) : undefined;
  const selectedEvent = selected?.kind === 'event' ? data?.events.find((e) => e.entityId === selected.id) : undefined;
  const selTime = selectedScene?.time ?? selectedEvent?.time ?? null;
  useEffect(() => {
    setForm({ kind: selTime && selTime.source !== 'scene' && selTime.source !== 'studio' ? selTime.kind : 'exact', start: selTime?.start ?? '', end: selTime?.end ?? '', label: selTime?.source === 'author' ? selTime.label : '' });
    setKnowledge(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.kind, selected?.id]);

  const askSave = () => {
    if (!selected) return;
    const name = selectedScene?.title ?? selectedEvent?.name ?? '';
    setPending({ text: `Задати час «${name}»: ${STORY_TIME_KIND_UK[form.kind]}${form.start ? `, ${form.start}` : ''}${form.kind === 'interval' ? ` — ${form.end}` : ''}?`, body: { subjectKind: selected.kind, subjectId: selected.id, ...form } });
  };
  const confirm = async () => {
    if (!pending) return;
    const res = await api(`${base}/timeline/points`, { method: 'PUT', body: JSON.stringify(pending.body) }).catch(() => null);
    const b = res ? await res.json().catch(() => ({})) : {};
    setPending(null);
    setMessage(res?.ok ? 'Час збережено.' : b.error || 'Не вдалося зберегти.');
    if (res?.ok) await load();
  };

  // Перетягування в «порядку в часі світу» — нове місце між сусідами, з підтвердженням.
  const ordered = [...timed].sort((a, b) => a.time!.key! - b.time!.key! || a.narrativeIndex - b.narrativeIndex);
  const dropAt = (targetIdx: number) => {
    const moving = ordered.find((s) => s.sectionId === (dragRef.current ?? dragId));
    dragRef.current = null;
    setDragId(null);
    if (!moving) return;
    const rest = ordered.filter((s) => s.sectionId !== moving.sectionId);
    const prev = rest[targetIdx - 1];
    const next = rest[targetIdx];
    if (!prev && !next) return;
    const k = prev && next ? (prev.time!.key! + next.time!.key!) / 2 : prev ? prev.time!.key! + 1 : next!.time!.key! - 1;
    const key = String(Math.round(k * 1e4) / 1e4);
    const label = prev && next ? `між «${prev.title}» і «${next.title}»` : prev ? `після «${prev.title}»` : `до «${next!.title}»`;
    setSelected({ kind: 'scene', id: moving.sectionId });
    setPending({ text: `Перемістити «${moving.title}» у часі світу ${label}?`, body: { subjectKind: 'scene', subjectId: moving.sectionId, kind: 'approximate', start: key, label: `≈ ${label}` } });
  };

  /** Вибір сцени чи події кліком — скасовує незавершене підтвердження. */
  const choose = (sel: Selected) => {
    setPending(null);
    setSelected(sel);
  };

  const loadKnowledge = async (characterId: string) => {
    setHero(characterId);
    if (!characterId || !selectedScene) return setKnowledge(null);
    const res = await api(`${base}/timeline/knowledge?character=${encodeURIComponent(characterId)}&scene=${encodeURIComponent(selectedScene.sectionId)}`).catch(() => null);
    setKnowledge(res?.ok ? await res.json() : null);
  };

  const open = (sectionId: string | null, chapterId: string | null, paragraphId: string | null, text = '') => {
    if (sectionId && chapterId && paragraphId) onOpenParagraph({ chapterId, sectionId, editorPid: paragraphId, text });
  };
  const flashbacks = scenes.filter((s) => s.flashback);
  const untimed = scenes.filter((s) => s.time?.key == null);
  const nameOfScene = (id: string | null) => scenes.find((s) => s.sectionId === id)?.title ?? '';
  const selectCls = 'min-w-0 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200';

  return (
    <section className="min-w-0 space-y-3" data-timeline>
      <div className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-3">
        {(['character', 'location', 'storyline'] as const).map((k) => (
          <label key={k} className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-400">
            {k === 'character' ? 'Герой' : k === 'location' ? 'Місце' : 'Сюжетна лінія'}
            <select className={selectCls} value={filters[k]} data-timeline-filter={k} onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))}>
              <option value="">усі</option>
              {options[k].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {loading && !data && <Loader2 className="h-5 w-5 animate-spin text-slate-500" />}
      {error && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{error}</p>}
      {data && !data.synced && <p className="text-sm text-slate-400">Книгу ще не синхронізовано з ядром — збережіть її й відкрийте хронологію за кілька секунд.</p>}
      {message && <p className="text-[11px] text-amber-300" data-timeline-message>{message}</p>}

      {data && data.synced && (
        <>
          <div className="min-w-0 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 p-2" data-timeline-axes>
            <svg width={width} height={svgH} className="block" role="img" aria-label="Порядок оповіді й час у світі">
              <text x={20} y={16} fill="#94a3b8" fontSize={11}>Порядок розкриття читачеві</text>
              <text x={20} y={206} fill="#94a3b8" fontSize={11}>Час у світі книги</text>
              <line x1={10} x2={width - 10} y1={214} y2={214} stroke="#334155" />
              {timed.map((s) => {
                const x1 = narrX(s.narrativeIndex) + CHIP_W / 2;
                const x2 = storyX(s.time!.key!) + CHIP_W / 2;
                return <line key={`l-${s.sectionId}`} x1={x1} y1={62} x2={x2} y2={storyY(s.sectionId)} stroke={s.flashback ? '#f59e0b' : '#38bdf8'} strokeWidth={s.flashback ? 2.5 : 1.2} strokeDasharray={s.flashback ? '6 4' : undefined} />;
              })}
              {scenes.map((s) => (
                <g key={`n-${s.sectionId}`} transform={`translate(${narrX(s.narrativeIndex)},24)`} onClick={() => choose({ kind: 'scene', id: s.sectionId })} className="cursor-pointer" data-timeline-narrative={s.sectionId}>
                  <rect width={CHIP_W} height={38} rx={8} fill={selected?.id === s.sectionId ? '#1e3a8a' : '#0f172a'} stroke={s.flashback ? '#f59e0b' : '#334155'} strokeWidth={s.flashback ? 2 : 1} />
                  <text x={8} y={15} fill="#94a3b8" fontSize={10}>#{s.narrativeIndex}{s.chapterNumber ? ` · гл. ${s.chapterNumber}` : ''}{s.flashback ? ' · флешбек' : ''}</text>
                  <text x={8} y={30} fill="#e2e8f0" fontSize={11}>{s.title.length > 18 ? `${s.title.slice(0, 17)}…` : s.title}</text>
                </g>
              ))}
              {timed.map((s) => (
                <g key={`s-${s.sectionId}`} transform={`translate(${storyX(s.time!.key!)},${storyY(s.sectionId)})`} onClick={() => choose({ kind: 'scene', id: s.sectionId })} className="cursor-pointer" data-timeline-story={s.sectionId}>
                  <rect width={CHIP_W} height={24} rx={6} fill={s.flashback ? '#78350f' : '#0c4a6e'} />
                  <text x={6} y={16} fill="#f8fafc" fontSize={10}>{s.time!.label.length > 20 ? `${s.time!.label.slice(0, 19)}…` : s.time!.label}</text>
                </g>
              ))}
            </svg>
          </div>

          {flashbacks.length > 0 && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3" data-timeline-flashbacks>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-300">
                <History className="h-3.5 w-3.5" /> Флешбеки ({flashbacks.length})
              </h3>
              <ul className="space-y-1">
                {flashbacks.map((s) => (
                  <li key={s.sectionId} className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-200" data-timeline-flashback={s.sectionId}>
                    <button type="button" className="font-bold hover:text-amber-200" onClick={() => choose({ kind: 'scene', id: s.sectionId })}>{s.title}</button>
                    <span className="text-slate-400">— розказано {s.narrativeIndex}-ю, а сталося {s.time?.label}, раніше за «{nameOfScene(s.flashbackAfter)}»</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.warnings.length > 0 && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-3" data-timeline-warnings>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-rose-300">
                <AlertTriangle className="h-3.5 w-3.5" /> Часові суперечності ({data.warnings.length})
              </h3>
              <ul className="space-y-1">
                {data.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[12px] text-slate-200" data-timeline-warning={w.kind}>
                    <span className="flex-1">{w.message}</span>
                    {w.paragraphId && w.chapterId && (
                      <button type="button" data-timeline-warning-open onClick={() => open(w.sectionId, w.chapterId, w.paragraphId)} className="flex shrink-0 items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[11px] hover:border-sky-500">
                        <ExternalLink className="h-3 w-3" /> до сцени
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-3" data-timeline-order>
              <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Порядок у часі світу {data.canEdit ? '(перетягніть, щоб змінити)' : ''}</h3>
              {ordered.length ? (
                <ol className="space-y-1">
                  {ordered.map((s, i) => (
                    <li
                      key={s.sectionId}
                      draggable={!!data.canEdit}
                      onDragStart={(e) => {
                        dragRef.current = s.sectionId;
                        e.dataTransfer?.setData('text/plain', s.sectionId);
                        setDragId(s.sectionId);
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => dropAt(i)}
                      data-timeline-order-item={s.sectionId}
                      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] ${s.flashback ? 'border-amber-500/40' : 'border-slate-800'} ${dragId === s.sectionId ? 'opacity-50' : ''}`}
                    >
                      {data.canEdit && <GripVertical className="h-3 w-3 shrink-0 text-slate-500" />}
                      <button type="button" className="flex-1 truncate text-left text-slate-200 hover:text-sky-300" onClick={() => choose({ kind: 'scene', id: s.sectionId })}>{s.title}</button>
                      <span className="max-w-[45%] truncate text-[10px] text-slate-400">{s.time!.label}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[11px] text-slate-500">Часу у світі ще не задано жодній сцені — оберіть сцену на шкалі вгорі.</p>
              )}
              {untimed.length > 0 && <p className="mt-2 text-[11px] text-slate-500">Без часу: {untimed.map((s) => s.title).join(', ')}</p>}
            </div>
            <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-3" data-timeline-events>
              <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Події ({data.events.length})</h3>
              <ul className="space-y-1">
                {data.events.map((e) => (
                  <li key={e.entityId} className="flex items-center gap-1.5 text-[12px]">
                    <button type="button" className="flex-1 truncate text-left text-slate-200 hover:text-sky-300" data-timeline-event={e.entityId} onClick={() => choose({ kind: 'event', id: e.entityId })}>{e.name}</button>
                    <span className="max-w-[45%] truncate text-[10px] text-slate-400">{e.time ? `${e.time.label}${e.time.source === 'scene' ? ' (зі сцени)' : ''}` : 'час невідомий'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {(selectedScene || selectedEvent) && (
            <aside className="min-w-0 space-y-2.5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4" data-timeline-panel={selected!.id}>
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 text-sky-300" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold text-slate-100">{selectedScene?.title ?? selectedEvent?.name}</h3>
                  <p className="text-[11px] text-slate-400">
                    {selectedScene ? `сцена #${selectedScene.narrativeIndex}${selectedScene.chapterNumber ? `, глава ${selectedScene.chapterNumber}` : ''}` : 'подія'} · час: {selTime ? selTime.label : 'не задано'}
                    {selectedScene?.flashback ? ' · флешбек' : ''}
                  </p>
                </div>
                {selectedScene?.firstParagraphId && selectedScene.chapterId && (
                  <button type="button" data-timeline-open onClick={() => open(selectedScene.sectionId, selectedScene.chapterId, selectedScene.firstParagraphId, selectedScene.excerpt)} className="flex shrink-0 items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[11px] hover:border-sky-500">
                    <ExternalLink className="h-3 w-3" /> до сцени
                  </button>
                )}
                <button type="button" onClick={() => choose(null)} className="text-slate-500 hover:text-slate-200"><X className="h-4 w-4" /></button>
              </div>
              {data.canEdit && (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-4" data-timeline-form>
                  <select className={selectCls} value={form.kind} data-timeline-kind onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as StoryTimeKind }))}>
                    {(Object.keys(STORY_TIME_KIND_UK) as StoryTimeKind[]).map((k) => (
                      <option key={k} value={k}>{STORY_TIME_KIND_UK[k]}</option>
                    ))}
                  </select>
                  {form.kind !== 'unknown' && <input className={selectCls} value={form.start} placeholder="1998-05-14, «день 3» або число" data-timeline-start onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />}
                  {form.kind === 'interval' && <input className={selectCls} value={form.end} placeholder="кінець" data-timeline-end onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />}
                  <input className={selectCls} value={form.label} placeholder="підпис (весна 1998)" onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
                  <button type="button" onClick={askSave} data-timeline-save className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 sm:col-span-4">Задати час</button>
                </div>
              )}
              {pending && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-[12px] text-sky-100" data-timeline-confirm>
                  <span className="flex-1">{pending.text}</span>
                  <button type="button" data-timeline-confirm-yes onClick={() => void confirm()} className="rounded bg-sky-600 px-2.5 py-0.5 text-[11px] font-bold text-white">Так</button>
                  <button type="button" onClick={() => setPending(null)} className="rounded border border-slate-600 px-2.5 py-0.5 text-[11px]">Ні</button>
                </div>
              )}
              {selectedScene && (
                <div className="space-y-1.5 border-t border-slate-800 pt-2.5" data-timeline-knowledge>
                  <label className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    Що знав до цієї сцени:
                    <select className={selectCls} value={hero} data-timeline-knowledge-hero onChange={(e) => void loadKnowledge(e.target.value)}>
                      <option value="">оберіть героя</option>
                      {options.character.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  {knowledge && (
                    <>
                      <p className="text-[10px] text-slate-500">{knowledge.rule}</p>
                      {knowledge.known.length ? (
                        <ul className="space-y-1" data-timeline-known>
                          {knowledge.known.map((k, i) => (
                            <li key={i} className="text-[12px] text-slate-200" data-timeline-known-item={k.kind}>
                              <span className="rounded bg-slate-800 px-1 text-[10px] text-slate-300">{k.kind === 'revelation' ? 'дізнався' : k.kind === 'event' ? 'подія' : 'факт'}</span> {k.name}
                              {k.detail ? <span className="text-slate-400"> · {k.detail}</span> : null}
                              {k.time ? <span className="text-[10px] text-slate-500"> · {k.time}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-slate-500">Нічого — до цієї сцени герой ще нічого з позначеного не знав.</p>
                      )}
                      {knowledge.later > 0 && <p className="text-[10px] text-slate-500">Ще {knowledge.later} — герой дізнається пізніше (не показано, щоб не було спойлерів).</p>}
                    </>
                  )}
                </div>
              )}
            </aside>
          )}
        </>
      )}
    </section>
  );
};

export default TimelinePage;
