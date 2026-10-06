export const MASTERY_SKILLS=[
 {id:'dialogue',name:'Діалоги',task:'Перепишіть розмову так, щоб кожен голос мав власний ритм.',questions:['Чого прагне кожен співрозмовник?','Які слова може сказати лише цей герой?']},
 {id:'conflict',name:'Конфлікт',task:'Покажіть несумісні цілі та ціну вибору без пояснення автора.',questions:['Що герой втратить?','Яка дія посилює перешкоду?']},
 {id:'subtext',name:'Підтекст',task:'Приберіть пряме пояснення наміру й передайте його дією або паузою.',questions:['Що герой приховує?','Що читач зрозуміє між рядками?']},
 {id:'emotion',name:'Емоції',task:'Замініть назву емоції на тілесну реакцію та конкретний вибір.',questions:['Який жест видає стан?','Як стан змінює рішення?']},
 {id:'description',name:'Описи',task:'Оберіть три деталі, які герой помітить саме в цій ситуації.',questions:['Чому герой помітив цю деталь?','Як опис впливає на дію?']},
 {id:'composition',name:'Композиція',task:'Переставте акценти сцени: очікування, поворот і наслідок.',questions:['Що змінилося наприкінці?','Де читач відчує поворот?']},
] as const;
export type MasterySkill=typeof MASTERY_SKILLS[number]['id'];
export interface MasteryVersion {id:string;slot:'A'|'B';text:string;at:string}
export interface MasteryExercise {
 id:string;skill:MasterySkill;depth:'short'|'deep';genre:string;target:{kind:'paragraph'|'scene'|'character';id:string};source:string;sourceHash:string;instruction:string;questions:string[];
 status:'open'|'completed'|'rejected';versions:MasteryVersion[];events:{action:string;at:string;reason?:string}[];createdAt:string;
}
export interface MasteryWorkspace {revision:number;plan:{skills:MasterySkill[];goal:string};exercises:MasteryExercise[]}
export const emptyMastery=():MasteryWorkspace=>({revision:0,plan:{skills:[],goal:''},exercises:[]});
