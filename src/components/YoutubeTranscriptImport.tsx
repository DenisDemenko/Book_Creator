import React, { useRef, useState } from 'react';
import type { Book, KnowledgeFile } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { MAX_TRANSCRIPT_BYTES, type TranscriptSource } from '../../shared/youtubeTranscript';
type Preview={source:TranscriptSource;text:string;languages:{id:string;language:string;name:string;origin:string}[];selectedLanguage:string};
export function YoutubeTranscriptImport({book,onImport,onClose}:{book:Book;onImport:(file:KnowledgeFile)=>void;onClose:()=>void}) {
  const latest=useRef({book,onImport,onClose}); latest.current={book,onImport,onClose};
  const {lang}=useLanguage(), en=lang==='en', label=(uk:string,english:string)=>en?english:uk;
  const [url,setUrl]=useState(''),[manual,setManual]=useState(''),[format,setFormat]=useState<'text'|'srt'|'vtt'>('text');
  const [preview,setPreview]=useState<Preview|null>(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[consent,setConsent]=useState(false);
  async function api(operation:string,body:object) {
    const r=await fetch(`/api/knowledge/books/${encodeURIComponent(book.id)}/youtube/${operation}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});
    const data=await r.json();if(!r.ok)throw new Error(data.error);return data;
  }
  async function load(language?:string,manualInput=false) {
    setBusy(true);setError('');setPreview(null);setConsent(false);
    try {const p=await api('preview',{url,...(manualInput?{text:manual,format}:language?{language}:{})});setPreview(p);setText(p.text);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function save() {
    if(!preview)return;setBusy(true);setError('');
    try {
      if((book.knowledgeFiles||[]).some(f=>f.transcriptSource?.videoId===preview.source.videoId && f.transcriptSource.language===preview.source.language)) throw new Error(label('Це відео цією мовою вже є в джерелах. Видаліть старе джерело, якщо хочете замінити його.','This video and language already exist in sources. Remove the old source to replace it.'));
      const data=await api('confirm',{...preview.source,text,confirmed:consent});
      const bytes=new TextEncoder().encode(JSON.stringify(data)).length;
      const q=await fetch('/api/media/check-upload',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({bookId:book.id,bytes,fileName:'YouTube transcript'})});
      if(!q.ok)throw new Error((await q.json()).error);
      // Recheck permission after quota request, immediately before applying the existing book update flow.
      await api('confirm',{...preview.source,text,confirmed:consent});
      if (latest.current.book.id !== book.id) throw new Error(label('Активна книга змінилась. Повторіть імпорт.','The active book changed. Restart the import.'));
      if ((latest.current.book.knowledgeFiles||[]).some(f=>f.transcriptSource?.videoId===preview.source.videoId && f.transcriptSource.language===preview.source.language)) throw new Error(label('Джерело вже додане.','Source already added.'));
      latest.current.onImport({id:`yt-${crypto.randomUUID()}`,fileName:`${data.source.title} (${data.source.language})`,fileType:'txt',contentText:data.text,transcriptSource:data.source,transcriptEdited:text!==preview.text,fileSizeLabel:`${(bytes/1024).toFixed(1)} KB`,createdAt:data.source.importedAt});latest.current.onClose();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const cls='rounded bg-slate-800 border border-slate-600 p-2';
  return <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="YouTube transcript"><div className="bg-slate-950 text-slate-100 rounded-xl p-5 w-full max-w-3xl max-h-[90vh] overflow-auto space-y-3">
    <h2 className="text-xl font-bold">{label('Розшифровка YouTube','YouTube transcript')}</h2>
    <p>{label('Імпорт доступних субтитрів. Без OCR, розпізнавання аудіо та автоматичного надсилання до ШІ. Спочатку збережіть книгу на сервері.','Import available captions. No OCR, speech recognition or automatic AI processing. Save your book to the server first.')}</p>
    <label className="block">YouTube URL<input className={`${cls} w-full`} value={url} onChange={e=>{setUrl(e.target.value);setPreview(null);setConsent(false);}} placeholder="https://www.youtube.com/watch?v=…" /></label>
    <button className={cls} disabled={busy} onClick={()=>void load()}>{label('Отримати субтитри','Fetch captions')}</button>
    <details><summary>{label('Ручний імпорт SRT/VTT або тексту','Import SRT/VTT or paste text')}</summary>
      <label>{label('Формат','Format')}<select className={cls} value={format} onChange={e=>setFormat(e.target.value as typeof format)}><option value="text">Text</option><option value="srt">SRT</option><option value="vtt">VTT</option></select></label>
      <input aria-label={label('Файл субтитрів','Subtitle file')} type="file" accept=".srt,.vtt,.txt" disabled={busy} onChange={async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>MAX_TRANSCRIPT_BYTES){setError(label('Максимум 2 МБ','Maximum 2 MB'));return;}setFormat(f.name.toLowerCase().endsWith('.vtt')?'vtt':f.name.toLowerCase().endsWith('.srt')?'srt':'text');setManual(await f.text());}}/>
      <textarea aria-label={label('Текст субтитрів','Caption text')} className={`${cls} w-full h-24`} value={manual} onChange={e=>setManual(e.target.value)} />
      <button className={cls} disabled={busy} onClick={()=>void load(undefined,true)}>{label('Переглянути ручний імпорт','Preview manual import')}</button>
    </details>
    {preview&&<><h3>{preview.source.title}</h3><p>{preview.source.language} · {label(preview.source.origin==='automatic'?'Автоматичні субтитри':preview.source.origin==='author'?'Авторські субтитри':'Ручне джерело',preview.source.origin)}</p>
      {!!preview.languages.length&&<label>{label('Мова/доріжка','Language/track')}<select className={cls} disabled={busy} value={preview.selectedLanguage} onChange={e=>void load(e.target.value)}>{preview.languages.map(l=><option key={l.id} value={l.id}>{l.name} ({l.origin})</option>)}</select></label>}
      <div className="max-h-40 overflow-auto">{preview.source.segments.map((s,i)=><p key={i}><a className="text-cyan-300" href={`${preview.source.url}&t=${Math.floor(s.start)}s`} target="_blank" rel="noopener noreferrer">{Math.floor(s.start/60)}:{String(Math.floor(s.start%60)).padStart(2,'0')}</a> {s.text}</p>)}</div>
      <label className="block">{label('Текст для збереження — можна скоротити чи відредагувати','Text to save — select an excerpt or edit')}<textarea className={`${cls} w-full h-40`} value={text} onChange={e=>{setText(e.target.value);setConsent(false);}}/></label>
      <p>{label('Таймкоди належать початковим субтитрам. Перевірте текст і права на використання. Збереження додає джерело; текст глав не змінюється.','Timestamps refer to original captions. Check the text and usage rights. Saving adds a source; chapter text stays unchanged.')}</p>
      <label className="block"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>{label(' Підтверджую збереження цього тексту та право його використання',' I confirm saving this text and my right to use it')}</label>
      <button className={cls} disabled={busy||!consent||!text.trim()} onClick={()=>void save()}>{label('Зберегти джерело','Save source')}</button>
    </>}
    {error&&<p role="alert" className="text-rose-300">{error}</p>}{busy&&<p role="status">{label('Обробка…','Processing…')}</p>}
    <button className={cls} disabled={busy} onClick={onClose}>{label('Скасувати','Cancel')}</button>
  </div></div>;
}
