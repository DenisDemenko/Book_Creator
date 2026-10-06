/**
 * Живий прогін AI-коуча «Книга і текст» (запис #363).
 * Запуск: npm run live:coach-draft   (потрібен `npm run build`).
 *
 * Перевіряє те, чого не бачить юніт-тест: панель «Текст для вставки в
 * книгу» належить вкладці «Аналіз» і БІЛЬШЕ НЕ стоїть у чаті — власник
 * (06.10.2026): «панель набору текста книги з'явилась в чаті з АІ, її там
 * не повинно бути». Кнопка «У чернетку» біля відповіді коуча має не
 * розкривати форму в розмові, а переводити на вкладку «Аналіз» із уже
 * підставленим текстом (тому функція не втрачена).
 *
 * Відповідь коуча підмінена перехопленням запиту — жодного ключа ШІ не
 * потрібно, перевіряється саме розкладка попапу.
 *
 * Пастка (log.md #172): у page.evaluate — лише стрілкові функції.
 * Пастка (AGENTS.md): у page.evaluate не можна звертатися до document
 * через замикання Node — тільки всередині самої функції.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-coach-draft');
const PORT = Number(process.env.COACH_DRAFT_PORT || 34241);
const BASE = `http://localhost:${PORT}`;
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const SHOTS = path.join(ROOT, 'tmp', 'coach-draft');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-coach', email: 'coach@test.ua', name: 'Живий коуч', role: 'admin', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(32).toString('hex');
await createSession({ token: TOKEN, userId: 'u-coach', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ROLE_ONBOARDING: 'off', ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => log.push(String(d)));
child.stderr.on('data', (d) => log.push(String(d)));
process.on('exit', () => { try { child.kill(); } catch { /* */ } });
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try { up = (await fetch(`${BASE}/api/auth/status`)).ok; } catch { /* */ }
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) { console.error(log.join('').slice(-2000)); process.exit(1); }

const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));
if (!CHROME) {
  console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).');
  child.kill();
  process.exit(1);
}
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const errors: string[] = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: 1600, height: 950 });
  await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
  await page.click('#nav-tab-editor');
  await page.waitForSelector('[data-editor-tool-dock]', { timeout: 30000 });
  await page.waitForSelector('#book-content-editor-ua', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));
  // Онбординг-тур відкривається сам і накриває кадр — закриваємо.
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button, a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
    b?.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // ── Стан попапу коуча: що саме видно зараз ───────────────────────────────
  const state = () =>
    page.evaluate(() => {
      const modal = document.querySelector('div[class*="z-[85]"]') as HTMLElement | null;
      if (!modal) return { open: false, draft: false, draftValue: '', label: false, insert: false, chatInput: false, tabs: [] as string[] };
      const ta = modal.querySelector('textarea') as HTMLTextAreaElement | null;
      return {
        open: true,
        draft: !!ta,
        draftValue: ta?.value ?? '',
        label: Array.from(modal.querySelectorAll('label')).some((l) => /Текст для вставки в книгу/.test(l.textContent || '')),
        insert: Array.from(modal.querySelectorAll('button')).some((b) => /Вставити в книгу/.test(b.textContent || '')),
        chatInput: !!modal.querySelector('input[placeholder*="Написати коучу"]'),
        tabs: Array.from(modal.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter((x) => ['Аналіз', 'Чат', 'Аудит книги'].includes(x)),
      };
    });

  const clickInModal = (re: string) =>
    page.evaluate((pattern) => {
      const modal = document.querySelector('div[class*="z-[85]"]') as HTMLElement | null;
      const rx = new RegExp(pattern);
      const btn = modal && (Array.from(modal.querySelectorAll('button')).find((b) => rx.test((b.textContent || '').trim())) as HTMLElement | undefined);
      btn?.click();
      return !!btn;
    }, re);

  // ── 1. Відкрити AI-коуча з тулбару (вкладка «AI Асистент») ───────────────
  const aiTab = await page.evaluate(() => {
    const dock = document.querySelector('[data-editor-tool-dock]') as HTMLElement | null;
    const btn = dock && (Array.from(dock.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'AI Асистент') as HTMLElement | undefined);
    btn?.click();
    return !!btn;
  });
  t('у блоці інструментів є вкладка «AI Асистент»', aiTab);
  await new Promise((r) => setTimeout(r, 300));
  const coachBtn = await page.evaluate(() => {
    const dock = document.querySelector('[data-editor-tool-dock]') as HTMLElement | null;
    const btn = dock && (Array.from(dock.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'AI-коуч') as HTMLElement | undefined);
    btn?.click();
    return !!btn;
  });
  t('кнопка «AI-коуч» натиснута', coachBtn);
  await page.waitForSelector('div[class*="z-[85]"]', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));

  let s = await state();
  t('попап коуча відкрито', s.open);
  t('три вкладки на місці', s.tabs.length === 3, s.tabs.join(' | '));
  t('типово відкрита вкладка «Аналіз» — панель вставки Є', s.draft && s.label && s.insert, JSON.stringify({ draft: s.draft, label: s.label, insert: s.insert }));
  t('у панелі вставки вже стоїть виділений фрагмент', s.draftValue.length > 0, `${s.draftValue.length} символів`);
  await page.screenshot({ path: path.join(SHOTS, '1-analysis-with-panel.png') });

  // ── 2. «Чат» — панелі вставки в розмові бути НЕ повинно ─────────────────
  await clickInModal('^Чат$');
  await new Promise((r) => setTimeout(r, 300));
  s = await state();
  t('у чаті є поле вводу повідомлення', s.chatInput);
  t('у чаті НЕМАЄ панелі «Текст для вставки в книгу»', !s.draft && !s.label, JSON.stringify({ draft: s.draft, label: s.label }));
  t('у чаті немає кнопки «Вставити в книгу»', !s.insert);
  await page.screenshot({ path: path.join(SHOTS, '2-chat-without-panel.png') });

  // ── 3. «У чернетку» з відповіді коуча веде на «Аналіз» із текстом ───────
  await page.setRequestInterception(true);
  const ANSWER = 'ВІДПОВІДЬ КОУЧА ДЛЯ ПЕРЕВІРКИ РОЗКЛАДКИ';
  page.on('request', (req) => {
    if (req.url().includes('/api/ai/coach-chat') && req.method() === 'POST') {
      return void req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reply: ANSWER }),
      });
    }
    return void req.continue();
  });
  await page.type('div[class*="z-[85]"] input[placeholder*="Написати коучу"]', 'Що тут не так?', { delay: 8 });
  await page.keyboard.press('Enter');
  await page.waitForFunction((needle) => document.body.innerText.includes(needle as string), { timeout: 15000 }, ANSWER);
  t('відповідь коуча з\'явилася в розмові', true);
  const toDraft = await clickInModal('^У чернетку');
  t('кнопка «У чернетку» є біля відповіді коуча', toDraft);
  await new Promise((r) => setTimeout(r, 400));
  s = await state();
  t('після «У чернетку» відкрилася вкладка «Аналіз»', s.draft && !s.chatInput, JSON.stringify({ draft: s.draft, chatInput: s.chatInput }));
  t('текст коуча підставлено в панель вставки', s.draftValue === ANSWER, s.draftValue.slice(0, 40));
  t('кнопка «Вставити в книгу» знову доступна', s.insert);
  await page.screenshot({ path: path.join(SHOTS, '3-after-to-draft.png') });

  // ── 4. «Аудит книги» — теж без панелі вставки ───────────────────────────
  await clickInModal('^Аудит книги$');
  await new Promise((r) => setTimeout(r, 300));
  s = await state();
  t('в аудиті книги панелі вставки немає', !s.draft && !s.label && !s.insert, JSON.stringify({ draft: s.draft, label: s.label }));
  await page.screenshot({ path: path.join(SHOTS, '4-audit-without-panel.png') });

  // ── 5. Повернення на «Аналіз» — панель на місці, стан збережено ─────────
  await clickInModal('^Аналіз$');
  await new Promise((r) => setTimeout(r, 300));
  s = await state();
  t('на «Аналізі» панель повертається', s.draft && s.label && s.insert);
  t('текст у панелі не загубився між вкладками', s.draftValue === ANSWER, s.draftValue.slice(0, 40));

  t('жодної помилки в консолі сторінки', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  child.kill();
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} перевірок пройдено, ${fail} провалено`);
console.log(`Скріншоти: ${SHOTS}`);
process.exit(fail === 0 ? 0 : 1);
