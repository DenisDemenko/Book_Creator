import { useEffect, useRef, useState } from 'react';
import type { ConstructorRenderReport } from '../../server/constructorRenderReport';

const hryvnias = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' });
const dollars = new Intl.NumberFormat('uk-UA', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 6,
});
const quantities = new Intl.NumberFormat('uk-UA');
const percent = new Intl.NumberFormat('uk-UA', { style: 'percent', maximumFractionDigits: 1 });
const reviewDate = new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeZone: 'Europe/Kyiv' });

type Review = ConstructorRenderReport['review'];

export function AdminConstructorPricing({ onReviewChanged }: { onReviewChanged: (review: Review) => void }) {
  const [report, setReport] = useState<ConstructorRenderReport | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [request, setRequest] = useState(0);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ key: string; revision: number; costUsd: string; sourceUrl: string } | null>(null);
  const priceField = useRef<HTMLInputElement>(null);
  const editingRow = report?.rows.find((row) => row.key === editing?.key);
  const editingKey = editing?.key;

  useEffect(() => {
    if (editingKey) priceField.current?.focus();
  }, [editingKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/credits/constructor-renders', {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не вдалося завантажити таблицю.');
        setReport(data);
        setError('');
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Не вдалося завантажити таблицю.');
      });
    return () => controller.abort();
  }, [request]);

  const save = async (change: { action: 'review'; revision: number } | { action: 'price'; revision: number; key: string; costUsd: number; sourceUrl: string }) => {
    if (saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/credits/constructor-renders/pricing', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося зберегти зміни.');
      onReviewChanged(data);
      setReport((current) => current && { ...current, review: data });
      setEditing(null);
      setNotice(change.action === 'review' ? 'Звірку тарифів підтверджено.' : 'Тариф збережено й застосовано до нових розрахунків.');
      setRequest((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не вдалося зберегти зміни.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="constructor-pricing-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 id="constructor-pricing-heading" className="text-sm font-bold text-slate-100">Тарифи фоторендерів конструкторів</h4>
          {report && (
            <p className="mt-1 text-xs text-slate-400">
              {report.taxRegime} · {quantities.format(report.fx)} ₴/$ · цільова маржа {report.targetMarginPercent}%
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Період підписки
            <select
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100"
              value={cycle}
              onChange={(event) => setCycle(event.target.value === 'annual' ? 'annual' : 'monthly')}
            >
              <option value="monthly">Місяць</option>
              <option value="annual">Рік</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => { setError(''); setEditing(null); setRequest((value) => value + 1); }}
            className="badge-glass rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-100"
          >
            Оновити
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {notice && <p role="status" className="text-xs text-emerald-300">{notice}</p>}
      {!report && !error && <p role="status" className="text-xs text-slate-400">Завантаження тарифів…</p>}
      {report && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 px-3 py-3">
            <div className="space-y-1 text-xs text-slate-400">
              {report.review.due && <p className="font-semibold text-amber-300">Час щотижневої звірки тарифів провайдерів</p>}
              <p>{report.review.reviewedAt ? `Остання звірка ${reviewDate.format(new Date(report.review.reviewedAt))}.` : 'Перша звірка очікує підтвердження.'}</p>
              {report.review.dueAt && <p>Наступна звірка до {reviewDate.format(new Date(report.review.dueAt))}.</p>}
              <p>Скористайтеся пошуком біля кожного рушія. Для Leonardo.Ai звірте історію списань в акаунті.</p>
            </div>
            <button
              type="button" disabled={saving || !!editing}
              className="badge-glass rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-100 disabled:opacity-40"
              onClick={() => void save({ action: 'review', revision: report.review.revision })}
            >Підтвердити звірку тарифів</button>
          </div>
          {editing && editingRow && (
            <form
              className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-700 p-3 text-xs"
              onSubmit={(event) => {
                event.preventDefault();
                void save({ ...editing, action: 'price', costUsd: Number(editing.costUsd) });
              }}
            >
              <p className="basis-full font-semibold text-slate-100">{editingRow.label} · {editingRow.formats.join(' / ')}</p>
              <label className="flex flex-col gap-1 text-slate-400">
                USD за фото
                <input ref={priceField} required type="number" step="0.000001" min="0.000001" value={editing.costUsd}
                  onChange={(event) => setEditing({ ...editing, costUsd: event.target.value })}
                  className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100" />
              </label>
              <label className="flex min-w-52 flex-1 flex-col gap-1 text-slate-400">
                Посилання на джерело
                <input required type="url" maxLength={2048} value={editing.sourceUrl}
                  onChange={(event) => setEditing({ ...editing, sourceUrl: event.target.value })}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100" />
              </label>
              <button type="submit" disabled={saving} className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-slate-950 disabled:opacity-40">Зберегти тариф</button>
              <button type="button" disabled={saving} onClick={() => setEditing(null)} className="badge-glass rounded-lg px-3 py-1.5 text-slate-100">Скасувати</button>
            </form>
          )}
          <p className="text-xs leading-relaxed text-slate-400">
            Виручка з націнкою {report.markupPercent}% розраховується множенням собівартості фото на 1,30.
            Залишок підписки враховує її чинну ціну, податки, накладні витрати, повний бюджет на текст і вибраний рушій.
            Розрахунок припускає використання всього пакета для фото. Річний план отримує бали щомісяця.
            Для Free показано п’ять спільних генерацій за весь час. Рахунок провайдера може включати доплати за референси.
          </p>
          <div role="region" aria-label="Порівняння фоторендерів за підписками" tabIndex={0} className="overflow-x-auto rounded-xl border border-slate-700/70">
            <table className="w-full min-w-[70rem] text-left text-xs text-slate-200">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th scope="col" className="p-3">Рушій і формат</th>
                  <th scope="col" className="p-3 text-right">Собівартість / фото</th>
                  <th scope="col" className="p-3 text-right">Ціна з націнкою {report.markupPercent}%</th>
                  <th scope="col" className="p-3 text-right">AI-балів / фото</th>
                  {report.plans.map((plan) => (
                    <th key={plan.id} scope="col" className="p-3 whitespace-nowrap">
                      <span className="block text-slate-100">{plan.name}</span>
                      {plan.id === 'free' ? 'Без оплати' : (
                        <>
                          {hryvnias.format(cycle === 'annual' ? plan.priceAnnualUah : plan.priceMonthlyUah)}
                          <span className="block font-normal">{quantities.format(plan.credits)} балів/міс</span>
                        </>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/70">
                {report.rows.map((row) => (
                  <tr key={row.key} className="align-top hover:bg-slate-800/40">
                    <th scope="row" className="p-3 min-w-44 font-medium text-slate-100">
                      {row.label}
                      <span className="mt-0.5 block font-normal text-slate-400">{row.formats.join(' / ')}</span>
                      {!row.available && <span className="mt-0.5 block font-normal text-amber-300">Зараз недоступний</span>}
                      {row.checkedAt && <span className="mt-0.5 block font-normal text-slate-400">Звірено {reviewDate.format(new Date(row.checkedAt))}</span>}
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-normal">
                        <a className="text-sky-300 underline" target="_blank" rel="noreferrer" href={row.sourceUrl}>Джерело</a>
                        <a className="text-sky-300 underline" target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent(row.searchQuery)}`} title={row.searchQuery}>Знайти актуальну ціну</a>
                        <button type="button" disabled={saving} className="text-amber-300 underline"
                          onClick={() => setEditing({ key: row.key, revision: report.review.revision, costUsd: String(row.costUsd), sourceUrl: row.sourceUrl })}>Змінити тариф</button>
                      </div>
                    </th>
                    <td className="p-3 text-right tabular-nums">{dollars.format(row.costUsd)}</td>
                    <td className="p-3 text-right tabular-nums">{dollars.format(row.markupPriceUsd)}</td>
                    <td className="p-3 text-right tabular-nums">{quantities.format(row.credits)}</td>
                    {row.plans.map((plan) => {
                      const estimate = plan[cycle];
                      return (
                        <td key={plan.id} className="p-3 whitespace-nowrap tabular-nums">
                          <span className="block font-semibold">{quantities.format(estimate.photos)} фото</span>
                          <span className="mt-0.5 block text-slate-400">Витрати на фото {hryvnias.format(estimate.imageCostUah)}</span>
                          <span className="block text-slate-400" title={`Націнка ${hryvnias.format(estimate.markupUah)}`}>
                            Виручка +{report.markupPercent}% {hryvnias.format(estimate.markupRevenueUah)}
                          </span>
                          <span className={estimate.contributionUah < 0 ? 'text-rose-300' : 'text-emerald-300'}>
                            Залишок {hryvnias.format(estimate.contributionUah)}
                            {plan.id !== 'free' && ` · ${percent.format(estimate.marginShare)}`}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
