/** Real HTTP + SQLite + DesignCraft -> stored artifact -> ordinary free book publication. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stored-designcraft-'));
process.env.DATA_DIR=dir;process.env.DATABASE_PATH=path.join(dir,'studio.db');
process.env.USER_API_KEY_SECRET='isolated-test-key';
const db=await import('../server/db');await db.initDb();
const {saveUser}=await import('../server/store');
const {saveBook,readArtifact}=await import('../server/bookStore');
const {saveBridgeSettings}=await import('../server/marketplaceBridge');
const {registerPdfRoutes}=await import('../server/pdfRoutes');
const {registerBookRoutes}=await import('../server/bookRoutes');
const {initialBook}=await import('../src/data/initialBook');
const now=new Date().toISOString();await saveUser({id:'test-admin',email:'admin@test.dev',name:'Site admin',role:'admin',createdAt:now});
const app=express();app.use(express.json({limit:'40mb'}));app.use((req:any,_res,next)=>{req.principal={id:'test-admin',email:'admin@test.dev',role:req.headers['x-test-role']||'admin',isGuest:false};next()});
const ops=registerPdfRoutes(app,{resolveEngine:()=>'',loadAdminLayer:async()=>({}) as never,generateText:async()=>({text:'{}'})});registerBookRoutes(app,ops);
let sentBook:any;const uploaded:Buffer[]=[];
const receiver=express();receiver.post('/bridge/books',express.json(),(req,res)=>{sentBook=req.body;res.json({created:true,listing:{slug:'free-guide',id:'listing-fixture'}})});
receiver.post('/bridge/books/:id/file',express.raw({type:()=>true,limit:'40mb'}),(req,res)=>{uploaded.push(req.body);res.json({id:'file-'+uploaded.length})});
const bridge=receiver.listen(0,'127.0.0.1');await new Promise(r=>bridge.once('listening',r));
await saveBridgeSettings({url:`http://127.0.0.1:${(bridge.address() as any).port}`,key:'test-only-bridge'});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
let checks=0;const ok=(s:string)=>{checks++;console.log('✓ '+s)};
const book:any=structuredClone(initialBook);book.id='TEST-STORED-GUIDE';book.title='Інструкція конструктора';book.author='Адміністратор сайту';book.characters=[];book.illustrations=[];book.layoutConfig.bookDesignThemeId='studio-editorial';book.chapters=[{id:'ch-1',title:'1. Початок роботи',order:1,sections:[{id:'s-1',title:'',content:'Оберіть слеб зі складу. Задайте діаметр круглого столу. Розташуйте деревину й розрахуйте вартість.\n\nЦя інструкція публікується безкоштовно від адміністратора.',order:1}]}];
async function call(p:string,body:unknown,role='admin'){const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json','x-test-role':role},body:JSON.stringify(body)});return {status:r.status,json:await r.json()}}
try{
 await saveBook({book,ownerId:'test-admin'});
 const no=await call(`/api/books/${book.id}/render`,{engineId:'designcraft'},'writer');assert.equal(no.status,403);ok('Stored publication render remains admin-only');
 const cli=process.env.DESIGNCRAFT_PATH;if(!cli||!fs.existsSync(cli))throw Error('Run with the pinned DESIGNCRAFT_PATH; an engine skip is not a successful conveyor test');
 const rendered=await call(`/api/books/${book.id}/render`,{engineId:'designcraft',formats:['digital'],sample:false,variant:'code'});assert.equal(rendered.status,200,JSON.stringify(rendered.json));
 const pdf=await readArtifact(book.id,'pdf','digital');assert(pdf);assert.equal(pdf.record.variant,'designcraft');assert.equal(Buffer.from(pdf.bytes).subarray(0,5).toString(),'%PDF-');assert(pdf.record.pageCount!>0);ok('Saved book renders with actual DesignCraft and records the selected engine');
 const invalid=await call(`/api/books/${book.id}/render`,{engineId:'missing-engine',formats:['digital'],sample:false});assert.equal(invalid.status,400);ok('Unknown engines fail instead of silently rendering with Nova');
 const missingCover=await call(`/api/books/${book.id}/publish`,{editions:[{format:'digital',priceMinor:0}]});assert.equal(missingCover.status,409);assert.equal(sentBook,undefined);ok('Missing cover returns an actionable conflict before creating a listing');
 const cover=fs.readFileSync(new URL('../FusionlabStudiologo.png',import.meta.url));assert(cover.length>3000);assert.equal((await call(`/api/books/${book.id}/artifact/cover`,{imageBase64:'data:image/png;base64,'+cover.toString('base64')})).status,200);
 const pub=await call(`/api/books/${book.id}/publish`,{editions:[{format:'digital',priceMinor:0}]});assert.equal(pub.status,200,JSON.stringify(pub.json));assert.equal(sentBook.priceMinor,0);assert.equal(sentBook.title,book.title);assert.equal(sentBook.externalId,book.id+':digital');ok('Free DesignCraft guide publishes under the ordinary book title and stable external ID');
 assert(uploaded.some(body=>body.indexOf(Buffer.from(pdf.bytes))>=0));ok('Publication uploads the exact stored PDF, not a new rendering with another engine');
 const mixed=await call(`/api/books/${book.id}/render`,{engineId:'designcraft',formats:['digital','print']});assert.equal(mixed.status,400);assert.deepEqual((await readArtifact(book.id,'pdf','digital'))?.bytes,pdf.bytes);ok('Unsupported mixed formats fail before overwriting the existing PDF');
 console.log(`${checks} passed.`);
}finally{await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>bridge.close(()=>r()))]);db.getDb()?.close();fs.rmSync(dir,{recursive:true,force:true})}
