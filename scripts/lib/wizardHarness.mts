/** Isolated real SQLite/routes. Only identity, external AI and web responses are fixtures. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type {AddressInfo} from 'node:net';
export async function wizardHarness(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wizard-scenarios-'));
 process.env.DATA_DIR=dir;process.env.DATABASE_PATH=path.join(dir,'test.db');
 const db=await import('../../server/db');if(!await db.initDb())throw new Error('SQLite fixture failed');
 const store=await import('../../server/expressStore');
 const media=await import('../../server/media/mediaLibraryStore');
 const {registerExpressRoutes}=await import('../../server/expressRoutes');
 const {registerMediaRoutes}=await import('../../server/mediaRoutes');
 const {importTechnicalUrl,searchTechnicalResources}=await import('../../server/technicalSources');
 const state={calls:[] as Array<{label:string;system:string;prompt:string}>,descriptions:0,worldDescriptions:0,badCitation:false,badCharacter:false,beforeReply:null as null|(()=>Promise<void>)};
 const app=express();
 app.use((q,_r,next)=>{if(q.url.startsWith('/studio/api/'))q.url=q.url.slice('/studio'.length);next();});
 app.use(express.json({limit:'12mb'}));
 app.use((q,_r,next)=>{
  const id=String(q.headers['x-test-user']??'writer');
  q.principal={id:id==='guest'?null:id,email:id+'@example.test',name:'Автор тесту',role:id==='no-ai'?'guest':'writer',isGuest:['guest','disabled'].includes(id)} as any;next();
 });
 app.get('/api/express/engines',(_q,r)=>r.json({engines:[{engine:'openai',modelId:'fixture-model',source:'platform'}]}));
 app.get('/api/chat/models',(_q,r)=>r.json({models:[{id:'fixture-vision',label:'Тестова модель із зором',available:true,vision:true}]}));
 const sourceId=(prompt:string)=>{const m=prompt.match(/"id":"([^"]+)"/);return m?.[1]??'source-one';};
 registerExpressRoutes(app,{
  ask:async(req,label,system,prompt)=>{
   state.calls.push({label,system,prompt});await state.beforeReply?.();
   const draft=store.getDraft(req.body?.draftId??'');
   let payload:any;
   if(label.includes('Інструкція')){
    const sources=(draft?.payload.sourceMaterials??[]).filter(s=>s.approved);
    payload={title:'Інструкція T-42',modelCode:'T-42 rev.1',description:'Монтаж панелі за документацією',materials:[{code:'A',name:'Панель',qty:'1'}],tools:['Ручний інструмент із документації'],warnings:['Перевірити фіксацію перед навантаженням'],steps:[{title:'З’єднати A та B',description:'Вставте панель A у кронштейн B згідно з джерелом.',components:'A, B',toolsResources:'За документацією',warning:'Уточнити допустиме навантаження',successCriterion:'Обидва фіксатори задіяні',sourceIds:[state.badCitation?'invented':sources[0]?.id??sourceId(prompt)],needsVerification:true}],finalChecks:['Перевірити фіксатори'],questions:['Уточнити допустиме навантаження у виробника']};
   }else if(label.includes('частина')){
    const n=Number(label.match(/частина (\d+)/)?.[1]??1);
    payload={partNumber:n,partTitle:'Частина '+n,chapters:[{chapterNumber:99,chapterTitle:'Глава '+n,summary:'Марта зберігає майстерню та робить наступний вибір.',involvedCharacterIds:state.badCharacter?['unknown']:(draft?.payload.cast??[]).map(c=>c.id),sourceIds:(draft?.payload.sourceMaterials??[]).filter(s=>s.approved).map(s=>s.id),choices:draft?.payload.entryMode==='labyrinth'?[{label:'Ліворуч',destination:'Майстерня',consequence:'Зустріч'}]:[]}]};
   }else if(label.includes('синопсис'))payload={synopsis:'Марта захищає майстерню. '+(draft?.payload.scenarioInputs?Object.values(draft.payload.scenarioInputs).join(' '):'')};
   else if(label.includes('загальний план'))payload={compositionPlan:'Частина 1: зав’язка. Частина 2: наслідки. Частина 3: завершення.'};
   else if(label.includes('каст'))payload={cast:[{firstName:'Марта',lastName:'Лісова',poltiRoleName:'Головна героїня'}]};
   else payload={framework:'psychotypes',rationale:'Причинний розвиток зіткнення характерів'};
   return {text:JSON.stringify(payload),engine:'fixture',source:'platform' as const};
  },
  world:{analyze:async()=>{state.worldDescriptions++;await state.beforeReply?.();return JSON.stringify({visible:'Кам’яна вежа, вузьке вікно та зелений схил.',creative:'Вигадка: вітер приносить дзвін.',unknown:'Історія, звуки та запахи невідомі.'});}},
  sources:{
   describe:async()=>{state.descriptions++;await state.beforeReply?.();return 'Видно зелений плащ, коротке темне волосся. Інші деталі невідомі.';},
   importUrl:raw=>importTechnicalUrl(raw,async url=>({url,mimeType:'text/html',bytes:Buffer.from('<title>T-42 manual</title><main><p>Fit panel A into bracket B. Check both clips.</p></main>')})),
   search:(query,domain)=>searchTechnicalResources(query,domain,async url=>({url,mimeType:'application/rss+xml',bytes:Buffer.from('<rss><channel><item><title>T-42 manufacturer manual</title><link>https://manufacturer.example/t42</link><description>Assembly documentation</description></item></channel></rss>')})),
  },
 });
 registerMediaRoutes(app);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 async function request(url:string,method='GET',data?:unknown,user='writer'){
  const r=await fetch(origin+url,{method,headers:{'content-type':'application/json','x-test-user':user},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:r.status,body:await r.json()};
 }
 return {app,server,origin,dir,db,store,media,state,request,async close(){
  server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.closeDb();await fs.rm(dir,{recursive:true,force:true,maxRetries:3});
 }};
}
