import React, { useCallback, useEffect, useState } from 'react';

interface PriceRow {
  plan: string;
  nameUk: string;
  credits: number;
  grossUah: number;
  vatUah: number;
  netUah: number;
  turnoverTaxUah: number;
  overheadUah: number;
  imageCostUah: number;
  otherAiUah: number;
  contributionUah: number;
  marginShare: number;
}

interface RegimeInfo {
  id: string;
  nameUk: string;
  noteUk: string;
  vatIncluded: boolean;
  vatPercent: number;
  prices: PriceRow[];
}

interface TaxPricingResponse {
  active: string;
  targetMarginPercent: number;
  fxUahPerUsd: number;
  regimes: RegimeInfo[];
}

const uah = (n: number) => `${n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴`;

/** Перемикач податкового режиму + таблиця цін і маржі за кожним сценарієм (ТЗ v0.5). */
export const AdminTaxPricingPanel: React.FC = () => {
  const [data, setData] = useState<TaxPricingResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tax-regime', { credentials: 'same-origin' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Помилка запиту (${res.status})`);
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося завантажити податкові сценарії.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const choose = async (regime: string) => {
    if (!data || data.active === regime || busy) return;
    const target = data.regimes.find((r) => r.id === regime);
    if (!window.confirm(`Перемкнути на «${target?.nameUk}»? Ціни тарифів на сайті одразу зміняться; вже оплачені підписки не чіпаємо.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/tax-regime', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regime }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Помилка запиту (${res.status})`);
      setData(json);
      setNotice('Режим змінено, ціни перераховано.');
      setTimeout(() => setNotice(null), 3500);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося змінити режим.');
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return <div className="text-xs text-slate-400">{error || 'Завантаження податкових сценаріїв…'}</div>;
  }

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-slate-100">Податковий режим і ціни підписок</h3>
        <p className="text-[11px] text-slate-400 mt-1">
          Ціни рахуються так, щоб валова маржа на виручці без ПДВ була {data.targetMarginPercent}% при 100% витрачених балів
          (курс {data.fxUahPerUsd} ₴/$, 8% накладних, бюджет на текст/JEV) і округлені вгору до кратного 10/100 ₴.
          Це модель, не підтверджені рахунки провайдерів — режим звіряйте з бухгалтером.
        </p>
      </div>

      {error && <div className="text-xs text-rose-300">{error}</div>}
      {notice && <div className="text-xs text-emerald-300">{notice}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {data.regimes.map((r) => {
          const active = r.id === data.active;
          return (
            <div key={r.id} className={`rounded-xl border p-3 ${active ? 'border-amber-500/60 bg-amber-500/5' : 'border-slate-700'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-slate-100">{r.nameUk}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{r.noteUk}</div>
                </div>
                <button
                  disabled={active || busy}
                  onClick={() => choose(r.id)}
                  className={`shrink-0 px-3 py-1 rounded-lg text-[11px] font-semibold ${
                    active ? 'bg-amber-500 text-slate-950' : 'badge-glass text-slate-300 hover:text-white'
                  }`}
                >
                  {active ? 'Активний' : 'Обрати'}
                </button>
              </div>
              <table className="w-full mt-2 text-[11px] text-slate-300">
                <thead>
                  <tr className="text-slate-500 text-left">
                    <th className="font-medium">План</th>
                    <th className="font-medium text-right">Ціна</th>
                    {r.vatIncluded && <th className="font-medium text-right">ПДВ</th>}
                    <th className="font-medium text-right">Без ПДВ</th>
                    <th className="font-medium text-right">Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  {r.prices.map((p) => (
                    <tr key={p.plan}>
                      <td>{p.nameUk} · {p.credits.toLocaleString('uk-UA')}</td>
                      <td className="text-right font-semibold text-slate-100">{uah(p.grossUah)}</td>
                      {r.vatIncluded && <td className="text-right">{uah(p.vatUah)}</td>}
                      <td className="text-right">{uah(p.netUah)}</td>
                      <td className="text-right">{Math.round(p.marginShare * 1000) / 10}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
};
