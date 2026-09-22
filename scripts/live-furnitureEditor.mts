/**
 * Живий прогін редактора виробу в адмінпанелі (частина А плану #173).
 * Запуск: npm run live:furniture-editor   (потрібен `npm run build`).
 *
 * НАВІЩО. Редактор «Управління карткою вітрини» — це довга форма з двома
 * темами, і її обіцянка — «картка виробу заводиться, зберігається й
 * показується в переліку». Перевіряємо по-справжньому: Express із прод-кодом,
 * сесія адміністратора, headless Chrome, клік «Додати виріб» → заповнення →
 * збереження → повернення в перелік.
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

const DIR = path.join(os.tmpdir(), 'nova-furniture-editor');
const PORT = Number(process.env.FURNITURE_EDITOR_PORT || 34191);
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
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tropazemli@gmail.com';

const { initStore, saveUser, createSession } = await import('../server/store');
const { blankFurnitureProduct } = await import('../src/components/adminOs/furnitureProduct');
await initStore();
await saveUser({
  id: 'u-live-admin',
  email: ADMIN_EMAIL,
  name: 'Жива перевірка',
  role: 'admin',
  createdAt: new Date().toISOString(),
} as any);

const TOKEN = crypto.randomBytes(32).toString('hex');
await createSession({
  token: TOKEN,
  userId: 'u-live-admin',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
});

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

// ---------------------------------------------------------------------------
// СЕРВЕРНА половина тієї самої перевірки.
//
// Браузер показує, що РЕДАКТОР відмовляє; тут перевіряємо, що й МАРШРУТ
// відмовляє — до моста. Саме це 16.09.2026 дало власнику сирий HTTP 400 з
// англійським текстом замість причини українською.
// ---------------------------------------------------------------------------
console.log('\nМежі полів на сервері (без моста):');
{
  const cookie = `nova_session=${TOKEN}`;
  const probe = (id: string, sku: string, over: Record<string, unknown>) => ({
    ...blankFurnitureProduct(),
    id,
    sku,
    name: 'Перевірка межі',
    priceUah: 100,
    media: [{ id: 'm', label: 'банер', src: 'data:,' }],
    ...over,
  });

  const saveProbe = async (p: unknown) =>
    fetch(`${BASE}/api/admin/furniture-products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ product: p }),
    });
  const publishProbe = async (id: string) => {
    const r = await fetch(`${BASE}/api/admin/furniture-products/${id}/publish`, { method: 'POST', headers: { cookie } });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, error: String(body?.error || '') };
  };
  const dropProbe = (id: string) =>
    fetch(`${BASE}/api/admin/furniture-products/${id}`, { method: 'DELETE', headers: { cookie } });

  const longTeaser = await saveProbe(probe('live-limit', 'LIVE-LIMIT', { teaser: 'т'.repeat(301) }));
  t('чорнетка з довгим тизером збереглася', longTeaser.ok, String(longTeaser.status));
  const longRefused = await publishProbe('live-limit');
  t('маршрут відмовив до моста (400, а не 409 «міст не налаштований»)', longRefused.status === 400, String(longRefused.status));
  t('причина — про тизер, українською', longRefused.error.includes('Тизер задовгий'), longRefused.error.slice(0, 110));
  await dropProbe('live-limit');

  // Дробовий залишок: приймач перевіряє stock як ціле (@IsInt()), тож міст
  // має отримати округлене. Доказ — відмова приходить про МІСТ, а не про stock.
  const frac = await saveProbe(probe('live-frac', 'LIVE-FRAC', { stock: 4.7 }));
  t('чорнетка з дробовим залишком збереглася', frac.ok, String(frac.status));
  const fracRefused = await publishProbe('live-frac');
  t('дробовий залишок не спіткнувся об валідацію stock', !fracRefused.error.includes('stock'), fracRefused.error.slice(0, 110));
  await dropProbe('live-frac');
}

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

  await page.waitForSelector('#nav-tab-admin', { timeout: 30000 });
  await page.click('#nav-tab-admin');
  await page.waitForSelector('.os-pill', { timeout: 20000 });

  // Відкрити вузол «Управління товарами».
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.os-pill')).find((p) => (p.getAttribute('aria-label') || '').startsWith('Управління товарами'));
    (el as HTMLElement | undefined)?.click();
  });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-admin-work]') as HTMLElement | null;
    return (el?.innerText || '').toLowerCase().includes('додати виріб');
  }, { timeout: 20000 });
  t('розділ «Управління товарами» відкрився з кнопкою «Додати виріб»', true);

  // Відкрити редактор.
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-admin-work] button'));
    const btn = btns.find((b) => (b.textContent || '').includes('Додати виріб'));
    (btn as HTMLElement | undefined)?.click();
  });
  await page.waitForSelector('[data-furniture-theme]', { timeout: 20000 });

  const shotDir = path.join(ROOT, 'tmp');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, 'furniture-editor-night.png'), fullPage: true });
  console.log('     (знімок: tmp/furniture-editor-night.png)');

  const title = await page.evaluate(() => (document.querySelector('[data-furniture-theme]') as HTMLElement | null)?.innerText.includes('Управління карткою вітрини') ?? false);
  t('редактор виробу відкрився (заголовок «Управління карткою вітрини»)', title);

  const theme = await page.evaluate(() => (document.querySelector('[data-furniture-theme]') as HTMLElement | null)?.getAttribute('data-furniture-theme'));
  t('стартова тема — нічна', theme === 'night', String(theme));

  // Перемикання на денну тему.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('[data-furniture-theme] button')).find((b) => (b.getAttribute('aria-label') || '').includes('денну тему') || (b.getAttribute('title') || '').includes('Денна тема'));
    (btn as HTMLElement | undefined)?.click();
  });
  await page.waitForFunction(() => (document.querySelector('[data-furniture-theme]') as HTMLElement | null)?.getAttribute('data-furniture-theme') === 'day', { timeout: 5000 });
  t('перемикач вмикає денну тему', true);
  await page.screenshot({ path: path.join(ROOT, 'tmp', 'furniture-editor-day.png'), fullPage: true });
  console.log('     (знімок: tmp/furniture-editor-day.png)');

  // Повернути нічну — далі працюємо в ній.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('[data-furniture-theme] button')).find((b) => (b.getAttribute('aria-label') || '').includes('нічну тему'));
    (btn as HTMLElement | undefined)?.click();
  });
  await page.waitForFunction(() => (document.querySelector('[data-furniture-theme]') as HTMLElement | null)?.getAttribute('data-furniture-theme') === 'night', { timeout: 5000 });

  // Заповнити картку.
  const setValue = async (field: string, value: string) => {
    await page.evaluate(([f, v]) => {
      const input = document.querySelector(`[data-field="${f}"]`) as HTMLInputElement | null;
      if (!input) return;
      const proto = Object.getPrototypeOf(input) as typeof HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, [field, value] as const);
  };
  await setValue('name', 'Тестовий органайзер (live)');
  await setValue('sku', 'LIVE-ORG-001');
  await setValue('price', '8900');

  // Межа тизера: 301 символ має відмовити ЛОКАЛЬНО (до моста), а не сирою
  // відмовою приймача. `maxLength` блокує набір, тому ставимо значення
  // програмно — саме так воно приходить із чорнетки, збереженої до правки.
  await page.evaluate(() => {
    const input = document.querySelector('[data-field="teaser"]') as HTMLInputElement | null;
    if (!input) return;
    const proto = Object.getPrototypeOf(input) as typeof HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(input, 'т'.repeat(301));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const counterShown = await page.evaluate(() => (document.querySelector('[data-furniture-theme]') as HTMLElement | null)?.innerText.includes('301/300') ?? false);
  t('редактор показує перевищення межі тизера (301/300)', counterShown);

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-furniture-theme] header button'));
    const btn = btns.find((b) => (b.textContent || '').includes('Опублікувати на вітрині'));
    (btn as HTMLElement | undefined)?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const refused = await page.evaluate(() => (document.querySelector('[data-furniture-theme]') as HTMLElement | null)?.innerText.includes('Тизер задовгий') ?? false);
  t('задовгий тизер відмовив локально, з причиною українською', refused);

  // Повертаємо робочий тизер, щоб збереження чорнетки було чистим.
  await setValue('teaser', 'Короткий тизер для перевірки.');
  await new Promise((r) => setTimeout(r, 300));

  // -------------------------------------------------------------------------
  // ВАРІАНТИ — додаткові артикули (#225).
  //
  // Юніт-тести вже перевіряють модель; тут перевіряється те, чого вони не
  // бачать: що рядок варіанта справді з'являється у формі, тримає власні
  // значення і що дубль артикула зупиняє публікацію ЛОКАЛЬНО, з причиною
  // українською — а не сирою відмовою приймача або, гірше, публікацією двох
  // однакових артикулів.
  // -------------------------------------------------------------------------
  const setVariant = async (field: string, index: number, value: string) => {
    await page.evaluate(([f, i, v]) => {
      const el = document.querySelector(`[data-variant-${f}="${i}"]`) as HTMLInputElement | null;
      if (!el) return;
      const proto = Object.getPrototypeOf(el) as typeof HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [field, index, value] as const);
  };

  const clickAddVariant = async () => {
    await page.evaluate(() => {
      (document.querySelector('[data-field="add-variant"]') as HTMLElement | null)?.click();
    });
    await new Promise((r) => setTimeout(r, 200));
  };

  await clickAddVariant();
  const rowsAfterFirst = await page.evaluate(() => document.querySelectorAll('[data-variant-row]').length);
  t('кнопка «Додати варіант» створює рядок', rowsAfterFirst === 1, String(rowsAfterFirst));

  await setVariant('name', 1, '2pc Phone/Pens Lid');
  await setVariant('sku', 1, 'LIVE-V-2PC');
  await setVariant('price', 1, '3800');
  await setVariant('stock', 1, '3');
  await new Promise((r) => setTimeout(r, 200));

  // Значення читаємо з .value, а не з innerText: у полів введення текст у
  // розмітці не живе, і перевірка «на око» тут нічого не доводила б.
  // Усередині evaluate — ЖОДНИХ оголошених функцій (пастка `__name`): тому
  // чотири окремі запити замість хелпера.
  const firstRow = await page.evaluate(() => {
    const name = document.querySelector('[data-variant-name="1"]') as HTMLInputElement | null;
    const sku = document.querySelector('[data-variant-sku="1"]') as HTMLInputElement | null;
    const price = document.querySelector('[data-variant-price="1"]') as HTMLInputElement | null;
    const stock = document.querySelector('[data-variant-stock="1"]') as HTMLInputElement | null;

    return {
      name: name?.value ?? '',
      sku: sku?.value ?? '',
      price: price?.value ?? '',
      stock: stock?.value ?? '',
    };
  });
  t(
    'рядок варіанта тримає назву, артикул, ціну й залишок',
    firstRow.name === '2pc Phone/Pens Lid' &&
      firstRow.sku === 'LIVE-V-2PC' &&
      firstRow.price === '3800' &&
      firstRow.stock === '3',
    JSON.stringify(firstRow),
  );

  const priceHint = await page.evaluate(() =>
    (document.querySelector('[data-furniture-theme]') as HTMLElement | null)?.innerText.includes('від') ?? false
  );
  t('редактор каже, що ціна каталогу — «від» найдешевшого варіанта', priceHint);

  // Другий варіант з ТИМ САМИМ артикулом — різний лише регістр, бо покупець
  // однаково не має бачити два артикули з однаковою ідентичністю.
  await clickAddVariant();
  await setVariant('name', 2, '4pc + 3 Lids');
  await setVariant('sku', 2, 'live-v-2pc');
  await setVariant('price', 2, '4800');
  await new Promise((r) => setTimeout(r, 300));

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-furniture-theme] header button'));
    const btn = btns.find((b) => (b.textContent || '').includes('Опублікувати на вітрині'));
    (btn as HTMLElement | undefined)?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const dupRefused = await page.evaluate(() =>
    (document.querySelector('[data-furniture-theme]') as HTMLElement | null)?.innerText.includes('уже зайнятий') ?? false
  );
  t('дубль артикула зупиняє публікацію, причина українською', dupRefused);

  await page.screenshot({ path: path.join(shotDir, 'furniture-editor-variants.png'), fullPage: true });
  console.log('     (знімок: tmp/furniture-editor-variants.png)');

  // -------------------------------------------------------------------------
  // ПОРЯДОК ФОТО — перетягування та «зробити головним» (#226).
  //
  // Юніт-тести перевіряють самі функції перестановки; тут перевіряється те,
  // чого вони не бачать: що жест справді привʼязаний до плиток, що перетягування
  // змінює СТАН чорнетки (а отже й поїде на вітрину) і що зірка піднімає фото в
  // головний банер. HTML5 drag-and-drop у headless-Chrome не відтворюється
  // мишею, тому події надсилаємо синтетично — з тим самим DataTransfer, який
  // дав би справжній браузер.
  // -------------------------------------------------------------------------
  const tmpMediaDir = path.join(DIR, 'media');
  fs.mkdirSync(tmpMediaDir, { recursive: true });
  const photoPaths = ['photo-a.png', 'photo-b.png'].map((name, index) => {
    const filePath = path.join(tmpMediaDir, name);
    // 2×2 PNG, різні за вмістом, щоб підписи й порядок було видно на знімку.
    const png = Buffer.from(
      index === 0
        ? 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwDiqkL4KAXWpB/1s1k0MAAAAAElFTkSuQmCC'
        : 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDAwMDEwAAAFBoB/7nO6sUAAAAASUVORK5CYII=',
      'base64'
    );
    fs.writeFileSync(filePath, png);
    return filePath;
  });

  const mediaInput = await page.$('input[type="file"][accept="image/*,video/*"]');
  if (mediaInput) await mediaInput.uploadFile(...photoPaths);
  await page.waitForFunction(
    () => Boolean(document.querySelector('[data-media-main]')) && document.querySelectorAll('[data-media-id]').length >= 1,
    { timeout: 15000 }
  );

  const mediaState = async () =>
    page.evaluate(() => {
      const main = document.querySelector('[data-media-main]') as HTMLElement | null;
      const tiles = Array.from(document.querySelectorAll('[data-media-id]')) as HTMLElement[];
      return { main: main?.getAttribute('data-media-main') ?? '', tiles: tiles.map((el) => el.getAttribute('data-media-id') ?? '') };
    });

  const beforeDrag = await mediaState();
  t('два фото завантажились, перше — головний банер', Boolean(beforeDrag.main) && beforeDrag.tiles.length === 1, JSON.stringify(beforeDrag));

  // Тягнемо друге фото НА головний банер — воно має стати головним.
  //
  // dragstart і drop розділені окремими тактами НАВМИСНО: компонент тримає
  // id перетягуваного в стані (так це працює в Firefox, де під час dragover
  // dataTransfer порожній), а React оновлює стан після обробника. У справжньому
  // перетягуванні між подіями проходять десятки мілісекунд, у синтетичному —
  // жодної, і drop побачив би `null`. Це властивість прогону, а не продукту:
  // тому тут пауза, а не зміна компонента.
  await page.evaluate((fromId) => {
    const from = document.querySelector(`[data-media-id="${fromId}"]`) as HTMLElement | null;
    if (!from) return;
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
  }, beforeDrag.tiles[0] ?? '');
  await new Promise((r) => setTimeout(r, 150));

  await page.evaluate((toId) => {
    const to = document.querySelector(`[data-media-main="${toId}"]`) as HTMLElement | null;
    if (!to) return;
    const dt = new DataTransfer();
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, beforeDrag.main);
  await new Promise((r) => setTimeout(r, 300));

  const afterDrag = await mediaState();
  t(
    'перетягування змінює головне фото (порядок у чорнетці, а не лише на вигляд)',
    afterDrag.main === beforeDrag.tiles[0] && afterDrag.tiles[0] === beforeDrag.main,
    JSON.stringify(afterDrag)
  );

  // Зірка на мініатюрі повертає попереднє фото в головні.
  await page.evaluate((id) => {
    (document.querySelector(`[data-media-make-main="${id}"]`) as HTMLElement | null)?.click();
  }, afterDrag.tiles[0] ?? '');
  await new Promise((r) => setTimeout(r, 300));

  const afterStar = await mediaState();
  t('зірка «зробити головним» повертає фото на перше місце', afterStar.main === beforeDrag.main, JSON.stringify(afterStar));

  await page.screenshot({ path: path.join(shotDir, 'furniture-editor-media-order.png'), fullPage: true });
  console.log('     (знімок: tmp/furniture-editor-media-order.png)');

  // Прибираємо дубль і лишаємо один робочий варіант: далі чорнетка має
  // зберегтися чисто, разом із цим артикулом.
  await page.evaluate(() => {
    (document.querySelector('[data-variant-remove="2"]') as HTMLElement | null)?.click();
  });
  await new Promise((r) => setTimeout(r, 200));
  const rowsAfterRemove = await page.evaluate(() => document.querySelectorAll('[data-variant-row]').length);
  t('рядок варіанта прибирається', rowsAfterRemove === 1, String(rowsAfterRemove));

  // Зберегти чорнетку кнопкою нижньої панелі.
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-furniture-theme] aside button'));
    const btn = btns.find((b) => (b.textContent || '').includes('Зберегти зміни'));
    (btn as HTMLElement | undefined)?.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const saved = await page.evaluate(() => (document.querySelector('[data-furniture-theme]') as HTMLElement | null)?.innerText.includes('збережено як чорнетку') ?? false);
  t('чорнетка збереглася (повідомлення про успіх)', saved);

  // Повернутися в перелік — чорнетка має бути в списку.
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-furniture-theme] aside button'));
    const btn = btns.find((b) => (b.textContent || '').includes('Скасувати'));
    (btn as HTMLElement | undefined)?.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const listText = await page.evaluate(() => (document.querySelector('[data-admin-work]') as HTMLElement | null)?.innerText ?? '');
  const inList = listText.includes('LIVE-ORG-001');
  t('чорнетка зʼявилася в переліку виробів', inList);

  await page.screenshot({ path: path.join(shotDir, 'furniture-editor-list.png') });
  console.log('     (знімок: tmp/furniture-editor-list.png)');
} finally {
  await browser.close();
  stopServer();
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
process.exit(fail ? 1 : 0);
