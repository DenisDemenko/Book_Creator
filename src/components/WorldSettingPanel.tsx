import React,{useRef,useState} from 'react';
import type {Book} from '../types';
import {useLanguage} from '../i18n/LanguageContext';
import {WorldFields} from './WorldFields';
import {WorldPhotoAnalysis} from './WorldPhotoAnalysis';
import {WORLD_FIELDS,LOCATION_FIELDS,SETTING_FIELDS,type WorldBase} from '../../shared/storyWorld';
import {worldProse,insertWorldDescription} from '../utils/storyWorld';
import {acceptAiOrigin} from '../../shared/aiTextOrigin';
import {wizardApi} from '../utils/expressDraftSession';
export function WorldSettingPanel({book,onUpdateBook,chapterId,sectionId,actor,readOnly=false,onInsertAtCursor,onDiscuss,initialAssetId,onReveal}:{book:Book;onUpdateBook:(book:Book)=>void;chapterId?:string;sectionId?:string;actor?:string;readOnly?:boolean;onInsertAtCursor?:(text:string)=>void;onDiscuss?:(text:string,where:string)=>void;initialAssetId?:string;onReveal?:(chapterId:string,sectionId:string,text:string)=>void}){
 const {lang}=useLanguage(),en=lang==='en';const tr=(uk:string,eng:string)=>en?eng:uk;
 const live=useRef(book);live.current=book;
 const [kind,setKind]=useState<'world'|'location'|'setting'>('world'),[locationId,setLocationId]=useState(book.storyLocations?.[0]?.id||'');
 const [destination,setDestination]=useState(sectionId||book.chapters[0]?.sections[0]?.id||''),[place,setPlace]=useState<'start'|'end'|'cursor'>('end'),[message,setMessage]=useState('');
 const section=book.chapters.flatMap(c=>c.sections).find(s=>s.id===(sectionId||destination));
 const location=book.storyLocations?.find(l=>l.id===locationId);
 const value:WorldBase|undefined=kind==='world'?book.storyWorld:kind==='location'?location:section?.setting;
 const disabled=readOnly||!!book.accessRestricted;
 function patch(data:any){
  if(disabled)return;const b=live.current;
  const base={id:value?.id||crypto.randomUUID(),name:'',description:'',approved:false,...value,...data};
  let next=b;
  if(kind==='world')next={...b,storyWorld:base};
  else if(kind==='location'){
   next={...b,storyLocations:(b.storyLocations||[]).map(l=>l.id===locationId?{...base,worldId:b.storyWorld?.id}:l)};
  }else if(section)next={...b,chapters:b.chapters.map(c=>({...c,sections:c.sections.map(s=>s.id!==section.id?s:{...s,setting:base})}))};
  live.current=next;onUpdateBook(next);
 }
 function addLocation(){const id=crypto.randomUUID();const b=live.current;onUpdateBook({...b,storyLocations:[...(b.storyLocations||[]),{id,name:tr('Нова локація','New location'),description:'',worldId:b.storyWorld?.id,approved:false}]});setLocationId(id);}
 function insert(){
  if(!value?.approved||disabled)return;
  const text=worldProse(value,kind);if(!text)return;
  if(place==='cursor'&&onInsertAtCursor){onInsertAtCursor(text);setMessage(tr('Додано до курсора','Inserted at cursor'));return;}
  const ch=live.current.chapters.find(c=>c.sections.some(s=>s.id===destination));
  if(!ch)return;const next=insertWorldDescription(live.current,ch.id,destination,text,place==='start'?'start':'end');
  if(next){onUpdateBook(next);setMessage(tr('Додано до обраного розділу','Inserted into selected section'));onReveal?.(ch.id,destination,value.description);}
 }
 return <details className="glass-panel rounded-2xl p-3 space-y-3" data-world-setting-panel open={initialAssetId?true:undefined}>
  <summary className="cursor-pointer text-sm font-bold">{tr('Світ, локації та обстановка','World, locations and setting')}</summary>
  {disabled?<p className="text-xs">{tr('Для зміни загального світу потрібен повний доступ до книги.','Full book access is required to change world canon.')}</p>:<>
  <div className="flex flex-wrap gap-2 my-3">{(['world','location','setting'] as const).map((k,i)=><button key={k} type="button" data-world-tab={k} aria-pressed={kind===k} onClick={()=>{setKind(k);setMessage('');}} className={'rounded-xl p-2 text-xs '+(kind===k?'badge-glass text-emerald-400':'btn-glass')}>{[tr('Світ','World'),tr('Локації','Locations'),tr('Обстановка сцени','Scene setting')][i]}</button>)}</div>
  <p className="text-xs text-slate-400">{tr('Картки та нотатки не додаються до рукопису автоматично. Підтвердьте канон і явно оберіть місце вставки.','Cards and notes never enter the manuscript automatically. Confirm canon and choose an insertion target.')}</p>
  {kind==='location'&&<div className="flex flex-wrap gap-2"><select aria-label="World location" value={locationId} onChange={e=>setLocationId(e.target.value)} className="bg-slate-950 p-2 text-xs rounded-xl min-w-0 max-w-full"><option value="">—</option>{book.storyLocations?.map(l=><option value={l.id} key={l.id}>{l.name}</option>)}</select><button type="button" onClick={addLocation} className="text-xs btn-glass p-2">+ {tr('Локація','Location')}</button></div>}
  {(kind!=='location'||location)&& (kind!=='setting'||section)?<>
   {kind==='setting'&&<label className="block text-xs">{tr('Пов’язана локація','Linked location')}<select aria-label="Scene location" value={section?.setting?.locationId||''} onChange={e=>patch({locationId:e.target.value})} className="bg-slate-950 p-2 w-full rounded-xl"><option value="">—</option>{book.storyLocations?.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
   {kind==='setting'&&section?.setting?.locationId&&<p className="text-xs text-slate-400 whitespace-pre-wrap">{book.storyLocations?.find(l=>l.id===section.setting?.locationId)?.description}</p>}
   <WorldFields value={value} fields={kind==='world'?WORLD_FIELDS:kind==='location'?LOCATION_FIELDS:SETTING_FIELDS} onChange={patch}/>
   {value?.descriptionOrigin&&<p className="text-xs text-teal-400">{tr('Згенеровано ШІ · прийнято автором','AI generated · accepted by author')}</p>}
   <WorldPhotoAnalysis key={kind+':'+(value?.id||'new')} target={kind} bookId={book.id} sectionId={kind==='setting'?section?.id:undefined} initialAssetId={initialAssetId}
    snapshotKey={JSON.stringify({value,section:kind==='setting'?section?.id:null})}
    beforeAnalyze={async()=>{const source=await wizardApi<any>('/api/core/projects/'+encodeURIComponent(book.id)+'/source');return {expectedRevision:source.revision};}}
    onAccept={(text,p)=>patch({description:text,descriptionOrigin:{...acceptAiOrigin(actor||'local-author'),modelId:p.modelId},approved:false,...(kind==='location'?{mediaIds:p.assetIds}:{})})}/>
   <div className="space-y-2 my-3">
    <label className="block text-xs">{tr('Куди додати опис','Insert description into')}<select aria-label="World insert section" value={destination} onChange={e=>setDestination(e.target.value)} className="bg-slate-950 p-2 w-full rounded-xl"><option value="">—</option>{book.chapters.flatMap(c=>c.sections.map(s=><option key={s.id} value={s.id}>{c.title} · {s.title}</option>))}</select></label>
    <select aria-label="World insert position" value={place} onChange={e=>setPlace(e.target.value as any)} className="bg-slate-950 w-full p-2 text-xs rounded-xl">
     <option value="end">{tr('Кінець розділу','End of section')}</option><option value="start">{tr('Початок розділу','Start of section')}</option>{onInsertAtCursor&&<option value="cursor">{tr('До курсора в активній сцені','At cursor in active scene')}</option>}
    </select>
    <button type="button" data-world-insert disabled={!value?.approved||!value.description.trim()||(!destination&&place!=='cursor')} onClick={insert} className="btn-glass p-2 text-xs rounded-xl disabled:opacity-40">{tr('Додати опис у книгу','Insert description into book')}</button>
   </div>
   {onDiscuss&&<div className="flex flex-wrap gap-2">{[tr('Доповнити антураж','Expand ambience'),tr('Перевірити канон','Check canon')].map(action=><button type="button" key={action} className="text-xs btn-glass p-2" onClick={()=>onDiscuss(action+'. '+tr('Дай пропозицію для прийняття або відхилення.','Return a proposal for review.')+'\n'+JSON.stringify({world:book.storyWorld?.approved?{...book.storyWorld,notes:undefined}:null,location:location?.approved?{...location,notes:undefined}:null,setting:section?.setting?.approved?{...section.setting,notes:undefined}:null,text:section?.content}),tr('Світ та обстановка','World and setting'))}>{action} → Jev</button>)}</div>}
  </>:<p className="text-xs">{tr('Створіть локацію або виберіть сцену.','Create a location or select a scene.')}</p>}
  {message&&<p role="status" className="text-xs text-emerald-400">{message}</p>}
  </>}
 </details>;
}
