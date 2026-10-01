/**
 * Т6.2 В2 (`PLAN_ACCESS.md`): наданий доступ на справжньому сервері —
 * PostgreSQL ядра, кімната спільного редагування (WebSocket), серверна копія,
 * API ядра. Без браузера (браузер — у В4).
 *
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:access-realtime
 * (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 * видаляється — лише тестова база!)
 *
 *   • ілюстраторка Ірина: сцена 2.1 (перегляд) і героїня Олена — бачить у
 *     кімнаті лише це, нічого не пише;
 *   • перекладач Тарас: розділ 1 (редагування) — його правка книги
 *     приймається лише в розділі 1, решта книги на сервері лишається;
 *   • точкові правки недозволених сцен не надходять і не приймаються;
 *   • серверна копія й зібрані файли — лише власнику; API ядра — білий список;
 *   • відкликання — після перепідключення сцени вже немає.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import WebSocket from 'ws';

const DB_URL = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!DB_URL) {
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL.');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-live-access-rt');
const PORT = Number(process.env.ACCESS_RT_PORT || 34362);
const BASE = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/ws`;
const BOOK = 'BK-ACCESS-RT';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Pool({ connectionString: DB_URL });
await db.query('DROP SCHEMA IF EXISTS fusion_core CASCADE');
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

const { initialBookData } = await import('../src/data/initialBook');
const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
const now = new Date().toISOString();
const TOK: Record<string, string> = {};
for (const [id, name] of [['u-owner', 'Олена'], ['u-iryna', 'Ірина'], ['u-taras', 'Тарас'], ['u-stranger', 'Чужий']] as const) {
  await saveUser({ id, email: `${id}@test.ua`, name, role: 'writer', createdAt: now } as any);
  TOK[id] = crypto.randomBytes(24).toString('hex');
  await createSession({ token: TOK[id], userId: id, createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() });
}

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, APP_URL: BASE, SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => log.push(String(d)));
child.stderr.on('data', (d) => log.push(String(d)));
process.on('exit', () => { try { child.kill(); } catch { /* */ } });
let health: any = null;
for (let i = 0; i < 120 && health?.core !== 'ready'; i++) {
  try { health = await (await fetch(`${BASE}/api/health`)).json(); } catch { /* */ }
  if (health?.core !== 'ready') await sleep(500);
}
if (health?.core !== 'ready') { console.error(log.join('').slice(-3000)); child.kill(); process.exit(1); }

const api = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: { Cookie: `nova_session=${TOK[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return {}; } })() as any };
};

// ── Книга власника, ядро, учасники й наданий доступ ─────────────────────────
const stamp = (ms: number) => new Date(Date.parse('2026-10-01T10:00:00.000Z') + ms).toISOString();
const BOOK_DATA: any = JSON.parse(JSON.stringify({ ...initialBookData, id: BOOK, title: 'Маяк — доступ', updatedAt: stamp(0) }));
console.log('\nПідготовка:');
t('власник зберігає серверну копію', (await api('PUT', `/api/books/${BOOK}`, 'u-owner', { book: BOOK_DATA })).status === 200);
let olena: any = null;
for (let i = 0; i < 60 && !olena; i++) {
  olena = (await q(`SELECT id FROM fusion_core.entities WHERE project_id=$1 AND type='character' AND external_ref='studio:character:char-1'`, [BOOK]))[0];
  if (!olena) await sleep(500);
}
t('книга синхронізована з ядром — героїня Олена (char-1) є сутністю', !!olena);
for (const [uid, role] of [['u-iryna', 'illustrator'], ['u-taras', 'translator']] as const) {
  const r = await api('POST', `/api/core/projects/${BOOK}/participants/roles`, 'u-owner', { userId: uid, roleId: role });
  t(`власник додав ${uid} з роллю ${role}`, r.status === 201, `${r.status} ${r.text.slice(0, 120)}`);
}
const pid = async (uid: string) => (await q(`SELECT id FROM fusion_core.project_participants WHERE project_id=$1 AND user_id=$2`, [BOOK, uid]))[0].id;
const grant = async (uid: string, level: string, scope: string, ref: string | null) =>
  (await q(`INSERT INTO fusion_core.access_grants (project_id, participant_id, level, scope_type, scope_ref, granted_by) VALUES ($1,$2,$3,$4,$5,'user:u-owner') RETURNING id`, [BOOK, await pid(uid), level, scope, ref]))[0].id;
const irynaScene = await grant('u-iryna', 'view', 'scene', 'sec-2-1');
await grant('u-iryna', 'view', 'character', olena?.id ?? 'none');
await grant('u-taras', 'edit', 'chapter', 'chap-1');

// ── WebSocket ──────────────────────────────────────────────────────────────
interface Client { ws: WebSocket; messages: any[]; closed: Promise<number>; }
const ticket = async (uid: string) => {
  const res = await api('POST', '/api/realtime/ticket', uid, { bookId: BOOK });
  return res.body;
};
const connect = (url: string): Promise<Client> => new Promise((resolve) => {
  const ws = new WebSocket(url);
  const messages: any[] = [];
  let closeResolve!: (c: number) => void;
  const closed = new Promise<number>((r) => { closeResolve = r; });
  ws.on('message', (d) => messages.push(JSON.parse(String(d))));
  ws.on('close', (code) => closeResolve(code));
  ws.on('open', () => resolve({ ws, messages, closed }));
  ws.on('error', () => resolve({ ws, messages, closed }));
});
const join = async (uid: string, initialBook?: any) => {
  const tk = await ticket(uid);
  const c = await connect(`${WS_URL}?ticket=${encodeURIComponent(tk.ticket)}`);
  c.ws.send(JSON.stringify({ type: 'client:join', payload: { bookId: BOOK, initialBook, user: { clientId: `c-${uid}-${Date.now()}`, userName: uid } } }));
  await sleep(600);
  return { c, tk };
};
const last = (c: Client, type: string) => [...c.messages].reverse().find((m) => m.type === type);
const send = (c: Client, type: string, payload: any) => c.ws.send(JSON.stringify({ type, payload: { bookId: BOOK, ...payload } }));
const sectionOf = (book: any, sid: string) => book?.chapters?.flatMap((ch: any) => ch.sections ?? []).find((s: any) => s.id === sid);

console.log('\nКімната спільного редагування:');
const { c: owner } = await join('u-owner', BOOK_DATA);
t('власник у кімнаті — повна книга', last(owner, 'room:sync')?.payload?.book?.chapters?.length === 2);

const { c: iryna, tk: tkI } = await join('u-iryna');
t('квиток ілюстраторки: спільна кімната, обмежено, не пише', tkI.shared === true && tkI.restricted === true && tkI.canWrite === false, JSON.stringify(tkI));
const syncI = last(iryna, 'room:sync')?.payload;
const textI = JSON.stringify(syncI?.book ?? null);
t('ілюстраторка бачить лише сцену 2.1 (розділ 2)', syncI?.book?.chapters?.length === 1 && syncI.book.chapters[0].sections.map((s: any) => s.id).join() === 'sec-2-1', textI.slice(0, 200));
t('…і лише картку Олени; синопсису, логлайну, біблії стилю — немає', syncI?.book?.characters?.map((c: any) => c.id).join() === 'char-1' && syncI.book.synopsis === '' && !textI.includes(String(BOOK_DATA.synopsis).slice(0, 40)) && syncI.book.visualBible?.artStyle === '');
t('…ні тексту розділу 1', !textI.includes(String(sectionOf(BOOK_DATA, 'sec-1-1').content).slice(0, 60)));
t('позначка обмеження й права — у room:sync', syncI?.restricted === true && syncI.access?.scenes?.['sec-2-1'] === 'view' && Array.isArray(syncI.changelog) && syncI.changelog.length === 0);

const { c: taras, tk: tkT } = await join('u-taras');
t('квиток перекладача: обмежено, пише', tkT.restricted === true && tkT.canWrite === true);
t('перекладач бачить лише розділ 1', last(taras, 'room:sync')?.payload?.book?.chapters?.map((c: any) => c.id).join() === 'chap-1');

// Перекладач надсилає «свою» книгу: розділ 1 змінено, плюс спроба змінити сцену 2.1 і назву книги.
{
  const mine = JSON.parse(JSON.stringify(last(taras, 'room:sync').payload.book));
  mine.updatedAt = stamp(60_000);
  mine.title = 'ЗЛАМАНА НАЗВА';
  mine.chapters[0].sections[0].content = 'ПЕРЕКЛАД РОЗДІЛУ 1';
  mine.chapters.push({ id: 'chap-2', title: 'Підробка', sections: [{ id: 'sec-2-1', content: 'ПІДРОБКА СЦЕНИ 2.1' }] });
  const before = owner.messages.length;
  const beforeI = iryna.messages.length;
  send(taras, 'book:update', { updatedBook: mine });
  await sleep(700);
  const got = owner.messages.slice(before).find((m) => m.type === 'book:remote_update')?.payload?.book;
  t('власник отримав правку перекладача: розділ 1 змінено', sectionOf(got, 'sec-1-1')?.content === 'ПЕРЕКЛАД РОЗДІЛУ 1');
  t('…сцена 2.1, назва й склад книги — як на сервері', sectionOf(got, 'sec-2-1')?.content === sectionOf(BOOK_DATA, 'sec-2-1').content && got?.title === BOOK_DATA.title && got?.chapters?.length === 2);
  const gotI = iryna.messages.slice(beforeI).find((m) => m.type === 'book:remote_update')?.payload?.book;
  t('ілюстраторці — оновлення лише її сцени (без розділу 1)', gotI?.chapters?.length === 1 && !JSON.stringify(gotI).includes('ПЕРЕКЛАД РОЗДІЛУ 1'));
}

console.log('\nТочкові правки:');
{
  const o0 = owner.messages.length;
  const i0 = iryna.messages.length;
  const t0 = taras.messages.length;
  send(taras, 'section:patch', { patch: { chapterId: 'chap-2', sectionId: 'sec-2-1', content: 'ЧУЖА ПРАВКА' } });
  await sleep(400);
  t('перекладач правит сцену поза доступом — не приймається, ніхто не отримує', !owner.messages.slice(o0).some((m) => m.type === 'section:remote_patch') && !iryna.messages.slice(i0).some((m) => m.type === 'section:remote_patch'));
  send(taras, 'section:patch', { patch: { chapterId: 'chap-1', sectionId: 'sec-1-2', content: 'ПЕРЕКЛАД 1.2' } });
  await sleep(400);
  t('правка своєї сцени — власник отримує', owner.messages.slice(o0).some((m) => m.type === 'section:remote_patch' && m.payload.patch.content === 'ПЕРЕКЛАД 1.2'));
  t('…ілюстраторка — ні (не її сцена)', !iryna.messages.slice(i0).some((m) => m.type === 'section:remote_patch'));
  send(owner, 'section:patch', { patch: { chapterId: 'chap-2', sectionId: 'sec-2-1', content: 'НОВА СЦЕНА 2.1' } });
  await sleep(400);
  t('власник правит сцену 2.1 — ілюстраторка отримує, перекладач — ні',
    iryna.messages.slice(i0).some((m) => m.type === 'section:remote_patch' && m.payload.patch.content === 'НОВА СЦЕНА 2.1') && !taras.messages.slice(t0).some((m) => m.type === 'section:remote_patch' && m.payload.patch.sectionId === 'sec-2-1'));
  const o1 = owner.messages.length;
  send(iryna, 'book:update', { updatedBook: { id: BOOK, title: 'ЗЛАМАНО', updatedAt: stamp(3_600_000), chapters: [] } });
  send(iryna, 'section:patch', { patch: { chapterId: 'chap-2', sectionId: 'sec-2-1', content: 'ІРИНА ПИШЕ' } });
  await sleep(500);
  t('ілюстраторка (перегляд) нічого не змінює', !owner.messages.slice(o1).some((m) => m.type === 'book:remote_update' || m.type === 'section:remote_patch'));
}

console.log('\nСерверна копія, експорт, API ядра:');
t('серверна копія книги — ілюстраторці 404', (await api('GET', `/api/books/${BOOK}`, 'u-iryna')).status === 404);
t('зібрані файли — 404', (await api('GET', `/api/books/${BOOK}/artifacts`, 'u-iryna')).status === 404 && (await api('GET', `/api/books/${BOOK}/artifact/pdf`, 'u-iryna')).status === 404);
t('перезаписати серверну копію перекладач не може', (await api('PUT', `/api/books/${BOOK}`, 'u-taras', { book: { ...BOOK_DATA, title: 'ЗЛАМАНО' } })).status === 404);
const accI = await api('GET', `/api/projects/${BOOK}/access`, 'u-iryna');
t('API ядра: «хто я» — обмежено', accI.status === 200 && accI.body.access.effective.restricted === true);
t('API ядра: пошук — 403 scope_restricted', (await api('GET', `/api/projects/${BOOK}/search?q=маяк`, 'u-iryna')).body.kind === 'scope_restricted');
const entsI = await api('GET', `/api/projects/${BOOK}/entities`, 'u-iryna');
t('API ядра: сутності — лише Олена', entsI.status === 200 && entsI.body.entities.length === 1 && entsI.body.entities[0].externalRef === 'studio:character:char-1', JSON.stringify(entsI.body.entities?.map((e: any) => e.name)));
t('API ядра: власник — без змін', (await api('GET', `/api/projects/${BOOK}/search?q=маяк`, 'u-owner')).status === 200);

console.log('\nВідкликання:');
await q(`UPDATE fusion_core.access_grants SET status='revoked', revoked_at=now(), revoked_by='user:u-owner' WHERE id=$1`, [irynaScene]);
iryna.ws.close();
const { c: iryna2 } = await join('u-iryna');
const sync2 = last(iryna2, 'room:sync')?.payload;
t('після відкликання сцени — у кімнаті сцени немає, картка Олени лишилась', sync2?.book?.chapters?.length === 0 && sync2.book.characters.map((c: any) => c.id).join() === 'char-1', JSON.stringify(sync2?.book?.chapters));
await q(`UPDATE fusion_core.access_grants SET status='revoked', revoked_at=now(), revoked_by='user:u-owner' WHERE participant_id=$1`, [await pid('u-iryna')]);
iryna2.ws.close();
const tk3 = await ticket('u-iryna');
t('відкликано все — лише приватна кімната', tk3.shared === false);

for (const c of [owner, taras]) c.ws.close();
await sleep(200);
child.kill();
await db.end();
const errs = log.join('').split('\n').filter((l) => /Error|помилка/i.test(l) && !/SMTP|smtp|GEMINI|ключ/i.test(l));
t('журнал сервера — без помилок', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail > 0 ? 1 : 0);
