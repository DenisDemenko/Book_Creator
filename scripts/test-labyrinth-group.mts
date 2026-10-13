import assert from "node:assert/strict";
import { groupDemo as d, groupBindings, groupRules as rules } from "../shared/labyrinthGroupDemo";
import { groupInitialState,groupAction,groupEvent,groupWorld,validateGroup,proveGroupExit,jointReady } from "../server/core/labyrinth/groupRuntime";
import { readerProjection } from "../server/core/labyrinth/reader";
import { LabyrinthError,stateHash,validateDefinition } from "../server/core/labyrinth/model";
import { simulateRuntime } from "../server/core/labyrinth/runtime";
import { directLabyrinth } from "../server/core/labyrinth/director";
import { DIRECTOR_DEFAULTS } from "../shared/labyrinthDirector";
let passed=0;
const check=(name:string,fn:()=>void)=>{fn();passed++;console.log("✓ ГРУПА: "+name);};
const reject=(fn:()=>void)=>assert.throws(fn,LabyrinthError);
check("Правила й три герої належать чинній карті",()=>assert.deepEqual(validateGroup(validateDefinition(d),groupBindings,rules),{bindings:groupBindings,rules}));
check("Один учасник не отримує другого героя",()=>reject(()=>validateGroup(d,groupBindings.map(b=>({...b,userId:"same"})),rules)));
check("Невідомі поля й прихований герой відхиляються",()=>{reject(()=>validateGroup(d,groupBindings,{...rules,secret:true}));reject(()=>validateGroup(d,[{...groupBindings[0],heroId:"missing"},...groupBindings.slice(1)],rules));});
check("Пропуск без достатнього тайм-ауту не вмикається",()=>reject(()=>validateGroup(d,groupBindings,{...rules,absence:"skip",timeoutSeconds:0})));
const state=groupInitialState(d,rules);
check("Безпека доводиться для всіх трьох героїв",()=>{
  const proof=proveGroupExit(d,state,rules,0);let s=state;
  for(const action of proof.actions)s=simulateRuntime(d,s,action,true);
  assert.ok(d.heroes.every(h=>d.exitNodeIds.includes(s.heroes[h.id].nodeId)));
});
check("Вичерпання бюджету не називається безпечним проходженням",()=>reject(()=>proveGroupExit(d,state,rules,0,1)));
check("Кожен отримує власні знання й сцену на своєму рівні",()=>{
  const one=readerProjection(d,state,"one",["lower-entry"],"north",{});
  const three=readerProjection(d,state,"three",["upper-left"],"north",{});
  assert.ok(JSON.stringify(one).includes("SECRET_ONLY_ONE"));assert.ok(!JSON.stringify(three).includes("SECRET_ONLY_ONE"));
  assert.ok(!JSON.stringify(one).includes("THREE_PRIVATE"));assert.match(three.scene.paragraphs[0].text,/UPPER_SCENE/);
});
check("Звичайна дія не обходить спільний важіль",()=>reject(()=>groupAction(d,state,rules,0,{kind:"interact",objectId:"generator",to:"on"},"one")));
check("Підтримка потрібна на обох рівнях",()=>{
  assert.ok(jointReady(state,rules.jointActions[0]));const s=structuredClone(state);s.heroes.three.nodeId="upper-right";
  assert.equal(jointReady(s,rules.jointActions[0]),false);
  reject(()=>groupAction(d,s,rules,0,{kind:"interact",objectId:"generator",to:"on"},"one",true));
});
check("Погоджена дія змінює міст один раз і лишає початковий стан",()=>{
  const before=stateHash(state),x=groupAction(d,state,rules,0,{kind:"interact",objectId:"generator",to:"on"},"one",true);
  assert.equal(x.state.objects["bridge-gate"],"open");assert.equal(x.state.storyTime,1);assert.equal(x.cursor,1);
  assert.equal(stateHash(state),before);assert.deepEqual(x.state.heroes.two.knowledge,["TWO_PRIVATE"]);
});
check("Нові знання не поширюються іншим героям",()=>{
  const world=structuredClone(d);world.objects.find(o=>o.id==="generator")!.transitions[1].consequences={resourceDelta:{},inventoryAdd:[],inventoryRemove:[],knowledgeAdd:["NEW_SECRET"]};
  const s=groupAction(world,state,rules,0,{kind:"interact",objectId:"generator",to:"on"},"one",true).state;
  assert.ok(s.heroes.one.knowledge.includes("NEW_SECRET"));assert.ok(!s.heroes.three.knowledge.includes("NEW_SECRET"));
});
const hazard=structuredClone(d);
hazard.events=[{id:"gas",nodeIds:["upper-left"],conditions:[],warning:"Шипіння над мостом",preparation:1,duration:3,cooldown:1,effects:[],avoidance:"Спуститися драбиною",hazard:{resourceCosts:{health:2},blocksMovement:false}}];
const scheduled=groupEvent(hazard,groupInitialState(hazard,rules),rules,0,{kind:"start_event",eventId:"gas"}).state;
check("Хід знизу завдає шкоди герою в активній зоні згори",()=>{
  const x=groupAction(hazard,scheduled,rules,0,{kind:"wait"},"one");
  assert.equal(x.state.heroes.one.resources.health,100);assert.equal(x.state.heroes.three.resources.health,98);
});
check("Ресурси будь-якого героя перевіряються до прийняття ходу",()=>{
  const s=structuredClone(scheduled);s.heroes.three.resources.health=1;
  reject(()=>groupAction(hazard,s,rules,0,{kind:"wait"},"one"));assert.equal(s.heroes.three.resources.health,1);
});
check("Герой після відкликання не переходить під чужий контроль",()=>{
  const world=groupWorld(hazard,["one","two"]),s=simulateRuntime(world,scheduled,{kind:"wait",heroId:"one"},true);
  assert.equal(s.heroes.three.resources.health,100);
});
check("Вибулий герой не може бути прихованою підтримкою спільного механізму",()=>{
  const world=groupWorld(d,["one","two"]);
  reject(()=>groupAction(world,state,{...rules,order:["one","two"]},0,{kind:"interact",objectId:"generator",to:"on"},"one",true));
});
const directed=structuredClone(hazard);
directed.director={...DIRECTOR_DEFAULTS,enabled:true,confidenceThreshold:0.4};
directed.events[0].director={intent:"challenge",priority:20};
const initial=groupInitialState(directed,rules);
const out=await directLabyrinth(directed,{id:"fixture",projectId:"fixture",mapId:"fixture",mapRevision:1,revision:0,seed:"fixture",
  difficulty:"reader_group",mode:"runtime",participants:[],state:initial,createdBy:"user:owner",createdAt:new Date().toISOString()},false,{},
  {step:(_d,s,a)=>groupEvent(directed,s,rules,0,a),prove:(_d,s,b)=>proveGroupExit(directed,s,rules,0,b)});
check("Jev використовує спільну safety-перевірку без платного виклику",()=>{
  assert.equal(out.trace.calls,0);assert.equal(out.trace.source,"rules");assert.equal(out.trace.eventId,"gas");assert.ok(out.state.engine!.events.length);
});
console.log("Підсумок: "+passed+" пройшло.");
