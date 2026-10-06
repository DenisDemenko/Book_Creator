import {randomUUID} from 'node:crypto';
import type {Express,Request,Response,RequestHandler} from 'express';
import type {CoreRepository} from './types';
import type {RealtimeAccessDeps} from '../realtimeAuth';
import {resolveProjectAccess,type ProjectAccess} from './projectRoutes';
import {canRead,canWrite,sceneLevel,entityLevel} from './collaboration/access';
import {CoreRuleError} from './rules';
import {ChatProviderError} from '../chatProviders';
import {getBook} from '../bookStore';
import {createBranch,branchHash} from './branches';
import {MASTERY_SKILLS,type MasteryExercise,type MasteryWorkspace} from './masteryTypes';
export interface MasteryRoutesDeps {repo:()=>CoreRepository|null;access:RealtimeAccessDeps;aiGuard?:RequestHandler;generate?:(req:Request,context:Record<string,unknown>)=>Promise<unknown>}
export function registerMasteryRoutes(app:Express,d:MasteryRoutesDeps){
 const base='/api/core/projects/:projectId/mastery';
 const handle=(fn:(req:Request,res:Response,repo:CoreRepository,a:ProjectAccess)=>Promise<void>)=>async(req:Request,res:Response)=>{try{
  const a=await resolveProjectAccess(req.principal as never,String(req.params.projectId),d.access);
  if(!a){res.status(req.principal&&!req.principal.isGuest?403:401).json({error:'Немає доступу до книги.'});return;}
  if(!a.effective.full&&!a.effective.canWriteAny)throw new CoreRuleError('bad_actor','Потрібен доступ до авторської роботи.');
  const repo=d.repo();if(!repo){res.status(503).json({error:'Ядро вправ недоступне.'});return;}await fn(req,res,repo,a);
 }catch(err){if(err instanceof ChatProviderError){res.status(err.status).json({error:err.message});return;}if(err instanceof CoreRuleError){res.status(({not_found:404,conflict:409,bad_actor:403,bad_input:400} as Record<string,number>)[err.code]??422).json({error:err.message});return;}console.error('[mastery]',err);res.status(500).json({error:'Не вдалося виконати дію з вправами.'});}};
 const material=async(repo:CoreRepository,a:ProjectAccess)=>{
  const documents=(await repo.listDocuments(a.projectId)).filter(d=>d.kind==='section'&&!d.deletedAt&&canWrite(sceneLevel(a.effective,d.parentId??'',d.id)));
  const sections=new Set(documents.map(d=>d.id));const paragraphs=(await repo.listAllParagraphs(a.projectId)).filter(p=>!p.deletedAt&&p.kind!=='draft'&&sections.has(p.documentId));
  const characters=(await repo.listEntities(a.projectId)).filter(e=>e.type==='character'&&e.status==='confirmed'&&canRead(entityLevel(a.effective,e.type,e.id)));
  return{documents,paragraphs,characters};
 };
 const source=async(repo:CoreRepository,a:ProjectAccess,target:MasteryExercise['target'],cached?:Awaited<ReturnType<typeof material>>)=>{
  if(!target||!['paragraph','scene','character'].includes(target.kind)||typeof target.id!=='string')throw new CoreRuleError('bad_input','Оберіть абзац, сцену або героя.');
  const m=cached??await material(repo,a);let text:string|undefined;
  if(target.kind==='paragraph')text=m.paragraphs.find(p=>p.id===target.id)?.text;
  if(target.kind==='scene'&&m.documents.some(x=>x.id===target.id))text=m.paragraphs.filter(p=>p.documentId===target.id).sort((a,b)=>a.order-b.order).map(p=>p.text).join('\n\n');
  if(target.kind==='character'){const e=m.characters.find(e=>e.id===target.id);if(e)text=JSON.stringify({name:e.name,canonical:e.canonical});}
  if(!text?.trim())throw new CoreRuleError('not_found','Матеріал відсутній або недоступний.');
  return{text:text.slice(0,30000),hash:branchHash(text)};
 };
 const state=async(repo:CoreRepository,a:ProjectAccess,expected:unknown)=>{if(!Number.isSafeInteger(expected)||Number(expected)<0)throw new CoreRuleError('bad_input','Потрібна ревізія вправ.');const s=await repo.getMasteryWorkspace(a.projectId,a.userId);if(s.revision!==expected)throw new CoreRuleError('conflict','Вправи вже змінили. Оновіть сторінку.');return s;};
 const persist=async(repo:CoreRepository,a:ProjectAccess,s:MasteryWorkspace)=>{if(Buffer.byteLength(JSON.stringify(s))>2*1024*1024)throw new CoreRuleError('bad_input','Історія вправ перевищила 2 MiB.');const expected=s.revision;s.revision++;await repo.saveMasteryWorkspace(a.projectId,a.userId,s,expected);return s;};
 const exercise=(s:MasteryWorkspace,id:string)=>{const e=s.exercises.find(e=>e.id===id);if(!e)throw new CoreRuleError('not_found','Вправу не знайдено.');return e;};
 const editable=(e:MasteryExercise)=>{if(e.status==='rejected')throw new CoreRuleError('conflict','Вправу відхилено. Створіть іншу.');};
 app.get(base,handle(async(_req,res,repo,a)=>{
  const s=await repo.getMasteryWorkspace(a.projectId,a.userId),m=await material(repo,a),visible:any[]=[];
  for(const e of s.exercises){try{const current=await source(repo,a,e.target,m);visible.push({...e,needsUpdate:current.hash!==e.sourceHash});}catch(err){if(!(err instanceof CoreRuleError))throw err;if(a.effective.full&&err.code==='not_found')visible.push({...e,needsUpdate:true});}}
  res.json({...s,canBranch:a.effective.full,exercises:visible,catalog:MASTERY_SKILLS,targets:{paragraphs:m.paragraphs.map(p=>({id:p.id,sectionId:p.documentId,text:p.text.slice(0,160)})),scenes:m.documents.map(d=>({id:d.id,title:d.title??d.id})),characters:m.characters.map(e=>({id:e.id,name:e.name}))},progress:MASTERY_SKILLS.map(skill=>({skill:skill.id,completed:visible.filter(e=>e.skill===skill.id&&e.status==='completed').length,total:visible.filter(e=>e.skill===skill.id&&e.status!=='rejected').length})),progressRule:'Кількість виконаних вправ — не оцінка літературної якості.'});
 }));
 app.put(`${base}/plan`,handle(async(req,res,repo,a)=>{const s=await state(repo,a,req.body?.expectedRevision),skills=req.body?.skills,goal=req.body?.goal;
  if(!Array.isArray(skills)||skills.length>6||skills.some(x=>!MASTERY_SKILLS.some(s=>s.id===x))||typeof goal!=='string'||goal.length>500)throw new CoreRuleError('bad_input','Некоректний навчальний план.');
  s.plan={skills:[...new Set(skills)],goal};res.json(await persist(repo,a,s));
 }));
 app.post(`${base}/exercises`,handle(async(req,res,repo,a)=>{const s=await state(repo,a,req.body?.expectedRevision),skill=MASTERY_SKILLS.find(s=>s.id===req.body?.skill),depth=req.body?.depth,genre=req.body?.genre;
  if(!skill||!['short','deep'].includes(depth)||typeof genre!=='string'||!genre.trim()||genre.length>120)throw new CoreRuleError('bad_input','Оберіть навичку, тривалість і жанр.');
  if(s.exercises.length>=100)throw new CoreRuleError('bad_input','До 100 вправ у проєкті.');const target={kind:req.body?.target?.kind,id:req.body?.target?.id},m=await source(repo,a,target);
  const now=new Date().toISOString();const e:MasteryExercise={id:randomUUID(),skill:skill.id,depth,genre:genre.trim(),target,source:m.text,sourceHash:m.hash,instruction:`${skill.task}\n${depth==='short'?'Працюйте 5–10 хвилин над одним поворотом.':'Працюйте 20–30 хвилин: змініть прийом у двох варіантах і поясніть художній вибір.'}\nМатеріал: ${target.kind} · ${target.id}. Жанр: ${genre.trim()}. Пишіть дві власні редакції, зберігаючи задум.`,questions:[...skill.questions],status:'open',versions:[],events:[{action:'created',at:now}],createdAt:now};
  s.exercises.push(e);await persist(repo,a,s);res.status(201).json({revision:s.revision,exercise:e});
 }));
 app.post(`${base}/exercises/:id/versions`,handle(async(req,res,repo,a)=>{const s=await state(repo,a,req.body?.expectedRevision),e=exercise(s,String(req.params.id));editable(e);await source(repo,a,e.target);
  const {slot,text}=req.body??{};if(!['A','B'].includes(slot)||typeof text!=='string'||!text.trim()||text.length>50000||e.versions.length>=200)throw new CoreRuleError('bad_input','Редакція A або B: до 50000 символів; до 200 версій.');
  e.versions.push({id:randomUUID(),slot,text,at:new Date().toISOString()});e.status='open';e.events.push({action:`saved_${slot}`,at:new Date().toISOString()});await persist(repo,a,s);res.json({revision:s.revision,exercise:e});
 }));
 app.post(`${base}/exercises/:id/status`,handle(async(req,res,repo,a)=>{const s=await state(repo,a,req.body?.expectedRevision),e=exercise(s,String(req.params.id));editable(e);const current=await source(repo,a,e.target),status=req.body?.status,reason=req.body?.reason;
  if(!['completed','rejected'].includes(status))throw new CoreRuleError('bad_input','Статус completed або rejected.');
  if(status==='completed'){if(current.hash!==e.sourceHash)throw new CoreRuleError('conflict','Матеріал змінився. Створіть вправу на актуальній основі.');const a=e.versions.filter(v=>v.slot==='A').at(-1),b=e.versions.filter(v=>v.slot==='B').at(-1);if(!a||!b||a.text.trim()===b.text.trim())throw new CoreRuleError('bad_input','Потрібні дві різні авторські редакції.');}
  if(status==='rejected'&&(typeof reason!=='string'||!reason.trim()||reason.length>1000))throw new CoreRuleError('bad_input','Поясніть, чому вправа не відповідає задуму.');
  e.status=status;e.events.push({action:status,at:new Date().toISOString(),...(status==='rejected'?{reason:reason.trim()}:{})});await persist(repo,a,s);res.json({revision:s.revision,exercise:e});
 }));
 app.post(`${base}/exercises/:id/branch`,handle(async(req,res,repo,a)=>{
  if(!a.effective.full)throw new CoreRuleError('bad_actor','Перенесення до гілки підтверджує власник або адміністратор.');
  if(req.body?.confirm!==true)throw new CoreRuleError('bad_input','Підтвердьте створення гілки з цією редакцією.');
  const s=await state(repo,a,req.body?.expectedRevision),e=exercise(s,String(req.params.id));editable(e);const current=await source(repo,a,e.target);
  if(current.hash!==e.sourceHash)throw new CoreRuleError('conflict','Матеріал вправи змінився.');
  const v=e.versions.find(v=>v.id===req.body?.versionId);if(!v)throw new CoreRuleError('not_found','Авторську редакцію не знайдено.');
  const stored=await getBook(a.projectId),owner=await d.access.getCollabOwnerId(a.projectId)??await d.access.getBookOwnerId(a.projectId);
  if(!stored||stored.ownerId!==owner)throw new CoreRuleError('not_found','Збережіть книгу на сервері.');
  const p=e.target.kind==='paragraph'?await repo.getParagraph(a.projectId,e.target.id):null;
  const sectionId=p?.documentId??(e.target.kind==='scene'?e.target.id:req.body?.sectionId);
  if(!Number.isSafeInteger(req.body?.expectedBranchRevision)||req.body.expectedBranchRevision<0)throw new CoreRuleError('bad_input','Потрібна ревізія гілок.');
  res.status(201).json(await createBranch(repo,a.projectId,stored,{name:`Вправа: ${e.skill} · ${v.slot}`,expectedRevision:req.body.expectedBranchRevision,initialFragment:{sectionId,text:v.text,paragraphId:p?.id}},`user:${a.userId}`));
 }));
 app.post(`${base}/exercises/:id/mentor`,...(d.aiGuard?[d.aiGuard]:[]),handle(async(req,res,repo,a)=>{
  const s=await state(repo,a,req.body?.expectedRevision),e=exercise(s,String(req.params.id));editable(e);const current=await source(repo,a,e.target);if(current.hash!==e.sourceHash)throw new CoreRuleError('conflict','Матеріал вправи змінився.');
  const mode=req.body?.mode??'questions';if(!['questions','rewrite'].includes(mode)||(mode==='rewrite'&&req.body?.confirm!==true))throw new CoreRuleError('bad_input','Готову правку потрібно явно запросити.');
  if(!d.generate){res.status(503).json({error:'AI-наставник не налаштований.'});return;}
  const result:any=await d.generate(req,{mode,skill:e.skill,genre:e.genre,depth:e.depth,source:e.source,versions:e.versions.filter(v=>v.slot==='A').slice(-1).concat(e.versions.filter(v=>v.slot==='B').slice(-1)),sampleCharacters:e.source.length,instruction:e.instruction});
  if((await repo.getMasteryWorkspace(a.projectId,a.userId)).revision!==s.revision||(await source(repo,a,e.target)).hash!==current.hash)throw new CoreRuleError('conflict','Вправа змінилася під час відповіді наставника.');
  if(mode==='questions'){if(!Array.isArray(result?.questions)||!result.questions.length||result.questions.length>5||result.questions.some((x:unknown)=>typeof x!=='string'||x.length>1000||!x.trim()))throw new CoreRuleError('bad_input','Наставник має повернути 1–5 запитань.');res.json({questions:result.questions,notice:'Це запитання, а не оцінка якості. Жанр і обсяг матеріалу враховані в контексті.'});}
  else{if(typeof result?.rewrite!=='string'||!result.rewrite.trim()||result.rewrite.length>50000)throw new CoreRuleError('bad_input','Некоректна пропозиція правки.');res.json({rewrite:result.rewrite,notice:'Пропозицію не збережено й не перенесено до рукопису.'});}
 }));
}
