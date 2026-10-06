import type { Express, Request, Response, RequestHandler } from 'express';
import type { CoreRepository } from './types';
import { resolveProjectAccess, type ProjectAccess } from './projectRoutes';
import type { RealtimeAccessDeps } from '../realtimeAuth';
import { canRead, canWrite, sceneLevel, entityLevel } from './collaboration/access';
import { rolesOf } from './collaboration/participants';
import { CoreRuleError } from './rules';
import { ChatProviderError } from '../chatProviders';
import { glossaryHash, saveTranslation, translationLanguage, translationView, updateGlossary, validateTranslation } from './translation';
import { getBook } from '../bookStore';
import { markerStringToTiptapDoc, tiptapDocToMarkerBlocks } from '../../src/utils/manuscriptDoc';

export interface TranslationRoutesDeps {
  repo: () => CoreRepository|null; access: RealtimeAccessDeps; aiGuard?: RequestHandler;
  generate?: (req: Request, context: Record<string, unknown>) => Promise<string>;
}
export function registerTranslationRoutes(app: Express, d: TranslationRoutesDeps) {
  const base = '/api/core/projects/:projectId/translation';
  const handle = (fn: (req: Request,res: Response,repo: CoreRepository,a: ProjectAccess) => Promise<void>) => async (req: Request,res: Response) => {
    try {
      const a = await resolveProjectAccess(req.principal as never,String(req.params.projectId),d.access);
      if (!a) { res.status(req.principal && !req.principal.isGuest ? 403:401).json({error:'Немає доступу до книги.'}); return; }
      const repo=d.repo(); if (!repo) { res.status(503).json({error:'Ядро перекладу недоступне.'}); return; }
      await fn(req,res,repo,a);
    } catch(err) {
      if (err instanceof ChatProviderError) { res.status(err.status).json({error:err.message}); return; }
      if (err instanceof CoreRuleError) { res.status(({not_found:404,conflict:409,bad_actor:403,bad_input:400} as Record<string,number>)[err.code]??422).json({error:err.message,kind:err.code}); return; }
      console.error('[translation]',err); res.status(500).json({error:'Не вдалося виконати операцію перекладу.'});
    }
  };
  const paragraphs = async (repo: CoreRepository,a: ProjectAccess,write=false) => {
    const documents=await repo.listDocuments(a.projectId); const docs=new Map(documents.filter(d=>!d.deletedAt).map(d=>[d.id,d]));
    return (await repo.listAllParagraphs(a.projectId)).filter(p=>!p.deletedAt && p.kind!=='draft' && docs.has(p.documentId) && (write?canWrite:canRead)(sceneLevel(a.effective,docs.get(p.documentId)?.parentId??'',p.documentId)));
  };
  const editor = async (repo: CoreRepository,a: ProjectAccess) => a.effective.full || ['translator','editor','coauthor','co_author'].includes(a.role) || (await rolesOf(repo,a.projectId,a.userId)).some(r=>['translator','editor','coauthor'].includes(r));
  const assertEditor = async (repo: CoreRepository,a: ProjectAccess) => { if (!await editor(repo,a)) throw new CoreRuleError('bad_actor','Потрібна роль перекладача або редактора.'); };
  const assertRevision = (n: unknown) => { if (!Number.isSafeInteger(n) || Number(n)<0) throw new CoreRuleError('bad_input','Потрібна ревізія перекладу.'); };
  app.get(base,handle(async(req,res,repo,a)=>{
    const language=translationLanguage(req.query.language??'en'),state=await repo.getTranslationWorkspace(a.projectId);
    const visible=await paragraphs(repo,a);
    res.json({revision:state.revision,language,glossary:state.glossary.filter(e=>e.language===language && (!a.effective.restricted || visible.some(p=>p.text.includes(e.source)))),canEdit:await editor(repo,a),canApprove:a.effective.full,
      paragraphs:visible.map(p=>({...translationView(state,p,language)}))});
  }));
  app.put(`${base}/paragraphs/:paragraphId`,handle(async(req,res,repo,a)=>{
    await assertEditor(repo,a); assertRevision(req.body?.expectedRevision);
    if (!(await paragraphs(repo,a,true)).some(p=>p.id===req.params.paragraphId)) throw new CoreRuleError('bad_actor','Немає права перекладати цей абзац.');
    if (req.body?.status==='approved' && !a.effective.full) throw new CoreRuleError('bad_actor','Переклад затверджує власник або адміністратор.');
    res.json(await saveTranslation(repo,a.projectId,{...req.body,paragraphId:String(req.params.paragraphId)},`user:${a.userId}`));
  }));
  app.put(`${base}/glossary`,handle(async(req,res,repo,a)=>{
    if (!a.effective.full) throw new CoreRuleError('bad_actor','Глосарій затверджує власник або адміністратор.');
    assertRevision(req.body?.expectedRevision);
    const result=await updateGlossary(repo,a.projectId,req.body);
    const visible=new Set((await paragraphs(repo,a)).map(p=>p.id));
    res.json({...result,proposals:result.proposals.filter(p=>visible.has(p.paragraphId))});
  }));
  app.post(`${base}/generate`,...(d.aiGuard?[d.aiGuard]:[]),handle(async(req,res,repo,a)=>{
    await assertEditor(repo,a);
    const p=(await paragraphs(repo,a,true)).find(p=>p.id===req.body?.paragraphId);
    if (!p) throw new CoreRuleError('bad_actor','Немає права перекладати цей абзац.');
    const language=translationLanguage(req.body.language),sourceLanguage=translationLanguage(req.body.sourceLanguage);
    if (language===sourceLanguage) throw new CoreRuleError('bad_input','Виберіть іншу цільову мову.');
    if (!d.generate) { res.status(503).json({error:'AI-переклад не налаштований. Можна редагувати вручну.'}); return; }
    const state=await repo.getTranslationWorkspace(a.projectId),glossary=state.glossary.filter(e=>e.language===language && (!a.effective.restricted || p.text.includes(e.source)));
    const mentions=await repo.listMentionsByParagraphs(a.projectId,[p.id]); const ids=new Set(mentions.filter(m=>m.status==='confirmed').map(m=>m.entityId));
    const profiles=(await repo.listEntities(a.projectId,'character')).filter(e=>e.status==='confirmed' && ids.has(e.id) && canRead(entityLevel(a.effective,e.type,e.id))).map(e=>({id:e.id,name:e.name,canonical:e.canonical}));
    const allTraits=await repo.listEntityTraits(a.projectId),superseded=new Set(allTraits.filter(t=>t.status==='confirmed').map(t=>t.supersedes));
    const traits=allTraits.filter(t=>t.status==='confirmed' && !superseded.has(t.id) && profiles.some(e=>e.id===t.entityId));
    const nearby=(await paragraphs(repo,a)).filter(x=>x.documentId===p.documentId && Math.abs(x.order-p.order)<=1).map(x=>x.text.slice(0,1500));
    const text=await d.generate(req,{source:p.text,sourceLanguage,language,glossary,profiles,traits,styleExamples:nearby});
    validateTranslation(p.text,text,glossary);
    const latest=await repo.getTranslationWorkspace(a.projectId),latestP=await repo.getParagraph(a.projectId,p.id);
    if (latest.revision!==state.revision || latestP?.textHash!==p.textHash) throw new CoreRuleError('conflict','Контекст змінився під час AI-перекладу. Повторіть запит.');
    // A proposal is never written to the manuscript or approved automatically.
    res.json({text,sourceHash:p.textHash,glossaryHash:glossaryHash(state,language),revision:state.revision});
  }));
  app.post(`${base}/import-legacy`,handle(async(req,res,repo,a)=>{
    if (!a.effective.full) throw new CoreRuleError('bad_actor','Імпорт виконує власник або адміністратор.');
    assertRevision(req.body?.expectedRevision);
    const state=await repo.getTranslationWorkspace(a.projectId);
    if (state.revision!==req.body.expectedRevision) throw new CoreRuleError('conflict','Переклад уже змінили.');
    const stored=await getBook(a.projectId); if (!stored) throw new CoreRuleError('not_found','Серверну книгу не знайдено.');
    const owner=await d.access.getCollabOwnerId(a.projectId) ?? await d.access.getBookOwnerId(a.projectId);
    if (stored.ownerId!==owner) throw new CoreRuleError('not_found','Серверне джерело не належить власнику проєкту.');
    const all=await paragraphs(repo,a); let imported=0; const skipped: string[]=[];
    for (const chapter of (stored.book.chapters as any[])??[]) for (const section of chapter.sections??[]) {
      if (!section.contentEn) continue;
      const originals=all.filter(p=>p.documentId===section.id).sort((a,b)=>a.order-b.order);
      const blocks=tiptapDocToMarkerBlocks(markerStringToTiptapDoc(section.contentEn));
      if (originals.length!==blocks.length) { skipped.push(section.id); continue; }
      // Do not guess paragraph alignment or silently overwrite existing translations.
      for (let i=0;i<originals.length;i++) {
        const p=originals[i]; if (state.records.some(r=>r.paragraphId===p.id && r.language==='en')) continue;
        try { validateTranslation(p.text,blocks[i],state.glossary.filter(e=>e.language==='en')); } catch { skipped.push(p.id); continue; }
        state.records.push({paragraphId:p.id,sourceLanguage:'uk',language:'en',versions:[{version:1,text:blocks[i],status:'draft',sourceHash:p.textHash,glossaryHash:glossaryHash(state,'en'),actor:`user:${a.userId}`,createdAt:new Date().toISOString()}]}); imported++;
      }
    }
    if (imported) { const expected=state.revision++; await repo.saveTranslationWorkspace(a.projectId,state,expected); }
    res.json({revision:state.revision,imported,skipped});
  }));
  app.get(`${base}/export`,handle(async(req,res,repo,a)=>{
    const language=translationLanguage(req.query.language??'en'),state=await repo.getTranslationWorkspace(a.projectId);
    const ps=await paragraphs(repo,a); const views=ps.map(p=>translationView(state,p,language));
    if (!views.length || views.some(v=>!v.current || v.current.status!=='approved' || v.needsUpdate)) throw new CoreRuleError('conflict','Експорт потребує актуального затвердженого перекладу кожного доступного абзацу.');
    const docs=await repo.listDocuments(a.projectId); const ordered=views.sort((a,b)=>{
      const da=docs.find(d=>d.id===a.documentId),db=docs.find(d=>d.id===b.documentId);
      const ca=docs.find(d=>d.id===da?.parentId),cb=docs.find(d=>d.id===db?.parentId);
      return (ca?.order??0)-(cb?.order??0)||(da?.order??0)-(db?.order??0)||a.order-b.order;
    });
    res.setHeader('Content-Disposition',`attachment; filename="translation-${language}.md"`);
    res.type('text/markdown').send(ordered.map(v=>v.current!.text).join('\n\n'));
  }));
}
