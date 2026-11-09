import type {Instruction,InstructionStepImage} from '../types';
import type {TechnicalProposal,TechnicalSettings} from '../../shared/technicalInstruction';
import type {WizardSource} from '../../shared/wizardScenarios';
import {createEmptyInstruction,instructionUid} from './instructionDraft';
import {LIBRARY_MEDIA_PREFIX} from './libraryMediaUrl';
/** Кадри кроку: усі фото джерел, на які він спирається (без повторів), у порядку джерел. */
export function stepImagesFromSources(sourceIds:string[]|undefined,sources:WizardSource[],caption:string):InstructionStepImage[]{
 const seen=new Set<string>();const out:InstructionStepImage[]=[];
 for(const id of sourceIds??[]){
  const source=sources.find(s=>s.id===id);if(!source)continue;
  for(const assetId of [source.assetId,...(source.assetIds??[])]){
   if(!assetId||seen.has(assetId))continue;seen.add(assetId);
   out.push({assetId,url:LIBRARY_MEDIA_PREFIX+'/'+assetId,caption:caption.trim().slice(0,200)+(caption.trim()?', кадр ':'Кадр ')+(out.length+1)});
  }
 }
 return out;
}
export function technicalProposalToInstruction(proposal:TechnicalProposal,settings:TechnicalSettings,sources:WizardSource[]):Instruction{
 const doc=createEmptyInstruction(settings.mode==='operation'?'usage':'assembly');
 return {...doc,title:proposal.title,modelCode:proposal.modelCode,description:proposal.description,sourceBased:true,
  materials:proposal.materials.map(m=>({...m,id:instructionUid('mat')})),
  tools:proposal.tools,warnings:proposal.warnings,finalChecks:proposal.finalChecks,
  steps:proposal.steps.map(s=>{
   const images=stepImagesFromSources(s.sourceIds,sources,s.title);
   return {...s,needsVerification:true,id:instructionUid('step'),aiGenerated:true,...(images.length?{images}:{})};
  }),
  knowledgeBase:sources.filter(s=>s.approved).map(s=>({id:s.id,title:s.title,link:s.kind==='url'?s.url??'':'',excerpt:'Підтверджене джерело'+(s.retrievedAt?' · отримано '+s.retrievedAt:'')})),
  troubleshooting:proposal.questions.map(q=>({id:instructionUid('question'),issue:q,cause:'Потребує уточнення за документацією',action:''})),
 };
}
