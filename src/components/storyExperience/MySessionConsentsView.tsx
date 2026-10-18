import React,{useCallback,useEffect,useState} from 'react';

interface ConsentRequest {sessionId:string;bookId:string;kind:string;title:string;completedAt:string;status:'pending'|'granted'|'revoked';decidedAt:string|null;materialText:string;materialHash:string;privacyReviewRequired?:boolean;}
interface Invitation {sessionId:string;bookId:string;kind:string;joined:boolean;}
export const MySessionConsentsView:React.FC=()=>{
  const [invitations,setInvitations]=useState<Invitation[]>([]);
  const [inviteError,setInviteError]=useState('');
  const refreshInvitations=useCallback(async()=>{
    try{
      const response=await fetch('/api/story-experience/my-invitations',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw new Error('Не вдалося отримати запрошення');
      const data=await response.json();
      setInvitations(Array.isArray(data.invitations)?data.invitations:[]);
    }catch(error){setInviteError(error instanceof Error?error.message:'Помилка');}
  },[]);
  useEffect(()=>{void refreshInvitations();},[refreshInvitations]);
  const leaveSession=async(invite:Invitation)=>{
    try{
      const response=await fetch('/api/story-experience/journals/'+encodeURIComponent(invite.sessionId)+'/leave',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:invite.bookId})});
      if(!response.ok)throw new Error('Не вдалося вийти з сесії');
      await refreshInvitations();
    }catch(error){setInviteError(error instanceof Error?error.message:'Помилка');}
  };
  const declineInvitation=async(invite:Invitation)=>{
    try{
      const response=await fetch('/api/story-experience/journals/'+encodeURIComponent(invite.sessionId)+'/decline',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:invite.bookId})});
      if(!response.ok)throw new Error('Не вдалося відхилити запрошення');
      await refreshInvitations();
    }catch(error){setInviteError(error instanceof Error?error.message:'Помилка');}
  };
  const acceptInvitation=async(invite:Invitation)=>{
    try{
      const response=await fetch('/api/story-experience/journals/'+encodeURIComponent(invite.sessionId)+'/join',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:invite.bookId})});
      if(!response.ok)throw new Error('Не вдалося підтвердити участь');
      await refreshInvitations();
    }catch(error){setInviteError(error instanceof Error?error.message:'Помилка');}
  };
  const [requests,setRequests]=useState<ConsentRequest[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/story-experience/my-consents',{credentials:'same-origin',cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'Не вдалося завантажити запити');
      setRequests(Array.isArray(data.requests)?data.requests:[]);
    }catch(e){setError(e instanceof Error?e.message:'Помилка завантаження');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  const decide=async(request:ConsentRequest,decision:'granted'|'revoked')=>{
    setBusy(request.sessionId);setError('');
    try{
      const response=await fetch('/api/story-experience/completed/'+encodeURIComponent(request.sessionId)+'/consent',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({bookId:request.bookId,decision,materialHash:request.materialHash}),
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'Не вдалося змінити дозвіл');
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:'Помилка запису дозволу');}
    finally{setBusy(null);}
  };
  return <section className="min-h-0 flex-1 overflow-y-auto bg-[#F4ECE1] p-4 text-[#2C1A12] lg:p-6" aria-label="Мої дозволи на використання сесій">
    <header><h1 className="text-2xl font-semibold">Мої дозволи</h1><p className="mt-2 max-w-2xl text-sm text-[#71645A]">Ви вирішуєте, чи дозволяти художню адаптацію матеріалу сесії. Відкликання блокує нові експорти, але не видаляє вже створені або опубліковані копії автоматично.</p></header>
    <div className="mt-4 space-y-2"><h2 className="text-lg font-semibold">Запрошення до сесій</h2>
      {inviteError&&<p role="alert" className="text-[#A63A2B]">{inviteError}</p>}
      {invitations.map(item=><div key={item.sessionId} className="flex items-center justify-between gap-3 rounded-xl border border-[#E0D4C7] p-3 text-sm"><span>{item.kind} · {item.sessionId.slice(0,8)}</span>{item.joined?<span className="flex items-center gap-2">Участь підтверджено <button type="button" onClick={()=>void leaveSession(item)} className="rounded-xl border border-[#D49A8B] px-3 py-2">Вийти з сесії</button></span>:<span className="flex gap-2"><button type="button" onClick={()=>void acceptInvitation(item)} className="rounded-xl border border-[#8B5937] px-3 py-2">Підтвердити участь</button><button type="button" onClick={()=>void declineInvitation(item)} className="rounded-xl border border-[#CDBBAA] px-3 py-2">Відхилити</button></span>}</div>)}
    </div>
    <button type="button" onClick={()=>{void refresh();void refreshInvitations();}} disabled={loading} className="my-4 rounded-xl border border-[#E0D4C7] px-3 py-2 text-sm disabled:opacity-40">Оновити</button>
    {error&&<p role="alert" className="mb-3 text-sm text-[#A63A2B]">{error}</p>}
    {loading?<p role="status">Завантаження…</p>:requests.length===0?<p className="rounded-2xl border border-[#E0D4C7] p-4 text-sm">Наразі запитів на вашу згоду немає.</p>:
      <div className="grid gap-3 lg:grid-cols-2">{requests.map(item=><article key={item.sessionId} className="rounded-2xl border border-[#E0D4C7] bg-[#FFFCF8] p-4">
        <p className="text-xs uppercase text-[#92633C]">{item.kind}</p><h2 className="mt-1 text-lg font-semibold">{item.title}</h2>
        <p className="mt-2 text-xs text-[#71645A]">Статус: {item.status==='pending'?'Очікує рішення':item.status==='granted'?'Дозволено':'Відкликано'}</p>
        <p className="mt-2 text-xs text-[#71645A]">Рішення стосується лише використання для книги. Перед погодженням переконайтеся, що знаєте, який матеріал буде використано.</p>
        <div className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#E0D4C7] bg-[#F4ECE1] p-3 text-sm" aria-label="Матеріал, на використання якого запитується згода">{item.materialText}</div>
        {item.privacyReviewRequired && <p role="alert" className="mt-3 text-sm text-[#825A20]">Матеріал потребує додаткової перевірки приватності. Погодження тимчасово недоступне.</p>}
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>void decide(item,'granted')} disabled={busy===item.sessionId||item.status==='granted'||item.privacyReviewRequired||!item.materialHash} className="rounded-xl border border-[#8B5937] px-3 py-2 text-sm disabled:opacity-40">Надати дозвіл</button>
          <button type="button" onClick={()=>void decide(item,'revoked')} disabled={busy===item.sessionId||item.status==='revoked'} className="rounded-xl border border-[#CDBBAA] px-3 py-2 text-sm disabled:opacity-40">Відкликати дозвіл</button></div>
      </article>)}</div>}
  </section>;
};
