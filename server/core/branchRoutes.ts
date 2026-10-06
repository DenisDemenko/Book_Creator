import type { Express, Request, Response, RequestHandler } from 'express';
import type { CoreRepository } from './types';
import type { RealtimeAccessDeps } from '../realtimeAuth';
import { resolveProjectAccess, type ProjectAccess } from './projectRoutes';
import { CoreRuleError } from './rules';
import { ChatProviderError } from '../chatProviders';
import { BookRevisionConflict, getBook, type StoredBook } from '../bookStore';
import { assertBranchEditable, branchCanonHash, branchHash, branchSnapshot, checkBranch, createBranch, getBranch, mergeBranchFragment, putBranchFragment, saveBranches } from './branches';
import { cleanFragmentText, refreshSimulationFreshness, validProposalTag } from './interviewProposals';

export interface BranchRoutesDeps {
  repo: () => CoreRepository|null; access: RealtimeAccessDeps; aiGuard?: RequestHandler;
  generate?: (req: Request,context: Record<string,unknown>) => Promise<unknown>;
  onSaved?: (stored: StoredBook,access: ProjectAccess) => void;
}
export function registerBranchRoutes(app: Express,d: BranchRoutesDeps) {
  const base='/api/core/projects/:projectId/branches';
  const handle=(fn:(req:Request,res:Response,repo:CoreRepository,a:ProjectAccess,stored:StoredBook)=>Promise<void>)=>async(req:Request,res:Response)=>{
    try {
      const a=await resolveProjectAccess(req.principal as never,String(req.params.projectId),d.access);
      if(!a){res.status(req.principal&&!req.principal.isGuest?403:401).json({error:'Немає доступу до книги.'});return;}
      if(!a.effective.full){res.status(403).json({error:'Ізольованими гілками керує власник або адміністратор.'});return;}
      const repo=d.repo();if(!repo){res.status(503).json({error:'Ядро гілок недоступне.'});return;}
      const stored=await getBook(a.projectId),owner=await d.access.getCollabOwnerId(a.projectId)??await d.access.getBookOwnerId(a.projectId);
      if(!stored||stored.ownerId!==owner)throw new CoreRuleError('not_found','Збережіть книгу на сервері перед створенням гілки.');
      await fn(req,res,repo,a,stored);
    }catch(err){
      if(err instanceof BookRevisionConflict){res.status(409).json({error:err.message,kind:'conflict',current:err.current});return;}
      if(err instanceof ChatProviderError){res.status(err.status).json({error:err.message});return;}
      if(err instanceof CoreRuleError){res.status(({not_found:404,conflict:409,bad_actor:403,bad_input:400} as Record<string,number>)[err.code]??422).json({error:err.message,kind:err.code});return;}
      console.error('[branches]',err);res.status(500).json({error:'Не вдалося виконати дію з гілкою.'});
    }
  };
  const revision=(n:unknown)=>{if(!Number.isSafeInteger(n)||Number(n)<0)throw new CoreRuleError('bad_input','Потрібна ревізія гілок.');};
  app.get(base,handle(async(_req,res,repo,a,stored)=>{
    const state=await repo.getBranchWorkspace(a.projectId),canonHash=await branchCanonHash(repo,a.projectId);
    res.json({...state,bookRevision:stored.revision,bookHash:branchHash(stored.book),canonHash,
      points:(await repo.listEntities(a.projectId)).filter(e=>e.status==='confirmed'&&['decision','event','threshold','turning-point','consequence'].includes(e.type)).map(e=>({id:e.id,name:e.name,type:e.type})),
      paragraphs:(await repo.listAllParagraphs(a.projectId)).filter(p=>!p.deletedAt&&p.kind!=='draft'),
      sections:(await repo.listDocuments(a.projectId)).filter(d=>d.kind==='section'&&!d.deletedAt)});
  }));
  app.post(base,handle(async(req,res,repo,a,stored)=>{
    revision(req.body?.expectedRevision);
    res.status(201).json(await createBranch(repo,a.projectId,stored,{name:req.body.name,pointEntityId:req.body.pointEntityId,expectedRevision:req.body.expectedRevision},`user:${a.userId}`));
  }));
  app.patch(`${base}/:branchId`,handle(async(req,res,repo,a,_stored)=>{
    revision(req.body?.expectedRevision);const state=await repo.getBranchWorkspace(a.projectId);
    if(state.revision!==req.body.expectedRevision)throw new CoreRuleError('conflict','Гілку вже змінили.');
    const b=getBranch(state,String(req.params.branchId));if(b.fragments.some(f=>f.status==='applying'))throw new CoreRuleError('conflict','Спочатку завершіть перенесення.');
    if(req.body.name!==undefined){if(typeof req.body.name!=='string'||!req.body.name.trim()||req.body.name.length>120)throw new CoreRuleError('bad_input','Некоректна назва.');b.name=req.body.name.trim();}
    if(req.body.status!==undefined){if(!['active','archived'].includes(req.body.status))throw new CoreRuleError('bad_input','Статус — active або archived.');b.status=req.body.status;}
    branchSnapshot(b,`user:${a.userId}`);await saveBranches(repo,a.projectId,state,state.revision);res.json({revision:state.revision,branch:b});
  }));
  app.post(`${base}/:branchId/fragments`,handle(async(req,res,repo,a,_stored)=>{
    revision(req.body?.expectedRevision);
    const {id,paragraphId,sectionId,text,expectedRevision}=req.body??{};
    res.json(await putBranchFragment(repo,a.projectId,String(req.params.branchId),{id,paragraphId,sectionId,text,expectedRevision},`user:${a.userId}`));
  }));
  app.post(`${base}/:branchId/fragments/:fragmentId/reject`,handle(async(req,res,repo,a,_stored)=>{
    revision(req.body?.expectedRevision);const state=await repo.getBranchWorkspace(a.projectId);
    if(state.revision!==req.body.expectedRevision)throw new CoreRuleError('conflict','Гілку вже змінили.');
    const b=getBranch(state,String(req.params.branchId));assertBranchEditable(b);
    const f=b.fragments.find(f=>f.id===req.params.fragmentId);if(!f)throw new CoreRuleError('not_found','Фрагмент не знайдено.');
    if(f.status!=='draft')throw new CoreRuleError('conflict','Фрагмент уже вирішено.');f.status='rejected';
    branchSnapshot(b,`user:${a.userId}`);await saveBranches(repo,a.projectId,state,state.revision);res.json({revision:state.revision,branch:b});
  }));
  app.post(`${base}/:branchId/check`,handle(async(req,res,repo,a,_stored)=>{
    const b=getBranch(await repo.getBranchWorkspace(a.projectId),String(req.params.branchId));res.json(await checkBranch(repo,a.projectId,b));
  }));
  app.post(`${base}/:branchId/fragments/:fragmentId/merge`,handle(async(req,res,repo,a,_stored)=>{
    revision(req.body?.expectedRevision);revision(req.body?.expectedBookRevision);
    const result=await mergeBranchFragment(repo,a.projectId,String(req.params.branchId),String(req.params.fragmentId),req.body,`user:${a.userId}`);
    const fragment=result.branch.fragments.find(f=>f.id===String(req.params.fragmentId));
    if(fragment?.sourceProposalId){
      const proposal=await repo.getCanonProposal(a.projectId,fragment.sourceProposalId);
      if(proposal?.status==='pending')await repo.resolveCanonProposal(a.projectId,proposal.id,{status:'accepted',actor:`user:${a.userId}`,result:{branchId:result.branch.id,sectionId:fragment.sectionId,text:fragment.text,bookRevision:result.stored.revision}});
    }
    d.onSaved?.(result.stored,a);res.json({...result,book:result.stored.book,bookRevision:result.stored.revision,stored:undefined});
  }));
  app.post(`${base}/from-proposal`,handle(async(req,res,repo,a,stored)=>{
    revision(req.body?.expectedRevision);
    const p=await repo.getCanonProposal(a.projectId,String(req.body.proposalId));
    if(!p||p.kind!=='fragment'||p.status!=='pending')throw new CoreRuleError('not_found','Невирішений фрагмент симуляції не знайдено.');
    const originalSim=await repo.getSimulation(a.projectId,p.simulationId);
    if(!originalSim)throw new CoreRuleError('not_found','Симуляцію не знайдено.');
    const sim=await refreshSimulationFreshness(repo,originalSim);
    if(sim.status==='stale'&&req.body.acknowledgeStale!==true)throw new CoreRuleError('conflict','Допит застарів. Підтвердьте його використання.');
    const state=await repo.getBranchWorkspace(a.projectId);
    if(state.revision!==req.body.expectedRevision)throw new CoreRuleError('conflict','Гілки вже змінили.');
    const existing=state.branches.find(b=>b.sourceId===p.id);
    if(existing){res.json({revision:state.revision,branch:existing});return;}
    const children=await repo.listCanonProposals(a.projectId,{simulationId:p.simulationId,kind:'tag',limit:1000});
    const tagIds=req.body.tagIds??[];if(!Array.isArray(tagIds)||tagIds.length>12)throw new CoreRuleError('bad_input','До 12 тегів.');
    const tags=tagIds.map((id:string)=>{const child=children.find(c=>c.id===id&&c.parentId===p.id&&c.status==='pending');if(!child)throw new CoreRuleError('not_found','Тег не належить фрагменту.');return validProposalTag((child.proposedChange as any).tag);}).filter(Boolean);
    const text=cleanFragmentText(req.body.content??(p.proposedChange as any).text);if(!text)throw new CoreRuleError('bad_input','Потрібен текст фрагмента.');
    res.status(201).json(await createBranch(repo,a.projectId,stored,{name:req.body.name??`Чернетка: ${sim.title}`.slice(0,120),expectedRevision:state.revision,source:sim.kind==='scene'?'magic_scene':'interview',sourceId:p.id,initialFragment:{sectionId:req.body.sectionId??sim.sceneId,text:[text,...tags].join(' '),sourceProposalId:p.id}},`user:${a.userId}`));
  }));
  app.post(`${base}/:branchId/hypotheses`,...(d.aiGuard?[d.aiGuard]:[]),handle(async(req,res,repo,a,_stored)=>{
    const b=getBranch(await repo.getBranchWorkspace(a.projectId),String(req.params.branchId));assertBranchEditable(b);
    if(!d.generate){res.status(503).json({error:'AI-гіпотези не налаштовані.'});return;}
    const checks=await checkBranch(repo,a.projectId,b);
    const result=await d.generate(req,{name:b.name,point:b.pointEntityId?await repo.getEntity(a.projectId,b.pointEntityId):null,fragments:b.fragments,checks,source:b.baseParagraphs.slice(0,50).map(p=>p.text).join('\n\n').slice(0,12000)});
    const list=(result as any)?.hypotheses;
    if(!Array.isArray(list)||list.some(x=>!x||typeof x.text!=='string'||typeof x.reason!=='string'))throw new CoreRuleError('bad_input','Модель не повернула гіпотези.');
    res.json({hypotheses:list.slice(0,3).map(x=>({text:x.text.slice(0,6000),reason:x.reason.slice(0,1000)})),rule:'Гіпотези не збережено. Автор обирає, що взяти до чернетки.'});
  }));
}
