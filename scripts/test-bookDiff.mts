import { diffSectionChange, applySectionPatch } from '../src/utils/bookDiff';

const mk = () => ({
  id:'BK1', title:'Книга', author:'А', genre:'g', synopsis:'s', logline:'l', theme:'t',
  version:'v1', revisionNumber:1, characters:[{id:'ch1',name:'Герой'}],
  layoutConfig:{formatPreset:'A5'}, visualBible:{artStyle:'x'}, versionHistory:[],
  updatedAt:'2026-01-01T00:00:00Z',
  chapters:[
    { id:'c1', bookId:'BK1', title:'Глава 1', order:1, sections:[
      { id:'s1', chapterId:'c1', title:'Пролог', order:1, content:'Текст А', wordCount:2, lastModified:'t0' },
      { id:'s2', chapterId:'c1', title:'Сцена',  order:2, content:'Текст Б', wordCount:2, lastModified:'t0' } ] },
    { id:'c2', bookId:'BK1', title:'Глава 2', order:2, sections:[
      { id:'s3', chapterId:'c2', title:'Фінал', order:1, content:'Текст В', wordCount:2, lastModified:'t0' } ] },
  ],
}) as any;

let pass=0, fail=0;
const t=(name:string, cond:boolean, extra='')=>{ cond?pass++:fail++; console.log(`${cond?'  ✓':'  ✗'} ${name}${extra?' — '+extra:''}`); };

console.log('diffSectionChange:');
// 1. правка тексту однієї секції (як це робить редактор)
{
  const a=mk(); const b={...a, updatedAt:'t1', chapters: a.chapters.map((c:any)=> c.id!=='c1'?c:({...c,
    sections:c.sections.map((s:any)=> s.id!=='s2'?s:({...s, content:'Текст Б+', wordCount:3, lastModified:'t1'}))}))};
  const p=diffSectionChange(a,b);
  t('правка тексту → патч', !!p && p.sectionId==='s2' && p.content==='Текст Б+' && p.wordCount===3, JSON.stringify(p));
  t('патч не тягне зайвого', !!p && Object.keys(p).sort().join()==='chapterId,content,lastModified,sectionId,wordCount');
}
// 2. перейменування секції → структурна зміна, патч не годиться
{
  const a=mk(); const b={...a, chapters:a.chapters.map((c:any)=> c.id!=='c1'?c:({...c,
    sections:c.sections.map((s:any)=> s.id!=='s1'?s:({...s, title:'Нова назва'}))}))};
  t('перейменування секції → null', diffSectionChange(a,b)===null);
}
// 3. додавання секції
{
  const a=mk(); const b={...a, chapters:a.chapters.map((c:any)=> c.id!=='c1'?c:({...c,
    sections:[...c.sections,{id:'s9',chapterId:'c1',title:'Нова',order:3,content:'',wordCount:0,lastModified:'t1'}]}))};
  t('додавання секції → null', diffSectionChange(a,b)===null);
}
// 4. зміна поля верхнього рівня (назва книги)
{
  const a=mk(); const b={...a, title:'Інша назва'};
  t('зміна назви книги → null', diffSectionChange(a,b)===null);
}
// 5. зміна персонажів
{
  const a=mk(); const b={...a, characters:[...a.characters,{id:'ch2',name:'Лиходій'}]};
  t('зміна персонажів → null', diffSectionChange(a,b)===null);
}
// 6. правки у двох секціях одночасно
{
  const a=mk(); const b={...a, chapters:a.chapters.map((c:any)=>({...c,
    sections:c.sections.map((s:any)=>({...s, content:s.content+'!'}))}))};
  t('дві глави змінено → null', diffSectionChange(a,b)===null);
}
// 7. однакові книги
{ const a=mk(); t('без змін → null', diffSectionChange(a,a)===null); }

console.log('\napplySectionPatch:');
{
  const a=mk();
  const out=applySectionPatch(a,{chapterId:'c1',sectionId:'s2',content:'Віддалений текст',wordCount:2});
  t('патч застосовано', out.chapters[0].sections[1].content==='Віддалений текст');
  t('незмінена глава зберегла ідентичність', out.chapters[1]===a.chapters[1]);
  t('незмінена секція зберегла ідентичність', out.chapters[0].sections[0]===a.chapters[0].sections[0]);
  t('персонажі не скопійовані', out.characters===a.characters);
  t('оригінал не мутовано', a.chapters[0].sections[1].content==='Текст Б');
}
{
  const a=mk();
  t('невідома секція → книга без змін', applySectionPatch(a,{chapterId:'c1',sectionId:'НЕМА',content:'x'})===a);
  t('невідома глава → книга без змін', applySectionPatch(a,{chapterId:'НЕМА',sectionId:'s1',content:'x'})===a);
  t('той самий вміст → книга без змін', applySectionPatch(a,{chapterId:'c1',sectionId:'s1',content:'Текст А'})===a);
}
console.log('\nround-trip:');
{
  const a=mk(); const b={...a, updatedAt:'t1', chapters:a.chapters.map((c:any)=> c.id!=='c2'?c:({...c,
    sections:c.sections.map((s:any)=> ({...s, content:'Змінений фінал', wordCount:2, lastModified:'t1'}))}))};
  const p=diffSectionChange(a,b)!;
  const applied=applySectionPatch(a,p);
  t('після патча текст збігається з очікуваним', applied.chapters[1].sections[0].content===b.chapters[1].sections[0].content);
}
console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail?1:0);
