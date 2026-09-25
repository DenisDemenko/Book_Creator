/**
 * Живий прогін сторінки 2 «Граф історії» (Т1.4, журнал #255).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:story-graph
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер. Шлях автора: відкрити
 * /projects/<книга>/story-graph — вузли сутностей книги кольорами реєстру;
 * клік по героїні — картка з підтвердженими зв'язками першого рівня й
 * абзацами-джерелами (критерій); пропозицію ШІ підтвердити; перейти з
 * джерела в редактор на той самий абзац; знайти вузол пошуком; відфільтрувати
 * за типом; додати зв'язок вручну; телефон.
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
const DIR = path.join(os.tmpdir(), 'nova-story-graph');
const PORT = Number(process.env.STORY_GRAPH_PORT || 34255);
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
  () => q(`SELECT id FROM fusion_core.paragraphs WHERE project_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`, [BOOK, pids]),
  (rows) => rows.length >= 4,
);
t('абзаци розділу — у ядрі', synced.length >= 4, `${synced.length}`);
const ent = async (name: string) => (await q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = $2`, [BOOK, name]))[0]?.id as string;
const olena = await ent('Олена Ковальчук');
const svarog = await ent('Сварог-9');
const taras = await ent('Тарас Вальц');
t('герої книги — сутності ядра', !!olena && !!svarog && !!taras);
const [rel] = await q(`INSERT INTO fusion_core.entity_relations (project_id, type, from_id, to_id, status, evidence, note, created_by)
  VALUES ($1, 'opposes', $2, $3, 'confirmed', $4, 'живий прогін', 'user:u-admin') RETURNING id`, [BOOK, svarog, olena, [pids[1]]]);
const [sug] = await q(`INSERT INTO fusion_core.entity_relations (project_id, type, from_id, to_id, status, evidence, created_by)
  VALUES ($1, 'follows', $2, $3, 'suggested', $4, 'ai:AI-1') RETURNING id`, [BOOK, taras, olena, [pids[2]]]);
const [fear] = await q(`INSERT INTO fusion_core.entities (project_id, type, name, status, created_by) VALUES ($1, 'emotion', 'тривога', 'confirmed', 'user:u-admin') RETURNING id`, [BOOK]);
await q(`INSERT INTO fusion_core.entity_mentions (project_id, entity_id, paragraph_id, span_start, span_end, source, status, subject_entity_id)
  VALUES ($1, $2, $3, 0, 1, 'tag', 'confirmed', $4)`, [BOOK, fear.id, pids[3], olena]);

console.log('\nГраф:');
await page.goto(`${BASE}/projects/${BOOK}/story-graph`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.react-flow__node', { timeout: 40000 }).catch(() => null);
await sleep(800);
const nodeNames = await page.evaluate(() => Array.from(document.querySelectorAll('.react-flow__node')).map((n) => n.textContent || ''));
t('сторінка /story-graph: вузли сутностей книги', nodeNames.some((n) => n.includes('Олена Ковальчук')) && nodeNames.some((n) => n.includes('Сварог-9')), `${nodeNames.length} вузлів`);
const edgeLabels = await page.evaluate(() => Array.from(document.querySelectorAll('.react-flow__edge-text')).map((e) => e.textContent));
t('ребра підписані типами зв\'язків', edgeLabels.includes('Протидіє') && edgeLabels.includes('Переживає'), edgeLabels.join(', '));
const colors = await page.evaluate(() => {
  const el = Array.from(document.querySelectorAll('[data-graph-node-type="character"]'))[0] as HTMLElement | undefined;
  return el ? getComputedStyle(el).backgroundColor : '';
});
t('колір вузла — з реєстру (персонаж)', !!colors && colors !== 'rgba(0, 0, 0, 0)', colors);
await page.screenshot({ path: path.join(DIR, 'graph-overview.png') });

console.log('\nКритерій — клік по героїні:');
await page.evaluate((id: string) => (document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement)?.click(), olena);
await page.waitForSelector(`[data-graph-card="${olena}"] [data-graph-confirmed]`, { timeout: 15000 }).catch(() => null);
const cardInfo = await page.evaluate((ids: string[]) => {
  const card = document.querySelector(`[data-graph-card="${ids[0]}"]`) as HTMLElement | null;
  if (!card) return null;
  const confirmed = card.querySelector('[data-graph-confirmed]') as HTMLElement | null;
  const relRow = card.querySelector(`[data-graph-edge="${ids[1]}"]`) as HTMLElement | null;
  return {
    confirmedText: confirmed?.innerText ?? '',
    evidence: relRow ? Array.from(relRow.querySelectorAll('[data-graph-evidence]')).map((e) => e.getAttribute('data-graph-evidence')) : [],
    suggested: !!card.querySelector('[data-graph-suggested]'),
  };
}, [olena, rel.id]);
t('КРИТЕРІЙ: картка героїні — підтверджені зв\'язки першого рівня', !!cardInfo && /Сварог-9/.test(cardInfo.confirmedText) && /Протидіє/.test(cardInfo.confirmedText) && /тривога/.test(cardInfo.confirmedText), cardInfo?.confirmedText.slice(0, 120));
t('…з джерелами — абзац, на який посилається зв\'язок', cardInfo?.evidence.join() === pids[1], JSON.stringify(cardInfo?.evidence));
t('пропозиція ШІ — окремо', !!cardInfo?.suggested);
await page.screenshot({ path: path.join(DIR, 'graph-card.png') });

await page.evaluate((id: string) => (document.querySelector(`[data-graph-edge="${id}"] [data-graph-confirm]`) as HTMLElement)?.click(), sug.id);
const st = await waitFor(() => q(`SELECT status FROM fusion_core.entity_relations WHERE id = $1`, [sug.id]), (r) => r[0]?.status === 'confirmed', 10000);
t('«Підтвердити» пропозицію ШІ — у ядрі confirmed', st[0]?.status === 'confirmed');
await page.waitForFunction((id: string) => !!document.querySelector(`[data-graph-confirmed] [data-graph-edge="${id}"]`), { timeout: 10000 }, sug.id).catch(() => null);
t('…і перейшла в підтверджені на картці', !!(await page.$(`[data-graph-confirmed] [data-graph-edge="${sug.id}"]`)));

console.log('\nНовий зв\'язок:');
await page.select('[data-graph-new-type]', 'participates_in');
await page.select('[data-graph-new-target]', taras);
await page.click('[data-graph-new-save]');
const made = await waitFor(
  () => q(`SELECT status, created_by FROM fusion_core.entity_relations WHERE project_id = $1 AND type = 'participates_in' AND from_id = $2 AND to_id = $3`, [BOOK, olena, taras]),
  (r) => r.length > 0,
  10000,
);
t('створено вручну — підтверджений, від автора', made[0]?.status === 'confirmed' && made[0]?.created_by === 'user:u-admin');

console.log('\nПошук і фільтр:');
await page.click('[data-graph-search]', { clickCount: 3 });
await page.type('[data-graph-search]', 'Тарас');
await page.click('[data-graph-search-go]');
await page.waitForSelector(`[data-graph-card="${taras}"]`, { timeout: 10000 }).catch(() => null);
t('пошук вузла — картка знайденого', !!(await page.$(`[data-graph-card="${taras}"]`)));
await page.click('[data-graph-type="emotion"]');
const types = await waitFor(
  () => page.evaluate(() => Array.from(document.querySelectorAll('[data-graph-node-type]')).map((e) => e.getAttribute('data-graph-node-type'))),
  (v) => v.length > 0 && v.every((x) => x === 'emotion'),
  8000,
);
t('фільтр типу «Емоційний стан» — лише емоції', types.length > 0 && types.every((x) => x === 'emotion'), types.join());
await page.click('[data-graph-type="emotion"]');
await sleep(1200);

console.log('\nПерехід у редактор із джерела:');
await page.evaluate((id: string) => (document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement)?.click(), olena);
await page.waitForSelector(`[data-graph-edge="${rel.id}"] [data-graph-evidence-open]`, { timeout: 15000 }).catch(() => null);
await page.evaluate((id: string) => (document.querySelector(`[data-graph-edge="${id}"] [data-graph-evidence-open]`) as HTMLElement)?.click(), rel.id);
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
t('редактор на абзаці-джерелі, абзац виділено', sel?.pid === pids[1] && sel.len > 10, JSON.stringify(sel));

console.log('\nТелефон:');
await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.goto(`${BASE}/projects/${BOOK}/story-graph`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-graph-canvas]', { timeout: 40000 });
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
await sleep(1500);
const m = await page.evaluate(() => {
  const el = document.querySelector('[data-story-graph]') as HTMLElement;
  const c = document.querySelector('[data-graph-canvas]') as HTMLElement;
  return { scroll: el.scrollWidth, client: el.clientWidth, canvas: c.getBoundingClientRect().width, nodes: document.querySelectorAll('.react-flow__node').length };
});
t('на 390 px — полотно на всю ширину, без горизонтальної прокрутки', m.scroll <= m.client + 1 && m.canvas >= 260 && m.nodes > 0, JSON.stringify(m));
await page.screenshot({ path: path.join(DIR, 'graph-mobile.png') });
console.log(`  (знімки: ${DIR}/graph-overview.png, graph-card.png, graph-mobile.png)`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
