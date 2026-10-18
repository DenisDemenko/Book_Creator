import React, { useState } from 'react';

type Registration = { id: number; name: string; contact: string; role: 'participant'|'representative'|'observer'; status: 'pending'|'confirmed'|'waitlist'; };
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

export const ConstellationEventPlanner: React.FC = () => {
  const [announcement, setAnnouncement] = useState(sample);
  const [form, setForm] = useState(() => extractAnnouncement(sample));
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<Registration['role']>('participant');
  const [message, setMessage] = useState('');
  const addRegistration = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !contact.trim()) return;
    setRegistrations(items => [...items, { id: Date.now(), name: name.trim(), contact: contact.trim(), role, status: 'pending' }]);
    setName(''); setContact(''); setMessage('Заявку додано до локального списку.');
  };
  return <section className="space-y-4 rounded-2xl border border-[#E0D4C7] bg-[#FFFCF8] p-4 text-[#2C1A12]" aria-label="Організація групової події">
    <header><h2 className="text-lg font-bold">Організація групової зустрічі</h2><p className="text-sm text-[#71645A]">Перший етап Constellation Studio 1.1 — чернетка події та локальний список заявок.</p></header>
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
    <div className="border-t border-[#E0D4C7] pt-4">
      <h3 className="mb-2 font-bold">Заявки на участь <span className="text-sm font-normal text-[#71645A]">({registrations.length})</span></h3>
      <form onSubmit={addRegistration} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input aria-label="Ім’я учасника" placeholder="Ім’я" value={name} onChange={e=>setName(e.target.value)} required className="min-w-0 rounded-xl border border-[#D9CABC] px-3 py-2 text-sm"/>
        <input aria-label="Контакт учасника" placeholder="Контакт (телефон або email)" value={contact} onChange={e=>setContact(e.target.value)} required className="min-w-0 rounded-xl border border-[#D9CABC] px-3 py-2 text-sm"/>
        <select aria-label="Роль" value={role} onChange={e=>setRole(e.target.value as Registration['role'])} className="rounded-xl border border-[#D9CABC] px-2 py-2 text-sm"><option value="participant">Із запитом</option><option value="representative">Представник</option><option value="observer">Спостерігач</option></select>
        <button className="rounded-xl bg-[#2E1B12] px-4 py-2 text-sm font-semibold text-white">Додати</button>
      </form>
      {registrations.length > 0 && <ul className="mt-3 space-y-2">{registrations.map(item=><li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E0D4C7] p-3 text-sm"><span>{item.name} · {item.role === 'participant' ? 'Із запитом' : item.role === 'representative' ? 'Представник' : 'Спостерігач'}</span><select aria-label={'Статус '+item.name} value={item.status} onChange={e=>setRegistrations(items=>items.map(x=>x.id===item.id?{...x,status:e.target.value as Registration['status']}:x))} className="rounded-lg border border-[#D9CABC] p-1"><option value="pending">Очікує</option><option value="confirmed">Підтверджено</option><option value="waitlist">Черга</option></select></li>)}</ul>}
      {message && <p role="status" className="mt-2 text-xs text-[#71645A]">{message}</p>}
      <p className="mt-3 text-xs text-[#8D5944]">Демо-чернетка: дані заявок поки зберігаються лише в пам’яті вкладки, зникають після перезавантаження та не надсилаються учасникам. Для реальних персональних даних потрібні серверне збереження й контроль доступу.</p>
    </div>
  </section>;
};
