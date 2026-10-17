import React from 'react';
import { CirclePause, CirclePlay, Radio, Users, Wifi, WifiOff, XCircle } from 'lucide-react';

export type SessionConnectionState = 'online' | 'unstable' | 'reconnecting' | 'offline' | 'restored';
export type SessionStatus = 'draft' | 'live' | 'paused' | 'completed';

interface SessionHeaderProps {
  title: string;
  phase?: string;
  status?: SessionStatus;
  participants?: number;
  connection?: SessionConnectionState;
  elapsed?: string;
  onPause?: () => void;
  onResume?: () => void;
  onEnd?: () => void;
}

const connectionMeta: Record<SessionConnectionState, { label: string; className: string }> = {
  online: { label: 'Онлайн', className: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  unstable: { label: 'Нестабільно', className: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  reconnecting: { label: 'Відновлення…', className: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10' },
  offline: { label: 'Офлайн', className: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
  restored: { label: 'Відновлено', className: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
};

export const SessionHeader: React.FC<SessionHeaderProps> = ({
  title,
  phase = 'Підготовка',
  status = 'live',
  participants = 1,
  connection = 'online',
  elapsed = '00:00',
  onPause,
  onResume,
  onEnd,
}) => {
  const meta = connectionMeta[connection];
  const isPaused = status === 'paused';

  return (
    <header className="flex flex-col gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-3 text-slate-100 backdrop-blur lg:flex-row lg:items-center lg:justify-between" data-story-experience="session-header">
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
          <span>Live session</span><span>·</span><span>{phase}</span>
        </div>
        <h2 className="truncate text-sm font-bold text-white">{title}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${meta.className}`}>
          {connection === 'offline' ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}{meta.label}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[10px] text-slate-400"><Users className="h-3 w-3" /> {participants}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 font-mono text-[10px] text-slate-300"><Radio className="h-3 w-3" /> {elapsed}</span>
        {status !== 'completed' && (
          <button type="button" onClick={isPaused ? onResume : onPause} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">
            {isPaused ? <CirclePlay className="h-3.5 w-3.5" /> : <CirclePause className="h-3.5 w-3.5" />}
            {isPaused ? 'Продовжити' : 'Пауза'}
          </button>
        )}
        {status !== 'completed' && (
          <button type="button" onClick={onEnd} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/15">
            <XCircle className="h-3.5 w-3.5" /> Завершити
          </button>
        )}
      </div>
    </header>
  );
};
