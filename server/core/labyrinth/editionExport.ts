import type {EditionManuscript} from '../../../shared/labyrinthEdition';
import {EDITION_ROLE_LABELS} from '../../../shared/labyrinthEdition';
import {escapeHtml} from '../../pdf/html/bookHtml';

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
 nodes.forEach(n=>{const c=document.createElementNS(ns,'circle');c.setAttribute('cx',String(n.x));c.setAttribute('cy',String(n.y));c.setAttribute('r',String(span*(n.id===m.pages[current].nodeId ? 0.05 : 0.025)));c.setAttribute('fill',n.id===m.pages[current].nodeId?'#14b8a6':'#475569');map.append(c);});
}
function show(){const p=m.pages[current];choice.value=String(current);title.textContent=p.title;text.textContent=p.text;const n=m.map.nodes.find(n=>n.id===p.nodeId);if(n)level.value=n.level;place.textContent=n?n.label+' · '+(n.level==='upper'?'Надстінні мости':'Нижні коридори'):'Авторська вставка';document.getElementById('previous').disabled=current===0;document.getElementById('next').disabled=current===m.pages.length-1;draw();}
level.addEventListener('change',draw);
choice.addEventListener('change',()=>{current=Number(choice.value);show();});
document.getElementById('previous').addEventListener('click',()=>{current=Math.max(0,current-1);show();title.focus();});
document.getElementById('next').addEventListener('click',()=>{current=Math.min(m.pages.length-1,current+1);show();title.focus();});
document.getElementById('print').addEventListener('click',()=>window.print());
document.addEventListener('keydown',e=>{if(['SELECT','INPUT','TEXTAREA','BUTTON'].includes(document.activeElement.tagName))return;if(e.key==='ArrowRight')document.getElementById('next').click();if(e.key==='ArrowLeft')document.getElementById('previous').click();});show();`;
export function editionHtml(m:EditionManuscript,nonce:string){
  const e=escapeHtml,raw=JSON.stringify(m).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const authors=m.authors.map(a=>EDITION_ROLE_LABELS[a.role]+': '+a.name).join('\n');
  const linear=m.pages.map(p=>'<section><h2>'+e(p.title)+'</h2><p>'+e(p.text)+'</p></section>').join('');
  return '<!doctype html><html lang="'+e(m.language)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="author" content="'+e(m.authors.filter(a=>['author','coauthor'].includes(a.role)).map(a=>a.name).join(', '))+'"><title>'+e(m.title)+'</title>'+
    '<style>body{margin:0;background:#f8fafc;color:#0f172a;font:18px/1.7 Georgia,serif}main{max-width:850px;margin:auto;padding:24px;overflow-wrap:anywhere}h1,h2{line-height:1.3}p{white-space:pre-wrap}button,select{font:inherit;min-height:44px;max-width:100%;padding:8px;border:1px solid #64748b;border-radius:8px;background:white;color:#0f172a}button:focus-visible,select:focus-visible{outline:3px solid #0d9488}button:disabled{opacity:.5}.actions{display:flex;flex-wrap:wrap;gap:10px}.cover{max-width:100%;max-height:500px}svg{width:100%;max-height:240px}.linear{display:none}@media print{.interactive,.actions{display:none}.linear{display:block}body{background:white}section{break-inside:avoid}}</style></head><body><main>'+
    '<h1>'+e(m.title)+'</h1><p>'+e(m.subtitle)+'</p>'+(m.cover?'<img class="cover" alt="Обкладинка погодженого видання" src="'+e(m.cover)+'">':'')+
    '<p data-edition-authors>'+e(authors)+'</p><p>'+e(m.licenseText)+'\nВерсія видання: '+m.version+'</p><details><summary>Як створено цю історію</summary><p>'+e(m.foreword)+'</p><p>'+e(m.acknowledgements)+'</p></details>'+
    '<section class="interactive" aria-label="Читання маршруту"><h2 id="scene-title" tabindex="-1"></h2><p id="scene-text"></p><p id="place" role="status"></p><label>Рівень карти <select id="map-level"><option value="lower">Нижні коридори</option><option value="upper">Надстінні мости</option></select></label><svg id="map" role="img" aria-label="Пройдений маршрут; поточне місце позначено"></svg></section>'+
    '<div class="actions"><label>Розділ <select id="page" aria-label="Розділ видання"></select></label><button id="previous">Назад</button><button id="next">Далі</button><button id="print">Друк</button></div><article class="linear">'+linear+'</article>'+
    '<noscript><article>'+linear+'</article></noscript><script id="edition-data" type="application/json" nonce="'+e(nonce)+'">'+raw+'</script><script nonce="'+e(nonce)+'">'+PLAYER+'</script></main></body></html>';
}
