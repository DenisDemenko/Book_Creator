import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve,basename} from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const loadBridgeModule=name=>readFileSync(new URL('../server/'+name+'.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace(/export /g,'');
const source=loadBridgeModule('roomPlanRecognition')+'\n'+loadBridgeModule('roomStudioBridge');
class ImageGenerationError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}
function fixture({plan='pro',status='active',end='2099-01-01',available=true,disabled=false,role='writer'}={}){
 const db=new DatabaseSync(':memory:');let handler,calls=0,visionCalls=0,price=.01,failure,missingMedia=false;
 const engines=Object.fromEntries(['nano-banana-2','nano-banana-pro','nano-banana-2-lite','gpt-image'].map(id=>[id,{id,label:id,modelId:'test-model',maxSize:id==='gpt-image'?'1K':'4K'}]));
 const context={Buffer,Date,console,Number,ImageGenerationError,platformKeyFor:async()=> 'fixture-provider-key',
 ChatProviderError: class extends Error {},generateText:async options=>{
  visionCalls++;assert.equal(options.engine,'gpt');assert.equal(options.images[0].mimeType,'image/jpeg');assert.equal(options.req.principal.id,'studio-owner');assert.equal(options.json,true);
  return {text:JSON.stringify({outline:[[100,100],[900,100],[900,900],[100,900]],partitions:[],openings:[]})};
 },createHash,timingSafeEqual,resolve,basename,GENERATED_DIR:'/unused',IMAGE_ENGINES:engines,listEngines:()=>Object.values(engines).map(e=>({...e,supportsReferenceImages:e.id!=='gpt-image',maxReferenceImages:e.id==='gpt-image'?0:10})),readFile:async()=>{throw Error('Must use media library');},readBridgeSettings:async()=>({key:'fixture-key'}),findUserByFirebaseUid:async uid=>uid==='fixture-uid'?{id:'studio-owner',email:'owner@fixture.invalid',role,disabled}:null,resolveSubscription:async()=>({plan,status,currentPeriodEnd:end}),getDb:()=>db,isAvailable:()=>available,creditsEnabled:()=>true,syncCredits:async()=>({available:200}),priceForImage:()=>price,creditsForCostUsd:usd=>Math.ceil(usd*1000),generateImage:async p=>{calls++;assert.equal(p.req.principal.id,'studio-owner');assert.equal(p.referenceImageUrls.length,1);if(failure)throw failure;return {url:'/api/media/generated-asset',engineId:p.engine,modelId:'test-model'};},assetIdFromUrl:url=>url.split('/').pop(),readAsset:async()=>missingMedia?null:({record:{ownerId:'studio-owner'},bytes:Buffer.from([137,80,78,71])})};
 vm.createContext(context);const register=vm.runInContext(stripTypeScriptTypes(source,{mode:'transform'})+'\nregisterRoomStudioBridge',context);register({post:(_path,fn)=>{handler=fn;}});
 const request=async(action,body={},key='fixture-key')=>{let code=200,data;const res={status:v=>{code=v;return res;},json:v=>{data=v;return res;}};await handler({get:()=>key,params:{action},body:{firebaseUid:'fixture-uid',...body}},res);return {code,data};};
 return {db,request,calls:()=>calls,visionCalls:()=>visionCalls,setPrice:v=>{price=v;},setFail:(error=Error('provider uncertain'))=>{failure=error;},setMissingMedia:v=>{missingMedia=v;}};
}
test('bridge rejects untrusted requests, unknown and disabled accounts',async()=>{const f=fixture();assert.equal((await f.request('access',{},'wrong')).code,403);assert.equal((await f.request('access',{firebaseUid:'other'})).code,403);assert.equal(f.calls(),0);f.db.close();const d=fixture({disabled:true});assert.equal((await d.request('quote')).code,403);d.db.close();});
for(const state of [{plan:'pro',end:'2000-01-01'},{plan:'ultra',status:'canceled'},{plan:'free'}])test('constructor entitlement refuses inactive subscription '+JSON.stringify(state),async()=>{const f=fixture(state);assert.equal((await f.request('access')).data.active,false);f.db.close();});
test('active Pro and Ultra use existing subscription and quotes do not call a paid provider',async()=>{for(const plan of ['pro','ultra']){const f=fixture({plan});assert.equal((await f.request('access')).data.active,true);const quote=await f.request('quote');assert.equal(quote.code,200);assert.equal(quote.data.engines[0].qualifiedStrict,false);assert.equal(quote.data.engines[0].credits,10);assert.equal(f.calls(),0);f.db.close();}});
async function payload(f){const q=(await f.request('quote')).data.engines[0];return {jobKey:'room:'+randomUUID(),prompt:'Keep exact room and product count',engine:q.id,imageSize:q.imageSize,quoteHash:q.quoteHash,maxCredits:q.credits,aspectRatio:'16:9',references:['data:image/png;base64,iVBORw0KGgo=']};}
test('a repeated or concurrent request has one paid provider call and returns stored media',async()=>{const f=fixture(),p=await payload(f);const results=await Promise.all([f.request('generate',p),f.request('generate',p)]);assert(results.some(r=>r.code===200));assert.equal(f.calls(),1);const replay=await f.request('generate',p);assert.equal(replay.code,200);assert(replay.data.image);assert.equal(f.calls(),1);assert.equal((await f.request('result',{jobKey:p.jobKey})).code,200);assert.equal(f.calls(),1);assert.equal((await f.request('generate',{...p,prompt:'different'})).code,409);f.db.close();});
test('a price change, budget cap and external references cannot trigger generation',async()=>{const f=fixture(),p=await payload(f);assert.equal((await f.request('generate',{...p,maxCredits:0})).code,409);assert.equal((await f.request('generate',{...p,references:['https://private.invalid/']})).code,400);f.setPrice(.02);assert.equal((await f.request('generate',p)).code,409);assert.equal(f.calls(),0);f.db.close();});
test('an uncertain provider failure is never retried automatically',async()=>{const f=fixture(),p=await payload(f);f.setFail();assert.equal((await f.request('generate',p)).code,503);assert.equal((await f.request('generate',p)).code,409);assert.equal(f.calls(),1);f.db.close();});
test('the room quote excludes engines without reference inputs', async () => {
  const f = fixture();
  try {
    const quote = await f.request('quote');
    assert(quote.data.engines.some((engine) => engine.id === 'nano-banana-2'));
    assert(!quote.data.engines.some((engine) => engine.id === 'gpt-image'));
    const rejected = await f.request('generate', { ...await payload(f), engine: 'gpt-image' });
    assert.equal(rejected.code, 409);
    assert.equal(f.calls(), 0);
  } finally {
    f.db.close();
  }
});

test('provider quota failures are reported without propagating raw provider data', async () => {
  const f = fixture();
  try {
    const p = await payload(f);
    f.setFail(new ImageGenerationError('quota', 'fixture provider diagnostics'));
    const failed = await f.request('generate', p);
    assert.equal(failed.code, 503);
    assert.match(failed.data.error, /квоту/);
    assert.doesNotMatch(failed.data.error, /fixture provider diagnostics/);
    const status = await f.request('result', { jobKey: p.jobKey });
    assert.equal(status.data.status, 'needs_review');
    assert.equal(status.data.error, failed.data.error);
    assert.equal(f.calls(), 1);
  } finally {
    f.db.close();
  }
});

test('a completed render can be recovered after storage becomes reachable again', async () => {
  const f = fixture();
  try {
    const p = await payload(f);
    f.setMissingMedia(true);
    assert.equal((await f.request('generate', p)).code, 503);
    const unavailable = await f.request('result', { jobKey: p.jobKey });
    assert.equal(unavailable.code, 503);
    assert.match(unavailable.data.error, /тимчасово недоступний/);
    f.setMissingMedia(false);
    const recovered = await f.request('result', { jobKey: p.jobKey });
    assert.equal(recovered.data.status, 'completed');
    assert(recovered.data.image);
    assert.equal(f.calls(), 1);
  } finally {
    f.db.close();
  }
});
test('database outage fails closed before paid work',async()=>{const f=fixture({available:false});assert.equal((await f.request('access')).code,503);assert.equal(f.calls(),0);f.db.close();});

test('plan recognition accepts only a bounded JPEG from the trusted marketplace',async()=>{
 const f=fixture(),image='/9j/fixtureJpeg';
 assert.equal((await f.request('recognize-plan',{image},'wrong')).code,403);
 assert.equal((await f.request('recognize-plan',{image:'https://example.invalid/plan.jpg'})).code,400);
 assert.equal(f.visionCalls(),0);
 const plan=await f.request('recognize-plan',{image});
 assert.equal(plan.code,200);
 assert.equal(plan.data.outline.length,4);
 assert.equal(f.visionCalls(),1);
 assert.equal(f.calls(),0);
 f.db.close();
});

test('room plan recognition allows active Pro and Ultra plus verified administrators', async () => {
  const image = '/9j/fixtureJpeg';
  for (const [account, bridgeBody] of [
    [{ plan: 'pro' }, {}],
    [{ plan: 'ultra' }, {}],
    [{ plan: 'free', role: 'admin' }, {}],
    [{ plan: 'free' }, { marketplaceAdmin: true }],
  ]) {
    const f = fixture(account);
    try {
      assert.equal((await f.request('recognize-plan', { image, ...bridgeBody })).code, 200);
      assert.equal(f.visionCalls(), 1);
    } finally {
      f.db.close();
    }
  }
});

test('room plan recognition denies expired, inactive, free and disabled accounts before vision', async () => {
  const image = '/9j/fixtureJpeg';
  for (const [account, bridgeBody] of [
    [{ plan: 'free' }, {}],
    [{ plan: 'pro', end: '2000-01-01' }, {}],
    [{ plan: 'ultra', status: 'canceled' }, {}],
    [{ plan: 'free' }, { marketplaceAdmin: 'true', role: 'admin' }],
    [{ plan: 'free', role: 'admin', disabled: true }, { marketplaceAdmin: true }],
  ]) {
    const f = fixture(account);
    try {
      assert.equal((await f.request('recognize-plan', { image, ...bridgeBody })).code, 403);
      assert.equal(f.visionCalls(), 0);
    } finally {
      f.db.close();
    }
  }
  const f = fixture({ plan: 'free' });
  try {
    assert.equal((await f.request('recognize-plan', { image, marketplaceAdmin: true }, 'wrong')).code, 403);
    assert.equal(f.visionCalls(), 0);
  } finally {
    f.db.close();
  }
});
