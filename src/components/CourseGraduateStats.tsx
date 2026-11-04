import React, { useEffect, useState } from 'react';

/** Показники з маркетплейсу (`/api/courses/:id/graduate-stats`). */
interface Stats {
  students: number;
  completed: number;
  sellers: number;
  works: { total: number; draft: number; pending: number; published: number };
  sales: { units: number; revenueMinor: number; commissionMinor: number };
  bonus: { sharePercent: number; accruedMinor: number; pendingMinor: number; paidMinor: number; dueMinor: number };
}

const uah = (minor: number) =>
  `${(minor / 100).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} грн`;

function Figure({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-[110px]">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-100">{value}</div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

/**
 * Блок автора курсу: скільки випускників дійшли до продажу, що вони продали й
 * яка частка комісії належить автору. Лише читання — нараховує й виплачує
 * бонус маркетплейс (адмін записує виплату вручну).
 */
export default function CourseGraduateStats({ courseId }: { courseId: string }) {
  const [stats, setStats] = useState<Stats | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setStats(undefined);
    setError(null);
    fetch(`/api/courses/${encodeURIComponent(courseId)}/graduate-stats`, { credentials: 'include' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (alive) setStats(body.stats ?? null);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [courseId]);

  return (
    <details data-course-graduate-stats className="rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300">
      <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-200">Випускники й їхні роботи</summary>
      <div className="px-3 pb-3">
        {error ? (
          <p className="text-rose-300">Показники недоступні: {error}</p>
        ) : stats === undefined ? (
          <p className="text-slate-500">Завантажую…</p>
        ) : stats === null ? (
          <p className="text-slate-500">
            Показники з'являться після публікації курсу у вітрині й першої роботи випускника.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Figure label="Учнів" value={stats.students} />
              <Figure label="Пройшли курс" value={stats.completed} />
              <Figure label="Випускників-продавців" value={stats.sellers} />
              <Figure
                label="Робіт"
                value={stats.works.total}
                hint={`${stats.works.published} у вітрині · ${stats.works.pending} на модерації · ${stats.works.draft} чернеток`}
              />
              <Figure label="Продано, шт." value={stats.sales.units} />
              <Figure label="Виручка випускників" value={uah(stats.sales.revenueMinor)} />
            </div>
            <div className="mt-3 rounded-lg bg-slate-800/60 p-2.5">
              <div className="text-[11px] font-semibold text-slate-200">
                Ваш бонус — {stats.bonus.sharePercent}% комісії магазину
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-2">
                <Figure label="Нараховано" value={uah(stats.bonus.accruedMinor)} />
                <Figure
                  label="Ще в очікуванні"
                  value={uah(stats.bonus.pendingMinor)}
                  hint="виріб ще не доставлено або триває строк повернення"
                />
                <Figure label="Виплачено" value={uah(stats.bonus.paidMinor)} />
                <Figure label="До виплати" value={uah(stats.bonus.dueMinor)} />
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                Бонус виплачує адміністратор магазину вручну; тут лише облік.
              </p>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
