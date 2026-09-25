/**
 * Живий прогін адрес сторінок і API проєкту (Т0.8, журнал #251).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:project-routes
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер: адреса кожної сторінки
 * відкривається напряму; перехід меню змінює адресу; «назад» повертає
 * попередню сторінку; профіль героя має власну адресу й переживає
 * перезавантаження; сторінка показує дані ядра книги; чужий користувач
 * отримує 403 і на API, і на сторінці.
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
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL (PostgreSQL з pgvector).');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-project-routes');
const PORT = Number(process.env.PROJECT_ROUTES_PORT || 34251);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'BK-2084-CYBER';
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

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
const session = async (id: string) => {
  await saveUser({ id, email: `${id}@test.ua`, name: id, role: 'writer', createdAt: new Date().toISOString() } as any);
  const token = crypto.randomBytes(24).toString('hex');
  await createSession({ token, userId: id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });
  return token;
};
const OWNER = await session('u-owner');
const STRANGER = await session('u-stranger');

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL },
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

const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
await browser.setCookie({ name: 'nova_session', value: OWNER, domain: 'localhost', path: '/' });
// Редактор питає «піти зі сторінки?» при незбереженому — у прогоні погоджуємось.
page.on('dialog', (d) => { void d.accept(); });
const pathNow = () => page.evaluate(() => window.location.pathname);
const corePage = () => page.evaluate(() => document.querySelector('[data-core-page]')?.getAttribute('data-core-page') ?? null);
const waitCore = async (seg: string) => {
  for (let i = 0; i < 40; i++) {
    if ((await corePage()) === seg) return true;
    await sleep(250);
  }
  return false;
};
const dismissTour = () => page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button,a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
const clickNav = (label: string) => page.evaluate((l: string) => {
  const b = Array.from(document.querySelectorAll('nav button, aside button, button')).find((e) => e.getAttribute('title') === l) as HTMLElement | undefined;
  b?.scrollIntoView();
  b?.click();
  return !!b;
}, label);

console.log('\nАдреса з кореня:');
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
await sleep(1500);
await dismissTour();
t('корінь уточнюється до /projects/<книга>/<вкладка>', new RegExp(`^/projects/${BOOK}/[a-z-]+$`).test(await pathNow()), await pathNow());

// Книга потрапляє на сервер і в ядро (Т0.6) після збереження — легка правка в редакторі.
await page.click('#nav-tab-editor');
await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 30000 });
await sleep(800);
t('вкладка «Книга & Текст» — /editor', (await pathNow()) === `/projects/${BOOK}/editor`);
const first = await page.$('#book-content-editor-ua .ProseMirror > *');
await first!.click();
await page.keyboard.press('End');
await page.keyboard.type(' ');
await page.keyboard.press('Backspace');
for (let i = 0; i < 40; i++) {
  const n = (await db.query(`SELECT count(*)::int AS n FROM fusion_core.paragraphs WHERE project_id = $1`, [BOOK]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
  if (n > 3) break;
  await sleep(1000);
}

console.log('\nПряме відкриття сторінок ядра:');
await page.goto(`${BASE}/projects/${BOOK}/story-graph`, { waitUntil: 'domcontentloaded' });
t('/story-graph відкривається напряму', await waitCore('story-graph'));
await sleep(1200);
const summaryText = await page.evaluate(() => document.querySelector('[data-core-summary]')?.textContent ?? '');
t('сторінка показує дані ядра книги', /Абзаців/.test(summaryText) && /(\d+)Абзаців/.test(summaryText.replace(/\s+/g, '')) && !/ще не синхронізовано/.test(summaryText), summaryText.slice(0, 120));
const navCount = await page.evaluate(() =>
  ['Розумний пошук', 'Граф історії', 'Профіль персонажа', 'Емоційна аналітика', 'Гілки сценарію', 'Хронологія історії', 'Візуальна бібліотека',
    'Безперервність', 'Майстерність письменника', 'Спільна робота', 'Контекстний переклад']
    .filter((l) => Array.from(document.querySelectorAll('button')).some((b) => b.getAttribute('title') === l)).length);
t('11 сторінок у меню («Семантичне ядро»)', navCount === 11, `${navCount}`);
for (const seg of ['search', 'emotions', 'scenario-branches', 'timeline', 'visual-library', 'continuity', 'writer-mastery', 'collaboration', 'translation']) {
  await page.goto(`${BASE}/projects/${BOOK}/${seg}`, { waitUntil: 'domcontentloaded' });
  if (!(await waitCore(seg))) { t(`/${seg} відкривається напряму`, false); }
}
t('решта 9 сторінок відкриваються напряму', true);

console.log('\nМеню й кнопка «назад»:');
await page.goto(`${BASE}/projects/${BOOK}/story-graph`, { waitUntil: 'domcontentloaded' });
await waitCore('story-graph');
await sleep(800);
await clickNav('Хронологія історії');
t('пункт меню змінює адресу', (await waitCore('timeline')) && (await pathNow()) === `/projects/${BOOK}/timeline`, await pathNow());
await page.click('#nav-tab-editor');
await sleep(800);
t('звичайна вкладка — теж адреса', (await pathNow()) === `/projects/${BOOK}/editor`);
await page.goBack();
t('«назад» — знову хронологія', (await waitCore('timeline')) && (await pathNow()) === `/projects/${BOOK}/timeline`);
await page.goBack();
t('ще «назад» — граф історії', (await waitCore('story-graph')) && (await pathNow()) === `/projects/${BOOK}/story-graph`);
await page.goForward();
t('«вперед» — хронологія', await waitCore('timeline'));

console.log('\nПрофіль персонажа:');
await page.goto(`${BASE}/projects/${BOOK}/character-profile`, { waitUntil: 'domcontentloaded' });
await waitCore('character-profile');
await page.waitForSelector('[data-core-characters] button', { timeout: 15000 }).catch(() => null);
const heroes = await page.evaluate(() => Array.from(document.querySelectorAll('[data-core-characters] button')).map((b) => b.textContent));
t('список героїв книги з ядра', heroes.length > 0, heroes.slice(0, 3).join(' | '));
await page.evaluate(() => (document.querySelector('[data-core-characters] button') as HTMLElement)?.click());
await page.waitForSelector('[data-character-profile]', { timeout: 15000 }).catch(() => null);
const heroPath = await pathNow();
const heroId = await page.evaluate(() => document.querySelector('[data-character-profile]')?.getAttribute('data-character-profile'));
t('картка героя — адреса /characters/:id (як у ТЗ)', !!heroId && heroPath === `/projects/${BOOK}/characters/${heroId}`, heroPath);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-character-profile]', { timeout: 20000 }).catch(() => null);
t('картка героя переживає перезавантаження', (await page.evaluate(() => document.querySelector('[data-character-profile]')?.getAttribute('data-character-profile'))) === heroId);
await page.goBack();
await page.waitForSelector('[data-core-characters]', { timeout: 15000 }).catch(() => null);
t('«назад» — знову список героїв', (await pathNow()) === `/projects/${BOOK}/character-profile` && !!(await page.$('[data-core-characters]')));

console.log('\nПеремикання книги й адреса:');
// Так «Мої книги» перемикають книгу: активна книга змінюється, сторінка перезавантажується.
await page.evaluate(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('nova_studio', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['books', 'meta'], 'readwrite');
      const books = tx.objectStore('books');
      const get = books.get('BK-2084-CYBER');
      get.onsuccess = () => {
        const copy = JSON.parse(JSON.stringify(get.result));
        copy.id = 'BK-SECOND';
        copy.data = { ...copy.data, id: 'BK-SECOND', title: 'Друга книга' };
        books.put(copy);
        tx.objectStore('meta').put({ key: 'active_book_id', value: 'BK-SECOND' });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
await sleep(1500);
t('після перемикання книги адреса веде на нову книгу', (await pathNow()).startsWith('/projects/BK-SECOND/'), await pathNow());
await page.goto(`${BASE}/projects/${BOOK}/timeline`, { waitUntil: 'domcontentloaded' });
t('пряма адреса першої книги відкриває саме її', (await waitCore('timeline')) && (await pathNow()) === `/projects/${BOOK}/timeline`);
const activeTitle = await page.evaluate(() => document.body.innerText.includes('Друга книга'));
t('і це справді перша книга, а не друга', !activeTitle);

console.log('\nЧужий користувач:');
const api = await fetch(`${BASE}/api/projects/${BOOK}/entities`, { headers: { Cookie: `nova_session=${STRANGER}` } });
t('API чужого проєкту — 403 (Т0.8)', api.status === 403);
const guestApi = await fetch(`${BASE}/api/projects/${BOOK}/summary`);
t('гість — 401', guestApi.status === 401);
const ctx = await browser.createBrowserContext();
const p2 = await ctx.newPage();
await p2.setViewport({ width: 1500, height: 950 });
await ctx.setCookie({ name: 'nova_session', value: STRANGER, domain: 'localhost', path: '/' });
await p2.goto(`${BASE}/projects/${BOOK}/search`, { waitUntil: 'domcontentloaded' });
await p2.waitForSelector('[data-core-problem]', { timeout: 30000 }).catch(() => null);
t('сторінка в чужого — пояснення про доступ, без даних', (await p2.evaluate(() => document.querySelector('[data-core-problem]')?.getAttribute('data-core-problem'))) === '403');
await page.screenshot({ path: path.join(DIR, 'core-page.png') });
console.log(`  (знімок: ${path.join(DIR, 'core-page.png')})`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2000)); process.exit(1); }
