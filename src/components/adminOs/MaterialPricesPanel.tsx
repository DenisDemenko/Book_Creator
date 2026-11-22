import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, FileUp, Pencil, Plus, RefreshCw, RotateCcw, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { SlabInventoryPanel } from './SlabInventoryPanel';
import { readPricesXml, starterPrices, writePricesXml, type BoardPrice } from './materialPricesXml';
import {
  blankDraft,
  derivedPrices,
  fromDrafts,
  GRAIN_LABEL,
  KIND_LABEL,
  sameBoards,
  toDraft,
  UNIT_LABEL,
  validateDraft,
  type BoardDraft,
  type DraftField,
} from './materialPricesTable';

type SlabPrice = {
  id: string; number: string; species: string; category: string;
  widthCm: number; lengthCm: number; thicknessCm: number;
  priceMinor: number; available: boolean;
};
type Catalogue = { version: number; boards: BoardPrice[]; slabs: SlabPrice[] };
const url = '/api/admin/slab-tables/material-prices';
const money = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' });
const sections = [
  ['boards', 'ДСП і фанера'], ['slabs', 'Ціни слебів Marketplace'], ['facades', 'Фасадні слеби'],
] as const;

const minorToText = (minor: number | null) => (minor === null ? '—' : money.format(minor / 100));

/* Стиль — як у решти адмінки: темна основа, ціанові рамки. */
const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-[rgba(0,180,255,.06)] px-3 py-1.5 text-xs font-medium text-[#d6ebff] transition-colors hover:border-cyan-300/60 hover:bg-[rgba(0,180,255,.14)] disabled:cursor-not-allowed disabled:opacity-40';
const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-sky-400/60 bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_0_14px_rgba(56,189,248,0.35)] transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none';
const field =
  'rounded-md border border-white/10 bg-[#0a1322] px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-300 focus:ring-1 focus:ring-cyan-400/40';
const cell =
  'w-full rounded-md border bg-[#0a1322] px-2 py-1 text-xs text-slate-100 outline-none transition-colors focus:border-cyan-300 focus:ring-1 focus:ring-cyan-400/40';
const th = 'whitespace-nowrap px-2 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[rgba(181,217,253,.75)]';

/** Підписане поле в розгорнутому рядку таблиці. */
function EditField({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-[rgba(181,217,253,.7)]">{label}</span>
      {children}
      {error && <span className="text-[10.5px] text-rose-300">{error}</span>}
    </label>
  );
}

export function MaterialPricesPanel() {
  const [tab, setTab] = useState<(typeof sections)[number][0]>('boards');
  const [current, setCurrent] = useState<Catalogue | null>(null);
  const [rows, setRows] = useState<BoardDraft[]>([]);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | BoardPrice['kind']>('all');
  const [xml, setXml] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  /** Рядки, розгорнуті для правки назви, формату, текстури й коду. */
  const [editing, setEditing] = useState<Set<string>>(() => new Set());

  const rowErrors = useMemo(() => {
    const all = rows.map((r) => r.id);
    return new Map(rows.map((r) => [r.key, validateDraft(r, all)]));
  }, [rows]);
  const invalidCount = [...rowErrors.values()].filter((e) => Object.keys(e).length > 0).length;
  const dirty = current ? !sameBoards(current.boards, rows) : false;
  const pricedCount = rows.filter((r) => r.price.trim() !== '').length;

  const visibleRows = rows.filter((r) => {
    if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
    const q = query.trim().toLowerCase();
    return !q || [r.id, r.name, r.decor].some((v) => v.toLowerCase().includes(q));
  });

  async function load(signal?: AbortSignal) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(url, { signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Не вдалося завантажити ціни.');
      setCurrent(result);
      setRows((result.boards as BoardPrice[]).map(toDraft));
      setEditing(new Set());
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Помилка завантаження.');
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  async function save() {
    if (!current) return;
    setError('');
    setNotice('');
    let boards: BoardPrice[];
    try {
      boards = fromDrafts(rows);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Перевірте таблицю.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: current.version, boards }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Не вдалося опублікувати довідник.');
      setCurrent({ ...current, ...result });
      setRows((result.boards as BoardPrice[]).map(toDraft));
      setEditing(new Set());
      setNotice(`Довідник опубліковано. Версія ${result.version}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Помилка публікації.');
    } finally {
      setBusy(false);
    }
  }

  const update = (key: string, field: DraftField, value: string) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  /** Поточна таблиця як XML — для «Завантажити XML» і блоку обміну. */
  function tableXml(): string | null {
    try {
      return writePricesXml(fromDrafts(rows));
    } catch (failure) {
      setError(failure instanceof Error ? `XML не сформовано. ${failure.message}` : 'Перевірте таблицю.');
      return null;
    }
  }

  function download() {
    const text = tableXml();
    if (!text) return;
    const link = document.createElement('a');
    const href = URL.createObjectURL(new Blob([text], { type: 'application/xml;charset=utf-8' }));
    link.href = href;
    link.download = 'material-prices.xml';
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  function applyXml(text: string) {
    try {
      const boards = readPricesXml(text);
      setRows(boards.map(toDraft));
      setError('');
      setNotice(`З XML у таблицю завантажено ${boards.length} поз. Перевірте й опублікуйте.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не вдалося прочитати XML.');
    }
  }

  const inputClass = (errors: Partial<Record<DraftField, string>> | undefined, field: DraftField) =>
    `${cell} ${errors?.[field] ? 'border-rose-400/80' : 'border-white/10'}`;

  return (
    <section className="space-y-4 text-[#eef6ff]" data-material-prices="1">
      <nav aria-label="Довідники матеріалів" className="flex flex-wrap gap-2">
        {sections.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              tab === key
                ? 'border-cyan-300/70 bg-[rgba(0,180,255,.16)] font-semibold text-white shadow-[0_0_12px_rgba(0,210,255,0.25)]'
                : 'border-white/15 bg-[#0a1322] text-slate-300 hover:border-cyan-400/40'
            }`}
            onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      {error && <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</p>}
      {busy && <p role="status" className="text-sm text-slate-300">Завантажуємо ціни…</p>}

      {tab === 'boards' && (
        <div className="space-y-3">
          {/* Панель дій */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex min-w-[200px] flex-1 items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Пошук: назва, декор, код"
                aria-label="Пошук у довіднику плит"
                className={`${field} w-full pl-8`}
              />
            </label>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
              aria-label="Тип матеріалу"
              className={field}
            >
              <option value="all">Усі матеріали</option>
              <option value="chipboard">ДСП</option>
              <option value="plywood">Фанера</option>
            </select>
            <button type="button" className={btn} disabled={busy || !current}
              onClick={() => {
                const draft = blankDraft(rows.map((r) => r.id));
                setRows((prev) => [...prev, draft]);
                setEditing((prev) => new Set(prev).add(draft.key));
                setQuery('');
                setKindFilter('all');
              }}>
              <Plus className="h-3.5 w-3.5" /> Додати плиту
            </button>
            <button type="button" className={btn} disabled={busy || !current}
              title="Додати приклади EGGER і фанери, яких ще немає в таблиці"
              onClick={() => setRows((prev) => [
                ...prev,
                ...starterPrices.filter((s) => !prev.some((r) => r.id === s.id)).map(toDraft),
              ])}>
              <Sparkles className="h-3.5 w-3.5" /> Додати зразки
            </button>
          </div>

          {/* Таблиця цін */}
          <div className="overflow-x-auto rounded-xl border border-cyan-400/25 bg-[#09111c]/80">
            <table className="w-full min-w-[680px] border-collapse text-xs">
              <caption className="px-3 py-2 text-left text-[11.5px] text-[rgba(214,235,255,.7)]">
                {current ? `Опублікований довідник · версія ${current.version}` : 'Довідник плит'}
                {' · '}{rows.length} поз., з ціною {pricedCount}
                {dirty && <span className="ml-2 rounded-full border border-amber-400/50 bg-amber-500/10 px-2 py-0.5 text-amber-200">є неопубліковані зміни</span>}
              </caption>
              <thead className="border-y border-cyan-400/20 bg-[rgba(0,180,255,.06)]">
                <tr>
                  <th className={th}>Матеріал</th>
                  <th className={th}>Формат, мм</th>
                  <th className={th}>Ціна, ₴</th>
                  <th className={`${th} text-right`}>За лист</th>
                  <th className={`${th} text-right`}>За м²</th>
                  <th className={th}><span className="sr-only">Дії</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const errors = rowErrors.get(row.key) ?? {};
                  const derived = derivedPrices(row);
                  // Помилка поза ціною видна лише в розгорнутому рядку — тож
                  // такий рядок розгортаємо самі, інакше причина ховалася б.
                  const otherError = Object.keys(errors).some((f) => f !== 'price');
                  const open = editing.has(row.key) || otherError;
                  return (
                    <Fragment key={row.key}>
                      <tr className={`border-white/5 align-top hover:bg-[rgba(0,180,255,.04)] ${open ? '' : 'border-b'}`} data-board-row={row.id}>
                        <td className="px-3 py-2">
                          <div className="min-w-0 max-w-[176px]">
                            <div className={`truncate font-medium ${row.name.trim() ? 'text-white' : 'italic text-slate-500'}`} title={row.name}>
                              {row.name.trim() || 'Без назви'}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-400">
                              <span className={`shrink-0 rounded-full border px-1.5 leading-4 ${
                                row.kind === 'plywood' ? 'border-amber-400/40 text-amber-200' : 'border-cyan-400/40 text-cyan-200'
                              }`}>{KIND_LABEL[row.kind]}</span>
                              <span className="truncate" title={`${row.decor} · ${GRAIN_LABEL[row.grain]} · ${row.id}`}>
                                {[row.decor, GRAIN_LABEL[row.grain]].filter(Boolean).join(' · ')}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-200">
                          {row.lengthMm} × {row.widthMm} × {row.thicknessMm}
                          {derived.areaM2 !== null && (
                            <div className="text-[10.5px] text-slate-500">{derived.areaM2.toFixed(3).replace('.', ',')} м²</div>
                          )}
                        </td>
                        <td className="min-w-[170px] px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <input value={row.price} inputMode="decimal" placeholder="не задано" aria-label={`Ціна, гривні: ${row.name || row.id}`}
                              title={errors.price} className={`${inputClass(errors, 'price')} !w-[84px] shrink-0 text-right tabular-nums`}
                              onChange={(e) => update(row.key, 'price', e.target.value)} />
                            <span className="text-slate-500">/</span>
                            <select value={row.unit} aria-label="За що ціна" className={`${inputClass(errors, 'unit')} !w-auto shrink-0`}
                              onChange={(e) => update(row.key, 'unit', e.target.value)}>
                              {Object.entries(UNIT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </div>
                          {errors.price && <div className="mt-1 text-[10.5px] text-rose-300">{errors.price}</div>}
                        </td>
                        <td className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${row.unit === 'sheet' ? 'font-semibold text-white' : 'text-cyan-200/80'}`}>
                          {minorToText(derived.perSheetMinor)}
                        </td>
                        <td className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${row.unit === 'm2' ? 'font-semibold text-white' : 'text-cyan-200/80'}`}>
                          {minorToText(derived.perM2Minor)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right">
                          <button type="button" aria-expanded={open} aria-label={`Змінити ${row.name || row.id}`} title="Змінити назву, формат, код"
                            className={`rounded-md p-1 transition-colors hover:bg-cyan-500/15 hover:text-cyan-200 ${open ? 'text-cyan-300' : 'text-slate-400'}`}
                            onClick={() => setEditing((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
                              return next;
                            })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" aria-label={`Видалити ${row.name || row.id}`} title="Видалити рядок"
                            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                            onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-white/5 bg-[rgba(0,180,255,.04)]" data-board-editor={row.id}>
                          <td colSpan={6} className="px-3 pb-3 pt-1">
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                              <EditField label="Назва" error={errors.name} wide>
                                <input value={row.name} placeholder="Напр. EGGER H1388 ST40 Дуб" className={inputClass(errors, 'name')}
                                  onChange={(e) => update(row.key, 'name', e.target.value)} />
                              </EditField>
                              <EditField label="Декор / артикул" error={errors.decor}>
                                <input value={row.decor} className={inputClass(errors, 'decor')}
                                  onChange={(e) => update(row.key, 'decor', e.target.value)} />
                              </EditField>
                              <EditField label="Тип" error={errors.kind}>
                                <select value={row.kind} className={inputClass(errors, 'kind')}
                                  onChange={(e) => update(row.key, 'kind', e.target.value)}>
                                  {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              </EditField>
                              <EditField label="Довжина, мм" error={errors.lengthMm}>
                                <input value={row.lengthMm} inputMode="decimal" className={inputClass(errors, 'lengthMm')}
                                  onChange={(e) => update(row.key, 'lengthMm', e.target.value)} />
                              </EditField>
                              <EditField label="Ширина, мм" error={errors.widthMm}>
                                <input value={row.widthMm} inputMode="decimal" className={inputClass(errors, 'widthMm')}
                                  onChange={(e) => update(row.key, 'widthMm', e.target.value)} />
                              </EditField>
                              <EditField label="Товщина, мм" error={errors.thicknessMm}>
                                <input value={row.thicknessMm} inputMode="decimal" className={inputClass(errors, 'thicknessMm')}
                                  onChange={(e) => update(row.key, 'thicknessMm', e.target.value)} />
                              </EditField>
                              <EditField label="Текстура" error={errors.grain}>
                                <select value={row.grain} className={inputClass(errors, 'grain')}
                                  onChange={(e) => update(row.key, 'grain', e.target.value)}>
                                  {Object.entries(GRAIN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              </EditField>
                              <EditField label="Код позиції" error={errors.id}>
                                <input value={row.id} className={`${inputClass(errors, 'id')} font-mono`}
                                  onChange={(e) => update(row.key, 'id', e.target.value)} />
                              </EditField>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && !busy && (
              <p className="px-3 py-6 text-center text-sm text-slate-300">
                Довідник ще порожній. Додайте плиту, зразки або імпортуйте XML.
              </p>
            )}
            {rows.length > 0 && visibleRows.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-slate-400">За фільтром нічого не знайдено.</p>
            )}
          </div>
          <p className="text-[11.5px] text-slate-400">
            Ціна задається за лист або за м² — друга колонка рахується з площі листа. Порожня ціна означає, що її ще не встановлено.
            Назву, формат, текстуру й код змінює олівець у рядку.
          </p>

          {/* Публікація */}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primaryBtn} disabled={busy || !current || !dirty || invalidCount > 0}
              onClick={() => void save()}>
              <Upload className="h-3.5 w-3.5" /> Опублікувати ціни плит
            </button>
            {invalidCount > 0 && <span className="text-xs text-rose-300">Виправте рядки з помилками: {invalidCount}</span>}
            {dirty && (
              <button type="button" className={btn} disabled={busy}
                onClick={() => current && setRows(current.boards.map(toDraft))}>
                <RotateCcw className="h-3.5 w-3.5" /> Скасувати зміни
              </button>
            )}
            <button type="button" className={btn} disabled={busy}
              onClick={() => {
                if (dirty && !window.confirm('Завантажити останні ціни з Marketplace і відкинути неопубліковані зміни?')) return;
                void load();
              }}>
              <RefreshCw className="h-3.5 w-3.5" /> Оновити з Marketplace
            </button>
          </div>

          {/* XML лишається для обміну з GibLab і майстернею Blum. */}
          <details
            className="rounded-xl border border-white/10 bg-[#09111c]/60 p-3"
            onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) { const t = tableXml(); if (t) setXml(t); } }}
          >
            <summary className="cursor-pointer text-sm text-[#d6ebff]">XML для обміну (імпорт / експорт)</summary>
            <p className="mt-2 text-xs text-slate-400">
              Формат material-prices версії 1 у гривнях: розміри в мм, priceMinor — у копійках за лист (sheet) або за м² (m2).
            </p>
            <textarea id="material-prices-xml" spellCheck={false} rows={8} value={xml} disabled={busy}
              aria-label="Довідник плит XML"
              className="mt-2 w-full rounded-lg border border-white/10 bg-[#0a1322] p-3 font-mono text-xs text-slate-200"
              onChange={(event) => setXml(event.target.value)} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className={btn} disabled={busy || !xml.trim()} onClick={() => applyXml(xml)}>
                Застосувати XML до таблиці
              </button>
              <label className={`${btn} cursor-pointer`}>
                <FileUp className="h-3.5 w-3.5" /> Імпорт XML-файлу
                <input type="file" accept=".xml,application/xml,text/xml" disabled={busy} className="sr-only"
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (!file) return;
                    if (file.size > 250_000) { setError('Файл XML перевищує 250 КБ.'); return; }
                    const contents = await file.text();
                    setXml(contents);
                    applyXml(contents);
                  }} />
              </label>
              <button type="button" className={btn} disabled={rows.length === 0} onClick={download}>
                <Download className="h-3.5 w-3.5" /> Завантажити XML
              </button>
            </div>
          </details>
        </div>
      )}

      {tab === 'slabs' && current && (
        <div className="overflow-x-auto rounded-xl border border-cyan-400/25 bg-[#09111c]/80">
          <table className="w-full text-left text-xs">
            <caption className="px-3 py-2 text-left text-[11.5px] text-[rgba(214,235,255,.7)]">Активні позиції складу · {current.slabs.length}</caption>
            <thead className="border-y border-cyan-400/20 bg-[rgba(0,180,255,.06)]">
              <tr>
                <th className={th}>Номер</th><th className={th}>Порода</th><th className={th}>Призначення</th>
                <th className={th}>Розміри, см</th><th className={`${th} text-right`}>Ціна за слеб</th><th className={th}>Стан</th>
              </tr>
            </thead>
            <tbody>
              {current.slabs.map((slab) => (
                <tr key={slab.id} className="border-b border-white/5 hover:bg-[rgba(0,180,255,.04)]">
                  <td className="px-2 py-2 font-mono">{slab.number}</td><td className="px-2 py-2">{slab.species}</td>
                  <td className="px-2 py-2">{slab.category === 'cabinet_facade' ? 'Фасади' : slab.category === 'table' ? 'Столи' : slab.category}</td>
                  <td className="px-2 py-2 tabular-nums">{slab.lengthCm} × {slab.widthCm} × {slab.thicknessCm}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-white">{money.format(slab.priceMinor / 100)}</td>
                  <td className={`px-2 py-2 ${slab.available ? 'text-emerald-300' : 'text-amber-300'}`}>{slab.available ? 'Доступний' : 'Зарезервовано'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {current.slabs.length === 0 && <p className="px-3 py-4 text-sm text-slate-300">Активних слебів немає.</p>}
        </div>
      )}
      {tab === 'slabs' && (
        <button type="button" className={btn} disabled={busy} onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" /> Оновити з Marketplace
        </button>
      )}
      {tab === 'facades' && <SlabInventoryPanel category="cabinet_facade" inventoryOnly />}
    </section>
  );
}
