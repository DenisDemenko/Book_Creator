/**
 * Тести приватного розпізнавання «телефон → локальний сервер» (журнал #550). Запуск: npm run test:private-inbox
 *
 *  1. Запечатаний конверт: браузерна сторона (sealed.js, WebCrypto) ⇄ сервер (envelope.mjs, node:crypto) — звірка між собою.
 *  2. Черга в Studio: лише шифротекст, квоти, строк життя, власник, підписані запити сервера.
 *  3. Сервер: забирає конверти, відхиляє підроблені, зберігає чернетку `scan`, розпізнає (Tesseract; Ollama — на підставному сервері).
 */
const DIR = '/tmp/nova-private-inbox-test';
process.env.DATA_DIR = `${DIR}/studio`;
process.env.DATABASE_PATH = `${DIR}/studio/nova-studio.db`;
process.env.PRIVATE_INBOX_USER_MAX_MB = '10';
delete process.env.PRIVATE_STORE_SIGNING_KEY;

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(`${DIR}/studio`, { recursive: true });

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
const attempt = (fn: () => unknown) => {
  try {
    fn();
    return '';
  } catch (e) {
    return String((e as Error).message);
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const envelope = await import('../services/private-store/src/envelope.mjs');
const phone = createRequire(import.meta.url)(path.join(ROOT, 'services/grabfusion/grabfusion/static/sealed.js')) as {
  seal: (pub: string, plain: Uint8Array, aad: string) => Promise<Uint8Array>;
  encodePayload: (h: unknown, img: Uint8Array) => Uint8Array;
  aadFor: (vaultId: string, itemId: string) => string;
  newItemId: () => string;
};

// ---------------------------------------------------------------------------
console.log('\nЗапечатаний конверт: телефон шифрує, сервер розпечатує');
const key = envelope.generateInboxKey();
t('ключ скриньки: публічний 65 байтів (несжатий P-256), приватний 32', Buffer.from(key.publicKey, 'base64url').length === 65 && Buffer.from(key.privateKey, 'base64url').length === 32);
const itemId0 = phone.newItemId();
t('номер елемента — 22 символи base64url', /^[A-Za-z0-9_-]{22}$/.test(itemId0), itemId0);
const aad0 = phone.aadFor('pstore_aaaa', itemId0);
t('AAD збігається в обох реалізаціях', aad0 === envelope.envelopeAad('pstore_aaaa', itemId0));
const image0 = randomBytes(4096);
const payload0 = phone.encodePayload({ v: 1, draftId: 'pd_test0001', kind: 'course', order: 1, mime: 'image/jpeg', note: 'Секретна примітка' }, image0);
const sealed0 = Buffer.from(await phone.seal(key.publicKey, payload0, aad0));
t('конверт починається з NSE1 і не містить відкритого тексту', sealed0.subarray(0, 4).toString() === 'NSE1' && !sealed0.includes('Секретна') && !sealed0.includes('pd_test0001'));
const opened0 = envelope.openEnvelope(key.privateKey, sealed0, aad0);
t('сервер розпечатує те, що запечатав телефон', opened0.equals(Buffer.from(payload0)));
const decoded0 = envelope.decodePayload(opened0);
t('заголовок і зображення повертаються без втрат', decoded0.header.note === 'Секретна примітка' && decoded0.image.equals(image0));
t('два запечатування одного змісту різні (ефемерний ключ і nonce)', !Buffer.from(await phone.seal(key.publicKey, payload0, aad0)).equals(sealed0));
t('конверт, запечатаний Node-реалізацією, теж розпечатується', envelope.openEnvelope(key.privateKey, envelope.sealEnvelope(key.publicKey, Buffer.from(payload0), aad0), aad0).equals(Buffer.from(payload0)));
t('інший сервер не розпечатає', /не розшифровується/.test(attempt(() => envelope.openEnvelope(envelope.generateInboxKey().privateKey, sealed0, aad0))));
t('конверт для іншого сервера (AAD) не розпечатується', /не розшифровується/.test(attempt(() => envelope.openEnvelope(key.privateKey, sealed0, phone.aadFor('pstore_other', itemId0)))));
t('той самий конверт під іншим номером елемента не розпечатується', /не розшифровується/.test(attempt(() => envelope.openEnvelope(key.privateKey, sealed0, phone.aadFor('pstore_aaaa', phone.newItemId())))));
const flipped = Buffer.from(sealed0);
flipped[flipped.length - 20] ^= 1;
t('один змінений біт — відмова', /не розшифровується/.test(attempt(() => envelope.openEnvelope(key.privateKey, flipped, aad0))));
t('обрізаний конверт і сміття — відмова', !!attempt(() => envelope.openEnvelope(key.privateKey, sealed0.subarray(0, 60), aad0)) && /не запечатаний/.test(attempt(() => envelope.openEnvelope(key.privateKey, randomBytes(200), aad0))));
const badEph = Buffer.from(sealed0);
badEph.fill(0, 4, 69);
t('хибний ефемерний ключ — відмова, а не збій процесу', !!attempt(() => envelope.openEnvelope(key.privateKey, badEph, aad0)));
t('заголовок завеликий — відмова', /завеликий/.test(attempt(() => envelope.encodePayload({ x: 'a'.repeat(9000) }, image0))));
t('хибна довжина заголовка — відмова', /Хибний заголовок/.test(attempt(() => envelope.decodePayload(Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), randomBytes(20)])))));

// ---------------------------------------------------------------------------
// Studio + сервер у процесі
// ---------------------------------------------------------------------------
const db = await import('../server/db');
await db.initDb();
const storeMod = await import('../server/store');
const registry = await import('../server/privateStore/store');
const inboxMod = await import('../server/privateStore/inbox');
const xstore = await import('../server/external/externalApiStore');
const photoRoutes = await import('../server/external/photoDraftRoutes');
const routes = await import('../server/privateStoreRoutes');
const vserver = await import('../services/private-store/src/server.mjs');
const vconfig = await import('../services/private-store/src/config.mjs');
const vimage = await import('../services/private-store/src/imageInfo.mjs');
const vocr = await import('../services/private-store/src/ocr.mjs');
const vinbox = await import('../services/private-store/src/inbox.mjs');
const canvasMod = await import('@napi-rs/canvas');

const now0 = new Date().toISOString();
for (const [id, email] of [['adm', 'admin@test.ua'], ['u1', 'u1@test.ua'], ['u2', 'u2@test.ua']] as const) {
  await storeMod.saveUser({ id, email, name: id, role: id === 'adm' ? 'admin' : 'writer', createdAt: now0 } as any);
}
const app = express();
app.use(express.json({ limit: '40mb' }));
photoRoutes.registerPhotoDraftRoutes(app, { describe: async () => { throw new Error('не потрібно'); } });
routes.registerPrivateStoreRoutes(app, { mailEnabled: () => true, sendMail: async () => ({ ok: true }) });
const studio = app.listen(0, '127.0.0.1');
await new Promise((r) => studio.once('listening', r));
const STUDIO = `http://127.0.0.1:${(studio.address() as net.AddressInfo).port}`;
const PD = `${STUDIO}/api/external/v1/photo-drafts`;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

// підставна Ollama
let ollamaCalls: any[] = [];
let ollamaReply = 'Інструкція зі складання\n1. Покладіть стійку.\n2. Вставте кріплення.';
const ollama = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.url === '/api/tags') return void res.end(JSON.stringify({ models: [{ name: 'qwen2.5vl:7b' }, { name: 'llama3.2-vision:11b' }] }));
    if (req.url === '/api/chat') {
      ollamaCalls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      return void res.end(JSON.stringify({ message: { role: 'assistant', content: ollamaReply } }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
});
await new Promise<void>((r) => ollama.listen(0, '127.0.0.1', r));
const OLLAMA = `http://127.0.0.1:${(ollama.address() as net.AddressInfo).port}`;

// сервер: ключ, база, підключення
const keyFile = path.join(DIR, 'master.key');
fs.writeFileSync(keyFile, randomBytes(32).toString('hex'));
const vaultPort = await freePort();
const VAULT = `http://127.0.0.1:${vaultPort}`;
const PAGE_ORIGIN = 'https://studio.test.ua';
const TESS_DIR = process.env.TESS_TEST_DIR || path.join(os.tmpdir(), 'nova-tessdata');
const haveTess = fs.existsSync(path.join(TESS_DIR, 'ukr.traineddata')) && fs.existsSync(path.join(TESS_DIR, 'eng.traineddata'));
const store = registry.createStore({ name: 'Тестовий сервер', endpoint: VAULT, origins: [PAGE_ORIGIN], userIds: ['u1'], createdBy: 'adm' });
const verification = registry.confirmVerification(store.id, registry.startVerification(store.id)!);
const silent = { log: () => undefined, error: () => undefined };
const vault = await vserver.createPrivateStore({
  env: {
    PRIVATE_STORE_PORT: String(vaultPort),
    PRIVATE_STORE_PUBLIC_URL: VAULT,
    PRIVATE_STORE_DATA_DIR: path.join(DIR, 'vault'),
    PRIVATE_STORE_MASTER_KEY_FILE: keyFile,
    PRIVATE_STORE_HEARTBEAT_SEC: '3600',
    PRIVATE_STORE_INBOX_POLL_SEC: '0',
    PRIVATE_STORE_TESSDATA_DIR: haveTess ? TESS_DIR : '',
    PRIVATE_STORE_TESSDATA_GZIP: 'false',
    OLLAMA_URL: OLLAMA,
    STUDIO_URL: STUDIO,
    PAIRING_CODE: verification.pairingCode!,
  },
  log: silent,
});
await vault.start();
await vault.beat();

console.log('\nСтудія: ключ скриньки, черга, квоти, власник');
const rec = registry.getStore(store.id)!;
t('сервер у пульсі повідомив публічний ключ скриньки; Studio приватного ключа не має', rec.inboxKey === vault.state.inbox.publicKey && !JSON.stringify(rec).includes(vault.state.inbox.privateKey));
const u1 = (await xstore.createToken({ userId: 'u1', name: 'GrabFusion', scope: 'photo-drafts' })).token;
const u2 = (await xstore.createToken({ userId: 'u2', name: 'GrabFusion', scope: 'photo-drafts' })).token;
async function pcall(method: string, p: string, opts: { token?: string; body?: Buffer | string; type?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.type) headers['content-type'] = opts.type;
  const res = await fetch(PD + p, { method, headers, body: opts.body as any });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* не JSON */
  }
  return { status: res.status, data };
}
const stores1 = await pcall('GET', '/private-stores', { token: u1 });
t('телефон отримує ключ скриньки свого сервера (inbox: true)', stores1.status === 200 && stores1.data.stores[0].inbox === true && stores1.data.stores[0].inboxKey === vault.state.inbox.publicKey);
t('у відповіді телефону немає адреси сервера й приватних ключів', !/endpoint|127\.0\.0\.1|privateKey/i.test(JSON.stringify(stores1.data)));
t('користувачу без призначеного сервера скриньки не видно', (await pcall('GET', '/private-stores', { token: u2 })).data.stores.length === 0);

// тестові зображення: чистий «скан» і «телефонне» фото
function drawPage(width: number, height: number, lines: string[], font = 28) {
  const c = canvasMod.createCanvas(width, height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.font = `${font}px Arial`;
  lines.forEach((l, i) => ctx.fillText(l, 40, 70 + i * Math.round(font * 2)));
  return c;
}
const PAGE_LINES = ['Інструкція зі складання полиці «Нордик»', 'Комплектація: стійка бічна — 2 шт., полиця — 4 шт.', 'Увага! Складайте виріб удвох на рівній поверхні.', '1. Покладіть бічну стійку на підлогу.', '2. Вставте кріплення у отвори, позначені літерою А.', '3. Приєднайте нижню полицю та затягніть гвинти.'];
const cleanPng = drawPage(1240, 520, PAGE_LINES).toBuffer('image/png');
const cleanJpeg = drawPage(1240, 520, PAGE_LINES).toBuffer('image/jpeg', 90);
function phoneLike() {
  const page = drawPage(1240, 520, PAGE_LINES);
  const c = canvasMod.createCanvas(900, 520);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#cdc8be';
  ctx.fillRect(0, 0, 900, 520);
  ctx.translate(450, 260);
  ctx.rotate((3.2 * Math.PI) / 180);
  ctx.drawImage(page, -430, -240, 860, 480);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const grad = ctx.createLinearGradient(0, 0, 900, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.42)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 900, 520);
  return c.toBuffer('image/jpeg', 55);
}
const phoneJpeg = phoneLike();

async function sendItem(token: string, opts: { storeId?: string; vaultKey?: string; vaultId?: string; header?: Record<string, unknown>; image?: Buffer; itemId?: string; expect?: number } = {}) {
  const itemId = opts.itemId ?? phone.newItemId();
  const header = { v: 1, draftId: 'pd_draft0001', kind: 'instruction', instructionMode: 'assembly', title: 'Полиця Нордик', order: 1, mime: 'image/png', note: 'Секретна примітка', ...(opts.header ?? {}) };
  const sealed = Buffer.from(await phone.seal(opts.vaultKey ?? vault.state.inbox.publicKey, phone.encodePayload(header, opts.image ?? cleanPng), phone.aadFor(opts.vaultId ?? store.id, itemId)));
  const res = await pcall('PUT', `/private-inbox/${opts.storeId ?? store.id}/${itemId}`, { token, body: sealed, type: 'application/octet-stream' });
  return { itemId, sealed, ...res };
}

const first = await sendItem(u1);
t('телефон кладе запечатаний знімок у чергу Studio — 201, queued', first.status === 201 && first.data.state === 'queued', JSON.stringify(first.data));
const sealedAgain = first.sealed;
const dup = await pcall('PUT', `/private-inbox/${store.id}/${first.itemId}`, { token: u1, body: sealedAgain, type: 'application/octet-stream' });
t('повтор із черги телефона (той самий номер і байти) — 200, без дубля', dup.status === 200 && dup.data.duplicate === true);
t('той самий номер з іншим вмістом — 409', (await pcall('PUT', `/private-inbox/${store.id}/${first.itemId}`, { token: u1, body: Buffer.concat([sealedAgain, Buffer.from([1])]), type: 'application/octet-stream' })).status === 409);
t('відкритий знімок (без конверта) Studio не приймає — 400', (await pcall('PUT', `/private-inbox/${store.id}/${phone.newItemId()}`, { token: u1, body: cleanPng, type: 'application/octet-stream' })).status === 400);
t('без токена — 401; чужий користувач (сервер не призначено) — 404', (await pcall('PUT', `/private-inbox/${store.id}/${phone.newItemId()}`, { body: sealedAgain, type: 'application/octet-stream' })).status === 401 && (await pcall('PUT', `/private-inbox/${store.id}/${phone.newItemId()}`, { token: u2, body: sealedAgain, type: 'application/octet-stream' })).status === 404);
t('невідомий сервер — 404; хибний номер елемента — 400', (await pcall('PUT', `/private-inbox/pstore_nope/${phone.newItemId()}`, { token: u1, body: sealedAgain, type: 'application/octet-stream' })).status === 404 && (await pcall('PUT', `/private-inbox/${store.id}/short`, { token: u1, body: sealedAgain, type: 'application/octet-stream' })).status === 400);
t('стан елемента: queued; чужий користувач бачить 404', (await pcall('GET', `/private-inbox/${store.id}/${first.itemId}`, { token: u1 })).data.state === 'queued' && (await pcall('GET', `/private-inbox/${store.id}/${first.itemId}`, { token: u2 })).status === 404);
const stored = fs.readFileSync(path.join(DIR, 'studio', 'private-inbox', store.id, `${first.itemId}.bin`));
t('на диску Studio лише шифротекст: ні тексту примітки, ні назви, ні байтів зображення', !stored.includes('Секретна') && !stored.includes('Полиця') && !stored.includes(cleanPng.subarray(0, 32)) && stored.equals(first.sealed));
t('адмінці видно лише кількість і обсяг черги', inboxMod.inboxStats(store.id).pending === 1 && inboxMod.inboxStats(store.id).bytes === first.sealed.length);

// квоти й строк життя
const big = Buffer.concat([Buffer.from('NSE1'), randomBytes(4 * 1024 * 1024)]);
const quota: number[] = [];
for (let i = 0; i < 3; i++) quota.push((await pcall('PUT', `/private-inbox/${store.id}/${phone.newItemId()}`, { token: u1, body: big, type: 'application/octet-stream' })).status);
t('квота користувача: після ~10 МБ невзятого — 429', quota[0] === 201 && quota[1] === 201 && quota[2] === 429, quota.join(','));
t('елемент завеликий (понад 12 МБ) — 413', (await pcall('PUT', `/private-inbox/${store.id}/${phone.newItemId()}`, { token: u1, body: Buffer.concat([Buffer.from('NSE1'), randomBytes(13 * 1024 * 1024)]), type: 'application/octet-stream' })).status === 413);
const lateId = phone.newItemId();
const lateBytes = Buffer.concat([Buffer.from('NSE1'), randomBytes(100)]);
inboxMod.putInboxItem({ storeId: store.id, userId: 'u2', itemId: lateId, bytes: lateBytes, now: new Date(Date.now() - 80 * 3600 * 1000) });
inboxMod.sweepInbox(new Date());
t('невзятий конверт зникає за строком (72 год): файл видалено, стан expired', inboxMod.inboxStatus(store.id, 'u2', lateId) === 'expired' && !fs.existsSync(path.join(DIR, 'studio', 'private-inbox', store.id, `${lateId}.bin`)));
// прибрати квотні елементи, лишити перший
for (const it of inboxMod.listInboxPending(store.id)) if (it.id !== first.itemId) inboxMod.ackInboxItem(store.id, it.id);

console.log('\nПідписані запити сервера до черги');
async function signedFetch(method: string, apiPath: string, over: { id?: string; skew?: number; signWith?: any } = {}) {
  const link = vault.state.link;
  const { signedRequestHeaders } = await import('../services/private-store/src/studioLink.mjs');
  const headers = signedRequestHeaders(over.signWith ?? vault.state.identity, over.id ?? link.vaultId, method, apiPath, new Date(Date.now() + (over.skew ?? 0) * 1000));
  const res = await fetch(`${STUDIO}${apiPath}`, { method, headers });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}
t('без підпису черга закрита — 401', (await fetch(`${STUDIO}/api/private-store/inbox`)).status === 401);
t('підпис чужим ключем — 401', (await signedFetch('GET', '/api/private-store/inbox', { signWith: (await import('../services/private-store/src/crypto.mjs')).generateIdentity() })).status === 401);
t('застарілий підпис (+5 хв) — 401', (await signedFetch('GET', '/api/private-store/inbox', { skew: 300 })).status === 401);
t('підпис шляху не переноситься: підпис «list» не відкриває конверт', await (async () => {
  const link = vault.state.link;
  const { signedRequestHeaders } = await import('../services/private-store/src/studioLink.mjs');
  const headers = signedRequestHeaders(vault.state.identity, link.vaultId, 'GET', '/api/private-store/inbox');
  return (await fetch(`${STUDIO}/api/private-store/inbox/${first.itemId}`, { headers })).status === 401;
})());
const listed = await signedFetch('GET', '/api/private-store/inbox');
t('із підписом — перелік: рівно один елемент із власником u1', listed.status === 200 && JSON.parse(listed.bytes.toString()).items.length === 1 && JSON.parse(listed.bytes.toString()).items[0].userId === 'u1');

console.log('\nСервер забирає, розпечатує, зберігає, розпізнає');
// відхилення: чужий сервер, не зображення, «бомба» розмірів, невідповідність типу
const foreign = await sendItem(u1, { vaultKey: envelope.generateInboxKey().publicKey });
const notImage = await sendItem(u1, { image: Buffer.from('це не зображення, а просто текст'.repeat(5)) });
const bomb = Buffer.from(cleanPng);
bomb.writeUInt32BE(30000, 16);
bomb.writeUInt32BE(30000, 20);
const bombItem = await sendItem(u1, { image: bomb });
const wrongMime = await sendItem(u1, { header: { mime: 'image/jpeg' } });
const phoneItem = await sendItem(u1, { header: { draftId: 'pd_draft0001', order: 2, mime: 'image/jpeg', note: 'фото з телефона' }, image: phoneJpeg });
const jpegItem = await sendItem(u1, { header: { draftId: 'pd_draft0002', kind: 'course', courseSource: 'document', title: 'Курс із документа', order: 1, mime: 'image/jpeg' }, image: cleanJpeg });
const poll = await vault.scans.pollOnce();
t('опитування: три прийняті, чотири відхилені', poll.stored === 3 && poll.rejected === 4 && poll.errors === 0, JSON.stringify(poll));
t('відхилене й прийняте підтверджено: Studio видалила байти (delivered)', [foreign, notImage, bombItem, wrongMime, first, phoneItem, jpegItem].every((i) => !fs.existsSync(path.join(DIR, 'studio', 'private-inbox', store.id, `${i.itemId}.bin`))) && (await pcall('GET', `/private-inbox/${store.id}/${first.itemId}`, { token: u1 })).data.state === 'delivered');
const doc1 = vault.db.getDoc('u1', 'scan_pd_draft0001');
t('чернетка scan_pd_draft0001: власник u1, дві сторінки за порядком, шапка з телефона', !!doc1 && doc1.kind === 'scan' && doc1.payload.pages.length === 2 && doc1.payload.pages[0].order === 1 && doc1.payload.pages[1].order === 2 && doc1.payload.title === 'Полиця Нордик' && doc1.payload.instructionMode === 'assembly');
t('зображення лежить як зашифрований asset, його читає лише власник', !!vault.db.getAsset('u1', doc1!.payload.pages[0].assetId) && vault.db.getAsset('u2', doc1!.payload.pages[0].assetId) === null && vault.db.getDoc('u2', 'scan_pd_draft0001') === null);
const raw = fs.readFileSync(path.join(DIR, 'vault', 'private-store.sqlite3'));
const wal = fs.existsSync(path.join(DIR, 'vault', 'private-store.sqlite3-wal')) ? fs.readFileSync(path.join(DIR, 'vault', 'private-store.sqlite3-wal')) : Buffer.alloc(0);
const hay = Buffer.concat([raw, wal]);
t('у файлі бази сервера немає відкритого тексту примітки, назви й байтів зображення', hay.length > 0 && !hay.includes('Секретна') && !hay.includes('Полиця Нордик') && !hay.includes(cleanPng.subarray(0, 64)));
t('повторне опитування нічого не дублює', (await vault.scans.pollOnce()).stored === 0 && vault.db.getDoc('u1', 'scan_pd_draft0001')!.payload.pages.length === 2);
const docs = vault.db.listDocs('u1', 'scan');
t('перелік чернеток: дві, у мета — назва, вид, лічильники', docs.length === 2 && docs.every((d: any) => d.meta.pages >= 1 && d.meta.kind));
t('журнал сервера без вмісту: подій прийому є, тексту немає', (() => {
  const log = JSON.stringify(vault.db.recentAudit(200));
  return log.includes('inbox_stored') && log.includes('inbox_rejected') && !log.includes('Секретна') && !log.includes('Полиця');
})());

await vault.scans.whenIdle();
if (haveTess) {
  const doc = vault.db.getDoc('u1', 'scan_pd_draft0001')!.payload;
  const cleanPage = doc.pages[0].ocr;
  t('Tesseract: чистий скан розпізнано, якість good, ключові слова на місці', cleanPage.status === 'done' && cleanPage.engine === 'tesseract' && cleanPage.quality === 'good' && /Інструкція/.test(cleanPage.text) && /Комплектація/.test(cleanPage.text), JSON.stringify({ q: cleanPage.quality, c: cleanPage.confidence, t: String(cleanPage.text).slice(0, 80) }));
  const phonePage = doc.pages[1].ocr;
  t('Tesseract: «телефонне» фото (нахил, тінь, JPEG) після підготовки дає читабельний текст', phonePage.status === 'done' && phonePage.usedPrep === true && /Комплектація|Інструкція|Нордик/.test(phonePage.text) && Math.abs(phonePage.angle - 3.2) < 1.2, JSON.stringify({ q: phonePage.quality, c: phonePage.confidence, a: phonePage.angle, t: String(phonePage.text).slice(0, 100) }));
  t('для кожної сторінки є оцінка довіри; сумнівні слова позначено списком', typeof cleanPage.confidence === 'number' && Array.isArray(cleanPage.uncertain));
} else {
  console.log('  ⚠ пропущено розпізнавання Tesseract: немає мовних моделей у ' + TESS_DIR + ' (задайте TESS_TEST_DIR)');
}

console.log('\nOllama на цьому ж комп\'ютері й дії користувача');
const claimsToken = (await import('../server/privateStore/token')).signAccessToken(registry.signingKey().privatePkcs8, { vaultId: store.id, userId: 'u1', kinds: ['scan', 'course', 'book', 'instruction'] }).token;
function vcall(method: string, p: string, body?: unknown, token = claimsToken, extra: Record<string, string> = {}) {
  return fetch(`${VAULT}${p}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra }, body: body !== undefined ? JSON.stringify(body) : undefined }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) }));
}
const engines = await vcall('GET', '/v1/engines');
t('рушії: Ollama відповідає, моделі видно; Tesseract — за наявності моделей', engines.status === 200 && engines.data.ollama.available === true && engines.data.ollama.models.includes('qwen2.5vl:7b') && engines.data.tesseract.available === haveTess);
const pageId = vault.db.getDoc('u1', 'scan_pd_draft0001')!.payload.pages[0].pageId;
const rec1 = await vcall('POST', '/v1/scans/scan_pd_draft0001/recognize', { pageId, engine: 'ollama' });
t('«розпізнати Ollama» — 202, запит до моделі йде на цей комп\'ютер', rec1.status === 202);
await sleep(100);
await vault.scans.whenIdle();
const afterOllama = vault.db.getDoc('u1', 'scan_pd_draft0001')!.payload.pages.find((p: any) => p.pageId === pageId);
t('результат Ollama збережено: рушій, текст, якість unknown, зображення передано моделі', afterOllama.ocr.engine === 'ollama' && afterOllama.ocr.text === ollamaReply && afterOllama.ocr.quality === 'unknown' && ollamaCalls.length === 1 && ollamaCalls[0].messages[0].images.length === 1 && ollamaCalls[0].stream === false);
t('запит до Ollama без хмарних адрес: лише налаштований локальний URL', ollamaCalls.length === 1 && new URL(vault.config.ollamaUrl).hostname === '127.0.0.1');
const edited = await vcall('PUT', `/v1/scans/scan_pd_draft0001/pages/${pageId}/text`, { text: 'Виправлений вручну текст' });
const afterEdit = vault.db.getDoc('u1', 'scan_pd_draft0001')!.payload.pages.find((p: any) => p.pageId === pageId);
t('правка тексту вручну: збережено, позначено textEdited, оригінал рушія лишається', edited.status === 200 && afterEdit.ocr.text === 'Виправлений вручну текст' && afterEdit.textEdited === true && afterEdit.ocr.original === ollamaReply);
const hdr = await vcall('POST', '/v1/scans/scan_pd_draft0001/edit', { title: 'Нова назва', kind: 'course', courseSource: 'document', consumed: { kind: 'course', id: 'crs_abcdef01' } });
const afterHdr = vault.db.getDoc('u1', 'scan_pd_draft0001')!;
t('шапку чернетки можна виправити: назва, вид, позначка «створено матеріал»', hdr.status === 200 && afterHdr.payload.title === 'Нова назва' && afterHdr.payload.kind === 'course' && afterHdr.payload.consumed.id === 'crs_abcdef01' && afterHdr.meta.title === 'Нова назва');
t('чужий користувач не бачить і не змінює чернетку (404)', (await vcall('PUT', `/v1/scans/scan_pd_draft0001/pages/${pageId}/text`, { text: 'x' }, (await import('../server/privateStore/token')).signAccessToken(registry.signingKey().privatePkcs8, { vaultId: store.id, userId: 'u2', kinds: ['scan'] }).token)).status === 404);
t('без права на вид scan — 403', (await vcall('GET', '/v1/engines', undefined, (await import('../server/privateStore/token')).signAccessToken(registry.signingKey().privatePkcs8, { vaultId: store.id, userId: 'u1', kinds: ['book'] }).token)).status === 403);
t('загальний PUT /v1/docs не перезаписує вхідні з телефона — 403', (await vcall('PUT', '/v1/docs/scan_pd_draft0001', { kind: 'scan', payload: { x: 1 } })).status === 403);
t('невідомий рушій — 400; невідома сторінка — 404', (await vcall('POST', '/v1/scans/scan_pd_draft0001/recognize', { pageId, engine: 'cloud' })).status === 400 && (await vcall('POST', '/v1/scans/scan_pd_draft0001/recognize', { pageId: 'nopage12', engine: 'ollama' })).status === 404);
const del = await vcall('DELETE', `/v1/scans/scan_pd_draft0001/pages/${vault.db.getDoc('u1', 'scan_pd_draft0001')!.payload.pages[1].pageId}`);
t('сторінку можна видалити разом із зображенням', del.status === 200 && vault.db.getDoc('u1', 'scan_pd_draft0001')!.payload.pages.length === 1);
t('видалення чернетки прибирає й зображення (загальний DELETE)', (await vcall('DELETE', '/v1/docs/scan_pd_draft0002')).status === 200 && vault.db.getDoc('u1', 'scan_pd_draft0002') === null && vault.db.stats('u1').assets === 1);

console.log('\nМежа приватності Ollama і якість');
t('OLLAMA_URL лише локальний: публічна адреса — відмова на старті', /цей комп/.test(attempt(() => vconfig.loadConfig({ OLLAMA_URL: 'https://api.example.com' } as any))) && /цей комп/.test(attempt(() => vconfig.loadConfig({ OLLAMA_URL: 'http://8.8.8.8:11434' } as any))));
t('дозволені: localhost, host.docker.internal, 192.168.x.x, 10.x', ['http://localhost:11434', 'http://host.docker.internal:11434', 'http://192.168.1.5:11434', 'http://10.0.0.7:11434'].every((u) => !attempt(() => vconfig.loadConfig({ OLLAMA_URL: u } as any))));
const good = vocr.scoreWords(Array.from({ length: 20 }, () => ({ text: 'слово', conf: 92 })));
const poor = vocr.scoreWords(Array.from({ length: 20 }, (_, i) => ({ text: i % 2 ? 'хиб' + i : 'сміття', conf: 31 })));
t('оцінка якості: впевнений текст — good, ненадійний — poor з переліком сумнівних слів', good.quality === 'good' && poor.quality === 'poor' && poor.uncertain.length > 0 && vocr.scoreWords([]).quality === 'poor');
t('заголовок конверта (недовірений) нормалізується: сміття у назві обрізано, невідомий вид — відмова', vinbox.parseHeader({ v: 1, draftId: 'pd_abcdef', kind: 'course', mime: 'image/png', title: '  Назва\u0007 '.repeat(50), order: 5 }).title.length <= 200 && /Невідомий вид/.test(attempt(() => vinbox.parseHeader({ v: 1, draftId: 'pd_abcdef', kind: 'hack', mime: 'image/png' }))));
t('розпізнавання формату за заголовком: PNG/JPEG розпізнано, текст і «бомба» — відмова', vimage.sniffImage(cleanPng)?.mime === 'image/png' && vimage.sniffImage(cleanJpeg)?.mime === 'image/jpeg' && vimage.sniffImage(Buffer.from('просто текст, не зображення'.repeat(3))) === null && !!vimage.imageProblem(vimage.sniffImage(bomb)));

console.log('\nВідкликання сервера прибирає чергу');
const lateItem = await sendItem(u1, { header: { draftId: 'pd_draft0003' } });
t('елемент у черзі до відкликання', lateItem.status === 201 && inboxMod.inboxStats(store.id).pending === 1);
registry.setRevoked(store.id, true);
inboxMod.dropInboxOfStore(store.id);
t('після відкликання невзяті конверти видалено, а сервер більше не може їх забирати (401)', inboxMod.inboxStats(store.id).pending === 0 && (await signedFetch('GET', '/api/private-store/inbox')).status === 401);

await vault.stop();
studio.closeAllConnections?.();
await new Promise((r) => studio.close(r));
await new Promise((r) => ollama.close(r));
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exitCode = fail ? 1 : 0;
void createHash;
