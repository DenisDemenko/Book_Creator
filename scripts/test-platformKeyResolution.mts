/**
 * Резолвінг ключа рушія для конкретного виклику (server/platformKeys.ts).
 * Запуск: npm run test:platform-keys
 *
 * Перевіряє саме той сценарій, на якому зловили баг #146: ключ у «Ключах
 * API» вставив ОДИН адміністратор, а запит до рушія робить хтось інший —
 * письменник або другий адміністратор. До фікса такий виклик ключа не
 * знаходив і мовчки йшов на змінну оточення.
 */
process.env.DATA_DIR = '/tmp/nova-test-platform-keys';
process.env.DATABASE_PATH = '/tmp/nova-test-platform-keys/n.db';
// Ключ шифрування сховища ключів — інакше isApiKeyCryptoConfigured() = false
// і резолвер свідомо повертає undefined (працює лише оточення).
process.env.USER_API_KEY_SECRET = 'test-secret-for-platform-key-resolution-32b';

import fs from 'node:fs';
fs.rmSync('/tmp/nova-test-platform-keys', { recursive: true, force: true });
fs.mkdirSync('/tmp/nova-test-platform-keys', { recursive: true });

const { initStore, saveUser, upsertUserApiKey, deleteUserApiKey } = await import('../server/store');
const { encryptApiKey, isApiKeyCryptoConfigured } = await import('../server/userApiKeyCrypto');
const { platformKeyFor, resolveEngineKey } = await import('../server/platformKeys');

await initStore();

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const now = new Date().toISOString();
const putKey = async (userId: string, engine: string, plain: string) => {
  await upsertUserApiKey({
    userId, engine,
    encryptedKey: encryptApiKey(plain),
    fingerprint: plain.slice(-8),
    createdAt: now, updatedAt: now,
  });
};

const mkUser = async (id: string, role: 'admin' | 'writer', disabled = false) => {
  await saveUser({
    id, email: `${id}@test.local`, name: id, role,
    disabled, createdAt: now, updatedAt: now,
  } as any);
};

const ADMIN_KEY = 'sk-admin-platform-key-0001';
const OWN_KEY = 'sk-writers-own-key-0002';
const OTHER_ADMIN_KEY = 'sk-second-admin-key-0003';

console.log('Передумови:');
t('шифрування сховища ключів налаштоване', isApiKeyCryptoConfigured());

await mkUser('admin-one', 'admin');
await mkUser('admin-two', 'admin');
await mkUser('writer-one', 'writer');
await mkUser('admin-off', 'admin', true);

console.log('\nКлюч вставив адміністратор — його бачать усі:');
await putKey('admin-one', 'deepseek', ADMIN_KEY);

t('платформний ключ знайдено', (await platformKeyFor('deepseek')) === ADMIN_KEY);
t('ПИСЬМЕННИК отримує ключ платформи', (await resolveEngineKey('writer-one', 'deepseek', 'test')) === ADMIN_KEY);
t('ІНШИЙ адміністратор отримує ключ платформи', (await resolveEngineKey('admin-two', 'deepseek', 'test')) === ADMIN_KEY);
t('сам вставляч отримує свій же ключ', (await resolveEngineKey('admin-one', 'deepseek', 'test')) === ADMIN_KEY);
t('без userId (фонова задача) теж працює', (await resolveEngineKey(undefined, 'deepseek', 'test')) === ADMIN_KEY);

console.log('\nІнший рушій — ключа немає, має бути undefined (далі підхопить оточення):');
t('для рушія без ключа повертає undefined', (await resolveEngineKey('writer-one', 'mistral', 'test')) === undefined);

console.log('\nВласний ключ користувача — запасний варіант, нічого не відібрано:');
await deleteUserApiKey('admin-one', 'deepseek');
await putKey('writer-one', 'deepseek', OWN_KEY);
t('платформного ключа більше немає', (await platformKeyFor('deepseek')) === undefined);
t('письменник із власним ключем використовує свій', (await resolveEngineKey('writer-one', 'deepseek', 'test')) === OWN_KEY);
t('чужий власний ключ не витікає до інших', (await resolveEngineKey('admin-two', 'deepseek', 'test')) === undefined);

console.log('\nПлатформний має пріоритет над власним (ключі належать платформі):');
await putKey('admin-two', 'deepseek', OTHER_ADMIN_KEY);
t('письменник із власним ключем усе одно бере платформний',
  (await resolveEngineKey('writer-one', 'deepseek', 'test')) === OTHER_ADMIN_KEY);

console.log('\nВимкнений адміністратор не постачає ключів:');
await deleteUserApiKey('admin-two', 'deepseek');
await putKey('admin-off', 'deepseek', 'sk-disabled-admin');
t('ключ вимкненого адміністратора ігнорується', (await platformKeyFor('deepseek')) === undefined);

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
