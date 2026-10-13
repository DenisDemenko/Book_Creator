/** Full App visual probe. Test identities are supplied only by the isolated API harness. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Express} from 'express';
import type {Server} from 'node:http';
import type {Page} from 'puppeteer-core';
import type {EditionTerms} from '../shared/labyrinthEdition';
import {getBook} from '../server/bookStore';
import {buildStarterBook} from '../src/utils/starterBook';

export async function liveEditionStudio({app,server,origin,project,bookId,terms}:{app:Express;server:Server;origin:string;project:string;bookId:string;terms:EditionTerms}){
  const phase=process.env.EDITION_DESIGN_PHASE==='before'?'before':'after',artifact=path.join('/tmp/t99-design',phase);
  await fs.mkdir(artifact,{recursive:true});
  const api=async(url:string,body?:unknown,user='owner')=>{
    const r=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-test-user':user},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data as any;
  };
  const base='/api/core/projects/'+bookId+'/labyrinth-editions',stored=(await getBook(bookId))!;
  let edition=await api(base,{expectedBookRevision:stored.revision,terms,key:crypto.randomUUID()});
  for(const credit of terms.credits){const v=await api(base+'/'+edition.id,undefined,credit.userId),mine=v.agreements.find((a:any)=>a.mine);
    await api(base+'/'+edition.id+'/decision',{snapshotHash:v.snapshotHash,expectedDecisionRevision:mine.revision,decision:'approve',note:'',publicName:mine.name,reviewed:true,agreeAuthorship:true,agreeLicense:true,agreePublication:true,agreeShares:true,key:crypto.randomUUID()},credit.userId);
  }
  edition=await api(base+'/'+edition.id);
  await api(base+'/'+edition.id+'/publish',{expectedRevision:edition.revision,confirm:true,key:crypto.randomUUID()});
  app.get('/api/auth/me',(q,r)=>{const id=q.principal?.id;r.json({user:{id,email:(id??'guest')+'@example.test',name:id==='owner'?'Тестовий письменник':'Тестовий співавтор',role:'writer',disabled:false,isGuest:!id},permissions:{canPublish:true,canEditContent:true,canUseAi:false},firebaseEnabled:false});});
  app.get('/api/core/onboarding/gate',(_q,r)=>r.json({enabled:false,required:false,sharedCourses:[]}));
  app.get('/api/core/projects/:id/my-role',(q,r)=>r.json({projectId:q.params.id,projectType:'book',isOwner:q.principal?.id==='owner',isAdmin:false,selfAssign:false,participant:null,roles:[],workspaces:[],activeWorkspace:null,aiAssistance:[],roleDetails:{},pending:{role:null,access:null}}));
  app.get('/api/books/:id',async(q,r)=>{const b=await getBook(String(q.params.id));if(!b){r.status(404).json({error:'Книгу не знайдено.'});return;}if(q.principal?.id!==b.ownerId){r.status(403).json({error:'Приватна копія книги доступна власнику.'});return;}r.json(b);});
  // Unrelated product APIs remain outside this visual probe; edition and reader APIs above are real.
  app.use('/api',(q,r)=>r.status(404).json({error:'Цей API не входить у тестовий прогін.'}));
  const {createServer}=await import('vite');
  const vite=await createServer({base:'/studio/',server:{middlewareMode:{server},hmr:{server}},define:{'import.meta.env.VITE_FIREBASE_API_KEY':JSON.stringify('visual-test-public-configuration'),'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN':JSON.stringify('localhost'),'import.meta.env.VITE_FIREBASE_PROJECT_ID':JSON.stringify('visual-fixture')}});
  app.use(vite.middlewares);
  const {launch}=await import('puppeteer-core');
  const browser=await launch({executablePath:'/usr/bin/chromium',headless:true,protocolTimeout:90000,args:['--no-sandbox','--disable-dev-shm-usage']});
  const errors:string[]=[],results:any[]=[];
  const make=async(user:string,theme:string,width:number,book:any)=>{
    const ctx=await browser.createBrowserContext(),p=await ctx.newPage();
    await p.setExtraHTTPHeaders({'x-test-user':user});await p.setViewport({width,height:1000});p.on('pageerror',e=>errors.push(e instanceof Error?e.message:String(e)));
    await p.setRequestInterception(true);p.on('request',r=>{const u=new URL(r.url());if(u.protocol==='data:'||u.origin===origin)void r.continue();else void r.abort();});
    await p.evaluateOnNewDocument((b:any,t:string)=>{localStorage.setItem('nova_glass_book',JSON.stringify(b));localStorage.setItem('nova_glass_user_role','writer');localStorage.setItem('nova_theme',t);localStorage.setItem('nova_guest_dismissed_login','1');},book,theme);
    return p;
  };
  const capture=async(p:Page,name:string,kind:string)=>{
    await p.evaluate(async()=>{await document.fonts.ready;const images=[...document.images];await Promise.all(images.map(i=>i.complete?Promise.resolve():new Promise<void>(r=>{i.addEventListener('load',()=>r(),{once:true});i.addEventListener('error',()=>r(),{once:true});})));});
    const facts=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,shell:!!document.querySelector('.app-shell-root'),header:!!document.querySelector('.app-shell-root header'),background:!!document.querySelector('.studio-backdrop'),panel:!!document.querySelector('[data-edition-review]'),body:getComputedStyle(document.body).fontFamily,titleWidths:[...document.querySelectorAll('.ed-header>div')].map(e=>e.getBoundingClientRect().width)}));
    assert.ok(facts.scroll<=facts.width+1,name+' must fit its viewport');if(kind==='studio'){assert.ok(facts.shell);assert.ok(facts.header);assert.ok(facts.background);if(phase==='after')assert.ok(facts.titleWidths.every(w=>w>=100),name+' headings must have readable width');}
    const file=path.join(artifact,name+'.png');await p.screenshot({path:file,fullPage:false});results.push({name,kind,...facts,file});console.log('✓ FULL APP '+name);
  };
  try{
    for(const theme of ['dark','light'])for(const width of [1440,390]){
      const owner=await make('owner',theme,width,stored.book);await owner.goto(origin+'/studio/projects/'+bookId+'/publishing',{waitUntil:'domcontentloaded'});
      await owner.waitForSelector('[data-edition-license]',{timeout:90000});
      await owner.waitForSelector('[data-edition-review][aria-busy="false"]',{timeout:90000});
      await capture(owner,'studio-owner-'+theme+'-'+width,'studio');await owner.close();
    }
    const readerBook=buildStarterBook({bookId:project,role:'writer',title:'Авторський лабіринт',author:'Автор',now:0});
    const reader=await make('reader','dark',1440,readerBook);await reader.goto(origin+'/studio/projects/'+project+'/labyrinth-reader',{waitUntil:'domcontentloaded'});
    await reader.waitForSelector('[data-edition-inbox-open="'+edition.id+'"]',{timeout:90000});
    const open=await reader.$('[data-edition-inbox-open="'+edition.id+'"]');await open!.click();await reader.waitForSelector('[data-edition-license]');await reader.waitForSelector('[data-edition-review][aria-busy="false"]');
    await reader.$eval('[data-edition-review]',e=>e.scrollIntoView({block:'center'}));await capture(reader,'studio-coauthor-dark-1440','studio');await reader.close();
    if(phase==='after'){
      const pending=await api(base,{expectedBookRevision:stored.revision,terms,key:crypto.randomUUID()});
      for(const width of [1440,390]){
        const p=await make('owner','dark',width,stored.book);await p.goto(origin+'/studio/projects/'+bookId+'/publishing',{waitUntil:'domcontentloaded'});
        await p.waitForSelector('[data-edition-check="0"]',{timeout:90000});await p.waitForSelector('[data-edition-review][aria-busy="false"]');
        await p.$eval('[data-edition-check="0"]',e=>e.closest('fieldset')!.scrollIntoView({block:'center'}));
        assert.ok(await p.$eval('[data-edition-approve]',e=>e.matches(':disabled')));
        await capture(p,'studio-pending-dark-'+width,'studio');await p.close();
      }
      const p=await make('reader','dark',390,readerBook);await p.goto(origin+'/studio/projects/'+project+'/labyrinth-reader',{waitUntil:'domcontentloaded'});
      await p.waitForSelector('[data-edition-inbox-open="'+pending.id+'"]',{timeout:90000});await p.click('[data-edition-inbox-open="'+pending.id+'"]');
      await p.waitForSelector('[data-edition-check="0"]',{timeout:90000});
      await p.waitForSelector('[data-edition-review][aria-busy="false"]');await p.$eval('[data-edition-check="0"]',e=>e.closest('fieldset')!.scrollIntoView({block:'center'}));
      await capture(p,'studio-coauthor-pending-dark-390','studio');
      for(let i=0;i<5;i++){await p.focus('[data-edition-check="'+i+'"]');await p.keyboard.press('Space');}
      const saved=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/decision'));
      await p.focus('[data-edition-approve]');await p.keyboard.press('Enter');const response=await saved;assert.ok(response.ok(),await response.text());await p.close();
    }
    for(const width of [1440,390]){
      const p=await make('guest','dark',width,{});await p.goto(origin+'/studio/api/labyrinth-editions/'+edition.id+'/read');await p.waitForSelector('#scene-text');
      await capture(p,'reader-dark-'+width,'public');
      if(phase==='after'){
        assert.ok(await p.$('[data-reader-brand]'));await p.focus('#next');await p.keyboard.press('Enter');assert.ok(await p.$eval('#scene-title',e=>e===document.activeElement));
        await p.click('[data-reader-theme]');await p.waitForFunction(()=>document.documentElement.dataset.theme==='light');await capture(p,'reader-light-'+width,'public');
        await p.emulateMediaType('print');assert.equal(await p.$eval('.reader-header',e=>getComputedStyle(e).display),'none');assert.equal(await p.$eval('.linear',e=>getComputedStyle(e).display),'block');
        assert.ok(await p.$eval('.print-credits',e=>getComputedStyle(e).display!=='none'&&!!e.textContent?.includes('Псевдонім один')));
      }
      await p.close();
    }
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(artifact,'report.json'),JSON.stringify({phase,mode:'real App.tsx + local identity/peripheral fixtures + real PostgreSQL edition/reader APIs',externalRequests:'blocked; declared site fonts use local fallback',productionAcceptance:false,results,errors},null,2));
    console.log('Підсумок: '+results.length+' повних екранів збережено; JavaScript errors: 0.');
  }finally{await browser.close();await vite.close();}
}
