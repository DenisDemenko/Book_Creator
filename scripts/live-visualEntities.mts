/**
 * Живий прогін вкладки «За сутностями» — Т2.3 В7.
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:visual-entities
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер, книга — той самий стартовий
 * фікстур `BK-2084-CYBER`, що й у сусідніх живих прогонах (Олена Ковальчук
 * у ньому вже з портретом-карткою — легасі-перенесення В2 спрацює саме
 * собою). Перевіряє саме подання (В7 лише перелічує й показує те, що вже
 * дають В1–В6): адреса `/visual-library` веде в Медіатеку на вкладку «За
 * сутностями» (а не на заглушку сторінки 7), ліва колонка — лічильники й
 * позначки «перевірити» / пропозиції ШІ / «без портрета», права —
 * зображення обраної сутності, версії зовнішності героя (В3/В5/В6),
 * пропозиція AI-3 на розгляд, «Прив'язати» і «Згенерувати» для нехероя,
 * «Відкрити в бібліотеці сутностей» з Медіатеки. Справжньої моделі
 * зображень немає (див. live-visualGeneration.mts).
 *
 * Пастка (log.md #172): у page.evaluate — лише рядки або стрілкові функції.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const DB_URL = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!DB_URL) {
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL (PostgreSQL з pgvector).');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-visual-entities');
const PORT = Number(process.env.VISUALENT_PORT || 34267);
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

// Підставна модель зображень — лише для перевірки «✨ Згенерувати» з панелі сутностей (В7 сама її не малює, а користується задачею В6).
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const FAKE_LOG = path.join(DIR, 'fake-image-requests.jsonl');
const FAKE = path.join(DIR, 'fake-image-provider.mjs');
fs.writeFileSync(FAKE, `
import fs from 'node:fs';
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (/generativelanguage\\.googleapis\\.com/.test(url) && /interactions/.test(url)) {
    const raw = init?.body ?? (typeof input === 'object' && typeof input?.clone === 'function' ? await input.clone().text() : '');
    const body = typeof raw === 'string' ? raw : raw instanceof Uint8Array || raw instanceof ArrayBuffer ? Buffer.from(raw).toString('utf8') : await new Response(raw).text();
    fs.appendFileSync(${JSON.stringify(FAKE_LOG)}, JSON.stringify({ url, body }) + '\\n');
    await new Promise((r) => setTimeout(r, 1200));
    return new Response(JSON.stringify({ id: 'fake-' + Date.now(), status: 'completed', output_image: { data: ${JSON.stringify(PNG_B64)}, mime_type: 'image/png' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return real(input, init);
};
`);
const fakeRequests = () => (fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-admin', email: 'admin-entlib@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
await saveUser({ id: 'u-reader', email: 'reader-entlib@test.ua', name: 'Читач', role: 'writer', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
const TOKEN_READER = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });
await createSession({ token: TOKEN_READER, userId: 'u-reader', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const { saveAsset } = await import('../server/media/mediaLibraryStore');
const PNG = Buffer.from(PNG_B64, 'base64');
const markoAi = await saveAsset({ ownerId: 'u-admin', bookId: BOOK, kind: 'illustration', filename: 'marko-ai.png', mimeType: 'image/png', bytes: PNG });
const kyivPic = await saveAsset({ ownerId: 'u-admin', bookId: BOOK, kind: 'illustration', filename: 'kyiv.png', mimeType: 'image/png', bytes: PNG });
const scenePic = await saveAsset({ ownerId: 'u-admin', bookId: BOOK, kind: 'illustration', filename: 'scene1.png', mimeType: 'image/png', bytes: PNG });

const log: string[] = [];
const child = spawn(process.execPath, ['--import', pathToFileURL(FAKE).href, path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, GEMINI_API_KEY: 'live-fake-key', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '', APP_URL: BASE },
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
t('ядро піднялось', true);

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

console.log('\nПідготовка: нові сутності в тексті (Олена — вже з фікстури, з портретом-карткою):');
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
await page.keyboard.type(' [/character:Марко] [/location:Київ] [/object:Меч] Марко в Києві з мечем.');
const [olena] = await waitFor(() => q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Олена Ковальчук'`, [BOOK]), (r) => r.length === 1);
const [marko] = await waitFor(() => q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Марко'`, [BOOK]), (r) => r.length === 1);
const [kyiv] = await waitFor(() => q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Київ'`, [BOOK]), (r) => r.length === 1);
const [mech] = await waitFor(() => q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Меч'`, [BOOK]), (r) => r.length === 1);
t('нові сутності синхронізовано: Марко, Київ, Меч', !!(marko && kyiv && mech));
// Фонові задачі ядра мусять відпрацювати до кінця: без цього перевірка читає
// недописаний стан (розбір — запис #301).
const pendingJobs = await waitFor(
  () => q(`SELECT count(*)::int AS n FROM fusion_core.core_jobs WHERE project_id = $1 AND status IN ('queued', 'running')`, [BOOK]),
  (r) => Number(r[0]?.n) === 0,
  90000,
);
t('фонові задачі ядра відпрацювали до кінця', Number(pendingJobs[0]?.n) === 0, `у черзі ${pendingJobs[0]?.n}`);
const legacyPortrait = await waitFor(() => q(`SELECT 1 FROM fusion_core.asset_entity_links WHERE project_id = $1 AND entity_id = $2 AND role = 'portrait' AND source = 'legacy'`, [BOOK, olena.id]), (r) => r.length >= 1);
t('портрет Олени вже перенесено з картки (легасі, В2) — саме собою, без наших дій', legacyPortrait.length >= 1);
const [sectionRow] = await q(`SELECT id FROM fusion_core.documents WHERE project_id = $1 AND kind = 'section' ORDER BY id LIMIT 1`, [BOOK]);

// Пропозиція AI-3 на розгляд для Марка — записана напряму (та сама форма, що й ai_visual, без справжньої моделі-тексту).
await db.query(
  `INSERT INTO fusion_core.asset_entity_links (project_id, asset_url, entity_id, target, role, status, source, created_by)
   VALUES ($1, $2, $3, $4, 'depicts', 'suggested', 'ai', 'ai:visual3')`,
  [BOOK, markoAi.url, marko.id, `e:${marko.id}`],
);
// Ілюстрація сцени — прив'язана як завжди (не обов'язково легасі: сцену бачить панель сутностей за будь-яким підтвердженим зв'язком «сцена»).
await api('POST', `/api/projects/${BOOK}/visual/links`, { assetUrl: scenePic.url, role: 'scene', sectionId: sectionRow.id });

console.log('\n/visual-library веде в Медіатеку, вкладку «За сутностями» (не заглушку сторінки 7):');
await page.goto(`${BASE}/projects/${BOOK}/visual-library`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-entity-library]', { timeout: 20000 });
t('немає заглушки «зʼявиться на етапі» — одразу панель сутностей', !(await page.evaluate(() => /з'явиться повністю на етапі/.test(document.body.textContent || ''))));
const entitiesTabActive = await page.evaluate(() => document.querySelector('[data-media-mode-tab="entities"]')?.className.includes('cyan') ?? false);
t('вкладка «За сутностями» активна', entitiesTabActive);

await waitFor(() => page.evaluate((id: string) => !!document.querySelector(`[data-ent-row="${id}"]`), marko.id), (v) => v, 20000);
t('усі нові сутності — у лівій колонці', await page.evaluate((ids: string[]) => ids.every((id) => !!document.querySelector(`[data-ent-row="${id}"]`)), [olena.id, marko.id, kyiv.id, mech.id]));
t('сцена з ілюстрацією — у розділі «Сцени»', !!(await page.$(`[data-ent-scene-row="${sectionRow.id}"]`)));

const olenaBadge = await page.evaluate((id: string) => !document.querySelector(`[data-ent-row="${id}"] [data-ent-no-portrait]`), olena.id);
t('КРИТЕРІЙ: Олена — портрет є (без позначки «без портрета»)', olenaBadge);
const markoBadge = await page.evaluate((id: string) => {
  const row = document.querySelector(`[data-ent-row="${id}"]`);
  return { noPortrait: !!row?.querySelector('[data-ent-no-portrait]'), suggested: row?.querySelector('[data-ent-suggested]')?.getAttribute('data-ent-suggested') ?? null };
}, marko.id);
t('КРИТЕРІЙ: Марко — «без портрета» і «пропозиції: 1»', markoBadge.noPortrait === true && markoBadge.suggested === '1', JSON.stringify(markoBadge));
const kyivBadge = await page.evaluate((id: string) => !!document.querySelector(`[data-ent-row="${id}"] [data-ent-no-portrait]`), kyiv.id);
t('Київ поки без зображення — «без портрета»', kyivBadge);

console.log('\nПрава колонка — герой (версії й пропозиція ШІ, В3/В5/В6 нікуди не зникли):');
await page.click(`[data-ent-row="${marko.id}"]`);
await page.waitForSelector('[data-appearance-versions]', { timeout: 10000 });
await page.waitForSelector('[data-ent-image-accept]', { timeout: 10000 });
t('картка героя (В3/В5/В6) — на місці, і зображення-пропозиція ШІ — з кнопками прийняти/відхилити', true);
await page.click('[data-ent-image-accept]');
await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-ent-image-accept]').length), (n) => n === 0, 10000);
const [markoLink] = await q(`SELECT role, status FROM fusion_core.asset_entity_links WHERE project_id = $1 AND entity_id = $2`, [BOOK, marko.id]);
t('прийнято з панелі сутностей: зв\'язок підтверджено (роль «зображено» — не портрет, тож «без портрета» лишиться)', markoLink?.status === 'confirmed' && markoLink?.role === 'depicts', JSON.stringify(markoLink));
const markoStillNoPortrait = await waitFor(
  () => page.evaluate((id: string) => !!document.querySelector(`[data-ent-row="${id}"] [data-ent-no-portrait]`), marko.id),
  (v) => v === true,
  10000,
);
t('лічильник оновився, а «без портрета» лишається (роль не портретна)', markoStillNoPortrait === true);

console.log('\nПрава колонка — локація («Прив\'язати» наявне зображення):');
await page.click(`[data-ent-row="${kyiv.id}"]`);
await page.waitForSelector('[data-ent-link]', { timeout: 10000 });
t('нехероя: кнопки «Згенерувати» й «Прив\'язати» (не картка героя)', (await page.$('[data-appearance-versions]')) === null && (await page.$('[data-ent-generate]')) !== null);
await page.click('[data-ent-link]');
await waitFor(() => page.evaluate((u: string) => Array.from(document.querySelectorAll('img')).some((i) => (i as HTMLImageElement).src.includes(u.split('/').pop() as string)), kyivPic.url), (v) => v, 10000);
await page.evaluate((url: string) => {
  const img = Array.from(document.querySelectorAll('img')).find((i) => (i as HTMLImageElement).src.includes(url.split('/').pop() as string)) as HTMLElement | undefined;
  (img?.closest('button') as HTMLElement | undefined)?.click();
}, kyivPic.url);
await waitFor(() => q(`SELECT 1 FROM fusion_core.asset_entity_links WHERE project_id = $1 AND entity_id = $2 AND role = 'location'`, [BOOK, kyiv.id]), (r) => r.length === 1, 10000);
const kyivFixed = await waitFor(() => page.evaluate((id: string) => !document.querySelector(`[data-ent-row="${id}"] [data-ent-no-portrait]`), kyiv.id), (v) => v, 10000);
t('«Прив\'язати» з панелі сутностей: зв\'язок «локація» створено, «без портрета» знято', kyivFixed);

console.log('\nПрава колонка — предмет («✨ Згенерувати», та сама фонова задача В6):');
await page.click(`[data-ent-row="${mech.id}"]`);
await page.waitForSelector('[data-ent-generate]', { timeout: 10000 });
await page.click('[data-ent-generate]');
await page.waitForSelector('[data-gen-modal] [data-gen-prompt]', { timeout: 20000 });
await waitFor(() => page.evaluate(() => (document.querySelector('[data-gen-engine]') as HTMLSelectElement | null)?.options.length ?? 0), (n) => n > 0, 10000);
await page.click('[data-gen-start]');
await page.waitForSelector('[data-gen-result] [data-gen-linked]', { timeout: 60000 });
const linkedText = await page.evaluate(() => document.querySelector('[data-gen-linked]')?.textContent ?? '');
t('КРИТЕРІЙ: згенеровано й прив\'язано предмет («Меч»)', /Меч/.test(linkedText), linkedText);
await page.click('[data-gen-modal] button[aria-label]');
await waitFor(() => page.evaluate(() => !document.querySelector('[data-gen-modal]')), (v) => v, 5000);
const mechFixed = await waitFor(() => page.evaluate((id: string) => !document.querySelector(`[data-ent-row="${id}"] [data-ent-no-portrait]`), mech.id), (v) => v, 10000);
t('після генерації Меч більше не «без портрета»', mechFixed);

console.log('\n«Відкрити в бібліотеці сутностей» з Медіатеки:');
await page.goto(`${BASE}/projects/${BOOK}/media`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-media-mode-tab="gallery"]', { timeout: 20000 });
await waitFor(() => page.evaluate((u: string) => Array.from(document.querySelectorAll('img')).some((i) => (i as HTMLImageElement).src.includes(u.split('/').pop() as string)), kyivPic.url), (v) => v, 15000);
await page.evaluate((url: string) => {
  const img = Array.from(document.querySelectorAll('img')).find((i) => (i as HTMLImageElement).src.includes(url.split('/').pop() as string));
  (img?.closest('div[class*="cursor-pointer"]') as HTMLElement | undefined)?.click();
}, kyivPic.url);
await page.waitForSelector(`[data-media-link-open-entity="${kyiv.id}"]`, { timeout: 10000 });
await page.click(`[data-media-link-open-entity="${kyiv.id}"]`);
const focused = await waitFor(() => page.evaluate((id: string) => document.querySelector(`[data-ent-row="${id}"]`)?.getAttribute('data-ent-row-active'), kyiv.id), (v) => v === '1', 10000);
t('КРИТЕРІЙ: «Відкрити в бібліотеці сутностей» перемикає на вкладку й одразу обирає Київ', focused === '1', focused);

console.log('\nЧужа книга — 403 ще до подання:');
const foreign = await api('GET', `/api/projects/${BOOK}-nope/visual/entities`, undefined, TOKEN_READER);
t('чужа книга — 403 (перелік сутностей теж під правами проєкту)', foreign.status === 403 || foreign.status === 401, String(foreign.status));

await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/projects/${BOOK}/visual-library`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-entity-library]', { timeout: 20000 });
const mm = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, vw: window.innerWidth }));
t('телефон 390 px: панель сутностей у межах екрана', mm.scrollW <= mm.vw + 1, JSON.stringify(mm));
await page.screenshot({ path: path.join(DIR, 'entities-phone.png') });
console.log(`  (знімок: ${DIR}/entities-phone.png)`);

t('моделі звертались лише за командою (одна генерація предмета)', fakeRequests().length === 1, String(fakeRequests().length));

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
