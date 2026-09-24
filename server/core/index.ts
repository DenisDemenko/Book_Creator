/**
 * Вхід у семантичне ядро (Т0.3): підключення до PostgreSQL, міграції на
 * старті, вибір сховища.
 *
 * ЗВІДКИ АДРЕСА БАЗИ — `CORE_DATABASE_URL`, і свідомо не `DATABASE_URL`.
 * `DATABASE_URL` — загальноприйнята назва, під нею на Railway живе база
 * маркетплейсу (Prisma). Якщо змінну розшарено між сервісами, Студія під
 * звичною назвою накотила б свої таблиці в чужу базу. Окрема назва робить
 * помилку неможливою, а схема `fusion_core` — навіть якщо адресу вкажуть ту
 * саму, таблиці ядра лягають окремо й нічого чужого не торкаються.
 *
 * БЕЗ БАЗИ СТУДІЯ ПРАЦЮЄ ЯК РАНІШЕ. Ядро — нова частина: поки адреси немає
 * або база недоступна, `getCoreRepository()` повертає null, а маршрути ядра
 * відповідають 503 з поясненням. Книги, редактор, ШІ — на SQLite, як були (К1).
 */

import pg from 'pg';
import {
  CORE_SCHEMA,
  describePgError,
  loadMigrations,
  MigrationError,
  resolveMigrationsDir,
  runMigrations,
} from './migrate';
import { PgCoreRepository } from './pgRepository';
import type { CoreRepository } from './types';

export type CoreState = 'disabled' | 'starting' | 'ready' | 'failed';

export interface CoreStatusInfo {
  state: CoreState;
  schemaVersion: number | null;
  /** Людський опис причини для `disabled` / `failed`; без адреси й паролів. */
  message: string;
}

let status: CoreStatusInfo = {
  state: 'disabled',
  schemaVersion: null,
  message: 'Ядро не запускалось',
};
let repository: CoreRepository | null = null;
let startPromise: Promise<CoreStatusInfo> | null = null;
/** Пауза перед повторною спробою, якщо база ядра недоступна. */
const RETRY_MS = 60_000;

export function coreDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env.CORE_DATABASE_URL?.trim();
  return url ? url : null;
}

/** Пул з'єднань ядра: шлях пошуку — схема ядра, потім `public` (там pgvector). */
export function createCorePool(url: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.CORE_DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'fusion-studio-core',
    options: `-c search_path=${CORE_SCHEMA},public`,
  });
  // Обрив простою з'єднання не має валити процес — пул відкриє нове.
  pool.on('error', (err) => console.warn('[core] помилка з\'єднання з PostgreSQL:', err.message));
  return pool;
}

/**
 * Запускає ядро: міграції → сховище. Повторний виклик повертає той самий
 * результат. Ніколи не кидає — стан видно в `getCoreStatus()`.
 */
export function initCore(log: (msg: string) => void = (m) => console.log(m)): Promise<CoreStatusInfo> {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const url = coreDatabaseUrl();
    if (!url) {
      status = {
        state: 'disabled',
        schemaVersion: null,
        message: 'CORE_DATABASE_URL не задано — семантичне ядро вимкнене, решта Студії працює',
      };
      log(`[core] ${status.message}`);
      return status;
    }
    status = { state: 'starting', schemaVersion: null, message: 'Накочування міграцій…' };
    const pool = createCorePool(url);
    try {
      const migrations = loadMigrations(resolveMigrationsDir());
      const res = await runMigrations(pool, migrations, log);
      repository = new PgCoreRepository(pool, true);
      status = {
        state: 'ready',
        schemaVersion: res.schemaVersion,
        message: res.applied.length
          ? `Накочено міграції: ${res.applied.join(', ')}`
          : 'Схема актуальна',
      };
      log(`[core] PostgreSQL готовий, схема v${res.schemaVersion} (${status.message})`);
    } catch (err) {
      await pool.end().catch(() => {});
      status = { state: 'failed', schemaVersion: null, message: describePgError(err) };
      console.error(`[core] ядро не запустилось: ${status.message}`);
      // База, що ще не піднялась (деплой обох сервісів разом), — не привід
      // лишати ядро вимкненим до наступного перезапуску: пробуємо знову.
      // Помилка самих міграцій — інша справа: її повтор нічого не змінить.
      if (!(err instanceof MigrationError)) {
        setTimeout(() => {
          startPromise = null;
          void initCore(log);
        }, RETRY_MS).unref();
      }
    }
    return status;
  })();
  return startPromise;
}

export function getCoreStatus(): CoreStatusInfo {
  return { ...status };
}

/** Сховище ядра або null, якщо ядро вимкнене чи не запустилось. */
export function getCoreRepository(): CoreRepository | null {
  return repository;
}

export async function shutdownCore(): Promise<void> {
  const r = repository;
  repository = null;
  startPromise = null;
  if (r) await r.close();
}
