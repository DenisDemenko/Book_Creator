/**
 * Живий прогін генерації від сутності — Т2.3 В6.
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:visual-generation
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL, SQLite Медіатеки й браузер. Справжньої
 * моделі зображень немає: серверу дано тестовий ключ Gemini, а в процес
 * сервера підкладено перехоплювач `fetch` (файл пишеться в тимчасову теку,
 * у репозиторій не йде), який на запит Interactions API повертає PNG і
 * записує, що надіслала Студія (промпт, референси). Решта шляху — справжня:
 * профіль героя → «Згенерувати» на версії → промпт з опису версії →
 * референси → фонова задача → файл у Медіатеці (паспорт «ШІ», модель,
 * промпт) → зв'язок-портрет версії від автора → портрет версії в профілі.
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
const DIR = path.join(os.tmpdir(), 'nova-visual-generation');
const PORT = Number(process.env.VISUALGEN_PORT || 34266);
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

// Підставна модель зображень: лише Interactions API Gemini, решта мережі — як є.
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
    await new Promise((r) => setTimeout(r, 1500));
    return new Response(JSON.stringify({ id: 'fake-' + Date.now(), status: 'completed', output_image: { data: ${JSON.stringify(PNG_B64)}, mime_type: 'image/png' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return real(input, init);
};
`);
const fakeRequests = () => (fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-admin', email: 'admin-search@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
await saveUser({ id: 'u-x', email: 'x@test.ua', name: 'Чужий', role: 'writer', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
const TOKEN_X = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });
await createSession({ token: TOKEN_X, userId: 'u-x', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const { saveAsset, getAsset } = await import('../server/media/mediaLibraryStore');
const PNG = Buffer.from(PNG_B64, 'base64');
const kid = await saveAsset({ ownerId: 'u-admin', bookId: BOOK, kind: 'character_art', filename: 'olena-8.png', mimeType: 'image/png', bytes: PNG });
const fullBody = await saveAsset({ ownerId: 'u-admin', bookId: BOOK, kind: 'character_art', filename: 'olena-full.png', mimeType: 'image/png', bytes: PNG });
const alien = await saveAsset({ ownerId: 'u-x', bookId: null, kind: 'upload', filename: 'alien.png', mimeType: 'image/png', bytes: PNG });

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
t('ядро піднялось', true, `схема v${(log.join('').match(/схема v(\d+)/) ?? [])[1]}`);

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
await waitFor(() => q(`SELECT 1 FROM fusion_core.asset_entity_links WHERE project_id = $1 AND entity_id = $2 AND source = 'legacy'`, [BOOK, olena.id]), (r) => r.length >= 1);
const v8 = (await api('POST', `/api/projects/${BOOK}/visual/appearance/${olena.id}`, { label: 'Олена, 8 років', age: '8', fromChapter: 1, toChapter: 1, description: 'Руде волосся у двох косах, веснянки, зелена сукня' })).body.version;
const vp = await api('PUT', `/api/projects/${BOOK}/visual/appearance/${olena.id}/versions/${v8.id}/portrait`, { assetUrl: kid.url });
const fb = await api('POST', `/api/projects/${BOOK}/visual/links`, { assetUrl: fullBody.url, role: 'full_body', entityId: olena.id });
t('версія «Олена, 8 років» з портретом і загальний повний зріст з Медіатеки', !!v8?.id && vp.status === 200 && fb.status === 201, `${vp.status}/${fb.status}`);
const engines = await api('GET', '/api/ai/image-engines');
t('двигуни Google доступні (тестовий ключ)', (engines.body.engines ?? []).some((e: any) => e.provider === 'google' && e.available));

console.log('\nПрофіль — «Згенерувати» на версії:');
await page.goto(`${BASE}/projects/${BOOK}/characters/${olena.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(`[data-av-generate="${v8.id}"]`, { timeout: 40000 });
t('кнопка «Згенерувати» — на основі (картка) і на затвердженій версії', !!(await page.$('[data-av-generate="base"]')));
await page.click(`[data-av-generate="${v8.id}"]`);
await page.waitForSelector('[data-gen-modal] [data-gen-prompt]', { timeout: 20000 });
await waitFor(() => page.evaluate(() => (document.querySelector('[data-gen-engine]') as HTMLSelectElement | null)?.options.length ?? 0), (n) => n > 0, 10000);
const modal = await page.evaluate(() => ({
  version: document.querySelector('[data-gen-version]')?.textContent ?? '',
  description: document.querySelector('[data-gen-description]')?.textContent ?? '',
  prompt: (document.querySelector('[data-gen-prompt]') as HTMLTextAreaElement).value,
  refs: Array.from(document.querySelectorAll('[data-gen-ref]')).map((e) => e.getAttribute('data-gen-ref')),
  aspect: (document.querySelector('[data-gen-aspect]') as HTMLSelectElement).value,
}));
t('КРИТЕРІЙ: вікно — версія, затверджений опис версії, промпт з ним і віком',
  modal.version === 'Олена, 8 років' && /двох косах/.test(modal.description) && modal.prompt.includes('Олена, 8 років (вік: 8)') && modal.prompt.includes('двох косах'), JSON.stringify(modal).slice(0, 300));
t('референси — портрет версії першим, далі загальний повний зріст (портрет з картки — не з Медіатеки, ні); пропорції портрета',
  modal.refs.join() === `${kid.url},${fullBody.url}` && modal.aspect === '3:4', modal.refs.join());
await page.click('[data-gen-prompt]');
await page.keyboard.press('End');
await page.keyboard.type(' Вечір, м\'яке світло.');
// Повний зріст не беремо — лише портрет версії.
await page.click(`[data-gen-ref="${fullBody.url}"]`);
await page.click('[data-gen-start]');
await page.waitForSelector('[data-gen-running]', { timeout: 10000 });
t('генерація пішла: індикатор із секундами, вікно не закривається', !!(await page.$('[data-gen-running]')));
await page.waitForSelector('[data-gen-result] [data-gen-linked]', { timeout: 60000 });
const res1 = await page.evaluate(() => ({
  img: document.querySelector('[data-gen-result-img]')?.getAttribute('src') ?? '',
  linked: document.querySelector('[data-gen-linked]')?.textContent ?? '',
  linkId: document.querySelector('[data-gen-linked]')?.getAttribute('data-gen-linked') ?? '',
}));
t('КРИТЕРІЙ: готово — зображення з Медіатеки, «Прив\'язано: портрет · Олена Ковальчук · Олена, 8 років»',
  /^\/api\/media\/file\//.test(res1.img) && /портрет/.test(res1.linked) && /Олена Ковальчук/.test(res1.linked) && /8 років/.test(res1.linked), JSON.stringify(res1));
await page.screenshot({ path: path.join(DIR, 'generation-modal.png') });

const reqs = fakeRequests();
const sent = JSON.parse(reqs[reqs.length - 1]?.body || '{}');
const inputs: any[] = Array.isArray(sent.input) ? sent.input : [];
const text = inputs.find((i) => i.type === 'text')?.text ?? sent.input;
const imgs = inputs.filter((i) => i.type === 'image');
t('модель отримала промпт автора (з правкою), пропорції портрета 3:4 і рівно один референс — публічну копію портрета версії',
  reqs.length === 1 && sent.response_format?.aspect_ratio === '3:4' && String(text).includes('Вечір, м\'яке світло.') && String(text).includes('двох косах') && imgs.length === 1 && /^http:\/\/localhost:\d+\/.+ref/.test(imgs[0].uri), JSON.stringify({ text: String(text).slice(0, 120), imgs }));
const refPublic = imgs[0] ? await fetch(imgs[0].uri) : null;
t('копія референсу справді доступна моделі без входу', refPublic?.status === 200 && (refPublic.headers.get('content-type') ?? '').startsWith('image/'), String(refPublic?.status));

const [link] = await q(`SELECT * FROM fusion_core.asset_entity_links WHERE id = $1`, [res1.linkId]);
t('зв\'язок у ядрі: портрет версії, від автора, підтверджено, звірено з описом версії',
  link?.role === 'portrait' && link?.source === 'author' && link?.status === 'confirmed' && link?.created_by === 'user:u-admin' && link?.appearance_version_id === v8.id && link?.checked_hash === v8.descriptionHash && !link?.needs_review && link?.asset_url === res1.img, JSON.stringify(link).slice(0, 300));
const asset = await getAsset(res1.img.split('/').pop()!);
t('файл у Медіатеці автора: портрет героя, книга, паспорт «ШІ», модель і промпт',
  asset?.ownerId === 'u-admin' && asset?.bookId === BOOK && asset?.kind === 'character_art' && asset?.source === 'ai' && !!asset?.model && (asset?.prompt ?? '').includes('Вечір'), JSON.stringify({ kind: asset?.kind, source: asset?.source, model: asset?.model, bookId: asset?.bookId }));

await page.click('[data-gen-modal] button[aria-label]');
await waitFor(() => page.evaluate(() => !document.querySelector('[data-gen-modal]')), (v) => v, 5000);
const card = await waitFor(() => page.evaluate(() => document.querySelector('[data-av-version="Олена, 8 років"] img')?.getAttribute('src') ?? ''), (v) => v === res1.img, 10000);
t('КРИТЕРІЙ: у стрічці версій — новий портрет версії (згенерований)', card === res1.img, card);
await page.select('[data-profile-upto]', '1');
const prof = await waitFor(() => page.evaluate(() => document.querySelector('[data-profile-portrait]')?.getAttribute('src') ?? ''), (v) => v === res1.img, 10000);
t('профіль «стан на главі 1» — згенерований портрет версії', prof === res1.img, prof);
const hist = await q(`SELECT action, snapshot FROM fusion_core.appearance_version_history WHERE version_id = $1 ORDER BY at DESC LIMIT 1`, [v8.id]);
t('в історії версії — «портрет», позначено як згенерований', hist[0]?.action === 'portrait' && hist[0]?.snapshot?.generated === true, JSON.stringify(hist[0]));

console.log('\nЧерез API — за карткою, права, статус задачі:');
const g2 = await api('POST', `/api/projects/${BOOK}/visual/generate`, { entityId: olena.id, role: 'full_body', prompt: 'Олена у повний зріст', referenceAssets: [fullBody.url] });
t('за карткою героя: повний зріст — 202', g2.status === 202 && !!g2.body.jobId, JSON.stringify(g2.body));
t('статус чужої задачі — 404 (бачить лише той, хто поставив)', (await api('GET', `/api/ai/generate-media-art/status/${g2.body.jobId}`, undefined, TOKEN_X)).status === 404);
const st2 = await waitFor(() => api('GET', `/api/ai/generate-media-art/status/${g2.body.jobId}`), (r) => r.body.status !== 'pending', 30000);
t('задача завершилась зі зв\'язком: повний зріст, загальний (без версії)', st2.body.status === 'complete' && st2.body.link?.role === 'full_body' && st2.body.link?.versionLabel === null && !st2.body.linkError, JSON.stringify(st2.body).slice(0, 300));
t('чужому — 403; чужий файл референсом — 400; версія-чернетка — 422',
  (await api('POST', `/api/projects/${BOOK}/visual/generate`, { entityId: olena.id, prompt: 'x' }, TOKEN_X)).status === 403 &&
  (await api('POST', `/api/projects/${BOOK}/visual/generate`, { entityId: olena.id, prompt: 'x', referenceAssets: [alien.url] })).status === 400 &&
  (await api('POST', `/api/projects/${BOOK}/visual/generate`, { entityId: olena.id, appearanceVersionId: (await api('POST', `/api/projects/${BOOK}/visual/appearance/${olena.id}`, { label: 'Чернетка', description: 'x', approved: false })).body.version.id, prompt: 'x' })).status === 422);
const m = await api('POST', '/api/ai/generate-media-art', { prompt: 'Просто натюрморт', bookId: BOOK });
const stm = await waitFor(() => api('GET', `/api/ai/generate-media-art/status/${m.body.jobId}`), (r) => r.body.status !== 'pending', 30000);
t('звичайна генерація Медіатеки (та сама фонова задача) — як і була: готово, без зв\'язку з сутністю',
  m.status === 202 && stm.body.status === 'complete' && /^\/api\/media\/file\//.test(stm.body.imageUrl) && !('link' in stm.body) && stm.body.promptUsed === 'Просто натюрморт', JSON.stringify(stm.body).slice(0, 200));
t('жодної генерації без команди: моделі звертались рівно тричі (дві від сутності, одна з Медіатеки)', fakeRequests().length === 3, String(fakeRequests().length));

await page.setViewport({ width: 390, height: 844 });
await page.waitForSelector(`[data-av-generate="${v8.id}"]`, { timeout: 20000 });
await page.click(`[data-av-generate="${v8.id}"]`);
await page.waitForSelector('[data-gen-modal] [data-gen-prompt]', { timeout: 20000 });
await sleep(500);
const mm = await page.evaluate(() => {
  const box = document.querySelector('[data-gen-modal] [role="dialog"]') as HTMLElement;
  const r = box.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth, doc: document.documentElement.scrollWidth };
});
t('телефон: вікно генерації в межах екрана', mm.left >= 0 && mm.right <= mm.vw && mm.doc <= mm.vw + 1, JSON.stringify(mm));
await page.screenshot({ path: path.join(DIR, 'generation-phone.png') });
console.log(`  (знімки: ${DIR}/generation-modal.png, generation-phone.png)`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
