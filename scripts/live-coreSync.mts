/**
 * Живий прогін синхронізації книги з ядром (Т0.6, журнал #249).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:core-sync
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер зі справжнім PostgreSQL і браузер: автор відкриває книгу →
 * вона зберігається на сервері → фонова задача `core_sync` кладе абзаци в
 * ядро з тими самими номерами, що в канві. Автор дописує тег — через кілька
 * секунд у ядрі з'являється згадка з суб'єктом, а текст книги на сервері
 * лишається таким, яким його надіслав редактор.
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
const DIR = path.join(os.tmpdir(), 'nova-core-sync');
const PORT = Number(process.env.CORE_SYNC_PORT || 34249);
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
await saveUser({ id: 'u-core', email: 'core@test.ua', name: 'Ядро', role: 'writer', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-core', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL },
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
console.log('\nСтарт:');
t('сервер піднявся, ядро готове', health?.core === 'ready', JSON.stringify(health));
t('міграції накочено на старті', /схема v4/.test(log.join('')), (log.join('').match(/\[core\][^\n]*/g) || []).join(' | '));
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
await page.setViewport({ width: 1500, height: 950 });
await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
await page.click('#nav-tab-editor');
await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 30000 });
await sleep(1500);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button,a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
const topPids = () => page.evaluate(`(() => {
  const ed = document.querySelector('#book-content-editor-ua .ProseMirror').editor;
  const out = []; ed.state.doc.forEach((n) => out.push(n.attrs.pid || null)); return out;
})()`) as Promise<(string | null)[]>;

// Відкриття книги саме по собі зберігає її (номери абзаців для розділу) —
// цього досить, щоб запустити першу синхронізацію. Якщо ні — легка правка.
const firstBlock = await page.$('#book-content-editor-ua .ProseMirror > *');
await firstBlock!.click();
await page.keyboard.press('End');
await page.keyboard.type(' ');
await page.keyboard.press('Backspace');

let puts = 0;
page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/api/books/')) puts++; });

console.log('\nПерша синхронізація:');
const paragraphs = await waitFor(
  () => q(`SELECT id, document_id, ord, text FROM fusion_core.paragraphs WHERE project_id = $1 AND deleted_at IS NULL ORDER BY document_id, ord`, [BOOK]),
  (rows) => rows.length > 3,
);
t('абзаци книги з\'явились у ядрі', paragraphs.length > 3, `${paragraphs.length} абзаців`);
// Перше збереження могло піти ще до того, як редактор роздав номери, —
// чекаємо книгу з номерами й синхронізацію після неї.
const stored = await waitFor(
  async () => (await fetch(`${BASE}/api/books/${BOOK}`, { headers: { Cookie: `nova_session=${TOKEN}` } })).json(),
  (b: any) => (b?.book?.chapters?.[0]?.sections?.[0]?.paragraphIds || []).length > 0,
);
const sec0 = stored?.book?.chapters?.[0]?.sections?.[0];
await waitFor(
  () => q(`SELECT count(*)::int AS n FROM fusion_core.core_jobs WHERE project_id = $1 AND status IN ('queued', 'running')`, [BOOK]),
  (rows) => rows[0].n === 0,
);
const coreSec0 = paragraphs.filter((p: any) => p.document_id === sec0?.id).map((p: any) => p.id);
t('номери абзаців у ядрі — ті самі, що в канві й у книзі',
  coreSec0.length > 0 && coreSec0.join() === (sec0?.paragraphIds || []).join() && coreSec0.join() === (await topPids()).join(),
  `${coreSec0.length} / ${sec0?.paragraphIds?.length}`);
const blocksTotal = (stored?.book?.chapters || []).reduce((n: number, c: any) => n + (c.sections || []).length, 0);
const docs = await q(`SELECT kind, count(*)::int AS n FROM fusion_core.documents WHERE project_id = $1 GROUP BY kind`, [BOOK]);
t('розділи книги — документи ядра', docs.find((d: any) => d.kind === 'section')?.n === blocksTotal, JSON.stringify(docs));
const job = await q(`SELECT status, result FROM fusion_core.core_jobs WHERE project_id = $1 AND kind = 'core_sync' ORDER BY created_at DESC LIMIT 1`, [BOOK]);
t('задача core_sync завершилась успішно', job[0]?.status === 'succeeded', job[0]?.status);

console.log('\nАвтор дописує тег:');
await page.evaluate(`(() => {
  const ed = document.querySelector('#book-content-editor-ua .ProseMirror').editor;
  const first = ed.state.doc.child(0);
  ed.chain().focus().setTextSelection(1 + first.content.size).insertContent(' [/emotion:радість — 5 @Живий тест]').run();
})()`);
await sleep(300);
const putsBefore = puts;
const inCanvas = await page.evaluate(`document.querySelector('#book-content-editor-ua .ProseMirror').editor.getText().includes('радість')`);
t('тег у канві', inCanvas === true);
await sleep(6000);
t('редактор зберіг книгу на сервер', puts > putsBefore, `PUT: ${putsBefore} → ${puts}`);
const mention = await waitFor(
  () => q(`SELECT m.fields, e.name, s.name AS subject
           FROM fusion_core.entity_mentions m
           JOIN fusion_core.entities e ON e.id = m.entity_id
           LEFT JOIN fusion_core.entities s ON s.id = m.subject_entity_id
           WHERE m.project_id = $1 AND e.type = 'emotion' AND e.name = 'радість'`, [BOOK]),
  (rows) => rows.length > 0,
);
t('згадка з тегу — у ядрі за кілька секунд', mention.length === 1, `${mention.length}`);
t('суб\'єкт із приписки @ і поле «інтенсивність»', mention[0]?.subject === 'Живий тест' && mention[0]?.fields?.fields?.[1]?.value === '5', JSON.stringify(mention[0]));
const versions = await q(`SELECT paragraph_id, max(version)::int AS v FROM fusion_core.paragraph_versions WHERE project_id = $1 GROUP BY paragraph_id HAVING max(version) > 1`, [BOOK]);
t('правка дала нову версію рівно одному абзацу', versions.length === 1 && versions[0].paragraph_id === coreSec0[0], JSON.stringify(versions));
const after = await (await fetch(`${BASE}/api/books/${BOOK}`, { headers: { Cookie: `nova_session=${TOKEN}` } })).json();
const coreText = await q(`SELECT text FROM fusion_core.paragraphs WHERE project_id = $1 AND id = $2`, [BOOK, coreSec0[0]]);
t('текст у ядрі = абзац рукопису, а рукопис на сервері не чіпано синхронізацією',
  after.book.chapters[0].sections[0].content.split('\n\n')[0] === coreText[0]?.text && coreText[0]?.text.includes('[/emotion:радість — 5 @Живий тест]'));

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
