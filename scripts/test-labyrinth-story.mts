import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {labyrinthDemo} from "../shared/labyrinthDemo";
import {runtimeInitialState,runtimeAction} from "../server/core/labyrinth/runtime";
import {assembleStory,chosenTimeline,rewriteInput,applyStoryRewrite,buildStoryBook,type StoryMaterial,type StoryEvent} from "../server/core/labyrinth/story";
import {stateHash} from "../server/core/labyrinth/model";
import type {StoryDraft} from "../shared/labyrinthStory";
let passed=0;
const check=(name:string,fn:()=>void)=>{fn();passed++;console.log("✓ ЗБІРКА: "+name);};
const world=structuredClone(labyrinthDemo);world.events=[];
world.heroes[0].knowledge=["HIDDEN_MEMORY"];world.heroes[0].goals=["HIDDEN_PLAN"];world.heroes[0].fears=["HIDDEN_FEAR"];
const run=randomUUID(),mapId=randomUUID(),heroId=world.heroes[0].id;
const journal=(edges:string[])=>{
  let state=runtimeInitialState(world);
  const events:StoryEvent[]=[{runId:run,revision:0,event:{state:structuredClone(state),private:"PRIVATE_CHAT"}}];
  for(const edgeId of edges){const action={kind:"move" as const,heroId,edgeId};state=runtimeAction(world,state,action).state;
    events.push({runId:run,revision:events.length,event:{action,state:structuredClone(state)}});}
  return {events,state};
};
const a=journal(["corridor"]),b=journal(["up","bridge","down"]);
const material=(j:typeof a):StoryMaterial=>({runId:run,mapId,revision:j.events.length-1,mapRevision:1,bookRevision:7,definition:world,
  heroes:[heroId],scenes:{},events:j.events,contributions:[],finalState:j.state});
const blocks=assembleStory(material(a)),bridge=assembleStory(material(b));
check("Два завершені маршрути дають різні тексти та точний фінал",()=>{
  assert.notDeepEqual(blocks,bridge);assert.ok(bridge.some(v=>v.text.includes("рушає мостом")));assert.ok(!blocks.some(v=>v.text.includes("рушає мостом")));
  assert.ok(blocks.filter(v=>v.kind==="ending").every(v=>v.text.includes("дістається виходу")));
});
check("Кожен фрагмент має версію, час, хід і перевірюваний відбиток джерела",()=>{
  for(const v of blocks){assert.equal(v.source.hash,stateHash(v.text));assert.equal(v.source.mapRevision,1);assert.equal(v.source.bookRevision,7);assert.ok(a.events.some(e=>e.revision===v.source.revision));}
});
check("Знання, страхи, плани, інвентар та приватний текст не входять у матеріал ШІ",()=>{
  const input=rewriteInput(blocks);for(const privateText of ["HIDDEN_MEMORY","HIDDEN_PLAN","HIDDEN_FEAR","PRIVATE_CHAT"])assert.ok(!input.includes(privateText));
});
check("Незавершене проходження і підміна фінального стану відхиляються",()=>{
  const m=material(a);m.finalState=runtimeInitialState(world);assert.throws(()=>assembleStory(m));
  const incomplete=material(journal([]));assert.throws(()=>assembleStory(incomplete));
});
check("Подія переходу має відповідати фактичному графу, а не тексту клієнта",()=>{
  const m=material(a);m.events[1].event.action.edgeId="bridge";assert.throws(()=>assembleStory(m));m.events[1].event.action.edgeId="corridor";
});
const contribution={id:randomUUID(),runId:run,sourceRevision:0,heroId,nodeId:world.startNodeId,text:"CONSENTED_ORIGINAL <img src=x>",aiAssisted:true};
const withContribution=assembleStory({...material(a),contributions:[contribution]});
check("Погоджений текст зберігається дослівно й не передається на літературну генерацію",()=>{
  assert.equal(withContribution.find(v=>v.kind==="contribution")?.text,contribution.text);
  assert.ok(!rewriteInput(withContribution).includes(contribution.text));
});
check("Повернення відсіює покинутий маршрут і внески з нього",()=>{
  const attempt=journal(["up"]),start=attempt.events[0];
  const restore:StoryEvent={runId:run,revision:2,event:{state:structuredClone(start.event.state),sourceRevision:0,recordedDirectorReused:true}};
  const finish={...a.events[1],revision:3};
  const events=[...attempt.events,restore,finish];
  const selected=chosenTimeline(events);assert.deepEqual(selected.map(e=>e.revision),[0,2,3]);
  const rebuilt=assembleStory({...material(a),revision:3,events,contributions:[{...contribution,sourceRevision:1}]});
  assert.ok(!rebuilt.some(v=>v.text.includes("драбиною")||v.kind==="contribution"));
});
check("Відсутня контрольна точка не породжує вигаданий маршрут",()=>{
  assert.throws(()=>chosenTimeline([{runId:run,revision:2,event:{state:a.state,sourceRevision:9,recordedDirectorReused:true}}]));
});
const modelInput=JSON.parse(rewriteInput(withContribution));
const response=JSON.stringify({blocks:modelInput.blocks.map((v:any)=>({id:v.id,text:"Літературно: "+v.text}))});
const proposed=applyStoryRewrite(withContribution,response);
check("ШІ створює лише пропозицію; оригінальні факти, фінал та внески незмінні",()=>{
  assert.deepEqual(proposed.map(v=>v.text),withContribution.map(v=>v.text));
  for(const v of proposed.filter(v=>v.kind==="ending"||v.kind==="contribution"))assert.equal(v.proposal,null);
});
check("Нові джерела, перестановка, пропуск, дубль та невірний JSON відхиляються",()=>{
  for(const raw of ["oops",JSON.stringify({blocks:[]}),JSON.stringify({blocks:[...modelInput.blocks].reverse()}),
    JSON.stringify({blocks:modelInput.blocks.map((v:any,i:number)=>({id:i?modelInput.blocks[0].id:"new-source",text:v.text}))})])
    assert.throws(()=>applyStoryRewrite(withContribution,raw));
});
const draft:StoryDraft={id:randomUUID(),revision:1,status:"draft",title:"Нова історія",runId:run,mapId,mapRevision:1,bookRevision:7,
  sourceRevision:1,sourceHash:stateHash(blocks),blocks:proposed,newBookId:null,ai:null,createdAt:new Date().toISOString(),generationPending:false,legalAuthorship:false,publicationReady:false};
check("Нова книга має власні ID, джерела й статус draft без копій чужих профілів",()=>{
  const book=buildStoryBook(draft,"Автор");assert.equal(book.id,"LB-STORY-"+draft.id);assert.equal(book.status,"draft");assert.deepEqual(book.characters,[]);
  assert.equal(book.labyrinthStory.publicationReady,false);assert.equal(book.labyrinthStory.legalAuthorship,false);assert.equal(book.labyrinthStory.fragments.length,draft.blocks.length);
  assert.ok(book.chapters[0].sections.some(s=>s.content.includes("[AI-DRAFT]")));
});
check("Закінчення небезпеки й повернення механізму мають джерела; сплив часу не названо перемогою",()=>{
  const d=structuredClone(world);d.events=[{id:"brief-hazard",nodeIds:[d.startNodeId],conditions:[],warning:"Коротка небезпека",preparation:0,duration:1,cooldown:1,effects:[{objectId:"generator",state:"off"}],avoidance:"Коридор",hazard:{resourceCosts:{health:1},blocksMovement:false}}];
  let state=runtimeInitialState(d);const events:StoryEvent[]=[{runId:run,revision:0,event:{state:structuredClone(state)}}];
  for(const action of [{kind:"start_event",eventId:"brief-hazard"},{kind:"wait",heroId},{kind:"move",heroId,edgeId:"corridor"}] as any[]){
    state=runtimeAction(d,state,action).state;events.push({runId:run,revision:events.length,event:{state:structuredClone(state),action}});
  }
  const result=assembleStory({...material(a),definition:d,revision:3,events,finalState:state});
  assert.ok(result.some(v=>v.text.includes("Час дії небезпеки")));
  assert.ok(result.some(v=>v.text.includes("змінює стан з «off» на «on»")));
  assert.ok(!result.some(v=>v.text.includes("Небезпеку в цьому місці подолано")));
  assert.ok(JSON.parse(rewriteInput(result)).blocks.every((v:any)=>typeof v.storyTime==="number"));
  const supplies=structuredClone(world);supplies.objects.push({id:"supplies",entityId:null,nodeId:supplies.startNodeId,kind:"cache",states:["full","empty"],initialState:"full",transitions:[{from:"full",to:"empty",conditions:[],effects:[],consequences:{resourceDelta:{ammo:5},inventoryAdd:[],inventoryRemove:[],knowledgeAdd:[]}}]});
  let inventoryState=runtimeInitialState(supplies);const inventoryEvents:StoryEvent[]=[{runId:run,revision:0,event:{state:structuredClone(inventoryState)}}];
  for(const action of [{kind:"interact",heroId,objectId:"supplies",to:"empty"},{kind:"move",heroId,edgeId:"corridor"}] as any[]){inventoryState=runtimeAction(supplies,inventoryState,action).state;inventoryEvents.push({runId:run,revision:inventoryEvents.length,event:{state:structuredClone(inventoryState),action}});}
  const inventoryBook=assembleStory({...material(a),definition:supplies,revision:2,events:inventoryEvents,finalState:inventoryState});
  assert.ok(inventoryBook.some(v=>v.text.includes("запас набоїв змінюється з 0 до 5")));assert.ok(!JSON.stringify(inventoryBook).includes("undefined"));
});
console.log("Підсумок: "+passed+" пройшло.");
