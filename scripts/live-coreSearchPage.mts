/**
 * Живий прогін сторінки 1 «Розумний пошук» (Т1.3, журнал #254).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:core-search-page
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер, без ключів моделей. Шлях автора:
 * відкрити /projects/<книга>/search, ввести «герой + емоція» — першим абзац
 * зі страхом саме героїні, з контекстом і поясненням; «Відкрити в редакторі»
 * — редактор на тому самому абзаці, виділеному; фільтри (персонаж, глава,
 * статус) звужують видачу; тлумачення ШІ без ключа чесно пише, що пошук без
 * нього; збережений запит переживає перезавантаження й повторюється кліком;
 * сторінка працює на ширині телефона.
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
const DIR = path.join(os.tmpdir(), 'nova-core-search-page');
const PORT = Number(process.env.CORE_SEARCH_PAGE_PORT || 34254);
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
t('ядро піднялось, схема ≥ v7 (збережені запити)', Number(schema) >= 7, `v${schema}`);

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
const pids = (await page.evaluate(`(() => {
  const ed = document.querySelector('#book-content-editor-ua .ProseMirror').editor;
  const out = []; ed.state.doc.forEach((n) => out.push(n.attrs.pid || null)); return out;
})()`)) as string[];
const synced = await waitFor(
  () => q(`SELECT id, text, document_id FROM fusion_core.paragraphs WHERE project_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`, [BOOK, pids]),
  (rows) => rows.length >= 4,
);
t('абзаци розділу — у ядрі', synced.length >= 4, `${synced.length}`);
const byId = new Map(synced.map((r: any) => [r.id, r]));
// Розмічена сцена: страх героїні книги в абзаці pFear; героїня без страху — pOlena.
const [pFear, pOlena] = [pids[2], pids[3]];
const [olena] = await q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND type = 'character' AND name = 'Олена Ковальчук'`, [BOOK]);
const [fear] = await q(`INSERT INTO fusion_core.entities (project_id, type, name, status, created_by) VALUES ($1, 'emotion', 'страх', 'confirmed', 'user:u-admin') RETURNING id`, [BOOK]);
const mention = (entity: string, pid: string, subject: string | null) =>
  q(`INSERT INTO fusion_core.entity_mentions (project_id, entity_id, paragraph_id, span_start, span_end, source, status, subject_entity_id)
     VALUES ($1, $2, $3, 0, 1, 'tag', 'confirmed', $4)`, [BOOK, entity, pid, subject]);
await mention(fear.id, pFear, olena.id);
await mention(olena.id, pOlena, null);
const sectionOfFear = byId.get(pFear)!.document_id;

console.log('\nСторінка «Розумний пошук»:');
await page.goto(`${BASE}/projects/${BOOK}/search`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-core-search-input]', { timeout: 40000 });
t('сторінка відкривається за адресою /projects/<книга>/search', await page.evaluate(() => location.pathname.endsWith('/search')));
await page.waitForFunction(() => (document.querySelector('[data-core-filter="character"]') as HTMLSelectElement | null)?.options.length! > 1, { timeout: 15000 }).catch(() => null);
const charOptions = await page.evaluate(() => Array.from((document.querySelector('[data-core-filter="character"]') as HTMLSelectElement).options).map((o) => o.textContent));
t('фільтр «Персонаж» — герої книги з ядра', charOptions.includes('Олена Ковальчук'), charOptions.join(', ').slice(0, 100));
await page.click('[data-core-search-interpret]'); // вимкнути тлумачення ШІ
await page.type('[data-core-search-input]', 'Олени страх');
await page.click('[data-core-search-run]');
await page.waitForSelector('[data-core-search-hit]', { timeout: 20000 }).catch(() => null);
const hits = await page.evaluate(() => Array.from(document.querySelectorAll('[data-core-search-hit]')).map((e) => e.getAttribute('data-core-search-hit')));
t('КРИТЕРІЙ: «Олени страх» — першим абзац страху героїні (точний paragraph_id)', hits[0] === pFear, `${hits[0]} vs ${pFear}`);
const firstCard = await page.evaluate((id: string) => {
  const el = document.querySelector(`[data-core-search-hit="${id}"]`) as HTMLElement;
  return { why: el.querySelector('[data-core-search-why]')?.textContent ?? '', text: el.innerText };
}, pFear);
t('у картці — пояснення релевантності й глава', /Олена Ковальчук — через «страх»/.test(firstCard.why) && /Глава \d/.test(firstCard.text) && !/Глава 1 · Глава 1/.test(firstCard.text), firstCard.why);
const ctx = await page.evaluate((id: string) => document.querySelector(`[data-core-search-hit="${id}"]`)!.querySelectorAll('p').length, pFear);
t('контекст — сусідні абзаци навколо знайденого', ctx >= 3, `${ctx}`);
await page.screenshot({ path: path.join(DIR, 'search-desktop.png') });

console.log('\nПерехід у редактор:');
await page.evaluate((id: string) => (document.querySelector(`[data-core-search-hit="${id}"] [data-core-search-open]`) as HTMLElement).click(), pFear);
await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 20000 });
const sel = await waitFor(
  () => page.evaluate(`(() => {
    const ed = document.querySelector('#book-content-editor-ua .ProseMirror')?.editor;
    if (!ed) return null;
    const { from, to } = ed.state.selection;
    const $from = ed.state.doc.resolve(from);
    let pid = null;
    for (let d = $from.depth; d >= 0; d--) { const n = $from.node(d); if (n.attrs && n.attrs.pid) { pid = n.attrs.pid; break; } }
    return { pid, len: to - from, path: location.pathname };
  })()`) as Promise<any>,
  (v) => !!v && v.len > 0,
  15000,
);
t('редактор відкрився на тому самому абзаці, абзац виділено', sel?.pid === pFear && sel.len > 10 && /\/editor$/.test(sel.path), JSON.stringify(sel));

console.log('\nФільтри й тлумачення:');
await page.goto(`${BASE}/projects/${BOOK}/search`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-core-search-input]', { timeout: 40000 });
await page.waitForFunction(() => (document.querySelector('[data-core-filter="character"]') as HTMLSelectElement | null)?.options.length! > 1, { timeout: 15000 }).catch(() => null);
await page.type('[data-core-search-input]', 'Олена');
await page.select('[data-core-filter="emotion"]', fear.id);
await page.click('[data-core-search-run]');
await page.waitForSelector('[data-core-search-interpretation]', { timeout: 20000 }).catch(() => null);
const interpText = await page.evaluate(() => document.querySelector('[data-core-search-interpretation]')?.textContent ?? '');
t('тлумачення ШІ без ключа — чесне пояснення, пошук іде без нього', /без тлумачення|не підключене/.test(interpText), interpText.slice(0, 120));
const filtered = await page.evaluate(() => Array.from(document.querySelectorAll('[data-core-search-hit]')).map((e) => e.getAttribute('data-core-search-hit')));
t('фільтр «Емоція: страх» — лише абзац зі страхом', filtered.length === 1 && filtered[0] === pFear, filtered.join());

console.log('\nЗбережені запити:');
await page.type('[data-core-search-save-name]', 'Страх Олени');
await page.click('[data-core-search-save]');
await page.waitForSelector('[data-core-saved]', { timeout: 10000 }).catch(() => null);
t('запит збережено — з\'явився в списку', (await page.$$('[data-core-saved]')).length === 1);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-core-saved]', { timeout: 30000 }).catch(() => null);
t('після перезавантаження — на місці', (await page.$$('[data-core-saved]')).length === 1);
await page.waitForFunction(() => (document.querySelector('[data-core-filter="emotion"]') as HTMLSelectElement | null)?.options.length! > 1, { timeout: 15000 }).catch(() => null);
await page.click('[data-core-saved-run]');
await page.waitForSelector('[data-core-search-hit]', { timeout: 20000 }).catch(() => null);
const rerun = await page.evaluate(() => ({
  hits: Array.from(document.querySelectorAll('[data-core-search-hit]')).map((e) => e.getAttribute('data-core-search-hit')),
  q: (document.querySelector('[data-core-search-input]') as HTMLInputElement).value,
  emotion: (document.querySelector('[data-core-filter="emotion"]') as HTMLSelectElement).value,
}));
t('клік по збереженому — той самий запит і фільтри, ті самі результати', rerun.q === 'Олена' && rerun.emotion === fear.id && rerun.hits.join() === pFear, JSON.stringify(rerun));
t('у базі — рядок saved_searches цього користувача', (await q(`SELECT count(*)::int AS n FROM fusion_core.saved_searches WHERE project_id = $1 AND user_id = 'u-admin'`, [BOOK]))[0].n === 1);
await page.click('[data-core-saved-delete]');
await sleep(800);
t('видалення', (await page.$$('[data-core-saved]')).length === 0);

console.log('\nТелефон:');
await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.goto(`${BASE}/projects/${BOOK}/search`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-core-search-input]', { timeout: 40000 });
// Бокове меню Студії на телефоні згортається (як робить автор) — сторінці лишається ширина екрана.
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
await sleep(600);
await page.click('[data-core-search-interpret]');
await page.type('[data-core-search-input]', 'Олени страх');
await page.click('[data-core-search-run]');
await page.waitForSelector('[data-core-search-hit]', { timeout: 20000 }).catch(() => null);
const overflow = await page.evaluate(() => {
  const el = document.querySelector('[data-core-search]') as HTMLElement;
  return { scroll: el.scrollWidth, client: el.clientWidth, width: el.getBoundingClientRect().width };
});
t('на ширині 390 px — без горизонтальної прокрутки, результати видно', overflow.scroll <= overflow.client + 1 && overflow.width >= 260 && (await page.$$('[data-core-search-hit]')).length > 0, JSON.stringify(overflow));
await page.screenshot({ path: path.join(DIR, 'search-mobile.png'), fullPage: false });
console.log(`  (знімки: ${DIR}/search-desktop.png, search-mobile.png; розділ абзацу — ${sectionOfFear})`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
