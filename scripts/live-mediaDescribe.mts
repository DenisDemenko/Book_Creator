/**
 * Живий прогін «Описати ШІ» та «Генерувати відео» (задача #220).
 * Запуск: npm run live:media-describe   (потрібен `npm run build`).
 *
 * НАВІЩО. Кнопок на картці стало чотири, і кожна веде в інше місце: кадр —
 * у панель генерації відео, опис — у вікно з текстом, а текст — у книгу,
 * інструкцію або курс. Перевіряти це «на вигляд» означало б не перевіряти
 * зовсім, тому тут усе робиться по-справжньому: Express із прод-кодом,
 * сесія автора, headless Chrome, справжнє фото в медіатеці.
 *
 * БЕЗ ВИТРАТ НА ШІ. Сервер піднімається з ПОРОЖНІМИ ключами
 * (`GEMINI_API_KEY`, `OPENAI_API_KEY`) — по-перше, щоб прогін не коштував
 * грошей, по-друге, бо сама відмова теж вимагає перевірки: автор має
 * побачити причину українською, а не порожнє вікно. Кнопки передачі при
 * цьому працюють без ШІ — текст можна вписати руками, і саме так тут
 * перевіряється передача до книги.
 *
 * Пастка, яку тут НЕ повторюємо (log.md #172): усередині page.evaluate не
 * оголошувати іменованих функцій — tsx обгортає їх у `__name`, якого в
 * браузері немає.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.join(os.tmpdir(), 'nova-media-describe');
const PORT = Number(process.env.MEDIA_DESCRIBE_PORT || 34195);
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
  id: 'u-live-describe',
  email: 'media-describe@test.ua',
  name: 'Живий опис',
  role: 'admin',
  createdAt: new Date().toISOString(),
} as any);

const TOKEN = crypto.randomBytes(32).toString('hex');
await createSession({
  token: TOKEN,
  userId: 'u-live-describe',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
});

const BOOK_ID = 'BK-2084-CYBER';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);
const MP4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');

const PHOTO = 'портрет-для-опису.png';
const VIDEO = 'кліп-для-кадру.mp4';

const photoAsset = await saveAsset({
  ownerId: 'u-live-describe',
  bookId: BOOK_ID,
  kind: 'illustration',
  filename: PHOTO,
  mimeType: 'image/png',
  bytes: PNG,
});
await saveAsset({
  ownerId: 'u-live-describe',
  bookId: BOOK_ID,
  kind: 'video',
  filename: VIDEO,
  mimeType: 'video/mp4',
  bytes: MP4,
});

const serverLog: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    DATA_DIR: DIR,
    DATABASE_PATH: `${DIR}/nova-studio.db`,
    PORT: String(PORT),
    NODE_ENV: 'production',
    // Порожні ключі — див. заголовок файлу: прогін не має коштувати грошей,
    // а чесна відмова без ключа теж потребує перевірки.
    GEMINI_API_KEY: '',
    OPENAI_API_KEY: '',
  },
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
t('сервер піднявся (ключі ШІ порожні — прогін безкоштовний)', true);

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
  await page.setViewport({ width: 1680, height: 1000 });
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
  t('медіатека відкрилася: фото й відео на місці', true);

  /** Які з нових кнопок намальовані на картці з такою назвою. */
  const cardButtons = (title: string) =>
    page.evaluate((name: string) => {
      const cards = Array.from(document.querySelectorAll('[data-tour="media__3"] > div'));
      const card = cards.find((c) => (c.querySelector('h3')?.textContent || '').trim() === name);
      return {
        start: !!card?.querySelector('[data-use-start-frame]'),
        describe: !!card?.querySelector('[data-describe-ai]'),
      };
    }, title);

  const photoButtons = await cardButtons(PHOTO);
  const videoButtons = await cardButtons(VIDEO);
  t('на ФОТО є кнопка «Генерувати відео»', photoButtons.start);
  t('на ФОТО є кнопка «Описати ШІ»', photoButtons.describe);
  t('на ВІДЕО цих кнопок немає', !videoButtons.start && !videoButtons.describe);

  // ── 1. Фото → стартовий кадр відео ─────────────────────────────────────
  await page.evaluate((name: string) => {
    const photo = name;
    const cards = Array.from(document.querySelectorAll('[data-tour="media__3"] > div'));
    const card = cards.find((c) => (c.querySelector('h3')?.textContent || '').trim() === photo);
    (card?.querySelector('[data-use-start-frame]') as HTMLElement | null)?.click();
  }, PHOTO);

  await page.waitForFunction(() => document.querySelector('aside[data-media-mode="video"]') !== null, { timeout: 10000 });
  t('панель генерації перейшла в режим «відео»', true);

  const frameShown = await page.evaluate((url: string) => {
    const aside = document.querySelector('aside[data-media-mode="video"]');
    return Array.from(aside?.querySelectorAll('img') || []).some((img) => (img.getAttribute('src') || '') === url);
  }, photoAsset.url);
  t('фото стало стартовим кадром у панелі', frameShown, photoAsset.url);

  const toastText = await page.evaluate(() => document.body.innerText);
  t('автор бачить підказку про стартовий кадр', toastText.includes('стартовим кадром відео'));

  // ── 2. «Описати ШІ» — вікно ────────────────────────────────────────────
  await page.evaluate((name: string) => {
    const cards = Array.from(document.querySelectorAll('[data-tour="media__3"] > div'));
    const card = cards.find((c) => (c.querySelector('h3')?.textContent || '').trim() === name);
    (card?.querySelector('[data-describe-ai]') as HTMLElement | null)?.click();
  }, PHOTO);
  await page.waitForSelector('[data-describe-modal]', { timeout: 10000 });
  t('кнопка «Описати ШІ» відкрила вікно', true);

  const modalShape = await page.evaluate(() => {
    const modal = document.querySelector('[data-describe-modal]') as HTMLElement | null;
    const target = modal?.querySelector('[data-describe-target]') as HTMLSelectElement | null;
    return {
      text: modal?.innerText || '',
      hasTextarea: !!modal?.querySelector('[data-describe-text]'),
      hasTitle: !!modal?.querySelector('[data-describe-title]'),
      targets: target ? Array.from(target.options).map((o) => o.value) : [],
      hasTransferText: !!modal?.querySelector('[data-describe-transfer-text]'),
      hasTransferBoth: !!modal?.querySelector('[data-describe-transfer-both]'),
    };
  });
  t('видно фото, поле тексту й заголовок', modalShape.hasTextarea && modalShape.hasTitle);
  t('є три цілі передачі', modalShape.targets.join(',') === 'book,instruction,course', modalShape.targets.join(','));
  t('є обидві кнопки передачі', modalShape.hasTransferText && modalShape.hasTransferBoth);

  // Ключів немає — вікно мусить сказати причину, а не мовчати.
  await page.waitForFunction(
    () => {
      const modal = document.querySelector('[data-describe-modal]') as HTMLElement | null;
      return (modal?.innerText || '').includes('Ключ');
    },
    { timeout: 15000 }
  );
  t('без ключа вікно показує причину українською (а не порожнечу)', true);

  // ── 3. Передача тексту: у книгу (без ШІ, текст вписуємо руками) ────────
  const TITLE = 'Ігор Вовк за фото (live)';
  await page.evaluate((payload: string[]) => {
    const [title, body] = payload;
    const modal = document.querySelector('[data-describe-modal]') as HTMLElement | null;
    const titleInput = modal?.querySelector('[data-describe-title]') as HTMLInputElement | null;
    const textArea = modal?.querySelector('[data-describe-text]') as HTMLTextAreaElement | null;
    if (titleInput) {
      const titleSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(titleInput), 'value')?.set;
      titleSet?.call(titleInput, title);
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (textArea) {
      const textSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textArea), 'value')?.set;
      textSet?.call(textArea, body);
      textArea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, [TITLE, 'Перший абзац живого опису.\n\nДругий абзац живого опису.']);

  await page.evaluate(() => {
    (document.querySelector('[data-describe-transfer-text]') as HTMLElement | null)?.click();
  });
  await page.waitForFunction(() => !document.querySelector('[data-describe-modal]'), { timeout: 15000 });
  t('після передачі вікно закрилося', true);

  await page.waitForFunction(
    (title: string) => document.body.innerText.includes(title),
    { timeout: 10000 },
    TITLE
  );
  t('тост підтвердив передачу в книгу', true);

  // Найважливіше: розділ справді зʼявився в книзі, а не лише в тості.
  await page.click('#nav-tab-toc');
  await page.waitForFunction(
    (title: string) => document.body.innerText.includes(title),
    { timeout: 15000 },
    TITLE
  );
  t('новий розділ видно у «Змісті» книги', true);

  // ── 4. «Разом з фото» — друга передача ────────────────────────────────
  await page.click('#nav-tab-media');
  await page.waitForSelector('[data-tour="media__3"]', { timeout: 15000 });
  await page.evaluate((name: string) => {
    const cards = Array.from(document.querySelectorAll('[data-tour="media__3"] > div'));
    const card = cards.find((c) => (c.querySelector('h3')?.textContent || '').trim() === name);
    (card?.querySelector('[data-describe-ai]') as HTMLElement | null)?.click();
  }, PHOTO);
  await page.waitForSelector('[data-describe-modal]', { timeout: 10000 });
  const TITLE_BOTH = 'Ігор Вовк з фото (live)';
  await page.evaluate((payload: string[]) => {
    const [title, body] = payload;
    const modal = document.querySelector('[data-describe-modal]') as HTMLElement | null;
    const titleInput = modal?.querySelector('[data-describe-title]') as HTMLInputElement | null;
    const textArea = modal?.querySelector('[data-describe-text]') as HTMLTextAreaElement | null;
    if (titleInput) {
      const titleSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(titleInput), 'value')?.set;
      titleSet?.call(titleInput, title);
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (textArea) {
      const textSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textArea), 'value')?.set;
      textSet?.call(textArea, body);
      textArea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, [TITLE_BOTH, 'Опис разом із фото.']);
  await page.evaluate(() => {
    (document.querySelector('[data-describe-transfer-both]') as HTMLElement | null)?.click();
  });
  await page.waitForFunction(() => !document.querySelector('[data-describe-modal]'), { timeout: 15000 });
  await page.click('#nav-tab-toc');
  await page.waitForFunction(
    (title: string) => document.body.innerText.includes(title),
    { timeout: 15000 },
    TITLE_BOTH
  );
  t('друга передача («разом з фото») теж дала розділ у книзі', true);

  const shotDir = path.join(ROOT, 'tmp');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, 'media-describe-transfer.png'), fullPage: true });
  console.log('     (знімок: tmp/media-describe-transfer.png)');

  // ── 4.5. Ціль «курс» — окрема сутність із власним сховищем ─────────────
  await page.click('#nav-tab-media');
  await page.waitForSelector('[data-tour="media__3"]', { timeout: 15000 });
  await page.evaluate((name: string) => {
    const cards = Array.from(document.querySelectorAll('[data-tour="media__3"] > div'));
    const card = cards.find((c) => (c.querySelector('h3')?.textContent || '').trim() === name);
    (card?.querySelector('[data-describe-ai]') as HTMLElement | null)?.click();
  }, PHOTO);
  await page.waitForSelector('[data-describe-modal]', { timeout: 10000 });
  const COURSE_TITLE = 'Курс про Ігоря (live)';
  await page.evaluate((payload: string[]) => {
    const [title, body] = payload;
    const modal = document.querySelector('[data-describe-modal]') as HTMLElement | null;
    const titleInput = modal?.querySelector('[data-describe-title]') as HTMLInputElement | null;
    const textArea = modal?.querySelector('[data-describe-text]') as HTMLTextAreaElement | null;
    if (titleInput) {
      const titleSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(titleInput), 'value')?.set;
      titleSet?.call(titleInput, title);
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (textArea) {
      const textSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textArea), 'value')?.set;
      textSet?.call(textArea, body);
      textArea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const select = modal?.querySelector('[data-describe-target]') as HTMLSelectElement | null;
    if (select) {
      const selSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value')?.set;
      selSet?.call(select, 'course');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, [COURSE_TITLE, 'Матеріал уроку про персонажа.']);
  await page.evaluate(() => {
    (document.querySelector('[data-describe-transfer-both]') as HTMLElement | null)?.click();
  });
  await page.waitForFunction(() => !document.querySelector('[data-describe-modal]'), { timeout: 15000 });
  t('передача в «курс» закрила вікно', true);

  const courses = await fetch(`${BASE}/api/courses`, { headers: { cookie: `nova_session=${TOKEN}` } })
    .then((r) => (r.ok ? r.json() : { courses: [] }))
    .then((d) => (Array.isArray(d?.courses) ? d.courses : []));
  const createdCourse = courses.find((c: any) => c.title === COURSE_TITLE);
  t('курс справді створено на сервері', !!createdCourse, courses.map((c: any) => c.title).join(' | '));
  t(
    'урок курсу несе текст і фото',
    !!createdCourse &&
      createdCourse.modules?.[0]?.lessons?.[0]?.description === 'Матеріал уроку про персонажа.' &&
      createdCourse.modules?.[0]?.lessons?.[0]?.photoUrls?.[0] === photoAsset.url,
    JSON.stringify(createdCourse?.modules || []).slice(0, 400)
  );

  // ── 5. Ціль «інструкція» без чернетки — чесна відмова ─────────────────
  await page.click('#nav-tab-media');
  await page.waitForSelector('[data-tour="media__3"]', { timeout: 15000 });
  await page.evaluate((name: string) => {
    const cards = Array.from(document.querySelectorAll('[data-tour="media__3"] > div'));
    const card = cards.find((c) => (c.querySelector('h3')?.textContent || '').trim() === name);
    (card?.querySelector('[data-describe-ai]') as HTMLElement | null)?.click();
  }, PHOTO);
  await page.waitForSelector('[data-describe-modal]', { timeout: 10000 });
  await page.evaluate(() => {
    const modal = document.querySelector('[data-describe-modal]') as HTMLElement | null;
    const textArea = modal?.querySelector('[data-describe-text]') as HTMLTextAreaElement | null;
    if (textArea) {
      const textSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textArea), 'value')?.set;
      textSet?.call(textArea, 'Текст для інструкції.');
      textArea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const select = modal?.querySelector('[data-describe-target]') as HTMLSelectElement | null;
    if (select) {
      const selSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value')?.set;
      selSet?.call(select, 'instruction');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.evaluate(() => {
    (document.querySelector('[data-describe-transfer-text]') as HTMLElement | null)?.click();
  });
  const stillOpen = await page.evaluate(() => !!document.querySelector('[data-describe-modal]'));
  t('без чернетки інструкції вікно НЕ закривається (текст не втрачено)', stillOpen);
  const instructionRefused = await page.evaluate(() => document.body.innerText.includes('Чернетки інструкції ще немає'));
  t('і автор бачить, чому саме передача не відбулася', instructionRefused);
  await page.screenshot({ path: path.join(shotDir, 'media-describe-instruction-refused.png') });
} finally {
  await browser.close();
  stopServer();
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
