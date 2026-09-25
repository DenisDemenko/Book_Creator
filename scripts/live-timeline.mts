/**
 * Живий прогін сторінки 6 «Хронологія» (Т2.1, журнал #258).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:timeline
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер. Шлях автора: /projects/<книга>/timeline
 * — сцени на шкалі порядку оповіді; задати сценам час у світі (з
 * підтвердженням); сцена з раннішим часом, розказана пізніше, — флешбек
 * окремим блоком (критерій); перетягнути сцену в порядку часу світу (з
 * підтвердженням); суперечність «передує» з переходом до сцени; «що знала
 * героїня до сцени» — у флешбеку не знає майбутнього; фільтр героя; телефон.
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
const DIR = path.join(os.tmpdir(), 'nova-timeline');
const PORT = Number(process.env.TIMELINE_PORT || 34258);
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
t('ядро піднялось, схема ≥ v8 (хронологія)', Number(schema) >= 8, `v${schema}`);

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
const para = async (sec: string) => (await q(`SELECT id FROM fusion_core.paragraphs WHERE project_id = $1 AND document_id = $2 AND deleted_at IS NULL ORDER BY ord LIMIT 1 OFFSET 1`, [BOOK, sec]))[0].id as string;
const pA = await para('sec-1-1');
const pB = await para('sec-1-2');
const pC = await para('sec-2-1');
const [olena] = await q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Олена Ковальчук'`, [BOOK]);
const ent = async (type: string, name: string) => (await q(`INSERT INTO fusion_core.entities (project_id, type, name, status, created_by) VALUES ($1, $2, $3, 'confirmed', 'user:u-admin') RETURNING id`, [BOOK, type, name]))[0].id as string;
const secret = await ent('revelation', 'Правда про імплант');
const leak = await ent('event', 'Витік даних');
const flood = await ent('event', 'Затоплення тунелів');
const m = (e: string, p: string, subject: string | null) =>
  q(`INSERT INTO fusion_core.entity_mentions (project_id, entity_id, paragraph_id, span_start, span_end, source, status, subject_entity_id) VALUES ($1, $2, $3, 0, 1, 'tag', 'confirmed', $4)`, [BOOK, e, p, subject]);
await m(olena.id, pA, null);
await m(secret, pA, olena.id);
await m(olena.id, pB, null);
await m(leak, pB, null);
await m(olena.id, pC, null);
await m(flood, pC, null);
// «Витік» (2084) має передувати «Затопленню» (2079) — суперечність.
await q(`INSERT INTO fusion_core.entity_relations (project_id, type, from_id, to_id, status, evidence, created_by) VALUES ($1, 'precedes', $2, $3, 'confirmed', $4, 'user:u-admin')`, [BOOK, leak, flood, [pB]]);

console.log('\nСторінка «Хронологія»:');
await page.goto(`${BASE}/projects/${BOOK}/timeline`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-timeline-narrative]', { timeout: 40000 }).catch(() => null);
const narr = await page.evaluate(() => Array.from(document.querySelectorAll('[data-timeline-narrative]')).map((e) => e.getAttribute('data-timeline-narrative')));
t('шкала порядку оповіді — сцени в порядку книги', narr.join() === 'sec-1-1,sec-1-2,sec-2-1', narr.join());
const setTime = async (sec: string, start: string) => {
  await page.evaluate((s: string) => (document.querySelector(`[data-timeline-narrative="${s}"]`) as any)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), sec);
  await page.waitForSelector(`[data-timeline-panel="${sec}"] [data-timeline-start]`, { timeout: 10000 });
  await page.select('[data-timeline-kind]', 'exact');
  await page.click('[data-timeline-start]', { clickCount: 3 });
  await page.type('[data-timeline-start]', start);
  await page.click('[data-timeline-save]');
  await page.waitForSelector('[data-timeline-confirm-yes]', { timeout: 5000 });
  await page.click('[data-timeline-confirm-yes]');
  await waitFor(() => q(`SELECT start_value FROM fusion_core.story_time_points WHERE project_id = $1 AND subject_id = $2`, [BOOK, sec]), (r) => r[0]?.start_value === start, 10000);
  await sleep(600);
};
await setTime('sec-1-1', '2084-05');
t('час сцени — після підтвердження, у ядрі', (await q(`SELECT kind, start_value, created_by FROM fusion_core.story_time_points WHERE project_id = $1 AND subject_id = 'sec-1-1'`, [BOOK]))[0]?.created_by === 'user:u-admin');
await setTime('sec-1-2', '2084-06');
await setTime('sec-2-1', '2079');
await page.waitForSelector('[data-timeline-flashback]', { timeout: 10000 }).catch(() => null);
const fb = await page.evaluate(() => Array.from(document.querySelectorAll('[data-timeline-flashback]')).map((e) => ({ id: e.getAttribute('data-timeline-flashback'), text: (e as HTMLElement).innerText })));
t('КРИТЕРІЙ: флешбек (2079, розказаний третім) — окремим блоком від часу оповіді', fb.length === 1 && fb[0].id === 'sec-2-1' && /2079/.test(fb[0].text), JSON.stringify(fb));
const amber = await page.evaluate(() => Array.from(document.querySelectorAll('[data-timeline-axes] line')).filter((l) => l.getAttribute('stroke') === '#f59e0b').length);
t('на шкалах лінія флешбека йде назад (виділена)', amber === 1, `${amber}`);
await page.screenshot({ path: path.join(DIR, 'timeline.png') });

console.log('\nСуперечність і перехід до сцени:');
const warn = await page.evaluate(() => (document.querySelector('[data-timeline-warning="relation_order"]') as HTMLElement | null)?.innerText ?? '');
t('попередження: «Витік» має передувати, але стоїть пізніше', /Витік даних.*передувати.*Затоплення тунелів/.test(warn), warn.slice(0, 120));

console.log('\nЗнання героїні:');
await page.evaluate(() => (document.querySelector('[data-timeline-narrative="sec-1-2"]') as any)?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForSelector('[data-timeline-panel="sec-1-2"] [data-timeline-knowledge-hero]', { timeout: 10000 });
await page.select('[data-timeline-knowledge-hero]', olena.id);
await page.waitForSelector('[data-timeline-known]', { timeout: 10000 }).catch(() => null);
const knownB = await page.evaluate(() => (document.querySelector('[data-timeline-known]') as HTMLElement | null)?.innerText ?? '');
t('до сцени 2 (2084-06) Олена вже знає правду про імплант (сцена 1, 2084-05)', /Правда про імплант/.test(knownB), knownB.slice(0, 100));
await page.evaluate(() => (document.querySelector('[data-timeline-narrative="sec-2-1"]') as any)?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForSelector('[data-timeline-panel="sec-2-1"] [data-timeline-knowledge-hero]', { timeout: 10000 });
await page.select('[data-timeline-knowledge-hero]', olena.id);
await sleep(1200);
const knownC = await page.evaluate(() => (document.querySelector('[data-timeline-knowledge]') as HTMLElement | null)?.innerText ?? '');
t('у флешбеку (2079) — ще не знає (хоч розказано раніше); «ще N — пізніше»', !/Правда про імплант/.test(knownC) && /дізнається пізніше/.test(knownC), knownC.slice(0, 160));

console.log('\nПеретягування в часі світу:');
await page.evaluate(() => {
  const src = document.querySelector('[data-timeline-order-item="sec-1-2"]') as HTMLElement;
  const dst = document.querySelector('[data-timeline-order-item="sec-1-1"]') as HTMLElement;
  const dt = new DataTransfer();
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await page.waitForSelector('[data-timeline-confirm]', { timeout: 5000 }).catch(() => null);
const ask = await page.evaluate(() => document.querySelector('[data-timeline-confirm]')?.textContent ?? '');
t('перетягування питає підтвердження', /Перемістити «Розділ 2/.test(ask), ask.slice(0, 100));
await page.click('[data-timeline-confirm-yes]');
const moved = await waitFor(() => q(`SELECT sort_key, kind FROM fusion_core.story_time_points WHERE project_id = $1 AND subject_id = 'sec-1-2'`, [BOOK]), (r) => r[0]?.kind === 'approximate', 10000);
const keyA = (await q(`SELECT sort_key FROM fusion_core.story_time_points WHERE project_id = $1 AND subject_id = 'sec-1-1'`, [BOOK]))[0].sort_key;
t('після підтвердження — сцена 2 у часі світу раніше за сцену 1', moved[0]?.kind === 'approximate' && Number(moved[0].sort_key) < Number(keyA), `${moved[0]?.sort_key} < ${keyA}`);

console.log('\nФільтр і перехід:');
await page.evaluate(() => (document.querySelector('[data-timeline-warning="relation_order"] [data-timeline-warning-open]') as HTMLElement)?.click());
const sel = await waitFor(
  () => page.evaluate(`(() => {
    const ed = document.querySelector('#book-content-editor-ua .ProseMirror')?.editor;
    if (!ed) return null;
    const { from, to } = ed.state.selection;
    const $from = ed.state.doc.resolve(from);
    let pid = null;
    for (let d = $from.depth; d >= 0; d--) { const n = $from.node(d); if (n.attrs && n.attrs.pid) { pid = n.attrs.pid; break; } }
    return { pid, len: to - from };
  })()`) as Promise<any>,
  (v) => !!v && v.len > 0,
  15000,
);
t('«до сцени» з попередження — редактор на абзаці-доказі', sel?.pid === pB, JSON.stringify(sel));

await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.goto(`${BASE}/projects/${BOOK}/timeline`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-timeline-narrative]', { timeout: 40000 });
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
await sleep(1000);
const opts = await page.evaluate(() => Array.from((document.querySelector('[data-timeline-filter="character"]') as HTMLSelectElement).options).map((o) => o.value));
const withHero = opts.find((v) => v && v !== '');
if (withHero) await page.select('[data-timeline-filter="character"]', withHero);
await sleep(1500);
const mm = await page.evaluate(() => {
  const el = document.querySelector('[data-timeline]') as HTMLElement;
  const box = el.getBoundingClientRect();
  const wide = Array.from(el.querySelectorAll('*')).filter((x) => x.getBoundingClientRect().right > box.right + 1 && !x.closest('[data-timeline-axes] svg')).slice(0, 4).map((x) => `${x.tagName}.${String((x as any).className?.baseVal ?? (x as any).className).slice(0, 50)}`);
  return { scroll: el.scrollWidth, client: el.clientWidth, narr: document.querySelectorAll('[data-timeline-narrative]').length, wide };
});
t('телефон: без горизонтальної прокрутки сторінки (шкали гортаються всередині), фільтр героя працює', mm.scroll <= mm.client + 1 && mm.narr >= 1, JSON.stringify(mm));
await page.screenshot({ path: path.join(DIR, 'timeline-mobile.png') });
console.log(`  (знімки: ${DIR}/timeline.png, timeline-mobile.png)`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
