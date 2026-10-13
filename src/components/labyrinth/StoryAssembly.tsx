import React,{useEffect,useRef,useState} from "react";
import type {StoryDraft,StoryDraftSummary,StoryRunSummary} from "../../../shared/labyrinthStory";
import type {Book} from "../../types";
import {gs,GsError} from "../graphStudio/gsApi";
import {saveBook,saveMeta,META_ACTIVE_BOOK} from "../../utils/storage";
import {buildAppPath} from "../../utils/appRoutes";
import {API_BASE} from "../../utils/basePath";
const button="min-h-11 rounded-lg border border-slate-500 px-3 py-2 hover:bg-slate-700 disabled:opacity-50";
const field="w-full min-w-0 rounded-lg border border-slate-500 bg-slate-950 p-2";
type Operation={path:string;body:unknown};
export function StoryAssembly({base,mapId,disabled}:{base:string;mapId:string;disabled:boolean}) {
  const[runs,setRuns]=useState<StoryRunSummary[]>([]),[drafts,setDrafts]=useState<StoryDraftSummary[]>([]);
  const[runId,setRunId]=useState(""),[title,setTitle]=useState("Історія проходження"),[draft,setDraft]=useState<StoryDraft|null>(null);
  const[edits,setEdits]=useState<Record<string,string|null>>({}),[reviewed,setReviewed]=useState(false),[confirmAi,setConfirmAi]=useState(false);
  const[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[pending,setPending]=useState<Operation|null>(null),generation=useRef(0);
  const list=async(token=generation.current)=>{
    const data=await gs<{runs:StoryRunSummary[];drafts:StoryDraftSummary[]}>("GET",base+"/maps/"+mapId+"/story-drafts");
    if(generation.current===token){setRuns(data.runs);setDrafts(data.drafts);setRunId(old=>data.runs.some(r=>r.id===old)?old:data.runs[0]?.id??"");}
  };
  const received=(v:StoryDraft)=>{setDraft(v);setTitle(v.title);setEdits({});setReviewed(false);setConfirmAi(false);};
  useEffect(()=>{
    const token=++generation.current;setDraft(null);setDrafts([]);setRuns([]);setEdits({});setPending(null);setNotice("");
    setTitle("Історія проходження");setReviewed(false);setConfirmAi(false);setBusy(true);
    void list(token).catch(e=>{if(generation.current===token)setNotice(e.message);}).finally(()=>{if(generation.current===token)setBusy(false);});
    return()=>{generation.current++;};
  },[base,mapId]);
  const open=async(id:string)=>{
    const token=generation.current;setBusy(true);setNotice("");setDraft(null);setEdits({});
    try{const v=await gs<StoryDraft>("GET",base+"/story-drafts/"+encodeURIComponent(id));if(token===generation.current)received(v);}
    catch(e){if(token===generation.current)setNotice((e as Error).message);}finally{if(token===generation.current)setBusy(false);}
  };
  const perform=async(op:Operation)=>{
    const token=generation.current;setBusy(true);setPending(op);setNotice("");
    try{const v=await gs<StoryDraft>("POST",op.path,op.body);if(token===generation.current){received(v);setPending(null);setNotice(v.status==="accepted"?"Нову приватну книгу створено.":"Чернетку збережено.");await list(token);}}
    catch(e){if(token===generation.current){setNotice((e as Error).message);if(e instanceof GsError&&(e.status<500||op.path.endsWith("/rewrite"))){setPending(null);if([401,403,409].includes(e.status)){setDraft(null);setEdits({});setReviewed(false);}await list(token).catch(()=>{});}}}
    finally{if(token===generation.current)setBusy(false);}
  };
  const post=(action:string,extra:object={})=>{if(draft)void perform({path:base+"/story-drafts/"+draft.id+"/"+action,body:{expectedRevision:draft.revision,key:crypto.randomUUID(),...extra}});};
  const openBook=async()=>{
    if(!draft?.newBookId)return;const token=generation.current;setBusy(true);setNotice("");
    try{const stored=await gs<{book:Book}>("GET",base+"/story-drafts/"+draft.id+"/book");if(token!==generation.current)return;
      await saveBook(stored.book);if(token!==generation.current)return;await saveMeta(META_ACTIVE_BOOK,stored.book.id);
      if(token!==generation.current)return;
      window.location.assign(buildAppPath({projectId:stored.book.id,tab:"editor"},API_BASE)!);
    }catch(e){if(token===generation.current)setNotice((e as Error).message);}finally{if(token===generation.current)setBusy(false);}
  };
  const unsaved=!!draft&&(title!==draft.title||Object.keys(edits).length>0),locked=disabled||busy||!!pending;
  return <section className="min-w-0 space-y-3 rounded-xl border border-indigo-600 p-3" data-story-assembly aria-busy={busy}>
    <h3 className="font-semibold">Проходження → нова книга</h3>
    <p>Зберіть завершений маршрут в окрему літературну чернетку та перевірте джерела. Погоджені внески зберігаються дослівно. Остаточне співавторство й видання погоджуються окремо.</p>
    <fieldset disabled={locked} className="min-w-0 space-y-3"><legend>Збірка історії</legend>
      <label className="block">Завершене проходження<select className={field} value={runId} data-story-run onChange={e=>setRunId(e.target.value)}>
        <option value="">Оберіть маршрут</option>{runs.map((r,i)=><option key={r.id} value={r.id}>{r.kind==="group"?"Група":"Один читач"} {i+1} · {new Date(r.createdAt).toLocaleString("uk-UA")} · r{r.revision}</option>)}
      </select></label>
      <label className="block">Назва нової книги<input className={field} data-story-title value={title} maxLength={300} onChange={e=>{setTitle(e.target.value);setReviewed(false);}}/></label>
      <div className="flex flex-wrap gap-2"><button className={button} data-story-create disabled={!runId||!title.trim()} onClick={()=>void perform({path:base+"/runs/"+runId+"/story-drafts",body:{expectedRunRevision:runs.find(r=>r.id===runId)!.revision,title,key:crypto.randomUUID()}})}>Зібрати чернетку</button>
        <button className={button} data-story-refresh onClick={()=>void list().catch(e=>setNotice(e.message))}>Оновити маршрути</button></div>
    </fieldset>
    {!runs.length&&<p>Завершіть одиночне або групове проходження відкритої карти.</p>}
    <div className="flex flex-wrap gap-2">{drafts.map(d=><button className={button+" max-w-full break-words text-left"} disabled={locked} key={d.id} data-story-open-draft={d.id} onClick={()=>void open(d.id)}>{d.title} · {d.status==="draft"?"чернетка":d.status==="accepted"?"книгу створено":"відхилено"}</button>)}</div>
    {notice&&<p role="status" className="break-words" data-story-notice>{notice}</p>}
    {pending&&!busy&&<button className={button} data-story-retry onClick={()=>void perform(pending)}>Повторити той самий запит</button>}
    {draft&&<section className="min-w-0 space-y-3" data-story-draft={draft.id}>
      <p>Карта v{draft.mapRevision} · книга r{draft.bookRevision} · завершений журнал r{draft.sourceRevision}. Кожен фрагмент має джерело.</p>
      {draft.blocks.map(b=><article key={b.id} className="min-w-0 space-y-2 rounded-lg border border-slate-600 p-3" data-story-block data-story-kind={b.kind}>
        <h4 className="font-semibold break-words">{b.title}{b.kind==="contribution"?" · погоджений оригінал":b.kind==="ending"?" · фінальний факт":""}</h4>
        <p className="whitespace-pre-wrap break-words" data-story-source-text>{b.text}</p>
        <p className="text-sm">Джерело: хід r{b.source.revision} · час {b.source.storyTime}{b.aiAssisted?" · участь ШІ":""}</p>
        {["fact","scene"].includes(b.kind)&&<label className="block">Літературна пропозиція{b.proposalOrigin==="ai"?" ШІ — перевірте зміст":""}
          <textarea className={field+" min-h-28"} data-story-edit={b.id} disabled={locked||draft.status!=="draft"} maxLength={16000} value={Object.hasOwn(edits,b.id)?edits[b.id]??b.text:b.proposal??b.text} onChange={e=>{setEdits(old=>({...old,[b.id]:e.target.value}));setReviewed(false);}}/>
          <button className={button} disabled={locked||draft.status!=="draft"} onClick={()=>{setEdits(old=>({...old,[b.id]:null}));setReviewed(false);}}>Повернути оригінал</button>
        </label>}
      </article>)}
      {draft.status==="draft"&&<fieldset disabled={locked} className="space-y-3"><legend>Редакція та прийняття</legend>
        <button className={button} data-story-save disabled={!unsaved||!title.trim()} onClick={()=>post("edit",{title,edits:Object.entries(edits).map(([id,text])=>({id,text}))})}>Зберегти мою редакцію</button>
        <label className="flex items-start gap-2"><input type="checkbox" data-story-confirm-ai checked={confirmAi} onChange={e=>setConfirmAi(e.target.checked)}/>Запитати літературну редакцію ШІ. Провайдер отримає факти й відкриті сцени; погоджені тексти учасників залишаються дослівними. Запит використовує мою квоту ШІ.</label>
        <button className={button} data-story-rewrite disabled={!confirmAi||unsaved||draft.generationPending} onClick={()=>post("rewrite",{confirmAi:true})}>Запропонувати редакцію ШІ</button>
        <label className="flex items-start gap-2"><input type="checkbox" data-story-reviewed checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>Я перевірив джерела, порядок, причинність і фінал та погоджую створення нової приватної чернетки книги.</label>
        <div className="flex flex-wrap gap-2"><button className={button} data-story-accept disabled={!reviewed||unsaved||draft.generationPending} onClick={()=>post("accept",{confirm:true,causalityReviewed:true})}>Прийняти й створити нову книгу</button>
          <button className={button} data-story-reject onClick={()=>post("reject")}>Відхилити збірку</button></div>
        {draft.generationPending&&<p>Літературний запит виконується. Відкрийте цю чернетку після його завершення.</p>}
      </fieldset>}
      {draft.newBookId&&<button className={button} disabled={locked} data-story-open-book onClick={()=>void openBook()}>Відкрити новий рукопис у редакторі</button>}
    </section>}
  </section>;
}
