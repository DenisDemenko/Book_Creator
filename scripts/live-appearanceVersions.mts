/**
 * Живий прогін версій зовнішності героя — Т2.3 В3 (журнал #262).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:appearance-versions
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер. Шлях автора: профіль Олени →
 * «Зовнішність за віком і етапами» → «Додати версію» (опис підставлено з
 * картки) → «Олена, 8 років · гл. 1» → портрет версії з Медіатеки →
 * КРИТЕРІЙ: «стан на главі 1» — портрет цієї версії, «Хто в сцені» глави 1 —
 * теж, з підписом; глава 2 — інша версія діє, портрет загальний; у Медіатеці
 * на зв'язку — назва версії; видалити версію — портрет лишається загальним;
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
const DIR = path.join(os.tmpdir(), 'nova-appearance-versions');
const PORT = Number(process.env.APPEAR_PORT || 34262);
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
const kid = await saveAsset({ ownerId: 'u-admin', bookId: 'BK-2084-CYBER', kind: 'character_art', filename: 'olena-8.png', mimeType: 'image/png', bytes: PNG });

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
t('ядро піднялось, схема ≥ v11 (версії зовнішності)', Number(schema) >= 11, `v${schema}`);

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
const legacy = await waitFor(() => q(`SELECT asset_url FROM fusion_core.asset_entity_links WHERE project_id = $1 AND entity_id = $2 AND source = 'legacy' AND role = 'portrait'`, [BOOK, olena.id]), (r) => r.length >= 1);
const cardUrl = legacy[0]?.asset_url as string;
t('портрет з картки Олени перенесено (загальний портрет)', /unsplash/.test(cardUrl ?? ''), cardUrl);
// Олена — у розділах глав 1 і 2 (теги в ядрі, як їх ставить синхронізація).
for (const sec of ['sec-1-1', 'sec-2-1']) {
  const [p] = await q(`SELECT id FROM fusion_core.paragraphs WHERE project_id = $1 AND document_id = $2 AND deleted_at IS NULL ORDER BY ord LIMIT 1`, [BOOK, sec]);
  await q(`INSERT INTO fusion_core.entity_mentions (project_id, entity_id, paragraph_id, span_start, span_end, source, status) VALUES ($1, $2, $3, 0, 1, 'tag', 'confirmed')`, [BOOK, olena.id, p.id]);
}

console.log('\nПрофіль — нова версія:');
await page.goto(`${BASE}/projects/${BOOK}/characters/${olena.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-appearance-versions] [data-av-add]', { timeout: 40000 });
t('блок «Зовнішність за віком і етапами»: версій ще немає, основа — картка з портретом',
  await page.evaluate(() => !!document.querySelector('[data-av-empty]') && !!document.querySelector('[data-av-base] img')));
await page.click('[data-av-add]');
await page.waitForSelector('[data-av-form="new"]');
const prefilled = await page.$eval('[data-av-description]', (e) => (e as HTMLTextAreaElement).value);
t('опис нової версії підставлено з картки героя (канон автора)', prefilled.length > 5, prefilled.slice(0, 80));
await page.type('[data-av-label]', 'Олена, 8 років');
await page.type('[data-av-age]', '8');
await page.select('[data-av-from]', '1');
await page.select('[data-av-to]', '1');
await page.click('[data-av-description]', { clickCount: 3 });
await page.keyboard.press('Backspace');
await page.type('[data-av-description]', 'Руде волосся в двох косах, веснянки');
await page.click('[data-av-save]');
const v1 = (await waitFor(() => q(`SELECT * FROM fusion_core.appearance_versions WHERE project_id = $1 AND entity_id = $2`, [BOOK, olena.id]), (r) => r.length === 1, 10000))[0];
t('версія в ядрі: назва, вік, гл. 1–1, опис, затверджена, від автора',
  v1?.label === 'Олена, 8 років' && v1?.age === '8' && v1?.from_chapter === 1 && v1?.to_chapter === 1 && /косах/.test(v1?.description) && v1?.approved && v1?.created_by === 'user:u-admin', JSON.stringify(v1));
const adult = await api('POST', `/api/projects/${BOOK}/visual/appearance/${olena.id}`, { label: 'Доросла', fromChapter: 2, description: 'Коротке руде волосся' });
t('друга версія через API — «Доросла · з гл. 2»', adult.status === 201, JSON.stringify(adult.body).slice(0, 200));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-av-version="Олена, 8 років"] [data-av-portrait]', { timeout: 40000 });

console.log('\nПортрет версії з Медіатеки:');
await page.click('[data-av-version="Олена, 8 років"] [data-av-portrait]');
await page.waitForFunction((u: string) => Array.from(document.querySelectorAll('.fixed img')).some((i) => i.getAttribute('src') === u), { timeout: 20000 }, kid.url);
await page.evaluate((u: string) => {
  const img = Array.from(document.querySelectorAll('.fixed img')).find((i) => i.getAttribute('src') === u);
  const target = (img?.closest('button') as HTMLElement | null) ?? (img as HTMLElement | undefined);
  target?.click();
}, kid.url);
const vl = await waitFor(() => q(`SELECT role, source, appearance_version_id FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2`, [BOOK, kid.url]), (r) => r.length === 1, 10000);
t('зв\'язок «портрет» Олени з позначкою версії, від автора', vl[0]?.role === 'portrait' && vl[0]?.appearance_version_id === v1.id && vl[0]?.source === 'author', JSON.stringify(vl));
const card1 = await waitFor(() => page.evaluate(() => document.querySelector('[data-av-version="Олена, 8 років"] img')?.getAttribute('src') ?? ''), (v) => !!v, 10000);
t('у картці версії — її портрет', card1 === kid.url, card1);
const full = await page.evaluate(() => document.querySelector('[data-profile-portrait]')?.getAttribute('src'));
t('профіль «уся книга» — загальний портрет (з картки), не дитячий', full === cardUrl, String(full));

console.log('\nКРИТЕРІЙ — «стан на главі N»:');
await page.select('[data-profile-upto]', '1');
const at1 = await waitFor(() => page.evaluate(() => {
  const img = document.querySelector('[data-profile-portrait]');
  return { src: img?.getAttribute('src'), version: img?.getAttribute('data-profile-portrait-version'), active: document.querySelector('[data-appearance-versions]')?.getAttribute('data-av-active'), shown: Array.from(document.querySelectorAll('[data-av-version]')).map((e) => e.getAttribute('data-av-version')) };
}), (v) => v.src === kid.url, 15000);
t('КРИТЕРІЙ: стан на главі 1 — портрет версії «Олена, 8 років»', at1.src === kid.url && at1.version === 'Олена, 8 років', JSON.stringify(at1));
t('на главі 1: діюча — «8 років», «Доросла» (з гл. 2) прихована', at1.active === v1.id && at1.shown.join() === 'Олена, 8 років', JSON.stringify(at1.shown));
await page.screenshot({ path: path.join(DIR, 'appearance-profile.png') });
await page.select('[data-profile-upto]', '2');
const at2 = await waitFor(() => page.evaluate(() => {
  const img = document.querySelector('[data-profile-portrait]');
  return { src: img?.getAttribute('src'), version: img?.getAttribute('data-profile-portrait-version'), active: document.querySelector('[data-av-version-active="1"]')?.getAttribute('data-av-version') };
}), (v) => v.src !== kid.url && v.active === 'Доросла', 15000);
t('на главі 2: діє «Доросла» (без свого портрета) — загальний портрет, не дитячий', at2.src === cardUrl && at2.version === '' && at2.active === 'Доросла', JSON.stringify(at2));

console.log('\nКРИТЕРІЙ — «Хто в сцені»:');
const sceneOf = async (sectionTitleRe: RegExp | null) => {
  if (sectionTitleRe) {
    await page.evaluate((src: string) => {
      const re = new RegExp(src);
      const el = Array.from(document.querySelectorAll('button,a,[role="button"],li,div')).find((e) => e.children.length < 4 && re.test((e.textContent || '').trim())) as HTMLElement | undefined;
      el?.click();
    }, sectionTitleRe.source);
  }
  return waitFor(() => page.evaluate(() => {
    const box = document.querySelector('[data-scene-visuals]');
    if (!box) return null;
    const c = box.querySelector('[data-scene-cast="Олена Ковальчук"]');
    return { section: box.getAttribute('data-scene-visuals'), portrait: c?.querySelector('img')?.getAttribute('src') ?? null, version: c?.querySelector('[data-scene-version]')?.getAttribute('data-scene-version') ?? null };
  }), (v) => !!v && !!v.portrait, 20000);
};
await page.goto(`${BASE}/projects/${BOOK}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-right-tab="scene"]', { timeout: 40000 });
await page.click('[data-right-tab="scene"]');
const s1 = await sceneOf(null);
t('КРИТЕРІЙ: розділ глави 1 — Олена з портретом «8 років» і підписом версії', s1?.section === 'sec-1-1' && s1?.portrait === kid.url && s1?.version === 'Олена, 8 років', JSON.stringify(s1));
const s2 = await api('GET', `/api/projects/${BOOK}/visual/scene?sectionId=sec-2-1`);
const o2 = s2.body.cast?.find((c: any) => c.name === 'Олена Ковальчук');
t('розділ глави 2 — підпис «Доросла», портрет загальний', o2?.versionLabel === 'Доросла' && o2?.portraitUrl === cardUrl, JSON.stringify(o2));
await page.screenshot({ path: path.join(DIR, 'appearance-scene.png') });

console.log('\nМедіатека і видалення:');
await page.click('#nav-tab-media');
await page.waitForFunction((u: string) => Array.from(document.querySelectorAll('[data-tour="media__3"] img')).some((i) => i.getAttribute('src') === u), { timeout: 20000 }, kid.url);
await page.evaluate((u: string) => {
  const img = Array.from(document.querySelectorAll('[data-tour="media__3"] img')).find((i) => i.getAttribute('src') === u);
  (img?.parentElement as HTMLElement | null)?.click();
}, kid.url);
const chipV = await waitFor(() => page.evaluate(() => document.querySelector('[data-media-link-version]')?.getAttribute('data-media-link-version') ?? ''), (v) => !!v, 10000);
t('у Медіатеці на зв\'язку — назва версії', chipV === 'Олена, 8 років', chipV);
await page.evaluate(() => (document.querySelector('[data-media-lightbox]') as HTMLElement | null)?.click());
await page.goto(`${BASE}/projects/${BOOK}/characters/${olena.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-av-version="Олена, 8 років"] [data-av-delete]', { timeout: 40000 });
await page.click('[data-av-version="Олена, 8 років"] [data-av-delete]');
await page.waitForSelector('[data-av-delete-confirm] [data-av-delete-yes]');
await page.click('[data-av-delete-confirm] [data-av-delete-yes]');
await waitFor(() => q(`SELECT id FROM fusion_core.appearance_versions WHERE id = $1`, [v1.id]), (r) => r.length === 0, 10000);
const kept = await q(`SELECT appearance_version_id FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2`, [BOOK, kid.url]);
const hist = await q(`SELECT action FROM fusion_core.appearance_version_history WHERE project_id = $1 AND version_id = $2 ORDER BY at, id`, [BOOK, v1.id]);
t('версію видалено (з підтвердженням у сторінці) — портрет лишився загальним; історія: створено, портрет, видалено',
  kept.length === 1 && kept[0].appearance_version_id === null && hist.map((h) => h.action).join() === 'created,portrait,deleted', JSON.stringify({ kept, hist }));
t('чужому API — 403', (await api('GET', `/api/projects/${BOOK}/visual/appearance/${olena.id}`, undefined, TOKEN_X)).status === 403);

await page.setViewport({ width: 390, height: 844 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-appearance-versions] [data-av-add]', { timeout: 40000 });
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
await sleep(1000);
await page.click('[data-av-add]');
await page.waitForSelector('[data-av-form="new"]');
const mm = await page.evaluate(() => {
  const box = document.querySelector('[data-appearance-versions]') as HTMLElement;
  const r = box.getBoundingClientRect();
  return { right: Math.round(r.right), vw: window.innerWidth, scroll: box.scrollWidth, client: box.clientWidth, page: document.documentElement.scrollWidth };
});
t('телефон: версії й форма в межах екрана, без горизонтальної прокрутки', mm.right <= mm.vw && mm.scroll <= mm.client + 1 && mm.page <= mm.vw + 1 && mm.client >= 220, JSON.stringify(mm));
await page.screenshot({ path: path.join(DIR, 'appearance-phone.png') });
console.log(`  (знімки: ${DIR}/appearance-profile.png, appearance-scene.png, appearance-phone.png)`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
