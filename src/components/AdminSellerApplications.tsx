import React, { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, RefreshCw, UserPlus } from 'lucide-react';

/**
 * «Заявки продавців» — черга «хочу продавати» з маркетплейсу.
 *
 * Заявки живуть у базі маркетплейсу, але рішення про них власник ухвалює в
 * панелі Студії: досі це можна було зробити лише на сторінці адміна
 * маркетплейсу, і погодження доводилося шукати у двох місцях — а з роллю
 * `buyer` туди взагалі не пускало.
 *
 * Правил схвалення тут немає жодного: на тому боці це дві записи однією
 * транзакцією (профіль продавця стає `approved`, роль користувача
 * `buyer` → `seller`), і дублювати їх означало б дати їм розійтись. Студія
 * лише передає рішення мостом і показує результат.
 */

type SellerApplication = {
  id: string;
  displayName: string;
  slug: string;
  bio: string | null;
  email: string | null;
  userRole: string | null;
  listings: number;
  createdAt: string;
  /** Тариф заявника з боку Студії — підписки живуть тут, а не в маркетплейсі. */
  plan: string | null;
  planName: string;
  /** Чи можна схвалювати: продавцем стає лише той, хто має платну підписку. */
  maySell: boolean;
  gate: string | null;
};

/** Ті самі назви, що й у кабінеті маркетплейсу: роль там — це `buyer`/`seller`. */
const ROLE_LABELS: Record<string, string> = {
  buyer: 'Покупець',
  seller: 'Продавець',
  admin: 'Адмін',
  writer: 'Письменник',
  expert: 'Експерт',
  sales_manager: 'Менеджер продажів',
  instruction_engineer: 'Інженер зі складання інструкцій',
  student: 'Студент',
};

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const AdminSellerApplications: React.FC = () => {
  const [rows, setRows] = useState<SellerApplication[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setMessage(null);
    try {
      const res = await fetch('/api/admin/marketplace-bridge/sellers', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося прочитати заявки продавців.');
      setRows(Array.isArray(data?.applications) ? data.applications : []);
    } catch (err: any) {
      setMessage({ tone: 'err', text: err?.message || 'Помилка завантаження.' });
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusyId(id);
    setMessage(null);
    try {
      const reason =
        decision === 'reject' ? window.prompt('Причина відхилення заявки:')?.trim() || '' : '';
      if (decision === 'reject' && !reason) {
        setMessage({ tone: 'err', text: 'Потрібна причина відхилення.' });
        return;
      }
      const res = await fetch(
        `/api/admin/marketplace-bridge/sellers/${encodeURIComponent(id)}/${decision}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(decision === 'reject' ? { reason } : {}),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Не вдалося (HTTP ${res.status}).`);
      setMessage({
        tone: 'ok',
        text:
          decision === 'approve'
            ? 'Схвалено — акаунт став продавцем і може виставляти товари.'
            : 'Заявку відхилено.',
      });
      void load();
    } catch (err: any) {
      setMessage({ tone: 'err', text: err?.message || 'Помилка.' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-400" /> Заявки продавців
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Хто просить право продавати на маркетплейсі. Схвалення робить акаунт продавцем
            (<span className="font-mono">buyer → seller</span>) — тобто відкриває кабінет продавця,
            а не лише галочку в списку.
          </p>
          <p className="text-[11px] text-amber-300/80 mt-1">
            Схвалити можна лише того, хто придбав платну підписку — мінімум «Start»: продавець
            витрачає саме ті засоби, які вона оплачує (зображення та тексти ШІ). Тариф кожного
            заявника показано праворуч від ролі.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400"
          title="Оновити"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {message && (
        <div
          className={`mt-3 p-2.5 rounded-xl text-xs ${
            message.tone === 'ok'
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {rows === null ? (
          <p className="text-xs text-slate-500">Завантаження…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-500">Заявок, що чекають рішення, немає.</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 rounded-xl bg-slate-950/50 border border-slate-800 p-3"
            >
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 bg-slate-800 text-slate-300 border-slate-700">
                {ROLE_LABELS[row.userRole ?? ''] ?? row.userRole ?? 'роль невідома'}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                  row.maySell
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                }`}
                title={row.maySell ? 'Платна підписка — можна схвалювати' : row.gate ?? undefined}
              >
                {row.planName}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate">{row.displayName}</p>
                <p className="text-[10px] text-slate-500 font-mono truncate">
                  {row.email ?? 'пошти немає'} · /{row.slug} · позицій: {row.listings} ·{' '}
                  {shortDate(row.createdAt)}
                </p>
                {row.bio && (
                  <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2" title={row.bio}>
                    {row.bio}
                  </p>
                )}
                {!row.maySell && row.gate && (
                  <p className="text-[10px] text-amber-300/90 mt-0.5">{row.gate}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => void decide(row.id, 'approve')}
                  disabled={busyId === row.id || !row.maySell}
                  title={row.maySell ? undefined : row.gate ?? 'Потрібна платна підписка'}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Схвалити
                </button>
                <button
                  onClick={() => void decide(row.id, 'reject')}
                  disabled={busyId === row.id}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 text-[11px] font-semibold disabled:opacity-50"
                >
                  <Ban className="w-3.5 h-3.5" /> Відхилити
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
