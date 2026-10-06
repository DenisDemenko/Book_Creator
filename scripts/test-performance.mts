import express from 'express';
import type {AddressInfo} from 'node:net';
import {registerQualityRoutes} from '../server/core/quality/qualityRoutes';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryCoreRepository} from '../server/core/memoryRepository';
import {PgCoreRepository} from '../server/core/pgRepository';
import type {CoreRepository} from '../server/core/types';
import {createCorePool} from '../server/core';
import {loadMigrations,resolveMigrationsDir,runMigrations} from '../server/core/migrate';
import {buildCharacterProfile} from '../server/core/characterProfile';
import {buildCharacterSnapshot} from '../server/core/characterSnapshot';
import {performanceReport,metric} from '../server/core/performance';
import {SceneTokenBudget,scheduleScene} from '../server/core/sceneScheduler';
import {cachedRead} from '../server/core/readCache';
async function suite(repo:CoreRepository){
 let n=0;const check=(title:string,fn:()=>void)=>{fn();n++;console.log('✓ '+title);};
 const p='perf-'+randomUUID(),actor='user:performance' as const;
 await repo.upsertProject({id:p,title:'Тест кешу',ownerId:'performance'});
 const hero=await repo.createEntity({projectId:p,type:'character',name:'Олена',status:'confirmed',createdBy:actor});
 await repo.upsertDocument({projectId:p,id:'chapter',kind:'chapter',parentId:null,order:0,title:'Глава'});
 for(const [order,id] of ['past','now','future'].entries()){await repo.upsertDocument({projectId:p,id,kind:'section',parentId:'chapter',order,title:id});await repo.upsertParagraph({projectId:p,id:'para-'+id,documentId:id,order:0,kind:'paragraph',text:'Події '+id},actor);}
 const before=performanceReport().totals.profile_build;
 const a=await buildCharacterProfile(repo,p,hero.id);const b=await buildCharacterProfile(repo,p,hero.id);
 check('повторний профіль без повторної побудови',()=>{assert.deepEqual(a,b);assert.equal(performanceReport().totals.profile_build,before+1);});
 (b as any).entity.name='підміна';check('клієнтська копія не змінює кеш',()=>assert.equal(a!.entity.name,'Олена'));
 const revision=(await repo.getProject(p))!.revision;
 await repo.updateEntity(p,hero.id,{name:'Олена після правки'},actor);
 const edited=await buildCharacterProfile(repo,p,hero.id);check('інвалідація канону без bump ревізії',()=>{assert.equal((edited as any).entity.name,'Олена після правки');});assert.equal((await repo.getProject(p))!.revision,revision);
 const request={projectId:p,characterId:hero.id,sceneId:'now',situation:'зустріч',allowedActions:['answer','silence']};
 const builds=performanceReport().totals.snapshot_build;const snapshot=await buildCharacterSnapshot(repo,request);const again=await buildCharacterSnapshot(repo,request);
 check('знімок повторно використано за героєм, часом і ревізією',()=>{assert.deepEqual(snapshot,again);assert.equal(performanceReport().totals.snapshot_build,builds+1);});
 const profileBuilds=performanceReport().totals.profile_build;await buildCharacterSnapshot(repo,{...request,simulationId:'another-run'});check('новий прогін незмінної сцени не перебудовує профіль',()=>assert.equal(performanceReport().totals.profile_build,profileBuilds));
 await repo.upsertParagraph({projectId:p,id:'para-past',documentId:'past',order:0,kind:'paragraph',text:'Змінений доказ'},actor);
 await buildCharacterSnapshot(repo,request);check('правка доказу інвалідує знімок',()=>assert.equal(performanceReport().totals.snapshot_build,builds+3));
 await buildCharacterSnapshot(repo,{...request,sceneId:'future'});check('час сцени має окремий ключ',()=>assert.equal(performanceReport().totals.snapshot_build,builds+4));
 await repo.bumpProjectRevision(p);await buildCharacterSnapshot(repo,request);check('нова ревізія має окремий ключ',()=>assert.equal(performanceReport().totals.snapshot_build,builds+5));
 let calls=0;const results=await Promise.all(Array.from({length:8},()=>cachedRead(repo,'profile',['single',p],async tracked=>{calls++;await tracked.getEntity(p,hero.id);return {ok:true};})));
 check('одночасна підготовка не дублює побудову',()=>{assert.equal(calls,1);assert.equal(results.length,8);});
 await assert.rejects(()=>cachedRead(repo,'profile',['vault',p],async tracked=>tracked.getSecretVault(p)));check('Vault ніколи не є джерелом кешу',()=>{});
 const budget=new SceneTokenBudget(100);budget.reserve('hello',{x:1},20);assert.throws(()=>budget.reserve('x'.repeat(100),{},20));check('бюджет блокує виклик до звернення до провайдера',()=>{});
 const order:number[]=[];await Promise.all([scheduleScene(p,async()=>{order.push(1);await Promise.resolve();order.push(2);}),scheduleScene(p,async()=>{order.push(3);})]);check('ходи одного проєкту виконуються послідовно',()=>assert.deepEqual(order,[1,2,3]));
 await assert.rejects(()=>scheduleScene(p,async()=>{throw new Error('private canary');}));await scheduleScene(p,async()=>{});check('збій не блокує наступну задачу',()=>{});
 let release!:()=>void;const hold=new Promise<void>(r=>release=r);const jobs=Array.from({length:16},()=>scheduleScene(p,()=>hold));await assert.rejects(()=>scheduleScene(p,async()=>{}));release();await Promise.all(jobs);check('черга обмежена й звільняє місця',()=>{});
 metric('cost_usd',.01);metric('tokens',100);metric('tokens',NaN);metric('tokens',-1);metric('private canary' as any,5);
 check('метрики містять лише дозволені числа, без приватного тексту',()=>{const report=performanceReport();assert.ok(report.totals.tokens>=100);assert.ok(!JSON.stringify(report).includes('private canary'));assert.ok(report.latency.p95Ms!>=0);});
 const app=express();registerQualityRoutes(app,{repo:()=>repo,requireAdmin:(req,res,next)=>{if(req.headers['x-role']==='reader'||req.headers['x-role']==='guest'){res.status(403).json({error:'Недостатньо прав'});return;}next();},makeDeps:async()=>{throw new Error('Not used');}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  for(const role of ['guest','reader']){const response=await fetch(origin+'/api/admin/quality/performance',{headers:{'x-role':role}});check('метрики закриті для '+role,()=>assert.equal(response.status,403));}
  const response=await fetch(origin+'/api/admin/quality/performance');const report=await response.json();check('адмін API має числові метрики без секретів',()=>{assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(report.totals.snapshot_hit>0);assert.ok(!JSON.stringify(report).includes(p));});
  if(process.argv.includes('--browser')){
   const {build}=await import('esbuild');const output=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AdminQualityView}from'./src/components/AdminQualityView';createRoot(document.getElementById('root')).render(React.createElement(AdminQualityView));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser'});app.get('/probe.js',(_q,r)=>r.type('application/javascript').send(output.outputFiles[0].text));app.get('/probe',(_q,r)=>r.send('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/probe.js"></script>'));
   const puppeteer=await import('puppeteer-core');const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{const page=await browser.newPage();await page.setViewport({width:390,height:844});await page.goto(origin+'/probe');await page.waitForSelector('[data-performance-metrics]');const shown=await page.$eval('[data-performance-metrics]',e=>e.textContent);check('БРАУЗЕР: метрики кешу, токенів і затримки видимі в адмінці',()=>{assert.ok(shown.includes('snapshot_hit'));assert.ok(shown.includes('cost_usd'));assert.ok(shown.includes('p95'));assert.ok(!shown.includes('private canary'));});await page.screenshot({path:`/tmp/t42-performance-${repo.kind}.png`,fullPage:true});}finally{await browser.close();}
  }
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
 console.log(`${repo.kind}: ${n} перевірок продуктивності пройшло.`);
}
await suite(new MemoryCoreRepository());if(process.env.CORE_TEST_DATABASE_URL){const pool=createCorePool(process.env.CORE_TEST_DATABASE_URL);try{await runMigrations(pool,loadMigrations(resolveMigrationsDir()));await suite(new PgCoreRepository(pool));}finally{await pool.end();}}
