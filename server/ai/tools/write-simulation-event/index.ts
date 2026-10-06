import type {BookToolHandler} from '../types';
import {CoreRuleError} from '../../../core/rules';
export const writeSimulationEvent:BookToolHandler=async s=>{
 if(s.simulation.status!=='active')throw new CoreRuleError('conflict','Прогін не активний.');
 const text=s.args.text;if(typeof text!=='string'||!text.trim()||text.length>4000)throw new CoreRuleError('bad_input','Подія — непорожній текст до 4000 символів.');
 s.signal.throwIfAborted();
 return s.deps.repo.addSimulationEvent({projectId:s.scope.projectId,simulationId:s.scope.simulationId,turnIndex:s.simulation.currentTurn,actor:'character',actorCharacterId:s.scope.characterId,eventType:'note',publicPayload:{text,sceneId:s.scope.sceneId,visibility:'actor_only'},createdBy:s.actor});
};
