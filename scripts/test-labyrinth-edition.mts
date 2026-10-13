import assert from 'node:assert/strict';
import {editionTerms,editionManuscript,editionExportBook} from '../server/core/labyrinth/edition';
import {editionHtml} from '../server/core/labyrinth/editionExport';
import {labyrinthDemo} from '../shared/labyrinthDemo';
import {LabyrinthError} from '../server/core/labyrinth/model';
import type {EditionTerms} from '../shared/labyrinthEdition';
const terms:EditionTerms={license:'all-rights-reserved',licenseText:'',commercial:false,
  credits:[{userId:'ACCOUNT_OWNER',name:'Письменник',role:'author',shareBps:0},{userId:'ACCOUNT_MEMBER',name:'Псевдонім',role:'coauthor',shareBps:0}],excludeContributionIds:[],foreword:'Про створення',acknowledgements:'Подяки',cover:null};
let passed=0;const check=(name:string,fn:()=>void)=>{fn();passed++;console.log('✓ ВИДАННЯ: '+name);};
const bad=(input:unknown)=>assert.throws(()=>editionTerms(input,'ACCOUNT_OWNER'),e=>e instanceof LabyrinthError&&e.status===422);
check('Власник погоджує роль письменника; інший учасник не замінює його',()=>{bad({...terms,credits:terms.credits.slice(1)});bad({...terms,credits:[terms.credits[0],{...terms.credits[1],role:'author'}]});});
check('Дубль акаунта, невідома роль, email і приховані параметри відхиляються',()=>{bad({...terms,credits:[terms.credits[0],terms.credits[0]]});bad({...terms,credits:[{...terms.credits[0],role:'admin'}]});bad({...terms,credits:[{...terms.credits[0],name:'private@example.invalid'}]});bad({...terms,apiKey:'INJECTED'});});
check('Для продажу потрібні явні 100%, безоплатне видання не приховує часток',()=>{bad({...terms,commercial:true});bad({...terms,credits:[{...terms.credits[0],shareBps:100}]});const t=editionTerms({...terms,commercial:true,credits:terms.credits.map((c,i)=>({...c,shareBps:i?3000:7000}))},'ACCOUNT_OWNER');assert.equal(t.credits.reduce((n,c)=>n+c.shareBps,0),10000);});
check('Ліцензія має підтверджений текст; custom без умов не приймається',()=>{assert.ok(editionTerms({...terms,license:'CC-BY-4.0'},'ACCOUNT_OWNER').licenseText.includes('creativecommons.org'));bad({...terms,license:'custom'});});
check('URL, SVG і підроблена обкладинка не доходять до рендерера',()=>{bad({...terms,cover:'https://127.0.0.1/private'});bad({...terms,cover:'data:image/svg+xml;base64,PHN2Zz4='});bad({...terms,cover:'data:image/png;base64,YmFk'});});
const book={title:'Назва <script>alert(1)</script>',subtitle:'Підзаголовок',language:'uk',privateNotes:'SECRET_NOTE',characters:[{name:'SECRET_CHARACTER'}],chapters:[{id:'ch',order:1,title:'Глава',sections:[
  {id:'one',order:1,title:'Вхід',content:'[AI-DRAFT]Подія відбулась.[/AI-DRAFT]'},
  {id:'two',order:2,title:'Внесок',content:'Погоджений внесок'},
]}]};
const origins=[{sectionId:'one',contributionId:null,userId:null,originalText:'Подія',nodeId:'lower-entry',heroId:'hero',aiAssisted:true},
  {sectionId:'two',contributionId:'SOURCE_CONTRIBUTION_ID',userId:'ACCOUNT_MEMBER',originalText:'Внесок',nodeId:'lower-exit',heroId:'hero',aiAssisted:false}];
const normalized=editionTerms(terms,'ACCOUNT_OWNER');
const manuscript=editionManuscript(book,'00000000-0000-4000-8000-000000000001',1,normalized,origins,labyrinthDemo);
check('Публічний зріз не копіює приватні поля, акаунти, джерельні IDs або незвідані вузли',()=>{const text=JSON.stringify(manuscript);for(const marker of ['SECRET_NOTE','SECRET_CHARACTER','ACCOUNT_OWNER','ACCOUNT_MEMBER','SOURCE_CONTRIBUTION_ID','isolated-room'])assert.ok(!text.includes(marker));assert.equal(manuscript.map.nodes.length,2);assert.equal(manuscript.map.edges.length,1);});
check('Погоджений ШІ-текст позначено метаданими, службові DRAFT-теги не друкуються',()=>{assert.equal(manuscript.pages[0].aiAssisted,true);assert.equal(manuscript.pages[0].text,'Подія відбулась.');});
check('Вилучення внеску прибирає його текст, не тільки титульне ім’я',()=>{const removed=editionManuscript(book,'edition',2,{...normalized,excludeContributionIds:['SOURCE_CONTRIBUTION_ID']},origins,labyrinthDemo);assert.equal(removed.pages.length,1);assert.ok(!JSON.stringify(removed).includes('Погоджений внесок'));});
check('HTML екранує титул і JSON; статичний плеєр не вставляє рукопис через innerHTML',()=>{const html=editionHtml(manuscript,'nonce');assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('\\u003cscript'));assert.ok(!html.includes('.innerHTML'));assert.ok(html.includes('<noscript>'));});
check('Експорт має тільки погоджені автори, ролі, ліцензію, передмову та точний текст',()=>{const out=editionExportBook(manuscript);assert.equal(out.author,'Письменник, Псевдонім');assert.equal(out.status,'ready_to_publish');assert.equal(out.editionMetadata.version,1);assert.deepEqual(out.characters,[]);const text=JSON.stringify(out);assert.ok(text.includes('Співавтор'));assert.ok(text.includes('Про створення'));assert.ok(!text.includes('SECRET_NOTE'));});
console.log('Підсумок: '+passed+' пройшло.');
