import {randomBytes} from 'node:crypto';
import type {Express,Request,Response} from 'express';
import type {RealtimeAccessDeps} from '../../realtimeAuth';
import {resolveProjectAccess} from '../projectRoutes';
import {canRead} from '../collaboration/access';
import {getBook,withBookSnapshot} from '../../bookStore';
import {LabyrinthError,stateHash} from './model';
import {PgLabyrinthStore} from './store';
import type {EditionGuard} from './editionStore';
import {editionExportBook} from './edition';
import {editionHtml,editionMarkdown} from './editionExport';
import {bookToPdfInput,specFromBook} from '../../pdf/pdfFromBook';
import {renderBookPdf} from '../../pdf/pdfRenderer';
export interface EditionRouteDeps {
  access:RealtimeAccessDeps;
  store:()=>PgLabyrinthStore|null;
  refreshPrincipal?:(q:Request)=>Promise<void>;
  groupPrincipal?:(id:string)=>Promise<{id:string;role:string;isGuest:boolean;name?:string}|null>;
  editionCanPublish?:(q:Request)=>Promise<boolean>;
  editionPendingProposals?:EditionGuard['pendingProposals'];
  editionEditorContributions?:EditionGuard['editorContributions'];
  editionCandidates?:EditionGuard['candidates'];
  editionRenderPdf?:(book:ReturnType<typeof editionExportBook>)=>Promise<Uint8Array>;
}
const fail=(status:number,message:string):never=>{throw new LabyrinthError(status,message);};
function input(q:Request,keys:string[]){const b=q.body;if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length!==keys.length||Object.keys(b).some(k=>!keys.includes(k)))fail(422,'Некоректні поля запиту видання.');return b;}
export function editionGuard(q:Request,d:EditionRouteDeps,publicRequest=false):EditionGuard {
  const userId=publicRequest?'':q.principal?.id??'';
  const recheck=async()=>{
    if(publicRequest)return;
    if(!q.principal?.id||q.principal.isGuest||(q.principal as any).disabled)fail(401,'Увійдіть у систему.');
    await d.refreshPrincipal?.(q);
    if(!q.principal?.id||q.principal.id!==userId||q.principal.isGuest||(q.principal as any).disabled)fail(401,'Обліковий запис недоступний.');
  };
  return {userId,recheck,readBook:getBook,
    fence:(id,fn)=>withBookSnapshot(id,async book=>{await recheck();if(!book)fail(404,'Серверну книгу не знайдено.');return fn(book!);}),
    canReadUser:async(bookId,id)=>{const p=await d.groupPrincipal?.(id);if(!p)return false;const a=await resolveProjectAccess(p,bookId,d.access);return !!a&&canRead(a.effective.book);},
    canPublish:async()=>{await recheck();return !!(await d.editionCanPublish?.(q));},
    canEditBook:async(bookId,id)=>{const p=await d.groupPrincipal?.(id);const a=p?await resolveProjectAccess(p,bookId,d.access):null;return !!a?.effective.canWriteAny;},
    pendingProposals:d.editionPendingProposals,editorContributions:d.editionEditorContributions,candidates:d.editionCandidates};
}
/** All existing publication entry points must consult the server registry, not a client flag. */
export async function assertLabyrinthPublication(q:Request,d:EditionRouteDeps,bookId:string,book?:Record<string,unknown>,commercial=false){
  const s=d.store()?.editions;
  const protectedId=bookId.startsWith('LB-STORY-')||bookId.startsWith('LAB-EDITION-')||!!book?.labyrinthStory;
  if(!protectedId)return;
  if(!s){if(protectedId)fail(503,'Для перевірки погоджень потрібне доступне ядро.');return;}
  if(await s.registeredStory(bookId)||bookId.startsWith('LB-STORY-'))fail(409,'Погодьте й опублікуйте конкретну версію в розділі «Видання проходження».');
  if(bookId.startsWith('LAB-EDITION-')){
    const id=bookId.slice('LAB-EDITION-'.length),g=editionGuard(q,d),m=await s.publication(id,g);
    // A mutable browser or saved payload cannot replace the agreed publication snapshot.
    if(book&&stateHash(book)!==stateHash(editionExportBook(m)))fail(409,'Текст або метадані відрізняються від погодженого видання.');
    const view=await s.get((await s.ownerBookId(id)),id,g);
    if(!view.canPublish)fail(403,'Немає права публікувати це видання.');
    if(commercial&&!view.commercial)fail(409,'Для продажу потрібні окремо погоджені комерційні умови.');
  }else if(book?.labyrinthStory)fail(409,'Походження збірки не підтверджене сервером.');
}
export function registerLabyrinthEditionRoutes(app:Express,d:EditionRouteDeps){
  const base='/api/core/projects/:projectId/labyrinth-editions';
  const handle=(fn:(q:Request,r:Response,g:EditionGuard)=>Promise<void>,publicRequest=false)=>async(q:Request,r:Response)=>{
    r.set('Cache-Control','no-store');
    try{const g=editionGuard(q,d,publicRequest);await g.recheck();if(!d.store()?.editions)fail(503,'Для видання потрібне доступне ядро PostgreSQL.');if(Object.keys(q.query).length)fail(422,'Некоректні параметри.');await fn(q,r,g);}
    catch(e){if(e instanceof LabyrinthError){r.status(e.status).json({error:e.message});return;}if(['40001','40P01','23505'].includes((e as any)?.code)){r.status(409).json({error:'Версія або погодження змінилися. Оновіть сторінку.'});return;}console.error('[labyrinth-edition]',{code:(e as any)?.code??'internal'});r.status(500).json({error:'Не вдалося виконати дію видання.'});}
  };
  const store=()=>d.store()!.editions;
  app.get(base+'/context',handle(async(q,r,g)=>{r.json(await store().context(String(q.params.projectId),g));}));
  app.post(base,handle(async(q,r,g)=>{const b=input(q,['expectedBookRevision','terms','key']);r.status(201).json(await store().create(String(q.params.projectId),b.expectedBookRevision,b.terms,b.key,g));}));
  app.get(base+'/:id',handle(async(q,r,g)=>{r.json(await store().get(String(q.params.projectId),String(q.params.id),g));}));
  app.post(base+'/:id/decision',handle(async(q,r,g)=>{const b=input(q,['snapshotHash','expectedDecisionRevision','decision','note','publicName','reviewed','agreeAuthorship','agreeLicense','agreePublication','agreeShares','key']);const {key,...decision}=b;r.json(await store().decide(String(q.params.projectId),String(q.params.id),decision,key,g));}));
  app.post(base+'/:id/publish',handle(async(q,r,g)=>{const b=input(q,['expectedRevision','confirm','key']);if(b.confirm!==true)fail(422,'Окремо підтвердьте публікацію повного тексту.');r.json(await store().publish(String(q.params.projectId),String(q.params.id),b.expectedRevision,b.key,g));}));
  app.post(base+'/:id/comments',handle(async(q,r,g)=>{const b=input(q,['text','key']);r.json(await store().comment(String(q.params.projectId),String(q.params.id),b.text,b.key,g));}));
  app.get('/api/core/projects/:projectId/labyrinth/reader/book-editions',handle(async(q,r,g)=>{r.json({editions:await store().inbox(String(q.params.projectId),g)});}));
  app.get(base+'/:id/export/:format',handle(async(q,r,g)=>{
    const format=String(q.params.format);if(!['pdf','md','html','json','book'].includes(format))fail(422,'Виберіть підтримуваний формат.');
    const m=await store().publication(String(q.params.id),g,String(q.params.projectId)),book=editionExportBook(m);
    let bytes:Buffer,mime:string;
    if(format==='pdf'){bytes=Buffer.from(d.editionRenderPdf?await d.editionRenderPdf(book):(await renderBookPdf(bookToPdfInput(book),specFromBook(book),{ownerId:g.userId})).bytes);mime='application/pdf';}
    else if(format==='md'){bytes=Buffer.from(editionMarkdown(m));mime='text/markdown; charset=utf-8';}
    else if(format==='html'){bytes=Buffer.from(editionHtml(m,randomBytes(16).toString('base64')));mime='text/html; charset=utf-8';}
    else{bytes=Buffer.from(JSON.stringify(format==='book'?book:m));mime='application/json; charset=utf-8';}
    await g.recheck();const latest=await store().publication(m.id,g,String(q.params.projectId));if(stateHash(latest)!==stateHash(m))fail(409,'Погодження змінилися під час експорту.');
    r.set('Content-Type',mime);r.set('Content-Disposition','attachment; filename="edition-'+m.version+'.'+(format==='book'?'json':format)+'"');r.set('X-Edition-Id',m.id);r.send(bytes);
  }));
  app.get('/api/labyrinth-editions/:id/read',handle(async(q,r,g)=>{
    const m=await store().publication(String(q.params.id),g),nonce=randomBytes(16).toString('base64');
    r.set('Content-Security-Policy',"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    r.type('html').send(editionHtml(m,nonce));
  },true));
  app.get('/api/labyrinth-editions/:id/metadata',handle(async(q,r,g)=>{const m=await store().publication(String(q.params.id),g);r.json({id:m.id,version:m.version,title:m.title,authors:m.authors,license:m.license,licenseText:m.licenseText,aiAssisted:m.aiAssisted});},true));
}
