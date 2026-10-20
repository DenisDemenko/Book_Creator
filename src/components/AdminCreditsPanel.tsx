import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminTaxPricingPanel } from './AdminTaxPricingPanel';

interface PricingConfig {
  targetMarginPercent: number;
  overheadPercent: number;
  usdPerCredit: number;
  fxUahPerUsd: number;
  textBudgetUah: number;
  freeCredits: number;
  planCredits: { start: number; pro: number; ultra: number; team: number };
}

interface ImageRow { key: string; label: string; size: string; costUsd: number; credits: number }
interface VideoRow {
  engineId: string; label: string; resolution: string; durationSec: number | null; costUsd: number;
  credits: number; creditsPerSecond: number | null; minDurationSec: number | null; maxDurationSec: number | null;
}
interface PlanRow {
  id: string; nameUk: string; credits: number; priceMonthlyUah: number; priceAnnualUah: number; textBudgetUah: number | null;
}
interface Overview {
  config: PricingConfig;
  defaults: PricingConfig;
  plans: PlanRow[];
  images: ImageRow[];
  videos: VideoRow[];
  examples: { photo: ImageRow | null; video: VideoRow | null };
  walletAvailable: boolean;
}
interface UserRow {
  id: string; email: string; name: string; role: string; plan: string; cycle: string; periodEnd: string;
  available: number | null; reserved: number | null;
}
interface LedgerRow {
  id: number; kind: string; availableDelta: number; reservedDelta: number; ref: string | null;
  reason: string | null; operator: string | null; createdAt: string;
}

const PLAN_IDS = ['free', 'start', 'pro', 'ultra', 'team'];
const num = (n: number, d = 0) => n.toLocaleString('uk-UA', { maximumFractionDigits: d });

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Помилка запиту (${res.status})`);
  return data;
}
const post = (url: string, method: string, body: unknown) =>
  api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

type Section = 'params' | 'costs' | 'users';

/** Єдине місце керування балами й підписками: параметри → ціни/пакети/списання, таблиця вартості, користувачі. */
export const AdminCreditsPanel: React.FC = () => {
  const [section, setSection] = useState<Section>('params');
  const [data, setData] = useState<Overview | null>(null);
  const [form, setForm] = useState<PricingConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d: Overview = await api('/api/admin/credits/overview');
      setData(d);
      setForm(d.config);
    } catch (e: any) {
      setError(e?.message || 'Не вдалося завантажити дані про бали.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 4000); };

  const save = async () => {
    if (!form) return;
    if (!window.confirm('Зберегти параметри? Ціни підписок, пакети балів, ліміт тексту й формула списання зміняться одразу. Вже нараховані бали не чіпаються.')) return;
    setError(null);
    try {
      const d: Overview = await post('/api/admin/credits/config', 'PUT', form);
      setData(d);
      setForm(d.config);
      flash('Збережено: ціни, пакети й списання оновлено автоматично.');
    } catch (e: any) {
      setError(e?.message || 'Не вдалося зберегти.');
    }
  };

  const changed = useMemo(() => !!data && !!form && JSON.stringify(data.config) !== JSON.stringify(form), [data, form]);

  if (!data || !form) return <div className="text-xs text-slate-400">{error || 'Завантаження даних про бали…'}</div>;

  const field = (label: string, key: keyof Omit<PricingConfig, 'planCredits'>, hint?: string, step = 1) => (
    <label className="flex flex-col gap-1 text-[11px] text-slate-400">
      <span>{label}</span>
      <input
        type="number" step={step} value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
        className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100"
      />
      {hint && <span className="text-slate-500">{hint} (типово {data.defaults[key]})</span>}
    </label>
  );

  const ex = data.examples;

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-slate-100">AI-бали та підписки</h3>
        <p className="text-[11px] text-slate-400 mt-1">
          Один бал знімається за зображення й відео. Правки параметрів автоматично переносяться в ціни підписок,
          пакети балів, ліміт тексту й формулу списання.
        </p>
        {ex.photo && ex.video && (
          <p className="text-xs text-amber-300 mt-2">
            Зараз: одне фото ({ex.photo.label}, {ex.photo.size}) = <b>{num(ex.photo.credits)}</b> балів;
            одне відео ({ex.video.label}, {ex.video.resolution}, {ex.video.durationSec} с) = <b>{num(ex.video.credits)}</b> балів.
          </p>
        )}
      </div>

      {error && <div className="text-xs text-rose-300">{error}</div>}
      {notice && <div className="text-xs text-emerald-300">{notice}</div>}
      {!data.walletAvailable && (
        <div className="text-xs text-amber-300">Гаманець недоступний: сховище працює без SQLite, списання балів вимкнено.</div>
      )}

      <div className="flex gap-2">
        {([['params', 'Параметри й плани'], ['costs', 'Вартість генерацій'], ['users', 'Користувачі']] as [Section, string][]).map(([id, label]) => (
          <button
            key={id} onClick={() => setSection(id)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold ${section === id ? 'bg-amber-500 text-slate-950' : 'badge-glass text-slate-300'}`}
          >{label}</button>
        ))}
      </div>

      {section === 'params' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {field('Цільова маржа, %', 'targetMarginPercent', 'валова, від виручки без ПДВ')}
            {field('Накладні, %', 'overheadPercent', 'платежі + інфраструктура')}
            {field('Вартість 1 бала, $', 'usdPerCredit', 'роздрібна', 0.0001)}
            {field('Курс, ₴ за $', 'fxUahPerUsd', 'для цін і ліміту тексту', 0.1)}
            {field('Ліміт тексту, ₴/період', 'textBudgetUah', 'на кожну платну підписку')}
            {field('Пробні бали', 'freeCredits', 'зареєстрований без підписки, одноразово')}
            {(['start', 'pro', 'ultra', 'team'] as const).map((p) => (
              <label key={p} className="flex flex-col gap-1 text-[11px] text-slate-400">
                <span>Бали {p}/міс</span>
                <input
                  type="number" value={form.planCredits[p]}
                  onChange={(e) => setForm({ ...form, planCredits: { ...form.planCredits, [p]: Number(e.target.value) } })}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100"
                />
                <span className="text-slate-500">типово {num(data.defaults.planCredits[p])}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button disabled={!changed} onClick={save}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 disabled:opacity-40">Зберегти й застосувати</button>
            <button disabled={!changed} onClick={() => setForm(data.config)} className="px-3 py-1.5 rounded-lg text-xs badge-glass text-slate-300 disabled:opacity-40">Скасувати</button>
            <button onClick={() => setForm(data.defaults)} className="px-3 py-1.5 rounded-lg text-xs badge-glass text-slate-300">Типові значення</button>
          </div>

          <table className="w-full text-[11px] text-slate-300">
            <thead><tr className="text-slate-500 text-left">
              <th className="font-medium">План</th><th className="font-medium text-right">Бали</th>
              <th className="font-medium text-right">₴/міс</th><th className="font-medium text-right">₴/рік</th>
              <th className="font-medium text-right">Текст, ₴</th>
            </tr></thead>
            <tbody>
              {data.plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.nameUk}</td>
                  <td className="text-right">{num(p.credits)}{p.id === 'free' ? ' (раз)' : ''}</td>
                  <td className="text-right font-semibold text-slate-100">{p.id === 'free' ? '—' : num(p.priceMonthlyUah)}</td>
                  <td className="text-right">{p.id === 'free' ? '—' : num(p.priceAnnualUah)}</td>
                  <td className="text-right">{p.textBudgetUah === null ? 'без ліміту' : num(p.textBudgetUah)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <AdminTaxPricingPanel key={JSON.stringify(data.config) + data.plans.map((p) => p.priceMonthlyUah).join()} />
        </div>
      )}

      {section === 'costs' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs font-bold text-slate-100 mb-2">Фото: балів за 1 зображення</h4>
            <table className="w-full text-[11px] text-slate-300">
              <thead><tr className="text-slate-500 text-left">
                <th className="font-medium">Модель</th><th className="font-medium">Розмір</th>
                <th className="font-medium text-right">Собівартість</th><th className="font-medium text-right">Балів</th>
              </tr></thead>
              <tbody>
                {data.images.map((r, i) => (
                  <tr key={i}><td>{r.label}</td><td>{r.size}</td><td className="text-right">${r.costUsd}</td>
                    <td className="text-right font-semibold text-slate-100">{num(r.credits)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-100 mb-2">Відео: балів за 1 кліп (типова тривалість)</h4>
            <table className="w-full text-[11px] text-slate-300">
              <thead><tr className="text-slate-500 text-left">
                <th className="font-medium">Модель</th><th className="font-medium">Розд.</th><th className="font-medium text-right">Тривал.</th>
                <th className="font-medium text-right">Балів</th><th className="font-medium text-right">за с</th>
              </tr></thead>
              <tbody>
                {data.videos.map((r, i) => (
                  <tr key={i}>
                    <td>{r.label}</td><td>{r.resolution}</td>
                    <td className="text-right">{r.durationSec ? `${r.durationSec} с` : 'кліп'}</td>
                    <td className="text-right font-semibold text-slate-100">{num(r.credits)}</td>
                    <td className="text-right">{r.creditsPerSecond ? num(r.creditsPerSecond) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-500 mt-2">
              Балів = собівартість / (вартість бала × (1 − маржа)), округлено вгору. Таблиця перераховується разом із параметрами.
            </p>
          </div>
        </div>
      )}

      {section === 'users' && <UsersSection onChanged={load} flash={flash} setError={setError} />}
    </div>
  );
};

const UsersSection: React.FC<{ onChanged: () => void; flash: (m: string) => void; setError: (m: string | null) => void }> = ({ flash, setError }) => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState('start');
  const [cycle, setCycle] = useState('monthly');

  const load = useCallback(async () => {
    try {
      const d = await api('/api/admin/credits/users');
      setUsers(d.users || []);
    } catch (e: any) {
      setError(e?.message || 'Не вдалося завантажити користувачів.');
    }
  }, [setError]);
  useEffect(() => { load(); }, [load]);

  const open = async (id: string) => {
    setOpenId(id === openId ? null : id);
    if (id === openId) return;
    try {
      const d = await api(`/api/admin/credits/users/${id}/ledger`);
      setLedger(d.ledger || []);
    } catch {
      setLedger([]);
    }
  };

  const adjust = async (id: string) => {
    try {
      await post(`/api/admin/credits/users/${id}/adjust`, 'POST', { delta: Number(delta), reason });
      flash('Баланс змінено, проводку записано в журнал.');
      setDelta(''); setReason('');
      await load();
      const d = await api(`/api/admin/credits/users/${id}/ledger`);
      setLedger(d.ledger || []);
    } catch (e: any) {
      setError(e?.message || 'Не вдалося змінити баланс.');
    }
  };

  const assign = async (id: string) => {
    if (!window.confirm(`Призначити тариф «${plan}» (${cycle === 'annual' ? 'рік' : 'місяць'}) без оплати?`)) return;
    try {
      await post(`/api/admin/credits/users/${id}/plan`, 'POST', { plan, cycle });
      flash('Тариф призначено, бали нараховано.');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Не вдалося призначити тариф.');
    }
  };

  const q = query.trim().toLowerCase();
  const rows = users.filter((u) => !q || u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));

  return (
    <div className="space-y-3">
      <input
        value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Пошук за email або іменем"
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100"
      />
      <table className="w-full text-[11px] text-slate-300">
        <thead><tr className="text-slate-500 text-left">
          <th className="font-medium">Користувач</th><th className="font-medium">Тариф</th>
          <th className="font-medium text-right">Доступно</th><th className="font-medium text-right">Резерв</th>
          <th className="font-medium text-right">Період до</th>
        </tr></thead>
        <tbody>
          {rows.map((u) => (
            <React.Fragment key={u.id}>
              <tr onClick={() => open(u.id)} className="cursor-pointer hover:bg-white/5">
                <td>{u.email}<span className="text-slate-500"> · {u.role}</span></td>
                <td>{u.plan}{u.plan !== 'free' ? ` (${u.cycle === 'annual' ? 'рік' : 'міс'})` : ''}</td>
                <td className="text-right font-semibold text-slate-100">{u.available === null ? '—' : num(u.available)}</td>
                <td className="text-right">{u.reserved === null ? '—' : num(u.reserved)}</td>
                <td className="text-right">{u.plan === 'free' ? '—' : new Date(u.periodEnd).toLocaleDateString('uk-UA')}</td>
              </tr>
              {openId === u.id && (
                <tr><td colSpan={5} className="bg-slate-900/60 p-3">
                  <div className="flex flex-wrap gap-2 items-end mb-3">
                    <input value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="± балів"
                      className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100" />
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (обов'язково)"
                      className="flex-1 min-w-[160px] bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100" />
                    <button onClick={() => adjust(u.id)} disabled={!delta || !reason.trim()}
                      className="px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 disabled:opacity-40">Скоригувати</button>
                    <select value={plan} onChange={(e) => setPlan(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100">
                      {PLAN_IDS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select value={cycle} onChange={(e) => setCycle(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100">
                      <option value="monthly">місяць</option><option value="annual">рік</option>
                    </select>
                    <button onClick={() => assign(u.id)} className="px-3 py-1 rounded-lg text-xs badge-glass text-slate-200">Призначити тариф</button>
                  </div>
                  <table className="w-full text-[11px] text-slate-400">
                    <thead><tr className="text-slate-500 text-left">
                      <th className="font-medium">Час</th><th className="font-medium">Подія</th>
                      <th className="font-medium text-right">Δ доступно</th><th className="font-medium text-right">Δ резерв</th>
                      <th className="font-medium">Причина / оператор</th>
                    </tr></thead>
                    <tbody>
                      {ledger.length === 0 && <tr><td colSpan={5}>Проводок ще немає.</td></tr>}
                      {ledger.map((l) => (
                        <tr key={l.id}>
                          <td>{new Date(l.createdAt).toLocaleString('uk-UA')}</td><td>{l.kind}</td>
                          <td className="text-right">{l.availableDelta}</td><td className="text-right">{l.reservedDelta}</td>
                          <td>{[l.reason, l.operator].filter(Boolean).join(' · ') || l.ref || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};
