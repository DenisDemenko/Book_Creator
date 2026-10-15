import React,{useState} from 'react';
import { BOOK_SCENARIOS,bookScenario,scenarioErrors } from '../../shared/wizardScenarios';
import type { ExpressWizardPayload } from './ExpressWizardView';
import type { Book } from '../types';
import { WizardSourcesPanel } from './WizardSourcesPanel';
export const WizardScenarioFields:React.FC<{
 value:ExpressWizardPayload;onChange:(patch:Partial<ExpressWizardPayload>)=>void;currentBook?:Book;
 onBeforeLeave?:()=>Promise<unknown>;onBusyChange?:(busy:boolean)=>void;
}>=({value,onChange,currentBook,onBeforeLeave,onBusyChange})=>{
 const selected=bookScenario(value.entryMode);
 const [importNotice,setImportNotice]=useState('');
 function select(id:string){
  const next=bookScenario(id);
  onChange({entryMode:id,framework:next.documentary?'documentary':value.framework==='documentary'?'hero_journey':value.framework,
    targetCastSize:next.documentary?0:(value.targetCastSize||2)});
 }
 const cards=(extra:boolean)=><div className="mt-2 grid gap-2 sm:grid-cols-2">{BOOK_SCENARIOS.filter(s=>!!s.extra===extra).map(s=>
  <button type="button" data-wizard-scenario={s.id} key={s.id} aria-pressed={selected.id===s.id} onClick={()=>select(s.id)}
   className={'rounded-xl border p-3 text-left '+(selected.id===s.id?'border-emerald-500 bg-emerald-500/10':'border-slate-700 bg-slate-950/70 hover:border-slate-500')}>
   <span className="block text-sm font-semibold text-slate-100">{s.title}</span><span className="mt-1 block text-xs text-slate-400">{s.description}</span>
  </button>)}</div>;
 return <div className="mb-5">
  <h2 className="text-lg font-bold text-slate-100">З чого почнемо книгу?</h2>
  {cards(false)}
  <details className="mt-3 text-sm text-slate-300"><summary>Інтерв’ю, серія, детектив, лабіринт, співавторство, практична книга</summary>{cards(true)}</details>
  <p className="my-3 text-sm text-emerald-200">{selected.description}</p>
  {selected.fields.map(field=><label key={field.key} className="mt-3 block text-sm text-slate-300">{field.label}{field.required?' *':''}
   <textarea name={field.key} value={value.scenarioInputs?.[field.key]??''} rows={3} maxLength={16000} placeholder={field.hint}
    onChange={e=>onChange({scenarioInputs:{...value.scenarioInputs,[field.key]:e.target.value}})}
    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-sm text-slate-100"/>
  </label>)}
  {selected.id==='series'&&currentBook&&<button type="button" className="mt-3 text-xs text-cyan-300 underline" onClick={()=>{
   const canon=currentBook.characters.map(c=>[c.id,c.name,c.surname,c.biography].filter(Boolean).join(' — ')).join('\n');
   const text=currentBook.chapters.flatMap(ch=>ch.sections.map(s=>s.content)).join('\n\n');
   setImportNotice(text.length>100000?'Героїв імпортовано. Текст більший за 100 000 символів: додайте потрібні уривки окремими файлами.':'Героїв і текст імпортовано. Перевірте матеріали перед підтвердженням.');
   onChange({canonicalSourceBookId:currentBook.id,scenarioInputs:{...value.scenarioInputs,previousCanon:canon.slice(0,16000)},
    cast:currentBook.characters.map(c=>({id:c.id,firstName:c.name,lastName:c.surname??'',poltiRoleName:c.role,appearance:JSON.stringify(c.appearance??{}),hook:c.biography,approved:true})),
    sourceMaterials:[...(value.sourceMaterials??[]).filter(s=>s.id!=='previous-book-'+currentBook.id),...(text.length<=100000?[{id:'previous-book-'+currentBook.id,kind:'note',title:'Попередня книга: '+currentBook.title,text,approved:false} as const]:[])]});
  }}>Взяти героїв і текст поточної книги «{currentBook.title}». Продовження створиться окремою книгою.</button>}
  {importNotice&&<p role="status" className="mt-2 text-xs text-amber-200">{importNotice}</p>}
  <div className="mt-4 grid gap-3 sm:grid-cols-2">
   <label className="text-sm text-slate-300">Аудиторія<input value={value.audience??''} onChange={e=>onChange({audience:e.target.value})} maxLength={500} className="mt-1 w-full rounded border border-slate-700 bg-slate-950/70 p-2"/></label>
   <label className="text-sm text-slate-300">Тон<input value={value.tone??''} onChange={e=>onChange({tone:e.target.value})} placeholder="Гумор, спокійний, пригодницький…" maxLength={500} className="mt-1 w-full rounded border border-slate-700 bg-slate-950/70 p-2"/></label>
  </div>
  {['lived_experience','collective'].includes(selected.id)&&<label className="mt-3 flex items-start gap-2 text-xs text-slate-300">
   <input type="checkbox" checked={value.sourcesPermission===true} onChange={e=>onChange({sourcesPermission:e.target.checked})}/>
   Маю дозвіл на використання цих матеріалів; приватні записи та справжні імена без дозволу не включаються до книги.
  </label>}
  <WizardSourcesPanel value={value.sourceMaterials??[]} onChange={sourceMaterials=>onChange({sourceMaterials})}
   onBeforeLeave={onBeforeLeave} onBusyChange={onBusyChange}/>
  {scenarioErrors(value).length>0&&<ul className="mt-3 space-y-1 text-xs text-amber-300">{scenarioErrors(value).map(message=><li key={message}>{message}</li>)}</ul>}
 </div>;
};
