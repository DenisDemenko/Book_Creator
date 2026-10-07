import React, { useEffect, useState } from 'react';
import type { Book } from '../types';

interface ParagraphTranslation {
  sourceLocation?: {chapterId:string|null;sectionId:string;editorPid:string|null;text:string};
  paragraphId: string; original: string; sourceHash: string; glossaryHash: string; sourceLanguage: string; needsUpdate: boolean;
  current: { text: string; status: string; version: number } | null;
  versions: { text: string; version: number; status: string; createdAt: string }[];
}
interface Workspace {
  revision: number; canEdit: boolean; canApprove: boolean;
  glossary: {id:string;source:string;target:string}[]; paragraphs: ParagraphTranslation[];
}
export function TranslationPage({ book, onOpenParagraph }: { book: Book; onOpenParagraph?: (target: {chapterId:string;sectionId:string;editorPid:string;text:string})=>void }) {
  const [language,setLanguage]=useState('en'),[sourceLanguage,setSourceLanguage]=useState('uk');
  const [state,setState]=useState<Workspace|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState(''),[text,setText]=useState('');
  const [source,setSource]=useState(''),[target,setTarget]=useState(''),[entryId,setEntryId]=useState('');
  const [proposals,setProposals]=useState<{paragraphId:string;before:string;text:string}[]>([]);
  const base=`/api/core/projects/${encodeURIComponent(book.id)}/translation`;
  const api=async(path:string,method='GET',body?:unknown)=>{
    const res=await fetch(base+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await res.json(); if(!res.ok) throw new Error(data.error||`Помилка ${res.status}`); return data;
  };
  const load=async()=>{ const next:Workspace=await api(`?language=${language}`); setState(next); return next; };
  useEffect(()=>{
    let cancelled=false; setState(null);setSelected('');setText('');setProposals([]);setError('');
    api(`?language=${language}`).then(next=>{if(!cancelled)setState(next);}).catch(e=>{if(!cancelled)setError(e.message);});
    return()=>{cancelled=true;};
  },[book.id,language]);
  const paragraph=state?.paragraphs.find(p=>p.paragraphId===selected);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const save=async(status:'draft'|'approved')=>{
    if(!state||!paragraph)return;
    await api(`/paragraphs/${encodeURIComponent(selected)}`,'PUT',{language,sourceLanguage,text,status,expectedRevision:state.revision,sourceHash:paragraph.sourceHash,glossaryHash:paragraph.glossaryHash});
    await load();setProposals(ps=>ps.filter(p=>p.paragraphId!==selected));
  };
  const button='rounded border border-slate-600 px-3 py-2 disabled:opacity-40';
  const field='rounded border border-slate-600 bg-slate-950 p-2';
  return <section className="space-y-4" data-translation-page>
    <div className="flex flex-wrap items-center gap-3">
      <label>Оригінал <select aria-label="Мова оригіналу" disabled={busy} className={field} value={sourceLanguage} onChange={e=>setSourceLanguage(e.target.value)}>{['uk','en','de','fr','es','pl'].map(l=><option key={l}>{l}</option>)}</select></label>
      <label>Переклад <select aria-label="Мова перекладу" disabled={busy} className={field} value={language} onChange={e=>setLanguage(e.target.value)}>{['en','uk','de','fr','es','pl'].map(l=><option key={l}>{l}</option>)}</select></label>
      <button className={button} disabled={busy} onClick={()=>run(async()=>{const next=await load();const p=next.paragraphs.find(p=>p.paragraphId===selected);if(p){setText(p.current?.text??'');setSourceLanguage(p.sourceLanguage);}})}>Оновити</button>
      <button className={button} disabled={busy||!state?.canApprove} onClick={()=>run(async()=>{const result=await api('/import-legacy','POST',{expectedRevision:state!.revision});await load();if(result.skipped.length)setError(`Не вдалося зіставити: ${result.skipped.join(', ')}. Ці фрагменти перекладіть вручну.`);})}>Імпортувати contentEn</button>
      <button className={button} disabled={busy||!state} onClick={()=>run(async()=>{
        const res=await fetch(`${base}/export?language=${language}`,{credentials:'same-origin'});if(!res.ok){const data=await res.json();throw new Error(data.error);}const url=URL.createObjectURL(await res.blob());const a=document.createElement('a');a.href=url;a.download=`translation-${language}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      })}>Експорт Markdown</button>
    </div>
    {error&&<p role="alert" className="text-amber-300">{error}</p>}
    {!state&&!error&&<p>Завантаження перекладів…</p>}
    {state&&<>
      <details open className="rounded border border-slate-700 p-3"><summary>Глосарій імен і термінів</summary>
        <ul className="my-3 space-y-2">{state.glossary.map(g=><li key={g.id}>{g.source} → {g.target} {state.canApprove&&<button className={button} disabled={busy} onClick={()=>{setSource(g.source);setTarget(g.target);setEntryId(g.id);}}>Змінити</button>}</li>)}</ul>
        {state.canApprove&&<form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();run(async()=>{const result=await api('/glossary','PUT',{id:entryId||undefined,language,source,target,expectedRevision:state.revision});setProposals(result.proposals);await load();setSource('');setTarget('');setEntryId('');});}}>
          <label>Термін оригіналу<input aria-label="Термін оригіналу" className={`${field} block max-w-full`} value={source} readOnly={!!entryId} onChange={e=>setSource(e.target.value)} required maxLength={200}/></label>
          <label>Переклад терміна<input aria-label="Переклад терміна" className={`${field} block max-w-full`} value={target} onChange={e=>setTarget(e.target.value)} required maxLength={200}/></label>
          <button className={button} disabled={busy}>Затвердити термін</button>
          {entryId&&<button type="button" className={button} onClick={()=>{setEntryId('');setSource('');setTarget('');}}>Скасувати</button>}
        </form>}
      </details>
      {!!proposals.length&&<div className="space-y-2 rounded border border-amber-700 p-3"><p>Пропозиції узгодження: {proposals.length}. Перевірте текст перед збереженням.</p>{proposals.map(p=><div key={p.paragraphId}><pre className="whitespace-pre-wrap break-words text-sm">{p.before} → {p.text}</pre><button className={button} onClick={()=>{setSelected(p.paragraphId);setText(p.text);}}>Переглянути пропозицію</button></div>)}</div>}
      <label className="block">Абзац <select aria-label="Абзац перекладу" disabled={busy} className={`${field} max-w-full`} value={selected} onChange={e=>{setSelected(e.target.value);const p=state.paragraphs.find(p=>p.paragraphId===e.target.value);setText(p?.current?.text??'');setSourceLanguage(p?.sourceLanguage??'uk');}}><option value="">Оберіть абзац</option>{state.paragraphs.map((p,i)=><option key={p.paragraphId} value={p.paragraphId}>{i+1}. {p.original.slice(0,65)} {p.needsUpdate?'— потребує оновлення':p.current?`— ${p.current.status}`:'— без перекладу'}</option>)}</select></label>
      {!state.paragraphs.length&&<p>Немає синхронізованих абзаців із доступом. Збережіть книгу, щоб синхронізувати її з ядром.</p>}
      {paragraph&&<>
        {paragraph.needsUpdate&&<p role="status" className="text-amber-300">Переклад потребує оновлення: оригінал або глосарій змінився.</p>}
        <div className="grid gap-3 lg:grid-cols-2"><div><h2>Оригінал</h2><pre className="whitespace-pre-wrap break-words rounded border border-slate-700 p-3">{paragraph.original}</pre></div><label>Переклад<textarea aria-label="Текст перекладу" disabled={busy} className={`${field} min-h-48 w-full`} value={text} readOnly={!state.canEdit} onChange={e=>setText(e.target.value)}/></label></div>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy||!state.canEdit} onClick={()=>run(()=>save('draft'))}>Зберегти чернетку</button>
          <button className={button} disabled={busy||!state.canApprove} onClick={()=>run(()=>save('approved'))}>Затвердити переклад</button>
          <button className={button} disabled={busy||!state.canEdit} onClick={()=>run(async()=>{const result=await api('/generate','POST',{paragraphId:selected,language,sourceLanguage,modelId:book.preferredAiModelId});setText(result.text);})}>Перекласти AI</button>
        </div>
        {paragraph.sourceLocation?.chapterId && paragraph.sourceLocation.editorPid && onOpenParagraph && <button type="button" className={button} onClick={()=>{const loc=paragraph.sourceLocation!;onOpenParagraph({chapterId:loc.chapterId!,sectionId:loc.sectionId,editorPid:loc.editorPid!,text:loc.text});}}>Відкрити оригінал у редакторі</button>}
        <details><summary>Історія перекладу ({paragraph.versions.length})</summary>{paragraph.versions.map(v=><div key={v.version} className="my-2 rounded border border-slate-700 p-3"><p>Версія {v.version} · {v.status} · {v.createdAt}</p><pre className="whitespace-pre-wrap break-words">{v.text}</pre><button className={button} disabled={!state.canEdit||busy} onClick={()=>setText(v.text)}>Взяти текст за основу</button></div>)}</details>
      </>}
    </>}
  </section>;
}
