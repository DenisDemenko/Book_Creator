import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from './auth';
import { DATA_DIR } from './db';
import { getBook } from './bookStore';
import { safeCompletedSessionSummary, type CompletedExperienceRecord, type ExperienceKind } from './storyExperienceRegistry';

const registryPath = path.join(DATA_DIR, 'story-experience-completed.json');
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
    let sourceBook;
    try { sourceBook = await getBook(body.bookId); } catch { res.status(500).json({error:'Не вдалося перевірити книгу'}); return; }
    if (!sourceBook || sourceBook.ownerId !== userId) { res.status(404).json({error:'Книгу не знайдено'}); return; }
    const record: CompletedExperienceRecord = {
      id: randomUUID(), ownerId: userId, bookId: body.bookId, title: body.title.slice(0,200), kind: body.kind,
      status:'completed', completedAt:new Date().toISOString(), publicParticipantLabels:[],
      events: body.events.map((e: any) => ({id:randomUUID(),label:e.label,description:e.description,approvedForBook:true,visibility:'approved' as const})),
    };
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
