import { z } from 'zod';
import type { AiTextOrigin } from './aiTextOrigin';
export interface WorldBase {id:string;name:string;description:string;notes?:string;approved:boolean;descriptionOrigin?:AiTextOrigin}
export interface StoryWorld extends WorldBase {era?:string;history?:string;geography?:string;culture?:string;rules?:string;limits?:string;technology?:string;atmosphere?:string}
export interface StoryLocation extends WorldBase {worldId?:string;architecture?:string;objects?:string;spatialLayout?:string;mediaIds?:string[]}
export interface SceneSetting extends WorldBase {locationId?:string;time?:string;season?:string;weather?:string;light?:string;sounds?:string;smells?:string;colors?:string;objects?:string;positions?:string;beforeAfter?:string;atmosphere?:string}
export const WORLD_FIELDS=[['name','Назва','Name'],['description','Опис світу','World description'],['era','Епоха','Era'],['history','Історія','History'],['geography','Географія','Geography'],['culture','Культура й побут','Culture and everyday life'],['technology','Технології та магія','Technology and magic'],['rules','Правила','Rules'],['limits','Обмеження','Limits'],['atmosphere','Тон і атмосфера','Tone and atmosphere'],['notes','Робочі нотатки','Working notes']] as const;
export const LOCATION_FIELDS=[['name','Назва локації','Location name'],['description','Опис локації','Location description'],['architecture','Архітектура й матеріали','Architecture and materials'],['spatialLayout','Планування','Spatial layout'],['objects','Важливі предмети','Important objects'],['notes','Робочі нотатки','Working notes']] as const;
export const SETTING_FIELDS=[['name','Назва обстановки','Setting name'],['description','Опис сцени','Scene description'],['time','Час','Time'],['season','Пора року','Season'],['weather','Погода','Weather'],['light','Освітлення','Lighting'],['sounds','Звуки','Sounds'],['smells','Запахи','Smells'],['colors','Кольори','Colors'],['objects','Предмети','Objects'],['positions','Розташування героїв','Character positions'],['atmosphere','Атмосфера','Atmosphere'],['beforeAfter','Що змінилося до/після','Changes before/after'],['notes','Робочі нотатки','Working notes']] as const;
export const WIZARD_STEPS=[{key:'seed',number:1,label:'Зерно'},{key:'world',number:6,label:'Світ'},{key:'model',number:2,label:'Модель'},{key:'cast',number:3,label:'Герої'},{key:'synopsis',number:4,label:'Синопсис'},{key:'structure',number:5,label:'Структура'}] as const;
export type WizardStepKey=typeof WIZARD_STEPS[number]['key'];
export function wizardStepKey(step:number):WizardStepKey{return WIZARD_STEPS.find(s=>s.number===step)?.key??'seed';}
const fields=Object.fromEntries(WORLD_FIELDS.map(([k])=>[k,z.string().max(k==='description'||k==='notes'?16000:8000)]));
export const storyWorldSchema=z.object({...fields,id:z.string().min(1).max(160),name:z.string().max(300),description:z.string().max(16000),approved:z.boolean(),descriptionOrigin:z.unknown().optional()}).partial().required({id:true,name:true,description:true,approved:true}).strict();
export function worldCanon(world?:StoryWorld):Record<string,string>|null {
 if(!world?.approved)return null;
 return Object.fromEntries(WORLD_FIELDS.filter(([k])=>k!=='notes'&&world[k]?.trim()).map(([k])=>[k,String(world[k])]));
}
