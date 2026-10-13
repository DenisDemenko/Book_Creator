import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { LabyrinthDefinition, LabyrinthRunState, LabyrinthRun } from "../../../shared/labyrinth";
import { GROUP_TERMS, type GroupRules, type GroupDecision, type GroupCommand, type GroupSummary, type GroupView } from "../../../shared/labyrinthGroup";
import { headingFromEvents } from "../../../shared/labyrinthNarration";
import { readerProjection, readerAction } from "./reader";
import { LabyrinthError, stateHash } from "./model";
import { groupWorld, validateGroup, groupInitialState, groupAction, groupEvent, jointFor, jointReady, proveGroupExit } from "./groupRuntime";
import { directLabyrinth } from "./director";
export type GroupGuard={ recheck:()=>Promise<void>; canReadUser:(id:string)=>Promise<boolean> };
type Member={hero_id:string;user_id:string|null;alias:string;status:"invited"|"active"|"left";candidate:boolean;terms:string|null;visited:string[];heading:"north"|"east"|"south"|"west"};
type Session={
  id:string;project_id:string;map_id:string;map_revision:number;revision:number;book_revision:number;
  seed:string;created_by:string;created_at:Date;state:LabyrinthRunState;definition:LabyrinthDefinition;scenes:any;
  rules:GroupRules;status:"lobby"|"playing"|"finished";cursor:number;deadline_at:Date|null;decision:GroupDecision|null;
  members:Member[];publication_revision:number;
};
const fail=(status:number,message:string):never=>{throw new LabyrinthError(status,message);};
const uuid=(id:string)=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))fail(404,"Групу не знайдено.");return id;};
const revision=(n:unknown)=>{if(!Number.isSafeInteger(n)||Number(n)<0)fail(422,"Вкажіть поточну ревізію.");return Number(n);};
const keyOf=(n:unknown)=>{if(typeof n!=="string"||!n.trim()||n.length>128)fail(422,"Вкажіть ідентифікатор запиту.");return n as string;};
const iso=(x:Date|string)=>new Date(x).toISOString();
const text=(x:unknown,max:number)=>{if(typeof x!=="string"||!x.trim()||x.length>max)fail(422,"Введіть текст у допустимому розмірі.");return (x as string).trim();};
function command(input:unknown):GroupCommand {
  if(!input||typeof input!=="object"||Array.isArray(input))fail(422,"Виберіть команду.");
  const x=input as any;
  const fields:Record<string,string[]>={
    join:["kind","alias","candidate","terms"],launch:["kind"],action:["kind","action"],pass:["kind"],
    advance_absent:["kind"],advance_flc:["kind"],leave:["kind"],propose_action:["kind","jointId"],
    propose_restore:["kind","sourceRevision"],vote:["kind","decisionId","approve"],
    message:["kind","channel","text"],contribute:["kind","text","include","aiAssisted","terms"],
    withdraw_contribution:["kind","contributionId"]
  };
  const keys=Object.hasOwn(fields,x.kind)?fields[x.kind]:null;
  if(!keys||Object.keys(x).length!==keys.length||Object.keys(x).some(k=>!keys.includes(k)))fail(422,"Некоректні поля команди.");
  if(x.kind==="join"){x.alias=text(x.alias,80);if(typeof x.candidate!=="boolean"||x.terms!==GROUP_TERMS)fail(422,"Підтвердьте умови участі.");}
  if(x.kind==="message"){x.text=text(x.text,4000);if(!["player_chat","hero_dialogue"].includes(x.channel))fail(422,"Виберіть канал розмови.");}
  if(x.kind==="contribute"){x.text=text(x.text,8000);if(x.include!==true||typeof x.aiAssisted!=="boolean"||x.terms!==GROUP_TERMS)fail(422,"Для внеску потрібна окрема згода на цей текст.");}
  if(x.kind==="vote"){uuid(x.decisionId);if(typeof x.approve!=="boolean")fail(422,"Виберіть відповідь.");}
  if(x.kind==="propose_action"&&(typeof x.jointId!=="string"||x.jointId.length>128))fail(422,"Виберіть спільну дію.");
  if(x.kind==="propose_restore")revision(x.sourceRevision);
  if(x.kind==="withdraw_contribution")uuid(x.contributionId);
  if(x.kind==="action")readerAction(x.action,"server");
  return x;
}
const required=(r:Session,d:GroupDecision)=>d.kind==="restore"||r.rules.decision==="unanimous"?d.voters.length:Math.floor(d.voters.length/2)+1;
const snapshot=(r:Session)=>({cursor:r.cursor,members:r.members.map(m=>({heroId:m.hero_id,visited:m.visited,heading:m.heading}))});
function context(r:Session) {
  const ids=r.members.filter(m=>m.status==="active").map(m=>m.hero_id);
  const d=groupWorld(r.definition,ids);
  const rules={...r.rules,order:r.rules.order.filter(id=>ids.includes(id))};
  const cursor=Math.max(0,rules.order.indexOf(r.rules.order[r.cursor]));
  return {d,rules,cursor};
}
function rotate(r:Session) {
  for(let i=1;i<=r.rules.order.length;i++){
    const n=(r.cursor+i)%r.rules.order.length,id=r.rules.order[n],m=r.members.find(m=>m.hero_id===id)!;
    if(m.status==="active"&&!r.definition.exitNodeIds.includes(r.state.heroes[id].nodeId)){r.cursor=n;return;}
  }
  r.status="finished";r.deadline_at=null;
}
function deadline(r:Session) {r.deadline_at=r.status==="playing"&&r.rules.timeoutSeconds?new Date(Date.now()+r.rules.timeoutSeconds*1000):null;}
/** Core transactions own group state, receipts, checkpoints and explicit draft contributions.
 * Existing collaboration grants remain authoritative. Joining does not grant authorship. */
export class PgLabyrinthGroupStore {
  constructor(private readonly pool:Pool) {}
  private async tx<T>(fn:(c:PoolClient)=>Promise<T>) {
    const c=await this.pool.connect();
    try {await c.query("BEGIN");const result=await fn(c);await c.query("COMMIT");return result;}
    catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
  private async load(c:PoolClient,p:string,id:string,user:string,write=false,author=false,allowLeft=false):Promise<Session> {
    uuid(id);
    const bind=(await c.query("SELECT g.map_id,m.status FROM labyrinth_groups g LEFT JOIN labyrinth_group_members m ON(m.project_id=g.project_id AND m.run_id=g.run_id AND m.user_id=$3) WHERE g.project_id=$1 AND g.run_id=$2",[p,id,user])).rows[0];
    if(!bind||(!author&&!bind.status))fail(404,"Вашу групу не знайдено.");
    if(!author&&!allowLeft&&bind.status==="left")fail(403,"Участь у цій групі завершена.");
    const h=(await c.query("SELECT * FROM labyrinth_reader_heads WHERE project_id=$1 AND map_id=$2 FOR SHARE",[p,bind.map_id])).rows[0];
    const r=(await c.query(
      "SELECT r.*,g.publication_revision,g.rules,g.status,g.cursor,g.deadline_at,g.decision,e.scenes,e.book_revision,v.definition FROM labyrinth_groups g JOIN labyrinth_runs r ON(r.project_id=g.project_id AND r.id=g.run_id) JOIN labyrinth_reader_editions e ON(e.project_id=g.project_id AND e.map_id=g.map_id AND e.revision=g.publication_revision) JOIN labyrinth_versions v ON(v.project_id=r.project_id AND v.map_id=r.map_id AND v.revision=r.map_revision) WHERE g.project_id=$1 AND g.run_id=$2 FOR "+(write?"UPDATE":"SHARE")+" OF g,r",[p,id])).rows[0] as Session;
    if(!r||!h?.active||r.publication_revision<=h.revoked_through)fail(403,"Автор відкликав доступ до цієї версії.");
    r.members=(await c.query("SELECT * FROM labyrinth_group_members WHERE project_id=$1 AND run_id=$2 ORDER BY hero_id FOR "+(write?"UPDATE":"SHARE"),[p,id])).rows as Member[];
    return r;
  }
  private async save(c:PoolClient,r:Session,actor:string,kind:string,before:LabyrinthRunState,details:Record<string,unknown>={}) {
    const old=r.revision;r.revision++;
    const update=await c.query("UPDATE labyrinth_runs SET revision=$3,state=$4 WHERE project_id=$1 AND id=$2 AND revision=$5",
      [r.project_id,r.id,r.revision,JSON.stringify(r.state),old]);
    if(update.rowCount!==1)fail(409,"Стан уже змінився.");
    await c.query("UPDATE labyrinth_groups SET status=$3,cursor=$4,deadline_at=$5,decision=$6 WHERE project_id=$1 AND run_id=$2",
      [r.project_id,r.id,r.status,r.cursor,r.deadline_at,r.decision?JSON.stringify(r.decision):null]);
    for(const m of r.members) await c.query("UPDATE labyrinth_group_members SET alias=$4,status=$5,candidate=$6,terms=$7,visited=$8,heading=$9 WHERE project_id=$1 AND run_id=$2 AND hero_id=$3",
      [r.project_id,r.id,m.hero_id,m.alias,m.status,m.candidate,m.terms,JSON.stringify(m.visited),m.heading]);
    await c.query("INSERT INTO labyrinth_run_events(project_id,run_id,revision,event) VALUES($1,$2,$3,$4)",
      [r.project_id,r.id,r.revision,JSON.stringify({kind,actor:"user:"+actor,mapRevision:r.map_revision,beforeHash:stateHash(before),
        afterHash:stateHash(r.state),state:r.state,group:snapshot(r),...details})]);
  }
  private async reconcile(r:Session,guard:GroupGuard) {
    let changed=false;
    for(const m of r.members) if(m.user_id&&m.status!=="left"&&!(await guard.canReadUser(m.user_id))) {
      m.status="left";r.decision=null;changed=true;
    }
    return changed;
  }
  private async view(c:PoolClient,r:Session,user:string):Promise<GroupView> {
    const me=r.members.find(m=>m.user_id===user);
    if(!me||me.status==="left")fail(403,"Участь у цій групі завершена.");
    const joined=me!.status==="active";
    const projection=joined?readerProjection(r.definition,r.state,me!.hero_id,me!.visited,me!.heading,r.scenes):{
      hero:{name:r.definition.heroes.find(h=>h.id===me!.hero_id)!.name,resources:{},inventory:[],knowledge:[]},
      scene:{title:"Запрошення до групи",paragraphs:[]},description:"Підтвердьте участь і виберіть ім'я.",
      heading:"north" as const,choices:[],interactions:[],warnings:[],completed:false,map:{nodes:[],edges:[],currentNodeId:""}
    };
    const records=joined?(await c.query(
      "SELECT revision,event->'state'->>'turn' AS turn,event->'state'->>'storyTime' AS time,event->'state'->'heroes'->$3::text->>'nodeId' AS node_id FROM labyrinth_run_events WHERE project_id=$1 AND run_id=$2 AND event ? 'group' ORDER BY revision DESC LIMIT 100",[r.project_id,r.id,me!.hero_id])).rows:[];
    const messages=joined?(await c.query(
      "SELECT * FROM labyrinth_group_messages WHERE project_id=$1 AND run_id=$2 AND channel<>'contribution' AND recipients ? $3 ORDER BY created_at DESC,id DESC LIMIT 100",
      [r.project_id,r.id,me!.hero_id])).rows:[];
    const contributions=joined?(await c.query(
      "SELECT * FROM labyrinth_group_messages WHERE project_id=$1 AND run_id=$2 AND channel='contribution' AND consent_active AND user_id=$3 ORDER BY created_at DESC,id DESC LIMIT 100",[r.project_id,r.id,user])).rows:[];
    const dec=r.decision;
    let decLabel="Спільна дія групи";
    if(dec?.kind==="restore")decLabel="Повернути групу до збереженого ходу r"+dec.sourceRevision;
    else if(dec?.action?.kind==="interact"&&joined&&r.definition.objects.some(o=>o.id===(dec.action as any).objectId&&o.nodeId===r.state.heroes[me!.hero_id].nodeId))
      decLabel=r.rules.jointActions.find(j=>j.objectId===(dec.action as any).objectId&&j.to===(dec.action as any).to)?.label??decLabel;
    const jointActions=joined?r.rules.jointActions.filter(j=>j.supports.some(v=>v.heroId===me!.hero_id&&v.nodeId===r.state.heroes[me!.hero_id].nodeId)&&
      r.definition.objects.some(o=>o.id===j.objectId&&o.nodeId===r.state.heroes[me!.hero_id].nodeId)).map(j=>({id:j.id,label:j.label})):[];
    projection.interactions=projection.interactions.filter(i=>!r.rules.jointActions.some(j=>j.objectId===i.objectId&&j.to===i.to));
    return {id:r.id,revision:r.revision,mapRevision:r.map_revision,bookRevision:r.book_revision,title:r.definition.title,
      turn:r.state.turn,storyTime:r.state.storyTime,...projection,
      checkpoints:records.map(e=>({revision:e.revision,turn:Number(e.turn),storyTime:Number(e.time),
        label:r.definition.nodes.find(n=>n.id===e.node_id)?.title??"Збережений хід"})),
      group:{status:r.status,joined,canLaunch:false,myTurn:joined&&r.status==="playing"&&r.rules.order[r.cursor]===me!.hero_id&&!dec,
        candidate:me!.candidate,terms:GROUP_TERMS,deadline:r.deadline_at?iso(r.deadline_at):null,
        members:r.rules.order.map(id=>{const m=r.members.find(m=>m.hero_id===id)!;return {
          heroId:id,heroName:r.definition.heroes.find(h=>h.id===id)!.name,alias:m.alias,status:m.status,flc:m.user_id===null,currentTurn:r.status==="playing"&&r.rules.order[r.cursor]===id};}),
        rules:{decision:r.rules.decision,timeoutSeconds:r.rules.timeoutSeconds,absence:r.rules.absence},jointActions,
        decision:dec?{id:dec.id,kind:dec.kind,label:decLabel,myVote:Object.hasOwn(dec.votes,me!.hero_id)?dec.votes[me!.hero_id]:null,
          approvals:Object.values(dec.votes).filter(Boolean).length,required:required(r,dec),canVote:joined&&dec.voters.includes(me!.hero_id)&&!Object.hasOwn(dec.votes,me!.hero_id)}:null},
      messages:messages.reverse().map(m=>({id:m.id,channel:m.channel,alias:m.alias,text:m.text,timestamp:iso(m.created_at)})),
      contributions:contributions.map(m=>({id:m.id,alias:m.alias,text:m.text,timestamp:iso(m.created_at),mapRevision:m.map_revision,
        sourceRevision:m.source_revision,nodeId:m.node_id,aiAssisted:m.ai_assisted,mine:true})),legalAuthorship:false};
  }
  async library(p:string,user:string):Promise<{groups:GroupSummary[]}> {
    const {rows}=await this.pool.query(
      "SELECT r.id,r.revision,r.created_at,g.status,m.alias,m.status AS member_status,v.definition->>'title' AS title FROM labyrinth_group_members m JOIN labyrinth_groups g USING(project_id,run_id) JOIN labyrinth_runs r ON(r.project_id=g.project_id AND r.id=g.run_id) JOIN labyrinth_reader_heads h ON(h.project_id=g.project_id AND h.map_id=g.map_id) JOIN labyrinth_versions v ON(v.project_id=r.project_id AND v.map_id=r.map_id AND v.revision=r.map_revision) WHERE m.project_id=$1 AND m.user_id=$2 AND m.status<>'left' AND h.active AND g.publication_revision>h.revoked_through ORDER BY r.created_at DESC LIMIT 100",[p,user]);
    return {groups:rows.map(r=>({id:r.id,title:r.title,alias:r.alias,status:r.status,revision:r.revision,invited:r.member_status==="invited",createdAt:iso(r.created_at)}))};
  }
  async authorGroups(p:string,mapId:string) {
    uuid(mapId);
    return (await this.pool.query(
      "SELECT r.id,r.revision,g.status,r.created_at FROM labyrinth_groups g JOIN labyrinth_runs r ON(r.project_id=g.project_id AND r.id=g.run_id) WHERE g.project_id=$1 AND g.map_id=$2 ORDER BY r.created_at DESC LIMIT 30",[p,mapId])).rows.map(r=>({id:r.id,revision:r.revision,status:r.status,createdAt:iso(r.created_at)}));
  }
  async journal(p:string,id:string) {
    uuid(id);
    if(!(await this.pool.query("SELECT run_id FROM labyrinth_groups WHERE project_id=$1 AND run_id=$2",[p,id])).rowCount)fail(404,"Групу не знайдено.");
    const {rows}=await this.pool.query(
      "SELECT * FROM labyrinth_group_messages WHERE project_id=$1 AND run_id=$2 AND channel='contribution' AND consent_active ORDER BY created_at,id LIMIT 1000",[p,id]);
    return {contributions:rows.map(m=>({id:m.id,userId:m.user_id,heroId:m.hero_id,alias:m.alias,text:m.text,timestamp:iso(m.created_at),
      runId:id,mapRevision:m.map_revision,sourceRevision:m.source_revision,nodeId:m.node_id,aiAssisted:m.ai_assisted,terms:m.terms,source:"labyrinth_group"})),
      legalAuthorship:false,limit:1000};
  }
  async get(p:string,id:string,user:string,guard:GroupGuard) {
    return this.tx(async c=>{
      // Permission housekeeping is serialized with commands. Reading never advances story time.
      const r=await this.load(c,p,id,user,true),before=structuredClone(r.state);
      const changed=await this.reconcile(r,guard);
      await guard.recheck();
      if(changed)await this.save(c,r,user,"group_access_reconciled",before);
      return this.view(c,r,user);
    });
  }
  async realtimeRevision(p:string,id:string,user:string) {
    return this.tx(async c=>{const r=await this.load(c,p,id,user);return r.revision;});
  }
  private async request(c:PoolClient,p:string,user:string,key:string,hash:string) {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",["group:"+p+":"+user+":"+key]);
    const receipt=(await c.query("SELECT * FROM labyrinth_group_requests WHERE project_id=$1 AND user_id=$2 AND key=$3",[p,user,key])).rows[0];
    if(receipt&&receipt.request_hash!==hash)fail(409,"Ідентифікатор уже використаний для іншої команди.");
    return receipt;
  }
  async create(p:string,mapId:string,pubRevision:unknown,bindings:unknown,rules:unknown,user:string,key:unknown,guard:GroupGuard) {
    uuid(mapId);revision(pubRevision);const k=keyOf(key),hash=stateHash({kind:"create",mapId,pubRevision,bindings,rules});
    return this.tx(async c=>{
      const receipt=await this.request(c,p,user,k,hash);
      if(receipt){const r=await this.load(c,p,receipt.run_id,user,false,true);await guard.recheck();return {id:r.id,revision:r.revision,status:r.status};}
      const head=(await c.query("SELECT * FROM labyrinth_reader_heads WHERE project_id=$1 AND map_id=$2 FOR SHARE",[p,mapId])).rows[0];
      if(!head?.active)fail(403,"Спочатку відкрийте версію читачам.");
      if(head.revision!==pubRevision)fail(409,"Версія читачів змінилась.");
      const e=(await c.query(
        "SELECT e.*,v.definition FROM labyrinth_reader_editions e JOIN labyrinth_versions v ON(v.project_id=e.project_id AND v.map_id=e.map_id AND v.revision=e.map_revision) WHERE e.project_id=$1 AND e.map_id=$2 AND e.revision=$3",[p,mapId,pubRevision])).rows[0];
      const validated=validateGroup(e.definition,bindings,rules);
      if(validated.bindings.some(b=>!e.hero_ids.includes(b.heroId)))fail(403,"Героя не відкрито читачам.");
      for(const b of validated.bindings)if(b.userId&&!(await guard.canReadUser(b.userId)))fail(403,"Учасник не має чинного перегляду цієї книги.");
      const d=groupWorld(e.definition,validated.rules.order),state=groupInitialState(d,validated.rules);
      await guard.recheck();
      const r=(await c.query(
        "INSERT INTO labyrinth_runs(project_id,map_id,map_revision,seed,state,created_by,participants,mode,difficulty) VALUES($1,$2,$3,$4,$5,$6,$7,'runtime','reader_group') RETURNING *",
        [p,mapId,e.map_revision,randomUUID(),JSON.stringify(state),"user:"+user,JSON.stringify(validated.bindings.filter(b=>b.userId).map(b=>({userId:b.userId,heroIds:[b.heroId]})))])).rows[0];
      await c.query("INSERT INTO labyrinth_groups(project_id,run_id,map_id,publication_revision,rules) VALUES($1,$2,$3,$4,$5)",[p,r.id,mapId,pubRevision,JSON.stringify(validated.rules)]);
      for(const b of validated.bindings)await c.query("INSERT INTO labyrinth_group_members(project_id,run_id,hero_id,user_id,alias,status,visited) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [p,r.id,b.heroId,b.userId,b.alias,b.userId?"invited":"active",JSON.stringify([state.heroes[b.heroId].nodeId])]);
      const members=validated.bindings.map(b=>({heroId:b.heroId,visited:[state.heroes[b.heroId].nodeId],heading:"north"}));
      await c.query("INSERT INTO labyrinth_run_events(project_id,run_id,revision,event) VALUES($1,$2,0,$3)",
        [p,r.id,JSON.stringify({kind:"group_created",actor:"user:"+user,mapRevision:e.map_revision,state,afterHash:stateHash(state),group:{cursor:0,members}})]);
      await c.query("INSERT INTO labyrinth_group_requests VALUES($1,$2,$3,$4,$5)",[p,user,k,hash,r.id]);
      return {id:r.id,revision:0,status:"lobby"};
    });
  }
  private async director(r:Session) {
    const {d,rules,cursor}=context(r);
    if(!d.director?.enabled||!d.heroes.length||d.heroes.every(h=>d.exitNodeIds.includes(r.state.heroes[h.id].nodeId)))return null;
    // Fictional weakest hero drives the policy. No chat or real-person emotion scoring.
    d.heroes.sort((a,b)=>(r.state.heroes[a.id].resources.health??1)/Math.max(1,a.resources.health??1)-(r.state.heroes[b.id].resources.health??1)/Math.max(1,b.resources.health??1));
    const run={id:r.id,projectId:r.project_id,mapId:r.map_id,mapRevision:r.map_revision,revision:r.revision,seed:r.seed,
      difficulty:"reader_group",mode:"runtime",participants:[],state:r.state,createdBy:r.created_by,createdAt:iso(r.created_at)} as LabyrinthRun;
    const result=await directLabyrinth(d,run,false,{},{
      step:(_d,s,input)=>groupEvent(d,s,rules,cursor,input),
      prove:(_d,s,budget)=>proveGroupExit(d,s,rules,cursor,budget),
    });
    r.state=result.state;return result.trace;
  }
  private step(r:Session,heroId:string,input:unknown,joint=false) {
    const {d,rules,cursor}=context(r);
    const result=groupAction(d,r.state,rules,cursor,input,heroId,joint);r.state=result.state;
    for(const m of r.members)if(m.status==="active") {
      const node=r.state.heroes[m.hero_id].nodeId;if(!m.visited.includes(node))m.visited.push(node);
      if(result.action.kind==="move"&&m.hero_id===heroId)m.heading=headingFromEvents(r.definition,[{action:result.action,state:r.state}],m.hero_id);
    }
    r.cursor=r.rules.order.indexOf(rules.order[result.cursor]);return result;
  }
  async execute(p:string,id:string,expected:unknown,input:unknown,user:string,key:unknown,guard:GroupGuard,author=false) {
    revision(expected);const cmd=command(input),k=keyOf(key);
    if(author&&cmd.kind!=="launch")fail(403,"Авторська панель запускає гру; героями керують їхні учасники.");
    const hash=stateHash({id,expected,command:cmd,author});
    return this.tx(async c=>{
      const receipt=await this.request(c,p,user,k,hash);
      if(receipt&&receipt.run_id!==id)fail(409,"Ідентифікатор належить іншій групі.");
      const r=await this.load(c,p,id,user,true,author,true);
      const me=r.members.find(m=>m.user_id===user);
      if(receipt){await guard.recheck();return author?{id,revision:r.revision,status:r.status}:me?.status==="left"?{left:true,revision:r.revision}:this.view(c,r,user);}
      if(r.revision!==expected)fail(409,"Група вже зробила іншу дію. Оновіть стан.");
      if(!author&&(!me||me.status==="left"))fail(403,"Участь у групі завершена.");
      await this.reconcile(r,guard);
      const before=structuredClone(r.state);
      const actor=r.members.find(m=>m.hero_id===r.rules.order[r.cursor])!;
      const active=()=>{if(!me||me.status!=="active")fail(403,"Спочатку підтвердьте участь.");};
      const playing=()=>{active();if(r.status!=="playing")fail(409,"Гра ще не почалася або вже завершена.");};
      const turn=()=>{playing();if(actor.hero_id!==me!.hero_id||r.decision)fail(409,"Зараз черга іншого героя або триває голосування.");};
      let detail:Record<string,unknown>={};
      if(cmd.kind==="join") {
        if(r.status!=="lobby"||me!.status!=="invited")fail(409,"Приєднатися можна лише до початку гри.");
        me!.alias=cmd.alias;me!.candidate=cmd.candidate;me!.terms=cmd.terms;me!.status="active";
      } else if(cmd.kind==="launch") {
        if(!author)fail(403,"Гру запускає автор.");
        if(r.status!=="lobby"||r.members.some(m=>m.user_id&&m.status!=="active"))fail(409,"Усі запрошені учасники мають підтвердити участь.");
        r.status="playing";detail.director=await this.director(r);
        if(r.definition.exitNodeIds.includes(r.state.heroes[actor.hero_id].nodeId))rotate(r);
        deadline(r);
      } else if(cmd.kind==="action") {
        turn();const projection=readerProjection(r.definition,r.state,me!.hero_id,me!.visited,me!.heading,r.scenes),a=readerAction(cmd.action,me!.hero_id);
        if(a.kind==="move"&&!projection.choices.some(x=>x.edgeId===a.edgeId&&x.available))fail(409,"Перехід зараз недоступний.");
        if(a.kind==="interact"&&!projection.interactions.some(x=>x.objectId===a.objectId&&x.to===a.to&&x.available))fail(409,"Механізм зараз недоступний.");
        detail.action=this.step(r,me!.hero_id,cmd.action).action;detail.director=await this.director(r);
        if(context(r).d.heroes.every(h=>r.definition.exitNodeIds.includes(r.state.heroes[h.id].nodeId)))r.status="finished";deadline(r);
      } else if(cmd.kind==="pass") {
        turn();rotate(r);deadline(r);detail={passedHeroId:me!.hero_id};
      } else if(cmd.kind==="advance_absent") {
        playing();
        const departed=actor.status==="left";
        if(!departed&&(r.rules.absence!=="skip"||!r.deadline_at||r.deadline_at.getTime()>Date.now()))fail(409,"За правилами група чекає учасника або строк ще не минув.");
        r.decision=null;rotate(r);deadline(r);detail={skippedHeroId:actor.hero_id,reason:departed?"access_or_left":"timeout"};
      } else if(cmd.kind==="advance_flc") {
        playing();if(actor.user_id!==null||r.decision)fail(409,"Зараз не хід автономного героя.");
        const {d,rules,cursor}=context(r),proof=proveGroupExit(d,r.state,rules,cursor),a=proof.actions[0];
        if(!a||a.kind==="start_event"||a.heroId!==actor.hero_id||jointFor(r.rules,a))rotate(r);
        else {const {heroId:_h,...input}=a;detail.action=this.step(r,actor.hero_id,input).action;detail.director=await this.director(r);}
        if(context(r).d.heroes.every(h=>r.definition.exitNodeIds.includes(r.state.heroes[h.id].nodeId)))r.status="finished";
        deadline(r);detail.flc=true;
      } else if(cmd.kind==="leave") {
        active();me!.status="left";r.decision=null;
        if(actor.hero_id===me!.hero_id){rotate(r);deadline(r);}
        detail={leftHeroId:me!.hero_id};
      } else if(cmd.kind==="propose_action"||cmd.kind==="propose_restore") {
        active();if(r.status==="lobby")fail(409,"Гра ще не почалася.");if(r.decision)fail(409,"Спочатку завершіть поточне голосування.");
        let action:GroupDecision["action"];
        if(cmd.kind==="propose_action") {
          turn();const j=r.rules.jointActions.find(j=>j.id===cmd.jointId);
          if(!j||!jointReady(r.state,j)||!j.supports.every(v=>r.members.some(m=>m.hero_id===v.heroId&&m.status==="active")))fail(409,"Герої ще не на місцях спільної дії.");
          action={kind:"interact",objectId:j!.objectId,to:j!.to};
          groupAction(context(r).d,r.state,context(r).rules,context(r).cursor,action,me!.hero_id,true);
        } else {
          const row=(await c.query("SELECT event FROM labyrinth_run_events WHERE project_id=$1 AND run_id=$2 AND revision=$3",[p,id,cmd.sourceRevision])).rows[0];
          if(!row?.event.group)fail(404,"Збережений хід не знайдено.");
        }
        r.decision={id:randomUUID(),kind:cmd.kind==="propose_restore"?"restore":"action",actorHeroId:me!.hero_id,
          ...(action?{action}:{}),...(cmd.kind==="propose_restore"?{sourceRevision:cmd.sourceRevision}:{}),
          voters:r.members.filter(m=>m.user_id&&m.status==="active").map(m=>m.hero_id),votes:{},stateHash:stateHash(r.state)};
        deadline(r);
      } else if(cmd.kind==="vote") {
        active();if(r.status==="lobby")fail(409,"Гра ще не почалася.");const dec=r.decision;
        if(!dec||dec.id!==cmd.decisionId||!dec.voters.includes(me!.hero_id))fail(409,"Голосування вже завершене або недоступне.");
        if(Object.hasOwn(dec.votes,me!.hero_id))fail(409,"Ваш голос уже записано.");
        dec.votes[me!.hero_id]=cmd.approve;
        const yes=Object.values(dec.votes).filter(Boolean).length,need=required(r,dec);
        if(yes>=need) {
          if(stateHash(r.state)!==dec.stateHash)fail(409,"Стан змінився після пропозиції.");
          for(const voter of dec.voters){const member=r.members.find(m=>m.hero_id===voter)!;
            if(member.status!=="active"||!member.user_id||!(await guard.canReadUser(member.user_id)))fail(403,"Склад групи змінився; рішення не застосовано.");}
          if(dec.kind==="action") {
            const result=this.step(r,dec.actorHeroId,dec.action,true);detail.action=result.action;detail.director=await this.director(r);
            if(context(r).d.heroes.every(h=>r.definition.exitNodeIds.includes(r.state.heroes[h.id].nodeId)))r.status="finished";
          } else {
            const saved=(await c.query("SELECT event FROM labyrinth_run_events WHERE project_id=$1 AND run_id=$2 AND revision=$3",[p,id,dec.sourceRevision])).rows[0]?.event;
            if(!saved?.group)fail(404,"Збережений хід не знайдено.");
            r.state=structuredClone(saved.state);r.cursor=saved.group.cursor;r.status="playing";
            for(const m of r.members){const old=saved.group.members.find((x:any)=>x.heroId===m.hero_id);
              if(old){m.visited=[...old.visited];m.heading=old.heading;}}
            if(r.members.find(m=>m.hero_id===r.rules.order[r.cursor])?.status!=="active")rotate(r);
            const ctx=context(r);proveGroupExit(ctx.d,r.state,ctx.rules,ctx.cursor);
            detail={sourceRevision:dec.sourceRevision,recordedDirectorReused:true};
          }
          r.decision=null;deadline(r);detail.decisionId=dec.id;detail.votes=dec.votes;
        } else if(yes+dec.voters.length-Object.keys(dec.votes).length<need) {
          r.decision=null;deadline(r);detail={decisionId:dec.id,rejected:true};
        }
      } else if(cmd.kind==="message"||cmd.kind==="contribute") {
        active();const contribution=cmd.kind==="contribute";
        if(contribution&&!me!.candidate)fail(403,"Для внесків виберіть участь як кандидат у співавтори.");
        const node=r.state.heroes[me!.hero_id].nodeId;
        const recipients=contribution?[me!.hero_id]:cmd.channel==="player_chat"?r.members.filter(m=>m.status==="active").map(m=>m.hero_id):
          r.members.filter(m=>m.status==="active"&&r.state.heroes[m.hero_id].nodeId===node).map(m=>m.hero_id);
        const message=(await c.query("INSERT INTO labyrinth_group_messages(project_id,run_id,hero_id,user_id,alias,channel,text,recipients,source_revision,map_revision,node_id,ai_assisted,consent_active,terms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id",
          [p,id,me!.hero_id,user,me!.alias,contribution?"contribution":cmd.channel,cmd.text,JSON.stringify(recipients),r.revision,r.map_revision,node,
            contribution?cmd.aiAssisted:false,contribution,contribution?cmd.terms:null])).rows[0];
        detail={messageId:message.id,channel:contribution?"contribution":cmd.channel};
      } else if(cmd.kind==="withdraw_contribution") {
        active();const changed=await c.query("UPDATE labyrinth_group_messages SET consent_active=false WHERE project_id=$1 AND run_id=$2 AND id=$3 AND user_id=$4 AND channel='contribution' AND consent_active",[p,id,cmd.contributionId,user]);
        if(changed.rowCount!==1)fail(404,"Ваш активний внесок не знайдено.");detail={withdrawnContributionId:cmd.contributionId};
      }
      await guard.recheck();
      await this.save(c,r,user,"group_"+cmd.kind,before,detail);
      await c.query("INSERT INTO labyrinth_group_requests VALUES($1,$2,$3,$4,$5)",[p,user,k,hash,id]);
      return author?{id,revision:r.revision,status:r.status}:me!.status==="left"?{left:true,revision:r.revision}:this.view(c,r,user);
    });
  }
}
