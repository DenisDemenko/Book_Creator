import {randomUUID} from 'node:crypto';
import type {CoreRepository,CoreActor,EntityRow} from './types';
import type {MagicSceneRun,MagicEvent,MagicFragment} from './magicSceneTypes';
import {CoreRuleError} from './rules';
import type {SnapshotResult} from './characterSnapshot';
import {createBookToolRuntime,type BookToolScope} from '../ai/tools';
import {characterSecretIds,vaultKeyFromEnv} from './secretVault';
import {skillInstructions} from '../ai/skills';
import {branchHash,branchCanonHash,createBranch,getBranch,mergeBranchFragment,checkBranch} from './branches';
import {getBook,getBookRevision,type StoredBook} from '../bookStore';
import {cleanFragmentText,validProposalTag} from './interviewProposals';
import {syncBookToCore} from './sync';
import {memoryEvidenceHash} from './characterMemory';
import {markerStringToTiptapDoc,tiptapDocToMarkerBlocks} from '../../src/utils/manuscriptDoc';
import {branchSnapshot,saveBranches} from './branches';
import type {StudioCharacterLike} from './characterProfile';
export const SCENE_ACTIONS=['answer','ask','act','silence','deflect','confess'];
export interface MagicSceneDeps {
 repo:CoreRepository;
 vaultKey?:()=>Buffer;
 secretChoice?:(context:Record<string,unknown>)=>Promise<unknown>;
 authorizeTools?:(scope:Readonly<BookToolScope>)=>Promise<boolean>;
 studio?:(projectId:string,entity:EntityRow)=>Promise<{character:StudioCharacterLike|null;all:StudioCharacterLike[]}|undefined>;
 decide:(context:{run:MagicSceneRun;characterId:string;situation:string;actor:CoreActor})=>Promise<{action:string;awaitingAuthor?:boolean;[key:string]:unknown}>;
 voice:(context:Record<string,unknown>)=>Promise<unknown>;
 writer:(context:Record<string,unknown>)=>Promise<unknown>;
 onSaved?:(stored:StoredBook)=>void;
}
async function bookSceneHash(p:string,id:string){const book:any=(await getBook(p))?.book,section=book?.chapters?.flatMap((c:any)=>c.sections??[]).find((s:any)=>s.id===id);if(!section)throw new CoreRuleError('not_found','Сцену видалено з книги.');return branchHash(section.content??'');}
async function magicCanon(repo:CoreRepository,p:string,participants:string[]){return branchHash({studio:(await getBook(p))?.book?.characters??[],canon:await branchCanonHash(repo,p),memories:await Promise.all(participants.map(characterId=>repo.listCharacterMemories(p,{characterId,simulationId:null,status:'confirmed',limit:1000})))});}
export async function saveMagic(repo:CoreRepository,projectId:string,run:MagicSceneRun){if(Buffer.byteLength(JSON.stringify(run))>2*1024*1024)throw new CoreRuleError('bad_input','Прогін перевищив 2 MiB.');const expected=run.revision;run.revision++;await repo.saveMagicSceneRun(projectId,run,expected);return run;}
export async function getMagic(repo:CoreRepository,projectId:string,id:string){const run=await repo.getMagicSceneRun(projectId,id);if(!run)throw new CoreRuleError('not_found','Magic Scene не знайдено.');return run;}
export async function sceneMaterial(repo:CoreRepository,projectId:string,id:string){
 const docs=await repo.listDocuments(projectId),doc=docs.find(d=>d.id===id&&d.kind==='section'&&!d.deletedAt);
 if(!doc)throw new CoreRuleError('not_found','Сцену не знайдено.');
 const paragraphs=(await repo.listParagraphs(projectId,id)).filter(p=>!p.deletedAt&&p.kind!=='draft').sort((a,b)=>a.order-b.order);
 return {text:paragraphs.map(p=>p.text).join('\n\n'),hash:branchHash(paragraphs.map(p=>({id:p.id,text:p.text}))),chapter:(docs.find(d=>d.id===doc.parentId)?.order??0)+1};
}
export async function startMagic(repo:CoreRepository,projectId:string,sceneId:string,input:any,actor:CoreActor){
 const participants=input?.participants;
 if(!Array.isArray(participants)||participants.length<2||participants.length>3||new Set(participants).size!==participants.length||participants.some(x=>typeof x!=='string'))throw new CoreRuleError('bad_input','Оберіть 2–3 різних героїв у порядку ходів.');
 if(typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>2000||typeof input.constraints!=='string'||input.constraints.length>2000)throw new CoreRuleError('bad_input','Мета й межі сцени — до 2000 символів.');
 if(!Number.isSafeInteger(input.maxTurns)||input.maxTurns<2||input.maxTurns>60)throw new CoreRuleError('bad_input','Від 2 до 60 ходів.');
 const source=await sceneMaterial(repo,projectId,sceneId);if(!source.text.trim())throw new CoreRuleError('bad_input','Сцені потрібен вихідний матеріал.');
 for(const id of participants){const e=await repo.getEntity(projectId,id),a=await repo.getCharacterAgent(projectId,id);if(!e||e.type!=='character'||e.status!=='confirmed')throw new CoreRuleError('bad_input','Учасник — підтверджений герой.');if(!a?.enabled||a.autonomyLevel!=='scene')throw new CoreRuleError('conflict',`Увімкніть для «${e.name}» рівень «Учасник сцени».`);}
 const asOfChapter=input.asOfChapter??source.chapter;if(!Number.isSafeInteger(asOfChapter)||asOfChapter<1||asOfChapter>source.chapter)throw new CoreRuleError('bad_input','Межа знань не може бути пізнішою за главу сцени.');
 const project=await repo.getProject(projectId);if(!project)throw new CoreRuleError('not_found','Проєкт не знайдено.');
 if((await repo.listSimulations(projectId,{kind:'scene',limit:1000})).length>=100)throw new CoreRuleError('bad_input','До 100 прогонів Magic Scene.');
 const sim=await repo.addSimulation({projectId,kind:'scene',sceneId,asOfChapter,baseBookRevision:project.revision,title:input.goal.trim().slice(0,200),createdBy:actor});
 const run:MagicSceneRun={revision:0,simulationId:sim.id,sceneId,participants,goal:input.goal.trim(),constraints:input.constraints,maxTurns:input.maxTurns,asOfChapter,sourceHash:source.hash,bookSceneHash:await bookSceneHash(projectId,sceneId),canonHash:await magicCanon(repo,projectId,participants),sourceText:source.text.slice(0,30000),status:'active',busy:null,events:[],privateSteps:[],fragments:[],requests:[],createdAt:new Date().toISOString()};
 return saveMagic(repo,projectId,run);
}
const checkRevision=(run:MagicSceneRun,n:unknown)=>{if(!Number.isSafeInteger(n)||Number(n)<0)throw new CoreRuleError('bad_input','Потрібна ревізія прогону.');if(run.revision!==n)throw new CoreRuleError('conflict','Прогін уже змінили. Оновіть сторінку.');};
const free=(run:MagicSceneRun)=>{if(run.busy)throw new CoreRuleError('conflict','Триває дія. Пауза скасовує її результат і дозволяє повтор.');};
async function fresh(repo:CoreRepository,p:string,run:MagicSceneRun){if(await bookSceneHash(p,run.sceneId)!==run.bookSceneHash||(await sceneMaterial(repo,p,run.sceneId)).hash!==run.sourceHash||await magicCanon(repo,p,run.participants)!==run.canonHash)throw new CoreRuleError('conflict','Основа або канон змінилися. Почніть новий прогін.');}
const observable=(event:MagicEvent)=>({id:event.id,turn:event.turn,characterId:event.characterId,characterName:event.characterName,speech:event.speech,actionText:event.actionText,audience:event.audience,at:event.at});
const publicText=(event:MagicEvent)=>`${event.characterName}: ${event.speech} ${event.actionText}`;
async function lock(repo:CoreRepository,p:string,run:MagicSceneRun,kind:NonNullable<MagicSceneRun['busy']>['kind']){run.busy={kind,token:randomUUID(),at:new Date().toISOString()};await saveMagic(repo,p,run);return run.busy.token;}
async function held(repo:CoreRepository,p:string,id:string,token:string){const run=await getMagic(repo,p,id);if(run.busy?.token!==token)throw new CoreRuleError('conflict','Дію скасовано або прогін уже змінили.');return run;}
async function failure(repo:CoreRepository,p:string,id:string,token:string,error:unknown){const run=await getMagic(repo,p,id);if(run.busy?.token===token){run.busy=null;run.lastError=error instanceof Error?error.message.slice(0,500):'Збій моделі';await saveMagic(repo,p,run);}}
export async function pauseMagic(repo:CoreRepository,p:string,id:string,expected:unknown,status:'active'|'paused'){
 const run=await getMagic(repo,p,id);checkRevision(run,expected);if(run.status==='closed')throw new CoreRuleError('conflict','Прогін завершено.');
 if(run.busy?.kind==='approve')throw new CoreRuleError('conflict','Дочекайтеся завершення затвердження.');
 run.status=status;run.busy=null;return saveMagic(repo,p,run);
}
export async function stepMagic(d:MagicSceneDeps,p:string,id:string,input:any,actor:CoreActor){
 let run=await getMagic(d.repo,p,id);const requestId=input?.requestId;
 if(typeof requestId!=='string'||requestId.length<8||requestId.length>100)throw new CoreRuleError('bad_input','Потрібен ідентифікатор запиту.');
 if(run.requests.some(r=>r.id===requestId&&r.operation==='step'))return run;
 checkRevision(run,input.expectedRevision);free(run);if(run.status!=='active'||run.fragments.length)throw new CoreRuleError('conflict','Для нового ходу потрібен активний прогін без літературної чернетки.');await fresh(d.repo,p,run);
 if(run.events.length>=run.maxTurns)throw new CoreRuleError('conflict','Ліміт ходів вичерпано.');
 const token=await lock(d.repo,p,run,'step');
 try{
 const characterId=run.participants[run.events.length%run.participants.length];const hero=await d.repo.getEntity(p,characterId);if(!hero)throw new CoreRuleError('not_found','Героя видалено.');
 const agent=await d.repo.getCharacterAgent(p,characterId);if(!agent?.enabled||agent.autonomyLevel!=='scene')throw new CoreRuleError('conflict','Автономність героя вимкнено.');
 const observed=run.events.filter(e=>e.audience.includes(characterId));const situation=[run.goal,run.constraints,...observed.slice(-12).map(publicText)].join('\n').slice(0,10000);
 const runtime=createBookToolRuntime({repo:d.repo,scope:{projectId:p,actorId:actor,characterId,sceneId:run.sceneId,simulationId:id},authorize:d.authorizeTools??(async scope=>scope.actorId===actor),allowedActions:SCENE_ACTIONS,situation,vaultKey:d.vaultKey??vaultKeyFromEnv,studio:await d.studio?.(p,hero),evaluate:async()=>d.decide({run,characterId,situation,actor})});
 const snapshot=await runtime.step('character-profile-agent',['get-character-snapshot'],ctx=>ctx.tool<SnapshotResult>('get-character-snapshot'));
 const scene=await runtime.step('character-agent',['get-scene-context'],ctx=>ctx.tool<{observed:Record<string,unknown>[]}>('get-scene-context'));
 let decision:Record<string,unknown>;
 if(input.authorAction!==undefined){if(!SCENE_ACTIONS.includes(input.authorAction))throw new CoreRuleError('bad_input','Некоректна дія автора.');decision={action:input.authorAction,source:'author'};}
 else decision=await runtime.step('character-agent',['evaluate-character-options'],ctx=>ctx.tool<Record<string,unknown>>('evaluate-character-options'));
 if(decision.awaitingAuthor){run=await held(d.repo,p,id,token);run.status='paused';run.busy=null;run.lastError='Jev і запасний LLM не обрали дію. Автор може обрати її явно й продовжити.';return saveMagic(d.repo,p,run);}
 const ids=await characterSecretIds(d.repo,d.vaultKey??vaultKeyFromEnv,p,characterId,run.sceneId);
 if(ids.length&&!input.authorAction){if(!d.secretChoice)throw new CoreRuleError('conflict','Приватний рушій секретів недоступний.');try{
  const record=typeof decision.decisionId==='string'?await d.repo.getCharacterDecision(p,decision.decisionId):null;
  if(record&&record.characterId!==characterId)throw new Error();
  const primary=(record?.options.primary??{}) as {allowed?:string[];forbidden?:string[]};const privateAllowed=SCENE_ACTIONS.filter(action=>(!primary.allowed||primary.allowed.includes(action))&&!primary.forbidden?.includes(action));if(!privateAllowed.length)throw new Error();
  const privateFacts=[];for(const secretId of ids)privateFacts.push(await runtime.step('character-agent',['read-authorized-secret'],ctx=>ctx.tool('read-authorized-secret',{secretId})));
  const choice:any=await d.secretChoice({hero:{id:hero.id,name:hero.name},snapshot:snapshot.snapshot,privateFacts,allowedActions:privateAllowed,situation,decision:{action:decision.action}});
  if(!choice||!privateAllowed.includes(choice.action))throw new Error();decision={action:choice.action,source:'sealed-private-choice'};
 }catch{throw new CoreRuleError('conflict','Приватний крок секрету не завершено. Секрет не розкрито.');}}
 if(typeof decision.action!=='string'||!SCENE_ACTIONS.includes(decision.action))throw new CoreRuleError('bad_input','Рішення містить недозволену дію.');
 const result:any=await d.voice({hero:{id:hero.id,name:hero.name},cast:await Promise.all(run.participants.map(async id=>({id,name:(await d.repo.getEntity(p,id))?.name??id}))),snapshot:snapshot.snapshot,goal:run.goal,constraints:run.constraints,decision,observed:scene.observed.slice(-12),skills:skillInstructions(['character-arc','dialogue-craft','emotion-dynamics','mystery-foreshadowing']),ownThoughts:run.privateSteps.filter(s=>s.characterId===characterId).slice(-4).map(s=>({thought:s.thought,intent:s.intent})),allowedAudience:run.participants,turn:run.events.length+1});
 for(const field of ['speech','actionText','privateThought','intent'])if(typeof result?.[field]!=='string'||result[field].length>(field==='intent'?1000:4000))throw new CoreRuleError('bad_input','Неправильна відповідь агента.');
 if(!result.speech.trim()&&!result.actionText.trim()&&decision.action!=='silence')throw new CoreRuleError('bad_input','Потрібна спостережувана репліка або дія.');
 const audience=result.audience??run.participants;if(!Array.isArray(audience)||audience.some(x=>!run.participants.includes(x)))throw new CoreRuleError('bad_input','Спостерігачі мають бути учасниками сцени.');
 await fresh(d.repo,p,run);run=await held(d.repo,p,id,token);
 const event:MagicEvent={id:randomUUID(),turn:run.events.length+1,characterId,characterName:hero.name,action:String(decision.action),speech:result.speech,actionText:result.actionText,audience:[...new Set([characterId,...audience])],at:new Date().toISOString()};run.events.push(event);run.privateSteps.push({eventId:event.id,characterId,thought:result.privateThought,intent:result.intent,decision,toolTrace:runtime.trace,snapshotHash:snapshot.hash});run.requests.push({id:requestId,operation:'step'});run.busy=null;delete run.lastError;if(run.events.length>=run.maxTurns)run.status='closed';await saveMagic(d.repo,p,run);await d.repo.updateSimulation(p,id,{currentTurn:run.events.length,status:run.status==='closed'?'closed':'active'});return run;
 }catch(error){await failure(d.repo,p,id,token,error);throw error;}
}
export async function draftMagic(d:MagicSceneDeps,p:string,id:string,input:any){
 let run=await getMagic(d.repo,p,id);checkRevision(run,input.expectedRevision);free(run);await fresh(d.repo,p,run);
 if(!run.events.length||run.fragments.length)throw new CoreRuleError('conflict','Потрібні події й відсутність попередньої чернетки.');
 const token=await lock(d.repo,p,run,'draft');
 try{
 const result:any=await d.writer({cast:await Promise.all(run.participants.map(async id=>({id,name:(await d.repo.getEntity(p,id))?.name??id}))),source:run.sourceText,goal:run.goal,constraints:run.constraints,events:run.events.map(observable),skills:skillInstructions(['author-style','continuity-check']),rule:'Лише спостережувані події. Збережіть авторський стиль; теги — пропозиції. Кожен фрагмент посилається на свої події.'});
 if(!Array.isArray(result?.fragments)||!result.fragments.length||result.fragments.length>12)throw new CoreRuleError('bad_input','Потрібні 1–12 фрагментів.');
 const fragments:MagicFragment[]=result.fragments.map((f:any)=>{
 if(typeof f?.text!=='string'||!f.text.trim()||f.text.length>6000||!Array.isArray(f.eventIds)||!f.eventIds.length||f.eventIds.some((e:unknown)=>!run.events.some(x=>x.id===e)))throw new CoreRuleError('bad_input','Некоректний фрагмент або його докази.');
 const tags=[...f.text.matchAll(/\[\/?[a-zА-Яа-яІіЇїЄєҐґ_\-]+:[^\]]*\]/gu)].map(m=>validProposalTag(m[0]));if(tags.some(t=>!t)||tags.length>12)throw new CoreRuleError('bad_input','Некоректна пропозиція тегу.');
 const text=cleanFragmentText(f.text);if(tiptapDocToMarkerBlocks(markerStringToTiptapDoc(text)).length>50)throw new CoreRuleError('bad_input','До 50 абзаців у фрагменті.');if(!text.trim())throw new CoreRuleError('bad_input','Потрібен літературний текст.');
 return{id:randomUUID(),text,eventIds:[...new Set<string>(f.eventIds)],tags:tags.map(value=>({id:randomUUID(),value:value!})),status:'draft'};
 });
 await fresh(d.repo,p,run);run=await held(d.repo,p,id,token);run.fragments=fragments;run.status='paused';run.busy=null;delete run.lastError;return saveMagic(d.repo,p,run);
 }catch(error){await failure(d.repo,p,id,token,error);throw error;}
}
async function canonMemories(repo:CoreRepository,p:string,run:MagicSceneRun,f:MagicFragment,revision:number,actor:CoreActor,paragraphIds:string[],evidenceHash:string|null){
 for(const event of run.events.filter(e=>f.eventIds.includes(e.id)))for(const characterId of event.audience){
  const parts=publicText(event).match(/[\s\S]{1,1750}/g)??[];
  for(let index=0;index<parts.length;index++){
   const key=`magic:${run.simulationId}:${event.id}:${characterId}:${index}`;
   const existing=(await repo.listCharacterMemories(p,{characterId,simulationId:null,dedupeKey:key,limit:5}));if(existing.length)continue;
   const content=parts.length===1?parts[index]:`${event.characterName} (${index+1}/${parts.length}): ${parts[index]}`;
   try{await repo.addCharacterMemory({projectId:p,characterId,memoryType:'recollection',layer:'character_belief',content,sourceEventKind:'simulation_event',sourceEventId:event.id,sourceParagraphIds:paragraphIds,evidenceHash,sceneId:run.sceneId,simulationId:null,canonRevision:revision,visibility:'hidden',origin:'author',truth:'unknown',beliefStatus:'knows',status:'confirmed',dedupeKey:key,createdBy:actor});}
   catch(error){if(!(error instanceof CoreRuleError&&error.code==='conflict'))throw error;const found=(await repo.listCharacterMemories(p,{characterId,simulationId:null,dedupeKey:key,limit:5})).some(m=>m.dedupeKey===key);if(!found)throw error;}
  }
 }
}

export async function approveMagic(d:MagicSceneDeps,p:string,id:string,fragmentId:string,input:any,actor:CoreActor){
 let run=await getMagic(d.repo,p,id);const f=run.fragments.find(f=>f.id===fragmentId);if(!f)throw new CoreRuleError('not_found','Фрагмент не знайдено.');
 if(input.confirm!==true)throw new CoreRuleError('bad_input','Явно підтвердьте цей фрагмент і його спостережувані спогади.');
 if(f.status==='accepted')return {run,book:(await getBook(p))?.book};
 checkRevision(run,input.expectedRevision);free(run);if(f.status==='rejected')throw new CoreRuleError('conflict','Фрагмент відхилено.');
 const tagIds=input.tagIds??[];if(!Array.isArray(tagIds)||tagIds.some(id=>!f.tags.some(t=>t.id===id)))throw new CoreRuleError('bad_input','Невідомі теги.');
 if(f.status==='applying'&&branchHash(tagIds)!==branchHash(f.selectedTagIds??[]))throw new CoreRuleError('conflict','При повторі залиште ті самі теги.');
 if(!Number.isSafeInteger(input.expectedBranchRevision)||!Number.isSafeInteger(input.expectedBookRevision))throw new CoreRuleError('bad_input','Потрібні ревізії книги й гілок.');
 const bindings: {id:string;name:string}[]=[];
 if(tagIds.length){const characters=await d.repo.listEntities(p,'character');for(const character of characters.filter(c=>run.participants.includes(c.id)&&f.tags.some(t=>tagIds.includes(t.id)&&t.value.includes(c.name)))){
  const existing=await d.repo.resolveAlias(p,'character',character.name);
  if((existing&&existing!==character.id)||characters.filter(c=>c.name.trim().toLocaleLowerCase()===character.name.trim().toLocaleLowerCase()).length!==1)throw new CoreRuleError('conflict','Ім’я учасника в тегах неоднозначне. Уточніть ім’я або канонічний псевдонім.');
  if(!existing)bindings.push({id:character.id,name:character.name});
 }}
 const token=await lock(d.repo,p,run,'approve');
 try{
 let branches=await d.repo.getBranchWorkspace(p);if(branches.revision!==input.expectedBranchRevision)throw new CoreRuleError('conflict','Гілки вже змінили.');
 const stored=await getBook(p);if(!stored)throw new CoreRuleError('not_found','Серверну книгу не знайдено.');
 if(!f.branchId){
  if(stored.revision!==input.expectedBookRevision)throw new CoreRuleError('conflict','Книга вже змінилася.');
  await fresh(d.repo,p,run);
  const existing=branches.branches.find(b=>b.sourceId===`${id}:${f.id}`);
  const created=existing?{branch:existing}:await createBranch(d.repo,p,stored,{name:`Magic Scene · ${run.events.length} ходів`,source:'magic_scene',sourceId:`${id}:${f.id}`,expectedRevision:branches.revision,initialFragment:{sectionId:run.sceneId,text:[f.text,...f.tags.filter(t=>tagIds.includes(t.id)).map(t=>t.value)].join(' ')}},actor);
  f.branchId=created.branch.id;f.branchFragmentId=created.branch.fragments[0].id;f.selectedTagIds=tagIds;f.status='applying';
  run=await held(d.repo,p,id,token);run.fragments[run.fragments.findIndex(x=>x.id===f.id)]=f;await saveMagic(d.repo,p,run);branches=await d.repo.getBranchWorkspace(p);
 }
 const branch=getBranch(branches,f.branchId!);const checks=await checkBranch(d.repo,p,branch);
 if((checks.issues.length||checks.knowledge.some((x:any)=>x.warnings?.length)||checks.causality.warnings.length)&&input.acknowledgeWarnings!==true)throw new CoreRuleError('conflict','Є попередження. Перевірте гілку й явно підтвердьте їх.');
 const merged=await mergeBranchFragment(d.repo,p,f.branchId!,f.branchFragmentId!,{confirm:true,expectedRevision:branches.revision,expectedBookRevision:input.expectedBookRevision,acknowledgeCanonChange:input.acknowledgeCanonChange===true},actor);
 for(const binding of bindings)await d.repo.addAlias(p,binding.id,binding.name,'name');
 await syncBookToCore(d.repo,merged.stored);
 const branchFragment=merged.branch.fragments.find(x=>x.id===f.branchFragmentId)!;
 const acceptedBook:any=await getBookRevision(p,branchFragment.acceptedRevision??merged.stored.revision);
 const acceptedSection=acceptedBook?.chapters?.flatMap((c:any)=>c.sections??[]).find((s:any)=>s.id===run.sceneId);
 const blocks=tiptapDocToMarkerBlocks(markerStringToTiptapDoc(branchFragment.text));
 if(!acceptedSection?.paragraphIds||!blocks.length||blocks.length>50)throw new CoreRuleError('conflict','Немає доказів затвердженого фрагмента.');
 const editorIds:string[]=acceptedSection.paragraphIds.slice(-blocks.length);
 const currentParagraphs=await d.repo.listParagraphs(p,run.sceneId);
 const proofs=editorIds.map(editorId=>currentParagraphs.find(x=>!x.deletedAt&&(x.editorPid??x.id)===editorId));
 if(proofs.some((paragraph,index)=>!paragraph||paragraph.text!==blocks[index]))throw new CoreRuleError('conflict','Затверджений фрагмент змінили або видалили до завершення памʼяті.');
 const paragraphIds=proofs.map(x=>x!.id),hashOf=new Map(currentParagraphs.map(x=>[x.id,x.textHash]));
 await canonMemories(d.repo,p,run,f,merged.stored.revision,actor,paragraphIds,memoryEvidenceHash(id=>hashOf.get(id),paragraphIds));
 run=await held(d.repo,p,id,token);const accepted=run.fragments.find(x=>x.id===f.id)!;accepted.status='accepted';accepted.acceptedRevision=merged.stored.revision;run.busy=null;run.status='closed';run.sourceHash=(await sceneMaterial(d.repo,p,run.sceneId)).hash;run.bookSceneHash=await bookSceneHash(p,run.sceneId);run.canonHash=await magicCanon(d.repo,p,run.participants);delete run.lastError;await saveMagic(d.repo,p,run);d.onSaved?.(merged.stored);return{run,book:merged.stored.book,checks};
 }catch(error){await failure(d.repo,p,id,token,error);throw error;}
}
export async function rejectMagic(repo:CoreRepository,p:string,id:string,fragmentId:string,expected:unknown){
 const run=await getMagic(repo,p,id);checkRevision(run,expected);free(run);const f=run.fragments.find(x=>x.id===fragmentId);if(!f)throw new CoreRuleError('not_found','Фрагмент не знайдено.');
 if(f.status==='accepted'||f.status==='rejected')throw new CoreRuleError('conflict','Фрагмент уже вирішено.');
 if(f.status==='applying'&&f.branchId){const state=await repo.getBranchWorkspace(p),branch=getBranch(state,f.branchId),fragment=branch.fragments.find(x=>x.id===f.branchFragmentId);if(!fragment||!['draft','rejected'].includes(fragment.status))throw new CoreRuleError('conflict','Рукопис уже змінено або змінюється. Завершіть затвердження.');if(fragment.status==='draft'){fragment.status='rejected';branchSnapshot(branch,'system:magic-scene-rejection');await saveBranches(repo,p,state,state.revision);}}
 f.status='rejected';return saveMagic(repo,p,run);
}

export async function checkMagic(repo:CoreRepository,p:string,run:MagicSceneRun){
 const stored=await getBook(p);if(!stored)throw new CoreRuleError('not_found','Книгу не знайдено.');
 return checkBranch(repo,p,{id:run.simulationId,name:'Magic Scene',pointEntityId:null,source:'magic_scene',sourceId:run.simulationId,baseBookRevision:stored.revision,baseBookHash:branchHash(stored.book),baseCanonHash:await branchCanonHash(repo,p),baseParagraphs:(await repo.listAllParagraphs(p)).filter(p=>!p.deletedAt&&p.kind!=='draft'),status:'active',history:[],createdAt:run.createdAt,fragments:run.fragments.filter(f=>f.status==='draft'||f.status==='applying').map(f=>({id:f.id,paragraphId:null,sectionId:run.sceneId,text:f.text,original:'',originalHash:'',status:'draft'}))});
}
