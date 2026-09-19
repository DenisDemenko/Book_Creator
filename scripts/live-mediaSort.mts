/**
 * Живий прогін сортування медіатеки.
 * Запуск: npm run live:media-sort   (потрібен `npm run build`).
 *
 * НАВІЩО. Порядок карток — це те, що оком не перевіриш: перелік виглядає
 * «якось відсортованим» у будь-якому разі. Тому перевіряємо по-справжньому:
 * Express із прод-кодом, сесія автора, headless Chrome, справжні файли
 * серверної медіатеки з РІЗНИМИ датами й навмисно «незручними» назвами
 * (`clip-3` згенеровано раніше за `clip-1`), а тоді перемикаємо спосіб
 * сортування й читаємо порядок із DOM.
 *
 * Що саме має бути видно:
 *   1. типово — від першої генерації до останньої;
 *   2. «від останньої» — рівно зворотний порядок;
 *   3. «за назвою» — інший порядок (доводить, що перемикач справді діє);
 *   4. вкладка «Відео» показує окремо лише кліпи й сортує їх тим самим
 *      способом;
 *   5. на картці видно дату появи (вона ж — ключ сортування).
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

const DIR = path.join(os.tmpdir(), 'nova-media-sort');
const PORT = Number(process.env.MEDIA_SORT_PORT || 34193);
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
/** Найменший правдоподібний MP4: контейнер не програється, але картка малюється. */
const MP4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');

/**
 * П'ять файлів, дати яких НЕ збігаються з порядком назв:
 *  - початок (10:00) і кінець (12:40) — зображення;
 *  - clip-3, clip-2, clip-1 (12:10, 12:20, 12:30) — відео, згенеровані
 *    у зворотному до нумерації порядку.
 */
const SEEDS: { filename: string; kind: 'illustration' | 'video'; at: string }[] = [
  { filename: 'AAA-початок.png', kind: 'illustration', at: '2026-09-12T10:00:00.000Z' },
  { filename: 'clip-3.mp4', kind: 'video', at: '2026-09-12T12:10:00.000Z' },
  { filename: 'clip-2.mp4', kind: 'video', at: '2026-09-12T12:20:00.000Z' },
  { filename: 'clip-1.mp4', kind: 'video', at: '2026-09-12T12:30:00.000Z' },
  { filename: 'ZZZ-кінець.png', kind: 'illustration', at: '2026-09-12T12:40:00.000Z' },
];

for (const seed of SEEDS) {
  await saveAsset({
    ownerId: 'u-live-media',
    bookId: BOOK_ID,
    kind: seed.kind,
    filename: seed.filename,
    mimeType: seed.kind === 'video' ? 'video/mp4' : 'image/png',
    bytes: seed.kind === 'video' ? MP4 : PNG,
    now: () => new Date(seed.at),
  });
}

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
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));
if (!CHROME) {
  console.error('Не знайдено Chrome/Chromium.');
  stopServer();
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

/** Назви, які ми самі засіяли: книга додає ще свої картки (обкладинка, портрети), і вони тут не предмет перевірки. */
const SEEDED = SEEDS.map((s) => s.filename);
const seededOnly = (titles: string[]) => titles.filter((x) => SEEDED.includes(x));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#nav-tab-media', { timeout: 30000 });
  await page.click('#nav-tab-media');

  // Картки малюються після відповіді `/api/media/list` — чекаємо саме на
  // п'ять засіяних назв, а не на «щось зʼявилося».
  await page.waitForFunction(
    (names: string[]) => {
      const h3 = Array.from(document.querySelectorAll('[data-tour="media__3"] h3')).map((el) => (el.textContent || '').trim());
      return names.every((n) => h3.includes(n));
    },
    { timeout: 30000 },
    SEEDED
  );
  t('медіатека відкрилася, усі 5 засіяних файлів видно', true);

  const readTitles = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-tour="media__3"] h3')).map((el) => (el.textContent || '').trim())
    );

  const setSort = (value: string) =>
    page.evaluate((v: string) => {
      const sel = document.querySelector('[data-tour="media__4"] select') as HTMLSelectElement | null;
      if (!sel) return;
      const proto = Object.getPrototypeOf(sel) as typeof HTMLSelectElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(sel, v);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);

  const clickFilter = (label: string) =>
    page.evaluate((l: string) => {
      const btns = Array.from(document.querySelectorAll('[data-tour="media__2"] button'));
      const btn = btns.find((b) => (b.textContent || '').trim() === l);
      (btn as HTMLElement | undefined)?.click();
    }, label);

  const sortOptions = await page.evaluate(() => {
    const sel = document.querySelector('[data-tour="media__4"] select') as HTMLSelectElement | null;
    return sel ? Array.from(sel.options).map((o) => o.value) : [];
  });
  t('перемикач сортування на місці, з пʼятьма способами', sortOptions.length === 5, sortOptions.join(','));

  // 1. Типово — від першої генерації до останньої.
  const generationAsc = seededOnly(await readTitles()).join(' | ');
  t(
    'типовий порядок — від першої генерації до останньої',
    generationAsc === 'AAA-початок.png | clip-3.mp4 | clip-2.mp4 | clip-1.mp4 | ZZZ-кінець.png',
    generationAsc
  );

  // 5. Дата на картці — саме той ключ, за яким вишикувано перелік.
  const badge = await page.evaluate(() => {
    const grid = document.querySelector('[data-tour="media__3"]') as HTMLElement | null;
    const match = (grid?.innerText || '').match(/\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/);
    return match ? match[0] : '';
  });
  t('на картці видно дату появи файлу', badge !== '', badge);

  // 2. Від останньої до першої.
  await setSort('generationDesc');
  await new Promise((r) => setTimeout(r, 300));
  const generationDesc = seededOnly(await readTitles()).join(' | ');
  t(
    '«від останньої» дає рівно зворотний порядок',
    generationDesc === 'ZZZ-кінець.png | clip-1.mp4 | clip-2.mp4 | clip-3.mp4 | AAA-початок.png',
    generationDesc
  );

  // 3. За назвою — інший порядок, отже перемикач справді діє.
  await setSort('title');
  await new Promise((r) => setTimeout(r, 300));
  const byTitle = seededOnly(await readTitles()).join(' | ');
  t(
    '«за назвою» шикує інакше — назва не дорівнює порядку генерації',
    byTitle === 'AAA-початок.png | clip-1.mp4 | clip-2.mp4 | clip-3.mp4 | ZZZ-кінець.png',
    byTitle
  );

  // 4. Вкладка «Відео»: лише кліпи, і той самий спосіб сортування.
  await clickFilter('Відео');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-tour="media__3"] h3').length === 3,
    { timeout: 10000 }
  );
  const videosByTitle = (await readTitles()).join(' | ');
  t('вкладка «Відео» показує окремо лише три кліпи', videosByTitle === 'clip-1.mp4 | clip-2.mp4 | clip-3.mp4', videosByTitle);

  await setSort('generationAsc');
  await new Promise((r) => setTimeout(r, 300));
  const videosChronological = (await readTitles()).join(' | ');
  t(
    'відео сортуються за часом генерації (3-й кадр знято першим)',
    videosChronological === 'clip-3.mp4 | clip-2.mp4 | clip-1.mp4',
    videosChronological
  );

  const shotDir = path.join(ROOT, 'tmp');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, 'media-library-sort.png'), fullPage: true });
  console.log('     (знімок: tmp/media-library-sort.png)');

  // Повертаємось на фільтр «Всі медіа» — переконуємось, що фото не зникли.
  await clickFilter('Всі медіа');
  await new Promise((r) => setTimeout(r, 300));
  t('фільтр «Всі медіа» повертає всі пʼять', seededOnly(await readTitles()).length === 5);
} finally {
  await browser.close();
  stopServer();
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
