/**
 * Живий прогін сторінки 3 «Жива біографія персонажа» (Т1.5, журнал #256).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:character-profile
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер, без ключів моделей. Шлях автора:
 * «Профіль персонажа» → героїня книги → канон автора з картки окремо від
 * висновків ШІ; факт Profile Builder із джерелом — «Підтвердити» переносить
 * його в підтверджені; арка з тегів; «стан на главі 1» ховає пізніше й
 * картку автора; «Оновити профіль (ШІ)» без ключа чесно пише про збій;
 * джерело відкриває редактор на тому самому абзаці; телефон.
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
const DIR = path.join(os.tmpdir(), 'nova-character-profile');
const PORT = Number(process.env.CHARACTER_PROFILE_PORT || 34256);
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
const [olenaRow] = await q(`SELECT id, external_ref FROM fusion_core.entities WHERE project_id = $1 AND name = 'Олена Ковальчук'`, [BOOK]);
const olena = olenaRow.id as string;
t('героїня книги — сутність ядра, зв\'язана з карткою', /^studio:character:/.test(olenaRow.external_ref ?? ''));
const [fear] = await q(`INSERT INTO fusion_core.entities (project_id, type, name, status, created_by) VALUES ($1, 'emotion', 'тривога', 'confirmed', 'user:u-admin') RETURNING id`, [BOOK]);
await q(`INSERT INTO fusion_core.entity_mentions (project_id, entity_id, paragraph_id, span_start, span_end, source, status, subject_entity_id, fields)
  VALUES ($1, $2, $3, 0, 1, 'tag', 'confirmed', $4, '{"value":"тривога — 4"}')`, [BOOK, fear.id, pids[1], olena]);
await q(`INSERT INTO fusion_core.entity_mentions (project_id, entity_id, paragraph_id, span_start, span_end, source, status)
  VALUES ($1, $2, $3, 0, 1, 'tag', 'confirmed')`, [BOOK, olena, pids[2]]);
const [fact] = await q(`INSERT INTO fusion_core.analysis_findings (project_id, entity_id, kind, payload, source_paragraph_ids, created_by)
  VALUES ($1, $2, 'profile_fact', $3, $4, 'ai:AI-2') RETURNING id`,
  [BOOK, olena, JSON.stringify({ field: 'skill', statement: 'Олена керує імплантом зв\'язку силою думки.', assessment: 'supported', quote: 'живий прогін' }), [pids[2]]]);

console.log('\nСторінка героїні:');
await page.goto(`${BASE}/projects/${BOOK}/characters/${olena}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-profile-name]', { timeout: 40000 }).catch(() => null);
t('адреса /projects/<книга>/characters/<id> відкриває профіль', (await page.evaluate(() => document.querySelector('[data-profile-name]')?.textContent)) === 'Олена Ковальчук');
const canon = await page.evaluate(() => document.querySelector('[data-profile-section="canon"]')?.textContent ?? '');
t('канон автора — з картки «Персонажів», окремим блоком', /Роль/.test(canon) && /ШІ їх не змінює/.test(canon), canon.slice(0, 120));
const suggested = await page.evaluate((id: string) => {
  const el = document.querySelector(`[data-profile-section="suggested"] [data-profile-fact="${id}"]`) as HTMLElement | null;
  return el ? { text: el.innerText, source: el.querySelector('[data-profile-place]')?.getAttribute('data-profile-place') } : null;
}, fact.id);
t('факт ШІ — окремо, із джерелом-абзацом (критерій ТЗ-H №1)', !!suggested && /керує імплантом/.test(suggested.text) && suggested.source === pids[2], JSON.stringify(suggested?.source));
const arc = await page.evaluate(() => (document.querySelector('[data-profile-arc="initial"]') as HTMLElement)?.innerText ?? '');
t('арка: початковий стан — «тривога» з тега', /тривога/.test(arc), arc.slice(0, 80));
await page.screenshot({ path: path.join(DIR, 'profile.png') });

await page.evaluate((id: string) => (document.querySelector(`[data-profile-fact="${id}"] [data-profile-fact-confirm]`) as HTMLElement)?.click(), fact.id);
const st = await waitFor(() => q(`SELECT status FROM fusion_core.analysis_findings WHERE id = $1`, [fact.id]), (r) => r[0]?.status === 'confirmed', 10000);
await page.waitForSelector(`[data-profile-section="confirmed"] [data-profile-fact="${fact.id}"]`, { timeout: 10000 }).catch(() => null);
t('«Підтвердити» — факт у підтверджених, у ядрі confirmed', st[0]?.status === 'confirmed' && !!(await page.$(`[data-profile-section="confirmed"] [data-profile-fact="${fact.id}"]`)));

console.log('\nСтан на главі й Profile Builder:');
await page.select('[data-profile-upto]', '1');
await page.waitForSelector('[data-profile-spoiler-note]', { timeout: 10000 }).catch(() => null);
const note = await page.evaluate(() => document.querySelector('[data-profile-spoiler-note]')?.textContent ?? '');
const canonHidden = await page.evaluate(() => document.querySelector('[data-profile-section="canon"]')?.textContent ?? '');
t('«стан на главі 1» — пояснення й картка автора прихована (лише роль)', /главах 1–1/.test(note) && !/Біографія/.test(canonHidden), note.slice(0, 80));
await page.select('[data-profile-upto]', '');
await sleep(800);
await page.click('[data-profile-build]');
const msg = await waitFor(() => page.evaluate(() => document.querySelector('[data-profile-message]')?.textContent ?? ''), (m) => !!m, 30000);
const job = await q(`SELECT status FROM fusion_core.core_jobs WHERE project_id = $1 AND kind = 'ai_profile' ORDER BY created_at DESC LIMIT 1`, [BOOK]);
t('«Оновити профіль (ШІ)» без ключа — задача ai_profile, чесний збій, сторінка жива', job[0]?.status === 'failed' && !!msg && !!(await page.$('[data-profile-name]')), `${job[0]?.status}: ${msg.slice(0, 80)}`);

console.log('\nПерехід у редактор:');
await page.evaluate((id: string) => (document.querySelector(`[data-profile-fact="${id}"] [data-profile-open]`) as HTMLElement)?.click(), fact.id);
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
t('джерело факту — редактор на тому самому абзаці, виділеному', sel?.pid === pids[2] && sel.len > 10, JSON.stringify(sel));

console.log('\nТелефон:');
await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.goto(`${BASE}/projects/${BOOK}/characters/${olena}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-profile-name]', { timeout: 40000 });
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
await sleep(1000);
const m = await page.evaluate(() => {
  const el = document.querySelector('[data-character-profile]') as HTMLElement;
  const box = el.getBoundingClientRect();
  const wide = Array.from(el.querySelectorAll('*')).filter((x) => x.getBoundingClientRect().right > box.right + 1).slice(0, 3).map((x) => `${x.tagName}.${String((x as HTMLElement).className).slice(0, 40)}`);
  return { scroll: el.scrollWidth, client: el.clientWidth, wide };
});
t('на 390 px — без горизонтальної прокрутки', m.scroll <= m.client + 1 && m.client >= 220, JSON.stringify(m));
await page.screenshot({ path: path.join(DIR, 'profile-mobile.png') });
console.log(`  (знімки: ${DIR}/profile.png, profile-mobile.png)`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
