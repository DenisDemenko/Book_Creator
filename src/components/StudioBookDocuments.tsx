import React,{useEffect,useMemo,useState} from 'react';
import {Trash2} from 'lucide-react';
interface Summary{ownerId?:string|null;id:string;title:string;updatedAt:string;pageCount?:number;}

/**
 * Мініатюра обкладинки (журнал #553). Обкладинка — це зібраний артефакт книги; у більшості книг його ще немає,
 * тож 404 — звичайна справа: тоді показуємо кольорову заглушку з першою літерою назви, а не поламане зображення.
 * Адреса публічна (`/api/public/books/:id/cover`) і кешується, тож перелік не ганяє байти щоразу.
 */
function Cover({id,title}:{id:string;title:string}){
  const [failed,setFailed]=useState(false);
  if(failed)return <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-900 text-lg font-bold text-slate-600">{(title||'?').trim().charAt(0).toLocaleUpperCase()}</span>;
  return <img src={`/api/public/books/${encodeURIComponent(id)}/cover`} alt="" loading="lazy" onError={()=>setFailed(true)} className="h-16 w-12 shrink-0 rounded border border-slate-700 bg-slate-900 object-cover" />;
}
export function StudioBookDocuments({books,userId,onOpen,onCreate,onDelete,opening}:{books:Summary[];userId:string|null;onOpen:(id:string)=>void;onCreate:()=>void;onDelete?:(b:{id:string;title:string})=>void;opening:string|null}){
  const [documents,setDocuments]=useState<Summary[]>([]),[error,setError]=useState(''),[query,setQuery]=useState(''),[kind,setKind]=useState('all'),[sort,setSort]=useState('date'),[page,setPage]=useState(0);
  useEffect(()=>{let stopped=false;if(!userId){setDocuments([]);return;}
    fetch('/api/wardrobe/documents',{credentials:'same-origin'}).then(async r=>{if(!r.ok)throw Error('Не вдалося отримати PDF-документи.');return r.json();}).then(data=>{if(!stopped){setDocuments((data.documents||[]).filter((d:Summary)=>d.ownerId===userId));setError('');}}).catch(e=>{if(!stopped)setError(e.message);});return()=>{stopped=true;};
  },[userId,books]);
  const entries=useMemo(()=>{const ownedDocuments=documents.filter(d=>d.ownerId===userId),ids=new Set(ownedDocuments.map(d=>d.id)),all=new Map(books.map(b=>[b.id,b]));ownedDocuments.forEach(d=>all.set(d.id,d));return [...all.values()].filter(b=>(kind==='all'||(kind==='pdf')===ids.has(b.id))&&(b.title+' '+b.id).toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title):b.updatedAt.localeCompare(a.updatedAt));},[books,documents,query,kind,sort,userId]);
  const cls='rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm';
  return <section className="rounded-2xl border border-cyan-500/30 bg-slate-950/50 p-5" data-book-documents>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Книги та PDF-документи</h2><button className={cls.replace('bg-slate-800','bg-amber-500')+' text-slate-950'} onClick={onCreate}>＋ Створити книгу</button><a className={cls} href="/wardrobe-builder">Створити PDF шафи →</a><a className={cls} href="/bed-builder">Створити PDF ліжка →</a></div>
    <p className="my-2 text-sm text-slate-400">Документацію шафи або ліжка можна зберегти з конструктора кнопкою «PDF у Книги». Тут відкриваються перегляд, редактор тексту, примітки та порядок аркушів.</p>
    {!userId?<p>Увійдіть, щоб бачити документи свого акаунта.</p>:<>
      <div className="my-3 flex flex-wrap gap-2"><input className={cls+' min-w-0 flex-1'} aria-label="Знайти книгу або PDF" placeholder="Назва або ID книги / документа" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/>
        <select className={cls} aria-label="Тип документа" value={kind} onChange={e=>{setKind(e.target.value);setPage(0);}}><option value="all">Усі</option><option value="book">Книги</option><option value="pdf">PDF меблів</option></select>
        <select className={cls} aria-label="Порядок документів" value={sort} onChange={e=>{setSort(e.target.value);setPage(0);}}><option value="date">Спочатку нові зміни</option><option value="title">За назвою</option></select></div>
      {error&&<p role="alert" className="text-amber-300">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{entries.slice(page*12,(page+1)*12).map(b=><div key={b.id} className={cls+' flex gap-3'} data-book-card={b.id}>
        <Cover id={b.id} title={b.title} />
        <div className="flex min-w-0 flex-1 flex-col">
          <button className="min-w-0 text-left disabled:opacity-50" disabled={opening!==null} onClick={()=>onOpen(b.id)}>
            <span className="block truncate font-bold">{b.title||b.id}</span>
            <span className="block text-xs text-slate-400">{b.pageCount?`PDF · ${b.pageCount} аркушів`:'Книга'} · {new Date(b.updatedAt).toLocaleDateString()}</span>
            <span className="block truncate text-xs text-slate-500">{b.id}</span>
            <span className="text-cyan-200">{opening===b.id?'Відкриваємо…':b.pageCount?'Переглянути й редагувати PDF →':'Відкрити книгу →'}</span>
          </button>
          {/* Видаляти можна лише книгу: PDF-документ шафи живе в своєму конструкторі й прибирається там. */}
          {onDelete&&!b.pageCount&&<button type="button" data-delete-book={b.id} onClick={()=>onDelete({id:b.id,title:b.title})} title="Видалити книгу" aria-label={`Видалити книгу: ${b.title||b.id}`} className="mt-2 flex w-fit items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-400 transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-3 w-3" />Видалити</button>}
        </div>
      </div>)}</div>
      {!entries.length&&<p className="my-2 text-sm text-slate-400">За цим запитом нічого не знайдено.</p>}
      <div className="mt-3 flex items-center gap-3"><button className={cls} disabled={!page} onClick={()=>setPage(n=>n-1)}>Назад</button><span className="text-xs">{Math.min(entries.length,page*12+1)}–{Math.min(entries.length,(page+1)*12)} із {entries.length}</span><button className={cls} disabled={(page+1)*12>=entries.length} onClick={()=>setPage(n=>n+1)}>Далі</button></div>
    </>}
  </section>;
}
