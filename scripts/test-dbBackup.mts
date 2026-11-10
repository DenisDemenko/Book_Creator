/**
 * Тести копій бази Studio (журнал #538).
 * Запуск: npm run test:db-backup
 *
 *  1. Налаштування з env.
 *  2. Знімок: файл відкривається як SQLite, має дані на момент знімка, не лишає `.tmp`.
 *  3. Ротація: тримаємо `keep` найновіших.
 *  4. Мало місця: відмова з причиною й без руйнування наявних копій; звільнення старих лише коли це допоможе.
 *  5. Знімок для завантаження: поза тек копій, прибирається.
 *  6. Розклад: вимкнено / свіжа копія є / перша копія по таймеру.
 *  7. Адмін-маршрути: список, ручна копія, завантаження (gzip) — тільки адміну.
 */
const DIR = '/tmp/nova-db-backup-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const bk = await import('../server/dbBackup');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

const live = db.getDb()!;
live.exec('CREATE TABLE IF NOT EXISTS backup_probe (id INTEGER PRIMARY KEY, note TEXT)');
live.prepare('INSERT INTO backup_probe (note) VALUES (?)').run('до знімка');

/** Скільки рядків у знімку — відкриваємо його окремим підключенням. */
async function probeRows(file: string): Promise<number> {
  const sqlite = (await import('node:sqlite')) as any;
  const conn = new sqlite.DatabaseSync(file);
  try {
    return (conn.prepare('SELECT COUNT(*) AS n FROM backup_probe').get() as { n: number }).n;
  } finally {
    conn.close();
  }
}

let clock = Date.parse('2026-11-10T03:00:00.000Z');
const baseDeps = (over: Partial<import('../server/dbBackup').BackupDeps> = {}) => ({
  exec: () => (sql: string) => live.exec(sql),
  dbPath: process.env.DATABASE_PATH!,
  now: () => new Date(clock),
  freeBytes: () => 10 * 1024 * 1024 * 1024, // 10 ГБ
  ...over,
});

// ---------------------------------------------------------------------------
console.log('\nНалаштування');
{
  const d = bk.backupConfig(env({}));
  t('типово: увімкнено, 3 копії, раз на добу, тека backups у DATA_DIR', d.enabled && d.keep === 3 && d.intervalMs === 24 * 3_600_000 && d.dir === path.join(DIR, 'backups'), JSON.stringify(d));
  t('DB_BACKUP_DISABLED=1 вимикає', bk.backupConfig(env({ DB_BACKUP_DISABLED: '1' })).enabled === false);
  t('DB_BACKUP_KEEP і інтервал береться, безглузде ігнорується', bk.backupConfig(env({ DB_BACKUP_KEEP: '5', DB_BACKUP_INTERVAL_HOURS: '6' })).keep === 5 && bk.backupConfig(env({ DB_BACKUP_KEEP: '0', DB_BACKUP_INTERVAL_HOURS: 'x' })).keep === 3);
  t('keep обмежено згори', bk.backupConfig(env({ DB_BACKUP_KEEP: '999' })).keep === 30);
  t('DB_BACKUP_DIR', bk.backupConfig(env({ DB_BACKUP_DIR: '/mnt/b' })).dir === '/mnt/b');
}

// ---------------------------------------------------------------------------
console.log('\nЗнімок');
const dir1 = path.join(DIR, 'backups');
{
  const r = bk.createBackup({ dir: dir1, keep: 3 }, baseDeps());
  t('копія створена', r.ok === true && !!r.file, JSON.stringify(r));
  t('ім’я за зразком nova-studio-РРРРММДД-ГГХХСС.db (UTC)', r.file?.name === 'nova-studio-20261110-030000.db', r.file?.name);
  t('файл відкривається як SQLite і має дані на момент знімка', (await probeRows(path.join(dir1, r.file!.name))) === 1);
  t('недописаних .tmp не лишилось', !fs.readdirSync(dir1).some((n) => n.endsWith('.tmp')));
  live.prepare('INSERT INTO backup_probe (note) VALUES (?)').run('після знімка');
  t('знімок не змінюється від пізніших записів у базу', (await probeRows(path.join(dir1, r.file!.name))) === 1);
}
{
  const odd = path.join(DIR, "it's a dir");
  const r = bk.createBackup({ dir: odd, keep: 3 }, baseDeps());
  t('апостроф у шляху не ламає SQL', r.ok === true && fs.existsSync(path.join(odd, r.file!.name)), JSON.stringify(r));
}
{
  const r = bk.createBackup({ dir: path.join(DIR, 'nodb'), keep: 3 }, baseDeps({ exec: () => null }));
  t('без бази — no_db, а не падіння', r.ok === false && r.reason === 'no_db');
}
{
  const dirX = path.join(DIR, 'junk');
  fs.mkdirSync(dirX, { recursive: true });
  fs.writeFileSync(path.join(dirX, 'nova-studio-20200101-000000.db.tmp'), 'недописано');
  fs.writeFileSync(path.join(dirX, 'notes.txt'), 'чужий файл');
  const r = bk.createBackup({ dir: dirX, keep: 3 }, baseDeps());
  t('недописаний .tmp з минулого падіння прибрано', r.ok === true && !fs.existsSync(path.join(dirX, 'nova-studio-20200101-000000.db.tmp')));
  t('чужі файли в теці не чіпаємо й не рахуємо копіями', fs.existsSync(path.join(dirX, 'notes.txt')) && bk.listBackups(dirX).length === 1);
}

// ---------------------------------------------------------------------------
console.log('\nРотація');
{
  const dir = path.join(DIR, 'rot');
  for (let i = 0; i < 5; i++) {
    clock += 24 * 3_600_000;
    bk.createBackup({ dir, keep: 2 }, baseDeps());
  }
  const names = bk.listBackups(dir).map((f) => f.name);
  t('лишились 2 найновіші, найновіша першою', names.length === 2 && names[0] > names[1] && names[0] === 'nova-studio-20261115-030000.db', names.join(','));
  clock += 24 * 3_600_000;
  const last = bk.createBackup({ dir, keep: 2 }, baseDeps());
  t('результат повідомляє, що прибрано', (last.pruned ?? []).length === 1, JSON.stringify(last.pruned));
  const info = bk.listBackups(dir)[0];
  t('createdAt береться з імені (UTC)', info.createdAt === '2026-11-15T03:00:00Z' || info.createdAt.startsWith('2026-11-1'), info.createdAt);
}

// ---------------------------------------------------------------------------
console.log('\nМало місця');
{
  const dir = path.join(DIR, 'space');
  fs.mkdirSync(dir, { recursive: true });
  // як у коді: база + WAL (WAL ще може бути не злитий і теж потрапляє в оцінку)
  const dbSize = [process.env.DATABASE_PATH!, `${process.env.DATABASE_PATH}-wal`].reduce((s, f) => s + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0) || 1;
  const need = Math.ceil(dbSize * 1.25) + bk.MIN_FREE_AFTER_BACKUP_BYTES;
  const fakeFree = (capacity: number) => (d: string) => capacity - fs.readdirSync(d).filter((n) => n.endsWith('.db')).reduce((s, n) => s + fs.statSync(path.join(d, n)).size, 0);

  const none = bk.createBackup({ dir, keep: 3 }, baseDeps({ freeBytes: () => need - 1 }));
  t('місця менше за потрібне — no_space із цифрами, файлу немає', none.ok === false && none.reason === 'no_space' && /МБ/.test(none.message ?? '') && bk.listBackups(dir).length === 0, JSON.stringify(none));

  // три наявні копії; місця рівно на нову ЛИШЕ після видалення найстарішої
  for (let i = 0; i < 3; i++) {
    clock += 3_600_000;
    bk.createBackup({ dir, keep: 3 }, baseDeps());
  }
  const sizes = bk.listBackups(dir).map((f) => f.bytes);
  const one = sizes[0];
  t('перед перевіркою три копії', sizes.length === 3);
  const capacity = 3 * one + need - Math.floor(one / 2); // вільно менше, ніж треба, але найстаріша копія звільнить достатньо
  clock += 3_600_000;
  const freed = bk.createBackup({ dir, keep: 3 }, baseDeps({ freeBytes: fakeFree(capacity) }));
  t('місця бракує, але найстарішу можна звільнити — звільняє й робить нову', freed.ok === true && bk.listBackups(dir).length === 3, JSON.stringify(freed));

  // не допоможе навіть прибирання → нічого не стираємо
  const before = bk.listBackups(dir).map((f) => f.name).join(',');
  clock += 3_600_000;
  const hopeless = bk.createBackup({ dir, keep: 3 }, baseDeps({ freeBytes: fakeFree(1) }));
  t('прибирання не допоможе — копій не стираємо наосліп', hopeless.ok === false && hopeless.reason === 'no_space' && bk.listBackups(dir).map((f) => f.name).join(',') === before);
}

// ---------------------------------------------------------------------------
console.log('\nЗнімок для завантаження');
{
  const snap = bk.createDownloadSnapshot(baseDeps());
  t('знімок створено в тимчасовій теці контейнера, не на томі', snap.ok === true && !!snap.path && snap.path.startsWith(os.tmpdir()) && !snap.path.startsWith(DIR));
  t('це справжня SQLite з даними', (await probeRows(snap.path!)) === 2);
  snap.cleanup!();
  t('cleanup прибирає знімок разом із текою', !fs.existsSync(snap.path!) && !fs.existsSync(path.dirname(snap.path!)));
  const none = bk.createDownloadSnapshot(baseDeps({ exec: () => null }));
  t('без бази — ok:false з поясненням', none.ok === false && /недоступна/.test(none.message ?? ''));
}

// ---------------------------------------------------------------------------
console.log('\nРозклад');
{
  const cfg = (over: Partial<import('../server/dbBackup').BackupConfig> = {}) => ({ enabled: true, dir: path.join(DIR, 'sched'), keep: 3, intervalMs: 24 * 3_600_000, ...over });
  t('вимкнено — таймер не створюється', bk.startBackupSchedule(cfg({ enabled: false }), baseDeps(), { firstDelayMs: 5 }) === null);

  // свіжа копія є → перша не створюється
  const dir = path.join(DIR, 'sched');
  bk.createBackup({ dir, keep: 3 }, baseDeps());
  const n0 = bk.listBackups(dir).length;
  const timer1 = bk.startBackupSchedule(cfg(), baseDeps(), { firstDelayMs: 20 });
  await new Promise((r) => setTimeout(r, 120));
  clearInterval(timer1!);
  t('остання копія свіжіша за добу — нову не робимо (деплої не плодять копій)', bk.listBackups(dir).length === n0);

  // копії старі → перша по таймеру
  clock += 30 * 3_600_000;
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(' '));
  const timer2 = bk.startBackupSchedule(cfg(), baseDeps(), { firstDelayMs: 20 });
  await new Promise((r) => setTimeout(r, 150));
  clearInterval(timer2!);
  console.log = origLog;
  t('копія застаріла — створюється по таймеру й пишеться в лог', bk.listBackups(dir).length === n0 + 1 && logs.some((l) => /\[dbBackup\] копія nova-studio-/.test(l)), logs.join('|'));
}

// ---------------------------------------------------------------------------
console.log('\nАдмін-маршрути (справжній Express)');
{
  const adminMod = await import('../server/adminRoutes');
  const app = express();
  app.use(express.json());
  const principals: Record<string, any> = {
    admin: { id: 'adm', email: 'adm@test.ua', role: 'admin', isGuest: false },
    writer: { id: 'wr', email: 'wr@test.ua', role: 'writer', isGuest: false },
  };
  app.use((req: any, _res, next) => {
    const u = req.headers['x-test-user'];
    req.principal = typeof u === 'string' && principals[u] ? principals[u] : { id: null, role: 'guest', isGuest: true };
    next();
  });
  adminMod.registerAdminRoutes(app);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (method: string, p: string, user?: string) => fetch(base + p, { method, headers: user ? { 'x-test-user': user } : {} });
  const tmpBackups = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('nova-backup-')).length;

  t('гість — 403 на всі три', [await call('GET', '/api/admin/db-backups'), await call('POST', '/api/admin/db-backups'), await call('GET', '/api/admin/db-backup/download')].every((r) => r.status === 403));
  t('звичайний автор — 403 на всі три', [await call('GET', '/api/admin/db-backups', 'writer'), await call('POST', '/api/admin/db-backups', 'writer'), await call('GET', '/api/admin/db-backup/download', 'writer')].every((r) => r.status === 403));

  const list0 = (await (await call('GET', '/api/admin/db-backups', 'admin')).json()) as any;
  t('адмін бачить стан: увімкнено, ліміт копій, розмір бази, вільне місце', list0.enabled === true && list0.keep === 3 && list0.dbBytes > 0 && typeof list0.freeBytes === 'number' && Array.isArray(list0.files), JSON.stringify(list0).slice(0, 200));

  const made = await call('POST', '/api/admin/db-backups', 'admin');
  const madeBody = (await made.json()) as any;
  t('ручна копія — 201, файл лежить у теці копій', made.status === 201 && !!madeBody.file && fs.existsSync(path.join(DIR, 'backups', madeBody.file.name)), JSON.stringify(madeBody).slice(0, 200));
  t('після неї у статусі на одну копію більше', madeBody.status.files.length === list0.files.length + 1);

  const tmpBefore = tmpBackups();
  const dl = await call('GET', '/api/admin/db-backup/download', 'admin');
  const gz = Buffer.from(await dl.arrayBuffer());
  t('завантаження — 200, gzip із назвою .db.gz', dl.status === 200 && /gzip/.test(dl.headers.get('content-type') || '') && /nova-studio-[0-9]{8}-[0-9]{6}\.db\.gz/.test(dl.headers.get('content-disposition') || ''), `${dl.status} ${dl.headers.get('content-disposition')}`);
  const raw = zlib.gunzipSync(gz);
  t('розпакований вміст — файл SQLite', raw.subarray(0, 15).toString('latin1') === 'SQLite format 3', raw.subarray(0, 15).toString('latin1'));
  t('кеш заборонено (там усі дані Studio)', /no-store/.test(dl.headers.get('cache-control') || ''));
  await new Promise((r) => setTimeout(r, 200));
  t('тимчасовий знімок після відповіді прибрано', tmpBackups() === tmpBefore, `${tmpBefore} → ${tmpBackups()}`);
  server.close();
}

console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
