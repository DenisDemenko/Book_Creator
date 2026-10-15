import assert from 'node:assert/strict';
import {BOOK_SCENARIOS} from '../shared/wizardScenarios';
import {wizardHarness} from './lib/wizardHarness.mts';
const h=await wizardHarness();let passed=0;
function check(name:string,ok:unknown){assert.ok(ok,name);passed++;console.log('✓ '+name);}
const source={id:'s1',kind:'note' as const,title:'Підтверджений посібник',text:'Fit A into B; check clips.',approved:true};
async function create(payload:any,user='writer'){if(payload.technical)payload.technical={modelCode:'',goal:'',...payload.technical};const r=await h.request('/api/express/draft','POST',{payload},user);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
async function suggest(d:any,stage:string,user='writer'){return h.request('/api/express/suggest','POST',{draftId:d.id,expectedRevision:d.revision,stage},user);}
try{
 for(const scenario of BOOK_SCENARIOS){
  const payload={entryMode:scenario.id,seed:'Книга про майстерню та вибір героїні',scenarioInputs:Object.fromEntries(scenario.fields.map(f=>[f.key,'AUTHOR_'+f.key])),sourcesPermission:true,framework:'psychotypes',cast:[{id:'marta',firstName:'Марта',lastName:'Лісова',approved:true}],sourceMaterials:[source,{...source,id:'hidden',text:'DO_NOT_SEND_PRIVATE',approved:false}]};
  const d=await create(payload),r=await suggest(d,'synopsis');
  check(scenario.id+' generates from selected scenario',r.status===200&&h.state.calls.at(-1)!.prompt.includes(scenario.rule));
  check(scenario.id+' excludes unapproved source',!h.state.calls.at(-1)!.prompt.includes('DO_NOT_SEND_PRIVATE'));
 }
 const anonymous=await create({seed:'Гостьовий задум'},'guest');
 const claimed=await h.request('/api/express/claim','POST',{draftId:anonymous.id,expectedRevision:anonymous.revision});
 check('anonymous draft claim advances revision and preserves payload',claimed.status===200&&claimed.body.userId==='writer'&&claimed.body.revision===2&&claimed.body.payload.seed==='Гостьовий задум');
 check('claimed draft is no longer a public capability',(await h.request('/api/express/draft/'+anonymous.id,'GET',undefined,'guest')).status===404);
 check('another user cannot claim an owned draft',(await h.request('/api/express/claim','POST',{draftId:anonymous.id,expectedRevision:2},'other')).status===404);
 const d=await create({entryMode:'characters_photos',cast:[{id:'marta',firstName:'Марта',lastName:'Лісова',approved:false}]});
 let count=h.state.calls.length,r=await suggest(d,'synopsis');
 check('unreviewed character blocks AI before provider',r.status===400&&h.state.calls.length===count);
 for(const user of ['other','guest','disabled']){
  r=await h.request('/api/express/draft/'+d.id,'GET',undefined,user);check(user+' cannot read owned draft',r.status===404);
  r=await h.request('/api/express/draft/'+d.id,'PATCH',{expectedRevision:d.revision,payload:{seed:'overwrite'}},user);check(user+' cannot edit owned draft',r.status===404);
 }
 r=await suggest(d,'synopsis','no-ai');check('AI role permission enforced',r.status===403);
 r=await create({entryMode:'collective',scenarioInputs:{contributors:'Спільна книга',permissions:'Угоди'},sourceMaterials:[source],sourcesPermission:false});
 count=h.state.calls.length;const denied=await suggest(r,'synopsis');check('collective consent required before AI',denied.status===400&&count===h.state.calls.length);
 for(const patch of [{entryMode:'invented'},{sourceMaterials:[source,source]},{sourceMaterials:[{...source,kind:'photo',assetId:'../private'}]},{sourceMaterials:[{...source,kind:'url',url:'http://localhost'}]},{cast:[{id:'a',firstName:123}]}]){
  const bad=await h.request('/api/express/draft','POST',{payload:patch});check('invalid scenario payload rejected',bad.status===400);
 }
 const reviewed=await create({seed:'Задум із підтвердженням',reviewConfirmed:true,structureConfirmed:true});
 const regenerated=await suggest(reviewed,'synopsis');
 check('regenerating reviewed content requires renewed author approval',regenerated.status===200&&!regenerated.body.draft.payload.reviewConfirmed&&!regenerated.body.draft.payload.structureConfirmed);
 const plain=await create({entryMode:'idea',seed:'Достатньо довгий задум',cast:[{id:'marta',firstName:'Марта',lastName:'Лісова'}],sourceMaterials:[source]});
 let latest=plain;
 for(let part=1;part<=3;part++){
  const result=await h.request('/api/express/generate','POST',{draftId:latest.id,expectedRevision:latest.revision,partNumber:part});
  check('part '+part+' has canonical id and global chapter number',result.status===200&&result.body.part.chapters[0].chapterNumber===part&&result.body.part.chapters[0].involvedCharacters[0]==='Марта Лісова');
  latest=result.body.draft;
 }
 h.state.badCharacter=true;
 r=await h.request('/api/express/generate','POST',{draftId:latest.id,expectedRevision:latest.revision,partNumber:1});
 check('unknown generated character id rejected',r.status===400);h.state.badCharacter=false;
 for(const endpoint of ['/sources/import-url','/sources/search','/sources/describe-photo','/technical/generate']){
  r=await h.request('/api/express'+endpoint,'POST',{},'guest');check(endpoint+' requires authentication',r.status===401);
 }
 r=await h.request('/api/express/sources/import-url','POST',{url:'https://manufacturer.example/manual'});
 check('web import returns unapproved text and provenance',r.status===200&&r.body.source.approved===false&&r.body.source.retrievedAt);
 r=await h.request('/api/express/sources/import-url','POST',{url:'http://127.0.0.1/private'});check('private URL rejected by real importer',r.status===422);
 r=await h.request('/api/express/sources/search','POST',{query:'T-42',domain:'manufacturer.example'});
 check('technical search is connected to route',r.status===200&&r.body.results.length===1);
 const photo=await h.media.saveAsset({ownerId:'writer',kind:'upload',filename:'reference.png',mimeType:'image/png',bytes:Buffer.from('fixture')});
 count=h.state.descriptions;r=await h.request('/api/express/sources/describe-photo','POST',{assetId:photo.id,modelId:'fixture-vision'},'other');
 check('foreign photo rejected before provider',r.status===404&&h.state.descriptions===count);
 r=await h.request('/api/express/sources/describe-photo','POST',{assetId:photo.id,modelId:'fixture-vision'});
 check('own photo returns unapproved description',r.status===200&&!r.body.approved&&h.state.descriptions===count+1);
 const technical=await create({track:'technical_instruction',technical:{mode:'assembly',title:'T-42',modelCode:'rev.1'},sourceMaterials:[{...source,approved:false}]});
 const generate=(draft:any,user='writer')=>h.request('/api/express/technical/generate','POST',{draftId:draft.id,expectedRevision:draft.revision},user);
 count=h.state.calls.length;r=await generate(technical);
 check('unapproved technical source blocks provider',r.status===400&&h.state.calls.length===count);
 let td=h.store.updateDraft(technical.id,{sourceMaterials:[source]},technical.revision)!;
 r=await generate(td,'other');check('foreign technical draft inaccessible',r.status===404);
 r=await generate(td);check('technical proposal stored with citation/hash/revision',r.status===200&&r.body.proposal.steps[0].sourceIds[0]==='s1'&&r.body.proposal.inputHash.length===64&&r.body.draft.revision===td.revision+1);
 td=r.body.draft;h.state.badCitation=true;const revision=td.revision;r=await generate(td);
 check('fabricated technical citation cannot save proposal',r.status===422&&h.store.getDraft(td.id)!.revision===revision);h.state.badCitation=false;
 let announce:()=>void,release:()=>void;
 const began=new Promise<void>(r=>announce=r),gate=new Promise<void>(r=>release=r);
 h.state.beforeReply=async()=>{announce();await gate;};
 const pending=generate(td);await began;h.store.updateDraft(td.id,{technical:{mode:'operation',title:'Newer',modelCode:'',goal:''}},td.revision);release();r=await pending;h.state.beforeReply=null;
 check('late technical response cannot overwrite newer product',r.status===409&&h.store.getDraft(td.id)!.payload.technical!.title==='Newer');
 const bound=await create({technical:{mode:'assembly',title:'T-42'},sourceMaterials:[{...source,kind:'photo',assetId:photo.id}]});
 const began2=new Promise<void>(r=>announce=r),gate2=new Promise<void>(r=>release=r);h.state.beforeReply=async()=>{announce();await gate2;};
 const late=generate(bound);await began2;await h.media.deleteAsset(photo.id,'writer');release();r=await late;h.state.beforeReply=null;
 check('revoked photo prevents late proposal persistence',r.status===409&&!h.store.getDraft(bound.id)!.payload.technical!.proposal);
 console.log('Підсумок: '+passed+' пройшло.');
}finally{await h.close();}
