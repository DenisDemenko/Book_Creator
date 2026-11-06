import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {Book} from '../../types';
import type {WardrobePdfData,WardrobeBookDocument} from '../../types/wardrobeDocument';
import {renderEditableDocument,fromBase64,toBase64} from '../../../shared/wardrobeDocument.mjs';
import {PDFDocument} from 'pdf-lib';
import {cacheBookFromServer} from '../../utils/storage';

type Props={book:Book;onUpdateBook:(book:Book,action?:string,details?:string)=>void};
const cls='rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm disabled:opacity-40';
const snapshot=(d:WardrobePdfData)=>({edits:structuredClone(d.edits),notes:{...d.notes},pageOrder:[...d.pageOrder],title:d.title});
export default function WardrobeDocumentEditor({book,onUpdateBook}:Props){
  const [source,setSource]=useState<WardrobeBookDocument>(book.wardrobeDocument!),[baseBook,setBaseBook]=useState(book),[revision,setRevision]=useState<number|null>(null),[privateReady,setPrivateReady]=useState(false);
  const [pageId,setPageId]=useState(source.document.pageOrder[0]),[search,setSearch]=useState(''),[textSearch,setTextSearch]=useState(''),[selected,setSelected]=useState(''),[blockPage,setBlockPage]=useState(0);
  const [status,setStatus]=useState('Читаємо збережений документ…'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[previewError,setPreviewError]=useState(''),[zoom,setZoom]=useState(100);
  const [undo,setUndo]=useState<ReturnType<typeof snapshot>[]>([]),[redo,setRedo]=useState<ReturnType<typeof snapshot>[]>([]);
  const canvas=useRef<HTMLCanvasElement>(null),renderTask=useRef<any>(null),originalUrl=useRef<string|null>(null);
  const d=source.document,pagesById=useMemo(()=>new Map(d.pages.map(p=>[p.id,p])),[d.pages]),active=pagesById.get(pageId)||d.pages[0],locked=revision===null||busy;
  useEffect(()=>{let cancelled=false;
    fetch(`/api/books/${encodeURIComponent(book.id)}`,{credentials:'same-origin'}).then(async r=>{if(!r.ok)throw Error('Не вдалося прочитати приватну серверну книгу.');return r.json();}).then(stored=>{
      if(cancelled)return;if(!stored.book?.wardrobeDocument||!Number.isInteger(stored.revision))throw Error('Неповні дані документа.');setPrivateReady(true);
      if(book.wardrobeDocument!.dirty){setRevision(book.wardrobeDocument!.cloudRevision??null);setStatus(stored.revision===book.wardrobeDocument!.cloudRevision?'Відновлено незбережену чернетку цього пристрою.':'На сервері є інша версія. Збережіть PDF/копію перед відкриттям серверної книги.');}
      else{setBaseBook(stored.book);setSource({...stored.book.wardrobeDocument,cloudRevision:stored.revision,dirty:false});setRevision(stored.revision);setStatus('Завантажено з Книг.');}
    }).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};
  },[book.id]); // A new book is a new editor; local keystrokes never reload it.
  useEffect(()=>{if(!privateReady)return;let cancelled=false,task:any,pdf:any;const timer=setTimeout(async()=>{
    try{setPreviewError('');const bytes=await renderEditableDocument(d,{onlyPage:active.id});if(cancelled)return;
      const lib=await import('pdfjs-dist');if(!lib.GlobalWorkerOptions.workerSrc)lib.GlobalWorkerOptions.workerSrc=(await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      task=lib.getDocument({data:bytes});pdf=await task.promise;if(cancelled)return;const p=await pdf.getPage(1),view=p.getViewport({scale:1.25*zoom/100}),c=canvas.current;if(!c)return;
      renderTask.current?.cancel();c.width=view.width;c.height=view.height;renderTask.current=p.render({canvas:c,canvasContext:c.getContext('2d')!,viewport:view});await renderTask.current.promise;
    }catch(e){if(!cancelled)setPreviewError(e instanceof Error?e.message:'Не вдалося показати PDF.');}
  },450);return()=>{cancelled=true;clearTimeout(timer);renderTask.current?.cancel();void task?.destroy()?.catch(()=>{});};
  },[d,active.id,zoom,privateReady]);
  useEffect(()=>()=>{if(originalUrl.current)URL.revokeObjectURL(originalUrl.current);},[]);
  function change(next:WardrobePdfData,remember=true){if(remember){setUndo(u=>[...u.slice(-24),snapshot(d)]);setRedo([]);}const updated={...source,document:next,cloudRevision:revision??source.cloudRevision,dirty:true};setSource(updated);onUpdateBook({...baseBook,title:next.title,updatedAt:new Date().toISOString(),wardrobeDocument:updated},'Редагування PDF документа');setStatus('Чернетка змінена. Натисніть «Зберегти в Книгах».');}
  function history(direction:'undo'|'redo'){const list=direction==='undo'?undo:redo,prior=list.at(-1);if(!prior)return;if(direction==='undo'){setUndo(list.slice(0,-1));setRedo(r=>[...r,snapshot(d)]);}else{setRedo(list.slice(0,-1));setUndo(u=>[...u,snapshot(d)]);}change({...d,...prior},false);}
  async function save(){if(revision===null||busy)return;setBusy(true);setError('');try{
    const pdfBytes=await renderEditableDocument(d);
    const clean={...source,dirty:false,cloudRevision:revision,renderedPdf:toBase64(pdfBytes),renderedPageCount:(await PDFDocument.load(pdfBytes)).getPageCount()},next={...baseBook,title:d.title,updatedAt:new Date().toISOString(),wardrobeDocument:clean};
    const r=await fetch(`/api/books/${encodeURIComponent(book.id)}`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({book:next,expectedRevision:revision})});
    const result=await r.json();if(!r.ok)throw Error(result.error||`Збереження не виконано (${r.status}).`);
    clean.cloudRevision=result.revision;setSource(clean);setBaseBook(next);setRevision(result.revision);onUpdateBook(next,'PDF збережено в Книгах');setStatus(`Збережено на сервері, версія ${result.revision}.`);
    try{await cacheBookFromServer(next,result.revision);}catch{setStatus(`Збережено на сервері, версія ${result.revision}. Локальний кеш недоступний.`);}
  }catch(e){setError(e instanceof Error?e.message:'Збереження не виконано.');}finally{setBusy(false);}}
  async function reloadServer(){if(busy)return;if(source.dirty&&!window.confirm('Відкинути локальну чернетку й відкрити серверну версію? Перед цим можна завантажити PDF з поточними правками.'))return;setBusy(true);setError('');try{
    const r=await fetch(`/api/books/${encodeURIComponent(book.id)}`,{credentials:'same-origin'});if(!r.ok)throw Error('Серверна книга недоступна.');const stored=await r.json();if(!stored.book?.wardrobeDocument)throw Error('Неповний документ.');const next=stored.book;next.wardrobeDocument={...next.wardrobeDocument,dirty:false,cloudRevision:stored.revision};setSource(next.wardrobeDocument);setBaseBook(next);setRevision(stored.revision);setPageId(next.wardrobeDocument.document.pageOrder[0]);setUndo([]);setRedo([]);onUpdateBook(next,'Відкрито серверну версію PDF');setStatus(`Відкрито серверну версію ${stored.revision}.`);
  }catch(e){setError(e instanceof Error?e.message:'Не вдалося відкрити версію.');}finally{setBusy(false);}}
  async function download(){setBusy(true);setError('');try{const bytes=await renderEditableDocument(d),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download='fusionlab-wardrobe-edited.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){setError(e instanceof Error?e.message:'PDF не сформовано.');}finally{setBusy(false);}}
  function move(delta:number){const i=d.pageOrder.indexOf(active.id),j=i+delta;if(j<0||j>=d.pageOrder.length)return;const order=[...d.pageOrder];[order[i],order[j]]=[order[j],order[i]];change({...d,pageOrder:order});}
  const filteredPages=d.pageOrder.map(id=>pagesById.get(id)!).filter(p=>!search||(p.title+' '+p.blocks.map(b=>d.edits[b.id]?.text??b.text).join(' ')+' '+(d.notes[p.id]||'')).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const blocks=active.blocks.filter(b=>b.role!=='page-number'&&!b.links&&(!textSearch||(d.edits[b.id]?.text??b.text).toLocaleLowerCase().includes(textSearch.toLocaleLowerCase())));
  function selectBlock(id:string){setTextSearch('');const index=active.blocks.filter(b=>b.role!=='page-number'&&!b.links).findIndex(b=>b.id===id);setBlockPage(Math.max(0,Math.floor(index/18)));setSelected(id);setTimeout(()=>document.getElementById('wd-'+id)?.focus(),0);}
  if(!privateReady)return <section className="p-5"><p role="status">{status}</p>{error&&<p role="alert">{error}</p>}</section>;
  return <section className="min-h-0 flex-1 overflow-auto bg-slate-900 p-4 text-slate-100" data-wardrobe-document>
    <h1 className="text-xl font-bold">PDF шафи · Книги</h1>
    <p className="my-2 text-sm text-slate-300">Редагуйте текст PDF, примітки та порядок аркушів. Зміни тексту не змінюють геометрію, розміри моделі чи GibLab. Конструкцію змінюйте у конструкторі.</p>
    <div className="flex flex-wrap items-center gap-2"><button className={cls} onClick={()=>void save()} disabled={busy||revision===null}>Зберегти в Книгах</button><button className={cls} onClick={()=>void download()} disabled={busy}>Завантажити PDF</button><button className={cls} onClick={()=>void reloadServer()} disabled={busy}>Відкрити серверну версію</button>
      <a className={cls} href={`/wardrobe-builder?document=${encodeURIComponent(book.id)}`}>Редагувати конструкцію шафи</a>
      <button className={cls} disabled={locked||!undo.length} onClick={()=>history('undo')}>Скасувати зміну</button><button className={cls} disabled={locked||!redo.length} onClick={()=>history('redo')}>Повторити</button>
      <button className={cls} onClick={()=>{if(originalUrl.current)URL.revokeObjectURL(originalUrl.current);originalUrl.current=URL.createObjectURL(new Blob([fromBase64(source.originalPdf)],{type:'application/pdf'}));window.open(originalUrl.current,'_blank','noopener');}}>Початковий PDF</button></div>
    <p role="status" className="my-2 text-sm text-cyan-200">{busy?'Опрацьовуємо документ…':status}</p>{error&&<p role="alert" className="mb-3 text-rose-300">{error}</p>}
    <label className="block mb-3">Назва документа<input className={cls+' ml-2 w-full sm:w-96'} disabled={locked} value={d.title} maxLength={200} onChange={e=>change({...d,title:e.target.value})}/></label>
    <div className="grid items-start gap-4 xl:grid-cols-[240px_minmax(0,1fr)_340px]">
      <nav aria-label="Аркуші PDF" className="rounded-xl border border-slate-700 p-3">
        <label>Пошук документа<input className={cls+' my-2 w-full'} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Назва аркуша або текст"/></label>
        <p className="text-xs text-slate-400">Знайдено {filteredPages.length} із {d.pages.length}</p>
        <div className="my-2 flex gap-2"><button className={cls} onClick={()=>move(-1)} disabled={locked||d.pageOrder[0]===active.id}>Вище ↑</button><button className={cls} onClick={()=>move(1)} disabled={locked||d.pageOrder.at(-1)===active.id}>Нижче ↓</button></div>
        <div className="max-h-[65vh] overflow-auto">{filteredPages.map(p=><button key={p.id} className={'my-1 w-full rounded-lg p-2 text-left text-sm '+(p.id===active.id?'bg-cyan-900':'bg-slate-800')} aria-current={p.id===active.id?'page':undefined} onClick={()=>{setPageId(p.id);setBlockPage(0);setSelected('');}}>{d.pageOrder.indexOf(p.id)+1}. {p.title}{d.notes[p.id]?' · примітки':''}</button>)}</div>
      </nav>
      <div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><button className={cls} onClick={()=>setPageId(d.pageOrder[Math.max(0,d.pageOrder.indexOf(active.id)-1)])}>←</button><span>{d.pageOrder.indexOf(active.id)+1} / {d.pages.length}</span><button className={cls} onClick={()=>setPageId(d.pageOrder[Math.min(d.pages.length-1,d.pageOrder.indexOf(active.id)+1)])}>→</button><label>Масштаб <select className={cls} value={zoom} onChange={e=>setZoom(Number(e.target.value))}>{[50,75,100,125,150,200].map(n=><option key={n}>{n}</option>)}</select></label></div>
        {previewError&&<p role="alert" className="text-rose-300">{previewError}</p>}
        <div className="overflow-auto rounded-lg bg-slate-700 p-2"><div className="relative bg-white" style={{width:841.89*1.25*zoom/100,maxWidth:'none'}}><canvas ref={canvas} aria-label={'PDF: '+active.title} className="block w-full"/>
          <div className="absolute inset-0">{active.blocks.filter(b=>b.role!=='page-number'&&!b.links).map(b=><button key={b.id} tabIndex={-1} aria-label={'Редагувати: '+(d.edits[b.id]?.text??b.text)} title={d.edits[b.id]?.text??b.text} className={'absolute border border-transparent hover:border-blue-500 hover:bg-blue-300/20 '+(selected===b.id?'border-blue-600':'')} style={{left:b.x/841.89*100+'%',top:(595.28-b.y-b.size)/595.28*100+'%',width:b.maxWidth/841.89*100+'%',height:(b.size+3)/595.28*100+'%'}} onClick={()=>selectBlock(b.id)}/>)}</div></div></div>
      </div>
      <aside className="rounded-xl border border-slate-700 p-3"><h2 className="font-bold">Текст PDF</h2><p className="my-1 text-xs text-slate-400">Виберіть напис на аркуші або знайдіть його нижче. Номери сторінок і посилання оновлюються автоматично. Шрифт зменшується, якщо рядок не вміщується в межах блока.</p>
        <input className={cls+' my-2 w-full'} aria-label="Пошук текстових блоків" value={textSearch} onChange={e=>{setTextSearch(e.target.value);setBlockPage(0);}} placeholder="Знайти напис"/>
        <div className="max-h-[50vh] overflow-auto">{blocks.slice(blockPage*18,(blockPage+1)*18).map(b=><div key={b.id} className={'my-2 rounded p-2 '+(selected===b.id?'bg-cyan-950':'bg-slate-800')}><label className="block text-xs">{b.id}<input id={'wd-'+b.id} disabled={locked} className={cls+' mt-1 w-full'} maxLength={3000} value={d.edits[b.id]?.text??b.text} onFocus={()=>setSelected(b.id)} onChange={e=>change({...d,edits:{...d.edits,[b.id]:{...d.edits[b.id],text:e.target.value}}})}/></label><label className="text-xs">Шрифт <input type="number" disabled={locked} className={cls+' w-20'} min={4} max={32} value={d.edits[b.id]?.size??b.size} onChange={e=>{const size=Number(e.target.value);if(size>=4&&size<=32)change({...d,edits:{...d.edits,[b.id]:{text:d.edits[b.id]?.text??b.text,size}}});}}/></label><button className="ml-2 text-xs text-cyan-200" disabled={locked} onClick={()=>{const edits={...d.edits};delete edits[b.id];change({...d,edits});}}>Початковий текст</button></div>)}</div>
        <div className="my-2 flex gap-2"><button className={cls} disabled={!blockPage} onClick={()=>setBlockPage(n=>n-1)}>Назад</button><button className={cls} disabled={(blockPage+1)*18>=blocks.length} onClick={()=>setBlockPage(n=>n+1)}>Ще блоки</button></div>
        <label className="block text-sm">Примітки до аркуша<textarea className={cls+' mt-1 min-h-28 w-full'} disabled={locked} value={d.notes[active.id]||''} maxLength={3000} onChange={e=>change({...d,notes:{...d.notes,[active.id]:e.target.value}})}/></label><p className="mt-1 text-xs text-slate-400">Примітки додаються окремими сторінками наприкінці PDF.</p>
      </aside>
    </div>
  </section>;
}
