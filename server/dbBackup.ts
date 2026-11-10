/**
 * Копії бази Studio (SQLite на томі Railway) — журнал #538.
 *
 * Навіщо. База `/data/nova-studio.db` тримає все: книги, чернетки за фото, гаманець балів, токени,
 * тарифи. Копій не було жодних: пошкоджений файл чи невдала міграція означали втрату всього. Том
 * Railway невеликий (500 МБ, на 10.11.2026 зайнято ≈307 МБ разом із файлами книг і медіа), тому копія
 * на тому ж томі — це страховка від ПОШКОДЖЕННЯ бази, а не від втрати тому. Від втрати тому захищає
 * лише копія поза ним: адмінка віддає свіжий знімок на завантаження (`/api/admin/db-backup/download`),
 * а автоматичні резервні копії Railway для тому вмикаються в його панелі (з цього сесії недоступні).
 *
 * Як. `VACUUM INTO` робить узгоджений знімок живої бази без зупинки запису (WAL), заодно стискаючи
 * порожнє місце. Знімок пишеться в `.tmp` і перейменовується — недописаний файл ніколи не виглядає
 * копією. Перед записом перевіряється вільне місце: переповнений том ламає саму Studio, а це гірше
 * за відсутність копії, тож без місця копію пропускаємо з видимою причиною.
 *
 * Чого тут немає: файлів книг і медіа (`DATA_DIR/books`, `DATA_DIR/media`) — це сотні МБ, їх
 * знімком бази не покрити. Автоматичний запуск: `DB_BACKUP_DISABLED=1` вимикає, `DB_BACKUP_KEEP`
 * (типово 3) — скільки копій тримати, `DB_BACKUP_INTERVAL_HOURS` (типово 24), `DB_BACKUP_DIR`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, DB_PATH, getDb, isAvailable } from './db';

export interface BackupFile {
  name: string;
  bytes: number;
  createdAt: string;
}

/** Один тип з необовʼязковими полями, а не обʼєднання: у tsconfig немає strict, і `ok` не звужує обʼєднання. */
export interface BackupResult {
  ok: boolean;
  file?: BackupFile;
  pruned?: string[];
  reason?: 'no_db' | 'no_space' | 'failed';
  message?: string;
}

export interface BackupConfig {
  enabled: boolean;
  dir: string;
  keep: number;
  intervalMs: number;
}

/** Скільки місця лишаємо тому ПІСЛЯ копії: Studio пише в нього книги, медіа й саму базу. */
export const MIN_FREE_AFTER_BACKUP_BYTES = 64 * 1024 * 1024;
/** Знімок не більший за базу, але WAL може бути ще не злитий; запас на це. */
const SPACE_FACTOR = 1.25;
const NAME_RE = /^nova-studio-(\d{8}-\d{6})\.db$/;

export function backupConfig(env: NodeJS.ProcessEnv = process.env): BackupConfig {
  const keep = Math.round(Number(env.DB_BACKUP_KEEP));
  const hours = Number(env.DB_BACKUP_INTERVAL_HOURS);
  return {
    enabled: !/^(1|true|on|yes)$/i.test(String(env.DB_BACKUP_DISABLED ?? '').trim()),
    dir: env.DB_BACKUP_DIR?.trim() || path.join(DATA_DIR, 'backups'),
    keep: Number.isFinite(keep) && keep >= 1 ? Math.min(keep, 30) : 3,
    intervalMs: Number.isFinite(hours) && hours >= 1 ? Math.round(hours * 3_600_000) : 24 * 3_600_000,
  };
}

export interface BackupDeps {
  /** Виконує SQL на живій базі; `null` — бази немає. */
  exec: () => ((sql: string) => void) | null;
  dbPath: string;
  now: () => Date;
  /** Вільне місце (байти) на томі `dir`; `null` — дізнатись не вдалось. */
  freeBytes: (dir: string) => number | null;
}

const realDeps: BackupDeps = {
  exec: () => {
    const db = isAvailable() ? getDb() : null;
    return db ? (sql) => db.exec(sql) : null;
  },
  dbPath: DB_PATH,
  now: () => new Date(),
  freeBytes: (dir) => {
    try {
      const st = fs.statfsSync(dir);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      return null;
    }
  },
};

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function sqlQuote(p: string): string {
  return `'${p.replace(/'/g, "''")}'`;
}

function dbBytes(dbPath: string): number {
  let total = 0;
  for (const suffix of ['', '-wal']) {
    try {
      total += fs.statSync(dbPath + suffix).size;
    } catch {
      /* файлу може не бути */
    }
  }
  return total;
}

export function listBackups(dir: string): BackupFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const files: BackupFile[] = [];
  for (const name of names) {
    const m = NAME_RE.exec(name);
    if (!m) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      const t = m[1];
      files.push({ name, bytes: st.size, createdAt: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z` });
    } catch {
      /* зникла між readdir і stat */
    }
  }
  return files.sort((a, b) => (a.name < b.name ? 1 : -1)); // найновіші першими
}

function prune(dir: string, keep: number): string[] {
  const removed: string[] = [];
  for (const f of listBackups(dir).slice(Math.max(0, keep))) {
    try {
      fs.unlinkSync(path.join(dir, f.name));
      removed.push(f.name);
    } catch {
      /* лишиться до наступного разу */
    }
  }
  return removed;
}

/** Знімок бази в `dir`. Не кидає: причина відмови повертається, щоб адмінка й журнал її показали. */
export function createBackup(config: Pick<BackupConfig, 'dir' | 'keep'>, deps: BackupDeps = realDeps): BackupResult {
  const exec = deps.exec();
  if (!exec) return { ok: false, reason: 'no_db', message: 'База даних недоступна (працює JSON-сховище) — копіювати нічого.' };
  try {
    fs.mkdirSync(config.dir, { recursive: true });
    // Недописані знімки з минулих падінь не повинні займати місце.
    for (const n of fs.readdirSync(config.dir)) if (n.endsWith('.tmp')) fs.rmSync(path.join(config.dir, n), { force: true });

    const need = Math.ceil(dbBytes(deps.dbPath) * SPACE_FACTOR) + MIN_FREE_AFTER_BACKUP_BYTES;
    let free = deps.freeBytes(config.dir);
    // Місця мало — звільняємо найстаріші копії понад keep-1 (тоді їх буде keep після нової), але лише коли це
    // справді вистачить: стирати стару копію заради копії, якої все одно не буде, — гірше за нічого.
    if (free !== null && free < need) {
      const keepNow = Math.max(1, config.keep - 1); // єдину копію (keep=1) не стираємо наосліп
      const reclaimable = listBackups(config.dir).slice(keepNow).reduce((sum, f) => sum + f.bytes, 0);
      if (free + reclaimable >= need) {
        prune(config.dir, keepNow);
        free = deps.freeBytes(config.dir);
      }
    }
    if (free !== null && free < need) {
      const mb = (n: number) => Math.round(n / 1024 / 1024);
      return {
        ok: false,
        reason: 'no_space',
        message: `На томі лишилось ${mb(free)} МБ, а для копії потрібно ≈${mb(need)} МБ (база ${mb(dbBytes(deps.dbPath))} МБ + запас ${mb(MIN_FREE_AFTER_BACKUP_BYTES)} МБ). Збільште том або видаліть зайве; завантажити знімок можна з адмінки.`,
      };
    }

    const name = `nova-studio-${stamp(deps.now())}.db`;
    const finalPath = path.join(config.dir, name);
    const tmpPath = `${finalPath}.tmp`;
    fs.rmSync(tmpPath, { force: true });
    exec(`VACUUM INTO ${sqlQuote(tmpPath)}`);
    fs.renameSync(tmpPath, finalPath);
    const st = fs.statSync(finalPath);
    const pruned = prune(config.dir, config.keep);
    const file = listBackups(config.dir).find((f) => f.name === name) ?? { name, bytes: st.size, createdAt: deps.now().toISOString() };
    return { ok: true, file, pruned };
  } catch (err) {
    return { ok: false, reason: 'failed', message: `Не вдалося зробити копію: ${String((err as Error)?.message ?? err).slice(0, 300)}` };
  }
}

/**
 * Знімок для завантаження: пишеться в тимчасову теку контейнера (НЕ на том — він малий) і видаляється,
 * коли відповідь закінчилась. Повертає шлях і функцію прибирання.
 */
export function createDownloadSnapshot(deps: BackupDeps = realDeps): {
  ok: boolean;
  path?: string;
  name?: string;
  cleanup?: () => void;
  message?: string;
} {
  const exec = deps.exec();
  if (!exec) return { ok: false, message: 'База даних недоступна (працює JSON-сховище) — копіювати нічого.' };
  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-backup-'));
    const name = `nova-studio-${stamp(deps.now())}.db`;
    const file = path.join(dir, name);
    exec(`VACUUM INTO ${sqlQuote(file)}`);
    const cleanupDir = dir;
    return { ok: true, path: file, name, cleanup: () => fs.rmSync(cleanupDir, { recursive: true, force: true }) };
  } catch (err) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, message: `Не вдалося зробити знімок: ${String((err as Error)?.message ?? err).slice(0, 300)}` };
  }
}

export interface BackupStatus {
  enabled: boolean;
  dir: string;
  keep: number;
  intervalHours: number;
  files: BackupFile[];
  dbBytes: number;
  freeBytes: number | null;
}

export function backupStatus(config: BackupConfig = backupConfig(), deps: BackupDeps = realDeps): BackupStatus {
  return {
    enabled: config.enabled,
    dir: config.dir,
    keep: config.keep,
    intervalHours: Math.round(config.intervalMs / 3_600_000),
    files: listBackups(config.dir),
    dbBytes: dbBytes(deps.dbPath),
    freeBytes: deps.freeBytes(fs.existsSync(config.dir) ? config.dir : DATA_DIR),
  };
}

/**
 * Автоматичні копії: перша — через кілька хвилин після старту (щоб не тягти запуск), якщо остання
 * свіжіша за інтервал — пропускається (інакше кожен деплой давав би нову копію й витісняв старі).
 */
export function startBackupSchedule(
  config: BackupConfig = backupConfig(),
  deps: BackupDeps = realDeps,
  timers: { firstDelayMs: number } = { firstDelayMs: 5 * 60_000 }
): NodeJS.Timeout | null {
  if (!config.enabled) return null;
  const tick = () => {
    const newest = listBackups(config.dir)[0];
    if (newest && deps.now().getTime() - Date.parse(newest.createdAt) < config.intervalMs * 0.9) return;
    const r = createBackup(config, deps);
    if (r.ok) console.log(`[dbBackup] копія ${r.file!.name} (${Math.round(r.file!.bytes / 1024)} КБ)${r.pruned!.length ? `, прибрано старих: ${r.pruned!.length}` : ''}`);
    else console.warn(`[dbBackup] копію пропущено (${r.reason}): ${r.message}`);
  };
  const first = setTimeout(tick, timers.firstDelayMs);
  first.unref();
  const every = setInterval(tick, Math.min(config.intervalMs, 3_600_000)); // перевірка щогодини; сама копія — раз на інтервал
  every.unref();
  return every;
}
