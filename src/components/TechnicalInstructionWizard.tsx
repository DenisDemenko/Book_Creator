import React,{useState} from 'react';
import {ArrowLeft,Loader2,Wrench} from 'lucide-react';
import type {WizardSource} from '../../shared/wizardScenarios';
import type {TechnicalSettings,TechnicalProposal} from '../../shared/technicalInstruction';
import {WizardSourcesPanel} from './WizardSourcesPanel';
import {InstructionBuilderView,type InstructionBookCreationPayload} from './InstructionBuilderView';
import {useWizardDraft} from '../utils/useWizardDraft';
import type {WizardDraft} from '../utils/expressDraftSession';
import {technicalProposalToInstruction} from '../utils/technicalInstructionDraft';
import {createEmptyInstruction,saveInstructionDraft} from '../utils/instructionDraft';
import type {Instruction} from '../types';
interface Payload{sourceMaterials?:WizardSource[];technical?:TechnicalSettings}
const initial:Payload={technical:{mode:'assembly',title:'',modelCode:'',goal:''},sourceMaterials:[]};
export const TechnicalInstructionWizard:React.FC<{
 onChangeTrack?:()=>void;onInstructionBookCreated?:(payload:InstructionBookCreationPayload)=>void;
}>=({onChangeTrack,onInstructionBookCreated})=>{
 const {session,view,loading,error,setError}=useWizardDraft('nova_technical_instruction_draft','technical_instruction',initial);
 const [working,setWorking]=useState(false);
 const [sourceBusy,setSourceBusy]=useState(false);
 const [reviewed,setReviewed]=useState(false);
 const [accepted,setAccepted]=useState<Instruction|null>(null);
 const data=view.payload.technical??initial.technical!;
 const sources=view.payload.sourceMaterials??[];
 const busy=loading||working||sourceBusy;
 const proposal=data.proposal;
 function edit(patch:Partial<TechnicalSettings>){
  setReviewed(false);session.edit({technical:{...data,...patch,proposal:undefined}});
 }
 function sourceChange(next:WizardSource[]){setReviewed(false);session.edit({sourceMaterials:next,technical:{...data,proposal:undefined}});}
 async function generate(){
  if(working)return;setWorking(true);setError(null);setReviewed(false);
  try{await session.generate<{draft:WizardDraft<Payload>;proposal:TechnicalProposal}>('/api/express/technical/generate',{});}
  catch(e){setError((e as Error).message);}
  finally{setWorking(false);}
 }
 async function accept(){
  if(!proposal||!reviewed)return;
  try{
   await session.flush();
   const doc=technicalProposalToInstruction(proposal,data,sources);
   saveInstructionDraft(doc);setAccepted(doc);
  }catch(e){setError((e as Error).message);}
 }
 if(accepted)return <div>
  <button type="button" className="mx-4 mt-4 text-sm text-cyan-300 underline" onClick={()=>setAccepted(null)}>Повернутися до джерел і пропозиції</button>
  <InstructionBuilderView initialInstruction={accepted} onChangeTrack={onChangeTrack} onInstructionBookCreated={onInstructionBookCreated}/>
 </div>;
 return <div data-technical-wizard className="mx-auto w-full max-w-5xl px-4 py-7">
  <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
   <div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-300"><Wrench size={16}/> Майстер інструкцій</p>
    <h1 className="mt-2 text-2xl font-bold text-slate-100">Інструкція з фото й техдокументації</h1>
    <p className="mt-2 text-sm text-slate-400">Матеріали → перевірені відомості → кроки → редактор інструкції → книга.</p></div>
   {onChangeTrack&&<button type="button" disabled={busy} onClick={()=>void session.flush().then(()=>onChangeTrack()).catch(e=>setError(e.message))} className="flex items-center gap-2 text-xs text-slate-300"><ArrowLeft size={14}/> До вибору напряму</button>}
  </header>
  {(error||view.error)&&<p role="alert" className="mb-4 rounded-xl border border-red-500/40 bg-red-950/60 p-3 text-sm text-red-200">{error||view.error}</p>}
  {view.conflict&&<div className="mb-4 rounded-xl border border-amber-500/40 p-4 text-sm text-slate-200">
   <p>Інша вкладка змінила чернетку. Збережіть свою копію перед вибором серверної версії.</p>
   <details><summary>Моя локальна копія</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(view.payload,null,2)}</pre></details>
   <details><summary>Серверна версія</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(view.conflict.payload,null,2)}</pre></details>
   <button type="button" className="mt-2 underline" onClick={()=>{session.useServer();setError(null);}}>Продовжити із серверною версією</button>
  </div>}
  <fieldset disabled={busy} className="min-w-0 rounded-2xl border border-slate-700 bg-slate-900/90 p-5">
   <h2 className="text-lg font-bold text-slate-100">1. Виріб і мета</h2>
   <div className="mt-3 grid gap-3 sm:grid-cols-2">
    <label className="text-sm text-slate-300">Виріб<input name="technical-title" value={data.title} maxLength={500} onChange={e=>edit({title:e.target.value})} placeholder="Стіл, пристрій, механізм…" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"/></label>
    <label className="text-sm text-slate-300">Модель і ревізія<input name="technical-model" value={data.modelCode} maxLength={500} onChange={e=>edit({modelCode:e.target.value})} placeholder="Точне маркування з документації" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"/></label>
   </div>
   <label className="mt-3 block text-sm text-slate-300">Що створюємо?
    <select name="technical-mode" value={data.mode} onChange={e=>edit({mode:e.target.value as TechnicalSettings['mode']})} className="ml-3 rounded border border-slate-700 bg-slate-950 p-2">
     <option value="assembly">Покрокове складання продукту</option><option value="operation">Покрокове використання продукту</option>
    </select>
   </label>
   <label className="mt-3 block text-sm text-slate-300">Завдання та умови<textarea value={data.goal} maxLength={10000} rows={3} onChange={e=>edit({goal:e.target.value})} placeholder="Для кого інструкція, який початковий стан і очікуваний результат?" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"/></label>
   <h2 className="mt-5 text-lg font-bold text-slate-100">2. Джерела та перевірені відомості</h2>
   <WizardSourcesPanel value={sources} onChange={sourceChange} intent="technical" onBeforeLeave={()=>session.flush()} onBusyChange={setSourceBusy}/>
   <p className="mt-3 text-xs text-slate-400">Не підтверджуйте нечіткі розміри чи невідомі параметри. Запишіть, що саме потребує уточнення. Вебрезультати потрібно завантажити й перевірити перед використанням.</p>
   <div className="mt-4 flex flex-wrap gap-4">
    <button type="button" disabled={!data.title.trim()||!sources.some(s=>s.approved&&s.text.trim())||!!view.conflict} onClick={()=>void generate()} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-40">Запропонувати кроки за джерелами</button>
    <button type="button" className="text-sm text-slate-300 underline" onClick={()=>{
     const doc={...createEmptyInstruction(data.mode==='operation'?'usage':'assembly'),title:data.title,modelCode:data.modelCode,description:data.goal,sourceBased:true};
     saveInstructionDraft(doc);setAccepted(doc);
    }}>Відкрити редактор без ШІ</button>
   </div>
   {proposal&&<section className="mt-6 border-t border-slate-700 pt-5">
    <h2 className="text-lg font-bold text-slate-100">3. Пропозиція для перевірки</h2>
    <h3 className="mt-3 font-semibold text-emerald-200">{proposal.title}</h3><p className="mt-2 text-sm text-slate-300">{proposal.description}</p>
    {proposal.questions.length>0&&<div className="mt-3 rounded-lg border border-amber-500/40 p-3 text-sm text-amber-200"><p className="font-semibold">Що потрібно уточнити</p><ul className="mt-2 space-y-1">{proposal.questions.map((q,i)=><li key={i}>{q}</li>)}</ul></div>}
    <ol className="mt-4 space-y-3">{proposal.steps.map((step,i)=><li key={i} className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300">
     <p className="font-semibold text-slate-100">{i+1}. {step.title}{step.needsVerification?' · потребує уточнення':''}</p>
     <p className="mt-2 whitespace-pre-wrap">{step.description}</p>
     <p className="mt-2 text-xs">Деталі: {step.components} · Інструменти: {step.toolsResources}</p>
     {step.warning&&<p className="mt-2 text-amber-200">{step.warning}</p>}
     <p className="mt-2 text-emerald-200">Перевірка: {step.successCriterion}</p>
     <p className="mt-2 text-xs text-cyan-200">Джерела: {step.sourceIds.map(id=>sources.find(s=>s.id===id)?.title??id).join(', ')}</p>
    </li>)}</ol>
    <label className="mt-4 flex items-center gap-2 text-sm text-emerald-200"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> Пропозицію переглянув; перевірю всі кроки в редакторі</label>
    <button type="button" disabled={!reviewed||!!view.conflict} onClick={()=>void accept()} className="mt-3 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-40">Прийняти в редактор інструкції</button>
   </section>}
  </fieldset>
  {busy&&<p role="status" className="mt-3 flex items-center gap-2 text-sm text-emerald-200"><Loader2 size={16} className="animate-spin"/> {working?'Готую пропозицію…':'Зберігаю або завантажую матеріали…'}</p>}
  <p className="mt-3 text-xs text-slate-500">{view.pending?'Зберігаю…':view.dirty?'Є незбережені зміни':'Чернетку збережено'}</p>
 </div>;
};
