/**
 * Живий прогін «Мого простору» й «Моєї ролі у проєкті» (Т6.4, `PLAN_ROLE_STUDIO.md`;
 * ТЗ Role Onboarding §15, §21–23; критерії №19–24, 26, 27). Запуск:
 * CORE_TEST_DATABASE_URL=postgres://… npm run live:role-studio (потрібен
 * зібраний dist/server.mjs і Chrome/Chromium; схема `fusion_core` у цій базі
 * видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер:
 *   (1) ілюстратор у чужій книзі: «Мій простір» ілюстратора, меню — розділи
 *       ролі нагорі, решта в згорнутому «Інше»; процес ШІ, частина книги;
 *   (2) «Запросити нову роль» → запит; роль і доступ без змін;
 *   (3) керівник у «Команді» → «Запити»: запит ролі схвалено без доступу;
 *       у ілюстратора дві ролі, перемикач простору — простір дизайнера;
 *   (4) підказка процесу ШІ в модулі; охорона ШІ: роль без доступу — 403;
 *   (5) відмова від ролі — доступ той самий; вихід із проєкту;
 *   (6) власниця: простір автора, меню повне, вибір простору;
 *   (7) телефон 390 px.
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
const DIR = path.join(os.tmpdir(), 'nova-live-role-studio');
const PORT = Number(process.env.ROLE_STUDIO_PORT || 34389);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'book-live-role-studio';
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
const waitFor = async <T,>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30000): Promise<T> => {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) { await sleep(400); v = await fn(); }
  return v;
};

const { initStore, saveUser, createSession } = await import('../server/store');
const { initialBookData } = await import('../src/data/initialBook');
await initStore();
const now = new Date().toISOString();
const TOK: Record<string, string> = {};
const people: [string, string, string][] = [['u-owner', 'writer', 'Олена Авторка'], ['u-ill', 'designer', 'Ілюстратор Іван'], ['u-mgr', 'writer', 'Менеджерка Марта'], ['u-pending', 'writer', 'Редактор у черзі'], ['u-phone', 'writer', 'Рецензентка']];
for (const [id, role, name] of people) {
  await saveUser({ id, email: `${id}@studio.test`, name, role, createdAt: now } as any);
  TOK[id] = crypto.randomBytes(24).toString('hex');
  await createSession({ token: TOK[id], userId: id, createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() });
}

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, ROLE_ONBOARDING: 'off', PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, APP_URL: BASE, SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' },
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
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any, wf: res.headers.get('x-nova-ai-workflow') };
};

const FULL: any = JSON.parse(JSON.stringify({ ...initialBookData, id: BOOK, title: 'Маяк', updatedAt: new Date(Date.now() - 60_000).toISOString() }));
const SCENE = String(FULL.chapters[0].sections[0].id);
await api('PUT', `/api/books/${BOOK}`, 'u-owner', { book: FULL });
await waitFor(() => q(`SELECT id FROM fusion_core.projects WHERE id = $1`, [BOOK]), (r) => r.length === 1, 40000);
const P = `/api/core/projects/${BOOK}`;
const assign = (userId: string, roleId: string, specialization?: string) => api('POST', `${P}/participants/roles`, 'u-owner', { userId, roleId, specialization });
const grant = (userId: string, level: string, scopeType: string, scopeRef?: string) => api('POST', `${P}/access`, 'u-owner', { userId, level, scopeType, scopeRef });
await assign('u-ill', 'illustrator');
await grant('u-ill', 'review', 'scene', SCENE);
await assign('u-mgr', 'book_manager');
await grant('u-mgr', 'manage', 'book');
await assign('u-pending', 'editor');
await assign('u-phone', 'reviewer');
await grant('u-phone', 'view', 'book');

const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [process.env.CHROMIUM_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors: string[] = [];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
const SEED = `(async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('nova_studio', 1);
    req.onupgradeneeded = () => { const d = req.result; for (const s of ['books', 'meta', 'snapshots']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' }); };
    req.onsuccess = () => { const tx = req.result.transaction(['books', 'meta'], 'readwrite'); tx.objectStore('books').put({ id: ${JSON.stringify(BOOK)}, data: ${JSON.stringify(FULL)}, updatedAt: new Date().toISOString() }); tx.objectStore('meta').put({ key: 'active_book_id', value: ${JSON.stringify(BOOK)} }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); };
    req.onerror = () => reject(req.error);
  });
})()`;
/** Відкрити Студію людини з книгою BOOK як активною й перейти на сторінку. */
const openAs = async (uid: string, tab = 'my-space', viewport = { width: 1440, height: 1000 }) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await ctx.setCookie({ name: 'nova_session', value: TOK[uid], domain: 'localhost', path: '/' });
  page.on('pageerror', (e) => errors.push(`${uid}: ${String(e)}`));
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#nav-tab-my-space', { timeout: 40000 });
  await page.evaluate(SEED);
  await page.goto(`${BASE}/projects/${BOOK}/${tab}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#nav-tab-my-space', { timeout: 40000 });
  return { ctx, page };
};
const click = async (page: Page, sel: string, wait = 500) => {
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
  await sleep(wait);
};
const text = (page: Page, sel: string) => page.$eval(sel, (e) => (e as HTMLElement).innerText).catch(() => '');
const attr = (page: Page, sel: string, a: string) => page.$eval(sel, (e, n) => e.getAttribute(n as string), a).catch(() => null);
const effOf = async (uid: string) => JSON.stringify((await api('GET', `${P}/access`, uid)).body.me?.effective ?? null);

try {
  console.log('(1) Ілюстратор у чужій книзі: «Мій простір» і меню (§15, №19):');
  const illEff0 = await effOf('u-ill');
  {
    const { ctx, page } = await openAs('u-ill');
    await page.waitForSelector('[data-my-space="illustrator"]', { timeout: 30000 }).catch(() => null);
    t('«Мій простір» — простір ілюстратора', (await text(page, '[data-my-space-title]')) === 'Простір ілюстратора');
    t('розділи простору: ілюстрації — головне, візуальна бібліотека, персонажі, медіатека', (await page.$$eval('[data-my-space-tab]', (els) => els.map((e) => e.getAttribute('data-my-space-tab')).join())) === 'illustrations,core-visual,characters,media');
    t('«з’явиться пізніше»: призначені завдання, результати (Т7)', (await page.$$('[data-my-space-later]')).length === 2);
    await page.waitForSelector('[data-nav-focus="on"]', { timeout: 15000 }).catch(() => null);
    t('меню: розділи ролі нагорі', (await attr(page, '[data-nav-focus]', 'data-nav-focus')) === 'on' && !!(await page.$('[data-nav-focus] #nav-tab-illustrations')));
    t('решта груп — у згорнутому «Інше»', (await attr(page, '[data-nav-others]', 'data-nav-others')) === 'closed' && !(await page.$('#nav-tab-cover')));
    await click(page, '[data-nav-others]');
    t('«Інше» розкривається — решта розділів доступна', !!(await page.$('#nav-tab-cover')));
    await page.waitForSelector('[data-my-space-ai="illustration"]', { timeout: 15000 }).catch(() => null);
    const ai = await text(page, '[data-my-space-ai]');
    t('процес ШІ — ілюстратора, лише частина проєкту (№21)', /Процес ілюстратора/.test(ai) && /частину проєкту/.test(ai), ai.replace(/\n/g, ' | ').slice(0, 200));
    t('запропоновані дії й фокус Jev', (await page.$$('[data-my-space-suggestion]')).length >= 3 && (await page.$$('[data-my-space-focus-item]')).length >= 2);
    await page.waitForFunction(`!/…/.test(document.querySelector('[data-my-space-access]')?.innerText || '…')`, { timeout: 10000 }).catch(() => null);
    t('мій доступ — обмежений: одна сцена', /Обмежений доступ — сцен: 1/.test(await text(page, '[data-my-space-access]')));
    t('власник у «Моїй ролі»: ілюстратор, кнопки відмови немає (остання роль)', !!(await page.$('[data-my-role-item="illustrator"]')) && !(await page.$('[data-my-role-remove]')));
    await page.screenshot({ path: path.join(DIR, 'my-space-illustrator.png'), fullPage: true });

    console.log('(2) «Запросити нову роль» — запит, права без змін (§23, №23, №24):');
    await page.select('[data-my-role-add-role]', 'designer');
    await page.type('[data-my-role-add-message]', 'Зроблю й обкладинку');
    await click(page, '[data-my-role-add-submit]', 1200);
    t('повідомлення: запит надіслано, доступ не змінився', /Запит ролі надіслано/.test(await text(page, '[data-my-role-notice]')));
    t('запит чекає рішення — видно в «Моїй ролі»', !!(await page.$('[data-my-role-pending]')) && /Дизайнер/.test(await text(page, '[data-my-role-pending]')));
    t('роль поки одна, доступ той самий', (await page.$$('[data-my-role-item]')).length === 1 && (await effOf('u-ill')) === illEff0);
    await ctx.close();
  }

  console.log('(3) Керівник: «Команда» → «Запити» — запит ролі (рішення §2 п.2):');
  {
    const { ctx, page } = await openAs('u-mgr', 'editor');
    await page.waitForSelector('#collab-team-drawer-btn', { timeout: 40000 });
    await click(page, '#collab-team-drawer-btn', 800);
    await click(page, '[data-collab-tab="access"]', 800);
    await page.waitForSelector('[data-access-request-kind="role"]', { timeout: 20000 }).catch(() => null);
    const card = await text(page, '[data-access-request-kind="role"]');
    t('запит ролі в «Запитах»: людина, роль, без нового доступу, повідомлення', /Ілюстратор Іван/.test(card) && /запит ролі/.test(card) && /Дизайнер/.test(card) && /без нового доступу/.test(card) && /обкладинку/.test(card), card.replace(/\n/g, ' | ').slice(0, 300));
    await click(page, '[data-access-request-kind="role"] [data-access-request-approve]', 1500);
    await page.waitForSelector('[data-access-request-done="approved"]', { timeout: 15000 }).catch(() => null);
    t('схвалено — у журналі рішень', /роль Дизайнер/.test(await text(page, '[data-access-request-done="approved"]')));
    const roles = await q(`SELECT role_id FROM fusion_core.participant_roles WHERE project_id = $1 AND status = 'active' AND participant_id IN (SELECT id FROM fusion_core.project_participants WHERE user_id = 'u-ill') ORDER BY role_id`, [BOOK]);
    t('у ілюстратора дві ролі', roles.map((r: any) => r.role_id).join() === 'designer,illustrator');
    t('доступ той самий — роль прав не дала (№24)', (await effOf('u-ill')) === illEff0);
    await ctx.close();
  }

  console.log('(4) Перемикач простору, підказка ШІ, охорона (№19, 21, 22):');
  {
    const { ctx, page } = await openAs('u-ill');
    await page.waitForSelector('[data-my-space-switch]', { timeout: 30000 }).catch(() => null);
    await click(page, '[data-my-space-ws="designer"]', 1500);
    await page.waitForSelector('[data-my-space="designer"]', { timeout: 15000 }).catch(() => null);
    t('простір дизайнера обрано', (await text(page, '[data-my-space-title]')) === 'Простір дизайнера');
    await page.waitForFunction(`!!document.querySelector('[data-nav-focus] #nav-tab-cover')`, { timeout: 15000 }).catch(() => null);
    t('меню слідує за простором: обкладинка нагорі', !!(await page.$('[data-nav-focus] #nav-tab-cover')));
    t('вибір збережено на сервері', (await q(`SELECT workspace FROM fusion_core.participant_preferences WHERE user_id = 'u-ill' AND project_id = $1`, [BOOK]))[0]?.workspace === 'designer');
    await click(page, '[data-nav-focus] #nav-tab-cover', 1500);
    await page.waitForSelector('[data-ai-workflow]', { timeout: 15000 }).catch(() => null);
    t('у модулі «Обкладинка» — підказка: дизайнерський процес, ваш процес', (await attr(page, '[data-ai-workflow]', 'data-ai-workflow')) === 'design' && (await attr(page, '[data-ai-workflow]', 'data-ai-fit')) === 'primary');
    const r = await api('GET', `${P}/ai-route?task=character_visual`, 'u-ill');
    t('образ персонажа — процес ілюстратора: основне там важливіше за суміжне в обраному просторі', r.body.route?.workflow === 'illustration' && r.body.route.fit === 'primary');
    const g = await api('POST', '/api/ai/edit-text', 'u-pending', { bookId: BOOK, text: 'Привіт', instruction: 'x' });
    t('роль без доступу — ШІ з книгою не працює: 403 no_project_access', g.status === 403 && g.body.kind === 'no_project_access');
    const o = await api('GET', `${P}/ai-route?task=chat`, 'u-owner');
    t('власниця — письменницький процес, увесь проєкт', o.body.route?.workflow === 'writer' && o.body.route.scope === 'project');
    await ctx.close();
  }

  console.log('(5) Відмова від ролі й вихід із проєкту (рішення §2 п.3):');
  {
    const { ctx, page } = await openAs('u-ill');
    await page.waitForSelector('[data-my-role-remove="designer"]', { timeout: 30000 }).catch(() => null);
    await click(page, '[data-my-role-remove="designer"]', 1500);
    t('роль дизайнера знято — повідомлення про доступ', /Доступ лишився/.test(await text(page, '[data-my-role-notice]')) && !(await page.$('[data-my-role-item="designer"]')));
    t('доступ той самий', (await effOf('u-ill')) === illEff0);
    const notes = await q(`SELECT message FROM fusion_core.core_notifications WHERE project_id = $1 AND message LIKE '%відмовився%'`, [BOOK]);
    t('керівникам — сповіщення', notes.length === 1);
    await page.waitForSelector('[data-my-space="illustrator"]', { timeout: 15000 }).catch(() => null);
    t('простір повернувся до ілюстратора', (await text(page, '[data-my-space-title]')) === 'Простір ілюстратора');
    await click(page, '[data-my-role-leave]', 300);
    await click(page, '[data-my-role-leave-confirm]', 2000);
    await page.waitForSelector('[data-my-space="left"]', { timeout: 15000 }).catch(() => null);
    t('вийшов із проєкту', !!(await page.$('[data-my-space="left"]')));
    t('після виходу — ні ролей, ні доступу', (await api('GET', `${P}/my-role`, 'u-ill')).status === 403 && (await q(`SELECT status FROM fusion_core.project_participants WHERE project_id = $1 AND user_id = 'u-ill'`, [BOOK]))[0]?.status === 'left');
    const ev = await q(`SELECT action, details FROM fusion_core.collab_events WHERE project_id = $1 ORDER BY created_at`, [BOOK]);
    t('аудит: запит і рішення ролі, відкликання, вихід (№27)', ev.some((e: any) => e.action === 'access_requested' && e.details.kind === 'role') && ev.some((e: any) => e.action === 'access_request_decided' && e.details.kind === 'role') && ev.some((e: any) => e.action === 'participant_status' && e.details.status === 'left'));
    await ctx.close();
  }

  console.log('(6) Власниця: простір автора, меню повне:');
  {
    const { ctx, page } = await openAs('u-owner');
    await page.waitForSelector('[data-my-space="author"]', { timeout: 30000 }).catch(() => null);
    t('простір автора', (await text(page, '[data-my-space-title]')) === 'Простір автора');
    t('меню власниці — повне (акцент лише для учасників)', (await attr(page, '[data-nav-focus]', 'data-nav-focus')) === 'off' && !!(await page.$('#nav-tab-dashboard')) && !!(await page.$('#nav-tab-core-story-graph')) && !(await page.$('[data-nav-others]')));
    t('власниці доступні всі простори', (await page.$$('[data-my-space-ws]')).length === 8);
    await page.select('[data-my-role-add-role]', 'book_designer');
    await click(page, '[data-my-role-add-submit]', 1500);
    t('власниця додає роль одразу', /Роль додано/.test(await text(page, '[data-my-role-notice]')) && !!(await page.$('[data-my-role-item="book_designer"]')));
    await ctx.close();
  }

  console.log('(7) Телефон 390 px (№26):');
  {
    const { ctx, page } = await openAs('u-phone', 'my-space', { width: 390, height: 844 });
    await page.waitForSelector('[data-my-space="reviewer"]', { timeout: 30000 }).catch(() => null);
    t('рецензентка: простір рецензента', (await text(page, '[data-my-space-title]')) === 'Простір рецензента');
    const overflow = await page.evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
    t('«Мій простір» на 390 px без горизонтальної прокрутки', Number(overflow) <= 1, `надлишок ${overflow}px`);
    await page.screenshot({ path: path.join(DIR, 'my-space-phone.png'), fullPage: true });
    await ctx.close();
  }
  t('канон твору без людей (№29)', (await q(`SELECT 1 FROM fusion_core.entities WHERE name IN ('Ілюстратор Іван', 'Менеджерка Марта', 'Рецензентка')`)).length === 0);
  t('без помилок сторінки', errors.length === 0, errors.join(' | '));
} catch (err) {
  t('прогін без збоїв', false, (err as Error).stack ?? String(err));
} finally {
  await browser.close();
  child.kill();
  await db.end();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
