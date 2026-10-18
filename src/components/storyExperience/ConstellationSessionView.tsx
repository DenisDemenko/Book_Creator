import React, { useMemo, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, CircleDot, Maximize2, Pause, RotateCcw, Save, UsersRound } from 'lucide-react';

type FigureKind = 'person' | 'object' | 'abstract' | 'empty';

type FigureItem = {
  id: string;
  label: string;
  kind: FigureKind;
  x: number;
  y: number;
  rotation: number;
  state: string;
};

const initialFigures: FigureItem[] = [
  { id: 'self', label: 'Я', kind: 'person', x: 20, y: 28, rotation: 30, state: 'Напруження' },
  { id: 'father', label: 'Батько', kind: 'person', x: 56, y: 20, rotation: 210, state: 'Дистанція' },
  { id: 'work', label: 'Робота', kind: 'abstract', x: 70, y: 58, rotation: 290, state: 'Притягання' },
  { id: 'fear', label: 'Страх', kind: 'abstract', x: 38, y: 66, rotation: 40, state: 'Стиснення' },
];

const stages = ['Підготовка', 'Запит', 'Представники', 'Розстановка', 'Рух', 'Рішення', 'Вихід з ролей', 'Завершення'];

export const ConstellationSessionView: React.FC<{ title?: string; onSnapshot?: (snapshot: { index:number; timestamp:string }) => void }> = ({ title = 'Діалог поколінь', onSnapshot }) => {
  const [figures, setFigures] = useState<FigureItem[]>(initialFigures);
  const [selectedId, setSelectedId] = useState('self');
  const [stage, setStage] = useState(3);
  const [snapshots, setSnapshots] = useState(['11:24', '11:37', '11:48']);
  const [paused, setPaused] = useState(false);
  const selected = useMemo(() => figures.find((item) => item.id === selectedId) || figures[0], [figures, selectedId]);

  const updateSelected = (patch: Partial<FigureItem>) => {
    setFigures((items) => items.map((item) => (item.id === selectedId ? { ...item, ...patch } : item)));
  };

  const saveSnapshot = () => {
    const now = new Date();
    const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setSnapshots((items) => [...items, timestamp]);
    onSnapshot?.({ index: snapshots.length + 1, timestamp });
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-slate-950 p-4 text-slate-100 lg:p-6" data-story-experience="constellation">
      <header className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">Constellation Studio</div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Поле — головний робочий простір. Фігури, напрямок, дистанція та snapshots завжди видимі у контексті сесії.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPaused((value) => !value)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300"><Pause className="h-3.5 w-3.5" /> {paused ? 'Продовжити' : 'Пауза'}</button>
          <button type="button" onClick={saveSnapshot} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950"><Camera className="h-3.5 w-3.5" /> Snapshot</button>
        </div>
      </header>

      <nav className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Етапи сесії">
        {stages.map((item, index) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={stage === index}
            onClick={() => setStage(index)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold ${stage === index ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-100' : 'border-slate-800 bg-slate-900 text-slate-500'}`}
          >
            {index + 1}. {item}
          </button>
        ))}
      </nav>

      {stage === 6 && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
          <div className="flex items-start gap-3">
            <UsersRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
            <div>
              <div className="text-sm font-bold text-amber-50">Вихід з ролей</div>
              <p className="mt-1 text-xs leading-5 text-amber-100/75">Перед завершенням сесії кожен учасник має явно вийти зі своєї ролі. Цей крок не ховається в меню і не пропускається автоматично.</p>
            </div>
          </div>
          <button type="button" onClick={() => setStage(7)} className="shrink-0 rounded-xl bg-amber-100 px-4 py-2 text-xs font-bold text-slate-950">Завершити вихід з ролей</button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="relative h-[62vh] min-h-[460px] max-h-[680px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(71,85,105,.38) 1px, transparent 0)', backgroundSize: '24px 24px' }}>
            <div className="absolute left-3 top-3 z-10 flex gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-1 shadow-xl">
              <button type="button" aria-label="Зменшити масштаб" className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800">−</button>
              <button type="button" aria-label="Поточний масштаб 100 відсотків" className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-300">100%</button>
              <button type="button" aria-label="Збільшити масштаб" className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800">＋</button>
              <button type="button" aria-label="Вмістити все поле" className="rounded-lg px-2 py-1.5 text-slate-400 hover:bg-slate-800" title="Вмістити поле"><Maximize2 className="h-3.5 w-3.5" /></button>
            </div>

            {figures.map((figure) => (
              <button
                type="button"
                key={figure.id}
                onClick={() => setSelectedId(figure.id)}
                aria-pressed={selectedId === figure.id}
                aria-label={`${figure.label}, ${figure.state}, напрям ${figure.rotation} градусів`}
                className={`absolute grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-center text-[10px] font-bold shadow-2xl transition sm:h-20 sm:w-20 ${selectedId === figure.id ? 'border-cyan-300 bg-cyan-500/15 text-cyan-50 ring-4 ring-cyan-500/10' : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500'}`}
                style={{ left: `${figure.x}%`, top: `${figure.y}%` }}
              >
                <span className="absolute -top-5 text-cyan-300" style={{ transform: `rotate(${figure.rotation}deg)` }} aria-hidden="true">▲</span>
                <span>{figure.label}</span>
              </button>
            ))}

            <div className="absolute bottom-3 right-3 hidden h-24 w-36 rounded-xl border border-slate-700 bg-slate-950/90 p-2 shadow-xl sm:block" aria-hidden="true">
              <div className="text-[9px] font-bold uppercase tracking-wide text-slate-600">Мінікарта</div>
              <div className="relative mt-2 h-14 rounded-md bg-slate-900">
                {figures.map((figure) => <span key={figure.id} className="absolute h-2 w-2 rounded-full bg-slate-500" style={{ left: `${figure.x}%`, top: `${figure.y}%` }} />)}
              </div>
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Snapshots сесії">
            {snapshots.map((time, index) => (
              <button key={`${time}-${index}`} type="button" className={`min-w-28 rounded-xl border p-3 text-left ${index === snapshots.length - 1 ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-800 bg-slate-900'}`}><div className="text-[10px] font-bold text-slate-300">Snapshot {String(index + 1).padStart(2, '0')}</div><div className="mt-1 text-[10px] text-slate-500">{time}</div></button>
            ))}
          </div>
        </div>

        <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-4 flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Inspector</div><h2 className="mt-1 text-sm font-bold text-white">{selected?.label}</h2></div><CircleDot className="h-4 w-4 text-slate-600" /></div>
          {selected && (
            <div className="space-y-4">
              <Field label="Назва"><input value={selected.label} onChange={(event) => updateSelected({ label: event.target.value })} className="input" /></Field>
              <Field label="Тип"><select value={selected.kind} onChange={(event) => updateSelected({ kind: event.target.value as FigureKind })} className="input"><option value="person">Людина</option><option value="object">Об’єкт</option><option value="abstract">Абстракція</option><option value="empty">Порожнє місце</option></select></Field>
              <Field label="Напрям"><input type="range" min="0" max="359" value={selected.rotation} onChange={(event) => updateSelected({ rotation: Number(event.target.value) })} className="w-full" /><div className="mt-1 text-[10px] text-slate-500">{selected.rotation}°</div></Field>
              <Field label="Стан"><input value={selected.state} onChange={(event) => updateSelected({ state: event.target.value })} className="input" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => updateSelected({ x: Math.max(5, selected.x - 5) })} className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300"><ChevronLeft className="h-3.5 w-3.5" /> Лівіше</button>
                <button type="button" onClick={() => updateSelected({ x: Math.min(95, selected.x + 5) })} className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300">Правіше <ChevronRight className="h-3.5 w-3.5" /></button>
              </div>
              <button type="button" onClick={() => setFigures(initialFigures)} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-400"><RotateCcw className="h-3.5 w-3.5" /> Повернути початкову розстановку</button>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] leading-5 text-amber-100/80"><UsersRound className="mb-2 h-4 w-4" /> Учасник має мати окрему дію «Пауза / Вийти». На етапі «Вихід з ролей» завершення сесії не можна сховати в меню.</div>
              <button type="button" className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950"><Save className="h-3.5 w-3.5" /> Зберегти стан</button>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
};

const Field: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</span>{children}</label>;
