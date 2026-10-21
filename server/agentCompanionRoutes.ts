import type { Express, Request, Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { requireAdmin } from './auth';
import { getDb } from './db';

function database() {
  const db = getDb();
  if (!db) throw new Error('SQLite недоступна.');
  db.exec(`CREATE TABLE IF NOT EXISTS agent_companion_devices (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    revoked_at TEXT, last_seen TEXT, state_json TEXT
  );
  CREATE TABLE IF NOT EXISTS agent_companion_jobs (
    id TEXT PRIMARY KEY, device_id TEXT NOT NULL, action TEXT NOT NULL,
    payload_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
    started_at TEXT, finished_at TEXT, result_json TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS agent_companion_one_active_job
    ON agent_companion_jobs(device_id) WHERE status IN ('pending', 'running');`);
  return db;
}
type Row = Record<string, any>;
function expire(db: NonNullable<ReturnType<typeof getDb>>) {
  const now = Date.now();
  db.prepare("UPDATE agent_companion_jobs SET status='expired', finished_at=? WHERE status='pending' AND created_at<?")
    .run(new Date(now).toISOString(), new Date(now - 120000).toISOString());
  // Never replay a running operation after a lost response. Its outcome is unknown.
  db.prepare("UPDATE agent_companion_jobs SET status='unknown', finished_at=? WHERE status='running' AND started_at<?")
    .run(new Date(now).toISOString(), new Date(now - 180000).toISOString());
}
function tokenDevice(req: Request, res: Response): Row | null {
  const token = req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) { res.status(401).json({ error: 'Потрібен токен помічника.' }); return null; }
  const hash = createHash('sha256').update(token).digest('hex');
  const device = database().prepare('SELECT * FROM agent_companion_devices WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?')
    .get(hash, new Date().toISOString()) as Row | undefined;
  if (!device) { res.status(401).json({ error: 'Підключення відкликане або строк дії завершився.' }); return null; }
  return device;
}
function bounded(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
    throw new Error('Некоректне поле.');
  return value.trim();
}
function fail(res: Response, error: unknown) {
  console.error('[agent-companion]', error);
  res.status(503).json({ error: 'Операцію не підтверджено. Оновіть журнал перед повторною спробою.' });
}
export function registerAgentCompanionRoutes(app: Express) {
  app.get('/api/admin/agent-companion', requireAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const db = database(); expire(db);
      const devices = db.prepare('SELECT id,name,created_at,expires_at,revoked_at,last_seen,state_json FROM agent_companion_devices WHERE owner_id=? ORDER BY created_at DESC').all(req.principal!.id).map(raw => {
        const row = raw as Row;
        return { ...row, state: row.state_json ? JSON.parse(row.state_json) : null, state_json: undefined };
      });
      const jobs = db.prepare(`SELECT j.* FROM agent_companion_jobs j JOIN agent_companion_devices d ON d.id=j.device_id
        WHERE d.owner_id=? ORDER BY j.created_at DESC LIMIT 50`).all(req.principal!.id).map(raw => {
        const row = raw as Row;
        return { ...row, payload: JSON.parse(row.payload_json), result: row.result_json ? JSON.parse(row.result_json) : null,
          payload_json: undefined, result_json: undefined };
      });
      res.json({ devices, jobs });
    } catch (error) { fail(res, error); }
  });
  app.post('/api/admin/agent-companion/pair', requireAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const name = bounded(req.body?.name, 100);
      const token = randomBytes(32).toString('hex'), id = randomUUID();
      const expiresAt = new Date(Date.now() + 86400000).toISOString();
      database().prepare('INSERT INTO agent_companion_devices (id,owner_id,name,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)')
        .run(id, req.principal!.id, name, createHash('sha256').update(token).digest('hex'), new Date().toISOString(), expiresAt);
      res.status(201).json({ id, token, expiresAt });
    } catch (error) { res.status(400).json({ error: 'Вкажіть назву комп’ютера; якщо помилка повторюється, перевірте сховище.' }); }
  });
  app.post('/api/admin/agent-companion/:id/revoke', requireAdmin, (req, res) => {
    try {
      const db = database();
      const device = db.prepare('SELECT id FROM agent_companion_devices WHERE id=? AND owner_id=?').get(req.params.id, req.principal!.id);
      if (!device) { res.status(404).json({ error: 'Підключення не знайдено.' }); return; }
      db.prepare('UPDATE agent_companion_devices SET revoked_at=? WHERE id=?').run(new Date().toISOString(), req.params.id);
      db.prepare("UPDATE agent_companion_jobs SET status='cancelled',finished_at=? WHERE device_id=? AND status='pending'")
        .run(new Date().toISOString(), req.params.id);
      res.json({ revoked: true, note: 'Нові команди заблоковано. Уже запущена команда може завершитися на комп’ютері.' });
    } catch (error) { fail(res, error); }
  });
  app.post('/api/admin/agent-companion/:id/jobs', requireAdmin, (req, res) => {
    let payload: Row, action: string;
    try {
      action = bounded(req.body?.action, 30);
      if (!['status','staged-diff','stage-file','commit','push','receive'].includes(action)) throw new Error('Команда не дозволена.');
      payload = {};
      if (action === 'stage-file') payload.path = bounded(req.body?.path, 1000);
      if (action === 'commit') { payload.message = bounded(req.body?.message, 2000); payload.expectedIndexHash = bounded(req.body?.expectedIndexHash, 64); }
      if (action !== 'status' && action !== 'staged-diff') {
        payload.expectedHead = bounded(req.body?.expectedHead, 40);
        if (!/^[a-f0-9]{40}$/i.test(payload.expectedHead)) throw new Error('Потрібен повний SHA.');
        payload.expectedBranch = bounded(req.body?.expectedBranch, 250);
      }
    } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    try {
      const db = database(); expire(db);
      const device = db.prepare('SELECT * FROM agent_companion_devices WHERE id=? AND owner_id=? AND revoked_at IS NULL AND expires_at>?')
        .get(req.params.id, req.principal!.id, new Date().toISOString()) as Row | undefined;
      if (!device) { res.status(404).json({ error: 'Підключення недоступне.' }); return; }
      if (!device.last_seen || Date.now() - Date.parse(device.last_seen) > 20000) {
        res.status(409).json({ error: 'Помічник не на зв’язку. Запустіть його на комп’ютері.' }); return;
      }
      if (db.prepare("SELECT id FROM agent_companion_jobs WHERE device_id=? AND status IN ('pending','running')").get(device.id)) {
        res.status(409).json({ error: 'Дочекайтеся завершення попередньої команди.' }); return;
      }
      // An uncertain previous write must be inspected with status before another write.
      const latest = db.prepare('SELECT status,action FROM agent_companion_jobs WHERE device_id=? ORDER BY created_at DESC LIMIT 1').get(device.id) as Row | undefined;
      if (latest?.status === 'unknown' && action !== 'status') {
        res.status(409).json({ error: 'Результат попередньої команди невідомий. Спершу натисніть «Стан Git».' }); return;
      }
      const id = randomUUID();
      db.prepare("INSERT INTO agent_companion_jobs (id,device_id,action,payload_json,status,created_at) VALUES (?,?,?,?,'pending',?)")
        .run(id, device.id, action, JSON.stringify(payload), new Date().toISOString());
      res.status(201).json({ id, status: 'pending' });
    } catch (error) { fail(res, error); }
  });
  app.post('/api/agent-companion/poll', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const device = tokenDevice(req, res); if (!device) return;
      const db = database(); expire(db);
      const raw = JSON.stringify(req.body?.state ?? null);
      if (raw.length > 32000) { res.status(400).json({ error: 'Стан надто великий.' }); return; }
      db.prepare('UPDATE agent_companion_devices SET last_seen=?,state_json=? WHERE id=?')
        .run(new Date().toISOString(), raw, device.id);
      const row = db.prepare("SELECT * FROM agent_companion_jobs WHERE device_id=? AND status='pending' ORDER BY created_at LIMIT 1").get(device.id) as Row | undefined;
      if (!row) { res.json({ job: null }); return; }
      const claimed = db.prepare("UPDATE agent_companion_jobs SET status='running',started_at=? WHERE id=? AND status='pending' RETURNING id")
        .get(new Date().toISOString(), row.id);
      res.json({ job: claimed ? { id: row.id, action: row.action, payload: JSON.parse(row.payload_json) } : null });
    } catch (error) { fail(res, error); }
  });
  app.post('/api/agent-companion/jobs/:id/result', (req, res) => {
    try {
      const device = tokenDevice(req, res); if (!device) return;
      const result = req.body;
      if (typeof result?.ok !== 'boolean' || JSON.stringify(result).length > 64000) {
        res.status(400).json({ error: 'Некоректний результат.' }); return;
      }
      const db = database();
      const job = db.prepare('SELECT * FROM agent_companion_jobs WHERE id=? AND device_id=?').get(req.params.id, device.id) as Row | undefined;
      if (!job) { res.status(404).json({ error: 'Команду не знайдено.' }); return; }
      if (['succeeded','failed'].includes(job.status)) { res.json({ saved: true }); return; }
      if (!['running','unknown'].includes(job.status)) { res.status(409).json({ error: 'Команду не було прийнято до виконання.' }); return; }
      db.prepare('UPDATE agent_companion_jobs SET status=?,finished_at=?,result_json=? WHERE id=?')
        .run(result.ok ? 'succeeded' : 'failed', new Date().toISOString(), JSON.stringify(result), job.id);
      res.json({ saved: true });
    } catch (error) { fail(res, error); }
  });
}
