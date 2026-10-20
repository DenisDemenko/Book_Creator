/**
 * Юніт-тести тарифів і квоти генерацій зображень (server/subscriptions.ts).
 * Не піднімає сервер — працює напряму зі store.ts (SQLite чи JSON-фолбек).
 *
 * ВАЖЛИВО: DATA_DIR/DATABASE_PATH ізольовані в /tmp, як і в test-sqlite.mts,
 * test-auth.mts, test-apiKeys.mts. До цього виправлення цей файл не мав
 * ізоляції — __dropDatabaseForTests() (виклик на початку І в кінці) видаляв
 * СПРАВЖНІЙ файл data/nova-studio.db, яким одночасно користується dev-сервер
 * (npm run dev), стираючи реальні акаунти, збережені ключі API, підписки —
 * все. Саме так одного разу зникли ключі LLM, введені в панелі «Ключі API».
 * Імпорти нижче — динамічні (await import), а не статичні: інакше ESM
 * підняв би їх вище за присвоєння DATA_DIR/DATABASE_PATH, і server/db.ts
 * прочитав би змінні ДО того, як ми їх перевизначили.
 */
const DIR = '/tmp/nova-subscriptions-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

import assert from 'node:assert/strict';
const { initStore, saveUser, __resetCacheForTests } = await import('../server/store.ts');
const { CreditWallet } = await import('../server/creditWallet.ts');
const { getDb } = await import('../server/db.ts');
const { checkImageQuota, activateSubscription, resolveSubscription, priceFor, PLANS } = await import('../server/subscriptions.ts');
const { __dropDatabaseForTests } = await import('../server/db.ts');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name} — ${(err as Error).message}`);
    }
  })();
}

async function main() {
  __dropDatabaseForTests();
  __resetCacheForTests();
  await initStore();

  const userId = 'sub-test-user-1';
  await saveUser({
    id: userId,
    email: 'sub-test@example.com',
    name: 'Тест',
    role: 'writer',
    createdAt: new Date().toISOString(),
  });

  console.log('\nЦіни (платник ПДВ, маржа 30%, текст 200 грн):');
  await test('Start місяць = 540', () => assert.equal(priceFor('start', 'monthly'), 540));
  await test('Pro рік = 7400 (10x)', () => assert.equal(priceFor('pro', 'annual'), 7400));
  await test('Ultra місяць = 2100', () => assert.equal(priceFor('ultra', 'monthly'), 2100));
  await test('Team місяць = 3800', () => assert.equal(priceFor('team', 'monthly'), 3800));
  await test('Free завжди 0', () => assert.equal(priceFor('free', 'annual'), 0));

  console.log('\nЗареєстрований без підписки («гість») — 300 пробних балів одноразово:');
  await test('новий користувач: план free, 300 балів, використано 0', async () => {
    const check = await checkImageQuota(userId, 'writer');
    assert.equal(check.plan, 'free');
    assert.equal(check.quota, 300);
    assert.equal(check.remaining, 300);
    assert.equal(check.allowed, true);
  });

  await test('повторна перевірка не нараховує пробні бали вдруге', async () => {
    await checkImageQuota(userId, 'writer');
    const check = await checkImageQuota(userId, 'writer');
    assert.equal(check.remaining, 300);
  });

  const wallet = new CreditWallet(getDb() as any);
  await test('після витрати 290 балів лишається 10 < 18 — генерацію заблоковано', async () => {
    wallet.reserve(userId, 'trial-job', 290);
    wallet.settle('trial-job', 290);
    const check = await checkImageQuota(userId, 'writer');
    assert.equal(check.allowed, false);
    assert.equal(check.remaining, 10);
    assert.ok(check.reasonUk && check.reasonUk.includes('Пробні'));
  });

  console.log('\nАктивація платної підписки нараховує місячний пакет:');
  await test('після activateSubscription(pro) пакет = 5000, залишок пробних згорів', async () => {
    await activateSubscription(userId, 'pro', 'monthly', 'liqpay', 'test-payment-1');
    const check = await checkImageQuota(userId, 'writer');
    assert.equal(check.plan, 'pro');
    assert.equal(check.quota, 5000);
    assert.equal(check.remaining, 5000);
    assert.equal(check.allowed, true);
  });

  await test('resolveSubscription повертає активний план pro', async () => {
    const sub = await resolveSubscription(userId);
    assert.equal(sub.plan, 'pro');
    assert.equal(sub.status, 'active');
    assert.equal(sub.provider, 'liqpay');
  });

  console.log('\nАдмін завжди без ліміту:');
  await test('адмін — allowed=true, quota=null незалежно від використання', async () => {
    const check = await checkImageQuota('any-admin-id', 'admin');
    assert.equal(check.allowed, true);
    assert.equal(check.quota, null);
  });

  console.log(`\nРезультат: ${passed} пройдено, ${failed} провалено`);
  __dropDatabaseForTests();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
