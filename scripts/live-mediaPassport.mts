/**
 * Живий прогін паспорта зображення в Медіатеці — Т2.3 В1 (журнал #260).
 * Запуск: npm run live:media-passport   (потрібен зібраний dist/).
 *
 * Шлях автора: Медіатека → на файлі без ліцензії позначка «ліцензія?» і
 * фільтр «Ліцензія невідома» → відкрити файл → паспорт: назва, автор,
 * ліцензія CC BY, посилання → зберегти (у сховищі й історії; позначка
 * зникає, назва на картці нова) → завантажити файл (стає ілюстрацією
 * книги) → «Замінити новою версією» → у книзі посилання на v2, стара версія
 * лишилась у переліку, на картці «v2» → телефон: вікно без горизонтальної
 * прокрутки.
 *
 * Пастка (log.md #172): у page.evaluate — лише стрілкові функції.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.join(os.tmpdir(), 'nova-media-passport');
const PORT = Number(process.env.MEDIA_PASSPORT_PORT || 34260);
const BASE = `http://localhost:${PORT}`;

process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
process.env.NODE_ENV = 'production';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const { initStore, saveUser, createSession } = await import('../server/store');
const { saveAsset } = await import('../server/media/mediaLibraryStore');
await initStore();
await saveUser({
  id: 'u-live-media',
  email: 'media-live@test.ua',
  name: 'Жива медіатека',
  role: 'admin',
  createdAt: new Date().toISOString(),
} as any);

const TOKEN = crypto.randomBytes(32).toString('hex');
await createSession({
  token: TOKEN,
  userId: 'u-live-media',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
});

// Книга, яку студія відкриває новому авторові (`src/data/initialBook.ts`):
// саме її id задає типовий розділ медіатеки, тож файли мають лягти в нього.
const BOOK_ID = 'BK-2084-CYBER';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);
// Файл без паспорта: завантажений, ліцензія невідома — на картці має бути позначка.
const seeded = await saveAsset({
  ownerId: 'u-live-media',
  bookId: BOOK_ID,
  kind: 'upload',
  filename: 'Ліс.png',
  mimeType: 'image/png',
  bytes: PNG,
});
const HERO_FILE = path.join(DIR, 'hero.png');
const HERO_V2_FILE = path.join(DIR, 'hero-v2.png');
fs.writeFileSync(HERO_FILE, PNG);
fs.writeFileSync(HERO_V2_FILE, PNG);

const serverLog: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, PORT: String(PORT), NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => serverLog.push(String(d)));
child.stderr.on('data', (d) => serverLog.push(String(d)));
const stopServer = () => { try { child.kill(); } catch { /* вже мертвий */ } };
process.on('exit', stopServer);

async function waitForServer(): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/status`);
      if (r.ok) return true;
    } catch { /* ще не піднявся */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (!(await waitForServer())) {
  console.error('Сервер не піднявся.\n' + serverLog.join('').slice(-2000));
  stopServer();
  process.exit(1);
}
t('сервер піднявся', true);

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
  console.error('Не знайдено Chrome/Chromium.');
  stopServer();
  process.exit(1);
}
const api = async (p: string, init: RequestInit = {}) => {
  const r = await fetch(`${BASE}${p}`, { ...init, headers: { Cookie: `nova_session=${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async <T,>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15000): Promise<T> => {
  let v = await fn();
  for (let i = 0; i < ms / 500 && !ok(v); i++) {
    await sleep(500);
    v = await fn();
  }
  return v;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-media', { timeout: 30000 });
  await page.click('#nav-tab-media');
  const cardSel = (id: string) => `[data-media-passport-badges="${id}"]`;
  await page.waitForSelector(cardSel(seeded.id), { timeout: 30000 }).catch(() => null);

  console.log('\nПозначки й фільтр:');
  const badge = await page.evaluate((sel: string) => document.querySelector(sel)?.textContent ?? '', cardSel(seeded.id));
  t('на файлі без ліцензії — позначка «ліцензія?»', /ліцензія\?/.test(badge), badge);
  await page.select('[data-media-passport-filter]', 'noLicense');
  await sleep(300);
  const titlesNoLic = await page.evaluate(() => Array.from(document.querySelectorAll('[data-tour="media__3"] h3')).map((e) => (e.textContent || '').trim()));
  t('фільтр «Ліцензія невідома» показує «Ліс.png»', titlesNoLic.includes('Ліс.png'), titlesNoLic.join(' | '));
  await page.select('[data-media-passport-filter]', 'all');
  await sleep(300);

  console.log('\nПаспорт:');
  await page.evaluate((sel: string) => {
    const badges = document.querySelector(sel);
    (badges?.parentElement as HTMLElement | null)?.click();
  }, cardSel(seeded.id));
  await page.waitForSelector(`[data-media-passport="${seeded.id}"] [data-passport-save]`, { timeout: 10000 });
  const lic0 = await page.evaluate(() => (document.querySelector('[data-passport-license]') as HTMLSelectElement).value);
  const src0 = await page.evaluate(() => (document.querySelector('[data-passport-source]') as HTMLSelectElement).value);
  t('паспорт відкрився: джерело «завантажено», ліцензія невідома, попередження', lic0 === 'unknown' && src0 === 'upload' && !!(await page.$('[data-passport-warnings]')), `${src0} ${lic0}`);
  await page.type('[data-passport-title]', 'Нічний ліс');
  await page.type('[data-passport-author]', 'Марія Художниця');
  await page.select('[data-passport-license]', 'cc-by');
  await page.type('[data-passport-license-url]', 'https://creativecommons.org/licenses/by/4.0/');
  await page.click('[data-passport-save]');
  const saved = await waitFor(() => api(`/api/media/${seeded.id}/passport`), (r) => r.body?.asset?.license === 'cc-by', 10000);
  t('збережено в сховищі: назва, автор, ліцензія, посилання', saved.body.asset.title === 'Нічний ліс' && saved.body.asset.author === 'Марія Художниця' && saved.body.asset.licenseUrl.startsWith('https://'), JSON.stringify(saved.body.asset).slice(0, 160));
  t('історія: «створено» і «змінено паспорт» (з автором дії)', saved.body.history.map((h: any) => h.action).join() === 'passport,created' && saved.body.history[0].actor === 'user:u-live-media');
  const hist = await waitFor(() => page.evaluate(() => Array.from(document.querySelectorAll('[data-passport-history-item]')).map((e) => e.getAttribute('data-passport-history-item'))), (v) => v.length === 2, 10000);
  t('історія видна у вікні', hist.join() === 'passport,created', hist.join());
  await page.keyboard.press('Escape');
  await page.evaluate(() => (document.querySelector('[data-media-lightbox]') as HTMLElement | null)?.click());
  await sleep(500);
  const badgeAfter = await page.evaluate((sel: string) => document.querySelector(sel)?.textContent ?? '', cardSel(seeded.id));
  const titles = await page.evaluate(() => Array.from(document.querySelectorAll('[data-tour="media__3"] h3')).map((e) => (e.textContent || '').trim()));
  t('позначка зникла, на картці нова назва', !/ліцензія\?/.test(badgeAfter) && titles.includes('Нічний ліс'), `${badgeAfter} | ${titles.filter((x) => /ліс/i.test(x)).join()}`);

  console.log('\nНова версія і посилання в книзі:');
  // Головне поле завантаження Медіатеки — поруч із кнопкою «Завантажити» (media__1), не поля панелі генерації.
  const inputs = await page.$$('input[type="file"][accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"]');
  const input = inputs[0] as any;
  await input.uploadFile(HERO_FILE);
  const heroAsset = await waitFor(async () => (await api(`/api/media/list?bookId=${BOOK_ID}`)).body.assets.find((a: any) => a.filename === 'hero.png'), (a) => !!a, 15000);
  t('файл завантажено в сховище', !!heroAsset);
  await page.waitForFunction((url: string) => Array.from(document.querySelectorAll('[data-tour="media__3"] img')).some((i) => i.getAttribute('src') === url), { timeout: 10000 }, heroAsset.url);
  await page.evaluate((url: string) => {
    const img = Array.from(document.querySelectorAll('[data-tour="media__3"] img')).find((i) => i.getAttribute('src') === url);
    (img?.parentElement as HTMLElement | null)?.click();
  }, heroAsset.url);
  await page.waitForSelector(`[data-media-passport="${heroAsset.id}"] [data-passport-version-input]`, { timeout: 10000 });
  const vInput = (await page.$('[data-passport-version-input]')) as any;
  await vInput.uploadFile(HERO_V2_FILE);
  const v2 = await waitFor(async () => (await api(`/api/media/list?bookId=${BOOK_ID}`)).body.assets.find((a: any) => a.rootId === heroAsset.id && a.version === 2), (a) => !!a, 15000);
  t('версія 2 у сховищі, стара — теж', !!v2 && (await api(`/api/media/${heroAsset.id}/passport`)).body.versions.length === 2);
  const lightImg = await waitFor(() => page.evaluate(() => (document.querySelector('[data-media-lightbox] img') as HTMLImageElement | null)?.getAttribute('src') ?? ''), (v) => v === v2?.url, 10000);
  t('у вікні — нова версія', lightImg === v2?.url, lightImg);
  const toast = await page.evaluate(() => document.body.innerText.match(/Версію 2 збережено\. Замін у книзі: (\d+)/)?.[1] ?? '');
  t('книга: посилання ілюстрації перейшло на v2 (замін — 1)', toast === '1', toast);
  const versionsUi = await waitFor(() => page.evaluate(() => Array.from(document.querySelectorAll('[data-passport-version]')).map((e) => e.getAttribute('data-passport-version'))), (v) => v.length === 2, 10000);
  t('у паспорті — обидві версії, нова першою', versionsUi.join() === '2,1', versionsUi.join());
  await page.screenshot({ path: path.join(DIR, 'media-passport.png') });
  await page.evaluate(() => (document.querySelector('[data-media-lightbox]') as HTMLElement | null)?.click());
  await sleep(700);
  const cardV2 = await page.evaluate((url: string) => {
    const img = Array.from(document.querySelectorAll('[data-tour="media__3"] img')).find((i) => i.getAttribute('src') === url);
    const card = img?.parentElement;
    return { has: !!img, badge: card?.querySelector('[data-media-passport-badges]')?.textContent ?? '', oldShown: Array.from(document.querySelectorAll('[data-tour="media__3"] img')).some((i) => i.getAttribute('src') === (window as any).__old) };
  }, v2.url);
  const oldStill = await page.evaluate((url: string) => Array.from(document.querySelectorAll('[data-tour="media__3"] img')).some((i) => i.getAttribute('src') === url), heroAsset.url);
  t('у галереї — картка v2 з позначкою «v2», старої окремою карткою немає', cardV2.has && /v2/.test(cardV2.badge) && !oldStill, JSON.stringify({ ...cardV2, oldStill }));

  console.log('\nТелефон:');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(800);
  await page.evaluate((url: string) => {
    const img = Array.from(document.querySelectorAll('[data-tour="media__3"] img')).find((i) => i.getAttribute('src') === url);
    (img?.parentElement as HTMLElement | null)?.click();
  }, v2.url);
  await page.waitForSelector('[data-media-passport] [data-passport-save]', { timeout: 10000 });
  const mm = await page.evaluate(() => {
    const box = document.querySelector('[data-media-passport]') as HTMLElement;
    const r = box.getBoundingClientRect();
    return { right: Math.round(r.right), vw: window.innerWidth, scroll: box.scrollWidth, client: box.clientWidth };
  });
  t('телефон: паспорт у межах екрана, без горизонтальної прокрутки', mm.right <= mm.vw && mm.scroll <= mm.client + 1, JSON.stringify(mm));
  await page.screenshot({ path: path.join(DIR, 'media-passport-mobile.png'), fullPage: false });
  console.log(`     (знімки: ${DIR}/media-passport.png, media-passport-mobile.png)`);
} finally {
  await browser.close();
  stopServer();
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
