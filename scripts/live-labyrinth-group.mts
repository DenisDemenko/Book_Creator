import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type {Express} from "express";
import type {LabyrinthDefinition} from "../shared/labyrinth";
import type {Page} from "puppeteer-core";
export async function liveGroup(app:Express,origin:string,project:string,mapId:string,world:LabyrinthDefinition,revoked:Set<string>) {
  const {build}=await import("esbuild");
  const base="/api/core/projects/"+project+"/labyrinth";
  const built=await build({stdin:{loader:"tsx",resolveDir:process.cwd(),contents:
    "import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';"+
    "import{BookStructureBuilder}from'./src/components/BookStructureBuilder';import{LanguageProvider}from'./src/i18n/LanguageContext';"+
    "import LabyrinthReader from'./src/components/labyrinth/LabyrinthReader';"+
    "import{ReaderPublication}from'./src/components/labyrinth/ReaderPublication';"+
    "function Author(){const[dirty,setDirty]=useState(true),[world,setWorld]=useState(null);useEffect(()=>{fetch("+JSON.stringify(base+"/maps/"+mapId+"/versions/1")+").then(r=>r.json()).then(v=>setWorld(v.definition))},[]);if(!world)return <p>Завантаження карти</p>;return <main style={{maxWidth:1100,margin:'auto',padding:20}}>"+
    "<button data-group-dirty onClick={()=>setDirty(v=>!v)}>Чернетка / збережено</button>"+
    "<ReaderPublication base="+JSON.stringify(base)+" mapId="+JSON.stringify(mapId)+" mapRevision={1} heroes={world.heroes} definition={world} dirty={dirty} busy={false}/></main>}"+
    "createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).get('mode')==='author'?<Author/>:"+
    "new URLSearchParams(location.search).get('mode')==='embedded'?<LanguageProvider><BookStructureBuilder book={{id:"+JSON.stringify(project)+",title:'Контрольна книга',chapters:[]}} onUpdateBook={()=>{}} onNavigateToTab={()=>{}}/></LanguageProvider>:"+
    "<main style={{maxWidth:1000,margin:'auto',padding:12}}><LabyrinthReader projectId="+JSON.stringify(project)+"/></main>);"},
    define:{"import.meta.env":JSON.stringify({BASE_URL:"/"})},bundle:true,write:false,platform:"browser",format:"esm",outdir:"/tmp/t97-probe"});
  const js=built.outputFiles.find(f=>f.path.endsWith(".js"))!.text;
  for(const secret of ["SECRET_ONLY_ONE","TWO_PRIVATE","THREE_PRIVATE"])assert.ok(!js.includes(secret),"Harness JS must not embed a private world: "+secret);
  const css=(await fs.readdir("dist/assets")).find(f=>/^index-.*\.css$/.test(f));assert.ok(css);
  app.get("/t97-probe.js",(_q,r)=>r.type("js").send(built.outputFiles.find(f=>f.path.endsWith(".js"))!.text));
  app.get("/t97-probe.css",(_q,r)=>void fs.readFile(path.join("dist/assets",css),"utf8").then(s=>r.type("css").send(s)));
  app.get("/t97-probe",(_q,r)=>r.send('<!doctype html><html lang="uk"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<link rel="stylesheet" href="/t97-probe.css"><body style="margin:0;background:#0f172a;color:#f1f5f9"><div id="root"></div>'+
    '<script type="module" src="/t97-probe.js"></script></body></html>'));
  const {launch}=await import("puppeteer-core");
  const browser=await launch({executablePath:"/usr/bin/chromium",headless:true,protocolTimeout:30000,args:["--no-sandbox","--disable-dev-shm-usage"]});
  const errors:string[]=[];let passed=0;
  const check=(name:string)=>{passed++;console.log("✓ БРАУЗЕР: "+name);};
  const make=async(user:string)=>{
    const context=await browser.createBrowserContext(),p=await context.newPage();
    await p.setExtraHTTPHeaders({"x-test-user":user});await p.setViewport({width:1280,height:1000});
    p.on("pageerror",e=>errors.push(String(e)));return p;
  };
  const author=await make("owner"),pages=await Promise.all(["reader","reader2","reader3"].map(make));
  const wait=(p:Page,fn:any,...args:any[])=>p.waitForFunction(fn,{polling:100,timeout:15000},...args);
  const ready=(p:Page)=>wait(p,()=>document.querySelector("[data-group-reader]")?.getAttribute("aria-busy")==="false");
  const press=async(p:Page,selector:string,fragment="/commands")=>{
    await p.bringToFront();await p.waitForSelector(selector);
    const response=p.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes(fragment),{timeout:15000});
    await p.focus(selector);await p.keyboard.press("Enter");const result=await response;
    if(fragment==="/commands")await ready(p);
    return result.json();
  };
  const api=async(path:string,user="reader",body?:unknown)=>{
    const r=await fetch(origin+base+path,{method:body===undefined?"GET":"POST",headers:{"content-type":"application/json","x-test-user":user},...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.ok(r.ok,await r.clone().text());return r.json();
  };
  try {
    await author.goto(origin+"/t97-probe?mode=author");
    await author.waitForSelector("[data-group-bind=one]");
    assert.equal(await author.$eval("[data-group-create]",e=>e.matches(":disabled")),true);
    await author.click("[data-group-dirty]");
    await wait(author,()=>!!document.querySelector('[data-group-bind=three] option[value="reader3"]'));
    for(const [hero,user] of [["one","reader"],["two","reader2"],["three","reader3"]])await author.select("[data-group-bind="+hero+"]",user);
    await author.click("[data-group-setup] details summary");
    await author.select("[data-group-joint-transition]",JSON.stringify({objectId:"generator",to:"on"}));
    await author.select("[data-group-support=one]","lower-entry");await author.select("[data-group-support=three]","upper-left");
    await author.click("[data-group-add-joint]");
    const created=await press(author,"[data-group-create]","/maps/"+mapId+"/groups");
    const createdId=String(created.id);
    await wait(author,(id:string)=>!!document.querySelector('[data-group-author-session="'+id+'"]'),createdId);
    check("Реальна авторська форма: чернетка заблокована; призначення трьох героїв, підтримка на двох рівнях і створення запрошень");
    for(let i=0;i<pages.length;i++){
      const p=pages[i];await p.goto(origin+"/t97-probe?labyrinth=group&groupRun="+createdId);await ready(p);
      assert.equal(await p.$("[data-group-knowledge]"),null);
      await p.bringToFront();await p.type("[data-group-alias]","Учасник "+(i+1));
      if(i===0)await p.click("[data-group-candidate]");
      await p.click("[data-group-terms]");await press(p,"[data-group-join]");
      await p.waitForSelector("[data-group-lobby]");
    }
    check("Три незалежні браузерні контексти приймають власні запрошення; співавторство не вмикається автоматично");
    for(let i=0;i<pages.length;i++){
      const body=await pages[i].$eval("[data-group-reader]",e=>e.textContent??"");
      for(const marker of ["SECRET_ONLY_ONE","TWO_PRIVATE","THREE_PRIVATE"].filter((_,n)=>n!==i))assert.ok(!body.includes(marker),marker);
    }
    assert.match(await pages[2].$eval("[data-group-scene]",e=>e.textContent??""),/UPPER_SCENE/);
    check("Кожен браузер отримує власну сцену й знання без чужих секретів у DOM");
    await author.bringToFront();await author.click("[data-group-author-refresh]");
    await wait(author,(id:string)=>document.querySelector('[data-group-author-session="'+id+'"]')?.textContent?.includes("r3"),createdId);
    await press(author,'[data-group-launch="'+createdId+'"]',"/launch");
    for(const p of pages)await wait(p,()=>!document.querySelector("[data-group-lobby]"));
    assert.equal(await pages[1].$eval("[data-group-wait]",e=>e.matches(":disabled")),true);
    await press(pages[0],"[data-group-propose]");
    for(const p of pages)await p.waitForSelector("[data-group-decision]");
    assert.match(await pages[1].$eval("[data-group-decision]",e=>e.textContent??""),/Спільна дія групи/);
    for(let i=0;i<pages.length;i++){
      const live=await api("/reader/groups/"+createdId,["reader","reader2","reader3"][i]);
      await wait(pages[i],(rev:number)=>document.querySelector("[data-group-progress]")?.textContent?.startsWith("r"+rev+" "),live.revision);
      await press(pages[i],"[data-group-vote-yes]");
    }
    for(const p of pages)await wait(p,()=>!document.querySelector("[data-group-decision]"));
    assert.equal((await api("/reader/groups/"+createdId)).storyTime,1);
    check("Клавіатурне голосування трьох гравців застосовує спільний важіль рівно один раз; черга іншого заблокована");
    const before=(await api("/reader/groups/"+createdId)).storyTime;
    await pages[0].bringToFront();await pages[0].type("[data-group-message]","HERO_ONLY");
    await press(pages[0],"[data-group-send]");
    await pages[1].reload();await ready(pages[1]);
    assert.ok(!(await pages[1].$eval("[data-group-messages]",e=>e.textContent??"")).includes("HERO_ONLY"));
    await pages[0].bringToFront();await pages[0].select("[data-group-channel]","player_chat");
    await pages[0].type("[data-group-message]","CHAT <img src=x onerror=alert(1)>");
    await press(pages[0],"[data-group-send]");
    for(const p of pages)await wait(p,()=>document.querySelector("[data-group-messages]")?.textContent?.includes("CHAT <img"));
    assert.equal(await pages[1].$("[data-group-messages] img"),null);
    assert.equal((await api("/reader/groups/"+createdId)).storyTime,before);
    check("Чат і діалог мають різні отримувачі; HTML лишається текстом, час не змінюється");
    const embedded=await make("reader");
    await embedded.goto(origin+"/t97-probe?mode=embedded&labyrinth=group&groupRun="+createdId);await ready(embedded);
    await embedded.reload();await ready(embedded);
    assert.ok(await embedded.$("[data-group-scene]"));
    check("Повернення до вбудованого читача після reload зберігає груповий режим");
    await embedded.close();
    const one=pages[0],saved=await api("/reader/groups/"+createdId);
    await one.reload();await ready(one);
    assert.equal((await api("/reader/groups/"+createdId)).storyTime,saved.storyTime);
    assert.match(await one.$eval("[data-group-knowledge]",e=>e.textContent??""),/SECRET_ONLY_ONE/);
    check("Перезавантаження браузера відновлює своє місце, знання та спільний час");
    await one.bringToFront();await one.type("[data-group-contribution]","CONSENTED_BROWSER_TEXT");
    assert.equal(await one.$eval("[data-group-submit-contribution]",e=>e.matches(":disabled")),true);
    await one.click("[data-group-include]");await press(one,"[data-group-submit-contribution]");
    await author.bringToFront();await author.click('[data-group-author-journal="'+createdId+'"]');
    await wait(author,()=>document.querySelector("[data-group-author-contributions]")?.textContent?.includes("CONSENTED_BROWSER_TEXT"));
    const journal=await author.$eval("[data-group-author-contributions]",e=>e.textContent??"");
    assert.ok(!journal.includes("HERO_ONLY")&&!journal.includes("CHAT"));
    assert.equal(await pages[1].$("[data-group-contribution]"),null);
    check("Погоджений текст додається лише через окрему згоду; авторський журнал не містить чатів");
    await press(one,"[data-group-withdraw]");
    await author.bringToFront();await author.click('[data-group-author-journal="'+createdId+'"]');
    await wait(author,()=>!document.querySelector("[data-group-author-contributions]")?.textContent?.includes("CONSENTED_BROWSER_TEXT"));
    check("Відкликання власного внеску відразу прибирає його з авторського журналу");
    await one.bringToFront();await one.select("[data-group-channel]","player_chat");
    const cdp=await one.createCDPSession();let dropped=false;
    await cdp.send("Fetch.enable",{patterns:[{urlPattern:"*/commands",requestStage:"Response"}]});
    cdp.on("Fetch.requestPaused",async e=>{
      if(!dropped){dropped=true;await cdp.send("Fetch.failRequest",{requestId:e.requestId,errorReason:"Failed"});}
      else await cdp.send("Fetch.continueResponse",{requestId:e.requestId});
    });
    const preLost=await api("/reader/groups/"+createdId);
    await one.type("[data-group-message]","LOST_RESPONSE_TEXT");
    await one.focus("[data-group-send]");await one.keyboard.press("Enter");
    await one.waitForSelector("[data-group-retry]");await cdp.send("Fetch.disable");
    await press(one,"[data-group-retry]");
    const afterLost=await api("/reader/groups/"+createdId);
    assert.equal(afterLost.revision,preLost.revision+1);
    assert.equal(afterLost.messages.filter((m:any)=>m.text==="LOST_RESPONSE_TEXT").length,1);
    await cdp.detach();check("Втрата відповіді після COMMIT: повтор використовує той самий ключ і не дублює повідомлення");
    await one.bringToFront();await one.focus('[aria-label="Збільшити текст групи"]');await one.keyboard.press("Enter");
    assert.equal(await one.$eval("[data-group-scene]",e=>(e as HTMLElement).style.fontSize),"20px");
    await one.screenshot({path:"/tmp/t97-group-desktop.png",fullPage:true});
    await pages[2].bringToFront();await pages[2].setViewport({width:390,height:844});
    await pages[2].screenshot({path:"/tmp/t97-group-mobile.png",fullPage:true});
    assert.ok(await pages[2].evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.ok(await pages[2].$('svg[role="img"] title'));
    check("Клавіатура, збільшення тексту й карта на 390 px без горизонтального прокручування");
    const guest=await make("guest");await guest.goto(origin+"/t97-probe?labyrinth=group&groupRun="+createdId);
    await guest.waitForSelector('[role="alert"]');
    assert.equal(await guest.$("[data-group-scene]"),null);check("Гість не отримує груповий текст навіть за прямим посиланням");
    const malformed=await make("reader");
    await malformed.goto(origin+"/t97-probe?labyrinth=group&groupRun="+encodeURIComponent("../library"));
    await malformed.waitForSelector('[role="alert"]');
    assert.equal(await malformed.$("[data-group-scene]"),null);
    assert.ok(malformed.url().includes("labyrinth=group"));
    await malformed.close();check("Некоректний ID у прямому посиланні не змінює API-маршрут або межі доступу");
    revoked.add("reader3");
    await wait(pages[2],()=>!document.querySelector("[data-group-scene]")&&!!document.querySelector('[role="alert"]'));
    assert.ok(!(await pages[2].$eval("body",e=>e.textContent??"")).includes("THREE_PRIVATE"));
    assert.ok(await pages[2].evaluate(()=>!Object.values({...localStorage,...sessionStorage}).some(v=>String(v).includes("THREE_PRIVATE"))));
    check("Відкликання grant закриває потік і прибирає сцену; приватні знання не зберігаються у WebStorage");
    const pub=await api("/maps/"+mapId+"/reader-publication","owner");
    await api("/maps/"+mapId+"/reader-withdraw","owner",{expectedRevision:pub.revision});
    for(const p of pages.slice(0,2))await wait(p,()=>!document.querySelector("[data-group-scene]")&&!!document.querySelector('[role="alert"]'));
    check("Відкликання видання прибирає сцени в усіх відкритих браузерах");
    assert.deepEqual(errors,[]);check("Немає помилок JavaScript у реальному інтерфейсі");
    console.log("Підсумок браузера: "+passed+" пройшло.");
  }catch(e){
    for(const p of pages)console.error("UI diagnostic",p.url(),(await p.$eval("body",e=>e.textContent??"").catch(()=>"")).slice(0,1800));
    throw e;
  }finally{revoked.clear();await browser.close();}
}
