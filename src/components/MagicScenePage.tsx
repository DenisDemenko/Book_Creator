import React,{useEffect,useState} from 'react';import type {Book} from '../types';import type {MagicSceneRun} from '../../server/core/magicSceneTypes';
interface Workspace {scenes:{id:string;title:string}[];characters:{id:string;name:string;agent:{autonomyLevel:string;enabled:boolean}|null}[];runs:MagicSceneRun[];bookRevision:number;branchRevision:number}
export function MagicScenePage({book,onUpdateBook}:{book:Book;onUpdateBook?:(book:Book,action?:string,details?:string)=>void}){
 const [streamText,setStreamText]=useState('');
 const [state,setState]=useState<Workspace>(),[scene,setScene]=useState(''),[participants,setParticipants]=useState<string[]>([]),[goal,setGoal]=useState(''),[constraints,setConstraints]=useState(''),[maxTurns,setMaxTurns]=useState(6),[selected,setSelected]=useState(''),[tab,setTab]=useState<'protocol'|'text'>('protocol'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[authorAction,setAuthorAction]=useState(''),[confirm,setConfirm]=useState(false),[warningsOk,setWarningsOk]=useState(false),[canonOk,setCanonOk]=useState(false),[tags,setTags]=useState<Record<string,boolean>>({}),[checks,setChecks]=useState<unknown>();
 const base=`/api/core/projects/${encodeURIComponent(book.id)}`;
 const api=async(path:string,method='GET',body?:unknown)=>{const res=await fetch(base+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await res.json();if(!res.ok)throw new Error(value.error??`Помилка ${res.status}`);return value;};
 const load=async()=>setState(await api('/magic-scenes'));
 useEffect(()=>{load().catch(e=>setError(e.message));},[book.id]);
 const run=state?.runs.find(r=>r.simulationId===selected),prefix=run?`/simulations/${run.simulationId}`:'';
 const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await load();}catch(e){setError(e instanceof Error?e.message:String(e));await load().catch(()=>{});}finally{setBusy(false);setConfirm(false);}};
 const mutation=(path:string,body:object={})=>api(path,'POST',{...body,expectedRevision:run?.revision});
 const streamDraft=async()=>{
  setStreamText('');setTab('text');const response=await fetch(base+prefix+'/draft-stream',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:run?.revision})});
  if(!response.ok){const e=await response.json();throw new Error(e.error??'Не вдалося створити чернетку.');}if(!response.body)throw new Error('Потік недоступний.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';let complete=false;
  try{while(true){const {value,done}=await reader.read();pending+=decoder.decode(value,{stream:!done});const lines=pending.split('\n');pending=lines.pop()!;for(const line of lines){if(!line)continue;const event=JSON.parse(line);if(event.type==='fragment')setStreamText(text=>text+'\n\n'+event.fragment.text);if(event.type==='complete')complete=true;}if(done)break;}if(!complete)throw new Error('Потік перервано. Оновіть прогін.');}finally{reader.releaseLock();}
 };
 const name=(id:string)=>state?.characters.find(c=>c.id===id)?.name??id;
 return <section data-magic-scene className="space-y-4 min-w-0 text-slate-200 border-b border-slate-700 pb-8 mb-8">
  <h2 className="text-xl font-semibold">Magic Scene</h2><p>Герої діють по черзі зі своїми знаннями. Події й літературна чернетка зберігаються окремо від рукопису. Протокол із приватними думками доступний власнику книги.</p>
  {error&&<p role="alert" className="text-amber-300 break-words">{error}</p>}
  {!state?<p>Завантаження…</p>:<>
   <fieldset disabled={busy} className="space-y-2"><legend>Режисер сцени</legend>
    <select aria-label="Сцена Magic Scene" value={scene} onChange={e=>setScene(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Оберіть сцену</option>{state.scenes.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select>
    <p>Оберіть 2–3 героїв у порядку ходів:</p><div className="flex flex-wrap gap-3">{state.characters.map(c=><label key={c.id}><input data-magic-character={c.id} type="checkbox" disabled={!participants.includes(c.id)&&participants.length>=3} checked={participants.includes(c.id)} onChange={e=>setParticipants(e.target.checked?[...participants,c.id]:participants.filter(id=>id!==c.id))}/>{c.name}{participants.includes(c.id)?` · хід ${participants.indexOf(c.id)+1}`:''}{c.agent?.autonomyLevel==='scene'?' · автономний':''}</label>)}</div>
    <button disabled={participants.length<2} onClick={()=>act(async()=>{await api('/magic-scenes/agents','POST',{characterIds:participants});})}>Дозволити вибраним героям автономну участь</button>
    <textarea aria-label="Мета Magic Scene" value={goal} onChange={e=>setGoal(e.target.value)} rows={2} maxLength={2000} placeholder="Мета сцени" className="bg-slate-900 p-2 w-full"/>
    <textarea aria-label="Межі Magic Scene" value={constraints} onChange={e=>setConstraints(e.target.value)} rows={2} maxLength={2000} placeholder="Межі, умови й дозволені зміни" className="bg-slate-900 p-2 w-full"/>
    <label>Ліміт ходів <input aria-label="Ліміт ходів Magic Scene" type="number" min={2} max={60} value={maxTurns} onChange={e=>setMaxTurns(Number(e.target.value))} className="bg-slate-900 p-2 w-20"/></label>
    <button disabled={!scene||participants.length<2||!goal.trim()} onClick={()=>act(async()=>{const r=await api(`/scenes/${encodeURIComponent(scene)}/simulations`,'POST',{participants,goal,constraints,maxTurns});setSelected(r.run.simulationId);setChecks(undefined);})} className="ml-3">Почати Magic Scene</button>
   </fieldset>
   <select aria-label="Прогін Magic Scene" value={selected} onChange={e=>{setSelected(e.target.value);setChecks(undefined);setConfirm(false);setWarningsOk(false);setCanonOk(false);setTags({});}} className="bg-slate-900 p-2 max-w-full"><option value="">Оберіть прогін</option>{state.runs.map(r=><option key={r.simulationId} value={r.simulationId}>{r.goal} · {r.status} · {r.events.length} ходів</option>)}</select>
   {run&&<>
    <p>Стан: {run.status}. Ходів: {run.events.length}/{run.maxTurns}. Межа знань: глава {run.asOfChapter}. Наступний герой: {name(run.participants[run.events.length%run.participants.length])}.</p>
    {run.busy&&<p>Триває {run.busy.kind}. Пауза скасовує незавершену генерацію; затвердження потрібно завершити повтором після збою.</p>}
    {run.lastError&&<p className="text-amber-300 break-words">{run.lastError}</p>}
    <fieldset disabled={busy} className="flex flex-wrap gap-3">
     <button disabled={run.status!=='active'||!!run.busy||!!run.fragments.length} onClick={()=>act(async()=>{await mutation(prefix+'/step',{requestId:crypto.randomUUID(),...(authorAction?{authorAction}:{})});})}>Наступний хід</button>
     <button disabled={run.status==='closed'||run.busy?.kind==='approve'} onClick={()=>act(async()=>{await mutation(prefix+'/pause',{status:run.status==='paused'?'active':'paused'});})}>{run.status==='paused'?'Продовжити':'Пауза'}</button>
     <select aria-label="Явна дія автора" value={authorAction} onChange={e=>setAuthorAction(e.target.value)} className="bg-slate-900 p-2 max-w-full"><option value="">Дію обирає Jev / запасний LLM</option>{['answer','ask','act','silence','deflect','confess'].map(a=><option key={a} value={a}>{a}</option>)}</select>
     <button disabled={!run.events.length||!!run.fragments.length||!!run.busy} onClick={()=>act(async()=>{await streamDraft();})}>Створити літературну чернетку</button>
    </fieldset>
    <div className="flex flex-wrap gap-3" role="tablist"><button role="tab" aria-selected={tab==='protocol'} onClick={()=>setTab('protocol')}>Протокол агентів</button><button role="tab" aria-selected={tab==='text'} onClick={()=>setTab('text')}>Літературний текст</button></div>
    {tab==='protocol'?<div className="space-y-3">{run.events.map(event=><article key={event.id} className="border border-slate-700 rounded p-3 break-words"><p>Хід {event.turn} · {name(event.characterId)} · {event.action}</p><p className="whitespace-pre-wrap">{event.speech}</p><p>{event.actionText}</p><p className="text-sm">Спостерігачі: {event.audience.map(name).join(', ')}</p><details><summary>Приватний протокол героя · для автора</summary>{run.privateSteps.filter(s=>s.eventId===event.id).map(s=><div key={s.eventId}><p>{s.thought}</p><p>{s.intent}</p><p>Рішення: {String(s.decision.source??'Jev')} · {String(s.decision.action)}</p></div>)}</details></article>)}</div>:<div className="space-y-3">
     <details><summary>Оригінал сцени на початку прогону</summary><p className="whitespace-pre-wrap break-words">{run.sourceText}</p></details>
     {busy&&streamText&&<p data-magic-stream className="whitespace-pre-wrap">{streamText}</p>}
     <p>Чернетка додає нові фрагменти до сцени. Теги — окремі пропозиції; виберіть лише ті, які затверджуєте.</p>
     {run.fragments.map(f=><article key={f.id} className="border border-slate-700 rounded p-3 space-y-2 break-words"><p>Статус: {f.status}</p><p className="whitespace-pre-wrap">{f.text}</p><p className="text-sm">Події-докази: {f.eventIds.map(id=>run.events.find(e=>e.id===id)?.turn).join(', ')}</p>{f.tags.map(t=><label key={t.id} className="block"><input type="checkbox" disabled={f.status!=='draft'} checked={f.status==='draft'?!!tags[t.id]:(f.selectedTagIds??[]).includes(t.id)} onChange={e=>setTags({...tags,[t.id]:e.target.checked})}/>{t.value} · пропозиція</label>)}
      {(f.status==='draft'||f.status==='applying')&&<div className="flex flex-wrap gap-3"><button disabled={busy||!confirm||!!run.busy} onClick={()=>act(async()=>{const r=await mutation(prefix+'/approve',{fragmentId:f.id,confirm:true,tagIds:f.status==='applying'?f.selectedTagIds??[]:f.tags.filter(t=>tags[t.id]).map(t=>t.id),expectedBranchRevision:state.branchRevision,expectedBookRevision:state.bookRevision,acknowledgeWarnings:warningsOk,acknowledgeCanonChange:canonOk});onUpdateBook?.(r.book,'Затверджено Magic Scene',run.goal);setChecks(r.checks);})}>Затвердити цей фрагмент і видимі спогади</button>{(f.status==='draft'||f.status==='applying')&&<button disabled={busy} onClick={()=>act(async()=>{await mutation(prefix+'/reject',{fragmentId:f.id});})}>Відхилити фрагмент</button>}{f.branchId&&<button disabled={busy} onClick={()=>act(async()=>{setChecks(await api(`/branches/${f.branchId}/check`,'POST',{}));})}>Перевірити гілку</button>}</div>}
     </article>)}
     <button disabled={busy||!run.fragments.length} onClick={()=>act(async()=>{setChecks(await mutation(prefix+'/check'));})}>Перевірити всю чернетку</button>
     <label className="block"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> Підтверджую вибраний фрагмент і пам’ять лише тих героїв, що спостерігали його події</label>
     <label className="block"><input type="checkbox" checked={warningsOk} onChange={e=>setWarningsOk(e.target.checked)}/> Перевірив попередження безперервності й причинності та підтверджую їх</label>
     <label className="block"><input type="checkbox" checked={canonOk} onChange={e=>setCanonOk(e.target.checked)}/> Перевірив зміни канону після створення гілки</label>
     {checks!==undefined&&<pre className="whitespace-pre-wrap break-words bg-slate-900 p-3 text-xs">{JSON.stringify(checks,null,2)}</pre>}
    </div>}
   </>}
  </>}
 </section>;
}
