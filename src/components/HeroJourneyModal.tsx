import React, { useMemo, useState } from 'react';
import {
  X,
  Sparkles,
  RefreshCw,
  Loader2,
  Wand2,
  ChevronDown,
  ClipboardCopy,
  Download,
  Info,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import type { Book } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * Модалка «Шлях Героя» — конструктор сюжетної дуги за мономіфом Джозефа
 * Кемпбелла (14 вузлів). Три вкладки: Конструктор (13 кроків), Крива сюжету
 * (інтерактивний графік + повзунки) і Підсумок (діагностика + зведення).
 *
 * ШІ-синхронізація адресується ядру сайту: запит іде на /api/ai/
 * analyze-emotional-arc з modelId = поточний рушій книги (якщо обрано),
 * інакше сервер використовує свій активний дефолт.
 */

interface HeroJourneyModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  /** Поточний рушій книги (book.preferredAiModelId) — передається в ядро. */
  preferredAiModelId?: string;
  /** Людська назва поточного рушія для підпису «ШІ синхронізація». */
  currentModelLabel: string;
}

type Tab = 'constructor' | 'curve' | 'summary';

interface HeroStep {
  n: number;
  title: string;
  hint: string;
}

const HERO_STEPS: HeroStep[] = [
  { n: 1, title: 'Старий герой (Звичайний світ)', hint: 'Хто він до початку історії? Захисні маски та статус-кво.' },
  { n: 2, title: 'Внутрішня проблема (Прихована травма)', hint: 'Глибинна тріщина в душі, яку герой приховує.' },
  { n: 3, title: 'Поклик до пригод', hint: 'Що вириває героя зі звичного ритму?' },
  { n: 4, title: 'Страх і відмова від поклику', hint: 'Чому герой спочатку відкидає шанс на зміни?' },
  { n: 5, title: 'Зустріч з наставником', hint: 'Хто дає герою ключ, знання або компас?' },
  { n: 6, title: 'Перетин першого порогу', hint: 'Момент, після якого назад дороги немає.' },
  { n: 7, title: 'Випробування, союзники та вороги', hint: 'Перші перешкоди нового світу.' },
  { n: 8, title: 'Наближення до найглибшої печери', hint: 'Підготовка до головного випробування.' },
  { n: 9, title: 'Найглибша криза', hint: 'Символічна смерть старого «я».' },
  { n: 10, title: 'Нагорода (оволодіння мечем)', hint: 'Що герой здобуває після кризи?' },
  { n: 11, title: 'Дорога назад', hint: 'Повернення, яке несе нові перешкоди.' },
  { n: 12, title: 'Воскресіння та катарсис', hint: 'Останнє очищення перед поверненням додому.' },
  { n: 13, title: 'Повернення з еліксиром', hint: 'Дар, який герой несе своєму світу.' },
];

/** Вузли емоційної кривої (14 точок): початкові значення валентності -10..+10. */
const DEFAULT_VALENCE = [0, 2.5, -3, 4, 5, 0, -6, 0, -7, -10, -2.5, -1, 3.5, 8] as const;

const NODE_NAMES = [
  'Звичайний світ',
  'Поклик до пригод',
  'Відмова від поклику',
  'Зустріч з наставником',
  'Перетин першого порогу',
  'Випробування та союзники',
  'Наближення до печери',
  'Головна підготовка',
  'Падіння в безодню',
  'Найглибша криза / Смерть',
  'Відродження та Нагорода',
  'Дорога назад',
  'Воскресіння / Катарсис',
  'Повернення з Еліксиром',
];

/** Ширина/висота SVG-поля (viewBox). */
const SVG_W = 1100;
const SVG_H = 420;
const NEUTRAL_Y = 210;
const Y_SCALE = 18; // 1 бал = 18px

/** x-координата вузла (рівномірно від 90 до 1000). */
function nodeX(i: number): number {
  return Math.round(90 + (910 * i) / 13);
}

function nodeY(valence: number): number {
  return Math.round(NEUTRAL_Y - Math.max(-10, Math.min(10, valence)) * Y_SCALE);
}

/** Плавна крива через точки (кубічні безьє з горизонтальними контрольними точками). */
function buildCurvePath(valences: number[]): string {
  const pts = valences.map((v, i) => ({ x: nodeX(i), y: nodeY(v) }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const cx = Math.round((prev.x + cur.x) / 2);
    d += ` C ${cx} ${prev.y}, ${cx} ${cur.y}, ${cur.x} ${cur.y}`;
  }
  return d;
}

function buildAreaPath(valences: number[]): string {
  return `${buildCurvePath(valences)} L ${nodeX(valences.length - 1)} ${NEUTRAL_Y} L ${nodeX(0)} ${NEUTRAL_Y} Z`;
}

function dotColor(v: number): string {
  if (v <= -7) return '#ef4444';
  if (v < -3) return '#dc2626';
  if (v < 0) return '#f59e0b';
  if (v < 4) return '#d99738';
  if (v < 7) return '#eab308';
  return '#4ade80';
}

export const HeroJourneyModal: React.FC<HeroJourneyModalProps> = ({
  isOpen,
  onClose,
  book,
  preferredAiModelId,
  currentModelLabel,
}) => {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('curve');
  const [valences, setValences] = useState<number[]>([...DEFAULT_VALENCE]);
  const [stepAnswers, setStepAnswers] = useState<Record<number, string>>({});
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set([1]));
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ arcName: string; description: string } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const filledCount = Object.values(stepAnswers).filter((v) => v.trim().length > 0).length;

  const setValence = (idx: number, value: number) => {
    setValences((prev) => {
      const next = [...prev];
      next[idx] = Math.max(-10, Math.min(10, value));
      return next;
    });
  };

  const toggleStep = (n: number) => {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const handleAiSync = async () => {
    setIsSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const outline = HERO_STEPS.map((s) => `${s.n}. ${s.title}: ${stepAnswers[s.n] || '—'}`).join('\n');
      const res = await fetch('/api/ai/analyze-emotional-arc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyOutline: outline,
          chaptersCount: 14,
          modelId: preferredAiModelId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'failed');
      setSyncResult({ arcName: data.arcName, description: data.description });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Не вдалося синхронізувати з ШІ.');
    } finally {
      setIsSyncing(false);
    }
  };

  const curvePath = useMemo(() => buildCurvePath(valences), [valences]);
  const areaPath = useMemo(() => buildAreaPath(valences), [valences]);

  const copyForMentor = async () => {
    const text = HERO_STEPS.map((s) => `${s.n}. ${s.title}: ${stepAnswers[s.n] || '—'}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard недоступний */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0b101c] border border-white/[0.08] rounded-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden shadow-2xl text-slate-200"
      >
        {/* Header */}
        <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-white/[0.08] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Wand2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">{t('editor.heroJourneyTitle')}</h2>
              <p className="text-xs text-slate-400">{t('editor.heroJourneySubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-white/10 text-xs text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {t('editor.heroJourneyFilled')} <strong className="text-amber-400">{filledCount}</strong> / {HERO_STEPS.length}
            </span>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="shrink-0 px-5 sm:px-6 pt-4 flex items-center gap-2 text-sm font-medium">
          {(['constructor', 'curve', 'summary'] as Tab[]).map((tb) => {
            const isActive = tab === tb;
            return (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={`px-4 py-2 rounded-t-lg transition-colors ${
                  isActive
                    ? 'bg-[#131b2e] border-t-2 border-x border-[#d99738] border-b-transparent text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tb === 'curve' && <span className="text-amber-400 mr-1">●</span>}
                {tb === 'constructor' && t('editor.heroJourneyTabConstructor')}
                {tb === 'curve' && t('editor.heroJourneyTabCurve')}
                {tb === 'summary' && t('editor.heroJourneyTabSummary')}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
          {tab === 'constructor' && (
            <div className="space-y-2.5">
              {HERO_STEPS.map((s) => (
                <div key={s.n} className="rounded-xl border border-[#1d293b] bg-[#0e141e] overflow-hidden">
                  <button
                    onClick={() => toggleStep(s.n)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left bg-[#121926]/50"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/25 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                        {String(s.n).padStart(2, '0')}
                      </span>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-200">{s.title}</h4>
                        <p className="text-xs text-slate-400">{s.hint}</p>
                      </div>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${openSteps.has(s.n) ? '' : '-rotate-90'}`} />
                  </button>
                  {openSteps.has(s.n) && (
                    <div className="p-4 pt-2 border-t border-[#182333]">
                      <textarea
                        value={stepAnswers[s.n] || ''}
                        onChange={(e) => setStepAnswers((prev) => ({ ...prev, [s.n]: e.target.value }))}
                        rows={3}
                        placeholder={t('editor.heroJourneyStepPlaceholder')}
                        className="w-full bg-[#0a0f16] border border-[#192435] rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'curve' && (
            <>
              <div className="bg-[#131b2e] border border-white/[0.08] rounded-2xl p-5 overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-white">{t('editor.heroJourneyCurveTitle')}</h3>
                    <p className="text-sm text-slate-400 mt-0.5">{t('editor.heroJourneyCurveDesc')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 flex items-center gap-1.5 bg-[#0d121b] px-3 py-1.5 rounded-lg border border-white/10">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      {currentModelLabel || t('editor.aiModelSelectAuto')}
                    </span>
                  </div>
                </div>

                {/* SVG curve */}
                <div className="relative bg-[#0d1322] rounded-xl border border-white/[0.08] p-4">
                  <div className="absolute left-4 top-4 text-xs font-mono text-emerald-400/90">+10</div>
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">0</div>
                  <div className="absolute left-4 bottom-4 text-xs font-mono text-rose-400/90">-10</div>
                  <div className="overflow-x-auto">
                    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full min-w-[760px] h-[380px] select-none">
                      <defs>
                        <linearGradient id="hj-curve" x1="0%" x2="100%" y1="0%" y2="0%">
                          <stop offset="0%" stopColor="#d99738" />
                          <stop offset="35%" stopColor="#f59e0b" />
                          <stop offset="68%" stopColor="#ef4444" />
                          <stop offset="85%" stopColor="#eab308" />
                          <stop offset="100%" stopColor="#4ade80" />
                        </linearGradient>
                        <linearGradient id="hj-area" x1="0%" x2="0%" y1="0%" y2="100%">
                          <stop offset="0%" stopColor="rgba(217,151,56,0.18)" />
                          <stop offset="100%" stopColor="rgba(217,151,56,0)" />
                        </linearGradient>
                      </defs>
                      <rect x="50" y="30" width="310" height="360" rx="6" fill="#16223b" fillOpacity="0.3" stroke="#253556" strokeOpacity="0.3" />
                      <rect x="390" y="30" width="350" height="360" rx="6" fill="#1f1828" fillOpacity="0.25" stroke="#3d2c44" strokeOpacity="0.3" />
                      <rect x="770" y="30" width="300" height="360" rx="6" fill="#14282e" fillOpacity="0.25" stroke="#224a4d" strokeOpacity="0.3" />
                      <text x="65" y="55" fontSize="11" fontWeight="600" fill="#64748b" letterSpacing="1">АКТ I: ЗВИЧАЙНИЙ СВІТ ТА ПОКЛИК</text>
                      <text x="405" y="55" fontSize="11" fontWeight="600" fill="#64748b" letterSpacing="1">АКТ II: ВИПРОБУВАННЯ ТА КРИЗА</text>
                      <text x="785" y="55" fontSize="11" fontWeight="600" fill="#64748b" letterSpacing="1">АКТ III: ПОВЕРНЕННЯ І ТРІУМФ</text>
                      <line x1="50" x2="1070" y1={NEUTRAL_Y} y2={NEUTRAL_Y} stroke="#475569" strokeOpacity="0.7" strokeWidth="1.2" strokeDasharray="4 4" />
                      <path d={areaPath} fill="url(#hj-area)" opacity="0.45" />
                      <path d={curvePath} fill="none" stroke="url(#hj-curve)" strokeWidth="4.5" strokeLinecap="round" />
                      {valences.map((v, i) => (
                        <g key={i} transform={`translate(${nodeX(i)}, ${nodeY(v)})`}>
                          <circle r={i === 9 ? 9 : i === 13 ? 9.5 : 7.5} fill={dotColor(v)} stroke="#131b2e" strokeWidth="2.5" />
                          <text
                            x="0"
                            y={v < 0 ? 22 : -14}
                            textAnchor="middle"
                            fontSize="11"
                            fontWeight={v <= -7 || v >= 7 ? 'bold' : '600'}
                            fill={v <= -7 ? '#f87171' : v >= 7 ? '#86efac' : '#94a3b8'}
                          >
                            {i + 1}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-white/[0.05] text-xs text-slate-400">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#d99738]" /> 1-8 Підйом і виклики</span>
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> 9-10 «Безодня» / Криза</span>
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> 14 Фінальний катарсис</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Act sliders */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    title: t('editor.heroJourneyAct1'),
                    subtitle: t('editor.heroJourneyAct1Sub'),
                    accent: 'text-amber-400/90',
                    border: 'hover:border-amber-500/30',
                    sliders: [
                      { label: t('editor.heroJourneyResistance'), idx: 2, min: -10, max: 0 },
                      { label: t('editor.heroJourneyThreshold'), idx: 4, min: 0, max: 10 },
                    ],
                    footer: t('editor.heroJourneyAct1Footer'),
                    footerVal: t('editor.heroJourneyModerate'),
                  },
                  {
                    title: t('editor.heroJourneyAct2'),
                    subtitle: t('editor.heroJourneyAct2Sub'),
                    accent: 'text-rose-400',
                    border: 'hover:border-rose-500/40',
                    sliders: [
                      { label: t('editor.heroJourneyAbyss'), idx: 9, min: -10, max: -2 },
                      { label: t('editor.heroJourneyTrials'), idx: 6, min: -9, max: 0 },
                    ],
                    footer: t('editor.heroJourneyAct2Footer'),
                    footerVal: t('editor.heroJourneyAct2FooterVal'),
                  },
                  {
                    title: t('editor.heroJourneyAct3'),
                    subtitle: t('editor.heroJourneyAct3Sub'),
                    accent: 'text-emerald-400',
                    border: 'hover:border-emerald-500/30',
                    sliders: [
                      { label: t('editor.heroJourneyResurrection'), idx: 12, min: 1, max: 8 },
                      { label: t('editor.heroJourneyTriumph'), idx: 13, min: 4, max: 10 },
                    ],
                    footer: t('editor.heroJourneyAct3Footer'),
                    footerVal: t('editor.heroJourneyAct3FooterVal'),
                  },
                ].map((card) => (
                  <div key={card.title} className={`bg-[#131b2e] border border-white/[0.08] rounded-2xl p-5 transition-all ${card.border}`}>
                    <h4 className={`text-xs font-semibold uppercase tracking-wider ${card.accent} mb-1`}>{card.title}</h4>
                    <h5 className="text-base font-semibold text-white mb-2">{card.subtitle}</h5>
                    <div className="space-y-4">
                      {card.sliders.map((sl) => (
                        <div key={sl.idx}>
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-slate-300">{sl.label}</span>
                            <span className="font-mono text-amber-400">{valences[sl.idx]}</span>
                          </div>
                          <input
                            type="range"
                            min={sl.min}
                            max={sl.max}
                            step="0.5"
                            value={valences[sl.idx]}
                            onChange={(e) => setValence(sl.idx, Number(e.target.value))}
                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 pt-3 border-t border-white/[0.05] flex items-center justify-between text-[11px] text-slate-400">
                      <span>{card.footer}</span>
                      <span className="text-slate-200 font-medium">{card.footerVal}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* AI sync */}
              <div className="bg-[#131b2e] border border-white/[0.08] rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  onClick={handleAiSync}
                  disabled={isSyncing}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-950/40 bg-cyan-900/20 border border-cyan-700/30 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-cyan-400" />}
                  {t('editor.heroJourneyAiSync')}
                </button>
                {syncResult && (
                  <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 flex-1">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>{syncResult.arcName}:</strong> {syncResult.description}
                    </span>
                  </div>
                )}
                {syncError && (
                  <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 flex-1">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{syncError}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'summary' && (
            <>
              {/* Diagnostics */}
              <div className="bg-[#111722] rounded-2xl border border-[#1b2537] p-6">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400 mb-2">
                  <Sparkles className="w-4 h-4" />
                  {t('editor.heroJourneyDiagnostic')}
                </div>
                <h3 className="text-2xl font-bold text-white mb-1">{t('editor.heroJourneyDiagnosticTitle')}</h3>
                <p className="text-sm text-slate-400 max-w-2xl">{t('editor.heroJourneyDiagnosticDesc')}</p>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
                  <div className="bg-[#141b27]/80 rounded-xl p-4 border border-emerald-500/20">
                    <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm mb-2">
                      <CheckCircle2 className="w-4 h-4" />
                      {t('editor.heroJourneyStrengths')}
                    </div>
                    <ul className="space-y-2 text-xs text-slate-300 list-disc list-inside">
                      <li>{t('editor.heroJourneyStrength1')}</li>
                      <li>{t('editor.heroJourneyStrength2')}</li>
                      <li>{t('editor.heroJourneyStrength3')}</li>
                    </ul>
                  </div>
                  <div className="bg-[#141b27]/80 rounded-xl p-4 border border-amber-500/25">
                    <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      {t('editor.heroJourneyPitfalls')}
                    </div>
                    <ul className="space-y-2 text-xs text-slate-300 list-disc list-inside">
                      <li>{t('editor.heroJourneyPitfall1')}</li>
                      <li>{t('editor.heroJourneyPitfall2')}</li>
                    </ul>
                  </div>
                  <div className="bg-[#141b27]/80 rounded-xl p-4 border border-sky-500/20">
                    <div className="flex items-center gap-2 text-sky-400 font-semibold text-sm mb-2">
                      <Info className="w-4 h-4" />
                      {t('editor.heroJourneyRecommendations')}
                    </div>
                    <ol className="space-y-2 text-xs text-slate-300 list-decimal list-inside">
                      <li>{t('editor.heroJourneyRec1')}</li>
                      <li>{t('editor.heroJourneyRec2')}</li>
                      <li>{t('editor.heroJourneyRec3')}</li>
                    </ol>
                  </div>
                </div>
              </div>

              {/* Step accordion */}
              <div className="bg-[#111722] rounded-2xl border border-[#1b2537] p-6">
                <h3 className="text-xl font-bold text-white mb-1">{t('editor.heroJourneyStepsCard')}</h3>
                <p className="text-xs text-slate-400 mb-4">{t('editor.heroJourneyStepsCardDesc')}</p>
                <div className="space-y-2.5">
                  {HERO_STEPS.map((s) => (
                    <div key={s.n} className="rounded-xl border border-[#1d293b] bg-[#0e141e] overflow-hidden">
                      <button onClick={() => toggleStep(s.n)} className="w-full px-4 py-3 flex items-center justify-between text-left bg-[#121926]/50">
                        <div className="flex items-center gap-3">
                          <span className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/25 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                            {String(s.n).padStart(2, '0')}
                          </span>
                          <span className="text-sm font-semibold text-slate-200">{s.title}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {stepAnswers[s.n]?.trim() ? (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hidden sm:inline-block">
                              {t('editor.heroJourneyFilledTag')}
                            </span>
                          ) : null}
                          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${openSteps.has(s.n) ? '' : '-rotate-90'}`} />
                        </div>
                      </button>
                      {openSteps.has(s.n) && (
                        <div className="p-4 pt-2 border-t border-[#182333]">
                          <p className="text-xs text-slate-300 italic font-serif border-l-2 border-amber-400 pl-2.5 leading-relaxed">
                            {stepAnswers[s.n]?.trim() ? `«${stepAnswers[s.n]}»` : t('editor.heroJourneyStepEmpty')}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={copyForMentor}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-900 hover:bg-amber-300 font-semibold text-sm transition-colors"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
                  {copied ? t('editor.heroJourneyCopied') : t('editor.heroJourneyCopy')}
                </button>
                <button
                  onClick={handleAiSync}
                  disabled={isSyncing}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#131b27] hover:bg-[#182232] text-slate-200 border border-[#233147] font-medium text-sm transition-colors disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 text-slate-400" />}
                  {t('editor.heroJourneyAiSync')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
