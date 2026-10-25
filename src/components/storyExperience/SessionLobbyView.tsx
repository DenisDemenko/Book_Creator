import React, { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCopy, Link2, LockKeyhole, Play, ShieldCheck, UserPlus, Users, XCircle } from 'lucide-react';
import { VisibilityControl, type VisibilityMode } from './VisibilityControl';

export type LobbyParticipantStatus = 'ready' | 'not-ready' | 'invited' | 'offline';

export interface LobbyParticipant {
  id: string;
  name: string;
  role: string;
  status: LobbyParticipantStatus;
  required?: boolean;
}

export interface SessionLobbyViewProps {
  title: string;
  joinCode?: string;
  inviteLinkLabel?: string;
  participants?: LobbyParticipant[];
  visibility?: VisibilityMode;
  minReady?: number;
  onStart?: () => void;
  onInvite?: () => void;
  onCopyCode?: () => void;
  onCopyLink?: () => void;
}

const statusMeta: Record<LobbyParticipantStatus, { label: string; className: string }> = {
  ready: { label: 'Готовий', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' },
  'not-ready': { label: 'Не готовий', className: 'border-amber-500/30 bg-amber-500/10 text-amber-200' },
  invited: { label: 'Запрошено', className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200' },
  offline: { label: 'Офлайн', className: 'border-slate-700 bg-slate-900 text-slate-500' },
};

const defaultParticipants: LobbyParticipant[] = [
  { id: 'host', name: 'Ведучий', role: 'Moderator', status: 'ready', required: true },
  { id: 'p1', name: 'Анна', role: 'Participant', status: 'ready', required: true },
  { id: 'p2', name: 'Тарас', role: 'Participant', status: 'not-ready', required: true },
  { id: 'p3', name: 'Ірина', role: 'Observer', status: 'invited' },
];

export const SessionLobbyView: React.FC<SessionLobbyViewProps> = ({
  title,
  joinCode = 'NOVA-4821',
  inviteLinkLabel = 'Посилання на сесію',
  participants = defaultParticipants,
  visibility = 'ROLE_BASED',
  minReady = 2,
  onStart,
  onInvite,
  onCopyCode,
  onCopyLink,
}) => {
  const [localParticipants, setLocalParticipants] = useState(participants);
  const readyCount = useMemo(() => localParticipants.filter((item) => item.status === 'ready').length, [localParticipants]);
  const requiredNotReady = useMemo(() => localParticipants.filter((item) => item.required && item.status !== 'ready'), [localParticipants]);
  const canStart = readyCount >= minReady && requiredNotReady.length === 0;

  const toggleReady = (id: string) => {
    setLocalParticipants((items) => items.map((item) => item.id === id && item.status !== 'invited' && item.status !== 'offline'
      ? { ...item, status: item.status === 'ready' ? 'not-ready' : 'ready' }
      : item));
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-slate-950 p-4 text-slate-100 lg:p-6" data-story-experience="session-lobby">
      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">Session Lobby</div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Перевірте склад, ролі, готовність і правила видимості до запуску. Кнопка старту активується лише коли обов’язкові учасники готові.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onInvite} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"><UserPlus className="h-3.5 w-3.5" /> Запросити</button>
          <button type="button" onClick={onStart} disabled={!canStart} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"><Play className="h-3.5 w-3.5" /> Почати сесію</button>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Учасники</div><h2 className="mt-1 text-sm font-bold text-white">{readyCount} готові · {localParticipants.length} у Lobby</h2></div>
              <Users className="h-4 w-4 text-slate-600" />
            </div>
            <div className="space-y-2">
              {localParticipants.map((participant) => {
                const meta = statusMeta[participant.status];
                const interactive = participant.status === 'ready' || participant.status === 'not-ready';
                return (
                  <div key={participant.id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0"><div className="flex items-center gap-2"><div className="truncate text-xs font-bold text-white">{participant.name}</div>{participant.required && <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[9px] font-semibold text-violet-200">обов’язковий</span>}</div><div className="mt-1 text-[10px] text-slate-500">{participant.role}</div></div>
                    <button type="button" onClick={() => interactive && toggleReady(participant.id)} disabled={!interactive} aria-pressed={participant.status === 'ready'} className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${meta.className} disabled:cursor-default`}>
                      {participant.status === 'ready' ? <CheckCircle2 className="h-3 w-3" /> : participant.status === 'not-ready' ? <XCircle className="h-3 w-3" /> : null}
                      {meta.label}
                    </button>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Умови старту</div>
            <div className="mt-3 space-y-2 text-xs">
              <Condition ok={readyCount >= minReady} text={`Щонайменше ${minReady} учасники готові`} />
              <Condition ok={requiredNotReady.length === 0} text="Усі обов’язкові учасники готові" />
              <Condition ok text="Ролі призначені" />
              <Condition ok text="Visibility policy визначена" />
            </div>
          </article>
        </div>

        <aside className="space-y-4">
          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Вхід у сесію</div>
            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">Код</div>
              <div className="mt-1 flex items-center justify-between gap-2"><code className="text-sm font-bold tracking-[0.16em] text-white">{joinCode}</code><button type="button" onClick={onCopyCode} aria-label="Копіювати код" className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><ClipboardCopy className="h-3.5 w-3.5" /></button></div>
            </div>
            <button type="button" onClick={onCopyLink} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300"><Link2 className="h-3.5 w-3.5" /> {inviteLinkLabel}</button>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <VisibilityControl value={visibility} disabled />
            <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-[10px] leading-4 text-cyan-100/80"><ShieldCheck className="mb-2 h-4 w-4" /> Lobby показує правила доступу, але не вирішує їх. Авторитетні ролі та visibility мають приходити із Session/Permission layer.</div>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-[10px] leading-4 text-slate-500"><LockKeyhole className="mb-2 h-4 w-4" /> Join code і invite link у цьому UX є display contract. Генерація токенів, expiry, одноразові посилання та перевірка доступу — задача технічного шару.</article>
        </aside>
      </div>
    </section>
  );
};

const Condition: React.FC<{ ok: boolean; text: string }> = ({ ok, text }) => (
  <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${ok ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100' : 'border-amber-500/20 bg-amber-500/10 text-amber-100'}`}>
    {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}<span>{text}</span>
  </div>
);
