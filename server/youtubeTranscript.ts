import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { normalizeSegments, parseSubtitles, youtubeVideoId, type TranscriptSource, type TranscriptSegment } from '../shared/youtubeTranscript';
export class TranscriptError extends Error { constructor(public status: number, message: string, public kind = 'transcript_unavailable') { super(message); } }
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
/** YouTube may return JSON3, legacy XML or srv3 despite a requested fmt. */
export function parseYoutubeCaptions(raw: string): TranscriptSegment[] {
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text) throw new TranscriptError(502, 'YouTube повернув порожню відповідь замість субтитрів. Спробуйте ручний імпорт розшифровки.', 'youtube_empty_captions');
  if (/^WEBVTT\b/.test(text)) return parseSubtitles(text, 'vtt');
  if (text.startsWith('{')) {
    let data: any;
    try { data = JSON.parse(text); } catch { throw new TranscriptError(502, 'YouTube повернув нерозбірну відповідь замість субтитрів.', 'youtube_caption_format'); }
    if (!Array.isArray(data.events)) throw new TranscriptError(502, 'YouTube не повернув сегментів субтитрів.', 'youtube_caption_format');
    return normalizeSegments(data.events.filter((e:any)=>Array.isArray(e.segs)).map((e:any)=>({start:e.tStartMs/1000,duration:(e.dDurationMs||0)/1000,text:e.segs.map((s:any)=>s.utf8||'').join('')})));
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || /<html\b|<!doctype html/i.test(text))
    throw new TranscriptError(502, 'YouTube повернув службову сторінку замість субтитрів. Скористайтеся ручним імпортом.', 'youtube_caption_response');
  if (XMLValidator.validate(text) !== true) throw new TranscriptError(502, 'YouTube повернув непідтримуваний формат відповіді. Доступний ручний імпорт.', 'youtube_caption_format');
  const tree = new XMLParser({preserveOrder:true, ignoreAttributes:false, trimValues:false, parseTagValue:false, processEntities:false, ignoreDeclaration:true}).parse(text);
  if (!Array.isArray(tree) || !tree.some((n:any)=>Array.isArray(n.transcript) || Array.isArray(n.timedtext)))
    throw new TranscriptError(502, 'Відповідь YouTube не містить субтитрів.', 'youtube_caption_format');
  function content(nodes:any[]):string { return nodes.map(n=>Object.entries(n).map(([k,v])=>k===':@'?'':k==='br'?' ':k==='#text'?String(v):Array.isArray(v)?content(v):'').join('')).join(''); }
  const segments:TranscriptSegment[]=[];
  function walk(nodes:any[]) { for(const n of nodes) for(const [k,v] of Object.entries(n)) {
    if (!Array.isArray(v)) continue;
    const a=n[':@']||{};
    if (k==='text' && a['@_start']!==undefined) segments.push({start:Number(a['@_start']),duration:Number(a['@_dur']||0),text:content(v)});
    else if(k==='p' && a['@_t']!==undefined) segments.push({start:Number(a['@_t'])/1000,duration:Number(a['@_d']||0)/1000,text:content(v)});
    else walk(v);
  } }
  walk(tree);
  return normalizeSegments(segments);
}
export async function loadYoutube(raw: unknown, language?: unknown, fetcher: typeof fetch = fetch) {
  const id = youtubeVideoId(raw), url=`https://www.youtube.com/watch?v=${id}`;
  const p=playerResponse(await boundedYoutubeText(url,fetcher));
  const playability = p.playabilityStatus;
  if (playability?.status !== 'OK') {
    const reason = typeof playability?.reason === 'string' ? playability.reason : '';
    if (/bot|automated|unusual traffic|robot/i.test(reason))
      throw new TranscriptError(503, 'YouTube блокує автоматичний запит із сервера. Це не означає, що відео недоступне для перегляду. Відкрийте розшифровку на YouTube та вставте текст у ручному імпорті.', 'youtube_server_blocked');
    if (playability?.status === 'LOGIN_REQUIRED')
      throw new TranscriptError(422, 'YouTube вимагає авторизації для доступу до цього відео із сервера. Ваш вхід у Studio не є входом у YouTube. Скористайтеся дозволеною розшифровкою через ручний імпорт.', 'youtube_login_required');
    if (playability?.status === 'AGE_CHECK_REQUIRED' || playability?.status === 'CONTENT_CHECK_REQUIRED')
      throw new TranscriptError(422, 'YouTube вимагає підтвердження віку або доступу. Автоматичний імпорт не обходить ці обмеження; доступний ручний імпорт дозволеного тексту.', 'youtube_access_check');
    throw new TranscriptError(422, 'YouTube не дозволив серверу отримати дані цього відео. Відкрийте відео на YouTube, щоб перевірити доступність; за наявності розшифровки вставте її текст вручну.', 'youtube_playability_unavailable');
  }
  const tracks = p.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if(!Array.isArray(tracks) || !tracks.length) throw new TranscriptError(422,'Субтитрів немає. Завантажте SRT/VTT або вставте текст.');
  const languages = tracks.map((t:any)=>({id:String(t.vssId),language:String(t.languageCode),name:String(t.name?.simpleText || t.languageCode),origin:t.kind==='asr'?'automatic':'author'}));
  const track = language === undefined ? tracks[0] : tracks.find((t:any)=>t.vssId===language);
  if(!track) throw new TranscriptError(422,'Обрана мова недоступна.');
  const captionUrl=new URL(track.baseUrl); captionUrl.searchParams.set('fmt','json3');
  let segments: TranscriptSegment[];
  try { segments=parseYoutubeCaptions(await boundedYoutubeText(captionUrl.toString(),fetcher)); }
  catch(e) {
    // Retry only the original public track URL supplied by YouTube, once. No alternate private endpoints.
    if (!(e instanceof TranscriptError) || !['youtube_empty_captions','youtube_caption_format'].includes(e.kind) || captionUrl.toString()===track.baseUrl) throw e;
    segments=parseYoutubeCaptions(await boundedYoutubeText(track.baseUrl,fetcher));
  }
  const source: TranscriptSource={videoId:id,url,title:String(p.videoDetails?.title||id).slice(0,500),language:String(track.languageCode),origin:track.kind==='asr'?'automatic':'author',importedAt:new Date().toISOString(),segments};
  return {source,languages,selectedLanguage:String(track.vssId)};
}
