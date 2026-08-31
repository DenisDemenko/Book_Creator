import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldCheck,
  Users,
  Calculator,
  RefreshCw,
  Trash2,
  Ban,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  Image as ImageIcon,
  TrendingUp,
  UserPlus,
  RotateCcw,
  Crown,
  BarChart3,
  Wallet,
  Cpu,
  Percent,
  CreditCard,
  Coins,
  Link2,
} from 'lucide-react';
import { AiPricingAnalyticsView } from './AiPricingAnalyticsView';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { AdminUserRow, UserRole } from '../types';
import { getRoleInfo } from '../utils/rbac';

type AdminTab = 'users' | 'roles' | 'costs' | 'business' | 'ai' | 'bridge';

interface RoleRow {
  role: UserRole;
  defaults: Record<string, boolean>;
  overrides: Record<string, boolean>;
  effective: Record<string, boolean>;
}

interface UsageSummaryRow {
  key: string;
  count: number;
  failed: number;
  costUsd: number;
}

interface UsageResponse {
  periodDays: number;
  pricing: {
    updatedAt: string;
    currency: string;
    source: string;
    images: { engineId: string; modelId: string; label: string; perImageUsd: Record<string, number> }[];
    text: { modelId: string; inputPerMillionUsd: number; outputPerMillionUsd: number; note: string };
  };
  totals: {
    generations: number;
    successful: number;
    failed: number;
    totalUsd: number;
    todayUsd: number;
    averageUsd: number;
    allTimeUsd: number;
  };
  byEngine: UsageSummaryRow[];
  byUser: UsageSummaryRow[];
  byRole: UsageSummaryRow[];
  byDay: UsageSummaryRow[];
  recent: {
    id: string; timestamp: string; userEmail: string; role: string;
    engineId: string; imageSize?: string; costUsd: number; context?: string; success: boolean;
  }[];
}

interface RevenueDayRow {
  day: string;
  revenueUah: number;
  revenueUsd: number;
  imageCostUsd: number;
  textCostUsd: number;
  totalCostUsd: number;
}

interface RevenueResponse {
  periodDays: number;
  exchangeRate: { uahToUsd: number; note: string };
  totals: {
    revenueUah: number;
    revenueUsd: number;
    imageCostUsd: number;
    textCostUsd: number;
    totalCostUsd: number;
    grossMarginUsd: number;
    grossMarginPct: number | null;
    paidPaymentsCount: number;
    mrrUah: number;
    activeSubscribersCount: number;
  };
  byDay: RevenueDayRow[];
  revenueByPlan: { plan: string; nameUk: string; revenueUah: number; count: number }[];
  activeSubscribersByPlan: { plan: string; nameUk: string; count: number }[];
  costByEngine: { kind: string; engineId: string; costUsd: number; count: number }[];
}

/** Кольори графіків — підібрані так, щоб читалися і на темній, і на світлій темі. */
const CHART_COLORS = {
  revenue: '#f59e0b',
  imageCost: '#38bdf8',
  textCost: '#a78bfa',
  subscribers: '#34d399',
  grid: 'rgba(148, 163, 184, 0.18)',
  axis: '#94a3b8',
};
const PIE_COLORS = [CHART_COLORS.imageCost, CHART_COLORS.textCost];

const uah = (n: number) => `${n.toLocaleString('uk-UA', { maximumFractionDigits: 0 })} ₴`;

const PERMISSION_LABELS: Record<string, string> = {
  canGenerateImages: 'Генерація зображень (платно)',
  canUseAi: 'Текстові функції ШІ',
  canEditContent: 'Редагування тексту книги',
};

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/**
 * Міст до вітрини Fusion Lab — адреса API маркетплейсу і спільний ключ.
 *
 * Свідомо окремий компонент зі своїм завантаженням: решта вкладок тягне
 * один спільний знімок адмінських даних, а ці налаштування читаються
 * рідко й не мають сенсу в тому запиті. Ключ ніколи не приходить із
 * сервера — лише відбиток, тож поле завжди порожнє, а «збережено» видно
 * по відбитку поруч.
 */
const MarketplaceBridgePanel: React.FC = () => {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [view, setView] = useState<{
    url: string;
    keySet: boolean;
    keyFingerprint?: string;
    cryptoConfigured: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/marketplace-bridge', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Не вдалося прочитати налаштування мосту.');
      const data = await res.json();
      setView(data);
      setUrl(data.url || '');
    } catch (err: any) {
      setMessage({ tone: 'err', text: err?.message || 'Помилка завантаження.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/marketplace-bridge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        // Ключ надсилаємо лише якщо адмін його вписав: порожнє поле означає
        // «не чіпати збережений», а не «стерти».
        body: JSON.stringify(key.trim() ? { url, key } : { url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Не вдалося зберегти.');
      setView(data);
      setKey('');
      setMessage({ tone: 'ok', text: 'Збережено.' });
    } catch (err: any) {
      setMessage({ tone: 'err', text: err?.message || 'Помилка збереження.' });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/marketplace-bridge/test', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Маркетплейс не відповів.');
      setMessage({
        tone: data.ok ? 'ok' : 'err',
        text: data.ok ? `Звʼязок є: ${data.body || 'HTTP ' + data.status}` : `HTTP ${data.status}`,
      });
    } catch (err: any) {
      setMessage({ tone: 'err', text: err?.message || 'Помилка перевірки.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-white/[0.06] space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-100">Міст «Nova → вітрина Fusion Lab»</h3>
          <p className="text-[11px] text-slate-400 leading-snug mt-1">
            Адреса API маркетплейсу і спільний ключ <code className="text-amber-300">BRIDGE_API_KEY</code>. Той самий
            ключ має стояти у змінних сервісу API на Railway — саме за ним маркетплейс упізнає запити Студії.
          </p>
        </div>

        <label className="block">
          <span className="block text-[11px] font-semibold text-slate-300 mb-1">Адреса API маркетплейсу</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.fusionlab.in.ua"
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 outline-none focus:border-amber-500/60"
          />
        </label>

        <label className="block">
          <span className="block text-[11px] font-semibold text-slate-300 mb-1">
            Ключ мосту
            {view?.keySet && (
              <span className="ml-2 font-mono text-[10px] text-emerald-300">
                збережено · відбиток {view.keyFingerprint || '—'}
              </span>
            )}
          </span>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            type="password"
            autoComplete="off"
            placeholder={view?.keySet ? 'Залиште порожнім, щоб не міняти' : 'Вставте ключ…'}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 outline-none focus:border-amber-500/60 font-mono"
          />
        </label>

        {view && !view.cryptoConfigured && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-[11px]">
            Не налаштований <code>USER_API_KEY_SECRET</code> — без нього ключ мосту неможливо зашифрувати, і збереження
            буде відхилено.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold disabled:opacity-60"
          >
            Зберегти
          </button>
          <button
            onClick={() => void test()}
            disabled={busy || !view?.keySet}
            className="px-4 py-2 rounded-xl badge-glass text-slate-200 text-xs font-bold disabled:opacity-40"
          >
            Перевірити звʼязок
          </button>
        </div>

        {message && (
          <div
            className={`p-3 rounded-xl text-[11px] border ${
              message.tone === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/40 text-rose-200'
            }`}
          >
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
};

export const AdminPanelView: React.FC = () => {
  const [tab, setTab] = useState<AdminTab>('business');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [revenue, setRevenue] = useState<RevenueResponse | null>(null);
  const [periodDays, setPeriodDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Калькулятор прогнозу
  const [calcEngine, setCalcEngine] = useState('nano-banana-2');
  const [calcSize, setCalcSize] = useState('2K');
  const [calcCount, setCalcCount] = useState(100);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const res = await fetch(url, { credentials: 'same-origin', ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Помилка запиту (${res.status})`);
    return data;
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, r, us, rev] = await Promise.all([
        request('/api/admin/users'),
        request('/api/admin/roles'),
        request(`/api/admin/usage?days=${periodDays}`),
        request(`/api/admin/revenue?days=${periodDays}`),
      ]);
      setUsers(u.users || []);
      setRoles(r.roles || []);
      setUsage(us);
      setRevenue(rev);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося завантажити дані панелі.');
    } finally {
      setLoading(false);
    }
  }, [request, periodDays]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3500);
  };

  const patchUser = async (id: string, body: Record<string, unknown>) => {
    try {
      await request(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      flash('Обліковий запис оновлено. Активні сесії користувача завершено.');
      loadAll();
    } catch (err: any) {
      setError(err?.message || 'Не вдалося оновити користувача.');
    }
  };

  const removeUser = async (row: AdminUserRow) => {
    if (!window.confirm(`Видалити обліковий запис ${row.email}? Дію не можна скасувати.`)) return;
    try {
      await request(`/api/admin/users/${row.id}`, { method: 'DELETE' });
      flash(`Обліковий запис ${row.email} видалено.`);
      loadAll();
    } catch (err: any) {
      setError(err?.message || 'Не вдалося видалити користувача.');
    }
  };

  const togglePermission = async (role: UserRole, key: string, value: boolean) => {
    try {
      await request(`/api/admin/roles/${role}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: { [key]: value } }),
      });
      flash(`Права ролі «${getRoleInfo(role).nameUk}» оновлено.`);
      loadAll();
    } catch (err: any) {
      setError(err?.message || 'Не вдалося змінити права.');
    }
  };

  const resetRole = async (role: UserRole) => {
    try {
      await request(`/api/admin/roles/${role}/reset`, { method: 'POST' });
      flash(`Права ролі «${getRoleInfo(role).nameUk}» повернуто до типових.`);
      loadAll();
    } catch (err: any) {
      setError(err?.message || 'Не вдалося скинути права.');
    }
  };

  const pricePerImage = useMemo(() => {
    const engine = usage?.pricing.images.find((e) => e.engineId === calcEngine);
    if (!engine) return 0;
    return engine.perImageUsd[calcSize] ?? Math.min(...Object.values(engine.perImageUsd));
  }, [usage, calcEngine, calcSize]);

  const availableSizes = useMemo(() => {
    const engine = usage?.pricing.images.find((e) => e.engineId === calcEngine);
    return engine ? Object.keys(engine.perImageUsd) : ['2K'];
  }, [usage, calcEngine]);

  useEffect(() => {
    if (!availableSizes.includes(calcSize)) setCalcSize(availableSizes[0]);
  }, [availableSizes, calcSize]);

  const maxDayCost = Math.max(...(usage?.byDay.map((d) => d.costUsd) || [0]), 0.0001);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-6 lg:p-8 space-y-6">
      {/* Шапка */}
      <div className="relative overflow-hidden p-6 rounded-2xl glass-panel-elevated">
        <div className="absolute -top-20 -right-12 w-64 h-64 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl badge-glass text-amber-300">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl lg:text-2xl font-bold font-heading">Панель адміністратора</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Облікові записи, матриця прав доступу та витрати на API генерацій
              </p>
            </div>
          </div>
          <button
            data-tour="admin__2"
            onClick={loadAll}
            disabled={loading}
            className="px-4 py-2 rounded-xl badge-glass hover:border-slate-400/40 text-slate-200 text-xs font-bold flex items-center gap-2 transition-all disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Оновити
          </button>
        </div>

        <div data-tour="admin__1" className="relative flex gap-1 mt-6 p-1 rounded-xl bg-slate-950/60 border border-white/[0.06] w-full sm:w-auto sm:inline-flex">
          {([
            ['business', 'Бізнес-аналітика', BarChart3],
            ['costs', 'Витрати на API', Calculator],
            ['ai', 'Тарифи та аналітика ШІ', Coins],
            ['users', 'Користувачі', Users],
            ['roles', 'Права доступу', ShieldCheck],
            ['bridge', 'Міст до вітрини', Link2],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              id={`admin-tab-${id}`}
              onClick={() => setTab(id)}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                tab === id ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="px-2 rounded hover:bg-white/10">✕</button>
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2" role="status">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* --------------------------- БІЗНЕС-АНАЛІТИКА --------------------------- */}
      {/* ------------------- ТАРИФИ ТА АНАЛІТИКА ШІ ------------------- */}
      {tab === 'ai' && <AiPricingAnalyticsView />}

      {tab === 'bridge' && <MarketplaceBridgePanel />}

      {tab === 'business' && revenue && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Період:</span>
            {[7, 30, 90, 365].map((d) => (
              <button
                key={d}
                onClick={() => setPeriodDays(d)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  periodDays === d ? 'bg-amber-500 text-slate-950' : 'badge-glass text-slate-300'
                }`}
              >
                {d} дн.
              </button>
            ))}
          </div>

          {/* KPI-картки */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                icon: Wallet,
                label: 'Дохід за період',
                value: uah(revenue.totals.revenueUah),
                hint: `≈ ${usd(revenue.totals.revenueUsd)} · ${revenue.totals.paidPaymentsCount} оплат`,
                tone: 'text-amber-300',
              },
              {
                icon: Cpu,
                label: 'Витрати на ШІ',
                value: usd(revenue.totals.totalCostUsd),
                hint: `зображення ${usd(revenue.totals.imageCostUsd)} · текст ${usd(revenue.totals.textCostUsd)}`,
                tone: 'text-cyan-300',
              },
              {
                icon: Percent,
                label: 'Валова маржа',
                value: revenue.totals.grossMarginPct === null ? '—' : `${revenue.totals.grossMarginPct}%`,
                hint: `${usd(revenue.totals.grossMarginUsd)} прибутку (екв.)`,
                tone: revenue.totals.grossMarginUsd >= 0 ? 'text-emerald-300' : 'text-rose-300',
              },
              {
                icon: CreditCard,
                label: 'MRR (щомісячно)',
                value: uah(revenue.totals.mrrUah),
                hint: `${revenue.totals.activeSubscribersCount} активних підписок зараз`,
                tone: 'text-violet-300',
              },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <div key={i} className="p-4 rounded-2xl glass-panel">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${card.tone}`} />
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">{card.label}</span>
                  </div>
                  <div className="text-xl font-bold font-mono">{card.value}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{card.hint}</div>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Дохід рахується в гривні за канонічною ціною тарифу (LiqPay й PayPal зведено в одну валюту),
            витрати на ШІ — в доларах за фактичними токенами й зображеннями. Для валової маржі дохід
            додатково перераховано в долари за курсом {revenue.exchangeRate.uahToUsd} $/₴ —{' '}
            {revenue.exchangeRate.note.toLowerCase()}
          </p>

          {/* Дохід проти витрат на ШІ за днями */}
          <div className="p-6 rounded-2xl glass-panel space-y-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-400" />
              Дохід проти витрат на ШІ-генерацію (за днями, $)
            </h2>
            {revenue.byDay.length === 0 ? (
              <p className="text-xs text-slate-500">Ще недостатньо даних за цей період — щойно з'являться перші оплати чи генерації, тут буде графік.</p>
            ) : (
              <div className="h-72 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={revenue.byDay} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(v: string) => v.slice(5)} tick={{ fill: CHART_COLORS.axis, fontSize: 10 }} axisLine={{ stroke: CHART_COLORS.grid }} tickLine={false} />
                    <YAxis tick={{ fill: CHART_COLORS.axis, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#e2e8f0' }}
                      formatter={(value: number, name: string) => [`$${Number(value).toFixed(3)}`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="imageCostUsd" stackId="cost" stroke={CHART_COLORS.imageCost} fill={CHART_COLORS.imageCost} fillOpacity={0.35} name="Витрати: зображення" />
                    <Area type="monotone" dataKey="textCostUsd" stackId="cost" stroke={CHART_COLORS.textCost} fill={CHART_COLORS.textCost} fillOpacity={0.35} name="Витрати: текст (Gemini+GPT+Claude)" />
                    <Line type="monotone" dataKey="revenueUsd" stroke={CHART_COLORS.revenue} strokeWidth={2.5} dot={false} name="Дохід (екв. $)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Дохід за планами */}
            <div className="p-6 rounded-2xl glass-panel space-y-3">
              <h2 className="text-sm font-bold">Дохід за тарифними планами</h2>
              {revenue.revenueByPlan.length === 0 ? (
                <p className="text-xs text-slate-500">Оплат за цей період ще не було.</p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenue.revenueByPlan} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                      <XAxis dataKey="nameUk" tick={{ fill: CHART_COLORS.axis, fontSize: 11 }} axisLine={{ stroke: CHART_COLORS.grid }} tickLine={false} />
                      <YAxis tick={{ fill: CHART_COLORS.axis, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                        labelStyle={{ color: '#e2e8f0' }}
                        formatter={(value: number, _name: string, item: any) => [uah(value), `Дохід (${item?.payload?.count ?? 0} опл.)`]}
                      />
                      <Bar dataKey="revenueUah" fill={CHART_COLORS.revenue} radius={[6, 6, 0, 0]} name="Дохід" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Структура витрат на ШІ */}
            <div className="p-6 rounded-2xl glass-panel space-y-3">
              <h2 className="text-sm font-bold">Структура витрат на ШІ</h2>
              {revenue.totals.totalCostUsd <= 0 ? (
                <p className="text-xs text-slate-500">Витрат за цей період ще не зафіксовано.</p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Зображення (Nano Banana)', value: revenue.totals.imageCostUsd },
                          { name: 'Текст (Gemini + GPT + Claude)', value: revenue.totals.textCostUsd },
                        ]}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {PIE_COLORS.map((color, i) => (
                          <Cell key={i} fill={color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                        formatter={(value: number) => usd(Number(value))}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Активні підписники за планами */}
          <div className="p-6 rounded-2xl glass-panel space-y-3">
            <h2 className="text-sm font-bold">Активні підписники за планами (зараз)</h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenue.activeSubscribersByPlan} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: CHART_COLORS.axis, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="nameUk" tick={{ fill: CHART_COLORS.axis, fontSize: 11 }} axisLine={{ stroke: CHART_COLORS.grid }} tickLine={false} width={70} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                    formatter={(value: number) => [`${value} підписників`, 'Активні']}
                  />
                  <Bar dataKey="count" fill={CHART_COLORS.subscribers} radius={[0, 6, 6, 0]} name="Підписників" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-slate-500">
              Безкоштовний план у підрахунок не входить — за визначенням не має активної записаної підписки (лічиться лише ліміт генерацій).
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------- ВИТРАТИ ------------------------------- */}
      {tab === 'costs' && usage && (
        <div className="space-y-6">
          {/* Підсумки */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: DollarSign, label: 'За період', value: usd(usage.totals.totalUsd), hint: `${usage.periodDays} днів`, tone: 'text-amber-300' },
              { icon: TrendingUp, label: 'Сьогодні', value: usd(usage.totals.todayUsd), hint: 'з початку доби', tone: 'text-cyan-300' },
              { icon: ImageIcon, label: 'Генерацій', value: String(usage.totals.successful), hint: `${usage.totals.failed} невдалих`, tone: 'text-violet-300' },
              { icon: Calculator, label: 'За весь час', value: usd(usage.totals.allTimeUsd), hint: `середня ${usd(usage.totals.averageUsd)}`, tone: 'text-emerald-300' },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <div key={i} className="p-4 rounded-2xl glass-panel">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${card.tone}`} />
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">{card.label}</span>
                  </div>
                  <div className="text-2xl font-bold font-mono">{card.value}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{card.hint}</div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Період:</span>
            {[7, 30, 90, 365].map((d) => (
              <button
                key={d}
                onClick={() => setPeriodDays(d)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  periodDays === d ? 'bg-amber-500 text-slate-950' : 'badge-glass text-slate-300'
                }`}
              >
                {d} дн.
              </button>
            ))}
          </div>

          {/* Калькулятор прогнозу */}
          <div data-tour="admin__5" className="p-6 rounded-2xl glass-panel space-y-4">
            <div className="flex items-center gap-2 border-b border-white/[0.06] pb-3">
              <Calculator className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-bold">Калькулятор вартості генерацій</h2>
              <span className="text-[10px] text-slate-500 ml-auto">
                тарифи від {usage.pricing.updatedAt}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1.5">Двигун</label>
                <select
                  value={calcEngine}
                  onChange={(e) => setCalcEngine(e.target.value)}
                  className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200"
                >
                  {usage.pricing.images.map((e) => (
                    <option key={e.engineId} value={e.engineId}>{e.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1.5">Роздільність</label>
                <select
                  value={calcSize}
                  onChange={(e) => setCalcSize(e.target.value)}
                  className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200"
                >
                  {availableSizes.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1.5">Кількість зображень</label>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={calcCount}
                  onChange={(e) => setCalcCount(Math.max(1, Number(e.target.value) || 1))}
                  className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 rounded-xl bg-slate-950/50 border border-white/[0.06]">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">За одне зображення</div>
                <div className="text-lg font-bold font-mono text-slate-100 mt-1">{usd(pricePerImage)}</div>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <div className="text-[10px] uppercase tracking-wider text-amber-300/80">Прогноз за {calcCount} шт.</div>
                <div className="text-lg font-bold font-mono text-amber-300 mt-1">{usd(pricePerImage * calcCount)}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/50 border border-white/[0.06]">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Книга на 40 ілюстрацій</div>
                <div className="text-lg font-bold font-mono text-slate-100 mt-1">{usd(pricePerImage * 40)}</div>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Тарифи стандартного рівня Google Gemini API. Текстові функції рахуються окремо:{' '}
              {usd(usage.pricing.text.inputPerMillionUsd)} за млн вхідних та{' '}
              {usd(usage.pricing.text.outputPerMillionUsd)} за млн вихідних токенів. {usage.pricing.text.note}
            </p>
          </div>

          {/* Розподіл за днями */}
          {usage.byDay.length > 0 && (
            <div className="p-6 rounded-2xl glass-panel space-y-3">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                Витрати за днями
              </h2>
              <div className="flex items-end gap-1 h-32">
                {usage.byDay.map((d) => (
                  <div key={d.key} className="flex-1 flex flex-col items-center justify-end group relative min-w-0">
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-amber-500/40 to-amber-400 min-h-[2px] transition-all"
                      style={{ height: `${Math.max(2, (d.costUsd / maxDayCost) * 100)}%` }}
                    />
                    <span className="absolute -top-6 hidden group-hover:block whitespace-nowrap text-[10px] font-mono bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 z-10">
                      {d.key.slice(5)} · {usd(d.costUsd)} · {d.count} шт.
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>{usage.byDay[0]?.key}</span>
                <span>{usage.byDay[usage.byDay.length - 1]?.key}</span>
              </div>
            </div>
          )}

          {/* Розподіли */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {([
              ['За двигунами', usage.byEngine],
              ['За користувачами', usage.byUser],
            ] as const).map(([title, rows]) => (
              <div key={title} className="p-6 rounded-2xl glass-panel space-y-3">
                <h2 className="text-sm font-bold">{title}</h2>
                {rows.length === 0 ? (
                  <p className="text-xs text-slate-500">Поки що жодної генерації.</p>
                ) : (
                  <div className="space-y-2">
                    {rows.map((row) => (
                      <div key={row.key} className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.06]">
                        <span className="truncate font-medium text-slate-200">{row.key}</span>
                        <span className="flex items-center gap-3 shrink-0 ml-3">
                          <span className="text-slate-400 font-mono">{row.count} шт.</span>
                          {row.failed > 0 && <span className="text-rose-400 font-mono">{row.failed} збоїв</span>}
                          <span className="text-amber-300 font-mono font-bold">{usd(row.costUsd)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Останні генерації */}
          <div className="p-6 rounded-2xl glass-panel space-y-3">
            <h2 className="text-sm font-bold">Останні генерації</h2>
            {usage.recent.length === 0 ? (
              <p className="text-xs text-slate-500">Журнал порожній.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-white/[0.06]">
                      <th className="pb-2 pr-3 font-medium">Час</th>
                      <th className="pb-2 pr-3 font-medium">Користувач</th>
                      <th className="pb-2 pr-3 font-medium">Двигун</th>
                      <th className="pb-2 pr-3 font-medium">Що саме</th>
                      <th className="pb-2 text-right font-medium">Вартість</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.recent.map((r) => (
                      <tr key={r.id} className="border-b border-white/[0.04]">
                        <td className="py-2 pr-3 font-mono text-slate-400 whitespace-nowrap">
                          {new Date(r.timestamp).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2 pr-3 truncate max-w-[160px]">{r.userEmail}</td>
                        <td className="py-2 pr-3 text-slate-400">{r.engineId}{r.imageSize ? ` · ${r.imageSize}` : ''}</td>
                        <td className="py-2 pr-3 truncate max-w-[200px] text-slate-400">{r.context || '—'}</td>
                        <td className="py-2 text-right font-mono">
                          {r.success
                            ? <span className="text-amber-300">{usd(r.costUsd)}</span>
                            : <span className="text-rose-400">збій</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------- КОРИСТУВАЧІ ----------------------------- */}
      {tab === 'users' && (
        <div data-tour="admin__3" className="p-6 rounded-2xl glass-panel space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-400" />
              Облікові записи ({users.length})
            </h2>
            <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5" />
              Реєстрація відкрита для всіх
            </span>
          </div>

          {users.length === 0 ? (
            <p className="text-xs text-slate-500">
              Поки що жодного зареєстрованого користувача. Перший, хто зареєструється з адмінською поштою, отримає роль адміністратора.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-white/[0.06]">
                    <th className="pb-2 pr-3 font-medium">Користувач</th>
                    <th className="pb-2 pr-3 font-medium">Роль</th>
                    <th className="pb-2 pr-3 font-medium">Генерацій</th>
                    <th className="pb-2 pr-3 font-medium">Витрачено</th>
                    <th className="pb-2 pr-3 font-medium">Останній вхід</th>
                    <th className="pb-2 text-right font-medium">Дії</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className={`border-b border-white/[0.04] ${u.disabled ? 'opacity-50' : ''}`}>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          {u.isProtectedAdmin && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-100 truncate">{u.name}</div>
                            <div className="text-[11px] text-slate-500 truncate">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <select
                          value={u.role}
                          disabled={u.isProtectedAdmin}
                          onChange={(e) => patchUser(u.id!, { role: e.target.value })}
                          className="field-glow p-1.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200 text-[11px] disabled:opacity-60"
                        >
                          {(['admin', 'writer', 'designer', 'translator', 'publisher', 'reader', 'guest'] as UserRole[]).map((r) => (
                            <option key={r} value={r}>{getRoleInfo(r).badgeEmoji} {getRoleInfo(r).nameUk}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-slate-300">{u.generations}</td>
                      <td className="py-2.5 pr-3 font-mono text-amber-300">{usd(u.spentUsd)}</td>
                      <td className="py-2.5 pr-3 font-mono text-slate-500 whitespace-nowrap">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('uk-UA') : '—'}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => patchUser(u.id!, { disabled: !u.disabled })}
                          disabled={u.isProtectedAdmin}
                          title={u.disabled ? 'Розблокувати' : 'Заблокувати'}
                          className="p-1.5 rounded-lg badge-glass hover:border-amber-400/40 text-slate-300 transition-all disabled:opacity-30 mr-1.5"
                        >
                          {u.disabled ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Ban className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => removeUser(u)}
                          disabled={u.isProtectedAdmin}
                          title="Видалити"
                          className="p-1.5 rounded-lg badge-glass hover:border-rose-400/40 text-rose-300 transition-all disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Зміна ролі або блокування завершує всі активні сесії користувача — нові права діють негайно, а не після виходу.
          </p>
        </div>
      )}

      {/* ------------------------------- ПРАВА -------------------------------- */}
      {tab === 'roles' && (
        <div data-tour="admin__4" className="space-y-4">
          <div className="p-4 rounded-2xl glass-panel text-xs text-slate-400 leading-relaxed">
            Тут задаються дозволи, які перевіряє <strong className="text-slate-200">сервер</strong>. Вимкнений
            дозвіл неможливо обійти через інтерфейс — запит буде відхилено. Права адміністратора
            незмінні, щоб не можна було випадково забрати доступ у себе.
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {roles.map((row) => {
              const info = getRoleInfo(row.role);
              const hasOverrides = Object.keys(row.overrides).length > 0;
              return (
                <div key={row.role} className="p-5 rounded-2xl glass-panel space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{info.badgeEmoji}</span>
                      <div>
                        <div className="font-bold text-sm">{info.nameUk}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{info.nameEn}</div>
                      </div>
                    </div>
                    {hasOverrides && (
                      <button
                        onClick={() => resetRole(row.role)}
                        className="px-2.5 py-1 rounded-lg badge-glass text-[10px] font-bold text-slate-300 hover:border-slate-400/40 flex items-center gap-1 transition-all"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Скинути
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {Object.keys(PERMISSION_LABELS).map((key) => {
                      const value = row.effective[key] === true;
                      const overridden = key in row.overrides;
                      const locked = row.role === 'admin';
                      return (
                        <label
                          key={key}
                          className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border text-xs transition-all ${
                            locked
                              ? 'bg-slate-950/40 border-white/[0.04] opacity-60 cursor-not-allowed'
                              : 'bg-slate-950/50 border-white/[0.06] hover:border-white/[0.14] cursor-pointer'
                          }`}
                        >
                          <span className="flex-1">
                            {PERMISSION_LABELS[key]}
                            {overridden && (
                              <span className="ml-1.5 text-[9px] uppercase tracking-wide text-amber-400">змінено</span>
                            )}
                          </span>
                          <input
                            type="checkbox"
                            checked={value}
                            disabled={locked}
                            onChange={(e) => togglePermission(row.role, key, e.target.checked)}
                            className="w-4 h-4 accent-amber-500 shrink-0"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading && !usage && !revenue && (
        <div className="p-10 text-center text-sm text-slate-400">Завантаження даних панелі…</div>
      )}
    </div>
  );
};
