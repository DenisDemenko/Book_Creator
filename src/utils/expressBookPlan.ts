import { aiDraftText } from '../../shared/aiTextOrigin';
import type {Book,Character} from '../types';
import type {ExpressWizardPayload} from '../components/ExpressWizardView';
import {normalizeCharacter} from './characterNormalize';
import {buildExpressSemanticTagPrefix} from './expressSemanticHandoff';
export function expressPlanToBook(book:Book,plan:ExpressWizardPayload,stamp=Date.now()):Book {
 const now=new Date(stamp).toISOString();
 const characters=(plan.cast??[]).map((c,i)=>{
  const existing=book.characters.find(old=>old.id===c.id);
  return normalizeCharacter({...existing,id:c.id||('char-express-'+stamp+'-'+i),bookId:book.id,name:c.firstName,surname:c.lastName,
   role:existing?.role??(i===0?'protagonist':i===1?'antagonist':'ally'),
   biography:[c.hook,c.psychotype,c.poltiRoleName?'Роль у творі: '+c.poltiRoleName:''].filter(Boolean).join('\n\n'),
   appearance:{...existing?.appearance,...(c.appearance?{distinguishingMarks:c.appearance}:{})},
   personality:{...existing?.personality,goals:c.goal?[c.goal]:existing?.personality?.goals??[],internalConflict:c.flaw??existing?.personality?.internalConflict??''},
  } as Character);
 });
 const chapters=(plan.parts??[]).map((part,pi)=>({
  id:'chap-express-'+stamp+'-'+pi,bookId:book.id,title:part.partTitle||('Частина '+(pi+1)),order:pi+1,
  sections:(part.chapters??[]).map((chapter,ci)=>{
   const summary=(chapter.summary??'').replace(/^(?:\[\/(?:chapter|outline|character):[^\]\r\n]*\]\s*)+/,'');
   const involved=[...(chapter.involvedCharacters??[]),...(chapter.involvedCharacterIds??[]).flatMap(id=>{
    const c=(plan.cast??[]).find(c=>c.id===id);return c?[c.firstName+' '+c.lastName]:[];
   })];
   const prefix=buildExpressSemanticTagPrefix({...chapter,involvedCharacters:involved},plan.cast??[]);
   const choices=(chapter.choices??[]).map(c=>'Вибір: '+c.label+' → '+c.destination+'. Наслідок: '+c.consequence).join('\n');
   const body=[summary,chapter.turningPoint?'Поворот: '+chapter.turningPoint:'',chapter.environmentalContext?'Стихія: '+chapter.environmentalContext:'',choices].filter(Boolean).join('\n\n');
   const content=prefix+'\n\n'+(chapter.source==='author'?body:aiDraftText(body));
   return {id:'sec-express-'+stamp+'-'+pi+'-'+ci,chapterId:'chap-express-'+stamp+'-'+pi,title:chapter.chapterTitle||('Глава '+(ci+1)),order:ci+1,
    content,wordCount:body.trim().split(/\s+/).filter(Boolean).length,lastModified:now,
    wizardSourceIds:chapter.sourceIds??[],narrativeChoices:chapter.choices??[],
   };
  }),
 }));
 return {...book,...(plan.storyWorld?{storyWorld:plan.storyWorld}:{}),genre:plan.genre||book.genre,logline:plan.seed||book.logline,synopsis:plan.synopsis||book.synopsis,
  characters:plan.cast!==undefined||plan.targetCastSize===0?characters:book.characters,chapters:chapters.length?chapters:book.chapters,heroArc:plan.heroArc||book.heroArc,
  wizardContext:{entryMode:plan.entryMode??'idea',framework:plan.framework??'hero_journey',canonicalSourceBookId:plan.canonicalSourceBookId,
   sourceReferences:(plan.sourceMaterials??[]).filter(s=>s.approved).map(s=>({id:s.id,title:s.title,kind:s.kind,...(s.kind==='url'?{url:s.url}:{})}))},
 };
}
