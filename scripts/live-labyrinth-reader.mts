import assert from "node:assert/strict";
import type { Express } from "express";
import fs from "node:fs/promises";
import path from "node:path";

export async function liveReader(app: Express, origin: string, project: string, mapId: string, _publicationRevision: number) {
  const { build } = await import("esbuild");
  const built = await build({
    stdin: {
      contents: "import React,{useState} from 'react';import{createRoot}from'react-dom/client';" +
        "import{BookStructureBuilder}from'./src/components/BookStructureBuilder';" +
        "import{SunLightingProvider}from'./src/context/SunLightingContext';" +
        "import{BlocksOpacityProvider}from'./src/context/BlocksOpacityContext';" +
        "import{SidebarNav}from'./src/components/SidebarNav';" +
        "import LabyrinthReader from'./src/components/labyrinth/LabyrinthReader';" +
        "const book={id:" + JSON.stringify(project) + ",title:'Тест читача',chapters:[],characters:[]};" +
        "function Menu(){const[tab,setTab]=useState('start');return <SunLightingProvider theme='dark'><BlocksOpacityProvider><div style={{display:'flex',minHeight:'100vh'}}>" +
        "<SidebarNav currentTab={tab} onSelectTab={setTab} currentRole='reader' book={book} onQuickAi={()=>{}} onOpenHelp={()=>{}}/>" +
        "<main style={{flex:1,minWidth:0,padding:20}}>{tab==='labyrinth-reader'?<LabyrinthReader projectId={book.id}/>:<p>Виберіть читання</p>}</main></div></BlocksOpacityProvider></SunLightingProvider>}" +
        "import{LanguageProvider}from'./src/i18n/LanguageContext';" +
        "import{ReaderPublication}from'./src/components/labyrinth/ReaderPublication';" +
        "function Author(){const[dirty,setDirty]=useState(true);return <main style={{maxWidth:1000,margin:'auto',padding:20}}>" +
        "<button data-dirty-toggle onClick={()=>setDirty(v=>!v)}>Чернетка / збережено</button>" +
        "<ReaderPublication base=" + JSON.stringify("/api/core/projects/" + project + "/labyrinth") +
        " mapId=" + JSON.stringify(mapId) + " mapRevision={2} heroes={[{id:'hero',name:'Мандрівник'}]} dirty={dirty} busy={false}/></main>}" +
        "createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).get('mode')==='author'?<Author/>:" +
        "new URLSearchParams(location.search).get('mode')==='menu'?<LanguageProvider><Menu/></LanguageProvider>:" +
        "<LanguageProvider><BookStructureBuilder book={{id:" + JSON.stringify(project) + ",title:'Тест читача',chapters:[]}}" +
        " onUpdateBook={()=>{}} onNavigateToTab={()=>{}}/></LanguageProvider>);",
      resolveDir: process.cwd(), loader: "tsx",
    },
    define: {"import.meta.env":JSON.stringify({BASE_URL:"/"})},
    bundle: true, write: false, platform: "browser", format: "esm", outdir: "/tmp/t96-probe",
  });
  const cssFile = (await fs.readdir("dist/assets")).find((f) => /^index-.*\.css$/.test(f));
  assert.ok(cssFile);
  app.get("/t96-probe.js",(_q,r) => r.type("js").send(built.outputFiles.find((f) => f.path.endsWith(".js"))!.text));
  app.get("/t96-probe.css",(_q,r) => void fs.readFile(path.join("dist/assets",cssFile),"utf8").then((css) =>
    r.type("css").send(css + (built.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? ""))));
  app.get("/t96-probe",(_q,r) => r.send('<!doctype html><html lang="uk"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<link rel="stylesheet" href="/t96-probe.css"><body style="margin:0;background:#0f172a;color:#f1f5f9"><div id="root"></div>' +
    '<script type="module" src="/t96-probe.js"></script></body></html>'));
  const { launch } = await import("puppeteer-core");
  const browser = await launch({executablePath:"/usr/bin/chromium",headless:true,protocolTimeout:30000,args:["--no-sandbox","--disable-dev-shm-usage"]});
  let passed = 0;
  const check = (name: string) => { passed++; console.log("✓ БРАУЗЕР: " + name); };
  const errors: string[] = [];
  const pendingRequests = new Set<string>();
  const page = await browser.newPage(), author = await browser.newPage();
  for (const p of [page,author]) p.on("pageerror",(e) => errors.push(String(e)));
  page.on("request", (r) => { if (r.url().includes("/labyrinth/")) pendingRequests.add(r.method() + " " + r.url()); });
  page.on("requestfinished", (r) => pendingRequests.delete(r.method() + " " + r.url()));
  page.on("requestfailed", (r) => pendingRequests.delete(r.method() + " " + r.url()));
  const waitPage = (fn: any, ...args: any[]) => page.waitForFunction(fn, {polling: 100}, ...args);
  const ready = async (selector: string) => {
    await page.waitForSelector(selector);
    await waitPage(() => document.querySelector("[data-labyrinth-reader]")?.getAttribute("aria-busy") === "false");
  };
  const revision = () => page.evaluate(() => new URL(location.href).searchParams.get("readerRun"));
  const progress = () => page.$eval("[data-reader-progress]",(e) => e.textContent);
  const press = async (selector: string) => {
    await ready(selector); await page.focus(selector); await page.keyboard.press("Enter");
    await waitPage(() => document.querySelector("[data-labyrinth-reader]")?.getAttribute("aria-busy") === "false");
  };
  try {
    await author.setExtraHTTPHeaders({"x-test-user":"owner"});
    await author.goto(origin + "/t96-probe?mode=author");
    await author.waitForSelector("[data-reader-publish]");
    await author.waitForFunction(() => document.querySelector("[data-reader-publication]")?.textContent?.includes("Відкрита карта"), {polling:100});
    assert.equal(await author.$eval("[data-reader-publish]",(e) => (e as HTMLButtonElement).disabled),true);
    check("Авторський екран не відкриває незбережену чернетку");
    await author.click("[data-dirty-toggle]");
    await author.waitForFunction(() => !(document.querySelector("[data-reader-publish]") as HTMLButtonElement).disabled, {polling:100});
    await author.click("[data-reader-publish]");
    await author.waitForFunction(() => document.body.textContent?.includes("Версію відкрито."), {polling:100});
    check("Справжня кнопка автора відкриває збережену версію через API");
    await page.bringToFront();
    await page.setExtraHTTPHeaders({"x-test-user":"reader"});
    await page.setViewport({width:1440,height:1000});
    await page.goto(origin + "/t96-probe?mode=menu");
    await page.waitForSelector("#nav-tab-labyrinth-reader");
    assert.equal(await page.$("#nav-tab-structure"),null);
    assert.match(await page.$eval("#nav-tab-labyrinth-reader",(e) => e.textContent ?? ""), /Читач лабіринта|Labyrinth reader/);
    await page.focus("#nav-tab-labyrinth-reader"); await page.keyboard.press("Enter");
    await ready("[data-reader-start]");
    check("Справжнє меню ролі читача відкриває лише читання без авторського конструктора");
    await page.goto(origin + "/t96-probe");
    await page.waitForSelector('nav[aria-label="Режим конструктора"]');
    const readerButton = await page.evaluateHandle(() => [...document.querySelectorAll("nav button")].find((b) => b.textContent === "Читач лабіринта")!);
    await (readerButton.asElement() as import("puppeteer-core").ElementHandle<Element>).focus();
    await page.keyboard.press("Enter"); await readerButton.dispose();
    await ready("[data-reader-start]");
    check("Читач відкривається з реальної сторінки структури книги клавіатурою");
    await press("[data-reader-start]"); await ready("[data-reader-scene]");
    const initialId = await revision(); assert.ok(initialId);
    assert.equal(await page.$eval("article h2",(e) => e === document.activeElement),true);
    check("Enter запускає проходження й переводить фокус на сцену");
    const initialText = await page.$eval("[data-reader-scene]",(e) => e.textContent ?? "");
    assert.match(initialText,/UPDATED_CANON/);
    assert.match(initialText,/<img src=x/);
    assert.equal(await page.$("[data-reader-scene] img"),null);
    assert.equal(await page.evaluate(() => (window as any).__readerXss),undefined);
    check("Текст із HTML відображається як текст, без виконання коду");
    assert.ok(!initialText.includes("HIDDEN_ROOM") && !initialText.includes("HIDDEN_BRIDGE_END"));
    assert.ok(await page.$('svg[role="img"] title'));
    await page.focus("details summary"); await page.keyboard.press("Enter");
    const accessible = await page.$eval('section[aria-label="Карта проходження"]',(e) => e.textContent ?? "");
    assert.match(accessible,/герой тут/); assert.ok(!accessible.includes("HIDDEN_ROOM"));
    check("Доступна SVG-карта має назву, маркер і текстову альтернативу");
    await page.focus('[aria-label="Збільшити текст"]'); await page.keyboard.press("Enter");
    assert.equal(await page.$eval("[data-reader-scene]",(e) => (e as HTMLElement).style.fontSize),"20px");
    check("Розмір тексту змінюється без зміни проходження");
    await page.screenshot({path:"/tmp/t96-reader-desktop.png",fullPage:true});
    const beforeIdle = await progress();
    await new Promise((r) => setTimeout(r,1500));
    assert.equal(await progress(),beforeIdle);
    check("Читання та пауза не витрачають ігровий час");
    await press("[data-reader-wait]"); await ready("[data-reader-warnings]");
    await press("[data-reader-wait]");
    await waitPage(() => document.querySelector("[data-reader-warnings]")?.textContent?.includes("Небезпека"));
    const activeProgress = await progress();
    const activeText = await page.$eval("[data-reader-warnings]",(e) => e.textContent);
    const bookmark = page.url();
    await page.reload(); await ready("[data-reader-scene]");
    assert.equal(await revision(),initialId); assert.equal(await progress(),activeProgress);
    assert.equal(await page.$eval("[data-reader-warnings]",(e) => e.textContent),activeText);
    check("Перезапуск сторінки під час небезпеки відновлює точний маршрут і час");
    const second = await browser.newPage();
    second.on("pageerror",(e) => errors.push(String(e)));
    await second.setExtraHTTPHeaders({"x-test-user":"reader"});
    await second.goto(bookmark);
    await second.waitForSelector("[data-reader-scene]");
    await second.waitForFunction(() => document.querySelector("[data-labyrinth-reader]")?.getAttribute("aria-busy") === "false", {polling:100});
    await page.bringToFront();
    await page.click("[data-reader-wait]");
    await second.bringToFront();
    await second.click("[data-reader-wait]");
    await page.bringToFront();
    await waitPage(() => document.querySelector("[data-labyrinth-reader]")?.getAttribute("aria-busy") === "false");
    await second.waitForFunction(() => document.querySelector("[data-labyrinth-reader]")?.getAttribute("aria-busy") === "false", {polling:100});
    await waitPage(() => document.querySelector("[data-reader-progress]")?.textContent?.includes("час історії 3"));
    await second.waitForFunction(() => document.querySelector("[data-reader-progress]")?.textContent?.includes("час історії 3"), {polling:100});
    assert.ok((await page.$("[role=alert]")) || (await second.$("[role=alert]")));
    assert.equal(await progress(),await second.$eval("[data-reader-progress]",(e) => e.textContent));
    check("Дві вкладки не дублюють хід, конфліктна вкладка отримує актуальну сцену");
    await second.close();
    await page.bringToFront();
    const cdp = await page.createCDPSession();
    await cdp.send("Fetch.enable",{patterns:[{urlPattern:"*/reader/sessions/*/actions",requestStage:"Response"}]});
    let dropped = false;
    cdp.on("Fetch.requestPaused",async (event) => {
      if (!dropped) {
        dropped = true; await cdp.send("Fetch.failRequest",{requestId:event.requestId,errorReason:"Failed"});
      } else await cdp.send("Fetch.continueRequest",{requestId:event.requestId});
    });
    await page.click("[data-reader-wait]");
    await page.waitForSelector("[data-reader-retry]");
    await cdp.send("Fetch.disable");
    assert.ok(dropped);
    await press("[data-reader-retry]");
    await waitPage(() => document.querySelector("[data-reader-progress]")?.textContent?.includes("час історії 4"));
    assert.equal(await page.$("[data-reader-retry]"),null);
    check("Втрачена після запису відповідь повторюється з тим самим ключем без другого ходу");
    await press('[data-reader-move="up"]');
    await waitPage(() => document.querySelector("[data-reader-scene]")?.textContent?.includes("FUTURE_SCENE_TEXT"));
    assert.match(await page.$eval('svg title',(e) => e.textContent ?? ""),/Лівий край мосту/);
    check("Перехід відкриває наступну сцену й переносить маркер на верхній рівень");
    await page.setViewport({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true);
    await page.screenshot({path:"/tmp/t96-reader-mobile.png",fullPage:true});
    check("390 px: сцена, керування та карта без горизонтального переповнення");
    await page.select("[data-reader-checkpoint]","0");
    await press("[data-reader-restore]");
    await waitPage((oldId) => new URL(location.href).searchParams.get("readerRun") !== oldId,initialId);
    assert.notEqual(await revision(),initialId);
    assert.match(await page.$eval('svg title',(e) => e.textContent ?? ""),/Вхід/);
    assert.ok(!(await page.$eval('[data-reader-map]',(e) => e.textContent ?? "")).includes("HIDDEN_BRIDGE_END"));
    check("Відновлення з клавіатури створює новий маршрут і повертає попередній туман карти");
    await press('[data-reader-move="corridor"]');
    await page.waitForSelector("[data-reader-complete]");
    assert.equal(await page.$eval("[data-reader-wait]",(e) => !!e.closest("fieldset[disabled]")),true);
    check("Досягнення виходу показує фінал і завершує дії");
    await author.bringToFront();
    await author.reload();
    await author.waitForSelector("[data-reader-withdraw]");
    await author.waitForFunction(() => !(document.querySelector("[data-reader-withdraw]") as HTMLButtonElement).disabled, {polling:100});
    await author.click("[data-reader-withdraw]");
    await author.waitForFunction(() => document.body.textContent?.includes("Доступ відкликано"), {polling:100});
    await page.bringToFront();
    await press("[data-reader-refresh]");
    await page.waitForSelector("[role=alert]");
    assert.equal(await page.$("[data-reader-scene]"),null);
    assert.equal(await page.evaluate(() => new URL(location.href).searchParams.has("readerRun")),false);
    assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes("UPDATED_CANON"));
    check("Відкликання автора очищає сцену з UI та bookmark; приватний текст не кешується");
    await page.setExtraHTTPHeaders({"x-test-user":"guest"});
    await page.reload(); await page.waitForSelector("[role=alert]");
    assert.equal(await page.$("[data-reader-start]"),null);
    check("Гість не бачить бібліотеку й не може почати читання");
    assert.deepEqual(errors,[]);
    check("Без помилок JavaScript у всіх перевірених екранах");
    console.log("Підсумок браузера: " + passed + " пройшло.");
  } catch (e) {
    console.error("Reader browser diagnostics", { errors, pendingRequests: [...pendingRequests],
      url: page.url(), body: await page.$eval("body", (node) => node.textContent?.slice(0, 1800)) });
    await page.bringToFront();
    await page.screenshot({path:"/tmp/t96-reader-failure.png",fullPage:true});
    throw e;
  } finally { await browser.close(); }
}
