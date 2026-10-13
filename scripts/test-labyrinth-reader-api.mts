import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { createCorePool } from "../server/core/index";
import { loadMigrations, resolveMigrationsDir, runMigrations } from "../server/core/migrate";
import { PgLabyrinthStore } from "../server/core/labyrinth/store";
import { registerLabyrinthRoutes } from "../server/core/labyrinth/routes";
import { computeEffective } from "../server/core/collaboration/access";
import { labyrinthDemo } from "../shared/labyrinthDemo";
import { DIRECTOR_DEFAULTS } from "../shared/labyrinthDirector";
import { stateHash } from "../server/core/labyrinth/model";
const url = process.env.CORE_TEST_DATABASE_URL;
if (!url) throw new Error("Set disposable local CORE_TEST_DATABASE_URL ending in _t96");
const parsed = new URL(url);
if (!["127.0.0.1","localhost"].includes(parsed.hostname) || !parsed.pathname.endsWith("_t96"))
  throw new Error("Reader test refuses a non-local or non-_t96 database.");
let pool = createCorePool(url), store: PgLabyrinthStore | null = new PgLabyrinthStore(pool);
const migrations = await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
assert.equal(migrations.schemaVersion, 40);
const p = "t96-" + Date.now(), foreign = p + "-foreign";
await pool.query("INSERT INTO projects(id,owner_id,title,revision) VALUES($1,'owner','Канон',7),($2,'other-owner','Чуже',1)", [p,foreign]);
const revoked = new Set<string>(), disabled = new Set(["disabled"]);
let refreshCalls = 0, revokeAtRefresh: number | null = null, modelCalls = 0;
const app = express(); app.use(express.json({limit:"40mb"}));
app.use((q,_r,next) => {
  const user = String(q.headers["x-test-user"] ?? "guest");
  q.principal = {id:user === "guest" ? null : user,role:user === "admin" ? "admin" : "user",isGuest:user === "guest"} as any;
  next();
});
registerLabyrinthRoutes(app, {
  store: () => store,
  refreshPrincipal: async (q) => {
    refreshCalls++;
    if (revokeAtRefresh === refreshCalls) revoked.add("reader");
    (q.principal as any).disabled = disabled.has(q.principal!.id!);
  },
  directorServices: () => { modelCalls++; throw new Error("Reader must never invoke a paid provider"); },
  access: {
    getCollabOwnerId: async () => undefined,
    getBookOwnerId: async (id) => id === p ? "owner" : id === foreign ? "other-owner" : null,
    listAcceptedInvites: async (projectId) => (projectId === p ? ["reader","reader2","editor","limited","disabled"] : []).map((id) => ({acceptedUserId:id,role:id === "editor" ? "editor" : "reader"})),
    effectiveAccess: async ({projectId,userId}) => {
      const scope = userId === "limited" ? "scene" : "book";
      const allowed = projectId === p && ["reader","reader2","editor","limited","disabled"].includes(userId) && !revoked.has(userId);
      return computeEffective(projectId,userId, allowed ? [{
        id:userId,participantId:userId,projectId,status:"active",level:"view",scopeType:scope,scopeRef:scope === "scene" ? "entry-scene" : null,
        validFrom:"2020-01-01T00:00:00Z",validUntil:null,
      }] as any : [], {full:false});
    },
  },
});
const server = app.listen(0,"127.0.0.1"); await new Promise<void>((r) => server.once("listening",r));
const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const request = async (path:string, body?:unknown, user="owner", project=p) => {
  const r = await fetch(origin + "/api/core/projects/" + project + "/labyrinth" + path, {
    method:body === undefined ? "GET" : "POST",
    headers:{"content-type":"application/json","x-test-user":user}, ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  return {status:r.status,body:await r.json(),cache:r.headers.get("cache-control")};
};
const expect = (r:any, status:number) => { assert.equal(r.status,status,JSON.stringify(r.body)); assert.equal(r.cache,"no-store"); return r.body; };
let passed = 0;
const check = (name:string) => { passed++; console.log("✓ API/PG: " + name); };
const act = async (v:any, action:any, key=randomUUID()) => request("/reader/sessions/" + v.id + "/actions", {expectedRevision:v.revision,action,key},"reader");
try {
  assert.equal((await runMigrations(pool,loadMigrations(resolveMigrationsDir()))).applied.length,0);
  check("Міграція v39 повторюється без змін");
  for (const [who,status] of [["guest",401],["disabled",401],["outsider",403],["limited",403]] as const)
    expect(await request("/reader/library",undefined,who),status);
  check("Гість, вимкнений акаунт, сторонній і доступ лише до сцени закриті");
  expect(await request("/reader/library",undefined,"reader",foreign),403);
  check("Доступ до іншої книги не успадковується");
  const d = structuredClone(labyrinthDemo);
  d.director = {...DIRECTOR_DEFAULTS,enabled:true,confidenceThreshold:0.4};
  d.events[0].conditions = []; d.events[0].director = {intent:"challenge",priority:20};
  d.events[0].hazard = {resourceCosts:{health:2},blocksMovement:false}; d.events[0].duration = 6;
  d.events[0].nodeIds = ["lower-entry","upper-left"];
  d.heroes.push({...structuredClone(d.heroes[0]),id:"other-hero",name:"UNSELECTED_HERO",knowledge:["OTHER_PRIVATE"],fears:["OTHER_FEAR"]});
  d.nodes.find((n) => n.id === "isolated-room")!.title = "HIDDEN_ROOM";
  d.nodes.find((n) => n.id === "isolated-room")!.description = "HIDDEN_BODY";
  d.nodes.find((n) => n.id === "upper-right")!.title = "HIDDEN_BRIDGE_END";
  d.nodes[0].sceneId = "entry-scene";
  d.nodes.find((n) => n.id === "upper-left")!.sceneId = "upper-scene";
  await pool.query("INSERT INTO documents(project_id,id,kind,title) VALUES($1,'entry-scene','section','Вхідна сцена'),($1,'upper-scene','section','Сцена мосту')",[p]);
  await pool.query("INSERT INTO paragraphs(project_id,id,document_id,ord,kind,text,text_hash) VALUES($1,'p-entry','entry-scene',0,'paragraph','ENTRY_TEXT <img src=x onerror=alert(1)>','fixture'),($1,'p-upper','upper-scene',0,'paragraph','FUTURE_SCENE_TEXT','fixture'),($1,'p-draft','entry-scene',1,'draft','PRIVATE_DRAFT','fixture')",[p]);
  const v = expect(await request("/maps",{definition:d,expectedRevision:0}),201), mapId = v.mapId;
  const pubPath = "/maps/" + mapId + "/reader-publication";
  assert.equal(expect(await request(pubPath),200).revision,0);
  for (const who of ["reader","editor"]) expect(await request(pubPath,{expectedRevision:0,mapRevision:1,heroIds:["hero"]},who),403);
  assert.equal(expect(await request("/reader/library",undefined,"reader"),200).editions.length,0);
  expect(await request("/reader/maps/" + mapId + "/start",{publicationRevision:0,heroId:"hero",key:randomUUID()},"reader"),403);
  check("Збереження карти не відкриває читання; учасники не публікують");
  const pub = expect(await request(pubPath,{expectedRevision:0,mapRevision:1,heroIds:["hero"]}),201);
  assert.equal(pub.bookRevision,7);
  expect(await request(pubPath,{expectedRevision:0,mapRevision:1,heroIds:["hero"]}),409);
  expect(await request(pubPath,{expectedRevision:1,mapRevision:1,heroIds:["hero"],public:true}),422);
  check("Лише явне відкриття версії; CAS та суворі поля публікації");
  const library = expect(await request("/reader/library",undefined,"reader"),200);
  assert.deepEqual(library.editions[0].heroes,[{id:"hero",name:"Мандрівник"}]);
  assert.ok(!JSON.stringify(library).includes("HIDDEN_ROOM") && !JSON.stringify(library).includes("OTHER_PRIVATE"));
  assert.deepEqual(library.sessions,[]);
  check("Бібліотека містить лише дозволені назви героїв, без світу та чужих проходжень");
  expect(await request("/reader/maps/" + mapId + "/start",{publicationRevision:pub.revision,heroId:"other-hero",key:randomUUID()},"reader"),403);
  expect(await request("/reader/maps/" + mapId + "/start",{publicationRevision:pub.revision,heroId:"hero",key:randomUUID(),seed:"cheat"},"reader"),422);
  check("Невідкритий герой та довільний seed відхилені");
  const startKey = randomUUID(), startBody = {publicationRevision:pub.revision,heroId:"hero",key:startKey};
  let run = expect(await request("/reader/maps/" + mapId + "/start",startBody,"reader"),201);
  const originalId = run.id;
  assert.equal(expect(await request("/reader/maps/" + mapId + "/start",startBody,"reader"),201).id,originalId);
  expect(await request("/reader/maps/" + mapId + "/start",{...startBody,heroId:"other-hero"},"reader"),409);
  check("Повтор старту повертає те саме проходження; колізія ключа відхилена");
  assert.deepEqual(run.map.nodes.map((n:any) => n.id).sort(),["lower-entry","lower-exit","upper-left"].sort());
  for (const marker of ["OTHER_PRIVATE","OTHER_FEAR","HIDDEN_ROOM","HIDDEN_BODY","HIDDEN_BRIDGE_END","FUTURE_SCENE_TEXT","PRIVATE_DRAFT"])
    assert.ok(!JSON.stringify(run).includes(marker),marker);
  for (const field of ["state","definition","seed","participants","proof","trace","engine"]) assert.ok(!Object.hasOwn(run,field));
  assert.match(JSON.stringify(run.scene),/ENTRY_TEXT/);
  assert.equal(run.warnings[0].phase,"warning");
  check("Перший DTO має свою сцену й локальне попередження; таємниці та сценарій приховані");
  // A single-hero reader run would otherwise be writable via author preview APIs.
  const solo = {...structuredClone(d),heroes:[structuredClone(d.heroes[0])]};
  const soloVersion = expect(await request("/maps",{definition:solo,expectedRevision:0}),201);
  const soloPublication = expect(await request("/maps/" + soloVersion.mapId + "/reader-publication",
    {expectedRevision:0,mapRevision:1,heroIds:["hero"]}),201);
  const soloReader = expect(await request("/reader/maps/" + soloVersion.mapId + "/start",
    {publicationRevision:soloPublication.revision,heroId:"hero",key:randomUUID()},"reader"),201);
  for (const who of ["owner","admin"]) {
    const prefix = "/runs/" + soloReader.id;
    expect(await request(prefix + "/structural-actions",
      {expectedRevision:0,action:{kind:"move",heroId:"hero",edgeId:"up"}},who),403);
    expect(await request(prefix + "/runtime-actions",
      {expectedRevision:0,action:{kind:"wait",heroId:"hero"},key:randomUUID()},who),403);
    expect(await request(prefix + "/director-actions",
      {expectedRevision:0,useAI:false,key:randomUUID()},who),403);
    expect(await request(prefix + "/restore",
      {expectedRevision:0,sourceRevision:0},who),403);
  }
  assert.equal(expect(await request("/maps/" + soloVersion.mapId + "/runs?mapRevision=1"),200).runs.length,0);
  assert.equal(expect(await request("/reader/sessions/" + soloReader.id,undefined,"reader"),200).revision,0);
  expect(await request("/maps/" + soloVersion.mapId + "/reader-withdraw",{expectedRevision:soloPublication.revision}),200);
  check("Авторські preview API не змінюють/відновлюють reader run; список preview їх не містить");
  for (const who of ["reader2","admin"]) {
    expect(await request("/reader/sessions/" + originalId,undefined,who),404);
    expect(await request("/reader/sessions/" + originalId + "/actions",{expectedRevision:run.revision,action:{kind:"wait"},key:randomUUID()},who),404);
    expect(await request("/reader/sessions/" + originalId + "/restore",{expectedRevision:run.revision,sourceRevision:0,key:randomUUID()},who),404);
  }
  check("Інший читач та адміністратор не керують чужою читацькою сесією");
  for (const path of ["/maps/" + mapId + "/versions/1","/runs/" + originalId,"/runs/" + originalId + "/events"])
    expect(await request(path,undefined,"reader"),403);
  check("Авторські API світу, стану та повної історії залишилися закритими");
  for (const action of [{kind:"start_event",eventId:"gas-warning"},{kind:"wait",heroId:"other-hero"},{kind:"move",edgeId:"up",state:{}}])
    expect(await act(run,action),422);
  expect(await act(run,{kind:"move",edgeId:"bridge"}),409);
  expect(await act(run,{kind:"interact",objectId:"other-door",to:"open"}),409);
  check("Немає запуску подій читачем, підміни героя та віддалених дій");
  const initial = structuredClone(run);
  run = expect(await act(run,{kind:"wait"}),200);
  assert.equal(run.storyTime,1); assert.equal(run.warnings[0].phase,"warning");
  run = expect(await act(run,{kind:"wait"}),200);
  assert.equal(run.storyTime,2); assert.equal(run.warnings[0].phase,"active");
  const beforeRestart = structuredClone(run);
  await pool.end(); pool = createCorePool(url); store = new PgLabyrinthStore(pool);
  const resumed = expect(await request("/reader/sessions/" + originalId,undefined,"reader"),200);
  assert.deepEqual(resumed,beforeRestart);
  check("Перезапуск pool/сервісу відновлює активну небезпеку, ресурси, час і checkpoint");
  assert.deepEqual(expect(await request("/reader/sessions/" + originalId,undefined,"reader"),200),resumed);
  check("Оновлення сцени не витрачає час і не запускає директора");
  const moveBody = {expectedRevision:run.revision,action:{kind:"move",edgeId:"up"},key:randomUUID()};
  run = expect(await request("/reader/sessions/" + originalId + "/actions",moveBody,"reader"),200);
  const afterMove = structuredClone(run);
  assert.match(JSON.stringify(run.scene),/FUTURE_SCENE_TEXT/);
  assert.equal(run.map.currentNodeId,"upper-left");
  assert.ok(run.map.nodes.some((n:any) => n.id === "upper-right"));
  check("Текст наступної сцени відкривається після переходу; маркер рухається");
  assert.deepEqual(expect(await request("/reader/sessions/" + originalId + "/actions",moveBody,"reader"),200),afterMove);
  expect(await request("/reader/sessions/" + originalId + "/actions",{...moveBody,action:{kind:"wait"}},"reader"),409);
  check("Втрачена відповідь не дублює хід; ключ не використовується для іншої дії");
  const concurrent = await Promise.all([act(run,{kind:"wait"}),act(run,{kind:"wait"})]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(),[200,409]);
  run = concurrent.find((r) => r.status === 200)!.body;
  assert.equal(run.revision,afterMove.revision + 1);
  check("Дві вкладки: лише один хід прийнято, другий отримує конфлікт");
  const beforeRevocation = run.revision;
  revoked.add("reader");
  expect(await request("/reader/sessions/" + originalId,undefined,"reader"),403);
  expect(await act(run,{kind:"wait"}),403);
  revoked.delete("reader");
  revokeAtRefresh = refreshCalls + 2;
  expect(await act(run,{kind:"wait"}),403); revokeAtRefresh = null; revoked.delete("reader");
  assert.equal(expect(await request("/reader/sessions/" + originalId,undefined,"reader"),200).revision,beforeRevocation);
  check("Відкликання прав на наступному запиті й під час дії не записує хід");
  run = expect(await act(run,{kind:"move",edgeId:"bridge"}),200);
  run = expect(await act(run,{kind:"move",edgeId:"down"}),200);
  assert.equal(run.completed,true); assert.deepEqual(run.choices,[]);
  expect(await act(run,{kind:"wait"}),409);
  check("Вихід завершує маршрут, наступні ігрові дії заблоковані");
  const restoreKey = randomUUID(), restoreBody = {expectedRevision:run.revision,sourceRevision:0,key:restoreKey};
  const restored = expect(await request("/reader/sessions/" + originalId + "/restore",restoreBody,"reader"),201);
  assert.notEqual(restored.id,originalId); assert.equal(restored.revision,0);
  assert.deepEqual(restored.map,initial.map); assert.deepEqual(restored.hero,initial.hero);
  assert.equal(restored.storyTime,initial.storyTime); assert.deepEqual(restored.warnings,initial.warnings);
  assert.equal(expect(await request("/reader/sessions/" + originalId,undefined,"reader"),200).completed,true);
  assert.equal(expect(await request("/reader/sessions/" + originalId + "/restore",restoreBody,"reader"),201).id,restored.id);
  check("Відновлення створює ідемпотентну копію стану й туману; оригінал збережено");
  expect(await request("/reader/sessions/" + originalId + "/restore",{...restoreBody,sourceRevision:999,key:randomUUID()},"reader"),404);
  expect(await request("/reader/sessions/" + originalId + "/restore",{...restoreBody,expectedRevision:0,key:randomUUID()},"reader"),409);
  check("Невідомий checkpoint і застаріле відновлення відхилені");
  const another = expect(await request("/reader/maps/" + mapId + "/start",{...startBody,key:randomUUID()},"reader2"),201);
  const ownList = expect(await request("/reader/library",undefined,"reader"),200).sessions;
  assert.ok(ownList.some((s:any) => s.id === restored.id)); assert.ok(!ownList.some((s:any) => s.id === another.id));
  check("Список збережених маршрутів відокремлений за обліковими записами");
  await pool.query("UPDATE paragraphs SET text='UPDATED_CANON <img src=x onerror=window.__readerXss=true>' WHERE project_id=$1 AND id='p-entry'",[p]);
  await pool.query("UPDATE projects SET revision=8 WHERE id=$1",[p]);
  assert.match(JSON.stringify(expect(await request("/reader/sessions/" + restored.id,undefined,"reader"),200).scene),/ENTRY_TEXT/);
  const nextD = structuredClone(d); nextD.nodes[0].description = "EDITION_TWO";
  expect(await request("/maps/" + mapId + "/versions",{definition:nextD,expectedRevision:1}),201);
  const pub2 = expect(await request(pubPath,{expectedRevision:pub.revision,mapRevision:2,heroIds:["hero"]}),201);
  assert.equal(pub2.bookRevision,8);
  const oldEdition = expect(await request("/reader/sessions/" + restored.id,undefined,"reader"),200);
  assert.equal(oldEdition.mapRevision,1); assert.ok(!JSON.stringify(oldEdition.scene).includes("UPDATED_CANON"));
  const newEdition = expect(await request("/reader/maps/" + mapId + "/start",{publicationRevision:pub2.revision,heroId:"hero",key:randomUUID()},"reader"),201);
  assert.equal(newEdition.mapRevision,2); assert.match(JSON.stringify(newEdition.scene),/UPDATED_CANON/);
  expect(await request("/reader/maps/" + mapId + "/start",{...startBody,key:randomUUID()},"reader"),409);
  check("Новий реліз не переписує старе проходження; новий старт читає новий знімок");
  await assert.rejects(pool.query("UPDATE labyrinth_reader_editions SET scenes='{}' WHERE project_id=$1",[p]),
    (e:any) => e.code === "23514");
  check("SQL не дозволяє перезаписати знімок тексту видання");
  const withdrawn = expect(await request("/maps/" + mapId + "/reader-withdraw",{expectedRevision:pub2.revision}),200);
  for (const id of [originalId,restored.id,newEdition.id]) expect(await request("/reader/sessions/" + id,undefined,"reader"),403);
  expect(await request("/reader/sessions/" + originalId + "/actions",moveBody,"reader"),403);
  expect(await request("/reader/maps/" + mapId + "/start",startBody,"reader"),403);
  assert.equal(expect(await request("/reader/library",undefined,"reader"),200).sessions.length,0);
  check("Відкликання публікації закриває усі її сесії та повтори старих запитів");
  const pub3 = expect(await request(pubPath,{expectedRevision:withdrawn.revision,mapRevision:2,heroIds:["hero"]}),201);
  expect(await request("/reader/sessions/" + restored.id,undefined,"reader"),403);
  expect(await request("/reader/maps/" + mapId + "/start",{publicationRevision:pub3.revision,heroId:"hero",key:randomUUID()},"reader"),201);
  check("Повторне відкриття не воскресає раніше відкликані сесії");
  await pool.query("UPDATE documents SET deleted_at=now() WHERE project_id=$1 AND id='entry-scene'",[p]);
  expect(await request(pubPath,{expectedRevision:pub3.revision,mapRevision:2,heroIds:["hero"]}),422);
  assert.equal(expect(await request(pubPath),200).revision,pub3.revision);
  await pool.query("UPDATE documents SET deleted_at=NULL WHERE project_id=$1 AND id='entry-scene'",[p]);
  check("Зникла сцена блокує нове видання без часткового запису");
  assert.equal((await pool.query("SELECT revision FROM projects WHERE id=$1",[p])).rows[0].revision,8);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM entities WHERE project_id=$1",[p])).rows[0].n,0);
  assert.equal(modelCalls,0);
  check("Читання не змінює канон і не викликає платного ШІ");
  store = null;
  expect(await request("/reader/library",undefined,"reader"),503);
  store = new PgLabyrinthStore(pool);
  check("Недоступне ядро відповідає 503 без адреси бази");
  expect(await request("/reader/library?heroId=other",undefined,"reader"),422);
  expect(await request("/reader/sessions/not-a-uuid",undefined,"reader"),404);
  check("Непідтримувані параметри та некоректні id відхилені");
  if (process.argv.includes("--browser")) {
    const { liveReader } = await import("./live-labyrinth-reader.mts");
    await liveReader(app,origin,p,mapId,pub3.revision);
  }
  console.log("Підсумок API/PG: " + passed + " пройшло.");
} finally {
  await pool.query("DELETE FROM projects WHERE id=ANY($1::text[])",[[p,foreign]]);
  await new Promise<void>((resolve,reject) => server.close((e) => e ? reject(e) : resolve()));
  await pool.end();
}
