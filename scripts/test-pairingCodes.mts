/**
 * Одноразові коди підключення DesignCraft-скрипта до акаунта Студії.
 * Запуск: npm run test:pairing-codes
 *
 * Перевіряється: код живе 5 хв і працює один раз; новий код скасовує попередній;
 * перебір обмежений; обмін дає робочий токен `nst_` саме цього автора; гість код не отримує.
 */
const DIR = '/tmp/nova-pairing-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const { PairingCodeStore, normalizePairingCode, PAIRING_TTL_MS, PAIRING_MAX_FAILURES } = await import('../server/external/pairingCodes');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '✓' : '✗'} ${n}${e ? ' — ' + e : ''}`);
};

// ── Сховище кодів ────────────────────────────────────────────────────────
let clock = 1_000_000;
const store = new PairingCodeStore(() => clock);
const a = store.issue('u-a');
t('код із 8 символів у форматі XXXX-XXXX', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(a.display), a.display);
t('без схожих символів 0/O/1/I', !/[01OI]/.test(a.code));
t('нормалізація прибирає дефіс, пробіли й регістр', normalizePairingCode(' abcd-efgh ') === 'ABCDEFGH');
const r1 = store.redeem(a.display.toLowerCase(), 'ip1');
t('обмін вдається (регістр і дефіс не заважають)', r1.ok === true && (r1 as any).userId === 'u-a');
t('повторний обмін того самого коду — invalid', store.redeem(a.code, 'ip1').ok === false);

const b1 = store.issue('u-b');
const b2 = store.issue('u-b');
t('новий код автора скасовує попередній', store.redeem(b1.code, 'ip2').ok === false && store.redeem(b2.code, 'ip2').ok === true);

const c = store.issue('u-c');
clock += PAIRING_TTL_MS + 1;
const rc = store.redeem(c.code, 'ip3');
t('прострочений код — expired', rc.ok === false && (rc as any).reason === 'expired');

const victim = store.issue('u-d');
for (let i = 0; i < PAIRING_MAX_FAILURES; i++) store.redeem('ZZZZZZZZ', 'attacker');
const locked = store.redeem(victim.code, 'attacker');
t('після 10 невдалих спроб адреса блокується навіть для правильного коду', locked.ok === false && (locked as any).reason === 'locked');
t('інша адреса не заблокована', store.redeem(victim.code, 'owner').ok === true);
{
  const { PAIRING_MAX_FAILURES_TOTAL } = await import('../server/external/pairingCodes');
  const s2 = new PairingCodeStore(() => clock);
  const good = s2.issue('u-e');
  for (let i = 0; i < PAIRING_MAX_FAILURES_TOTAL; i++) s2.redeem('ZZZZZZZZ', `fake-${i}`);
  const r = s2.redeem(good.code, 'fresh-address');
  t('загальна стеля: перебір зі змінними адресами блокується', r.ok === false && (r as any).reason === 'locked');
}

// ── HTTP: видача коду й обмін на токен ─────────────────────────────────
const db = await import('../server/db');
await db.initDb();
const storeMod = await import('../server/store');
const routes = await import('../server/external/externalApiRoutes');
const now = new Date().toISOString();
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', createdAt: now } as any);

const users: Record<string, any> = { 'u-a': { id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', isGuest: false } };
const GUEST = { id: null, email: 'guest@local', name: 'Гість', role: 'guest', isGuest: true };
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  const u = req.headers['x-test-session'];
  req.principal = typeof u === 'string' && users[u] ? users[u] : GUEST;
  next();
});
routes.registerExternalApiRoutes(app, { recognize: async () => ({ text: '', modelId: 'x' }) });
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function call(method: string, path: string, opts: { session?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.session) headers['x-test-session'] = opts.session;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

t('гість не отримує код', (await call('POST', '/api/external-tokens/pairing-code', { body: {} })).status === 401);
const issued = await call('POST', '/api/external-tokens/pairing-code', { session: 'u-a', body: {} });
t('автор отримує код (201)', issued.status === 201 && typeof issued.data.code === 'string', JSON.stringify(issued.data));
t('у відповіді строк дії', issued.data.ttlSec === 300 && !!issued.data.expiresAt);
t('у відповіді немає токена', !JSON.stringify(issued.data).includes('nst_'));

const paired = await call('POST', '/api/external/v1/pair', { body: { code: issued.data.code } });
t('обмін коду дає токен nst_', paired.status === 201 && String(paired.data.token).startsWith('nst_'));
t('токен названо «DesignCraft (локально)»', paired.data.record?.name === 'DesignCraft (локально)');
const me = await call('GET', '/api/external/v1/me', { token: paired.data.token });
t('токен працює й належить автору', me.status === 200 && JSON.stringify(me.data).includes('u-a'));
t('повторний обмін — 404', (await call('POST', '/api/external/v1/pair', { body: { code: issued.data.code } })).status === 404);
t('вигаданий код — 404', (await call('POST', '/api/external/v1/pair', { body: { code: 'ABCD-EFGH' } })).status === 404);
const tokens = await call('GET', '/api/external-tokens', { session: 'u-a' });
t('токен видно в списку автора (можна відкликати)', tokens.data.tokens?.some((x: any) => x.name === 'DesignCraft (локально)'));

server.close();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало.`);
if (fail) process.exit(1);
