import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository';
import { PgCoreRepository } from '../server/core/pgRepository';
import { createCorePool } from '../server/core';
import { loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate';
import type { CoreRepository } from '../server/core/types';
import { renameTranslatedTerm, validateTranslation } from '../server/core/translation';
import { computeEffective } from '../server/core/collaboration/access';
const testDir=await fs.mkdtemp(path.join(os.tmpdir(),'book-translation-'));
process.env.DATA_DIR=testDir;
process.env.DATABASE_PATH=path.join(testDir,'test.db');
const {registerTranslationRoutes}=await import('../server/core/translationRoutes');
const {saveBook}=await import('../server/bookStore');

async function suite(repo:CoreRepository) {
 let passed=0;
 const check=(name:string,fn:()=>void)=>{fn();passed++;console.log(`✓ ${name}`);};
 const P=`translation-${randomUUID()}`;
 await repo.upsertProject({id:P,ownerId:'owner',title:'Переклад'});
 await repo.upsertDocument({projectId:P,id:'ch',kind:'chapter',order:0});
 await repo.upsertDocument({projectId:P,id:'s',parentId:'ch',kind:'section',order:0});
 await repo.upsertDocument({projectId:P,id:'secret',parentId:'ch',kind:'section',order:1});
 for(const [id,documentId,text,order] of [['p1','s','[/character:Сергій] мовчить.',0],['p2','s','Сергій знайшов доказ.',1],['hidden','secret','Прихований абзац.',0]] as const) await repo.upsertParagraph({projectId:P,id,documentId,text,order,kind:'paragraph'},'system:core_sync');
 const hero=await repo.createEntity({projectId:P,type:'character',name:'Сергій',createdBy:'user:owner',status:'confirmed',canonical:{speech:'Короткі стримані речення'}});
 await repo.replaceParagraphMentions(P,'p1',[{entityId:hero.id,spanStart:0,spanEnd:21,source:'author',status:'confirmed'}]);
 const originalHashes=(await repo.listAllParagraphs(P)).map(p=>p.textHash);
 const app=express();app.use(express.json());app.use((req,_res,next)=>{const user=String(req.headers['x-user']??'guest');req.principal={id:user==='guest'?null:user,isGuest:user==='guest',role:user==='admin'?'admin':'writer'} as any;next();});
 let lastContext:any;
 const access={getBookOwnerId:async(id:string)=>id===P?'owner':null,getCollabOwnerId:async()=>undefined,listAcceptedInvites:async()=>[{acceptedUserId:'translator',role:'translator'},{acceptedUserId:'reader',role:'reader'}],effectiveAccess:async({projectId,userId}:{projectId:string;userId:string})=>{
   if(!['translator','reader'].includes(userId))return null;
   const e=computeEffective(projectId,userId,[],{full:false});e.scenes.s=userId==='translator'?'edit':'view';e.restricted=true;e.canWriteAny=userId==='translator';return e;
 }};
 registerTranslationRoutes(app,{repo:()=>repo,access,generate:async(_req,context)=>{lastContext=context;return String(context.source).replace('мовчить.','is silent.').replace('Сергій',context.glossary[0]?.target??'Сергій');}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const base=`${origin}/api/core/projects/${P}/translation`;
 const req=async(user:string,path='',method='GET',body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'x-user':user,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body: r.headers.get('Content-Type')?.includes('json')?await r.json():await r.text()};};
 const get=async()=> (await req('owner','?language=en')).body;
 const input=async(id:string,text:string,status='draft')=>{const s=await get(),p=s.paragraphs.find(p=>p.paragraphId===id);return{paragraphId:id,language:'en',sourceLanguage:'uk',text,status,expectedRevision:s.revision,sourceHash:p.sourceHash,glossaryHash:p.glossaryHash};};
 try {
  check('ключі тегів не перекладаються',()=>assert.throws(()=>validateTranslation('[/character:Сергій]','[/hero:Сергій]',[])));
  check('зниклий тег відхилено',()=>assert.throws(()=>validateTranslation('[/character:Сергій]','Serhii',[])));
  check('зайвий тег відхилено',()=>assert.throws(()=>validateTranslation('Текст','[/character:Сергій]',[])));
  check('без глосарія значення тегу зберігається',()=>assert.throws(()=>validateTranslation('[/character:Сергій]','[/character:Serhii]',[])));
  check('перейменування не псує ключ або довший термін',()=>assert.equal(renameTranslatedTerm('[/Serhii:Serhii] Serhii SerhiiX','Serhii','Sergiy'),'[/Serhii:Sergiy] Sergiy SerhiiX'));
  const guest=await req('guest');check('гість — 401',()=>assert.equal(guest.status,401));
  assert.equal((await req('stranger')).status,403);passed++;console.log('✓ сторонній — 403');
  let data=await get();const glossary=await req('owner','/glossary','PUT',{language:'en',source:'Сергій',target:'Serhii',entityId:hero.id,expectedRevision:data.revision});
  check('глосарій прив’язує переклад до тієї самої сутності',()=>{assert.equal(glossary.status,200);assert.equal(glossary.body.entry.entityId,hero.id);});
  const alias=await repo.resolveAlias(P,'character','Serhii');check('перекладений тег вирішується в ту саму сутність',()=>assert.equal(alias,hero.id));
  data=(await req('reader')).body;check('читач бачить лише дозволені абзаци',()=>{assert.equal(data.paragraphs.length,2);assert.ok(!JSON.stringify(data).includes('Прихований'));});
  assert.equal((await req('reader','/paragraphs/p1','PUT',await input('p1','[/character:Serhii] is silent.'))).status,403);passed++;console.log('✓ читач не записує');
  assert.equal((await req('translator','/paragraphs/hidden','PUT',await input('hidden','Secret.'))).status,403);passed++;console.log('✓ перекладач не записує чужу сцену');
  assert.equal((await req('translator','/paragraphs/p1','PUT',await input('p1','[/character:Serhii] is silent.','approved'))).status,403);passed++;console.log('✓ перекладач не затверджує');
  assert.equal((await req('translator','/glossary','PUT',{language:'en',source:'А',target:'A',expectedRevision:data.revision})).status,403);passed++;console.log('✓ перекладач не затверджує глосарій');
  const generated=await req('owner','/generate','POST',{paragraphId:'p1',language:'en',sourceLanguage:'uk'});
  check('AI отримує затверджений профіль і глосарій',()=>{assert.equal(generated.status,200);assert.equal(lastContext.profiles[0].canonical.speech,'Короткі стримані речення');assert.equal(lastContext.glossary[0].target,'Serhii');});
  const before=await repo.getTranslationWorkspace(P);
  check('AI-пропозиція не пише й не затверджує переклад',()=>assert.equal(before.records.length,0));
  const scopedAI=await req('translator','/generate','POST',{paragraphId:'p1',language:'en',sourceLanguage:'uk'});
  check('сценовий доступ не відкриває приватні профілі моделі',()=>{assert.equal(scopedAI.status,200);assert.equal(lastContext.profiles.length,0);});
  const write=await input('p1','[/character:Serhii] is silent.');
  const concurrent=await Promise.all([req('translator','/paragraphs/p1','PUT',write),req('translator','/paragraphs/p1','PUT',write)]);
  check('одночасні записи: один прийнятий, другий — 409',()=>assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]));
  assert.equal((await req('owner','/paragraphs/p1','PUT',await input('p1','[/character:Serhii] is silent.','approved'))).status,200);
  assert.equal((await req('owner','/paragraphs/p2','PUT',await input('p2','Serhii found evidence.','approved'))).status,200);
  assert.equal((await req('owner','/paragraphs/hidden','PUT',await input('hidden','Hidden paragraph.','approved'))).status,200);
  const exported=await req('owner','/export');check('експорт затвердженого перекладу',()=>{assert.equal(exported.status,200);assert.match(exported.body,/Serhii found evidence/);});
  const old=await get();const rename=await req('owner','/glossary','PUT',{id:glossary.body.entry.id,language:'en',source:'Сергій',target:'Sergiy',entityId:hero.id,expectedRevision:old.revision});
  check('зміна імені знаходить усі входження та пропонує оновлення',()=>{assert.equal(rename.body.proposals.length,2);assert.match(rename.body.proposals[0].text,/Sergiy/);});
  data=await get();check('глосарій позначає переклад для оновлення',()=>assert.ok(data.paragraphs.every(p=>p.needsUpdate)));
  check('пропозиції не переписали текст без підтвердження',()=>assert.match(data.paragraphs.find(p=>p.paragraphId==='p1').current.text,/Serhii/));
  assert.equal((await req('owner','/export')).status,409);passed++;console.log('✓ застарілий переклад не експортується');
  assert.equal((await req('owner','/paragraphs/p1','PUT',{...write,status:'approved',expectedRevision:data.revision})).status,409);passed++;console.log('✓ старий глосарій не приймається при затвердженні');
  for(const proposal of rename.body.proposals)assert.equal((await req('owner',`/paragraphs/${proposal.paragraphId}`,'PUT',await input(proposal.paragraphId,proposal.text,'approved'))).status,200);
  const history=(await get()).paragraphs.find(p=>p.paragraphId==='p1').versions;
  check('нове ім’я — нова версія, старий переклад збережено',()=>{assert.equal(history.length,3);assert.match(history[0].text,/Serhii/);assert.match(history[2].text,/Sergiy/);});
  const staleSource=await input('p1','[/character:Sergiy] is silent.','approved');
  await repo.upsertParagraph({projectId:P,id:'p1',documentId:'s',order:0,kind:'paragraph',text:'[/character:Сергій] більше не мовчить.'},'user:owner');
  assert.equal((await req('owner','/paragraphs/p1','PUT',staleSource)).status,409);passed++;console.log('✓ зміна оригіналу під час редагування — 409');
  data=await get();check('зміна оригіналу позначає переклад для оновлення',()=>assert.equal(data.paragraphs.find(p=>p.paragraphId==='p1').needsUpdate,true));
  const unchangedHero=await repo.getEntity(P,hero.id);
  check('переклад не змінював канон',()=>assert.deepEqual(unchangedHero?.canonical,{speech:'Короткі стримані речення'}));
  assert.deepEqual((await repo.listAllParagraphs(P)).filter(p=>p.id!=='p1').map(p=>p.textHash),originalHashes.slice(1));
  // Legacy import: separate aligned scene, no tag guesswork.
  await repo.upsertDocument({projectId:P,id:'legacy',parentId:'ch',kind:'section',order:2});
  await repo.upsertParagraph({projectId:P,id:'legacy-p',documentId:'legacy',order:0,kind:'paragraph',text:'Привіт.'},'system:core_sync');
  await saveBook({ownerId:'owner',book:{id:P,chapters:[{id:'ch',sections:[{id:'legacy',content:'Привіт.',contentEn:'Hello.'}]}]}});
  const imported=await req('owner','/import-legacy','POST',{expectedRevision:(await get()).revision});
  check('contentEn імпортовано як en-чернетку зі стабільним ID',()=>{assert.equal(imported.body.imported,1);});
  const again=await req('owner','/import-legacy','POST',{expectedRevision:(await get()).revision});check('повторний імпорт не переписує переклади',()=>assert.equal(again.body.imported,0));
  const latest=await get();
  const renameRace=await Promise.all(['Sergiy-A','Sergiy-B'].map(target=>req('owner','/glossary','PUT',{id:glossary.body.entry.id,language:'en',source:'Сергій',target,entityId:hero.id,expectedRevision:latest.revision})));
  check('одночасне затвердження глосарія: лише одне прийнято',()=>assert.deepEqual(renameRace.map(r=>r.status).sort(),[200,409]));
  const winner=renameRace.find(r=>r.status===200)!.body.entry.target;
  const loser=winner==='Sergiy-A'?'Sergiy-B':'Sergiy-A';
  const losingAlias=await repo.resolveAlias(P,'character',loser);
  check('відхилений глосарій не залишив псевдоніма в каноні',()=>assert.equal(losingAlias,null));
  const badTag=await req('owner','/paragraphs/p2','PUT',await input('p2','[/character:Injected] text'));
  check('API відхиляє доданий моделлю тег',()=>assert.equal(badTag.status,400));
  const badLanguage=await req('owner','?language=english');check('невірний код мови — 400',()=>assert.equal(badLanguage.status,400));
  if(process.argv.includes('--browser')) {
    const {build}=await import('esbuild');const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{TranslationPage}from'./src/components/TranslationPage';createRoot(document.getElementById('root')).render(React.createElement(TranslationPage,{book:{id:${JSON.stringify(P)}}}));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser'});
    const cssFiles=(await fs.readdir('dist/assets')).filter(name=>name.endsWith('.css'));
    const css=(await Promise.all(cssFiles.map(name=>fs.readFile(path.join('dist/assets',name),'utf8')))).join('\n');
    app.get('/probe.css',(_q,r)=>r.type('text/css').send(css));
    app.get('/probe.js',(_q,r)=>r.type('application/javascript').send(bundle.outputFiles[0].text));app.get('/probe',(_q,r)=>r.send('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/probe.css"><div id="root" style="padding:16px;background:#0f172a;color:white"></div><script src="/probe.js"></script>'));
    const puppeteer=await import('puppeteer-core');const browser=await puppeteer.default.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    try {const page=await browser.newPage();await page.setExtraHTTPHeaders({'x-user':'owner'});await page.goto(origin+'/probe');await page.waitForSelector('[aria-label="Абзац перекладу"]');await page.select('[aria-label="Абзац перекладу"]','legacy-p');await page.waitForFunction(()=>document.querySelector('textarea')?.value==='Hello.');await page.click('textarea');await page.type('textarea',' Again.');const buttons=await page.$$('button');for(const b of buttons){if(await b.evaluate(e=>e.textContent)==='Затвердити переклад'){await b.click();break;}}await page.waitForFunction(()=>document.body.textContent?.includes('Версія 2'));await page.setViewport({width:390,height:844});await page.screenshot({path:`/tmp/translation-${repo.kind}.png`,fullPage:true});
      const uiText=await page.$eval('[data-translation-page]',e=>e.textContent);
      check('БРАУЗЕР: оригінал поруч, редагування, затвердження й історія',()=>{assert.match(uiText!,/Привіт/);assert.match(uiText!,/Версія 2/);});
      for(const b of await page.$$('button')){if(await b.evaluate(e=>e.textContent)==='Змінити'){await b.click();break;}}
      await page.click('[aria-label="Переклад терміна"]',{clickCount:3});await page.keyboard.press('Backspace');await page.type('[aria-label="Переклад терміна"]','Sergey');
      for(const b of await page.$$('button')){if(await b.evaluate(e=>e.textContent)==='Затвердити термін'){await b.click();break;}}
      await page.waitForFunction(()=>document.body.textContent?.includes('Пропозиції узгодження: 2'));
      const suggestions=await page.$eval('[data-translation-page]',e=>e.textContent);
      check('БРАУЗЕР: зміна глосарія показує обидва входження й пропозиції',()=>assert.match(suggestions!,/Sergey/));
      const fitsPhone=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);
      check('БРАУЗЕР: телефон без горизонтального прокручування',()=>assert.equal(fitsPhone,true));
      await page.screenshot({path:`/tmp/translation-${repo.kind}.png`,fullPage:true});
    } finally {await browser.close();}
  }
  console.log(`Підсумок ${repo.kind}: ${passed} пройшло.`);
 } finally {await new Promise<void>(r=>server.close(()=>r()));}
}
try {
 await suite(new MemoryCoreRepository());
 if(process.env.CORE_TEST_DATABASE_URL){const pool=createCorePool(process.env.CORE_TEST_DATABASE_URL);try{await runMigrations(pool,loadMigrations(resolveMigrationsDir()));await suite(new PgCoreRepository(pool));}finally{await pool.end();}}else console.log('PostgreSQL пропущено: немає CORE_TEST_DATABASE_URL.');
} finally {await fs.rm(testDir,{recursive:true,force:true});}
