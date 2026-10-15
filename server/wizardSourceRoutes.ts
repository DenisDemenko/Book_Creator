import type { Express } from 'express';
import { requireAuth, requirePermission } from './auth';
import { generateText, resolveTextEngine } from './aiCore';
import { resolveEngineForWizard, noEngineMessage } from './expressEngine';
import { CHAT_MODELS, modelSupportsVision } from './chatProviders';
import { readAsset, getAsset } from './media/mediaLibraryStore';
import { getDraft, updateDraft, assertDraftRevision, DraftConflictError, DraftValidationError } from './expressStore';
import { importTechnicalUrl, searchTechnicalResources } from './technicalSources';
import { technicalInstructionPrompt, parseTechnicalProposal, technicalInputHash } from './technicalInstruction';
import { buildCharacterFromImagePrompt, characterFromImageSystemInstruction } from './characterFromImagePrompt';
import type { TechnicalSettings } from '../shared/technicalInstruction';

type Ask=(req:any,label:string,system:string,prompt:string)=>Promise<{text:string}>;
export interface WizardSourceDeps {
 ask?:Ask;
 importUrl?:typeof importTechnicalUrl;
 search?:typeof searchTechnicalResources;
 describe?: (req:any,assetId:string,modelId:string,intent:string)=>Promise<string>;
}
async function describePhoto(req:any,assetId:string,modelId:string,intent:string):Promise<string> {
 const model=CHAT_MODELS.find(m=>m.id===modelId);
 if(!model||!modelSupportsVision(modelId))throw new DraftValidationError('Оберіть модель із зором; текстова модель не аналізує фото.');
 const resource=await readAsset(assetId);
 if(!resource||resource.record.ownerId!==String(req.principal.id))throw new DraftValidationError('Фото недоступне.',404);
 if(!['image/jpeg','image/png','image/webp'].includes(resource.record.mimeType))throw new DraftValidationError('Для аналізу використайте JPEG, PNG або WEBP.');
 const choice=await resolveEngineForWizard(req.principal.id,model.engine);
 if(!choice||choice.engine!==model.engine)throw new DraftValidationError(noEngineMessage(),503);
 const technical=intent==='technical';
 const result=await generateText({
  engine:resolveTextEngine(modelId),modelId,req,privateContent:true,
  apiKeyOverride:choice.apiKeyOverride,
  systemInstruction:technical
   ?'Ти — технічний помічник. Опиши лише видимі деталі, маркування, кріплення, взаємне розташування та стан. Не вигадуй прихованих з’єднань, розмірів, моментів затягування чи електричних параметрів. Нечитабельне познач як невідоме. Це чернетка для підтвердження автором.'
   :characterFromImageSystemInstruction()+'\nНе встановлюй особистість, етнічність, релігію, стан здоров’я чи психологічні риси за зовнішністю.',
  prompt:technical?'Опиши доступні технічні відомості на фото; окремо переліч, що потребує перевірки.':buildCharacterFromImagePrompt({photoLabel:resource.record.filename}),
  images:[{mimeType:resource.record.mimeType,dataBase64:Buffer.from(resource.bytes).toString('base64')}],
  label:technical?'Інструкція: спостереження за фото':'Wizard: зовнішність за фото',
 });
 const current=await getAsset(assetId);
 if(!current||current.ownerId!==String(req.principal.id))throw new DraftValidationError('Доступ до фото відкликано під час аналізу.',409);
 return result.text;
}
function fail(res:any,error:unknown) {
 if(error instanceof DraftConflictError)return res.status(409).json({error:error.message,kind:'draft_conflict',draft:error.current});
 return res.status(error instanceof DraftValidationError?error.status:422).json({error:(error as Error).message});
}
export function registerWizardSourceRoutes(app:Express,deps:WizardSourceDeps={}){
 app.post('/api/express/sources/import-url',requireAuth,async(req,res)=>{
  try {res.json(await (deps.importUrl??importTechnicalUrl)(String(req.body?.url??'')));}catch(e){fail(res,e);}
 });
 app.post('/api/express/sources/search',requireAuth,async(req,res)=>{
  try {res.json({results:await (deps.search??searchTechnicalResources)(String(req.body?.query??''),req.body?.domain)});}catch(e){fail(res,e);}
 });
 app.post('/api/express/sources/describe-photo',requireAuth,requirePermission('canUseAi'),async(req,res)=>{
  try {
   const assetId=String(req.body?.assetId??'');
   const asset=await getAsset(assetId);
   if(!asset||asset.ownerId!==String(req.principal!.id))throw new DraftValidationError('Фото недоступне.',404);
   const text=await (deps.describe??describePhoto)(req,assetId,String(req.body?.modelId??''),req.body?.intent==='technical'?'technical':'character');
   const current=await getAsset(assetId);
   if(!current||current.ownerId!==String(req.principal!.id))throw new DraftValidationError('Фото вже недоступне.',409);
   res.json({text,assetId,approved:false});
  }catch(e){fail(res,e);}
 });
 app.post('/api/express/technical/generate',requireAuth,requirePermission('canUseAi'),async(req,res)=>{
  try {
   const draft=getDraft(String(req.body?.draftId??''));
   if(!draft||draft.userId!==String(req.principal!.id))throw new DraftValidationError('Чернетка недоступна.',404);
   assertDraftRevision(draft,req.body?.expectedRevision);
   const settings=draft.payload.technical as unknown as TechnicalSettings|undefined;
   if(!settings||!['assembly','operation'].includes(settings.mode)||!settings.title?.trim())throw new DraftValidationError('Вкажіть виріб і тип інструкції.');
   const sources=(draft.payload.sourceMaterials??[]).filter(s=>s.approved&&s.text.trim());
   if(!sources.length)throw new DraftValidationError('Підтвердьте хоча б одне джерело перед генерацією.');
   for(const source of sources.filter(s=>s.assetId)){
    const asset=await getAsset(source.assetId!);
    if(!asset||asset.ownerId!==String(req.principal!.id))throw new DraftValidationError('Джерело більше недоступне.',403);
   }
   const {system,prompt}=technicalInstructionPrompt({...settings,proposal:undefined},sources);
   const ask=deps.ask??(async(r:any,label:string,system:string,prompt:string)=>{
    const choice=await resolveEngineForWizard(r.principal.id,r.body?.engine);
    if(!choice)throw new DraftValidationError(noEngineMessage(),503);
    return generateText({...choice,req:r,privateContent:true,label,systemInstruction:system,prompt,json:true});
   });
   const raw=await ask(req,'Інструкція з фото й документації',system,prompt);
   const proposal=parseTechnicalProposal(raw.text,sources);
   proposal.inputHash=technicalInputHash(settings,sources);
   for(const source of sources.filter(s=>s.assetId)){
    const asset=await getAsset(source.assetId!);
    if(!asset||asset.ownerId!==String(req.principal!.id))throw new DraftValidationError('Доступ до джерела відкликано.',409);
   }
   const updated=updateDraft(draft.id,{technical:{...settings,proposal}},draft.revision,3);
   if(!updated)throw new DraftValidationError('Чернетку видалено під час генерації.',404);
   res.json({proposal,draft:updated});
  }catch(e){fail(res,e);}
 });
}
