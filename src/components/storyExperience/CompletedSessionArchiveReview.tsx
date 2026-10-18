import React, { useState } from 'react';
import type { SessionExportKind } from './SessionExportToBookView';

interface ApprovedEventDraft { id: number; label: string; description: string; }
export interface CompletedSessionArchiveReviewProps {
  bookId: string;
  kind: SessionExportKind;
  title: string;
  onClose: () => void;
  onSaved?: (id: string) => void;
}
/** Manual review is intentional: demo summaries, private notes and participant identities must never be auto-exported. */
export const CompletedSessionArchiveReview: React.FC<CompletedSessionArchiveReviewProps> = ({ bookId, kind, title, onClose, onSaved }) => {
  const [events, setEvents] = useState<ApprovedEventDraft[]>([{ id: 1, label: '', description: '' }]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const valid = events.length > 0 && events.every(e => e.label.trim().length > 0 && e.description.trim().length > 0);
  const save = async () => {
    if (!valid || !confirmed || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/story-experience/completed', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId, kind, title, confirmedForBook: true,
          events: events.map(e => ({ label: e.label.trim(), description: e.description.trim(), approvedForBook: true, visibility: 'approved' })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.sessionId !== 'string') throw new Error(data.error || 'Не вдалося зберегти архів.');
      setSaved(data.sessionId);
      onSaved?.(data.sessionId);
    } catch (err) { setError(err instanceof Error ? err.message : 'Помилка архівування'); }
    finally { setBusy(false); }
  };
  return <section className="min-h-0 flex-1 overflow-y-auto bg-slate-950 p-4 text-slate-100 lg:p-6">
    <div className="mx-auto max-w-3xl space-y-4">
      <header><h1 className="text-xl font-semibold">Перевірка матеріалу перед архівацією</h1><p className="mt-2 text-sm text-slate-400">Введіть лише ті події, на які є дозвіл. Справжні імена, приватні висловлювання та нотатки фасилітатора не копіюються сюди автоматично.</p></header>
      {saved ? <div role="status" className="rounded-xl border border-emerald-700 p-4 text-sm">Сесію збережено в архіві. ID: {saved}<button type="button" onClick={onClose} className="mt-3 block rounded-lg bg-slate-100 px-3 py-2 text-slate-950">Повернутися</button></div> : <>
        {events.map((event, index) => <div key={event.id} className="space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <label className="block text-xs">Дозволена подія {index + 1}<input value={event.label} maxLength={200} onChange={e => setEvents(old => old.map(x => x.id === event.id ? {...x,label:e.target.value}:x))} placeholder="Нейтральна назва" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"/></label>
          <label className="block text-xs">Перевірений опис<textarea rows={4} maxLength={10000} value={event.description} onChange={e => setEvents(old => old.map(x => x.id === event.id ? {...x,description:e.target.value}:x))} placeholder="Без персональних та чутливих деталей" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"/></label>
          <button type="button" disabled={events.length===1} onClick={() => setEvents(old=>old.filter(x=>x.id!==event.id))} className="text-xs text-rose-200 disabled:opacity-40">Прибрати подію</button>
        </div>)}
        <button type="button" disabled={events.length>=200} onClick={() => setEvents(old=>[...old,{id:Math.max(...old.map(x=>x.id))+1,label:'',description:''}])} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Додати подію</button>
        <div role="note" className="rounded-xl border border-amber-600/50 p-3 text-xs text-amber-100">Система не може гарантувати анонімність: навіть без імен людину можуть упізнати за змістом. Для використання чужого досвіду потрібні належні дозволи.</div>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Я перевірив кожну подію, прибрав персональні деталі та маю дозвіл використовувати матеріал.</span></label>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <div className="flex gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Назад</button><button type="button" disabled={!valid||!confirmed||busy} onClick={()=>void save()} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-950 disabled:opacity-40">{busy?'Збереження…':'Зберегти погоджені події'}</button></div>
      </>}
    </div>
  </section>;
};
