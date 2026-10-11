import assert from 'node:assert/strict';
import express from 'express';
import { parseSubtitles, normalizeSegments, youtubeVideoId, MAX_TRANSCRIPT_BYTES } from '../shared/youtubeTranscript';
import { loadYoutube, boundedYoutubeText, playerResponse } from '../server/youtubeTranscript';
import { registerYoutubeTranscriptRoutes } from '../server/youtubeTranscriptRoutes';
let count=0;const test=async(name:string,fn:()=>unknown)=>{await fn();count++;console.log('✓ '+name);};
const url='https://www.youtube.com/watch?v=abcdefghijk';
await test('URL watch/shorts/youtu.be; сторонні адреси, порт, credentials відхилено',()=>{
 for(const u of [url,'https://youtu.be/abcdefghijk','https://www.youtube.com/shorts/abcdefghijk'])assert.equal(youtubeVideoId(u),'abcdefghijk');
 for(const u of ['http://www.youtube.com/watch?v=abcdefghijk','https://youtube.com.evil/watch?v=abcdefghijk','https://user@youtube.com/watch?v=abcdefghijk','https://localhost/','https://youtube.com:444/watch?v=abcdefghijk'])assert.throws(()=>youtubeVideoId(u));
});
const srt='1\r\n00:00:01,000 --> 00:00:03,000\r\n<b>Вітаю</b> &amp; дякую!\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nВітаю знову';
await test('SRT Unicode/CRLF/розмітка/таймкоди',()=>{const s=parseSubtitles(srt,'srt');assert.equal(s[0].text,'Вітаю & дякую!');assert.equal(s[1].start,4);assert.equal(s[0].duration,2);});
await test('VTT cue ID/налаштування/NOTE та короткий таймкод',()=>assert.deepEqual(parseSubtitles('WEBVTT\n\nNOTE example\nignore\n\ncue\n00:01.100 --> 00:03.200 align:start\nПривіт','vtt'),[{start:1.1,duration:2.1,text:'Привіт'}]));
await test('Повтор після паузи збережено; лише ідентичне перекриття об’єднано',()=>assert.equal(normalizeSegments([{start:1,duration:2,text:'так'},{start:2,duration:2,text:'так'},{start:5,duration:1,text:'так'}]).length,2));
await test('Некоректний час/порядок/порожній/великий файл відхилено',()=>{
 for(const v of ['1\n00:99:00,000 --> 00:99:02,000\na','1\n00:00:02,000 --> 00:00:01,000\na','invalid'])assert.throws(()=>parseSubtitles(v,'srt'));
 assert.throws(()=>parseSubtitles('','text'));assert.throws(()=>parseSubtitles('a'.repeat(MAX_TRANSCRIPT_BYTES+1),'text'));
 assert.throws(()=>normalizeSegments([{start:2,duration:1,text:'a'},{start:1,duration:1,text:'b'}]));
});
await test('Вставлений текст зберігає абзаци',()=>assert.equal(parseSubtitles('Перший\n\nДругий','text')[0].text,'Перший\n\nДругий'));
const player={playabilityStatus:{status:'OK'},videoDetails:{title:'Test {title}'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{vssId:'.uk',languageCode:'uk',name:{simpleText:'Українська'},baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk'},{vssId:'a.en',languageCode:'en',kind:'asr',baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk'}]}}};
let calls=0;let revoked=false;let revokeOnFetch=false;
const mock:typeof fetch=async(input,init)=>{calls++;assert.equal(init?.redirect,'error');if(revokeOnFetch)revoked=true;const u=new URL(String(input));return new Response(u.pathname==='/watch'?`var ytInitialPlayerResponse = ${JSON.stringify(player)}; next` : JSON.stringify({events:[{tStartMs:1000,dDurationMs:2000,segs:[{utf8:'Привіт'}]}]}));};
await test('Player JSON з дужками у рядку; мови і automatic provenance',async()=>{assert.equal(playerResponse(`ytInitialPlayerResponse = ${JSON.stringify(player)};`).videoDetails.title,player.videoDetails.title);const r=await loadYoutube(url,'a.en',mock);assert.equal(r.source.origin,'automatic');assert.equal(r.languages.length,2);assert.equal(r.source.segments[0].start,1);});
await test('Відсутня мова/недоступне відео/немає captions',async()=>{
 await assert.rejects(loadYoutube(url,'xx',mock));
 for(const p of [{playabilityStatus:{status:'LOGIN_REQUIRED'}},{playabilityStatus:{status:'OK'}}])await assert.rejects(loadYoutube(url,undefined,async()=>new Response(`ytInitialPlayerResponse = ${JSON.stringify(p)};`)));
});
await test('Блокування сервера/вхід/віковий контроль не названі недоступністю відео',async()=>{
 for(const [status,reason,kind] of [['LOGIN_REQUIRED',"Sign in to confirm you're not a bot",'youtube_server_blocked'],['LOGIN_REQUIRED','Please sign in','youtube_login_required'],['AGE_CHECK_REQUIRED','Age check','youtube_access_check'],['ERROR','Video unavailable','youtube_playability_unavailable']]) {
   await assert.rejects(loadYoutube(url,undefined,async()=>new Response(`ytInitialPlayerResponse = ${JSON.stringify({playabilityStatus:{status,reason}})};`)),(e:any)=>e.kind===kind && !e.message.startsWith('Відео недоступне.'));
 }
});
await test('SSRF caption URL і великі/помилкові відповіді закриті',async()=>{
 await assert.rejects(boundedYoutubeText('https://evil/api/timedtext',mock));
 await assert.rejects(boundedYoutubeText(url,async()=>new Response('x'.repeat(8*1024*1024+1))));
 await assert.rejects(boundedYoutubeText(url,async()=>new Response('',{status:403})));
});
const deps:any={getBookOwnerId:async()=> 'owner',getCollabOwnerId:async()=>undefined,listAcceptedInvites:async()=>revoked?[]:[{acceptedUserId:'editor',role:'literary_editor'},{acceptedUserId:'reader',role:'beta_reader'}]};
const app=express();app.use(express.json({limit:'3mb'}));app.use((q,_r,n)=>{const id=q.headers['x-user'] as string;if(id)(q as any).principal={id,role:'writer',isGuest:false,disabled:id==='disabled'};n();});registerYoutubeTranscriptRoutes(app,deps,mock);
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}/api/knowledge/books/book-test/youtube/`;
async function post(op:string,id:string,body:any){return fetch(base+op,{method:'POST',headers:{'Content-Type':'application/json',...(id?{'x-user':id}:{})},body:JSON.stringify(body)});}
try {
 await test('Гість, сторонній, читач, disabled не отримують джерело',async()=>{for(const id of ['', 'stranger','reader','disabled']){const before=calls;assert.ok((await post('preview',id,{url})).status>=400);assert.equal(calls,before);}});
 await test('Власник і редактор отримують manual preview без OCR/провайдера',async()=>{for(const id of ['owner','editor']){const before=calls;const r=await post('preview',id,{url,text:srt,format:'srt'});assert.equal(r.status,200);assert.equal((await r.json()).source.origin,'manual');assert.equal(calls,before);}});
 await test('Підтвердження обов’язкове; повернення джерела без зміни книги',async()=>{const body={url,text:'Уривок',segments:parseSubtitles(srt,'srt')};assert.equal((await post('confirm','owner',body)).status,422);const r=await post('confirm','owner',{...body,confirmed:true});assert.equal(r.status,200);assert.equal((await r.json()).text,'Уривок');});
 await test('Відкликання під час мережевого запиту блокує пізню відповідь',async()=>{revokeOnFetch=true;assert.equal((await post('preview','editor',{url})).status,403);revokeOnFetch=false;assert.equal((await post('confirm','editor',{url,text:'a',segments:parseSubtitles(srt,'srt'),confirmed:true})).status,403);});
} finally {await new Promise<void>(r=>server.close(()=>r()));}
console.log(`Підсумок: ${count} пройшло, 0 впало.`);
