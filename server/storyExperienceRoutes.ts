import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from './auth';
import { DATA_DIR } from './db';
import { getBook } from './bookStore';
import type { ExperienceEventKind, ExperienceEventRecord } from './storyExperienceEvents';
import { inspectApprovedExperience } from './storyExperiencePrivacy';
import { safeCompletedSessionSummary, type CompletedExperienceRecord, type ExperienceKind } from './storyExperienceRegistry';

const registryPath = path.join(DATA_DIR, 'story-experience-completed.json');
const journalPath = path.join(DATA_DIR, 'story-experience-journal.json');
interface DraftJournal { sessionId: string; bookId: string; ownerId: string; kind: ExperienceKind; status: 'draft' | 'completed'; events: ExperienceEventRecord[]; }
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
        if (journal.events.some(event=>event.id===eventId)) return 'duplicate' as const;
        if (journal.events.length>=10000) return 'limit' as const;
        // Treat incoming strings as untrusted: journal events are NEVER approved for book export.
        const event: ExperienceEventRecord = {id:eventId,sessionId:journal.sessionId,sequence:journal.events.length+1,
          kind,visibility:'private',approvedForBook:false,label:label.trim(),description:description.trim(),occurredAt:new Date().toISOString()};
        journal.events.push(event);
        await storeJournals(items);
        return event;
      });
      if(result==='missing'){res.status(404).json({error:'Журнал не знайдено'});return;}
      if(result==='duplicate'){res.status(409).json({error:'Подія вже існує'});return;}
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
      // Never return approved text or private data in list responses.
      res.json({ sessions: records.map(({events, publicParticipantLabels, ...r}) => ({ ...r, eventCount: events.length, participantCount: publicParticipantLabels.length })) });
    } catch { res.status(500).json({error:'Неможливо прочитати архів'}); }
  });
  app.post('/api/story-experience/completed', requireAuth, async (req: Request, res: Response) => {
    const userId = req.principal?.id;
    if (!userId) { res.status(401).json({error:'Потрібна авторизація'}); return; }
    const body = req.body || {};
    if (typeof body.bookId !== 'string' || !body.bookId.trim() || typeof body.title !== 'string' || !body.title.trim()
      || !safeKinds.has(body.kind) || body.confirmedForBook !== true
      || !Array.isArray(body.events) || body.events.length === 0 || body.events.length > 200
      || body.events.some((e: any) => !e || typeof e.label !== 'string' || typeof e.description !== 'string'
        || e.approvedForBook !== true || e.visibility !== 'approved'
        || e.label.length > 200 || e.description.length > 10000)) {
      res.status(400).json({error:'Потрібен погоджений набір дозволених подій'}); return;
    }
    const privacyIssues = inspectApprovedExperience(body.events, body.title);
    if (privacyIssues.length) { res.status(422).json({ error: 'У матеріалі виявлено можливі персональні ідентифікатори. Приберіть їх перед збереженням.', issues: privacyIssues }); return; }
    let sourceBook;
    try { sourceBook = await getBook(body.bookId); } catch { res.status(500).json({error:'Не вдалося перевірити книгу'}); return; }
    if (!sourceBook || sourceBook.ownerId !== userId) { res.status(404).json({error:'Книгу не знайдено'}); return; }
    const record: CompletedExperienceRecord = {
      id: randomUUID(), ownerId: userId, bookId: body.bookId, title: body.title.slice(0,200), kind: body.kind,
      status:'completed', completedAt:new Date().toISOString(), publicParticipantLabels:[],
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
