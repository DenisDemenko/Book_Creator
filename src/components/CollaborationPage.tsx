import {CreativeProjects} from './CreativeProjects';
import {CollaborationChanges} from './CollaborationChanges';
import React, { useCallback, useEffect, useState } from 'react';
import type { Book } from '../types';
import type { WorkItem, WorkNotice, WorkTarget } from '../../server/core/collaboration/workspaceStore';
import { CollaborationTeam } from './CollaborationTeam';
import { AccessPanel } from './AccessPanel';
import { useLanguage } from '../i18n/LanguageContext';
interface State { userId:string; canManage:boolean;canRestore:boolean;names:Record<string,string>; targets:Array<{target:WorkTarget;label:string;canComment:boolean}>; items:WorkItem[]; participants:string[]; notifications:WorkNotice[] }
interface Source {revision:number;book:Book}
const field='w-full min-w-0 rounded border border-slate-600 bg-slate-950 p-2 text-slate-100';
const button='rounded border border-slate-600 px-3 py-2 disabled:opacity-40';
export function CollaborationPage({book,onUpdateBook,onOpenCharacter,onOpenParagraph}:{book:Book;onUpdateBook?:(book:Book)=>void;onOpenCharacter:(id:string)=>void;onOpenParagraph?:(target:{chapterId:string;sectionId:string;editorPid:string;text:string})=>void}) {
  const {lang}=useLanguage();
  const [data,setData]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [view,setView]=useState<'work'|'access'|'history'|'changes'|'creative'>('work');
  const [detail,setDetail]=useState<any>(null);
  const [target,setTarget]=useState(''),[kind,setKind]=useState<'comment'|'task'>('comment'),[text,setText]=useState(''),[assignee,setAssignee]=useState(''),[dueAt,setDueAt]=useState('');
  const [source,setSource]=useState<Source|null>(null),[history,setHistory]=useState<Array<{revision:number;savedAt:string}>>([]),[selected,setSelected]=useState(''),[old,setOld]=useState<Source|null>(null),[confirm,setConfirm]=useState(false);
  const root=`/api/core/projects/${encodeURIComponent(book.id)}`;
  const api=useCallback(async(path:string,method='GET',body?:unknown)=> {
    const res=await fetch(root+path,{method,credentials:'same-origin',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await res.json().catch(()=>({})); if(!res.ok) throw new Error(value.error || `Помилка ${res.status}`); return value;
  },[root]);
  const load=useCallback(async()=> {const value=await api('/collaboration');setData(value);setError('');},[api]);
  useEffect(()=> {let live=true; const update=()=>api('/collaboration').then(v=>{if(live){setData(v);setError('');}}).catch(e=>{if(live){setData(null);setError(e.message);}});void update();const timer=setInterval(update,10000);return()=>{live=false;clearInterval(timer);};},[api]);
  const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const pick=data?.targets.find(t=>JSON.stringify(t.target)===target);
  const openTarget=async(t:WorkTarget)=> {
    if(t.kind==='paragraph'&&onOpenParagraph){const result=await api('/collaboration/target?'+new URLSearchParams({kind:t.kind,id:t.id,chapterId:t.chapterId,sectionId:t.sectionId}));onOpenParagraph(result.paragraph);return;}
    if(t.kind==='entity'||t.kind==='material') {const result=await api('/collaboration/target?'+new URLSearchParams({kind:t.kind,id:t.id}));if(result.entity?.type==='character')onOpenCharacter(t.id);else setDetail(result);return;}
    if(['scene','chapter'].includes(t.kind) && onOpenParagraph) {
      const s:Source=await api('/source'); const c=s.book.chapters.find(c=>c.id===(t.kind==='chapter'?t.id:t.chapterId));const section=t.kind==='chapter'?c?.sections[0]:c?.sections.find(s=>s.id===t.id);
      if(!section) throw new Error('Сцена більше недоступна.');
      onOpenParagraph({chapterId:c.id,sectionId:section.id,editorPid:section.paragraphIds?.[0] ?? '',text:''});
    }
  };
  const loadHistory=async()=> { const [s,h]=await Promise.all([api('/source'),api('/source/history')]);setSource(s);setHistory(h.revisions);setOld(null);setSelected('');setConfirm(false); };
  const changes: Array<{label:string;before:string;after:string}>=[];
  if(source&&old) for(const c of source.book.chapters??[]) for(const s of c.sections??[]) {
    const previous=old.book.chapters?.find(x=>x.id===c.id)?.sections?.find(x=>x.id===s.id);
    if(previous?.content!==s.content) changes.push({label:`${c.title} / ${s.title}`,before:previous?.content??'Сцени в цій версії немає.',after:s.content});
  }
  return <section data-collaboration-workspace className="space-y-4 min-w-0">
    <nav aria-label="Розділи співпраці" className="flex flex-wrap gap-2">{(['work','access','history','changes','creative'] as const).map(v=><button key={v} className={button} aria-pressed={view===v} onClick={()=>{setView(v);if(v==='history')void action(loadHistory);}}>{v==='work'?'Коментарі й завдання':v==='access'?'Команда й доступ':v==='creative'?'Творчі проєкти':v==='changes'?'Пропозиції та внески':'Історія правок'}</button>)}</nav>
    {detail&&<aside className="rounded-xl border border-slate-700 p-4 break-words"><button className={button} onClick={()=>setDetail(null)}>Закрити джерело</button>{detail.entity&&<><h3>{detail.entity.name}</h3><pre className="whitespace-pre-wrap break-words">{JSON.stringify(detail.entity.canonical,null,2)}</pre></>}{detail.material&&<><h3>{detail.material.title??detail.material.name??detail.material.id}</h3>{detail.material.url&&<a href={detail.material.url} target="_blank" rel="noreferrer">Відкрити матеріал</a>}</>}</aside>}
    {error&&<p role="alert" className="break-words text-red-400">{error}</p>}
    {!data&&!error&&<p role="status">Завантаження співпраці…</p>}
    {view==='creative'&&data?.canRestore&&<CreativeProjects key={book.id} bookId={book.id}/>}
    {view==='creative'&&data&&!data.canRestore&&<p>Творчі проєкти створює власник книги.</p>}
    {view==='changes'&&<CollaborationChanges key={book.id} bookId={book.id} onUpdateBook={onUpdateBook}/>}
    {view==='access'&&data&&<><CollaborationTeam bookId={book.id} bookTitle={book.title} canManage={data.canRestore} names={data.names}/><AccessPanel key={book.id} bookId={book.id} lang={lang==='en'?'en':'uk'}/></>}
    {view==='work'&&data&&<>
      <section aria-label="Особисті сповіщення" className="space-y-2"><h2 className="font-bold">Мої сповіщення ({data.notifications.filter(n=>!n.readAt).length})</h2>{data.notifications.filter(n=>!n.readAt).map(n=>{const i=data.items.find(i=>i.id===n.itemId);return <div key={n.id} className="flex flex-wrap items-center gap-2"><span className="break-words">{n.kind==='overdue'?'Прострочено':i?.kind==='task'?'Завдання':'Коментар'}: {i?.text.slice(0,100)}</span><button disabled={busy} className={button} onClick={()=>void action(async()=>{await api(`/collaboration/notifications/${n.id}/read`,'POST');await load();})}>Прочитано</button></div>;})}</section>
      <form aria-label="Новий запис співпраці" className="grid gap-3 rounded-xl border border-slate-700 p-4" onSubmit={e=>{e.preventDefault();void action(async()=>{await api('/collaboration/items','POST',{kind,target:pick.target,text,assigneeId:assignee,dueAt});setText('');await load();});}}>
        <h2 className="font-bold">Додати коментар або завдання</h2>
        <label>Ціль<select className={field} aria-label="Ціль запису" required value={target} onChange={e=>setTarget(e.target.value)}><option value="">Оберіть ціль</option>{data.targets.map(t=><option key={JSON.stringify(t.target)} value={JSON.stringify(t.target)} disabled={!t.canComment}>{({book:'Книга',chapter:'Глава',scene:'Сцена',paragraph:'Абзац',entity:'Сутність',material:'Матеріал'})[t.target.kind]}: {t.label}{!t.canComment?' (лише перегляд)':''}</option>)}</select></label>
        <label>Тип<select className={field} aria-label="Тип запису" value={kind} onChange={e=>setKind(e.target.value as any)}><option value="comment">Коментар</option>{data.canManage&&<option value="task">Завдання</option>}</select></label>
        <label>Текст<textarea className={field} aria-label="Текст запису" required maxLength={4000} value={text} onChange={e=>setText(e.target.value)}/></label>
        {kind==='task'&&<><label>Виконавець<select className={field} aria-label="Виконавець" required value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Оберіть учасника</option>{data.participants.map(id=><option key={id} value={id}>{data.names[id]??id}</option>)}</select></label><label>Строк виконання<input className={field} aria-label="Строк виконання" type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label></>}
        <button className={button} disabled={busy||!pick?.canComment}>Додати</button>
      </form>
      <h2 className="font-bold">Записи проєкту ({data.items.length})</h2>
      {data.items.map(i=><article data-work-item={i.id} key={i.id} className="space-y-2 rounded-xl border border-slate-700 p-4 break-words">
        <p className="font-bold">{i.kind==='task'?'Завдання':'Коментар'} · {i.status==='done'?'Завершено':'Відкрито'}</p>
        <p>{data.targets.find(t=>JSON.stringify(t.target)===JSON.stringify(i.target))?.label ?? i.target.kind} · {data.names[i.authorId]??i.authorId}</p>
        <p className="whitespace-pre-wrap">{i.text}</p>
        {i.assigneeId&&<p>Виконавець: {data.names[i.assigneeId]??i.assigneeId}{i.dueAt?` · до ${new Date(i.dueAt).toLocaleString('uk-UA')}`:''}{i.dueAt&&i.status==='open'&&Date.parse(i.dueAt)<Date.now()?' · Прострочено':''}</p>}
        {(data.canManage || i.kind==='comment'&&i.authorId===data.userId&&data.targets.some(t=>JSON.stringify(t.target)===JSON.stringify(i.target)&&t.canComment))&&<WorkItemEditor key={`${i.id}:${i.version}`} item={i} state={data} busy={busy} save={patch=>action(async()=>{await api(`/collaboration/items/${i.id}`,'PATCH',{expectedVersion:i.version,...patch});await load();})}/>}
        <div className="flex flex-wrap gap-2">{['chapter','scene','paragraph','entity','material'].includes(i.target.kind)&&<button disabled={busy} className={button} onClick={()=>void action(()=>openTarget(i.target))}>Відкрити джерело</button>}{(data.canManage||(i.kind==='comment'?i.authorId===data.userId:i.assigneeId===data.userId))&&<button disabled={busy} className={button} onClick={()=>void action(async()=>{await api(`/collaboration/items/${i.id}`,'PATCH',{expectedVersion:i.version,status:i.status==='open'?'done':'open'});await load();})}>{i.status==='open'?'Завершити':'Відкрити знову'}</button>}</div>
      </article>)}
    </>}
    {view==='history'&&source&&<div className="space-y-3" data-source-history>
      <p>Поточна серверна ревізія: {source.revision}. Відновлення створить нову ревізію.</p>
      <label>Попередня ревізія<select className={field} aria-label="Попередня ревізія" value={selected} onChange={e=>{setSelected(e.target.value);setOld(null);setConfirm(false);if(e.target.value)void action(async()=>setOld(await api(`/source/history/${e.target.value}`)));}}><option value="">Оберіть ревізію</option>{history.map(h=><option key={h.revision} value={h.revision}>#{h.revision} · {new Date(h.savedAt).toLocaleString('uk-UA')}</option>)}</select></label>
      {old&&<><h3 className="font-bold">Порівняння тексту сцен</h3>{!changes.length&&<p>Тексти наявних сцен однакові. Інші зміни наведені у повному знімку.</p>}{changes.map((c,index)=><div key={index} className="space-y-2"><h4>{c.label}</h4><pre className="whitespace-pre-wrap break-words">Ревізія {old.revision}: {c.before}</pre><pre className="whitespace-pre-wrap break-words">Зараз: {c.after}</pre></div>)}<details><summary>Повний доступний знімок ревізії {old.revision}</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(old.book,null,2)}</pre></details>
        {data?.canRestore&&<><p>Відновлення замінить усі поля книги цим знімком. Коментарі й завдання збережуться.</p><label className="flex items-center gap-2"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Підтверджую відновлення всієї книги</label><button className={button} disabled={busy||!confirm||source.revision===old.revision} onClick={()=>void action(async()=>{const saved=await api('/source/restore','POST',{sourceRevision:old.revision,expectedRevision:source.revision});onUpdateBook?.(saved.book);await loadHistory();await load();})}>Відновити ревізію {old.revision}</button></>}
      </>}
    </div>}
  </section>;
}

function WorkItemEditor({item,state,busy,save}:{item:WorkItem;state:State;busy:boolean;save:(patch:Record<string,unknown>)=>Promise<void>}) {
  const [text,setText]=useState(item.text),[assignee,setAssignee]=useState(item.assigneeId??''),[due,setDue]=useState(item.dueAt?localDate(item.dueAt):'');
  return <details><summary>Редагувати запис</summary><form className="grid gap-2" onSubmit={e=>{e.preventDefault();void save({text,...(item.kind==='task'?{assigneeId:assignee,dueAt:due}:{} )});}}>
    <label>Текст<textarea className={field} aria-label="Редагування тексту" required maxLength={4000} value={text} onChange={e=>setText(e.target.value)}/></label>
    {item.kind==='task'&&<><label>Виконавець<select className={field} aria-label="Змінити виконавця" value={assignee} onChange={e=>setAssignee(e.target.value)}>{state.participants.map(id=><option key={id} value={id}>{state.names[id]??id}</option>)}</select></label><label>Строк<input className={field} aria-label="Змінити строк" type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/></label></>}
    <button className={button} disabled={busy}>Зберегти зміни</button>
  </form></details>;
}
function localDate(iso:string) {const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
