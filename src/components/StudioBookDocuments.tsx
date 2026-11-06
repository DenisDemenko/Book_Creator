import React,{useEffect,useMemo,useState} from 'react';
interface Summary{ownerId?:string|null;id:string;title:string;updatedAt:string;pageCount?:number;}
export function StudioBookDocuments({books,userId,onOpen,onCreate,opening}:{books:Summary[];userId:string|null;onOpen:(id:string)=>void;onCreate:()=>void;opening:string|null}){
  const [documents,setDocuments]=useState<Summary[]>([]),[error,setError]=useState(''),[query,setQuery]=useState(''),[kind,setKind]=useState('all'),[sort,setSort]=useState('date'),[page,setPage]=useState(0);
  useEffect(()=>{let stopped=false;if(!userId){setDocuments([]);return;}
    fetch('/api/wardrobe/documents',{credentials:'same-origin'}).then(async r=>{if(!r.ok)throw Error('Не вдалося отримати PDF-документи.');return r.json();}).then(data=>{if(!stopped){setDocuments((data.documents||[]).filter((d:Summary)=>d.ownerId===userId));setError('');}}).catch(e=>{if(!stopped)setError(e.message);});return()=>{stopped=true;};
  },[userId,books]);
  const entries=useMemo(()=>{const ownedDocuments=documents.filter(d=>d.ownerId===userId),ids=new Set(ownedDocuments.map(d=>d.id)),all=new Map(books.map(b=>[b.id,b]));ownedDocuments.forEach(d=>all.set(d.id,d));return [...all.values()].filter(b=>(kind==='all'||(kind==='pdf')===ids.has(b.id))&&(b.title+' '+b.id).toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title):b.updatedAt.localeCompare(a.updatedAt));},[books,documents,query,kind,sort,userId]);
  const cls='rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm';
  return <section className="rounded-2xl border border-cyan-500/30 bg-slate-950/50 p-5" data-book-documents>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Книги та PDF-документи</h2><button className={cls+' bg-amber-500 text-slate-950'} onClick={onCreate}>＋ Створити книгу</button><a className={cls} href="/wardrobe-builder">Створити PDF шафи →</a></div>
    <p className="my-2 text-sm text-slate-400">Документацію шафи можна зберегти з конструктора кнопкою «PDF у Книги». Тут відкриваються перегляд, редактор тексту, примітки та порядок аркушів.</p>
    {!userId?<p>Увійдіть, щоб бачити документи свого акаунта.</p>:<>
      <div className="my-3 flex flex-wrap gap-2"><input className={cls+' min-w-0 flex-1'} aria-label="Знайти книгу або PDF" placeholder="Назва або ID книги / документа" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/>
        <select className={cls} aria-label="Тип документа" value={kind} onChange={e=>{setKind(e.target.value);setPage(0);}}><option value="all">Усі</option><option value="book">Книги</option><option value="pdf">PDF шафи</option></select>
        <select className={cls} aria-label="Порядок документів" value={sort} onChange={e=>{setSort(e.target.value);setPage(0);}}><option value="date">Спочатку нові зміни</option><option value="title">За назвою</option></select></div>
      {error&&<p role="alert" className="text-amber-300">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{entries.slice(page*12,(page+1)*12).map(b=><button key={b.id} className={cls+' text-left disabled:opacity-50'} disabled={opening!==null} onClick={()=>onOpen(b.id)}><span className="block truncate font-bold">{b.title||b.id}</span><span className="block text-xs text-slate-400">{b.pageCount?`PDF · ${b.pageCount} аркушів`:'Книга'} · {new Date(b.updatedAt).toLocaleDateString()}</span><span className="block truncate text-xs text-slate-500">{b.id}</span><span className="text-cyan-200">{opening===b.id?'Відкриваємо…':b.pageCount?'Переглянути й редагувати PDF →':'Відкрити книгу →'}</span></button>)}</div>
      {!entries.length&&<p className="my-2 text-sm text-slate-400">За цим запитом нічого не знайдено.</p>}
      <div className="mt-3 flex items-center gap-3"><button className={cls} disabled={!page} onClick={()=>setPage(n=>n-1)}>Назад</button><span className="text-xs">{Math.min(entries.length,page*12+1)}–{Math.min(entries.length,(page+1)*12)} із {entries.length}</span><button className={cls} disabled={(page+1)*12>=entries.length} onClick={()=>setPage(n=>n+1)}>Далі</button></div>
    </>}
  </section>;
}
