import type {Book} from '../types';
import type {WorldBase} from '../../shared/storyWorld';
import {aiOriginOpen,AI_ORIGIN_CLOSE} from '../../shared/aiTextOrigin';
import {calculateWordCount} from './helpers';
export function worldProse(value:WorldBase,kind:'world'|'location'|'setting'):string {
 if(!value.description.trim())return '';
 const tag='[/'+(kind==='setting'?'scene':kind)+':'+value.name.replace(/[\]\r\n]/g,'')+']';
 const body=value.descriptionOrigin?aiOriginOpen(value.descriptionOrigin)+'\n\n'+value.description+'\n\n'+AI_ORIGIN_CLOSE:value.description;
 return tag+'\n\n'+body;
}
/** Explicit target only. Never silently fall back to a different scene. */
export function insertWorldDescription(book:Book,chapterId:string,sectionId:string,text:string,at:'start'|'end'='end'):Book|null{
 const chapter=book.chapters.find(c=>c.id===chapterId),section=chapter?.sections.find(s=>s.id===sectionId);
 if(!section||!text.trim())return null;
 const content=(at==='start'?[text,section.content]:[section.content,text]).filter(Boolean).join('\n\n');
 return {...book,chapters:book.chapters.map(c=>c.id!==chapterId?c:{...c,sections:c.sections.map(s=>s.id!==sectionId?s:{...s,content,wordCount:calculateWordCount(content),lastModified:new Date().toISOString()})})};
}
