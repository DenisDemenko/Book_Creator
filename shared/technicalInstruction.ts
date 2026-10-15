import type { WizardSource } from './wizardScenarios';
export type TechnicalMode='assembly'|'operation';
export interface TechnicalStepProposal {
 title:string;description:string;components:string;toolsResources:string;warning:string;
 successCriterion:string;sourceIds:string[];needsVerification:boolean;
}
export interface TechnicalProposal {
 title:string;modelCode:string;description:string;materials:{code:string;name:string;qty:string}[];
 tools:string[];warnings:string[];steps:TechnicalStepProposal[];finalChecks:string[];questions:string[];
 inputHash?:string;
}
export interface TechnicalSettings { mode:TechnicalMode;title:string;modelCode:string;goal:string;proposal?:TechnicalProposal }
export function technicalSourceErrors(sources:WizardSource[]):string[] {
 const approved=sources.filter(s=>s.approved&&s.text.trim());
 return approved.length?[]:['Додайте й підтвердьте хоча б одне джерело.'];
}
