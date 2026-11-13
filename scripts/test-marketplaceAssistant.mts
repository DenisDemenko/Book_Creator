import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
const dir = mkdtempSync(join(tmpdir(), 'nova-marketplace-assistant-'));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = join(dir, 'db.sqlite');
process.env.USER_API_KEY_SECRET = 'fixture-encryption-secret-not-production';
const { initDb, closeDb, getDb } = await import('../server/db');
const store = await import('../server/store');
const { encryptApiKey } = await import('../server/userApiKeyCrypto');
const { saveBridgeSettings } = await import('../server/marketplaceBridge');
const { registerMarketplaceAssistant } =
  await import('../server/marketplaceAssistant');
assert.equal(await initDb(), true);
await store.initStore();
const now = new Date().toISOString();
for (const [id, role, name] of [
  ['owner', 'admin', 'Власник'],
  ['maria', 'site_manager', 'Марія'],
  ['writer', 'writer', 'Автор'],
] as const)
  await store.saveUser({
    id,
    email: id + '@fixture.test',
    name,
    role,
    createdAt: now,
  });
await store.upsertUserApiKey({
  userId: 'owner',
  engine: 'deepseek',
  encryptedKey: encryptApiKey('fixture-deepseek-not-a-real-key'),
  fingerprint: 'fixture',
  createdAt: now,
  updatedAt: now,
});
let proxyCalls = 0;
const backend = express();
backend.use(express.json());
backend.get('/assistant/bridge/leads', (req, res) => {
  proxyCalls++;
  assert.equal(req.get('x-bridge-key'), 'fixture-bridge-secret');
  const a = JSON.parse(
    Buffer.from(req.get('x-support-actor')!, 'base64url').toString(),
  );
  assert.equal(a.role, 'site_manager');
  assert.equal(a.name, 'Марія');
  res.json([{ id: 'lead-fixture' }]);
});
const bs = backend.listen(0, '127.0.0.1');
await new Promise<void>((r) => bs.once('listening', r));
await saveBridgeSettings({
  url: `http://127.0.0.1:${(bs.address() as any).port}`,
  key: 'fixture-bridge-secret',
});
let who: any = { id: 'owner', role: 'admin', isGuest: false };
let calls = 0;
let fail = false;
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  req.principal = who;
  next();
});
const stop = registerMarketplaceAssistant(app, {
  generate: async (
    engine,
    model,
    prompt,
    system,
    key,
    _images,
    _json,
    opts,
  ) => {
    calls++;
    assert.equal(engine, 'deepseek');
    assert.equal(key, 'fixture-deepseek-not-a-real-key');
    assert.equal(opts?.maxTokens, 800);
    assert.ok(opts?.signal);
    if (fail)
      throw Error(
        'Provider failed with sensitive diagnostic that must not escape',
      );
    return { text: 'Перевірена відповідь', inputTokens: 50, outputTokens: 20 };
  },
});
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
async function call(path: string, body?: unknown, key?: string) {
  const r = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'x-bridge-key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
try {
  let r = await call('/api/admin/marketplace-assistant/config');
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, true);
  assert.ok(r.body.models.length >= 1);
  assert.ok(
    !JSON.stringify(r.body).includes('fixture-deepseek-not-a-real-key'),
  );
  const config = {
    model: r.body.model,
    enabled: true,
    dailyRequests: 2,
    dailyTokens: 10000,
  };
  assert.equal(
    (await call('/api/admin/marketplace-assistant/config', config)).status,
    200,
  );
  const input = {
    requestId: 'turn-1',
    system: 'Підбирай за перевіреним каталогом',
    context: { catalog: [] },
    history: [{ role: 'user', content: 'Які є послуги?' }],
  };
  assert.equal(
    (await call('/api/marketplace-assistant/generate', input)).status,
    403,
  );
  assert.equal(calls, 0);
  const [a, b] = await Promise.all([
    call('/api/marketplace-assistant/generate', input, 'fixture-bridge-secret'),
    call('/api/marketplace-assistant/generate', input, 'fixture-bridge-secret'),
  ]);
  assert.ok([a.status, b.status].includes(200));
  assert.equal(calls, 1);
  assert.ok([200, 409].includes(b.status));
  r = await call(
    '/api/marketplace-assistant/generate',
    input,
    'fixture-bridge-secret',
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.cached, true);
  assert.equal(calls, 1);
  fail = true;
  r = await call(
    '/api/marketplace-assistant/generate',
    { ...input, requestId: 'turn-2' },
    'fixture-bridge-secret',
  );
  assert.equal(r.status, 503);
  assert.ok(!JSON.stringify(r.body).includes('sensitive'));
  assert.equal(calls, 2);
  assert.equal(
    (
      await call(
        '/api/marketplace-assistant/generate',
        { ...input, requestId: 'turn-2' },
        'fixture-bridge-secret',
      )
    ).status,
    503,
  );
  assert.equal(calls, 2);
  assert.equal(
    (
      await call(
        '/api/marketplace-assistant/generate',
        { ...input, requestId: 'turn-3' },
        'fixture-bridge-secret',
      )
    ).status,
    429,
  );
  assert.equal(calls, 2);
  const logged = getDb()!
    .prepare('SELECT COUNT(*) AS n FROM usage_log WHERE context=?')
    .get('marketplace-consultation') as { n: number };
  assert.equal(logged.n, 2);
  who = { id: 'writer', role: 'writer', isGuest: false };
  assert.equal((await call('/api/support/marketplace/leads')).status, 403);
  assert.equal(
    (await call('/api/admin/marketplace-assistant/config')).status,
    403,
  );
  assert.equal(proxyCalls, 0);
  who = { id: 'maria', role: 'site_manager', isGuest: false };
  r = await call('/api/support/marketplace/leads');
  assert.equal(r.status, 200);
  assert.equal(r.body[0].id, 'lead-fixture');
  assert.equal(proxyCalls, 1);
  assert.equal(
    (await call('/api/admin/marketplace-assistant/config')).status,
    403,
  );
  console.log(
    'PASS Studio assistant: server-only platform DeepSeek key, model allowlist, deduplication, platform budget, failed-call reservation, safe errors, writer denial and verified manager identity through the bridge. No live provider calls.',
  );
} finally {
  stop();
  await Promise.all([
    new Promise<void>((r) => server.close(() => r())),
    new Promise<void>((r) => bs.close(() => r())),
  ]);
  closeDb();
  rmSync(dir, { recursive: true, force: true });
}
