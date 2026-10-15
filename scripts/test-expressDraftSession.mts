import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { WizardDraftSession, WizardApiError } from '../src/utils/expressDraftSession';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'express-drafts-'));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, 'drafts.db');
const { DatabaseSync } = await import('node:sqlite');
const old = new DatabaseSync(process.env.DATABASE_PATH);
old.exec("CREATE TABLE express_drafts (id TEXT PRIMARY KEY,user_id TEXT,step INTEGER NOT NULL DEFAULT 1,payload TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL)");
const date = new Date().toISOString();
old.prepare('INSERT INTO express_drafts VALUES(?,?,?,?,?,?,?)').run('legacy', null, 3, JSON.stringify({cast:[{firstName:'Іван',lastName:'Коваль'}]}),date,date,'2099-01-01');
old.close();
const db = await import('../server/db');
const store = await import('../server/expressStore');
const { registerExpressRoutes } = await import('../server/expressRoutes');
let passed = 0;
function check(name: string, condition: unknown) { assert.ok(condition, name); passed++; console.log('✓ ' + name); }
let calls = 0;
let resolveAi: (() => void) | undefined;
let started: (() => void) | undefined;
let waitAi = false;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.principal = { id:'writer', role:'writer', isGuest:false } as any; next(); });
registerExpressRoutes(app, { ask: async (_req, _label, _system, prompt) => {
  calls++;
  if (waitAi) { started?.(); await new Promise<void>((r) => { resolveAi = r; }); }
  const text = prompt.includes('"cast"') ? JSON.stringify({cast:[{firstName:'Новий',lastName:'Герой',poltiRoleName:'Союзник'}]})
    : prompt.includes('"synopsis"') ? JSON.stringify({synopsis:'Погоджений синопсис'})
    : JSON.stringify({framework:'psychotypes',rationale:'Конфлікт цілей'});
  return { text, engine:'test', source:'platform' };
}});
const server = app.listen(0,'127.0.0.1');
await new Promise<void>(r => server.once('listening',r));
const base = 'http://127.0.0.1:'+(server.address() as AddressInfo).port;
async function request(url: string, method='GET', data?: unknown) {
  const response=await fetch(base+url,{method,headers:{'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:response.status,body:await response.json()};
}
try {
  check('SQLite initialization migrates an existing schema', await db.initDb());
  const legacy = store.getDraft('legacy')!;
  check('legacy ids are persisted once', !!legacy.payload.cast![0].id && store.getDraft('legacy')!.payload.cast![0].id === legacy.payload.cast![0].id);
  db.closeDb(); await db.initDb();
  check('legacy identity survives restart', store.getDraft('legacy')!.payload.cast![0].id === legacy.payload.cast![0].id);
  const d=store.createDraft('writer',{seed:'Двоє героїв захищають майстерню',cast:[{id:'hero-a',firstName:'Олена',lastName:'Коваль'},{id:'hero-b',firstName:'Іван',lastName:'Бондар'}]});
  check('new draft starts at revision 1', d.revision===1);
  const patch={cast:[{id:'hero-b',firstName:'Іван',lastName:'Бондар'}]};
  const first=store.updateDraft(d.id,patch,d.revision,3)!;
  check('deletion preserves remaining hero identity',first.payload.cast![0].id==='hero-b');
  assert.throws(()=>store.updateDraft(d.id,{seed:'stale'},d.revision),store.DraftConflictError);
  check('stale writes cannot overwrite the current payload',store.getDraft(d.id)!.payload.seed===d.payload.seed);
  const endpoint='/api/express/draft/'+d.id;
  check('missing revision is rejected', (await request(endpoint,'PATCH',{payload:{seed:'bad'}})).status===428);
  const writes=await Promise.all([
    request(endpoint,'PATCH',{expectedRevision:first.revision,payload:{genre:'A'}}),
    request(endpoint,'PATCH',{expectedRevision:first.revision,payload:{genre:'B'}}),
  ]);
  check('concurrent API writers: one success, one conflict',writes.filter(r=>r.status===200).length===1&&writes.filter(r=>r.status===409).length===1);
  check('conflict includes the current server draft',writes.find(r=>r.status===409)!.body.draft.revision===first.revision+1);
  let latest=store.getDraft(d.id)!;
  let r=await request('/api/express/suggest','POST',{draftId:d.id,stage:'cast',expectedRevision:latest.revision});
  check('nonempty cast gets a separate proposal',r.status===200&&r.body.needsConfirmation===true);
  check('cast proposal does not change stored canon',store.getDraft(d.id)!.payload.cast![0].id==='hero-b'&&store.getDraft(d.id)!.revision===latest.revision);
  check('proposed heroes have canonical ids',!!r.body.payload.cast[0].id&&r.body.payload.cast[0].id!=='hero-b');
  const before=calls;
  r=await request('/api/express/suggest','POST',{draftId:d.id,stage:'synopsis',expectedRevision:1});
  check('stale request is rejected before AI call',r.status===409&&calls===before);
  waitAi=true;
  const began=new Promise<void>(r=>{started=r;});
  const pending=request('/api/express/suggest','POST',{draftId:d.id,stage:'synopsis',expectedRevision:latest.revision});
  await began;
  store.updateDraft(d.id,{seed:'Новіший задум'},latest.revision);
  resolveAi!();
  r=await pending; waitAi=false;
  check('late AI response is rejected',r.status===409);
  check('late AI did not store synopsis',!store.getDraft(d.id)!.payload.synopsis);
  const memory=new Map<string,string>();
  const storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);},removeItem:(k:string)=>{memory.delete(k);}};
  type P={seed?:string;synopsis?:string};
  const start={id:'client',revision:1,step:3,payload:{seed:'початок'}};
  let aiCalled=0;
  let fail=true;
  let apiRevision=1;
  const client=new WizardDraftSession<P>({},async <T,>(url:string,init?:RequestInit)=>{
    if (init?.method==='PATCH') {
      if(fail)throw new Error('Немає мережі');
      const data=JSON.parse(String(init.body));
      assert.equal(data.expectedRevision,apiRevision);
      apiRevision++;
      return {...start,revision:apiRevision,step:data.step,payload:data.payload} as T;
    }
    aiCalled++;
    return {draft:{...start,revision:++apiRevision,payload:{...client.view.payload,synopsis:'новий'}}} as T;
  },storage);
  client.open(start);client.edit({seed:'локальна правка'});
  await assert.rejects(()=>client.flush(4),/Немає мережі/);
  check('failed save blocks forward navigation',client.view.step===3&&client.view.dirty);
  await assert.rejects(()=>client.generate('/ai',{}),/Немає мережі/);
  check('failed save blocks dependent generation',aiCalled===0);
  const restored=new WizardDraftSession<P>({},undefined,storage);
  check('local edit survives reopening before debounce',restored.recover('client')&&restored.view.payload.seed==='локальна правка');
  fail=false;await client.flush(4);
  check('retry saves before navigation',client.view.step===4&&!client.view.dirty&&apiRevision===2);
  client.open(start);
  check('late GET cannot reset a newer revision',client.view.draft!.revision===2);
  client.edit({seed:'наступний'});
  await Promise.all([client.flush(),client.flush()]);
  check('queued saves use current revision without self-conflict',apiRevision===3&&!client.view.dirty);
  let release: (()=>void)|undefined;
  let announce: (()=>void)|undefined;
  const inflight=new Promise<void>(r=>{announce=r;});
  const during=new WizardDraftSession<P>({},async <T,>(_url:string,init?:RequestInit)=>{
    const data=JSON.parse(String(init?.body));
    if(data.expectedRevision===1){announce!();await new Promise<void>(r=>{release=r;});}
    return {...start,revision:data.expectedRevision+1,step:data.step,payload:data.payload} as T;
  },storage);
  during.open(start);during.edit({seed:'перша правка'});
  const saving=during.flush(4);await inflight;
  during.edit({seed:'пізніша правка'});release!();await saving;
  check('edits during an inflight save are flushed before proceeding',during.view.payload.seed==='пізніша правка'&&!during.view.dirty&&during.view.draft!.revision===3);
  const conflict=new WizardDraftSession<P>({},async()=>{throw new WizardApiError('Конфлікт',409,{...start,revision:2,payload:{seed:'інша вкладка'}});},storage);
  conflict.open(start);conflict.edit({seed:'моя копія'});
  await assert.rejects(()=>conflict.flush());
  check('conflict preserves local payload',conflict.view.payload.seed==='моя копія'&&conflict.view.conflict?.revision===2);
  conflict.useServer();
  check('explicit server choice resolves conflict',conflict.view.payload.seed==='інша вкладка'&&!conflict.view.dirty&&!conflict.view.conflict);
  const largePayload={sourceMaterials:[{id:'large-source',kind:'note',title:'Великий документ',text:'Ж'.repeat(40000),approved:true}]};
  const large=new WizardDraftSession<typeof largePayload>({sourceMaterials:[]},async <T,>(_url:string,init?:RequestInit)=>{
    assert.equal(init?.keepalive,false,'large UTF-8 requests must use a normal fetch');
    const body=JSON.parse(String(init?.body));
    return {...start,revision:2,payload:body.payload} as T;
  },storage);
  large.open({...start,payload:{sourceMaterials:[]}});large.edit(largePayload);
  await large.flush(4);
  check('large UTF-8 draft saves without the browser keepalive size failure',!large.view.dirty&&large.view.step===4&&large.view.payload.sourceMaterials[0].text.length===40000);
  const callsAfterLogin:string[]=[];
  const anonymous=new WizardDraftSession<P>({},async <T,>(url:string,init?:RequestInit)=>{
    callsAfterLogin.push(url);
    const input=JSON.parse(String(init?.body));
    if(url.endsWith('/claim')){assert.equal(input.expectedRevision,1);return {...start,userId:'writer',revision:2} as T;}
    assert.equal(input.expectedRevision,2);
    return {draft:{...start,userId:'writer',revision:3}} as T;
  },storage);
  anonymous.open({...start,userId:null});
  await anonymous.generate('/ai',{});
  check('guest-started draft is claimed before authenticated AI',callsAfterLogin.join(',')==='/api/express/claim,/ai'&&anonymous.view.draft!.userId==='writer');
  let anonymousProvider=0;
  const unclaimed=new WizardDraftSession<P>({},async <T,>(url:string)=>{
    if(url.endsWith('/claim'))throw new WizardApiError('Потрібен вхід',401);
    anonymousProvider++;return {} as T;
  },storage);
  unclaimed.open({...start,userId:null});
  await assert.rejects(()=>unclaimed.generate('/ai',{}));
  check('failed claim cannot send private context to provider',anonymousProvider===0&&unclaimed.view.draft!.userId===null);
  console.log('Підсумок: '+passed+' пройшло.');
} finally {
  await new Promise<void>(r=>server.close(()=>r()));
  db.closeDb();
  await fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
