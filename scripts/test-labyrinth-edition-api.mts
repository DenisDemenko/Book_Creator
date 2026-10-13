import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import express from 'express';
import type {AddressInfo} from 'node:net';
import {PDFDocument} from 'pdf-lib';
import {labyrinthDemo} from '../shared/labyrinthDemo';
import {GROUP_TERMS} from '../shared/labyrinthGroup';
import type {EditionTerms} from '../shared/labyrinthEdition';
const url=process.env.CORE_TEST_DATABASE_URL;
if(!url)throw new Error('Use a disposable local CORE_TEST_DATABASE_URL ending in _t99.');
const target=new URL(url);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_t99'))throw new Error('Edition tests refuse non-local/non-_t99 databases.');
process.env.DATA_DIR=await fs.mkdtemp('/tmp/t99-books-');delete process.env.DATABASE_PATH;
const [{createCorePool},{loadMigrations,resolveMigrationsDir,runMigrations},{PgLabyrinthStore},{registerLabyrinthRoutes},{registerLabyrinthEditionRoutes,assertLabyrinthPublication},{registerPdfRoutes},bookStore,db,{computeEffective},{stateHash},{LabyrinthError},{renderBookPdf},{bookToPdfInput,specFromBook},contributionStore,{registerSourceRoutes},{registerContributionRoutes}]=await Promise.all([
  import('../server/core/index'),import('../server/core/migrate'),import('../server/core/labyrinth/store'),import('../server/core/labyrinth/routes'),import('../server/core/labyrinth/editionRoutes'),
  import('../server/pdfRoutes'),import('../server/bookStore'),import('../server/db'),import('../server/core/collaboration/access'),import('../server/core/labyrinth/model'),import('../server/core/labyrinth/model'),
  import('../server/pdf/pdfRenderer'),import('../server/pdf/pdfFromBook'),import('../server/core/collaboration/contributionStore'),import('../server/core/collaboration/sourceRoutes'),import('../server/core/collaboration/contributionRoutes')]);
if(!process.argv.includes('--json'))assert.equal(await db.initDb(),true,'SQLite must execute');
let pool=createCorePool(url),store=new PgLabyrinthStore(pool);assert.equal((await runMigrations(pool,loadMigrations(resolveMigrationsDir()))).schemaVersion,41);
const project='t99-'+randomUUID(),disabled=new Set(['disabled']),revoked=new Set<string>(),publishDenied=new Set<string>();
const editorialBooks=new Set<string>();
const principal=(id:string)=>['owner','reader','reader2','admin','designer','outsider','disabled'].includes(id)&&!disabled.has(id)?{id,role:id==='admin'?'admin':'writer',isGuest:false,name:id}:null;
await pool.query("INSERT INTO projects(id,owner_id,title,revision) VALUES($1,'owner','Канон',7)",[project]);
await bookStore.saveBook({book:{id:project,title:'Оригінал',author:'Письменник',chapters:[{id:'canon',sections:[{id:'canon-scene',content:'UNCHANGED_CANON'}]}],privateNotes:'PRIVATE_SOURCE_NOTE'},ownerId:'owner'});
const original=stateHash(await bookStore.getBook(project));
const access={getBookOwnerId:async(id:string)=>(await bookStore.getBook(id))?.ownerId??null,getCollabOwnerId:async()=>undefined,
  listAcceptedInvites:async(id:string)=>id===project?['reader','reader2','designer'].map(acceptedUserId=>({acceptedUserId,role:'reader'})):editorialBooks.has(id)?[{acceptedUserId:'reader',role:'coauthor'}]:[],
  effectiveAccess:async({projectId,userId}:any)=>computeEffective(projectId,userId,!revoked.has(userId)&&(projectId===project&&['reader','reader2','designer'].includes(userId)||editorialBooks.has(projectId)&&userId==='reader')?[{id:userId,projectId,participantId:userId,status:'active',level:editorialBooks.has(projectId)?'edit':'view',scopeType:'book',scopeRef:null,validFrom:'2020-01-01T00:00:00Z',validUntil:null}] as any:[],{full:false})};
const app=express();app.use((q,_r,next)=>{if(q.url.startsWith('/studio/api/'))q.url=q.url.slice('/studio'.length);next();});app.use(express.json({limit:'12mb'}));
app.use((q,_r,next)=>{const id=String(q.headers['x-test-user']??'guest');q.principal={id:id==='guest'?null:id,role:id==='admin'?'admin':'writer',isGuest:id==='guest'} as any;next();});
const refreshPrincipal=async(q:any)=>{if(!principal(q.principal?.id))throw new LabyrinthError(401,'account disabled');};
registerLabyrinthRoutes(app,{access,store:()=>store,groupPrincipal:async id=>principal(id),refreshPrincipal,
  storyBooks:{read:bookStore.getBook,write:(book,ownerId,beforeWrite)=>bookStore.saveBook({book,ownerId,beforeWrite,mergeKey:'labyrinth-story:'+String((book.labyrinthStory as any).draftId)})}});
let pendingProposal=false,editorRows:Array<{userId:string;sectionId:string;resultRevision:number}>=[],renderMode='normal',permissionMode='normal';
let renderStartedResolve=()=>{},renderFinish=()=>{},renderStarted=Promise.resolve();
const editionDeps={access,store:()=>store,groupPrincipal:async(id:string)=>principal(id),refreshPrincipal,
  editionCanPublish:async(q:any)=>{const id=q.principal.id;if(permissionMode==='revoke-next'){permissionMode='normal';publishDenied.add(id);return true;}return !publishDenied.has(id);},
  editionPendingProposals:async(id:string)=>pendingProposal||!!db.getDb()&&contributionStore.changeProposals(id).some(p=>p.status==='pending'),
  editionEditorContributions:async(id:string)=>[...editorRows,...(db.getDb()?contributionStore.contributions(id).map(c=>({userId:c.userId,sectionId:c.resourceId,resultRevision:c.resultRevision})):[])],
  editionCandidates:async()=>[{userId:'designer',alias:'Художник'}],
  editionRenderPdf:async(book:any)=>{if(renderMode==='delay'){renderStartedResolve();await new Promise<void>(r=>{renderFinish=r;});renderMode='normal';}return (await renderBookPdf(bookToPdfInput(book),specFromBook(book))).bytes;}};
registerLabyrinthEditionRoutes(app,editionDeps);
registerSourceRoutes(app,{access,repo:()=>null});
registerContributionRoutes(app,{access,repo:()=>null});
registerPdfRoutes(app,{assertBookPublication:(q,id,book,commercial)=>assertLabyrinthPublication(q,editionDeps,id,book,commercial),resolveEngine:()=> 'gemini',loadAdminLayer:async()=>({} as any),generateText:async()=>{throw new Error('Live provider must not be called');}});
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
const call=async(path:string,body?:unknown,user='owner',method?:string)=>{const r=await fetch(origin+path,{method:method??(body===undefined?'GET':'POST'),headers:{'x-test-user':user,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const bytes=Buffer.from(await r.arrayBuffer());const json=r.headers.get('content-type')?.includes('application/json')?JSON.parse(bytes.toString()):null;return {status:r.status,body:json,bytes,cache:r.headers.get('cache-control'),type:r.headers.get('content-type'),csp:r.headers.get('content-security-policy')};};
const expect=(r:any,status:number)=>{assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(r.cache,'no-store');return r.body;};
const lab='/api/core/projects/'+project+'/labyrinth';let passed=0;const check=(name:string)=>{passed++;console.log('✓ ВИДАННЯ/API/'+(process.argv.includes('--json')?'JSON':'SQLite')+': '+name);};
const world=structuredClone(labyrinthDemo);world.events=[];const template=world.heroes[0];world.heroes=[{...structuredClone(template),id:'one',name:'Іван',knowledge:['PRIVATE_ONE']},{...structuredClone(template),id:'two',name:'Олена',knowledge:['PRIVATE_TWO']}];
world.nodes.find(n=>n.id==='lower-entry')!.description='Початок історії';world.nodes.find(n=>n.id==='isolated-room')!.description='UNVISITED_SECRET';
const terms:EditionTerms={license:'all-rights-reserved',licenseText:'',commercial:false,credits:[{userId:'owner',name:'Авторська назва',role:'author',shareBps:0},{userId:'reader',name:'Псевдонім один',role:'coauthor',shareBps:0},{userId:'reader2',name:'Видавець',role:'publisher',shareBps:0}],excludeContributionIds:[],foreword:'Як створено цю історію',acknowledgements:'Подяки команді',cover:null};
let bookId='',groupId='',contributionId='',edition:any;
const endpoint=()=>'/api/core/projects/'+bookId+'/labyrinth-editions';
const create=async(input=terms,key=randomUUID(),revision?:number)=>{const current=await bookStore.getBook(bookId);return call(endpoint(),{expectedBookRevision:revision??current!.revision,terms:input,key});};
const get=async(id=edition.id,user='owner')=>expect(await call(endpoint()+'/'+id,undefined,user),200);
const decide=async(id:string,user:string,decision='approve',overrides:any={})=>{const v=await get(id,user),me=v.agreements.find((a:any)=>a.mine);return call(endpoint()+'/'+id+'/decision',{snapshotHash:v.snapshotHash,expectedDecisionRevision:me.revision,decision,note:'',publicName:me.name,reviewed:true,agreeAuthorship:true,agreeLicense:true,agreePublication:true,agreeShares:true,key:randomUUID(),...overrides},user);};
const allApprove=async(id:string)=>{for(const c of terms.credits)expect(await decide(id,c.userId),200);return get(id);};
const publish=async(v:any,user='owner',key=randomUUID())=>call(endpoint()+'/'+v.id+'/publish',{expectedRevision:v.revision,confirm:true,key},user);
const groupView=async(user='reader')=>expect(await call(lab+'/reader/groups/'+groupId,undefined,user),200);
const send=async(command:any,user='reader')=>expect(await call(lab+'/reader/groups/'+groupId+'/commands',{expectedRevision:(await groupView(user)).revision,command,key:randomUUID()},user),200);
try{
  const map=expect(await call(lab+'/maps',{expectedRevision:0,definition:world}),201);
  const opened=expect(await call(lab+'/maps/'+map.mapId+'/reader-publication',{expectedRevision:0,mapRevision:1,heroIds:['one','two']}),201);
  const group=expect(await call(lab+'/maps/'+map.mapId+'/groups',{publicationRevision:opened.revision,bindings:[{heroId:'one',userId:'reader',alias:'Герой один'},{heroId:'two',userId:'reader2',alias:'Герой два'}],rules:{order:['one','two'],decision:'unanimous',timeoutSeconds:0,absence:'pause',jointActions:[]},key:randomUUID()}),201);groupId=group.id;
  await send({kind:'join',alias:'Псевдонім один',candidate:true,terms:GROUP_TERMS});await send({kind:'join',alias:'Псевдонім два',candidate:false,terms:GROUP_TERMS},'reader2');
  expect(await call(lab+'/groups/'+groupId+'/launch',{expectedRevision:(await groupView()).revision,key:randomUUID()}),200);
  await send({kind:'message',channel:'player_chat',text:'PRIVATE_PLAYER_CHAT'});
  contributionId=(await send({kind:'contribute',text:'Погоджений літературний внесок.',include:true,aiAssisted:false,terms:GROUP_TERMS})).contributions[0].id;
  await send({kind:'action',action:{kind:'move',edgeId:'corridor'}});for(const edgeId of ['up','bridge','down'])await send({kind:'action',action:{kind:'move',edgeId}},'reader2');
  const finished=await groupView(),draft=expect(await call(lab+'/runs/'+groupId+'/story-drafts',{expectedRunRevision:finished.revision,title:'Книга команди',key:randomUUID()}),201);
  bookId=expect(await call(lab+'/story-drafts/'+draft.id+'/accept',{expectedRevision:draft.revision,confirm:true,causalityReviewed:true,key:randomUUID()}),200).newBookId;
  check('Справжній груповий маршрут і Т9.8 створюють приватну серверну книгу');
  const context=expect(await call(endpoint()+'/context'),200);assert.equal(context.ownerId,'owner');assert.ok(context.candidates.some((c:any)=>c.userId==='reader'&&c.required));assert.ok(context.candidates.some((c:any)=>c.userId==='designer'));check('Автор бачить походження внесків та чинних учасників для титульного складу');
  for(const user of ['guest','disabled'])expect(await call(endpoint()+'/context',undefined,user),401);expect(await call(endpoint()+'/context',undefined,'reader'),404);expect(await call(endpoint()+'/context',undefined,'admin'),404);check('Гість, вимкнений акаунт і чужий admin не отримують авторських налаштувань');
  expect(await create({...terms,credits:terms.credits.filter(c=>c.userId!=='reader')}),422);check('Автор включеного внеску не може бути мовчки прибраний зі складу');
  pendingProposal=true;expect(await create(),409);pendingProposal=false;check('Нерозглянуті редакторські пропозиції блокують підготовку версії');
  expect(await create(terms,randomUUID(),0),409);const createKey=randomUUID();edition=expect(await create(terms,createKey),201);assert.equal(edition.ready,false);assert.equal(expect(await create(terms,createKey),201).id,edition.id);expect(await create({...terms,foreword:'Інше'},createKey),409);check('CAS, повтор втраченої відповіді та колізія ключа не створюють дубль');
  expect(await call(endpoint()+'/'+edition.id,undefined,'outsider'),404);expect(await call(endpoint()+'/'+edition.id,undefined,'admin'),404);const member=await get(edition.id,'reader');assert.equal(member.ownContributions.length,1);assert.ok(!JSON.stringify(member).includes('userId'));for(const secret of ['PRIVATE_PLAYER_CHAT','PRIVATE_ONE','PRIVATE_TWO','PRIVATE_SOURCE_NOTE','UNVISITED_SECRET'])assert.ok(!JSON.stringify(member).includes(secret));check('Учасник бачить свій внесок і версію, без account IDs, чатів, прихованих сцен або знань');
  const inbox=expect(await call(lab+'/reader/book-editions',undefined,'reader'),200);assert.equal(inbox.editions[0].id,edition.id);check('Учасник отримує версію в кабінеті читача без нових прав на весь рукопис');
  expect(await publish(edition),409);expect(await call(endpoint()+'/'+edition.id+'/export/pdf'),409);expect(await call('/api/labyrinth-editions/'+edition.id+'/read',undefined,'guest'),404);check('Непогоджену версію не можна опублікувати або експортувати як фінальну');
  expect(await decide(edition.id,'reader','approve',{agreeLicense:false}),422);expect(await decide(edition.id,'reader','approve',{publicName:'Підміна імені'}),422);check('Роль, публічне ім’я, текст, ліцензія й частки потребують явних підтверджень');
  const declined=expect(await decide(edition.id,'reader','decline',{note:'Потрібна правка'}),200);assert.equal(declined.agreements.find((a:any)=>a.mine).status,'declined');expect(await publish(await get()),409);check('Відмова не перетворюється на згоду');
  edition=await allApprove(edition.id);assert.equal(edition.ready,true);
  const pdf=await call(endpoint()+'/'+edition.id+'/export/pdf');assert.equal(pdf.status,200);assert.equal(pdf.cache,'no-store');const pdfDoc=await PDFDocument.load(pdf.bytes);assert.equal(pdfDoc.getAuthor(),'Авторська назва, Псевдонім один');assert.ok(pdfDoc.getPageCount()>0);check('Реальний PDF містить підтверджених авторів у титулі та метаданих');
  for(const format of ['json','md','html','book']){const out=await call(endpoint()+'/'+edition.id+'/export/'+format);assert.equal(out.status,200);for(const secret of ['PRIVATE_SOURCE_NOTE','PRIVATE_PLAYER_CHAT','PRIVATE_ONE','UNVISITED_SECRET','"userId"'])assert.ok(!out.bytes.toString().includes(secret));}check('HTML/MD/JSON та джерело DOCX/EPUB віддають точну погоджену версію без приватних даних');
  expect(await publish(edition,'reader'),403);publishDenied.add('owner');expect(await publish(edition),403);publishDenied.clear();check('Право участі й погодження не надає права публікації');
  permissionMode='revoke-next';expect(await publish(edition),403);publishDenied.clear();check('Відкликання права перед commit не публікує видання');
  const comment=expect(await call(endpoint()+'/'+edition.id+'/comments',{text:'REVIEW_DISCUSSION_NOT_PUBLIC',key:randomUUID()},'reader'),200);assert.ok(comment.comments.length);check('Обговорення спільне лише для учасників і не стає частиною книги');
  edition=await get();const publishKey=randomUUID();edition=expect(await publish(edition,'reader2',publishKey),200);assert.equal(edition.status,'published');assert.equal(expect(await publish({...edition,revision:edition.revision-1},'reader2',publishKey),200).id,edition.id);assert.equal((await pool.query("SELECT count(*)::int AS n FROM labyrinth_edition_events WHERE edition_id=$1 AND kind='published'",[edition.id])).rows[0].n,1);check('Погоджений видавець публікує; повтор команди не дублює видання');
  const publicPage=await call('/api/labyrinth-editions/'+edition.id+'/read',undefined,'guest');assert.equal(publicPage.status,200);assert.ok(publicPage.csp.includes("default-src 'none'"));assert.ok(publicPage.bytes.toString().includes('Псевдонім один'));assert.ok(!publicPage.bytes.toString().includes('REVIEW_DISCUSSION_NOT_PUBLIC'));check('Публічне інтерактивне читання має лише погоджені титул, текст і пройдений маршрут');
  const metadata=expect(await call('/api/labyrinth-editions/'+edition.id+'/metadata',undefined,'guest'),200);assert.equal(metadata.authors.length,3);assert.ok(!JSON.stringify(metadata).includes('reader'));check('Публічні метадані не містять приватних ідентифікаторів');
  const freshBook=(await bookStore.getBook(bookId))!;const modified=structuredClone(freshBook.book) as any;modified.chapters[0].sections[0].content+=' НОВА РЕДАКЦІЯ';await bookStore.saveBook({book:modified,expectedRevision:freshBook.revision});
  const oldPublic=await call('/api/labyrinth-editions/'+edition.id+'/read',undefined,'guest');assert.equal(oldPublic.status,200);assert.ok(!oldPublic.bytes.toString().includes('НОВА РЕДАКЦІЯ'));check('Зміна робочого рукопису не переписує раніше погоджене опубліковане видання');
  const v2=expect(await create({...terms,license:'CC-BY-4.0'}),201);assert.equal(v2.version,2);assert.ok(v2.agreements.every((a:any)=>a.status==='pending'));expect(await publish(v2),409);check('Нова редакція та ліцензія не успадковують попередні згоди');
  const current=(await bookStore.getBook(bookId))!;await bookStore.saveBook({book:{...current.book,title:'Ще новіша назва'},expectedRevision:current.revision});expect(await decide(v2.id,'reader'),409);assert.equal((await get(v2.id)).fresh,false);check('Застарілий рукопис не можна погодити навіть правильним snapshot hash');
  expect(await decide(edition.id,'reader','withdraw'),200);expect(await call('/api/labyrinth-editions/'+edition.id+'/read',undefined,'guest'),404);expect(await call(endpoint()+'/'+edition.id+'/export/book'),409);check('Відкликання згоди закриває публічну видачу й наступний експорт без зміни історії');
  const v3=expect(await create(),201);editorRows=[{userId:'designer',sectionId:modified.chapters[0].sections[0].id,resultRevision:(await bookStore.getBook(bookId))!.revision}];expect(await create(),422);editorRows=[];check('Автор прийнятих редакторських правок також потребує згоди');
  renderStarted=new Promise(r=>{renderStartedResolve=r;});const v3Ready=await allApprove(v3.id);renderMode='delay';const latePdf=call(endpoint()+'/'+v3.id+'/export/pdf');await renderStarted;expect(await decide(v3.id,'reader','withdraw'),200);renderFinish();assert.equal((await latePdf).status,409);check('Відкликання під час рендеру не видає пізній PDF');
  const guarded=await call('/api/admin/pdf/publish',{book:{...(await bookStore.getBook(bookId))!.book,labyrinthStory:undefined},editions:[{format:'digital',priceMinor:0}]},'admin');assert.equal(guarded.status,409);check('Старий publish API не обходить погодження після видалення клієнтського прапорця');
  if(process.argv.includes('--browser')){const {liveLabyrinthEdition}=await import('./live-labyrinth-edition.mts');await liveLabyrinthEdition({app,origin,project,bookId});}
  if(process.argv.includes('--studio')){const {liveEditionStudio}=await import('./live-labyrinth-edition-studio.mts');await liveEditionStudio({app,server,origin,project,bookId,terms});}
  await send({kind:'withdraw_contribution',contributionId});expect(await create(),409);
  const without=expect(await create({...terms,credits:[terms.credits[0]],excludeContributionIds:[contributionId]}),201);assert.ok(!JSON.stringify(without.manuscript).includes('Погоджений літературний внесок.'));check('Вилучення відкликаного внеску прибирає його текст із нової версії');
  expect(await decide(without.id,'owner'),200);const withoutReady=await get(without.id);revoked.add('reader');const noSourceCredit=expect(await publish(withoutReady),200);assert.equal(noSourceCredit.status,'published');revoked.clear();check('Видання без вилученого внеску не залежить від його колишнього автора');
  if(db.getDb()){
    const secondDraft=expect(await call(lab+'/runs/'+groupId+'/story-drafts',{expectedRunRevision:(await groupView()).revision,title:'Редакторська співпраця',key:randomUUID()}),201);
    const secondBookId=expect(await call(lab+'/story-drafts/'+secondDraft.id+'/accept',{expectedRevision:secondDraft.revision,confirm:true,causalityReviewed:true,key:randomUUID()}),200).newBookId;
    const source='/api/core/projects/'+secondBookId+'/source',editorial='/api/core/projects/'+secondBookId+'/collaboration',edBase='/api/core/projects/'+secondBookId+'/labyrinth-editions';
    assert.equal((await call(source,undefined,'reader')).status,403);
    editorialBooks.add(secondBookId);
    const b=(await bookStore.getBook(secondBookId))!,chapter=(b.book.chapters as any[])[0],section=chapter.sections[0],patch={content:'CO_AUTHOR_EDITOR_TEXT'};
    const direct=await call(source+'/chapters/'+chapter.id+'/sections/'+section.id,{expectedRevision:b.revision,patch},'reader','PATCH');
    assert.equal(direct.status,409);assert.equal(direct.body.kind,'proposal_required');
    check('Погодження не надає редагування; чинне запрошення співавтора відкриває редактор лише через Change Proposal');
    const proposal=expect(await call(editorial+'/proposals',{chapterId:chapter.id,sectionId:section.id,sourceRevision:b.revision,patch,note:'Спільна редакція'},'reader'),201).proposal;
    const editorialTerms={...terms,credits:terms.credits.slice(0,2)};
    expect(await call(edBase,{expectedBookRevision:b.revision,terms:editorialTerms,key:randomUUID()}),409);
    expect(await call(editorial+'/proposals/'+proposal.id+'/merge',{}),200);
    const edited=(await bookStore.getBook(secondBookId))!;
    assert.equal(edited.revision,b.revision+1);assert.ok(expect(await call(source+'/history'),200).revisions.length>=2);
    check('Реальна незлита пропозиція блокує видання; схвалена правка створює серверну ревізію й історію');
    expect(await call(edBase,{expectedBookRevision:edited.revision,terms:{...terms,credits:[terms.credits[0]]},key:randomUUID()}),422);
    const accepted=expect(await call(edBase,{expectedBookRevision:edited.revision,terms:editorialTerms,key:randomUUID()}),201);
    const own=expect(await call(edBase+'/'+accepted.id,undefined,'reader'),200);
    assert.ok(own.canEditBook);assert.ok(own.ownContributions.some((c:any)=>c.text==='CO_AUTHOR_EDITOR_TEXT'));
    assert.ok(JSON.stringify(own.manuscript).includes('CO_AUTHOR_EDITOR_TEXT'));
    check('Злитий редакторський внесок потребує особистої згоди та показує співавтору його точну редакцію');
  }
  await pool.end();pool=createCorePool(url);store=new PgLabyrinthStore(pool);assert.equal((await runMigrations(pool,loadMigrations(resolveMigrationsDir()))).applied.length,0);assert.equal((await get(without.id)).status,'published');check('Перепідключення до PostgreSQL зберігає версії, погодження, історію й ідемпотентність');
  assert.equal(stateHash(await bookStore.getBook(project)),original);check('Базова книга й історія джерела залишаються незмінними');
  console.log('Підсумок: '+passed+' API перевірок пройшло.');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.query('DELETE FROM labyrinth_edition_requests WHERE edition_id IN (SELECT id FROM labyrinth_book_editions WHERE source_project_id=$1)',[project]);await pool.query('DELETE FROM labyrinth_edition_events WHERE edition_id IN (SELECT id FROM labyrinth_book_editions WHERE source_project_id=$1)',[project]);await pool.query('DELETE FROM labyrinth_book_editions WHERE source_project_id=$1',[project]);await pool.query('DELETE FROM projects WHERE id=$1',[project]);await pool.end();await db.closeDb();}
