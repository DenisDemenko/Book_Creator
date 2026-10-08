/** Collaboration annotations live beside the authoritative book in SQLite.
 * Each change and its recipient notifications commit atomically. No content is broadcast. */
import { randomUUID } from 'node:crypto';
import { getDb } from '../../db';
export type WorkTarget = { kind: 'book' | 'chapter' | 'scene' | 'paragraph' | 'entity' | 'material'; id?: string; chapterId?: string; sectionId?: string };
export interface WorkItem {
  id: string; kind: 'comment' | 'task'; target: WorkTarget; text: string;
  authorId: string; assigneeId: string | null; dueAt: string | null;
  status: 'open' | 'done'; version: number; createdAt: string; updatedAt: string;
}
export interface WorkNotice { id: string; itemId: string; userId: string; readAt: string | null; createdAt: string; kind?: 'change' | 'overdue' }
export class WorkspaceError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const initialized = new WeakSet<object>();
function db() {
  const db = getDb();
  if (!db) throw new WorkspaceError(503, 'Сховище співпраці недоступне.');
  if (!initialized.has(db)) { db.exec(`CREATE TABLE IF NOT EXISTS collaboration_items (
    project_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project_id,id));
    CREATE TABLE IF NOT EXISTS collaboration_notices (
    project_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, id TEXT NOT NULL, user_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project_id,id));
    CREATE INDEX IF NOT EXISTS collaboration_notices_user ON collaboration_notices(project_id,user_id);`); initialized.add(db); }
  return db;
}
export function workItems(projectId: string): WorkItem[] {
  return db().prepare('SELECT payload FROM collaboration_items WHERE project_id=?').all(projectId).map((r: any) => JSON.parse(r.payload));
}
export function workNotices(projectId: string, userId: string): WorkNotice[] {
  return db().prepare('SELECT payload FROM collaboration_notices WHERE project_id=? AND user_id=?').all(projectId,userId).map((r: any) => JSON.parse(r.payload));
}
export function saveWorkItem(projectId: string, item: WorkItem, expectedVersion: number | null, recipients: string[], onCommit?:()=>void): WorkItem {
  const conn = db();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const row = conn.prepare('SELECT payload FROM collaboration_items WHERE project_id=? AND id=?').get(projectId,item.id) as any;
    if (expectedVersion === null ? !!row : !row || JSON.parse(row.payload).version !== expectedVersion) throw new WorkspaceError(409, 'Запис уже змінився. Оновіть сторінку.');
    if (!row && workItems(projectId).length >= 2000) throw new WorkspaceError(409, 'Досягнуто ліміту 2000 записів співпраці.');
    conn.prepare('INSERT OR REPLACE INTO collaboration_items(project_id,id,payload) VALUES(?,?,?)').run(projectId,item.id,JSON.stringify(item));
    for (const userId of new Set(recipients)) {
      const notice: WorkNotice = { id: randomUUID(), itemId:item.id, userId, readAt:null, createdAt:item.updatedAt };
      conn.prepare('INSERT INTO collaboration_notices(project_id,id,user_id,payload) VALUES(?,?,?,?)').run(projectId,notice.id,userId,JSON.stringify(notice));
      // Keep a bounded recipient inbox; annotations and book history remain intact.
      conn.prepare(`DELETE FROM collaboration_notices WHERE project_id=? AND user_id=? AND rowid NOT IN
        (SELECT rowid FROM collaboration_notices WHERE project_id=? AND user_id=? ORDER BY rowid DESC LIMIT 500)`).run(projectId,userId,projectId,userId);
    }
    onCommit?.();
    conn.exec('COMMIT');
  } catch (e) { conn.exec('ROLLBACK'); throw e; }
  return item;
}
export function readWorkNotice(projectId: string, userId: string, id: string): void {
  const conn = db();
  const row = conn.prepare('SELECT payload FROM collaboration_notices WHERE project_id=? AND user_id=? AND id=?').get(projectId,userId,id) as any;
  if (!row) throw new WorkspaceError(404, 'Сповіщення не знайдено.');
  const notice: WorkNotice = JSON.parse(row.payload);
  notice.readAt ??= new Date().toISOString();
  conn.prepare('UPDATE collaboration_notices SET payload=? WHERE project_id=? AND user_id=? AND id=?').run(JSON.stringify(notice),projectId,userId,id);
}

/** Stable per-deadline reminders: polling never creates duplicates or resets read state. */
export function ensureDeadlineNotices(projectId:string,userId:string,items:WorkItem[]):void {
  const conn=db();
  for(const item of items) {
    if(item.kind!=='task'||item.status!=='open'||item.assigneeId!==userId||!item.dueAt||Date.parse(item.dueAt)>Date.now())continue;
    const notice:WorkNotice={id:`due:${item.id}:${item.dueAt}`,itemId:item.id,userId,readAt:null,createdAt:item.dueAt,kind:'overdue'};
    conn.prepare('INSERT OR IGNORE INTO collaboration_notices(project_id,id,user_id,payload) VALUES(?,?,?,?)').run(projectId,notice.id,userId,JSON.stringify(notice));
  }
  conn.prepare(`DELETE FROM collaboration_notices WHERE project_id=? AND user_id=? AND rowid NOT IN
    (SELECT rowid FROM collaboration_notices WHERE project_id=? AND user_id=? ORDER BY rowid DESC LIMIT 500)`).run(projectId,userId,projectId,userId);
}
