import type {BookToolHandler} from '../types';
import {CoreRuleError} from '../../../core/rules';
import {cleanFragmentText,validProposalTag} from '../../../core/interviewProposals';
export const proposeCanonChange:BookToolHandler=async s=>{
 const {kind,text,sourceEventIds=[],parentId}=s.args;
 if(!['memory','fact','fragment','tag'].includes(String(kind))||typeof text!=='string'||!text.trim()||text.length>4000||!Array.isArray(sourceEventIds)||sourceEventIds.length>20||sourceEventIds.some(id=>typeof id!=='string'))throw new CoreRuleError('bad_input','Некоректна пропозиція.');
 if(kind==='memory'&&text.length>2000||kind==='fact'&&text.length>1000)throw new CoreRuleError('bad_input','Пропозиція перевищує межу спогаду або факту.');
 if(kind==='tag'){const parent=typeof parentId==='string'?await s.deps.repo.getCanonProposal(s.scope.projectId,parentId):null;if(!parent||parent.simulationId!==s.scope.simulationId||parent.characterId!==s.scope.characterId||parent.kind!=='fragment'||parent.status!=='pending')throw new CoreRuleError('bad_input','Тег — лише до власної pending-пропозиції фрагмента.');}
 else if(parentId!==undefined)throw new CoreRuleError('bad_input','parentId дозволений лише тегу.');
 const observed=await s.observed();if(!sourceEventIds.length||sourceEventIds.some(id=>!observed.some(e=>e.id===id)))throw new CoreRuleError('bad_input','Потрібні лише власні спостережувані події-докази.');
 const clean=kind==='tag'?validProposalTag(text):cleanFragmentText(text);if(!clean?.trim())throw new CoreRuleError('bad_input','Некоректний текст або тег.');
 s.signal.throwIfAborted();
 const proposedChange=kind==='memory'?{content:clean,memoryType:'recollection',sceneId:s.scope.sceneId}:kind==='fragment'?{text:clean,sectionId:s.scope.sceneId}:kind==='tag'?{tag:clean,sectionId:s.scope.sceneId}:{statement:clean,sceneId:s.scope.sceneId};
 return s.deps.repo.addCanonProposal({projectId:s.scope.projectId,simulationId:s.scope.simulationId,characterId:s.scope.characterId,kind:kind as 'memory'|'fact'|'fragment'|'tag',proposedChange,sourceEventIds:[...new Set(sourceEventIds)],...(kind==='tag'?{parentId:parentId as string}:{}),createdBy:'ai:character-voice'});
};
