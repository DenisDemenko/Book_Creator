import assert from "node:assert/strict";
import express from "express";
import type {AddressInfo} from "node:net";
import {randomUUID} from "node:crypto";
import {WebSocket,WebSocketServer} from "ws";
import {createCorePool} from "../server/core/index";
import {loadMigrations,resolveMigrationsDir,runMigrations} from "../server/core/migrate";
import {PgLabyrinthStore} from "../server/core/labyrinth/store";
import {registerLabyrinthRoutes} from "../server/core/labyrinth/routes";
import {subscribeGroupUpdates} from "../server/core/labyrinth/groupRealtime";
import {computeEffective,canRead} from "../server/core/collaboration/access";
import {resolveProjectAccess} from "../server/core/projectRoutes";
import {resolveRealtimeAccess,issueRealtimeTicket,verifyRealtimeTicket,ticketFromUrl} from "../server/realtimeAuth";
import {groupDemo,groupBindings,groupRules} from "../shared/labyrinthGroupDemo";
import {GROUP_TERMS} from "../shared/labyrinthGroup";
import {DIRECTOR_DEFAULTS} from "../shared/labyrinthDirector";
import {stateHash} from "../server/core/labyrinth/model";
const url=process.env.CORE_TEST_DATABASE_URL;
if(!url)throw new Error("Use a disposable local CORE_TEST_DATABASE_URL ending in _t97.");
const parsed=new URL(url);
if(!["127.0.0.1","localhost"].includes(parsed.hostname)||!parsed.pathname.endsWith("_t97"))throw new Error("Group tests refuse non-local/non-_t97 databases.");
let pool=createCorePool(url),store=new PgLabyrinthStore(pool);
assert.equal((await runMigrations(pool,loadMigrations(resolveMigrationsDir()))).schemaVersion,39);
const project="t97-"+Date.now(),foreign=project+"-foreign";
await pool.query("INSERT INTO projects(id,owner_id,title,revision) VALUES($1,'owner','Канон',7),($2,'foreign-owner','Чуже',1)",[project,foreign]);
const revoked=new Set<string>(),disabled=new Set(["disabled"]);
let refreshCalls=0,revokeAt:number|null=null,modelCalls=0;
const userIds=["owner","admin","reader","reader2","reader3","limited","disabled","outsider"];
const principal=(id:string)=>userIds.includes(id)&&!disabled.has(id)?{id,role:id==="admin"?"admin":"user",isGuest:false,name:id}:null;
const access={
  getBookOwnerId:async(p:string)=>p===project?"owner":p===foreign?"foreign-owner":null,
  getCollabOwnerId:async()=>undefined,
  listAcceptedInvites:async(p:string)=>(p===project?["reader","reader2","reader3","limited","disabled"]:[]).map(id=>({acceptedUserId:id,role:"reader"})),
  effectiveAccess:async({projectId,userId}:any)=>computeEffective(projectId,userId,
    projectId===project&&["reader","reader2","reader3","limited","disabled"].includes(userId)&&!revoked.has(userId)?[{
      id:userId,projectId,participantId:userId,status:"active",level:"view",scopeType:userId==="limited"?"scene":"book",
      scopeRef:userId==="limited"?"one-scene":null,validFrom:"2020-01-01T00:00:00Z",validUntil:null
    }] as any:[],{full:false})
};
const app=express();app.use(express.json({limit:"40mb"}));
app.use((q,_r,next)=>{const id=String(q.headers["x-test-user"]??"guest");q.principal={id:id==="guest"?null:id,role:id==="admin"?"admin":"user",isGuest:id==="guest"} as any;next();});
registerLabyrinthRoutes(app,{
  access,store:()=>store,groupPrincipal:async id=>principal(id),groupUserIds:async()=>["reader","reader2","reader3"],
  refreshPrincipal:async q=>{refreshCalls++;if(revokeAt===refreshCalls)revoked.add("reader");(q.principal as any).disabled=disabled.has(q.principal!.id!);},
  directorServices:()=>{modelCalls++;throw new Error("No paid models in group tests");}
});
app.post("/api/realtime/ticket",async(q,r)=>{
  const a=await resolveRealtimeAccess(q.principal as any,q.body.bookId,access);
  if(!a){r.status(401).json({error:"auth"});return;}r.json({ticket:issueRealtimeTicket(a)});
});
const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
const origin="http://127.0.0.1:"+(server.address() as AddressInfo).port;
const wss=new WebSocketServer({server,path:"/ws"});
wss.on("connection",(ws,q)=>{
  const a=verifyRealtimeTicket(ticketFromUrl(q.url));if(!a){ws.close(4401,"auth");return;}
  ws.once("message",raw=>{
    const msg=JSON.parse(raw.toString());
    if(msg.type!=="labyrinth:subscribe"||Object.keys(msg.payload??{}).length!==1){ws.close(4403,"scope");return;}
    subscribeGroupUpdates(ws,async()=>{
      const u=principal(a.userId),grant=u?await resolveProjectAccess(u,a.bookId,access):null;
      if(!grant||!canRead(grant.effective.book))throw new Error("revoked");
      return store.group.realtimeRevision(a.bookId,msg.payload.runId,a.userId);
    },60);
  });
});
const request=async(path:string,body?:unknown,user="owner",p=project)=>{
  const r=await fetch(origin+"/api/core/projects/"+p+"/labyrinth"+path,{method:body===undefined?"GET":"POST",
    headers:{"content-type":"application/json","x-test-user":user},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json(),cache:r.headers.get("cache-control")};
};
const expect=(r:any,status:number)=>{assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(r.cache,"no-store");return r.body;};
let passed=0;
const check=(name:string)=>{passed++;console.log("✓ API/PG: "+name);};
const get=(id:string,user="reader")=>request("/reader/groups/"+id,undefined,user).then(r=>expect(r,200));
const send=async(id:string,command:any,user="reader",key=randomUUID(),expected?:number)=>{
  const rev=expected??(await get(id,user)).revision;
  return request("/reader/groups/"+id+"/commands",{expectedRevision:rev,command,key},user);
};
const join=async(id:string,user:string,candidate=false)=>expect(await send(id,{kind:"join",alias:user,candidate,terms:GROUP_TERMS},user),200);
const launch=async(id:string)=>expect(await request("/groups/"+id+"/launch",{expectedRevision:(await get(id)).revision,key:randomUUID()}),200);
const rawRun=async(id:string)=>(await pool.query("SELECT state,revision FROM labyrinth_runs WHERE project_id=$1 AND id=$2",[project,id])).rows[0];
const sockets:WebSocket[]=[];
try {
  assert.equal((await runMigrations(pool,loadMigrations(resolveMigrationsDir()))).applied.length,0);check("Міграція v39 повторна й незмінна");
  for(const [user,status] of [["guest",401],["disabled",401],["outsider",403],["limited",403]] as const)
    expect(await request("/reader/groups",undefined,user),status);
  expect(await request("/reader/groups",undefined,"reader",foreign),403);
  check("Гість, вимкнений акаунт, сторонній, частковий доступ і чужа книга закриті");
  const candidates=expect(await request("/group-candidates"),200).users;
  assert.ok(candidates.some((u:any)=>u.userId==="reader3"));assert.ok(!candidates.some((u:any)=>["disabled","limited"].includes(u.userId)));
  check("Кандидати беруться з чинних прав співпраці, без ключів та email");
  const world=structuredClone(groupDemo);world.director={...DIRECTOR_DEFAULTS,enabled:true};
  const version=expect(await request("/maps",{expectedRevision:0,definition:world}),201),mapId=version.mapId;
  let publication=expect(await request("/maps/"+mapId+"/reader-publication",{expectedRevision:0,mapRevision:1,heroIds:["one","two","three"]}),201);
  const create=(rules=groupRules,bindings=groupBindings,key=randomUUID())=>request("/maps/"+mapId+"/groups",{publicationRevision:publication.revision,bindings,rules,key});
  expect(await create(groupRules,groupBindings.map((b,i)=>i===0?{...b,userId:"disabled"}:b)),403);
  expect(await create(groupRules,groupBindings.map((b,i)=>i===0?{...b,userId:"outsider"}:b)),403);
  check("Призначення не обходить вимкнення акаунта або відсутність доступу");
  const createKey=randomUUID(),created=expect(await create(groupRules,groupBindings,createKey),201),id=created.id;
  assert.equal(expect(await create(groupRules,groupBindings,createKey),201).id,id);
  expect(await create({...groupRules,decision:"majority"},groupBindings,createKey),409);check("Старт групи ідемпотентний, колізія ключа відхиляється");
  expect(await request("/maps/"+mapId+"/groups",{publicationRevision:publication.revision,bindings:groupBindings,rules:groupRules,key:randomUUID()},"reader"),403);
  expect(await request("/groups/"+id+"/contributions",undefined,"reader"),403);
  expect(await request("/reader/groups/"+id,undefined,"admin"),404);expect(await request("/reader/groups/"+id,undefined,"owner"),404);
  check("Авторські дії та журнал закриті читачеві; адміністратор не керує чужим героєм");
  assert.deepEqual((await get(id)).hero.knowledge,[]);
  expect(await send(id,{kind:"join",alias:"X",candidate:false,terms:"wrong"}),422);
  expect(await send(id,{kind:"action",action:{kind:"wait"}}),403);
  await join(id,"reader",true);await join(id,"reader2");await join(id,"reader3");check("Своє приєднання, псевдонім і умови; до згоди секрети не видаються");
  const one=await get(id),two=await get(id,"reader2"),three=await get(id,"reader3");
  assert.ok(JSON.stringify(one).includes("SECRET_ONLY_ONE"));assert.ok(!JSON.stringify(two).includes("SECRET_ONLY_ONE")&&!JSON.stringify(three).includes("SECRET_ONLY_ONE"));
  assert.ok(!JSON.stringify(one).includes("TWO_PRIVATE")&&!JSON.stringify(one).includes("THREE_PRIVATE"));
  for(const v of [one,two,three])for(const field of ["definition","state","seed","trace","proof","participants"])assert.ok(!Object.hasOwn(v,field));
  assert.match(JSON.stringify(three.scene),/UPPER_SCENE/);assert.equal(three.map.currentNodeId,"upper-left");
  check("Окремі сцени, знання, туман і маркер на двох рівнях; DTO не розкриває світ");
  expect(await send(id,{kind:"action",action:{kind:"wait"}}),409);
  await launch(id);
  expect(await send(id,{kind:"launch"}),403);
  expect(await send(id,{kind:"action",action:{kind:"wait",heroId:"three"}}),422);
  expect(await send(id,{kind:"action",action:{kind:"wait"}},"reader3"),409);
  check("Автор запускає готову групу; підміна героя, фази або черги відхилена");
  const current=await get(id),firstKey=randomUUID(),secondKey=randomUUID();
  const bodies=[firstKey,secondKey].map(key=>({expectedRevision:current.revision,command:{kind:"action",action:{kind:"wait"}},key}));
  const concurrent=await Promise.all(bodies.map(body=>request("/reader/groups/"+id+"/commands",body,"reader")));
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const accepted=bodies[concurrent.findIndex(r=>r.status===200)];
  const after=await get(id);assert.equal(after.storyTime,current.storyTime+1);
  const hashAfter=stateHash((await rawRun(id)).state);
  expect(await request("/reader/groups/"+id+"/commands",accepted,"reader"),200);
  assert.equal(stateHash((await rawRun(id)).state),hashAfter);
  expect(await request("/reader/groups/"+id+"/commands",{...accepted,command:{kind:"pass"}},"reader"),409);
  check("Конкурентні ходи: один успіх; повтор прийнятого ключа не дублює час і подію");
  await send(id,{kind:"pass"},"reader2").then(r=>expect(r,200));
  await send(id,{kind:"pass"},"reader3").then(r=>expect(r,200));
  const beforeJoint=await rawRun(id);
  expect(await send(id,{kind:"action",action:{kind:"interact",objectId:"generator",to:"on"}}),409);
  assert.equal((await rawRun(id)).revision,beforeJoint.revision);
  let decision=expect(await send(id,{kind:"propose_action",jointId:"joint-lever"}),200).group.decision;
  assert.equal((await get(id)).storyTime,after.storyTime);
  assert.equal((await get(id,"reader2")).group.decision.label,"Спільна дія групи");
  expect(await send(id,{kind:"action",action:{kind:"wait"}}),409);
  const vote={kind:"vote",decisionId:decision.id,approve:true},voteKey=randomUUID();
  expect(await send(id,vote,"reader",voteKey),200);
  const voterRevision=(await get(id)).revision;
  const votes=await Promise.all(["reader2","reader3"].map(user=>send(id,vote,user,randomUUID(),voterRevision)));
  assert.deepEqual(votes.map(r=>r.status).sort(),[200,409]);
  const loser=["reader2","reader3"][votes.findIndex(r=>r.status===409)];
  expect(await send(id,vote,loser),200);
  assert.equal((await rawRun(id)).state.objects["bridge-gate"],"open");
  assert.equal((await get(id)).storyTime,after.storyTime+1);
  expect(await send(id,vote),409);
  const applied=(await pool.query("SELECT count(*) FROM labyrinth_run_events WHERE project_id=$1 AND run_id=$2 AND event->'action'->>'objectId'='generator' AND event->'action'->>'to'='on'",[project,id])).rows[0].count;
  assert.equal(Number(applied),1);check("Ізоляція: спільний важіль після всіх голосів; одночасні голоси не дублюють наслідок");
  const beforeChat=(await get(id)).storyTime;
  expect(await send(id,{kind:"message",channel:"hero_dialogue",text:"PRIVATE_DIALOGUE"}),200);
  assert.ok((await get(id)).messages.some((m:any)=>m.text==="PRIVATE_DIALOGUE"));
  assert.ok(!(await get(id,"reader2")).messages.some((m:any)=>m.text==="PRIVATE_DIALOGUE"));
  assert.ok(!(await get(id,"reader3")).messages.some((m:any)=>m.text==="PRIVATE_DIALOGUE"));
  expect(await send(id,{kind:"message",channel:"player_chat",text:"PLAYER_CHAT"}),200);
  assert.ok((await get(id,"reader2")).messages.some((m:any)=>m.text==="PLAYER_CHAT"));
  assert.equal((await get(id)).storyTime,beforeChat);
  check("Чат усіх гравців і діалог лише героїв поруч; повідомлення не витрачають час");
  const snapshotRevision=(await get(id)).revision,snapshotState=structuredClone((await rawRun(id)).state);
  expect(await send(id,{kind:"action",action:{kind:"move",edgeId:"room-door"}},"reader2"),200);
  assert.equal((await get(id,"reader2")).map.currentNodeId,"lower-entry");
  assert.ok(!(await get(id,"reader2")).messages.some((m:any)=>m.text==="PRIVATE_DIALOGUE"));
  expect(await send(id,{kind:"message",channel:"hero_dialogue",text:"NEARBY_DIALOGUE"}),200);
  assert.ok((await get(id,"reader2")).messages.some((m:any)=>m.text==="NEARBY_DIALOGUE"));
  check("Перехід до іншого героя не відкриває старий приватний діалог; новий дозволений");
  expect(await send(id,{kind:"contribute",text:"NO_CONSENT",include:false,aiAssisted:false,terms:GROUP_TERMS}),422);
  expect(await send(id,{kind:"contribute",text:"NOT_CANDIDATE",include:true,aiAssisted:false,terms:GROUP_TERMS},"reader2"),403);
  const contributionKey=randomUUID(),contributionRev=(await get(id)).revision;
  const contribute={kind:"contribute",text:"APPROVED_TEXT",include:true,aiAssisted:true,terms:GROUP_TERMS};
  let own=expect(await send(id,contribute,"reader",contributionKey,contributionRev),200);
  expect(await send(id,contribute,"reader",contributionKey,contributionRev),200);
  let journal=expect(await request("/groups/"+id+"/contributions"),200);
  assert.equal(journal.contributions.length,1);assert.equal(journal.contributions[0].aiAssisted,true);
  assert.equal(journal.contributions[0].mapRevision,1);assert.equal(journal.contributions[0].sourceRevision,contributionRev);
  assert.equal(journal.legalAuthorship,false);
  for(const marker of ["PLAYER_CHAT","PRIVATE_DIALOGUE","NEARBY_DIALOGUE","SECRET_ONLY_ONE","NO_CONSENT"])
    assert.ok(!JSON.stringify(journal).includes(marker));
  assert.equal((await get(id,"reader2")).contributions.length,0);
  const contributionId=own.contributions[0].id;
  expect(await send(id,{kind:"withdraw_contribution",contributionId},"reader2"),404);
  expect(await send(id,{kind:"withdraw_contribution",contributionId}),200);
  assert.equal(expect(await request("/groups/"+id+"/contributions"),200).contributions.length,0);
  check("Лише явно погоджений текст із точним походженням; чужий внесок не відкликається, свій відкликається");
  own=expect(await send(id,{kind:"propose_restore",sourceRevision:snapshotRevision}),200);
  decision=own.group.decision;
  for(const user of ["reader","reader2","reader3"])expect(await send(id,{kind:"vote",decisionId:decision.id,approve:true},user),200);
  assert.equal(stateHash((await rawRun(id)).state),stateHash(snapshotState));
  assert.equal((await get(id,"reader2")).map.currentNodeId,"isolated-room");
  assert.equal(expect(await request("/groups/"+id+"/contributions"),200).contributions.length,0);
  check("Контрольна точка відновлює всіх героїв, туман і записане рішення Jev новою ревізією; згода не відроджується");
  const beforeRestart=await get(id);
  await pool.end();pool=createCorePool(url);store=new PgLabyrinthStore(pool);
  assert.deepEqual(await get(id),beforeRestart);check("Перезапуск сервісу зберігає точний груповий стан, знання й історію");
  for(const suffix of ["structural-actions","runtime-actions","director-actions","restore"]){
    const body=suffix==="structural-actions"?{expectedRevision:beforeRestart.revision,action:{kind:"move",heroId:"one",edgeId:"up"}}:
      suffix==="runtime-actions"?{expectedRevision:beforeRestart.revision,action:{kind:"wait",heroId:"one"},key:randomUUID()}:
      suffix==="director-actions"?{expectedRevision:beforeRestart.revision,useAI:false,key:randomUUID()}:
      {expectedRevision:beforeRestart.revision,sourceRevision:0};
    expect(await request("/runs/"+id+"/"+suffix,body),403);
  }
  assert.equal(expect(await request("/maps/"+mapId+"/runs?mapRevision=1"),200).runs.length,0);
  check("Авторські preview API не обходять групові правила та не відновлюють чужий хід");
  expect(await send(id,{kind:"advance_absent"}),409);
  const skipId=expect(await create({...groupRules,absence:"skip",timeoutSeconds:5}),201).id;
  for(const user of ["reader","reader2","reader3"])await join(skipId,user);
  await launch(skipId);expect(await send(skipId,{kind:"advance_absent"},"reader2"),409);
  await pool.query("UPDATE labyrinth_groups SET deadline_at=now()-interval '1 second' WHERE project_id=$1 AND run_id=$2",[project,skipId]);
  const beforeSkip=await rawRun(skipId);
  const skipped=expect(await send(skipId,{kind:"advance_absent"},"reader2"),200);
  assert.equal(skipped.storyTime,beforeSkip.state.storyTime);assert.ok(skipped.group.myTurn);
  assert.equal(stateHash((await rawRun(skipId)).state),stateHash(beforeSkip.state));
  check("За замовчуванням очікування; дозволений прострочений пропуск не рухає чужого героя або час");
  const majorityId=expect(await create({...groupRules,decision:"majority"}),201).id;
  for(const user of ["reader","reader2","reader3"])await join(majorityId,user);
  await launch(majorityId);
  const majorityCheckpoint=(await get(majorityId)).revision;
  let majority=expect(await send(majorityId,{kind:"propose_action",jointId:"joint-lever"}),200).group.decision;
  expect(await send(majorityId,{kind:"vote",decisionId:majority.id,approve:true}),200);
  expect(await send(majorityId,{kind:"vote",decisionId:majority.id,approve:false},"reader2"),200);
  assert.equal((await rawRun(majorityId)).state.objects.generator,"off");
  expect(await send(majorityId,{kind:"vote",decisionId:majority.id,approve:true},"reader3"),200);
  assert.equal((await rawRun(majorityId)).state.objects.generator,"on");
  check("Більшість 2/3 враховує заперечення й застосовує дію лише після достатніх голосів");
  majority=expect(await send(majorityId,{kind:"propose_restore",sourceRevision:majorityCheckpoint}),200).group.decision;
  expect(await send(majorityId,{kind:"vote",decisionId:majority.id,approve:true}),200);
  expect(await send(majorityId,{kind:"vote",decisionId:majority.id,approve:true},"reader2"),200);
  assert.ok((await get(majorityId)).group.decision);
  expect(await send(majorityId,{kind:"vote",decisionId:majority.id,approve:false},"reader3"),200);
  assert.equal((await get(majorityId)).group.decision,null);
  assert.equal((await rawRun(majorityId)).state.objects.generator,"on");
  check("Повернення завжди одностайне; третє заперечення скасовує його без зміни світу");
  const revokeVoteId=expect(await create(),201).id;
  for(const user of ["reader","reader2","reader3"])await join(revokeVoteId,user);
  await launch(revokeVoteId);
  const revokedDecision=expect(await send(revokeVoteId,{kind:"propose_action",jointId:"joint-lever"}),200);
  revoked.add("reader3");
  expect(await send(revokeVoteId,{kind:"vote",decisionId:revokedDecision.group.decision.id,approve:true},"reader",randomUUID(),revokedDecision.revision),409);
  const reconciled=await get(revokeVoteId);
  assert.equal(reconciled.group.decision,null);
  assert.equal(reconciled.group.members.find((m:any)=>m.heroId==="three").status,"left");
  assert.equal(reconciled.storyTime,revokedDecision.storyTime);
  assert.equal((await rawRun(revokeVoteId)).state.objects.generator,"off");
  revoked.delete("reader3");expect(await request("/reader/groups/"+revokeVoteId,undefined,"reader3"),403);
  check("Відкликання посеред голосування скасовує пропозицію після refresh без зависання, наслідку або відродження участі");
  const flcBindings=groupBindings.map(b=>b.heroId==="one"?b:{...b,userId:null});
  const flcId=expect(await create({...groupRules,order:["two","one","three"]},flcBindings),201).id;
  await join(flcId,"reader");await launch(flcId);
  let flc=await get(flcId),changed=false;
  for(let i=0;i<14&&flc.group.status==="playing";i++){
    const actor=flc.group.members.find((m:any)=>m.currentTurn);
    if(actor.flc)flc=expect(await send(flcId,{kind:"advance_flc"}),200);
    else flc=expect(await send(flcId,{kind:"action",action:{kind:"move",edgeId:"corridor"}}),200);
    const raw=await rawRun(flcId);if(raw.state.heroes.two.nodeId!=="isolated-room"||raw.state.heroes.three.nodeId!=="upper-left")changed=true;
  }
  assert.ok(changed);assert.equal(flc.group.status,"finished");check("FLC виконує дозволені безпечні ходи за локальними правилами, без чужого входу");
  const rollbackBefore=await rawRun(id);
  revokeAt=refreshCalls+2;
  expect(await send(id,{kind:"message",channel:"player_chat",text:"ROLLBACK_MESSAGE"},"reader",randomUUID(),rollbackBefore.revision),403);
  revokeAt=null;revoked.delete("reader");
  assert.equal((await rawRun(id)).revision,rollbackBefore.revision);
  assert.ok(!(await get(id)).messages.some((m:any)=>m.text==="ROLLBACK_MESSAGE"));check("Права повторно перевіряються перед COMMIT; пізнє відкликання не лишає часткового запису");
  const ticket=await fetch(origin+"/api/realtime/ticket",{method:"POST",headers:{"content-type":"application/json","x-test-user":"reader3"},body:JSON.stringify({bookId:project})}).then(r=>r.json());
  const ws=new WebSocket(origin.replace("http:","ws:")+"/ws?ticket="+encodeURIComponent(ticket.ticket));sockets.push(ws);
  const notification=await new Promise<any>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("No group notification")),5000);
    ws.once("open",()=>ws.send(JSON.stringify({type:"labyrinth:subscribe",payload:{runId:id}})));
    ws.once("message",m=>{clearTimeout(timer);resolve(JSON.parse(m.toString()));});
  });
  assert.deepEqual(Object.keys(notification).sort(),["revision","type"]);assert.equal(notification.type,"labyrinth:changed");
  const closed=new Promise<number>(resolve=>ws.once("close",resolve));
  revoked.add("reader3");assert.equal(await closed,4403);
  expect(await request("/reader/groups/"+id,undefined,"reader3"),403);
  expect(await send(id,{kind:"pass"},"reader2"),200);
  assert.equal((await get(id)).group.members.find((m:any)=>m.heroId==="three").status,"left");
  revoked.delete("reader3");expect(await request("/reader/groups/"+id,undefined,"reader3"),403);
  const noResurrection=expect(await send(id,{kind:"propose_restore",sourceRevision:snapshotRevision}),200).group.decision;
  for(const user of ["reader","reader2"])expect(await send(id,{kind:"vote",decisionId:noResurrection.id,approve:true},user),200);
  expect(await request("/reader/groups/"+id,undefined,"reader3"),403);
  assert.equal((await get(id)).group.members.find((m:any)=>m.heroId==="three").status,"left");
  check("Контрольна точка до відкликання не відновлює доступ або участь вибулого героя");
  check("WebSocket віддає лише ревізію, закривається після відкликання; повторний grant не відроджує завершену участь");
  if(process.argv.includes("--browser")){
    revoked.clear();disabled.delete("reader3");
    const {liveGroup}=await import("./live-labyrinth-group.mts");
    await liveGroup(app,origin,project,mapId,world,revoked);
  }
  publication=expect(await request("/maps/"+mapId+"/reader-publication"),200);
  if(publication.active)expect(await request("/maps/"+mapId+"/reader-withdraw",{expectedRevision:publication.revision}),200);
  expect(await request("/reader/groups/"+id,undefined,"reader"),403);
  assert.equal(expect(await request("/reader/groups",undefined,"reader"),200).groups.length,0);
  const head=expect(await request("/maps/"+mapId+"/reader-publication"),200);
  expect(await request("/maps/"+mapId+"/reader-publication",{expectedRevision:head.revision,mapRevision:1,heroIds:["one","two","three"]}),201);
  expect(await request("/reader/groups/"+id,undefined,"reader"),403);
  check("Відкликання видання блокує всі групи; повторне відкриття не відроджує старі сесії");
  assert.equal(modelCalls,0);
  assert.equal((await pool.query("SELECT revision FROM projects WHERE id=$1",[project])).rows[0].revision,7);
  assert.equal((await pool.query("SELECT revision FROM labyrinth_maps WHERE project_id=$1 AND id=$2",[project,mapId])).rows[0].revision,1);
  check("Проходження не змінює канон книги чи карти й не запускає платний провайдер");
  console.log("Підсумок API/PG: "+passed+" пройшло.");
}finally{
  for(const ws of sockets)ws.terminate();
  for(const ws of wss.clients)ws.terminate();
  await new Promise<void>(r=>wss.close(()=>r()));
  await new Promise<void>(r=>server.close(()=>r()));
  await pool.query("DELETE FROM projects WHERE id=ANY($1::text[])",[[project,foreign]]);
  await pool.end();
}
