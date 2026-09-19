/**
 * Живий прогін видалення з медіатеки разом із попередженням.
 * Запуск: npm run live:media-delete   (потрібен `npm run build`).
 *
 * НАВІЩО. Видалення — єдина дія в медіатеці, яку не можна скасувати: кошика
 * немає, архіву немає, байти з диска стерто. Тому тут перевіряється не
 * «кнопка є», а весь ланцюг:
 *   1. кошик на картці НЕ видаляє зразу — спершу діалог із попередженням;
 *   2. у діалозі видно саме той файл (назва + мініатюра) і чесний текст про
 *      незворотність;
 *   3. «Скасувати» не змінює НІЧОГО — ні на екрані, ні на сервері, ні на
 *      диску (це найважливіша перевірка: скасування має бути повним);
 *   4. «Видалити назавжди» прибирає картку, опис у базі Й байти з диска;
 *   5. те саме працює з лайтбокса й для відео, а не лише для фото.
 *
 * Пастка, яку тут НЕ повторюємо (log.md #172): усередині page.evaluate не
 * оголошувати іменованих функцій — tsx обгортає їх у `__name`, якого в
 * браузері немає. Лише стрілкові функції, передані як параметр.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.join(os.tmpdir(), 'nova-media-delete');
const PORT = Number(process.env.MEDIA_DELETE_PORT || 34194);
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
const { saveAsset, getAsset, assetPath } = await import('../server/media/mediaLibraryStore');
await initStore();
await saveUser({
  id: 'u-live-delete',
  email: 'media-delete@test.ua',
  name: 'Живе видалення',
  role: 'admin',
  createdAt: new Date().toISOString(),
} as any);

const TOKEN = crypto.randomBytes(32).toString('hex');
await createSession({
  token: TOKEN,
  userId: 'u-live-delete',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
});

const BOOK_ID = 'BK-2084-CYBER';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);
const MP4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');

const PHOTO = 'фото-до-видалення.png';
const VIDEO = 'відео-до-видалення.mp4';

const photoAsset = await saveAsset({
  ownerId: 'u-live-delete',
  bookId: BOOK_ID,
  kind: 'illustration',
  filename: PHOTO,
  mimeType: 'image/png',
  bytes: PNG,
});
const videoAsset = await saveAsset({
  ownerId: 'u-live-delete',
  bookId: BOOK_ID,
  kind: 'video',
  filename: VIDEO,
  mimeType: 'video/mp4',
  bytes: MP4,
});

t('на диску лежать обидва файли', fs.existsSync(assetPath(photoAsset)) && fs.existsSync(assetPath(videoAsset)));

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

/** Скільки файлів бачить сервер — незалежно від того, що показує екран. */
const serverAssets = async (): Promise<string[]> => {
  const r = await fetch(`${BASE}/api/media/list`, { headers: { cookie: `nova_session=${TOKEN}` } });
  const body = await r.json().catch(() => ({}));
  return Array.isArray(body?.assets) ? body.assets.map((a: any) => String(a.filename)) : [];
};

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
if (!CHROME) {
  console.error('Не знайдено Chrome/Chromium.');
  stopServer();
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#nav-tab-media', { timeout: 30000 });
  await page.click('#nav-tab-media');

  await page.waitForFunction(
    (names: string[]) => {
      const h3 = Array.from(document.querySelectorAll('[data-tour="media__3"] h3')).map((el) => (el.textContent || '').trim());
      return names.every((n) => h3.includes(n));
    },
    { timeout: 30000 },
    [PHOTO, VIDEO]
  );
  t('медіатека відкрилася, фото й відео на місці', true);

  const readTitles = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-tour="media__3"] h3')).map((el) => (el.textContent || '').trim())
    );

  /** Клік по кошику конкретної картки (id беремо з data-хука). */
  const clickCardTrash = (title: string) =>
    page.evaluate((name: string) => {
      const cards = Array.from(document.querySelectorAll('[data-tour="media__3"] > div'));
      const card = cards.find((c) => (c.querySelector('h3')?.textContent || '').trim() === name);
      const btn = card?.querySelector('[data-delete-media]') as HTMLElement | null;
      btn?.click();
      return !!btn;
    }, title);

  const dialogState = () =>
    page.evaluate(() => {
      const dialog = document.querySelector('[data-delete-dialog]') as HTMLElement | null;
      if (!dialog) return { open: false, text: '', hasMedia: false, hasVideo: false, hasImage: false };
      return {
        open: true,
        text: dialog.innerText || '',
        hasMedia: !!dialog.querySelector('video, img'),
        hasVideo: !!dialog.querySelector('video'),
        hasImage: !!dialog.querySelector('img'),
      };
    });

  const clickInDialog = (hook: string) =>
    page.evaluate((sel: string) => {
      const btn = document.querySelector(`[data-delete-dialog] ${sel}`) as HTMLElement | null;
      btn?.click();
      return !!btn;
    }, hook);

  const lightboxOpen = () => page.evaluate(() => !!document.querySelector('[data-media-lightbox]'));

  // ── 1. Кошик на картці ВІДЕО не видаляє зразу ────────────────────────────
  t('кошик на картці відео знайдено й натиснуто', await clickCardTrash(VIDEO));

  let dialog = await dialogState();
  t('зʼявився діалог підтвердження (замість негайного видалення)', dialog.open);
  t('у діалозі попередження про незворотність', dialog.text.includes('Відновити видалене неможливо'), dialog.text.split('\n').slice(0, 4).join(' / '));
  t('у діалозі назва саме того файлу', dialog.text.includes(VIDEO), VIDEO);
  t('у діалозі є мініатюра файлу (для відео — плеєр)', dialog.hasVideo && dialog.hasImage === false);
  t('лайтбокс при цьому НЕ відкрився', !(await lightboxOpen()));

  const shotDir = path.join(ROOT, 'tmp');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, 'media-delete-confirm.png') });
  console.log('     (знімок: tmp/media-delete-confirm.png)');

  // ── 2. Скасування не має змінити нічого ─────────────────────────────────
  t('кнопка «Скасувати» натиснута', await clickInDialog('[data-delete-cancel]'));
  await new Promise((r) => setTimeout(r, 400));
  t('діалог закрився', !(await dialogState()).open);
  const afterCancel = await readTitles();
  t('на екрані лишились обидві картки', afterCancel.includes(PHOTO) && afterCancel.includes(VIDEO), afterCancel.join(' | '));
  t('сервер теж не видалив нічого', (await serverAssets()).length === 2);
  t('байти на диску на місці', fs.existsSync(assetPath(photoAsset)) && fs.existsSync(assetPath(videoAsset)));

  // ── 3. Лайтбокс: кошик є і там ──────────────────────────────────────────
  await page.evaluate((name: string) => {
    const cards = Array.from(document.querySelectorAll('[data-tour="media__3"] > div'));
    const card = cards.find((c) => (c.querySelector('h3')?.textContent || '').trim() === name);
    const media = card?.querySelector('video, img') as HTMLElement | null;
    (media?.parentElement as HTMLElement | undefined)?.click();
  }, VIDEO);
  await page.waitForFunction(() => !!document.querySelector('[data-media-lightbox]'), { timeout: 10000 });
  const lightboxTrash = await page.evaluate(() => {
    const btn = document.querySelector('[data-media-lightbox] [data-delete-media-lightbox]') as HTMLElement | null;
    btn?.click();
    return !!btn;
  });
  t('у лайтбоксі є кошик і він відкриває діалог', lightboxTrash && (await dialogState()).open);

  // ── 4. Підтвердження видаляє: екран, база, диск ─────────────────────────
  await clickInDialog('[data-delete-confirm]');
  await page.waitForFunction(
    (name: string) => !Array.from(document.querySelectorAll('[data-tour="media__3"] h3')).some((el) => (el.textContent || '').trim() === name),
    { timeout: 15000 },
    VIDEO
  );
  t('картка відео зникла з галереї', !(await readTitles()).includes(VIDEO));
  const leftAfterVideo = await serverAssets();
  t('сервер віддає лише фото', leftAfterVideo.length === 1 && leftAfterVideo[0] === PHOTO, leftAfterVideo.join(','));
  t('опису відео в медіатеці немає', (await getAsset(videoAsset.id)) === null);
  t('байтів відео на диску теж немає', !fs.existsSync(assetPath(videoAsset)));

  // ── 5. Те саме для фото ─────────────────────────────────────────────────
  t('кошик на картці фото натиснуто', await clickCardTrash(PHOTO));
  dialog = await dialogState();
  t('для фото діалог теж про незворотність', dialog.open && dialog.text.includes('Відновити видалене неможливо'));
  t('для фото в діалозі саме фото (без плеєра)', dialog.hasImage && !dialog.hasVideo);
  await clickInDialog('[data-delete-confirm]');
  // Чекаємо саме на зникнення ФОТО, а не на порожню галерею: книга додає
  // свої картки (обкладинка, портрети персонажів) — вони тут не предмет
  // перевірки й нікуди не подінуться.
  await page.waitForFunction(
    (name: string) => !Array.from(document.querySelectorAll('[data-tour="media__3"] h3')).some((el) => (el.textContent || '').trim() === name),
    { timeout: 15000 },
    PHOTO
  );
  t('картка фото зникла з галереї', !(await readTitles()).includes(PHOTO));
  t('сервер віддає порожній список', (await serverAssets()).length === 0);
  t('байтів фото на диску немає', !fs.existsSync(assetPath(photoAsset)));
  await page.screenshot({ path: path.join(shotDir, 'media-delete-after.png') });
  console.log('     (знімок: tmp/media-delete-after.png)');
} finally {
  await browser.close();
  stopServer();
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
