import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import express from "express";
import type {AddressInfo} from "node:net";
import {labyrinthDemo} from "../shared/labyrinthDemo";
import {GROUP_TERMS} from "../shared/labyrinthGroup";
const url=process.env.CORE_TEST_DATABASE_URL;
if(!url)throw new Error("Use a disposable local CORE_TEST_DATABASE_URL ending in _t98.");
const parsed=new URL(url);
if(!["127.0.0.1","localhost"].includes(parsed.hostname)||!parsed.pathname.endsWith("_t98"))throw new Error("Story tests refuse non-local/non-_t98 databases.");
process.env.DATA_DIR=await fs.mkdtemp("/tmp/t98-books-");
delete process.env.DATABASE_PATH;
const [{createCorePool},{loadMigrations,resolveMigrationsDir,runMigrations},{PgLabyrinthStore},{registerLabyrinthRoutes},bookStore,db,{computeEffective},{stateHash},{LabyrinthError}]=await Promise.all([
  import("../server/core/index"),import("../server/core/migrate"),import("../server/core/labyrinth/store"),import("../server/core/labyrinth/routes"),
  import("../server/bookStore"),import("../server/db"),import("../server/core/collaboration/access"),import("../server/core/labyrinth/model"),import("../server/core/labyrinth/model")]);
if(!process.argv.includes("--json"))assert.equal(await db.initDb(),true,"SQLite must execute, not skip");
let pool=createCorePool(url),store=new PgLabyrinthStore(pool);
assert.equal((await runMigrations(pool,loadMigrations(resolveMigrationsDir()))).schemaVersion,41);
const project="t98-"+randomUUID(),foreign=project+"-foreign";
await pool.query("INSERT INTO projects(id,owner_id,title,revision) VALUES($1,'owner','Канон',7),($2,'foreign-owner','Чуже',1)",[project,foreign]);
const sourceBook={id:project,title:"Оригінальна книга",author:"Автор",chapters:[{id:"canon",sections:[{id:"canon-scene",content:"UNCHANGED_CANON"}]}],privateNotes:"AUTHOR_PRIVATE"};
await bookStore.saveBook({book:sourceBook,ownerId:"owner"});
const sourceBefore=stateHash(await bookStore.getBook(project));
const disabled=new Set<string>(["disabled"]),revoked=new Set<string>(),aiDenied=new Set<string>();
const users=["owner","admin","reader","reader2","limited","disabled","outsider"];
const principal=(id:string)=>users.includes(id)&&!disabled.has(id)?{id,role:id==="admin"?"admin":"user",isGuest:false,name:id}:null;
const access={getBookOwnerId:async(p:string)=>p===project?"owner":p===foreign?"foreign-owner":null,getCollabOwnerId:async()=>undefined,
  listAcceptedInvites:async(p:string)=>(p===project?["reader","reader2","limited"]:[]).map(id=>({acceptedUserId:id,role:"reader"})),
  effectiveAccess:async({projectId,userId}:any)=>computeEffective(projectId,userId,projectId===project&&["reader","reader2","limited"].includes(userId)&&!revoked.has(userId)?[{
    id:userId,projectId,participantId:userId,status:"active",level:"view",scopeType:userId==="limited"?"scene":"book",scopeRef:userId==="limited"?"one-scene":null,validFrom:"2020-01-01T00:00:00Z",validUntil:null
  }] as any:[],{full:false})};
let modelCalls=0,lastInput="",modelMode="normal",writeMode="normal";
let modelStarted:Promise<void>=Promise.resolve(),modelStartedResolve:()=>void=()=>{},modelFinish:()=>void=()=>{};
const delayModel=()=>{modelMode="delay";modelStarted=new Promise(r=>{modelStartedResolve=r;});};
const app=express();app.use(express.json({limit:"8mb"}));
app.use((q,_r,next)=>{const id=String(q.headers["x-test-user"]??"guest");q.principal={id:id==="guest"?null:id,role:id==="admin"?"admin":"user",isGuest:id==="guest"} as any;next();});
registerLabyrinthRoutes(app,{access,store:()=>store,groupPrincipal:async id=>principal(id),
  refreshPrincipal:async q=>{(q.principal as any).disabled=disabled.has(q.principal!.id!);},
  recheckAi:async q=>{if(aiDenied.has(q.principal!.id!))throw new LabyrinthError(403,"AI permission revoked");},
  generateStory:async(_q,input)=>{modelCalls++;lastInput=input;
    if(modelMode==="delay"){modelStartedResolve();await new Promise<void>(r=>{modelFinish=r;});}
    if(modelMode==="fail")throw new Error("PRIVATE_PROVIDER_KEY_DO_NOT_PRINT");
    const blocks=JSON.parse(input).blocks.map((b:any)=>({id:b.id,text:"Літературно: "+b.text}));
    if(modelMode==="bad")blocks[0].id="INVENTED_SOURCE";
    return{text:JSON.stringify({blocks}),modelId:"controlled-test",inputTokens:10,outputTokens:20,costUsd:0};},
  storyBooks:{read:bookStore.getBook,write:async(book,ownerId,recheck)=>{
    if(writeMode==="revoke-owner")disabled.add("owner");
    if(writeMode==="revoke-contributor")revoked.add("reader");
    const saved=await bookStore.saveBook({book,ownerId,beforeWrite:recheck,mergeKey:"labyrinth-story:"+String((book.labyrinthStory as any)?.draftId)});
    if(writeMode==="lose-core-commit"){writeMode="normal";throw new Error("controlled post-write failure");}return saved;
  }}
});
const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
const origin="http://127.0.0.1:"+(server.address() as AddressInfo).port;
const base="/api/core/projects/"+project+"/labyrinth";
const request=async(path:string,body?:unknown,user="owner",p=project)=>{
  const r=await fetch(origin+"/api/core/projects/"+p+"/labyrinth"+path,{method:body===undefined?"GET":"POST",headers:{"content-type":"application/json","x-test-user":user},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:r.status,body:await r.json(),cache:r.headers.get("cache-control")};
};
const expect=(r:any,status:number)=>{assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(r.cache,"no-store");return r.body;};
let passed=0;const check=(name:string)=>{passed++;console.log("✓ API/PG/"+(process.argv.includes("--json")?"JSON":"SQLite")+": "+name);};
const world=structuredClone(labyrinthDemo);world.events=[];world.heroes[0].knowledge=["SECRET_KNOWLEDGE"];world.heroes[0].goals=["SECRET_PLAN"];
world.nodes.find(n=>n.id==="lower-entry")!.description="FROZEN_PUBLIC_SCENE";
let mapId="",publication:any;
const release=async(d=world)=>{
  const map=expect(await request("/maps",{expectedRevision:0,definition:d}),201);
  const pub=expect(await request("/maps/"+map.mapId+"/reader-publication",{expectedRevision:0,mapRevision:1,heroIds:d.heroes.map(h=>h.id)}),201);
  return{mapId:map.mapId,pub};
};
const solo=async(edges:string[],map=mapId,pub=publication,heroId=world.heroes[0].id)=>{
  let s=expect(await request("/reader/maps/"+map+"/start",{publicationRevision:pub.revision,heroId,key:randomUUID()},"reader"),201);
  for(const edgeId of edges)s=expect(await request("/reader/sessions/"+s.id+"/actions",{expectedRevision:s.revision,action:{kind:"move",edgeId},key:randomUUID()},"reader"),200);
  return s;
};
const create=async(s:any,title="Історія "+randomUUID(),key=randomUUID())=>request("/runs/"+s.id+"/story-drafts",{expectedRunRevision:s.revision,title,key});
const get=async(d:any)=>expect(await request("/story-drafts/"+d.id),200);
const edit=async(d:any,text:string,key=randomUUID())=>request("/story-drafts/"+d.id+"/edit",{expectedRevision:d.revision,title:d.title,edits:[{id:d.blocks.find((b:any)=>b.kind==="fact").id,text}],key});
const accept=async(d:any,key=randomUUID())=>request("/story-drafts/"+d.id+"/accept",{expectedRevision:d.revision,confirm:true,causalityReviewed:true,key});
const rewrite=async(d:any,key=randomUUID())=>request("/story-drafts/"+d.id+"/rewrite",{expectedRevision:d.revision,confirmAi:true,key});
try {
  assert.equal((await runMigrations(pool,loadMigrations(resolveMigrationsDir()))).applied.length,0);check("Міграція v40 повторна та незмінна");
  const released=await release();mapId=released.mapId;publication=released.pub;
  for(const [user,status] of [["guest",401],["disabled",401],["outsider",403],["reader",403],["reader2",403],["limited",403]] as const)
    expect(await request("/maps/"+mapId+"/story-drafts",undefined,user),status);
  check("Гість, вимкнений акаунт, сторонній і учасники не читають авторську збірку");
  const unfinished=await solo([]);expect(await create(unfinished),409);assert.equal(modelCalls,0);check("Незавершений маршрут не створює чернетки та не викликає AI");
  const a=await solo(["corridor"]),b=await solo(["up","bridge","down"]);
  const createKey=randomUUID(),titleA="Маршрут A",draftA=expect(await create(a,titleA,createKey),201);
  assert.ok(draftA.blocks.every((v:any)=>v.source.runId===a.id&&v.source.mapRevision===1&&v.source.bookRevision===7));
  assert.ok(draftA.blocks.some((v:any)=>v.kind==="ending"&&v.text.includes("дістається виходу")));
  for(const marker of ["SECRET_KNOWLEDGE","SECRET_PLAN","AUTHOR_PRIVATE","UNCHANGED_CANON"])assert.ok(!JSON.stringify(draftA).includes(marker));
  check("Готовий маршрут має походження кожного фрагмента та точний фінал без приватного стану");
  assert.equal(expect(await create(a,titleA,createKey),201).id,draftA.id);
  assert.equal(expect(await create(a,titleA),201).id,draftA.id);
  expect(await create(a,"Інше",createKey),409);check("Повтор і новий ключ тієї самої збірки не дублюють її; колізія ключа відхилена");
  const draftB=expect(await create(b,"Маршрут B"),201);
  assert.ok(draftB.blocks.some((v:any)=>v.text.includes("рушає мостом")));
  assert.ok(!draftA.blocks.some((v:any)=>v.text.includes("рушає мостом")));
  assert.equal(draftB.mapRevision,draftA.mapRevision);check("Два маршрути однієї версії дають різні причинно узгоджені історії");
  expect(await request("/story-drafts/"+draftA.id,undefined,"owner",foreign),403);
  expect(await request("/story-drafts/"+draftA.id,undefined,"admin",foreign),404);
  expect(await request("/story-drafts/"+draftA.id+"?secret=1"),422);
  expect(await request("/runs/"+randomUUID()+"/story-drafts",{expectedRunRevision:0,title:"Підміна",key:randomUUID()}),404);check("Чужий project/run/draft та довільні параметри не обходять scope");
  const changed=structuredClone(world);changed.nodes[0].description="NEW_UNVISITED_VERSION";
  expect(await request("/maps/"+mapId+"/versions",{expectedRevision:1,definition:changed}),201);
  assert.ok((await get(draftA)).blocks.some((v:any)=>v.text.includes("FROZEN_PUBLIC_SCENE")));
  assert.ok(!JSON.stringify(await get(draftA)).includes("NEW_UNVISITED_VERSION"));check("Нова карта не змінює заморожені сцени історичного проходження");
  const badFields={expectedRevision:0,confirmAi:true,key:randomUUID(),apiKey:"NOT_A_REAL_KEY"};
  expect(await request("/story-drafts/"+draftA.id+"/rewrite",badFields),422);
  expect(await request("/story-drafts/"+draftA.id+"/rewrite",{expectedRevision:0,confirmAi:false,key:randomUUID()}),422);
  aiDenied.add("owner");expect(await rewrite(draftA),403);aiDenied.clear();assert.equal(modelCalls,0);check("AI потребує підтвердження та дозволу до виклику; сторонні ключі не приймаються");
  const aiKey=randomUUID(),rewritten=expect(await rewrite(draftA,aiKey),200);
  assert.equal(modelCalls,1);expect(await rewrite(draftA,aiKey),200);assert.equal(modelCalls,1);
  assert.deepEqual(rewritten.blocks.map((v:any)=>v.text),draftA.blocks.map((v:any)=>v.text));
  assert.ok(rewritten.blocks.filter((v:any)=>v.kind==="ending").every((v:any)=>v.proposal===null));check("AI — лише редакторська пропозиція; повтор не витрачає ще один виклик і не змінює факти");
  modelMode="bad";const badKey=randomUUID();expect(await rewrite(draftB,badKey),422);
  assert.equal((await get(draftB)).revision,0);expect(await rewrite(draftB,badKey),409);
  modelMode="fail";const failed=expect(await rewrite(draftB),502);assert.ok(!JSON.stringify(failed).includes("PRIVATE_PROVIDER_KEY"));modelMode="normal";
  check("Вигадані джерела й помилка провайдера не записуються і не розкривають секретів");
  const edits=await Promise.all([edit(rewritten,"Редакція один"),edit(rewritten,"Редакція два")]);
  assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);const reviewed=await get(draftA);
  assert.ok(reviewed.blocks.some((v:any)=>v.proposalOrigin==="author"&&v.aiAssisted));
  const ending=reviewed.blocks.find((v:any)=>v.kind==="ending");
  expect(await request("/story-drafts/"+reviewed.id+"/edit",{expectedRevision:reviewed.revision,title:reviewed.title,edits:[{id:ending.id,text:"Вигадана перемога"}],key:randomUUID()}),422);
  check("Конкурентна редакція має один успіх; оригінал фіналу захищений, походження AI не губиться");
  expect(await request("/story-drafts/"+reviewed.id+"/accept",{expectedRevision:reviewed.revision,confirm:true,causalityReviewed:false,key:randomUUID()}),422);
  assert.equal(await bookStore.getBook("LB-STORY-"+reviewed.id),null);check("До явного прийняття нової книги немає");
  const acceptKey=randomUUID(),accepted=expect(await accept(reviewed,acceptKey),200);
  const saved=await bookStore.getBook(accepted.newBookId);assert.ok(saved);assert.equal(saved.ownerId,"owner");assert.equal(saved.revision,1);
  expect(await accept(reviewed,acceptKey),200);assert.equal((await bookStore.getBook(accepted.newBookId))!.revision,1);
  assert.equal((saved.book as any).status,"draft");assert.equal((saved.book as any).labyrinthStory.publicationReady,false);
  assert.deepEqual((saved.book as any).characters,[]);assert.equal(stateHash(await bookStore.getBook(project)),sourceBefore);
  expect(await request("/story-drafts/"+accepted.id+"/book",undefined,"reader"),403);
  check("Прийняття створює одну окрему приватну книгу без зміни канону чи автоматичного співавторства");
  writeMode="lose-core-commit";const recoverDraft=expect(await create(b,"Відновлення після збою"),201),recoverKey=randomUUID();
  expect(await accept(recoverDraft,recoverKey),500);assert.ok(await bookStore.getBook("LB-STORY-"+recoverDraft.id));
  const recovered=expect(await accept(recoverDraft,recoverKey),200);assert.equal((await bookStore.getBook(recovered.newBookId))!.revision,1);
  check("Збій між записом книги й Core commit відновлюється без дубля або перезапису");
  const late=expect(await create(b,"Пізня відповідь"),201);delayModel();const pending=rewrite(late);await modelStarted;
  expect(await request("/story-drafts/"+late.id+"/reject",{expectedRevision:late.revision,key:randomUUID()}),200);
  modelFinish();expect(await pending,409);modelMode="normal";assert.equal((await get(late)).status,"rejected");
  check("Відхилення під час генерації відкидає пізню відповідь");
  const revokedActor=expect(await create(b,"Відкликаний автор"),201);delayModel();const actorPending=rewrite(revokedActor);await modelStarted;
  disabled.add("owner");modelFinish();expect(await actorPending,401);disabled.delete("owner");modelMode="normal";
  assert.equal((await get(revokedActor)).revision,0);check("Вимкнення автора під час AI не дозволяє записати пізню пропозицію");
  const revokedAi=expect(await create(b,"Відкликаний AI"),201);delayModel();const aiPending=rewrite(revokedAi);await modelStarted;
  aiDenied.add("owner");modelFinish();expect(await aiPending,403);aiDenied.clear();modelMode="normal";
  assert.equal((await get(revokedAi)).revision,0);check("Відкликання дозволу AI перевіряється також після відповіді");
  const groupWorld=structuredClone(world);
  const template=structuredClone(groupWorld.heroes[0]);
  groupWorld.heroes=[{...structuredClone(template),id:"one",name:"Іван",knowledge:["ONE_PRIVATE"]},{...structuredClone(template),id:"two",name:"Олена",knowledge:["TWO_PRIVATE"]}];
  const groupMap=await release(groupWorld);
  const groupRules={order:["one","two"],decision:"unanimous",timeoutSeconds:0,absence:"pause",jointActions:[]};
  const groupView=async(id:string,user="reader")=>expect(await request("/reader/groups/"+id,undefined,user),200);
  const send=async(id:string,command:any,user="reader")=>{
    const current=await groupView(id,user);return expect(await request("/reader/groups/"+id+"/commands",{expectedRevision:current.revision,command,key:randomUUID()},user),200);
  };
  const newGroup=async()=>{
    const g=expect(await request("/maps/"+groupMap.mapId+"/groups",{publicationRevision:groupMap.pub.revision,
      bindings:[{heroId:"one",userId:"reader",alias:"Іван"},{heroId:"two",userId:"reader2",alias:"Олена"}],rules:groupRules,key:randomUUID()}),201);
    await send(g.id,{kind:"join",alias:"Псевдонім один",candidate:true,terms:GROUP_TERMS});
    await send(g.id,{kind:"join",alias:"Псевдонім два",candidate:false,terms:GROUP_TERMS},"reader2");
    expect(await request("/groups/"+g.id+"/launch",{expectedRevision:(await groupView(g.id)).revision,key:randomUUID()}),200);return g.id;
  };
  const finishGroup=async(id:string)=>{
    await send(id,{kind:"action",action:{kind:"move",edgeId:"corridor"}});
    for(const edgeId of ["up","bridge","down"])await send(id,{kind:"action",action:{kind:"move",edgeId}},"reader2");
    const finished=await groupView(id);assert.equal(finished.group.status,"finished");return finished;
  };
  const groupId=await newGroup();
  await send(groupId,{kind:"message",channel:"player_chat",text:"PRIVATE_PLAYER_CHAT"});
  await send(groupId,{kind:"message",channel:"hero_dialogue",text:"PRIVATE_HERO_DIALOGUE"});
  const approved=await send(groupId,{kind:"contribute",text:"CONSENTED_T98_TEXT",include:true,aiAssisted:true,terms:GROUP_TERMS});
  const contributionId=approved.contributions[0].id,checkpoint=approved.revision;
  await send(groupId,{kind:"action",action:{kind:"move",edgeId:"up"}});
  await send(groupId,{kind:"contribute",text:"ABANDONED_BRANCH_TEXT",include:true,aiAssisted:false,terms:GROUP_TERMS});
  const decision=(await send(groupId,{kind:"propose_restore",sourceRevision:checkpoint})).group.decision;
  await send(groupId,{kind:"vote",decisionId:decision.id,approve:true});
  await send(groupId,{kind:"vote",decisionId:decision.id,approve:true},"reader2");
  const groupFinished=await finishGroup(groupId),groupDraft=expect(await create(groupFinished,"Історія групи"),201);
  assert.ok(groupDraft.blocks.some((v:any)=>v.kind==="contribution"&&v.text==="CONSENTED_T98_TEXT"&&v.aiAssisted));
  for(const marker of ["PRIVATE_PLAYER_CHAT","PRIVATE_HERO_DIALOGUE","ONE_PRIVATE","TWO_PRIVATE","ABANDONED_BRANCH_TEXT"])
    assert.ok(!JSON.stringify(groupDraft).includes(marker));
  assert.equal(groupDraft.blocks.filter((v:any)=>v.text.includes("Іван рушає драбиною")).length,0);
  check("Групова історія зберігає погоджений внесок; приватні чати/знання й скасована гілка відсутні");
  expect(await rewrite(groupDraft),200);assert.ok(!lastInput.includes("CONSENTED_T98_TEXT"));
  assert.ok(!lastInput.includes("PRIVATE_PLAYER_CHAT")&&!lastInput.includes("ONE_PRIVATE"));
  const groupAfterAi=await get(groupDraft);assert.equal(groupAfterAi.blocks.find((v:any)=>v.kind==="contribution").proposal,null);
  const forbiddenEdit={expectedRevision:groupAfterAi.revision,title:groupAfterAi.title,edits:[{id:groupAfterAi.blocks.find((v:any)=>v.kind==="contribution").id,text:"Чужа редакція"}],key:randomUUID()};
  expect(await request("/story-drafts/"+groupDraft.id+"/edit",forbiddenEdit),422);
  check("Текст учасника не переписується автором/AI і не надсилається зовнішній моделі");
  const lateConsent=expect(await create(groupFinished,"Відкликання під час AI"),201);delayModel();const consentPending=rewrite(lateConsent);await modelStarted;
  await send(groupId,{kind:"withdraw_contribution",contributionId});modelFinish();expect(await consentPending,409);modelMode="normal";
  expect(await request("/story-drafts/"+lateConsent.id),409);expect(await accept(groupAfterAi),409);
  const refreshedGroup=await groupView(groupId),withoutConsent=expect(await create(refreshedGroup,"Без відкликаного внеску"),201);
  assert.ok(!JSON.stringify(withoutConsent).includes("CONSENTED_T98_TEXT"));
  check("Відкликання під час генерації не блокується SQL-локом; пізній текст і стара збірка відхиляються");
  await send(groupId,{kind:"contribute",text:"CONSENT_BEFORE_WRITE",include:true,aiAssisted:false,terms:GROUP_TERMS});
  const withNewConsent=await groupView(groupId),writeConsent=expect(await create(withNewConsent,"Доступ перед записом"),201);
  writeMode="revoke-contributor";expect(await accept(writeConsent),409);assert.equal(await bookStore.getBook("LB-STORY-"+writeConsent.id),null);revoked.clear();writeMode="normal";
  check("Відкликаний доступ до внеску в черзі запису не створює книгу");
  const writeActor=expect(await create(b,"Автор перед записом"),201);writeMode="revoke-owner";
  expect(await accept(writeActor),401);assert.equal(await bookStore.getBook("LB-STORY-"+writeActor.id),null);disabled.delete("owner");writeMode="normal";
  check("Перевірка автора виконується всередині реальної черги SQLite/JSON до запису");
  const retiredGroup=await newGroup();await send(retiredGroup,{kind:"action",action:{kind:"move",edgeId:"up"}});await send(retiredGroup,{kind:"leave"});
  const retiredFinish=await send(retiredGroup,{kind:"action",action:{kind:"move",edgeId:"corridor"}},"reader2");
  const retiredDraft=expect(await create(retiredFinish,"Герой залишив групу"),201);
  assert.ok(retiredDraft.blocks.some((v:any)=>v.text.includes("Іван рушає драбиною")));
  assert.ok(retiredDraft.blocks.some((v:any)=>v.kind==="ending"&&v.text.includes("Іван перебуває")));
  assert.ok(!retiredDraft.blocks.some((v:any)=>v.kind==="ending"&&v.text.includes("Іван дістається виходу")));
  check("Минулі дії героя, який вийшов, зберігаються; його невиконаний вихід не вигадується");
  const fork=expect(await request("/reader/sessions/"+b.id+"/restore",{expectedRevision:b.revision,sourceRevision:1,key:randomUUID()},"reader"),201);
  let forkFinish=fork;for(const edgeId of ["bridge","down"])forkFinish=expect(await request("/reader/sessions/"+fork.id+"/actions",{expectedRevision:forkFinish.revision,action:{kind:"move",edgeId},key:randomUUID()},"reader"),200);
  const forkDraft=expect(await create(forkFinish,"Одиночне відновлення"),201);
  assert.equal(forkDraft.blocks.filter((v:any)=>v.text.includes("рушає драбиною")).length,1);
  assert.ok(forkDraft.blocks.some((v:any)=>v.source.runId===b.id));assert.ok(forkDraft.blocks.some((v:any)=>v.source.runId===fork.id));
  check("Одиночний fork включає точну передісторію батьківського checkpoint без дубля руху");
  const revived=expect(await create(b,late.title),201);assert.equal(revived.id,late.id);assert.equal(revived.status,"draft");assert.ok(revived.revision>late.revision);
  check("Після відхилення явна повторна збірка відновлює чернетку новою ревізією");
  const pendingDraft=expect(await create(b,"Після перезапуску генератора"),201),oldKey=randomUUID();
  await pool.query("INSERT INTO labyrinth_story_requests(project_id,user_id,key,draft_id,operation,request_hash,status,created_at) VALUES($1,'owner',$2,$3,'rewrite',$4,'pending',now()-interval '3 minutes')",
    [project,oldKey,pendingDraft.id,stateHash({operation:"rewrite",id:pendingDraft.id,expected:pendingDraft.revision})]);
  const callsBefore=modelCalls;expect(await rewrite(pendingDraft,oldKey),409);assert.equal(modelCalls,callsBefore);
  expect(await rewrite(pendingDraft),200);assert.equal(modelCalls,callsBefore+1);
  check("Покинута генерація після restart не повторюється автоматично; нова підтверджена спроба можлива");
  const acceptedHash=stateHash(await bookStore.getBook(accepted.newBookId));
  await pool.end();pool=createCorePool(url);store=new PgLabyrinthStore(pool);db.closeDb();bookStore.__resetBookCacheForTests();
  if(!process.argv.includes("--json"))assert.equal(await db.initDb(),true);
  assert.equal(stateHash(await bookStore.getBook(accepted.newBookId)),acceptedHash);assert.equal((await get(accepted)).status,"accepted");
  assert.equal((await runMigrations(pool,loadMigrations(resolveMigrationsDir()))).applied.length,0);
  check("Перезапуск PostgreSQL-пулу та сховища книги зберігає рукопис, джерела й прийняття");
  if(process.argv.includes("--browser"))await (await import("./live-labyrinth-story.mts")).liveStory(app,origin,project,groupMap.mapId,revoked);
  const withdrawnDraft=expect(await create(b,"Відкликане читання"),201);delayModel();const withdrawPending=rewrite(withdrawnDraft);await modelStarted;
  expect(await request("/maps/"+mapId+"/reader-withdraw",{expectedRevision:publication.revision}),200);modelFinish();expect(await withdrawPending,403);modelMode="normal";
  assert.equal(stateHash(await bookStore.getBook(project)),sourceBefore);
  check("Відкликана читацька версія відкидає пізній AI; канон незмінний протягом усього прогону");
} finally {
  modelFinish();await new Promise<void>(r=>server.close(()=>r()));await pool.end();db.closeDb();
  await fs.rm(process.env.DATA_DIR,{recursive:true,force:true});
}
console.log("Підсумок: "+passed+" API перевірок пройшло.");
