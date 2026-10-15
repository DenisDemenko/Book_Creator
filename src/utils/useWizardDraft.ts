import {useEffect,useRef,useState} from 'react';
import {WizardDraftSession,WizardApiError,wizardApi,type WizardDraft} from './expressDraftSession';
import {registerNavigationGuard} from './navigationGuard';
export function useWizardDraft<P extends object>(key:string,track:string,initial:P){
 const [session]=useState(()=>{
  let storage:Storage|undefined;try{storage=sessionStorage;}catch{}
  return new WizardDraftSession<P>(initial,wizardApi,storage);
 });
 const [view,setView]=useState(session.view);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState<string|null>(null);
 const request=useRef<Promise<WizardDraft<P>>|null>(null);
 useEffect(()=>session.subscribe(()=>setView(session.view)),[session]);
 useEffect(()=>{
  let active=true;
  request.current??=(async()=>{
   let id:string|null=null;try{id=localStorage.getItem(key);}catch{}
   if(id){
    session.recover(id);setView(session.view);
    try{return await wizardApi<WizardDraft<P>>('/api/express/draft/'+id);}
    catch(e){if(!(e instanceof WizardApiError)||e.status!==404)throw e;}
   }
   const draft=await wizardApi<WizardDraft<P>>('/api/express/draft',{method:'POST',body:JSON.stringify({track,payload:initial})});
   try{localStorage.setItem(key,draft.id);}catch{}
   return draft;
  })();
  void request.current.then(d=>{if(active){session.open(d);setView(session.view);}}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[session,key,track]);
 useEffect(()=>{
  if(!view.draft||!view.dirty||view.conflict)return;
  const timer=setTimeout(()=>void session.flush().catch(()=>undefined),600);
  return()=>clearTimeout(timer);
 },[view.payload,view.dirty,view.conflict,view.draft?.id,session]);
 useEffect(()=>{
  const unregister=registerNavigationGuard(()=>session.flush());
  const guard=(e:BeforeUnloadEvent)=>{if(session.view.dirty||session.view.pending){e.preventDefault();e.returnValue='';}};
  const hidden=()=>{if(document.visibilityState==='hidden'&&session.view.dirty)void session.flush().catch(()=>undefined);};
  window.addEventListener('beforeunload',guard);document.addEventListener('visibilitychange',hidden);
  return()=>{unregister();window.removeEventListener('beforeunload',guard);document.removeEventListener('visibilitychange',hidden);void session.flush().catch(()=>undefined);};
 },[session]);
 return {session,view,loading,error,setError};
}
