/**
 * Запускач міграцій ядра (Т0.3): SQL-файли `NNNN_назва.sql` з версією.
 *
 * ЧОМУ СВІЙ, А НЕ БІБЛІОТЕКА. Потрібно чотири речі, і всі вміщуються в сотню
 * рядків: порядок за номером, кожна міграція в окремій транзакції, облік
 * накочених, і — головне — відмова, якщо вже накочений файл змінили заднім
 * числом (контрольна сума). Бібліотека принесла б свій формат і CLI, а шар
 * ядра мусить однаково працювати з `npm run dev`, зі збірки `dist/` і з тестів.
 *
 * ДВА ЗАПУСКИ ОДНОЧАСНО (два інстанси при деплої) не зіпсують базу: весь
 * прогін іде під `pg_advisory_lock`, другий чекає й бачить, що все накочено.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const CORE_SCHEMA = 'fusion_core';
const MIGRATIONS_TABLE = `${CORE_SCHEMA}.core_schema_migrations`;
/** Довільне, але стале число — ключ advisory-блокування міграцій ядра. */
const MIGRATION_LOCK_KEY = 72019550;

export interface CoreMigration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

/** Мінімум від `pg.PoolClient`, який потрібен запускачу (так його легко підмінити в тесті). */
export interface MigrationClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  release(): void;
}
export interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

export class MigrationError extends Error {
  constructor(message: string, readonly version?: number) {
    super(message);
    this.name = 'MigrationError';
  }
}

const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function parseMigrationFileName(file: string): { version: number; name: string } | null {
  const m = FILE_RE.exec(file);
  if (!m) return null;
  return { version: Number(m[1]), name: m[2] };
}

export function migrationChecksum(sql: string): string {
  // CRLF/LF не мають міняти суму: репозиторій живе і на Windows (autocrlf).
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Читає й перевіряє теку міграцій: лише файли за шаблоном, номери з 1 без
 * пропусків і повторів. Пропуск — майже завжди загублений файл при злитті,
 * і краще впасти тут, ніж накотити 0005 на базу без 0004.
 */
export function loadMigrations(dir: string): CoreMigration[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const out: CoreMigration[] = [];
  for (const file of files) {
    const parsed = parseMigrationFileName(file);
    if (!parsed) throw new MigrationError(`Файл міграції «${file}» не відповідає шаблону NNNN_назва.sql`);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    out.push({ ...parsed, sql, checksum: migrationChecksum(sql) });
  }
  out.sort((a, b) => a.version - b.version);
  out.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new MigrationError(
        `Міграції мають іти без пропусків з 0001: на місці ${String(i + 1).padStart(4, '0')} стоїть ${String(m.version).padStart(4, '0')}`,
        m.version,
      );
    }
  });
  return out;
}

/**
 * Де лежать SQL-файли. У `npm run dev` — поруч із цим модулем; у зібраному
 * `dist/server.mjs` модуль вбудовано в бандл, тож поруч — `dist/`, куди
 * Dockerfile копіює теку як `core-migrations`. Останній варіант — локальний
 * `npm start` зі збірки без Docker.
 */
export function resolveMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'migrations'),
    path.join(here, 'core-migrations'),
    path.join(process.cwd(), 'server', 'core', 'migrations'),
  ];
  const found = candidates.find((dir) => fs.existsSync(dir));
  if (!found) throw new MigrationError(`Теку міграцій ядра не знайдено (шукали: ${candidates.join(', ')})`);
  return found;
}

export interface MigrateResult {
  applied: number[];
  alreadyApplied: number[];
  /** Найбільша накочена версія після прогону. */
  schemaVersion: number;
}

export async function runMigrations(
  pool: MigrationPool,
  migrations: CoreMigration[],
  log: (msg: string) => void = () => {},
): Promise<MigrateResult> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    locked = true;
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${CORE_SCHEMA}`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
         version    integer PRIMARY KEY,
         name       text NOT NULL,
         checksum   text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query(`SELECT version, name, checksum FROM ${MIGRATIONS_TABLE} ORDER BY version`);
    const done = new Map<number, { name: string; checksum: string }>();
    for (const r of rows) done.set(Number(r.version), { name: r.name, checksum: r.checksum });

    const known = new Set(migrations.map((m) => m.version));
    for (const v of done.keys()) {
      if (!known.has(v)) {
        throw new MigrationError(
          `У базі накочено міграцію ${v}, якої немає в коді — схоже, код старіший за базу. Зупинено, щоб не працювати з чужою схемою.`,
          v,
        );
      }
    }

    const applied: number[] = [];
    const alreadyApplied: number[] = [];
    for (const m of migrations) {
      const prev = done.get(m.version);
      if (prev) {
        if (prev.checksum !== m.checksum) {
          throw new MigrationError(
            `Міграцію ${m.version} (${m.name}) змінено після того, як її накочено. Накочене не переписують — додайте нову міграцію.`,
            m.version,
          );
        }
        alreadyApplied.push(m.version);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL search_path TO ${CORE_SCHEMA}, public`);
        await client.query(m.sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (version, name, checksum) VALUES ($1, $2, $3)`, [
          m.version,
          m.name,
          m.checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new MigrationError(`Міграція ${m.version} (${m.name}) не накотилась: ${describePgError(err)}`, m.version);
      }
      applied.push(m.version);
      log(`[core] міграцію ${String(m.version).padStart(4, '0')}_${m.name} накочено`);
    }
    const schemaVersion = migrations.length ? migrations[migrations.length - 1].version : 0;
    return { applied, alreadyApplied, schemaVersion };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/**
 * Людський опис помилки PostgreSQL. Найчастіша на старті — база без pgvector:
 * на Railway це звичайний шаблон PostgreSQL замість шаблону з pgvector.
 */
export function describePgError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const msg = e?.message ?? String(err);
  if (/extension "vector"/i.test(msg) || (e?.code === '58P01' && /vector/i.test(msg))) {
    return `${msg} — у базі немає розширення pgvector. На Railway потрібен сервіс PostgreSQL із pgvector (шаблон «pgvector»), а не звичайний PostgreSQL.`;
  }
  return msg;
}
