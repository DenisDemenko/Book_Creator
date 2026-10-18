import React, { useEffect, useState } from 'react';
import { completeSessionJournal, loadJournalReview, type JournalSession } from './sessionJournalClient';
import { eligibleEventPreviews, type SessionEventCandidate } from './eligibleSessionEvents';
import type { SessionExportKind } from './SessionExportToBookView';

interface ApprovedEventDraft { id: number; label: string; description: string; }
export interface CompletedSessionArchiveReviewProps {
  bookId: string;
  kind: SessionExportKind;
  title: string;
  sourceEvents?: SessionEventCandidate[];
  journal?: JournalSession;
  onClose: () => void;
  onSaved?: (id: string) => void;
}
/** Manual review is intentional: demo summaries, private notes and participant identities must never be auto-exported. */
export const CompletedSessionArchiveReview: React.FC<CompletedSessionArchiveReviewProps> = ({ bookId, kind, title, sourceEvents = [], journal, onClose, onSaved }) => {
  const [events, setEvents] = useState<ApprovedEventDraft[]>(() => { const eligible = eligibleEventPreviews(sourceEvents); return eligible.length ? eligible.map((e, i) => ({id:i+1,label:e.label,description:e.description})) : [{id:1,label:'',description:''}]; });
  const [journalEvents, setJournalEvents] = useState<Array<{id:string;label:string;description:string;selected:boolean}>>([]);
  const [journalError, setJournalError] = useState('');
  const [journalReady, setJournalReady] = useState(false);
  useEffect(() => {
    if (!journal) return;
    let disposed = false;
    (async () => {
      try {
        await completeSessionJournal(journal);
        const available = await loadJournalReview(journal);
        if (!disposed) {setJournalEvents(available.map(e=>({id:e.id,label:e.label,description:e.description,selected:false})));setJournalReady(true);}
      } catch(error){if(!disposed)setJournalError(error instanceof Error?error.message:'Не вдалося прочитати журнал');}
    })();
    return () => {disposed=true;};
  },[journal]);
  const [inviteEmail,setInviteEmail]=useState('');
  const [inviteMessage,setInviteMessage]=useState('');
  const invite=async()=>{
    if(!journal||!inviteEmail.trim())return;
    try{
      const response=await fetch('/api/story-experience/journals/'+encodeURIComponent(journal.sessionId)+'/invite',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId,email:inviteEmail.trim()})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'Помилка запрошення');
      setInviteMessage('Запрошення надіслано до облікового запису. Участь потребує підтвердження.');
      setInviteEmail('');void loadRoster();
    }catch(error){setInviteMessage(error instanceof Error?error.message:'Помилка');}
  };
  const [participantIds,setParticipantIds]=useState('');
  const [rosterError,setRosterError]=useState('');
  const [pendingCount,setPendingCount]=useState(0);
  const loadRoster=async()=>{
    if(!journal)return;
    try{
      const response=await fetch('/api/story-experience/journals/'+encodeURIComponent(journal.sessionId)+'/participants?bookId='+encodeURIComponent(bookId),{credentials:'same-origin',cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'Не вдалося перевірити учасників');
      setParticipantIds((Array.isArray(data.participantIds)?data.participantIds:[]).join('\n'));
      setPendingCount(Number(data.pendingCount)||0);setRosterError('');setConfirmed(false);
    }catch(error){setRosterError(error instanceof Error?error.message:'Помилка');}
  };
  useEffect(()=>{void loadRoster();},[journal?.sessionId,bookId]);
  const consentRoster=participantIds.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);
  const rosterValid=consentRoster.length>0 && consentRoster.length<=100 && consentRoster.every(id=>id.length<=128) && new Set(consentRoster).size===consentRoster.length;
  const [confirmed, setConfirmed] = useState(false);
  const [privacyPreview, setPrivacyPreview] = useState<{title:string;events:Array<{label:string;description:string}>;issues:Array<{field:string;category:string}>}|null>(null);
  const [previewBusy,setPreviewBusy]=useState(false);
  const [previewError,setPreviewError]=useState('');
  const draftFingerprint=JSON.stringify({title,events:events.map(e=>({label:e.label,description:e.description}))});
  const [reviewedFingerprint,setReviewedFingerprint]=useState('');
  const requestPrivacyPreview=async()=>{
    setPreviewBusy(true);setPreviewError('');setPrivacyPreview(null);
    try {
      const response=await fetch('/api/story-experience/privacy/preview',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId,title,events:events.map(({label,description})=>({label,description}))})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!Array.isArray(result.events))throw new Error(result.error||'Помилка перевірки приватності');
      setPrivacyPreview(result);setReviewedFingerprint(draftFingerprint);
    }catch(error){setPreviewError(error instanceof Error?error.message:'Помилка перевірки');}
    finally{setPreviewBusy(false);}
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const valid = events.length > 0 && events.every(e => e.label.trim().length > 0 && e.description.trim().length > 0);
  const save = async () => {
    if (!valid || !confirmed || !rosterValid || !journal || busy || reviewedFingerprint!==draftFingerprint || (privacyPreview?.issues.length??0)>0) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/story-experience/completed', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId, kind, title, sourceJournalId:journal?.sessionId, confirmedForBook: true, consentRequiredParticipantIds:consentRoster,
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
  return <section className="min-h-0 flex-1 overflow-y-auto bg-[#F4ECE1] p-4 text-[#2C1A12] lg:p-6">
    <div className="mx-auto max-w-3xl space-y-4">
      <header><h1 className="text-xl font-semibold">Перевірка матеріалу перед архівацією</h1><p className="mt-2 text-sm text-[#71645A]">{sourceEvents.length ? `Із ${sourceEvents.length} подій доступні для перегляду ${eligibleEventPreviews(sourceEvents).length}. Приховані й непогоджені події не передаються до форми.` : 'Джерело подій не підключено: введіть лише дозволені нейтральні події вручну.'} Справжні імена, приватні висловлювання та нотатки фасилітатора не копіюються сюди автоматично.</p></header>
      {journal && <article className="rounded-2xl border border-[#E0D4C7] bg-[#FFFCF8] p-4">
        <h2 className="text-sm font-semibold">Події завершеного журналу</h2>
        <p className="mt-2 text-xs text-[#71645A]">Приватні записи видно власнику для перевірки, але вони не переносяться в книгу без явного вибору, редагування та повторного підтвердження.</p>
        {journalError && <p role="alert" className="mt-2 text-xs text-[#A63A2B]">{journalError}</p>}
        {!journalReady && !journalError && <p role="status" className="mt-2 text-xs">Завершення та читання журналу…</p>}
        {journalEvents.map(entry => <label key={entry.id} className="mt-2 flex items-start gap-2 rounded-xl border border-[#E0D4C7] p-2 text-xs">
          <input type="checkbox" checked={entry.selected} onChange={e => {setConfirmed(false);setJournalEvents(prev=>prev.map(x=>x.id===entry.id?{...x,selected:e.target.checked}:x));}} />
          <span><strong>{entry.label}</strong><span className="mt-1 block text-[#71645A]">{entry.description}</span></span>
        </label>)}
        <button type="button" disabled={!journalEvents.some(e=>e.selected)} onClick={() => {setConfirmed(false);setEvents(previous => [...previous.filter(e=>e.label.trim()||e.description.trim()),...journalEvents.filter(e=>e.selected).map((e,i)=>({id:Date.now()+i,label:e.label,description:e.description}))]);setJournalEvents(previous=>previous.map(e=>({...e,selected:false})));}} className="mt-3 rounded-xl border border-[#CDBBAA] px-3 py-2 text-xs disabled:opacity-40">Додати обрані події до чернетки нижче</button>
      </article>}
      {saved ? <div role="status" className="rounded-2xl border border-[#A5C1A4] p-4 text-sm">Сесію збережено в архіві. ID: {saved}<button type="button" onClick={onClose} className="mt-3 block rounded-lg bg-[#2E1B12] px-3 py-2 text-[#FFF9F1]">Повернутися</button></div> : <>
        {events.map((event, index) => <div key={event.id} className="space-y-2 rounded-2xl border border-[#E0D4C7] bg-[#FFFCF8] p-4">
          <label className="block text-xs">Дозволена подія {index + 1}<input value={event.label} maxLength={200} onChange={e => { setConfirmed(false); setEvents(old => old.map(x => x.id === event.id ? {...x,label:e.target.value}:x)); }} placeholder="Нейтральна назва" className="mt-1 w-full rounded-xl border border-[#E0D4C7] bg-[#F4ECE1] p-2 text-sm"/></label>
          <label className="block text-xs">Перевірений опис<textarea rows={4} maxLength={10000} value={event.description} onChange={e => { setConfirmed(false); setEvents(old => old.map(x => x.id === event.id ? {...x,description:e.target.value}:x)); }} placeholder="Без персональних та чутливих деталей" className="mt-1 w-full rounded-xl border border-[#E0D4C7] bg-[#F4ECE1] p-2 text-sm"/></label>
          <button type="button" disabled={events.length===1} onClick={() => { setConfirmed(false); setEvents(old=>old.filter(x=>x.id!==event.id)); }} className="text-xs text-[#A63A2B] disabled:opacity-40">Прибрати подію</button>
        </div>)}
        <button type="button" disabled={events.length>=200} onClick={() => { setConfirmed(false); setEvents(old=>[...old,{id:Math.max(...old.map(x=>x.id))+1,label:'',description:''}]); }} className="rounded-xl border border-[#E0D4C7] px-3 py-2 text-xs">Додати подію</button>
        <div className="space-y-3 rounded-2xl border border-[#DBC6AE] p-4">
          <h2 className="font-semibold">Перевірка приватності</h2>
          <button type="button" disabled={!valid||previewBusy} onClick={()=>void requestPrivacyPreview()} className="rounded-xl border border-[#8B5937] px-3 py-2 text-xs disabled:opacity-40">{previewBusy?'Перевірка…':'Перевірити та порівняти'}</button>
          {previewError&&<p role="alert" className="text-sm text-[#A63A2B]">{previewError}</p>}
          {privacyPreview&&reviewedFingerprint===draftFingerprint&&<div className="space-y-3">
            <p className="text-xs">Знайдено потенційних прямих ідентифікаторів: {privacyPreview.issues.length}. Автоматичні заміни — лише пропозиція для ручного перегляду.</p>
            {privacyPreview.events.map((proposed,i)=><div key={i} className="grid gap-2 md:grid-cols-2">
              <div className="whitespace-pre-wrap rounded-xl border border-[#E0D4C7] p-2 text-xs"><strong>Початковий текст</strong><p>{events[i]?.label}</p><p>{events[i]?.description}</p></div>
              <div className="whitespace-pre-wrap rounded-xl border border-[#DBC6AE] p-2 text-xs"><strong>Пропоноване очищення</strong><p>{proposed.label}</p><p>{proposed.description}</p></div>
            </div>)}
            {privacyPreview.issues.length>0&&<button type="button" onClick={()=>{setConfirmed(false);setEvents(old=>old.map((e,i)=>({...e,label:privacyPreview.events[i]?.label??e.label,description:privacyPreview.events[i]?.description??e.description})));setPrivacyPreview(null);setReviewedFingerprint('');}} className="rounded-xl border border-[#8B5937] px-3 py-2 text-xs">Перенести пропозиції в редактор для ручної перевірки</button>}
          </div>}
          {reviewedFingerprint!==draftFingerprint&&<p className="text-xs text-[#825A20]">Після кожної зміни тексту виконайте перевірку повторно.</p>}
        </div>
        {journal&&<div className="rounded-2xl border border-[#E0D4C7] p-3 text-sm"><label className="block">Запросити зареєстрованого учасника за email<input type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-[#CDBBAA] bg-[#FFFCF8] p-2" placeholder="Електронна адреса облікового запису"/></label><button type="button" onClick={()=>void invite()} disabled={!inviteEmail.trim()} className="mt-2 rounded-xl border border-[#8B5937] px-3 py-2 text-xs">Надіслати запрошення</button>{inviteMessage&&<p role="status" className="mt-2 text-xs">{inviteMessage}</p>}</div>}
        {!journal && <p role="alert" className="text-xs text-[#825A20]">Для архівації необхідний завершений журнал із підтвердженою участю. Збереження тимчасово недоступне.</p>}
        <button type="button" disabled={!journal} onClick={()=>void loadRoster()} className="rounded-xl border border-[#8B5937] px-3 py-2 text-xs disabled:opacity-40">Оновити підтверджених учасників</button>
        {rosterError&&<p role="alert" className="text-[#A63A2B] text-xs">{rosterError}</p>}
        {pendingCount>0&&<p className="text-xs text-[#825A20]">Очікують підтвердження: {pendingCount}</p>}
        <label className="block rounded-2xl border border-[#E0D4C7] p-3 text-sm">Ідентифікатори учасників, згода яких обов'язкова (облікові записи, через кому або новий рядок)
          <textarea rows={3} value={participantIds} readOnly className="mt-2 w-full rounded-xl border border-[#CDBBAA] bg-[#FFFCF8] p-2" placeholder="ID авторизованих учасників — не їхні імена" />
          <span className="mt-1 block text-xs text-[#825A20]">Не включайте сторонніх осіб і не використовуйте вигадані ID. Усі зазначені учасники повинні особисто погодити матеріал. Список не можна вважати підтвердженим автоматично.</span>
        </label>
        <div role="note" className="rounded-2xl border border-[#E2C38D] p-3 text-xs text-[#825A20]">Система не може гарантувати анонімність: навіть без імен людину можуть упізнати за змістом. Для використання чужого досвіду потрібні належні дозволи.</div>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Я перевірив кожну подію, прибрав персональні деталі та маю дозвіл використовувати матеріал.</span></label>
        {error && <p role="alert" className="text-sm text-[#A63A2B]">{error}</p>}
        <div className="flex gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-[#E0D4C7] px-4 py-2 text-sm">Назад</button><button type="button" disabled={!valid||!confirmed||!rosterValid||!journal||busy||reviewedFingerprint!==draftFingerprint||(privacyPreview?.issues.length??0)>0} onClick={()=>void save()} className="rounded-lg bg-[#2E1B12] px-4 py-2 text-sm text-[#FFF9F1] disabled:opacity-40">{busy?'Збереження…':'Зберегти погоджені події'}</button></div>
      </>}
    </div>
  </section>;
};
