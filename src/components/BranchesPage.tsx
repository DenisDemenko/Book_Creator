import React,{useEffect,useState} from 'react';
import type {Book} from '../types';
import type {ScenarioBranch,BranchWorkspace} from '../../server/core/branchTypes';
import type {ParagraphRow} from '../../server/core/types';
type Workspace=BranchWorkspace&{bookRevision:number;canonHash:string;points:{id:string;name:string}[];sections:{id:string;title?:string}[];paragraphs:ParagraphRow[]};
export function BranchesPage({book,onUpdateBook}:{book:Book;onUpdateBook?:(book:Book,action?:string,details?:string)=>void}) {
 const [state,setState]=useState<Workspace>(),[selected,setSelected]=useState(''),[name,setName]=useState(''),[point,setPoint]=useState(''),[target,setTarget]=useState(''),[section,setSection]=useState(''),[text,setText]=useState(''),[compare,setCompare]=useState(''),[confirm,setConfirm]=useState(false),[canonOk,setCanonOk]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[checks,setChecks]=useState<any>(),[hypotheses,setHypotheses]=useState<{text:string;reason:string}[]>([]),[version,setVersion]=useState('');
 const base=`/api/core/projects/${encodeURIComponent(book.id)}/branches`;
 const api=async(path='',method='GET',body?:unknown)=>{const r=await fetch(base+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw new Error(data.error??`Помилка ${r.status}`);return data;};
 const load=async()=>setState(await api());
 useEffect(()=>{const refresh=()=>load().catch(e=>setError(e.message));refresh();window.addEventListener('vault:branch-created',refresh);return()=>window.removeEventListener('vault:branch-created',refresh);},[book.id]);
 const b=state?.branches.find(b=>b.id===selected),other=state?.branches.find(b=>b.id===compare);
 const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await load();}catch(e){setError(e instanceof Error?e.message:String(e));await load().catch(()=>{});}finally{setBusy(false);setConfirm(false);}};
 const mutation=(path:string,body:object,method='POST')=>api(path,method,{...body,expectedRevision:state?.revision});
 const prefix=b?`/${b.id}`:'';
 const choose=(id:string)=>{setSelected(id);setChecks(undefined);setHypotheses([]);setVersion('');setConfirm(false);setCanonOk(false);setText('');setTarget('');};
 return <section data-branches-page className="space-y-4 min-w-0 text-slate-200">
  <p>Гілки зберігають окремі чернетки. Рукопис змінюється лише після підтвердження конкретного фрагмента.</p>
  {error&&<p role="alert" className="text-amber-300 break-words">{error}</p>}
  {!state?<p>Завантаження…</p>:<>
   <fieldset disabled={busy} className="flex flex-wrap gap-2">
    <input aria-label="Назва нової гілки" value={name} onChange={e=>setName(e.target.value)} maxLength={120} placeholder="Назва гілки" className="bg-slate-900 rounded p-2 min-w-0"/>
    <select aria-label="Точка розгалуження" value={point} onChange={e=>setPoint(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Без прив’язки до події</option>{state.points.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <button disabled={!name.trim()} onClick={()=>action(async()=>{const r=await mutation('',{name,pointEntityId:point||null});choose(r.branch.id);setName('');})}>Створити гілку</button>
   </fieldset>
   <select aria-label="Гілка" value={selected} onChange={e=>choose(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Оберіть гілку</option>{state.branches.map(b=><option key={b.id} value={b.id}>{b.name}{b.status==='archived'?' (архів)':''}</option>)}</select>
   {b&&<>
    <fieldset disabled={busy} className="flex flex-wrap gap-3"><input aria-label="Нова назва гілки" value={name} onChange={e=>setName(e.target.value)} placeholder={b.name} className="bg-slate-900 p-2 min-w-0"/><button disabled={!name.trim()} onClick={()=>action(async()=>{await mutation(prefix,{name},'PATCH');setName('');})}>Перейменувати</button><button onClick={()=>action(async()=>{await mutation(prefix,{status:b.status==='active'?'archived':'active'},'PATCH');})}>{b.status==='active'?'Архівувати':'Відновити'}</button></fieldset>
    <p>Основа: ревізія {b.baseBookRevision}. Походження: {b.source}. Версій гілки: {b.history.length}.</p>
    <select aria-label="Порівняти з гілкою" value={compare} onChange={e=>setCompare(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Без іншої гілки</option>{state.branches.filter(x=>x.id!==b.id).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
    {b.fragments.map(f=><article key={f.id} className="border border-slate-700 rounded p-3 space-y-2 break-words">
     <p>Фрагмент: {f.status}{f.acceptedRevision?` · перенесено в ревізію ${f.acceptedRevision}`:''}</p>
     <div className="grid md:grid-cols-3 gap-3"><div><strong>Оригінал на час створення</strong><p className="whitespace-pre-wrap">{f.original||'Новий фрагмент'}</p></div><div><strong>Ця гілка</strong><p className="whitespace-pre-wrap">{f.text}</p></div>{other&&<div><strong>{other.name}</strong><p className="whitespace-pre-wrap">{other.fragments.find(x=>x.paragraphId===f.paragraphId&&x.sectionId===f.sectionId)?.text??'Альтернативи немає'}</p></div>}</div>
     {(f.status==='draft'||f.status==='applying')&&b.status==='active'&&<div className="flex flex-wrap gap-3"><button disabled={busy||!confirm||(state.canonHash!==b.baseCanonHash&&!canonOk)} onClick={()=>action(async()=>{const r=await mutation(`${prefix}/fragments/${f.id}/merge`,{confirm:true,expectedBookRevision:state.bookRevision,acknowledgeCanonChange:canonOk});onUpdateBook?.(r.book,'Прийнято фрагмент гілки',b.name);})}>Підтвердити цей фрагмент у рукопис</button>{f.status==='draft'&&<button disabled={busy} onClick={()=>action(async()=>{await mutation(`${prefix}/fragments/${f.id}/reject`,{});})}>Відхилити</button>}</div>}
    </article>)}
    <label className="block"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> Я підтверджую перенесення вибраного фрагмента в рукопис</label>
    {state.canonHash!==b.baseCanonHash&&<label className="block text-amber-300"><input type="checkbox" checked={canonOk} onChange={e=>setCanonOk(e.target.checked)}/> Канон змінився. Я перевірив гілку з актуальним каноном</label>}
    {b.status==='active'&&<fieldset disabled={busy||b.fragments.some(f=>f.status==='applying')} className="space-y-2">
     <select aria-label="Абзац для альтернативи" value={target} onChange={e=>{setTarget(e.target.value);const p=b.baseParagraphs.find(p=>p.id===e.target.value);if(p){setSection(p.documentId);setText(p.text);}}} className="bg-slate-900 p-2 max-w-full"><option value="">Новий фрагмент наприкінці сцени</option>{b.baseParagraphs.map(p=><option key={p.id} value={p.id}>{p.text.slice(0,90)}</option>)}</select>
     <select aria-label="Сцена гілки" disabled={!!target} value={section} onChange={e=>setSection(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Оберіть сцену</option>{state.sections.map(s=><option key={s.id} value={s.id}>{s.title||s.id}</option>)}</select>
     <textarea aria-label="Текст альтернативи" value={text} onChange={e=>setText(e.target.value)} rows={6} className="w-full bg-slate-900 rounded p-2"/>
     <button disabled={!text.trim()||!section} onClick={()=>action(async()=>{const existing=b.fragments.find(f=>f.paragraphId===target&&f.status==='draft');await mutation(`${prefix}/fragments`,{id:existing?.id,paragraphId:target||null,sectionId:section,text});setText('');})}>Зберегти ізольовану чернетку</button>
    </fieldset>}
    <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={()=>action(async()=>setChecks(await api(`${prefix}/check`,'POST',{})))}>Перевірити залежності й суперечності</button><button disabled={busy||b.status==='archived'} onClick={()=>action(async()=>setHypotheses((await api(`${prefix}/hypotheses`,'POST',{})).hypotheses))}>Запропонувати AI-гіпотези</button></div>
    {checks&&<pre className="whitespace-pre-wrap break-words text-xs p-3 bg-slate-900">{JSON.stringify(checks,null,2)}</pre>}
    {hypotheses.map((h,i)=><article key={i} className="break-words"><p>{h.text}</p><p>{h.reason}</p><button onClick={()=>setText(h.text)}>Взяти до поля чернетки</button></article>)}
    <select aria-label="Історія гілки" value={version} onChange={e=>setVersion(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Історія версій</option>{b.history.map(h=><option key={h.version} value={h.version}>Версія {h.version}: {h.name} · {h.createdAt}</option>)}</select>
    {version&&<div className="whitespace-pre-wrap break-words">{b.history.find(h=>h.version===Number(version))?.fragments.map(f=>f.text).join('\n\n')}</div>}
   </>}
  </>}
 </section>;
}
