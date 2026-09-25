/**
 * Сторінка 1 — «Розумний пошук» (Т1.3, ТЗ-11 §2).
 *
 * Запит звичайною мовою («Де Сергій приховує страх від дружини?») + фільтри
 * ТЗ (персонаж, сцена, глава, емоція, подія, період, статус підтвердження).
 * ШІ (AI-2, `searchInterpret`) лише розкладає запит на фільтри й слова — на
 * запит він не відповідає; видача — завжди знайдені абзаци книги з
 * контекстом (сусідні абзаци), поясненням релевантності й переходом у
 * редактор до того самого абзацу (за постійним номером, Т0.5).
 *
 * Пошук — один сервіс ядра (`hybridSearch`, Т1.2): слова, зміст, сутності.
 * Права: сервер пускає лише учасників книги; збережені запити — особисті.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, ExternalLink, Loader2, Search, Sparkles, Trash2, X } from 'lucide-react';
import type { Book } from '../types';

export interface SearchHitView {
  paragraphId: string;
  editorPid: string;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterTitle: string;
  chapterNumber: number | null;
  excerpt: string;
  context: { before: string | null; after: string | null };
  score: number;
  sources: {
    text?: { terms: string[] };
    vector?: { similarity: number };
    graph?: { groupsCovered: number; groupsTotal: number; entities: { id: string; name: string; type: string; subjectOf?: string }[] };
  };
  why: string;
}

interface SearchResponseView {
  synced: boolean;
  results: SearchHitView[];
  entities: { id: string; type: string; name: string; via: 'query' | 'filter' | 'ai' }[];
  sources: {
    text: { used: boolean; hits: number };
    vector: { used: boolean; hits: number; reason?: string; embedded: number; total: number };
    graph: { used: boolean; hits: number };
  } | null;
  interpretation:
    | { ok: true; text: string; entities: { id: string; type: string; name: string }[]; unmatched: { type: string; name: string }[]; chapterNumbers: number[]; mentionStatus: string | null }
    | { ok: false; error: string }
    | null;
}

interface SavedSearch {
  id: string;
  name: string;
  params: SearchParams;
}

export interface SearchParams {
  q: string;
  entityIds: string[];
  chapterIds: string[];
  chapterFrom?: number;
  chapterTo?: number;
  status?: 'confirmed' | 'suggested';
  interpret: boolean;
}

interface Props {
  book: Book;
  onOpenParagraph: (target: { chapterId: string; sectionId: string; editorPid: string; text: string }) => void;
}

/** Фільтри ТЗ за сутностями: тип ядра → підпис. */
const ENTITY_FILTERS: { type: string; label: string }[] = [
  { type: 'character', label: 'Персонаж' },
  { type: 'emotion', label: 'Емоція' },
  { type: 'scene', label: 'Сцена' },
  { type: 'event', label: 'Подія' },
];

const TYPE_LABEL: Record<string, string> = {
  character: 'персонаж',
  emotion: 'емоція',
  scene: 'сцена',
  event: 'подія',
  location: 'місце',
};

/** «Глава 2 · Ранок»; якщо назва вже починається з «Глава …», номер не дублюється. */
export function chapterLabel(r: { chapterNumber: number | null; chapterTitle: string }): string {
  if (!r.chapterNumber) return r.chapterTitle;
  if (/^\s*(глава|розділ|chapter)\s*\d/i.test(r.chapterTitle)) return r.chapterTitle;
  return `Глава ${r.chapterNumber}${r.chapterTitle ? ` · ${r.chapterTitle}` : ''}`;
}

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

const selectCls =
  'min-w-0 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500';

export const CoreSearchPage: React.FC<Props> = ({ book, onOpenParagraph }) => {
  const base = `/api/projects/${encodeURIComponent(book.id)}`;
  const [query, setQuery] = useState('');
  const [interpret, setInterpret] = useState(true);
  const [entityFilter, setEntityFilter] = useState<Record<string, string>>({});
  const [chapterId, setChapterId] = useState('');
  const [chapterFrom, setChapterFrom] = useState('');
  const [chapterTo, setChapterTo] = useState('');
  const [status, setStatus] = useState<'' | 'confirmed' | 'suggested'>('');
  const [options, setOptions] = useState<Record<string, { id: string; name: string }[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponseView | null>(null);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  const chapters = useMemo(() => [...book.chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [book.chapters]);

  // Списки для фільтрів — сутності ядра книги за типами.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      ENTITY_FILTERS.map(async ({ type }) => {
        const res = await api(`${base}/entities?type=${type}`).catch(() => null);
        const body = res?.ok ? await res.json() : { entities: [] };
        return [type, (body.entities || []).map((e: any) => ({ id: e.id, name: e.name }))] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setOptions(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [base]);

  const loadSaved = useCallback(async () => {
    const res = await api(`${base}/saved-searches`).catch(() => null);
    if (res?.ok) setSaved(((await res.json()).items || []) as SavedSearch[]);
  }, [base]);
  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  const currentParams = (): SearchParams => ({
    q: query.trim(),
    entityIds: Object.values(entityFilter).filter(Boolean),
    chapterIds: chapterId ? [chapterId] : [],
    chapterFrom: chapterFrom ? Number(chapterFrom) : undefined,
    chapterTo: chapterTo ? Number(chapterTo) : undefined,
    status: status || undefined,
    interpret,
  });

  const run = async (params: SearchParams) => {
    if (!params.q && !params.entityIds.length) {
      setError('Введіть запит або оберіть сутність у фільтрах.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api(`${base}/search`, { method: 'POST', body: JSON.stringify(params) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult(null);
        setError(
          res.status === 503
            ? 'Семантичне ядро зараз недоступне — решта Студії працює.'
            : res.status === 403
              ? 'Немає доступу до цієї книги.'
              : body.error || `Помилка ${res.status}`,
        );
        return;
      }
      setResult(body as SearchResponseView);
    } catch {
      setError('Немає зв\'язку з сервером.');
    } finally {
      setBusy(false);
    }
  };

  const applySaved = (s: SavedSearch) => {
    const p = s.params;
    setQuery(p.q || '');
    setInterpret(p.interpret !== false);
    const byType: Record<string, string> = {};
    for (const id of p.entityIds || []) {
      const hit = ENTITY_FILTERS.find(({ type }) => (options[type] || []).some((o) => o.id === id));
      if (hit) byType[hit.type] = id;
    }
    setEntityFilter(byType);
    setChapterId(p.chapterIds?.[0] || '');
    setChapterFrom(p.chapterFrom ? String(p.chapterFrom) : '');
    setChapterTo(p.chapterTo ? String(p.chapterTo) : '');
    setStatus(p.status || '');
    void run({ ...p, entityIds: p.entityIds || [], chapterIds: p.chapterIds || [], interpret: p.interpret !== false });
  };

  const save = async () => {
    const name = saveName.trim() || query.trim().slice(0, 60);
    if (!name) return;
    setSaving(true);
    try {
      const res = await api(`${base}/saved-searches`, { method: 'POST', body: JSON.stringify({ name, params: currentParams() }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error || 'Не вдалося зберегти запит.');
      else {
        setSaveName('');
        await loadSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await api(`${base}/saved-searches/${id}`, { method: 'DELETE' }).catch(() => null);
    await loadSaved();
  };

  const interp = result?.interpretation;

  return (
    <section className="min-w-0 space-y-4" data-core-search>
      <form
        className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(currentParams());
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Наприклад: Де Сергій приховує страх від дружини?"
              data-core-search-input
              className="w-full rounded-xl border border-slate-700 bg-slate-950/60 py-2.5 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            data-core-search-run
            className="flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Шукати
          </button>
        </div>
        <label className="flex min-w-0 items-start gap-2 text-xs text-slate-300">
          <input type="checkbox" className="mt-0.5 shrink-0" checked={interpret} onChange={(e) => setInterpret(e.target.checked)} data-core-search-interpret />
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
          <span className="min-w-0 break-words">ШІ розкладає запит на фільтри (лише розкладає — відповідь завжди з тексту книги)</span>
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" data-core-search-filters>
          {ENTITY_FILTERS.map(({ type, label }) => (
            <label key={type} className="flex flex-col gap-1 text-[11px] text-slate-400">
              {label}
              <select
                className={selectCls}
                value={entityFilter[type] || ''}
                data-core-filter={type}
                onChange={(e) => setEntityFilter((prev) => ({ ...prev, [type]: e.target.value }))}
              >
                <option value="">будь-яка</option>
                {(options[type] || []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Глава
            <select className={selectCls} value={chapterId} data-core-filter="chapter" onChange={(e) => setChapterId(e.target.value)}>
              <option value="">усі</option>
              {chapters.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {i + 1}. {c.title}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-[11px] text-slate-400">
            Період (глави)
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={chapters.length || undefined}
                value={chapterFrom}
                onChange={(e) => setChapterFrom(e.target.value)}
                placeholder="від"
                data-core-filter="from"
                className={`${selectCls} w-full`}
              />
              <span>—</span>
              <input
                type="number"
                min={1}
                max={chapters.length || undefined}
                value={chapterTo}
                onChange={(e) => setChapterTo(e.target.value)}
                placeholder="до"
                data-core-filter="to"
                className={`${selectCls} w-full`}
              />
            </div>
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Статус підтвердження
            <select className={selectCls} value={status} data-core-filter="status" onChange={(e) => setStatus(e.target.value as any)}>
              <option value="">будь-який</option>
              <option value="confirmed">підтверджено автором</option>
              <option value="suggested">запропоновано ШІ</option>
            </select>
          </label>
          <div className="flex flex-col gap-1 text-[11px] text-slate-400">
            Зберегти запит
            <div className="flex gap-1.5">
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="назва"
                data-core-search-save-name
                className={`${selectCls} w-full`}
              />
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || (!query.trim() && !Object.values(entityFilter).some(Boolean))}
                data-core-search-save
                className="rounded-lg border border-slate-700 px-2.5 text-slate-200 hover:border-sky-500 disabled:opacity-50"
                title="Зберегти запит і фільтри"
              >
                <Bookmark className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </form>

      {saved.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-core-saved-searches>
          {saved.map((s) => (
            <span key={s.id} className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 py-0.5 pl-2.5 pr-1 text-[11px] text-slate-200" data-core-saved={s.id}>
              <button type="button" onClick={() => applySaved(s)} className="hover:text-sky-300" data-core-saved-run>
                <Bookmark className="mr-1 inline h-3 w-3" />
                {s.name}
              </button>
              <button type="button" onClick={() => void remove(s.id)} className="rounded-full p-0.5 text-slate-500 hover:text-rose-300" title="Видалити" data-core-saved-delete>
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" data-core-search-error>
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3" data-core-search-results>
          {interp && (
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-xs text-slate-300" data-core-search-interpretation>
              {interp.ok ? (
                <>
                  <span className="font-bold text-violet-200">ШІ розклав запит:</span>{' '}
                  {interp.entities.map((e) => `${TYPE_LABEL[e.type] ?? e.type} «${e.name}»`).join(', ') || 'без сутностей'}
                  {interp.text ? ` · слова «${interp.text}»` : ''}
                  {interp.chapterNumbers.length ? ` · глави ${interp.chapterNumbers.join(', ')}` : ''}
                  {interp.mentionStatus ? ` · статус: ${interp.mentionStatus === 'confirmed' ? 'підтверджено' : 'запропоновано'}` : ''}
                  {interp.unmatched.length > 0 && (
                    <span className="block text-amber-300">
                      У книзі немає: {interp.unmatched.map((u) => `${TYPE_LABEL[u.type] ?? u.type} «${u.name}»`).join(', ')} — ці назви фільтром не стали.
                    </span>
                  )}
                </>
              ) : (
                <span className="text-amber-300">{(interp as { error: string }).error}</span>
              )}
            </div>
          )}
          {!result.synced && <p className="text-sm text-slate-400">Книгу ще не синхронізовано з ядром — збережіть її й спробуйте за кілька секунд.</p>}
          {result.synced && (
            <p className="text-[11px] text-slate-500" data-core-search-summary>
              Знайдено абзаців: {result.results.length}
              {result.entities.length ? ` · сутності: ${result.entities.map((e) => e.name).join(', ')}` : ''}
              {result.sources?.vector && !result.sources.vector.used && result.sources.vector.reason ? ` · ${result.sources.vector.reason}` : ''}
            </p>
          )}
          {result.synced && result.results.length === 0 && (
            <p className="text-sm text-slate-400">Нічого не знайдено. Спробуйте інші слова або зніміть частину фільтрів.</p>
          )}
          <ol className="space-y-2.5">
            {result.results.map((r) => (
              <li key={r.paragraphId} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3.5" data-core-search-hit={r.paragraphId}>
                <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                  <span className="font-bold text-slate-200">
                    {chapterLabel(r)}
                  </span>
                  {r.sectionTitle && <span>· {r.sectionTitle}</span>}
                  <span className="ml-auto flex gap-1">
                    {r.sources.graph && (
                      <span className="rounded-full border border-emerald-500/40 px-1.5 text-emerald-300">
                        сутності{r.sources.graph.groupsTotal > 1 ? ` ${r.sources.graph.groupsCovered}/${r.sources.graph.groupsTotal}` : ''}
                      </span>
                    )}
                    {r.sources.text && <span className="rounded-full border border-sky-500/40 px-1.5 text-sky-300">слова</span>}
                    {r.sources.vector && <span className="rounded-full border border-violet-500/40 px-1.5 text-violet-300">зміст</span>}
                  </span>
                </div>
                {r.context.before && <p className="line-clamp-2 text-xs text-slate-500">{r.context.before}</p>}
                <p className="my-1 border-l-2 border-sky-500/60 pl-2.5 text-sm leading-relaxed text-slate-100" data-core-search-excerpt>
                  {r.excerpt}
                </p>
                {r.context.after && <p className="line-clamp-2 text-xs text-slate-500">{r.context.after}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="flex-1 text-[11px] text-slate-400" data-core-search-why>
                    Чому тут: {r.why}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      r.chapterId && onOpenParagraph({ chapterId: r.chapterId, sectionId: r.sectionId, editorPid: r.editorPid, text: r.excerpt })
                    }
                    disabled={!r.chapterId}
                    data-core-search-open
                    className="flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:border-sky-500 disabled:opacity-50"
                  >
                    <ExternalLink className="h-3 w-3" /> Відкрити в редакторі
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {result.results.length > 0 && (
            <button type="button" onClick={() => setResult(null)} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300">
              <X className="h-3 w-3" /> Очистити результати
            </button>
          )}
        </div>
      )}
    </section>
  );
};

export default CoreSearchPage;
