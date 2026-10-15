import type {Instruction} from '../types';
import type {TechnicalProposal,TechnicalSettings} from '../../shared/technicalInstruction';
import type {WizardSource} from '../../shared/wizardScenarios';
import {createEmptyInstruction,instructionUid} from './instructionDraft';
export function technicalProposalToInstruction(proposal:TechnicalProposal,settings:TechnicalSettings,sources:WizardSource[]):Instruction{
 const doc=createEmptyInstruction(settings.mode==='operation'?'usage':'assembly');
 return {...doc,title:proposal.title,modelCode:proposal.modelCode,description:proposal.description,sourceBased:true,
  materials:proposal.materials.map(m=>({...m,id:instructionUid('mat')})),
  tools:proposal.tools,warnings:proposal.warnings,finalChecks:proposal.finalChecks,
  steps:proposal.steps.map(s=>({...s,needsVerification:true,id:instructionUid('step'),aiGenerated:true})),
  knowledgeBase:sources.filter(s=>s.approved).map(s=>({id:s.id,title:s.title,link:s.kind==='url'?s.url??'':'',excerpt:'Підтверджене джерело'+(s.retrievedAt?' · отримано '+s.retrievedAt:'')})),
  troubleshooting:proposal.questions.map(q=>({id:instructionUid('question'),issue:q,cause:'Потребує уточнення за документацією',action:''})),
 };
}
