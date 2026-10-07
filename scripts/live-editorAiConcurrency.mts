/** Controlled real EditorView + delayed AI HTTP response; no paid provider or full App. */
import assert from 'node:assert/strict';
import express from 'express';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
const app=express();app.use(express.json());
let release:(()=>void)|undefined, pending=false, fail=false;
app.post('/api/ai/analyze-scene',async(_req,res)=>{
  pending=true;await new Promise<void>(resolve=>{release=resolve;});pending=false;
  if(fail)res.status(502).json({error:'Контрольований збій провайдера'});
  else res.json({text:'Контрольована AI пропозиція, не канон'});
});
const bundle=await build({stdin:{contents:`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{EditorView}from'./src/components/EditorView';import{LanguageProvider}from'./src/i18n/LanguageContext';
import{SunLightingProvider}from'./src/context/SunLightingContext';import{initialBook}from'./src/data/initialBook';import{callAi}from'./src/utils/aiClient';
const initial=structuredClone(initialBook);initial.id='editor-ai-fixture';initial.chapters=initial.chapters.slice(0,1);initial.chapters[0].sections=initial.chapters[0].sections.slice(0,1);initial.chapters[0].sections[0].content='Початковий текст.';
function Probe(){const[book,setBook]=useState(initial),[status,setStatus]=useState('idle'),[result,setResult]=useState('');
return <><button id="run-ai" disabled={status==='pending'} onClick={async()=>{setStatus('pending');try{const answer=await callAi('/api/ai/analyze-scene',{text:book.chapters[0].sections[0].content});setResult(answer.text);setStatus('done');}catch(e){setResult(e.message);setStatus('failed');}}}>Запустити ШІ</button><output id="ai-status">{status}</output><output id="ai-result">{result}</output><output id="saved-text" hidden>{book.chapters[0].sections[0].content}</output><EditorView book={book} activeChapterId={book.chapters[0].id} activeSectionId={book.chapters[0].sections[0].id} onSelectSection={()=>{}} currentRole="writer" onUpdateBook={setBook}/></>}
createRoot(document.getElementById('root')).render(<LanguageProvider><SunLightingProvider theme="dark"><Probe/></SunLightingProvider></LanguageProvider>);
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',define:{'process.env.NODE_ENV':'"development"'},sourcemap:'inline',loader:{'.css':'empty'}});
app.get('/probe.js',(_req,res)=>res.type('application/javascript').send(bundle.outputFiles[0].text));
const css=(await fs.readdir('dist/assets')).filter(f=>f.endsWith('.css'));const stylesheet=(await Promise.all(css.map(f=>fs.readFile(path.join('dist/assets',f),'utf8')))).join('\n');
app.get('/probe.css',(_req,res)=>res.type('text/css').send(stylesheet));
app.get('/',(_req,res)=>res.send('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><div id="root"></div><script type="module" src="/probe.js"></script>'));
// Editor background lookups use empty fixtures; they are outside this acceptance criterion.
app.get('/api/*',(_req,res)=>res.json({cast:[],illustrations:[],entities:[],groups:[],registry:[],types:[],models:[],paragraphs:[],permissions:{}}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const artifact=await fs.mkdtemp(path.join(os.tmpdir(),'editor-ai-concurrency-'));
let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;let checks=0;const results:string[]=[];
const check=(label:string)=>{checks++;results.push(label);console.log('✓ '+label);};
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>{errors.push(String(e));console.error('Browser:',e instanceof Error?e.stack:String(e));});await page.setViewport({width:1440,height:1000});await page.goto(origin);await page.waitForSelector('[contenteditable="true"]',{timeout:10000});
 for(const mode of ['success','failure']){
  fail=mode==='failure';await page.click('#run-ai');await page.waitForFunction(()=>document.querySelector('#ai-status')?.textContent==='pending');assert.equal(pending,true);check(mode+': AI HTTP запит залишається незавершеним');
  const marker=mode==='success'?' ПРАВКА ПІД ЧАС ШІ.':' ПРАВКА ПІД ЧАС ЗБОЮ.';
  await page.click('[contenteditable="true"]');await page.keyboard.press('End');await page.keyboard.type(marker);
  await page.waitForFunction(m=>document.querySelector('#saved-text')?.textContent?.includes(m),{},marker.trim());
  assert.equal(pending,true);check(mode+': редактор і onUpdateBook працюють до відповіді ШІ');
  const before=await page.$eval('#saved-text',e=>e.textContent);assert.match(before!,/Початковий текст/);if(mode==='failure')assert.match(before!,/ПРАВКА ПІД ЧАС ШІ/);check(mode+': початковий текст і попередні авторські правки збережені');release!();await page.waitForFunction(s=>document.querySelector('#ai-status')?.textContent===s,{},fail?'failed':'done');
  assert.equal(await page.$eval('#saved-text',e=>e.textContent),before);check(mode+': відповідь ШІ не перезаписує авторську правку');
  assert.equal(await page.$eval('[contenteditable="true"]',e=>e.getAttribute('contenteditable')),'true');check(mode+': редактор доступний після завершення');
 }
 assert.match((await page.$eval('#ai-result',e=>e.textContent))!,/Контрольований збій/);check('помилка провайдера видима');
 assert.deepEqual(errors,[]);check('немає помилок JavaScript');await page.screenshot({path:path.join(artifact,'editor-ai.png'),fullPage:true});
 await fs.writeFile(path.join(artifact,'report.json'),JSON.stringify({mode:'isolated real EditorView + controlled delayed HTTP provider; no full App or paid AI',checks,results},null,2));console.log(checks+' перевірок; артефакти: '+artifact);
}finally{release?.();await browser?.close();await new Promise<void>(r=>server.close(()=>r()));}
