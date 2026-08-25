/**
 * Вкладка адмінки «Тарифи та аналітика ШІ».
 *
 * Інтеграція з Modul_token (ARCHITECTURE_TOKEN_MODULE_INTEGRATION.md, п. 7б):
 * показує тарифи текстових двигунів (включно з новими DeepSeek/Groq/Mistral)
 * і аналітику чат-сесій — реальні дані з usage_log / chat_sessions / chat_messages
 * Book_Creality (не власне сховище Modul_token).
 *
 * Дизайн: неоморфна тема, портована з Modul_token (src/styles/tokenModuleTheme.css,
 * клас `.token-module-scope`) — той самий візуальний принцип, що й у
 * редизайні чату (QuickAiModal.tsx), включно з панеллю сесій, де адмін може
 * створити тестову сесію та видалити будь-яку (модерація) — server/adminRoutes.ts
 * → POST/DELETE /api/admin/chat/sessions.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw,
  Download,
  Cpu,
  Bot,
  Brain,
  Sparkles,
  Calculator,
  TrendingUp,
  AlertTriangle,
  Loader2,
  Coins,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { useSunLighting } from '../context/SunLightingContext';

interface AiPricingRow {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  input_price_per_1k: number;
  output_price_per_1k: number;
  is_active: boolean;
  updated_at: string;
  note?: string;
}

interface VelocityPoint {
  day: string;
  tokens: number;
  cost: number;
  isPeak?: boolean;
}

interface CostShare {
  model: string;
  cost: number;
  tokens: number;
  percentage: number;
}

interface AnalyticsSession {
  id: string;
  title: string;
  status: string;
  model: string;
  created_at: string;
  updated_at: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: number;
}

interface AiAnalytics {
  total_cost: number;
  total_tokens: number;
  active_sessions_count: number;
  avg_cost_per_session: number;
  cache_hit_rate: number;
  avg_latency_ms: number;
  error_rate: number;
  velocity_7d: VelocityPoint[];
  cost_distribution: CostShare[];
}

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  Google: Cpu,
  OpenAI: Bot,
  Anthropic: Brain,
  DeepSeek: Sparkles,
  Meta: Sparkles,
  Mistral: Sparkles,
};

const PROVIDER_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#fb7185', '#fbbf24'];

/** Унікальний колір світіння для кожної компанії-провайдера. Цей шар
 *  «аврори» світиться навколо картки тарифа окремою для кожної компанії. */
const PROVIDER_GLOW: Record<string, { hex: string; rgb: string }> = {
  Google:    { hex: '#4285F4', rgb: '66, 133, 244' },  // фірмовий синій Google
  OpenAI:    { hex: '#10A37F', rgb: '16, 163, 127' },  // зелений OpenAI
  Anthropic: { hex: '#D97757', rgb: '217, 119, 87' },  // теракота Anthropic
  DeepSeek:  { hex: '#4D6BFE', rgb: '77, 107, 254' },  // синьо-фіолетовий DeepSeek
  Meta:      { hex: '#A78BFA', rgb: '167, 139, 250' }, // фіолетовий Meta
  Mistral:   { hex: '#FB7185', rgb: '251, 113, 133' }, // рожевий Mistral
};
const PROVIDER_GLOW_FALLBACK = { hex: '#22D3EE', rgb: '34, 211, 238' };

export const AiPricingAnalyticsView: React.FC = () => {
  const [pricings, setPricings] = useState<AiPricingRow[]>([]);
  const [analytics, setAnalytics] = useState<AiAnalytics | null>(null);
  const [sessions, setSessions] = useState<AnalyticsSession[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unitMode, setUnitMode] = useState<'1k' | '1m'>('1m');
  const [estInput, setEstInput] = useState(25000);
  const [estOutput, setEstOutput] = useState(5000);
  const [creatingSession, setCreatingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  // ---- Світіння карток, кероване позицією сонечка на екрані (як на інших сторінках) ----
  const { sunPosition, intensityFactor, isSunEnabled } = useSunLighting();
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [cardSun, setCardSun] = useState<Record<string, { dx: number; dy: number; dist: number }>>({});

  useEffect(() => {
    const update = () => {
      const next: Record<string, { dx: number; dy: number; dist: number }> = {};
      for (const [id, el] of Object.entries(cardRefs.current)) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = sunPosition.x - cx;
        const dy = sunPosition.y - cy;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        next[id] = { dx: dx / dist, dy: dy / dist, dist };
      }
      setCardSun(next);
    };
    update();
    const onScrollOrResize = () => update();
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [sunPosition]);

  /** Стиль сяйва картки: напрямок тіні/хайлайту — від/до сонця (як у
   *  .neo-* на інших сторінках), кольорове світіння — унікальне для
   *  компанії, сила — від близькості сонця та спринту (intensityFactor). */
  const providerGlowStyle = useCallback(
    (provider: string, info?: { dx: number; dy: number; dist: number }): React.CSSProperties => {
      const glow = PROVIDER_GLOW[provider] || PROVIDER_GLOW_FALLBACK;
      const { dx = 0.7, dy = -0.7, dist = 1400 } = info || {};
      const proximity = Math.max(0, Math.min(1, 1 - dist / 900));
      const sunFactor = isSunEnabled ? 0.6 + intensityFactor * 0.4 : 0.12;
      const glowAlpha = (0.1 + proximity * 0.5) * sunFactor;
      const innerAlpha = (0.05 + proximity * 0.14) * sunFactor;
      const glowRadius = 18 + proximity * 30;
      const glowSpread = 3 + proximity * 10;
      const shadowX = (-dx * 5).toFixed(1);
      const shadowY = (-dy * 5).toFixed(1);
      const lightX = (dx * 5).toFixed(1);
      const lightY = (dy * 5).toFixed(1);
      // 0.6 = типова інтенсивність повзунка «Сайво:» (150pt/250): діленням
      // на неї зберігаємо поточний вигляд, а сам повзунок тепер регулює
      // силу цього світіння карток (через CSS var() — оновлюється живцем).
      return {
        backgroundColor: 'var(--surface)',
        backgroundImage: `radial-gradient(circle 150px at ${(50 + dx * 30).toFixed(0)}% ${(50 + dy * 30).toFixed(0)}%, rgba(${glow.rgb}, calc(${innerAlpha.toFixed(3)} * var(--glow-intensity) / 0.6)), transparent 72%)`,
        boxShadow: `${shadowX}px ${shadowY}px 12px var(--shadow-dark), ${lightX}px ${lightY}px 12px var(--shadow-light), 0 0 ${glowRadius.toFixed(0)}px ${glowSpread.toFixed(0)}px rgba(${glow.rgb}, calc(${glowAlpha.toFixed(3)} * var(--glow-intensity) / 0.6))`,
        transition: 'box-shadow 0.15s ease-out, background-image 0.2s ease-out, opacity 0.2s ease-out',
      };
    },
    [intensityFactor, isSunEnabled]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pricingRes, analyticsRes] = await Promise.all([
        fetch('/api/admin/ai/pricing', { credentials: 'same-origin' }),
        fetch('/api/admin/ai/analytics', { credentials: 'same-origin' }),
      ]);
      if (!pricingRes.ok || !analyticsRes.ok) {
        throw new Error('Не вдалося завантажити тарифи/аналітику ШІ.');
      }
      const pricingData = await pricingRes.json();
      const analyticsData = await analyticsRes.json();
      setPricings(pricingData.pricings || []);
      setUpdatedAt(pricingData.updatedAt || '');
      setAnalytics(analyticsData.analytics);
      setSessions(analyticsData.sessions || []);
    } catch (e: any) {
      setError(e?.message || 'Помилка завантаження.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** «+ Нова тестова сесія» — створює чат-сесію під обліковим записом адміна (для ручної перевірки моделі з адмінки). */
  const createTestSession = async () => {
    setCreatingSession(true);
    try {
      const res = await fetch('/api/admin/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: '{}',
      });
      if (res.ok) await load();
    } catch {
      /* мережа впала — панель просто не оновиться */
    } finally {
      setCreatingSession(false);
    }
  };

  /** Видалення будь-якої сесії з панелі — адмінська модерація. */
  const deleteSession = async (id: string) => {
    setDeletingSessionId(id);
    try {
      const res = await fetch(`/api/admin/chat/sessions/${id}`, { method: 'DELETE', credentials: 'same-origin' });
      if (res.ok) setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      /* мережа впала — рядок лишиться, наступний load() звірить реальний стан */
    } finally {
      setDeletingSessionId(null);
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Session ID', 'Title', 'Model', 'Status', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Total Cost ($)'],
      ...sessions.map((s) => [
        s.id,
        `"${s.title.replace(/"/g, '""')}"`,
        s.model,
        s.status,
        s.total_input_tokens,
        s.total_output_tokens,
        s.total_tokens,
        s.total_cost.toFixed(4),
      ]),
    ];
    const csv = 'data:text/csv;charset=utf-8,' + rows.map((r) => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = encodeURI(csv);
    a.download = `chat-telemetry-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const multiplier = unitMode === '1m' ? 1000 : 1;
  const maxTokens = Math.max(...(analytics?.velocity_7d.map((v) => v.tokens) || [0]), 1);

  if (loading && !pricings.length) {
    return (
      <div className="token-module-scope p-10 rounded-2xl text-[var(--outline)] text-sm flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Завантаження…
      </div>
    );
  }

  return (
    <div className="token-module-scope rounded-2xl p-5 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--on-surface)]">Тарифи та аналітика ШІ</h2>
          <p className="text-xs text-[var(--outline)] mt-0.5">
            Ціни текстових двигунів і витрати чат-сесій {updatedAt ? `· тарифи від ${updatedAt}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={!sessions.length}
            className="px-3 py-1.5 rounded-lg nm-btn text-[var(--on-surface)] text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg nm-btn text-[var(--on-surface)] text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Оновити
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl nm-inset text-rose-400 text-xs flex items-start gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {/* ----------------------------- ТАРИФИ ----------------------------- */}
      {/* overflow-visible — щоб кольорове світіння карток не зрізалось краєм секції */}
      <div className="relative overflow-visible p-5 rounded-2xl nm-outset">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-bold text-[var(--on-surface)] flex items-center gap-2">
            <Calculator className="w-4 h-4 text-[var(--primary)]" /> Тарифи текстових моделей
          </h3>
          <div className="flex items-center gap-1 p-1 rounded-xl nm-inset">
            {(['1k', '1m'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnitMode(u)}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  unitMode === u ? 'nm-btn-primary' : 'text-[var(--outline)] hover:text-[var(--on-surface)]'
                }`}
              >
                {u === '1k' ? 'за 1k' : 'за 1M'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {pricings.map((p) => {
            const Icon = PROVIDER_ICONS[p.provider] || Sparkles;
            const inPrice = p.input_price_per_1k * multiplier;
            const outPrice = p.output_price_per_1k * multiplier;
            return (
              <div
                key={p.id}
                ref={(el) => { cardRefs.current[p.id] = el; }}
                className={`rounded-2xl p-4 nm-outset-sm transition-all ${p.is_active ? '' : 'opacity-60'}`}
                style={providerGlowStyle(p.provider, cardSun[p.id])}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg nm-inset text-[var(--primary)]">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-[13px] font-bold text-[var(--on-surface)]">{p.provider}</div>
                      <div className="text-[10px] text-[var(--outline)] font-mono truncate max-w-[180px]">{p.model}</div>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      p.is_active ? 'bg-emerald-500/15 text-emerald-300' : 'text-[var(--outline)]'
                    }`}
                  >
                    {p.is_active ? 'активна' : 'немає ключа'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-xl nm-inset p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--outline)]">вхід</div>
                    <div className="text-[15px] font-mono font-bold text-[var(--on-surface)] mt-0.5">
                      ${inPrice.toFixed(inPrice < 0.01 && unitMode === '1k' ? 4 : unitMode === '1m' ? 2 : 3)}
                    </div>
                  </div>
                  <div className="rounded-xl nm-inset p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--outline)]">вихід</div>
                    <div className="text-[15px] font-mono font-bold text-[var(--on-surface)] mt-0.5">
                      ${outPrice.toFixed(outPrice < 0.01 && unitMode === '1k' ? 4 : unitMode === '1m' ? 2 : 3)}
                    </div>
                  </div>
                </div>
                {p.note && <p className="text-[10px] text-[var(--outline)] mt-2 leading-snug">{p.note}</p>}
              </div>
            );
          })}
        </div>

        {/* Калькулятор вартості */}
        <div className="mt-5 rounded-2xl nm-inset-deep p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[var(--on-surface)]">Орієнтовна вартість повідомлення</span>
            <span className="text-[11px] text-[var(--outline)]">{estInput.toLocaleString()} вхідних · {estOutput.toLocaleString()} вихідних токенів</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <input
                type="range" min={1000} max={200000} step={1000}
                value={estInput} onChange={(e) => setEstInput(Number(e.target.value))}
                className="w-full accent-[var(--primary)]"
              />
            </div>
            <div>
              <input
                type="range" min={500} max={32000} step={500}
                value={estOutput} onChange={(e) => setEstOutput(Number(e.target.value))}
                className="w-full accent-[var(--primary)]"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-3">
            {pricings.filter((p) => p.is_active).map((p) => {
              const cost = (estInput * p.input_price_per_1k + estOutput * p.output_price_per_1k) / 1000;
              return (
                <div key={p.id} className="rounded-xl nm-outset-xs p-2 text-center">
                  <div className="text-[10px] text-[var(--outline)] truncate">{p.provider}</div>
                  <div className="text-[13px] font-mono font-bold text-[var(--primary)]">${cost.toFixed(4)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* --------------------------- АНАЛІТИКА --------------------------- */}
      {analytics && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Токени за 7 днів */}
          <div className="lg:col-span-8 relative overflow-hidden p-5 rounded-2xl nm-outset">
            <h3 className="text-sm font-bold text-[var(--on-surface)] flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-[var(--primary)]" /> Токени чат-сесій за 7 днів
            </h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.velocity_7d}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                  <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }}
                    formatter={(value: any, name: any) => [Number(value).toLocaleString(), name === 'tokens' ? 'токенів' : 'витрати ($)']}
                  />
                  <Bar dataKey="tokens" radius={[6, 6, 0, 0]}>
                    {analytics.velocity_7d.map((v, i) => (
                      <Cell key={i} fill={v.isPeak ? '#f59e0b' : 'rgba(245,158,11,0.45)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-6 mt-4 text-xs text-[var(--on-surface-variant)]">
              <span className="flex items-center gap-1.5"><Coins className="w-3.5 h-3.5 text-[var(--primary)]" /> Всього токенів: <b>{analytics.total_tokens.toLocaleString()}</b></span>
              <span>Сесій: <b>{analytics.active_sessions_count}</b></span>
              <span>Середня вартість сесії: <b>${analytics.avg_cost_per_session.toFixed(4)}</b></span>
              <span>Рівень помилок: <b>{analytics.error_rate.toFixed(2)}%</b></span>
            </div>
          </div>

          {/* Розподіл витрат за моделями */}
          <div className="lg:col-span-4 relative overflow-hidden p-5 rounded-2xl nm-outset">
            <h3 className="text-sm font-bold text-[var(--on-surface)] mb-4">Витрати за моделями</h3>
            {analytics.cost_distribution.length === 0 ? (
              <p className="text-xs text-[var(--outline)]">Даних ще немає.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={analytics.cost_distribution} dataKey="cost" nameKey="model" innerRadius={38} outerRadius={62} paddingAngle={2}>
                        {analytics.cost_distribution.map((_, i) => (
                          <Cell key={i} fill={PROVIDER_COLORS[i % PROVIDER_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }}
                        formatter={(value: any, _name: any, item: any) => [`$${Number(value).toFixed(4)}`, item?.payload?.model]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {analytics.cost_distribution.map((d, i) => (
                    <div key={d.model} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PROVIDER_COLORS[i % PROVIDER_COLORS.length] }} />
                      <span className="text-[var(--on-surface-variant)] truncate flex-1">{d.model}</span>
                      <span className="text-[var(--outline)] font-mono">${d.cost.toFixed(4)}</span>
                      <span className="text-[var(--outline)] font-mono w-9 text-right">{d.percentage.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Сесії чату — сайдбар-подібна панель з можливістю додати/видалити (як у чаті, п.4 плану) */}
          <div className="lg:col-span-12 relative overflow-hidden p-5 rounded-2xl nm-outset">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-bold text-[var(--on-surface)]">Сесії чату ({sessions.length})</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={createTestSession}
                  disabled={creatingSession}
                  className="px-3 py-1.5 rounded-lg nm-btn-primary text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
                >
                  {creatingSession ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Нова тестова сесія
                </button>
                <button onClick={exportCsv} className="px-3 py-1.5 rounded-lg nm-btn text-[var(--on-surface)] text-[11px] font-bold flex items-center gap-1.5">
                  <Download className="w-3 h-3" /> Експорт CSV
                </button>
              </div>
            </div>
            {sessions.length === 0 ? (
              <p className="text-xs text-[var(--outline)]">Чат-сесій ще немає.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[var(--outline)] text-left border-b border-[var(--border-subtle)]">
                      <th className="py-2 pr-3 font-semibold">Назва</th>
                      <th className="py-2 pr-3 font-semibold">Модель</th>
                      <th className="py-2 pr-3 font-semibold text-right">Токени</th>
                      <th className="py-2 pr-3 font-semibold text-right">Вартість</th>
                      <th className="py-2 pr-3 font-semibold text-right">Оновлено</th>
                      <th className="py-2 font-semibold text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.slice(0, 50).map((s) => (
                      <tr key={s.id} className="border-b border-[var(--border-subtle)] text-[var(--on-surface-variant)]">
                        <td className="py-2 pr-3 max-w-[220px] truncate">{s.title}</td>
                        <td className="py-2 pr-3 font-mono text-[var(--outline)]">{s.model}</td>
                        <td className="py-2 pr-3 text-right font-mono">{s.total_tokens.toLocaleString()}</td>
                        <td className="py-2 pr-3 text-right font-mono">${s.total_cost.toFixed(4)}</td>
                        <td className="py-2 pr-3 text-right text-[var(--outline)]">{new Date(s.updated_at).toLocaleDateString('uk-UA')}</td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => deleteSession(s.id)}
                            disabled={deletingSessionId === s.id}
                            title="Видалити сесію"
                            className="nm-btn p-1.5 rounded-lg text-rose-400 disabled:opacity-50"
                          >
                            {deletingSessionId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          </button>
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
    </div>
  );
};
