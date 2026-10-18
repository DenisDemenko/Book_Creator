import React, { useMemo, useState } from 'react';
import { BookOpenText, Dice5, History, NotebookPen, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';

type JourneyStep = { turn: number; from: number; to: number; dice: number; note?: string; type?: 'normal' | 'snake' | 'arrow' };

const defaultSteps: JourneyStep[] = [
  { turn: 5, from: 16, to: 9, dice: 0, type: 'snake', note: 'Повернення до теми контролю' },
  { turn: 6, from: 9, to: 15, dice: 6, type: 'normal' },
  { turn: 7, from: 15, to: 21, dice: 6, type: 'normal' },
];

export const LeelaSessionView: React.FC<{ title?: string; cellCount?: number; onJourneyStep?: (step: {turn:number;from:number;to:number;dice:number}) => void }> = ({ title = 'Подорож · сесія 04', cellCount = 72, onJourneyStep }) => {
  const [currentCell, setCurrentCell] = useState(21);
  const [steps, setSteps] = useState<JourneyStep[]>(defaultSteps);
  const [reflection, setReflection] = useState('');
  const [lastDice, setLastDice] = useState<number | null>(6);
  const [hostMode, setHostMode] = useState(false);

  const cells = useMemo(() => Array.from({ length: cellCount }, (_, index) => index + 1), [cellCount]);
  const currentPrompt = currentCell === 21
    ? 'Що я продовжую робити за інерцією, хоча вже знаю інший шлях?'
    : 'Що ця точка маршруту показує мені про мій теперішній запит?';

  const rollMockDice = () => {
    const dice = Math.floor(Math.random() * 6) + 1;
    const from = currentCell;
    const to = Math.min(cellCount, currentCell + dice);
    setLastDice(dice);
    setCurrentCell(to);
    const turn = steps.length + 1;
    setSteps((items) => [...items, { turn, from, to, dice, type: 'normal' }]);
    onJourneyStep?.({turn,from,to,dice});
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-slate-950 p-4 text-slate-100 lg:p-6" data-story-experience="leela">
      <header className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Leela Studio</div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Ruleset і Board Pack не зашиті в UI. Поле рендериться динамічно, а акцент залишається на поточній клітині, рефлексії та історії маршруту.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={hostMode} onClick={() => setHostMode((value) => !value)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${hostMode ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100' : 'border-slate-800 bg-slate-900 text-slate-300'}`}><ShieldCheck className="h-3.5 w-3.5" /> Host mode</button>
          <button type="button" onClick={rollMockDice} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950"><Dice5 className="h-3.5 w-3.5" /> Кинути кубик</button>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 sm:p-4">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Board Pack</div><h2 className="mt-1 text-sm font-bold text-white">Класичний маршрут · {cellCount} клітини</h2></div><button type="button" className="inline-flex self-start items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[10px] text-slate-400"><RotateCcw className="h-3 w-3" /> Fit</button></div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(44px, 1fr))' }} role="grid" aria-label={`Поле Leela, ${cellCount} клітин`}>
            {cells.map((cell) => (
              <button
                key={cell}
                type="button"
                role="gridcell"
                aria-current={cell === currentCell ? 'step' : undefined}
                aria-label={`Клітина ${cell}${cell === currentCell ? ', поточна' : ''}`}
                onClick={() => setCurrentCell(cell)}
                className={`relative aspect-square min-h-11 rounded-lg border text-[10px] font-semibold transition sm:min-h-12 ${cell === currentCell ? 'border-emerald-300 bg-emerald-400/15 text-white ring-2 ring-emerald-400/10' : 'border-slate-800 bg-slate-950 text-slate-500 hover:border-slate-700'}`}
              >
                {cell}
                {cell === currentCell && <span className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-white shadow" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <article className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4" aria-live="polite">
            <div className="mb-2 flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-200/70">Поточна клітина</div><h2 className="mt-1 text-lg font-bold text-white">{currentCell} · Усвідомлення</h2></div>{lastDice && <span className="rounded-xl border border-emerald-300/20 bg-slate-950/50 px-3 py-2 text-sm font-bold text-emerald-100" aria-label={`Останній кидок: ${lastDice}`}>🎲 {lastDice}</span>}</div>
            <p className="text-xs leading-5 text-emerald-50/80">У цій точці рішення важливіше за швидкість руху. Зупиніться на змісті клітини перед наступним кидком.</p>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-300"><Sparkles className="h-3.5 w-3.5" /> Питання для рефлексії</div>
            <p className="text-sm leading-6 text-slate-200">{currentPrompt}</p>
            <label className="mt-4 block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Моя нотатка</span><textarea value={reflection} onChange={(event) => setReflection(event.target.value)} rows={5} placeholder="Запишіть думку…" className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-emerald-500/50" /></label>
            <button type="button" className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950"><NotebookPen className="h-3.5 w-3.5" /> Зберегти нотатку</button>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-3 flex items-center justify-between"><div className="inline-flex items-center gap-2 text-xs font-bold text-white"><History className="h-4 w-4 text-slate-500" /> Маршрут</div><span className="text-[10px] text-slate-500">{steps.length} ходів</span></div>
            <div className="space-y-2">
              {[...steps].reverse().slice(0, 5).map((step) => (
                <div key={`${step.turn}-${step.from}-${step.to}`} className="rounded-xl border border-slate-800 bg-slate-950 p-3"><div className="flex items-center justify-between text-[10px]"><span className="font-bold text-slate-300">Хід {step.turn}</span><span className={step.type === 'snake' ? 'text-rose-300' : 'text-slate-500'}>{step.type === 'snake' ? 'змія' : `🎲 ${step.dice}`}</span></div><div className="mt-1 text-xs text-slate-400">{step.from} → {step.to}</div>{step.note && <div className="mt-1 text-[10px] text-slate-600">{step.note}</div>}</div>
              ))}
            </div>
          </article>

          {hostMode && (
            <article className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4"><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-200"><BookOpenText className="h-3.5 w-3.5" /> Приватна нотатка ведучого</div><textarea rows={4} aria-label="Приватна нотатка ведучого" placeholder="Цю нотатку бачить лише ведучий…" className="w-full rounded-xl border border-amber-500/20 bg-slate-950/50 p-3 text-xs text-slate-200 outline-none placeholder:text-slate-600" /></article>
          )}
        </aside>
      </div>
    </section>
  );
};
