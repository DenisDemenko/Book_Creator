import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {StoredBook} from '../../bookStore';
import type {EditionTerms,EditionView,EditionContext,EditionManuscript} from '../../../shared/labyrinthEdition';
import {GROUP_TERMS} from '../../../shared/labyrinthGroup';
import {LabyrinthError,stateHash} from './model';
import {editionTerms,editionManuscript,editionBookHash,editionName,editionText,type EditionOrigin} from './edition';
export interface EditionGuard {
  userId:string;
  recheck:()=>Promise<void>;
  canReadUser:(bookId:string,userId:string)=>Promise<boolean>;
  canPublish:()=>Promise<boolean>;
  canEditBook?:(bookId:string,userId:string)=>Promise<boolean>;
  readBook:(id:string)=>Promise<StoredBook|null>;
  fence:<T>(id:string,fn:(book:StoredBook)=>Promise<T>)=>Promise<T>;
  pendingProposals?:(id:string)=>Promise<boolean>;
  editorContributions?:(id:string)=>Promise<Array<{userId:string;sectionId:string;resultRevision:number}>>;
  candidates?:(bookId:string,sourceId:string)=>Promise<Array<{userId:string;alias:string}>>;
}
const fail=(status:number,message:string):never=>{throw new LabyrinthError(status,message);};
const uuid=(id:string)=>{if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))fail(404,'Видання не знайдено.');return id;};
const revision=(n:unknown)=>{if(!Number.isSafeInteger(n)||Number(n)<0)fail(422,'Вкажіть поточну ревізію.');return Number(n);};
const keyOf=(n:unknown)=>{if(typeof n!=='string'||!n.trim()||n.length>128)fail(422,'Потрібен ідентифікатор запиту.');return n as string;};
type Row={id:string;book_id:string;source_project_id:string;draft_id:string;owner_id:string;edition_version:number;revision:number;book_revision:number;source_book_hash:string;snapshot_hash:string;status:EditionView['status'];payload:any;created_at:Date;published_at:Date|null};

export class PgLabyrinthEditionStore {
  constructor(private readonly pool:Pool){}
  private async tx<T>(fn:(c:PoolClient)=>Promise<T>){const c=await this.pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  private async anchor(c:PoolClient,book:StoredBook){
    const d=(await c.query('SELECT * FROM labyrinth_story_drafts WHERE new_book_id=$1 AND status=\'accepted\' FOR SHARE',[book.id])).rows[0];
    if(!d||book.id!=='LB-STORY-'+d.id)fail(404,'Ця книга не є прийнятою збіркою проходження.');
    const owner=(await c.query('SELECT owner_id FROM projects WHERE id=$1',[d.project_id])).rows[0]?.owner_id;
    if(!owner||book.ownerId!==owner)fail(409,'Власник джерела книги змінився.');
    return {d,owner:owner as string};
  }
  private async origins(c:PoolClient,book:StoredBook,g:EditionGuard,excluded:string[]=[]){
    if(!Array.isArray(book.book.chapters)||(book.book.chapters as any[]).some(ch=>!Array.isArray(ch.sections)))fail(422,'Некоректна структура рукопису.');
    const {d,owner}=await this.anchor(c,book),ignore=new Set(excluded);
    const bind=(await c.query('SELECT map_id,map_revision FROM labyrinth_runs WHERE project_id=$1 AND id=$2 FOR SHARE',[d.project_id,d.run_id])).rows[0];
    const h=(await c.query('SELECT active,revoked_through FROM labyrinth_reader_heads WHERE project_id=$1 AND map_id=$2 FOR SHARE',[d.project_id,d.map_id])).rows[0];
    const session=(await c.query('SELECT publication_revision FROM labyrinth_groups WHERE project_id=$1 AND run_id=$2 UNION ALL SELECT publication_revision FROM labyrinth_reader_sessions WHERE project_id=$1 AND run_id=$2',[d.project_id,d.run_id])).rows[0];
    if(!bind||!h?.active||!session||session.publication_revision<=h.revoked_through)fail(403,'Доступ до джерела проходження відкликано.');
    const definition=(await c.query('SELECT definition FROM labyrinth_versions WHERE project_id=$1 AND map_id=$2 AND revision=$3',[d.project_id,d.map_id,bind.map_revision])).rows[0]?.definition;
    if(!definition)fail(409,'Незмінну карту джерела не знайдено.');
    const all:EditionOrigin[]=[];
    const contributions:EditionContext['contributions']=[];
    for(const [i,b] of d.payload.blocks.entries()){
      const sectionId=book.id+'-s'+i;
      const present=(book.book.chapters as any[]).some(ch=>ch.sections?.some((s:any)=>s.id===sectionId));
      let userId:string|null=null;
      if(b.source.contributionId){
        const m=(await c.query("SELECT m.*,g.status AS member_status,g.candidate FROM labyrinth_group_messages m LEFT JOIN labyrinth_group_members g ON(g.project_id=m.project_id AND g.run_id=m.run_id AND g.hero_id=m.hero_id AND g.user_id=m.user_id) WHERE m.project_id=$1 AND m.run_id=$2 AND m.id=$3 AND m.channel='contribution' FOR SHARE OF m",[d.project_id,d.run_id,b.source.contributionId])).rows[0];
        if(!m)fail(409,'Джерело внеску не знайдено.');
        userId=m.user_id;
        const active=!!(m.consent_active&&m.member_status==='active'&&m.candidate&&m.terms===GROUP_TERMS&&await g.canReadUser(d.project_id,m.user_id));
        contributions.push({id:m.id,sectionId,userId:m.user_id,alias:m.alias,text:b.text,active});
        if(present&&!ignore.has(m.id)&&!active)fail(409,'Внесок утратив згоду або доступ. Вилучіть його з нової версії видання.');
      }
      all.push({sectionId,contributionId:b.source.contributionId,userId,originalText:b.text,nodeId:b.source.nodeId,heroId:b.source.heroId,aiAssisted:!!(b.aiAssisted||b.proposalOrigin==='ai')});
    }
    if(excluded.some(id=>!contributions.some(c=>c.id===id)))fail(422,'Вилучення не належить внескам цієї книги.');
    const edits=await g.editorContributions?.(book.id)??[];
    const required=new Set(all.filter(o=>o.userId&&o.contributionId&&!ignore.has(o.contributionId)&&(book.book.chapters as any[]).some(ch=>ch.sections?.some((s:any)=>s.id===o.sectionId))).map(o=>o.userId!));
    for(const e of edits)if(e.resultRevision<=book.revision&&e.userId!==owner&&(book.book.chapters as any[]).some(ch=>ch.sections?.some((s:any)=>s.id===e.sectionId))&&!all.some(o=>o.sectionId===e.sectionId&&o.contributionId&&ignore.has(o.contributionId))){
      required.add(e.userId);
      if(!all.some(o=>o.sectionId===e.sectionId&&o.userId===e.userId)){
        const original=all.find(o=>o.sectionId===e.sectionId);
        all.push({sectionId:e.sectionId,contributionId:null,userId:e.userId,originalText:original?.originalText??'',nodeId:original?.nodeId??null,heroId:original?.heroId??null,aiAssisted:original?.aiAssisted??false});
      }
    }
    return {d,owner,all,contributions,definition,required};
  }
  private async row(c:PoolClient,bookId:string,id:string,write=false){
    uuid(id);const row=(await c.query('SELECT * FROM labyrinth_book_editions WHERE book_id=$1 AND id=$2 FOR '+(write?'UPDATE':'SHARE'),[bookId,id])).rows[0] as Row;
    if(!row)fail(404,'Видання не знайдено.');return row;
  }
  private async allowed(c:PoolClient,r:Row,g:EditionGuard,manage=false){
    await g.recheck();
    const me=r.payload.terms.credits.find((p:any)=>p.userId===g.userId);
    if(g.userId!==r.owner_id&&(!me||manage))fail(404,'Ваше видання не знайдено.');
    if(!(await g.canReadUser(r.book_id,g.userId))&&!(await g.canReadUser(r.source_project_id,g.userId)))fail(403,'Доступ до видання відкликано.');
    return me;
  }
  private async proof(c:PoolClient,r:Row,g:EditionGuard,book?:StoredBook,requireFresh=false){
    const current=book??await g.readBook(r.book_id);if(!current||current.ownerId!==r.owner_id)fail(404,'Серверну книгу не знайдено.');
    const fresh=current.revision===r.book_revision&&editionBookHash(current.book)===r.source_book_hash;
    if(requireFresh&&!fresh)fail(409,'Рукопис змінився. Створіть нову версію й отримайте погодження знову.');
    // Published manuscripts stay immutable when the working book changes. Rights remain current.
    const checkBook=r.status==='published'||r.status==='withdrawn'?{...current,book:r.payload.sourceBook,revision:r.book_revision}:current;
    const origin=await this.origins(c,checkBook,g,r.payload.terms.excludeContributionIds);
    const ids=new Set(r.payload.terms.credits.map((p:any)=>p.userId));
    if([...origin.required].some(id=>!ids.has(id)))fail(409,'Додайте до умов усіх авторів включених внесків та правок.');
    for(const p of r.payload.terms.credits)if(!(await g.canReadUser(r.book_id,p.userId))&&!(await g.canReadUser(r.source_project_id,p.userId)))fail(403,'Доступ одного з учасників відкликано.');
    return {current,fresh,origin};
  }
  private async agreements(c:PoolClient,id:string){return (await c.query('SELECT * FROM labyrinth_edition_agreements WHERE edition_id=$1 ORDER BY id',[id])).rows;}
  private async view(c:PoolClient,r:Row,g:EditionGuard):Promise<EditionView>{
    const current=await g.readBook(r.book_id),fresh=!!current&&current.revision===r.book_revision&&editionBookHash(current.book)===r.source_book_hash;
    const agreements=await this.agreements(c,r.id),terms=r.payload.terms as EditionTerms;
    let rights=true;try{await this.proof(c,r,g,current??undefined);}catch(e){if(!(e instanceof LabyrinthError))throw e;rights=false;}
    const pending=r.status==='review'&&!!(await g.pendingProposals?.(r.book_id));
    const ready=r.status!=='withdrawn'&&rights&&!pending&&(r.status==='published'||fresh)&&agreements.every(a=>a.status==='approved'&&a.snapshot_hash===r.snapshot_hash);
    const mine=terms.credits.find(p=>p.userId===g.userId);
    const comments=(await c.query("SELECT id,payload,created_at FROM labyrinth_edition_events WHERE edition_id=$1 AND kind='comment' ORDER BY created_at,id LIMIT 200",[r.id])).rows;
    return {id:r.id,bookId:r.book_id,version:r.edition_version,revision:r.revision,bookRevision:r.book_revision,snapshotHash:r.snapshot_hash,status:r.status,fresh,ready,
      canManage:g.userId===r.owner_id,canPublish:!!(ready&&mine&&['author','publisher'].includes(mine.role)&&await g.canPublish()),canEditBook:!!(mine&&await g.canEditBook?.(r.book_id,g.userId)),
      commercial:terms.commercial,manuscript:r.payload.manuscript,
      agreements:terms.credits.map(p=>{const a=agreements.find(v=>v.user_id===p.userId);return {id:a.id,name:p.name,role:p.role,shareBps:p.shareBps,status:a.status,revision:a.revision,mine:p.userId===g.userId,note:a.user_id===g.userId||g.userId===r.owner_id?a.payload.note??'':''};}),
      ownContributions:(r.payload.origins as EditionOrigin[]).filter(o=>o.userId===g.userId&&!terms.excludeContributionIds.includes(o.contributionId!)).map(o=>({sectionId:o.sectionId,text:r.payload.sourceBook.chapters.flatMap((ch:any)=>ch.sections??[]).find((s:any)=>s.id===o.sectionId)?.content??'',originalText:o.originalText,aiAssisted:o.aiAssisted})),
      comments:comments.map(c=>({id:c.id,name:c.payload.name,text:c.payload.text,createdAt:new Date(c.created_at).toISOString()})),
      createdAt:new Date(r.created_at).toISOString(),publishedAt:r.published_at?new Date(r.published_at).toISOString():null};
  }
  private async receipt(c:PoolClient,book:string,user:string,key:string,hash:string){
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['edition:'+book+':'+user+':'+key]);
    const r=(await c.query('SELECT * FROM labyrinth_edition_requests WHERE book_id=$1 AND user_id=$2 AND key=$3',[book,user,key])).rows[0];
    if(r&&r.request_hash!==hash)fail(409,'Цей ключ уже використаний для іншого запиту.');return r;
  }
  private async record(c:PoolClient,r:Row,g:EditionGuard,key:string,hash:string,kind:string,payload:unknown){
    await c.query('INSERT INTO labyrinth_edition_requests(book_id,user_id,key,request_hash,edition_id) VALUES($1,$2,$3,$4,$5)',[r.book_id,g.userId,key,hash,r.id]);
    await c.query('INSERT INTO labyrinth_edition_events(edition_id,actor_id,kind,payload) VALUES($1,$2,$3,$4)',[r.id,g.userId,kind,JSON.stringify(payload)]);
  }
  async context(bookId:string,g:EditionGuard):Promise<EditionContext>{
    return g.fence(bookId,book=>this.tx(async c=>{
      const {owner}=await this.anchor(c,book);await g.recheck();if(g.userId!==owner)fail(404,'Авторські налаштування не знайдено.');
      const allIds=(await c.query("SELECT m.id FROM labyrinth_group_messages m JOIN labyrinth_story_drafts d ON(d.project_id=m.project_id AND d.run_id=m.run_id) WHERE d.new_book_id=$1 AND m.channel='contribution'",[bookId])).rows.map(r=>r.id);
      const o=await this.origins(c,book,g,allIds);
      const members=(await c.query('SELECT user_id,alias,candidate FROM labyrinth_group_members WHERE project_id=$1 AND run_id=$2 AND status=\'active\' AND user_id IS NOT NULL',[o.d.project_id,o.d.run_id])).rows;
      const required=new Set(o.all.filter(v=>v.userId&&(book.book.chapters as any[]).some(ch=>ch.sections?.some((s:any)=>s.id===v.sectionId))).map(v=>v.userId!));
      const candidates=new Map<string,EditionContext['candidates'][number]>();
      candidates.set(owner,{userId:owner,alias:String(book.book.author??'Письменник'),required:true,reason:'Власник книги'});
      for(const m of members)if(await g.canReadUser(o.d.project_id,m.user_id))candidates.set(m.user_id,{userId:m.user_id,alias:m.alias,required:required.has(m.user_id),reason:required.has(m.user_id)?'Внесок у рукопис':'Учасник проходження'});
      for(const p of await g.candidates?.(bookId,o.d.project_id)??[])if(!candidates.has(p.userId)&&((await g.canReadUser(bookId,p.userId))||(await g.canReadUser(o.d.project_id,p.userId))))candidates.set(p.userId,{...p,required:false,reason:'Учасник спільної роботи'});
      for(const e of await g.editorContributions?.(bookId)??[])candidates.set(e.userId,{userId:e.userId,alias:candidates.get(e.userId)?.alias??'Учасник редакції',required:true,reason:'Редакторські правки'});
      const editions=(await c.query('SELECT id,edition_version,status,payload->\'manuscript\'->>\'title\' AS title FROM labyrinth_book_editions WHERE book_id=$1 ORDER BY edition_version DESC LIMIT 50',[bookId])).rows;
      return {bookRevision:book.revision,ownerId:owner,candidates:[...candidates.values()],contributions:o.contributions,editions:editions.map(e=>({id:e.id,version:e.edition_version,status:e.status,title:e.title}))};
    }));
  }
  async create(bookId:string,expected:unknown,input:unknown,key:unknown,g:EditionGuard){
    const k=keyOf(key);revision(expected);const hash=stateHash({op:'create',expected,input});
    return g.fence(bookId,book=>this.tx(async c=>{
      const {owner}=await this.anchor(c,book);await g.recheck();if(g.userId!==owner)fail(403,'Версію видання готує власник книги.');
      const prior=await this.receipt(c,bookId,g.userId,k,hash);
      if(prior){const r=await this.row(c,bookId,prior.edition_id);await this.allowed(c,r,g);return this.view(c,r,g);}
      if(book.revision!==expected)fail(409,'Спочатку перечитайте актуальний рукопис.');
      if(await g.pendingProposals?.(bookId))fail(409,'Спочатку розгляньте всі редакторські пропозиції.');
      const terms=editionTerms(input,owner),o=await this.origins(c,book,g,terms.excludeContributionIds);
      if([...o.required].some(user=>!terms.credits.some(p=>p.userId===user)))fail(422,'Додайте всіх авторів включених внесків і правок або вилучіть відповідний внесок.');
      for(const p of terms.credits)if(!(await g.canReadUser(bookId,p.userId))&&!(await g.canReadUser(o.d.project_id,p.userId)))fail(403,'До видання можна додати тільки чинного учасника книги.');
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['edition-version:'+bookId]);
      const version=Number((await c.query('SELECT COALESCE(MAX(edition_version),0)+1 AS n FROM labyrinth_book_editions WHERE book_id=$1',[bookId])).rows[0].n),id=randomUUID();
      const manuscript=editionManuscript(book.book,id,version,terms,o.all,o.definition);
      const snapshotHash=stateHash({bookRevision:book.revision,bookHash:editionBookHash(book.book),terms,manuscript});
      const payload={terms,manuscript,origins:o.all,sourceBook:book.book};
      const r=(await c.query('INSERT INTO labyrinth_book_editions(id,book_id,source_project_id,draft_id,owner_id,edition_version,book_revision,source_book_hash,snapshot_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[id,bookId,o.d.project_id,o.d.id,owner,version,book.revision,editionBookHash(book.book),snapshotHash,JSON.stringify(payload)])).rows[0] as Row;
      for(const p of terms.credits)await c.query('INSERT INTO labyrinth_edition_agreements(edition_id,user_id,snapshot_hash,payload) VALUES($1,$2,$3,$4)',[id,p.userId,snapshotHash,JSON.stringify({name:p.name,role:p.role,note:''})]);
      await g.recheck();await this.record(c,r,g,k,hash,'created',{bookRevision:book.revision,snapshotHash});return this.view(c,r,g);
    }));
  }
  async get(bookId:string,id:string,g:EditionGuard){return this.tx(async c=>{const r=await this.row(c,bookId,id);await this.allowed(c,r,g);return this.view(c,r,g);});}
  async decide(bookId:string,id:string,input:any,key:unknown,g:EditionGuard){
    const k=keyOf(key),hash=stateHash({op:'decision',id,input});revision(input.expectedDecisionRevision);
    if(!['approve','decline','withdraw'].includes(input.decision)||typeof input.snapshotHash!=='string')fail(422,'Виберіть погодження, відмову або відкликання.');
    const note=editionText(input.note,2000,true);
    return g.fence(bookId,book=>this.tx(async c=>{
      const prior=await this.receipt(c,bookId,g.userId,k,hash),r=await this.row(c,bookId,id,true),credit=await this.allowed(c,r,g);
      if(prior)return this.view(c,r,g);
      const a=(await c.query('SELECT * FROM labyrinth_edition_agreements WHERE edition_id=$1 AND user_id=$2 FOR UPDATE',[id,g.userId])).rows[0];
      if(!a||!credit)fail(403,'Погоджувати можна тільки власну участь.');
      if(a.revision!==input.expectedDecisionRevision||r.snapshot_hash!==input.snapshotHash)fail(409,'Умови або ваше рішення змінилися. Перечитайте версію.');
      if(input.decision==='approve'){
        if(r.status!=='review')fail(409,'Цю версію вже опубліковано або відкликано.');
        if(input.reviewed!==true||input.agreeAuthorship!==true||input.agreeLicense!==true||input.agreePublication!==true||input.agreeShares!==true||editionName(input.publicName)!==credit.name)fail(422,'Окремо підтвердьте текст, роль, публічне ім’я, ліцензію, розповсюдження й частки.');
        await this.proof(c,r,g,book,true);
      }
      const status=input.decision==='approve'?'approved':input.decision==='decline'?'declined':'withdrawn';
      await c.query('UPDATE labyrinth_edition_agreements SET status=$3,revision=revision+1,payload=payload||$4::jsonb,updated_at=now() WHERE edition_id=$1 AND user_id=$2',[id,g.userId,status,JSON.stringify({note,decision:input.decision,snapshotHash:r.snapshot_hash,confirmations:input.decision==='approve'?{reviewed:true,authorship:true,license:true,publication:true,shares:true}:null})]);
      r.revision++;if(r.status==='published'&&status!=='approved')r.status='withdrawn';
      await c.query('UPDATE labyrinth_book_editions SET revision=$2,status=$3 WHERE id=$1',[id,r.revision,r.status]);
      await g.recheck();await this.record(c,r,g,k,hash,'decision',{decision:input.decision,agreementId:a.id,snapshotHash:r.snapshot_hash});return this.view(c,r,g);
    }));
  }
  async publish(bookId:string,id:string,expected:unknown,key:unknown,g:EditionGuard){
    const k=keyOf(key),hash=stateHash({op:'publish',id,expected});revision(expected);
    return g.fence(bookId,book=>this.tx(async c=>{
      const prior=await this.receipt(c,bookId,g.userId,k,hash),r=await this.row(c,bookId,id,true),credit=await this.allowed(c,r,g);
      if(!credit||!['author','publisher'].includes(credit.role)||!(await g.canPublish()))fail(403,'Опублікувати може погоджений письменник або видавець із правом публікації.');
      if(prior)return this.view(c,r,g);
      if(r.revision!==expected||r.status!=='review')fail(409,'Видання змінилося або вже опубліковане.');
      await this.proof(c,r,g,book,true);
      if(await g.pendingProposals?.(bookId))fail(409,'Залишилися нерозглянуті редакторські пропозиції.');
      if((await this.agreements(c,id)).some(a=>a.status!=='approved'||a.snapshot_hash!==r.snapshot_hash))fail(409,'Потрібне явне погодження кожного учасника цієї версії.');
      await g.recheck();if(!(await g.canPublish()))fail(403,'Право публікації відкликано.');
      r.revision++;r.status='published';r.published_at=new Date();
      await c.query("UPDATE labyrinth_book_editions SET revision=$2,status='published',published_at=$3 WHERE id=$1",[id,r.revision,r.published_at]);
      await this.record(c,r,g,k,hash,'published',{snapshotHash:r.snapshot_hash});return this.view(c,r,g);
    }));
  }
  async comment(bookId:string,id:string,text:unknown,key:unknown,g:EditionGuard){
    const value=editionText(text,4000),k=keyOf(key),hash=stateHash({op:'comment',id,text:value});
    return this.tx(async c=>{const prior=await this.receipt(c,bookId,g.userId,k,hash),r=await this.row(c,bookId,id,true),me=await this.allowed(c,r,g);if(prior)return this.view(c,r,g);
      const count=(await c.query("SELECT count(*)::int AS n FROM labyrinth_edition_events WHERE edition_id=$1 AND kind='comment'",[id])).rows[0].n;
      if(count>=200)fail(422,'Обговорення цієї версії досягло ліміту.');
      await this.record(c,r,g,k,hash,'comment',{text:value,name:me?.name??'Письменник'});return this.view(c,r,g);});
  }
  async inbox(sourceProjectId:string,g:EditionGuard){
    await g.recheck();if(!(await g.canReadUser(sourceProjectId,g.userId)))fail(403,'Доступ до книги відкликано.');
    const rows=(await this.pool.query('SELECT e.id,e.book_id,e.edition_version,e.status,e.payload->\'manuscript\'->>\'title\' AS title FROM labyrinth_book_editions e JOIN labyrinth_edition_agreements a ON(a.edition_id=e.id AND a.user_id=$2) WHERE e.source_project_id=$1 ORDER BY e.created_at DESC LIMIT 50',[sourceProjectId,g.userId])).rows;
    return rows.map(r=>({id:r.id,bookId:r.book_id,version:r.edition_version,status:r.status,title:r.title}));
  }
  async publication(id:string,g:EditionGuard,privateBookId?:string):Promise<EditionManuscript>{
    uuid(id);return this.tx(async c=>{
      const r=(await c.query('SELECT * FROM labyrinth_book_editions WHERE id=$1 FOR SHARE',[id])).rows[0] as Row;
      if(!r||(!privateBookId&&r.status!=='published')||(privateBookId&&r.book_id!==privateBookId))fail(404,'Опубліковане видання не знайдено.');
      if(privateBookId)await this.allowed(c,r,g);
      const view=await this.view(c,r,g);if(!view.ready)fail(privateBookId?409:404,'Видання ще не погоджено або доступ відкликано.');
      return r.payload.manuscript;
    });
  }
  async registeredStory(bookId:string){return !!(await this.pool.query('SELECT 1 FROM labyrinth_story_drafts WHERE new_book_id=$1 LIMIT 1',[bookId])).rowCount;}
  async ownerBookId(id:string){uuid(id);const r=(await this.pool.query('SELECT book_id FROM labyrinth_book_editions WHERE id=$1',[id])).rows[0];if(!r)fail(404,'Видання не знайдено.');return r.book_id as string;}
}
