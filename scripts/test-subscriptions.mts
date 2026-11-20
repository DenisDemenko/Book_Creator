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
const { checkImageQuota, activateSubscription, resolveSubscription, priceFor, PLANS, getActiveTaxRegime } = await import('../server/subscriptions.ts');
const { constructorPlanProjection } = await import('../server/constructorRenderReport.ts');
const { quoteConstructorImages } = await import('../server/constructorImageEngines.ts');
const { listEngines } = await import('../server/imageGeneration.ts');
const { captureImagePrice, priceForImage, setImagePriceOverrides } = await import('../server/pricing.ts');
const { loadProviderImagePricing, providerPricingReview, saveProviderImagePricing, confirmedProviderImagePrice } =
  await import('../server/providerImagePricing.ts');
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

  const gptImage = { costUsd: 0.034, credits: 49 };
  const pro = { ...PLANS.pro, credits: PLANS.pro.aiCredits };
  await test('націнка 30% і залишок підписки обчислюються окремо', () => {
    const row = constructorPlanProjection(pro, gptImage, getActiveTaxRegime(), 48, false);
    assert.equal(row.photos, 102);
    assert.equal(row.grossUah, 740);
    assert.equal(row.imageCostUah, 166.46);
    assert.equal(row.markupRevenueUah, 216.40);
    assert.equal(row.markupUah, 49.94);
    assert.equal(row.contributionUah, 191);
  });
  await test('річний тариф враховує 12 місячних пакетів і річну ціну', () => {
    const row = constructorPlanProjection(pro, gptImage, getActiveTaxRegime(), 48, true);
    assert.equal(row.photos, 1224);
    assert.equal(row.grossUah, 7400);
    assert.equal(row.otherAiUah, 2400);
    assert.equal(row.contributionUah, 1177.10);
  });
  await test('Free використовує п’ять запусків за весь час і нульову виручку', () => {
    const free = { ...PLANS.free, credits: PLANS.free.aiCredits };
    const row = constructorPlanProjection(free, gptImage, getActiveTaxRegime(), 48, true);
    assert.equal(row.photos, 5);
    assert.equal(row.grossUah, 0);
    assert.equal(row.contributionUah, -8.16);
  });

  await test('новий тариф змінює AI-бали, скасовує стару оцінку та зберігається після завантаження', async () => {
    const access = {
      registry: listEngines({ google: false, openai: true, bytedance: false, leonardo: false }),
      google: new Map(), seedream: undefined, leonardo: undefined, seedreamViaFal: false,
    };
    const quote = (aspectRatio: string) => quoteConstructorImages(access, '1K', aspectRatio).find((row) => row.id === 'gpt-image')!;
    const before = quote('1:1');
    const priceAtReservation = captureImagePrice();
    assert.equal(before.credits, 49);
    await saveProviderImagePricing({
      action: 'price', revision: providerPricingReview().revision, key: before.priceKey, costUsd: 0.07,
      sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-image-1.5',
    }, 'admin-fixture');
    const after = quote('1:1');
    assert.equal(after.costUsd, 0.07);
    assert.equal(priceAtReservation('gpt-image', '1K'), 0.034);
    assert.equal(after.credits, 100);
    assert.notEqual(after.quoteHash, before.quoteHash);
    assert.equal(quote('16:9').costUsd, 0.05);
    assert.equal(confirmedProviderImagePrice(after.priceKey!)?.updatedBy, 'admin-fixture');
    setImagePriceOverrides({});
    assert.equal(priceForImage('gpt-image', '1K'), 0.034);
    await loadProviderImagePricing();
    assert.equal(priceForImage('gpt-image', '1K'), 0.07);
  });

  await test('непідтверджена ціна і паралельні записи не перезаписують тариф', async () => {
    const revision = providerPricingReview().revision;
    await assert.rejects(saveProviderImagePricing({
      action: 'price', revision, key: 'gpt-image@1K', costUsd: 0.02, sourceUrl: 'javascript:alert(1)',
    }, 'admin-fixture'), /HTTPS/);
    assert.equal(providerPricingReview().revision, revision);
    const concurrent = await Promise.allSettled([
      saveProviderImagePricing({ action: 'review', revision }, 'admin-a'),
      saveProviderImagePricing({ action: 'review', revision }, 'admin-b'),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    const stale = concurrent.find((result) => result.status === 'rejected');
    assert.equal(stale?.reason.status, 409);
    assert.equal(priceForImage('gpt-image', '1K'), 0.07);
  });

  await test('нагадування стає активним через сім днів після підтвердження', () => {
    const review = providerPricingReview();
    assert.equal(Date.parse(review.dueAt!) - Date.parse(review.reviewedAt!), 7 * 86_400_000);
    assert.equal(providerPricingReview(Date.parse(review.dueAt!) - 1).due, false);
    assert.equal(providerPricingReview(Date.parse(review.dueAt!)).due, true);
  });

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
