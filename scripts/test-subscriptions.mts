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
const { initStore, saveUser, recordUsage, __resetCacheForTests } = await import('../server/store.ts');
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

  console.log('\nЦіни:');
  await test('Start місяць = 260', () => assert.equal(priceFor('start', 'monthly'), 260));
  await test('Pro рік = 8000 (10x)', () => assert.equal(priceFor('pro', 'annual'), 8000));
  await test('Ultra місяць = 2600', () => assert.equal(priceFor('ultra', 'monthly'), 2600));
  await test('Free завжди 0', () => assert.equal(priceFor('free', 'annual'), 0));

  console.log('\nБезкоштовний план — ліміт 10 за весь час:');
  await test('новий користувач: план free, ліміт 10, використано 0', async () => {
    const check = await checkImageQuota(userId, 'writer');
    assert.equal(check.plan, 'free');
    assert.equal(check.quota, 10);
    assert.equal(check.used, 0);
    assert.equal(check.allowed, true);
  });

  // Симулюємо 10 успішних генерацій.
  for (let i = 0; i < 10; i++) {
    await recordUsage({
      id: `use-test-${i}`,
      timestamp: new Date().toISOString(),
      userId,
      userEmail: 'sub-test@example.com',
      role: 'writer',
      kind: 'image',
      engineId: 'nano-banana-2',
      modelId: 'gemini-3.1-flash-image',
      imageSize: '2K',
      costUsd: 0.101,
      success: true,
    });
  }

  await test('після 10 генерацій — квоту вичерпано', async () => {
    const check = await checkImageQuota(userId, 'writer');
    assert.equal(check.allowed, false);
    assert.equal(check.used, 10);
    assert.ok(check.reasonUk && check.reasonUk.includes('безкоштовний'));
  });

  await test('невдалі спроби не рахуються в квоту', async () => {
    await recordUsage({
      id: 'use-test-failed',
      timestamp: new Date().toISOString(),
      userId,
      userEmail: 'sub-test@example.com',
      role: 'writer',
      kind: 'image',
      engineId: 'nano-banana-2',
      modelId: 'gemini-3.1-flash-image',
      costUsd: 0,
      success: false,
    });
    const check = await checkImageQuota(userId, 'writer');
    assert.equal(check.used, 10); // не 11
  });

  console.log('\nАктивація платної підписки знімає ліміт free:');
  await test('після activateSubscription(pro) квота = 400, used скидається (новий period_start)', async () => {
    await activateSubscription(userId, 'pro', 'monthly', 'liqpay', 'test-payment-1');
    const check = await checkImageQuota(userId, 'writer');
    assert.equal(check.plan, 'pro');
    assert.equal(check.quota, 400);
    assert.equal(check.used, 0); // period-based, попередні lifetime-записи були до currentPeriodStart
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
