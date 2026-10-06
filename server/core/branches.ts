import { createHash, randomUUID } from 'node:crypto';
import type { CoreRepository, MentionRow, ParagraphRow } from './types';
import type { BranchWorkspace, ScenarioBranch, BranchFragment } from './branchTypes';
import { CoreRuleError } from './rules';
import { getBook, hasBookMergeReceipt, saveBook, type StoredBook } from '../bookStore';
import { markerStringToTiptapDoc, tiptapDocToMarkerBlocks } from '../../src/utils/manuscriptDoc';
import { reconcileParagraphIds } from '../../src/utils/paragraphIds';
import { entityBySlug, parseEntityTagsInSource } from '../../src/utils/coreEntities';
import { entityNameFromTag } from './sync';
import { analyzeCausality } from './causality';
import { checkDraftKnowledge } from './continuityDraft';
import { refreshAllContinuityRules } from './continuity';

export const branchHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function branchCanonHash(repo: CoreRepository,projectId: string) {
  return branchHash(await Promise.all([repo.listEntities(projectId),repo.listRelations(projectId),repo.listEntityTraits(projectId),repo.listAliases(projectId)]));
}
export function branchSnapshot(branch: ScenarioBranch, actor: string) {
  branch.history.push({ version: branch.history.length+1, name: branch.name, status: branch.status, fragments: structuredClone(branch.fragments), actor, createdAt: new Date().toISOString() });
}
export async function saveBranches(repo: CoreRepository, projectId: string, state: BranchWorkspace, expected: number) {
  state.revision=expected+1;
  await repo.saveBranchWorkspace(projectId,state,expected);
}
export function getBranch(state: BranchWorkspace,id: string): ScenarioBranch {
  const branch=state.branches.find(b=>b.id===id);
  if (!branch) throw new CoreRuleError('not_found','Гілку не знайдено.');
  return branch;
}
export function assertBranchEditable(branch: ScenarioBranch) {
  if (branch.status==='archived') throw new CoreRuleError('conflict','Архівну гілку спочатку відновіть.');
  if (branch.fragments.some(f=>f.status==='applying')) throw new CoreRuleError('conflict','Триває перенесення фрагмента. Повторіть його завершення.');
}
export async function createBranch(repo: CoreRepository, projectId: string, stored: StoredBook, input: {
  name: string; pointEntityId?: string|null; expectedRevision: number;
  source?: ScenarioBranch['source']; sourceId?: string|null; initialFragment?: {sectionId:string;text:string;sourceProposalId?:string;paragraphId?:string|null};
}, actor: string) {
  const state=await repo.getBranchWorkspace(projectId);
  if (state.revision!==input.expectedRevision) throw new CoreRuleError('conflict','Гілки вже змінили. Оновіть сторінку.');
  if (typeof input.name!=='string' || !input.name.trim() || input.name.length>120) throw new CoreRuleError('bad_input','Назва гілки — до 120 символів.');
  const point=input.pointEntityId ? await repo.getEntity(projectId,input.pointEntityId) : null;
  if (input.pointEntityId && (!point || point.status!=='confirmed' || !['decision','event','threshold','turning-point','consequence'].includes(point.type))) throw new CoreRuleError('bad_input','Точка розгалуження — затверджене рішення, подія або поріг.');
  const canonHash=await branchCanonHash(repo,projectId);
  const branch: ScenarioBranch={id:randomUUID(),name:input.name.trim(),pointEntityId:point?.id??null,source:input.source??'author',sourceId:input.sourceId??null,
    baseBookRevision:stored.revision,baseBookHash:branchHash(stored.book),baseCanonHash:canonHash,baseParagraphs:(await repo.listAllParagraphs(projectId)).filter(p=>!p.deletedAt && p.kind!=='draft'),status:'active',fragments:[],history:[],createdAt:new Date().toISOString()};
  if(input.initialFragment){
    const f=input.initialFragment;
    if(typeof f.text!=='string'||!f.text.trim()||f.text.length>100000)throw new CoreRuleError('bad_input','Некоректний текст.');
    if(!(await repo.listDocuments(projectId)).some(d=>d.id===f.sectionId&&d.kind==='section'&&!d.deletedAt))throw new CoreRuleError('not_found','Сцену не знайдено.');
    const p=f.paragraphId?branch.baseParagraphs.find(p=>p.id===f.paragraphId&&p.documentId===f.sectionId):null;
    if(f.paragraphId&&!p)throw new CoreRuleError('bad_input','Абзац не належить сцені.');
    branch.fragments.push({id:randomUUID(),paragraphId:p?.id??null,sectionId:f.sectionId,text:f.text,original:p?.text??'',originalHash:p?.textHash??'',status:'draft',...(f.sourceProposalId?{sourceProposalId:f.sourceProposalId}:{})});
  }
  branchSnapshot(branch,actor);state.branches.push(branch);await saveBranches(repo,projectId,state,state.revision);
  return {revision:state.revision,branch};
}
export async function putBranchFragment(repo: CoreRepository,projectId: string,branchId: string,input: {
  id?: string; paragraphId?: string|null; sectionId: string; text: string; expectedRevision: number; sourceProposalId?: string;
},actor: string) {
  const state=await repo.getBranchWorkspace(projectId);
  if (state.revision!==input.expectedRevision) throw new CoreRuleError('conflict','Гілку вже змінили.');
  const branch=getBranch(state,branchId);assertBranchEditable(branch);
  if (typeof input.text!=='string' || !input.text.trim() || input.text.length>100000 || /\[\/?AI-DRAFT\]/.test(input.text)) throw new CoreRuleError('bad_input','Потрібен текст без обгортки AI-DRAFT, до 100000 символів.');
  const docs=await repo.listDocuments(projectId);
  if (!docs.some(d=>d.id===input.sectionId && d.kind==='section' && !d.deletedAt)) throw new CoreRuleError('not_found','Сцену не знайдено.');
  const paragraph=input.paragraphId ? branch.baseParagraphs.find(p=>p.id===input.paragraphId) : null;
  if (input.paragraphId && (!paragraph || paragraph.deletedAt || paragraph.kind==='draft' || paragraph.documentId!==input.sectionId)) throw new CoreRuleError('bad_input','Абзац має належати вибраній сцені.');
  const prev=input.id ? branch.fragments.find(f=>f.id===input.id) : null;
  if (input.id && !prev) throw new CoreRuleError('not_found','Фрагмент не знайдено.');
  if (prev && prev.status!=='draft') throw new CoreRuleError('conflict','Вирішений фрагмент не редагується. Створіть новий.');
  if (prev && (prev.paragraphId!==(paragraph?.id??null) || prev.sectionId!==input.sectionId)) throw new CoreRuleError('bad_input','Ціль фрагмента не можна змінювати.');
  if (!prev && paragraph && branch.fragments.some(f=>f.paragraphId===paragraph.id && f.status!=='rejected')) throw new CoreRuleError('conflict','Цей абзац уже має альтернативу в гілці.');
  const fragment: BranchFragment={id:prev?.id??randomUUID(),paragraphId:paragraph?.id??null,sectionId:input.sectionId,text:input.text,
    original:prev?.original??paragraph?.text??'',originalHash:prev?.originalHash??paragraph?.textHash??'',status:'draft',
    ...(prev?.sourceProposalId||input.sourceProposalId ? {sourceProposalId:prev?.sourceProposalId??input.sourceProposalId}: {})};
  if (prev) branch.fragments[branch.fragments.indexOf(prev)]=fragment;else branch.fragments.push(fragment);
  branchSnapshot(branch,actor);await saveBranches(repo,projectId,state,state.revision);
  return {revision:state.revision,branch};
}
/** Read-only overlay: analyses see draft paragraphs and tags; canonical repository never writes. */
async function overlay(repo: CoreRepository,projectId: string,branch: ScenarioBranch) {
  const paras=structuredClone(branch.baseParagraphs);
  const changed=new Set<string>();
  for (const f of branch.fragments.filter(f=>f.status==='draft'||f.status==='applying')) {
    if (f.paragraphId) { const p=paras.find(p=>p.id===f.paragraphId);if(p){p.text=f.text;p.textHash=branchHash(f.text);changed.add(p.id);} }
    else { const id=`branch:${f.id}`;changed.add(id);paras.push({projectId,id,documentId:f.sectionId,order:Math.max(-1,...paras.filter(p=>p.documentId===f.sectionId).map(p=>p.order))+1,text:f.text,textHash:branchHash(f.text),kind:'paragraph',version:1,deletedAt:null,editorPid:null,updatedAt:new Date().toISOString()}); }
  }
  const mentions=(await repo.listMentionsByParagraphs(projectId,paras.map(p=>p.id))).filter(m=>!changed.has(m.paragraphId));
  for (const p of paras.filter(p=>changed.has(p.id))) for (const t of parseEntityTagsInSource(p.text)) {
    const definition=t.entity??entityBySlug(t.slug);if(!definition)continue;
    const parsed=entityNameFromTag(definition,t.value),entityId=await repo.resolveAlias(projectId,t.slug,parsed.name);if(!entityId)continue;
    const subjectEntityId=parsed.subject ? await repo.resolveAlias(projectId,'character',parsed.subject) : null;
    mentions.push({id:`branch:${p.id}:${t.start}`,projectId,entityId,paragraphId:p.id,spanStart:t.start,spanEnd:t.end,source:'author',status:'confirmed',subjectEntityId,fields:{}} as MentionRow);
  }
  return new Proxy(repo,{get(target,key){
    if(key==='listAllParagraphs')return async()=>structuredClone(paras);
    if(key==='getParagraph')return async(_p:string,id:string)=>structuredClone(paras.find(p=>p.id===id)??null);
    if(key==='listParagraphs')return async(_p:string,id:string)=>structuredClone(paras.filter(p=>p.documentId===id && !p.deletedAt).sort((a,b)=>a.order-b.order));
    if(key==='listMentionsByParagraphs')return async(_p:string,ids:string[])=>structuredClone(mentions.filter(m=>ids.includes(m.paragraphId)));
    if(key==='listMentionsByEntity')return async(_p:string,id:string)=>structuredClone(mentions.filter(m=>m.entityId===id));
    if(key==='listSubjectMentions')return async()=>structuredClone(mentions.filter(m=>m.subjectEntityId));
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
}
export async function checkBranch(repo: CoreRepository,projectId: string,branch: ScenarioBranch) {
  const virtual=await overlay(repo,projectId,branch);
  const causality=await analyzeCausality(virtual,projectId,branch.pointEntityId?{entityIds:[branch.pointEntityId]}:{});
  const issues:any[]=[];const traits=structuredClone(await repo.listEntityTraits(projectId));
  const analysis=new Proxy(virtual,{get(target,key){
    if(key==='listContinuityIssues')return async()=>[];
    if(key==='upsertContinuityIssue')return async(input:any)=>{const row={...input,id:input.id??randomUUID(),status:input.status??'suggested'};issues.push(row);return row;};
    if(key==='listEntityTraits')return async(_p:string,id?:string)=>structuredClone(traits.filter(t=>!id||t.entityId===id));
    if(key==='upsertEntityTrait')return async(input:any)=>{const row={...input,id:input.id??randomUUID()};const index=traits.findIndex(t=>t.id===row.id);if(index>=0)traits[index]=row;else traits.push(row);return row;};
    if(key==='setContinuityIssueStatus')return async()=>null;
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const continuity=await refreshAllContinuityRules(analysis,projectId);
  const entities=await repo.listEntities(projectId);const knowledge=[];
  for(const f of branch.fragments.filter(f=>f.status==='draft')) for(const hero of entities.filter(e=>e.type==='character' && e.status==='confirmed')) {
    if(!f.text.includes(hero.name))continue;
    knowledge.push({fragmentId:f.id,...await checkDraftKnowledge(virtual,projectId,{characterId:hero.id,sectionId:f.sectionId,draftText:f.text})});
  }
  return {causality,knowledge,continuity,issues,rule:'Попередження й залежності гіпотези. Основа й канон не змінюються.'};
}
export async function mergeBranchFragment(repo: CoreRepository,projectId: string,branchId: string,fragmentId: string,input: {
  expectedRevision: number; expectedBookRevision: number; confirm: boolean; acknowledgeCanonChange?: boolean;
},actor: string) {
  if(input.confirm!==true)throw new CoreRuleError('bad_input','Потрібне явне підтвердження перенесення фрагмента.');
  const state=await repo.getBranchWorkspace(projectId);
  if(state.revision!==input.expectedRevision)throw new CoreRuleError('conflict','Гілку вже змінили.');
  const branch=getBranch(state,branchId);
  if(branch.status==='archived')throw new CoreRuleError('conflict','Архівна гілка не переноситься.');
  const f=branch.fragments.find(f=>f.id===fragmentId);if(!f)throw new CoreRuleError('not_found','Фрагмент не знайдено.');
  if(f.status==='rejected')throw new CoreRuleError('conflict','Відхилений фрагмент не переноситься.');
  const stored=await getBook(projectId);if(!stored)throw new CoreRuleError('not_found','Серверну книгу не знайдено.');
  const key=branchHash({branchId,fragmentId,text:f.text,originalHash:f.originalHash});
  if(f.status==='accepted')return {revision:state.revision,branch,stored};
  let applied=await hasBookMergeReceipt(projectId,key);
  if(!applied && stored.revision!==input.expectedBookRevision)throw new CoreRuleError('conflict','Книгу вже змінили. Оновіть порівняння.');
  if(!applied && branch.baseCanonHash!==await branchCanonHash(repo,projectId) && input.acknowledgeCanonChange!==true)throw new CoreRuleError('conflict','Канон змінився: перевірте гілку й явно підтвердьте актуальний канон.');
  const book=structuredClone(stored.book) as any;
  const chapter=book.chapters?.find((c:any)=>c.sections?.some((s:any)=>s.id===f.sectionId));const section=chapter?.sections?.find((s:any)=>s.id===f.sectionId);
  if(!section)throw new CoreRuleError('not_found','Сцену видалено з книги.');
  const blocks=tiptapDocToMarkerBlocks(markerStringToTiptapDoc(section.content??''));
  if(!applied){
    if(f.paragraphId){
      const p=await repo.getParagraph(projectId,f.paragraphId);if(!p||p.deletedAt)throw new CoreRuleError('conflict','Оригінальний абзац видалено.');
      const id=p.editorPid??p.id;const index=section.paragraphIds?.indexOf(id);const at=typeof index==='number'&&index>=0?index:p.order;
      if(blocks[at]!==f.original)throw new CoreRuleError('conflict','Оригінальний фрагмент змінився. Створіть альтернативу на актуальній основі.');
      blocks[at]=f.text;
    } else blocks.push(f.text);
    section.content=blocks.join('\n\n');const ids=reconcileParagraphIds({sectionId:section.id,content:section.content,prevIds:section.paragraphIds,prevHashes:section.paragraphHashes});
    section.paragraphIds=ids.ids;section.paragraphHashes=ids.hashes;section.lastModified=new Date().toISOString();book.updatedAt=section.lastModified;
  }
  if(f.status==='draft'){
    if(branch.fragments.some(x=>x.status==='applying'))throw new CoreRuleError('conflict','Спочатку завершіть попередній фрагмент.');
    f.status='applying';branchSnapshot(branch,actor);await saveBranches(repo,projectId,state,state.revision);
  }
  let saved:StoredBook;
  try {saved=applied?stored:await saveBook({book,expectedRevision:stored.revision,mergeKey:key});applied=true;}
  catch(err){
    const current=await repo.getBranchWorkspace(projectId);const pending=getBranch(current,branchId).fragments.find(x=>x.id===fragmentId)!;
    pending.status='draft';branchSnapshot(getBranch(current,branchId),actor);await saveBranches(repo,projectId,current,current.revision);throw err;
  }
  const current=await repo.getBranchWorkspace(projectId);const currentBranch=getBranch(current,branchId),accepted=currentBranch.fragments.find(x=>x.id===fragmentId)!;
  accepted.status='accepted';accepted.acceptedRevision=saved.revision;branchSnapshot(currentBranch,actor);await saveBranches(repo,projectId,current,current.revision);
  return {revision:current.revision,branch:currentBranch,stored:saved};
}
