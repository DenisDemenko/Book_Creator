/**
 * `npm run core:migrate` — накотити міграції ядра вручну (Т0.3).
 *
 * Сервер і так накочує їх на старті; цей скрипт — щоб перевірити нову базу
 * до деплою або подивитись стан. Адреса — з CORE_DATABASE_URL; сама адреса
 * в консоль не виводиться (у ній пароль).
 */
import { coreDatabaseUrl, createCorePool } from '../server/core/index.ts';
import { describePgError, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';

const url = coreDatabaseUrl();
if (!url) {
  console.error('CORE_DATABASE_URL не задано. Приклад: CORE_DATABASE_URL=postgres://… npm run core:migrate');
  process.exit(1);
}
const pool = createCorePool(url);
try {
  const migrations = loadMigrations(resolveMigrationsDir());
  const res = await runMigrations(pool, migrations, (m) => console.log(m));
  console.log(
    res.applied.length
      ? `✓ Накочено: ${res.applied.join(', ')}; схема v${res.schemaVersion}`
      : `✓ Схема актуальна (v${res.schemaVersion}), нічого накочувати`,
  );
} catch (err) {
  console.error(`✗ ${describePgError(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
