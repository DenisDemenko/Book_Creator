import React, { useEffect, useState } from 'react';

type Registration = { id: string; name: string; contact: string; role: 'participant'|'representative'|'observer'; status: 'pending'|'confirmed'|'waitlist'; };
type SavedEvent = {id:string;theme:string;date:string;time:string;venue:string;address:string;price:string;announcement:string;registrations:Registration[]};
const sample = `✨ ГРУПОВІ РОЗСТАНОВКИ ✨
ТЕМА: «ПРОЯВЛЕНІСТЬ»
Четвер, 22 жовтня
Початок о 18:00
Ретритний центр «Цілісність»
м. Ужгород, вул. Фединця, 25а
Вхід для учасників — 250 грн`;

function extractAnnouncement(raw: string) {
  const theme = raw.match(/ТЕМА:\s*[«"“]?([^»"”\n]+)/i)?.[1]?.trim() || '';
  const date = raw.match(/(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)/i)?.[0] || '';
  const time = raw.match(/(?:о|початок о)\s*(\d{1,2}:\d{2})/i)?.[1] || '';
  const price = raw.match(/(\d+)\s*грн/i)?.[1] || '';
  const address = raw.match(/(?:м\.|місто)\s*[^\n]+/i)?.[0]?.trim() || '';
  const venue = raw.match(/(?:центр|студія|простір)\s*[«"“][^»"”]+[»"”]/i)?.[0]?.trim() || '';
  return { theme, date, time, price, address, venue };
}

export const ConstellationEventPlanner: React.FC<{bookId?:string}> = ({bookId}) => {
  const [announcement, setAnnouncement] = useState(sample);
  const [form, setForm] = useState(() => extractAnnouncement(sample));
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<Registration['role']>('participant');
  const [message, setMessage] = useState('');
  const [savedEventId, setSavedEventId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<SavedEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const loadEvents = async () => {
    if (!bookId) return;
    setLoadingEvents(true);
    try {
      const result = await fetch('/api/constellation/events?bookId='+encodeURIComponent(bookId),{credentials:'same-origin'});
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || 'Не вдалося завантажити події');
      setEvents(data.events ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не вдалося завантажити події');
    } finally {setLoadingEvents(false);}
  };
  useEffect(() => { void loadEvents(); }, [bookId]);
  const openEvent = (item: SavedEvent) => {
    setSavedEventId(item.id);
    setForm({theme:item.theme,date:item.date,time:item.time,venue:item.venue,address:item.address,price:item.price});
    setAnnouncement(item.announcement);
    setRegistrations(item.registrations);
    setMessage('Відкрито подію для редагування.');
  };
  const saveEvent = async () => {
    if (!bookId || !form.theme.trim()) { setMessage('Вкажіть тему та відкрийте власну книгу.'); return; }
    setBusy(true);
    try {
      const result = await fetch(savedEventId ? '/api/constellation/events/'+encodeURIComponent(savedEventId) : '/api/constellation/events', {
        method:savedEventId ? 'PATCH' : 'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...form,announcement,bookId})
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || 'Сервер відхилив збереження');
      setSavedEventId(data.event.id);
      setRegistrations(data.event.registrations ?? []);
      await loadEvents();
      setMessage('Подію збережено на сервері.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не вдалося зберегти подію');
    } finally { setBusy(false); }
  };
  const addRegistration = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !contact.trim() || !savedEventId || !bookId) {
      setMessage('Спочатку збережіть подію, потім додайте заявку.');
      return;
    }
    setBusy(true);
    try {
      const result = await fetch('/api/constellation/events/'+encodeURIComponent(savedEventId)+'/registrations',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({bookId,name,contact,role})
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || 'Не вдалося створити заявку');
      setRegistrations(data.event.registrations);
      setName(''); setContact(''); setMessage('Заявку збережено на сервері.');
    } catch(error) { setMessage(error instanceof Error ? error.message : 'Помилка заявки'); }
    finally {setBusy(false);}
  };
  return <section className="space-y-4 rounded-2xl border border-[#E0D4C7] bg-[#FFFCF8] p-4 text-[#2C1A12]" aria-label="Організація групової події">
    <header><h2 className="text-lg font-bold">Організація групової зустрічі</h2><p className="text-sm text-[#71645A]">Перший етап Constellation Studio 1.1 — чернетка події та локальний список заявок.</p></header>
    <div className="rounded-xl border border-[#E0D4C7] bg-[#F4ECE1] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Мої збережені події</h3><button type="button" onClick={() => void loadEvents()} disabled={loadingEvents} className="rounded-lg border border-[#D9CABC] bg-white px-3 py-1 text-xs">Оновити</button></div>
      {events.length===0 ? <p className="text-sm text-[#71645A]">Збережених подій поки немає або потрібна авторизація.</p> :
        <div className="grid gap-2 sm:grid-cols-2">{events.map(item=><button key={item.id} type="button" onClick={()=>openEvent(item)} className={`rounded-xl border p-3 text-left text-sm ${savedEventId===item.id?'border-[#8B5937] bg-white':'border-[#E0D4C7] bg-[#FFFCF8]'}`}><strong className="block">{item.theme}</strong><span className="text-xs text-[#71645A]">{item.date} {item.time} · заявок: {item.registrations.length}</span></button>)}</div>}
      {savedEventId && <button type="button" className="mt-3 rounded-lg border border-[#D9CABC] bg-white px-3 py-2 text-xs" onClick={()=>{setSavedEventId(null);setRegistrations([]);setMessage('Нова подія: заповніть поля й збережіть.');}}>＋ Нова подія</button>}
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor="event-announcement" className="text-sm font-semibold">Текст анонсу</label>
        <textarea id="event-announcement" value={announcement} onChange={e=>setAnnouncement(e.target.value)} rows={8} className="w-full rounded-xl border border-[#D9CABC] bg-white p-3 text-sm"/>
        <button type="button" onClick={() => { setForm(extractAnnouncement(announcement)); setMessage('Дані витягнуто. Перевірте поля перед використанням.'); }} className="rounded-xl bg-[#2E1B12] px-4 py-2 text-sm font-semibold text-white">Заповнити поля з анонсу</button>
      </div>
      <div className="grid content-start gap-2 sm:grid-cols-2">
        {([['theme','Тема'],['date','Дата (уточніть рік)'],['time','Час'],['venue','Місце'],['address','Адреса'],['price','Ціна, грн']] as const).map(([key,label])=><label key={key} className="flex flex-col gap-1 text-xs font-semibold">{label}<input value={form[key]} onChange={e=>setForm(old=>({...old,[key]:e.target.value}))} className="min-w-0 rounded-xl border border-[#D9CABC] bg-white px-3 py-2 text-sm font-normal"/></label>)}
        <p className="sm:col-span-2 text-xs text-[#71645A]">Автоматичне розпізнавання є лише підказкою: дату, рік, адресу та вартість необхідно підтвердити вручну.</p>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy || !bookId} onClick={() => void saveEvent()} className="rounded-xl bg-[#2E1B12] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{savedEventId ? 'Зберегти зміни' : 'Створити подію'}</button>
      {!savedEventId && <span className="text-xs text-[#71645A]">Реєстрація відкриється після збереження події авторизованим власником книги.</span>}
    </div>
    <div className="border-t border-[#E0D4C7] pt-4">
      <h3 className="mb-2 font-bold">Заявки на участь <span className="text-sm font-normal text-[#71645A]">({registrations.length})</span></h3>
      <form onSubmit={addRegistration} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input aria-label="Ім’я учасника" placeholder="Ім’я" value={name} onChange={e=>setName(e.target.value)} required className="min-w-0 rounded-xl border border-[#D9CABC] px-3 py-2 text-sm"/>
        <input aria-label="Контакт учасника" placeholder="Контакт (телефон або email)" value={contact} onChange={e=>setContact(e.target.value)} required className="min-w-0 rounded-xl border border-[#D9CABC] px-3 py-2 text-sm"/>
        <select aria-label="Роль" value={role} onChange={e=>setRole(e.target.value as Registration['role'])} className="rounded-xl border border-[#D9CABC] px-2 py-2 text-sm"><option value="participant">Із запитом</option><option value="representative">Представник</option><option value="observer">Спостерігач</option></select>
        <button disabled={busy || !savedEventId} className="rounded-xl bg-[#2E1B12] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Додати</button>
      </form>
      {registrations.length > 0 && <ul className="mt-3 space-y-2">{registrations.map(item=><li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E0D4C7] p-3 text-sm"><span>{item.name} · {item.role === 'participant' ? 'Із запитом' : item.role === 'representative' ? 'Представник' : 'Спостерігач'}</span><select aria-label={'Статус '+item.name} value={item.status} onChange={async e=>{const status=e.target.value as Registration['status'];if(!savedEventId||!bookId)return;const result=await fetch('/api/constellation/events/'+encodeURIComponent(savedEventId)+'/registrations/'+encodeURIComponent(item.id),{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId,status})});if(result.ok){const data=await result.json();setRegistrations(data.event.registrations);}else{setMessage('Не вдалося змінити статус');}}} className="rounded-lg border border-[#D9CABC] p-1"><option value="pending">Очікує</option><option value="confirmed">Підтверджено</option><option value="waitlist">Черга</option></select></li>)}</ul>}
      {message && <p role="status" className="mt-2 text-xs text-[#71645A]">{message}</p>}
      <p className="mt-3 text-xs text-[#8D5944]">Заявки зберігаються тільки для авторизованого власника книги. Публічної форми реєстрації та автоматичних повідомлень ще немає. Поки не використовуйте цей прототип для реального збору персональних даних.</p>
    </div>
  </section>;
};
