/**
 * Сховище задач генерації Gamma.
 *
 * Той самий контракт, що й у решти сховищ: SQLite основний, JSON у DATA_DIR —
 * запасний, назовні лише camelCase.
 *
 * Головне, заради чого воно існує: **облік витрачених кредитів**. Кожна
 * генерація списує гроші з рахунку власника, і без запису, хто й на що їх
 * витратив, баланс просто зникав би.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb, isAvailable, DATA_DIR } from '../db';

/**
 * `cover_art` — окремий вид, бо він іде іншим ендпоінтом (`POST /images`,
 * а не `/generations`) і статус у нього свій. Зводити його з рештою в один
 * шлях означало б розвилку в кожному місці, де є вид.
 */
export type GammaJobKind = 'course_deck' | 'landing' | 'social' | 'document' | 'cover_art';
export type GammaJobStatus = 'pending' | 'completed' | 'failed';

export interface GammaJob {
  id: string;
  userId: string | null;
  bookId: string | null;
  kind: GammaJobKind;
  format: string;
  status: GammaJobStatus;
  title: string;
  gammaUrl: string | null;
  exportUrl: string | null;
  exportAs: string | null;
  creditsUsed: number | null;
  creditsLeft: number | null;
  errorUk: string | null;
  createdAt: string;
  updatedAt: string;
}

const JSON_FILE = 'gamma.json';
interface JsonShape { jobs: GammaJob[] }
const EMPTY: JsonShape = { jobs: [] };

let jsonCache: JsonShape | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

async function loadJson(): Promise<JsonShape> {
  if (jsonCache) return jsonCache;
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, JSON_FILE), 'utf8');
    jsonCache = { ...EMPTY, ...(JSON.parse(raw) as Partial<JsonShape>) };
  } catch {
    jsonCache = structuredClone(EMPTY);
  }
  return jsonCache;
}

function persistJson(): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const target = path.join(DATA_DIR, JSON_FILE);
      const temp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(jsonCache, null, 2), 'utf8');
      await fs.rename(temp, target);
    })
    .catch((err) => console.error('[gammaStore] Не вдалося зберегти gamma.json:', err));
  return writeChain as Promise<void>;
}

const useJson = () => !isAvailable();

/** Лише для тестів. */
export function __resetGammaCacheForTests(): void {
  jsonCache = null;
}

function rowToJob(row: any): GammaJob {
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    bookId: row.book_id ? String(row.book_id) : null,
    kind: String(row.kind) as GammaJobKind,
    format: String(row.format),
    status: String(row.status) as GammaJobStatus,
    title: String(row.title || ''),
    gammaUrl: row.gamma_url ? String(row.gamma_url) : null,
    exportUrl: row.export_url ? String(row.export_url) : null,
    exportAs: row.export_as ? String(row.export_as) : null,
    creditsUsed: row.credits_used === null || row.credits_used === undefined ? null : Number(row.credits_used),
    creditsLeft: row.credits_left === null || row.credits_left === undefined ? null : Number(row.credits_left),
    errorUk: row.error_uk ? String(row.error_uk) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function createJob(job: Omit<GammaJob, 'createdAt' | 'updatedAt'> & { now?: () => Date }): Promise<GammaJob> {
  const at = (job.now?.() ?? new Date()).toISOString();
  const record: GammaJob = { ...job, createdAt: at, updatedAt: at };
  delete (record as any).now;

  if (useJson()) {
    const data = await loadJson();
    data.jobs.push(record);
    await persistJson();
    return record;
  }
  getDb()!
    .prepare(
      `INSERT INTO gamma_jobs
         (id, user_id, book_id, kind, format, status, title, gamma_url, export_url, export_as,
          credits_used, credits_left, error_uk, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id, record.userId, record.bookId, record.kind, record.format, record.status,
      record.title, record.gammaUrl, record.exportUrl, record.exportAs,
      record.creditsUsed, record.creditsLeft, record.errorUk, record.createdAt, record.updatedAt
    );
  return record;
}

export async function updateJob(
  id: string,
  patch: Partial<Omit<GammaJob, 'id' | 'createdAt'>>,
  now?: () => Date
): Promise<GammaJob | null> {
  const existing = await getJob(id);
  if (!existing) return null;
  const next: GammaJob = { ...existing, ...patch, updatedAt: (now?.() ?? new Date()).toISOString() };

  if (useJson()) {
    const data = await loadJson();
    const i = data.jobs.findIndex((j) => j.id === id);
    if (i >= 0) data.jobs[i] = next;
    await persistJson();
    return next;
  }
  getDb()!
    .prepare(
      `UPDATE gamma_jobs SET status = ?, gamma_url = ?, export_url = ?,
         credits_used = ?, credits_left = ?, error_uk = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(next.status, next.gammaUrl, next.exportUrl, next.creditsUsed, next.creditsLeft, next.errorUk, next.updatedAt, id);
  return next;
}

export async function getJob(id: string): Promise<GammaJob | null> {
  const jobId = String(id || '').trim();
  if (!jobId) return null;
  if (useJson()) return (await loadJson()).jobs.find((j) => j.id === jobId) ?? null;
  const row = getDb()!.prepare('SELECT * FROM gamma_jobs WHERE id = ?').get(jobId);
  return row ? rowToJob(row) : null;
}

export async function listJobs(userId?: string | null, limit = 50): Promise<GammaJob[]> {
  if (useJson()) {
    return (await loadJson()).jobs
      .filter((j) => (userId ? j.userId === userId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  const rows = userId
    ? getDb()!.prepare('SELECT * FROM gamma_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit)
    : getDb()!.prepare('SELECT * FROM gamma_jobs ORDER BY created_at DESC LIMIT ?').all(limit);
  return (rows as any[]).map(rowToJob);
}

/**
 * Скільки кредитів витрачено за період.
 *
 * Це та відповідь, заради якої сховище й існує: «куди поділись кредити».
 * Рахуємо лише завершені задачі — незавершена ще нічого не списала.
 */
export async function creditsSpent(params: { userId?: string | null; sinceIso?: string } = {}): Promise<{
  jobs: number;
  credits: number;
}> {
  const all = await listJobs(params.userId ?? null, 1000);
  const rows = all.filter(
    (j) => j.status === 'completed' && (params.sinceIso ? j.createdAt >= params.sinceIso : true)
  );
  return {
    jobs: rows.length,
    credits: rows.reduce((sum, j) => sum + (j.creditsUsed ?? 0), 0),
  };
}
