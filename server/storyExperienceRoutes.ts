import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from './auth';
import { findUserById, findUserByEmail } from './store';
import { DATA_DIR } from './db';
import { getBook } from './bookStore';
import type { ExperienceEventKind, ExperienceEventRecord } from './storyExperienceEvents';
import { inspectApprovedExperience, proposeExperienceRedactions } from './storyExperiencePrivacy';
import { consentMaterial, safeCompletedSessionSummary, type CompletedExperienceRecord, type ExperienceKind } from './storyExperienceRegistry';

const registryPath = path.join(DATA_DIR, 'story-experience-completed.json');
const journalPath = path.join(DATA_DIR, 'story-experience-journal.json');
interface DraftJournal { invitedParticipantIds?: string[]; participantIds?: string[]; sessionId: string; bookId: string; ownerId: string; kind: ExperienceKind; status: 'draft' | 'completed'; events: ExperienceEventRecord[]; }
async function loadJournals(): Promise<DraftJournal[]> {
  try { const data = JSON.parse(await fs.readFile(journalPath, 'utf8')); return Array.isArray(data) ? data : []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
async function storeJournals(items: DraftJournal[]): Promise<void> {
  await fs.mkdir(DATA_DIR, {recursive:true});
  const temp = journalPath + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(items), {mode:0o600});
  await fs.rename(temp,journalPath);
}
async function load(): Promise<CompletedExperienceRecord[]> {
  try { const data = JSON.parse(await fs.readFile(registryPath, 'utf8')); return Array.isArray(data) ? data : []; }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
}
let queue: Promise<void> = Promise.resolve();
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action);
  queue = result.then(() => undefined, () => undefined);
  return result;
}
const safeKinds = new Set<ExperienceKind>(['mafia','constellation','leela']);
export function registerStoryExperienceRoutes(app: Express): void {
  // Draft event journal is owner-scoped and never automatically approved for book use.
  app.post('/api/story-experience/journals', requireAuth, async (req: Request, res: Response) => {
    const ownerId = req.principal?.id;
    const {bookId,kind} = req.body || {};
    if (!ownerId) {res.status(401).json({error:'Авторизація потрібна'});return;}
    if (typeof bookId !== 'string' || !bookId || !safeKinds.has(kind)) {res.status(400).json({error:'Недійсні дані сесії'});return;}
    try {
      const book = await getBook(bookId);
      if (!book || book.ownerId !== ownerId) {res.status(404).json({error:'Книгу не знайдено'});return;}
      const record: DraftJournal = {sessionId:randomUUID(),bookId,ownerId,kind,status:'draft',events:[]};
      await enqueue(async()=>{ const items=await loadJournals();await storeJournals([...items,record]); });
      res.status(201).json({sessionId:record.sessionId});
    } catch {res.status(500).json({error:'Не вдалося створити журнал'});}
  });
  app.post('/api/story-experience/journals/:sessionId/events', requireAuth, async (req: Request, res: Response) => {
    const ownerId=req.principal?.id;
    if (!ownerId) {res.status(401).json({error:'Авторизація потрібна'});return;}
    const {bookId,kind,label,description,eventId} = req.body || {};
    const allowedKinds: ExperienceEventKind[] = ['game-action','vote','figure-move','snapshot','leela-move'];
    if (typeof bookId !== 'string' || !bookId || !allowedKinds.includes(kind) ||
      typeof label !== 'string' || typeof description !== 'string' ||
      !label.trim() || label.length>200 || description.length>2000 ||
      typeof eventId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(eventId)) {
      res.status(400).json({error:'Недійсні дані події'});return;
    }
    try {
      const book=await getBook(bookId);
      if (!book || book.ownerId !== ownerId) {res.status(404).json({error:'Книгу не знайдено'});return;}
      const result=await enqueue(async()=>{
        const items=await loadJournals();
        const journal=items.find(item=>item.sessionId===req.params.sessionId && item.bookId===bookId && item.ownerId===ownerId && item.status==='draft');
        if (!journal) return 'missing' as const;
        const previous = journal.events.find(event=>event.id===eventId);
        if (previous) return previous.kind===kind && previous.label===label.trim() && previous.description===description.trim() ? 'duplicate' as const : 'conflict' as const;
        if (journal.events.length>=10000) return 'limit' as const;
        // Treat incoming strings as untrusted: journal events are NEVER approved for book export.
        const event: ExperienceEventRecord = {id:eventId,sessionId:journal.sessionId,sequence:journal.events.length+1,
          kind,visibility:'private',approvedForBook:false,label:label.trim(),description:description.trim(),occurredAt:new Date().toISOString()};
        journal.events.push(event);
        await storeJournals(items);
        return event;
      });
      if(result==='missing'){res.status(404).json({error:'Журнал не знайдено'});return;}
      if(result==='duplicate'){res.status(200).json({eventId,alreadyRecorded:true});return;}
      if(result==='conflict'){res.status(409).json({error:'eventId зайнято іншою подією'});return;}
      if(result==='limit'){res.status(413).json({error:'Ліміт подій'});return;}
      res.status(201).json({eventId:result.id,sequence:result.sequence});
    } catch {res.status(500).json({error:'Не вдалося записати подію'});}
  });
  app.get('/api/story-experience/journals/:sessionId/review', requireAuth, async (req: Request, res: Response) => {
    const userId=req.principal?.id, bookId=req.query.bookId;
    if(!userId){res.status(401).json({error:'Авторизація потрібна'});return;}
    if(typeof bookId!=='string'){res.status(400).json({error:'Потрібен bookId'});return;}
    try {
      const book=await getBook(bookId);
      if(!book || book.ownerId!==userId){res.status(404).json({error:'Книгу не знайдено'});return;}
      const journal=(await loadJournals()).find(j=>j.sessionId===req.params.sessionId && j.bookId===bookId && j.ownerId===userId);
      if(!journal){res.status(404).json({error:'Журнал не знайдено'});return;}
      // The owner can review event payloads; no automatic approval or publication.
      res.json({sessionId:journal.sessionId,kind:journal.kind,status:journal.status,
        events:journal.events.map(e=>({id:e.id,kind:e.kind,label:e.label,description:e.description,visibility:e.visibility,approvedForBook:false}))});
    } catch {res.status(500).json({error:'Не вдалося прочитати журнал'});}
  });
  app.post('/api/story-experience/journals/:sessionId/complete', requireAuth, async (req: Request,res: Response) => {
    const ownerId=req.principal?.id, bookId=req.body?.bookId;
    if(!ownerId){res.status(401).json({error:'Авторизація потрібна'});return;}
    if(typeof bookId!=='string'){res.status(400).json({error:'Потрібен bookId'});return;}
    try {
      const book=await getBook(bookId);
      if(!book || book.ownerId!==ownerId){res.status(404).json({error:'Книгу не знайдено'});return;}
      const result=await enqueue(async()=>{
        const items=await loadJournals();
        const journal=items.find(j=>j.sessionId===req.params.sessionId && j.bookId===bookId && j.ownerId===ownerId);
        if(!journal)return 'missing' as const;
        if(journal.status==='completed')return 'already' as const;
        journal.status='completed';
        await storeJournals(items);
        return 'ok' as const;
      });
      if(result==='missing'){res.status(404).json({error:'Журнал не знайдено'});return;}
      res.json({sessionId:req.params.sessionId,status:'completed',alreadyCompleted:result==='already'});
    } catch {res.status(500).json({error:'Не вдалося завершити журнал'});}
  });
  app.get('/api/story-experience/completed', requireAuth, async (req: Request, res: Response) => {
    const userId = req.principal?.id;
    if (!userId) { res.status(401).json({error:'Потрібна авторизація'}); return; }
    try {
      const records = (await load()).filter(r => r.ownerId === userId && (!req.query.bookId || r.bookId === req.query.bookId));
      // Only owner-facing archive metadata. Never expose private participant identifiers or consent audit.
      res.json({ sessions: records.map(({events, canonicalEvents, publicParticipantLabels, consentRequiredParticipantIds, consentDecisions, ...r}) => ({ ...r, eventCount: canonicalEvents?.length ?? events.length, participantCount: publicParticipantLabels.length })) });
    } catch { res.status(500).json({error:'Неможливо прочитати архів'}); }
  });
  // The owner is a verified participant only when explicitly recorded against this journal.
  // Other participant enrollment must be authenticated; it is not inferred from names.
  // Invitations target existing, enabled site accounts and never enroll anyone automatically.
  app.post('/api/story-experience/journals/:sessionId/invite', requireAuth, async (req: Request,res: Response)=>{
    const ownerId=req.principal?.id;
    const {bookId,participantId,email}=req.body||{};
    if(!ownerId){res.status(401).json({error:'Авторизація потрібна'});return;}
    if(typeof bookId!=='string'||!(typeof participantId==='string'&&participantId.trim() || typeof email==='string'&&email.trim())){
      res.status(400).json({error:'Укажіть книгу та зареєстрованого користувача'});return;
    }
    try {
      const user=typeof email==='string'&&email.trim() ? await findUserByEmail(email.trim().toLowerCase()) : await findUserById(participantId);
      if(!user||user.disabled){res.status(404).json({error:'Зареєстрованого користувача не знайдено'});return;}
      const outcome=await enqueue(async()=>{
        const all=await loadJournals();
        const journal=all.find(j=>j.sessionId===req.params.sessionId&&j.bookId===bookId&&j.ownerId===ownerId&&j.status==='draft');
        if(!journal)return 'missing' as const;
        journal.invitedParticipantIds??=[];
        if(!journal.invitedParticipantIds.includes(user.id))journal.invitedParticipantIds.push(user.id);
        await storeJournals(all);return 'invited' as const;
      });
      if(outcome==='missing'){res.status(404).json({error:'Журнал недоступний'});return;}
      res.status(201).json({invited:true});
    }catch{res.status(500).json({error:'Не вдалося запросити учасника'});}
  });
  app.get('/api/story-experience/my-invitations',requireAuth,async(req:Request,res:Response)=>{
    const id=req.principal?.id;
    if(!id){res.status(401).json({error:'Авторизація потрібна'});return;}
    try{
      const all=await loadJournals();
      res.setHeader('Cache-Control','no-store');
      res.json({invitations:all.filter(j=>j.status==='draft'&&j.invitedParticipantIds?.includes(id))
        .map(j=>({sessionId:j.sessionId,bookId:j.bookId,kind:j.kind,joined:!!j.participantIds?.includes(id)}))});
    }catch{res.status(500).json({error:'Запрошення недоступні'});}
  });
  app.get('/api/story-experience/journals/:sessionId/participants',requireAuth,async(req:Request,res:Response)=>{
    const id=req.principal?.id,bookId=req.query.bookId;
    if(!id||typeof bookId!=='string'){res.status(400).json({error:'Недійсний запит'});return;}
    try{
      const journal=(await loadJournals()).find(j=>j.sessionId===req.params.sessionId&&j.bookId===bookId&&j.ownerId===id);
      if(!journal){res.status(404).json({error:'Журнал недоступний'});return;}
      res.setHeader('Cache-Control','no-store');
      res.json({participantIds:journal.participantIds??[],pendingCount:(journal.invitedParticipantIds??[]).filter(user=>!journal.participantIds?.includes(user)).length});
    }catch{res.status(500).json({error:'Помилка списку учасників'});}
  });
  app.post('/api/story-experience/journals/:sessionId/decline',requireAuth,async(req:Request,res:Response)=>{
    const id=req.principal?.id,bookId=req.body?.bookId;
    if(!id||typeof bookId!=='string'){res.status(400).json({error:'Недійсний запит'});return;}
    try{
      const result=await enqueue(async()=>{
        const items=await loadJournals();
        const journal=items.find(j=>j.sessionId===req.params.sessionId&&j.bookId===bookId&&j.status==='draft'&&j.invitedParticipantIds?.includes(id));
        if(!journal||journal.participantIds?.includes(id))return false;
        journal.invitedParticipantIds=journal.invitedParticipantIds?.filter(x=>x!==id);
        await storeJournals(items);return true;
      });
      if(!result){res.status(404).json({error:'Запрошення недоступне'});return;}
      res.json({declined:true});
    }catch{res.status(500).json({error:'Не вдалося відхилити запрошення'});}
  });
  app.post('/api/story-experience/journals/:sessionId/leave',requireAuth,async(req:Request,res:Response)=>{
    const userId=req.principal?.id,bookId=req.body?.bookId;
    if(!userId||typeof bookId!=='string'){res.status(400).json({error:'Недійсний запит'});return;}
    try{
      const outcome=await enqueue(async()=>{
        const all=await loadJournals();
        const journal=all.find(j=>j.sessionId===req.params.sessionId&&j.bookId===bookId&&j.status==='draft'&&j.participantIds?.includes(userId));
        if(!journal)return 'missing' as const;
        journal.participantIds=journal.participantIds?.filter(id=>id!==userId);
        journal.invitedParticipantIds=journal.invitedParticipantIds?.filter(id=>id!==userId);
        await storeJournals(all);
        return 'left' as const;
      });
      if(outcome==='missing'){res.status(404).json({error:'Участь недоступна для скасування'});return;}
      res.json({left:true});
    }catch{res.status(500).json({error:'Не вдалося вийти з сесії'});}
  });
  app.post('/api/story-experience/journals/:sessionId/join', requireAuth, async (req: Request,res: Response) => {
    const userId=req.principal?.id;
    const {bookId}=req.body||{};
    if(!userId){res.status(401).json({error:'Авторизація потрібна'});return;}
    if(typeof bookId!=='string'||!bookId){res.status(400).json({error:'Укажіть книгу'});return;}
    try {
      const status=await enqueue(async()=>{
        const records=await loadJournals();
        const journal=records.find(r=>r.sessionId===req.params.sessionId&&r.bookId===bookId&&r.status==='draft');
        if(!journal)return 'missing' as const;
        if(journal.ownerId!==userId && !journal.invitedParticipantIds?.includes(userId))return 'forbidden' as const;
        journal.participantIds ??=[];
        if(!journal.participantIds.includes(userId))journal.participantIds.push(userId);
        await storeJournals(records);
        return 'joined' as const;
      });
      if(status!=='joined'){res.status(404).json({error:'Журнал недоступний'});return;}
      res.json({joined:true});
    }catch{res.status(500).json({error:'Не вдалося підтвердити участь'});}
  });
  app.post('/api/story-experience/completed', requireAuth, async (req: Request, res: Response) => {
    const userId = req.principal?.id;
    if (!userId) { res.status(401).json({error:'Потрібна авторизація'}); return; }
    const body = req.body || {};
    if (typeof body.bookId !== 'string' || !body.bookId.trim() || typeof body.title !== 'string' || !body.title.trim()
      || !safeKinds.has(body.kind) || body.confirmedForBook !== true
      || !Array.isArray(body.events) || body.events.length === 0 || body.events.length > 200
      || !Array.isArray(body.consentRequiredParticipantIds) || body.consentRequiredParticipantIds.length === 0 || body.consentRequiredParticipantIds.length > 100
      || body.consentRequiredParticipantIds.some((id: unknown) => typeof id !== 'string' || !id.trim() || id.length > 128)
      || body.events.some((e: any) => !e || typeof e.label !== 'string' || typeof e.description !== 'string'
        || e.approvedForBook !== true || e.visibility !== 'approved'
        || e.label.length > 200 || e.description.length > 10000)) {
      res.status(400).json({error:'Потрібен погоджений набір дозволених подій'}); return;
    }
    if(typeof body.sourceJournalId!=='string'||!body.sourceJournalId.trim()){
      res.status(400).json({error:'Архівація потребує підтвердженого журналу-джерела та складу учасників'});return;
    }
    const journal=(await loadJournals()).find(item=>item.sessionId===body.sourceJournalId&&item.bookId===body.bookId&&item.ownerId===userId&&item.kind===body.kind&&item.status==='completed');
    const members=journal?.participantIds??[];
    if(!members.length || members.length!==body.consentRequiredParticipantIds.length ||
      !members.every(id=>body.consentRequiredParticipantIds.includes(id))){
      res.status(422).json({error:'Список учасників не відповідає підтвердженим учасникам журналу'});return;
    }
    const privacyIssues = inspectApprovedExperience(body.events, body.title);
    if (privacyIssues.length) { res.status(422).json({ error: 'У матеріалі виявлено можливі персональні ідентифікатори. Приберіть їх перед збереженням.', issues: privacyIssues }); return; }
    let sourceBook;
    try { sourceBook = await getBook(body.bookId); } catch { res.status(500).json({error:'Не вдалося перевірити книгу'}); return; }
    if (!sourceBook || sourceBook.ownerId !== userId) { res.status(404).json({error:'Книгу не знайдено'}); return; }
    const record: CompletedExperienceRecord = {
      id: randomUUID(), ownerId: userId, bookId: body.bookId, title: body.title.slice(0,200), kind: body.kind,
      status:'completed', completedAt:new Date().toISOString(), publicParticipantLabels:[],
      consentRequiredParticipantIds: [...new Set<string>(body.consentRequiredParticipantIds || [])], consentDecisions:[],
      events: body.events.map((e: any) => ({id:randomUUID(),label:e.label,description:e.description,approvedForBook:true,visibility:'approved' as const})),
    };
    record.canonicalEvents = record.events.map((e, i) => ({
      id: e.id, sessionId: record.id, sequence: i + 1, kind: 'note' as const,
      visibility: 'approved' as const, approvedForBook: true,
      label: e.label, description: e.description, occurredAt: record.completedAt,
    }));
    try {
      await enqueue(async () => { const items = await load(); await fs.mkdir(DATA_DIR,{recursive:true}); const tmp = registryPath + '.' + randomUUID() + '.tmp'; await fs.writeFile(tmp,JSON.stringify([...items,record]),{mode:0o600}); await fs.rename(tmp,registryPath); });
      res.status(201).json({sessionId:record.id});
    } catch { res.status(500).json({error:'Не вдалося зберегти сесію'}); }
  });
  // Preview only; does not mutate archived sessions or certify anonymization.
  app.post('/api/story-experience/privacy/preview', requireAuth, async (req: Request,res: Response) => {
    const userId=req.principal?.id;
    const {bookId,title,events}=req.body||{};
    if(!userId){res.status(401).json({error:'Потрібна авторизація'});return;}
    if(typeof bookId!=='string'||typeof title!=='string'||title.length>200||
      !Array.isArray(events)||events.length>200||events.some((event:any)=>!event||
      typeof event.label!=='string'||typeof event.description!=='string'||
      event.label.length>200||event.description.length>10000)){
      res.status(400).json({error:'Недійсний матеріал для перевірки'});return;
    }
    try{
      const book=await getBook(bookId);
      if(!book||book.ownerId!==userId){res.status(404).json({error:'Книгу не знайдено'});return;}
      res.setHeader('Cache-Control','no-store');
      res.json(proposeExperienceRedactions(events,title));
    }catch{res.status(500).json({error:'Перевірка приватності недоступна'});}
  });
  app.get('/api/story-experience/my-consents', requireAuth, async (req: Request, res: Response) => {
    const participantId = req.principal?.id;
    if (!participantId) { res.status(401).json({error:'Потрібна авторизація'}); return; }
    try {
      const records = (await load()).filter(record => record.consentRequiredParticipantIds?.includes(participantId));
      res.setHeader('Cache-Control','no-store');
      res.json({requests: records.map(record => {
        const decisions = (record.consentDecisions ?? []).filter(item => item.participantId === participantId && item.scope === 'book-adaptation');
        const latest = decisions[decisions.length - 1];
        // Never return event bodies, participants or other users' consent decisions.
        let material: {text:string;hash:string} | null = null;
        try { material = consentMaterial(record); } catch { /* Suppress content until privacy review. */ }
        return {sessionId:record.id,bookId:record.bookId,kind:record.kind,
          title:record.title,completedAt:record.completedAt,materialText:material?.text ?? '',materialHash:material?.hash ?? '',privacyReviewRequired:!material,
          status:latest?.status==='granted' && (!material || latest.materialHash!==material.hash) ? 'pending' : latest?.status ?? 'pending',decidedAt:latest?.decidedAt ?? null};
      })});
    } catch {res.status(500).json({error:'Не вдалося завантажити запити'});}
  });
  // Consent can only be granted or revoked by the authenticated participant.
  // Owner may designate required user IDs when archiving, but cannot sign for them.
  app.post('/api/story-experience/completed/:sessionId/consent', requireAuth, async (req: Request, res: Response) => {
    const participantId = req.principal?.id;
    const { bookId, decision, materialHash } = req.body || {};
    if (!participantId) { res.status(401).json({error:'Потрібна авторизація'}); return; }
    if (typeof bookId !== 'string' || !bookId || (decision !== 'granted' && decision !== 'revoked')) {
      res.status(400).json({error:'Недійсне рішення про згоду'}); return;
    }
    try {
      const result = await enqueue(async () => {
        const records = await load();
        const record = records.find(r => r.id === req.params.sessionId && r.bookId === bookId);
        if (!record || !record.consentRequiredParticipantIds?.includes(participantId)) return 'missing' as const;
        // Revocation is always permitted for the named participant, even if the
        // approved material was modified or subsequently fails the privacy check.
        // Only a new grant needs the current canonical material hash.
        let digest: string | undefined;
        if (decision === 'granted') {
          try { digest = consentMaterial(record).hash; }
          catch { return 'privacy' as const; }
          if (typeof materialHash !== 'string' || materialHash !== digest) return 'stale' as const;
        }
        record.consentDecisions ??= [];
        record.consentDecisions.push({participantId, scope:'book-adaptation', status:decision, ...(digest ? { materialHash:digest } : {}), decidedAt:new Date().toISOString()});
        const temp = registryPath + '.' + randomUUID() + '.tmp';
        await fs.writeFile(temp,JSON.stringify(records),{mode:0o600});
        await fs.rename(temp,registryPath);
        return 'saved' as const;
      });
      if (result === 'privacy') { res.status(409).json({error:'Матеріал потребує очищення персональних даних перед погодженням.'}); return; }
      if (result === 'stale') { res.status(409).json({error:'Матеріал змінився. Перегляньте його перед новим погодженням.'}); return; }
      if (result === 'missing') { res.status(404).json({error:'Для цього облікового запису згоди не запитували'}); return; }
      res.json({status:decision, scope:'book-adaptation'});
    } catch { res.status(500).json({error:'Не вдалося записати рішення'}); }
  });
  app.get('/api/story-experience/completed/:sessionId/book-material', requireAuth, async (req: Request,res: Response) => {
    const userId = req.principal?.id, bookId = req.query.bookId;
    if (!userId) { res.status(401).json({error:'Потрібна авторизація'}); return; }
    if (typeof bookId !== 'string') { res.status(400).json({error:'Укажіть bookId'}); return; }
    try {
      const sourceBook = await getBook(bookId);
      if (!sourceBook || sourceBook.ownerId !== userId) { res.status(404).json({error:'Книгу не знайдено'}); return; }
      const record = (await load()).find(r => r.id === req.params.sessionId && r.ownerId === userId && r.bookId === bookId);
      if (!record) { res.status(404).json({error:'Сесію не знайдено'}); return; }
      res.json(safeCompletedSessionSummary(record,{ownerId:userId,bookId,sessionId:req.params.sessionId}));
    } catch { res.status(422).json({error:'Матеріал недоступний для експорту'}); }
  });
}
