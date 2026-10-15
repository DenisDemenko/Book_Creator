import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { WORLD_FIELDS } from '../../shared/storyWorld';
export function WorldFields({value,fields=WORLD_FIELDS,onChange,disabled=false}:{value:any;fields?:ReadonlyArray<readonly [string,string,string]>;onChange:(patch:any)=>void;disabled?:boolean}){
 const {lang}=useLanguage();const en=lang==='en';
 return <fieldset disabled={disabled} className="space-y-2 min-w-0" data-world-fields>
  {fields.map(([key,uk,english])=><label key={key} className="block text-xs text-slate-300">
   {en?english:uk}
   {['name','era','time','season','weather','light'].includes(key)?
    <input name={'world-'+key} value={value?.[key]||''} maxLength={key==='name'?300:8000} onChange={e=>onChange({[key]:e.target.value,approved:false})} className="w-full p-2 rounded-xl bg-slate-950 border border-slate-700 text-sm"/>:
    <textarea name={'world-'+key} value={value?.[key]||''} rows={key==='description'?3:2} maxLength={['description','notes'].includes(key)?16000:8000} onChange={e=>onChange({[key]:e.target.value,approved:false})} className="w-full p-2 rounded-xl bg-slate-950 border border-slate-700 text-sm"/>}
  </label>)}
  <button type="button" data-world-confirm onClick={()=>onChange({approved:true})} disabled={!value?.name?.trim()} className="btn-glass px-3 py-2 text-xs rounded-xl">
   {value?.approved?(en?'✓ Canon confirmed':'✓ Канон підтверджено'):(en?'Confirm canon':'Підтвердити канон')}
  </button>
 </fieldset>;
}
