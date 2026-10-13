import { labyrinthDemo } from "./labyrinthDemo";
import type { GroupBinding, GroupRules } from "./labyrinthGroup";
/** Synthetic fixture, no real accounts. */
export const groupDemo=structuredClone(labyrinthDemo);
groupDemo.title="Троє біля мосту";
groupDemo.events=[];
groupDemo.objects.find(o=>o.id==="generator")!.initialState="off";
groupDemo.objects.find(o=>o.id==="bridge-gate")!.initialState="closed";
groupDemo.edges.push({id:"room-door",from:"isolated-room",to:"lower-entry",kind:"corridor",bidirectional:true,duration:1,costs:{},conditions:[],overNodeIds:[]});
groupDemo.nodes.find(n=>n.id==="lower-entry")!.description="LOWER_SCENE";
groupDemo.nodes.find(n=>n.id==="upper-left")!.description="UPPER_SCENE";
groupDemo.nodes.find(n=>n.id==="isolated-room")!.description="ROOM_SCENE";
const base=structuredClone(groupDemo.heroes[0]);
groupDemo.heroes=[
  {...structuredClone(base),id:"one",name:"Іван",knowledge:["SECRET_ONLY_ONE"],resources:{health:100,energy:40}},
  {...structuredClone(base),id:"two",name:"Олена",startNodeId:"isolated-room",knowledge:["TWO_PRIVATE"],resources:{health:100,energy:40}},
  {...structuredClone(base),id:"three",name:"Марк",startNodeId:"upper-left",knowledge:["THREE_PRIVATE"],resources:{health:100,energy:40}},
];
export const groupBindings:GroupBinding[]=[
  {heroId:"one",userId:"reader",alias:"Іван"},{heroId:"two",userId:"reader2",alias:"Олена"},{heroId:"three",userId:"reader3",alias:"Марк"}
];
export const groupRules:GroupRules={order:["one","two","three"],decision:"unanimous",timeoutSeconds:0,absence:"pause",
  jointActions:[{id:"joint-lever",label:"Разом увімкнути міст",objectId:"generator",to:"on",supports:[{heroId:"one",nodeId:"lower-entry"},{heroId:"three",nodeId:"upper-left"}]}]};
