import React from 'react';
import { ArrowLeft, Bell, CirclePause, DoorOpen, Eye, LockKeyhole, Radio, ShieldCheck, Wifi, XCircle } from 'lucide-react';
import { SessionHeader, type SessionConnectionState, type SessionStatus } from './SessionHeader';
import { SessionRecoveryNotice } from './SessionRecoveryNotice';
import { VisibilityControl, type VisibilityMode } from './VisibilityControl';

export type ParticipantSessionKind = 'mafia' | 'constellation' | 'leela';

export interface ParticipantSessionPreviewProps {
  kind: ParticipantSessionKind;
  title: string;
  phase?: string;
  status?: SessionStatus;
  connection?: SessionConnectionState;
  elapsed?: string;
  roleLabel?: string;
  visibility?: VisibilityMode;
  primaryTitle: string;
  primaryText: string;
  secondaryText?: string;
  actionLabel?: string;
  exitLabel?: string;
  pendingLocalActions?: number;
  onPrimaryAction?: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onExit?: () => void;
  onRetryConnection?: () => void;
  onDismissRestored?: () => void;
}

const kindMeta: Record<ParticipantSessionKind, { eyebrow: string; accentClass: string }> = {
  mafia: { eyebrow: 'Player session', accentClass: 'text-violet-300' },
  constellation: { eyebrow: 'Participant session', accentClass: 'text-cyan-300' },
  leela: { eyebrow: 'Journey session', accentClass: 'text-emerald-300' },
};

/**
 * Спільний mobile-first preview того, що реально бачить учасник live-сесії.
 * Компонент не вирішує права доступу самостійно: server/session layer передає
 * вже дозволені дані, а UX лише показує їх у participant-safe форматі.
 */
export const ParticipantSessionPreview: React.FC<ParticipantSessionPreviewProps> = ({
  kind,
  title,
  phase = 'Live',
  status = 'live',
  connection = 'online',
  elapsed = '00:00',
  roleLabel = 'Учасник',
  visibility = 'ROLE_BASED',
  primaryTitle,
  primaryText,
  secondaryText,
  actionLabel,
  exitLabel = 'Вийти із сесії',
  pendingLocalActions = 0,
  onPrimaryAction,
  onStart,
  onPause,
  onResume,
  onExit,
  onRetryConnection,
  onDismissRestored,
}) => {
  const meta = kindMeta[kind];
  const isPaused = status === 'paused';
  const isCompleted = status === 'completed';
  const canAct = status === 'live' && connection !== 'offline' && connection !== 'reconnecting';

  return (
    <section className="mx-auto w-full max-w-md overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950 text-slate-100 shadow-2xl shadow-black/30" data-story-experience="participant-preview" data-session-kind={kind} data-session-status={status}>
      <SessionHeader
        title={title}
        phase={phase}
        status={status}
        participants={1}
        connection={connection}
        elapsed={elapsed}
        onStart={onStart}
        onPause={onPause}
        onResume={onResume}
        onEnd={onExit}
      />

      <div className="space-y-4 p-4 sm:p-5">
        <SessionRecoveryNotice connection={connection} pendingLocalActions={pendingLocalActions} onRetry={onRetryConnection} onDismissRestored={onDismissRestored} />

        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${meta.accentClass}`}>{meta.eyebrow}</div>
            <div className="mt-1 text-sm font-bold text-white">{roleLabel}</div>
          </div>
          <VisibilityControl value={visibility} compact disabled />
        </div>

        {isCompleted ? (
          <article className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4" role="status">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-300">Сесію завершено</div>
            <h2 className="mt-2 text-lg font-bold text-white">Дякуємо за участь</h2>
            <p className="mt-2 text-sm leading-6 text-emerald-50/75">Спільний стан більше не змінюється. Локальні нотатки можна зберегти або закрити разом із сесією.</p>
          </article>
        ) : (
          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4" aria-live="polite">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><Eye className="h-3.5 w-3.5" /> Видно зараз</div>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-950 px-2 py-1 text-[9px] text-slate-500"><ShieldCheck className="h-3 w-3" /> participant-safe</span>
            </div>
            <h2 className="text-lg font-bold text-white">{primaryTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">{primaryText}</p>
            {secondaryText && <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-500">{secondaryText}</p>}
            {actionLabel && (
              <button type="button" onClick={onPrimaryAction} disabled={!canAct} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500">
                <Bell className="h-4 w-4" /> {actionLabel}
              </button>
            )}
          </article>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">З’єднання</div><div className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-300"><Wifi className="h-3.5 w-3.5" /> {connection}</div></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">Час</div><div className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-slate-300"><Radio className="h-3.5 w-3.5" /> {elapsed}</div></div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-[10px] leading-4 text-slate-500">
          <div className="mb-1 inline-flex items-center gap-1.5 font-bold uppercase tracking-[0.12em] text-slate-500"><LockKeyhole className="h-3.5 w-3.5" /> Видимість</div>
          Приватні, секретні або moderator-only поля не повинні навіть потрапляти до цього preview. UI не приховує серверні дані постфактум — він отримує вже дозволений payload.
        </div>

        {!isCompleted && status !== 'lobby' && status !== 'draft' && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={isPaused ? onResume : onPause}
              disabled={connection === 'offline' || connection === 'reconnecting'}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs font-semibold text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isPaused ? <ArrowLeft className="h-3.5 w-3.5" /> : <CirclePause className="h-3.5 w-3.5" />}
              {isPaused ? 'Повернутися' : 'Пауза'}
            </button>
            <button type="button" onClick={onExit} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs font-semibold text-rose-200">
              {kind === 'constellation' ? <DoorOpen className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {exitLabel}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
