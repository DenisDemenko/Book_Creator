import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Express} from 'express';
import type {Page} from 'puppeteer-core';
import JSZip from 'jszip';
export async function liveLabyrinthEdition({app,origin,project,bookId}:{app:Express;origin:string;project:string;bookId:string}){
  const {build}=await import('esbuild');
  const built=await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:
    "import React from 'react';import{createRoot}from'react-dom/client';import{EditionPanel,EditionInbox}from'./src/components/labyrinth/EditionPanel';"+
    "createRoot(document.getElementById('root')).render(<main style={{maxWidth:1000,margin:'auto',padding:12}}>{location.pathname.endsWith('/inbox')?<EditionInbox projectId="+JSON.stringify(project)+"/>:<EditionPanel bookId="+JSON.stringify(bookId)+"/>}</main>);"},
    bundle:true,write:false,platform:'browser',format:'esm',outdir:'/tmp/t99-probe',define:{'import.meta.env':JSON.stringify({BASE_URL:'/'})}});
  const js=built.outputFiles.find(f=>f.path.endsWith('.js'))!.text;
  for(const marker of ['PRIVATE_SOURCE_NOTE','PRIVATE_PLAYER_CHAT','PRIVATE_ONE','UNVISITED_SECRET'])assert.ok(!js.includes(marker));
  const css=(await fs.readdir('dist/assets')).find(f=>/^index-.*\.css$/.test(f));assert.ok(css);
  app.get('/t99-probe.js',(_q,r)=>r.type('js').send(js));
  app.get('/t99-probe.css',(_q,r)=>void fs.readFile(path.join('dist/assets',css),'utf8').then(v=>r.type('css').send(v)));
  const html='<!doctype html><html lang="uk"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/t99-probe.css"><body style="margin:0;background:#0f172a;color:#f1f5f9"><div id="root"></div><script type="module" src="/t99-probe.js"></script></body></html>';
  app.get('/t99-author',(_q,r)=>r.send(html));app.get('/t99/inbox',(_q,r)=>r.send(html));
  const {launch}=await import('puppeteer-core');
  const browser=await launch({executablePath:'/usr/bin/chromium',headless:true,protocolTimeout:30000,args:['--no-sandbox','--disable-dev-shm-usage']});
  let passed=0;const errors:string[]=[];const check=(name:string)=>{passed++;console.log('✓ ВИДАННЯ/БРАУЗЕР: '+name);};
  const make=async(user:string)=>{const context=await browser.createBrowserContext(),p=await context.newPage();await p.setExtraHTTPHeaders({'x-test-user':user});await p.setViewport({width:1280,height:1000});p.on('pageerror',e=>errors.push(String(e)));return p;};
  const wait=(p:Page,fn:any,...args:any[])=>p.waitForFunction(fn,{polling:100,timeout:15000},...args);
  const ready=(p:Page)=>wait(p,()=>document.querySelector('[data-edition-review]')?.getAttribute('aria-busy')==='false');
  const press=async(p:Page,selector:string,suffix:string)=>{const response=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(suffix),{timeout:15000});await p.focus(selector);await p.keyboard.press('Enter');const r=await response;assert.ok(r.ok(),await r.text());return r.json();};
  const checks=async(p:Page)=>{for(let i=0;i<5;i++){await p.focus('[data-edition-check="'+i+'"]');await p.keyboard.press('Space');}};
  try{
    const guest=await make('guest');await guest.goto(origin+'/t99-author');await wait(guest,()=>!!document.querySelector('[role="alert"]'));assert.equal(await guest.$('[data-edition-create]'),null);check('Гість не отримує рукопис або авторські налаштування');
    const owner=await make('owner');await owner.goto(origin+'/t99-author');await wait(owner,()=>!!document.querySelector('[data-edition-create]'));
    await owner.click('[data-edition-panel] > details > summary');
    let lost=false,createdId='';await owner.setRequestInterception(true);
    owner.on('request',r=>{if(!lost&&r.method()==='POST'&&r.url().endsWith('/labyrinth-editions')){lost=true;void fetch(r.url(),{method:'POST',headers:{'content-type':'application/json','x-test-user':'owner'},body:r.postData()}).then(async out=>{assert.ok(out.ok);createdId=(await out.json() as any).id;await r.abort('failed');}).catch(e=>{errors.push(String(e));void r.abort('failed');});}else void r.continue();});
    await owner.click('[data-edition-create]');await wait(owner,()=>!!document.querySelector('[data-edition-create-retry]'));
    const created=await press(owner,'[data-edition-create-retry]','/labyrinth-editions');assert.equal(created.id,createdId);await ready(owner);check('Реальна форма й повтор після втрати відповіді створюють одну версію');
    assert.equal(await owner.$eval('[data-edition-approve]',e=>e.matches(':disabled')),true);
    assert.equal(await owner.$eval('[data-edition-download="pdf"]',e=>e.matches(':disabled')),true);
    check('Фінальний експорт і погодження заблоковані без особистих підтверджень');
    await checks(owner);await press(owner,'[data-edition-approve]','/decision');await ready(owner);assert.equal(await owner.$eval('[data-edition-publish]',e=>e.matches(':disabled')),true);check('Одне авторське погодження не замінює рішення співавтора');
    const reader=await make('reader');await reader.goto(origin+'/t99/inbox');await wait(reader,(id:string)=>!!document.querySelector('[data-edition-inbox-open="'+id+'"]'),created.id);
    await reader.click('[data-edition-inbox-open="'+created.id+'"]');await ready(reader);await reader.click('[data-edition-own-contributions] > summary');
    assert.ok((await reader.$eval('[data-edition-own-contributions]',e=>e.textContent??'')).includes('Погоджений літературний внесок.'));
    for(const secret of ['PRIVATE_PLAYER_CHAT','PRIVATE_ONE','PRIVATE_SOURCE_NOTE'])assert.ok(!(await reader.$eval('body',e=>e.textContent??'')).includes(secret));check('Співавтор відкриває запрошення й бачить оригінал свого внеску, без приватних даних');
    await reader.setViewport({width:390,height:844});await reader.$eval('[data-edition-check="0"]',e=>e.scrollIntoView({block:'center'}));assert.ok(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await reader.screenshot({path:'/tmp/t99-edition-review-mobile.png',fullPage:false});await checks(reader);await press(reader,'[data-edition-approve]','/decision');await ready(reader);check('На 390px погодження працює клавіатурою без горизонтального прокручування');
    await press(reader,'[data-edition-withdraw]','/decision');await ready(reader);check('Співавтор може відкликати власне погодження');
    await checks(reader);await press(reader,'[data-edition-approve]','/decision');await ready(reader);
    await owner.click('[data-edition-refresh]');await ready(owner);assert.equal(await owner.$eval('[data-edition-download="pdf"]',e=>e.matches(':disabled')),false);
    await owner.screenshot({path:'/tmp/t99-edition-desktop.png',fullPage:false});
    const downloads=await fs.mkdtemp('/tmp/t99-downloads-');const client=await owner.createCDPSession();await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    for(const format of ['epub','docx']){
      await owner.click('[data-edition-download="'+format+'"]');let name:string|undefined;
      for(let i=0;i<100;i++){name=(await fs.readdir(downloads)).find(n=>n.endsWith('.'+format));if(name)break;await new Promise(r=>setTimeout(r,50));}
      assert.ok(name,'A real '+format+' file must be downloaded');const zip=await JSZip.loadAsync(await fs.readFile(path.join(downloads,name)));
      const entries=Object.values(zip.files).filter(f=>!f.dir&&/\.(xml|xhtml|opf)$/.test(f.name));const texts=(await Promise.all(entries.map(f=>f.async('string')))).join('\n');
      assert.ok(texts.includes('Письменник'));assert.ok(texts.includes('Псевдонім один'));assert.ok(texts.includes('Титульний склад'));assert.ok(!texts.includes('PRIVATE_PLAYER_CHAT'));assert.ok(!texts.includes('"userId"'));
      const metadata=await zip.file(format==='docx'?'docProps/core.xml':'OEBPS/content.opf')!.async('string');
      assert.ok(metadata.includes('Письменник'));assert.ok(metadata.includes('Псевдонім один'));
    }
    check('Чинні DOCX/EPUB-експортери створюють валідні архіви з погодженими авторами та умовами');
    await owner.focus('[data-edition-publish-check]');await owner.keyboard.press('Space');const published=await press(owner,'[data-edition-publish]','/publish');assert.equal(published.status,'published');await ready(owner);check('Публікація потребує окремого підтвердження й відкриває посилання на точну версію');
    const publicPage=await make('guest');await publicPage.goto(origin+'/api/labyrinth-editions/'+created.id+'/read');await publicPage.waitForSelector('#scene-text');
    await publicPage.setViewport({width:390,height:844});assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await publicPage.focus('#next');await publicPage.keyboard.press('Enter');assert.ok((await publicPage.$eval('#scene-text',e=>e.textContent??'')).length);assert.ok(await publicPage.$eval('#scene-title',e=>e===document.activeElement));
    await publicPage.screenshot({path:'/tmp/t99-edition-public-mobile.png',fullPage:false});check('Публічний плеєр, карта й перехід між розділами працюють на мобільній ширині з CSP');
    await reader.click('[data-edition-refresh]');await ready(reader);await press(reader,'[data-edition-withdraw]','/decision');await ready(reader);
    const removed=await publicPage.goto(origin+'/api/labyrinth-editions/'+created.id+'/read');assert.equal(removed!.status(),404);check('Після відкликання згоди публічне посилання перестає віддавати книгу');
    assert.deepEqual(errors,[]);check('Прогін завершено без помилок браузерного JavaScript');
  }finally{await browser.close();}
  console.log('Підсумок: '+passed+' браузерних перевірок пройшло.');
}
