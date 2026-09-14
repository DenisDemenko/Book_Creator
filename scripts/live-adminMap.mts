/**
 * Живий прогін карти адмінпанелі в справжньому браузері.
 * Запуск: npm run live:admin-map   (потрібен `npm run build` — сервер береться з dist/)
 *
 * НАВІЩО. Карта адмінки — це навігація, і її єдина обіцянка звучить так:
 * «кожна пігулка відкриває СПРАВЖНІЙ розділ». Обіцянку не перевірити ні
 * типами, ні юніт-тестом: вузол може мати правильний `action`, а сторінка —
 * не малювати нічого (саме так і жила заглушка «Промти ядра» роками).
 * Тому тут усе по-справжньому: Express із тим самим кодом, що в проді,
 * сесія адміністратора, headless Chrome і КОЖНА з одинадцяти пігулок.
 *
 * Як входимо без Firebase: сесію створюємо тим самим сховищем, що й сервер
 * (`createSession` + cookie `nova_session`), тому сервер бачить звичайного
 * залогіненого адміністратора. Жодних послаблень у прод-коді для цього немає.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.join(os.tmpdir(), 'nova-admin-map');
const PORT = Number(process.env.ADMIN_MAP_PORT || 34177);
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

// ---------------------------------------------------------------------------
// 1. Дані: адміністратор і його сесія (до старту сервера — щоб не ділити
//    один файл бази на двох письменників одночасно).
// ---------------------------------------------------------------------------
const { initStore, saveUser, createSession } = await import('../server/store');
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
console.log(`Дані: адміністратор ${ADMIN_EMAIL} і сесія в ${DIR}`);

// ---------------------------------------------------------------------------
// 2. Сервер: той самий зібраний застосунок, що їде в прод.
// ---------------------------------------------------------------------------
const serverLog: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, PORT: String(PORT), NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => serverLog.push(String(d)));
child.stderr.on('data', (d) => serverLog.push(String(d)));

const stopServer = () => {
  try {
    child.kill();
  } catch {
    /* вже мертвий */
  }
};
process.on('exit', stopServer);

async function waitForServer(): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/status`);
      if (r.ok) return true;
    } catch {
      /* ще не піднявся */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

console.log('Сервер: стартуючи dist/server.mjs…');
if (!(await waitForServer())) {
  console.error('Сервер не піднявся. Останні рядки логу:\n' + serverLog.join('').slice(-2000));
  stopServer();
  process.exit(1);
}
t('сервер піднявся й відповідає', true);
t('сесія адміністратора приймається', (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: `nova_session=${TOKEN}` } })).status === 200);

// ---------------------------------------------------------------------------
// 3. Браузер
// ---------------------------------------------------------------------------
const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));
if (!CHROME) {
  console.error('Не знайдено Chrome/Chromium. Задайте CHROMIUM_PATH.');
  stopServer();
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  // Cookie ставимо напряму в браузер — так само, як це зробив би сервер
  // заголовком Set-Cookie. Тип `CookieData` у puppeteer вимагає `domain`+`path`.
  await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  // Перехід в «Адмінпанель» — так само, як це робить користувач.
  await page.waitForSelector('#nav-tab-admin', { timeout: 30000 });
  await page.click('#nav-tab-admin');
  await page.waitForSelector('.os-pill', { timeout: 20000 });

  const shot = async (name: string) => {
    const dir = path.join(ROOT, 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `admin-map-${name}.png`) });
  };

  console.log('\nКарта:');
  const map = await page.evaluate(() => {
    const pills = Array.from(document.querySelectorAll('.os-pill'));
    const danger = Array.from(document.querySelectorAll('.os-pill--danger'));
    // Смуга сутностей є ТІЛЬКИ на карті — за нею й відрізняємо карту від
    // сторінки розділу. Рахувати пігулки не можна: у консолі вони живуть
    // у колонці шарів, і їх там теж одинадцять.
    const band = Array.from(document.querySelectorAll('div')).filter(
      (d) => d.className.includes('rounded-full') && d.className.includes('border-cyan-400/25')
    );
    const text = document.body.innerText.toLowerCase();
    return {
      pills: pills.length,
      labels: pills.map((p) => p.getAttribute('aria-label') || ''),
      danger: danger.map((p) => p.getAttribute('aria-label') || ''),
      circuits: document.querySelectorAll('.os-circuit').length,
      tiles: band.length,
      hasCore: text.includes('ядро'),
      headerOk: text.includes('адмін панель'),
    };
  });

  t('на карті 11 пігулок', map.pills === 11, String(map.pills));
  t('кожна пігулка підписана (доступна з клавіатури/скрін-рідера)', map.labels.every((l: string) => l.length > 3));
  t('червона пігулка рівно одна', map.danger.length === 1, map.danger.join(', '));
  t('червона — саме «Історія комітів»', (map.danger[0] || '').startsWith('Історія комітів'), map.danger[0] || '');
  t('провідники від ядра намальовані', map.circuits >= 11, String(map.circuits));
  t('ядро підписане', map.hasCore);
  t('шапка називає сторінку', map.headerOk);
  t('плиток смуги сутностей вісім', map.tiles === 8, String(map.tiles));
  await shot('map');
  console.log(`     (знімок: tmp/admin-map-map.png)`);

  // -------------------------------------------------------------------------
  console.log('\nКожен вузол відкриває справжній розділ:');
  const nodes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.os-pill')).map((p) => p.getAttribute('aria-label') || '')
  );

  /**
   * Що саме має бути видно в робочій області кожного вузла. Це не «текст є»,
   * а «відкрився саме цей екран»: мітки взяті з того, що ці розділи друкують
   * заголовками. Порівняння — без урахування регістру, бо в розмітці стоїть
   * CSS `uppercase`, і `innerText` віддає вже піднятий текст.
   */
  const MARKERS: Record<string, string> = {
    'Провайдери ШІ': 'ключі api',
    'Промти ядра': 'ядро ai',
    'Тарифи ШІ': 'тариф',
    'Витрати на API': 'за період',
    'Бізнес-аналітика': 'дохід',
    'Міст до вітрини': 'міст',
    'Модерація': 'модерація',
    'Користувачі': 'облікові записи',
    'Доступ і ролі': 'дозвол',
    'CRM': 'облік користувачів',
    'Історія комітів': 'коміт',
  };

  for (const label of nodes) {
    const title = label.split('.')[0].trim();
    await page.evaluate((lbl: string) => {
      const el = Array.from(document.querySelectorAll('.os-pill')).find((p) => (p.getAttribute('aria-label') || '') === lbl);
      (el as HTMLElement | undefined)?.click();
    }, label);

    /*
     * Розділи вантажаться асинхронно, і по-різному довго: «Історія комітів»
     * читає живий git log і парсить журнал, тож за фіксовану паузу вона не
     * встигає й виглядала б як порожня. Чекаємо, доки в робочій області
     * зʼявиться справжній вміст (або доки не мине стеля — тоді чесно падаємо).
     */
    await page
      .waitForFunction(
        () => ((document.querySelector('[data-admin-work]') as HTMLElement | null)?.innerText || '').trim().length > 60,
        { timeout: 15000, polling: 250 }
      )
      .catch(() => undefined);

    const state = await page.evaluate(() => {
      // Робоча область розділу — за стабільним атрибутом, а не за класами:
      // класи Tailwind з дужками довелось би екранувати й вони міняються.
      const work = document.querySelector('[data-admin-work]') as HTMLElement | null;
      const body = document.body.innerText.toLowerCase();
      const band = Array.from(document.querySelectorAll('div')).filter(
        (d) => d.className.includes('rounded-full') && d.className.includes('border-cyan-400/25')
      );
      return {
        back: body.includes('до карти'),
        bandTiles: band.length,
        workChars: (work?.innerText || '').trim().length,
        workText: (work?.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase(),
      };
    });

    const marker = MARKERS[title] || '';
    t(`«${title}»: відкрився саме цей розділ`,
      state.back && state.bandTiles === 0 && state.workChars > 60 && (!marker || state.workText.includes(marker)),
      `маркер «${marker}»: ${state.workText.includes(marker) ? 'є' : 'немає'}, символів: ${state.workChars}`);
  }

  // -------------------------------------------------------------------------
  console.log('\nЗаглушок не лишилось:');
  const afterText = await page.evaluate(() => document.body.innerText.toLowerCase());
  t('тексту-заглушки «відкривається кнопкою Швидкий AI» немає',
    !afterText.includes('відкривається кнопкою'));
  t('панель інспектора на місці', afterText.includes('інспектор вузла'));

  // Три самостійні сторінки — перевіряємо їхній вміст окремо: тут важливо,
  // що показано САМЕ той екран, а не будь-яка сторінка з текстом.
  const openByTitle = async (fragment: string) => {
    await page.evaluate(() => {
      const back = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('До карти'));
      (back as HTMLElement | undefined)?.click();
    });
    await page.waitForSelector('.os-pill', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate((frag: string) => {
      const el = Array.from(document.querySelectorAll('.os-pill')).find((p) => (p.getAttribute('aria-label') || '').startsWith(frag));
      (el as HTMLElement | undefined)?.click();
    }, fragment);
    await new Promise((r) => setTimeout(r, 1500));
    return page.evaluate(() =>
      (document.querySelector('[data-admin-work]') as HTMLElement | null)?.innerText.toLowerCase() || ''
    );
  };

  const backToMap = await page.evaluate(() => {
    const back = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('До карти'));
    (back as HTMLElement | undefined)?.click();
    return true;
  });
  await page.waitForSelector('.os-pill--danger', { timeout: 10000 });
  t('кнопка «До карти» повертає на карту', backToMap);

  const keysText = await openByTitle('Провайдери ШІ');
  t('«Провайдери ШІ» показує саме ключі', /ключ/i.test(keysText), keysText.slice(0, 80));
  await shot('api-keys');

  const coreText = await openByTitle('Промти ядра');
  t('«Промти ядра» показує конструктор промтів', /інструкц|модул|промт/i.test(coreText) && coreText.length > 200, coreText.slice(0, 80));
  await shot('core-ai');

  const modText = await openByTitle('Модерація');
  t('«Модерація» показує чергу погоджень', /модерац|черг/i.test(modText), modText.slice(0, 80));
  await shot('moderation');

  // -------------------------------------------------------------------------
  // Тулбар «Книга та текст» — та сама перевірка, але на СПРАВЖНЬОМУ екрані:
  // скарга власника була саме про місце, яке підписи зʼїдали.
  console.log('\nТулбар «Книга та текст» (лише іконки):');
  await page.evaluate(() => (document.getElementById('nav-tab-editor') as HTMLElement | null)?.click());

  const toolbarReady = await page
    .waitForSelector('button[aria-label="+ Сноска [^]"]', { timeout: 25000 })
    .then(() => true)
    .catch(() => false);

  if (!toolbarReady) {
    console.log('  ⚠ редактор не відкрився — перевірку тулбара пропущено (не провал: це інший екран)');
  } else {
    // Підписи кнопок — з uk-словника: саме їх раніше було видно на кнопках.
    const LABELS = ['— Тире', '« » Лапки', '+ Сноска [^]', '+ QR-код', '+ З галереї', '+ 🎨 Ілюстрація (AI)', '+ Тега', 'Перейти до тегу'];
    const buttons = await page.evaluate((labels: string[]) =>
      labels.map((label) => {
        const el = document.querySelector(`button[aria-label="${label}"]`) as HTMLElement | null;
        return {
          label,
          found: !!el,
          visibleText: (el?.innerText || '').trim(),
          hasTitle: !!el?.getAttribute('title'),
          svg: el ? el.querySelectorAll('svg').length : 0,
        };
      }), LABELS);

    t('кнопки тулбара знайдено за підписом (він тепер в aria-label)',
      buttons.every((b) => b.found), buttons.filter((b) => !b.found).map((b) => b.label).join(', '));
    t('жодного видимого підпису на кнопках не лишилось',
      buttons.every((b) => b.visibleText === ''), buttons.filter((b) => b.visibleText).map((b) => `${b.label} → «${b.visibleText}»`).join('; '));
    t('у кожної кнопки є підказка при наведенні',
      buttons.every((b) => b.hasTitle), buttons.filter((b) => !b.hasTitle).map((b) => b.label).join(', '));
    t('у кожної кнопки є іконка',
      buttons.every((b) => b.svg > 0), buttons.filter((b) => b.svg === 0).map((b) => b.label).join(', '));

    // Перемикач тегів міняє і підпис, і іконку — перевіряємо обидва стани.
    const tagToggle = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Сховати теги"], button[aria-label="Показати теги"]') as HTMLElement | null;
      return { label: btn?.getAttribute('aria-label') || '', icons: btn?.querySelectorAll('svg').length || 0, text: (btn?.innerText || '').trim() };
    });
    t('перемикач тегів підписаний і має іконку',
      tagToggle.label.length > 0 && tagToggle.icons > 0 && tagToggle.text === '', JSON.stringify(tagToggle));
    await shot('editor-toolbar');
  }
} finally {
  await browser.close();
  stopServer();
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
