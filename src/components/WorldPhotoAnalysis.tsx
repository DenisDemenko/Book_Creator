import React,{useEffect,useRef,useState} from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import {wizardApi} from '../utils/expressDraftSession';
import {importWizardFile} from '../utils/wizardFiles';
import {apiPath} from '../utils/basePath';
export interface WorldPhotoProposal {visible:string;creative:string;unknown:string;modelId:string;assetIds:string[];revision?:number}
export function WorldPhotoAnalysis({target,bookId,sectionId,beforeAnalyze,onAccept,initialAssetId,snapshotKey}:{target:'world'|'location'|'setting';bookId?:string;sectionId?:string;beforeAnalyze?:()=>Promise<object>;onAccept:(text:string,p:WorldPhotoProposal)=>void;initialAssetId?:string;snapshotKey:string}){
 const {lang}=useLanguage(),en=lang==='en';const tr=(uk:string,eng:string)=>en?eng:uk;
 const [assets,setAssets]=useState<any[]>([]),[selected,setSelected]=useState<string[]>(initialAssetId?[initialAssetId]:[]);
 const [models,setModels]=useState<any[]>([]),[modelId,setModelId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [proposal,setProposal]=useState<WorldPhotoProposal|null>(null),[creative,setCreative]=useState(false),[stamp,setStamp]=useState('');
 const live=useRef(snapshotKey);live.current=snapshotKey;const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;void Promise.all([
  wizardApi<any>('/api/media/list?latest=1').then(r=>setAssets(r.assets.filter((a:any)=>['image/jpeg','image/png','image/webp'].includes(a.mimeType)&&(!bookId||!a.bookId||a.bookId===bookId)))),
  wizardApi<any>('/api/chat/models').then(r=>setModels(r.models.filter((m:any)=>m.vision&&m.available)))
 ]).catch(e=>setError(e.message));return()=>{mounted.current=false;};},[bookId]);
 const stale=proposal&&stamp!==snapshotKey;
 async function analyze(){
  setBusy(true);setError('');setProposal(null);const start=live.current;
  try{
   const context=beforeAnalyze?await beforeAnalyze():{};
   const out=await wizardApi<WorldPhotoProposal>('/api/express/sources/describe-world',{method:'POST',body:JSON.stringify({target,bookId,sectionId,assetIds:selected,modelId,...context})});
   if(!mounted.current)return;if(live.current!==start)throw new Error(tr('Контекст змінився. Повторіть аналіз.','Context changed. Analyze again.'));
   setProposal(out);setCreative(false);setStamp(start);
  }catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setBusy(false);}
 }
 return <details className="mt-3 rounded-xl border border-slate-700 p-3" data-world-photo>
  <summary className="cursor-pointer text-sm font-semibold">{tr('Описати за фото з медіатеки','Describe from media library')}</summary>
  <p className="text-xs text-slate-400 my-2">{tr('Завантажені та згенеровані фото. Аналіз лише після натискання кнопки; до 4 зображень; кожне аналізується окремим запитом.','Uploaded and generated images. Analysis starts only on request; up to 4 images; each is analyzed in a separate request.')}</p>
  {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  <fieldset disabled={busy} className="space-y-2 min-w-0">
   <label className="block text-xs">{tr('Додати фото / сфотографувати','Upload / take photo')}
    <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={async e=>{
     const files=Array.from(e.target.files??[]);e.target.value='';setBusy(true);setError('');
     try{for(const f of files.slice(0,4)){const source=await importWizardFile(f);const a={id:source.assetId,title:source.title,url:'/api/media/file/'+source.assetId};setAssets(old=>[...old,a]);setSelected(old=>[...old,a.id!].slice(0,4));}}
     catch(e){setError((e as Error).message);}finally{setBusy(false);}
    }} className="block max-w-full text-xs"/>
   </label>
   <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">{assets.map(a=><label key={a.id} className="text-xs min-w-0 break-words">
    <input type="checkbox" checked={selected.includes(a.id)} disabled={!selected.includes(a.id)&&selected.length>=4} onChange={e=>{setProposal(null);setSelected(old=>e.target.checked?[...old,a.id]:old.filter(id=>id!==a.id));}}/>
    <img className="w-full h-20 object-contain" src={apiPath(a.url)} alt={a.title||a.filename}/>{a.title||a.filename}
   </label>)}</div>
   <label className="block text-xs">{tr('Модель із зором','Vision model')}
    <select aria-label="World vision model" value={modelId} onChange={e=>{setModelId(e.target.value);setProposal(null);}} className="w-full bg-slate-950 p-2 rounded-xl">
     <option value="">{tr('Оберіть модель','Select a model')}</option>{models.map(m=><option key={m.id} value={m.id}>{m.label||m.id}</option>)}
    </select>
   </label>
   <button type="button" data-world-analyze disabled={!modelId||!selected.length} onClick={()=>void analyze()} className="btn-glass p-2 rounded-xl text-xs">{busy?tr('Аналіз…','Analyzing…'):tr('Запропонувати опис ШІ','Suggest AI description')}</button>
  </fieldset>
  {proposal&&<div className="space-y-2 mt-3" data-world-proposal>
   <label className="block text-xs">{tr('Видиме на фото','Visible in images')}<textarea aria-label="Visible world description" className="w-full bg-slate-950 p-2 rounded-xl" value={proposal.visible} onChange={e=>setProposal({...proposal,visible:e.target.value})}/></label>
   <p className="text-xs whitespace-pre-wrap">{tr('Художнє припущення: ','Creative suggestion: ')}{proposal.creative}</p>
   <p className="text-xs whitespace-pre-wrap text-slate-400">{tr('Невідоме: ','Unknown: ')}{proposal.unknown}</p>
   <label className="block text-xs"><input type="checkbox" checked={creative} onChange={e=>setCreative(e.target.checked)}/>{tr('Додати художнє припущення','Include creative suggestion')}</label>
   {stale&&<p role="alert">{tr('Контекст змінився. Повторіть аналіз.','Context changed. Analyze again.')}</p>}
   <button type="button" data-world-photo-accept disabled={!!stale||!proposal.visible.trim()} className="btn-glass p-2 text-xs" onClick={()=>{onAccept([proposal.visible,creative?proposal.creative:''].filter(Boolean).join('\n\n'),proposal);setProposal(null);}}>{tr('Прийняти в обраний блок','Accept into selected card')}</button>
   <button type="button" data-world-photo-reject className="p-2 text-xs" onClick={()=>setProposal(null)}>{tr('Відхилити','Reject')}</button>
  </div>}
 </details>;
}
