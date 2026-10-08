import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import type {AddressInfo} from 'node:net';
import {MemoryCoreRepository} from '../server/core/memoryRepository';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creative-orders-'));
process.env.DATA_DIR=dir;process.env.DATABASE_PATH=path.join(dir,'books.db');
const db=await import('../server/db');await db.initDb();
const books=await import('../server/bookStore');await books.saveBook({ownerId:'owner',book:{id:'book',title:'Private book',chapters:[{id:'c',sections:[{id:'s',content:'SECRET MANUSCRIPT'}]}]}});
const repo=new MemoryCoreRepository();let disabled=false,missing=true,fail=false,calls=0;
let specialist:{id:string;disabled?:boolean}|undefined;
const deps={repo:()=>repo,principal:async(id:string)=>disabled?null:({id,role:'writer',isGuest:false} as any),access:{getBookOwnerId:async(id:string)=>(await books.getBook(id))?.ownerId,getCollabOwnerId:async()=>undefined,listAcceptedInvites:async()=>[]}};
const {createCreativeProject,creativeProjectDb,listCreativeProjects}=await import('../server/core/creative/projects');
const created=await createCreativeProject(deps,'owner','book',{title:'Illustrations'});const p={...created,orderId:'order-one'};const conn=creativeProjectDb();conn.prepare('UPDATE creative_projects SET payload=? WHERE id=?').run(JSON.stringify(p),p.id);
const {registerCreativeOrderBindingRoutes}=await import('../server/core/creative/orderBinding');
let remote={orderId:'order-one',externalId:p.id,version:3,status:'SPECIALIST_SELECTED',specialist:{firebaseUid:'verified-uid',name:'Designer'}};
let hook=async()=>{};
const app=express();app.use(express.json());app.use((q,_r,n)=>{const id=String(q.headers['x-user']??'owner');q.principal={id,role:id==='admin'?'admin':'writer',isGuest:id==='guest'} as any;n();});registerCreativeOrderBindingRoutes(app,{...deps,fetchSelection:async(_q,id)=>{calls++;assert.equal(id,'order-one');if(fail)throw new Error('offline');await hook();return remote;},specialistUser:async uid=>{assert.equal(uid,'verified-uid');return missing?undefined:specialist;}});
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const sync=(body:unknown={confirmed:true},user='owner')=>fetch(`${origin}/api/creative/projects/${p.id}/order-sync`,{method:'POST',headers:{'content-type':'application/json','x-user':user},body:JSON.stringify(body)});
let count=0;const check=(s:string)=>{count++;console.log('✓ '+s);};
try{
 for(const user of ['guest','outsider','admin'])assert.equal((await sync({confirmed:true},user)).status,user==='guest'?401:403);assert.equal(calls,0);check('only book owner may fetch selection; site admin cannot substitute owner');
 assert.equal((await sync({})).status,422);assert.equal(calls,0);check('explicit confirmation before bridge call');
 const initial=await books.getBook('book');let r=await sync();assert.equal(r.status,200);let body=await r.json();assert.equal(body.waitingForStudioLogin,true);assert.equal(body.project.specialistId,null);assert.equal(body.project.specialistFirebaseUid,'verified-uid');assert.equal(body.project.status,'SPECIALIST_SELECTED');check('selected specialist saved without inventing a local identity');
 missing=false;specialist={id:'local-designer'};r=await sync();body=await r.json();assert.equal(body.project.specialistId,'local-designer');assert.equal(body.waitingForStudioLogin,false);assert.equal(listCreativeProjects('book','owner').length,1);check('verified Firebase UID maps to local account on the same project, no duplicates');
 assert.deepEqual(await repo.listParticipants('book'),[]);assert.deepEqual(await repo.listAccessGrants({projectId:'book'}),[]);assert.deepEqual(await books.getBook('book'),initial);assert.equal(body.accessGranted,false);check('selection does not add grants, roles, participants or manuscript edits');
 const before=listCreativeProjects('book','owner')[0];remote={...remote,version:2};assert.equal((await sync()).status,409);assert.deepEqual(listCreativeProjects('book','owner')[0],before);check('older remote revision cannot overwrite choice');
 remote={...remote,version:3,externalId:'foreign-project'};assert.equal((await sync()).status,502);remote={...remote,externalId:p.id,orderId:'foreign-order'};assert.equal((await sync()).status,502);remote={...remote,orderId:'order-one'};check('bridge reply checked against order and private project ids');
 specialist={id:'local-designer',disabled:true};assert.equal((await sync()).status,403);specialist={id:'local-designer'};check('disabled specialist cannot be bound');
 fail=true;assert.equal((await sync()).status,502);fail=false;assert.deepEqual(listCreativeProjects('book','owner')[0],before);check('failed bridge leaves project unchanged');
 hook=async()=>{disabled=true;};assert.equal((await sync()).status,403);disabled=false;hook=async()=>{};check('owner account rechecked after bridge response');
 remote={...remote,version:4,status:'CANCELLED'};assert.equal((await sync()).status,200);assert.equal(listCreativeProjects('book','owner')[0].status,'CANCELLED');check('cancellation synchronizes state; previous access requires explicit revocation');
 if(process.argv.includes('--browser')){
  const {build}=await import('esbuild');const built=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{CreativeOrderBinding}from'./src/components/CreativeOrderBinding';createRoot(document.getElementById('root')).render(<CreativeOrderBinding project={${JSON.stringify({...before,specialistName:null,status:'MODERATION'})}} onSynced={async()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife'});
  const css=(await fs.readdir('dist/assets')).find(f=>/^index-.*\.css$/.test(f));assert.ok(css);const cssText=await fs.readFile(path.join('dist/assets',css),'utf8');app.get('/probe.js',(_q,r)=>r.type('js').send(built.outputFiles[0].text));app.get('/style.css',(_q,r)=>r.type('css').send(cssText));app.get('/probe',(_q,r)=>r.send('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><main id="root" class="bg-slate-950 text-slate-100 p-4"></main><script src="/probe.js"></script>'));
  const {launch}=await import('puppeteer-core');const browser=await launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin+'/probe');await page.waitForSelector('button');assert.equal(await page.$eval('button',b=>(b as HTMLButtonElement).disabled),true);await page.click('input[type=checkbox]');await page.click('button');await page.waitForSelector('[role=status]');assert.ok((await page.$eval('[role=status]',e=>e.textContent))?.includes('Доступ до книги не змінено'));check('BROWSER: explicit sync checkbox and successful response');await page.setViewport({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await page.screenshot({path:path.join(dir,'order-binding-mobile.png'),fullPage:true});check('BROWSER: 390px, no overflow or JS errors');}finally{await browser.close();}
 }
 console.log(`Підсумок: ${count} пройшло. Артефакти ${dir}`);
}finally{await new Promise<void>(r=>server.close(()=>r()));db.closeDb();}
