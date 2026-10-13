import type {EditionManuscript} from '../../../shared/labyrinthEdition';
import {EDITION_ROLE_LABELS} from '../../../shared/labyrinthEdition';
import {escapeHtml} from '../../pdf/html/bookHtml';
import {EDITION_READER_THEME} from '../../../shared/labyrinthEditionTheme';
import {editionBrand} from './editionBrand';

export function editionMarkdown(m:EditionManuscript){
  return '# '+m.title+'\n\n'+m.authors.map(a=>EDITION_ROLE_LABELS[a.role]+': '+a.name).join('\n')+'\n\n'+m.licenseText+
    '\n\nВерсія видання: '+m.version+'\n\n## Як створено цю історію\n\n'+m.foreword+'\n\n'+
    (m.acknowledgements?'## Подяки\n\n'+m.acknowledgements+'\n\n':'')+m.pages.map(p=>'## '+p.title+'\n\n'+p.text).join('\n\n');
}
/** Constant player code: manuscript text is assigned through textContent, never innerHTML. */
const PLAYER=String.raw`const m=JSON.parse(document.getElementById('edition-data').textContent);
const choice=document.getElementById('page'),title=document.getElementById('scene-title'),text=document.getElementById('scene-text'),place=document.getElementById('place'),map=document.getElementById('map'),level=document.getElementById('map-level');
m.pages.forEach((p,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=(i+1)+'. '+p.title;choice.append(o);});
let current=0;
const ns='http://www.w3.org/2000/svg';
function draw(){map.replaceChildren();const nodes=m.map.nodes.filter(n=>n.level===level.value);if(!nodes.length)return;
 const xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y),span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),1),pad=span*.12,left=Math.min(...xs)-pad,top=Math.min(...ys)-pad,width=Math.max(...xs)-left+pad,height=Math.max(...ys)-top+pad;
 map.setAttribute('viewBox',[left,top,Math.max(width,span*.5),Math.max(height,span*.5)].join(' '));
 m.map.edges.forEach(e=>{const a=nodes.find(n=>n.id===e.from),b=nodes.find(n=>n.id===e.to);if(!a||!b)return;const line=document.createElementNS(ns,'line');['x1','y1','x2','y2'].forEach((k,i)=>line.setAttribute(k,String([a.x,a.y,b.x,b.y][i])));line.setAttribute('stroke','#64748b');line.setAttribute('stroke-width',String(span*.01));map.append(line);});
nodes.forEach(n=>{const c=document.createElementNS(ns,'circle');c.setAttribute('cx',String(n.x));c.setAttribute('cy',String(n.y));c.setAttribute('r',String(span*(n.id===m.pages[current].nodeId ? 0.05 : 0.025)));c.setAttribute('class',n.id===m.pages[current].nodeId?'map-point is-current':'map-point');map.append(c);});
}
function show(){const p=m.pages[current];choice.value=String(current);title.textContent=p.title;text.textContent=p.text;const n=m.map.nodes.find(n=>n.id===p.nodeId);if(n)level.value=n.level;place.textContent=n?n.label+' · '+(n.level==='upper'?'Надстінні мости':'Нижні коридори'):'Авторська вставка';document.getElementById('previous').disabled=current===0;document.getElementById('next').disabled=current===m.pages.length-1;document.getElementById('reader-progress').textContent='Розділ '+(current+1)+' із '+m.pages.length;map.setAttribute('aria-label','Пройдений маршрут; '+place.textContent);draw();}
level.addEventListener('change',draw);
choice.addEventListener('change',()=>{current=Number(choice.value);show();});
document.getElementById('previous').addEventListener('click',()=>{current=Math.max(0,current-1);show();title.focus();});
document.getElementById('next').addEventListener('click',()=>{current=Math.min(m.pages.length-1,current+1);show();title.focus();});
document.getElementById('print').addEventListener('click',()=>window.print());
const themeButton=document.getElementById('reader-theme');
function themeLabel(){const light=document.documentElement.dataset.theme==='light';themeButton.textContent=light?'Темна тема':'Світла тема';themeButton.setAttribute('aria-pressed',String(light));}
themeButton.addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=theme;try{localStorage.setItem('nova_theme',theme);}catch{}themeLabel();});themeLabel();
document.addEventListener('keydown',e=>{if(['SELECT','INPUT','TEXTAREA','BUTTON'].includes(document.activeElement.tagName))return;if(e.key==='ArrowRight')document.getElementById('next').click();if(e.key==='ArrowLeft')document.getElementById('previous').click();});show();`;
const THEME_BOOT=String.raw`try{document.documentElement.dataset.theme=localStorage.getItem('nova_theme')==='light'?'light':'dark';}catch{document.documentElement.dataset.theme='dark';}`;
export function editionHtml(m:EditionManuscript,nonce:string){
  const e=escapeHtml,raw=JSON.stringify(m).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const authors=m.authors.map(a=>EDITION_ROLE_LABELS[a.role]+': '+a.name).join('\n');
  const brand=editionBrand();
  const linear=m.pages.map(p=>'<section><h2>'+e(p.title)+'</h2><p>'+e(p.text)+'</p></section>').join('');
  return '<!doctype html><html lang="'+e(m.language)+'" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="author" content="'+e(m.authors.filter(a=>['author','coauthor'].includes(a.role)).map(a=>a.name).join(', '))+'"><title>'+e(m.title)+'</title>'+
    '<script nonce="'+e(nonce)+'">'+THEME_BOOT+'</script><style>'+EDITION_READER_THEME+'.edition-reader{--reader-bg:url("'+brand.background+'");}</style></head><body class="edition-reader">'+
    '<header class="reader-header"><a class="reader-brand" data-reader-brand href="https://www.fusionlab.in.ua/studio"><img src="'+brand.logo+'" alt="Fusion Lab Studio"><span><strong>FUSION LAB STUDIO</strong><small>Інтерактивне видання</small></span></a><div class="reader-header-actions"><a class="ed-button reader-studio-link" href="https://www.fusionlab.in.ua/studio">У Студію</a><button id="reader-theme" class="ed-button" data-reader-theme aria-label="Перемкнути тему">Світла тема</button></div></header><main class="reader-main">'+
    '<section class="reader-title"><span class="ed-badge ed-badge--published">Книга-лабіринт · видання '+m.version+'</span><h1>'+e(m.title)+'</h1><p>'+e(m.subtitle)+'</p><div class="print-credits"><p>'+e(authors)+'</p><p>'+e(m.licenseText)+'</p></div></section>'+
    '<div class="reader-layout"><div class="reader-book"><section class="reader-page" aria-label="Читання маршруту"><p class="page-label">Історія цього проходження</p><h2 id="scene-title" tabindex="-1"></h2><p id="scene-text"></p></section><div class="reader-toolbar"><span id="reader-progress" class="reader-progress" aria-live="polite"></span><div class="reader-nav"><button id="previous" class="ed-button">Назад</button><button id="next" class="ed-button ed-button--primary">Далі</button><button id="print" class="ed-button">Друк</button></div></div></div>'+
    '<aside class="reader-side" aria-label="Навігація і дані видання"><section class="ed-card"><h2>Розділи історії</h2><label>Поточний розділ<select id="page" class="ed-field" aria-label="Розділ видання"></select></label></section>'+
    '<section class="ed-card reader-map-card"><h2>Карта проходження</h2><p id="place" role="status"></p><label>Рівень карти<select id="map-level" class="ed-field"><option value="lower">Нижні коридори</option><option value="upper">Надстінні мости</option></select></label><svg id="map" class="reader-map" role="img" aria-label="Пройдений маршрут; поточне місце позначено"></svg><div class="reader-legend">Поточне місце героя</div></section>'+
    '<section class="ed-card"><h2>Автори видання</h2>'+(m.cover?'<img class="reader-cover" alt="Обкладинка погодженого видання" src="'+e(m.cover)+'">':'')+'<p class="reader-authors" data-edition-authors>'+e(authors)+'</p><p class="reader-license">'+e(m.licenseText)+'</p></section></aside></div>'+
    '<details class="ed-details reader-about"><summary>Як створено цю історію</summary><p>'+e(m.foreword)+'</p><p>'+e(m.acknowledgements)+'</p></details><article class="linear"><section><h2>Як створено цю історію</h2><p>'+e(m.foreword)+'</p><p>'+e(m.acknowledgements)+'</p></section>'+linear+'</article><noscript><article>'+linear+'</article></noscript><footer class="reader-footer">FUSION LAB STUDIO · Погоджена історія проходження</footer>'+
    '<script id="edition-data" type="application/json" nonce="'+e(nonce)+'">'+raw+'</script><script nonce="'+e(nonce)+'">'+PLAYER+'</script></main></body></html>';
}
