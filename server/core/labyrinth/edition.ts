import { EDITION_ROLES, EDITION_ROLE_LABELS, type EditionTerms, type EditionManuscript } from '../../../shared/labyrinthEdition';
import { LabyrinthError, stateHash } from './model';
import { toParagraphs } from '../../pdf/pdfRenderer';
import { buildStarterBook } from '../../../src/utils/starterBook';
import type { LabyrinthDefinition } from '../../../shared/labyrinth';

const fail=(message:string):never=>{throw new LabyrinthError(422,message);};
export const editionText=(value:unknown,max:number,empty=false):string=>{
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))fail('Введіть текст у допустимому розмірі.');
  return (value as string).normalize('NFC').trim();
};
export const editionName=(value:unknown)=>{
  const name=editionText(value,80);if(name.includes('@')||/[\u0000-\u001f\u007f]/.test(name))fail('Вкажіть публічне ім’я або псевдонім, без email.');return name;
};
export function editionTerms(input:unknown,owner:string):EditionTerms {
  const x=input as EditionTerms;
  const fields=['license','licenseText','commercial','credits','excludeContributionIds','foreword','acknowledgements','cover'];
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==fields.length||Object.keys(x).some(k=>!fields.includes(k)))fail('Некоректні умови видання.');
  if(!['all-rights-reserved','CC-BY-4.0','custom'].includes(x.license)||typeof x.commercial!=='boolean')fail('Виберіть ліцензію та спосіб розповсюдження.');
  const licenseText=x.license==='CC-BY-4.0'?'Creative Commons Attribution 4.0 International — https://creativecommons.org/licenses/by/4.0/':
    x.license==='all-rights-reserved'?'Усі права захищено. Використання поза погодженими умовами потребує дозволу правовласників.':editionText(x.licenseText,8000);
  if(!Array.isArray(x.credits)||!x.credits.length||x.credits.length>50)fail('Додайте письменника та необхідних учасників (до 50).');
  const ids=new Set<string>();
  const credits=x.credits.map(c=>{
    if(!c||Object.keys(c).length!==4||Object.keys(c).some(k=>!['userId','name','role','shareBps'].includes(k))||typeof c.userId!=='string'||!c.userId||c.userId.length>160||ids.has(c.userId))fail('Кожен учасник має бути вказаний один раз.');
    ids.add(c.userId);
    if(!EDITION_ROLES.includes(c.role)||!Number.isSafeInteger(c.shareBps)||c.shareBps<0||c.shareBps>10000)fail('Некоректна роль або частка доходу.');
    return {...c,name:editionName(c.name)};
  });
  if(credits.filter(c=>c.role==='author').length!==1||!credits.some(c=>c.userId===owner&&c.role==='author'))fail('Письменник — власник книги; він також погоджує цю версію.');
  const sum=credits.reduce((v,c)=>v+c.shareBps,0);
  if((x.commercial&&sum!==10000)||(!x.commercial&&sum!==0))fail(x.commercial?'Для продажу погодьте розподіл 100% доходу.':'Для безоплатного видання частки доходу мають дорівнювати нулю.');
  if(!Array.isArray(x.excludeContributionIds)||x.excludeContributionIds.length>2500||new Set(x.excludeContributionIds).size!==x.excludeContributionIds.length||x.excludeContributionIds.some(id=>typeof id!=='string'||id.length>160))fail('Некоректний список вилучених внесків.');
  let cover:string|null=null;
  if(x.cover!==null){
    if(typeof x.cover!=='string'||x.cover.length>3*1024*1024||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(x.cover))fail('Обкладинка має бути PNG/JPEG до 2 МБ.');
    const bytes=Buffer.from(x.cover.split(',')[1],'base64');
    if(bytes.length>2*1024*1024||(x.cover.startsWith('data:image/png')?bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a':bytes.subarray(0,3).toString('hex')!=='ffd8ff'))fail('Некоректний файл обкладинки.');
    if(x.cover.startsWith('data:image/png')&&(bytes.length<24||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16000000))fail('Обкладинка завелика для перегляду.');
    cover=x.cover;
  }
  return {...x,licenseText,credits,cover,foreword:editionText(x.foreword,8000,true),acknowledgements:editionText(x.acknowledgements,4000,true)};
}

export interface EditionOrigin {
  sectionId:string; contributionId:string|null; userId:string|null;
  originalText:string; nodeId:string|null; heroId:string|null; aiAssisted:boolean;
}
export function editionManuscript(book:Record<string,any>,id:string,version:number,terms:EditionTerms,origins:EditionOrigin[],definition:LabyrinthDefinition):EditionManuscript {
  if(!Array.isArray(book.chapters)||!book.chapters.length)fail('У книги немає рукопису.');
  const excluded=new Set(terms.excludeContributionIds),nodes:EditionManuscript['map']['nodes']=[],edges:EditionManuscript['map']['edges']=[];
  const places=new Map<string,string>(),lastPlace=new Map<string,string>();
  const pages:EditionManuscript['pages']=[];
  for(const chapter of [...book.chapters].sort((a,b)=>(a.order??0)-(b.order??0))){
    if(!Array.isArray(chapter.sections))fail('Некоректні розділи рукопису.');
    for(const section of [...chapter.sections].sort((a,b)=>(a.order??0)-(b.order??0))){
      const origin=origins.find(o=>o.sectionId===section.id);
      if(origin?.contributionId&&excluded.has(origin.contributionId))continue;
      let nodeId:string|null=null;
      const node=origin?.nodeId?definition.nodes.find(n=>n.id===origin.nodeId):null;
      if(node){
        nodeId=places.get(node.id)??'place-'+(places.size+1);
        if(!places.has(node.id)){places.set(node.id,nodeId);nodes.push({id:nodeId,label:'Місце '+places.size,x:node.x,y:node.y,level:node.level});}
        if(origin?.heroId){const previous=lastPlace.get(origin.heroId);if(previous&&previous!==nodeId&&!edges.some(e=>e.from===previous&&e.to===nodeId))edges.push({from:previous,to:nodeId});lastPlace.set(origin.heroId,nodeId);}
      }
      const content=editionText(section.content??'',100000,true).replace(/\[\/?AI-DRAFT\]/g,'');
      const text=toParagraphs(content).join('\n\n');
      if(text)pages.push({id:'page-'+(pages.length+1),title:editionText(section.title||chapter.title||'Розділ',300),text,nodeId,aiAssisted:!!origin?.aiAssisted});
    }
  }
  if(!pages.length||pages.length>2500||Buffer.byteLength(JSON.stringify(pages))>2*1024*1024)fail('Видання має містити текст і вкладатися в ліміт 2 МБ.');
  return {id,version,title:editionText(book.title,300),subtitle:editionText(book.subtitle??'',300,true),language:['uk','en'].includes(book.language)?book.language:'uk',
    pages,map:{nodes,edges},foreword:terms.foreword||'Цю історію створено на основі завершеного проходження книги-лабіринта. Учасники погодили цю літературну версію та спосіб представлення своїх внесків.',
    acknowledgements:terms.acknowledgements,cover:terms.cover,authors:terms.credits.map(c=>({name:c.name,role:c.role})),license:terms.license,licenseText:terms.licenseText,aiAssisted:pages.some(p=>p.aiAssisted)};
}
export const editionBookHash=(book:Record<string,unknown>)=>stateHash(book);
export function editionExportBook(m:EditionManuscript){
  const author=m.authors.filter(c=>['author','coauthor'].includes(c.role)).map(c=>c.name).join(', ');
  const book=buildStarterBook({bookId:'LAB-EDITION-'+m.id,title:m.title,author,role:'writer',now:0});
  book.subtitle=m.subtitle;book.language=m.language;book.status='ready_to_publish';book.version=''+m.version;
  book.characters=[];book.versionHistory=[];
  const copyright=m.authors.map(a=>EDITION_ROLE_LABELS[a.role]+': '+a.name).join('\n')+'\n\n'+m.licenseText+'\n\nВерсія видання: '+m.version;
  const front=[{title:'Титульний склад і умови',content:copyright},{title:'Як створено цю історію',content:m.foreword}];
  if(m.acknowledgements)front.push({title:'Подяки',content:m.acknowledgements});
  book.chapters=[{id:'front',bookId:book.id,title:'Передмова',order:0,sections:front.map((s,i)=>({id:'front-'+i,chapterId:'front',order:i+1,...s,wordCount:s.content.split(/\s+/).length,lastModified:'1970-01-01T00:00:00Z'}))},
    {id:'story',bookId:book.id,title:'Історія проходження',order:1,sections:m.pages.map((p,i)=>({id:p.id,chapterId:'story',order:i+1,title:p.title,content:p.text,wordCount:p.text.split(/\s+/).length,lastModified:'1970-01-01T00:00:00Z'}))}];
  book.coverConfig.frontArtUrl=m.cover??undefined;
  book.coverConfig.coverImageUrl=m.cover??undefined;
  return {...book,editionMetadata:{id:m.id,version:m.version,authors:m.authors,license:m.license,licenseText:m.licenseText,aiAssisted:m.aiAssisted}};
}
