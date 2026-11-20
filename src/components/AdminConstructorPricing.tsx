import { useEffect, useState } from 'react';
import type { ConstructorRenderReport } from '../../server/constructorRenderReport';

const hryvnias = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' });
const dollars = new Intl.NumberFormat('uk-UA', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 6,
});
const quantities = new Intl.NumberFormat('uk-UA');
const percent = new Intl.NumberFormat('uk-UA', { style: 'percent', maximumFractionDigits: 1 });

export function AdminConstructorPricing() {
  const [report, setReport] = useState<ConstructorRenderReport | null>(null);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');

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
            onClick={() => { setError(''); setRequest((value) => value + 1); }}
            className="badge-glass rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-100"
          >
            Оновити
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {!report && !error && <p role="status" className="text-xs text-slate-400">Завантаження тарифів…</p>}
      {report && (
        <>
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
