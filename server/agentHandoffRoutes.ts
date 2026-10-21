import { registerAgentCompanionRoutes } from './agentCompanionRoutes';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from './auth';
import { getDb } from './db';
import { HANDOFF_FIELDS, HANDOFF_REPOSITORIES, type HandoffDraft, type HandoffEntry } from '../src/types/agentHandoff';

function database() {
  const db = getDb();
  if (!db) throw new Error('SQLite недоступна. Журнал не збережено.');
  db.exec(`CREATE TABLE IF NOT EXISTS agent_session_handoffs (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    recorded_by TEXT NOT NULL,
    accepted_at TEXT,
    accepted_by TEXT,
    receiving_agent TEXT,
    receiving_session TEXT,
    acceptance_notes TEXT
  )`);
  return db;
}
function decode(row: Record<string, unknown>): HandoffEntry {
  return { ...JSON.parse(String(row.payload)), id: String(row.id),
    createdAt: String(row.created_at), recordedBy: String(row.recorded_by),
    acceptedAt: row.accepted_at as string | null, acceptedBy: row.accepted_by as string | null,
    receivingAgent: row.receiving_agent as string | null,
    receivingSession: row.receiving_session as string | null,
    acceptanceNotes: row.acceptance_notes as string | null };
}
function text(value: unknown, limit = 12000): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Некоректне або надто довге поле.');
  return value.trim();
}
export function registerAgentHandoffRoutes(app: Express): void {
  registerAgentCompanionRoutes(app);
  app.get('/api/admin/agent-handoffs', requireAdmin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const db = database();
      const rows = db.prepare('SELECT * FROM agent_session_handoffs ORDER BY created_at DESC, id DESC LIMIT 500').all();
      const total = db.prepare('SELECT COUNT(*) AS n FROM agent_session_handoffs').get() as { n: number };
      res.json({ entries: rows.map(row => decode(row as Record<string, unknown>)), total: total.n });
    } catch (error) {
      console.error('[agent-handoffs] read failed', error);
      res.status(503).json({ error: 'Серверне сховище журналу недоступне. Спробуйте пізніше.' });
    }
  });
  app.post('/api/admin/agent-handoffs', requireAdmin, (req, res) => {
    let draft: HandoffDraft;
    try {
      const body = req.body || {};
      if (!HANDOFF_REPOSITORIES.includes(body.repository)) throw new Error('Оберіть правильний репозиторій.');
      draft = { repository: body.repository } as HandoffDraft;
      for (const [key] of HANDOFF_FIELDS) draft[key] = text(body[key] ?? '');
      for (const key of ['agent', 'session', 'environment', 'branch', 'task', 'checks', 'remaining', 'next', 'evidence'] as const)
        if (!draft[key]) throw new Error('Заповніть обов’язкові поля; якщо даних немає, напишіть «не перевірено».');
      if (draft.commit && !/^[a-f0-9]{7,40}$/i.test(draft.commit)) throw new Error('SHA має містити від 7 до 40 шістнадцяткових символів.');
    } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    try {
      const db = database();
      const id = randomUUID();
      db.prepare('INSERT INTO agent_session_handoffs (id, payload, created_at, recorded_by) VALUES (?, ?, ?, ?)')
        .run(id, JSON.stringify(draft), new Date().toISOString(), req.principal!.id);
      res.status(201).json({ entry: decode(db.prepare('SELECT * FROM agent_session_handoffs WHERE id = ?').get(id) as Record<string, unknown>) });
    } catch (error) {
      console.error('[agent-handoffs] write failed', error);
      res.status(503).json({ error: 'Не вдалося зберегти передачу. Текст форми залишено для повторної спроби.' });
    }
  });
  app.post('/api/admin/agent-handoffs/:id/accept', requireAdmin, (req, res) => {
    let agent: string, session: string, notes: string;
    try {
      agent = text(req.body?.agent, 300); session = text(req.body?.session, 300);
      notes = text(req.body?.notes);
      if (!agent || !session || !notes) throw new Error('Вкажіть агента, нову сесію та результат перевірки гілки / SHA / контексту.');
    } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    try {
      const db = database();
      const row = db.prepare('SELECT * FROM agent_session_handoffs WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
      if (!row) { res.status(404).json({ error: 'Запис не знайдено.' }); return; }
      if (row.accepted_at) { res.status(409).json({ error: 'Передачу вже прийнято. Оновіть журнал.' }); return; }
      // One conditional UPDATE protects against concurrent acceptance.
      db.prepare(`UPDATE agent_session_handoffs
        SET accepted_at = ?, accepted_by = ?, receiving_agent = ?, receiving_session = ?, acceptance_notes = ?
        WHERE id = ? AND accepted_at IS NULL`)
        .run(new Date().toISOString(), req.principal!.id, agent, session, notes, req.params.id);
      const changes = db.prepare('SELECT changes() AS n').get() as { n: number };
      if (changes.n !== 1) { res.status(409).json({ error: 'Передачу вже прийнято іншою сесією.' }); return; }
      res.json({ entry: decode(db.prepare('SELECT * FROM agent_session_handoffs WHERE id = ?').get(req.params.id) as Record<string, unknown>) });
    } catch (error) {
      console.error('[agent-handoffs] accept failed', error);
      res.status(503).json({ error: 'Не вдалося зберегти приймання. Оновіть журнал і перевірте стан.' });
    }
  });
}
