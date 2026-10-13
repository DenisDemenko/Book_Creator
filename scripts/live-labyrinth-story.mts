import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type {Express} from "express";
import type {Page} from "puppeteer-core";
export async function liveStory(app:Express,origin:string,project:string,mapId:string,_revoked:Set<string>) {
  const {build}=await import("esbuild"),base="/api/core/projects/"+project+"/labyrinth";
  const built=await build({stdin:{loader:"tsx",resolveDir:process.cwd(),contents:
    "import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{StoryAssembly}from'./src/components/labyrinth/StoryAssembly';"+
    "import{loadBook}from'./src/utils/storage';function App(){const[book,setBook]=useState(null);useEffect(()=>{if(location.pathname.endsWith('/editor'))loadBook().then(setBook)},[]);"+
    "return location.pathname.endsWith('/editor')?<main data-editor-open>{book?<><h1>{book.title}</h1><p data-editor-id>{book.id}</p>{book.chapters.flatMap(c=>c.sections).map(s=><p key={s.id}>{s.content}</p>)}</>:<p>Loading</p>}</main>:"+
    "<main style={{maxWidth:1000,margin:'auto',padding:12}}><StoryAssembly base="+JSON.stringify(base)+" mapId="+JSON.stringify(mapId)+" disabled={false}/></main>}createRoot(document.getElementById('root')).render(<App/>);"},
    bundle:true,write:false,platform:"browser",format:"esm",outdir:"/tmp/t98-probe",define:{"import.meta.env":JSON.stringify({BASE_URL:"/"})}});
  const js=built.outputFiles.find(f=>f.path.endsWith(".js"))!.text;
  for(const marker of ["ONE_PRIVATE","TWO_PRIVATE","SECRET_KNOWLEDGE","PRIVATE_PLAYER_CHAT"])assert.ok(!js.includes(marker),"Harness JS embeds private data");
  const css=(await fs.readdir("dist/assets")).find(f=>/^index-.*\.css$/.test(f));assert.ok(css);
  app.get("/t98-probe.js",(_q,r)=>r.type("js").send(js));
  app.get("/t98-probe.css",(_q,r)=>void fs.readFile(path.join("dist/assets",css),"utf8").then(v=>r.type("css").send(v)));
  const html='<!doctype html><html lang="uk"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/t98-probe.css"><body style="margin:0;background:#0f172a;color:#f1f5f9"><div id="root"></div><script type="module" src="/t98-probe.js"></script></body></html>';
  app.get("/t98-probe",(_q,r)=>r.send(html));app.get("/projects/:id/editor",(_q,r)=>r.send(html));
  const {launch}=await import("puppeteer-core");
  const browser=await launch({executablePath:"/usr/bin/chromium",headless:true,protocolTimeout:30000,args:["--no-sandbox","--disable-dev-shm-usage"]});
  let passed=0;const errors:string[]=[];const check=(name:string)=>{passed++;console.log("✓ БРАУЗЕР: "+name);};
  const make=async(user:string)=>{const context=await browser.createBrowserContext(),p=await context.newPage();await p.setExtraHTTPHeaders({"x-test-user":user});await p.setViewport({width:1280,height:1000});p.on("pageerror",e=>errors.push(String(e)));return p;};
  const wait=(p:Page,fn:any,...args:any[])=>p.waitForFunction(fn,{polling:100,timeout:15000},...args);
  const ready=(p:Page)=>wait(p,()=>document.querySelector("[data-story-assembly]")?.getAttribute("aria-busy")==="false");
  const press=async(p:Page,selector:string,fragment:string)=>{
    const response=p.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes(fragment),{timeout:15000});
    await p.focus(selector);await p.keyboard.press("Enter");const r=await response;assert.ok(r.ok(),await r.text());await ready(p);return r.json();
  };
  const owner=await make("owner");
  try {
    const guest=await make("guest");await guest.goto(origin+"/t98-probe");await ready(guest);
    assert.equal(await guest.$("[data-story-block]"),null);assert.match(await guest.$eval("[data-story-notice]",e=>e.textContent??""),/Увійдіть/);check("Прямий гостьовий вхід не отримує авторського тексту");
    await owner.goto(origin+"/t98-probe");await ready(owner);assert.ok(await owner.$('[data-story-run] option[value]:not([value=""])'));
    await owner.focus("[data-story-title]");await owner.keyboard.down("Control");await owner.keyboard.press("KeyA");await owner.keyboard.up("Control");await owner.keyboard.type("Браузерна історія "+Date.now());
    const cdp=await owner.createCDPSession();let dropped=false;
    await cdp.send("Fetch.enable",{patterns:[{urlPattern:"*/runs/*/story-drafts",requestStage:"Response"}]});
    cdp.on("Fetch.requestPaused",async e=>{if(!dropped){dropped=true;await cdp.send("Fetch.failRequest",{requestId:e.requestId,errorReason:"Failed"});}else await cdp.send("Fetch.continueResponse",{requestId:e.requestId});});
    await owner.focus("[data-story-create]");await owner.keyboard.press("Enter");await owner.waitForSelector("[data-story-retry]");
    await cdp.send("Fetch.disable");const draft=await press(owner,"[data-story-retry]","/story-drafts");await cdp.detach();
    assert.ok(await owner.$('[data-story-draft="'+draft.id+'"]'));assert.equal(await owner.$$eval('[data-story-open-draft]',e=>e.filter(x=>x.getAttribute('data-story-open-draft')===document.querySelector('[data-story-draft]')?.getAttribute('data-story-draft')).length),1);
    check("Реальна форма й повтор після втрати відповіді створюють одну збірку");
    const sourceTexts=await owner.$$eval("[data-story-source-text]",els=>els.map(e=>e.textContent));
    assert.equal(await owner.$eval("[data-story-accept]",e=>e.matches(":disabled")),true);
    assert.equal(await owner.$('[data-story-kind="ending"] textarea'),null);assert.equal(await owner.$('[data-story-kind="contribution"] textarea'),null);
    check("Прийняття потребує перевірки; фінал і чужий погоджений текст не мають редактора");
    await owner.focus("[data-story-edit]");await owner.keyboard.down("Control");await owner.keyboard.press("KeyA");await owner.keyboard.up("Control");await owner.keyboard.type("Авторська редакція <img src=x onerror=alert(1)>");
    await press(owner,"[data-story-save]","/edit");assert.equal(await owner.$("[data-story-draft] img"),null);
    assert.deepEqual(await owner.$$eval("[data-story-source-text]",els=>els.map(e=>e.textContent)),sourceTexts);
    check("Ручна редакція не змінює факти; HTML лишається текстом");
    assert.equal(await owner.$eval("[data-story-rewrite]",e=>e.matches(":disabled")),true);
    await owner.click("[data-story-confirm-ai]");await press(owner,"[data-story-rewrite]","/rewrite");
    assert.deepEqual(await owner.$$eval("[data-story-source-text]",els=>els.map(e=>e.textContent)),sourceTexts);
    assert.ok((await owner.$eval("[data-story-draft]",e=>e.textContent??"")).includes("ШІ — перевірте зміст"));check("AI запускається окремо і повертає позначену пропозицію з незмінними джерелами");
    await owner.screenshot({path:"/tmp/t98-story-desktop.png",fullPage:false});
    await owner.setViewport({width:390,height:844});await owner.$eval("[data-story-reviewed]",e=>e.scrollIntoView({block:"center"}));
    assert.ok(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await owner.screenshot({path:"/tmp/t98-story-mobile.png",fullPage:false});
    await owner.focus("[data-story-reviewed]");await owner.keyboard.press("Space");const accepted=await press(owner,"[data-story-accept]","/accept");
    assert.ok(accepted.newBookId);check("390 px і клавіатура: перевірка та прийняття створюють окремий приватний рукопис");
    const navigation=owner.waitForNavigation({waitUntil:"load"});await owner.focus("[data-story-open-book]");await owner.keyboard.press("Enter");await navigation;
    await owner.waitForFunction((id:string)=>document.querySelector("[data-editor-id]")?.textContent===id,{timeout:15000},accepted.newBookId);
    assert.ok(owner.url().includes(accepted.newBookId+"/editor"));
    assert.ok(!(await owner.$eval("body",e=>e.textContent??"")).includes("ONE_PRIVATE"));check("Книга завантажується у чинне IndexedDB та відкривається за власною адресою редактора");
    assert.deepEqual(errors,[]);check("Прогін без помилок браузерного JavaScript");
  } finally {await browser.close();}
  console.log("Підсумок: "+passed+" браузерних перевірок пройшло.");
}
