/**
 * Живий прогін постійних номерів абзаців (Т0.5, журнал #246).
 * Запуск: npm run live:paragraph-ids   (потрібен зібраний dist/server.mjs).
 *
 * У справжньому браузері: кожен блок канви має номер; Enter посередині абзацу
 * лишає номер першій половині й дає новий другій; номери переживають
 * перезавантаження сторінки; серверна копія книги отримує `paragraphIds`, а
 * текст розділу номерів не містить.
 *
 * Пастка (log.md #172): у page.evaluate — лише рядки або стрілкові функції.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-paragraph-ids');
const PORT = Number(process.env.PARAGRAPH_IDS_PORT || 34246);
const BASE = `http://localhost:${PORT}`;
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

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-pid', email: 'pid@test.ua', name: 'Абзаци', role: 'writer', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-pid', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => log.push(String(d)));
child.stderr.on('data', (d) => log.push(String(d)));
process.on('exit', () => { try { child.kill(); } catch { /* */ } });
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try { up = (await fetch(`${BASE}/api/auth/status`)).ok; } catch { /* */ }
  if (!up) await sleep(500);
}
if (!up) { console.error(log.join('').slice(-2000)); process.exit(1); }

const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });

const openEditor = async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
  await page.click('#nav-tab-editor');
  await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 30000 });
  await sleep(1500);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button,a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
    b?.click();
  });
};
const topPids = () => page.evaluate(`(() => {
  const ed = document.querySelector('#book-content-editor-ua .ProseMirror').editor;
  const out = []; ed.state.doc.forEach((n) => out.push(n.attrs.pid || null)); return out;
})()`) as Promise<(string | null)[]>;

console.log('\nНомери в канві:');
await openEditor();
const before = await topPids();
t('кожен блок має номер', before.length > 3 && before.every(Boolean), `${before.length} блоків`);
t('номери унікальні', new Set(before).size === before.length);
t('номер видно в розмітці (data-pid)', await page.evaluate(() => document.querySelectorAll('#book-content-editor-ua [data-pid]').length > 3));

console.log('\nEnter посередині абзацу:');
// Справжній клік ставить фокус у канву (синтетичний — ні), далі каретку
// переносимо в середину першого абзацу командою редактора.
const firstBlock = await page.$('#book-content-editor-ua .ProseMirror > *');
await firstBlock!.click();
await sleep(300);
await page.evaluate(`(() => {
  const ed = document.querySelector('#book-content-editor-ua .ProseMirror').editor;
  const first = ed.state.doc.child(0);
  ed.commands.setTextSelection(1 + Math.floor(first.content.size / 2));
})()`);
await page.keyboard.press('Enter');
await sleep(800);
const afterSplit = await topPids();
t('перша половина лишила номер', afterSplit[0] === before[0], `${afterSplit[0]} / ${before[0]}`);
t('друга половина отримала новий номер', !!afterSplit[1] && !before.includes(afterSplit[1]));
t('решта номерів на місці', afterSplit.slice(2).join() === before.slice(1).join());

console.log('\nПісля перезавантаження:');
await sleep(4000); // збереження в IndexedDB і дзеркало на сервер
await openEditor();
const reloaded = await topPids();
t('номери ті самі, що до перезавантаження', reloaded.join() === afterSplit.join(), `${reloaded.length}/${afterSplit.length}`);

console.log('\nСерверна копія:');
let stored: any = null;
for (let i = 0; i < 10 && !stored?.book?.chapters; i++) {
  const res = await fetch(`${BASE}/api/books/BK-2084-CYBER`, { headers: { Cookie: `nova_session=${TOKEN}` } });
  stored = res.ok ? await res.json() : null;
  if (!stored?.book?.chapters) await sleep(1500);
}
const section = stored?.book?.chapters?.[0]?.sections?.[0];
t('у копії є paragraphIds для першого розділу', Array.isArray(section?.paragraphIds) && section.paragraphIds.length === afterSplit.length,
  `${section?.paragraphIds?.length} / ${afterSplit.length}`);
t('текст розділу номерів не містить', typeof section?.content === 'string' && !afterSplit.some((id) => id && section.content.includes(id)));

await browser.close();
child.kill();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
