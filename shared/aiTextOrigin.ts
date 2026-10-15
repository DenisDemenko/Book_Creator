/** Editorial metadata only. Never put prompts, keys, provider URLs or private source bytes here. */
export interface AiTextOrigin {
 v:1; id:string; origin:'ai'; status:'accepted'; acceptedAt:string; acceptedBy:string;
 parentId?:string; modelId?:string; jobId?:string;
}
const safe=(value:unknown,max=160)=>typeof value==='string'?value.slice(0,max):'';
export function normalizeAiOrigin(value:unknown):AiTextOrigin|null {
 if(!value||typeof value!=='object')return null;
 const p=value as Record<string,unknown>;
 if(p.v!==1||p.origin!=='ai'||p.status!=='accepted'||!safe(p.id)||!safe(p.acceptedBy)||!Number.isFinite(Date.parse(String(p.acceptedAt))))return null;
 return {v:1,id:safe(p.id),origin:'ai',status:'accepted',acceptedAt:String(p.acceptedAt),acceptedBy:safe(p.acceptedBy),
 ...(safe(p.parentId)?{parentId:safe(p.parentId)}:{}),...(safe(p.modelId)?{modelId:safe(p.modelId)}:{}),...(safe(p.jobId)?{jobId:safe(p.jobId)}:{})};
}
export function aiOriginOpen(value:AiTextOrigin):string {
 const clean=normalizeAiOrigin(value);if(!clean)throw new Error('Invalid AI origin');
 return '[AI-GENERATED:'+encodeURIComponent(JSON.stringify(clean))+']';
}
export const AI_ORIGIN_CLOSE='[/AI-GENERATED]';
export function parseAiOriginOpen(marker:string):AiTextOrigin|null {
 const m=marker.match(/^\[AI-GENERATED:([^\]\r\n]{1,6000})\]$/);
 if(!m)return null;try{return normalizeAiOrigin(JSON.parse(decodeURIComponent(m[1])));}catch{return null;}
}
export function acceptAiOrigin(actor:string,previous?:AiTextOrigin|null,now=new Date().toISOString(),id:string=globalThis.crypto.randomUUID()):AiTextOrigin {
 return previous??{v:1,id,origin:'ai',status:'accepted',acceptedAt:now,acceptedBy:actor||'local-author'};
}
export function stripAiTextMarkers(text:string):string {
 if (!/\[(?:\/?AI-DRAFT|AI-GENERATED:|\/AI-GENERATED)/.test(text)) return text;
 return String(text??'').replace(/\r\n/g,'\n')
 .replace(/\[(?:\/?AI-DRAFT|AI-GENERATED:[^\]\r\n]*|\/AI-GENERATED)\]/g,'')
 .replace(/\n{3,}/g,'\n\n').trim();
}
export interface AiTextFragment {origin:AiTextOrigin|null;status:'draft'|'accepted';start:number;end:number;textStart:number;textEnd:number;text:string}
export function aiTextFragments(text:string):AiTextFragment[] {
 const out:AiTextFragment[]=[],stack:Array<{origin:AiTextOrigin|null;start:number;textStart:number}>=[];
 const re=/\[(AI-DRAFT|AI-GENERATED:[^\]\r\n]*|\/AI-DRAFT|\/AI-GENERATED)\]/g;
 for(const match of text.matchAll(re)){
  const token=match[1],origin=parseAiOriginOpen(match[0].trim());
  if(token==='AI-DRAFT'||origin){stack.push({origin,start:match.index!,textStart:match.index!+match[0].length});continue;}
  const frame=stack.at(-1);if(!frame)continue;
  if(token!==(frame.origin?'/AI-GENERATED':'/AI-DRAFT'))continue;
  stack.pop();const body=text.slice(frame.textStart,match.index);
  if(stripAiTextMarkers(body).trim())out.push({...frame,status:frame.origin?'accepted':'draft',end:match.index!+match[0].length,textEnd:match.index!,text:body.trim()});
 }
 return out.sort((a,b)=>a.start-b.start);
}
export function aiMetadataSpans(text:string):[number,number][] {
 return aiTextFragments(text).flatMap(f=>[[f.start,f.textStart],[f.textEnd,f.end]] as [number,number][]);
}

/** Central insertion contract. AI suggestions always require a fresh review. */
export function aiDraftText(text:string):string {
 const body=stripAiTextMarkers(text).trim();
 return body?'[AI-DRAFT]\n\n'+body+'\n\n[/AI-DRAFT]':'';
}
export function acceptedAiText(text:string,actor='local-author'):string {
 const body=stripAiTextMarkers(text).trim();
 return body?aiOriginOpen(acceptAiOrigin(actor))+'\n\n'+body+'\n\n'+AI_ORIGIN_CLOSE:'';
}
