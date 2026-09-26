/**
 * Живий прогін прив'язки зображень до сутностей — Т2.3 В2 (журнал #261).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:visual-links
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер. Шлях автора: синхронізація книги
 * переносить портрети героїв з карток (зв'язки «з книги»); Медіатека →
 * відкрити файл → «Прив'язки до книги» → портрет Олени → КРИТЕРІЙ: портрет
 * у профілі героя і в «Хто в сцені» редактора; ілюстрація сцени — у тому ж
 * блоці; фільтр «Сутність»; відв'язати — профіль повертається до портрета з
 * картки; чужий — 403; телефон.
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
const DIR = path.join(os.tmpdir(), 'nova-visual-links');
const PORT = Number(process.env.VISUAL_PORT || 34261);
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
const portrait = await saveAsset({ ownerId: 'u-admin', bookId: 'BK-2084-CYBER', kind: 'character_art', filename: 'olena-portrait.png', mimeType: 'image/png', bytes: PNG });
const sceneArt = await saveAsset({ ownerId: 'u-admin', bookId: 'BK-2084-CYBER', kind: 'illustration', filename: 'tunnel-scene.png', mimeType: 'image/png', bytes: PNG });

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
t('ядро піднялось, схема ≥ v10 (зв\'язки зображень)', Number(schema) >= 10, `v${schema}`);

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
const sections = await waitFor(
  () => q(`SELECT id FROM fusion_core.documents WHERE project_id = $1 AND kind = 'section' AND deleted_at IS NULL`, [BOOK]),
  (rows) => rows.length >= 3,
);
t('сцени книги — у ядрі', sections.length >= 3, `${sections.length}`);
const [olena] = await q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Олена Ковальчук'`, [BOOK]);
const legacy = await waitFor(() => q(`SELECT entity_id, asset_url FROM fusion_core.asset_entity_links WHERE project_id = $1 AND source = 'legacy' AND role = 'portrait'`, [BOOK]), (r) => r.length >= 1);
t('синхронізація перенесла портрети героїв із карток (зв\'язки «з книги»)', legacy.length >= 1 && legacy.some((l) => l.entity_id === olena.id && /unsplash/.test(l.asset_url)), `${legacy.length}`);
// Олена — у першому розділі (тег у ядрі, як його ставить синхронізація).
const [pA] = await q(`SELECT id FROM fusion_core.paragraphs WHERE project_id = $1 AND document_id = 'sec-1-1' AND deleted_at IS NULL ORDER BY ord LIMIT 1 OFFSET 1`, [BOOK]);
await q(`INSERT INTO fusion_core.entity_mentions (project_id, entity_id, paragraph_id, span_start, span_end, source, status) VALUES ($1, $2, $3, 0, 1, 'tag', 'confirmed')`, [BOOK, olena.id, pA.id]);

const openCard = async (url: string) => {
  await page.waitForFunction((u: string) => Array.from(document.querySelectorAll('[data-tour="media__3"] img')).some((i) => i.getAttribute('src') === u), { timeout: 20000 }, url);
  await page.evaluate((u: string) => {
    const img = Array.from(document.querySelectorAll('[data-tour="media__3"] img')).find((i) => i.getAttribute('src') === u);
    (img?.parentElement as HTMLElement | null)?.click();
  }, url);
  await page.waitForSelector('[data-media-links] [data-media-link-add]', { timeout: 10000 });
};
const linkTo = async (role: string, target: string) => {
  await page.click('[data-media-link-add]');
  await page.waitForFunction(() => (document.querySelector('[data-media-link-target]') as HTMLSelectElement | null)?.options.length! > 1, { timeout: 10000 });
  await page.select('[data-media-link-role]', role);
  await sleep(200);
  await page.select('[data-media-link-target]', target);
  await page.click('[data-media-link-save]');
};
const closeLightbox = async () => {
  await page.evaluate(() => (document.querySelector('[data-media-lightbox]') as HTMLElement | null)?.click());
  await sleep(500);
};

console.log('\nМедіатека — прив\'язати портрет:');
await page.click('#nav-tab-media');
await openCard(portrait.url);
t('у вікні файлу — «Прив\'язки до книги», поки порожньо', /Ще не прив/.test(await page.evaluate(() => document.querySelector('[data-media-links]')?.textContent ?? '')));
await linkTo('portrait', olena.id);
const mine = await waitFor(() => q(`SELECT role, source, created_by FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2`, [BOOK, portrait.url]), (r) => r.length === 1, 10000);
t('зв\'язок у ядрі: портрет, від автора', mine[0]?.role === 'portrait' && mine[0]?.source === 'author' && mine[0]?.created_by === 'user:u-admin', JSON.stringify(mine));
const chip = await waitFor(() => page.evaluate(() => document.querySelector('[data-media-link]')?.getAttribute('data-media-link') ?? ''), (v) => !!v, 5000);
t('чип «портрет · Олена Ковальчук · автор»', chip === 'portrait:Олена Ковальчук', chip);
await closeLightbox();

console.log('\nМедіатека — ілюстрація сцени:');
await openCard(sceneArt.url);
await linkTo('scene', 'sec-1-1');
await waitFor(() => q(`SELECT id FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2 AND section_id = 'sec-1-1'`, [BOOK, sceneArt.url]), (r) => r.length === 1, 10000);
t('ілюстрація прив\'язана до сцени sec-1-1', true);
await closeLightbox();
await page.waitForSelector('[data-media-entity-filter]', { timeout: 10000 });
await page.select('[data-media-entity-filter]', `e:${olena.id}`);
await sleep(400);
const filtered = await page.evaluate(() => Array.from(document.querySelectorAll('[data-tour="media__3"] img')).map((i) => i.getAttribute('src')));
t('фільтр «Сутність: Олена» — її портрети (з Медіатеки й з картки), без ілюстрації сцени', filtered.includes(portrait.url) && !filtered.includes(sceneArt.url), JSON.stringify(filtered));
await page.select('[data-media-entity-filter]', '');

console.log('\nКРИТЕРІЙ — профіль і «Хто в сцені»:');
await page.goto(`${BASE}/projects/${BOOK}/characters/${olena.id}`, { waitUntil: 'domcontentloaded' });
const prof = await waitFor(() => page.evaluate(() => {
  const img = document.querySelector('[data-profile-portrait]') as HTMLImageElement | null;
  return img ? { src: img.getAttribute('src'), source: img.getAttribute('data-profile-portrait') } : null;
}), (v) => !!v, 40000);
t('КРИТЕРІЙ: у профілі Олени — портрет, прив\'язаний у Медіатеці', prof?.src === portrait.url && prof?.source === 'link', JSON.stringify(prof));
await page.goto(`${BASE}/projects/${BOOK}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-right-tab="scene"]', { timeout: 40000 });
await page.click('[data-right-tab="scene"]');
const cast = await waitFor(() => page.evaluate(() => {
  const box = document.querySelector('[data-scene-visuals]');
  if (!box) return null;
  const c = box.querySelector('[data-scene-cast="Олена Ковальчук"] img') as HTMLImageElement | null;
  return { section: box.getAttribute('data-scene-visuals'), portrait: c?.getAttribute('src') ?? null, source: c?.getAttribute('data-scene-portrait') ?? null, ill: Array.from(box.querySelectorAll('[data-scene-illustration]')).map((i) => i.getAttribute('src')) };
}), (v) => !!v && !!v.portrait, 20000);
t('КРИТЕРІЙ: «Хто в сцені» розділу — Олена з тим самим портретом', cast?.section === 'sec-1-1' && cast?.portrait === portrait.url && cast?.source === 'link', JSON.stringify(cast));
t('«Хто в сцені» — ілюстрація сцени з Медіатеки', !!cast?.ill.includes(sceneArt.url));
await page.screenshot({ path: path.join(DIR, 'visual-scene.png') });

console.log('\nВідв\'язати і права:');
await page.click('#nav-tab-media');
await openCard(portrait.url);
await page.waitForSelector('[data-media-link-remove]', { timeout: 10000 });
await page.click('[data-media-link-remove]');
await waitFor(() => q(`SELECT id FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2`, [BOOK, portrait.url]), (r) => r.length === 0, 10000);
const back = await api('GET', `/api/projects/${BOOK}/visual/portrait/${olena.id}`);
t('відв\'язано — портрет Олени знову той, що перенесено з картки', /unsplash/.test(back.body.portrait?.url ?? '') && back.body.portrait?.source === 'link', JSON.stringify(back.body));
t('чужому API — 403', (await api('GET', `/api/projects/${BOOK}/visual/links`, undefined, TOKEN_X)).status === 403);
await page.screenshot({ path: path.join(DIR, 'visual-media.png') });
await closeLightbox();

await page.setViewport({ width: 390, height: 844 });
await sleep(800);
await openCard(sceneArt.url);
const mm = await page.evaluate(() => {
  const box = document.querySelector('[data-media-links]') as HTMLElement;
  const r = box.getBoundingClientRect();
  return { right: Math.round(r.right), vw: window.innerWidth, scroll: box.scrollWidth, client: box.clientWidth };
});
t('телефон: прив\'язки в межах екрана, без горизонтальної прокрутки', mm.right <= mm.vw && mm.scroll <= mm.client + 1, JSON.stringify(mm));
console.log(`  (знімки: ${DIR}/visual-scene.png, visual-media.png)`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
