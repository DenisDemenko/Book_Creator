import React,{useEffect,useRef,useState} from 'react';
import {EDITION_ROLES,EDITION_ROLE_LABELS,type EditionContext,type EditionCreditInput,type EditionTerms,type EditionView} from '../../../shared/labyrinthEdition';
import {gs,GsError} from '../graphStudio/gsApi';
import {exportBookToDocx,exportBookToEpub} from '../../utils/fileExporters';
import type {Book} from '../../types';

const button='min-h-11 rounded-lg border border-slate-500 px-3 py-2 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-300 disabled:opacity-50';
const field='min-h-11 w-full min-w-0 rounded-lg border border-slate-500 bg-slate-950 p-2 text-slate-100';
type Operation={path:string;body:unknown};
const baseOf=(id:string)=>'/api/core/projects/'+encodeURIComponent(id)+'/labyrinth-editions';
const link=(id:string,tab:string)=>import.meta.env.BASE_URL+'projects/'+encodeURIComponent(id)+'/'+tab;
const publicLink=(id:string)=>import.meta.env.BASE_URL+'api/labyrinth-editions/'+encodeURIComponent(id)+'/read';
const states={pending:'Очікує',approved:'Погоджено',declined:'Відмова',withdrawn:'Відкликано'};

export function EditionReview({bookId,editionId,onChanged}:{bookId:string;editionId:string;onChanged?:()=>void}){
  const [view,setView]=useState<EditionView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [pending,setPending]=useState<Operation|null>(null),[checks,setChecks]=useState<boolean[]>([false,false,false,false,false]);
  const [note,setNote]=useState(''),[comment,setComment]=useState(''),[publishConfirmed,setPublishConfirmed]=useState(false);
  const generation=useRef(0),base=baseOf(bookId)+'/'+encodeURIComponent(editionId);
  const received=(v:EditionView)=>{setView(v);setPending(null);};
  const failed=(e:unknown)=>{
    setError((e as Error).message||'Не вдалося отримати версію.');
    if(e instanceof GsError&&[401,403,404].includes(e.status)){setView(null);setPending(null);setChecks([false,false,false,false,false]);}
  };
  useEffect(()=>{const token=++generation.current;setView(null);setError('');setPending(null);setBusy(true);
    void gs<EditionView>('GET',base).then(v=>{if(token===generation.current)received(v);}).catch(e=>{if(token===generation.current)failed(e);}).finally(()=>{if(token===generation.current)setBusy(false);});
    return()=>{generation.current++;};
  },[base]);
  useEffect(()=>{setChecks([false,false,false,false,false]);setPublishConfirmed(false);setNote('');},[view?.id,view?.snapshotHash,view?.agreements.find(a=>a.mine)?.revision]);
  const reload=async()=>{const token=generation.current;setBusy(true);setError('');try{const v=await gs<EditionView>('GET',base);if(token===generation.current)received(v);}catch(e){if(token===generation.current)failed(e);}finally{if(token===generation.current)setBusy(false);}};
  const perform=async(op:Operation)=>{const token=generation.current;setPending(op);setBusy(true);setError('');try{const v=await gs<EditionView>('POST',op.path,op.body);if(token===generation.current){received(v);onChanged?.();return true;}}catch(e){if(token===generation.current){failed(e);if(e instanceof GsError&&e.status<500){setPending(null);if(e.status===409)await reload();}}}finally{if(token===generation.current)setBusy(false);}return false;};
  const me=view?.agreements.find(a=>a.mine);
  const decide=(decision:'approve'|'decline'|'withdraw')=>{
    if(!view||!me)return;
    void perform({path:base+'/decision',body:{snapshotHash:view.snapshotHash,expectedDecisionRevision:me.revision,decision,note,publicName:me.name,
      reviewed:checks[0],agreeAuthorship:checks[1],agreeLicense:checks[2],agreePublication:checks[3],agreeShares:checks[4],key:crypto.randomUUID()}});
  };
  const download=async(format:string)=>{
    const token=generation.current;setBusy(true);setError('');
    try{
      if(format==='epub'||format==='docx'){
        const book=await gs<Book>('GET',base+'/export/book');if(token!==generation.current)return;
        if(format==='epub')await exportBookToEpub(book);else await exportBookToDocx(book);
      }else{
        const r=await fetch(base+'/export/'+format,{credentials:'same-origin'});
        if(!r.ok){const b=await r.json().catch(()=>({}));throw new GsError(b.error||'Експорт недоступний.',r.status);}
        const blob=await r.blob();if(token!==generation.current)return;
        const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download='Видання-'+view!.version+'.'+format;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    }catch(e){if(token===generation.current)failed(e);}finally{if(token===generation.current)setBusy(false);}
  };
  return <section className="min-w-0 space-y-4 rounded-xl border border-teal-700 bg-slate-900 p-3 text-slate-100 [overflow-wrap:anywhere]" data-edition-review aria-busy={busy}>
    <div className="flex flex-wrap items-center gap-3"><h3 className="text-lg font-bold">Погодження видання</h3><button className={button} onClick={()=>void reload()} disabled={busy} data-edition-refresh>Оновити</button></div>
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Завантаження…</p>}
    {pending&&!busy&&<button className={button} data-edition-retry onClick={()=>void perform(pending)}>Повторити запит</button>}
    {view&&<>
      <p data-edition-status>Версія {view.version} · рукопис r{view.bookRevision} · {view.status==='published'?'Опубліковано':view.status==='withdrawn'?'Відкликано':'На погодженні'}</p>
      {!view.fresh&&view.status==='review'&&<p role="status" className="rounded-lg border border-amber-400 p-2">Рукопис змінився. Потрібна нова версія та повторні погодження.</p>}
      <h4 className="font-bold">Склад і умови цієї версії</h4>
      <ul className="space-y-2">{view.agreements.map(a=><li key={a.id}>{a.name} · {EDITION_ROLE_LABELS[a.role]} · {states[a.status]}{view.commercial?' · '+(a.shareBps/100)+'% доходу':''}</li>)}</ul>
      <p className="whitespace-pre-wrap" data-edition-license>{view.manuscript.licenseText}</p>
      <p>{view.commercial?'Дозволено комерційне розповсюдження. Погоджені частки фіксуються в умовах; виплати здійснюються окремо.':'Безоплатне розповсюдження цієї версії.'}</p>
      <details data-edition-manuscript><summary>Повний текст для погодження</summary>
        <h4 className="font-bold">{view.manuscript.title}</h4>
        {view.manuscript.cover&&<img src={view.manuscript.cover} alt="Обкладинка для погодження" className="max-h-72 max-w-full"/>}
        <p className="whitespace-pre-wrap">{view.manuscript.foreword}</p>
        {view.manuscript.pages.map(p=><article className="my-4 space-y-2" key={p.id}><h5 className="font-bold">{p.title}</h5><p className="whitespace-pre-wrap">{p.text}</p>{p.aiAssisted&&<p className="text-sm">Створено за участю ШІ; текст потребує вашої перевірки.</p>}</article>)}
        <p className="whitespace-pre-wrap">{view.manuscript.acknowledgements}</p>
      </details>
      {view.ownContributions.length>0&&<details data-edition-own-contributions><summary>Мої внески та їхня редакція</summary>{view.ownContributions.map(c=><article key={c.sectionId} className="my-3 space-y-2"><p className="whitespace-pre-wrap">Оригінал: {c.originalText}</p><p className="whitespace-pre-wrap">У рукописі: {c.text}</p></article>)}</details>}
      {me&&<fieldset disabled={busy||!!pending} className="space-y-3 rounded-lg border border-slate-500 p-3">
        <legend>Моє рішення — {me.name}, {EDITION_ROLE_LABELS[me.role]}</legend>
        {view.status==='review'&&me.status!=='approved'&&['Я прочитав текст і перевірив свій внесок','Погоджую публічне ім’я та вказану роль','Погоджую ліцензію й умови використання','Погоджую публікацію повного тексту онлайн та розповсюдження файлів','Погоджую спосіб розповсюдження й зазначені частки'].map((label,i)=><label className="flex min-h-11 items-start gap-3" key={label}>
          <input type="checkbox" checked={checks[i]} data-edition-check={i} onChange={e=>setChecks(c=>c.map((v,j)=>j===i?e.target.checked:v))}/><span>{label}</span>
        </label>)}
        <label className="block">Примітка до мого рішення<textarea className={field} value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} data-edition-note/></label>
        <div className="flex flex-wrap gap-2">
          {view.status==='review'&&me.status!=='approved'&&<button className={button} disabled={!view.fresh||!checks.every(Boolean)} data-edition-approve onClick={()=>decide('approve')}>Погодити цю версію</button>}
          {view.status==='review'&&me.status!=='approved'&&<button className={button} data-edition-decline onClick={()=>decide('decline')}>Відмовитися</button>}
          {me.status==='approved'&&<button className={button} data-edition-withdraw onClick={()=>decide('withdraw')}>Відкликати мою згоду</button>}
        </div>
      </fieldset>}
      <div className="space-y-2" data-edition-export>
        <h4 className="font-bold">Файли погодженої версії</h4>
        <div className="flex flex-wrap gap-2">{['pdf','epub','docx','html','md','json'].map(format=><button key={format} className={button} disabled={busy||!view.ready} data-edition-download={format} onClick={()=>void download(format)}>{format.toUpperCase()}</button>)}</div>
        {!view.ready&&<p>Публікація й фінальний експорт доступні після всіх необхідних погоджень.</p>}
      </div>
      {view.status==='review'&&(view.canManage||view.canPublish)&&<fieldset disabled={busy||!!pending} className="space-y-2 rounded-lg border border-teal-500 p-3">
        <legend>Опублікувати інтерактивне видання</legend>
        <label className="flex min-h-11 gap-3"><input type="checkbox" checked={publishConfirmed} onChange={e=>setPublishConfirmed(e.target.checked)} data-edition-publish-check/><span>Підтверджую відкриття повного погодженого тексту за публічним посиланням.</span></label>
        <button className={button} disabled={!view.canPublish||!publishConfirmed} data-edition-publish onClick={()=>void perform({path:base+'/publish',body:{expectedRevision:view.revision,confirm:true,key:crypto.randomUUID()}})}>Опублікувати</button>
      </fieldset>}
      {view.status==='published'&&view.ready&&<a className="inline-block min-h-11 underline" data-edition-public-link href={publicLink(view.id)} target="_blank" rel="noopener noreferrer">Відкрити опубліковане інтерактивне видання</a>}
      {(view.canManage||view.canEditBook)&&<nav className="flex flex-wrap gap-4"><a className="min-h-11 underline" href={link(bookId,'editor')}>Редактор рукопису</a><a className="min-h-11 underline" href={link(bookId,'collaboration')}>Команда, пропозиції правок та історія внесків</a></nav>}
      {!view.canEditBook&&!view.canManage&&<p className="text-sm">Погодження цієї версії не дає права редагувати рукопис. Потрібну роль у редакційній команді надає письменник.</p>}
      <details><summary>Обговорення цієї версії — для її учасників</summary>
        {view.comments.map(c=><p className="my-2 whitespace-pre-wrap" key={c.id}>{c.name}: {c.text}</p>)}
        <label className="block">Коментар<textarea className={field} value={comment} maxLength={4000} onChange={e=>setComment(e.target.value)} data-edition-comment/></label>
        <button className={button} disabled={busy||!!pending||!comment.trim()} data-edition-comment-send onClick={()=>void perform({path:base+'/comments',body:{text:comment,key:crypto.randomUUID()}}).then(ok=>{if(ok)setComment('');})}>Додати коментар</button>
        <p className="text-sm">Обговорення не потрапляє до експортованої книги.</p>
      </details>
    </>}
  </section>;
}

export function EditionPanel({bookId}:{bookId:string}){
  const [context,setContext]=useState<EditionContext|null>(null),[credits,setCredits]=useState<EditionCreditInput[]>([]),[selected,setSelected]=useState<string[]>([]),[excluded,setExcluded]=useState<string[]>([]);
  const [license,setLicense]=useState<EditionTerms['license']>('all-rights-reserved'),[licenseText,setLicenseText]=useState(''),[commercial,setCommercial]=useState(false);
  const [foreword,setForeword]=useState(''),[acknowledgements,setAcknowledgements]=useState(''),[cover,setCover]=useState<string|null>(null);
  const [editionId,setEditionId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<Operation|null>(null);
  const generation=useRef(0),base=baseOf(bookId);
  const refresh=async(reset=false)=>{const token=generation.current;setBusy(true);setError('');try{const c=await gs<EditionContext>('GET',base+'/context');if(token!==generation.current)return;setContext(c);
    if(reset){setCredits(c.candidates.map(p=>({userId:p.userId,name:p.alias.slice(0,80),role:p.userId===c.ownerId?'author':'coauthor',shareBps:0})));setSelected(c.candidates.filter(p=>p.required).map(p=>p.userId));setExcluded([]);setEditionId(c.editions[0]?.id??'');}
  }catch(e){if(token===generation.current){setError((e as Error).message);if(e instanceof GsError&&[401,403,404].includes(e.status)){setContext(null);setCredits([]);setEditionId('');}}}finally{if(token===generation.current)setBusy(false);}};
  useEffect(()=>{generation.current++;setContext(null);setEditionId('');setPending(null);setLicense('all-rights-reserved');setCommercial(false);setForeword('');setAcknowledgements('');setCover(null);void refresh(true);return()=>{generation.current++;};},[base]);
  const perform=async(op:Operation)=>{const token=generation.current;setPending(op);setBusy(true);setError('');try{const v=await gs<EditionView>('POST',op.path,op.body);if(token===generation.current){setPending(null);setEditionId(v.id);await refresh(false);}}catch(e){if(token===generation.current){setError((e as Error).message);if(e instanceof GsError&&e.status<500){setPending(null);if([401,403,404].includes(e.status)){setContext(null);setCredits([]);setEditionId('');}else if(e.status===409)await refresh(false);}}}finally{if(token===generation.current)setBusy(false);}};
  const patchCredit=(userId:string,patch:Partial<EditionCreditInput>)=>setCredits(c=>c.map(p=>p.userId===userId?{...p,...patch}:p));
  return <section className="min-w-0 space-y-4 rounded-xl border border-teal-600 p-3 text-slate-100 [overflow-wrap:anywhere]" data-edition-panel>
    <h2 className="text-xl font-bold">Видання проходження</h2>
    <p>Збережіть рукопис у редакторі. Для видання підготуйте окрему версію, оберіть склад та умови й отримайте особисті погодження учасників.</p>
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Завантаження…</p>}
    {pending&&!busy&&<button className={button} data-edition-create-retry onClick={()=>void perform(pending)}>Повторити запит</button>}
    {context&&<>
      <button className={button} disabled={busy} onClick={()=>void refresh(false)}>Оновити серверний рукопис r{context.bookRevision}</button>
      <details><summary>Підготувати нову версію видання</summary>
        <fieldset disabled={busy||!!pending} className="space-y-4 py-3">
          <legend>Склад, внески та умови</legend>
          {context.contributions.length>0&&<div className="space-y-2"><h3 className="font-bold">Вилучення внесків</h3>{context.contributions.map(c=><label className="flex min-h-11 items-start gap-3" key={c.id}>
            <input type="checkbox" checked={excluded.includes(c.id)} data-edition-exclude={c.id} onChange={e=>setExcluded(v=>e.target.checked?[...v,c.id]:v.filter(id=>id!==c.id))}/>
            <span>Вилучити внесок {c.alias}{!c.active?' — згода або доступ відсутні':''}<span className="block whitespace-pre-wrap text-sm">{c.text}</span></span>
          </label>)}</div>}
          <div className="space-y-3">{credits.map(c=>{const candidate=context.candidates.find(p=>p.userId===c.userId)!;const required=c.userId===context.ownerId||candidate.reason==='Редакторські правки'||context.contributions.some(v=>v.userId===c.userId&&!excluded.includes(v.id));return <div className="space-y-2 rounded-lg border border-slate-500 p-2" key={c.userId}>
            <label className="flex min-h-11 gap-3"><input type="checkbox" checked={selected.includes(c.userId)} disabled={required} onChange={e=>setSelected(v=>e.target.checked?[...v,c.userId]:v.filter(id=>id!==c.userId))}/><span>{candidate.alias} · {candidate.reason}</span></label>
            {selected.includes(c.userId)&&<div className="grid min-w-0 gap-2 sm:grid-cols-3">
              <label>Публічне ім’я<input className={field} value={c.name} maxLength={80} data-edition-credit-name={c.userId} onChange={e=>patchCredit(c.userId,{name:e.target.value})}/></label>
              <label>Роль<select className={field} value={c.role} disabled={c.userId===context.ownerId} onChange={e=>patchCredit(c.userId,{role:e.target.value as EditionCreditInput['role']})}>{EDITION_ROLES.filter(role=>c.userId===context.ownerId?role==='author':role!=='author').map(role=><option key={role} value={role}>{EDITION_ROLE_LABELS[role]}</option>)}</select></label>
              {commercial&&<label>Частка доходу, %<input className={field} type="number" min={0} max={100} step={0.01} value={c.shareBps/100} onChange={e=>patchCredit(c.userId,{shareBps:Math.round(Number(e.target.value)*100)})}/></label>}
            </div>}
          </div>;})}</div>
          <label className="block">Ліцензія<select className={field} value={license} data-edition-license-select onChange={e=>setLicense(e.target.value as EditionTerms['license'])}><option value="all-rights-reserved">Усі права захищено</option><option value="CC-BY-4.0">Creative Commons BY 4.0</option><option value="custom">Власні умови</option></select></label>
          {license==='custom'&&<label className="block">Текст умов<textarea className={field} value={licenseText} maxLength={8000} onChange={e=>setLicenseText(e.target.value)}/></label>}
          <label className="flex min-h-11 gap-3"><input type="checkbox" checked={commercial} onChange={e=>setCommercial(e.target.checked)} data-edition-commercial/><span>Дозволити продаж; усі учасники мають погодити розподіл 100% доходу.</span></label>
          <label className="block">Передмова «Як створено цю історію»<textarea className={field} value={foreword} maxLength={8000} data-edition-foreword onChange={e=>setForeword(e.target.value)}/></label>
          <label className="block">Подяки<textarea className={field} value={acknowledgements} maxLength={4000} onChange={e=>setAcknowledgements(e.target.value)}/></label>
          <label className="block">Обкладинка PNG/JPEG до 2 МБ<input className={field} type="file" accept="image/png,image/jpeg" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>2*1024*1024){setError('Обкладинка завелика.');return;}const token=generation.current,reader=new FileReader();reader.onload=()=>{if(token===generation.current)setCover(String(reader.result));};reader.readAsDataURL(file);}}/></label>
          {cover&&<><img src={cover} alt="Вибрана обкладинка" className="max-h-48 max-w-full"/><button className={button} onClick={()=>setCover(null)}>Прибрати обкладинку</button></>}
          <button className={button} data-edition-create onClick={()=>void perform({path:base,body:{expectedBookRevision:context.bookRevision,terms:{license,licenseText,commercial,credits:credits.filter(c=>selected.includes(c.userId)).map(c=>({...c,shareBps:commercial?c.shareBps:0})),excludeContributionIds:excluded,foreword,acknowledgements,cover},key:crypto.randomUUID()}})}>Створити версію для погодження</button>
          <p className="text-sm">Зміна тексту, складу чи умов потребує нової версії. Попередні згоди до неї не переносяться.</p>
        </fieldset>
      </details>
      <label className="block">Версії видання<select className={field} value={editionId} onChange={e=>setEditionId(e.target.value)} data-edition-version><option value="">Оберіть версію</option>{context.editions.map(e=><option key={e.id} value={e.id}>v{e.version} · {e.title} · {e.status==='published'?'Опубліковано':e.status==='withdrawn'?'Відкликано':'Погодження'}</option>)}</select></label>
    </>}
    {editionId&&<EditionReview key={editionId} bookId={bookId} editionId={editionId} onChanged={()=>void refresh(false)}/>}
  </section>;
}

export function EditionInbox({projectId}:{projectId:string}){
  const [editions,setEditions]=useState<Array<{id:string;bookId:string;version:number;title:string;status:string}>>([]),[selected,setSelected]=useState('');
  const [error,setError]=useState('');const generation=useRef(0),base='/api/core/projects/'+encodeURIComponent(projectId)+'/labyrinth/reader/book-editions';
  const reload=async()=>{const token=generation.current;setError('');try{const v=await gs<{editions:typeof editions}>('GET',base);if(token===generation.current)setEditions(v.editions);}catch(e){if(token===generation.current){setEditions([]);setSelected('');if(!(e instanceof GsError&&[401,403,404].includes(e.status)))setError((e as Error).message);}}};
  useEffect(()=>{generation.current++;setEditions([]);setSelected('');void reload();return()=>{generation.current++;};},[base]);
  const current=editions.find(e=>e.id===selected);
  return <section className="space-y-3 rounded-xl border border-slate-500 p-3" data-edition-inbox>
    <h3 className="font-bold">Мої погодження видань</h3><button className={button} data-edition-inbox-refresh onClick={()=>void reload()}>Оновити запрошення</button>
    {error&&<p role="status">{error}</p>}
    {!editions.length&&<p>Автор ще не надіслав вам версію для погодження.</p>}
    {editions.map(e=><button className={button+' mr-2'} key={e.id} onClick={()=>setSelected(e.id)} data-edition-inbox-open={e.id}>v{e.version} · {e.title}</button>)}
    {current&&<EditionReview key={current.id} bookId={current.bookId} editionId={current.id} onChanged={()=>void reload()}/>}
  </section>;
}
