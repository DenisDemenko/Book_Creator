/**
 * HTTP-тести адмін-маршрутів балів і підписок (server/adminRoutes.ts):
 * огляд, зміна параметрів, коригування балансу, призначення тарифу, права.
 */
const DIR = '/tmp/nova-admin-credits-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

import assert from 'node:assert/strict';
import express from 'express';
const { initStore, saveUser, __resetCacheForTests } = await import('../server/store.ts');
const { __dropDatabaseForTests } = await import('../server/db.ts');
const admin = await import('../server/adminRoutes.ts');
const { applyTaxRegime } = await import('../server/subscriptions.ts');

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
  }
}

async function main() {
  __dropDatabaseForTests();
  __resetCacheForTests();
  await initStore();
  applyTaxRegime('vat_payer');
  await saveUser({ id: 'u1', email: 'u1@example.com', name: 'U1', role: 'writer', createdAt: new Date().toISOString() });

  let principal: any = { id: 'adm', email: 'admin@example.com', role: 'admin', isGuest: false };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.principal = principal;
    next();
  });
  admin.registerAdminRoutes(app);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
  };

  console.log('\nОгляд і параметри:');
  await test('огляд містить фото й відео з балами та приклад', async () => {
    const r = await call('GET', '/api/admin/credits/overview');
    assert.equal(r.status, 200);
    assert.ok(r.json.images.length > 10 && r.json.videos.length > 5);
    assert.ok(r.json.examples.photo.credits > 0 && r.json.examples.video.credits > r.json.examples.photo.credits);
    assert.equal(r.json.plans.find((p: any) => p.id === 'start').credits, 2000);
  });
  await test('PUT config: курс 60 підвищує ціни планів в огляді', async () => {
    const before = (await call('GET', '/api/admin/credits/overview')).json.plans.find((p: any) => p.id === 'pro').priceMonthlyUah;
    const r = await call('PUT', '/api/admin/credits/config', { fxUahPerUsd: 60 });
    assert.equal(r.status, 200);
    assert.ok(r.json.plans.find((p: any) => p.id === 'pro').priceMonthlyUah > before);
    await call('PUT', '/api/admin/credits/config', { fxUahPerUsd: 48 });
  });
  await test('PUT config: некоректне значення → 400', async () => {
    assert.equal((await call('PUT', '/api/admin/credits/config', { targetMarginPercent: 999 })).status, 400);
  });

  console.log('\nКористувач: баланс, коригування, тариф:');
  await test('призначення тарифу start нараховує 2000 балів', async () => {
    const r = await call('POST', '/api/admin/credits/users/u1/plan', { plan: 'start', cycle: 'monthly' });
    assert.equal(r.status, 200);
    assert.equal(r.json.balance.available, 2000);
  });
  await test('коригування без причини → 400, з причиною → баланс і журнал', async () => {
    assert.equal((await call('POST', '/api/admin/credits/users/u1/adjust', { delta: 100, reason: '' })).status, 400);
    const r = await call('POST', '/api/admin/credits/users/u1/adjust', { delta: 100, reason: 'компенсація' });
    assert.equal(r.json.balance.available, 2100);
    const l = await call('GET', '/api/admin/credits/users/u1/ledger');
    assert.equal(l.json.ledger[0].kind, 'adjustment');
    assert.equal(l.json.ledger[0].operator, 'admin@example.com');
  });
  await test('коригування нижче нуля заборонене', async () => {
    assert.equal((await call('POST', '/api/admin/credits/users/u1/adjust', { delta: -999999, reason: 'x' })).status, 400);
  });
  await test('список користувачів показує тариф і баланс', async () => {
    const r = await call('GET', '/api/admin/credits/users');
    const u = r.json.users.find((x: any) => x.id === 'u1');
    assert.equal(u.plan, 'start');
    assert.equal(u.available, 2100);
  });

  console.log('\nПрава:');
  await test('не-адмін отримує 403 на всі маршрути балів', async () => {
    principal = { id: 'u1', email: 'u1@example.com', role: 'writer', isGuest: false };
    for (const [m, u] of [['GET', '/api/admin/credits/overview'], ['GET', '/api/admin/credits/users'], ['PUT', '/api/admin/credits/config'], ['POST', '/api/admin/credits/users/u1/adjust']]) {
      assert.equal((await call(m, u, {})).status, 403, `${m} ${u}`);
    }
  });

  server.close();
  console.log(`\nРезультат: ${passed} пройдено, ${failed} провалено`);
  __dropDatabaseForTests();
  if (failed > 0) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
