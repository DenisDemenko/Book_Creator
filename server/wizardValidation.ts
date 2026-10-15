import { storyWorldSchema, WIZARD_STEPS } from '../shared/storyWorld';
import { z } from 'zod';
import { BOOK_SCENARIOS, STORY_MODELS } from '../shared/wizardScenarios';
const source=z.object({
 id:z.string().min(1).max(160),kind:z.enum(['file','photo','url','note']),title:z.string().max(300),
 text:z.string().max(100000),approved:z.boolean(),url:z.string().max(3000).optional(),
 assetId:z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/).optional(),characterId:z.string().max(160).optional(),retrievedAt:z.string().max(100).optional(),
}).refine(s=>s.kind!=='photo'||!!s.assetId).refine(s=>{
 if(s.kind!=='url')return true;
 try { const u=new URL(s.url??'');return u.protocol==='https:'&&!u.username&&!u.password; } catch{return false;}
});
const schema=z.object({
 storyWorld:storyWorldSchema.optional(),navigationVersion:z.literal(2).optional(),stepKey:z.enum(WIZARD_STEPS.map(s=>s.key) as [string,...string[]]).optional(),
 framework:z.enum(STORY_MODELS.map(m=>m.id) as [string,...string[]]).optional(),
 track:z.enum(['book','course','instruction','game','technical_instruction']).optional(),
 cast:z.array(z.object({id:z.string().max(160).optional(),firstName:z.string().max(300),lastName:z.string().max(300),
   poltiRoleName:z.string().max(1000).optional(),appearance:z.string().max(16000).optional(),goal:z.string().max(16000).optional(),
   flaw:z.string().max(16000).optional(),approved:z.boolean().optional()}).passthrough()).max(40).optional(),
 entryMode:z.enum(BOOK_SCENARIOS.map(s=>s.id) as [string,...string[]]).optional(),
 scenarioInputs:z.record(z.string().max(100),z.string().max(16000)).refine(v=>Object.keys(v).length<=30).optional(),
 seed:z.string().max(4000).optional(),genre:z.string().max(500).optional(),audience:z.string().max(500).optional(),tone:z.string().max(500).optional(),
 targetCastSize:z.number().int().min(0).max(20).optional(),sourceMaterials:z.array(source).max(20).refine(v=>new Set(v.map(s=>s.id)).size===v.length).optional(),
 sourcesPermission:z.boolean().optional(),useAi:z.boolean().optional(),reviewConfirmed:z.boolean().optional(),structureConfirmed:z.boolean().optional(),
 compositionPlan:z.string().max(100000).optional(),synopsis:z.string().max(100000).optional(),
 technical:z.object({mode:z.enum(['assembly','operation']),title:z.string().max(500),modelCode:z.string().max(500),goal:z.string().max(10000),proposal:z.unknown().optional()}).optional(),
}).passthrough();
export function validateWizardPatch(patch:unknown):void {
 const result=schema.safeParse(patch);
 if(!result.success)throw new Error('Некоректні поля сценарію, матеріали або перевищений ліміт тексту.');
 if(JSON.stringify(patch).length>600000)throw new Error('Чернетка перевищує 600 000 символів. Зменште обсяг матеріалів.');
}
