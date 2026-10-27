import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';

const directory = mkdtempSync(join(tmpdir(), 'studio-furniture-access-'));
process.env.DATA_DIR = directory;
process.env.DATABASE_PATH = join(directory, 'studio.db');
process.env.USER_API_KEY_SECRET = 'isolated-furniture-test-only';
const { initStore, saveUser, createSession } = await import('../server/store');
const { attachPrincipal, registerAuthRoutes } = await import('../server/auth');
const { registerAdminRoutes } = await import('../server/adminRoutes');
const { registerSlabTableRoutes } = await import('../server/slabTableBridge');
const { saveBridgeSettings } = await import('../server/marketplaceBridge');
await initStore();
let role = 'buyer', allowed = false, failLookup = false;
const uid = 'bound-furniture-test-uid';
const key = 'isolated-bridge-key';
let forwardedActor: string | undefined;
const marketplace = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.headers['x-bridge-key'] !== key) { res.statusCode = 401; res.end('{}'); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  if (req.url === '/bridge/tables/designer-access/lookup') {
    if (failLookup) { res.statusCode = 503; res.end(JSON.stringify({ message: 'Test marketplace unavailable' })); return; }
    res.end(JSON.stringify({ role, allowed, firebaseUid: uid }));
  } else if (req.url === '/bridge/tables/designer-access' && req.method === 'GET') {
    res.end(JSON.stringify({ designers: role === 'furniture_designer' ? [{ firebaseUid: uid, email: 'furniture@example.test' }] : [] }));
  } else if (req.url === '/bridge/tables/designer-access') {
    assert.equal(body.email, 'furniture@example.test');
    assert.equal(body.firebaseUid, uid);
    role = body.enabled ? 'furniture_designer' : 'buyer'; allowed = body.enabled;
    res.end(JSON.stringify({ role, allowed, firebaseUid: uid }));
  } else if (req.url === '/bridge/tables/state' || req.url === '/bridge/tables/slabs') {
    forwardedActor = req.headers['x-slab-actor-uid'] as string | undefined;
    res.end(JSON.stringify({ slabs: [], id: 'new-slab' }));
  } else { res.statusCode = 404; res.end('{}'); }
});
await new Promise<void>((resolve) => marketplace.listen(0, '127.0.0.1', resolve));
const marketPort = (marketplace.address() as { port: number }).port;
await saveBridgeSettings({ url: `http://127.0.0.1:${marketPort}`, key });
const admin = { id: 'admin', email: 'owner@example.test', name: 'Owner', role: 'admin' as const, createdAt: new Date().toISOString() };
const designer = { id: 'designer', email: 'furniture@example.test', firebaseUid: uid, name: 'Designer', role: 'reader' as const, createdAt: new Date().toISOString() };
await saveUser(admin); await saveUser(designer);
async function session(userId: string) {
  const token = randomBytes(32).toString('hex');
  await createSession({ token, userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  return `nova_session=${token}`;
}
const app = express(); app.use(express.json()); app.use(attachPrincipal);
registerAuthRoutes(app); registerAdminRoutes(app); registerSlabTableRoutes(app);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const ownerCookie = await session(admin.id);
let designerCookie = await session(designer.id), count = 0;
async function request(path: string, status: number, cookie = designerCookie, method = 'GET', body?: object) {
  const response = await fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, status, path + ': ' + JSON.stringify(data));
  count++; return data;
}
try {
  const users = await request('/api/admin/users', 200, ownerCookie);
  assert(users.roles.includes('furniture_designer'));
  const matrix = await request('/api/admin/roles', 200, ownerCookie);
  assert(matrix.roles.find((r: { role: string }) => r.role === 'furniture_designer').effective.canManageSlabs);
  await request('/api/admin/slab-tables/state', 403);
  await request('/api/admin/users/designer', 200, ownerCookie, 'PATCH', { role: 'furniture_designer', firebaseUid: 'forged-client-value' });
  assert.equal(role, 'furniture_designer');
  designerCookie = await session(designer.id); // Normal re-login after an admin role change.
  const me = await request('/api/auth/me', 200);
  assert.equal(me.user.role, 'furniture_designer'); assert.equal(me.permissions.canManageSlabs, true);
  await request('/api/admin/slab-tables/state', 200); assert.equal(forwardedActor, uid);
  await request('/api/admin/slab-tables/slabs', 200, designerCookie, 'POST', { number: 'test' });
  assert.equal(forwardedActor, uid);
  await request('/api/admin/slab-tables/production', 403);
  await request('/api/admin/slab-tables/costs', 403, designerCookie, 'PUT', {});
  await request('/api/admin/slab-tables/resin-textures', 403, designerCookie, 'POST', {});
  await request('/api/admin/users', 403);
  await request('/api/admin/roles', 403);
  role = 'buyer'; allowed = false; // Revocation in the marketplace, without a Studio logout.
  await request('/api/admin/slab-tables/slabs', 403, designerCookie, 'POST', {});
  assert.equal((await request('/api/auth/me', 200)).user.role, 'reader');
  role = 'furniture_designer'; allowed = true; // Assignment in the marketplace.
  const updatedRoster = await request('/api/admin/users', 200, ownerCookie);
  assert.equal(updatedRoster.users.find((u: { id: string }) => u.id === designer.id).role, 'furniture_designer');
  assert.equal((await request('/api/auth/me', 200)).user.role, 'furniture_designer');
  await request('/api/admin/slab-tables/state', 200);
  allowed = false; // Per-user marketplace denial overrides the role preset.
  await request('/api/admin/slab-tables/slabs', 403, designerCookie, 'POST', {});
  allowed = true; failLookup = true;
  await request('/api/admin/slab-tables/slabs', 503, designerCookie, 'POST', {});
  assert.equal((await request('/api/auth/me', 200)).user.role, 'furniture_designer');
  failLookup = false;
  await request('/api/admin/users/designer', 200, ownerCookie, 'PATCH', { role: 'reader' });
  assert.equal(role, 'buyer'); assert.equal(allowed, false);
  designerCookie = await session(designer.id);
  await request('/api/admin/slab-tables/state', 403);
  console.log(`${count} shared furniture HTTP checks passed: assignment both ways, live revocation, actor binding, least privilege and API downtime; no payments.`);
} finally {
  await Promise.all([new Promise<void>((r) => server.close(() => r())), new Promise<void>((r) => marketplace.close(() => r()))]);
  const storage = await import('../server/db');
  if (storage.isAvailable()) storage.getDb().close();
  rmSync(directory, { recursive: true, force: true });
}
