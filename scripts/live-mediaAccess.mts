/**
 * Живий прогін: чи видно рольові розділи, зокрема «Медіатеку» (запит власника
 * 06.10.2026: «у письменника та дизайнера немає доступу до Медіотеки»).
 * Запуск: npm run live:media-access   (потрібен `npm run build`).
 *
 * Перевіряє найкоротший шлях, яким керується меню: `canAccessTab(role, tab)` зі
 * списку `allowedTabs` ролі (src/utils/rbac.ts) — саме його фільтрує SidebarNav.
 * Серверні маршрути медіатеки закриті лише `requireAuth` + лімітом сховища
 * тарифу, тож роль вирішує ЛИШЕ видимість розділу.
 *
 * Пастка (log.md #172): у page.evaluate — лише стрілкові функції.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-media-access');
const PORT = Number(process.env.MEDIA_ACCESS_PORT || 34251);
const BASE = `http://localhost:${PORT}`;
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
const ROLES = ['writer', 'designer', 'admin'] as const;
const tokens: Record<string, string> = {};
for (const role of ROLES) {
  await saveUser({ id: `u-${role}`, email: `${role}@test.ua`, name: `Живий ${role}`, role, createdAt: new Date().toISOString() } as any);
  const token = crypto.randomBytes(32).toString('hex');
  await createSession({ token, userId: `u-${role}`, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString() });
  tokens[role] = token;
}

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
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium.'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

try {
  for (const role of ROLES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 950 });
    await browser.setCookie({ name: 'nova_session', value: tokens[role], domain: 'localhost', path: '/' });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[id^="nav-tab-"]', { timeout: 40000 });
    await new Promise((r) => setTimeout(r, 1200));
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
      b?.click();
    });
    await new Promise((r) => setTimeout(r, 400));

    const nav = await page.evaluate(() => Array.from(document.querySelectorAll('[id^="nav-tab-"]')).map((e) => e.id.replace('nav-tab-', '')));
    const quota = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/media/storage', { credentials: 'same-origin' });
        return { status: r.status, body: (await r.text()).slice(0, 160) };
      } catch (e) {
        return { status: -1, body: String(e) };
      }
    });
    let libraryRendered = false;
    let libraryText = '';
    if (nav.includes('media')) {
      await page.click('#nav-tab-media');
      await new Promise((r) => setTimeout(r, 1200));
      libraryRendered = await page.evaluate(() => !!document.querySelector('[data-tour="media__0"], [data-tour="media__3"], [data-media-mode-tab]'));
      libraryText = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 180));
      await page.screenshot({ path: path.join(ROOT, 'tmp', 'media-access', `${role}.png`) });
    }
    console.log(`\n=== ${role} ===`);
    console.log(`  nav-tabs: ${nav.length}`);
    console.log(`  media-tab: ${nav.includes('media') ? 'YES' : 'NO'}`);
    console.log(`  library-rendered: ${libraryRendered ? 'YES' : 'NO'}`);
    console.log(`  /api/media/storage: ${quota.status} ${quota.body}`);
    await page.close();
  }
} finally {
  await browser.close();
  child.kill();
}
