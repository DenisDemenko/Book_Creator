import React,{useEffect,useState} from "react";
import type {LabyrinthDefinition} from "../../../shared/labyrinth";
import type {ReaderPublication} from "../../../shared/labyrinthReader";
import type {GroupBinding,GroupRules,JointAction} from "../../../shared/labyrinthGroup";
import {gs,GsError} from "../graphStudio/gsApi";
import {API_BASE} from "../../utils/basePath";
const button="min-h-11 rounded-lg border border-slate-500 px-3 py-2 hover:bg-slate-700 disabled:opacity-50";
const field="w-full min-w-0 rounded-lg border border-slate-500 bg-slate-950 p-2";
type Summary={id:string;revision:number;status:string};
type Operation={path:string;body:unknown};
export function GroupSetup({base,mapId,definition,publication,disabled}:{base:string;mapId:string;definition:LabyrinthDefinition;publication:ReaderPublication;disabled:boolean}) {
  const [users,setUsers]=useState<Array<{userId:string;name:string}>>([]),[bindings,setBindings]=useState<GroupBinding[]>([]);
  const [decision,setDecision]=useState<GroupRules["decision"]>("unanimous"),[absence,setAbsence]=useState<GroupRules["absence"]>("pause");
  const [timeout,setTimeout]=useState(0),[joints,setJoints]=useState<JointAction[]>([]);
  const [jointLabel,setJointLabel]=useState("Спільний важіль"),[transition,setTransition]=useState("");
  const [supports,setSupports]=useState<Record<string,string>>({});
  const [groups,setGroups]=useState<Summary[]>([]),[journal,setJournal]=useState<Array<{id:string;alias:string;text:string;sourceRevision:number;aiAssisted:boolean}>>([]);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[pending,setPending]=useState<Operation|null>(null);
  const heroes=definition.heroes.filter(h=>publication.heroIds.includes(h.id));
  const load=async()=>{const result=await gs<{groups:Summary[]}>("GET",base+"/maps/"+mapId+"/groups");setGroups(result.groups);};
  useEffect(()=>{
    let live=true;setBindings(heroes.map(h=>({heroId:h.id,userId:"",alias:h.name})));setJoints([]);setSupports({});setJournal([]);
    void Promise.all([gs<{users:typeof users}>("GET",base+"/group-candidates"),gs<{groups:Summary[]}>("GET",base+"/maps/"+mapId+"/groups")])
      .then(([people,sessions])=>{if(live){setUsers(people.users);setGroups(sessions.groups);}})
      .catch(e=>{if(live)setNotice(e.message);});
    return()=>{live=false;};
  },[base,mapId,publication.revision]);
  const run=async(op:Operation)=>{
    setBusy(true);setNotice("");setPending(op);
    try{await gs("POST",op.path,op.body);setPending(null);setNotice("Збережено.");await load();}
    catch(e){setNotice((e as Error).message);if(e instanceof GsError&&e.status<500){setPending(null);await load().catch(()=>{});}}
    finally{setBusy(false);}
  };
  const link=(id:string)=>API_BASE+"/projects/"+(base.match(/projects\/([^/]+)\/labyrinth/)?.[1]??"")+"/labyrinth-reader?labyrinth=group&groupRun="+id;
  const valid=bindings.length>=2&&bindings.every(b=>b.userId===null||!!b.userId);
  const move=(i:number,delta:number)=>setBindings(old=>{const next=[...old];[next[i],next[i+delta]]=[next[i+delta],next[i]];return next;});
  return <section className="min-w-0 space-y-3 rounded-lg border border-slate-600 p-3" data-group-setup>
    <h3 className="font-semibold">Підготовка групового проходження</h3>
    <p>Герої призначаються учасникам із чинним переглядом книги. Кожен сам підтвердить участь і вибере псевдонім. Призначення не надає нових прав на книгу.</p>
    <fieldset disabled={disabled||busy||!!pending} className="min-w-0 space-y-3">
      <legend>Герої та порядок ходів</legend>
      {bindings.map((b,i)=><div key={b.heroId} className="grid min-w-0 gap-2 md:grid-cols-3">
        <label>{heroes.find(h=>h.id===b.heroId)?.name}
          <select className={field} value={b.userId??"__flc__"} data-group-bind={b.heroId} onChange={e=>setBindings(old=>old.map(x=>x.heroId===b.heroId?{...x,userId:e.target.value==="__flc__"?null:e.target.value}:x))}>
            <option value="">Оберіть учасника</option>{users.map(u=><option value={u.userId} key={u.userId}>{u.name}</option>)}
            <option value="__flc__">Автономний FLC · локальні правила</option>
          </select>
        </label>
        <label>Ім’я в запрошенні<input className={field} value={b.alias} maxLength={80} onChange={e=>setBindings(old=>old.map(x=>x.heroId===b.heroId?{...x,alias:e.target.value}:x))}/></label>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={i===0} onClick={()=>move(i,-1)} aria-label={"Раніше: "+b.alias}>↑</button>
          <button className={button} disabled={i===bindings.length-1} onClick={()=>move(i,1)} aria-label={"Пізніше: "+b.alias}>↓</button>
          <button className={button} onClick={()=>setBindings(old=>old.filter(x=>x.heroId!==b.heroId))}>Прибрати героя</button>
        </div>
      </div>)}
      {heroes.filter(h=>!bindings.some(b=>b.heroId===h.id)).map(h=><button className={button} key={h.id} onClick={()=>setBindings(old=>[...old,{heroId:h.id,userId:"",alias:h.name}])}>Додати {h.name}</button>)}
      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        <label>Спільне рішення<select className={field} value={decision} onChange={e=>setDecision(e.target.value as typeof decision)}><option value="unanimous">Одностайність</option><option value="majority">Більшість</option></select></label>
        <label>Відсутність<select className={field} value={absence} onChange={e=>{setAbsence(e.target.value as typeof absence);if(e.target.value==="skip"&&timeout<5)setTimeout(60);}}><option value="pause">Чекати учасника</option><option value="skip">Дозволити пропуск після строку</option></select></label>
        <label>Строк черги, секунд (0 — без таймера)<input className={field} type="number" min={0} max={3600} value={timeout} onChange={e=>setTimeout(Number(e.target.value))}/></label>
      </div>
      <details className="space-y-2">
        <summary className="cursor-pointer py-2">Додати спільний механізм</summary>
        <label>Назва дії<input className={field} value={jointLabel} onChange={e=>setJointLabel(e.target.value)} maxLength={160} data-group-joint-label/></label>
        <label>Перехід механізму<select className={field} value={transition} data-group-joint-transition onChange={e=>setTransition(e.target.value)}>
          <option value="">Оберіть механізм</option>{definition.objects.flatMap(o=>o.transitions.map(t=><option key={o.id+":"+t.from+":"+t.to} value={JSON.stringify({objectId:o.id,to:t.to})}>{o.id} · {t.from} → {t.to}</option>))}
        </select></label>
        <p>Принаймні два герої мають зайняти свої місця; один — біля механізму.</p>
        {bindings.map(b=><label className="block" key={b.heroId}>{b.alias}<select className={field} data-group-support={b.heroId} value={supports[b.heroId]??""} onChange={e=>setSupports(old=>({...old,[b.heroId]:e.target.value}))}>
          <option value="">Не потрібен для підтримки</option>{definition.nodes.map(n=><option key={n.id} value={n.id}>{n.title} · {n.level==="upper"?"згори":"знизу"}</option>)}
        </select></label>)}
        <button className={button} data-group-add-joint disabled={!transition||!jointLabel.trim()||bindings.filter(b=>supports[b.heroId]).length<2} onClick={()=>{
          setJoints(old=>[...old,{id:crypto.randomUUID(),label:jointLabel,...JSON.parse(transition),supports:bindings.filter(b=>supports[b.heroId]).map(b=>({heroId:b.heroId,nodeId:supports[b.heroId]}))}]);setTransition("");setSupports({});
        }}>Додати спільну дію</button>
      </details>
      {joints.map(j=><p key={j.id}>{j.label} · {j.supports.length} героїв <button className={button} onClick={()=>setJoints(old=>old.filter(x=>x.id!==j.id))}>Прибрати дію</button></p>)}
      <button className={button} disabled={!valid} data-group-create onClick={()=>void run({
        path:base+"/maps/"+mapId+"/groups",body:{publicationRevision:publication.revision,bindings,
          rules:{order:bindings.map(b=>b.heroId),decision,absence,timeoutSeconds:timeout,jointActions:joints},key:crypto.randomUUID()}})}>Створити групу й запрошення</button>
    </fieldset>
    {pending&&!busy&&<button className={button} onClick={()=>void run(pending)}>Повторити той самий запит</button>}
    <button className={button} disabled={busy} data-group-author-refresh onClick={()=>void load().catch(e=>setNotice(e.message))}>Оновити готовність груп</button>
    {notice&&<p role="status">{notice}</p>}
    {groups.map(g=><div className="space-y-2 rounded-lg border p-2" key={g.id} data-group-author-session={g.id}>
      <p>{g.status==="lobby"?"Підготовка":g.status==="playing"?"Гра":"Завершено"} · r{g.revision}</p>
      <a className="underline" href={link(g.id)}>Відкрити групове проходження</a>
      <button className={button} disabled={busy||!!pending||g.status!=="lobby"} data-group-launch={g.id}
        onClick={()=>void run({path:base+"/groups/"+g.id+"/launch",body:{expectedRevision:g.revision,key:crypto.randomUUID()}})}>Запустити після приєднання всіх</button>
      <button className={button} disabled={busy} data-group-author-journal={g.id} onClick={()=>void gs<{contributions:typeof journal}>("GET",base+"/groups/"+g.id+"/contributions").then(v=>setJournal(v.contributions)).catch(e=>setNotice(e.message))}>Переглянути погоджені внески</button>
    </div>)}
    <section data-group-author-contributions>{journal.map(c=><p key={c.id}>{c.alias}: {c.text} · джерело r{c.sourceRevision}{c.aiAssisted?" · ШІ":""}</p>)}</section>
    <p>Літературна збірка завершеного проходження — наступний етап Т9.8. Остаточне співавторство погоджується окремо. Чати до журналу внесків не копіюються.</p>
  </section>;
}
