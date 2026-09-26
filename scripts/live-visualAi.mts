/**
 * Живий прогін AI-3 у бібліотеці ілюстрацій — Т2.3 В4.
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:visual-ai
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер, але БЕЗ ключів моделі: кнопки
 * «Розпізнати (ШІ)» і «Звірити з описом» ставлять задачу `ai_visual`, яка
 * чесно падає без ключа, а сторінка лишається живою. Відповідь AI-3
 * підставляємо в базу так, як її пише задача (пропозиція зв'язку `suggested`
 * з висновком-доказом, ознаки, звірка), і проходимо шлях автора: пропозиції
 * в Медіатеці → «Прив'язати» / «Відхилити» → підсумок звірки з поясненням;
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
const DIR = path.join(os.tmpdir(), 'nova-visual-ai');
const PORT = Number(process.env.VISUALAI_PORT || 34264);
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
const kid = await saveAsset({ ownerId: 'u-admin', bookId: 'BK-2084-CYBER', kind: 'character_art', filename: 'olena-ai.png', mimeType: 'image/png', bytes: PNG });

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
const locs = await q(`SELECT id, name FROM fusion_core.entities WHERE project_id = $1 AND type <> 'character' ORDER BY name LIMIT 2`, [BOOK]);
const other = (await q(`SELECT id, name FROM fusion_core.entities WHERE project_id = $1 AND type = 'character' AND id <> $2 ORDER BY name LIMIT 1`, [BOOK, olena.id]))[0];
t('книга в ядрі: Олена й ще герой', !!olena && !!other, other?.name);

console.log('\nМедіатека — «Розпізнати (ШІ)» без ключа:');
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
await page.waitForSelector('[data-media-ai-recognize]', { timeout: 10000 });
t('у вікні файлу — кнопка «Розпізнати (ШІ)»', true);
await page.click('[data-media-ai-recognize]');
const job1 = await waitFor(() => q(`SELECT status, payload FROM fusion_core.core_jobs WHERE project_id = $1 AND kind = 'ai_visual' ORDER BY created_at DESC LIMIT 1`, [BOOK]), (r) => r[0] && ['failed', 'succeeded'].includes(r[0].status), 60000);
t('задача ai_visual (recognize) поставлена лише за командою і чесно впала без ключа', job1[0]?.status === 'failed' && job1[0]?.payload?.mode === 'recognize' && job1[0]?.payload?.assetUrl === kid.url, JSON.stringify(job1[0]));
await waitFor(() => page.evaluate(() => !document.querySelector('[data-media-ai-recognize]')?.hasAttribute('disabled')), (v) => v, 40000);
t('сторінка жива, кнопка знову доступна', !!(await page.$('[data-media-links]')));
await page.evaluate(() => (document.querySelector('[data-media-lightbox]') as HTMLElement | null)?.click());
await sleep(400);

console.log('\nВідповідь AI-3 (так, як її пише задача):');
const [run] = await q(`INSERT INTO fusion_core.analysis_runs (project_id, role, module, model, prompt_version, created_by, status)
  VALUES ($1, 'AI-3', 'coreAi3Visual', 'fake-ai3', 'live', 'user:u-admin', 'done') RETURNING id`, [BOOK]).catch(async () =>
  q(`INSERT INTO fusion_core.analysis_runs (project_id, role, module, model, prompt_version, created_by) VALUES ($1, 'AI-3', 'coreAi3Visual', 'fake-ai3', 'live', 'user:u-admin') RETURNING id`, [BOOK]));
const addFinding = async (entityId: string | null, kind: string, payload: object) =>
  (await q(`INSERT INTO fusion_core.analysis_findings (project_id, run_id, entity_id, kind, payload, source_asset_ids, status, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, 'suggested', 'ai:AI-3') RETURNING id`, [BOOK, run.id, entityId, kind, JSON.stringify(payload), [kid.url]]))[0].id as string;
const fOlena = await addFinding(olena.id, 'visual_link', { summary: 'Руда жінка — схоже, Олена.', role: 'depicts', entityName: 'Олена Ковальчук', mode: 'recognize', confidence: 0.8 });
const fOther = await addFinding(other.id, 'visual_link', { summary: `Схоже, ${other.name}.`, role: 'depicts', entityName: other.name, mode: 'recognize', confidence: 0.4 });
await addFinding(olena.id, 'visual_trait', { summary: 'Коротке світле волосся.', field: 'hair', entityName: 'Олена Ковальчук', mode: 'recognize', confidence: 0.7 });
await addFinding(olena.id, 'visual_mismatch', { summary: 'На зображенні карі очі, в описі — сіро-блакитні.', field: 'eyes', entityName: 'Олена Ковальчук', mode: 'recognize', confidence: 0.6 });
for (const [eid, fid] of [[olena.id, fOlena], [other.id, fOther]] as const) {
  await q(`INSERT INTO fusion_core.asset_entity_links (project_id, asset_url, asset_id, entity_id, target, role, status, source, evidence, created_by)
    VALUES ($1, $2, $3, $4, $5, 'depicts', 'suggested', 'ai', $6, 'ai:AI-3')`, [BOOK, kid.url, kid.id, eid, `e:${eid}`, [fid]]);
}
t('у базі: 2 пропозиції зв\'язків від AI-3 і 4 висновки з доказом-зображенням',
  (await q(`SELECT count(*)::int AS n FROM fusion_core.asset_entity_links WHERE project_id = $1 AND source = 'ai' AND status = 'suggested'`, [BOOK]))[0].n === 2);

await openCard(kid.url);
const chips = await waitFor(() => page.evaluate(() => Array.from(document.querySelectorAll('[data-media-link-status="suggested"]')).map((e) => e.getAttribute('data-media-link'))), (v) => v.length === 2, 10000);
t('КРИТЕРІЙ: у Медіатеці — «ШІ пропонує»: Олена й другий герой, з «Прив\'язати» / «Відхилити»', chips.length === 2 && chips.includes('depicts:Олена Ковальчук') && !!(await page.$('[data-media-link-accept]')), JSON.stringify(chips));
// Висновки AI-3 приходять окремим запитом (GET analysis) — чекаємо їх, а не лише чипи.
const aiBox = await waitFor(() => page.evaluate(() => ({ traits: document.querySelectorAll('[data-media-ai-trait]').length, mism: document.querySelector('[data-media-ai-mismatch]')?.textContent ?? '' })), (b) => b.traits > 0 && !!b.mism, 10000);
t('блок «AI-3 бачить» — ознака й розбіжність з описом', aiBox.traits === 1 && /карі очі/.test(aiBox.mism), JSON.stringify(aiBox));
await page.screenshot({ path: path.join(DIR, 'visual-ai-suggest.png') });
const olenaLink = (await q(`SELECT id FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2 AND entity_id = $3`, [BOOK, kid.url, olena.id]))[0];
const otherLink = (await q(`SELECT id FROM fusion_core.asset_entity_links WHERE project_id = $1 AND asset_url = $2 AND entity_id = $3`, [BOOK, kid.url, other.id]))[0];
await page.click(`[data-media-link-accept="${olenaLink.id}"]`);
const acc = await waitFor(() => q(`SELECT status, source, created_by FROM fusion_core.asset_entity_links WHERE id = $1`, [olenaLink.id]), (r) => r[0]?.status === 'confirmed', 10000);
// Висновок-доказ маршрут переводить слідом за зв'язком — чекаємо, а не читаємо одразу.
const accF = await waitFor(() => q(`SELECT status FROM fusion_core.analysis_findings WHERE id = $1`, [fOlena]), (r) => r[0]?.status === 'confirmed', 10000);
t('«Прив\'язати»: підтверджено автором, джерело — ШІ; висновок-доказ підтверджено',
  acc[0]?.created_by === 'user:u-admin' && acc[0]?.source === 'ai' && accF[0]?.status === 'confirmed', JSON.stringify(acc));
// Після «Прив'язати» панель перечитує зв'язки й перемальовує чипи — клікаємо вже в оновлений список.
await waitFor(() => page.evaluate((id: string) => {
  const b = document.querySelector(`[data-media-link-reject="${id}"]`) as HTMLButtonElement | null;
  return !!b && !b.disabled && !document.querySelector(`[data-media-link-status="suggested"][data-media-link="depicts:Олена Ковальчук"]`);
}, otherLink.id), (v) => v, 10000);
await page.evaluate((id: string) => (document.querySelector(`[data-media-link-reject="${id}"]`) as HTMLButtonElement | null)?.click(), otherLink.id);
await waitFor(() => q(`SELECT status FROM fusion_core.asset_entity_links WHERE id = $1`, [otherLink.id]), (r) => r[0]?.status === 'rejected', 10000);
t('«Відхилити»: зв\'язок відхилено назавжди (лишається в базі), висновок відхилено, чип зник',
  (await waitFor(() => q(`SELECT status FROM fusion_core.analysis_findings WHERE id = $1`, [fOther]), (r) => r[0]?.status === 'rejected', 10000))[0]?.status === 'rejected' &&
  (await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-media-link-status="suggested"]').length), (n) => n === 0, 10000)) === 0);

console.log('\nЗвірка з описом:');
const add = await api('POST', `/api/projects/${BOOK}/visual/links`, { assetUrl: kid.url, role: 'portrait', entityId: olena.id });
t('портрет Олени з Медіатеки (API)', add.status === 201);
await page.evaluate(() => (document.querySelector('[data-media-lightbox]') as HTMLElement | null)?.click());
await sleep(300);
await openCard(kid.url);
await page.waitForSelector(`[data-media-link-compare="${add.body.link.id}"]`, { timeout: 10000 });
t('на портреті героя — «Звірити з описом»; на «зображено» — ні', !(await page.$(`[data-media-link-compare="${olenaLink.id}"]`)));
await page.click(`[data-media-link-compare="${add.body.link.id}"]`);
const job2 = await waitFor(() => q(`SELECT status, payload FROM fusion_core.core_jobs WHERE project_id = $1 AND kind = 'ai_visual' ORDER BY created_at DESC LIMIT 1`, [BOOK]), (r) => r[0]?.payload?.mode === 'compare' && ['failed', 'succeeded'].includes(r[0].status), 60000);
t('«Звірити з описом» — задача ai_visual (compare) для цього зв\'язку, без ключа чесно впала', job2[0]?.payload?.linkId === add.body.link.id && job2[0]?.status === 'failed', JSON.stringify(job2[0]));
await q(`INSERT INTO fusion_core.analysis_findings (project_id, run_id, entity_id, kind, payload, source_asset_ids, status, created_by)
  VALUES ($1, $2, $3, 'visual_match', $4, $5, 'suggested', 'ai:AI-3'), ($1, $2, $3, 'visual_mismatch', $6, $5, 'suggested', 'ai:AI-3')`,
  [BOOK, run.id, olena.id, JSON.stringify({ summary: 'Зріст і статура — як в описі.', field: 'build', linkId: add.body.link.id, mode: 'compare' }), [kid.url],
    JSON.stringify({ summary: 'На портреті темне волосся, в описі — платинове.', field: 'hair', linkId: add.body.link.id, mode: 'compare' })]);
await waitFor(() => page.evaluate(() => !!document.querySelector('[data-media-link-compare]') && !document.querySelector('[data-media-link-compare]')!.hasAttribute('disabled')), (v) => v, 40000);
await page.evaluate(() => (document.querySelector('[data-media-lightbox]') as HTMLElement | null)?.click());
await sleep(300);
await openCard(kid.url);
const verdict = await waitFor(() => page.evaluate(() => {
  const v = document.querySelector('[data-media-link-verdict]');
  return v ? { v: v.getAttribute('data-media-link-verdict'), text: v.textContent ?? '' } : null;
}), (x) => !!x, 10000);
t('КРИТЕРІЙ: підсумок звірки під портретом — «є розбіжності» з поясненням', verdict?.v === 'mismatch' && /платинове/.test(verdict.text), JSON.stringify(verdict));
await page.screenshot({ path: path.join(DIR, 'visual-ai-compare.png') });
t('чужому — 403 на «Розпізнати» й «Звірити»',
  (await api('POST', `/api/projects/${BOOK}/visual/recognize`, { assetUrl: kid.url }, TOKEN_X)).status === 403 &&
  (await api('POST', `/api/projects/${BOOK}/visual/links/${add.body.link.id}/compare`, {}, TOKEN_X)).status === 403);

await page.setViewport({ width: 390, height: 844 });
await sleep(800);
const mm = await page.evaluate(() => {
  const box = document.querySelector('[data-media-links]') as HTMLElement;
  const r = box.getBoundingClientRect();
  return { right: Math.round(r.right), vw: window.innerWidth, scroll: box.scrollWidth, client: box.clientWidth };
});
t('телефон: прив\'язки й підсумок AI-3 в межах екрана', mm.right <= mm.vw && mm.scroll <= mm.client + 1, JSON.stringify(mm));
await page.screenshot({ path: path.join(DIR, 'visual-ai-phone.png') });
console.log(`  (знімки: ${DIR}/visual-ai-suggest.png, visual-ai-compare.png, visual-ai-phone.png)`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
