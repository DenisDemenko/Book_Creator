/**
 * Живий прогін наданого доступу (Т6.2 В4, `PLAN_ACCESS.md`). Запуск:
 * CORE_TEST_DATABASE_URL=postgres://… npm run live:access-grants (потрібен
 * зібраний dist/server.mjs і Chrome/Chromium; схема `fusion_core` у цій базі
 * видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер (чотири люди — чотири окремі профілі):
 *   (1) власниця в «Команді» → «Доступ» надає ілюстраторці сцену «Лабіринти» і
 *       героїню Олену (перегляд) та медіатеку (робочий доступ), перекладачеві —
 *       розділ 1 (редагування);
 *   (2) ілюстраторка відкриває Студію — у неї лише сцена 2.1 і картка Олени,
 *       позначка обмеженого доступу, серверна копія книги — 404;
 *   (3) перекладач бачить лише розділ 1 і пише в ньому — правка доходить до
 *       власниці, решта книги не змінюється;
 *   (4) бета-читач зі старим запрошенням — уся книга, як раніше;
 *   (5) власниця відкликає сцену — у ілюстраторки вона зникає без
 *       перезавантаження; журнал;
 *   (6) телефон 390 px.
 *
 * Пастка (log.md #172): у page.evaluate — лише рядки або стрілкові функції.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DB_URL = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!DB_URL) {
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL.');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-live-access-grants');
const PORT = Number(process.env.ACCESS_GRANTS_PORT || 34363);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'BK-ACCESS-LIVE';
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
const { initStore, saveUser, createSession, createCollabInvite } = await import('../server/store');
await initStore();
const now = new Date().toISOString();
const people = [
  { id: 'u-owner', email: 'owner-access@test.ua', name: 'Олена Авторка' },
  { id: 'u-iryna', email: 'iryna-access@test.ua', name: 'Ірина' },
  { id: 'u-taras', email: 'taras-access@test.ua', name: 'Тарас' },
  { id: 'u-reader', email: 'reader-access@test.ua', name: 'Бета-читач' },
];
const TOK: Record<string, string> = {};
for (const p of people) {
  await saveUser({ ...p, role: 'writer', createdAt: now } as any);
  TOK[p.id] = crypto.randomBytes(24).toString('hex');
  await createSession({ token: TOK[p.id], userId: p.id, createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() });
}
// Старе запрошення (до Т6.2): бета-читач прийняв його ще тоді.
await createCollabInvite({
  id: 'inv-old-reader', bookId: BOOK, bookTitle: 'Маяк', inviterUserId: 'u-owner', inviteeEmail: 'reader-access@test.ua',
  role: 'reader', token: 'tok-old-reader', status: 'accepted', emailSent: false, createdAt: now, acceptedAt: now, acceptedUserId: 'u-reader',
} as any);

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ROLE_ONBOARDING: 'off', ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, APP_URL: BASE, SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' },
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

// Книга власниці: серверна копія (цілі доступу) і синхронізація з ядром (герої).
const FULL: any = JSON.parse(JSON.stringify({ ...initialBookData, id: BOOK, title: 'Маяк', updatedAt: new Date(Date.now() - 60_000).toISOString() }));
const SEC11 = String(FULL.chapters[0].sections[0].content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
const SEC21 = String(FULL.chapters[1].sections[0].content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
await api('PUT', `/api/books/${BOOK}`, 'u-owner', { book: FULL });
let olena: any = null;
for (let i = 0; i < 60 && !olena; i++) {
  olena = (await q(`SELECT id FROM fusion_core.entities WHERE project_id=$1 AND type='character' AND external_ref='studio:character:char-1'`, [BOOK]))[0];
  if (!olena) await sleep(500);
}
for (const [uid, role] of [['u-iryna', 'illustrator'], ['u-taras', 'translator']] as const) {
  await api('POST', `/api/core/projects/${BOOK}/participants/roles`, 'u-owner', { userId: uid, roleId: role });
}

// ── Браузер ──────────────────────────────────────────────────────────────────
const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [process.env.CHROMIUM_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors: string[] = [];
type Page = Awaited<ReturnType<typeof browser.newPage>>;

const seedBook = async (page: Page, book: any) => {
  await page.evaluate(async (b: any) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('nova_studio', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('snapshots')) d.createObjectStore('snapshots', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const d = req.result;
        const tx = d.transaction(['books', 'meta'], 'readwrite');
        tx.objectStore('books').put({ id: b.id, data: b, updatedAt: new Date().toISOString() });
        tx.objectStore('meta').put({ key: 'active_book_id', value: b.id });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, book);
};
const localBook = (page: Page) =>
  page.evaluate(
    (id: string) =>
      new Promise<any>((resolve) => {
        const req = indexedDB.open('nova_studio', 1);
        req.onsuccess = () => {
          const g = req.result.transaction('books').objectStore('books').get(id);
          g.onsuccess = () => resolve(g.result?.data ?? null);
          g.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
    BOOK,
  );
const open = async (uid: string, book: any) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await ctx.setCookie({ name: 'nova_session', value: TOK[uid], domain: 'localhost', path: '/' });
  page.on('pageerror', (e) => errors.push(`${uid}: ${String(e)}`));
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
  await seedBook(page, book);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
  return { ctx, page };
};
const openAccess = async (page: Page) => {
  await page.waitForSelector('#collab-team-drawer-btn', { timeout: 40000 });
  const already = await page.$('[data-collab-tab="access"]');
  if (!already) await page.evaluate(() => (document.querySelector('#collab-team-drawer-btn') as HTMLElement | null)?.click());
  await page.waitForSelector('[data-collab-tab="access"]', { timeout: 20000 });
  await page.evaluate(() => (document.querySelector('[data-collab-tab="access"]') as HTMLElement | null)?.click());
  await page.waitForSelector('[data-access-panel="ready"], [data-access-panel="error"]', { timeout: 20000 });
};
const closeDrawer = async (page: Page) => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-collab-tab="access"]')?.closest('.fixed') as HTMLElement | null;
    overlay?.click();
  });
  await sleep(300);
};
const waitFor = async (fn: () => Promise<boolean>, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
const grantViaUi = async (page: Page, userId: string, scope: string, level: string, target?: string) => {
  await page.select('[data-access-user]', userId);
  await page.select('[data-access-scope]', scope);
  await sleep(250);
  await page.select('[data-access-level]', level);
  if (target) await page.select('[data-access-target]', target);
  await sleep(200);
  await page.click('[data-access-grant]');
  await page.waitForFunction(() => !!document.querySelector('[data-access-notice]'), { timeout: 10000 }).catch(() => null);
  await sleep(600);
  return page.$eval('[data-access-notice]', (e) => `${e.getAttribute('data-access-notice')}: ${(e as HTMLElement).innerText}`).catch(() => '');
};
// Порожня оболонка книги в браузері учасника: зміст прийде з кімнати.
const SHELL = { ...FULL, title: 'Маяк', chapters: [], characters: [], updatedAt: '2020-01-01T00:00:00.000Z' };

try {
  // ── (1) ────────────────────────────────────────────────────────────────────
  console.log('(1) Власниця надає доступ у «Команда» → «Доступ»:');
  const { page: owner } = await open('u-owner', FULL);
  await openAccess(owner);
  const meOwner = await owner.$eval('[data-access-me]', (e) => (e as HTMLElement).innerText).catch(() => '');
  t('мій доступ — повний', /Повний доступ/.test(meOwner), meOwner);
  const users = await owner.$$eval('[data-access-user] option', (os) => os.map((o) => (o as HTMLOptionElement).value));
  t('у списку «Кому» — учасники (ілюстраторка, перекладач), без власниці', users.includes('u-iryna') && users.includes('u-taras') && !users.includes('u-owner'), users.join());
  await owner.select('[data-access-scope]', 'scene');
  await sleep(250);
  const sceneGroups = await owner.$$eval('[data-access-target] optgroup', (gs) => gs.map((g) => `${g.getAttribute('label')}: ${Array.from(g.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value).join(',')}`));
  t('сцени згруповано за розділами книги', sceneGroups.length === 2 && sceneGroups[1].includes('sec-2-1'), sceneGroups.join(' | '));
  t('сцену «Лабіринти» ілюстраторці — надано', /^success/.test(await grantViaUi(owner, 'u-iryna', 'scene', 'view', 'sec-2-1')));
  t('героїню Олену — надано', /^success/.test(await grantViaUi(owner, 'u-iryna', 'character', 'view', olena?.id)));
  const lv = await (async () => { await owner.select('[data-access-scope]', 'media_library'); await sleep(250); return owner.$$eval('[data-access-level] option', (os) => os.map((o) => (o as HTMLOptionElement).value)); })();
  t('для медіатеки — рівні «перегляд» і «робота з файлами»', lv.join() === 'view,work', lv.join());
  t('медіатеку (робочий доступ) — надано', /^success/.test(await grantViaUi(owner, 'u-iryna', 'media_library', 'work')));
  t('перекладачеві — розділ 1, редагування', /^success/.test(await grantViaUi(owner, 'u-taras', 'chapter', 'edit', 'chap-1')));
  const card = await owner.$eval('[data-access-person="u-iryna"]', (e) => (e as HTMLElement).innerText).catch(() => '');
  t('картка ілюстраторки: три доступи з назвами цілей', /Сцена/.test(card) && /Олена/.test(card) && /Медіатека/.test(card) && /Робота з файлами/.test(card), card.replace(/\n/g, ' / '));
  const rows = await q(`SELECT g.level, g.scope_type, g.scope_ref, p.user_id, g.granted_by FROM fusion_core.access_grants g JOIN fusion_core.project_participants p ON p.id = g.participant_id WHERE g.project_id=$1 AND g.status='active' ORDER BY g.created_at`, [BOOK]);
  t('у базі — чотири записи від власниці', rows.length === 4 && rows.every((r: any) => r.granted_by === 'user:u-owner'), JSON.stringify(rows.map((r: any) => `${r.user_id}:${r.level}:${r.scope_type}`)));
  await closeDrawer(owner);

  // ── (2) ────────────────────────────────────────────────────────────────────
  console.log('\n(2) Ілюстраторка бачить лише надане:');
  const { page: iryna } = await open('u-iryna', SHELL);
  const gotI = await waitFor(async () => (await localBook(iryna))?.accessRestricted === true);
  const bI = await localBook(iryna);
  t('книга з кімнати — обмежена (позначка), записана в її браузері', gotI);
  t('лише розділ 2 і сцена 2.1, лише картка Олени', bI?.chapters?.length === 1 && bI.chapters[0].sections.map((s: any) => s.id).join() === 'sec-2-1' && bI.characters.map((c: any) => c.id).join() === 'char-1', JSON.stringify(bI?.chapters?.map((c: any) => c.id)));
  const pageText = await iryna.evaluate(() => document.body.innerText);
  t('тексту розділу 1 на сторінці немає', !pageText.includes(SEC11.slice(0, 25)));
  t('позначка «Обмежений доступ» видима', !!(await iryna.$('[data-access-restricted-banner]')));
  await openAccess(iryna);
  const meI = await iryna.$eval('[data-access-me]', (e) => (e as HTMLElement).innerText).catch(() => '');
  t('«Мій доступ»: обмежений — сцена, персонаж, медіатека', /Обмежений доступ/.test(meI) && /сцен: 1/.test(meI) && /персонажів: 1/.test(meI) && /медіатека/.test(meI), meI);
  t('надавати доступ не може — форми немає', !(await iryna.$('[data-access-form]')));
  await closeDrawer(iryna);
  const fetched = await iryna.evaluate(async (id: string) => {
    const r1 = await fetch(`/api/books/${id}`, { credentials: 'same-origin' });
    const r2 = await fetch(`/api/projects/${id}/search?q=світанок`, { credentials: 'same-origin' });
    const r3 = await fetch(`/api/projects/${id}/media`, { credentials: 'same-origin' });
    return [r1.status, r2.status, r3.status];
  }, BOOK);
  t('з її браузера: серверна копія — 404, пошук — 403, медіатека книги — 200', fetched.join() === '404,403,200', fetched.join());
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const upBook = await api('POST', '/api/media/upload', 'u-owner', { dataUrl: PNG, filename: 'olena.png', bookId: BOOK, kind: 'character_art' });
  const upOther = await api('POST', '/api/media/upload', 'u-owner', { dataUrl: PNG, filename: 'private.png', bookId: 'BK-OTHER-PRIVATE', kind: 'upload' });
  const fileStatus = async (id: string, who: string) => (await fetch(`${BASE}/api/media/file/${id}`, { headers: { Cookie: `nova_session=${TOK[who]}` } })).status;
  t('файл медіатеки книги (портрет у картці) — ілюстраторці 200, файл іншої книги власниці — 404',
    !!upBook.body.asset?.id && (await fileStatus(upBook.body.asset.id, 'u-iryna')) === 200 && (await fileStatus(upOther.body.asset?.id, 'u-iryna')) === 404, `${upBook.status}/${upOther.status}`);
  t('…перекладачеві (медіатеку не надано) — 404', (await fileStatus(upBook.body.asset?.id, 'u-taras')) === 404);

  // ── (3) ────────────────────────────────────────────────────────────────────
  console.log('\n(3) Перекладач пише лише в розділі 1:');
  const { page: taras } = await open('u-taras', SHELL);
  await waitFor(async () => (await localBook(taras))?.accessRestricted === true);
  const bT = await localBook(taras);
  t('у перекладача — лише розділ 1 (дві сцени)', bT?.chapters?.map((c: any) => c.id).join() === 'chap-1' && bT.chapters[0].sections.length === 2, JSON.stringify(bT?.chapters?.map((c: any) => c.id)));
  await taras.evaluate(() => (document.querySelector('#nav-tab-editor') as HTMLElement | null)?.click());
  await sleep(1500);
  const editor = await taras.$('.ProseMirror[contenteditable="true"], [contenteditable="true"]');
  if (editor) {
    await editor.click();
    await taras.keyboard.press('End');
    await taras.keyboard.type(' ПЕРЕКЛАД-ТАРАСА');
  }
  t('редактор відкрито і набрано текст', !!editor);
  const reached = await waitFor(async () => JSON.stringify((await localBook(owner))?.chapters?.[0]?.sections ?? []).includes('ПЕРЕКЛАД-ТАРАСА'), 20000);
  t('правка перекладача дійшла до власниці', reached);
  const bO = await localBook(owner);
  t('у власниці решта книги на місці (розділ 2, герої, синопсис)', bO?.chapters?.length === 2 && bO.characters.length === FULL.characters.length && bO.synopsis === FULL.synopsis);

  // ── (4) ────────────────────────────────────────────────────────────────────
  console.log('\n(4) Бета-читач зі старим запрошенням:');
  const { page: reader } = await open('u-reader', SHELL);
  const gotR = await waitFor(async () => ((await localBook(reader))?.chapters?.length ?? 0) === 2);
  const bR = await localBook(reader);
  t('уся книга, як до Т6.2 (без позначки обмеження)', gotR && !bR?.accessRestricted && !(await reader.$('[data-access-restricted-banner]')));
  const legacy = await q(`SELECT g.level, g.source, g.source_ref FROM fusion_core.access_grants g JOIN fusion_core.project_participants p ON p.id=g.participant_id WHERE p.project_id=$1 AND p.user_id='u-reader'`, [BOOK]);
  t('запрошення перенесено в доступ на книгу: перегляд, джерело — запрошення', legacy.length === 1 && legacy[0].level === 'view' && legacy[0].source === 'legacy_invite' && legacy[0].source_ref === 'inv-old-reader', JSON.stringify(legacy));

  // ── (5) ────────────────────────────────────────────────────────────────────
  console.log('\n(5) Відкликання:');
  await openAccess(owner);
  const sceneId = (await q(`SELECT g.id FROM fusion_core.access_grants g WHERE g.project_id=$1 AND g.scope_type='scene' AND g.status='active'`, [BOOK]))[0]?.id;
  await owner.click(`[data-access-revoke="${sceneId}"]`);
  await owner.waitForFunction(() => /Відкликано/.test(document.querySelector('[data-access-notice]')?.textContent || ''), { timeout: 10000 }).catch(() => null);
  t('власниця відкликала сцену — повідомлення', /Відкликано/.test(await owner.$eval('[data-access-notice]', (e) => (e as HTMLElement).innerText).catch(() => '')));
  const gone = await waitFor(async () => ((await localBook(iryna))?.chapters?.length ?? -1) === 0, 20000);
  t('у ілюстраторки сцена зникла без перезавантаження (перепідключення 4409)', gone);
  const textAfter = await iryna.evaluate(() => document.body.innerText);
  t('…і тексту сцени 2.1 на сторінці вже немає', !textAfter.includes(SEC21.slice(0, 25)));
  await owner.click('[data-access-events-btn]');
  await owner.waitForSelector('[data-access-events]', { timeout: 10000 }).catch(() => null);
  await sleep(500);
  const evs = await owner.$$eval('[data-access-event]', (es) => es.map((e) => `${e.getAttribute('data-access-event')}: ${(e as HTMLElement).innerText.replace(/\n/g, ' ')}`));
  t('журнал: «Відкликано … Ірина» і надання', evs.some((e) => e.startsWith('access_revoked') && /Ірина/.test(e)) && evs.filter((e) => e.startsWith('access_granted')).length >= 4, evs.slice(0, 3).join(' | '));
  await owner.click('[data-access-events-btn]');

  // ── (6) ────────────────────────────────────────────────────────────────────
  console.log('\n(6) Телефон 390 px:');
  await owner.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await owner.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await owner.waitForSelector('#nav-tab-editor', { timeout: 40000 }).catch(() => null);
  await owner.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
    b?.click();
  });
  await sleep(500);
  await openAccess(owner);
  await sleep(500);
  const ph: any = await owner.evaluate(`(() => {
    const r = (sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b ? { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) } : null; };
    return { w: window.innerWidth, sw: document.documentElement.scrollWidth, tab: r('[data-collab-tab="access"]'), target: r('[data-access-scope]'), grant: r('[data-access-grant]'), revoke: r('[data-access-revoke]') };
  })()`);
  t('вкладка «Доступ», форма й кнопки вміщаються, без горизонтальної прокрутки',
    !!ph.tab && ph.tab.right <= ph.w && !!ph.grant && ph.grant.right <= ph.w && (ph.grant.width ?? 0) >= 200 && !!ph.target && ph.target.right <= ph.w && ph.sw <= ph.w + 1, JSON.stringify(ph));
  await owner.screenshot({ path: path.join(DIR, 'access-phone.png') });
  t('без помилок JavaScript на сторінках', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  child.kill();
  await db.end();
}
const serverErrs = log.join('').split('\n').filter((l) => /\bError\b|помилка маршруту/i.test(l) && !/SMTP|smtp|GEMINI|API key|ключ/i.test(l));
t('журнал сервера — без помилок', serverErrs.length === 0, serverErrs.slice(0, 3).join(' | '));
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
