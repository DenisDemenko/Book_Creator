import React,{useEffect,useRef,useState} from "react";
import {GROUP_TERMS,type GroupCommand,type GroupSummary,type GroupView} from "../../../shared/labyrinthGroup";
import {gs,GsError} from "../graphStudio/gsApi";
import {realtimeSocketUrl} from "../../utils/basePath";
import ReaderMap from "./ReaderMap";
const button="min-h-11 rounded-lg border border-slate-500 px-3 py-2 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-300 disabled:opacity-50";
const field="w-full min-w-0 rounded-lg border border-slate-500 bg-slate-950 p-2";
type Pending={path:string;body:unknown};
export default function LabyrinthGroupReader({projectId}:{projectId:string}) {
  const base="/api/core/projects/"+encodeURIComponent(projectId)+"/labyrinth/reader/groups";
  const [groups,setGroups]=useState<GroupSummary[]>([]),[view,setView]=useState<GroupView|null>(null);
  const [busy,setBusy]=useState(true),[error,setError]=useState(""),[pending,setPending]=useState<Pending|null>(null);
  const [alias,setAlias]=useState(""),[candidate,setCandidate]=useState(false),[acceptTerms,setAcceptTerms]=useState(false);
  const [channel,setChannel]=useState<"player_chat"|"hero_dialogue">("hero_dialogue"),[message,setMessage]=useState("");
  const [contribution,setContribution]=useState(""),[include,setInclude]=useState(false),[aiAssisted,setAiAssisted]=useState(false);
  const [checkpoint,setCheckpoint]=useState(0),[font,setFont]=useState(18),[now,setNow]=useState(Date.now());
  const [transport,setTransport]=useState("Оновлення запитами");
  const epoch=useRef(0),alive=useRef(true),title=useRef<HTMLHeadingElement>(null);
  const current=useRef({view,busy,pending});current.current={view,busy,pending};
  const bookmark=(id?:string)=>{
    const url=new URL(location.href);url.searchParams.set("labyrinth","group");
    url.searchParams.delete("readerRun");
    if(id)url.searchParams.set("groupRun",id);else url.searchParams.delete("groupRun");
    history.replaceState(history.state,"",url);
  };
  const apply=(next:GroupView)=>{
    if(!alive.current)return;
    if(current.current.view?.id===next.id&&current.current.view.revision>next.revision)return;
    current.current.view=next;setView(next);setPending(null);current.current.pending=null;
    setCheckpoint(old=>next.checkpoints.some(c=>c.revision===old)?old:next.checkpoints[0]?.revision??0);bookmark(next.id);
  };
  const reject=(e:unknown)=>{
    if(!alive.current)return;
    if(e instanceof GsError&&[401,403,404].includes(e.status)){
      epoch.current++;current.current.view=null;setView(null);setGroups([]);setPending(null);current.current.pending=null;bookmark();
      setMessage("");setContribution("");setInclude(false);
    }
    setError((e as Error).message||"Не вдалося отримати групове проходження.");
  };
  const refresh=async(id:string)=>{
    const token=epoch.current;
    try{const next=await gs<GroupView>("GET",base+"/"+encodeURIComponent(id));if(token===epoch.current)apply(next);}
    catch(e){if(token===epoch.current)reject(e);}
  };
  const library=async()=>{
    const token=++epoch.current;setBusy(true);setError("");setView(null);current.current.view=null;setPending(null);bookmark();
    try{const next=await gs<{groups:GroupSummary[]}>("GET",base);if(token===epoch.current&&alive.current)setGroups(next.groups);}
    catch(e){reject(e);}finally{if(alive.current)setBusy(false);}
  };
  const open=async(id:string)=>{
    ++epoch.current;setBusy(true);setError("");setPending(null);await refresh(id);if(alive.current)setBusy(false);
  };
  useEffect(()=>{
    alive.current=true;const token=++epoch.current;
    void(async()=>{
      try{
        const next=await gs<{groups:GroupSummary[]}>("GET",base);if(token!==epoch.current||!alive.current)return;setGroups(next.groups);
        const id=new URL(location.href).searchParams.get("groupRun");if(id)await refresh(id);
      }catch(e){if(token===epoch.current)reject(e);}finally{if(alive.current)setBusy(false);}
    })();
    return()=>{alive.current=false;epoch.current++;};
  },[base]);
  useEffect(()=>{if(view?.group.joined)title.current?.focus();},[view?.id,view?.map.currentNodeId,view?.group.joined]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!view)return;const id=view.id;
    let cancelled=false,refreshing=false,ws:WebSocket|undefined;
    const update=async()=>{
      if(cancelled||refreshing||current.current.busy||current.current.pending||current.current.view?.id!==id)return;
      refreshing=true;try{await refresh(id);}finally{refreshing=false;}
    };
    // HTTP recovery is always available. It does not advance the world clock.
    const timer=setInterval(()=>void update(),4000);
    void(async()=>{
      try{
        const ticket=await gs<{ticket:string}>("POST","/api/realtime/ticket",{bookId:projectId});
        if(cancelled)return;
        const url=new URL(realtimeSocketUrl());url.searchParams.set("ticket",ticket.ticket);ws=new WebSocket(url);
        ws.onopen=()=>{if(!cancelled){setTransport("Синхронізація наживо");ws!.send(JSON.stringify({type:"labyrinth:subscribe",payload:{runId:id}}));}};
        ws.onmessage=event=>{
          try{const m=JSON.parse(event.data);if(m.type==="labyrinth:changed"&&Number.isSafeInteger(m.revision)&&m.revision>(current.current.view?.revision??-1))void update();}catch{}
        };
        ws.onclose=event=>{
          if(cancelled)return;setTransport("Оновлення запитами");
          if(event.code===4403)void refresh(id);
        };
      }catch{if(!cancelled)setTransport("Оновлення запитами");}
    })();
    return()=>{cancelled=true;clearInterval(timer);ws?.close();};
  },[view?.id,base,projectId]);
  const submit=async(operation:Pending)=>{
    const token=epoch.current;setBusy(true);current.current.busy=true;setError("");setPending(operation);current.current.pending=operation;
    try{
      const next=await gs<GroupView|{left:true}>("POST",operation.path,operation.body);
      if(token!==epoch.current||!alive.current)return;
      if("left" in next){await library();return;}
      apply(next);
      const command=(operation.body as {command?:GroupCommand}).command;
      if(command?.kind==="message")setMessage("");
      if(command?.kind==="contribute"){setContribution("");setInclude(false);}
    }catch(e){
      if(token!==epoch.current)return;reject(e);
      if(e instanceof GsError&&e.status<500){
        setPending(null);current.current.pending=null;
        if(e.status===409&&current.current.view)await refresh(current.current.view.id);
      }
    }finally{if(alive.current){setBusy(false);current.current.busy=false;}}
  };
  const send=(command:GroupCommand)=>{
    if(!view)return;
    void submit({path:base+"/"+encodeURIComponent(view.id)+"/commands",body:{expectedRevision:view.revision,command,key:crypto.randomUUID()}});
  };
  const decision=view?.group.decision,actor=view?.group.members.find(m=>m.currentTurn);
  return <section className="min-w-0 space-y-4 rounded-xl bg-slate-900 p-3 text-slate-100 [overflow-wrap:anywhere]" aria-busy={busy} data-group-reader>
    <h2 className="text-xl font-bold">Групове проходження</h2>
    <p>Кожен керує своїм героєм. Час історії змінюється після дій; читання, голосування й чат його не витрачають.</p>
    {error&&<p role="alert" className="rounded-lg border border-amber-400 p-3">{error}</p>}
    {busy&&<p role="status">Завантаження…</p>}
    {pending&&!busy&&<button className={button} data-group-retry onClick={()=>void submit(pending)}>Повторити запит</button>}
    {!view?<div className="space-y-3">
      <button className={button} disabled={busy} onClick={()=>void library()}>Оновити групи</button>
      {!busy&&!groups.length&&<p>Автор ще не призначив вам героя. Запрошення з’являться тут після створення групи.</p>}
      {groups.map(g=><button className={button+" mr-2"} key={g.id} disabled={busy} data-group-open={g.id} onClick={()=>void open(g.id)}>
        {g.title} · {g.alias} · {g.invited?"Запрошення":g.status==="lobby"?"Підготовка":g.status==="finished"?"Завершено":"Гра"}
      </button>)}
    </div>:<>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={()=>void library()}>До списку груп</button>
        <button className={button} disabled={busy} data-group-refresh onClick={()=>void open(view.id)}>Оновити стан</button>
        <button className={button} disabled={font>=28} aria-label="Збільшити текст групи" onClick={()=>setFont(v=>v+2)}>А+</button>
        <button className={button} disabled={font<=16} aria-label="Зменшити текст групи" onClick={()=>setFont(v=>v-2)}>А−</button>
      </div>
      <p role="status" data-group-progress>r{view.revision} · хід {view.turn} · час історії {view.storyTime} · {transport}</p>
      <ul className="flex flex-wrap gap-3" aria-label="Порядок ходів">
        {view.group.members.map(m=><li key={m.heroId} data-group-member={m.heroId}>
          {m.alias}{m.flc?" · автономний FLC":""} · {m.status==="invited"?"ще не приєднався":m.status==="left"?"участь завершена":"готовий"}
          {m.currentTurn?" · його черга":""}
        </li>)}
      </ul>
      {!view.group.joined?<fieldset disabled={busy||!!pending} className="space-y-3">
        <legend>Приєднання</legend>
        <label>Ваше ім’я або псевдонім<input className={field} value={alias} maxLength={80} onChange={e=>setAlias(e.target.value)} data-group-alias/></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={candidate} onChange={e=>setCandidate(e.target.checked)} data-group-candidate/>Хочу пропонувати текст як кандидат у співавтори</label>
        <p>Вхід не надає співавторства й не дозволяє публікувати ваші повідомлення. Кожний внесок потребує окремої згоди. Остаточне видання погоджується окремо.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={acceptTerms} onChange={e=>setAcceptTerms(e.target.checked)} data-group-terms/>Розумію правила участі та видимість чатів</label>
        <button className={button} disabled={!alias.trim()||!acceptTerms} data-group-join onClick={()=>send({kind:"join",alias,candidate,terms:GROUP_TERMS})}>Приєднатися своїм героєм</button>
      </fieldset>:<>
        {view.group.status==="lobby"&&<p role="status" data-group-lobby>Ви готові. Після приєднання всіх учасників автор запустить гру.</p>}
        <article style={{fontSize:font}} className="space-y-3 whitespace-pre-wrap leading-relaxed" data-group-scene>
          <h2 ref={title} tabIndex={-1} className="text-2xl font-bold">{view.scene.title}</h2>
          {view.scene.paragraphs.map((p,i)=>p.kind==="heading"?<h3 className="font-bold" key={i}>{p.text}</h3>:
            p.kind==="blockquote"?<blockquote key={i} className="border-l-2 pl-3">{p.text}</blockquote>:<p key={i}>{p.text}</p>)}
          <p>{view.description}</p>
        </article>
        <p><strong>{view.hero.name}</strong> · {Object.entries(view.hero.resources).map(([k,v])=>(k==="health"?"Здоров’я":k==="energy"?"Сили":k)+": "+v).join(" · ")}</p>
        {!!view.warnings.length&&<section className="rounded-lg border border-amber-400 p-3" role="status">
          {view.warnings.map((w,i)=><p key={i}>{w.phase==="warning"?"Попередження":"Небезпека"}: {w.text} {w.avoidance}</p>)}
        </section>}
        <details data-group-knowledge><summary className="cursor-pointer py-2">Мої предмети та знання</summary>
          <p>Предмети: {view.hero.inventory.join(", ")||"немає"}</p>
          <ul>{view.hero.knowledge.map((k,i)=><li key={i}>{k}</li>)}</ul>
        </details>
        {decision?<section className="space-y-2 rounded-lg border border-teal-400 p-3" data-group-decision>
          <h3 className="font-semibold">{decision.label}</h3>
          <p>Підтримали: {decision.approvals}; потрібно: {decision.required}. {decision.myVote===null?"Ваш голос ще не записаний.":decision.myVote?"Ви підтримали.":"Ви відхилили."}</p>
          <button className={button} disabled={busy||!!pending||!decision.canVote} data-group-vote-yes onClick={()=>send({kind:"vote",decisionId:decision.id,approve:true})}>Погодити</button>
          <button className={button+" ml-2"} disabled={busy||!!pending||!decision.canVote} data-group-vote-no onClick={()=>send({kind:"vote",decisionId:decision.id,approve:false})}>Відхилити</button>
        </section>:<fieldset disabled={busy||!!pending||!view.group.myTurn} className="space-y-2">
          <legend>{view.group.myTurn?"Ваш хід":"Чекаємо на хід: "+(actor?.alias??"група")}</legend>
          {view.choices.map(c=><button className={button+" block w-full text-left"} key={c.edgeId} disabled={!c.available} data-group-move={c.edgeId}
            onClick={()=>send({kind:"action",action:{kind:"move",edgeId:c.edgeId}})}>{c.label}{c.reason?" — "+c.reason:""}</button>)}
          {view.interactions.map(i=><button className={button+" mr-2"} key={i.objectId+":"+i.to} disabled={!i.available}
            onClick={()=>send({kind:"action",action:{kind:"interact",objectId:i.objectId,to:i.to}})}>{i.label}</button>)}
          {view.group.jointActions.map(j=><button className={button+" mr-2"} key={j.id} data-group-propose={j.id} onClick={()=>send({kind:"propose_action",jointId:j.id})}>{j.label} · запропонувати групі</button>)}
          <button className={button+" mr-2"} data-group-wait onClick={()=>send({kind:"action",action:{kind:"wait"}})}>Зачекати один крок історії</button>
          <button className={button} data-group-pass onClick={()=>send({kind:"pass"})}>Передати чергу без витрати часу</button>
        </fieldset>}
        {view.group.status==="playing"&&<div className="space-y-2">
          <p>Спільне рішення: {view.group.rules.decision==="unanimous"?"одностайність":"більшість"}. Відсутність: {view.group.rules.absence==="pause"?"чекати учасника":"дозволити пропуск після строку"}.</p>
          {view.group.deadline&&<p>Строк поточної черги: {new Date(view.group.deadline).toLocaleTimeString()}.</p>}
          {actor?.flc&&<button className={button} disabled={busy||!!pending||!!decision} data-group-flc onClick={()=>send({kind:"advance_flc"})}>Виконати хід FLC за локальними правилами</button>}
          {(actor?.status==="left"||view.group.rules.absence==="skip")&&<button className={button} disabled={busy||!!pending||actor?.status!=="left"&&(!view.group.deadline||now<new Date(view.group.deadline).getTime())}
            data-group-absent onClick={()=>send({kind:"advance_absent"})}>Продовжити після відсутнього учасника</button>}
        </div>}
        {view.group.status==="finished"&&<p role="status" data-group-complete>Групове проходження завершено.</p>}
        {!!view.map.nodes.length&&<ReaderMap map={view.map}/>}
        <section className="min-w-0 space-y-2 rounded-lg border border-slate-600 p-3">
          <h3 className="font-semibold">Розмова</h3>
          <p>Чат гравців бачить уся група. Діалог героя бачать лише герої поруч у момент надсилання. Ці повідомлення не стають внесками.</p>
          <label>Канал<select className={field} value={channel} onChange={e=>setChannel(e.target.value as typeof channel)} data-group-channel>
            <option value="hero_dialogue">Діалог героїв поруч</option><option value="player_chat">Чат усіх гравців</option>
          </select></label>
          <ol className="max-h-72 space-y-2 overflow-auto" data-group-messages>
            {view.messages.map(m=><li key={m.id}><strong>{m.alias} · {m.channel==="hero_dialogue"?"герой":"гравець"}: </strong>{m.text}</li>)}
          </ol>
          <label>Повідомлення<textarea className={field} rows={3} maxLength={4000} value={message} onChange={e=>setMessage(e.target.value)} data-group-message/></label>
          <button className={button} disabled={busy||!!pending||!message.trim()} data-group-send onClick={()=>send({kind:"message",channel,text:message})}>Надіслати в обраний канал</button>
        </section>
        {view.group.candidate&&<section className="min-w-0 space-y-2 rounded-lg border border-teal-600 p-3">
          <h3 className="font-semibold">Мій текст для майбутньої книги</h3>
          <p>Це окрема пропозиція до чернетки. Автор бачить цей текст і його походження. Остаточне видання й співавторство погоджуються окремо.</p>
          <label>Внесок<textarea className={field} rows={4} value={contribution} maxLength={8000} onChange={e=>setContribution(e.target.value)} data-group-contribution/></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={include} onChange={e=>setInclude(e.target.checked)} data-group-include/>Дозволяю включити саме цей текст до журналу матеріалів книги</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={aiAssisted} onChange={e=>setAiAssisted(e.target.checked)}/>Під час написання використано ШІ</label>
          <button className={button} disabled={busy||!!pending||!include||!contribution.trim()} data-group-submit-contribution
            onClick={()=>send({kind:"contribute",text:contribution,include,aiAssisted,terms:GROUP_TERMS})}>Додати погоджений текст</button>
        </section>}
        <section className="space-y-2" data-group-contributions>
          <h3 className="font-semibold">Мої погоджені внески</h3>
          {view.contributions.map(c=><article className="rounded-lg border p-3" key={c.id}>
            <p>{c.text}</p><p className="text-sm">Карта v{c.mapRevision} · джерело r{c.sourceRevision}{c.aiAssisted?" · участь ШІ":""}</p>
            <button className={button} disabled={busy||!!pending} data-group-withdraw={c.id} onClick={()=>send({kind:"withdraw_contribution",contributionId:c.id})}>Відкликати дозвіл на цей внесок</button>
          </article>)}
        </section>
        {view.group.status!=="lobby"&&<fieldset disabled={busy||!!pending||!!decision} className="space-y-2 rounded-lg border p-3">
          <legend>Спільне повернення</legend>
          <label>Збережений хід<select className={field} value={checkpoint} data-group-checkpoint onChange={e=>setCheckpoint(Number(e.target.value))}>
            {view.checkpoints.map(c=><option key={c.revision} value={c.revision}>r{c.revision} · {c.label} · час {c.storyTime}</option>)}
          </select></label>
          <p>Повернення потребує згоди всіх учасників. Історія та внески зберігаються; відкликані права не відновлюються.</p>
          <button className={button} data-group-restore onClick={()=>send({kind:"propose_restore",sourceRevision:checkpoint})}>Запропонувати повернути всю групу</button>
        </fieldset>}
        <button className={button} disabled={busy||!!pending} data-group-leave onClick={()=>{
          if(confirm("Завершити участь у цій групі? Для нового проходження автор має створити нову групу."))send({kind:"leave"});
        }}>Завершити мою участь</button>
      </>}
    </>}
  </section>;
}
