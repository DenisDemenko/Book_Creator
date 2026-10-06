import {scheduleScene} from './sceneScheduler';
import type {Express,Request,Response,RequestHandler} from 'express';
import type {CoreRepository} from './types';import type {RealtimeAccessDeps} from '../realtimeAuth';
import {resolveProjectAccess,type ProjectAccess} from './projectRoutes';import {CoreRuleError} from './rules';import {ChatProviderError} from '../chatProviders';
import {getBook} from '../bookStore';import {startMagic,getMagic,stepMagic,draftMagic,pauseMagic,approveMagic,rejectMagic,checkMagic,type MagicSceneDeps} from './magicScene';
import {setAgent} from './interview';
export interface MagicRoutesDeps {repo:()=>CoreRepository|null;access:RealtimeAccessDeps;aiGuard?:RequestHandler;engines:(req:Request,repo:CoreRepository,a:ProjectAccess)=>Promise<Omit<MagicSceneDeps,'repo'>>}
export function registerMagicSceneRoutes(app:Express,d:MagicRoutesDeps){
 const base='/api/core/projects/:projectId';
 const handle=(fn:(req:Request,res:Response,repo:CoreRepository,a:ProjectAccess)=>Promise<void>)=>async(req:Request,res:Response)=>{res.set('Cache-Control','no-store');try{
  const a=await resolveProjectAccess(req.principal as never,String(req.params.projectId),d.access);if(!a){res.status(req.principal&&!req.principal.isGuest?403:401).json({error:'Немає доступу до книги.'});return;}
  if(!a.effective.full)throw new CoreRuleError('bad_actor','Приватні протоколи й затвердження Magic Scene доступні власнику та адміністратору.');
  const repo=d.repo();if(!repo){res.status(503).json({error:'Ядро Magic Scene недоступне.'});return;}
  const stored=await getBook(a.projectId),owner=await d.access.getCollabOwnerId(a.projectId)??await d.access.getBookOwnerId(a.projectId);
  if(!stored||stored.ownerId!==owner)throw new CoreRuleError('not_found','Збережіть книгу на сервері.');await fn(req,res,repo,a);
 }catch(err){if(err instanceof ChatProviderError){res.status(err.status).json({error:err.message});return;}if(err instanceof CoreRuleError){res.status(({not_found:404,conflict:409,bad_input:400,bad_actor:403} as Record<string,number>)[err.code]??422).json({error:err.message,kind:err.code});return;}res.status(500).json({error:'Не вдалося виконати дію Magic Scene.'});}};
 const engines=async(req:Request,repo:CoreRepository,a:ProjectAccess):Promise<MagicSceneDeps>=>{const access=await resolveProjectAccess(req.principal as never,a.projectId,d.access);if(!access?.effective.full)throw new CoreRuleError('bad_actor','Доступ відкликано.');return {repo,...await d.engines(req,repo,a),authorizeTools:async scope=>{const current=await resolveProjectAccess(req.principal as never,scope.projectId,d.access);return !!current?.effective.full&&scope.projectId===a.projectId&&scope.actorId===`user:${a.userId}`;}};};
 const ai=d.aiGuard?[d.aiGuard]:[];
 app.get(`${base}/magic-scenes`,handle(async(_req,res,repo,a)=>{
  const docs=(await repo.listDocuments(a.projectId)).filter(d=>d.kind==='section'&&!d.deletedAt),entities=(await repo.listEntities(a.projectId)).filter(e=>e.type==='character'&&e.status==='confirmed');
  const characters=await Promise.all(entities.map(async e=>({id:e.id,name:e.name,agent:await repo.getCharacterAgent(a.projectId,e.id)})));
  const runs=[];for(const sim of await repo.listSimulations(a.projectId,{kind:'scene',limit:100})){const run=await repo.getMagicSceneRun(a.projectId,sim.id);if(run)runs.push(run);}
  const branches=await repo.getBranchWorkspace(a.projectId),stored=(await getBook(a.projectId))!;
  res.json({scenes:docs.map(d=>({id:d.id,title:d.title??d.id})),characters,runs,bookRevision:stored.revision,branchRevision:branches.revision});
 }));
 app.post(`${base}/magic-scenes/agents`,handle(async(req,res,repo,a)=>{
  const ids=req.body?.characterIds;if(!Array.isArray(ids)||ids.length<2||ids.length>3||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new CoreRuleError('bad_input','Оберіть 2–3 героїв.');
  for(const id of ids){const e=await repo.getEntity(a.projectId,id);if(!e||e.type!=='character'||e.status!=='confirmed')throw new CoreRuleError('bad_input','Потрібні підтверджені герої.');}
  for(const id of ids)await setAgent(repo,a.projectId,id,{autonomyLevel:'scene'},`user:${a.userId}`);res.json({ok:true});
 }));
 app.post(`${base}/scenes/:sceneId/simulations`,handle(async(req,res,repo,a)=>{res.status(201).json({run:await startMagic(repo,a.projectId,String(req.params.sceneId),req.body,`user:${a.userId}`)});}));
 const runBase=`${base}/simulations/:simulationId`;
 app.get(`${runBase}/events`,handle(async(req,res,repo,a)=>{const run=await getMagic(repo,a.projectId,String(req.params.simulationId));res.json({run,events:run.events,privateSteps:run.privateSteps});}));
 app.post(`${runBase}/step`,...ai,handle(async(req,res,repo,a)=>{res.json({run:await scheduleScene(a.projectId,async()=>stepMagic(await engines(req,repo,a),a.projectId,String(req.params.simulationId),req.body,`user:${a.userId}`))});}));
 app.post(`${runBase}/pause`,handle(async(req,res,repo,a)=>{const status=req.body?.status??'paused';if(!['active','paused'].includes(status))throw new CoreRuleError('bad_input','Статус active або paused.');res.json({run:await pauseMagic(repo,a.projectId,String(req.params.simulationId),req.body?.expectedRevision,status)});}));
 app.post(`${runBase}/check`,handle(async(req,res,repo,a)=>{res.json(await checkMagic(repo,a.projectId,await getMagic(repo,a.projectId,String(req.params.simulationId))));}));
 app.post(`${runBase}/draft`,...ai,handle(async(req,res,repo,a)=>{res.json({run:await scheduleScene(a.projectId,async()=>draftMagic(await engines(req,repo,a),a.projectId,String(req.params.simulationId),req.body))});}));
 app.post(`${runBase}/draft-stream`,...ai,handle(async(req,res,repo,a)=>{
  // Only complete, validated fragments enter the stream. Never expose raw model tokens.
  const run=await scheduleScene(a.projectId,async()=>draftMagic(await engines(req,repo,a),a.projectId,String(req.params.simulationId),req.body));
  const current=await resolveProjectAccess(req.principal as never,a.projectId,d.access);if(!current?.effective.full)throw new CoreRuleError('bad_actor','Доступ відкликано.');
  res.status(200).set({'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders();
  for(const fragment of run.fragments){if(res.destroyed)return;res.write(JSON.stringify({type:'fragment',fragment})+'\n');await new Promise<void>(resolve=>setImmediate(resolve));}
  res.end(JSON.stringify({type:'complete',revision:run.revision})+'\n');
 }));
 app.post(`${runBase}/approve`,handle(async(req,res,repo,a)=>{res.json(await approveMagic(await engines(req,repo,a),a.projectId,String(req.params.simulationId),String(req.body?.fragmentId),req.body,`user:${a.userId}`));}));
 app.post(`${runBase}/reject`,handle(async(req,res,repo,a)=>{res.json({run:await rejectMagic(repo,a.projectId,String(req.params.simulationId),String(req.body?.fragmentId),req.body?.expectedRevision)});}));
}
