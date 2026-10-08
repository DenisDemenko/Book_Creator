import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { CoreRepository } from '../types';
import type { RealtimeAccessDeps } from '../../realtimeAuth';
import { getAsset, listAssets } from '../../media/mediaLibraryStore';
import { getBook, type StoredBook } from '../../bookStore';
import { resolveProjectAccess, type ProjectAccess } from '../projectRoutes';
import { entityLevel, levelRank, sceneLevel } from './access';
import { ensureDeadlineNotices, readWorkNotice, saveWorkItem, workItems, workNotices, WorkspaceError, type WorkTarget, type WorkItem } from './workspaceStore';

interface Deps { access: RealtimeAccessDeps; repo: () => CoreRepository | null; describeUser?: (userId:string)=>Promise<string|null> }
export async function collaborationTargetLevel(target: WorkTarget, a: ProjectAccess, book: StoredBook, repo: CoreRepository): Promise<number> {
    if (!target || typeof target !== 'object') return 0;
    switch(target.kind) {
      case 'book': return levelRank(a.effective.book);
      case 'chapter': return (book.book.chapters as any[])?.some(c=>c.id===target.id) ? Math.max(levelRank(a.effective.book),levelRank(a.effective.chapters[target.id])) : 0;
      case 'scene': return (book.book.chapters as any[])?.find(c=>c.id===target.chapterId)?.sections?.some((s:any)=>s.id===target.id) ? levelRank(sceneLevel(a.effective,target.chapterId,target.id)) : 0;
      case 'paragraph': {
        const section=(book.book.chapters as any[])?.find(c=>c.id===target.chapterId)?.sections?.find((s:any)=>s.id===target.sectionId);
        const p=section && await repo.getParagraph(a.projectId,target.id);
        return p && !p.deletedAt && p.documentId===target.sectionId && (!section.paragraphIds?.length || section.paragraphIds.includes(p.editorPid??p.id)) ? levelRank(sceneLevel(a.effective,target.chapterId,target.sectionId)) : 0;
      }
      case 'entity': { const e = await repo.getEntity(a.projectId,target.id); return e && e.status !== 'rejected' ? levelRank(entityLevel(a.effective,e.type,e.id)) : 0; }
      case 'material': { const m = await getAsset(target.id); const exists = m && m.bookId === a.projectId && m.ownerId === book.ownerId || (book.book.illustrations as any[])?.some(m=>m.id===target.id); return exists ? a.effective.full ? 7 : a.effective.media === 'work' ? 2 : a.effective.media === 'view' ? 1 : 0 : 0; }
      default: return 0;
    }
  }

export function registerCollaborationWorkspaceRoutes(app: Express, deps: Deps) {
  const base = '/api/core/projects/:projectId/collaboration';
  const handle = (fn:(req:Request,res:Response,a:ProjectAccess,b:StoredBook,r:CoreRepository)=>Promise<void>) => async(req:Request,res:Response)=> {
    res.set('Cache-Control','no-store');
    try {
      const a = await resolveProjectAccess(req.principal as never,String(req.params.projectId),deps.access);
      if(!a) throw new WorkspaceError(req.principal && !req.principal.isGuest ? 403 : 401,'Немає доступу до проєкту.');
      const b = await getBook(a.projectId); const r = deps.repo();
      const owner = await deps.access.getCollabOwnerId(a.projectId) ?? await deps.access.getBookOwnerId(a.projectId);
      if(!b || b.ownerId !== owner) throw new WorkspaceError(404,'Серверну книгу не знайдено.');
      if(!r) throw new WorkspaceError(503,'Ядро недоступне.');
      await fn(req,res,a,b,r);
    } catch(e) { if(e instanceof WorkspaceError) res.status(e.status).json({error:e.message}); else { console.error('[collaboration-workspace]',e); res.status(500).json({error:'Не вдалося виконати дію співпраці.'}); } }
  };
  const targets = async(a:ProjectAccess,b:StoredBook,r:CoreRepository)=> {
    const candidates:Array<{target:WorkTarget;label:string}> = [{target:{kind:'book'},label:'Уся книга'}];
    for(const c of b.book.chapters as any[] ?? []) {
      candidates.push({target:{kind:'chapter',id:c.id},label:c.title ?? c.id});
      for(const s of c.sections ?? []) {
        candidates.push({target:{kind:'scene',id:s.id,chapterId:c.id},label:`${c.title ?? c.id} / ${s.title ?? s.id}`});
        if(levelRank(sceneLevel(a.effective,c.id,s.id))>0) for(const p of await r.listParagraphs(a.projectId,s.id)) candidates.push({target:{kind:'paragraph',id:p.id,chapterId:c.id,sectionId:s.id},label:`${s.title ?? s.id}: ${p.text.slice(0,80)}`});
      }
    }
    for(const e of await r.listEntities(a.projectId)) if(e.status !== 'rejected') candidates.push({target:{kind:'entity',id:e.id},label:e.name});
    for(const m of b.book.illustrations as any[] ?? []) candidates.push({target:{kind:'material',id:m.id},label:m.title ?? m.name ?? m.id});
    for(const m of await listAssets(b.ownerId,{bookId:a.projectId})) if(!candidates.some(c=>c.target.kind==='material'&&c.target.id===m.id)) candidates.push({target:{kind:'material',id:m.id},label:m.title || m.filename});
    const out = [];
    for(const c of candidates) { const rank = await collaborationTargetLevel(c.target,a,b,r); if(rank>0) out.push({...c,canComment:rank>=2}); }
    return out;
  };
  app.get(base,handle(async(_req,res,a,b,r)=> {
    const visible: WorkItem[] = [];
    for(const item of workItems(a.projectId)) if(await collaborationTargetLevel(item.target,a,b,r)>0) visible.push(item);
    const ids = new Set(visible.map(i=>i.id));
    ensureDeadlineNotices(a.projectId,a.userId,visible);
    const people = (await r.listParticipants(a.projectId)).filter(p=>p.status==='active');
    const users=[...new Set([b.ownerId,...people.map(p=>p.userId)].filter(Boolean))];
    const names:Record<string,string>={};
    for(const id of users) names[id]=await deps.describeUser?.(id) ?? id;
    res.json({userId:a.userId,canRestore:a.isOwner || a.role==='admin',canManage:a.effective.full || a.effective.book === 'manage',
      names,targets:await targets(a,b,r), items:visible.sort((x,y)=>y.createdAt.localeCompare(x.createdAt)),
      participants:users,
      notifications:workNotices(a.projectId,a.userId).filter(n=>ids.has(n.itemId) && (n.kind!=='overdue' || visible.some(i=>i.id===n.itemId&&i.status==='open'&&i.assigneeId===a.userId&&n.id===`due:${i.id}:${i.dueAt}`))).sort((x,y)=>y.createdAt.localeCompare(x.createdAt))});
  }));
  app.get(`${base}/target`,handle(async(req,res,a,b,r)=> {
    const target:WorkTarget = {kind:String(req.query.kind) as WorkTarget['kind'],id:String(req.query.id ?? ''),chapterId:String(req.query.chapterId ?? ''),sectionId:String(req.query.sectionId ?? '')};
    if (!await collaborationTargetLevel(target,a,b,r)) throw new WorkspaceError(404,'Ціль не знайдено.');
    if(target.kind==='paragraph') {const p=await r.getParagraph(a.projectId,target.id);res.json({kind:'paragraph',paragraph:{chapterId:target.chapterId,sectionId:target.sectionId,editorPid:p.editorPid??p.id,text:p.text}});}
    else if(target.kind==='entity') { const e=await r.getEntity(a.projectId,target.id); res.json({kind:'entity',entity:e}); }
    else if(target.kind==='material') { const m=await getAsset(target.id);const item=m && m.bookId===a.projectId && m.ownerId===b.ownerId ? {id:m.id,title:m.title||m.filename,url:m.url} : (b.book.illustrations as any[]).find(m=>m.id===target.id);res.json({kind:'material',material:item}); }
    else res.json({kind:target.kind});
  }));
  async function recipients(item: WorkItem,a:ProjectAccess,b:StoredBook,r:CoreRepository) {
    const out:string[]=[];
    const subscribers = item.kind === 'comment' ? (await r.listParticipants(a.projectId)).filter(p=>p.status==='active').map(p=>p.userId) : [];
    const ids = new Set([b.ownerId,item.authorId,item.assigneeId,...subscribers].filter(Boolean));
    for(const id of ids) {
      if(id===a.userId) continue;
      // Never use an assignee supplied by the client as an authorization principal.
      const eff = id===b.ownerId ? null : await deps.access.effectiveAccess?.({projectId:a.projectId,userId:id,invite:null});
      if(id===b.ownerId) out.push(id);
      else if(eff && eff !== 'unavailable') {
        const access:ProjectAccess = {projectId:a.projectId,userId:id,role:'participant',isOwner:false,canWrite:false,effective:eff};
        if(await collaborationTargetLevel(item.target,access,b,r)>0) out.push(id);
      }
    }
    return out;
  }
  async function assignee(id:unknown,target:WorkTarget,a:ProjectAccess,b:StoredBook,r:CoreRepository) {
    if(typeof id !== 'string' || !id || id.length>200) throw new WorkspaceError(400,'Оберіть виконавця.');
    if(id===b.ownerId) return id;
    const p = await r.getParticipant(a.projectId,id);
    if(!p || p.status!=='active') throw new WorkspaceError(400,'Виконавець має бути активним учасником.');
    const eff = await deps.access.effectiveAccess?.({projectId:a.projectId,userId:id,invite:null});
    if(!eff || eff==='unavailable' || !await collaborationTargetLevel(target,{...a,userId:id,isOwner:false,effective:eff},b,r)) throw new WorkspaceError(403,'Виконавцю недоступна ціль завдання.');
    return id;
  }
  const text = (v:unknown)=> { if(typeof v !== 'string' || !v.trim() || v.length>4000) throw new WorkspaceError(400,'Текст має містити від 1 до 4000 символів.'); return v.trim(); };
  const due = (v:unknown)=> { if(v===null || v===undefined || v==='') return null; if(typeof v!=='string'||v.length>40||!Number.isFinite(Date.parse(v))) throw new WorkspaceError(400,'Некоректний строк.'); return new Date(v).toISOString(); };
  const manage = (a:ProjectAccess)=> a.effective.full || a.effective.book==='manage';
  app.post(`${base}/items`,handle(async(req,res,a,b,r)=> {
    const body=req.body ?? {}; const target:WorkTarget=body.target;
    if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(k=>!['kind','id','chapterId','sectionId'].includes(k)) || target.kind !== 'book' && (typeof target.id !== 'string' || !target.id || target.id.length>200) || ['scene','paragraph'].includes(target.kind) && (typeof target.chapterId !== 'string' || !target.chapterId || target.chapterId.length>200)) throw new WorkspaceError(400,'Некоректна ціль запису.');
    if(target.kind==='book' && Object.keys(target).length!==1 || target.kind!=='paragraph' && target.sectionId!==undefined || !['scene','paragraph'].includes(target.kind) && target.chapterId!==undefined) throw new WorkspaceError(400,'Зайві поля цілі.');
    if(target.kind==='paragraph' && (typeof target.sectionId!=='string'||!target.sectionId||target.sectionId.length>200)) throw new WorkspaceError(400,'Потрібна сцена абзацу.');
    if(await collaborationTargetLevel(target,a,b,r)<2) throw new WorkspaceError(403,'Немає права коментувати цю ціль.');
    if(!['comment','task'].includes(body.kind)) throw new WorkspaceError(400,'Невідомий тип запису.');
    if(body.kind==='task' && !manage(a)) throw new WorkspaceError(403,'Завдання створює керівник проєкту.');
    const at=new Date().toISOString();
    const item:WorkItem={id:randomUUID(),kind:body.kind,target:{kind:target.kind,...(target.id?{id:target.id}:{}),...(target.chapterId?{chapterId:target.chapterId}:{}),...(target.sectionId?{sectionId:target.sectionId}:{})},text:text(body.text),authorId:a.userId,assigneeId:body.kind==='task'?await assignee(body.assigneeId,target,a,b,r):null,dueAt:body.kind==='task'?due(body.dueAt):null,status:'open',version:1,createdAt:at,updatedAt:at};
    saveWorkItem(a.projectId,item,null,await recipients(item,a,b,r)); res.status(201).json({item});
  }));
  app.patch(`${base}/items/:id`,handle(async(req,res,a,b,r)=> {
    const item=workItems(a.projectId).find(i=>i.id===req.params.id);
    if(!item || !await collaborationTargetLevel(item.target,a,b,r)) throw new WorkspaceError(404,'Запис не знайдено.');
    const body=req.body ?? {}; const keys=Object.keys(body);
    if(keys.length<2 || keys.some(k=>!['expectedVersion','text','status','assigneeId','dueAt'].includes(k)) || (!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)) throw new WorkspaceError(400,'Потрібні версія та дозволені поля.');
    if(!manage(a)) {
      if(item.kind==='comment' ? item.authorId!==a.userId || await collaborationTargetLevel(item.target,a,b,r)<2 : item.assigneeId!==a.userId || keys.some(k=>!['expectedVersion','status'].includes(k))) throw new WorkspaceError(403,'Немає права змінювати цей запис.');
    }
    if(body.status!==undefined && !['open','done'].includes(body.status)) throw new WorkspaceError(400,'Невідомий стан.');
    if(item.kind==='comment' && (body.assigneeId!==undefined||body.dueAt!==undefined)) throw new WorkspaceError(400,'Виконавець і строк стосуються завдання.');
    const next={...item,version:item.version+1,updatedAt:new Date().toISOString(),
      ...(body.text!==undefined?{text:text(body.text)}:{}),...(body.status!==undefined?{status:body.status}:{}),
      ...(body.assigneeId!==undefined?{assigneeId:await assignee(body.assigneeId,item.target,a,b,r)}:{}),...(body.dueAt!==undefined?{dueAt:due(body.dueAt)}:{})};
    saveWorkItem(a.projectId,next,body.expectedVersion,await recipients(next,a,b,r)); res.json({item:next});
  }));
  app.post(`${base}/notifications/:id/read`,handle(async(req,res,a,b,r)=> {
    const notice=workNotices(a.projectId,a.userId).find(n=>n.id===req.params.id);
    const item=notice && workItems(a.projectId).find(i=>i.id===notice.itemId);
    if(!item || !await collaborationTargetLevel(item.target,a,b,r)) throw new WorkspaceError(404,'Сповіщення не знайдено.');
    readWorkNotice(a.projectId,a.userId,String(req.params.id)); res.json({ok:true});
  }));
}
