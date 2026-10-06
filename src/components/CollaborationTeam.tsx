import React, { useEffect, useState } from 'react';
import { activeCollabOntology } from '../utils/collabOntology';
interface Props {bookId:string;bookTitle:string;canManage:boolean;names:Record<string,string>}
export function CollaborationTeam({bookId,bookTitle,canManage,names}:Props) {
  const [people,setPeople]=useState<any[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [email,setEmail]=useState(''),[inviteRole,setInviteRole]=useState('editor'),[role,setRole]=useState('editor'),[user,setUser]=useState(''),[specialization,setSpecialization]=useState(''),[notice,setNotice]=useState(''),[inviteLink,setInviteLink]=useState('');
  const [roles,setRoles]=useState(activeCollabOntology().roles);
  const url=`/api/core/projects/${encodeURIComponent(bookId)}/participants`;
  const request=async(path:string,method='GET',body?:unknown)=>{const r=await fetch(path,{method,credentials:'same-origin',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const b=await r.json();if(!r.ok)throw new Error(b.error||`Помилка ${r.status}`);return b;};
  const load=async()=>setPeople((await request(url)).participants);
  useEffect(()=>{let live=true;void request(url).then(b=>{if(live)setPeople(b.participants);}).catch(e=>{if(live)setError(e.message);});void request('/api/collaboration/roles').then(b=>{if(live&&b.roles)setRoles(b.roles.map((r:any)=>({...r,status:r.deprecated?'deprecated':'active'})));}).catch(()=>{});return()=>{live=false;};},[url]);
  const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const chosen=roles.find(r=>r.id===role);
  const field='w-full min-w-0 rounded border border-slate-600 bg-slate-950 p-2';const button='rounded border border-slate-600 px-3 py-2 disabled:opacity-40';
  return <section aria-label="Учасники та ролі" className="space-y-3 rounded-xl border border-slate-700 p-4">
    <h2 className="font-bold">Команда проєкту</h2><p>Роль описує роботу учасника. Доступ до змісту задається окремо нижче.</p>
    {error&&<p role="alert" className="text-red-400">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {people.map(p=><article key={p.participant.id} className="break-words"><h3>{names[p.participant.userId]??p.participant.userId} · {p.participant.status}</h3>{p.roles.map((r:any)=><div key={r.id} className="flex flex-wrap gap-2">{r.label?.uk??r.roleId}{r.specialization?` / ${r.specialization}`:''}{canManage&&r.roleId!=='project_owner'&&<button className={button} disabled={busy} onClick={()=>void action(async()=>{await request(`${url}/roles/${r.id}`,'DELETE');await load();})}>Відкликати роль</button>}</div>)}</article>)}
    {canManage&&<>
      <form className="grid gap-2" aria-label="Призначити роль" onSubmit={e=>{e.preventDefault();void action(async()=>{await request(url+'/roles','POST',{userId:user,roleId:role,specialization:chosen?.requiresSpecialization?specialization:undefined});await load();setNotice('Роль призначено.');});}}>
        <h3 className="font-bold">Роль учасника</h3><label>Учасник<select className={field} aria-label="Учасник для ролі" required value={user} onChange={e=>setUser(e.target.value)}><option value="">Оберіть учасника</option>{people.filter(p=>p.participant.status==='active').map(p=><option key={p.participant.userId} value={p.participant.userId}>{names[p.participant.userId]??p.participant.userId}</option>)}</select></label>
        <label>Роль<select className={field} aria-label="Роль учасника" value={role} onChange={e=>{setRole(e.target.value);setSpecialization('');}}>{roles.filter(r=>r.status==='active').map(r=><option key={r.id} value={r.id}>{r.label.uk}</option>)}</select></label>
        {chosen?.requiresSpecialization&&<label>Спеціалізація<select className={field} aria-label="Спеціалізація ролі" required value={specialization} onChange={e=>setSpecialization(e.target.value)}><option value="">Оберіть спеціалізацію</option>{chosen.specializations.map(id=><option key={id} value={id}>{roles.find(r=>r.id===id)?.label.uk??id}</option>)}</select></label>}
        <button className={button} disabled={busy}>Призначити роль</button>
      </form>
      <form aria-label="Запросити учасника" className="grid gap-2" onSubmit={e=>{e.preventDefault();void action(async()=>{const b=await request('/api/collaboration/invite','POST',{bookId,bookTitle,email,role:inviteRole});setInviteLink(b.inviteLink ?? '');setNotice(b.emailSent?'Запрошення надіслано.':'Запрошення створено. Скопіюйте посилання нижче.');setEmail('');});}}>
        <h3 className="font-bold">Запросити до книги</h3><label>Електронна пошта<input className={field} type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Роль запрошення<select className={field} aria-label="Роль запрошення" value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>{roles.filter(r=>r.invitable&&r.status==='active').map(r=><option key={r.id} value={r.id}>{r.label.uk}</option>)}</select></label><button className={button} disabled={busy||!roles.some(r=>r.invitable&&r.status==='active'&&r.id===inviteRole)}>Запросити</button>
      </form>
      {inviteLink&&<label>Посилання запрошення<input aria-label="Посилання запрошення" className={field} readOnly value={inviteLink} onFocus={e=>e.target.select()}/></label>}
    </>}
  </section>;
}
