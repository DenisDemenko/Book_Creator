/**
 * Вкладка «Аналітика ринку Etsy» — клієнт модуля King Market Intelligence
 * (ТЗ `TZ_King_Market_Intelligence_Etsy_v1_0.docx`, розділи 4–13, 25, 28).
 *
 * ГОЛОВНЕ, ЩО ЦЕЙ ЕКРАН МУСИТЬ ПЕРЕДАТИ. Etsy Open API v3 у цьому середовищі
 * не підключений (немає ETSY_API_KEY), і за рішенням власника джерелом даних
 * є модель із реєстру ядра. Тому жодне число тут не є фактом про конкретний
 * лістинг Etsy — це оцінка за знаннями моделі. Автор, який прийме ці цифри
 * за дані Etsy, ухвалить реальні рішення про закупівлю на вигаданих числах,
 * тож застереження стоїть банером НАД таблицею (ТЗ 25), кожен рядок несе
 * власну позначку `VERIFIED / CALCULATED / ESTIMATED / UNAVAILABLE`, а все,
 * що має форму продажів, супроводжується буквальним маркером
 * «ESTIMATED / NOT ACTUAL ETSY SALES» (ТЗ 10). Пом'якшувати ці формулювання
 * не можна — вони і є функція, а не оформлення.
 *
 * ЧОМУ РОЗКЛАДКА OPPORTUNITY SCORE — ЦЕНТРАЛЬНА ВЗАЄМОДІЯ. ТЗ 28 вимагає, щоб
 * бал «відтворювався з видимих компонентів і ваг». Один бал 0–100 без
 * розкладки — це та сама вигадка, тільки коротша: за ним не видно, що
 * половина компонентів була відсутня й узята нейтральною. Тому клік по балу
 * розкриває таблицю доданків із сирим значенням, вагою, внеском і поясненням
 * `basisUk`, а компоненти зі списку `missing` названі окремо.
 *
 * Уся логіка — на сервері (`/api/market/*`). Тут немає ані ключів, ані ваг за
 * замовчуванням, ані формули: ваги приходять зі звіту, доступні моделі — з
 * `/api/market/settings`. Це те саме рішення, що й у PublishingHubView.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  ChevronDown,
  Crown,
  Download,
  ExternalLink,
  HelpCircle,
  Info,
  LineChart,
  Loader2,
  Lock,
  Minus,
  RefreshCw,
  Languages,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { FeeCalculatorView } from './etsy/FeeCalculatorView';
import { SeoTranslationsTab } from './etsy/SeoTranslationsTab';
import type { AuthUser } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { usePlanAccess } from '../hooks/usePlanAccess';
import type {
  FieldStatus,
  MarketReport,
  MarketReportItem,
  ScoreComponent,
  ScoreWeights,
} from '../../server/market/marketTypes';

interface MarketIntelligenceViewProps {
  authUser: AuthUser | null;
  onGoToSubscription?: () => void;
}

/** Модель зі списку `/api/market/settings`. */
interface MarketModelOption {
  id: string;
  label: string;
  provider: string;
  engine: string;
  /** false — ключ провайдера не введений; вибрати можна, але скринінг впаде. */
  configured: boolean;
}

interface MarketSettings {
  weights: ScoreWeights;
  modelId: string | null;
  availableModels: MarketModelOption[];
  source: 'ai_screen' | 'etsy_api';
}

interface TopicRow {
  topicKey: string;
  topic: string;
  collectedAt: string;
  itemCount: number;
}

/** Помилка з розібраним тілом відповіді — щоб розрізняти `kind` сервера. */
interface ApiError extends Error {
  status?: number;
  payload?: {
    error?: string;
    kind?: 'plan_required' | 'bad_model_output' | string;
    requiredPlans?: string[];
    currentPlan?: string;
  } | null;
}

const COUNT_OPTIONS = [5, 10, 15, 20, 30];

const inputClass =
  'w-full rounded-lg bg-slate-900/70 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error: ApiError = new Error(data?.error || `Помилка ${res.status}`);
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data as T;
}

// ===========================================================================
// Позначки походження (ТЗ 25)
// ===========================================================================

const STATUS_CLASS: Record<FieldStatus, string> = {
  VERIFIED: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
  CALCULATED: 'bg-sky-500/15 border-sky-500/40 text-sky-300',
  ESTIMATED: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
  UNAVAILABLE: 'bg-slate-700/40 border-slate-600 text-slate-400',
};

const STATUS_HINT_KEY: Record<FieldStatus, string> = {
  VERIFIED: 'marketIntel.provVerifiedHint',
  CALCULATED: 'marketIntel.provCalculatedHint',
  ESTIMATED: 'marketIntel.provEstimatedHint',
  UNAVAILABLE: 'marketIntel.provUnavailableHint',
};

const STATUS_LABEL_KEY: Record<FieldStatus, string> = {
  VERIFIED: 'marketIntel.provVerified',
  CALCULATED: 'marketIntel.provCalculated',
  ESTIMATED: 'marketIntel.provEstimated',
  UNAVAILABLE: 'marketIntel.provUnavailable',
};

const ProvenanceBadge: React.FC<{ status: FieldStatus; confidence?: number }> = ({ status, confidence }) => {
  const { t } = useLanguage();
  const hint =
    typeof confidence === 'number'
      ? `${t(STATUS_HINT_KEY[status])} ${t('marketIntel.provConfidence', { n: Math.round(confidence * 100) })}`
      : t(STATUS_HINT_KEY[status]);
  return (
    <span
      title={hint}
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-mono font-bold leading-none tracking-wide ${STATUS_CLASS[status]}`}
    >
      {t(STATUS_LABEL_KEY[status])}
    </span>
  );
};

/**
 * Значення, якого джерело не дало, показується прочерком із підказкою, а не
 * нулем: нуль — це теж число, і його автор прочитає як «відгуків немає»,
 * тоді як насправді ми просто не знаємо (ТЗ 2, 25, 28).
 */
const Unavailable: React.FC = () => {
  const { t } = useLanguage();
  return (
    <span title={t('marketIntel.unavailableTooltip')} className="text-slate-600 cursor-help border-b border-dotted border-slate-700">
      —
    </span>
  );
};

// ===========================================================================
// Динаміка (ТЗ 9). «unknown» навмисно не схожий на «stable».
// ===========================================================================

const TrendCell: React.FC<{ item: MarketReportItem }> = ({ item }) => {
  const { t } = useLanguage();
  const { trend, snapshotCount, daysBetween } = item.dynamics;
  const meta =
    daysBetween !== null
      ? t('marketIntel.trendMeta', { snapshots: snapshotCount, days: daysBetween })
      : '';

  if (trend === 'unknown') {
    // Пунктирна рамка й знак питання: «ми не знаємо» має виглядати інакше,
    // ніж «не змінилось», бо це різні факти.
    return (
      <span
        title={t('marketIntel.trendUnknownHint')}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-600 bg-slate-800/40 px-2 py-0.5 text-xs text-slate-400 cursor-help"
      >
        <HelpCircle className="w-3.5 h-3.5" /> {t('marketIntel.trendUnknown')}
      </span>
    );
  }
  if (trend === 'rising') {
    return (
      <span title={meta} className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
        <ArrowUpRight className="w-3.5 h-3.5" /> {t('marketIntel.trendRising')}
      </span>
    );
  }
  if (trend === 'declining') {
    return (
      <span title={meta} className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-300">
        <ArrowDownRight className="w-3.5 h-3.5" /> {t('marketIntel.trendDeclining')}
      </span>
    );
  }
  return (
    <span
      title={`${t('marketIntel.trendStableHint')} ${meta}`}
      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300"
    >
      <Minus className="w-3.5 h-3.5" /> {t('marketIntel.trendStable')}
    </span>
  );
};

// ===========================================================================
// Розкладка Opportunity Score (ТЗ 11, 28)
// ===========================================================================

const COMPONENT_LABEL_KEY: Record<ScoreComponent, string> = {
  demand: 'marketIntel.compDemand',
  growth: 'marketIntel.compGrowth',
  competition: 'marketIntel.compCompetition',
  pricePotential: 'marketIntel.compPricePotential',
  engagement: 'marketIntel.compEngagement',
  saturation: 'marketIntel.compSaturation',
  margin: 'marketIntel.compMargin',
};

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';
  if (score >= 40) return 'text-amber-300 border-amber-500/40 bg-amber-500/10';
  return 'text-rose-300 border-rose-500/40 bg-rose-500/10';
}

const ScoreBreakdown: React.FC<{ item: MarketReportItem }> = ({ item }) => {
  const { t } = useLanguage();
  const { breakdown, missing, score } = item.opportunity;
  const totalContribution = breakdown.reduce((sum, part) => sum + part.contribution, 0);

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4 space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-cyan-400" /> {t('marketIntel.breakdownTitle')}
        </h4>
        <p className="text-xs text-slate-500 mt-1">{t('marketIntel.breakdownHint')}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="text-left py-1.5 pr-3">{t('marketIntel.bdComponent')}</th>
              <th className="text-right py-1.5 px-3">{t('marketIntel.bdRaw')}</th>
              <th className="text-right py-1.5 px-3">{t('marketIntel.bdWeight')}</th>
              <th className="text-right py-1.5 px-3">{t('marketIntel.bdContribution')}</th>
              <th className="text-left py-1.5 pl-3">{t('marketIntel.bdBasis')}</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((part) => {
              const isMissing = missing.includes(part.component);
              return (
                <tr key={part.component} className="border-t border-slate-800">
                  <td className={`py-1.5 pr-3 ${isMissing ? 'text-slate-500 italic' : 'text-slate-200'}`}>
                    {t(COMPONENT_LABEL_KEY[part.component])}
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono text-slate-300">{part.raw.toFixed(1)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-slate-500">{part.weight}%</td>
                  <td className="py-1.5 px-3 text-right font-mono text-cyan-300">{part.contribution.toFixed(2)}</td>
                  <td className="py-1.5 pl-3 text-slate-400">{part.basisUk}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-700">
              <td className="py-1.5 pr-3 font-semibold text-slate-200">{t('marketIntel.bdTotal')}</td>
              <td />
              <td />
              <td className="py-1.5 px-3 text-right font-mono font-bold text-cyan-200">
                {totalContribution.toFixed(2)} → {score}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {missing.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <p className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> {t('marketIntel.bdMissingTitle')}
          </p>
          <p className="mt-1">
            {missing.map((component) => t(COMPONENT_LABEL_KEY[component])).join(', ')} — {t('marketIntel.bdMissingNote')}
          </p>
        </div>
      )}

      <DynamicsAndSales item={item} />
    </div>
  );
};

/** Динаміка й оцінна швидкість продажів — обидві розкриваються разом із балом. */
const DynamicsAndSales: React.FC<{ item: MarketReportItem }> = ({ item }) => {
  const { t } = useLanguage();
  const { dynamics, salesVelocity } = item;

  const rows: Array<[string, string | number | null]> = [
    [t('marketIntel.dynReviewGrowth'), dynamics.reviewGrowth],
    [t('marketIntel.dynReviewVelocity'), dynamics.reviewVelocity !== null ? dynamics.reviewVelocity.toFixed(2) : null],
    [
      t('marketIntel.dynPriceChange'),
      dynamics.priceChange !== null
        ? `${dynamics.priceChange > 0 ? '+' : ''}${dynamics.priceChange.toFixed(2)} $`
        : null,
    ],
    [t('marketIntel.dynFavoriteGrowth'), dynamics.favoriteGrowth],
    [t('marketIntel.dynSnapshots'), dynamics.snapshotCount],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-700/50 bg-slate-950/50 p-3">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
          {t('marketIntel.dynamicsTitle')}
        </h5>
        <ul className="space-y-1 text-xs">
          {rows.map(([label, value]) => (
            <li key={label} className="flex justify-between gap-3 border-b border-slate-800/60 py-1 last:border-0">
              <span className="text-slate-500">{label}</span>
              <span className="font-mono text-slate-200">
                {value === null || value === undefined ? <Unavailable /> : value}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/*
        Оцінна швидкість продажів. ТЗ 10 вимагає буквальний маркер поруч і
        текст дисклеймера з самого поля, а не з нашої вигадки, — тому
        `salesVelocity.disclaimerUk` показується як є.
      */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-3">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-amber-300 mb-2 flex items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5" /> {t('marketIntel.salesTitle')}
        </h5>
        <p className="inline-block rounded border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-[10px] font-mono font-bold tracking-wide text-rose-200">
          {t('marketIntel.salesMarker')}
        </p>
        <ul className="space-y-1 text-xs mt-2">
          <li className="flex justify-between gap-3 border-b border-slate-800/60 py-1">
            <span className="text-slate-500">{t('marketIntel.salesMonthly')}</span>
            <span className="font-mono text-amber-200">
              {salesVelocity.estimatedMonthly === null ? <Unavailable /> : `≈ ${salesVelocity.estimatedMonthly}`}
            </span>
          </li>
          <li className="flex justify-between gap-3 py-1">
            <span className="text-slate-500">{t('marketIntel.salesRatio')}</span>
            <span className="font-mono text-slate-300">{salesVelocity.reviewToSaleRatio}</span>
          </li>
        </ul>
        <p className="text-[11px] text-amber-200/90 mt-2">{salesVelocity.disclaimerUk}</p>
      </div>
    </div>
  );
};

// ===========================================================================
// CSV (ТЗ 28: «Дані можна експортувати CSV/XLSX»)
// ===========================================================================

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Вивантаження без сторонньої бібліотеки. Позначки походження йдуть у файл
 * окремими колонками: звіт, вийнятий у таблицю, не має втрачати те, що
 * робить його чесним.
 */
function downloadReportCsv(report: MarketReport): void {
  const header = [
    'title',
    'shop',
    'url',
    'price_usd',
    'currency',
    'rating',
    'review_count',
    'favorers',
    'popularity',
    'trend',
    'opportunity_score',
    'estimated_monthly_sales_NOT_ACTUAL_ETSY_SALES',
    'provenance_source',
    'provenance_status',
    'provenance_confidence',
    'unavailable_fields',
  ];
  const lines = [header.join(',')];
  for (const item of report.items) {
    const listing = item.listing;
    lines.push(
      [
        listing.title,
        listing.shopName,
        listing.url,
        listing.priceUsd,
        listing.currency,
        listing.rating,
        listing.reviewCount,
        listing.favorers,
        item.popularity,
        item.dynamics.trend,
        item.opportunity.score,
        item.salesVelocity.estimatedMonthly,
        listing.provenance.source,
        listing.provenance.status,
        listing.provenance.confidence,
        listing.provenance.unavailable.join(' '),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  lines.push('');
  lines.push(csvCell(report.disclaimerUk));

  // BOM — інакше Excel відкриє кирилицю кракозябрами.
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `market-${report.topicKey || 'report'}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ===========================================================================
// Екран
// ===========================================================================

export const MarketIntelligenceView: React.FC<MarketIntelligenceViewProps> = ({ authUser, onGoToSubscription }) => {
  const { t, lang: uiLang } = useLanguage();
  const access = usePlanAccess(authUser, ['pro', 'ultra']);

  /**
   * Вкладки сторінки. Скринінг лишається першим і за замовчуванням: це
   * єдина вкладка, яка витрачає гроші на модель, і саме заради неї автор
   * сюди заходить. Дві інші рахують за формулами й працюють без мережі —
   * калькулятор комісій Etsy та SEO-переклади, — тож вони не мають
   * потребувати ані звіту, ані попереднього скринінгу.
   */
  const [tab, setTab] = useState<'screen' | 'fees' | 'seo'>('screen');

  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(10);
  const [modelId, setModelId] = useState('');
  const [force, setForce] = useState(false);

  const [settings, setSettings] = useState<MarketSettings | null>(null);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [report, setReport] = useState<MarketReport | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** true — модель віддала не JSON (502 bad_model_output). Мовчки не повторюємо. */
  const [badModel, setBadModel] = useState(false);
  const [openScoreKey, setOpenScoreKey] = useState<string | null>(null);

  const canLoad = access.isRegistered && access.hasAccess && !access.loading;

  const loadTopics = useCallback(() => {
    api<{ topics: TopicRow[] }>('/api/market/topics')
      .then((data) => setTopics(data.topics || []))
      .catch(() => setTopics([]));
  }, []);

  useEffect(() => {
    if (!canLoad) return;
    api<MarketSettings>('/api/market/settings')
      .then((data) => {
        setSettings(data);
        setModelId((current) => current || data.modelId || '');
      })
      .catch(() => setSettings(null));
    loadTopics();
  }, [canLoad, loadTopics]);

  /** Перетворює помилку сервера на людський текст із урахуванням `kind`. */
  const applyError = useCallback(
    (err: ApiError) => {
      const kind = err.payload?.kind;
      if (kind === 'bad_model_output') {
        setBadModel(true);
        setError(null);
        return;
      }
      setBadModel(false);
      if (kind === 'plan_required') {
        setError(
          t('marketIntel.errPlanRequired', {
            plans: (err.payload?.requiredPlans || []).join(' / ') || 'Pro / Ultra',
            current: err.payload?.currentPlan || t('marketIntel.freePlanName'),
          })
        );
        return;
      }
      setError(err.message);
    },
    [t]
  );

  const runScreen = useCallback(async () => {
    const trimmed = topic.trim();
    if (!trimmed) {
      setError(t('marketIntel.errNoTopic'));
      return;
    }
    setBusy(true);
    setError(null);
    setBadModel(false);
    setOpenScoreKey(null);
    try {
      const data = await api<{ report: MarketReport; fromCache: boolean; cachedAt?: string }>('/api/market/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: trimmed,
          count,
          modelId: modelId || undefined,
          force: force || undefined,
        }),
      });
      setReport(data.report);
      setCachedAt(data.fromCache ? data.cachedAt || data.report.collectedAt : null);
      loadTopics();
    } catch (err) {
      applyError(err as ApiError);
      setReport(null);
      setCachedAt(null);
    } finally {
      setBusy(false);
    }
  }, [topic, count, modelId, force, applyError, loadTopics, t]);

  const openSavedTopic = useCallback(
    async (row: TopicRow) => {
      setTopic(row.topic);
      setBusy(true);
      setError(null);
      setBadModel(false);
      setOpenScoreKey(null);
      try {
        const data = await api<{ report: MarketReport | null }>(
          `/api/market/report?topic=${encodeURIComponent(row.topic)}`
        );
        setReport(data.report);
        setCachedAt(data.report ? data.report.collectedAt : null);
      } catch (err) {
        applyError(err as ApiError);
      } finally {
        setBusy(false);
      }
    },
    [applyError]
  );

  const sortedItems = useMemo(
    () => (report ? [...report.items].sort((a, b) => b.opportunity.score - a.opportunity.score) : []),
    [report]
  );

  const locale = uiLang === 'en' ? 'en-GB' : 'uk-UA';
  const money = (value: number | null | undefined) =>
    value === null || value === undefined ? <Unavailable /> : `$${value.toFixed(2)}`;

  // --- Гейт «зареєстрований / перевіряємо / тариф» (як у NarrationView) ---

  if (!access.isRegistered) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-6 lg:p-8">
        <div className="p-6 rounded-2xl glass-panel space-y-3 text-center max-w-md mx-auto mt-10">
          <Lock className="w-8 h-8 text-slate-500 mx-auto" />
          <h3 className="text-sm font-bold text-slate-100">{t('marketIntel.needRegHeading')}</h3>
          <p className="text-xs text-slate-400">{t('marketIntel.needRegDesc')}</p>
        </div>
      </div>
    );
  }

  if (access.loading) {
    return <div className="flex-1 p-10 text-center text-sm text-slate-400">{t('marketIntel.checkingPlan')}</div>;
  }

  if (!access.hasAccess) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-6 lg:p-8">
        <div className="p-6 rounded-2xl glass-panel space-y-3 text-center max-w-md mx-auto mt-10">
          <Crown className="w-8 h-8 text-amber-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-100">{t('marketIntel.upgradeHeading')}</h3>
          <p className="text-xs text-slate-400">
            {t('marketIntel.upgradeDesc', {
              plan: (uiLang === 'en' ? access.planNameEn : access.planNameUk) || t('marketIntel.freePlanName'),
            })}
          </p>
          {onGoToSubscription && (
            <button
              onClick={onGoToSubscription}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-md transition-all"
            >
              {t('marketIntel.viewPlans')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const aggregate = report?.aggregate;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100 flex items-center gap-2">
            <LineChart className="w-6 h-6 text-cyan-400" /> {t('marketIntel.heading')}
          </h1>
          <p className="text-slate-400 text-sm mt-1">{t('marketIntel.intro')}</p>
        </header>

        {/*
          Панель вкладок у мові студії (slate + бірюза), а не в склі набору:
          вона належить сторінці, а не перенесеному набору. Скляні поверхні
          починаються всередині вкладок, під обгорткою `.etsy-kit`.
        */}
        <nav className="flex flex-wrap gap-1 rounded-xl border border-slate-700/50 bg-slate-900/50 p-1">
          {(
            [
              { id: 'screen' as const, label: t('marketIntel.tabScreen'), icon: LineChart },
              { id: 'fees' as const, label: t('marketIntel.tabFees'), icon: Calculator },
              { id: 'seo' as const, label: t('marketIntel.tabSeo'), icon: Languages },
            ]
          ).map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/40'
                    : 'border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {tab === 'fees' && (
          <div className="etsy-kit">
            <FeeCalculatorView />
          </div>
        )}

        {/*
          SEO-вкладка отримує не порожній список, а ключові слова останнього
          скринінгу: словник перекладає саме те, що модуль щойно знайшов у
          ніші. Без звіту список порожній — і вкладка чесно показує це,
          замість підставляти демонстраційні теги, як робив вихідний набір.
        */}
        {tab === 'seo' && (
          <div className="etsy-kit">
            <SeoTranslationsTab currentTags={report?.keywordCandidates.map((c) => c.phrase) ?? []} />
          </div>
        )}

        {tab === 'screen' && (
          <>
        {/*
          Постійний банер походження. Стоїть НАД усім, а не під таблицею, і не
          згортається: його завдання — бути прочитаним ДО того, як автор
          побудує на цих числах рішення про закупівлю (ТЗ 25).
        */}
        <section className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
          <h2 className="text-sm font-bold text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {t('marketIntel.disclaimerHeading')}
          </h2>
          <p className="text-xs text-amber-100/90 mt-2 leading-relaxed">
            {report?.disclaimerUk ||
              'Дані зібрані мовною моделлю, а не з Etsy Open API. Це ОЦІНКА ринку за знаннями моделі, а не факти про конкретні лістинги Etsy: ціни, кількість відгуків і рейтинги можуть не відповідати дійсним. Не приймайте рішень про закупівлю чи ціноутворення лише за цими числами — звіряйте з Etsy вручну або підключіть офіційний API (ETSY_API_KEY).'}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-200">
              {settings?.source === 'etsy_api' ? t('marketIntel.sourceEtsy') : t('marketIntel.sourceAi')}
            </span>
            {report?.modelId && (
              <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-0.5 text-[11px] text-slate-300">
                {t('marketIntel.modelUsed', { model: report.modelId })}
              </span>
            )}
            {report && <ProvenanceBadge status={report.provenance.status} confidence={report.provenance.confidence} />}
          </div>
        </section>

        {/* --- Пошук (ТЗ 6) --- */}
        <section className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Search className="w-4 h-4 text-cyan-400" /> {t('marketIntel.searchTitle')}
          </h2>

          <div className="grid gap-4 lg:grid-cols-[2fr_auto_2fr]">
            <label className="block">
              <span className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                {t('marketIntel.topicLabel')}
              </span>
              <input
                className={inputClass}
                value={topic}
                placeholder={t('marketIntel.topicPlaceholder')}
                onChange={(event) => setTopic(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && !busy && runScreen()}
              />
            </label>

            <label className="block">
              <span className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                {t('marketIntel.countLabel')}
              </span>
              <select className={inputClass} value={count} onChange={(event) => setCount(Number(event.target.value))}>
                {COUNT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                {t('marketIntel.modelLabel')}
              </span>
              <select className={inputClass} value={modelId} onChange={(event) => setModelId(event.target.value)}>
                <option value="">{t('marketIntel.modelDefault')}</option>
                {(settings?.availableModels || []).map((model) => (
                  <option
                    key={model.id}
                    value={model.id}
                    disabled={!model.configured}
                    className={model.configured ? '' : 'text-slate-600'}
                  >
                    {model.label} · {model.provider}
                    {model.configured ? '' : ` — ${t('marketIntel.modelNotConfigured')}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-slate-500">{t('marketIntel.topicHint')}</p>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300" title={t('marketIntel.forceHint')}>
              <input
                type="checkbox"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
                className="accent-cyan-500"
              />
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              {t('marketIntel.forceLabel')}
            </label>

            <button
              onClick={runScreen}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/20 border border-cyan-500/50 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {busy ? t('marketIntel.searching') : t('marketIntel.searchBtn')}
            </button>

            {report && (
              <button
                onClick={() => downloadReportCsv(report)}
                title={t('marketIntel.exportHint')}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-cyan-500"
              >
                <Download className="w-4 h-4" /> {t('marketIntel.exportCsv')}
              </button>
            )}
          </div>

          {/* Раніше зібрані теми — вхід у збережений звіт без нового виклику моделі. */}
          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-slate-500">{t('marketIntel.recentTitle')}</p>
              <button onClick={loadTopics} className="text-slate-500 hover:text-slate-300" title={t('marketIntel.refreshTopics')}>
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            {topics.length === 0 ? (
              <p className="text-xs text-slate-600 mt-2">{t('marketIntel.recentEmpty')}</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-2">
                {topics.map((row) => (
                  <button
                    key={row.topicKey}
                    onClick={() => openSavedTopic(row)}
                    title={t('marketIntel.recentMeta', {
                      count: row.itemCount,
                      date: new Date(row.collectedAt).toLocaleString(locale),
                    })}
                    className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs text-slate-300 hover:border-cyan-500 hover:text-cyan-200"
                  >
                    {row.topic}
                    <span className="text-slate-600"> · {row.itemCount}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* --- Помилки --- */}
        {badModel && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t('marketIntel.errBadModel')}</span>
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {cachedAt && (
          <p className="text-xs text-slate-500 flex items-center gap-2">
            <Info className="w-3.5 h-3.5" />
            {t('marketIntel.fromCache', { date: new Date(cachedAt).toLocaleString(locale) })}
          </p>
        )}

        {!report && !busy && !error && !badModel && (
          <p className="text-sm text-slate-500 text-center py-10">{t('marketIntel.emptyReport')}</p>
        )}

        {/* --- Зведення по ніші (ТЗ 5) --- */}
        {report && aggregate && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">{t('marketIntel.aggregateTitle')}</h2>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
              {(
                [
                  [t('marketIntel.aggCount'), String(aggregate.itemCount), 'text-slate-100'],
                  [
                    t('marketIntel.aggAvgPrice'),
                    aggregate.avgPriceUsd === null ? null : `$${aggregate.avgPriceUsd.toFixed(2)}`,
                    'text-slate-100',
                  ],
                  [
                    t('marketIntel.aggMedianPrice'),
                    aggregate.medianPriceUsd === null ? null : `$${aggregate.medianPriceUsd.toFixed(2)}`,
                    'text-slate-100',
                  ],
                  [
                    t('marketIntel.aggPriceRange'),
                    aggregate.minPriceUsd === null || aggregate.maxPriceUsd === null
                      ? null
                      : `$${aggregate.minPriceUsd.toFixed(0)}–$${aggregate.maxPriceUsd.toFixed(0)}`,
                    'text-slate-100',
                  ],
                  [
                    t('marketIntel.aggAvgReviews'),
                    aggregate.avgReviewCount === null ? null : String(Math.round(aggregate.avgReviewCount)),
                    'text-slate-100',
                  ],
                  [
                    t('marketIntel.aggAvgOpportunity'),
                    aggregate.avgOpportunity === null ? null : String(Math.round(aggregate.avgOpportunity)),
                    'text-cyan-300',
                  ],
                  [t('marketIntel.aggRising'), String(aggregate.risingCount), 'text-emerald-300'],
                  [t('marketIntel.aggDeclining'), String(aggregate.decliningCount), 'text-rose-300'],
                  [t('marketIntel.aggNew'), String(aggregate.newCount), 'text-sky-300'],
                ] as Array<[string, string | null, string]>
              ).map(([label, value, tone]) => (
                <div key={label} className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
                  <div className={`text-lg font-semibold ${tone}`}>{value === null ? <Unavailable /> : value}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* --- Таблиця товарів (ТЗ 7, 11) --- */}
        {report && (
          <section className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">{t('marketIntel.tableTitle')}</h2>
              <p className="text-xs text-slate-500 mt-1">{t('marketIntel.tableHint')}</p>
            </div>

            {sortedItems.length === 0 ? (
              <p className="text-sm text-slate-500">{t('marketIntel.noItems')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="text-left py-2 pr-3">{t('marketIntel.colTitle')}</th>
                      <th className="text-left py-2 px-3">{t('marketIntel.colShop')}</th>
                      <th className="text-right py-2 px-3">{t('marketIntel.colPrice')}</th>
                      <th className="text-right py-2 px-3">{t('marketIntel.colRating')}</th>
                      <th className="text-right py-2 px-3">{t('marketIntel.colPopularity')}</th>
                      <th className="text-left py-2 px-3">{t('marketIntel.colTrend')}</th>
                      <th className="text-right py-2 pl-3">{t('marketIntel.colScore')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((item) => {
                      const listing = item.listing;
                      const missingField = (field: string) => listing.provenance.unavailable.includes(field);
                      const isOpen = openScoreKey === listing.productKey;
                      return (
                        <React.Fragment key={listing.productKey}>
                          <tr className="border-t border-slate-800 align-top">
                            <td className="py-2 pr-3 max-w-[22rem]">
                              <div className="flex items-start gap-2">
                                <span className="text-slate-200">{listing.title}</span>
                                {listing.url && (
                                  <a
                                    href={listing.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={t('marketIntel.openUrl')}
                                    className="text-slate-500 hover:text-cyan-300 shrink-0 mt-0.5"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                              <div className="mt-1">
                                <ProvenanceBadge
                                  status={listing.provenance.status}
                                  confidence={listing.provenance.confidence}
                                />
                              </div>
                            </td>
                            <td className="py-2 px-3 text-slate-400">
                              {missingField('shopName') || !listing.shopName ? <Unavailable /> : listing.shopName}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-300">
                              {missingField('priceUsd') ? <Unavailable /> : money(listing.priceUsd)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-400">
                              {missingField('rating') || listing.rating === null ? (
                                <Unavailable />
                              ) : (
                                listing.rating.toFixed(1)
                              )}
                              <span className="text-slate-600"> / </span>
                              {missingField('reviewCount') || listing.reviewCount === null ? (
                                <Unavailable />
                              ) : (
                                listing.reviewCount
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-300">{item.popularity}</td>
                            <td className="py-2 px-3">
                              <TrendCell item={item} />
                            </td>
                            <td className="py-2 pl-3 text-right">
                              {/*
                                Бал — не число, а кнопка: ТЗ 28 вимагає, щоб він
                                відтворювався з видимих компонентів і ваг.
                              */}
                              <button
                                onClick={() => setOpenScoreKey(isOpen ? null : listing.productKey)}
                                aria-expanded={isOpen}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono font-bold hover:brightness-125 transition ${scoreColor(
                                  item.opportunity.score
                                )}`}
                              >
                                {item.opportunity.score}
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                              </button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="border-t border-slate-800/60">
                              <td colSpan={7} className="py-3">
                                <ScoreBreakdown item={item} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* --- Ключові слова-кандидати (ТЗ 13) --- */}
        {report && (
          <section className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">{t('marketIntel.keywordsTitle')}</h2>
            {report.keywordCandidates.length === 0 ? (
              <p className="text-sm text-slate-500">{t('marketIntel.keywordsEmpty')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {report.keywordCandidates.map((candidate) => (
                  <span
                    key={candidate.phrase}
                    title={t('marketIntel.keywordListings', { n: candidate.listings })}
                    className="rounded-full bg-slate-800 border border-slate-700 px-3 py-1 text-xs text-slate-200"
                  >
                    {candidate.phrase}
                    <span className="text-slate-500"> · {candidate.listings}</span>
                    <span className="text-cyan-400/80"> · {Math.round(candidate.score)}</span>
                  </span>
                ))}
              </div>
            )}
          </section>
        )}
          </>
        )}
      </div>
    </div>
  );
};
