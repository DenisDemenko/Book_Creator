/** One world clock. Bounded joint proof includes free turn passes and fails closed. */
import type { LabyrinthDefinition as World, LabyrinthRunState as State, RuntimeAction } from "../../../shared/labyrinth";
import type { GroupBinding, GroupRules, JointAction } from "../../../shared/labyrinthGroup";
import { initialState, LabyrinthError, stateHash } from "./model";
import { effectiveObjects, simulateRuntime } from "./runtime";
import { readerAction } from "./reader";
const bad = (text: string): never => { throw new LabyrinthError(422, text); };
const reject = (): never => { throw new LabyrinthError(409, "Спільну дію або безпечне продовження зараз не доведено."); };
const exact = (x: unknown, keys: string[]) => {
  if (!x || typeof x !== "object" || Array.isArray(x) || Object.keys(x).length !== keys.length ||
    Object.keys(x).some((k) => !keys.includes(k))) bad("Некоректні налаштування групи.");
  return x as Record<string, any>;
};
export function validateGroup(d: World, inputBindings: unknown, inputRules: unknown): { bindings: GroupBinding[]; rules: GroupRules } {
  if (!Array.isArray(inputBindings) || inputBindings.length < 2 || inputBindings.length > 12) bad("Група має містити від двох до дванадцяти героїв.");
  const bindings = (inputBindings as unknown[]).map((x) => {
    const b = exact(x, ["heroId", "userId", "alias"]);
    if (!d.heroes.some((h) => h.id === b.heroId) ||
      (b.userId !== null && (typeof b.userId !== "string" || !b.userId || b.userId.length > 200)) ||
      typeof b.alias !== "string" || !b.alias.trim() || b.alias.trim().length > 80) bad("Виберіть героя, учасника й коротке ім'я.");
    return { heroId: b.heroId as string, userId: b.userId as string | null, alias: b.alias.trim() };
  });
  const human = bindings.filter((b) => b.userId !== null);
  if (!human.length || new Set(human.map((b) => b.userId)).size !== human.length ||
    new Set(bindings.map((b) => b.heroId)).size !== bindings.length) bad("Один учасник керує одним власним героєм.");
  const r = exact(inputRules, ["order", "decision", "timeoutSeconds", "absence", "jointActions"]);
  if (!Array.isArray(r.order) || r.order.length !== bindings.length || new Set(r.order).size !== bindings.length ||
    r.order.some((id: unknown) => !bindings.some((b) => b.heroId === id)) ||
    !["unanimous", "majority"].includes(r.decision) || !["pause", "skip"].includes(r.absence) ||
    !Number.isSafeInteger(r.timeoutSeconds) || r.timeoutSeconds < 0 || r.timeoutSeconds > 3600 ||
    (r.absence === "skip" && r.timeoutSeconds < 5) ||
    !Array.isArray(r.jointActions) || r.jointActions.length > 20) bad("Перевірте порядок, голосування й правила відсутності.");
  const jointActions: JointAction[] = r.jointActions.map((x: unknown) => {
    const j = exact(x, ["id", "label", "objectId", "to", "supports"]);
    const obj = d.objects.find((o) => o.id === j.objectId);
    if (typeof j.id !== "string" || !/^[a-zA-Z0-9._:-]{1,128}$/.test(j.id) ||
      ["constructor","prototype","__proto__"].includes(j.id) ||
      typeof j.label !== "string" || !j.label.trim() || j.label.length > 160 ||
      !obj?.transitions.some((t) => t.to === j.to) || !Array.isArray(j.supports) ||
      j.supports.length < 2 || j.supports.length > bindings.length) bad("Спільній дії потрібні механізм і щонайменше два місця підтримки.");
    const supports = j.supports.map((x: unknown) => {
      const v = exact(x, ["heroId", "nodeId"]);
      if (!bindings.some((b) => b.heroId === v.heroId) || !d.nodes.some((n) => n.id === v.nodeId)) bad("Місце підтримки належить вибраній карті та герою.");
      return { heroId: v.heroId as string, nodeId: v.nodeId as string };
    });
    if (new Set(supports.map((v: { heroId: string }) => v.heroId)).size !== supports.length ||
      !supports.some((v: {nodeId:string}) => v.nodeId === obj!.nodeId)) bad("Кожен герой має одне місце; один із них має бути біля механізму.");
    return { id: j.id, label: j.label.trim(), objectId: j.objectId, to: j.to, supports };
  });
  if (new Set(jointActions.map((j) => j.id)).size !== jointActions.length ||
    new Set(jointActions.map((j) => j.objectId + ":" + j.to)).size !== jointActions.length) bad("Повторна спільна дія.");
  return { bindings, rules: { order: [...r.order], decision: r.decision, timeoutSeconds: r.timeoutSeconds, absence: r.absence, jointActions } };
}
export function groupWorld(d: World, ids: string[]): World {
  return { ...d, heroes: ids.map((id) => {
    const h = d.heroes.find((h) => h.id === id); if (!h) bad("Героя не відкрито в цій версії."); return h!;
  }) };
}
export const jointFor = (r: GroupRules, action: RuntimeAction) =>
  action.kind === "interact" ? r.jointActions.find((j) => j.objectId === action.objectId && j.to === action.to) : undefined;
export const jointReady = (s: State, j: JointAction) => j.supports.every((v) => s.heroes[v.heroId]?.nodeId === v.nodeId);
export function nextCursor(d: World, s: State, r: GroupRules, cursor: number) {
  for (let i=0; i<r.order.length; i++) {
    const next=(cursor+i)%r.order.length;
    if (!d.exitNodeIds.includes(s.heroes[r.order[next]].nodeId)) return next;
  }
  return cursor % r.order.length;
}
function simulate(d: World, s: State, r: GroupRules, action: RuntimeAction) {
  const joint = jointFor(r, action);
  if (joint && (!jointReady(s, joint) || !joint.supports.every(v=>d.heroes.some(h=>h.id===v.heroId)))) reject();
  return simulateRuntime(d, s, action, true);
}
export function proveGroupExit(d: World, s: State, rules: GroupRules, cursor: number, budget=20000) {
  const allOut = (s: State) => d.heroes.every((h) => d.exitNodeIds.includes(s.heroes[h.id].nodeId));
  const horizon = Math.max(s.storyTime, ...(s.engine?.events ?? []).map((v) => {
    const e=d.events.find((e) => e.id===v.eventId)!;
    return v.resolvedAt ?? v.startedAt+e.preparation+e.duration;
  }));
  const distances = new Map<string,number>(d.exitNodeIds.map((id)=>[id,0]));
  for (let i=0;i<d.nodes.length;i++) {
    let changed=false;
    for (const e of d.edges) {
      if (distances.has(e.to) && (!distances.has(e.from) || distances.get(e.from)!>distances.get(e.to)!+1)) {distances.set(e.from,distances.get(e.to)!+1);changed=true;}
      if (e.bidirectional && distances.has(e.from) && (!distances.has(e.to) || distances.get(e.to)!>distances.get(e.from)!+1)) {distances.set(e.to,distances.get(e.from)!+1);changed=true;}
    }
    if (!changed) break;
  }
  type Entry={state:State;cursor:number;path:RuntimeAction[];score:number};
  const score=(state:State)=>d.heroes.reduce((n,h)=>n+(distances.get(state.heroes[h.id].nodeId)??10000),0);
  const heap:Entry[]=[];
  const push=(entry:Entry)=> {heap.push(entry);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p].score<=entry.score)break;heap[i]=heap[p];i=p;}heap[i]=entry;};
  const pop=()=>{const result=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].score<heap[c].score)c++;if(heap[c].score>=last.score)break;heap[i]=heap[c];i=c;}heap[i]=last;}return result;};
  push({state:s,cursor:nextCursor(d,s,rules,cursor),path:[],score:score(s)});
  const seen=new Set<string>(); let work=0;
  while(heap.length && ++work<=budget) {
    const current=pop(), state=current.state;
    if(allOut(state)) return {actions:current.path,arrivalTime:state.storyTime};
    const hash=stateHash({state:{...state,turn:0,storyTime:Math.min(state.storyTime,horizon),engine:{...state.engine,director:undefined}},cursor:current.cursor});
    if(seen.has(hash))continue;seen.add(hash);
    const heroId=rules.order[current.cursor],nodeId=state.heroes[heroId].nodeId;
    const actions:RuntimeAction[]=d.edges.filter(e=>e.from===nodeId||(e.bidirectional&&e.to===nodeId)).map(e=>({kind:"move",heroId,edgeId:e.id}));
    const objects=effectiveObjects(d,state);
    for(const o of d.objects.filter(o=>o.nodeId===nodeId)) for(const t of o.transitions)
      if(t.from===objects[o.id]) actions.push({kind:"interact",heroId,objectId:o.id,to:t.to});
    if(state.storyTime<horizon)actions.push({kind:"wait",heroId});
    const next=nextCursor(d,state,rules,(current.cursor+1)%rules.order.length);
    if(next!==current.cursor)push({state,cursor:next,path:current.path,score:score(state)});
    for(const action of actions) {
      work+=(action.kind==="move"?d.edges.find(e=>e.id===action.edgeId)!.duration:1)*(d.events.length+d.heroes.length);
      if(work>budget)break;
      try {
        const state2=simulate(d,state,rules,action);
        push({state:state2,cursor:nextCursor(d,state2,rules,(current.cursor+1)%rules.order.length),
          path:[...current.path,action],score:score(state2)});
      } catch(e) {if(!(e instanceof LabyrinthError))throw e;}
    }
  }
  reject();
}
export function groupInitialState(d: World, r: GroupRules) {
  const s=initialState(d);
  if(d.heroes.some(h=>h.resources.health===0)) reject();
  s.engine={version:1,events:[]};
  if(d.director?.enabled)s.engine.director={decisions:0,modelCalls:0,lastDecisionTime:null,recentMoves:[]};
  proveGroupExit(d,s,r,0);
  return s;
}
export function groupAction(d:World,s:State,r:GroupRules,cursor:number,input:unknown,heroId:string,jointApproved=false) {
  const action=readerAction(input,heroId);
  if(jointFor(r,action)&&!jointApproved)throw new LabyrinthError(409,"Для цієї дії потрібна згода групи.");
  const state=simulate(d,s,r,action);
  if(action.kind==="move"&&state.engine?.director) state.engine.director.recentMoves=[...state.engine.director.recentMoves,
    {from:s.heroes[heroId].nodeId,to:state.heroes[heroId].nodeId,edgeId:action.edgeId}].slice(-8);
  const next=nextCursor(d,state,r,(cursor+1)%r.order.length);
  return {action,state,cursor:next,proof:proveGroupExit(d,state,r,next)};
}
export function groupEvent(d:World,s:State,r:GroupRules,cursor:number,input:unknown) {
  const x=exact(input,["kind","eventId"]);
  if(x.kind!=="start_event"||typeof x.eventId!=="string") bad("Некоректна подія.");
  const action={kind:"start_event" as const,eventId:x.eventId};
  const state=simulate(d,s,r,action);
  return {action,state,proof:proveGroupExit(d,state,r,cursor)};
}
