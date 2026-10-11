import type { Express, Request, Response } from 'express';
import { requireAuth } from './auth';
import { resolveRealtimeAccess, type RealtimeAccessDeps } from './realtimeAuth';
import { parseSubtitles, transcriptText, youtubeVideoId, normalizeSegments } from '../shared/youtubeTranscript';
import { loadYoutube, TranscriptError } from './youtubeTranscript';
export function registerYoutubeTranscriptRoutes(app: Express, deps: RealtimeAccessDeps, fetcher: typeof fetch = fetch) {
  const active = new Set<string>();
  async function allowed(req: Request) {
    if (!req.principal || req.principal.isGuest || ('disabled' in req.principal && req.principal.disabled)) return false;
    const a=await resolveRealtimeAccess(req.principal,String(req.params.bookId),deps);
    // Private fallback rooms are not proof of ownership of a saved project.
    return !!a?.shared && a.canWrite && !a.scoped && !a.restricted;
  }
  for(const operation of ['preview','confirm'] as const) app.post(`/api/knowledge/books/:bookId/youtube/${operation}`,requireAuth,async(req:Request,res:Response)=>{
    res.set('Cache-Control','no-store');
    const key=req.principal!.id!;
    let locked=false;
    try {
      if(!await allowed(req)) return res.status(403).json({error:'Збережіть книгу на сервері; потрібен повний доступ до редагування її джерел.'});
      const b=req.body;
      if(!b || typeof b!=='object') throw new TranscriptError(422,'Некоректний запит.');
      if(operation==='confirm') {
        if(b.confirmed!==true || typeof b.text!=='string' || !b.text.trim() || Buffer.byteLength(b.text)>2*1024*1024) throw new TranscriptError(422,'Підтвердьте непорожній текст до 2 МБ.');
        const videoId=youtubeVideoId(b.url);
        if (!Array.isArray(b.segments)) throw new TranscriptError(422,'Потрібні сегменти розшифровки.');
        const segments=normalizeSegments(b.segments);
        return res.json({source:{videoId,url:`https://www.youtube.com/watch?v=${videoId}`,title:String(b.title||videoId).slice(0,500),language:String(b.language||'und').slice(0,30),origin:['author','automatic','manual'].includes(b.origin)?b.origin:'manual',importedAt:new Date().toISOString(),segments},text:b.text.trim()});
      }
      if(active.has(key)) throw new TranscriptError(429,'Дочекайтеся попереднього імпорту.');
      active.add(key); locked=true;
      let result;
      if(b.format) {
        if(!['srt','vtt','text'].includes(b.format)) throw new TranscriptError(422,'Потрібен SRT, VTT або текст.');
        const videoId=youtubeVideoId(b.url),segments=parseSubtitles(b.text,b.format);
        result={source:{videoId,url:`https://www.youtube.com/watch?v=${videoId}`,title:videoId,language:'und',origin:'manual',importedAt:new Date().toISOString(),segments},languages:[],selectedLanguage:''};
      } else result=await loadYoutube(b.url,b.language,fetcher);
      if(!await allowed(req)) return res.status(403).json({error:'Доступ відкликано.'});
      res.json({...result,text:transcriptText(result.source.segments)});
    }catch(e){res.status(e instanceof TranscriptError?e.status:422).json({kind:e instanceof TranscriptError?e.kind:'invalid_transcript',error:e instanceof TranscriptError?e.message:(e instanceof SyntaxError?'Некоректні субтитри YouTube.':(e as Error).message || 'Некоректний імпорт.')});}
    finally{if(locked) active.delete(key);}
  });
}
