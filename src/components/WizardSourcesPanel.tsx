import React,{useEffect,useRef,useState} from 'react';
import { Camera,FileUp,Loader2,Plus,Search,Trash2 } from 'lucide-react';
import type { WizardSource } from '../../shared/wizardScenarios';
import { wizardApi } from '../utils/expressDraftSession';
import { importWizardFile } from '../utils/wizardFiles';
import { apiPath } from '../utils/basePath';
import { registerNavigationGuard } from '../utils/navigationGuard';
type Person={id?:string;firstName:string;lastName:string};
export const WizardSourcesPanel:React.FC<{
 value:WizardSource[];onChange:(sources:WizardSource[])=>void;intent?:'character'|'technical';
 characters?:Person[];onApplyCharacter?:(id:string,text:string)=>void;onBeforeLeave?:()=>Promise<unknown>;
 onBusyChange?:(busy:boolean)=>void;
}>=({value,onChange,intent='character',characters=[],onApplyCharacter,onBeforeLeave,onBusyChange})=>{
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [url,setUrl]=useState('');
 const [query,setQuery]=useState('');
 const [domain,setDomain]=useState('');
 const [results,setResults]=useState<Array<{title:string;url:string;snippet:string}>>([]);
 const [models,setModels]=useState<Array<{id:string;label?:string;available?:boolean;vision?:boolean}>>([]);
 const [modelId,setModelId]=useState('');
 const current=useRef(value);current.current=value;
 const task=useRef<Promise<unknown>|null>(null);
 const leave=useRef(onBeforeLeave);leave.current=onBeforeLeave;
 useEffect(()=>registerNavigationGuard(async()=>{await task.current;await leave.current?.();}),[]);
 useEffect(()=>{
  let active=true;
  void wizardApi<{models:typeof models}>('/api/chat/models').then(r=>{
   if(active){const vision=r.models.filter(m=>m.vision&&m.available);setModels(vision);}
  }).catch(()=>undefined);
  return ()=>{active=false;};
 },[]);
 function change(next:WizardSource[]){current.current=next;onChange(next);}
 function patch(id:string,data:Partial<WizardSource>){change(current.current.map(s=>s.id===id?{...s,...data}:s));}
 async function perform(work:()=>Promise<void>){
  if(task.current)return;
  setBusy(true);onBusyChange?.(true);setError('');
  const pending=Promise.resolve().then(work);task.current=pending;
  try{await pending;}catch(e){setError((e as Error).message);}
  finally{task.current=null;setBusy(false);onBusyChange?.(false);}
 }
 async function importFiles(files:File[]){
  await perform(async()=>{
   for(const file of files){
    if(current.current.length>=20)throw new Error('У чернетці можна додати до 20 джерел.');
    const source=await importWizardFile(file);change([...current.current,source]);
   }
  });
 }
 async function loadUrl(raw:string){
  const result=await wizardApi<any>('/api/express/sources/import-url',{method:'POST',body:JSON.stringify({url:raw})});
  let source:WizardSource;
  if(result.file){
   const bytes=Uint8Array.from(atob(result.file.dataBase64),c=>c.charCodeAt(0));
   source=await importWizardFile(new File([bytes],result.file.name,{type:result.file.type}));
   source={...source,kind:'url',url:result.url,retrievedAt:result.retrievedAt};
  }else source={...result.source,id:crypto.randomUUID()};
  if(current.current.length>=20)throw new Error('У чернетці вже 20 джерел.');
  change([...current.current,source]);setUrl('');
 }
 return <section className="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-4" aria-label="Матеріали й джерела">
  <h3 className="text-sm font-semibold text-slate-100">Матеріали й джерела</h3>
  <p className="mt-1 text-xs text-slate-400">Фото приватні. ШІ отримує лише підтверджений текст джерел; аналіз фото запускається окремою кнопкою. До 20 джерел, файл до 8 МБ.</p>
  {error&&<p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  <fieldset disabled={busy} className="min-w-0">
   <div className="my-3 flex flex-wrap gap-3 text-sm text-emerald-300">
    <label className="cursor-pointer inline-flex items-center gap-1"><FileUp size={16}/> Завантажити фото / PDF / DOCX / TXT
     <input className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.docx,.txt,.md" onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void importFiles(files);}}/>
    </label>
    <label className="cursor-pointer inline-flex items-center gap-1"><Camera size={16}/> Сфотографувати
     <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void importFiles(files);}}/>
    </label>
    <button type="button" className="inline-flex items-center gap-1" disabled={value.length>=20} onClick={()=>change([...current.current,{id:crypto.randomUUID(),kind:'note',title:'Нотатка автора',text:'',approved:false}])}><Plus size={16}/> Додати текст</button>
   </div>
   {value.some(s=>s.kind==='photo')&&<label className="mb-3 block text-xs text-slate-300">Модель для аналізу фото
    <select value={modelId} onChange={e=>setModelId(e.target.value)} className="ml-2 max-w-full rounded border border-slate-700 bg-slate-900 p-2">
     <option value="">Оберіть модель із зором</option>{models.map(m=><option key={m.id} value={m.id}>{m.label||m.id}</option>)}
    </select>
   </label>}
   <div className="space-y-3">{value.map(source=><article key={source.id} className="rounded-lg border border-slate-700 p-3">
    <div className="flex items-center gap-2">
     <input aria-label="Назва джерела" value={source.title} onChange={e=>patch(source.id,{title:e.target.value,approved:false})} className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-200"/>
     <button type="button" title="Видалити джерело з чернетки" onClick={()=>change(current.current.filter(s=>s.id!==source.id))}><Trash2 size={16}/></button>
    </div>
    {source.kind==='photo'&&source.assetId&&<div className="my-2 flex flex-wrap items-center gap-3">
     <img src={apiPath('/api/media/file/'+source.assetId)} alt={source.title} className="h-24 max-w-full rounded object-contain"/>
     <button type="button" disabled={!modelId} className="text-xs text-emerald-300 underline" onClick={()=>void perform(async()=>{
      const result=await wizardApi<{text:string}>('/api/express/sources/describe-photo',{method:'POST',body:JSON.stringify({assetId:source.assetId,modelId,intent})});
      if(current.current.some(s=>s.id===source.id))patch(source.id,{text:result.text,approved:false});
     })}>Запропонувати опис видимого</button>
    </div>}
    {source.url&&<a href={source.url} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-cyan-300">{source.url}</a>}
    {source.retrievedAt&&<p className="text-xs text-slate-500">Отримано: {new Date(source.retrievedAt).toLocaleString()}</p>}
    <textarea aria-label={'Текст джерела '+source.title} value={source.text} maxLength={100000} rows={4} onChange={e=>patch(source.id,{text:e.target.value,approved:false})} placeholder="Перевірте витяг або введіть власний опис" className="mt-2 w-full rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200"/>
    <label className="mt-2 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={source.approved} disabled={!source.text.trim()} onChange={e=>patch(source.id,{approved:e.target.checked})}/> Текст перевірено; дозволяю використовувати його для ШІ</label>
    {source.kind==='photo'&&characters.length>0&&<div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-300">
     <label>Герой: <select value={source.characterId??''} onChange={e=>patch(source.id,{characterId:e.target.value||undefined})} className="rounded border border-slate-700 bg-slate-900 p-1">
      <option value="">Не прив’язано</option>{characters.map(c=><option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
     </select></label>
     {onApplyCharacter&&<button type="button" className="text-emerald-300 underline" disabled={!source.approved||!source.characterId} onClick={()=>onApplyCharacter(source.characterId!,source.text)}>Прийняти як опис зовнішності</button>}
    </div>}
   </article>)}</div>
   <details className="mt-4 text-sm text-slate-300" open={intent==='technical'?true:undefined}>
    <summary>Технічні вебджерела та документація</summary>
    <div className="mt-2 flex flex-wrap gap-2">
     <input aria-label="HTTPS-посилання на документацію" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://manufacturer.example/manual" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 p-2 text-xs"/>
     <button type="button" className="text-emerald-300" disabled={!url.trim()} onClick={()=>void perform(()=>loadUrl(url))}>Завантажити текст</button>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
     <input aria-label="Запит пошуку документації" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Виробник, модель, ревізія, manual / datasheet" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 p-2 text-xs"/>
     <input aria-label="Домен виробника (необов’язково)" value={domain} onChange={e=>setDomain(e.target.value)} placeholder="Домен виробника (необов’язково)" className="rounded border border-slate-700 bg-slate-900 p-2 text-xs"/>
     <button type="button" disabled={query.trim().length<3} className="inline-flex items-center gap-1 text-emerald-300" onClick={()=>void perform(async()=>{
      const result=await wizardApi<{results:typeof results}>('/api/express/sources/search',{method:'POST',body:JSON.stringify({query,domain})});setResults(result.results);
      if(!result.results.length)setError('Пошук не повернув результатів. Уточніть модель або додайте посилання вручну.');
     })}><Search size={14}/> Шукати</button>
    </div>
    <a href={'https://www.google.com/search?q='+encodeURIComponent(query+' manual datasheet'+(domain?' site:'+domain:''))} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-cyan-300 underline">Відкрити пошук у браузері</a>
    <p className="mt-1 text-xs text-slate-500">Результат пошуку ще не є підтвердженим джерелом. Перевірте модель і ревізію; перевагу надавайте документації виробника.</p>
    {results.map(r=><div key={r.url} className="mt-2 rounded border border-slate-700 p-2 text-xs">
     <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300">{r.title}</a><p>{r.snippet}</p>
     <button type="button" className="mt-1 text-emerald-300 underline" onClick={()=>void perform(()=>loadUrl(r.url))}>Імпортувати для перевірки</button>
    </div>)}
   </details>
  </fieldset>
  {busy&&<p role="status" className="mt-2 flex items-center gap-2 text-xs text-emerald-300"><Loader2 size={14} className="animate-spin"/> Працюю з матеріалами…</p>}
 </section>;
};
