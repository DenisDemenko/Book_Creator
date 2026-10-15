import {aiTextFragments,aiMetadataSpans,stripAiTextMarkers} from '../../shared/aiTextOrigin';
import {parseEntityTagsInSource,stripEntityTags} from './coreEntities';
export interface TaggedFragment {chapterId:string;sectionId:string;field:'content'|'contentEn';start:number;end:number;text:string;tags:string[];origin:'ai'|'author_or_unknown';status:'accepted'|'draft'|'unmarked';blockId?:string}
export interface TagBook {chapters:Array<{id:string;sections:Array<{id:string;content?:string;contentEn?:string}>}>}
/** Input must already be the viewer's server projection. No hidden book lookup. */
export function manuscriptTagIndex(book:TagBook):TaggedFragment[]{
 const out:TaggedFragment[]=[];
 for(const c of book.chapters||[])for(const s of c.sections||[])for(const field of ['content','contentEn'] as const){
  const text=s[field]||'',ai=aiTextFragments(text),metadata=aiMetadataSpans(text);let carried:string[]=[];
  const mergeTags=(tags:string[])=>{
   const kinds=new Set(tags.map(t=>t.split(':')[0]));
   carried=[...new Set([...carried.filter(t=>!kinds.has(t.split(':')[0])),...tags])];
  };
  for(const match of text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)){
   const raw=match[0],begin=match.index!,finish=begin+raw.length;
   const boundaries=[...new Set([begin,finish,...metadata.flatMap(([a,b])=>[a,b]).filter(p=>p>begin&&p<finish)])].sort((a,b)=>a-b);
   for(let i=0;i<boundaries.length-1;i++){
    const start=boundaries[i],end=boundaries[i+1];
    if(metadata.some(([a,b])=>start>=a&&end<=b))continue;
    const paragraph=text.slice(start,end);if(!paragraph.trim())continue;
    const tags=parseEntityTagsInSource(paragraph).map(t=>t.tag+':'+t.value);
    const custom=paragraph.match(/^тега:\s*(.+)$/i);if(custom)tags.push('custom:'+custom[1].trim());
    const clean=stripEntityTags(paragraph);
    if(!clean.trim()||custom){mergeTags(tags);continue;}
    const f=ai.filter(a=>start>=a.textStart&&start<a.textEnd).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
    out.push({chapterId:c.id,sectionId:s.id,field,start,end,text:clean,tags:[...new Set([...carried,...tags,...(f?['origin:ai','status:'+f.status]:[])])],origin:f?'ai':'author_or_unknown',status:f?.status||'unmarked',blockId:f?.origin?.id});
   }
  }
 }
 return out;
}
export function filterTagIndex(rows:TaggedFragment[],options:{tags?:string[];origin?:string;status?:string;chapterId?:string;sectionId?:string}={}):TaggedFragment[]{
 return rows.filter(r=>(!options.origin||r.origin===options.origin)&&(!options.status||r.status===options.status)&&(!options.chapterId||r.chapterId===options.chapterId)&&(!options.sectionId||r.sectionId===options.sectionId)&&(options.tags||[]).every(t=>r.tags.some(tag=>tag.toLocaleLowerCase().includes(t.toLocaleLowerCase()))));
}
export function taggedContext(rows:TaggedFragment[]):string{
 return rows.map(r=>'['+r.chapterId+'/'+r.sectionId+':'+r.start+'-'+r.end+(r.blockId?' AI:'+r.blockId:'')+']\n'+r.text).join('\n\n');
}
export function editorialTagSpans(text:string):[number,number][]{
 return [...parseEntityTagsInSource(text).map(t=>[t.start,t.end] as [number,number]),...aiMetadataSpans(text)];
}
