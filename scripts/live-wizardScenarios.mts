/** Full Studio App/CSS probe; provider and public web use declared fixtures. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {wizardHarness} from './lib/wizardHarness.mts';
import {buildStarterBook} from '../src/utils/starterBook';
import type {Page} from 'puppeteer-core';
const h=await wizardHarness(),artifact='/tmp/wizard-scenarios-ui';
await fs.mkdir(artifact,{recursive:true});
const book=buildStarterBook({bookId:'wizard-ui-book',role:'writer',title:'Авторська майстерня',author:'Автор тесту',now:0});
h.app.get('/api/auth/me',(_q,r)=>r.json({user:{id:'writer',email:'writer@example.test',name:'Автор тесту',role:'writer',disabled:false,isGuest:false},permissions:{canPublish:true,canEditContent:true,canUseAi:true},firebaseEnabled:false}));
h.app.get('/api/core/onboarding/gate',(_q,r)=>r.json({enabled:false,required:false,sharedCourses:[]}));
h.app.get('/api/core/projects/:id/my-role',(q,r)=>r.json({projectId:q.params.id,projectType:'book',isOwner:true,isAdmin:false,selfAssign:false,participant:null,roles:[],workspaces:[],activeWorkspace:null,aiAssistance:[],roleDetails:{},pending:{role:null,access:null}}));
h.app.use('/api',(_q,r)=>r.status(404).json({error:'API outside this isolated wizard probe'}));
process.env.DISABLE_HMR='true';
const {createServer}=await import('vite');
const vite=await createServer({base:'/studio/',server:{middlewareMode:{server:h.server},hmr:{server:h.server}},define:{'import.meta.env.VITE_FIREBASE_API_KEY':JSON.stringify('visual-test-public-configuration'),'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN':JSON.stringify('localhost'),'import.meta.env.VITE_FIREBASE_PROJECT_ID':JSON.stringify('visual-fixture')}});
h.app.use(vite.middlewares);
const {launch}=await import('puppeteer-core');
const browser=await launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,protocolTimeout:90000,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors:string[]=[],checks:string[]=[],shots:any[]=[];
async function check(name:string,ok:unknown){assert.ok(ok,name);checks.push(name);console.log('✓ '+name);}
async function make(width:number,theme='dark',wizard='technical_instruction'){
 const ctx=await browser.createBrowserContext(),p=await ctx.newPage();await p.setViewport({width,height:1000});await p.setExtraHTTPHeaders({'x-test-user':'writer'});
 p.on('pageerror',e=>errors.push(String(e)));await p.setRequestInterception(true);
 p.on('request',r=>{const u=new URL(r.url());if(u.origin===h.origin||u.protocol==='data:'||u.protocol==='blob:')void r.continue();else void r.abort();});
 await p.evaluateOnNewDocument((b,t)=>{localStorage.setItem('nova_glass_book',JSON.stringify(b));localStorage.setItem('nova_glass_user_role','writer');localStorage.setItem('nova_theme',t);localStorage.setItem('nova_guest_dismissed_login','1');},book,theme);
 await p.goto(h.origin+'/studio/?open=express&wizard='+wizard,{waitUntil:'domcontentloaded'});
 await p.waitForSelector(wizard==='book'?'[data-book-wizard]':'[data-technical-wizard]',{timeout:90000});
 return p;
}
async function click(p:Page,text:string,root=''){
 await p.waitForFunction((t,r)=>Array.from(document.querySelectorAll(r?r+' button':'button')).some(e=>e.textContent?.trim()===t&&!e.matches(':disabled')),{},text,root);
 const buttons=await p.$$(root?root+' button':'button');for(const b of buttons)if(await b.evaluate(e=>e.textContent?.trim())===text&&!await b.evaluate(e=>e.matches(':disabled'))){await b.click();return;}throw new Error('Button missing: '+text);
}
async function fill(p:Page,selector:string,text:string){
 await p.waitForFunction(s=>{const el=document.querySelector(s);return el&&!el.matches(':disabled');},{},selector);
 await p.focus(selector);await p.keyboard.down('Control');await p.keyboard.press('A');await p.keyboard.up('Control');await p.type(selector,text);
}
async function labelClick(p:Page,text:string){
 await p.waitForFunction(t=>Array.from(document.querySelectorAll('label')).some(e=>e.textContent?.includes(t)&&!!e.querySelector('input[type=checkbox]:not(:disabled)')),{},text);
 const labels=await p.$$('label');for(const l of labels)if(await l.evaluate((e,t)=>e.textContent?.includes(t),text)){const c=await l.$('input[type=checkbox]');if(c){await c.click();return;}}
 throw new Error('Checkbox missing: '+text);
}
async function capture(p:Page,name:string){
 await p.evaluate(async()=>{window.scrollTo(0,0);await document.fonts.ready;});
 const facts=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,shell:!!document.querySelector('.app-shell-root'),header:!!document.querySelector('.app-shell-root header'),backdrop:!!document.querySelector('.studio-backdrop')}));
 assert.ok(facts.shell&&facts.header&&facts.backdrop,'real site design must be mounted');assert.ok(facts.scroll<=facts.width+1,'horizontal overflow '+JSON.stringify(facts));
 await p.screenshot({path:path.join(artifact,name+'.png'),fullPage:true});shots.push({name,...facts});
}
try{
 const p=await make(390);
 await fill(p,'[name=technical-title]','T-42');await fill(p,'[name=technical-model]','rev.1');
 const txt=path.join(h.dir,'T-42.txt');await fs.writeFile(txt,('Fit panel A into bracket B. Verify both clips are engaged.\n').repeat(1300));
 const file=await p.$('[data-technical-wizard] input[type=file][multiple]');const {PDFDocument,StandardFonts}=await import('pdf-lib');
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 pdf.addPage().drawText('T-42: Fit panel A into bracket B. Check both clips.',{x:50,y:700,size:12,font});
 const pdfPath=path.join(h.dir,'T-42.pdf');await fs.writeFile(pdfPath,await pdf.save());
 const {Document,Paragraph,Packer}=await import('docx');
 const docxPath=path.join(h.dir,'T-42.docx');await fs.writeFile(docxPath,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('T-42: Fit panel A into bracket B. Check both clips.')]}]})));
 await file!.uploadFile(txt,pdfPath,docxPath);
 await p.waitForSelector('textarea[aria-label="Текст джерела T-42.txt"]');
 await p.waitForSelector('textarea[aria-label="Текст джерела T-42.pdf"]');
 await p.waitForSelector('textarea[aria-label="Текст джерела T-42.docx"]');
 await check('TXT, PDF and DOCX text extracted without AI',h.state.calls.length===0&&await p.$$eval('article textarea',nodes=>nodes.length===3&&nodes.every(e=>(e as HTMLTextAreaElement).value.includes('panel A'))));
 await check('unapproved sources disable generation',await p.$eval('[data-technical-wizard]',e=>Array.from(e.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Запропонувати кроки за джерелами')!.matches(':disabled')));
 await labelClick(p,'Текст перевірено; дозволяю');
 await fill(p,'[aria-label="Запит пошуку документації"]','T-42');await click(p,'Шукати','[data-technical-wizard]');
 await p.waitForSelector('a[href="https://manufacturer.example/t42"]');await click(p,'Імпортувати для перевірки','[data-technical-wizard]');
 await p.waitForSelector('textarea[aria-label="Текст джерела T-42 manual"]');
 await check('technical web search and import need separate approval',await p.$eval('textarea[aria-label="Текст джерела T-42 manual"]',e=>!(e.closest('article')!.querySelector('input[type=checkbox]') as HTMLInputElement).checked));
 await click(p,'Запропонувати кроки за джерелами','[data-technical-wizard]');
 await p.waitForFunction(()=>document.querySelector('[data-technical-wizard]')?.textContent?.includes('3. Пропозиція для перевірки'));
 const technicalId=await p.evaluate(()=>localStorage.getItem('nova_technical_instruction_draft'));
 await check('source above 64 KiB reaches real SQLite intact',(h.store.getDraft(technicalId!)!.payload.sourceMaterials?.[0].text.length??0)>65536);
 await check('technical proposal retains unresolved questions and citation',await p.$eval('[data-technical-wizard]',e=>e.textContent!.includes('T-42.txt')&&e.textContent!.includes('допустиме навантаження')));
 await capture(p,'technical-mobile-dark');await labelClick(p,'Пропозицію переглянув');await click(p,'Прийняти в редактор інструкції');
 await p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()==='Створити книгу'));
 await check('unverified instruction blocks book creation',await p.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Створити книгу')!.matches(':disabled')));
 await p.click('[data-instruction-section=steps]');await labelClick(p,'Параметри й послідовність цього кроку');
 await fill(p,'textarea[placeholder="Опишіть дію точно й однозначно."]','Fit panel A into bracket B. Check clips before use.');
 await check('editing a verified step requires renewed review',await p.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Створити книгу')!.matches(':disabled')));
 await labelClick(p,'Параметри й послідовність цього кроку');
 await check('reviewed technical step enables book creation',await p.evaluate(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Створити книгу')!.matches(':disabled')));
 const aiBefore=h.state.calls.length;await click(p,'Створити книгу');
 await p.waitForFunction(()=>!document.querySelector('[data-technical-wizard]')&&document.body.textContent?.includes('Інструкція T-42'),{timeout:30000});
 await check('instruction to book skips extra AI',h.state.calls.length===aiBefore);
 await p.close();
 const b=await make(1440,'dark','book');
 await b.click('[data-wizard-scenario=characters_photos]');await fill(b,'[name=wizard-seed]','Марта захищає стару майстерню від несправедливого продажу.');
 await click(b,'Почати','[data-book-wizard]');await b.waitForSelector('[data-wizard-world]');await click(b,'Далі','[data-book-wizard]');await b.waitForSelector('[data-story-model=psychotypes]');await click(b,'Далі','[data-book-wizard]');
 await click(b,'Додати свого героя','[data-book-wizard]');
 await fill(b,'input[aria-label="Ім’я героя"]','Марта');await fill(b,'input[aria-label="Прізвище героя"]','Лісова');
 const photoPath=path.join(h.dir,'reference.png');await fs.writeFile(photoPath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8WQAAAAASUVORK5CYII=','base64'));
 const upload=await b.$('[data-book-wizard] input[type=file][multiple]');await upload!.uploadFile(photoPath);
 await b.waitForSelector('select option[value=fixture-vision]');
 await check('photo upload does not trigger hidden AI',h.state.descriptions===0);
 const selects=await b.$$('select');for(const s of selects)if(await s.$('option[value=fixture-vision]'))await s.select('fixture-vision');
 await click(b,'Запропонувати опис видимого','[data-book-wizard]');
 await b.waitForFunction(()=>((document.querySelector('textarea[aria-label="Текст джерела reference.png"]') as HTMLTextAreaElement)?.value??'').includes('зелений плащ'));
 await check('photo analysis is explicit and unapproved',h.state.descriptions===1);
 await labelClick(b,'Текст перевірено; дозволяю');
 const heroSelect=await b.$$('select');for(const s of heroSelect)if(await s.evaluate(e=>e.parentElement?.textContent?.startsWith('Герой:')))await s.evaluate(e=>{const s=e as HTMLSelectElement;s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}));});
 await click(b,'Прийняти як опис зовнішності','[data-book-wizard]');await labelClick(b,'Опис героя перевірено');
 await capture(b,'characters-photo-desktop-dark');await click(b,'Далі','[data-book-wizard]');
 await b.waitForSelector('[name=wizard-synopsis]');await click(b,'Створити синопсис із цих даних','[data-book-wizard]');
 await b.waitForFunction(()=>!!(document.querySelector('[name=wizard-synopsis]') as HTMLTextAreaElement)?.value);
 await click(b,'Запропонувати загальний план','[data-book-wizard]');
 await b.waitForFunction(()=>!!(document.querySelector('[name=wizard-composition]') as HTMLTextAreaElement)?.value);
 await labelClick(b,'Перевірив джерела');await click(b,'Далі','[data-book-wizard]');
 await b.waitForFunction(()=>document.querySelectorAll('[data-book-wizard] details input').length===3,{timeout:30000});
 await fill(b,'[data-book-wizard] details:first-of-type textarea','Марта приймає рішення зберегти майстерню. Автор уточнив наслідки цього рішення.');
 await labelClick(b,'Структуру та зміст глав перевірено');await capture(b,'book-structure-desktop-dark');
 await click(b,'Почати писати','[data-book-wizard]');await b.waitForFunction(()=>!document.querySelector('[data-book-wizard]'),{timeout:30000});
 await click(b,'Зберегти');
 await b.waitForFunction(async()=>{const s=await import(location.origin+'/studio/src/utils/storage.ts');return (await s.loadBook())?.characters?.[0]?.name==='Марта';});
 const stored=await b.evaluate(async()=>{const s=await import(location.origin+'/studio/src/utils/storage.ts');return await s.loadBook();});
 await check('book handoff preserves reviewed name and photo description',stored.characters?.[0]?.name==='Марта'&&stored.characters[0].appearance?.distinguishingMarks?.includes('зелений плащ'));
 await check('editing an AI chapter keeps its origin',stored.chapters[0].sections[0].content.includes('[AI-DRAFT]')&&stored.chapters[0].sections[0].content.includes('Автор уточнив'));
 await check('book handoff contains deterministic semantic tags',stored.chapters?.[0]?.sections?.[0]?.content?.includes('[/character:Марта Лісова]'));
 await b.close();
 const light=await make(1440,'light');await capture(light,'technical-desktop-light');await light.close();
 await check('browser has no JavaScript errors',errors.length===0);
 await fs.writeFile(path.join(artifact,'report.json'),JSON.stringify({mode:'Real App + CSS + SQLite/routes/media; identity, provider and public web fixtures',productionAcceptance:false,checks,shots,errors},null,2));
 console.log('Підсумок: '+checks.length+' перевірок; '+shots.length+' екрани.');
}catch(e){console.error('Browser errors',errors);const pages=await browser.pages();for(let i=0;i<pages.length;i++){try{await pages[i].screenshot({path:path.join(artifact,'failure-'+i+'.png'),fullPage:true});console.error((await pages[i].evaluate(()=>document.body.innerText)).slice(-5000));}catch{}}throw e;
}finally{await browser.close();await vite.close();await h.close();}
