/**
 * Вкладка «Динаміка ніші» — як змінювалась ніша між збереженими прогонами
 * скринінгу (ТЗ 8, 9).
 *
 * ЧОМУ ЦЕ НЕ «РАДАР ТРЕНДІВ» ІЗ НАБОРУ. Той екран на кожен пошук ключового
 * слова генерував `Math.random()` для обсягу запитів, зростання, середньої
 * ціни, конверсії та CPC — і малював із цього графіки. Два натискання
 * поспіль давали два різні «тренди» для того самого слова.
 *
 * Тут джерело інше: зрізи, які модуль уже зберіг під час скринінгу. Одна
 * точка на графіку = один реальний прогін із його датою. Нічого не
 * витрачається (модель не викликається), нічого не добудовується: якщо
 * прогін один — показуємо, що порівнювати нема з чим, замість прямої лінії,
 * яку читають як стабільність. Порожній показник лишається порожнім і
 * рахується окремо: товар без ціни не є товаром за нуль доларів.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Info, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { GlassCard } from './GlassCard';

interface TopicRun {
  collectedAt: string;
  listings: number;
  medianPriceUsd: number | null;
  totalReviews: number | null;
  avgRating: number | null;
  missingPrice: number;
  missingReviews: number;
  missingRating: number;
}

interface TopicTrend {
  topicKey: string;
  runs: TopicRun[];
  comparable: boolean;
}

interface TopicOption {
  topicKey: string;
  topic: string;
}

interface TopicTrendViewProps {
  topics: TopicOption[];
  /** Ключ теми, яку автор щойно дивився у скринінгу — з неї й починаємо. */
  initialTopicKey?: string | null;
}

/** Різниця між першим і останнім прогоном. `null`, якщо бракує даних. */
function delta(runs: TopicRun[], pick: (run: TopicRun) => number | null): number | null {
  const values = runs.map(pick).filter((v): v is number => typeof v === 'number');
  if (values.length < 2) return null;
  return Math.round((values[values.length - 1] - values[0]) * 100) / 100;
}

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });

export const TopicTrendView: React.FC<TopicTrendViewProps> = ({ topics, initialTopicKey }) => {
  const [topicKey, setTopicKey] = useState(initialTopicKey || topics[0]?.topicKey || '');
  const [trend, setTrend] = useState<TopicTrend | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (key: string) => {
    if (!key) {
      setTrend(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/market/topic/${encodeURIComponent(key)}/trend`, {
        credentials: 'same-origin',
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        setError(data?.error || `Помилка ${res.status}`);
        setTrend(null);
        return;
      }
      setTrend(data as TopicTrend);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося завантажити динаміку.');
      setTrend(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(topicKey);
  }, [topicKey, load]);

  const runs = trend?.runs ?? [];
  const chartData = runs.map((run) => ({
    date: dateLabel(run.collectedAt),
    price: run.medianPriceUsd,
    reviews: run.totalReviews,
    listings: run.listings,
  }));

  const priceDelta = delta(runs, (r) => r.medianPriceUsd);
  const reviewDelta = delta(runs, (r) => r.totalReviews);

  const Delta: React.FC<{ value: number | null; prefix?: string }> = ({ value, prefix = '' }) => {
    if (value === null) return <span className="text-white/50">даних для порівняння немає</span>;
    const up = value > 0;
    const Icon = up ? TrendingUp : TrendingDown;
    if (value === 0) return <span className="text-white/70">без змін</span>;
    return (
      <span className={`inline-flex items-center gap-1 ${up ? 'text-emerald-300' : 'text-rose-300'}`}>
        <Icon className="w-4 h-4" />
        {up ? '+' : ''}
        {prefix}
        {value}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <GlassCard
        title="Динаміка ніші між прогонами"
        subtitle="Одна точка — один збережений прогін скринінгу з його датою. Нічого не витрачається: модель тут не викликається."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-white/80 px-1">
              Ніша
            </label>
            <select
              className="glass-input"
              value={topicKey}
              onChange={(event) => setTopicKey(event.target.value)}
            >
              {topics.length === 0 && <option value="">Жодної теми ще не досліджено</option>}
              {topics.map((item) => (
                <option key={item.topicKey} value={item.topicKey} className="bg-slate-900">
                  {item.topic}
                </option>
              ))}
            </select>
          </div>

          {busy && (
            <p className="text-xs text-white/60 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Читаю збережені зрізи…
            </p>
          )}

          {error && (
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2">
              <p className="text-xs text-rose-100">{error}</p>
            </div>
          )}

          {/*
            Один прогін — не тренд. Показати пряму лінію з однієї точки
            означало б відповісти «стабільно» на питання, на яке даних нема.
          */}
          {!busy && !error && trend && !trend.comparable && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2.5">
              <p className="text-xs text-amber-100 leading-relaxed flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {runs.length === 0
                    ? 'Цю нішу ще не досліджували — зрізів немає.'
                    : 'Збережено лише один прогін. Динаміка зʼявиться після другого: одна точка не показує напрямку, і малювати з неї лінію означало б відповісти «стабільно» на питання, на яке даних немає.'}
                </span>
              </p>
            </div>
          )}
        </div>
      </GlassCard>

      {trend?.comparable && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <GlassCard className="p-4">
              <p className="text-xs uppercase tracking-wider text-white/60">Медіанна ціна</p>
              <p className="text-2xl font-bold text-white mt-1">
                {runs[runs.length - 1].medianPriceUsd === null
                  ? '—'
                  : `$${runs[runs.length - 1].medianPriceUsd}`}
              </p>
              <p className="text-xs mt-1">
                <Delta value={priceDelta} prefix="$" /> від першого прогону
              </p>
            </GlassCard>
            <GlassCard className="p-4">
              <p className="text-xs uppercase tracking-wider text-white/60">Сума відгуків</p>
              <p className="text-2xl font-bold text-white mt-1">
                {runs[runs.length - 1].totalReviews ?? '—'}
              </p>
              <p className="text-xs mt-1">
                <Delta value={reviewDelta} /> від першого прогону
              </p>
            </GlassCard>
            <GlassCard className="p-4">
              <p className="text-xs uppercase tracking-wider text-white/60">Прогонів збережено</p>
              <p className="text-2xl font-bold text-white mt-1">{runs.length}</p>
              <p className="text-xs text-white/60 mt-1">
                {dateLabel(runs[0].collectedAt)} — {dateLabel(runs[runs.length - 1].collectedAt)}
              </p>
            </GlassCard>
          </div>

          <GlassCard title="Медіанна ціна за прогонами">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                  <XAxis dataKey="date" stroke="rgba(255,255,255,0.6)" fontSize={11} />
                  <YAxis stroke="rgba(255,255,255,0.6)" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(15,23,42,0.95)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  {/* connectNulls={false} — прогін без цін лишається розривом
                      у лінії, а не з'єднується прямою, ніби дані там були. */}
                  <Line type="monotone" dataKey="price" stroke="#38bdf8" strokeWidth={2} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          <GlassCard title="Сума відгуків за прогонами">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                  <XAxis dataKey="date" stroke="rgba(255,255,255,0.6)" fontSize={11} />
                  <YAxis stroke="rgba(255,255,255,0.6)" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(15,23,42,0.95)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Line type="monotone" dataKey="reviews" stroke="#a78bfa" strokeWidth={2} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          <GlassCard title="Прогони">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-white/60">
                  <tr className="text-left">
                    <th className="py-2 pr-4 font-semibold">Дата</th>
                    <th className="py-2 pr-4 font-semibold">Позицій</th>
                    <th className="py-2 pr-4 font-semibold">Медіанна ціна</th>
                    <th className="py-2 pr-4 font-semibold">Відгуків</th>
                    <th className="py-2 pr-4 font-semibold">Рейтинг</th>
                    <th className="py-2 font-semibold">Без даних</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.collectedAt} className="border-t border-white/10 text-white/90">
                      <td className="py-2 pr-4">{dateLabel(run.collectedAt)}</td>
                      <td className="py-2 pr-4">{run.listings}</td>
                      <td className="py-2 pr-4">
                        {run.medianPriceUsd === null ? <span className="text-white/40">—</span> : `$${run.medianPriceUsd}`}
                      </td>
                      <td className="py-2 pr-4">
                        {run.totalReviews ?? <span className="text-white/40">—</span>}
                      </td>
                      <td className="py-2 pr-4">
                        {run.avgRating ?? <span className="text-white/40">—</span>}
                      </td>
                      {/*
                        Стовпчик «без даних» — не службовий. Без нього два
                        прогони порівнювались би як рівні, хоча в одному було
                        десять цін, а в другому дві.
                      */}
                      <td className="py-2 text-white/60">
                        {run.missingPrice + run.missingReviews + run.missingRating === 0
                          ? '—'
                          : [
                              run.missingPrice ? `ціна: ${run.missingPrice}` : '',
                              run.missingReviews ? `відгуки: ${run.missingReviews}` : '',
                              run.missingRating ? `рейтинг: ${run.missingRating}` : '',
                            ]
                              .filter(Boolean)
                              .join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-white/60 leading-relaxed mt-3 flex gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Це динаміка ОЦІНОК моделі, а не даних Etsy: зрізи зібрані тим самим скринінгом,
                що й звіт у першій вкладці. Зміна між прогонами може означати і зміну ринку, і
                просто інший добір товарів моделлю.
              </span>
            </p>
          </GlassCard>
        </>
      )}
    </div>
  );
};
