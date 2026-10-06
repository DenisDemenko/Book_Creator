import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository';
import type { CoreRepository } from '../server/core/types';
import { computeEffective, makeEffectiveResolver, grantAccess, revokeAccess } from '../server/core/collaboration/access';
import { shapeRoomEvent } from '../server/core/collaboration/accessView';
import type { RealtimeAccessDeps } from '../server/realtimeAuth';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t31-workspace-'));
process.env.DATA_DIR=dir;process.env.DATABASE_PATH=path.join(dir,'book.db');
const db=await import('../server/db'); await db.initDb();
const store=await import('../server/bookStore');
const {registerCollaborationWorkspaceRoutes}=await import('../server/core/collaboration/workspaceRoutes');
const {registerSourceRoutes}=await import('../server/core/collaboration/sourceRoutes');
const {registerParticipantRoutes}=await import('../server/core/collaboration/routes');
const projects:string[]=[];
let passed=0;const check=(label:string,valid:boolean)=>{if(!valid)throw new Error(label);passed++;console.log(`✓ ${label}`);};
async function suite(repo:CoreRepository,name:string,browser=false) {
  const id=`T31-${randomUUID()}`;projects.push(id);
  await repo.upsertProject({id,ownerId:'owner',title:'Співпраця'});
  const hero=await repo.createEntity({projectId:id,type:'character',name:'Герой',externalRef:'studio:character:c1',createdBy:'user:owner'});
  for(const userId of ['editor','viewer','commenter','hidden']) await repo.upsertParticipant({projectId:id,userId,source:'manual',createdBy:'user:owner'});
  const index=new Map([['ch',['s1','s2']]]);const granter={userId:'owner',isOwner:true,isAdmin:false};
  const editorGrant=await grantAccess(repo,{projectId:id,granter,userId:'editor',scopeType:'scene',scopeRef:'s1',level:'edit',bookIndex:index});
  await grantAccess(repo,{projectId:id,granter,userId:'viewer',scopeType:'scene',scopeRef:'s1',level:'view',bookIndex:index});
  await grantAccess(repo,{projectId:id,granter,userId:'commenter',scopeType:'scene',scopeRef:'s1',level:'comment',bookIndex:index});
  await grantAccess(repo,{projectId:id,granter,userId:'hidden',scopeType:'scene',scopeRef:'s2',level:'edit',bookIndex:index});
  await store.saveBook({ownerId:'owner',book:{id,title:'Співпраця',characters:[{id:'c1',name:'Герой'}],illustrations:[{id:'image',title:'Малюнок'}],chapters:[{id:'ch',title:'Розділ',sections:[{id:'s1',title:'Сцена',content:'Початок',paragraphIds:['p1']},{id:'s2',title:'Прихована сцена',content:'ПРИХОВАНИЙ ТЕКСТ'}]}]}});
  await repo.upsertDocument({projectId:id,id:'ch',kind:'chapter',parentId:null,order:0,title:'Розділ'});
  for(const sid of ['s1','s2']) {await repo.upsertDocument({projectId:id,id:sid,kind:'section',parentId:'ch',order:0,title:sid});await repo.upsertParagraph({projectId:id,id:sid==='s1'?'p1':'p2',documentId:sid,order:0,kind:'paragraph',text:sid==='s1'?'Початок':'ПРИХОВАНИЙ АБЗАЦ'},'user:owner');}
  const access:RealtimeAccessDeps={getBookOwnerId:async p=>(await store.getBook(p))?.ownerId,getCollabOwnerId:async()=>undefined,listAcceptedInvites:async()=>[],effectiveAccess:makeEffectiveResolver(()=>repo,()=> 'ready')};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{const user=String(req.headers['x-user']||'guest');req.principal={id:user==='guest'?null:user,role:user==='admin'?'admin':'writer',isGuest:user==='guest'} as any;next();});
  registerCollaborationWorkspaceRoutes(app,{access,repo:()=>repo});registerSourceRoutes(app,{access,repo:()=>repo});
  registerParticipantRoutes(app,{access,repo:()=>repo,bookOutline:async()=>({chapters:[{id:'ch',title:'Розділ',sections:[{id:'s1',title:'Сцена'},{id:'s2',title:'Прихована сцена'}]}]})});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,base=`/api/core/projects/${id}`;
  const call=async(user:string,suffix='',method='GET',body?:unknown)=>{const res=await fetch(origin+base+'/collaboration'+suffix,{method,headers:{'x-user':user,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:res.status,body:await res.json()};};
  const scene={kind:'scene',id:'s1',chapterId:'ch'};const secret={kind:'scene',id:'s2',chapterId:'ch'};
  const comment=(user:string,target=scene,text='Коментар')=>call(user,'/items','POST',{kind:'comment',target,text});
  const task=(assigneeId='editor',target=scene,more={})=>call('owner','/items','POST',{kind:'task',target,text:'Перевірити сцену',assigneeId,dueAt:'2026-10-07T12:00:00Z',...more});
  console.log(`\n${name}`);
  try {
    check('гість 401',(await call('guest')).status===401);check('чужий 403',(await call('stranger')).status===403);
    check('переглядач не коментує',(await comment('viewer')).status===403);
    check('коментатор може коментувати',(await comment('commenter')).status===201);
    check('обмежений не коментує приховану сцену',(await comment('editor',secret)).status===403);
    const closed=await comment('owner',secret,'ПРИХОВАНИЙ КОМЕНТАР');check('власник коментує приховане',closed.status===201);
    const visible=await call('editor');check('приховані записи й цілі не виходять через API',!JSON.stringify(visible).includes('ПРИХОВАНИЙ')&&!JSON.stringify(visible).includes('Прихована сцена'));
    await grantAccess(repo,{projectId:id,granter,userId:'commenter',scopeType:'character',scopeRef:hero.id,level:'view'});
    const sourceFor=async(user:string)=>(await fetch(origin+base+'/source',{headers:{'x-user':user}})).json();
    check('джерело приховує картку недозволеного героя',(await sourceFor('editor')).book.characters.length===0);
    check('джерело повертає дозволену картку героя',(await sourceFor('commenter')).book.characters[0]?.id==='c1');
    check('коментар до конкретного абзацу',(await comment('commenter',{kind:'paragraph',id:'p1',chapterId:'ch',sectionId:'s1'} as any,'Абзацний коментар')).status===201);
    check('точний перехід абзацу',(await call('editor','/target?kind=paragraph&id=p1&chapterId=ch&sectionId=s1')).body.paragraph.editorPid==='p1');
    check('прихований абзац не читається',(await call('editor','/target?kind=paragraph&id=p2&chapterId=ch&sectionId=s2')).status===404);
    check('абзац не підміняє сцену',(await comment('editor',{kind:'paragraph',id:'p2',chapterId:'ch',sectionId:'s1'} as any)).status===403);
    check('цілі сутностей підтримані',(await comment('owner',{kind:'entity',id:hero.id} as any)).status===201);
    check('матеріали підтримані',(await comment('owner',{kind:'material',id:'image'} as any)).status===201);
    check('джерело дозволеної сутності',(await call('owner',`/target?kind=entity&id=${hero.id}`)).body.entity.id===hero.id);
    check('джерело прихованої сутності закрито',(await call('editor',`/target?kind=entity&id=${hero.id}`)).status===404);
    check('невідома сутність заборонена',(await comment('owner',{kind:'entity',id:'missing'} as any)).status===403);
    check('підміна чужої сцени з дозволеним розділом заборонена',(await comment('editor',{...secret,chapterId:'other'})).status===403);
    check('некоректний текст 400',(await comment('owner',scene,' ')).status===400);
    check('надмірний текст 400',(await comment('owner',scene,'x'.repeat(4001))).status===400);
    check('невідома ціль заборонена',(await comment('owner',{kind:'vault',id:'secret'} as any)).status===403);
    check('учасник не створює завдання',(await call('editor','/items','POST',{kind:'task',target:scene,text:'Завдання',assigneeId:'editor'})).status===403);
    check('неучасник не стає виконавцем',(await task('stranger')).status===400);
    check('учаснику не призначають приховану сцену',(await task('hidden')).status===403);
    check('перевірка строку',(await task('editor',scene,{dueAt:'invalid'})).status===400);
    const created=await task();check('завдання з виконавцем і строком',created.status===201&&created.body.item.assigneeId==='editor'&&created.body.item.dueAt==='2026-10-07T12:00:00.000Z');
    const ti=created.body.item;const inbox=(await call('editor')).body.notifications;const n=inbox.find((n:any)=>n.itemId===ti.id);
    check('призначення породжує особисте сповіщення',!!n);
    check('чужий не читає сповіщення',(await call('commenter',`/notifications/${n.id}/read`,'POST')).status===404);
    check('одержувач позначає прочитаним',(await call('editor',`/notifications/${n.id}/read`,'POST')).status===200);
    check('прочитане збережене',!!(await call('editor')).body.notifications.find((x:any)=>x.id===n.id).readAt);
    const edit=async(user:string,fields:unknown)=>call(user,`/items/${ti.id}`,'PATCH',fields);
    check('виконавець не підміняє текст',(await edit('editor',{expectedVersion:1,text:'Підміна'})).status===403);
    check('інші учасники не закривають завдання',(await edit('commenter',{expectedVersion:1,status:'done'})).status===403);
    const parallel=await Promise.all([edit('editor',{expectedVersion:1,status:'done'}),edit('owner',{expectedVersion:1,status:'done'})]);
    check('два одночасні записи: один успіх один конфлікт',parallel.filter(r=>r.status===200).length===1&&parallel.filter(r=>r.status===409).length===1);
    check('статус завдання збережений',(await call('owner')).body.items.find((i:any)=>i.id===ti.id).status==='done');
    check('зміна не приймає сторонні поля',(await edit('owner',{expectedVersion:2,authorId:'attacker'})).status===400);
    const past=await task('editor',scene,{dueAt:'2000-01-01T00:00:00Z'});
    const expired=(await call('editor')).body.notifications.filter((n:any)=>n.itemId===past.body.item.id&&n.kind==='overdue');
    check('особисте сповіщення про прострочення',expired.length===1);
    check('повторне читання не дублює прострочення',(await call('editor')).body.notifications.filter((n:any)=>n.itemId===past.body.item.id&&n.kind==='overdue').length===1);
    await call('editor',`/notifications/${expired[0].id}/read`,'POST');
    check('прочитання нагадування збережено',!!(await call('editor')).body.notifications.find((n:any)=>n.id===expired[0].id).readAt);
    await call('editor',`/items/${past.body.item.id}`,'PATCH',{expectedVersion:1,status:'done'});
    check('завершене завдання не дає простроченого нагадування',!(await call('editor')).body.notifications.some((n:any)=>n.itemId===past.body.item.id&&n.kind==='overdue'));
    const own=(await comment('commenter')).body.item;
    check('автор редагує коментар',(await call('commenter',`/items/${own.id}`,'PATCH',{expectedVersion:1,text:'Оновлений коментар'})).status===200);
    check('інший не редагує коментар',(await call('editor',`/items/${own.id}`,'PATCH',{expectedVersion:2,text:'Підміна'})).status===403);
    check('коментар не перетворюється на завдання',(await call('owner',`/items/${own.id}`,'PATCH',{expectedVersion:2,assigneeId:'editor'})).status===400);
    const eff=computeEffective(id,'viewer',[],{full:false});eff.scenes.s1='view';eff.restricted=true;
    check('WS не показує правку чужої сцени',shapeRoomEvent({type:'section:remote_patch',payload:{patch:{chapterId:'ch',sectionId:'s2',content:'ПРИХОВАНИЙ'}}},{eff,characterRefs:new Set()})===null);
    check('WS обрізає повне джерело',!JSON.stringify(shapeRoomEvent({type:'book:remote_update',payload:{book:(await store.getBook(id)).book}},{eff,characterRefs:new Set()})).includes('ПРИХОВАНИЙ'));
    if(browser) await browserSuite(app,origin,id);
    await revokeAccess(repo,{projectId:id,grantId:editorGrant.id,granter});
    check('відкликаний доступ закриває API негайно',(await call('editor')).status===403);
    check('відкликаний доступ закриває зміни',(await edit('editor',{expectedVersion:2,status:'open'})).status===403);
    // Close/reopen SQLite to prove notices and annotations survive the process connection.
    db.closeDb();await db.initDb();check('коментарі збереглися після перепідключення',(await call('owner')).body.items.some((i:any)=>i.id===own.id&&i.text==='Оновлений коментар'));
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
}
async function browserSuite(app:express.Express,origin:string,id:string) {
  const esbuild=await import('esbuild');const puppeteer=(await import('puppeteer-core')).default;
  const built=await esbuild.build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{CollaborationPage}from'./src/components/CollaborationPage';import{LanguageProvider}from'./src/i18n/LanguageContext';const book={id:${JSON.stringify(id)}};createRoot(document.getElementById('root')).render(<LanguageProvider><CollaborationPage book={book} onOpenCharacter={id=>document.body.dataset.entity=id} onOpenParagraph={t=>{document.body.dataset.scene=t.sectionId;document.body.dataset.pid=t.editorPid;}}/></LanguageProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',outfile:'/tmp/t31-browser.js',define:{'import.meta.env.DEV':'false','import.meta.env.PROD':'true'}});
  const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=await fs.readFile(path.join('dist/assets',(await fs.readdir('dist/assets')).find(f=>/^index-.*\.css$/.test(f))),'utf8');
  app.get('/t31-browser',(_req,res)=>res.send('<html><body><div id="root"></div><script src="/t31-browser.js"></script></body></html>'));app.get('/t31-browser.js',(_req,res)=>res.type('js').send(js));
  const chrome=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await chrome.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push((e as Error).message));
  await fs.mkdir('/tmp/t31-browser',{recursive:true});
  try {
    await page.setExtraHTTPHeaders({'x-user':'owner'});await page.setViewport({width:390,height:844});await page.goto(origin+'/t31-browser');await page.addStyleTag({content:css});await page.waitForSelector('[aria-label="Ціль запису"]');
    await page.select('[aria-label="Ціль запису"]',JSON.stringify({kind:'scene',id:'s1',chapterId:'ch'}));await page.type('[aria-label="Текст запису"]','Браузерний коментар');await page.click('form button');await page.waitForFunction(()=>[...document.querySelectorAll('[data-work-item]')].some(e=>e.textContent.includes('Браузерний коментар')));
    check('браузер: додавання коментаря',true);
    await page.select('[aria-label="Тип запису"]','task');await page.type('[aria-label="Текст запису"]','Браузерне завдання');await page.select('[aria-label="Виконавець"]','editor');await page.click('form button');await page.waitForFunction(()=>[...document.querySelectorAll('[data-work-item]')].some(e=>e.textContent.includes('Браузерне завдання')));check('браузер: призначення завдання',true);
    await page.screenshot({path:'/tmp/t31-browser/work-390.png',fullPage:true});check('браузер: мобільна ширина',await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.setExtraHTTPHeaders({'x-user':'editor'});await page.reload();await page.addStyleTag({content:css});await page.waitForSelector('[data-work-item]');
    await page.evaluate(()=>{const e=[...document.querySelectorAll('[data-work-item]')].find(e=>e.textContent.includes('Браузерне завдання'));(e.querySelectorAll('button')[1] as HTMLButtonElement).click();});await page.waitForFunction(()=>[...document.querySelectorAll('[data-work-item]')].some(e=>e.textContent.includes('Браузерне завдання')&&e.textContent.includes('Завершено')));check('браузер: виконавець завершує завдання',true);
    await page.evaluate(()=>{const e=[...document.querySelectorAll('[data-work-item]')].find(e=>e.textContent.includes('Браузерний коментар'));(e.querySelector('button') as HTMLButtonElement).click();});await page.waitForFunction(()=>document.body.dataset.scene==='s1');check('браузер: перехід до джерела сцени',true);
    await page.evaluate(()=>{document.body.dataset.pid='';const e=[...document.querySelectorAll('[data-work-item]')].find(e=>e.textContent.includes('Абзацний коментар'));(e.querySelector('button') as HTMLButtonElement).click();});await page.waitForFunction(()=>document.body.dataset.pid==='p1');check('браузер: перехід до конкретного абзацу',true);
    await page.setExtraHTTPHeaders({'x-user':'owner'});await page.reload();await page.addStyleTag({content:css});await page.waitForSelector('[data-work-item]');
    await page.evaluate(()=>{(Array.from(document.querySelectorAll('nav button')).find(e=>e.textContent==='Команда й доступ') as HTMLButtonElement).click();});
    await page.waitForSelector('[aria-label="Учасник для ролі"]');await page.select('[aria-label="Учасник для ролі"]','editor');await page.select('[aria-label="Роль учасника"]','editor');await page.click('form[aria-label="Призначити роль"] button');await page.waitForFunction(()=>document.querySelector('[aria-label="Учасники та ролі"]')?.textContent.includes('Роль призначено.'));check('браузер: призначення ролі',true);
    await page.screenshot({path:'/tmp/t31-browser/access-390.png',fullPage:true});check('браузер: панель команди на мобільному',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const source=await fetch(origin+`/api/core/projects/${id}/source/chapters/ch/sections/s1`,{method:'PATCH',headers:{'x-user':'owner','content-type':'application/json'},body:JSON.stringify({expectedRevision:1,patch:{content:'Правка для відновлення'}})});check('браузер: створено нову ревізію',source.ok);
    await page.evaluate(()=>{(Array.from(document.querySelectorAll('nav button')).find(e=>e.textContent==='Історія правок') as HTMLButtonElement).click();});await page.waitForSelector('[aria-label="Попередня ревізія"]');await page.select('[aria-label="Попередня ревізія"]','1');await page.waitForSelector('[data-source-history] input[type=checkbox]');
    check('браузер: відновлення вимагає підтвердження',await page.evaluate(()=>Array.from(document.querySelectorAll('[data-source-history] button')).some((e:HTMLButtonElement)=>e.disabled)));
    await page.screenshot({path:'/tmp/t31-browser/history-390.png',fullPage:true});await page.click('[data-source-history] input[type=checkbox]');await page.click('[data-source-history] button');await page.waitForFunction(()=>document.querySelector('[data-source-history]')?.textContent.includes('ревізія: 3'));check('браузер: відновлення створює нову ревізію',true);
    check('браузер: немає помилок React',errors.length===0);
  }finally{await chrome.close();}
}
let pool:any=null;
try {
  await suite(new MemoryCoreRepository(),'SQLite + Memory',process.argv.includes('--browser'));
  if(process.env.CORE_TEST_DATABASE_URL) {
    const {createCorePool}=await import('../server/core');const {runMigrations,loadMigrations,resolveMigrationsDir}=await import('../server/core/migrate');const {PgCoreRepository}=await import('../server/core/pgRepository');
    pool=createCorePool(process.env.CORE_TEST_DATABASE_URL);await runMigrations(pool,loadMigrations(resolveMigrationsDir()));await suite(new PgCoreRepository(pool),'SQLite + PostgreSQL');
  }
  console.log(`\n${passed} перевірок пройшло.`);
}finally{if(pool)for(const id of projects)await pool.query('DELETE FROM fusion_core.projects WHERE id=$1',[id]);await pool?.end();db.closeDb();await fs.rm(dir,{recursive:true,force:true});}
