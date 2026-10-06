import assert from 'node:assert/strict';
import {InProcessAgentRuntime,HarnessAgentRuntime,HarnessNotConfiguredError,type AgentRuntime} from '../server/ai/adapters/harness';
import {HttpJevAdapter,MockJevAdapter} from '../server/ai/adapters/jev';
import {validateDecision,snapshotHash,type CharacterSnapshot,type JevQuestion} from '../server/ai/contracts';
const snapshot:CharacterSnapshot={character_id:'hero',name:'Олена',as_of_chapter:1,canon:[],confirmed_facts:[],current_states:[],relations:[],recent_appearances:[],situation:'Лист',allowed_actions:['answer','silence']};
const questions:JevQuestion[]=[{id:'next_action',kind:'choice',instructions:'Дія',options:{answer:'відповісти',silence:'промовчати'}},{id:'fear',kind:'score',instructions:'Страх',levels:['спокій','страх']}];
let n=0;const check=(name:string,run:()=>void)=>{run();n++;console.log('✓ '+name);};
const invoke=async(runtime:AgentRuntime)=>runtime.step('hero',['read'],async context=>({decision:await context.tool('read'),character:context.scope.characterId}));
const tools=[{name:'read',description:'scoped fixture',run:async(_args,scope)=>({character:scope.characterId,value:1})}];
const scope={projectId:'project',characterId:'hero',actorId:'user:owner',simulationId:'sim',sceneId:'scene'};
const before=await invoke(new InProcessAgentRuntime(scope,tools));
// Simulated replacement adapter with different internal runtime; consumer code unchanged.
class ReplacementRuntime implements AgentRuntime{readonly name='contract-replacement';constructor(private runtime:AgentRuntime){}get trace(){return this.runtime.trace;}step<R>(agent:string,allow:string[],run:Parameters<AgentRuntime['step']>[2],opts?:Parameters<AgentRuntime['step']>[3]){return this.runtime.step<R>(agent,allow,run as any,opts);}}
const replacement=new ReplacementRuntime(new InProcessAgentRuntime(scope,tools));const after=await invoke(replacement);check('незмінний споживач працює після заміни реалізації рантайму',()=>assert.deepEqual(after,before));
await assert.rejects(()=>replacement.step('hero',[],context=>context.tool('read')));check('адаптер зберігає заборону незареєстрованих дозволів',()=>assert.ok(replacement.trace.some(e=>e.kind==='tool_denied')));
for(const model of ['jev-contract-v1','jev-contract-v2']){
 const adapter=new HttpJevAdapter('fixture',{model,fetchImpl:async(_url,options)=>{const request=JSON.parse(String(options.body));assert.equal(request.model,model);return new Response(JSON.stringify({model,answers:{next_action:{choice:'answer',probabilities:{answer:.9,silence:.1}},fear:{score:1}},usage:{input_tokens:10,output_tokens:2}}),{status:200});}});
 const decision=await adapter.evaluate(snapshot,questions);check('версія провайдера '+model+' зберігає контракт Story Core',()=>{assert.ok(validateDecision(decision).ok);assert.equal(decision.model_version,model);assert.equal(decision.selected_action,'answer');assert.equal(decision.scores.fear,10);assert.equal(decision.snapshot_hash,snapshotHash(snapshot));});
}
const invalid=new HttpJevAdapter('fixture',{fetchImpl:async()=>new Response(JSON.stringify({model:'bad',answers:{next_action:{choice:'unauthorized'},fear:{score:100}}}),{status:200})});const bad=await invalid.evaluate(snapshot,questions);check('недозволена дія нової відповіді виправляється до дозволеної',()=>{assert.ok(snapshot.allowed_actions.includes(bad.selected_action));assert.equal(bad.corrected,true);assert.equal(validateDecision(bad).ok,false);});
const mock=await new MockJevAdapter().evaluate(snapshot,questions);check('mock і HTTP повертають однакову схему',()=>assert.ok(validateDecision(mock).ok));
const notConfigured:AgentRuntime=new HarnessAgentRuntime();await assert.rejects(()=>notConfigured.step('hero',[],async()=>{}),HarnessNotConfiguredError);check('непідключений DeepSeek Harness дає явну відмову',()=>{});
console.log(`${n} контрактних перевірок; реальний upgrade Harness не перевірявся.`);
