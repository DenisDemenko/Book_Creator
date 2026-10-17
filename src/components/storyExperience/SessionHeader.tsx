import React from 'react';
import { CirclePause, CirclePlay, Play, Radio, Users, Wifi, WifiOff, XCircle } from 'lucide-react';
import { AttentionAurora } from './AttentionAurora';

export type SessionConnectionState = 'online' | 'unstable' | 'reconnecting' | 'offline' | 'restored';
export type SessionStatus = 'draft' | 'lobby' | 'live' | 'paused' | 'completed';

interface SessionHeaderProps {
  title: string;
  phase?: string;
  status?: SessionStatus;
  participants?: number;
  connection?: SessionConnectionState;
  elapsed?: string;
  onStart?: () => void;
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

const statusLabels: Record<SessionStatus, string> = {
  draft: 'Чернетка',
  lobby: 'Lobby',
  live: 'Live',
  paused: 'Пауза',
  completed: 'Завершено',
};

export const SessionHeader: React.FC<SessionHeaderProps> = ({
  title,
  phase = 'Підготовка',
  status = 'live',
  participants = 1,
  connection = 'online',
  elapsed = '00:00',
  onStart,
  onPause,
  onResume,
  onEnd,
}) => {
  const meta = connectionMeta[connection];
  const isPaused = status === 'paused';
  const canRun = status === 'live' || status === 'paused';
  const canStart = status === 'draft' || status === 'lobby';
  const needsAttention = connection === 'unstable' || connection === 'reconnecting' || connection === 'offline' || connection === 'restored';

  return (
    <header className="flex flex-col gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-3 text-slate-100 backdrop-blur lg:flex-row lg:items-center lg:justify-between" data-story-experience="session-header" data-session-status={status}>
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
          <span>{statusLabels[status]}</span><span>·</span><span>{phase}</span>
        </div>
        <h2 className="truncate text-sm font-bold text-white">{title}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AttentionAurora active={needsAttention} intensity={connection === 'offline' ? 'strong' : 'soft'} ariaLabel={needsAttention ? `Зміна стану з'єднання: ${meta.label}` : undefined}>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${meta.className}`} aria-live="polite">
            {connection === 'offline' ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}{meta.label}
          </span>
        </AttentionAurora>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[10px] text-slate-400"><Users className="h-3 w-3" /> {participants}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 font-mono text-[10px] text-slate-300"><Radio className="h-3 w-3" /> {elapsed}</span>

        {canStart && onStart && (
          <button type="button" onClick={onStart} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-white">
            <Play className="h-3.5 w-3.5" /> Почати сесію
          </button>
        )}

        {canRun && (
          <button type="button" onClick={isPaused ? onResume : onPause} disabled={connection === 'offline'} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
            {isPaused ? <CirclePlay className="h-3.5 w-3.5" /> : <CirclePause className="h-3.5 w-3.5" />}
            {isPaused ? 'Продовжити' : 'Пауза'}
          </button>
        )}

        {status !== 'completed' && status !== 'draft' && (
          <button type="button" onClick={onEnd} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/15">
            <XCircle className="h-3.5 w-3.5" /> Завершити
          </button>
        )}
      </div>
    </header>
  );
};
