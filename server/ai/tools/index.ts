/** Bound server tools: no HTTP endpoint, executable model code, filesystem, shell or network tool. */
import {InProcessAgentRuntime,ToolDeniedError,type AgentTool,type RuntimeScope} from '../adapters/harness';
import {buildCharacterSnapshot} from '../../core/characterSnapshot';
import {CoreRuleError} from '../../core/rules';
import type {BookToolDeps,BookToolScope,BookToolHandler} from './types';
import {getCharacterSnapshot} from './get-character-snapshot';
import {getSceneContext} from './get-scene-context';
import {searchCharacterMentions} from './search-character-mentions';
import {evaluateCharacterOptions} from './evaluate-character-options';
import {readAuthorizedSecret} from './read-authorized-secret';
import {writeSimulationEvent} from './write-simulation-event';
import {proposeCanonChange} from './propose-canon-change';
export type {BookToolDeps,BookToolScope} from './types';
const handlers:Record<string,BookToolHandler>={
 'get-character-snapshot':getCharacterSnapshot,'get-scene-context':getSceneContext,
 'search-character-mentions':searchCharacterMentions,'evaluate-character-options':evaluateCharacterOptions,
 'read-authorized-secret':readAuthorizedSecret,'write-simulation-event':writeSimulationEvent,'propose-canon-change':proposeCanonChange,
};
export const BOOK_TOOL_NAMES=Object.freeze(Object.keys(handlers));
const contextKeys={project_id:'projectId',actor_id:'actorId',character_id:'characterId',scene_id:'sceneId',simulation_id:'simulationId'} as const;
const actorPattern=/^user:[^\s:]+$/;
function parsedArgs(input:unknown,scope:Readonly<BookToolScope>){
 if(input==null)return {};
 if(typeof input!=='object'||Array.isArray(input))throw new CoreRuleError('bad_input','Tool потребує об’єкт аргументів.');
 let args:Record<string,unknown>;try{if(Buffer.byteLength(JSON.stringify(input))>16384)throw new Error();args=structuredClone(input) as Record<string,unknown>;}catch{throw new CoreRuleError('bad_input','Аргументи не є JSON до 16 KiB.');}
 for(const [snake,camel] of Object.entries(contextKeys))for(const key of [snake,camel])if(key in args){if(args[key]!==scope[camel as keyof BookToolScope])throw new ToolDeniedError(`Підміна ${snake} заборонена.`);delete args[key];}
 return args;
}
const keys:Record<string,readonly string[]>={
 'get-character-snapshot':[],'get-scene-context':[],'search-character-mentions':['query'],
 'evaluate-character-options':['actions'],'read-authorized-secret':['secretId'],
 'write-simulation-event':['text'],'propose-canon-change':['kind','text','sourceEventIds','parentId'],
};
export function createBookTools(deps:BookToolDeps):AgentTool[]{
 const scope:Readonly<BookToolScope>=Object.freeze({...deps.scope});
 if(Object.values(contextKeys).some(key=>typeof scope[key]!=='string'||!scope[key].trim()||scope[key].length>200)||!scope.sceneId||!actorPattern.test(scope.actorId))throw new ToolDeniedError('Некоректний серверний scope.');
 return BOOK_TOOL_NAMES.map(name=>({name,description:`${name}: only the server-bound character, scene and simulation`,async run(input:unknown,runtimeScope:RuntimeScope,signal:AbortSignal){
  const args=parsedArgs(input,scope);
  if(Object.keys(args).some(key=>!keys[name].includes(key)))throw new ToolDeniedError('Невідомі аргументи tool.');
  for(const key of Object.values(contextKeys))if(runtimeScope[key]!==scope[key])throw new ToolDeniedError('Scope рантайму не збігається із серверним дозволом.');
  signal.throwIfAborted();if(!await deps.authorize(scope))throw new ToolDeniedError('Доступ до книги відкликано.');signal.throwIfAborted();
  const sim=await deps.repo.getSimulation(scope.projectId,scope.simulationId),hero=await deps.repo.getEntity(scope.projectId,scope.characterId);
  if(!sim||sim.sceneId!==scope.sceneId||sim.status==='stale'||!hero||hero.type!=='character'||hero.status!=='confirmed')throw new ToolDeniedError('Герой, сцена або прогін недоступні.');
  const magic=sim.kind==='scene'?await deps.repo.getMagicSceneRun(scope.projectId,scope.simulationId):null;
  if(sim.kind==='interview'?sim.characterId!==scope.characterId:!magic?.participants.includes(scope.characterId))throw new ToolDeniedError('Герой не є учасником прогону.');
  const snapshot=()=>buildCharacterSnapshot(deps.repo,{projectId:scope.projectId,characterId:scope.characterId,sceneId:scope.sceneId,simulationId:scope.simulationId,asOfChapter:sim.asOfChapter,situation:deps.situation,allowedActions:[...deps.allowedActions],studio:deps.studio});
  const observed=async():Promise<Record<string,unknown>[]>=>{
   if(magic){const notes=(await deps.repo.listSimulationEvents(scope.projectId,scope.simulationId)).filter(e=>e.actorCharacterId===scope.characterId&&e.eventType==='note').map(e=>({id:e.id,turn:e.turnIndex,characterId:scope.characterId,note:e.publicPayload.text}));return [...magic.events.filter(e=>e.audience.includes(scope.characterId)).map(e=>({id:e.id,turn:e.turn,characterId:e.characterId,characterName:e.characterName,speech:e.speech,actionText:e.actionText,audience:e.audience,at:e.at})),...notes];}
   return (await deps.repo.listSimulationEvents(scope.projectId,scope.simulationId)).filter(e=>e.actor==='author'||e.actorCharacterId===scope.characterId).map(e=>({id:e.id,eventType:e.eventType,turn:e.turnIndex,payload:e.publicPayload}));
  };
  signal.throwIfAborted();const result=await handlers[name]({deps,scope,simulation:sim,signal,actor:scope.actorId as `user:${string}`,snapshot,observed,args});signal.throwIfAborted();return result;
 }}));
}
export function createBookToolRuntime(deps:BookToolDeps){return new InProcessAgentRuntime({...deps.scope},createBookTools(deps));}
