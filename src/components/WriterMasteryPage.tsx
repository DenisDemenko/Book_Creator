import React,{useEffect,useState} from 'react';
import type {Book} from '../types';
import type {MasteryWorkspace,MasteryExercise,MasterySkill} from '../../server/core/masteryTypes';
type Workspace=Omit<MasteryWorkspace,'exercises'>&{canBranch:boolean;catalog:{id:MasterySkill;name:string}[];exercises:(MasteryExercise&{needsUpdate:boolean})[];progress:{skill:string;completed:number;total:number}[];targets:{paragraphs:{id:string;text:string}[];scenes:{id:string;title:string}[];characters:{id:string;name:string}[]}};
export function WriterMasteryPage({book}:{book:Book}){
 const [state,setState]=useState<Workspace>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[skills,setSkills]=useState<MasterySkill[]>([]),[goal,setGoal]=useState(''),[skill,setSkill]=useState('dialogue'),[depth,setDepth]=useState('short'),[genre,setGenre]=useState('Проза'),[kind,setKind]=useState('scene'),[target,setTarget]=useState(''),[selected,setSelected]=useState(''),[a,setA]=useState(''),[b,setB]=useState(''),[reason,setReason]=useState(''),[questions,setQuestions]=useState<string[]>([]),[rewrite,setRewrite]=useState(''),[history,setHistory]=useState(''),[branchMessage,setBranchMessage]=useState(''),[section,setSection]=useState('');
 const base=`/api/core/projects/${encodeURIComponent(book.id)}/mastery`;
 const api=async(path='',method='GET',body?:unknown)=>{const r=await fetch(base+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw new Error(data.error??`Помилка ${r.status}`);return data;};
 const load=async()=>{const s:Workspace=await api();setState(s);setSkills(s.plan.skills);setGoal(s.plan.goal);};
 useEffect(()=>{load().catch(e=>setError(e.message));},[book.id]);
 const e=state?.exercises.find(e=>e.id===selected);
 useEffect(()=>{setA(e?.versions.filter(v=>v.slot==='A').at(-1)?.text??'');setB(e?.versions.filter(v=>v.slot==='B').at(-1)?.text??'');setQuestions(e?.questions??[]);setRewrite('');setHistory('');setBranchMessage('');},[selected,e?.id]);
 const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await load();}catch(err){setError(err instanceof Error?err.message:String(err));await load().catch(()=>{});}finally{setBusy(false);}};
 const mutation=(path:string,body:object,method='POST')=>api(path,method,{...body,expectedRevision:state?.revision});
 const branch=async(slot:'A'|'B')=>{if(!e)return;await act(async()=>{const v=e.versions.filter(v=>v.slot===slot).at(-1);if(!v)throw new Error('Спочатку збережіть редакцію.');const url=`/api/core/projects/${encodeURIComponent(book.id)}/branches`;const r=await fetch(url,{credentials:'same-origin'}),workspace=await r.json();if(!r.ok)throw new Error(workspace.error);const result=await mutation(`/exercises/${e.id}/branch`,{versionId:v.id,confirm:true,expectedBranchRevision:workspace.revision,sectionId:section});setBranchMessage(`Створено гілку «${result.branch.name}». Відкрийте «Гілки сценарію» для перевірки й підтвердження фрагмента. Редакція сцени або героя стане новим фрагментом; редакція абзацу — його альтернативою.`);});};
 const savedA=e?.versions.filter(v=>v.slot==='A').at(-1)?.text??'',savedB=e?.versions.filter(v=>v.slot==='B').at(-1)?.text??'';
 const canComplete=!!savedA.trim()&&!!savedB.trim()&&savedA.trim()!==savedB.trim()&&a===savedA&&b===savedB;
 const targets=state?(kind==='scene'?state.targets.scenes.map(s=>({id:s.id,label:s.title})):kind==='paragraph'?state.targets.paragraphs.map(p=>({id:p.id,label:p.text})):state.targets.characters.map(c=>({id:c.id,label:c.name}))):[];
 return <section data-writer-mastery className="space-y-4 min-w-0 text-slate-200">
  <p>Пишіть на матеріалі власної книги. Редакції вправ зберігаються окремо від рукопису.</p>
  {error&&<p role="alert" className="text-amber-300 break-words">{error}</p>}
  {!state?<p>Завантаження…</p>:<>
   <fieldset disabled={busy} className="space-y-2"><legend>Особистий навчальний план</legend><div className="flex flex-wrap gap-3">{state.catalog.map(s=><label key={s.id}><input type="checkbox" checked={skills.includes(s.id)} onChange={e=>setSkills(e.target.checked?[...skills,s.id]:skills.filter(x=>x!==s.id))}/>{s.name}</label>)}</div><input aria-label="Мета навчання" value={goal} onChange={e=>setGoal(e.target.value)} maxLength={500} placeholder="Мета навчання" className="bg-slate-900 p-2 w-full"/><button onClick={()=>act(async()=>{await mutation('/plan',{skills,goal},'PUT');})}>Зберегти план</button></fieldset>
   <div className="flex flex-wrap gap-3">{state.progress.map(p=><span key={p.skill}>{state.catalog.find(s=>s.id===p.skill)?.name}: {p.completed}/{p.total} вправ виконано</span>)}</div><p className="text-sm">Це облік практики, а не оцінка літературної якості.</p>
   <fieldset disabled={busy} className="flex flex-wrap gap-2"><legend>Нова вправа</legend>
    <select aria-label="Навичка вправи" value={skill} onChange={e=>setSkill(e.target.value)} className="bg-slate-900 p-2">{state.catalog.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
    <select aria-label="Тривалість вправи" value={depth} onChange={e=>setDepth(e.target.value)} className="bg-slate-900 p-2"><option value="short">Коротка · 5–10 хв</option><option value="deep">Поглиблена · 20–30 хв</option></select>
    <input aria-label="Жанр твору" value={genre} onChange={e=>setGenre(e.target.value)} maxLength={120} className="bg-slate-900 p-2 min-w-0"/>
    <select aria-label="Тип матеріалу" value={kind} onChange={e=>{setKind(e.target.value);setTarget('');}} className="bg-slate-900 p-2"><option value="scene">Сцена</option><option value="paragraph">Абзац</option><option value="character">Персонаж</option></select>
    <select aria-label="Матеріал вправи" value={target} onChange={e=>setTarget(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Оберіть матеріал</option>{targets.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select>
    <button disabled={!target||!genre.trim()} onClick={()=>act(async()=>{const r=await mutation('/exercises',{skill,depth,genre,target:{kind,id:target}});setSelected(r.exercise.id);setQuestions(r.exercise.questions);setA('');setB('');})}>Отримати вправу</button>
   </fieldset>
   <select aria-label="Історія вправ" value={selected} onChange={e=>setSelected(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Оберіть вправу</option>{state.exercises.map(e=><option key={e.id} value={e.id}>{state.catalog.find(s=>s.id===e.skill)?.name} · {e.target.id} · {e.status}</option>)}</select>
   {e&&<>
    <p className="whitespace-pre-wrap break-words">{e.instruction}</p><details><summary>Матеріал на час створення вправи</summary><p className="whitespace-pre-wrap break-words">{e.source}</p></details>
    {e.needsUpdate&&<p className="text-amber-300">Матеріал змінився. Створіть вправу на актуальній основі.</p>}
    <fieldset disabled={busy||e.status==='rejected'} className="grid md:grid-cols-2 gap-3">
     {(['A','B'] as const).map(slot=><div key={slot}><label>Авторська редакція {slot}<textarea aria-label={`Авторська редакція ${slot}`} value={slot==='A'?a:b} onChange={event=>slot==='A'?setA(event.target.value):setB(event.target.value)} rows={8} className="w-full bg-slate-900 rounded p-2"/></label><button disabled={!(slot==='A'?a:b).trim()} onClick={()=>act(async()=>{await mutation(`/exercises/${e.id}/versions`,{slot,text:slot==='A'?a:b});})}>Зберегти {slot}</button>{state.canBranch&&<button disabled={e.needsUpdate||!e.versions.some(v=>v.slot===slot)||(e.target.kind==='character'&&!section)} onClick={()=>branch(slot)} className="ml-3">До гілки зі збереженої {slot}</button>}</div>)}
    </fieldset>
    {e.target.kind==='character'&&<select aria-label="Сцена для редакції героя" value={section} onChange={e=>setSection(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Сцена для нової гілки</option>{state.targets.scenes.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select>}
    {branchMessage&&<p role="status" className="break-words">{branchMessage}</p>}
    <fieldset disabled={busy||e.status==='rejected'} className="flex flex-wrap gap-3"><button disabled={e.needsUpdate||!canComplete||e.status==='completed'} onClick={()=>act(async()=>{await mutation(`/exercises/${e.id}/status`,{status:'completed'});})}>Завершити вправу</button><input aria-label="Причина відхилення вправи" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Чому не відповідає задуму" className="bg-slate-900 p-2 min-w-0"/><button disabled={!reason.trim()} onClick={()=>act(async()=>{await mutation(`/exercises/${e.id}/status`,{status:'rejected',reason});})}>Відхилити вправу</button></fieldset>
    <p>Запитання наставника:</p><ul className="list-disc pl-5">{questions.map((q,i)=><li key={i} className="break-words">{q}</li>)}</ul>
    <div className="flex flex-wrap gap-3"><button disabled={busy||e.status==='rejected'||e.needsUpdate} onClick={()=>act(async()=>{const r=await mutation(`/exercises/${e.id}/mentor`,{mode:'questions'});setQuestions(r.questions);})}>Запитати AI-наставника</button><button disabled={busy||e.status==='rejected'||e.needsUpdate} onClick={()=>act(async()=>{const r=await mutation(`/exercises/${e.id}/mentor`,{mode:'rewrite',confirm:true});setRewrite(r.rewrite);})}>Явно запросити готову правку</button></div>
    {rewrite&&<div><p className="whitespace-pre-wrap break-words">{rewrite}</p><button onClick={()=>setB(rewrite)}>Взяти пропозицію в поле B</button><p>Поле ще не збережено. Рукопис не змінено.</p></div>}
    <select aria-label="Версії редакцій" value={history} onChange={e=>setHistory(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Історія редакцій</option>{e.versions.map((v,i)=><option key={v.id} value={v.id}>Версія {i+1} · {v.slot} · {v.at}</option>)}</select><p className="whitespace-pre-wrap break-words">{e.versions.find(v=>v.id===history)?.text}</p>
    <details><summary>Історія виконання</summary>{e.events.map((event,i)=><p key={i}>{event.at} · {event.action}{event.reason?` · ${event.reason}`:''}</p>)}</details>
   </>}
  </>}
 </section>;
}
