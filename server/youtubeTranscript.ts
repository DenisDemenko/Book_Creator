import { normalizeSegments, youtubeVideoId, type TranscriptSource } from '../shared/youtubeTranscript';
export class TranscriptError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function boundedYoutubeText(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'www.youtube.com' || u.port || u.username || u.password || !['/watch','/api/timedtext'].includes(u.pathname)) throw new TranscriptError(422, 'Недозволена адреса субтитрів.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetcher(u, {signal: controller.signal, redirect:'error', headers:{'Accept-Language':'uk,en;q=0.8'}});
    if (!r.ok || !r.body) throw new TranscriptError(422, 'YouTube не надав розшифровку. Завантажте SRT/VTT або вставте текст.');
    const reader = r.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const {done,value} = await reader.read(); if(done) break; size += value.length; if(size > 8*1024*1024) throw new TranscriptError(413,'Відповідь YouTube завелика.'); chunks.push(value); } } finally { await reader.cancel().catch(()=>{}); }
    return Buffer.concat(chunks).toString('utf8');
  } catch(e) { if(e instanceof TranscriptError) throw e; throw new TranscriptError(502,'YouTube недоступний або перевищено час очікування. Спробуйте SRT/VTT.'); }
  finally { clearTimeout(timer); }
}
export function playerResponse(html: string): any {
  const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/g.exec(html);
  if (!marker) throw new TranscriptError(422,'YouTube не надав доступних субтитрів. Скористайтеся ручним імпортом.');
  const start = marker.index + marker[0].length; let depth=0, quoted=false, escaped=false;
  for(let i=start;i<html.length;i++) { const c=html[i]; if(quoted) {if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false;} else {if(c==='"') quoted=true; else if(c==='{') depth++; else if(c==='}' && --depth===0) {try{return JSON.parse(html.slice(start,i+1));}catch{break;}}} }
  throw new TranscriptError(422,'Некоректна відповідь YouTube.');
}
export async function loadYoutube(raw: unknown, language?: unknown, fetcher: typeof fetch = fetch) {
  const id = youtubeVideoId(raw), url=`https://www.youtube.com/watch?v=${id}`;
  const p=playerResponse(await boundedYoutubeText(url,fetcher));
  if(p.playabilityStatus?.status !== 'OK') throw new TranscriptError(422,'Відео недоступне. Імпорт не обходить обмеження YouTube.');
  const tracks = p.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if(!Array.isArray(tracks) || !tracks.length) throw new TranscriptError(422,'Субтитрів немає. Завантажте SRT/VTT або вставте текст.');
  const languages = tracks.map((t:any)=>({id:String(t.vssId),language:String(t.languageCode),name:String(t.name?.simpleText || t.languageCode),origin:t.kind==='asr'?'automatic':'author'}));
  const track = language === undefined ? tracks[0] : tracks.find((t:any)=>t.vssId===language);
  if(!track) throw new TranscriptError(422,'Обрана мова недоступна.');
  const captionUrl=new URL(track.baseUrl); captionUrl.searchParams.set('fmt','json3');
  const data=JSON.parse(await boundedYoutubeText(captionUrl.toString(),fetcher));
  const segments=normalizeSegments((data.events || []).filter((e:any)=>Array.isArray(e.segs)).map((e:any)=>({start:e.tStartMs/1000,duration:(e.dDurationMs||0)/1000,text:e.segs.map((s:any)=>s.utf8||'').join('')})));
  const source: TranscriptSource={videoId:id,url,title:String(p.videoDetails?.title||id).slice(0,500),language:String(track.languageCode),origin:track.kind==='asr'?'automatic':'author',importedAt:new Date().toISOString(),segments};
  return {source,languages,selectedLanguage:String(track.vssId)};
}
