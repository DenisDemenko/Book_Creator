/**
 * Живий прогін пропозицій AI-1 (Т1.1, журнал #252).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:core-mentions
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер. Відповідь моделі тут не
 * перевіряється (у прогоні немає мережі до провайдерів — це робить
 * `test:core-mentions` з підставною моделлю): пропозиції кладуться в ядро
 * так, як їх кладе AI-1, а перевіряється шлях автора — панель показує
 * пропозиції розділу, «Підтвердити» ставить тег на початок саме того абзацу,
 * книга зберігається й синхронізується, у ядрі з'являється згадка;
 * «Відхилити» прибирає пропозицію; кнопка аналізу без ключа моделі показує
 * зрозумілу помилку, а не ламає панель.
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
const DIR = path.join(os.tmpdir(), 'nova-core-mentions');
const PORT = Number(process.env.CORE_MENTIONS_PORT || 34252);
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
await saveUser({ id: 'u-owner', email: 'owner@test.ua', name: 'Автор', role: 'writer', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-owner', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  // Жодних ключів моделей: «Знайти згадки» мусить чесно сказати, що моделі немає.
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
await page.setViewport({ width: 1600, height: 1000 });
await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
page.on('dialog', (d) => { void d.accept(); });

await page.goto(`${BASE}/projects/${BOOK}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 40000 });
await sleep(1500);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button,a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
// Легка правка — книга з номерами абзаців іде на сервер і в ядро.
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
  () => q(`SELECT id, text FROM fusion_core.paragraphs WHERE project_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`, [BOOK, pids]),
  (rows) => rows.length >= 3,
);
console.log('\nПідготовка:');
t('абзаци розділу — у ядрі з номерами канви', synced.length >= 3, `${synced.length} з ${pids.length}`);

// Пропозиції так, як їх записує AI-1 (kind mention_suggestion, suggested, від ai:AI-1).
const target = pids[1];
const other = pids[2];
const insert = (pid: string, payload: object) =>
  q(`INSERT INTO fusion_core.analysis_findings (project_id, kind, payload, source_paragraph_ids, created_by)
     VALUES ($1, 'mention_suggestion', $2, $3, 'ai:AI-1') RETURNING id`, [BOOK, JSON.stringify(payload), [pid]]);
const [s1] = await insert(target, { entityType: 'emotion', entityName: 'тривога', tag: '[/emotion:тривога — 4]', quote: 'живий прогін', confidence: 0.7, summary: 'тривога' });
const [s2] = await insert(other, { entityType: 'location', entityName: 'Поділ', tag: '[/location:Поділ]', confidence: 0.6, summary: 'місце' });
const textsBefore = (await page.evaluate(`(() => {
  const ed = document.querySelector('#book-content-editor-ua .ProseMirror').editor;
  const out = []; ed.state.doc.forEach((n) => out.push(n.textContent)); return out;
})()`)) as string[];

console.log('\nПанель пропозицій:');
await page.evaluate(() => (document.querySelector('[data-right-tab="entities"]') as HTMLElement | null)?.click());
await page.waitForSelector('[data-ai-suggestions]', { timeout: 15000 }).catch(() => null);
// Панель вантажить пропозиції при відкритті розділу — оновлюємо, перемкнувши вкладку.
await page.evaluate(() => (document.querySelector('[data-right-tab]:not([data-right-tab="entities"])') as HTMLElement | null)?.click());
await sleep(300);
await page.evaluate(() => (document.querySelector('[data-right-tab="entities"]') as HTMLElement | null)?.click());
await page.waitForSelector('[data-ai-suggestion]', { timeout: 15000 }).catch(() => null);
const shown = await page.evaluate(() => Array.from(document.querySelectorAll('[data-ai-suggestion]')).map((e) => e.textContent || ''));
t('панель показує обидві пропозиції розділу з тегом і уривком', shown.length === 2 && shown.some((x) => x.includes('[/emotion:тривога — 4]')), `${shown.length}`);

await page.evaluate((id: string) => (document.querySelector(`[data-ai-suggestion="${id}"] [data-ai-suggestion-confirm]`) as HTMLElement)?.click(), s1.id);
await sleep(800);
const textsAfter = (await page.evaluate(`(() => {
  const ed = document.querySelector('#book-content-editor-ua .ProseMirror').editor;
  const out = []; ed.state.doc.forEach((n) => out.push(n.textContent)); return out;
})()`)) as string[];
t('«Підтвердити» — тег на початку саме того абзацу', textsAfter[1].startsWith('[/emotion:тривога — 4]') || textsAfter[1].includes('[/emotion:тривога — 4] '), textsAfter[1].slice(0, 60));
t('інші абзаци не змінились', textsAfter.every((x, i) => i === 1 || x === textsBefore[i]));
t('пропозиція зникла з панелі', !(await page.$(`[data-ai-suggestion="${s1.id}"]`)));
const mention = await waitFor(
  () => q(`SELECT m.paragraph_id FROM fusion_core.entity_mentions m JOIN fusion_core.entities e ON e.id = m.entity_id
           WHERE m.project_id = $1 AND e.type = 'emotion' AND e.name = 'тривога'`, [BOOK]),
  (rows) => rows.length > 0,
);
t('книга збереглась і синхронізувалась: згадка «тривога» в ядрі — у тому самому абзаці', mention.length === 1 && mention[0].paragraph_id === target);
t('пропозиція в ядрі — підтверджена', (await q(`SELECT status FROM fusion_core.analysis_findings WHERE id = $1`, [s1.id]))[0].status === 'confirmed');

await page.evaluate((id: string) => (document.querySelector(`[data-ai-suggestion="${id}"] [data-ai-suggestion-reject]`) as HTMLElement)?.click(), s2.id);
await sleep(800);
t('«Відхилити» — зникла з панелі, у ядрі rejected, текст без змін',
  !(await page.$(`[data-ai-suggestion="${s2.id}"]`)) && (await q(`SELECT status FROM fusion_core.analysis_findings WHERE id = $1`, [s2.id]))[0].status === 'rejected' &&
  !((await page.evaluate(`document.querySelector('#book-content-editor-ua .ProseMirror').editor.getText()`)) as string).includes('[/location:Поділ]'));

console.log('\nКнопка аналізу без ключа моделі:');
await page.evaluate(() => (document.querySelector('[data-ai-suggestions-run]') as HTMLElement)?.click());
const msg = await waitFor(
  () => page.evaluate(() => document.querySelector('[data-ai-suggestions-message]')?.textContent ?? ''),
  (m) => !!m && !/Аналіз…/.test(m),
  30000,
);
t('задача пішла у фон і чесно закінчилась помилкою моделі, панель жива', !!msg && !!(await page.$('[data-ai-suggestions-run]')), msg.slice(0, 120));
const job = await q(`SELECT status, error FROM fusion_core.core_jobs WHERE project_id = $1 AND kind = 'ai_mentions' ORDER BY created_at DESC LIMIT 1`, [BOOK]);
t('у черзі — задача ai_mentions (failed без ключа)', job[0]?.status === 'failed', `${job[0]?.status}: ${String(job[0]?.error).slice(0, 80)}`);
await page.screenshot({ path: path.join(DIR, 'ai-suggestions.png') });
console.log(`  (знімок: ${path.join(DIR, 'ai-suggestions.png')})`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
