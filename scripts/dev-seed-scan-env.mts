/**
 * Тестове середовище для прогону WriterScan: тимчасова база з тестовим автором і його сесією.
 * Токен сесії пишеться у файл `$ENV_DIR/session.txt`, а не в консоль; база лише локальна й одноразова
 * (щоразу видаляється й створюється наново). Далі — справжній `server.ts` на цій базі; кроки — у
 * `docs/reports/DAILY_2026-11-04.md`, розділ «Тестове середовище».
 *
 * Запуск: ENV_DIR=<тека> npx tsx scripts/dev-seed-scan-env.mts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ENV_DIR = process.env.ENV_DIR!;
const DATA = path.join(ENV_DIR, 'data');
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
process.env.DATA_DIR = DATA;
process.env.DATABASE_PATH = path.join(DATA, 'nova-studio.db');

const db = await import('../server/db.ts');
const store = await import('../server/store.ts');
await db.initDb();
await store.initStore();

const user = {
  id: 'usr-scan-test',
  email: 'scan-test@example.test',
  name: 'Тестовий автор',
  role: 'writer' as const,
  createdAt: new Date().toISOString(),
};
await store.saveUser(user as any);
const token = crypto.randomBytes(32).toString('hex');
await store.createSession({
  token,
  userId: user.id,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
});
fs.writeFileSync(path.join(ENV_DIR, 'session.txt'), token, 'utf8');
console.log('тестового автора й сесію створено; база:', process.env.DATABASE_PATH);
await db.closeDb?.();
process.exit(0);
