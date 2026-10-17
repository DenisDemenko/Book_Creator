import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Eye, Play, Radio, Shield, Users, Vote } from 'lucide-react';

type Phase = 'Lobby' | 'Intro' | 'Investigation' | 'Event' | 'Vote' | 'Finale';

type MockPlayer = {
  id: string;
  name: string;
  role: string;
  status: 'online' | 'attention' | 'offline';
  secretCount: number;
};

const players: MockPlayer[] = [
  { id: 'p1', name: 'Анна', role: 'Архівіст', status: 'online', secretCount: 2 },
  { id: 'p2', name: 'Тарас', role: 'Механік', status: 'online', secretCount: 1 },
  { id: 'p3', name: 'Ірина', role: 'Свідок', status: 'attention', secretCount: 3 },
  { id: 'p4', name: 'Макс', role: 'Гість', status: 'online', secretCount: 1 },
  { id: 'p5', name: 'Олег', role: 'Директор', status: 'online', secretCount: 2 },
  { id: 'p6', name: 'Леся', role: 'Журналіст', status: 'offline', secretCount: 2 },
];

const phases: Phase[] = ['Lobby', 'Intro', 'Investigation', 'Event', 'Vote', 'Finale'];
const statusLabel: Record<MockPlayer['status'], string> = {
  online: 'онлайн',
  attention: 'потребує уваги',
  offline: 'офлайн',
};

export const MafiaGameMasterView: React.FC<{ projectTitle?: string }> = ({ projectTitle = 'Ніч у старій обсерваторії' }) => {
  const [phase, setPhase] = useState<Phase>('Investigation');
  const [eventStarted, setEventStarted] = useState(false);
  const [voteOpen, setVoteOpen] = useState(false);

  const onlineCount = useMemo(() => players.filter((player) => player.status !== 'offline').length, []);

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-slate-950 p-4 text-slate-100 lg:p-6" data-story-experience="mafia-gm">
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-violet-300">Mafia Story Studio · Game Master</div>
          <h1 className="text-2xl font-bold text-white">{projectTitle}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Ведучий бачить стан гри, гравців, події, тригери й голосування. Секрети відкриваються лише в дозволеному контексті.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200"><Radio className="h-3.5 w-3.5" /> {onlineCount} онлайн</span>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:text-white"><Eye className="h-3.5 w-3.5" /> Як гравець</button>
        </div>
      </header>

      <nav className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Фази гри">
        {phases.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={phase === item} onClick={() => setPhase(item)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${phase === item ? 'border-violet-400/60 bg-violet-500/15 text-violet-100' : 'border-slate-800 bg-slate-900 text-slate-500 hover:text-slate-300'}`}>{item}</button>
        ))}
      </nav>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <div className="space-y-4">
          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4 lg:p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Поточна фаза</div>
                <h2 className="mt-1 text-lg font-bold text-white">{phase}</h2>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-300"><Clock3 className="h-4 w-4 text-slate-500" /> 18:42</div>
            </div>

            <div className={`rounded-xl border p-4 ${eventStarted ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`} aria-live="polite">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-200"><AlertTriangle className="h-3.5 w-3.5" /> Активна подія</div>
              <h3 className="text-base font-bold text-white">Зникло світло у східному крилі</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-300">Відкрити доказ E-04 для трьох ролей після двадцятої хвилини. Інші гравці бачать лише факт відключення.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => setEventStarted(true)} disabled={eventStarted} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-white disabled:cursor-default disabled:bg-emerald-100"><Play className="h-3.5 w-3.5" /> {eventStarted ? 'Подію запущено' : 'Запустити подію'}</button>
                <button type="button" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">Відкласти</button>
              </div>
            </div>
          </article>

          <div className="grid gap-3 md:grid-cols-3">
            <StatusCard icon={<Shield className="h-4 w-4" />} label="Тригери" title="3 готові" detail="1 очікує умови" />
            <StatusCard icon={<Vote className="h-4 w-4" />} label="Голосування" title={voteOpen ? 'Відкрите' : 'Не відкрито'} detail={voteOpen ? '5 із 6 голосів' : 'Фаза Vote попереду'} action={() => setVoteOpen((value) => !value)} pressed={voteOpen} />
            <StatusCard icon={<CheckCircle2 className="h-4 w-4" />} label="Фінал" title="3 гілки" detail="2 доступні зараз" />
          </div>

          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-white">Стрічка подій</h2><span className="text-[10px] text-slate-500">Live session</span></div>
            <div className="space-y-1.5">
              <TimelineItem time="18:37" title="Анна відкрила доказ E-02" detail="Видимість: Архівіст" />
              <TimelineItem time="18:33" title="Тарас активував тригер «Старий генератор»" detail="Видимість: Game Master" />
              <TimelineItem time="18:26" title="Гравцям відкрито східне крило" detail="Видимість: усі" />
            </div>
          </article>
        </div>

        <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-4 flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Учасники</div><h2 className="mt-1 text-sm font-bold text-white">Гравці</h2></div><Users className="h-4 w-4 text-slate-600" /></div>
          <div className="space-y-2">
            {players.map((player) => (
              <div key={player.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-bold text-white">{player.name}</div><div className="mt-0.5 text-[10px] text-slate-500">{player.role}</div></div><span className={`h-2.5 w-2.5 rounded-full ${player.status === 'online' ? 'bg-emerald-400' : player.status === 'attention' ? 'bg-amber-400' : 'bg-slate-700'}`} role="img" aria-label={statusLabel[player.status]} title={statusLabel[player.status]} /></div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500"><span>{player.secretCount} секрети</span><button type="button" className="font-semibold text-violet-300 hover:text-violet-200" aria-label={`Відкрити дані гравця ${player.name}`}>Відкрити</button></div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
};

const StatusCard: React.FC<{ icon: React.ReactNode; label: string; title: string; detail: string; action?: () => void; pressed?: boolean }> = ({ icon, label, title, detail, action, pressed }) => (
  <button type="button" onClick={action} aria-pressed={action ? pressed : undefined} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-left transition hover:border-slate-700">
    <div className="mb-3 flex items-center justify-between text-slate-500"><span className="text-[10px] font-bold uppercase tracking-[0.12em]">{label}</span>{icon}</div>
    <div className="text-sm font-bold text-white">{title}</div><div className="mt-1 text-[10px] text-slate-500">{detail}</div>
  </button>
);

const TimelineItem: React.FC<{ time: string; title: string; detail: string }> = ({ time, title, detail }) => (
  <div className="grid grid-cols-[52px_1fr] gap-3 rounded-xl px-2 py-2 hover:bg-slate-950"><div className="font-mono text-[10px] text-slate-600">{time}</div><div><div className="text-xs text-slate-300">{title}</div><div className="mt-0.5 text-[10px] text-slate-600">{detail}</div></div></div>
);
