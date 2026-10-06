/**
 * Сторінка 8 — «Перевірка безперервності» (Т2.4 В8, PLAN_CONTINUITY.md §3).
 *
 * Три вкладки над тим, що вже роблять В1–В7:
 *   • «Проблеми» — перелік `continuity_issues` (фільтр за видом і статусом),
 *     картка з обома доказами поруч і переходом до тексту, кнопки статусу
 *     (критерій сторінки 8: автор бачить проблеми з двома доказами й змінює
 *     статус); запуск п'яти правил без AI одним кліком і AI-2 по розділу або
 *     лише по змінених місцях — усе тільки за командою автора;
 *   • «Риси» — риси сутностей (вік, колір, матеріал…), пропозиції AI-2 з
 *     «Підтвердити / Відхилити», додавання риси вручну;
 *   • «Чернетка» — перевірка чернетки героя на «витік знання» (ТЗ-H) станом
 *     на сцену й історія перевірок.
 * Читач бачить проблеми й риси без кнопок; чернетка — лише автору.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FileSearch, Loader2, ListChecks, Play, Plus, Sparkles, Tags, Trash2, X } from 'lucide-react';
import type { Book } from '../types';

type IssueKind = 'object' | 'knowledge' | 'place' | 'age' | 'time' | 'causality';
type IssueStatus = 'suggested' | 'confirmed' | 'dismissed' | 'resolved' | 'needs_review';

interface Evidence {
  sectionId: string;
  paragraphId: string | null;
  quote: string;
  entityId: string | null;
}
interface Issue {
  id: string;
  kind: IssueKind;
  entityId: string | null;
  summary: string;
  evidenceA: Evidence;
  evidenceB: Evidence | null;
  status: IssueStatus;
  source: 'rule' | 'ai';
  insufficientData: boolean;
  createdBy: string;
  updatedAt: string;
}
interface Place {
  paragraphId: string | null;
  editorPid: string | null;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterNumber: number | null;
  missing: boolean;
}
interface IssuesData {
  issues: Issue[];
  places: Record<string, Place>;
  entities: Record<string, { name: string; type: string }>;
  counts: { byKind: Record<string, number>; byStatus: Record<string, number>; total: number };
  canEdit: boolean;
}
interface Trait {
  id: string;
  entityId: string;
  label: string;
  value: string;
  sectionId: string | null;
  status: 'suggested' | 'confirmed' | 'rejected';
  source: 'author' | 'ai';
  supersedes: string | null;
  appearanceVersionId: string | null;
}
interface TraitsData {
  entities: { id: string; name: string; type: string; traits: Trait[] }[];
  sections: Record<string, { title: string; chapterNumber: number | null }>;
  suggested: number;
  canEdit: boolean;
}
interface DraftFinding {
  entityId: string;
  entityName: string;
  kind: 'revelation' | 'event';
  match: 'tag' | 'name';
  quote: string;
  reason: 'learns_later' | 'never_learns';
  learnsAt: { sectionId: string; title: string; chapterNumber: number | null; via: 'subject' | 'present' } | null;
}
interface DraftCheck {
  id: string;
  characterId: string;
  sectionId: string | null;
  draftText: string;
  findings: DraftFinding[];
  simulationId: string | null;
  createdAt: string;
}
interface DraftResult {
  check: DraftCheck;
  known: string[];
  unknownTags: string[];
  rule: string;
}

interface Props {
  book: Book;
  onOpenParagraph: (t: { chapterId: string; sectionId: string; editorPid: string; text: string }) => void;
}

const KIND_UK: Record<IssueKind, string> = { time: 'Час', age: 'Вік', knowledge: 'Знання', place: 'Місце', object: 'Предмет', causality: 'Причинність' };
const KINDS: IssueKind[] = ['time', 'age', 'knowledge', 'place', 'object', 'causality'];
const STATUS_UK: Record<IssueStatus, string> = {
  needs_review: 'На перегляд',
  suggested: 'Пропозиція',
  confirmed: 'Підтверджено',
  resolved: 'Виправлено',
  dismissed: 'Відхилено',
};
const STATUS_CLS: Record<IssueStatus, string> = {
  needs_review: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
  suggested: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  confirmed: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  resolved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  dismissed: 'border-slate-600 bg-slate-800/60 text-slate-400',
};
/** Які кнопки статусу доречні з кожного стану. */
const ACTIONS: Record<IssueStatus, { to: IssueStatus; label: string }[]> = {
  suggested: [{ to: 'confirmed', label: 'Підтвердити' }, { to: 'dismissed', label: 'Відхилити' }],
  confirmed: [{ to: 'resolved', label: 'Виправлено' }, { to: 'dismissed', label: 'Відхилити' }],
  needs_review: [{ to: 'confirmed', label: 'Досі актуально' }, { to: 'resolved', label: 'Виправлено' }, { to: 'dismissed', label: 'Відхилити' }],
  resolved: [{ to: 'confirmed', label: 'Повернути' }],
  dismissed: [{ to: 'confirmed', label: 'Повернути' }],
};
const TYPE_UK: Record<string, string> = { character: 'Герой', location: 'Локація', world: 'Світ', object: 'Предмет', tool: 'Інструмент', group: 'Група', revelation: 'Розкриття', event: 'Подія', decision: 'Рішення' };

const api = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  return { ok: !!res?.ok, status: res?.status ?? 0, body: body as any };
};
const problemText = (status: number, fallback?: string) =>
  status === 403 ? 'Немає доступу до цієї книги.' : status === 503 ? 'Семантичне ядро зараз недоступне.' : status === 0 ? 'Немає зв\'язку з сервером.' : fallback || `Помилка ${status}`;
const btn = 'inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-left text-[11px] font-semibold disabled:opacity-50';
const selectCls = 'min-w-0 max-w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200';

/** Розділи книги в порядку читання — для «AI-2 по розділу» і «станом на сцену». */
function useSections(book: Book) {
  return useMemo(
    () =>
      [...(book.chapters ?? [])]
        .sort((a, b) => a.order - b.order)
        .flatMap((c, ci) => [...(c.sections ?? [])].sort((a, b) => a.order - b.order).map((s) => ({ id: s.id, label: `гл. ${ci + 1} · ${s.title || 'без назви'}` }))),
    [book.chapters],
  );
}

// ── Проблеми ────────────────────────────────────────────────────────────────

function EvidenceBox({ label, ev, place, onOpen, insufficient }: { label: string; ev: Evidence | null; place?: Place; onOpen: () => void; insufficient?: boolean }) {
  if (!ev) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 p-2.5 text-[12px] text-slate-400" data-cont-evidence-missing>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
        {insufficient ? 'Недостатньо даних — другої сторони не знайдено.' : '—'}
      </div>
    );
  }
  const where = place
    ? `${place.chapterNumber ? `гл. ${place.chapterNumber} · ` : ''}${place.sectionTitle ? `«${place.sectionTitle}»` : 'розділ'}`
    : 'розділ';
  const canOpen = !!place && !place.missing && !!place.chapterId && !!place.editorPid;
  return (
    <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5" data-cont-evidence>
      <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        <span className="truncate font-normal normal-case text-slate-400">{where}</span>
      </div>
      <blockquote className="break-words border-l-2 border-slate-600 pl-2 text-[12px] leading-relaxed text-slate-200">{ev.quote}</blockquote>
      {place?.missing && <p className="mt-1 text-[11px] text-amber-300">Цього місця вже немає в книзі.</p>}
      {canOpen && (
        <button type="button" onClick={onOpen} data-cont-open={ev.paragraphId} className={`${btn} mt-1.5 border-slate-700 text-slate-300 hover:border-sky-500`}>
          <ExternalLink className="h-3 w-3" /> Відкрити в тексті
        </button>
      )}
    </div>
  );
}

function IssuesTab({ book, onOpenParagraph }: Props) {
  const base = `/api/projects/${encodeURIComponent(book.id)}`;
  const sections = useSections(book);
  const [kind, setKind] = useState<IssueKind | ''>('');
  const [status, setStatus] = useState<IssueStatus | ''>('');
  const [data, setData] = useState<IssuesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [aiSection, setAiSection] = useState('');
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    if (status) qs.set('status', status);
    const r = await api(`${base}/continuity/issues?${qs.toString()}`);
    if (!alive.current) return;
    if (!r.ok) setError(problemText(r.status, r.body.error));
    else {
      setError(null);
      setData(r.body);
    }
  }, [base, kind, status]);
  useEffect(() => {
    void load();
  }, [load]);

  const setIssueStatus = async (id: string, to: IssueStatus) => {
    setBusy(`status:${id}`);
    const r = await api(`${base}/continuity/issues/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status: to }) });
    setBusy(null);
    if (!r.ok) setMessage(problemText(r.status, r.body.error));
    await load();
  };

  const runRules = async () => {
    setBusy('rules');
    setMessage(null);
    const r = await api(`${base}/continuity/rules/all`, { method: 'POST' });
    setBusy(null);
    setMessage(r.ok ? `Правила перевірено: нових проблем — ${r.body.created}, оновлено — ${r.body.updated}.` : problemText(r.status, r.body.error));
    await load();
  };

  /** AI-2: поставити задачі й чекати, доки всі завершаться (опитування статусу задачі). */
  const runAi = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setMessage(null);
    const r = await api(`${base}/continuity/ai`, { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) {
      setBusy(null);
      setMessage(r.status === 402 ? 'Бюджет AI для цієї книги вичерпано.' : r.status === 429 ? 'Забагато запусків — спробуйте за хвилину.' : problemText(r.status, r.body.error));
      return;
    }
    const jobs: { sectionId: string; jobId: string }[] = r.body.jobs ?? [];
    if (!jobs.length) {
      setBusy(null);
      setMessage(r.body.note || 'Нічого перевіряти.');
      return;
    }
    setMessage(`AI-2 перевіряє розділів: ${jobs.length}…`);
    let issues = 0;
    let traits = 0;
    let failed = 0;
    const pending = new Set(jobs.map((j) => j.jobId));
    for (let i = 0; i < 180 && pending.size && alive.current; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      for (const id of [...pending]) {
        const j = await api(`${base}/jobs/${encodeURIComponent(id)}`);
        if (!j.ok || !['succeeded', 'failed', 'cancelled'].includes(j.body.status)) continue;
        pending.delete(id);
        if (j.body.status !== 'succeeded') failed++;
        issues += Number(j.body.result?.issues ?? 0) + Number(j.body.result?.refreshed ?? 0);
        traits += Number(j.body.result?.traits ?? 0);
      }
    }
    if (!alive.current) return;
    setBusy(null);
    setMessage(
      pending.size
        ? 'AI-2 ще працює — результати з\'являться тут, щойно задачі завершаться (оновіть сторінку).'
        : `AI-2 завершив: проблем — ${issues}, рис на розгляд — ${traits}${failed ? `, не вдалося — ${failed}` : ''}.${r.body.stopped ? ` Частину не поставлено: ${r.body.stopped.error}` : ''}`,
    );
    await load();
  };

  const open = (ev: Evidence, place?: Place) => {
    if (place?.chapterId && place.editorPid) onOpenParagraph({ chapterId: place.chapterId, sectionId: place.sectionId, editorPid: place.editorPid, text: ev.quote });
  };
  const counts = data?.counts;
  const needsReview = counts?.byStatus.needs_review ?? 0;

  return (
    <div className="space-y-3" data-cont-issues-tab>
      {data?.canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
          <button type="button" data-cont-run-rules disabled={!!busy} onClick={runRules} className={`${btn} border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20`}>
            {busy === 'rules' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Перевірити правилами
          </button>
          <span className="hidden h-5 w-px bg-slate-700 sm:block" />
          <select className={selectCls} value={aiSection} onChange={(e) => setAiSection(e.target.value)} data-cont-ai-section>
            <option value="">розділ для AI-2…</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button type="button" data-cont-run-ai disabled={!!busy || !aiSection} onClick={() => runAi({ sectionId: aiSection }, 'ai')} className={`${btn} border-violet-500/50 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20`}>
            {busy === 'ai' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} AI-2: перевірити розділ
          </button>
          <button type="button" data-cont-run-changed disabled={!!busy || !needsReview} onClick={() => runAi({ changed: true }, 'changed')} className={`${btn} border-amber-500/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20`} title="AI-2 лише по розділах, де текст доказів змінився">
            {busy === 'changed' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Змінені місця ({needsReview})
          </button>
        </div>
      )}
      {message && <p className="text-[12px] text-slate-300" data-cont-message>{message}</p>}
      {error && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{error}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" data-cont-kind="" onClick={() => setKind('')} className={`${btn} ${kind === '' ? 'border-sky-500 bg-sky-500/15 text-sky-100' : 'border-slate-700 text-slate-300'}`}>
          Усі {counts ? `· ${counts.total}` : ''}
        </button>
        {KINDS.map((k) => (
          <button key={k} type="button" data-cont-kind={k} onClick={() => setKind(k)} className={`${btn} ${kind === k ? 'border-sky-500 bg-sky-500/15 text-sky-100' : 'border-slate-700 text-slate-300'}`}>
            {KIND_UK[k]} · {counts?.byKind[k] ?? 0}
          </button>
        ))}
        <select className={`${selectCls} ml-auto`} value={status} onChange={(e) => setStatus(e.target.value as IssueStatus | '')} data-cont-status>
          <option value="">усі статуси</option>
          {(Object.keys(STATUS_UK) as IssueStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_UK[s]} ({counts?.byStatus[s] ?? 0})
            </option>
          ))}
        </select>
      </div>

      {!data && !error && <Loader2 className="h-5 w-5 animate-spin text-slate-500" />}
      {data && data.issues.length === 0 && (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400" data-cont-empty>
          {counts?.total
            ? 'За цим фільтром проблем немає.'
            : data.canEdit
              ? 'Проблем безперервності не знайдено. Натисніть «Перевірити правилами» — час, вік, знання, місце й предмет перевіряються без AI; AI-2 шукає глибше по розділу.'
              : 'Проблем безперервності не знайдено.'}
        </p>
      )}
      <ul className="space-y-2.5">
        {data?.issues.map((i) => {
          const pa = data.places[i.evidenceA.paragraphId ?? `section:${i.evidenceA.sectionId}`];
          const pb = i.evidenceB ? data.places[i.evidenceB.paragraphId ?? `section:${i.evidenceB.sectionId}`] : undefined;
          const who = i.entityId ? data.entities[i.entityId] : undefined;
          return (
            <li key={i.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3" data-cont-issue={i.id} data-cont-issue-status={i.status} data-cont-issue-kind={i.kind}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-full border border-slate-600 px-2 py-0.5 font-bold text-slate-200">{KIND_UK[i.kind]}</span>
                <span className={`rounded-full border px-2 py-0.5 ${STATUS_CLS[i.status]}`}>{STATUS_UK[i.status]}</span>
                <span className="text-slate-500">{i.source === 'ai' ? 'AI-2' : 'правило'}</span>
                {who && <span className="text-slate-400">· {TYPE_UK[who.type] ?? who.type}: {who.name}</span>}
              </div>
              <p className="mb-2 text-[13px] leading-relaxed text-slate-100">{i.summary}</p>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <EvidenceBox label="Доказ А" ev={i.evidenceA} place={pa} onOpen={() => open(i.evidenceA, pa)} />
                <EvidenceBox label="Доказ Б" ev={i.evidenceB} place={pb} insufficient={i.insufficientData} onOpen={() => i.evidenceB && open(i.evidenceB, pb)} />
              </div>
              {i.status === 'needs_review' && <p className="mt-1.5 text-[11px] text-amber-300">Текст доказу змінився після перевірки — погляньте, чи суперечність лишилась.</p>}
              {data.canEdit && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ACTIONS[i.status].map((a) => (
                    <button
                      key={a.to}
                      type="button"
                      data-cont-set={a.to}
                      disabled={busy === `status:${i.id}`}
                      onClick={() => setIssueStatus(i.id, a.to)}
                      className={`${btn} ${a.to === 'dismissed' ? 'border-slate-600 text-slate-300 hover:border-slate-400' : a.to === 'resolved' ? 'border-emerald-500/50 text-emerald-200 hover:bg-emerald-500/10' : 'border-sky-500/50 text-sky-200 hover:bg-sky-500/10'}`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Риси ────────────────────────────────────────────────────────────────────

function TraitsTab({ book }: { book: Book }) {
  const base = `/api/projects/${encodeURIComponent(book.id)}`;
  const sections = useSections(book);
  const [data, setData] = useState<TraitsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entities, setEntities] = useState<{ id: string; name: string; type: string }[]>([]);
  const [form, setForm] = useState({ entityId: '', label: '', value: '', sectionId: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api(`${base}/continuity/traits`);
    if (!r.ok) setError(problemText(r.status, r.body.error));
    else {
      setError(null);
      setData(r.body);
    }
  }, [base]);
  useEffect(() => {
    void load();
    void api(`${base}/entities`).then((r) => {
      if (r.ok) setEntities((r.body.entities ?? []).filter((e: any) => ['character', 'location', 'world', 'object', 'tool', 'group'].includes(e.type)).sort((a: any, b: any) => a.name.localeCompare(b.name, 'uk')));
    });
  }, [base, load]);

  const decide = async (t: Trait, status: 'confirmed' | 'rejected') => {
    setBusy(t.id);
    const r = await api(`${base}/entities/${encodeURIComponent(t.entityId)}/traits/${encodeURIComponent(t.id)}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    setBusy(null);
    if (!r.ok) setMessage(problemText(r.status, r.body.error));
    await load();
  };
  const remove = async (t: Trait) => {
    setBusy(t.id);
    const r = await api(`${base}/entities/${encodeURIComponent(t.entityId)}/traits/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
    setBusy(null);
    if (!r.ok) setMessage(problemText(r.status, r.body.error));
    await load();
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.entityId || !form.label.trim() || !form.value.trim()) return;
    setBusy('add');
    const r = await api(`${base}/entities/${encodeURIComponent(form.entityId)}/traits`, {
      method: 'PUT',
      body: JSON.stringify({ label: form.label, value: form.value, sectionId: form.sectionId || undefined }),
    });
    setBusy(null);
    if (!r.ok) setMessage(problemText(r.status, r.body.error));
    else {
      setMessage(`Рису «${form.label.trim()}» додано.`);
      setForm((f) => ({ ...f, label: '', value: '' }));
    }
    await load();
  };

  return (
    <div className="space-y-3" data-cont-traits-tab>
      <p className="text-[12px] text-slate-400">
        Риса — пара «мітка → значення» (вік, колір очей, матеріал даху…). Дві підтверджені риси з однаковою міткою й різним значенням — проблема безперервності
        (правила «вік», «місце», «предмет»). Пропозиції AI-2 стають рисами лише після вашого «Підтвердити».
      </p>
      {data?.canEdit && (
        <form onSubmit={add} className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-5" data-cont-trait-form>
          <select className={selectCls} value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })} data-cont-trait-entity-select>
            <option value="">сутність…</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({TYPE_UK[e.type] ?? e.type})
              </option>
            ))}
          </select>
          <input className={selectCls} placeholder="мітка (напр. колір очей)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} data-cont-trait-label maxLength={80} />
          <input className={selectCls} placeholder="значення" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} data-cont-trait-value maxLength={400} />
          <select className={selectCls} value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })} data-cont-trait-section>
            <option value="">де встановлено (необов'язково)</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy === 'add' || !form.entityId || !form.label.trim() || !form.value.trim()} className={`${btn} justify-center border-emerald-500/50 text-emerald-200 hover:bg-emerald-500/10`} data-cont-trait-add>
            <Plus className="h-3.5 w-3.5" /> Додати рису
          </button>
        </form>
      )}
      {message && <p className="text-[12px] text-slate-300" data-cont-message>{message}</p>}
      {error && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{error}</p>}
      {!data && !error && <Loader2 className="h-5 w-5 animate-spin text-slate-500" />}
      {data && data.entities.length === 0 && <p className="text-sm text-slate-400" data-cont-empty>Рис ще немає.</p>}
      <div className="grid min-w-0 grid-cols-1 gap-2.5 lg:grid-cols-2">
        {data?.entities.map((e) => (
          <section key={e.id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-3" data-cont-trait-entity={e.id}>
            <h3 className="mb-1.5 text-[13px] font-bold text-slate-100">
              {e.name} <span className="font-normal text-slate-500">· {TYPE_UK[e.type] ?? e.type}</span>
            </h3>
            <ul className="space-y-1">
              {e.traits.map((t) => {
                const where = t.sectionId ? data.sections[t.sectionId] : undefined;
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-1.5 text-[12px]" data-cont-trait={t.id} data-cont-trait-status={t.status}>
                    <span className="text-slate-400">{t.label}:</span>
                    <span className="font-semibold text-slate-100">{t.value}</span>
                    {t.status === 'suggested' && <span className="rounded-full border border-violet-500/40 px-1.5 text-[10px] text-violet-200">пропозиція AI-2</span>}
                    {t.appearanceVersionId && <span className="text-[10px] text-slate-500">з версії зовнішності</span>}
                    {t.supersedes && <span className="text-[10px] text-slate-500">замінює попередню</span>}
                    {where && <span className="text-[10px] text-slate-500">{where.chapterNumber ? `гл. ${where.chapterNumber} · ` : ''}«{where.title}»</span>}
                    {data.canEdit && t.status === 'suggested' && (
                      <>
                        <button type="button" disabled={busy === t.id} onClick={() => decide(t, 'confirmed')} data-cont-trait-set="confirmed" className={`${btn} border-sky-500/50 text-sky-200`}>
                          <CheckCircle2 className="h-3 w-3" /> Підтвердити
                        </button>
                        <button type="button" disabled={busy === t.id} onClick={() => decide(t, 'rejected')} data-cont-trait-set="rejected" className={`${btn} border-slate-600 text-slate-300`}>
                          <X className="h-3 w-3" /> Відхилити
                        </button>
                      </>
                    )}
                    {data.canEdit && t.status !== 'suggested' && !t.appearanceVersionId && (
                      <button type="button" disabled={busy === t.id} onClick={() => remove(t)} data-cont-trait-delete title="Видалити рису" className="ml-auto text-slate-500 hover:text-rose-300">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

// ── Чернетка ────────────────────────────────────────────────────────────────

function DraftFindings({ findings }: { findings: DraftFinding[] }) {
  if (!findings.length) {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-emerald-300" data-cont-draft-clean>
        <CheckCircle2 className="h-4 w-4" /> Витоку знання не знайдено.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {findings.map((f, i) => (
        <li key={`${f.entityId}-${i}`} className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-2.5 text-[12px]" data-cont-draft-finding={f.entityId} data-cont-draft-reason={f.reason}>
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />
            <span className="font-bold text-rose-100">{f.entityName}</span>
            <span className="text-slate-400">({f.kind === 'revelation' ? 'розкриття' : 'подія'}, {f.match === 'tag' ? 'тег' : 'за назвою в тексті'})</span>
          </div>
          <p className="text-slate-200">
            {f.reason === 'learns_later' && f.learnsAt
              ? `Герой дізнається про це лише пізніше — ${f.learnsAt.chapterNumber ? `гл. ${f.learnsAt.chapterNumber}, ` : ''}«${f.learnsAt.title}» (${f.learnsAt.via === 'subject' ? 'йому розкривають' : 'він присутній'}).`
              : 'У книзі герой про це не дізнається зовсім.'}
          </p>
          <blockquote className="mt-1 border-l-2 border-rose-500/40 pl-2 text-slate-300">{f.quote}</blockquote>
        </li>
      ))}
    </ul>
  );
}

function DraftTab({ book }: { book: Book }) {
  const base = `/api/projects/${encodeURIComponent(book.id)}`;
  const sections = useSections(book);
  const [heroes, setHeroes] = useState<{ id: string; name: string }[]>([]);
  const [hero, setHero] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<DraftResult | null>(null);
  const [history, setHistory] = useState<DraftCheck[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api(`${base}/entities?type=character`).then((r) => {
      if (!r.ok) return;
      const list = (r.body.entities ?? []).sort((a: any, b: any) => a.name.localeCompare(b.name, 'uk'));
      setHeroes(list);
      setHero((h) => h || list[0]?.id || '');
    });
  }, [base]);
  const loadHistory = useCallback(async () => {
    if (!hero) return setHistory([]);
    const r = await api(`${base}/continuity/draft-checks?characterId=${encodeURIComponent(hero)}&limit=20`);
    setHistory(r.ok ? r.body.checks ?? [] : []);
  }, [base, hero]);
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const check = async () => {
    setBusy(true);
    setError(null);
    const r = await api(`${base}/continuity/check-draft`, { method: 'POST', body: JSON.stringify({ characterId: hero, draftText: text, sectionId: sectionId || undefined }) });
    setBusy(false);
    if (!r.ok) {
      setError(problemText(r.status, r.body.error));
      return;
    }
    setResult(r.body);
    await loadHistory();
  };
  const sectionLabel = (id: string | null) => (id ? sections.find((s) => s.id === id)?.label ?? 'сцена' : 'кінець книги');

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-cont-draft-tab>
      <section className="min-w-0 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
        <p className="text-[12px] text-slate-400">
          Вставте чернетку сцени чи репліку героя — перевірка покаже, чи згадує він таємниці й події, яких станом на цю сцену ще не знає. У книгу нічого не
          записується; кожна перевірка лишається в історії праворуч.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-400">
            Герой
            <select className={selectCls} value={hero} onChange={(e) => setHero(e.target.value)} data-cont-draft-hero>
              {heroes.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-400">
            Станом на початок сцени
            <select className={selectCls} value={sectionId} onChange={(e) => setSectionId(e.target.value)} data-cont-draft-section>
              <option value="">кінець книги</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          className="h-40 w-full rounded-xl border border-slate-700 bg-slate-950/60 p-2.5 text-[13px] text-slate-100"
          placeholder="Олена сказала: «Я знаю, що батько живий»…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={20000}
          data-cont-draft-text
        />
        <button type="button" disabled={busy || !hero || !text.trim()} onClick={check} data-cont-draft-check className={`${btn} border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />} Перевірити чернетку
        </button>
        {error && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{error}</p>}
        {result && (
          <div className="space-y-2 border-t border-slate-800 pt-2" data-cont-draft-result>
            <DraftFindings findings={result.check.findings} />
            {result.known.length > 0 && <p className="text-[11px] text-slate-400" data-cont-draft-known>Відоме героєві: {result.known.join(', ')}.</p>}
            {result.unknownTags.length > 0 && <p className="text-[11px] text-slate-500">Теги, яких у книзі немає (не перевірено): {result.unknownTags.join(', ')}.</p>}
            <p className="text-[11px] text-slate-500">{result.rule}</p>
          </div>
        )}
      </section>
      <aside className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/40 p-3" data-cont-draft-history>
        <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Історія перевірок</h3>
        {!history.length && <p className="text-[12px] text-slate-500">Перевірок цього героя ще немає.</p>}
        <ul className="space-y-1.5">
          {history.map((h) => (
            <li key={h.id} data-cont-draft-history-row={h.id}>
              <button type="button" onClick={() => setShown(shown === h.id ? null : h.id)} className="w-full rounded-xl border border-slate-800 bg-slate-950/40 p-2 text-left text-[12px] hover:border-slate-600">
                <div className="flex items-center gap-1.5">
                  <span className={h.findings.length ? 'font-bold text-rose-200' : 'text-emerald-300'}>{h.findings.length ? `витоків: ${h.findings.length}` : 'без витоку'}</span>
                  <span className="ml-auto text-[10px] text-slate-500">{new Date(h.createdAt).toLocaleString('uk-UA')}</span>
                </div>
                <div className="truncate text-slate-400">{sectionLabel(h.sectionId)} · {h.draftText.slice(0, 80)}</div>
              </button>
              {shown === h.id && (
                <div className="mt-1 space-y-1.5 rounded-xl border border-slate-800 p-2">
                  <p className="whitespace-pre-wrap break-words text-[12px] text-slate-300">{h.draftText}</p>
                  <DraftFindings findings={h.findings} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

// ── Сторінка ────────────────────────────────────────────────────────────────

function CausalityTab({ book }: { book: Book }) {
  type Policy = { exception?: string; requiresKnowledge: string[]; claims: { entityId: string; label: string; value: string }[] };
  const empty: Policy = { requiresKnowledge: [], claims: [] };
  const [entities, setEntities] = useState<{ id: string; name: string; type: string; canonical: { causality?: Policy } }[]>([]);
  const [selected, setSelected] = useState('');
  const [policy, setPolicy] = useState<Policy>(empty);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void api(`/api/projects/${encodeURIComponent(book.id)}/entities`).then(r => {
      if (!live) return;
      if (r.ok) setEntities(r.body.entities.filter((e: any) => e.status === 'confirmed'));
      else setMessage(problemText(r.status, r.body.error));
    });
    return () => { live = false; };
  }, [book.id]);
  const choose = (id: string) => {
    setSelected(id); setMessage('');
    const p = entities.find(e => e.id === id)?.canonical?.causality;
    setPolicy(p && Array.isArray(p.requiresKnowledge) && Array.isArray(p.claims) ? p : empty);
  };
  const save = async () => {
    setBusy(true);
    const r = await api(`/api/projects/${encodeURIComponent(book.id)}/causality/entities/${encodeURIComponent(selected)}/policy`, { method: 'PUT', body: JSON.stringify(policy) });
    setBusy(false);
    if (r.ok) { setEntities(es => es.map(e => e.id === selected ? { ...e, canonical: { ...e.canonical, causality: r.body.policy } } : e)); setMessage('Збережено. На вкладці «Проблеми» запустіть перевірку правил.'); }
    else setMessage(problemText(r.status, r.body.error));
  };
  return <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-3" data-causality-policy>
    <h3 className="text-sm font-semibold text-slate-100">Причини й потрібні знання героя</h3>
    <p className="text-xs text-slate-400">Причинні зв’язки задаються у графі твору. Тут можна вказати потрібні факти, твердження про канон та навмисний виняток. Перевірка дає попередження й не переписує книгу.</p>
    <label className="block text-xs text-slate-300">Подія або рішення
      <select className={`${selectCls} mt-1 block w-full`} value={selected} onChange={e => choose(e.target.value)} data-causality-event>
        <option value="">Оберіть подію</option>
        {entities.filter(e => ['event', 'decision', 'threshold', 'turning-point', 'conflict', 'revelation', 'consequence'].includes(e.type)).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </label>
    {selected && <>
      <label className="block text-xs text-slate-300">Навмисний виняток
        <select className={`${selectCls} mt-1 block w-full`} value={policy.exception ?? ''} onChange={e => setPolicy(p => ({ ...p, exception: e.target.value || undefined }))} data-causality-exception>
          <option value="">Звичайний причинний перехід</option><option value="coincidence">Випадковість</option><option value="false_belief">Хибне переконання героя</option><option value="mystery">Навмисна загадка</option>
        </select>
      </label>
      <fieldset className="space-y-1"><legend className="text-xs text-slate-300">Факти, потрібні герою для цієї дії</legend>
        {entities.filter(e => ['event', 'revelation', 'consequence'].includes(e.type) && e.id !== selected).map(e => <label key={e.id} className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={policy.requiresKnowledge.includes(e.id)} onChange={x => setPolicy(p => ({ ...p, requiresKnowledge: x.target.checked ? [...p.requiresKnowledge, e.id] : p.requiresKnowledge.filter(id => id !== e.id) }))} />{e.name}
        </label>)}
      </fieldset>
      <fieldset className="space-y-2"><legend className="text-xs text-slate-300">Твердження події про затверджені риси</legend>
        {policy.claims.map((c, i) => <div key={i} className="flex flex-wrap gap-2">
          <select aria-label="Сутність твердження" className={selectCls} value={c.entityId} onChange={e => setPolicy(p => ({ ...p, claims: p.claims.map((v, n) => n === i ? { ...v, entityId: e.target.value } : v) }))}><option value="">Сутність</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          <input aria-label="Назва риси" placeholder="Риса, наприклад очі" className={selectCls} value={c.label} maxLength={80} onChange={e => setPolicy(p => ({ ...p, claims: p.claims.map((v, n) => n === i ? { ...v, label: e.target.value } : v) }))} />
          <input aria-label="Значення риси" placeholder="Значення у цій події" className={selectCls} value={c.value} maxLength={400} onChange={e => setPolicy(p => ({ ...p, claims: p.claims.map((v, n) => n === i ? { ...v, value: e.target.value } : v) }))} />
          <button type="button" className={btn} onClick={() => setPolicy(p => ({ ...p, claims: p.claims.filter((_, n) => n !== i) }))}>Видалити твердження</button>
        </div>)}
        <button type="button" className={btn} disabled={policy.claims.length >= 100} onClick={() => setPolicy(p => ({ ...p, claims: [...p.claims, { entityId: '', label: '', value: '' }] }))}>Додати твердження</button>
      </fieldset>
      <button type="button" className={`${btn} text-emerald-200`} disabled={busy} onClick={save} data-causality-save>{busy ? 'Збереження…' : 'Зберегти правила події'}</button>
    </>}
    {message && <p role="status" className="text-xs text-slate-300">{message}</p>}
  </section>;
}

type Tab = 'issues' | 'traits' | 'draft' | 'causality';

export const ContinuityPage: React.FC<Props> = ({ book, onOpenParagraph }) => {
  const [tab, setTab] = useState<Tab>('issues');
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    void api(`/api/projects/${encodeURIComponent(book.id)}/continuity/traits`).then((r) => setCanEdit(!!r.body?.canEdit));
  }, [book.id]);
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'issues', label: 'Проблеми', icon: <ListChecks className="h-3.5 w-3.5" /> },
    { key: 'traits', label: 'Риси', icon: <Tags className="h-3.5 w-3.5" /> },
    ...(canEdit ? [{ key: 'draft' as Tab, label: 'Чернетка', icon: <FileSearch className="h-3.5 w-3.5" /> }] : []),
    ...(canEdit ? [{ key: 'causality' as Tab, label: 'Причинність', icon: <ListChecks className="h-3.5 w-3.5" /> }] : []),
  ];
  return (
    <section className="min-w-0 space-y-3" data-continuity>
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            data-continuity-tab={t.key}
            onClick={() => setTab(t.key)}
            className={`${btn} px-3 py-1.5 text-xs ${tab === t.key ? 'border-emerald-500 bg-emerald-500/15 text-emerald-100' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {tab === 'issues' && <IssuesTab book={book} onOpenParagraph={onOpenParagraph} />}
      {tab === 'traits' && <TraitsTab book={book} />}
      {tab === 'draft' && canEdit && <DraftTab book={book} />}
      {tab === 'causality' && canEdit && <CausalityTab key={book.id} book={book} />}
    </section>
  );
};

export default ContinuityPage;
