import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function load(path, result, deps = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
  const context = { Buffer, Date, console, ...deps }; vm.createContext(context);
  return vm.runInContext(`${stripTypeScriptTypes(source, { mode: 'transform' })}\n(${result})`, context);
}
const { CreditWallet, WalletError } = load('../server/creditWallet.ts', '{CreditWallet, WalletError}');
const schema = load('../server/creditSchema.ts', 'CREDIT_SCHEMA');
function fixture({ paid = true, expires = '2099-01-01', status = 'active', available = true, gate = true } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec(schema);
  const wallet = new CreditWallet(db);
  wallet.grant('studio-user', 200, 'initial', 'test balance');
  let cost = 49, model = 'gpt-image-1.5', handler;
  const register = load('../server/tableAiBilling.ts', 'registerTableAiBillingRoutes', {
    timingSafeEqual, CreditWallet, WalletError, TableImageError: class extends Error {}, generateTableImage: async () => ({ image: 'data:image/png;base64,aW1hZ2U=' }),
    readBridgeSettings: async () => ({ key: 'secret' }),
    findUserByFirebaseUid: async uid => uid === 'firebase-user' ? { id: 'studio-user' } : undefined,
    resolveSubscription: async () => ({ plan: paid ? 'pro' : 'free', status, currentPeriodEnd: expires }),
    PLANS: { free: {}, pro: {} }, getDb: () => db, isAvailable: () => available, creditsEnabled: () => gate,
    syncCredits: async () => wallet.getBalance('studio-user'),
    creditsForCostUsd: () => cost, priceForImage: () => 0.034,
    IMAGE_PRICING: { 'gpt-image': { get modelId() { return model; } } },
  });
  register({ post: (_path, fn) => { handler = fn; } });
  async function request(action, { key = 'secret', firebaseUid = 'firebase-user', model = 'gpt-image-1.5', jobKey = `table:${randomUUID()}` } = {}) {
    let code = 200, body;
    const res = { status: value => { code = value; return res; }, json: value => { body = value; return res; } };
    await handler({ get: () => key, params: { action }, body: { firebaseUid, jobKey, model } }, res);
    return { code, body, jobKey };
  }
  return { request, wallet, db, setCost: value => { cost = value; }, setModel: value => { model = value; } };
}

test('bridge secret required; browser cannot spend or refund credits', async () => {
  const f = fixture(); assert.equal((await f.request('reserve', { key: 'wrong' })).code, 403);
  assert.equal(f.wallet.getBalance('studio-user').available, 200); f.db.close();
});
test('active subscriber reserves then settles the exact Studio catalog price, idempotently', async () => {
  const f = fixture(); const start = await f.request('reserve');
  assert.equal(start.body.mode, 'credits'); assert.equal(start.body.credits, 49);
  assert.equal(f.wallet.getBalance('studio-user').available, 151);
  f.setCost(100); // admin changes price during generation
  assert.equal((await f.request('reserve', { jobKey: start.jobKey })).body.credits, 49);
  assert.equal((await f.request('settle', { jobKey: start.jobKey })).code, 200);
  assert.equal((await f.request('settle', { jobKey: start.jobKey })).code, 200);
  assert.equal(f.wallet.getBalance('studio-user').available, 151);
  assert.equal(f.wallet.getBalance('studio-user').reserved, 0);
  assert.equal(f.wallet.listLedger('studio-user').filter(r => r.kind === 'charge').length, 1); f.db.close();
});
test('failure returns reserved funds exactly once', async () => {
  const f = fixture(); const start = await f.request('reserve');
  await f.request('release', { jobKey: start.jobKey }); await f.request('release', { jobKey: start.jobKey });
  assert.equal(f.wallet.getBalance('studio-user').available, 200);
  assert.equal(f.wallet.getBalance('studio-user').reserved, 0); f.db.close();
});
test('unknown or another user cannot settle someone else reservation', async () => {
  const f = fixture(); const start = await f.request('reserve');
  assert.equal((await f.request('settle', { jobKey: start.jobKey, firebaseUid: 'other' })).code, 409);
  assert.equal(f.wallet.getBalance('studio-user').reserved, 49); f.db.close();
});
test('last available credits cannot be reserved twice by concurrent requests', async () => {
  const f = fixture(); f.wallet.adjust('studio-user', -151, 'test', 'tester');
  const results = await Promise.all([f.request('reserve'), f.request('reserve')]);
  assert.deepEqual(results.map(r => r.code).sort(), [200, 402]);
  assert.equal(f.wallet.getBalance('studio-user').available, 0); f.db.close();
});
for (const opts of [{ paid: false }, { expires: '2000-01-01' }, { status: 'canceled' }]) test(`non-active subscription uses free table allowance ${JSON.stringify(opts)}`, async () => {
  const f = fixture(opts); const result = await f.request('reserve');
  assert.equal(result.body.mode, 'free'); assert.equal(f.wallet.getBalance('studio-user').available, 200); f.db.close();
});
test('unknown Studio account is free; no email matching or new wallet is created', async () => {
  const f = fixture(); assert.equal((await f.request('access', { firebaseUid: 'new' })).body.mode, 'free');
  assert.equal(f.wallet.listAccounts().length, 1); f.db.close();
});
test('database outage and disabled billing refuse paid calls', async () => {
  for (const opts of [{ available: false }, { gate: false }]) {
    const f = fixture(opts); assert.equal((await f.request('reserve')).code, 503); f.db.close();
  }
});
test('access price and model follow the Studio admin catalog dynamically', async () => {
  const f = fixture(); f.setCost(73); f.setModel('gpt-image-2.5-sunburst');
  const result = await f.request('access');
  assert.equal(result.body.credits, 73); assert.equal(result.body.model, 'gpt-image-2.5-sunburst'); f.db.close();
});

test('generation requires reserved subscriber credits and rejects browser bridge impersonation', async () => {
  const f = fixture();
  assert.equal((await f.request('generate')).code, 402);
  const start = await f.request('reserve');
  assert.equal((await f.request('generate', { jobKey: start.jobKey, key: 'wrong' })).code, 403);
  assert.equal((await f.request('generate', { jobKey: start.jobKey })).code, 200);
  f.db.close();
});
test('model change between reservation and generation cannot silently change the billed model', async () => {
  const f = fixture(); const start = await f.request('reserve'); f.setModel('gpt-image-2.5-sunburst');
  assert.equal((await f.request('generate', { jobKey: start.jobKey })).code, 409); f.db.close();
});

function imageFixture({ key = 'admin-panel-only', status = 200, payload = { data: [{ b64_json: 'aW1hZ2U=' }] } } = {}) {
  let captured, calls = 0, requestedEngine;
  const generate = load('../server/tableAiGeneration.ts', 'generateTableImage', {
    FormData, Blob, Uint8Array, AbortSignal,
    process: { env: { OPENAI_API_KEY: 'must-never-use-env' } },
    platformKeyFor: async engine => { requestedEngine = engine; return key; },
    fetch: async (url, options) => { calls++; captured = { url, ...options }; return { ok: status === 200, status, json: async () => payload }; },
  });
  const input = { model: 'gpt-image-1.5', prompt: 'table preview', referenceImage: 'data:image/png;base64,iVBORw0KGgo=', apiKey: 'must-never-use-caller-key' };
  return { generate, input, inspect: () => ({ calls, captured, requestedEngine }) };
}
test('OpenAI request uses only Studio admin GPT key; no key is returned', async () => {
  const f = imageFixture(); const result = await f.generate(f.input);
  assert.equal(f.inspect().requestedEngine, 'gpt');
  assert.equal(f.inspect().captured.headers.Authorization, 'Bearer admin-panel-only');
  assert.deepEqual(Object.keys(result), ['image']);
  assert.doesNotMatch(JSON.stringify(result), /admin-panel-only|must-never-use/);
});
test('missing admin-panel key refuses generation despite env or caller keys', async () => {
  const empty = imageFixture({ key: '' });
  await assert.rejects(empty.generate(empty.input), /Ключі API/);
  assert.equal(empty.inspect().calls, 0);
});
for (const status of [401, 403, 429, 500]) test(`OpenAI ${status} errors expose no key`, async () => {
  const f = imageFixture({ status });
  await assert.rejects(f.generate(f.input), error => !/admin-panel-only|must-never-use/.test(error.message));
});
test('malformed provider image is rejected inside Studio', async () => {
  const f = imageFixture({ payload: { data: [] } }); await assert.rejects(f.generate(f.input), /некоректне/);
});

test('platform key resolver reads keys only from enabled administrators', async () => {
  const read = [];
  const resolver = load('../server/platformKeys.ts', 'platformKeyFor', {
    isApiKeyCryptoConfigured: () => true,
    listUsers: async () => [{ id: 'author', role: 'author' }, { id: 'disabled-admin', role: 'admin', disabled: true }, { id: 'active-admin', role: 'admin' }],
    getUserApiKey: async (id, engine) => { read.push([id, engine]); return { encryptedKey: 'ciphertext' }; },
    decryptApiKey: () => ' admin-key ',
  });
  assert.equal(await resolver('gpt'), 'admin-key');
  assert.deepEqual(read, [['active-admin', 'gpt']]);
});
test('a user-owned key cannot substitute for a missing administrator key', async () => {
  let reads = 0;
  const resolver = load('../server/platformKeys.ts', 'platformKeyFor', {
    isApiKeyCryptoConfigured: () => true,
    listUsers: async () => [{ id: 'author', role: 'author' }],
    getUserApiKey: async () => { reads++; return { encryptedKey: 'user-key' }; },
    decryptApiKey: () => 'user-key',
  });
  assert.equal(await resolver('gpt'), undefined); assert.equal(reads, 0);
});
