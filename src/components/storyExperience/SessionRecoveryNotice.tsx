import React from 'react';
import { CheckCircle2, CloudOff, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import type { SessionConnectionState } from './SessionHeader';

interface SessionRecoveryNoticeProps {
  connection: SessionConnectionState;
  pendingLocalActions?: number;
  onRetry?: () => void;
  onDismissRestored?: () => void;
}

const meta: Record<Exclude<SessionConnectionState, 'online'>, {
  title: string;
  body: string;
  className: string;
  icon: React.ReactNode;
}> = {
  unstable: {
    title: 'З’єднання нестабільне',
    body: 'Нові дії можуть очікувати підтвердження серверної сесії. Не дублюйте дію вручну.',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    icon: <TriangleAlert className="h-4 w-4" />,
  },
  reconnecting: {
    title: 'Відновлюємо сесію',
    body: 'Інтерфейс зберігає поточний контекст, але остаточний стан має підтвердити Session Engine.',
    className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100',
    icon: <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" />,
  },
  offline: {
    title: 'Немає зв’язку із сесією',
    body: 'Дії, що змінюють спільний стан, тимчасово заблоковані. Приватний текст можна зберігати локально лише як чернетку.',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-100',
    icon: <WifiOff className="h-4 w-4" />,
  },
  restored: {
    title: 'Сесію відновлено',
    body: 'Стан синхронізовано. Перевірте поточний етап перед наступною дією.',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
};

export const SessionRecoveryNotice: React.FC<SessionRecoveryNoticeProps> = ({
  connection,
  pendingLocalActions = 0,
  onRetry,
  onDismissRestored,
}) => {
  if (connection === 'online') return null;
  const current = meta[connection];

  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between ${current.className}`} role="status" aria-live="polite" data-story-experience="session-recovery" data-connection={connection}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{current.icon}</span>
        <div className="min-w-0">
          <div className="text-xs font-bold">{current.title}</div>
          <div className="mt-1 text-[11px] leading-5 opacity-75">{current.body}</div>
          {pendingLocalActions > 0 && (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold opacity-80">
              <CloudOff className="h-3 w-3" /> {pendingLocalActions} локальні дії очікують перевірки
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        {(connection === 'offline' || connection === 'unstable') && onRetry && (
          <button type="button" onClick={onRetry} className="rounded-xl border border-current/20 bg-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/15">
            Спробувати знову
          </button>
        )}
        {connection === 'restored' && onDismissRestored && (
          <button type="button" onClick={onDismissRestored} className="rounded-xl border border-current/20 bg-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/15">
            Продовжити
          </button>
        )}
      </div>
    </div>
  );
};
