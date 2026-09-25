/**
 * Живий прогін сторінки 4 «Емоційний монітор» (Т2.2, журнал #259).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:emotions
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер. Шлях автора: /projects/<книга>/emotions
 * — крива страху героїні (з тегів із силою); КРИТЕРІЙ: маркер кривої →
 * «Докази» з абзацами → перехід до абзацу в редакторі; «до / після» події з
 * доказами; шкала часу світу (Т2.1) і показник «майстерність» з позначкою
 * «недостатньо даних»; ручне коригування точки з тега без зміни тексту і
 * його скасування; пропозиція AI-2 — підтвердити з уточненою силою,
 * «недостатньо даних» від AI — лише прибрати; своя точка і її видалення з
 * підтвердженням; усі герої — емоція без героя; таблиця; чужий — 403; телефон.
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
const DIR = path.join(os.tmpdir(), 'nova-emotions');
const PORT = Number(process.env.EMOTIONS_PORT || 34259);
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
t('ядро піднялось, схема ≥ v9 (емоційний монітор)', Number(schema) >= 9, `v${schema}`);

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
const fear = await ent('emotion', 'страх');
const sad = await ent('emotion', 'смуток');
const leak = await ent('event', 'Витік даних');
const m = (e: string, p: string, subject: string | null, value = '') =>
  q(`INSERT INTO fusion_core.entity_mentions (project_id, entity_id, paragraph_id, span_start, span_end, source, status, subject_entity_id, fields) VALUES ($1, $2, $3, 0, 1, 'tag', 'confirmed', $4, $5)`, [BOOK, e, p, subject, JSON.stringify({ value })]);
// Глава 1: страх 3; «Витік даних»; глава 2: страх 9 і смуток без героя.
await m(olena.id, pA, null);
await m(fear, pA, olena.id, 'страх — 3');
await m(olena.id, pB, null);
await m(leak, pB, null);
await m(olena.id, pC, null);
await m(fear, pC, olena.id, 'страх — 9');
await m(sad, pC, null, 'смуток');
const [sug] = await q(
  `INSERT INTO fusion_core.analysis_findings (project_id, entity_id, kind, payload, source_paragraph_ids, status, created_by)
   VALUES ($1, $2, 'emotion_point', $3, $4, 'suggested', 'ai:AI-2') RETURNING id`,
  [BOOK, olena.id, JSON.stringify({ emotion: 'надія', family: 'hope', layer: 'secondary', intensity: 4, craft: 6, statement: 'Олена вірить, що встигне.', quote: 'встигне' }), [pB]],
);
const [ins] = await q(
  `INSERT INTO fusion_core.analysis_findings (project_id, entity_id, kind, payload, source_paragraph_ids, status, insufficient_data, created_by)
   VALUES ($1, $2, 'emotion_point', $3, '{}', 'suggested', true, 'ai:AI-2') RETURNING id`,
  [BOOK, olena.id, JSON.stringify({ emotion: 'гнів', family: 'anger', statement: 'Натяк, доказу замало.', insufficient: true })],
);

console.log('\nСторінка «Емоційний монітор»:');
await page.goto(`${BASE}/projects/${BOOK}/emotions`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-emotions-series]', { timeout: 40000 }).catch(() => null);
const series = await page.evaluate(() => Array.from(document.querySelectorAll('[data-emotions-series]')).map((e) => e.getAttribute('data-emotions-series')));
t('крива страху Олени по главах (героїня з найбільшою кількістю точок — одразу)', series.includes('Олена Ковальчук:fear'), series.join());
t('вибрано героїню автоматично', await page.evaluate((id: string) => document.querySelector(`[data-emotions-hero="${id}"]`)?.getAttribute('aria-pressed') === 'true', olena.id));
const totals = await waitFor(() => page.evaluate(() => document.querySelector('[data-emotions-totals]')?.textContent ?? ''), (v) => /з тегів 2/.test(v), 10000);
t('лічильник джерел: з тегів 2 (у героїні)', /з тегів 2/.test(totals), totals);
t('мітка події на шкалі — «Витік даних»', await page.evaluate((id: string) => !!document.querySelector(`[data-emotions-event-tick="${id}"]`), leak));
await page.screenshot({ path: path.join(DIR, 'emotions.png') });

console.log('\nКРИТЕРІЙ — оцінка → абзаци → текст:');
await page.evaluate(() => (document.querySelector('[data-emotions-average="Олена Ковальчук:fear:1"]') as any)?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForSelector('[data-emotions-evidence]', { timeout: 5000 }).catch(() => null);
const ev = await page.evaluate(() => ({
  title: document.querySelector('[data-emotions-evidence] h3')?.textContent ?? '',
  items: Array.from(document.querySelectorAll('[data-emotions-evidence-item]')).map((e) => e.getAttribute('data-emotions-evidence-item')),
}));
t('середнє гл. 2 (9) відкривається до свого абзацу', /гл\. 2 — середнє 9/.test(ev.title) && ev.items.join() === pC, JSON.stringify(ev));
await page.click('[data-emotions-evidence-open]');
const sel1 = await waitFor(
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
t('«до тексту» з доказів — редактор на абзаці (страх 9)', sel1?.pid === pC, JSON.stringify(sel1));
await page.goto(`${BASE}/projects/${BOOK}/emotions`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-emotions-series="Олена Ковальчук:fear"]', { timeout: 40000 });

console.log('\nДо / після події:');
await page.select('[data-emotions-event]', leak);
await page.select('[data-emotions-window]', '1');
await page.waitForSelector('[data-emotions-impact-row]', { timeout: 10000 }).catch(() => null);
const imp = await page.evaluate(() => Array.from(document.querySelectorAll('[data-emotions-impact-row]')).map((e) => ({ k: e.getAttribute('data-emotions-impact-row'), text: e.textContent })));
const fearImp = imp.find((r) => r.k === 'Олена Ковальчук:fear');
t('«Витік даних» — страх Олени 3 → 9, ▲ +6', !!fearImp && /3 → 9/.test(fearImp.text ?? '') && /\+6/.test(fearImp.text ?? ''), JSON.stringify(imp));
await page.click('[data-emotions-impact-row="Олена Ковальчук:fear"]');
const impEv = await waitFor(() => page.evaluate(() => Array.from(document.querySelectorAll('[data-emotions-evidence-item]')).map((e) => e.getAttribute('data-emotions-evidence-item'))), (v) => v.length > 0, 5000);
t('рядок «до / після» відкривається до обох абзаців', impEv.sort().join() === [pA, pC].sort().join(), JSON.stringify(impEv));
t('подія позначена на графіку', await page.evaluate(() => !!document.querySelector('[data-emotions-event-mark]')));
await page.select('[data-emotions-event]', '');

console.log('\nШкала часу світу і показники:');
const tp = (sec: string, v: string, key: number) => q(`INSERT INTO fusion_core.story_time_points (project_id, subject_kind, subject_id, kind, start_value, sort_key, created_by) VALUES ($1, 'scene', $2, 'exact', $3, $4, 'user:u-admin')`, [BOOK, sec, v, key]);
await tp('sec-1-1', '2084', 2084);
await tp('sec-2-1', '2079', 2079);
await page.select('[data-emotions-axis]', 'world');
await page.click('[data-emotions-table-toggle]');
const wt = await waitFor(() => page.evaluate(() => ({
  head: Array.from(document.querySelectorAll('[data-emotions-table] thead th')).map((e) => e.textContent),
  row: Array.from(document.querySelectorAll('[data-emotions-table] tbody tr')).map((r) => r.textContent).find((x) => /страх/.test(x ?? '')) ?? '',
})), (v) => v.head.includes('2079'), 10000);
// Сцена без точки часу бере порядок у світі зі Студії (Scene.timelineOrder) — як у «Хронології».
t('шкала часу світу (Т2.1): 2079 → 2084, страх Олени 9 → 3 (флешбек зліва)', wt.head.slice(-2).join() === '2079,2084' && /страх—?93$/.test(wt.row.replace(/\s/g, '')), JSON.stringify(wt));
await page.click('[data-emotions-table-toggle]');
await page.select('[data-emotions-axis]', 'chapter');
await page.select('[data-emotions-metric]', 'craft');
const uns = await waitFor(() => page.evaluate(() => document.querySelector('[data-emotions-unscored]')?.textContent ?? ''), (v) => v.length > 0, 10000);
t('показник «майстерність передачі»: теги без оцінки — «недостатньо даних»', /Недостатньо даних: 2/.test(uns), uns);
await page.select('[data-emotions-metric]', 'intensity');
await page.waitForSelector('[data-emotions-series="Олена Ковальчук:fear"]', { timeout: 10000 });

console.log('\nРучне коригування точки з тега:');
const tagPt = (await q(`SELECT id FROM fusion_core.entity_mentions WHERE project_id = $1 AND paragraph_id = $2 AND entity_id = $3`, [BOOK, pC, fear]))[0].id;
await page.evaluate((id: string) => (document.querySelector(`[data-emotions-point="${id}"]`) as any)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), tagPt);
await page.waitForSelector('[data-emotions-panel] [data-emotions-correct-save]', { timeout: 5000 }).catch(() => null);
const panel = await page.evaluate(() => (document.querySelector('[data-emotions-panel]') as HTMLElement | null)?.textContent ?? '');
t('панель точки: героїня, емоція, сила, джерело, «текст не зміниться»', /Олена Ковальчук: страх — 9/.test(panel) && /тег у тексті/.test(panel) && /текст книги й тег не зміняться/.test(panel), panel.slice(0, 160));
await page.focus('[data-emotions-correct-intensity]');
for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
await page.select('[data-emotions-correct-craft]', '4');
await page.click('[data-emotions-correct-save]');
const corr = await waitFor(() => q(`SELECT id, intensity, craft, source FROM fusion_core.emotion_points WHERE project_id = $1 AND paragraph_id = $2`, [BOOK, pC]), (r) => r.length === 1, 10000);
t('скориговано: 9 → 6, майстерність 4 — у ядрі від автора', corr[0]?.intensity === 6 && corr[0]?.craft === 4 && corr[0]?.source === 'author', JSON.stringify(corr));
const text = (await q(`SELECT text FROM fusion_core.paragraphs WHERE project_id = $1 AND id = $2`, [BOOK, pC]))[0].text;
const panel2 = await waitFor(() => page.evaluate(() => (document.querySelector('[data-emotions-panel]') as HTMLElement | null)?.textContent ?? ''), (v) => /скориговано автором/.test(v), 10000);
t('панель: «скориговано автором (у тезі 9)»; текст абзацу той самий', /скориговано автором \(у тезі 9\)/.test(panel2) && typeof text === 'string' && text.length > 0, panel2.slice(0, 160));
await page.click('[data-emotions-delete]');
await page.waitForSelector('[data-emotions-delete-confirm] button', { timeout: 5000 });
t('скасування питає підтвердження', /Скасувати коригування/.test(await page.evaluate(() => document.querySelector('[data-emotions-delete-confirm]')?.textContent ?? '')));
await page.click('[data-emotions-delete-confirm] button');
t('після «Так» — знову як у тезі', (await waitFor(() => q(`SELECT id FROM fusion_core.emotion_points WHERE project_id = $1 AND paragraph_id = $2`, [BOOK, pC]), (r) => r.length === 0, 10000)).length === 0);

console.log('\nПропозиції AI-2:');
await page.waitForSelector(`[data-emotions-suggestion="${sug.id}"]`, { timeout: 10000 }).catch(() => null);
const insCard = await page.evaluate((id: string) => ({ badge: !!document.querySelector(`[data-emotions-suggestion="${id}"] [data-emotions-insufficient]`), confirm: !!document.querySelector(`[data-emotions-confirm="${id}"]`) }), ins.id);
t('«недостатньо даних» від AI — з позначкою, без «Підтвердити»', insCard.badge && !insCard.confirm, JSON.stringify(insCard));
await page.focus(`[data-emotions-strength="${sug.id}"]`);
for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
await page.click(`[data-emotions-confirm="${sug.id}"]`);
const confirmed = await waitFor(() => q(`SELECT intensity, craft, layer, source, finding_id FROM fusion_core.emotion_points WHERE project_id = $1`, [BOOK]), (r) => r.length === 1, 10000);
t('ГОТОВО: підтверджено з уточненою силою 4 → 7 (шар і майстерність — від AI)', confirmed[0]?.intensity === 7 && confirmed[0]?.craft === 6 && confirmed[0]?.layer === 'secondary' && confirmed[0]?.source === 'ai' && confirmed[0]?.finding_id === sug.id, JSON.stringify(confirmed));
t('висновок — confirmed', (await q(`SELECT status FROM fusion_core.analysis_findings WHERE id = $1`, [sug.id]))[0]?.status === 'confirmed');
await page.waitForSelector('[data-emotions-series="Олена Ковальчук:hope"]', { timeout: 10000 }).catch(() => null);
t('з\'явилась крива «надія»', await page.evaluate(() => !!document.querySelector('[data-emotions-series="Олена Ковальчук:hope"]')));
await page.click(`[data-emotions-reject="${ins.id}"]`);
t('«недостатньо даних» прибрано', (await waitFor(() => q(`SELECT status FROM fusion_core.analysis_findings WHERE id = $1`, [ins.id]), (r) => r[0]?.status === 'rejected', 10000))[0]?.status === 'rejected');
await page.select('[data-emotions-event]', leak);
await sleep(1500);
await page.screenshot({ path: path.join(DIR, 'emotions-full.png'), fullPage: true });
await page.select('[data-emotions-event]', '');

console.log('\nСвоя точка:');
await page.waitForSelector('[data-emotions-add-paragraph]', { timeout: 10000 });
await page.select('[data-emotions-add-paragraph]', pA);
await page.type('[data-emotions-add-emotion]', 'Рішучість');
await page.select('[data-emotions-add-layer]', 'hidden');
await page.select('[data-emotions-add-impact]', '8');
await page.click('[data-emotions-add-save]');
const own = await waitFor(() => q(`SELECT id, emotion, family, layer, intensity, impact, craft, created_by FROM fusion_core.emotion_points WHERE project_id = $1 AND source = 'author'`, [BOOK]), (r) => r.length === 1, 10000);
t('точка автора: рішучість 5, прихована, вплив 8, майстерність не оцінено', own[0]?.emotion === 'рішучість' && own[0]?.family === 'resolve' && own[0]?.layer === 'hidden' && own[0]?.intensity === 5 && own[0]?.impact === 8 && own[0]?.craft === null && own[0]?.created_by === 'user:u-admin', JSON.stringify(own));
await page.waitForSelector(`[data-emotions-point="${own[0]?.id}"]`, { timeout: 10000 }).catch(() => null);
await page.evaluate((id: string) => (document.querySelector(`[data-emotions-point="${id}"]`) as any)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), own[0]?.id);
await page.waitForSelector('[data-emotions-delete]', { timeout: 5000 });
await page.click('[data-emotions-delete]');
await page.waitForSelector('[data-emotions-delete-confirm] button', { timeout: 5000 });
t('видалення питає підтвердження', /Прибрати цю точку/.test(await page.evaluate(() => document.querySelector('[data-emotions-delete-confirm]')?.textContent ?? '')));
await page.click('[data-emotions-delete-confirm] button');
const gone = await waitFor(() => q(`SELECT id FROM fusion_core.emotion_points WHERE project_id = $1 AND source = 'author'`, [BOOK]), (r) => r.length === 0, 10000);
t('після «Так» — точку прибрано', gone.length === 0);

console.log('\nУсі герої, таблиця, права:');
await page.click('[data-emotions-hero="all"]');
const warn = await waitFor(() => page.evaluate(() => document.querySelector('[data-emotions-warning="no_subject"]')?.textContent ?? ''), (v) => v.length > 0, 10000);
t('емоція без героя — попередження з підказкою @Ім\'я', /Емоцій без героя: 1/.test(warn) && /@Ім'я/.test(warn), warn.slice(0, 120));
await page.click('[data-emotions-table-toggle]');
const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-emotions-table] tbody tr')).map((r) => r.textContent));
t('таблиця замість графіка: страх — 3 і 9 по главах', rows.some((r) => /страх/.test(r ?? '') && /3/.test(r ?? '') && /9/.test(r ?? '')), JSON.stringify(rows));
await page.click('[data-emotions-table-toggle]');
t('чужому API — 403', (await api('GET', `/api/projects/${BOOK}/emotions`, undefined, TOKEN_X)).status === 403);

await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.goto(`${BASE}/projects/${BOOK}/emotions`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-emotions-series]', { timeout: 40000 });
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
await sleep(1000);
const mm = await page.evaluate(() => {
  const el = document.querySelector('[data-emotions]') as HTMLElement;
  const box = el.getBoundingClientRect();
  const wide = Array.from(el.querySelectorAll('*')).filter((x) => x.getBoundingClientRect().right > box.right + 1 && !x.closest('[data-emotions-svg]')).slice(0, 4).map((x) => `${x.tagName}.${String((x as any).className?.baseVal ?? (x as any).className).slice(0, 50)}`);
  return { scroll: el.scrollWidth, client: el.clientWidth, wide };
});
t('телефон: без горизонтальної прокрутки сторінки (графік гортається всередині)', mm.scroll <= mm.client + 1 && mm.wide.length === 0, JSON.stringify(mm));
await page.screenshot({ path: path.join(DIR, 'emotions-mobile.png'), fullPage: true });
console.log(`  (знімки: ${DIR}/emotions.png, emotions-mobile.png)`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
