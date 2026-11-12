/**
 * Тести локального сервера приватного сховища й підключення його до Studio (журнал #549). Запуск: npm run test:private-store
 *
 *  1. Криптографія сервера: шифрування в спокої, привʼязка до місця (AAD), головний ключ.
 *  2. Токени: підпис Studio ⇄ перевірка сервером, строк, аудиторія, відкликання.
 *  3. База: записи, власник, ревізії, зображення; у файлі бази відкритого тексту немає.
 *  4. Підключення: код видається ЛИШЕ після підтвердження поштою й кодом; ліміт спроб; одноразовість.
 *  5. Живий сервер у процесі: пульс, токен користувача, CORS/Host/Origin, відкликання, перепідключення.
 */
const DIR = '/tmp/nova-private-store-test';
process.env.DATA_DIR = `${DIR}/studio`;
process.env.DATABASE_PATH = `${DIR}/studio/nova-studio.db`;
delete process.env.PRIVATE_STORE_SIGNING_KEY;

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(`${DIR}/studio`, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const storeMod = await import('../server/store');
const registry = await import('../server/privateStore/store');
const tokenMod = await import('../server/privateStore/token');
const routes = await import('../server/privateStoreRoutes');
const vcrypto = await import('../services/private-store/src/crypto.mjs');
const vtoken = await import('../services/private-store/src/token.mjs');
const vdb = await import('../services/private-store/src/db.mjs');
const vconfig = await import('../services/private-store/src/config.mjs');
const vserver = await import('../services/private-store/src/server.mjs');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
const vaultLog: string[] = [];
const silent = { log: (m: string) => void vaultLog.push(m), error: (m: string) => void vaultLog.push(m) };
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

// ---------------------------------------------------------------------------
console.log('\nКриптографія сервера');
const keyFile = path.join(DIR, 'master.key');
fs.writeFileSync(keyFile, randomBytes(32).toString('hex'));
const master = vcrypto.loadMasterKey(keyFile);
const dataKey = vcrypto.deriveDataKey(master);
t('головний ключ — 32 байти, підключ шифрування відрізняється від нього', master.length === 32 && dataKey.length === 32 && !master.equals(dataKey));
const sealed = vcrypto.seal(dataKey, 'Секретна книга', 'doc:a:payload');
t('шифротекст не містить відкритого тексту', !sealed.includes('Секретна') && sealed.startsWith('nps1.'));
t('розшифровується з тим самим AAD', vcrypto.open(dataKey, sealed, 'doc:a:payload').toString('utf8') === 'Секретна книга');
t('інший AAD (підміна місця запису) — відмова', (() => { try { vcrypto.open(dataKey, sealed, 'doc:b:payload'); return false; } catch { return true; } })());
t('пошкоджений шифротекст — відмова', (() => { try { vcrypto.open(dataKey, sealed.slice(0, -4) + 'AAAA', 'doc:a:payload'); return false; } catch { return true; } })());
t('два шифрування одного тексту різні (випадковий nonce)', vcrypto.seal(dataKey, 'x', 'a') !== vcrypto.seal(dataKey, 'x', 'a'));
const attempt = (fn: () => unknown) => { try { fn(); return ''; } catch (e) { return String((e as Error).message); } };
t('немає файлу ключа — зрозуміла відмова', /Немає файлу головного ключа/.test(attempt(() => vcrypto.loadMasterKey(path.join(DIR, 'nope.key')))));
fs.writeFileSync(path.join(DIR, 'weak.key'), '00'.repeat(32));
t('слабкий ключ (однакові байти) — відмова', /слабкий/.test(attempt(() => vcrypto.loadMasterKey(path.join(DIR, 'weak.key')))));
fs.writeFileSync(path.join(DIR, 'short.key'), 'abcd');
t('короткий ключ — відмова', /32 байти/.test(attempt(() => vcrypto.loadMasterKey(path.join(DIR, 'short.key')))));
fs.writeFileSync(path.join(DIR, 'b64.key'), randomBytes(32).toString('base64'));
t('ключ у base64 теж приймається', vcrypto.loadMasterKey(path.join(DIR, 'b64.key')).length === 32);

console.log('\nНалаштування');
t('STUDIO_URL: https дозволено', vconfig.normalizeStudioUrl('https://www.fusionlab.in.ua/studio/') === 'https://www.fusionlab.in.ua/studio');
t('STUDIO_URL: http лише для локальних хостів', vconfig.normalizeStudioUrl('http://host.docker.internal:3000') === 'http://host.docker.internal:3000' && !!attempt(() => vconfig.normalizeStudioUrl('http://evil.example.com')));
t('PUBLIC_URL за замовчуванням — 127.0.0.1', vconfig.loadConfig({}).publicUrl === 'http://127.0.0.1:8787');
t('дозволені хости включають публічну адресу', vconfig.loadConfig({ PRIVATE_STORE_PUBLIC_URL: 'https://vault.home:9443' }).allowedHosts.has('vault.home:9443'));

// ---------------------------------------------------------------------------
console.log('\nТокен: Studio підписує — сервер перевіряє');
const studioKey = registry.signingKey();
const nowSec = Math.floor(Date.now() / 1000);
const mk = (over: Record<string, unknown> = {}) => tokenMod.signAccessToken(studioKey.privatePkcs8, { vaultId: 'pstore_x', userId: 'u1', kinds: ['book', 'course'], nowSec, ...over });
const check = (token: string, over: Record<string, unknown> = {}) => vtoken.verifyToken(token, { studioPublicKey: studioKey.publicSpki, vaultId: 'pstore_x', nowSec, ...over });
const good = check(mk().token);
t('чинний токен проходить; sub, kinds, jti на місці', good.ok && good.claims.sub === 'u1' && good.claims.kinds.join() === 'book,course' && !!good.claims.jti);
t('чужа аудиторія (інший сервер) — відмова', !check(mk().token, { vaultId: 'pstore_other' }).ok && (check(mk().token, { vaultId: 'pstore_other' }) as any).reason === 'audience');
t('прострочений токен — відмова', (check(mk({ nowSec: nowSec - 3600 }).token) as any).reason === 'expired');
t('токен із майбутнього — відмова', (check(mk({ nowSec: nowSec + 3600 }).token) as any).reason === 'not_yet_valid');
t('підроблений payload — підпис не збігається', (() => { const [v, p, s] = mk().token.split('.'); const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'admin' })).toString('base64url'); return (check(`${v}.${forged}.${s}`) as any).reason === 'signature'; })());
const otherKey = vcrypto.generateIdentity();
t('токен, підписаний чужим ключем, — відмова', !vtoken.verifyToken(mk().token, { studioPublicKey: otherKey.publicKey, vaultId: 'pstore_x', nowSec }).ok);
t('строк життя довший за 15 хв — відмова', (check(tokenMod.signAccessToken(studioKey.privatePkcs8, { vaultId: 'pstore_x', userId: 'u1', kinds: ['book'], nowSec, ttlSec: 3000 }).token) as any).ok === true, 'ttl обрізається підписувачем до 15 хв');
t('відкликання: токен, виданий до cutoff, — відмова', (check(mk({ nowSec: nowSec - 60 }).token, { revokeTokensBefore: new Date((nowSec - 30) * 1000).toISOString() }) as any).reason === 'revoked');
t('сміття замість токена — відмова', !check('abc').ok && !check('').ok && !check('v1.a.b').ok);

// ---------------------------------------------------------------------------
console.log('\nБаза: записи, власник, шифрування в спокої');
const store = new vdb.Db(path.join(DIR, 'vault-a'), dataKey);
const created = store.putDoc('u1', { id: 'book_aaaaaa', kind: 'book', meta: { title: 'Тіні Нео-Києва' }, payload: { chapters: [{ text: 'ЦІЛКОМ ТАЄМНИЙ ТЕКСТ' }] } });
t('створення — ревізія 1', created.revision === 1 && created.created);
t('читання повертає вміст і мета', store.getDoc('u1', 'book_aaaaaa')?.meta.title === 'Тіні Нео-Києва' && store.getDoc('u1', 'book_aaaaaa')?.payload.chapters[0].text === 'ЦІЛКОМ ТАЄМНИЙ ТЕКСТ');
t('чужий власник не бачить запису', store.getDoc('u2', 'book_aaaaaa') === null && store.listDocs('u2').length === 0);
t('чужий id — «зайнятий», а не перезапис', (() => { try { store.putDoc('u2', { id: 'book_aaaaaa', kind: 'book', meta: {}, payload: {} }); return false; } catch (e) { return (e as any).kind === 'id_taken'; } })());
const second = store.putDoc('u1', { id: 'book_aaaaaa', kind: 'book', meta: { title: 'Нова назва' }, payload: { v: 2 }, expectedRevision: 1 });
t('оновлення з очікуваною ревізією — ревізія 2', second.revision === 2 && !second.created);
t('застаріла ревізія — конфлікт з поточною', (() => { try { store.putDoc('u1', { id: 'book_aaaaaa', kind: 'book', meta: {}, payload: {}, expectedRevision: 1 }); return false; } catch (e) { return e instanceof vdb.RevisionConflict && (e as any).current === 2; } })());
t('вид змінити не можна', (() => { try { store.putDoc('u1', { id: 'book_aaaaaa', kind: 'course', meta: {}, payload: {} }); return false; } catch (e) { return (e as any).kind === 'kind_mismatch'; } })());
store.putDoc('u1', { id: 'course_bbbbbb', kind: 'course', meta: { title: 'Курс' }, payload: {} });
t('перелік за видом', store.listDocs('u1', 'course').length === 1 && store.listDocs('u1').length === 2);
store.putAsset('u1', { id: 'img_cccccc', docId: 'book_aaaaaa', mime: 'image/png', bytes: Buffer.from('PNGDATA-SECRET') });
t('зображення читається власником, не чужим', store.getAsset('u1', 'img_cccccc')?.bytes.toString() === 'PNGDATA-SECRET' && store.getAsset('u2', 'img_cccccc') === null);
store.close();
const rawFile = fs.readFileSync(path.join(DIR, 'vault-a', 'private-store.sqlite3'));
const walFile = fs.existsSync(path.join(DIR, 'vault-a', 'private-store.sqlite3-wal')) ? fs.readFileSync(path.join(DIR, 'vault-a', 'private-store.sqlite3-wal')) : Buffer.alloc(0);
const hay = Buffer.concat([rawFile, walFile]);
t('у файлі бази немає відкритого тексту книги, назви й зображення', !hay.includes('ТАЄМНИЙ') && !hay.includes('Нео-Києва') && !hay.includes('PNGDATA-SECRET'));
// Контроль самої перевірки: файл прочитано, і шифротекст у ньому справді є (інакше «відкритого тексту немає» нічого б не доводило).
t('перевірка не порожня: файл прочитано, шифротекст у ньому є', hay.length > 0 && hay.includes('nps1.'));
const reopened = new vdb.Db(path.join(DIR, 'vault-a'), dataKey);
t('після перевідкриття дані читаються тим самим ключем', reopened.getDoc('u1', 'book_aaaaaa')?.payload.v === 2);
t('видалення прибирає запис і його зображення', reopened.deleteDoc('u1', 'book_aaaaaa') && reopened.getAsset('u1', 'img_cccccc') === null);
reopened.close();
const wrongKey = vcrypto.deriveDataKey(randomBytes(32));
t('з чужим ключем база не читається', (() => { const d = new vdb.Db(path.join(DIR, 'vault-a'), wrongKey); try { d.listDocs('u1'); return false; } catch { return true; } finally { d.close(); } })());

// ---------------------------------------------------------------------------
console.log('\nStudio: підключення лише за поштою й кодом');
await storeMod.saveUser({ id: 'adm', email: 'admin@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
await storeMod.saveUser({ id: 'u1', email: 'u1@test.ua', name: 'Авторка', role: 'writer', createdAt: new Date().toISOString() } as any);
await storeMod.saveUser({ id: 'u2', email: 'u2@test.ua', name: 'Інша', role: 'writer', createdAt: new Date().toISOString() } as any);
const principals: Record<string, any> = {
  adm: { id: 'adm', email: 'admin@test.ua', name: 'Адмін', role: 'admin', isGuest: false },
  u1: { id: 'u1', email: 'u1@test.ua', name: 'Авторка', role: 'writer', isGuest: false },
  u2: { id: 'u2', email: 'u2@test.ua', name: 'Інша', role: 'writer', isGuest: false },
};
const mails: Array<{ to: string; subject: string; html: string; text: string }> = [];
let mailOn = true;
let mailOk = true;
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  const u = req.headers['x-test-session'];
  req.principal = typeof u === 'string' && principals[u] ? principals[u] : { id: null, role: 'guest', isGuest: true };
  next();
});
routes.registerPrivateStoreRoutes(app, {
  mailEnabled: () => mailOn,
  sendMail: async (m) => (mailOk ? (mails.push(m), { ok: true }) : { ok: false, error: 'smtp down' }),
});
const studio = app.listen(0, '127.0.0.1');
await new Promise((r) => studio.once('listening', r));
const studioPort = (studio.address() as net.AddressInfo).port;
const STUDIO = `http://127.0.0.1:${studioPort}`;
const vaultPort = await freePort();
const VAULT = `http://127.0.0.1:${vaultPort}`;
const PAGE_ORIGIN = 'https://studio.test.ua';

async function call(method: string, p: string, opts: { session?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.session) headers['x-test-session'] = opts.session;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(STUDIO + p, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const codeFromMail = () => /\b([A-Z2-9]{8})\b/.exec(mails[mails.length - 1].text)![1];

t('без входу й для не-адміна адмінпанель закрита', (await call('GET', '/api/admin/private-stores')).status === 403 && (await call('GET', '/api/admin/private-stores', { session: 'u1' })).status === 403 && (await call('POST', '/api/admin/private-stores', { session: 'u1', body: { name: 'x' } })).status === 403);

mailOn = false;
const noMail = await call('POST', '/api/admin/private-stores', { session: 'adm', body: { name: 'Без пошти', endpoint: VAULT, origins: [PAGE_ORIGIN], userIds: ['u1'] } });
t('пошта на сервері не налаштована — підключення створити не можна (503)', noMail.status === 503 && noMail.data.kind === 'mail_unavailable' && registry.listStores().length === 0);
mailOn = true;

mailOk = false;
const failedMail = await call('POST', '/api/admin/private-stores', { session: 'adm', body: { name: 'Лист не пішов', endpoint: VAULT, origins: [PAGE_ORIGIN], userIds: ['u1'] } });
t('лист не надіслано — запис не лишається без підтвердження', failedMail.status === 502 && registry.listStores().length === 0);
mailOk = true;

const bad = await call('POST', '/api/admin/private-stores', { session: 'adm', body: { name: 'Поганий', endpoint: 'ftp://x', origins: [PAGE_ORIGIN], userIds: [] } });
t('некоректна адреса сервера — 400', bad.status === 400 && bad.data.kind === 'bad_input');

const made = await call('POST', '/api/admin/private-stores', { session: 'adm', body: { name: 'Домашній сервер', endpoint: VAULT, origins: [PAGE_ORIGIN], userIds: ['u1'] } });
const storeId: string = made.data.store.id;
t('створення — 201, статус pending, коду підключення у відповіді НЕМАЄ', made.status === 201 && made.data.store.status === 'pending' && !JSON.stringify(made.data).includes('PS-') && made.data.verification.sent === true);
t('лист пішов на пошту адміністратора з кодом з 8 символів', mails.length === 1 && mails[0].to === 'admin@test.ua' && /[A-Z2-9]{8}/.test(mails[0].text));
t('адмінці показано маскований адрес', made.data.verification.emailMasked === 'a***@test.ua');
t('код підтвердження в базі лише як хеш', !JSON.stringify(registry.getStore(storeId)).includes(codeFromMail()));
const unverifiedPair = await call('POST', '/api/private-store/pair', { body: { code: 'PS-AAAA-BBBB-CCCC', publicKey: vcrypto.generateIdentity().publicKey } });
t('до підтвердження підключитися неможливо (код підключення не існує)', unverifiedPair.status === 404 && unverifiedPair.data.kind === 'invalid_code');

const wrongs = [];
for (let i = 0; i < 4; i++) wrongs.push(await call('POST', `/api/admin/private-stores/${storeId}/verify`, { session: 'adm', body: { code: 'AAAAAAAA' } }));
t('хибні коди — 400, лічильник спроб спадає', wrongs.every((w) => w.status === 400) && wrongs[0].data.attemptsLeft === 4 && wrongs[3].data.attemptsLeft === 1, JSON.stringify(wrongs.map((w) => w.data.attemptsLeft)));
const rightCode = codeFromMail();
const fifthWrong = await call('POST', `/api/admin/private-stores/${storeId}/verify`, { session: 'adm', body: { code: 'AAAAAAAA' } });
t('5-а хибна спроба скасовує код: навіть правильний більше не діє', fifthWrong.status === 400 && (await call('POST', `/api/admin/private-stores/${storeId}/verify`, { session: 'adm', body: { code: rightCode } })).data.kind === 'code_unavailable');
const resent = await call('POST', `/api/admin/private-stores/${storeId}/verification`, { session: 'adm' });
t('новий лист — новий код, ще один лист на пошту', resent.status === 201 && mails.length === 2 && codeFromMail() !== rightCode);
t('не-адмін код підтвердження ввести не може', (await call('POST', `/api/admin/private-stores/${storeId}/verify`, { session: 'u1', body: { code: codeFromMail() } })).status === 403);
const verified = await call('POST', `/api/admin/private-stores/${storeId}/verify`, { session: 'adm', body: { code: codeFromMail() } });
const pairingCode: string = verified.data.pairing.code;
t('правильний код → одноразовий код підключення PS-XXXX-XXXX-XXXX і дані розгортання', verified.status === 200 && /^PS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(pairingCode) && verified.data.deploy.env.PAIRING_CODE === pairingCode && verified.data.deploy.env.PRIVATE_STORE_PUBLIC_URL === VAULT);
t('код підключення в базі лише як хеш', !JSON.stringify(registry.getStore(storeId)).includes(pairingCode) && registry.getStore(storeId)!.verified);
t('повторне введення того ж коду підтвердження не діє', (await call('POST', `/api/admin/private-stores/${storeId}/verify`, { session: 'adm', body: { code: codeFromMail() } })).status === 400);
const badKey = await call('POST', '/api/private-store/pair', { body: { code: pairingCode, publicKey: 'not-a-key' } });
t('некоректний публічний ключ — 400, код при цьому не згорає', badKey.status === 400 && registry.getStore(storeId)!.pairingExpiresAt !== null);

// ---------------------------------------------------------------------------
console.log('\nЖивий локальний сервер у процесі');
const baseEnv = (port: number, dataDir: string, code?: string) => ({
  PRIVATE_STORE_PORT: String(port),
  PRIVATE_STORE_PUBLIC_URL: `http://127.0.0.1:${port}`,
  PRIVATE_STORE_DATA_DIR: dataDir,
  PRIVATE_STORE_MASTER_KEY_FILE: keyFile,
  PRIVATE_STORE_NAME: 'Домашній сервер',
  PRIVATE_STORE_HEARTBEAT_SEC: '3600',
  STUDIO_URL: STUDIO,
  ...(code ? { PAIRING_CODE: code } : {}),
});
const vault = await vserver.createPrivateStore({ env: baseEnv(vaultPort, path.join(DIR, 'vault-live'), pairingCode), log: silent });
await vault.start();
const rec = registry.getStore(storeId)!;
t('сервер підключився кодом: статус active, id збігається', rec.status === 'active' && vault.state.link?.vaultId === storeId);
t('сервер отримав публічний ключ Studio та дозволені сторінки', vault.state.link?.studioPublicKey === studioKey.publicSpki && vault.state.link?.studioOrigins.includes(PAGE_ORIGIN));
t('код підключення одноразовий: другий сервер із тим самим кодом не підключиться', (await call('POST', '/api/private-store/pair', { body: { code: pairingCode, publicKey: vcrypto.generateIdentity().publicKey } })).status === 404);
await vault.beat();
t('пульс прийнято: сервер «в мережі», у стані версія й кількість записів', registry.getStore(storeId)!.online && (registry.getStore(storeId)!.info as any)?.version === '0.2.0');

function vcall(method: string, p: string, opts: { token?: string; origin?: string; host?: string; body?: unknown; raw?: Buffer; type?: string } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; data: any; bytes: Buffer }>((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.origin) headers.origin = opts.origin;
    if (opts.host) headers.host = opts.host;
    let payload: Buffer | undefined;
    if (opts.body !== undefined) {
      payload = Buffer.from(JSON.stringify(opts.body));
      headers['content-type'] = opts.type ?? 'application/json';
    } else if (opts.raw) {
      payload = opts.raw;
      headers['content-type'] = opts.type ?? 'image/png';
    }
    if (payload) headers['content-length'] = String(payload.length);
    const req = http.request({ host: '127.0.0.1', port: vaultPort, path: p, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        let data: any = null;
        try { data = JSON.parse(bytes.toString('utf8')); } catch { /* бінарна відповідь */ }
        resolve({ status: res.statusCode || 0, headers: res.headers, data, bytes });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const health = await vcall('GET', '/v1/health');
t('health відкритий і не віддає нічого зайвого', health.status === 200 && health.data.paired === true && health.data.vaultId === storeId && Object.keys(health.data).sort().join() === 'ok,paired,status,time,vaultId,version');
t('чужа адреса Host — 421 (захист від DNS-rebinding)', (await vcall('GET', '/v1/health', { host: 'evil.example.com' })).status === 421);

const tokenRes = await call('POST', `/api/private-store/${storeId}/token`, { session: 'u1' });
const userToken: string = tokenRes.data.token;
t('користувач, якому призначено сервер, отримує токен і адресу', tokenRes.status === 200 && !!userToken && tokenRes.data.endpoint === VAULT && tokenRes.data.kinds.length === 4 && tokenRes.data.kinds.includes('scan'));
t('непризначений користувач токена не отримує (403)', (await call('POST', `/api/private-store/${storeId}/token`, { session: 'u2' })).status === 403);
t('без входу токена немає (401)', (await call('POST', `/api/private-store/${storeId}/token`)).status === 401);
t('перелік «мої сервери»: лише призначені, без зайвих полів', (await call('GET', '/api/private-store/mine', { session: 'u1' })).data.stores.length === 1 && (await call('GET', '/api/private-store/mine', { session: 'u2' })).data.stores.length === 0);

const noTok = await vcall('GET', '/v1/docs');
t('запис без токена — 401', noTok.status === 401 && noTok.data.kind === 'unauthenticated');
t('сторінка з чужого origin — 403 і без CORS-заголовків', (await vcall('GET', '/v1/health', { origin: 'https://evil.example.com' })).status === 403);
const pre = await new Promise<http.IncomingMessage>((resolve) => {
  const r = http.request({ host: '127.0.0.1', port: vaultPort, path: '/v1/docs', method: 'OPTIONS', headers: { origin: PAGE_ORIGIN, 'access-control-request-method': 'PUT', 'access-control-request-private-network': 'true' } }, resolve);
  r.end();
});
t('preflight з дозволеної сторінки: CORS і Private Network Access', pre.statusCode === 204 && pre.headers['access-control-allow-origin'] === PAGE_ORIGIN && pre.headers['access-control-allow-private-network'] === 'true');

const put = await vcall('PUT', '/v1/docs/book_live01', { token: userToken, origin: PAGE_ORIGIN, body: { kind: 'book', meta: { title: 'Приватна книга' }, payload: { chapters: ['текст'] } } });
t('запис книги з токеном — 201, CORS-заголовок для дозволеної сторінки', put.status === 201 && put.data.revision === 1 && put.headers['access-control-allow-origin'] === PAGE_ORIGIN);
t('читання, перелік і ревізії працюють', (await vcall('GET', '/v1/docs/book_live01', { token: userToken })).data.doc.meta.title === 'Приватна книга' && (await vcall('GET', '/v1/docs?kind=book', { token: userToken })).data.docs.length === 1);
t('конфлікт ревізій — 409 з поточною', (await vcall('PUT', '/v1/docs/book_live01', { token: userToken, body: { kind: 'book', meta: {}, payload: {}, expectedRevision: 5 } })).data.current === 1);
t('Content-Type не JSON — 415 (проста міжсайтова форма не пройде)', (await vcall('PUT', '/v1/docs/book_live02', { token: userToken, body: { kind: 'book', payload: {} }, type: 'text/plain' })).status === 415);
t('некоректний id і вид — 400', (await vcall('PUT', '/v1/docs/a', { token: userToken, body: { kind: 'book', payload: {} } })).status === 400 && (await vcall('PUT', '/v1/docs/book_live03', { token: userToken, body: { kind: 'video', payload: {} } })).status === 400);
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const asset = await vcall('PUT', '/v1/assets/img_live001?doc=book_live01', { token: userToken, raw: png, type: 'image/png' });
const back = await vcall('GET', '/v1/assets/img_live001', { token: userToken });
t('зображення: запис і читання назад байт у байт, безпечні заголовки', asset.status === 201 && back.bytes.equals(png) && back.headers['content-type'] === 'image/png' && back.headers['x-content-type-options'] === 'nosniff');
t('SVG та інші типи не приймаються', (await vcall('PUT', '/v1/assets/img_live002', { token: userToken, raw: Buffer.from('<svg/>'), type: 'image/svg+xml' })).status === 415);

const otherUserToken = registry.issueAccessToken(storeId, 'u1').token!;
registry.updateStore(storeId, { userIds: ['u1', 'u2'] });
const u2Token = (await call('POST', `/api/private-store/${storeId}/token`, { session: 'u2' })).data.token;
t('інший користувач не бачить чужих записів і не може їх прочитати чи видалити', (await vcall('GET', '/v1/docs', { token: u2Token })).data.docs.length === 0 && (await vcall('GET', '/v1/docs/book_live01', { token: u2Token })).status === 404 && (await vcall('DELETE', '/v1/docs/book_live01', { token: u2Token })).status === 404);
t('токен, виданий для іншого сервера, не діє', (await vcall('GET', '/v1/docs', { token: tokenMod.signAccessToken(studioKey.privatePkcs8, { vaultId: 'pstore_other', userId: 'u1', kinds: ['book'] }).token })).status === 401);
const bookOnly = tokenMod.signAccessToken(studioKey.privatePkcs8, { vaultId: storeId, userId: 'u1', kinds: ['course'] }).token;
t('токен без права на вид «book» не читає й не пише книг', (await vcall('GET', '/v1/docs/book_live01', { token: bookOnly })).status === 404 && (await vcall('PUT', '/v1/docs/book_live09', { token: bookOnly, body: { kind: 'book', payload: {} } })).status === 403);
void otherUserToken;

console.log('\nКерування з адмінпанелі');
await call('POST', `/api/admin/private-stores/${storeId}/revoke-tokens`, { session: 'adm' });
await vault.beat();
t('«скасувати токени»: виданий раніше токен перестає діяти після пульсу', (await vcall('GET', '/v1/docs', { token: userToken })).status === 401);
const fresh = (await call('POST', `/api/private-store/${storeId}/token`, { session: 'u1' })).data.token;
await new Promise((r) => setTimeout(r, 1100));
const fresh2 = (await call('POST', `/api/private-store/${storeId}/token`, { session: 'u1' })).data.token;
t('новий токен після скасування діє', (await vcall('GET', '/v1/docs', { token: fresh2 })).status === 200, String((await vcall('GET', '/v1/docs', { token: fresh2 })).status));
void fresh;
const revoked = await call('POST', `/api/admin/private-stores/${storeId}/revoke`, { session: 'adm' });
t('відкликання: нових токенів Studio не видає (409)', revoked.data.store.status === 'revoked' && (await call('POST', `/api/private-store/${storeId}/token`, { session: 'u1' })).status === 409);
await vault.beat();
t('після пульсу сервер замикається: 503 revoked на всі запити з токеном', (await vcall('GET', '/v1/docs', { token: fresh2 })).status === 503 && (await vcall('GET', '/v1/health')).data.status === 'revoked');
await call('POST', `/api/admin/private-stores/${storeId}/restore`, { session: 'adm' });
await vault.beat();
await new Promise((r) => setTimeout(r, 1200)); // токени, видані до межі відкликання (наступна повна секунда), не діють
const afterRestore = (await call('POST', `/api/private-store/${storeId}/token`, { session: 'u1' })).data.token;
t('повернення в роботу: сервер відкривається, дані на місці', (await vcall('GET', '/v1/docs/book_live01', { token: afterRestore })).data.doc.meta.title === 'Приватна книга');
const many = [];
for (let i = 0; i < 35; i++) many.push((await vcall('GET', '/v1/docs', { token: 'v1.bad.bad' })).status);
t('підбір токенів упирається в 429', many.includes(429));

const tampered = await fetch(`${STUDIO}/api/private-store/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-private-store-id': storeId, 'x-private-store-time': String(Math.floor(Date.now() / 1000)), 'x-private-store-signature': 'AAAA' }, body: JSON.stringify({ version: '0.1.0' }) });
t('пульс із підробленим підписом — 401', tampered.status === 401);
const unknownBeat = await fetch(`${STUDIO}/api/private-store/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-private-store-id': 'pstore_none', 'x-private-store-time': String(Math.floor(Date.now() / 1000)), 'x-private-store-signature': 'AAAA' }, body: '{}' });
t('пульс невідомого сервера — 401', unknownBeat.status === 401);

console.log('\nGrabFusion: стан локальних серверів автора');
const xstore = await import('../server/external/externalApiStore');
const photoRoutes = await import('../server/external/photoDraftRoutes');
await storeMod.saveUser({ id: 'u3', email: 'u3@test.ua', name: 'Без сервера', role: 'writer', createdAt: new Date().toISOString() } as any);
const gfApp = express();
photoRoutes.registerPhotoDraftRoutes(gfApp, { describe: async () => { throw new Error('не потрібно'); } });
const gfServer = gfApp.listen(0, '127.0.0.1');
await new Promise((r) => gfServer.once('listening', r));
const GF = `http://127.0.0.1:${(gfServer.address() as net.AddressInfo).port}/api/external/v1/photo-drafts`;
const gfCall = async (token?: string) => {
  const res = await fetch(`${GF}/private-stores`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, raw: text, cache: res.headers.get('cache-control') };
};
const phone1 = (await xstore.createToken({ userId: 'u1', name: 'GrabFusion', scope: 'photo-drafts' })).token;
const phone3 = (await xstore.createToken({ userId: 'u3', name: 'GrabFusion', scope: 'photo-drafts' })).token;
const gf1 = await gfCall(phone1);
t('телефон автора бачить свій сервер: назва, «в мережі», види', gf1.status === 200 && gf1.data.stores.length === 1 && gf1.data.stores[0].name === 'Домашній сервер' && gf1.data.stores[0].online === true && gf1.data.stores[0].kinds.includes('book'), gf1.raw);
t('адреси сервера, списку користувачів і ключів у відповіді НЕМАЄ', !/endpoint|127\.0\.0\.1|userIds|origins|publicKey|pairing|verify/i.test(gf1.raw), gf1.raw);
t('відповідь не кешується', gf1.cache === 'no-store');
t('користувач без призначеного сервера отримує порожній перелік', (await gfCall(phone3)).data.stores.length === 0);
t('без токена — 401', (await gfCall()).status === 401);
t('токен застосунку не відкриває чужих серверів: u3 не бачить сервера u1', !(await gfCall(phone3)).raw.includes(storeId));
await new Promise((r) => gfServer.close(r));

console.log('\nГалочка «приватно» переживає закриття вікна створення');
// Помилка 12.11.2026 (#551): ефект дашборда скидав вибір на закритті вікна, а вікно закриває той самий клік,
// що відкриває майстер, — книга мовчки ставала хмарною. Перевіряємо саме порядок у коді, бо React-ефект тестом утиліти не спіймати.
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const dashboardSource = fs.readFileSync(path.join(repoRoot, 'src/components/DashboardView.tsx'), 'utf8');
const closeBranch = /if \(!createChooserOpen\) \{([\s\S]*?)\n    \}/.exec(dashboardSource);
t('на закритті вікна вибір сервера не скидається', !!closeBranch && !/setPendingPrivateStore/.test(closeBranch[1]), closeBranch ? closeBranch[1].slice(0, 120) : 'гілку не знайдено');
t('натомість вибір скидається на ВІДКРИТТІ вікна', /\}\n    setPendingPrivateStore\(null\);/.test(dashboardSource));
t('кнопки способу створення спершу запамʼятовують вибір, потім закривають вікно', (dashboardSource.match(/choosePrivate\(\);\n\s*setCreateChooserOpen\(false\);/g) || []).length >= 2);

console.log('\nОхоронець приватності в браузері');
const guard = await import('../src/utils/privateStore');
t('поки приватного матеріалу не відкрито, нічого не блокується', !guard.blockedByPrivacy('POST', '/api/courses') && !guard.isPrivateMaterialActive());
guard.setActivePrivateMaterial('course', 'crs_x');
t('відкрито приватний курс: запис у хмарні курси, ШІ й PDF блокуються', guard.blockedByPrivacy('POST', '/api/courses') && guard.blockedByPrivacy('PUT', '/api/courses/abc') && guard.blockedByPrivacy('POST', '/api/ai/elaborate-instruction-steps') && guard.blockedByPrivacy('POST', '/api/pdf/author-preview'));
t('читання (GET) і службові маршрути не блокуються', !guard.blockedByPrivacy('GET', '/api/courses') && !guard.blockedByPrivacy('POST', '/api/private-store/pstore_x/token') && !guard.blockedByPrivacy('GET', '/api/auth/me'));
t('префікс /studio (маркетплейс) розпізнається', guard.blockedByPrivacy('POST', '/studio/api/ai/x'));
guard.setActivePrivateMaterial('book', 'BK-1');
guard.setActivePrivateMaterial('book', null);
t('закриття книги не знімає охорону з відкритого курсу (окремі слоти)', guard.isPrivateMaterialActive() && guard.blockedByPrivacy('POST', '/api/courses'));
guard.setActivePrivateMaterial('course', null);
t('закрито останній приватний матеріал — охорону знято', !guard.isPrivateMaterialActive() && !guard.blockedByPrivacy('POST', '/api/courses'));
guard.setPendingPrivateOpen({ kind: 'instruction', storeId: 'pstore_x', id: 'ins_1' });
t('«відкрити» чужого виду слот не забирає', guard.takePendingPrivateOpen('course') === null && guard.takePendingPrivateOpen('instruction')?.id === 'ins_1');
t('«відкрити» одноразове', guard.takePendingPrivateOpen('instruction') === null);

console.log('\nПерепідключення без втрати даних');
await vault.stop();
const reRequest = await call('POST', `/api/admin/private-stores/${storeId}/verification`, { session: 'adm' });
const reCode = codeFromMail();
const reVerify = await call('POST', `/api/admin/private-stores/${storeId}/verify`, { session: 'adm', body: { code: reCode } });
t('перепідключення теж лише за поштою й кодом', reRequest.status === 201 && reVerify.status === 200 && registry.getStore(storeId)!.verified);
const vault2 = await vserver.createPrivateStore({ env: baseEnv(vaultPort, path.join(DIR, 'vault-live'), reVerify.data.pairing.code), log: silent });
await vault2.start();
t('той самий сервер із новим кодом підключається, дані книги збережені', vault2.state.link?.status === 'active' && vault2.db.getDoc('u1', 'book_live01')?.meta.title === 'Приватна книга');
await vault2.stop();

console.log('\nСервер без ключа не запускається');
t('немає файлу ключа — createPrivateStore кидає помилку (fail closed)', await (async () => { try { await vserver.createPrivateStore({ env: { ...baseEnv(await freePort(), path.join(DIR, 'vault-nokey')), PRIVATE_STORE_MASTER_KEY_FILE: path.join(DIR, 'missing.key') }, log: silent }); return false; } catch (e) { return /Немає файлу головного ключа/.test((e as Error).message); } })());
const lone = await vserver.createPrivateStore({ env: { ...baseEnv(await freePort(), path.join(DIR, 'vault-lone')), STUDIO_URL: '' }, log: silent });
await lone.start();
const loneHealth = await new Promise<any>((resolve) => http.get({ host: '127.0.0.1', port: lone.config.port, path: '/v1/health' }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => resolve(JSON.parse(s))); }));
const loneDocs = await new Promise<number>((resolve) => http.get({ host: '127.0.0.1', port: lone.config.port, path: '/v1/docs', headers: { authorization: 'Bearer v1.a.b' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode || 0)); }));
t('непідключений сервер: health каже unpaired, записи недоступні (503)', loneHealth.paired === false && loneHealth.status === 'unpaired' && loneDocs === 503);
await lone.stop();

await new Promise((r) => studio.close(r));
(studio as any).closeAllConnections?.();
db.closeDb();
if (fail) console.log(`\nЖурнал локального сервера:\n${vaultLog.join('\n')}`);
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exitCode = fail ? 1 : 0;
