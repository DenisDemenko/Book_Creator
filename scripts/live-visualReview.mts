/**
 * Живий прогін «перевірити» після зміни опису — Т2.3 В5 (журнал #263).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:visual-review
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер. Шлях автора: Медіатека → повний
 * зріст Олени (звірено одразу) → у картці героя змінилось волосся
 * (збереження книги → синхронізація ядра) → КРИТЕРІЙ: зображення Олени з
 * позначкою «перевірити» в Медіатеці (значок на картці, фільтр, чип у вікні
 * файлу) і в профілі героя; сповіщення ядра; «Звірено» знімає позначку; опис
 * версії зовнішності змінено у профілі — портрет версії «перевірити»;
 * чужий — 403; телефон.
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
const DIR = path.join(os.tmpdir(), 'nova-visual-review');
const PORT = Number(process.env.REVIEW_PORT || 34263);
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
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const waitFor = async <T,>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 40000): Promise<T> => {
  let v = await fn();
  for (let i = 0; i < ms / 1000 && !ok(v); i++) {
    await sleep(1000);
    v = await fn();
  }
  return v;
};

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-admin', email: 'admin-search@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
await saveUser({ id: 'u-x', email: 'x@test.ua', name: 'Чужий', role: 'writer', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
const TOKEN_X = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });
await createSession({ token: TOKEN_X, userId: 'u-x', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const { saveAsset } = await import('../server/media/mediaLibraryStore');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const kid = await saveAsset({ ownerId: 'u-admin', bookId: 'BK-2084-CYBER', kind: 'character_art', filename: 'olena-full.png', mimeType: 'image/png', bytes: PNG });

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, GEMINI_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '' },
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
const schema = (log.join('').match(/схема v(\d+)/) ?? [])[1];
t('ядро піднялось, схема ≥ v11', Number(schema) >= 11, `v${schema}`);

const api = async (method: string, p: string, body?: unknown, token = TOKEN) => {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Cookie: `nova_session=${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

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
await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
page.on('dialog', (d) => { void d.accept(); });

console.log('\nПідготовка:');
await page.goto(`${BASE}/projects/${BOOK}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 40000 });
await sleep(1500);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button,a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
const first = await page.$('#book-content-editor-ua .ProseMirror > *');
await first!.click();
await page.keyboard.press('End');
await page.keyboard.type(' ');
await page.keyboard.press('Backspace');
const [olena] = await waitFor(() => q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Олена Ковальчук'`, [BOOK]), (r) => r.length === 1);
const legacy = await waitFor(
  () => q(`SELECT id, asset_url, checked_hash, needs_review FROM fusion_core.asset_entity_links WHERE project_id = $1 AND entity_id = $2 AND source = 'legacy' AND role = 'portrait'`, [BOOK, olena.id]),
  (r) => r.length === 1 && !!r[0].checked_hash,
);
const cardUrl = legacy[0]?.asset_url as string;
t('портрет з картки перенесено й звірено з поточним описом', !!legacy[0]?.checked_hash && legacy[0]?.needs_review === false, cardUrl);

console.log('\nМедіатека — повний зріст:');
await page.click('#nav-tab-media');
const openCard = async (url: string) => {
  await page.waitForFunction((u: string) => Array.from(document.querySelectorAll('[data-tour="media__3"] img')).some((i) => i.getAttribute('src') === u), { timeout: 20000 }, url);
  await page.evaluate((u: string) => {
    const img = Array.from(document.querySelectorAll('[data-tour="media__3"] img')).find((i) => i.getAttribute('src') === u);
    (img?.parentElement as HTMLElement | null)?.click();
  }, url);
  await page.waitForSelector('[data-media-links] [data-media-link-add]', { timeout: 10000 });
};
await openCard(kid.url);
await page.click('[data-media-link-add]');
await page.waitForFunction(() => (document.querySelector('[data-media-link-target]') as HTMLSelectElement | null)?.options.length! > 1, { timeout: 10000 });
await page.select('[data-media-link-role]', 'full_body');
await sleep(200);
await page.select('[data-media-link-target]', olena.id);
await page.click('[data-media-link-save]');
const full = (await waitFor(() => q(`SELECT id, checked_hash, needs_review FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2`, [BOOK, kid.url]), (r) => r.length === 1, 10000))[0];
t('прив\'язано автором — звірено одразу (відбиток як у портрета з картки)', full?.checked_hash === legacy[0].checked_hash && full?.needs_review === false, JSON.stringify(full));
await page.evaluate(() => (document.querySelector('[data-media-lightbox]') as HTMLElement | null)?.click());
await sleep(400);

console.log('\nКартка героя змінилась:');
const stored = await api('GET', `/api/books/${BOOK}`);
const book = stored.body.book;
const ch = book.characters.find((c: any) => c.name === 'Олена');
ch.appearance.hair = 'Довге чорне волосся, заплетене в косу';
const put = await api('PUT', `/api/books/${BOOK}`, { book, expectedRevision: stored.body.revision });
t('книгу збережено з новим волоссям Олени', put.status === 200, JSON.stringify(put.body).slice(0, 120));
const flagged = await waitFor(
  () => q(`SELECT asset_url FROM fusion_core.asset_entity_links WHERE project_id = $1 AND entity_id = $2 AND needs_review`, [BOOK, olena.id]),
  (r) => r.length === 2,
);
t('КРИТЕРІЙ: після синхронізації — обидва зображення Олени «перевірити»', flagged.length === 2, JSON.stringify(flagged));
const notes = await q(`SELECT message, payload FROM fusion_core.core_notifications WHERE project_id = $1 AND kind = 'visual_needs_review'`, [BOOK]);
t('сповіщення ядра: «Опис зовнішності «Олена Ковальчук» змінився — перевірте зображення: 2»', notes.length === 1 && /Олена Ковальчук/.test(notes[0].message) && /: 2$/.test(notes[0].message), notes[0]?.message);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#nav-tab-media', { timeout: 40000 });
await page.click('#nav-tab-media');
const badge = await waitFor(() => page.evaluate((u: string) => {
  const img = Array.from(document.querySelectorAll('[data-tour="media__3"] img')).find((i) => i.getAttribute('src') === u);
  return !!img?.parentElement?.querySelector('[data-media-review-badge]');
}, kid.url), (v) => v, 20000);
t('Медіатека: на картці файлу — «⚠ перевірити»', badge);
await page.waitForSelector('[data-media-entity-filter] option[value="review"]', { timeout: 10000 });
await page.select('[data-media-entity-filter]', 'review');
await sleep(400);
const onlyReview = await page.evaluate(() => Array.from(document.querySelectorAll('[data-tour="media__3"] img')).map((i) => i.getAttribute('src')));
t('фільтр «⚠ Перевірити» — лише зображення з позначкою', onlyReview.includes(kid.url) && onlyReview.every((u) => u === kid.url || u === cardUrl), JSON.stringify(onlyReview));
await page.screenshot({ path: path.join(DIR, 'review-media.png') });
await page.select('[data-media-entity-filter]', '');
await openCard(kid.url);
await page.waitForSelector('[data-media-link-review]', { timeout: 10000 });
await page.click('[data-media-link-checked]');
await waitFor(() => q(`SELECT needs_review FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2`, [BOOK, kid.url]), (r) => r[0]?.needs_review === false, 10000);
const after = (await q(`SELECT needs_review, checked_hash FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2`, [BOOK, kid.url]))[0];
t('«Звірено» у вікні файлу — позначку знято, відбиток новий', after.needs_review === false && after.checked_hash !== full.checked_hash);
await page.evaluate(() => (document.querySelector('[data-media-lightbox]') as HTMLElement | null)?.click());

console.log('\nПрофіль героя:');
await page.goto(`${BASE}/projects/${BOOK}/characters/${olena.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-av-review]', { timeout: 40000 });
const block = await page.evaluate(() => ({ n: document.querySelector('[data-av-review]')?.getAttribute('data-av-review'), badge: !!document.querySelector('[data-av-base] [data-av-review-badge]') }));
t('КРИТЕРІЙ: у профілі — «Перевірити після зміни опису: 1» і позначка на портреті з картки', block.n === '1' && block.badge, JSON.stringify(block));
await page.screenshot({ path: path.join(DIR, 'review-profile.png') });
await page.click('[data-av-review-done]');
await waitFor(() => q(`SELECT needs_review FROM fusion_core.asset_entity_links WHERE id = $1`, [legacy[0].id]), (r) => r[0]?.needs_review === false, 10000);
await waitFor(() => page.evaluate(() => !document.querySelector('[data-av-review]')), (v) => v, 10000);
t('«Звірено» в профілі — позначку знято, блок зник', !(await page.$('[data-av-review]')));

console.log('\nОпис версії зовнішності:');
const v = await api('POST', `/api/projects/${BOOK}/visual/appearance/${olena.id}`, { label: 'Студентка', fromChapter: 1, toChapter: 1, description: 'Коротке волосся' });
await api('PUT', `/api/projects/${BOOK}/visual/appearance/${olena.id}/versions/${v.body.version.id}/portrait`, { assetUrl: kid.url });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-av-version="Студентка"] [data-av-edit]', { timeout: 40000 });
await page.click('[data-av-version="Студентка"] [data-av-edit]');
await page.waitForSelector('[data-av-description]');
await page.click('[data-av-description]', { clickCount: 3 });
await page.keyboard.press('Backspace');
await page.type('[data-av-description]', 'Коротке фіолетове волосся, окуляри');
await page.click('[data-av-save]');
await waitFor(() => q(`SELECT needs_review FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2`, [BOOK, kid.url]), (r) => r[0]?.needs_review === true, 10000);
const vb = await waitFor(() => page.evaluate(() => !!document.querySelector('[data-av-version="Студентка"] [data-av-review-badge]')), (x) => x, 10000);
t('КРИТЕРІЙ: опис версії змінено в профілі — її портрет «перевірити» (позначка на картці версії)', vb);
const n2 = await q(`SELECT message FROM fusion_core.core_notifications WHERE project_id = $1 AND kind = 'visual_needs_review' ORDER BY created_at DESC LIMIT 1`, [BOOK]);
t('сповіщення з назвою версії', /Студентка/.test(n2[0]?.message ?? ''), n2[0]?.message);
t('чужому «Звірено» — 403', (await api('POST', `/api/projects/${BOOK}/visual/links/${full.id}/checked`, {}, TOKEN_X)).status === 403);

await page.setViewport({ width: 390, height: 844 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-av-review]', { timeout: 40000 });
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
await sleep(1000);
const mm = await page.evaluate(() => {
  const box = document.querySelector('[data-appearance-versions]') as HTMLElement;
  const r = box.getBoundingClientRect();
  return { right: Math.round(r.right), vw: window.innerWidth, scroll: box.scrollWidth, client: box.clientWidth, page: document.documentElement.scrollWidth };
});
t('телефон: блок «перевірити» в межах екрана, без горизонтальної прокрутки', mm.right <= mm.vw && mm.scroll <= mm.client + 1 && mm.page <= mm.vw + 1 && mm.client >= 220, JSON.stringify(mm));
await page.screenshot({ path: path.join(DIR, 'review-phone.png') });
console.log(`  (знімки: ${DIR}/review-media.png, review-profile.png, review-phone.png)`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
