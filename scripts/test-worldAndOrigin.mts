import assert from 'node:assert/strict';
import {acceptAiOrigin,aiOriginOpen,AI_ORIGIN_CLOSE,parseAiOriginOpen,stripAiTextMarkers,aiTextFragments,aiDraftText,acceptedAiText} from '../shared/aiTextOrigin';
import {markerStringToTiptapDoc,tiptapDocToMarkerString} from '../src/utils/manuscriptDoc';
import {stripEntityTags} from '../src/utils/coreEntities';
import {calculateWordCount,renderSectionBlocksHtml,renderSectionContentHtml} from '../src/utils/helpers';
import {exportBookToDocx,exportBookToEpub,exportParagraphs,bookToPlainText} from '../src/utils/fileExporters';
import {bookToMarkdown} from '../server/pdf/bookToMarkdown';
import {buildDesigncraftRtf,rtfText} from '../server/pdf/designcraft/rtf';
import {manuscriptTagIndex,filterTagIndex,taggedContext} from '../src/utils/manuscriptTagIndex';
import {replaceRanges} from '../src/utils/searchScope';
import {worldProse,insertWorldDescription} from '../src/utils/storyWorld';
import {worldCanon,WIZARD_STEPS,storyWorldSchema} from '../shared/storyWorld';
import {wizardContext} from '../server/expressPrompt';
import {expressPlanToBook} from '../src/utils/expressBookPlan';
import {buildStarterBook} from '../src/utils/starterBook';
import {MemoryCoreRepository} from '../server/core/memoryRepository';
import {syncBookToCore} from '../server/core/sync';
let count=0;const check=(name:string,f:()=>void)=>{f();count++;console.log('✓ '+name);};
const origin=acceptAiOrigin('writer',null,'2026-10-15T10:00:00Z','fragment-1');
const accepted=aiOriginOpen(origin)+'\n\nСонце освітило камінь.\n\nДругий абзац.\n\n'+AI_ORIGIN_CLOSE;
const tagged='[/world:Острів] [/location:Вежа]\n\n'+accepted;
const base=buildStarterBook({bookId:'world-origin-test',title:'Світ',author:'Автор',role:'writer',now:0});
const book={...base,chapters:[{...base.chapters[0],id:'c',sections:[{...base.chapters[0].sections[0],id:'s',content:tagged}]}]};
check('accepted origin is stable, explicit and whitelist-only',()=>{assert.deepEqual(parseAiOriginOpen(aiOriginOpen({...origin,secret:'no'} as any)),origin);assert.equal(acceptAiOrigin('other',origin),origin);});
check('invalid or forged metadata cannot become accepted origin',()=>{assert.equal(parseAiOriginOpen('[AI-GENERATED:%broken]'),null);assert.equal(parseAiOriginOpen('[AI-GENERATED:%7B%7D]'),null);});
check('accepted marker roundtrips with exact fragment ID and paragraphs',()=>assert.equal(tiptapDocToMarkerString(markerStringToTiptapDoc(tagged)),tagged));
check('editing the prose preserves AI origin',()=>{const doc=markerStringToTiptapDoc(accepted);doc.content![0].content![0].content![0].text='Змінений автором текст.';const text=tiptapDocToMarkerString(doc);assert.equal(aiTextFragments(text)[0].origin?.id,'fragment-1');assert.ok(text.includes('Змінений'));});
check('nested regeneration preserves both origins and content',()=>{const nested=aiOriginOpen(origin)+'\n\nПочаток.\n\n'+acceptedAiText('Нова пропозиція.')+'\n\nКінець.\n\n'+AI_ORIGIN_CLOSE;assert.equal(tiptapDocToMarkerString(markerStringToTiptapDoc(nested)),nested);});
check('empty deleted blocks leave no dangling AI tags',()=>assert.equal(tiptapDocToMarkerString(markerStringToTiptapDoc(aiOriginOpen(origin)+'\n\n'+AI_ORIGIN_CLOSE)),''));
check('legacy inline AI wrappers become real reviewable blocks',()=>assert.equal(markerStringToTiptapDoc('[AI-DRAFT]Знайомий текст.[/AI-DRAFT]').content![0].type,'aiDraft'));
check('world entry uses the same canon without conflicting old seed rules',()=>{const prompt=wizardContext({entryMode:'world',scenarioInputs:{worldRules:'OLD_RULE'},storyWorld:{id:'w',name:'Острів',description:'',rules:'NEW_RULE',approved:true}});assert.ok(prompt.includes('NEW_RULE')&&!prompt.includes('OLD_RULE'));});
check('legacy drafts remain drafts; manual legacy text is never guessed AI',()=>{assert.equal(aiTextFragments(aiDraftText('Чернетка.'))[0].status,'draft');assert.equal(aiTextFragments('Мій старий текст.').length,0);});
check('exports retain prose with identical paragraphs and counts',()=>{assert.equal(stripEntityTags(tagged).trim(),'Сонце освітило камінь.\n\nДругий абзац.');assert.equal(calculateWordCount(tagged),5);assert.deepEqual(exportParagraphs(tagged),['Сонце освітило камінь.','Другий абзац.']);});
check('HTML, Nova/spread renderers contain no metadata or spacing artifacts',()=>{const plain={...book,chapters:book.chapters.map(c=>({...c,sections:c.sections.map(s=>({...s,content:stripEntityTags(tagged)}))}))};for(const render of [renderSectionBlocksHtml,renderSectionContentHtml])assert.equal(render(tagged,book,[],[]),render(stripEntityTags(tagged),plain,[],[]));});
check('Chromium/Pandoc Markdown and DesignCraft input strip origin',()=>{for(const output of [bookToMarkdown(book as any).markdown,buildDesigncraftRtf(book as any).rtf.replace(/<0x([0-9A-F]{4})>/g,(_,h)=>String.fromCharCode(parseInt(h,16))),bookToPlainText(book)]){assert.ok(output.includes('Сонце'));assert.ok(!output.includes('AI-GENERATED')&&!output.includes('fragment-1')&&!output.includes('acceptedBy'));}});
check('new AI draft cannot inherit a previous acceptance',()=>{const fresh=aiDraftText(accepted);assert.ok(!fresh.includes('AI-GENERATED'));assert.equal(aiTextFragments(fresh)[0].status,'draft');});
check('compound tag index includes entity and AI origin with exact source offsets',()=>{const rows=filterTagIndex(manuscriptTagIndex(book),{tags:['/location:Вежа','origin:ai'],status:'accepted'});assert.equal(rows.length,2);assert.equal(rows[0].blockId,'fragment-1');assert.equal(tagged.slice(rows[0].start,rows[0].end),rows[0].text);assert.ok(taggedContext(rows).includes('[c/s:'));});
check('search replacement cannot rewrite accepted metadata',()=>{const a=accepted.indexOf('fragment-1');assert.equal(replaceRanges(accepted,[[a,a+10]],'bad'),accepted);});

check('index does not carry a replaced location into the next scene',()=>{
 const b={chapters:[{id:'c',sections:[{id:'s',content:'[/location:Вежа]\n\nТут вежа.\n\n[/location:Міст]\n\nТут міст.'}]}]};
 assert.equal(filterTagIndex(manuscriptTagIndex(b),{tags:['/location:Вежа']}).length,1);
});
check('legacy inline AI source is indexed without mislabeling adjacent manual text',()=>{
 const rows=manuscriptTagIndex({chapters:[{id:'c',sections:[{id:'s',content:'Ручне.[AI-DRAFT]Штучне.[/AI-DRAFT]Ручне далі.'}]}]});
 assert.deepEqual(rows.map(r=>[r.text,r.status]),[['Ручне.','unmarked'],['Штучне.','draft'],['Ручне далі.','unmarked']]);
});
const world={id:'w',name:'Острів',description:'Кам’яна вежа.',rules:'Магія не повертає час.',notes:'DO_NOT_SEND_NOTES',approved:true};
check('only confirmed canon is included in every wizard AI context',()=>{const prompt=wizardContext({storyWorld:world});assert.ok(prompt.includes(world.rules));assert.ok(!prompt.includes(world.notes));assert.equal(worldCanon({...world,approved:false}),null);});
check('world stage preserves legacy steps and validates payload',()=>{assert.deepEqual(WIZARD_STEPS.map(s=>s.number),[1,6,2,3,4,5]);assert.ok(storyWorldSchema.safeParse(world).success);assert.ok(!storyWorldSchema.safeParse({...world,rules:'x'.repeat(8001)}).success);});
check('wizard handoff keeps world canon outside manuscript prose',()=>{const result=expressPlanToBook(base,{storyWorld:world},1);assert.deepEqual(result.storyWorld,world);assert.ok(!result.chapters.some(c=>c.sections.some(s=>s.content.includes(world.rules))));});
check('manual world description from an AI image is still manual text',()=>{const text=worldProse(world,'world');assert.ok(!text.includes('AI-GENERATED'));assert.ok(text.includes('[/world:Острів]'));});
check('accepted AI world description retains origin on explicit insertion',()=>{const value={...world,descriptionOrigin:origin};const result=insertWorldDescription(book,'c','s',worldProse(value,'world'),'start')!;assert.ok(result.chapters[0].sections[0].content.includes('fragment-1'));assert.equal(insertWorldDescription(book,'c','missing','x'),null);assert.equal(book.chapters[0].sections[0].content,tagged);});

const blobs:Blob[]=[];const originalDocument=globalThis.document,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
try {
 URL.createObjectURL=(blob:Blob)=>{blobs.push(blob);return 'blob:origin-test';};URL.revokeObjectURL=()=>{};
 (globalThis as any).document={createElement:()=>({click(){}}),body:{appendChild(){},removeChild(){}}};
 await exportBookToDocx(book);await exportBookToEpub(book);
 const {default:JSZip}=await import('jszip');
 for(const [i,kind]of ['DOCX','EPUB'].entries()){
  const zip=await JSZip.loadAsync(await blobs[i].arrayBuffer());const documents=await Promise.all(Object.values(zip.files).filter(f=>/\.(?:xml|xhtml|html|opf)$/.test(f.name)).map(f=>f.async('string')));
  const all=documents.join('\n');
  check(kind+' real archive retains prose and excludes AI metadata',()=>{assert.ok(all.includes('Сонце освітило камінь.'));assert.ok(!all.includes('AI-GENERATED')&&!all.includes('fragment-1')&&!all.includes('acceptedBy'));});
 }
}finally{(globalThis as any).document=originalDocument;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}

const repo=new MemoryCoreRepository();
await syncBookToCore(repo,{id:book.id,ownerId:'writer',book:{...book,storyWorld:world,storyLocations:[{id:'l',name:'Вежа',description:'Камінь',approved:true}],chapters:book.chapters.map(c=>({...c,sections:c.sections.map(s=>({...s,setting:{id:'setting',name:'Зал',description:'Вікна',approved:true,locationId:'l'}}))}))}},{});

const w=await repo.findEntityByExternalRef(book.id,'world','studio:world:w');assert.ok(w);assert.ok(!JSON.stringify(w.canonical).includes('DO_NOT_SEND_NOTES'));
assert.equal((await repo.listEntities(book.id)).filter(e=>e.type==='location'&&e.name==='Вежа').length,1);
check('structured world cards reuse registry aliases without private notes',()=>assert.ok(w));
console.log('Підсумок: '+count+' пройшло.');
