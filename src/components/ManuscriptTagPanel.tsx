import React,{useMemo,useState} from 'react';
import type {Book} from '../types';
import {useLanguage} from '../i18n/LanguageContext';
import {manuscriptTagIndex,filterTagIndex,taggedContext} from '../utils/manuscriptTagIndex';
export function ManuscriptTagPanel({book,onNavigate,onDiscuss}:{book:Book;onNavigate:(chapter:string,section:string,field:'content'|'contentEn',start:number,end:number)=>void;onDiscuss?:(text:string,where:string)=>void}){
 const {lang}=useLanguage(),en=lang==='en';const [query,setQuery]=useState(''),[status,setStatus]=useState(''),[scope,setScope]=useState('');
 const rows=useMemo(()=>filterTagIndex(manuscriptTagIndex(book),{tags:query.split(',').map(s=>s.trim()).filter(Boolean),status,chapterId:scope}),[book,query,status,scope]);
 const tooLarge=rows.length>100||rows.reduce((n,r)=>n+r.text.length,0)>40000;
 return <details className="glass-panel rounded-2xl p-3" data-manuscript-tag-panel>
  <summary className="cursor-pointer text-sm font-bold">{en?'Tags and AI origin':'Теги та походження ШІ'}</summary>
  <label className="block text-xs mt-2">{en?'All tags (comma = AND)':'Усі теги (кома = І)'}<input aria-label="Manuscript tag filter" value={query} onChange={e=>setQuery(e.target.value)} placeholder="/character:Марта, origin:ai" className="w-full bg-slate-950 p-2 rounded-xl"/></label>
  <select aria-label="AI origin status" value={status} onChange={e=>setStatus(e.target.value)} className="bg-slate-950 w-full p-2 text-xs rounded-xl"><option value="">{en?'All origins':'Усе походження'}</option><option value="accepted">{en?'AI accepted':'ШІ · прийнято'}</option><option value="draft">{en?'AI drafts':'ШІ · чернетки'}</option><option value="unmarked">{en?'Author or unknown':'Автор або невідомо'}</option></select>
  <select aria-label="Tag chapter scope" value={scope} onChange={e=>setScope(e.target.value)} className="bg-slate-950 w-full p-2 text-xs rounded-xl"><option value="">{en?'Entire book':'Уся книга'}</option>{book.chapters.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select>
  <p className="text-xs my-2" role="status">{rows.length} {en?'fragments':'фрагментів'}</p>
  <div className="max-h-64 overflow-y-auto space-y-2">{rows.slice(0,100).map((r,i)=><button key={i} type="button" className="block w-full text-left text-xs p-2 rounded-xl btn-glass break-words" onClick={()=>onNavigate(r.chapterId,r.sectionId,r.field,r.start,r.end)}>{r.status==='accepted'?'✓ ШІ · ':r.status==='draft'?'✨ ШІ · ':''}{r.text.slice(0,150)}</button>)}</div>
  {tooLarge&&<p className="text-xs">{en?'Narrow the selection to 100 fragments and 40,000 characters.':'Звузьте вибірку до100 фрагментів і40000 символів.'}</p>}
  {onDiscuss&&<button type="button" className="text-xs btn-glass p-2 mt-2" disabled={!rows.length||tooLarge} onClick={()=>onDiscuss('Проаналізуй і підсумуй ці фрагменти. Посилайся на точні джерела [глава/сцена:початок-кінець]. Не змінюй рукопис.\n\n'+taggedContext(rows),'Теги та походження ШІ')}>{en?'Analyze selected results with Jev':'Проаналізувати вибрані результати з Jev'}</button>}
 </details>;
}
