import React, { useState } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';
import { AlertTriangle, Quote, Target, TrendingUp } from 'lucide-react';

/**
 * Артефакт діагностики /diagn (diagn-module-tech-spec-v1.0.md §6).
 *
 * Компонент навмисно нічого не запитує й нічого не нормалізує: він малює
 * те, що йому дали. Нормалізація живе на сервері (server/diagnPrompt.ts),
 * бо той самий звіт має однаково виглядати і щойно порахований, і
 * піднятий з історії через півроку — а з історії він приходить уже
 * записаним, повз будь-яку клієнтську обробку.
 *
 * Три вкладки, а не одна довга сторінка: підмодулі відповідають на різні
 * питання («як я пишу», «чи тримається сюжет», «чого мені бракує»), і
 * зшиті в стовпчик вони читаються як один нерозбірливий присуд.
 */

export interface DiagnMetric { score: number; label: string }
export interface DiagnStyle {
  summary: string;
  metrics: Record<string, DiagnMetric>;
  highlights: { excerpt: string; note: string }[];
  recommendations: string[];
}
export interface DiagnStructure {
  summary: string;
  detected_archetype: string;
  arc_position: string;
  deviations: { type: string; description: string; severity: 'low' | 'medium' | 'high' }[];
  recommendations: string[];
}
export interface DiagnCompetency {
  summary: string;
  radar: { skill: string; score: number }[];
  gaps: string[];
  next_exercises: string[];
}

export interface DiagnReport {
  diagn_id: string;
  created_at: string;
  word_count?: number;
  low_confidence?: boolean;
  from_cache?: boolean;
  failed?: { module: string; error: string }[];
  modules: { style?: DiagnStyle; structure?: DiagnStructure; competency?: DiagnCompetency };
}

const METRIC_LABELS: Record<string, string> = {
  sentence_rhythm: 'Ритм речень',
  lexical_diversity: 'Лексичне розмаїття',
  dialogue_ratio: 'Частка діалогів',
};

const SEVERITY: Record<string, { label: string; cls: string }> = {
  low: { label: 'незначне', cls: 'border-slate-600 bg-slate-700/40 text-slate-300' },
  medium: { label: 'помітне', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-200' },
  high: { label: 'серйозне', cls: 'border-red-500/40 bg-red-500/10 text-red-200' },
};

const Bar: React.FC<{ label: string; metric: DiagnMetric }> = ({ label, metric }) => (
  <div>
    <div className="mb-1 flex items-baseline justify-between gap-3">
      <span className="text-xs font-semibold text-slate-200">{label}</span>
      <span className="font-mono text-xs text-slate-400">{metric.score}</span>
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
      <div
        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400"
        style={{ width: `${Math.max(0, Math.min(100, metric.score))}%` }}
      />
    </div>
    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{metric.label}</p>
  </div>
);

const RecommendationList: React.FC<{ items: string[]; title: string }> = ({ items, title }) =>
  items.length === 0 ? null : (
    <div>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
        <TrendingUp className="h-3.5 w-3.5" />
        {title}
      </h4>
      <ul className="space-y-1">
        {items.map((r, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-300">
            <span className="text-emerald-400">—</span>
            {r}
          </li>
        ))}
      </ul>
    </div>
  );

export const DiagnosticReportCard: React.FC<{ report: DiagnReport; documentTitle?: string }> = ({
  report,
  documentTitle,
}) => {
  const available = (['style', 'structure', 'competency'] as const).filter((k) => report.modules[k]);
  const [tab, setTab] = useState<(typeof available)[number]>(available[0] ?? 'style');

  const style = report.modules.style;
  const structure = report.modules.structure;
  const competency = report.modules.competency;

  const TAB_TITLES = { style: 'Стиль', structure: 'Структура', competency: 'Компетенції' } as const;

  return (
    <div className="nova-glass-dark overflow-hidden rounded-2xl border border-slate-800">
      <header className="border-b border-slate-800 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-bold text-slate-100">
            Діагностика{documentTitle ? ` · ${documentTitle}` : ''}
          </h3>
          <span className="font-mono text-[11px] text-slate-500">
            {new Date(report.created_at).toLocaleString('uk-UA')}
            {report.word_count ? ` · ${report.word_count} слів` : ''}
            {report.from_cache ? ' · з кешу' : ''}
          </span>
        </div>

        {report.low_confidence && (
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Текст коротший за 300 слів — висновки про стиль і структуру орієнтовні. Це не помилка
            аналізу, а межа того, що видно на такому обсязі.
          </p>
        )}

        {report.failed && report.failed.length > 0 && (
          <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-200">
            Не відпрацювало: {report.failed.map((f) => `${f.module} (${f.error})`).join('; ')}. Решта
            підмодулів порахована й показана нижче.
          </p>
        )}

        {available.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {available.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400 hover:bg-white/[0.05]'
                }`}
              >
                {TAB_TITLES[k]}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="space-y-5 px-5 py-4">
        {tab === 'style' && style && (
          <>
            <p className="text-sm leading-relaxed text-slate-300">{style.summary}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {Object.entries(style.metrics).map(([key, m]) => (
                <Bar key={key} label={METRIC_LABELS[key] ?? key} metric={m} />
              ))}
            </div>
            {style.highlights.length > 0 && (
              <div className="space-y-2">
                {style.highlights.map((h, i) => (
                  <figure key={i} className="rounded-xl border border-slate-800 bg-slate-900/50 px-3.5 py-3">
                    <blockquote className="flex gap-2 text-xs italic leading-relaxed text-slate-200">
                      <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" />
                      {h.excerpt}
                    </blockquote>
                    {h.note && <figcaption className="mt-1.5 pl-5 text-[11px] text-slate-500">{h.note}</figcaption>}
                  </figure>
                ))}
              </div>
            )}
            <RecommendationList items={style.recommendations} title="Що змінити" />
          </>
        )}

        {tab === 'structure' && structure && (
          <>
            <p className="text-sm leading-relaxed text-slate-300">{structure.summary}</p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">
                {structure.detected_archetype}
              </span>
              <span className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-200">
                {structure.arc_position}
              </span>
            </div>
            {structure.deviations.length > 0 && (
              <ul className="space-y-2">
                {structure.deviations.map((d, i) => {
                  const s = SEVERITY[d.severity] ?? SEVERITY.medium;
                  return (
                    <li key={i} className={`rounded-xl border px-3.5 py-2.5 ${s.cls}`}>
                      <div className="mb-0.5 flex items-center gap-2">
                        <span className="text-xs font-bold">{d.type}</span>
                        <span className="text-[10px] uppercase tracking-wider opacity-70">{s.label}</span>
                      </div>
                      <p className="text-[11px] leading-relaxed opacity-90">{d.description}</p>
                    </li>
                  );
                })}
              </ul>
            )}
            <RecommendationList items={structure.recommendations} title="Що змінити" />
          </>
        )}

        {tab === 'competency' && competency && (
          <>
            <p className="text-sm leading-relaxed text-slate-300">{competency.summary}</p>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={competency.radar} outerRadius="72%">
                  <PolarGrid stroke="#1e293b" />
                  <PolarAngleAxis dataKey="skill" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 9 }} />
                  <Radar dataKey="score" stroke="#34d399" fill="#34d399" fillOpacity={0.25} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            {competency.gaps.length > 0 && (
              <div>
                <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <Target className="h-3.5 w-3.5" />
                  Прогалини
                </h4>
                <ul className="space-y-1">
                  {competency.gaps.map((g, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-300">
                      <span className="text-amber-400">—</span>
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <RecommendationList items={competency.next_exercises} title="Вправи далі" />
          </>
        )}
      </div>
    </div>
  );
};
