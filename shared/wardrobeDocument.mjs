import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {stampFusionPdfHeader} from './fusion-pdf-branding.mjs';
export function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
export function fromBase64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
export function validateEditableDocument(d){
  const bad=()=>{throw Error('Некоректний редагований PDF-документ.');};
  if(!d||d.schema!=='fusionlab.wardrobe.pdf'||d.version!==1||typeof d.title!=='string'||d.title.length>300||!Array.isArray(d.pages)||!d.pages.length||d.pages.length>2000)bad();
  for(const key of ['backgroundPdf','font'])if(typeof d[key]!=='string'||d[key].length>(key==='font'?1500000:8000000)||!/^[A-Za-z0-9+/]*={0,2}$/.test(d[key]))bad();
  if(fromBase64(d.font).slice(0,4).toString()!=='0,1,0,0')bad();
  if(fromBase64(d.backgroundPdf).slice(0,5).toString()!=='37,80,68,70,45')bad();
  const ids=new Set(),blocks=new Set();let count=0;
  for(const p of d.pages){
    if(!p||typeof p.id!=='string'||p.id.length>100||ids.has(p.id)||typeof p.title!=='string'||p.title.length>500||!Array.isArray(p.blocks)||p.blocks.length>1000)bad();ids.add(p.id);
    for(const b of p.blocks){if(!b||typeof b.id!=='string'||blocks.has(b.id)||typeof b.text!=='string'||b.text.length>5000||![b.x,b.y,b.size,b.maxWidth].every(Number.isFinite)||b.x<0||b.x>842||b.y<0||b.y>596||b.size<4||b.size>48||b.maxWidth<1||b.maxWidth>842||!Array.isArray(b.color)||b.color.length!==3||b.color.some(c=>!Number.isFinite(c)||c<0||c>1))bad();blocks.add(b.id);count++;}
  }
  if(count>100000||!Array.isArray(d.pageOrder)||d.pageOrder.length!==ids.size||new Set(d.pageOrder).size!==ids.size||d.pageOrder.some(id=>!ids.has(id)))bad();
  for(const p of d.pages)for(const b of p.blocks)if(b.links&&(!Array.isArray(b.links)||b.links.length>10||b.links.some(l=>!l||typeof l.label!=='string'||l.label.length>80||!ids.has(l.pageId))))bad();
  if(!d.edits||typeof d.edits!=='object'||Array.isArray(d.edits)||Object.keys(d.edits).length>count)bad();
  for(const [id,v] of Object.entries(d.edits))if(!blocks.has(id)||!v||typeof v.text!=='string'||v.text.length>3000||(v.size!==undefined&&(!Number.isFinite(v.size)||v.size<4||v.size>32)))bad();
  if(!d.notes||typeof d.notes!=='object'||Array.isArray(d.notes)||Object.keys(d.notes).length>ids.size||Object.entries(d.notes).some(([id,s])=>!ids.has(id)||typeof s!=='string'||s.length>3000))bad();
  return d;
}
export async function renderEditableDocument(data,{onlyPage}={}){
  const d=validateEditableDocument(data),background=await PDFDocument.load(fromBase64(d.backgroundPdf));
  if(background.getPageCount()!==d.pages.length)throw Error('Кількість сторінок PDF не збігається з описом.');
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(fromBase64(d.font),{subset:false}),characters=new Set(font.getCharacterSet());
  function supported(s){for(const c of s)if(!characters.has(c.codePointAt(0)))throw Error(`Шрифт документа не містить символ ${c}. Замініть його.`);}
  const pages=new Map(d.pages.map((p,i)=>[p.id,{...p,index:i}])),numbers=new Map(d.pageOrder.map((id,i)=>[id,i+1]));
  const noteStarts=new Map();let totalPages=d.pages.length;
  for(const id of d.pageOrder)if(d.notes[id]?.trim()){
    noteStarts.set(id,totalPages+1);let count=1,y=510;
    for(const paragraph of d.notes[id].split('\n')){let row='';for(const char of paragraph){const next=row+char;if(font.widthOfTextAtSize(next,10)>770){y-=16;row=char;}else row=next;if(y<50){count++;y=540;}}y-=18;}
    totalPages+=count;
  }
  const changed=Object.keys(d.edits).length>0;
  for(const id of onlyPage?[onlyPage]:d.pageOrder){const source=pages.get(id);if(!source)throw Error('Аркуш не знайдено.');const [p]=await pdf.copyPages(background,[source.index]);pdf.addPage(p);
    for(const block of source.blocks){const edit=d.edits[block.id];let text=edit?.text??block.text;
      if(block.role==='page-number')text=`${numbers.get(id)} / ${totalPages}`;
      if(block.links)text='Аркуші присадок — '+block.links.map(link=>`${link.label}: ${numbers.get(link.pageId)??'—'}`).join('; ');
      supported(text);
      if(/[\r\n]/.test(text))throw Error('Для нового абзацу скористайтеся примітками до аркуша. Текстовий блок має один рядок.');
      const size=Math.min(edit?.size??block.size,block.maxWidth/Math.max(.01,font.widthOfTextAtSize(text,1)));
      if(size<4&&text)throw Error('Текст не вміщується: скоротіть його або перенесіть до приміток.');
      p.drawText(text,{x:block.x,y:block.y,size:Math.max(4,size),font,color:rgb(...block.color)});
    }
    if(changed)p.drawText('Текст відредаговано у Студії; геометрію та присадки визначає збережений проєкт.',{x:28,y:34,size:5.5,font,color:rgb(.5,.26,.1)});
  }
  const notes=(onlyPage?[onlyPage]:d.pageOrder).filter(id=>d.notes[id]?.trim());
  for(const id of notes){const source=pages.get(id);let p=pdf.addPage([841.89,595.28]),y=510;
    let noteNumber=noteStarts.get(id);const noteFooter=()=>p.drawText(`${noteNumber} / ${totalPages}`,{x:750,y:18,size:8,font});noteFooter();
    p.drawText(`Примітки · ${source.title}`,{x:28,y:552,size:13,font});
    supported(d.notes[id].replace(/[\r\n]/g,''));
    for(const paragraph of d.notes[id].split('\n')){let row='';for(const char of paragraph){const next=row+char;if(font.widthOfTextAtSize(next,10)>770){p.drawText(row,{x:28,y,size:10,font});y-=16;row=char;}else row=next;if(y<50){p=pdf.addPage([841.89,595.28]);noteNumber++;noteFooter();y=540;}}p.drawText(row,{x:28,y,size:10,font});y-=18;}
  }
  stampFusionPdfHeader(pdf,font);
  pdf.setTitle(d.title);pdf.setAuthor('Fusion Lab Studio');return pdf.save();
}
