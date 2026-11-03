/**
 * Тести підключення гаманця до генерації (server/creditGate.ts) і грошового
 * ліміту тексту (checkChatQuota). Ізольована база в /tmp, як у test-subscriptions.
 */
const DIR = '/tmp/nova-credit-gate-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

import assert from 'node:assert/strict';
const { initStore, saveUser, recordUsage, upsertSubscription, __resetCacheForTests } = await import('../server/store.ts');
const { beginImage, beginVideo, assertVideoAffordable, syncCredits, ImageCreditsError, beginJev, jevTariff, jevCreditsPerMillionTokens } = await import('../server/creditGate.ts');
const { JevCreditsError } = await import('../server/core/ai/jevBilling.ts');
const { imageCostTable, videoCostTable } = await import('../server/creditCatalog.ts');
const { updatePricingConfig, PLANS, priceFor } = await import('../server/subscriptions.ts');
const { creditsForCostUsd } = await import('../server/creditPricing.ts');
const { getPricingConfig, DEFAULT_PRICING_CONFIG } = await import('../server/taxPricing.ts');
const { checkChatQuota, activateSubscription, textBudgetUsd } = await import('../server/subscriptions.ts');
const { __dropDatabaseForTests } = await import('../server/db.ts');
const { CreditWallet } = await import('../server/creditWallet.ts');
const { getDb } = await import('../server/db.ts');

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name} — ${(err as Error).message}`);
  }
}
const req = (id: string, role = 'writer') => ({ principal: { id, role, isGuest: false } });
const ENGINE = ['nano-banana-2', 'gemini-3.1-flash-image', '1K'] as const; // $0.067 → 96 балів

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'no-error';
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
}

async function main() {
  __dropDatabaseForTests();
  __resetCacheForTests();
  await initStore();
  const w = () => new CreditWallet(getDb() as any);
  for (const id of ['u-vid', 'u-trial', 'u-fail', 'u-low', 'u-pay', 'u-lapse', 'u-text', 'u-free-text', 'u-jev', 'u-jev2', 'u-jev3', 'u-jev4', 'u-jev5']) {
    await saveUser({ id, email: `${id}@example.com`, name: id, role: 'writer', createdAt: new Date().toISOString() });
  }

  console.log('\nГенерація зображення: резерв → списання/повернення:');
  await test('успіх: резерв 96, списано 96, лишилось 204 з 300', async () => {
    const job = await beginImage(req('u-trial'), ...ENGINE);
    assert.ok(job);
    assert.equal(job!.reservedCredits, 96);
    assert.equal(w().getBalance('u-trial').reserved, 96);
    job!.settle(...ENGINE);
    assert.deepEqual(w().getBalance('u-trial'), { userId: 'u-trial', available: 204, reserved: 0 });
  });
  await test('збій провайдера: резерв повернено повністю', async () => {
    const job = await beginImage(req('u-fail'), ...ENGINE);
    job!.release('429');
    assert.equal(w().getBalance('u-fail').available, 300);
  });
  await test('недостатньо балів: ImageCreditsError до виклику провайдера, баланс не змінено', async () => {
    w().grant('u-low', 1, 'x', 't'); // створює рахунок; пробні 300 нижче спалимо
    await syncCredits('u-low');
    const before = w().getBalance('u-low').available;
    w().adjust('u-low', -(before - 50), 'тест', 'op');
    assert.equal(await codeOf(beginImage(req('u-low'), ...ENGINE)), 'IMAGE_CREDITS_LOW');
    assert.equal(w().getBalance('u-low').available, 50);
  });
  await test('помилка має kind=credits і status=402 (маршрути віддають 402)', async () => {
    try {
      await beginImage(req('u-low'), ...ENGINE);
      assert.fail('очікувалась помилка');
    } catch (e) {
      assert.ok(e instanceof ImageCreditsError);
      assert.equal((e as InstanceType<typeof ImageCreditsError>).kind, 'credits');
      assert.equal((e as InstanceType<typeof ImageCreditsError>).status, 402);
    }
  });
  await test('невідома ціна рушія: IMAGE_PRICE_UNKNOWN, без списання', async () => {
    assert.equal(await codeOf(beginImage(req('u-trial'), 'no-such-engine', 'no-such-model', '1K')), 'IMAGE_PRICE_UNKNOWN');
  });
  await test('адмін і гість без входу — гейт не застосовується', async () => {
    assert.equal(await beginImage(req('any-admin', 'admin'), ...ENGINE), null);
    assert.equal(await beginImage({ principal: { isGuest: true } }, ...ENGINE), null);
  });
  await test('AI_CREDITS_DISABLED=1 — аварійний вимикач', async () => {
    process.env.AI_CREDITS_DISABLED = '1';
    try {
      assert.equal(await beginImage(req('u-trial'), ...ENGINE), null);
    } finally {
      delete process.env.AI_CREDITS_DISABLED;
    }
  });

  console.log('\nВідео: той самий гаманець, ціна за фактичними параметрами:');
  await test('Kling 2.5, 5 с, 1080 = $0.30 → 429 балів; резерв і списання', async () => {
    await activateSubscription('u-vid', 'team', 'monthly', 'liqpay', 'pv');
    const job = await beginVideo(req('u-vid'), 'leonardo-kling2-5', '1080', 5);
    assert.ok(job);
    assert.equal(job!.reservedCredits, 429);
    assert.equal(w().getBalance('u-vid').available, 50000 - 429);
    job!.settleVideo('leonardo-kling2-5', 'KLING2_5', '1080', 5);
    assert.deepEqual(w().getBalance('u-vid'), { userId: 'u-vid', available: 50000 - 429, reserved: 0 });
  });
  await test('збій відео: резерв повернено', async () => {
    const before = w().getBalance('u-vid').available;
    const job = await beginVideo(req('u-vid'), 'leonardo-kling2-5', '1080', 5);
    job!.release('quota');
    assert.equal(w().getBalance('u-vid').available, before);
  });
  await test('пробних 300 балів не вистачає на відео: швидка відмова 402 без резерву', async () => {
    const e = await (async () => {
      try {
        await assertVideoAffordable(req('u-fail'), 'leonardo-kling2-5', '1080', 5);
        return null;
      } catch (x) {
        return x as any;
      }
    })();
    assert.ok(e instanceof ImageCreditsError);
    assert.equal(e.code, 'IMAGE_CREDITS_LOW');
    assert.equal(w().getBalance('u-fail').reserved, 0);
  });
  await test('одне відео коштує в рази більше за одне фото', () => {
    const photo = creditsForCostUsd(0.067);
    const video = creditsForCostUsd(0.3);
    assert.ok(video > photo * 4, `${video} vs ${photo}`);
  });
  await test('каталог: рядки фото й відео збігаються з живою формулою списання', () => {
    for (const r of imageCostTable()) assert.equal(r.credits, creditsForCostUsd(r.costUsd));
    const v = videoCostTable().find((x) => x.engineId === 'leonardo-kling2-5' && x.resolution === '1080');
    assert.equal(v?.credits, 429);
  });

  console.log('\nАдмін-коригування автоматично переходять у підписки й списання:');
  await test('курс 48 → 60: ціни планів ростуть, формула балів не змінюється (вартість бала в $)', async () => {
    const before = priceFor('pro', 'monthly');
    await updatePricingConfig({ fxUahPerUsd: 60 });
    assert.ok(priceFor('pro', 'monthly') > before);
    assert.equal(creditsForCostUsd(0.067), 96);
    await updatePricingConfig({ fxUahPerUsd: 48 });
    assert.equal(priceFor('pro', 'monthly'), before);
  });
  await test('маржа 30 → 40%: фото коштує більше балів, ціни не падають', async () => {
    const price = priceFor('start', 'monthly');
    await updatePricingConfig({ targetMarginPercent: 40 });
    assert.equal(creditsForCostUsd(0.067), 112); // ceil(0.067 / 0.0006)
    assert.ok(priceFor('start', 'monthly') >= price);
    await updatePricingConfig({ targetMarginPercent: 30 });
    assert.equal(creditsForCostUsd(0.067), 96);
  });
  await test('пакет плану й ліміт тексту з адмінки миттєво в PLANS', async () => {
    await updatePricingConfig({ planCredits: { start: 3000 }, textBudgetUah: 300 });
    assert.equal(PLANS.start.aiCredits, 3000);
    assert.ok(Math.abs((PLANS.start.chatQuotaUsd ?? 0) - 300 / 48) < 1e-9);
    await updatePricingConfig({ planCredits: { start: 2000 }, textBudgetUah: 200 });
    assert.deepEqual(getPricingConfig(), DEFAULT_PRICING_CONFIG);
  });
  await test('некоректні значення відхиляються, конфіг не псується', async () => {
    let msg = '';
    try {
      await updatePricingConfig({ targetMarginPercent: 120 });
    } catch (e) {
      msg = (e as Error).message;
    }
    assert.ok(msg.length > 0);
    assert.equal(getPricingConfig().targetMarginPercent, 30);
  });

  console.log('\nПідписка: пакет, згоряння, завершення:');
  await test('платний план: щомісячний пакет, залишок пробних згорає', async () => {
    await activateSubscription('u-pay', 'start', 'monthly', 'liqpay', 'p1');
    const b = await syncCredits('u-pay');
    assert.equal(b.available, 2000);
    assert.equal((await syncCredits('u-pay')).available, 2000); // повтор без ефекту
  });
  await test('річна підписка: через місяць новий пакет, старий залишок згорає', async () => {
    const start = new Date(Date.now() - 35 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 300 * 86_400_000).toISOString();
    await upsertSubscription({
      userId: 'u-pay', plan: 'start', billingCycle: 'annual', status: 'active',
      currentPeriodStart: start, currentPeriodEnd: end, createdAt: start, updatedAt: start,
    } as any);
    w().adjust('u-pay', -1500, 'витрачено', 'op'); // лишилось 500 від першого місяця
    await syncCredits('u-pay'); // monthIdx = 1 → згоряння + новий пакет
    assert.equal(w().getBalance('u-pay').available, 2000);
  });
  await test('підписка закінчилась: платні залишки згорають до 300', async () => {
    const start = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const end = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await upsertSubscription({
      userId: 'u-lapse', plan: 'pro', billingCycle: 'monthly', status: 'active',
      currentPeriodStart: start, currentPeriodEnd: end, createdAt: start, updatedAt: start,
    } as any);
    w().grant('u-lapse', 5000, 'old-pack', 'старий пакет');
    const b = await syncCredits('u-lapse');
    assert.equal(b.available, 300);
  });

  console.log('\nТекст: грошовий ліміт 200 грн на підписку (не бали):');
  const now = new Date().toISOString();
  const usage = (id: string, userId: string, cost: number, ctx: string) =>
    recordUsage({
      id, timestamp: new Date(Date.now() + 1000).toISOString(), userId, userEmail: `${userId}@example.com`, role: 'writer',
      kind: 'text', engineId: 'gemini', modelId: 'm', costUsd: cost, success: true, context: ctx,
    } as any);
  await test('ліміт у доларах = 200 грн за курсом цін', () => assert.ok(Math.abs(textBudgetUsd() - 200 / 48) < 1e-9));
  await test('платна підписка: поки витрати тексту нижче ліміту — дозволено', async () => {
    await activateSubscription('u-text', 'start', 'monthly', 'liqpay', 'p2');
    await usage('t1', 'u-text', 1.0, 'Редактор');
    assert.equal((await checkChatQuota('u-text', 'writer')).allowed, true);
  });
  await test('ліміт рахує ВЕСЬ текст (не лише чат) і блокує після вичерпання', async () => {
    await usage('t2', 'u-text', textBudgetUsd(), 'Аналіз JEV');
    const q = await checkChatQuota('u-text', 'writer');
    assert.equal(q.allowed, false);
    assert.ok(q.reasonUk?.includes('200 грн'));
  });
  await test('безкоштовний користувач і адмін текстовим лімітом не обмежені', async () => {
    await usage('t3', 'u-free-text', 99, 'Редактор');
    assert.equal((await checkChatQuota('u-free-text', 'writer')).allowed, true);
    assert.equal((await checkChatQuota('any-admin', 'admin')).allowed, true);
  });

  console.log('\nJev: 4000 балів за 1 млн токенів (03.11.2026):');
  await test('тариф за замовчуванням — 4000 балів за 1 млн токенів, редагується в конфігу', async () => {
    assert.equal(jevCreditsPerMillionTokens(), 4000);
    assert.equal(DEFAULT_PRICING_CONFIG.jevCreditsPerMillionTokens, 4000);
    await updatePricingConfig({ jevCreditsPerMillionTokens: 5000 });
    assert.equal(jevCreditsPerMillionTokens(), 5000);
    await updatePricingConfig({ jevCreditsPerMillionTokens: 4000 });
  });
  await test('некоректний тариф відхиляється: від’ємний, дробовий, завеликий', async () => {
    for (const bad of [-1, 1.5, 10_000_001, 'abc']) {
      await assert.rejects(updatePricingConfig({ jevCreditsPerMillionTokens: bad }), /jevCreditsPerMillionTokens/);
    }
    assert.equal(jevCreditsPerMillionTokens(), 4000);
  });
  await test('резерв з запасом 25%: оцінка 20 000 токенів → резерв 100 балів; списано за фактичні 15 000 = 60', async () => {
    const job = await beginJev(req('u-jev'), 20_000);
    assert.ok(job);
    assert.equal(job!.reservedCredits, 100); // 20 000 × 1,25 = 25 000 токенів × 4000 / 1e6
    assert.equal(w().getBalance('u-jev').reserved, 100);
    const settled = job!.settleTokens(15_000);
    assert.deepEqual(settled, { credits: 60, capped: false });
    assert.deepEqual(w().getBalance('u-jev'), { userId: 'u-jev', available: 240, reserved: 0 });
  });
  await test('витрата понад резерв: списано лише резерв і це названо (capped)', async () => {
    const job = await beginJev(req('u-jev2'), 20_000);
    const settled = job!.settleTokens(100_000); // хотіли б 400, резерв 100
    assert.deepEqual(settled, { credits: 100, capped: true });
    assert.equal(w().getBalance('u-jev2').available, 200);
  });
  await test('нуль токенів: весь резерв повертається', async () => {
    const job = await beginJev(req('u-jev3'), 20_000);
    assert.deepEqual(job!.settleTokens(0), { credits: 0, capped: false });
    assert.deepEqual(w().getBalance('u-jev3'), { userId: 'u-jev3', available: 300, reserved: 0 });
  });
  await test('збій Jev: release повертає резерв', async () => {
    const job = await beginJev(req('u-jev4'), 20_000);
    job!.release('429');
    assert.deepEqual(w().getBalance('u-jev4'), { userId: 'u-jev4', available: 300, reserved: 0 });
  });
  await test('балів не вистачає: JevCreditsError (402) ДО Jev, баланс не змінено, у тексті тариф', async () => {
    // 100 000 токенів × 1,25 × 4000 / 1e6 = 500 балів, а на рахунку 300 пробних.
    let err: unknown;
    try {
      await beginJev(req('u-jev5'), 100_000);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof JevCreditsError);
    const e = err as InstanceType<typeof JevCreditsError>;
    assert.equal(e.status, 402);
    assert.equal(e.kind, 'credits');
    assert.equal(e.code, 'JEV_CREDITS_LOW');
    assert.equal(e.needed, 500);
    assert.equal(e.available, 300);
    assert.ok(e.message.includes('4000 балів за 1 млн токенів'));
    assert.deepEqual(w().getBalance('u-jev5'), { userId: 'u-jev5', available: 300, reserved: 0 });
  });
  await test('адмін, гість і нульова оцінка гейтом не обмежені', async () => {
    assert.equal(await beginJev(req('any-admin', 'admin'), 1_000_000), null);
    assert.equal(await beginJev({ principal: { id: null, role: 'guest', isGuest: true } }, 1_000_000), null);
    assert.equal(await beginJev(req('u-jev'), 0), null);
  });
  await test('нульовий тариф: Jev безкоштовний, гейт не втручається', async () => {
    await updatePricingConfig({ jevCreditsPerMillionTokens: 0 });
    assert.equal(await beginJev(req('u-jev'), 1_000_000), null);
    await updatePricingConfig({ jevCreditsPerMillionTokens: 4000 });
  });
  await test('тариф і баланс для панелі: користувач — з балансом, адмін — без обмежень', async () => {
    const user = await jevTariff(req('u-jev'));
    assert.deepEqual(user, { creditsPerMillionTokens: 4000, unlimited: false, balance: 240 });
    const admin = await jevTariff(req('any-admin', 'admin'));
    assert.deepEqual(admin, { creditsPerMillionTokens: 4000, unlimited: true, balance: null });
  });
  void now;

  console.log(`\nРезультат: ${passed} пройдено, ${failed} провалено`);
  __dropDatabaseForTests();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
