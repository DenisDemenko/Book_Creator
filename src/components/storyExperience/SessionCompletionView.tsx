import React, { useState } from 'react';
import { Archive, ArrowLeft, CheckCircle2, FileText, NotebookPen, PlusCircle, Save, UsersRound } from 'lucide-react';

export interface SessionCompletionViewProps {
  title: string;
  kindLabel: string;
  duration?: string;
  participantCount?: number;
  summaryItems?: string[];
  participantExitLabel?: string;
  onReturnToProject?: () => void;
  onCreateNextSession?: () => void;
  onArchive?: () => void;
  onSaveNotes?: (notes: string) => void;
  onExportToBook?: () => void;
}

export const SessionCompletionView: React.FC<SessionCompletionViewProps> = ({
  title,
  kindLabel,
  duration = '18:42',
  participantCount = 1,
  summaryItems = ['Сесію завершено', 'Поточний стан зафіксовано', 'Participant view закрито'],
  participantExitLabel = 'Учасники можуть безпечно вийти із сесії.',
  onReturnToProject,
  onCreateNextSession,
  onArchive,
  onSaveNotes,
  onExportToBook,
}) => {
  const [notes, setNotes] = useState('');
  const archived = false;

  const archive = () => {
    if (!onArchive) return;
    onArchive();
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-slate-950 p-4 text-slate-100 lg:p-6" data-story-experience="session-completion">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Session completed</div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{kindLabel}: завершення сесії, перевірка виходу учасників, нотатки ведучого та підготовка архіву.</p>
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <article className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="mb-3 flex items-center gap-2 text-emerald-100"><CheckCircle2 className="h-5 w-5" /><h2 className="text-sm font-bold">Сесію завершено</h2></div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-500/15 bg-slate-950/40 p-3"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-200/60">Тривалість</div><div className="mt-1 font-mono text-sm text-white">{duration}</div></div>
                <div className="rounded-xl border border-emerald-500/15 bg-slate-950/40 p-3"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-200/60">Учасники</div><div className="mt-1 inline-flex items-center gap-1.5 text-sm text-white"><UsersRound className="h-4 w-4" /> {participantCount}</div></div>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-3 flex items-center gap-2"><FileText className="h-4 w-4 text-slate-500" /><h2 className="text-sm font-bold text-white">Підсумок</h2></div>
              <div className="space-y-2">
                {summaryItems.map((item) => <div key={item} className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />{item}</div>)}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-2 flex items-center gap-2"><NotebookPen className="h-4 w-4 text-violet-300" /><h2 className="text-sm font-bold text-white">Нотатки ведучого</h2></div>
              <p className="text-[11px] leading-5 text-slate-500">Це UX-контракт для moderator notes. Зберігання, encryption, permissions і retention визначає технічний шар.</p>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={7} placeholder="Що важливо зафіксувати після сесії…" className="mt-3 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-violet-500/50" />
              <button type="button" onClick={() => onSaveNotes?.(notes)} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"><Save className="h-3.5 w-3.5" /> Зберегти нотатки</button>
            </article>
          </div>

          <aside className="space-y-4">
            {onExportToBook && <article className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4"><h2 className="text-sm font-bold text-white">Перетворити досвід на книгу</h2><p className="mt-2 text-xs leading-5 text-cyan-100/75">Підготуйте історію та вигаданих героїв із захистом конфіденційності.</p><button type="button" onClick={onExportToBook} className="mt-3 w-full rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-950">Відкрити майстер експорту</button></article>}
            <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Вихід учасників</div>
              <p className="mt-2 text-xs leading-5 text-slate-300">{participantExitLabel}</p>
              <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-[10px] leading-4 text-cyan-100/80">Participant client після completed-state не повинен отримувати moderator-only дані або продовжувати надсилати session mutations.</div>
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Snapshot / archive</div>
              <button type="button" onClick={archive} disabled={!onArchive} aria-pressed={archived} className={`mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${archived ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-slate-800 bg-slate-950 text-slate-300'}`}><Archive className="h-3.5 w-3.5" /> {onArchive ? 'Перевірити події для архіву' : 'Архівація потребує підключення'}</button>
              <p className="mt-2 text-[10px] leading-4 text-slate-600">Фактичне створення snapshot, version id і archive record виконує Session Engine.</p>
            </article>

            <div className="space-y-2">
              <button type="button" onClick={onReturnToProject} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs font-semibold text-slate-300 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Повернутися до проєкту</button>
              <button type="button" onClick={onCreateNextSession} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-950"><PlusCircle className="h-3.5 w-3.5" /> Створити наступну сесію</button>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
};
