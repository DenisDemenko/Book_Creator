import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Check } from 'lucide-react';

/** Те, що віддає GET /api/books/:id/sync (див. server/bookSyncRoutes.ts). */
interface SyncSummary {
  title: string;
  revision: number;
  updatedAt: string;
  chapters: Array<{ id: string; title: string; hash: string }>;
}
interface SyncPlanView {
  action: 'none' | 'pull' | 'push';
  newer: 'local' | 'remote' | 'same';
  reason: string;
  diverged: boolean;
  blocked: boolean;
  overwritesLoserEdits: boolean;
  chapters: Array<{ id: string; title: string; state: 'only-local' | 'only-remote' | 'changed' | 'same' }>;
}
interface SyncStatusView {
  enabled: boolean;
  remoteHost?: string;
  local?: SyncSummary | null;
  remote?: SyncSummary | null;
  plan?: SyncPlanView;
}

const STATE_LABEL: Record<SyncPlanView['chapters'][number]['state'], string> = {
  'only-local': 'лише тут',
  'only-remote': 'лише на проді',
  changed: 'відрізняється',
  same: 'однакова',
};

function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('uk-UA');
}

/**
 * Синхронізація версій книги з іншим сервером (локальна Студія ↔ прод).
 * Не показує нічого, якщо синхронізацію не налаштовано або немає прав адміна.
 */
export const BookSyncPanel: React.FC<{ bookId: string }> = ({ bookId }) => {
  const [status, setStatus] = useState<SyncStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const url = `/api/books/${encodeURIComponent(bookId)}/sync`;

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) return setStatus({ enabled: false });
      if (!res.ok) throw new Error((data as any).error || `Помилка ${res.status}`);
      setStatus(data as SyncStatusView);
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [url]);

  useEffect(() => {
    setDone(null);
    void load();
  }, [load]);

  const apply = async (direction?: 'pull' | 'push') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(direction ? { direction } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || `Помилка ${res.status}`);
      const dir = (data as any).direction as 'pull' | 'push' | null;
      setDone(
        dir === 'pull' ? 'Версію з проду взято сюди. Перезавантажте сторінку, щоб побачити зміни.'
          : dir === 'push' ? 'Локальну версію відправлено на прод.'
          : 'Версії вже однакові.',
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!status || !status.enabled) {
    return error ? <p role="alert" className="text-[11px] text-rose-300">Синхронізація версій: {error}</p> : null;
  }

  const plan = status.plan;
  const needsConfirm = !!plan && plan.overwritesLoserEdits && plan.action !== 'none';
  const actionLabel = plan?.action === 'pull' ? 'Взяти з проду сюди' : 'Відправити на прод';

  return (
    <div className="pt-4 border-t border-slate-800 space-y-3" data-book-sync>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
          Синхронізація версій{status.remoteHost ? ` · ${status.remoteHost}` : ''}
        </h4>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} /> Перевірити
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {([['Тут', status.local], ['Прод', status.remote]] as const).map(([label, side]) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-900 p-2.5">
            <span className="block text-slate-500">{label}</span>
            {side ? (
              <>
                <b className="block text-slate-200">{formatTime(side.updatedAt)}</b>
                <span className="text-slate-500">ревізія {side.revision} · глав {side.chapters.length}</span>
              </>
            ) : (
              <b className="text-slate-400">книги немає</b>
            )}
          </div>
        ))}
      </div>

      {plan && (
        <>
          <p className="text-[11px] text-slate-300" data-sync-reason>{plan.reason}</p>

          {plan.chapters.some((c) => c.state !== 'same') && (
            <ul className="max-h-32 space-y-1 overflow-auto text-[11px]" data-sync-diff>
              {plan.chapters.filter((c) => c.state !== 'same').map((c) => (
                <li key={c.id} className="flex justify-between gap-2 rounded-lg bg-slate-900 px-2.5 py-1">
                  <span className="truncate text-slate-200">{c.title || c.id}</span>
                  <span className="shrink-0 text-amber-300">{STATE_LABEL[c.state]}</span>
                </li>
              ))}
            </ul>
          )}

          {needsConfirm && (
            <label className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Обидві версії змінювалися після останньої синхронізації. Новіша замінить іншу; стара лишиться в історії змін.
                <span className="mt-1.5 flex items-center gap-2">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  Розумію, застосувати
                </span>
              </span>
            </label>
          )}

          <div className="flex flex-wrap gap-2">
            {plan.blocked ? (
              <>
                <button type="button" disabled={busy} onClick={() => void apply('pull')} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700/50 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
                  <ArrowDownToLine className="h-3.5 w-3.5" /> Взяти з проду
                </button>
                <button type="button" disabled={busy} onClick={() => void apply('push')} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700/50 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
                  <ArrowUpFromLine className="h-3.5 w-3.5" /> Відправити на прод
                </button>
              </>
            ) : plan.action !== 'none' ? (
              <button
                type="button"
                disabled={busy || (needsConfirm && !confirmed)}
                onClick={() => void apply()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700/50 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
              >
                {plan.action === 'pull' ? <ArrowDownToLine className="h-3.5 w-3.5" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
                {actionLabel}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300"><Check className="h-3.5 w-3.5" /> Синхронізовано</span>
            )}
          </div>
        </>
      )}

      {done && (
        <p role="status" className="text-[11px] text-emerald-300">
          {done}{' '}
          {done.includes('Перезавантажте') && (
            <button type="button" onClick={() => window.location.reload()} className="underline">Перезавантажити</button>
          )}
        </p>
      )}
      {error && <p role="alert" className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
};
