/** Тести SQLite-сховища та міграції з JSON. Запуск: npm run test:sqlite */
const DIR = '/tmp/nova-sqlite-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

// Кладемо «старі» JSON-файли ДО першого відкриття бази — імітуємо оновлення
// вже працюючої інсталяції.
fs.writeFileSync(`${DIR}/users.json`, JSON.stringify([
  { id: 'u-old-1', email: 'Legacy@Example.com', name: 'Старий', role: 'writer',
    passwordHash: 'scrypt$aa$bb', createdAt: '2026-01-01T00:00:00Z', lastLoginAt: '2026-02-01T00:00:00Z' },
  { id: 'u-old-2', email: 'admin@example.com', name: 'Адмін', role: 'admin',
    createdAt: '2026-01-02T00:00:00Z', disabled: true },
]));
fs.writeFileSync(`${DIR}/sessions.json`, JSON.stringify([
  { token: 'tok-old', userId: 'u-old-1', createdAt: '2026-02-01T00:00:00Z',
    expiresAt: new Date(Date.now() + 86400000).toISOString() },
  { token: 'tok-dead', userId: 'u-old-1', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-02T00:00:00Z' },
]));
fs.writeFileSync(`${DIR}/usage.json`, JSON.stringify([
  { id: 'r1', timestamp: '2026-08-01T10:00:00Z', userId: 'u-old-1', userEmail: 'legacy@example.com',
    role: 'writer', kind: 'image', engineId: 'nano-banana-2', modelId: 'm', imageSize: '2K', costUsd: 0.101, success: true },
  { id: 'r2', timestamp: '2026-08-02T10:00:00Z', userId: 'u-old-1', userEmail: 'legacy@example.com',
    role: 'writer', kind: 'image', engineId: 'nano-banana-pro', modelId: 'm', imageSize: '4K', costUsd: 0.24, success: true },
  { id: 'r3', timestamp: '2026-08-02T11:00:00Z', userId: 'u-old-1', userEmail: 'legacy@example.com',
    role: 'writer', kind: 'image', engineId: 'nano-banana-pro', modelId: 'm', imageSize: '4K', costUsd: 0, success: false },
]));
fs.writeFileSync(`${DIR}/role-overrides.json`, JSON.stringify({ guest: { canGenerateImages: true } }));

const db = await import('../server/db');
const store = await import('../server/store');

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('Доступність SQLite:');
await db.initDb();
t('node:sqlite доступний', db.isAvailable(), db.unavailableMessage());
const info = await store.initStore();
t('бекенд = sqlite', info.backend === 'sqlite', info.backend);
t('файл бази створено', fs.existsSync(process.env.DATABASE_PATH!));

console.log('\nМіграція з JSON:');
{
  const users = await store.listUsers();
  t('перенесено 2 користувачів', users.length === 2, String(users.length));
  const legacy = await store.findUserByEmail('legacy@example.com');
  t('пошук нечутливий до регістру після міграції', legacy?.id === 'u-old-1');
  t('хеш пароля збережено', legacy?.passwordHash === 'scrypt$aa$bb');
  const admin = await store.findUserByEmail('admin@example.com');
  t('прапорець disabled збережено', admin?.disabled === true);
  t('користувач без пароля не отримав сміття', admin?.passwordHash === undefined);

  const live = await store.findSession('tok-old');
  t('жива сесія перенесена', live?.userId === 'u-old-1');
  t('протухла сесія не віддається', (await store.findSession('tok-dead')) === undefined);

  const usage = await store.listUsage();
  t('перенесено 3 записи витрат', usage.length === 3, String(usage.length));
  t('успішність збережено як boolean', usage.filter(r => r.success).length === 2);
  t('перевизначення ролей перенесено', (await store.getRoleOverrides()).guest?.canGenerateImages === true);
  t('маркер міграції створено', fs.existsSync(`${DIR}/.migrated-to-sqlite`));
  t('вихідні JSON-файли не видалені', fs.existsSync(`${DIR}/users.json`));
}

console.log('\nПовторний запуск не дублює дані:');
{
  store.__resetCacheForTests();
  await store.initStore();
  t('користувачів досі 2', (await store.listUsers()).length === 2);
  t('записів витрат досі 3', (await store.listUsage()).length === 3);
}

console.log('\nАгрегати рахує база:');
{
  const total = await store.totalSpendUsd();
  t('сума за весь час = 0.341', Math.abs(total - 0.341) < 1e-9, total.toFixed(4));
  const byUser = await store.spendByUser();
  t('витрати u-old-1', Math.abs((byUser.get('u-old-1')?.costUsd || 0) - 0.341) < 1e-9);
  t('невдалі не потрапили в лічильник', byUser.get('u-old-1')?.count === 2);
  const since = await store.listUsageSince('2026-08-02T00:00:00Z');
  t('вибірка за періодом працює', since.length === 2, String(since.length));
}

console.log('\nCRUD у базі:');
{
  await store.saveUser({ id: 'u-new', email: 'New@Test.com', name: 'Новий', role: 'designer', createdAt: new Date().toISOString() });
  t('створення', (await store.findUserByEmail('new@test.com'))?.name === 'Новий');
  await store.saveUser({ id: 'u-new', email: 'New@Test.com', name: 'Новий', role: 'publisher', createdAt: new Date().toISOString() });
  t('оновлення не дублює', (await store.listUsers()).length === 3);
  t('роль оновилася', (await store.findUserById('u-new'))?.role === 'publisher');

  await store.createSession({ token: 'tk1', userId: 'u-new', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  t('сесія створена', (await store.findSession('tk1'))?.userId === 'u-new');
  await store.deleteUser('u-new');
  t('видалення користувача', (await store.findUserById('u-new')) === undefined);
  t('сесії користувача теж прибрано', (await store.findSession('tk1')) === undefined);

  const purged = await store.purgeExpiredSessions();
  t('очищення протухлих сесій повертає число', typeof purged === 'number', String(purged));
}

console.log('\nУнікальність пошти:');
{
  let threw = false;
  try {
    await store.saveUser({ id: 'u-dup', email: 'LEGACY@example.com', name: 'Дубль', role: 'writer', createdAt: new Date().toISOString() });
  } catch { threw = true; }
  t('база не дає створити другий запис із тією ж поштою', threw);
}

// Регресія на реальний баг Фази G3: у SCHEMA був CREATE UNIQUE INDEX на
// users(firebase_uid), який виконувався ДО міграції, що додає цю колонку.
// Для свіжої бази все проходило (колонка є в CREATE TABLE), тож решта цього
// файлу нічого не помічала — а от будь-яка база, створена до Фази G1, валила
// весь initDb() з "no such column" і сховище тихо відкочувалось на JSON.
// Тому тут база створюється саме у СТАРОМУ вигляді, а не з нуля.
console.log('\nВідкриття бази, створеної до появи firebase_uid:');
{
  const OLD_DIR = '/tmp/nova-sqlite-oldshape';
  const OLD_DB = `${OLD_DIR}/nova-studio.db`;
  fs.rmSync(OLD_DIR, { recursive: true, force: true });
  fs.mkdirSync(OLD_DIR, { recursive: true });

  const { DatabaseSync } = await import('node:sqlite');
  const legacy = new DatabaseSync(OLD_DB);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT,
      google_id TEXT,
      avatar_url TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );`);
  legacy.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('u-legacy', 'old@example.com', 'До G1', 'writer', 'scrypt$aa$bb', null, null, 0, '2026-01-01T00:00:00Z', null);
  legacy.close();

  // Свій модуль бази, щоб не чіпати вже проініціалізований у решті файлу.
  process.env.DATA_DIR = OLD_DIR;
  process.env.DATABASE_PATH = OLD_DB;
  const freshDbModule = await import(`../server/db.ts?oldshape=${Date.now()}`);

  const opened = await freshDbModule.initDb();
  t('стара база відкривається, а не падає у JSON-фолбек', opened === true);

  if (opened) {
    const handle = freshDbModule.getDb()!;
    const cols = (handle.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
    t('міграція додала колонку firebase_uid', cols.includes('firebase_uid'));

    const idx = (handle.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_firebase_uid'").all() as unknown[]);
    t('унікальний індекс на firebase_uid створено міграцією', idx.length === 1);

    const row = handle.prepare('SELECT name, role FROM users WHERE id = ?').get('u-legacy') as { name: string; role: string } | undefined;
    t('наявні дані не втрачені', row?.name === 'До G1' && row?.role === 'writer');

    // Windows не дає видалити файл, поки дескриптор відкритий.
    handle.close?.();
  }

  try {
    fs.rmSync(OLD_DIR, { recursive: true, force: true });
  } catch {
    // Прибирання тимчасової теки — не привід валити тести.
  }
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
