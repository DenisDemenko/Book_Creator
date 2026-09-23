/**
 * Скріншоти для сторінки довідки (`src/components/HelpGuideView.tsx`).
 *
 * Запуск: npm run build && npm run live:help-screens
 *
 * ЩО РОБИТЬ. Піднімає прод-збірку на тестовій базі, кладе в неї книгу з двома
 * героями (у одного є готові діалоги), відкриває справжній Chrome і робить
 * знімки тих екранів, про які розповідає довідка: панель сутностей, блок
 * «Діалоги героя» у вкладці «Сцена», вікно налаштування, меню підбірки репліки
 * й результат у канві. Пише їх у `public/help/`, звідки їх бере сторінка
 * довідки (Vite копіює `public/` у збірку).
 *
 * ⚠️ ПОРЯДОК ЗАПУСКУ: спершу `npm run build`, потім цей прогін. Він працює
 * проти `dist/`, а Vite копіює `public/` у `dist/` ЛИШЕ ПІД ЧАС ЗБІРКИ — тож
 * свіжі кадри в зібраній студії самі не з'являться. Щоб не змушувати робити
 * другу збірку, прогін копіює свої кадри в `dist/help/` власноруч (див.
 * `syncToDist` нижче).
 *
 * Кадр самої сторінки довідки (`help-page.png`) лягає в `tmp/`, а не в
 * `public/help/`: застосунок його не використовує, а важить він понад 600 КБ.
 *
 * ЧОМУ НОМЕРИ МАЛЮЄ САМ ПРОГІН, А НЕ ЛЮДИНА В РЕДАКТОРІ. У довідці під
 * кожним знімком є перелік «що означає цифра N». Щоб перелік не розійшовся з
 * картинкою після найменшої правки інтерфейсу, номери ставить той самий
 * прогін, який робить знімок: він підсвічує елемент і малює на ньому кружечок.
 * Якщо елемент зникне з коду — прогін скаже про це вголос, а не мовчки зробить
 * скріншот без мітки.
 *
 * Пастка цього репозиторію (log.md #172): усередині `page.evaluate` НЕ
 * оголошувати іменованих функцій — tsx обгортає їх у `__name`, якого в
 * браузері немає.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHOTS = path.join(ROOT, 'public', 'help');
const DIR = path.join(os.tmpdir(), 'nova-live-help-screens');
const PORT = Number(process.env.HELP_SCREENS_PORT || 34199);
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tropazemli@gmail.com';
const TEST_BOOK_ID = 'BK-HELP-SCREENS';

process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
process.env.NODE_ENV = 'production';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const { initialBookData } = await import('../src/data/initialBook');
const { initStore, saveUser, createSession } = await import('../server/store');

await initStore();
await saveUser({
  id: 'u-help',
  email: ADMIN_EMAIL,
  name: 'Знімки для довідки',
  role: 'admin',
  createdAt: new Date().toISOString(),
} as any);

const TOKEN = crypto.randomBytes(32).toString('hex');
await createSession({
  token: TOKEN,
  userId: 'u-help',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
});

/**
 * Книга для знімків. Текст — навмисно «звичайний роман», щоб канва на
 * скріншоті виглядала як у автора, а не як тестова таблиця: два абзаци опису,
 * два герої, у Олени — готові репліки (саме їх показує довідка).
 */
const TEST_BOOK = {
  ...initialBookData,
  id: TEST_BOOK_ID,
  title: 'Нео-Київ. Архітектор пам’яті',
  author: 'Автор',
  genre: 'Наукова фантастика',
  synopsis: 'Олена тримає місто, зшите з чужих спогадів.',
  chapters: [
    {
      id: 'ch-help',
      bookId: TEST_BOOK_ID,
      title: 'Глава 1. Скляні куполи',
      order: 1,
      sections: [
        {
          id: 'sec-help-1',
          chapterId: 'ch-help',
          title: 'Сцена 1',
          order: 1,
          wordCount: 0,
          lastModified: new Date().toISOString(),
          content: [
            'Скляні куполи Верхнього Печерська відбивали перші промені холодного серпневого сонця, перетворюючи неоновий горизонт Нео-Києва на мерехтливу призму.',
            '',
            'Олена стояла біля панорамного вікна лабораторії на 84-му поверсі й дивилася, як вантажні аеродрони креслили білі лінії над куполами древніх соборів, закутих у захисні титанові саркофаги.',
          ].join('\n'),
          scene: {
            title: 'Сцена 1',
            location: 'Лабораторія, 84-й поверх',
            timeOfDay: 'Світанок, 05:45',
            characters: [
              {
                characterId: 'char-olena',
                goal: 'Завершити синхронізацію нейроносія',
                emotionalState: 'Зосереджена, втомлена',
                action: 'Спостерігає за містом',
                conflict: 'Ризик синаптичного зворотного удару',
              },
            ],
          },
        },
      ],
    },
  ],
  characters: [
    {
      id: 'char-olena',
      bookId: TEST_BOOK_ID,
      name: 'Олена',
      surname: 'Савицька',
      role: 'protagonist',
      profession: 'Архітектор пам’яті',
      dialogueTemplates: [
        '— Готовність до синхронізації 98 відсотків, пане архітекторе.',
        '— Я не зупиню процес. Навіть якщо він зупинить мене.',
        '— Покажіть мені його спогади. Цілком.',
      ],
      behaviorPatterns: ['дивиться прямо в очі', 'тримає спину рівно'],
    },
    {
      id: 'char-svarog',
      bookId: TEST_BOOK_ID,
      name: 'Сварог',
      role: 'deuteragonist',
      dialogueTemplates: ['— Ризик синаптичного зворотного удару — 37 відсотків.'],
    },
  ],
  footnotes: [],
  illustrations: [],
  qrTags: [],
  versionHistory: [],
  updatedAt: new Date().toISOString(),
};

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

if (!(await waitForServer())) {
  console.error('Сервер не піднявся.\n' + serverLog.join('').slice(-2000));
  stopServer();
  process.exit(1);
}

const cookie = `nova_session=${TOKEN}`;
const put = await fetch(`${BASE}/api/books/${TEST_BOOK_ID}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ book: TEST_BOOK }),
});
t('тестова книга з двома героями лягла на сервер', put.status === 200, String(put.status));

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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=2'],
});

/** Мітка на елементі: кружечок із номером плюс підсвітка рамкою. */
type Mark = { selector: string; n: number };

try {
  const page = await browser.newPage();
  /*
   * Вьюпорт вище за типовий (1200 замість 1050) — і це не дрібниця: панель
   * сутностей і вкладка «Сцена» довгі, і на низькому екрані їхні нижні блоки
   * опинялися під згином. Кадр, який ріже мітку, — це зламана довідка, тому
   * економніше дати кадру більше висоти, ніж потім виправляти текст.
   */
  await page.setViewport({ width: 1680, height: 1200, deviceScaleFactor: 2 });
  await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
  /* Мова знімків — українська: довідка має обидві мови, а кадри показують ту,
     якою власник користується. Виставляємо ДО завантаження скриптів. */
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('nova_language', 'uk');
    } catch {
      /* приватний режим */
    }
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });

  // Книга кладеться в те сховище, з якого канва читає рукопис.
  await page.evaluate(async (book: any) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('nova_studio', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['books', 'meta'], 'readwrite');
        tx.objectStore('books').put({ id: book.id, data: book, updatedAt: new Date().toISOString() });
        tx.objectStore('meta').put({ key: 'active_book_id', value: book.id });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, TEST_BOOK as any);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
  await page.click('#nav-tab-editor');
  await page.waitForSelector('.ProseMirror', { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 800));

  /**
   * Ставить номерні мітки. Кожен елемент спершу прокручується у видиму
   * область (панелі в Студії мають власну прокрутку), і лише потім
   * обчислюються координати — інакше мітки «поїхали» б від того, що елемент
   * був за межами вікна.
   */
  const annotate = async (marks: Mark[]) => {
    return page.evaluate(async (list: { selector: string; n: number }[]) => {
      document.querySelectorAll('[data-help-mark]').forEach((el) => el.remove());
      const found: { n: number; el: Element }[] = [];
      const missing: string[] = [];
      for (const mark of list) {
        const el = document.querySelector(mark.selector);
        if (el) found.push({ n: mark.n, el });
        else missing.push(`${mark.n}: ${mark.selector}`);
      }
      for (const item of found) {
        (item.el as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      /*
       * Другий прохід — ЗВЕРХУ ВНИЗ за площею, із `block: 'nearest'`. Перший
       * прохід центрує КОЖЕН елемент, і після нього останній (найменший) часто
       * лишається наполовину за нижньою межею панелі: у кадрі 2 кнопка
       * «Налаштувати діалоги героя» була зрізана, а координатний клік по ній
       * узагалі припадав на футер — саме так прогін і «виявив», що вікно не
       * відкривається. Другий прохід доводить найменші елементи до повної
       * видимості.
       */
      const byArea = [...found].sort((a, b) => {
        const ra = (a.el as HTMLElement).getBoundingClientRect();
        const rb = (b.el as HTMLElement).getBoundingClientRect();
        return rb.width * rb.height - ra.width * ra.height;
      });
      for (const item of byArea) {
        (item.el as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      /*
       * І останній прохід — по НАЙМЕНШОМУ елементу, з `block: 'center'`.
       * `nearest` не прокручує, якщо елемент видно ХОЧ ЧАСТКОВО, а кнопка
       * внизу довгої панелі саме такою й була: у кадрі 2 її зрізало, і це
       * видно було тільки оком — перевірка «всі мітки поставлено» мовчала,
       * бо мітка існувала. `center` доводить її до повної видимості.
       */
      if (byArea.length > 0) {
        (byArea[0].el as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      await new Promise((r) => setTimeout(r, 250));
      for (const item of found) {
        const r = (item.el as HTMLElement).getBoundingClientRect();
        const dot = document.createElement('div');
        dot.setAttribute('data-help-mark', String(item.n));
        dot.textContent = String(item.n);
        dot.style.cssText =
          `position:fixed;left:${Math.max(2, r.left - 9)}px;top:${Math.max(2, r.top - 9)}px;` +
          'width:22px;height:22px;border-radius:9999px;background:#f97316;color:#0b1220;' +
          'font:700 13px/22px system-ui,sans-serif;text-align:center;z-index:2147483647;' +
          'box-shadow:0 0 0 2px #0b1220, 0 2px 6px rgba(0,0,0,.5);pointer-events:none;';
        document.body.appendChild(dot);
        (item.el as HTMLElement).setAttribute('data-help-outlined', '1');
        (item.el as HTMLElement).style.outline = '2px solid rgba(249,115,22,.9)';
        (item.el as HTMLElement).style.outlineOffset = '1px';
      }
      return { placed: found.length, missing };
    }, marks);
  };

  /**
   * Мітка, якій нікуди стати, — це ЗЛАМАНА довідка: під скріншотом буде
   * перелічено номер, якого на картинці немає. Тому кожен кадр перевіряє, що
   * всі номери справді поставлені, і прогін падає, якщо ні.
   */
  const annotateStrict = async (file: string, marks: Mark[]) => {
    const result = await annotate(marks);
    t(`кадр ${file}: усі мітки поставлено`, result.missing.length === 0, result.missing.join('; '));
  };

  const clearAnnotations = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('[data-help-mark]').forEach((el) => el.remove());
      document.querySelectorAll('[data-help-outlined]').forEach((el) => {
        (el as HTMLElement).removeAttribute('data-help-outlined');
        (el as HTMLElement).style.outline = '';
        (el as HTMLElement).style.outlineOffset = '';
      });
    });
  };

  /**
   * Відкрити вікно й дочекатися його. Клік повторюється: у живому браузері
   * перший клік інколи припадає на момент, коли панель ще перемальовується
   * після прокрутки (мітка 2 нижче по сторінці), і подія губиться. Без
   * повтору прогін падає не через ваду застосунку, а через власну квапливість.
   */
  const openDialoguesModal = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      /*
       * Клікаємо ЧЕРЕЗ DOM, а не координатами: кнопка стоїть у самому низу
       * довгої панелі, і координатний клік інколи припадав на момент
       * перемальовування панелі (у прогін це виглядало як «вікно не
       * відкрилося»). Діагностика тут — не прикраса: якщо кнопка виявиться
       * `disabled` або її щось накриє, у звіті буде видно, що саме.
       */
      const info = await page.evaluate(() => {
        const btn = document.querySelector('[data-open-dialogue-setup]') as HTMLButtonElement | null;
        if (!btn) return { found: false };
        const r = btn.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        btn.click();
        return {
          found: true,
          disabled: btn.disabled,
          covers: top ? `${top.tagName}.${(top.className || '').toString().slice(0, 30)}` : 'null',
          at: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`,
        };
      });
      if (attempt === 0) console.log('    кнопка налаштування:', JSON.stringify(info));
      try {
        await page.waitForSelector('[data-character-dialogue-modal]', { timeout: 5000 });
        await new Promise((r) => setTimeout(r, 400));
        return true;
      } catch {
        /* не відкрилося — пробуємо ще раз */
      }
    }
    return false;
  };

  /**
   * Знімок області навколо елемента — з відступом, щоб було видно контекст.
   *
   * Кадр розширюється і під УСІ поставлені мітки: у вікні діалогів кнопка
   * «Зберегти» опинялася за нижньою межею кадру, і мітка 4 була зрізана
   * (це видно було на самому PNG, а перевірка «всі мітки поставлено» цього не
   * ловила — мітка існувала в DOM, просто не в кадрі).
   */
  const shotAround = async (file: string, selector: string, pad = 28) => {
    /*
     * Прокрутку вікна скидаємо ПЕРЕД вимірюванням. `page.screenshot({clip})`
     * рахує область у координатах ДОКУМЕНТА, а `getBoundingClientRect` — у
     * координатах ВІКНА; якщо між цими двома моментами сторінка хоч трохи
     * прокрутиться (а вона прокручується — мітки-кружечки додаються в body),
     * кадр з'їжджає вниз і зрізає нижню частину. Так було зрізано кнопку
     * «Зберегти» у вікні діалогів.
     */
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 150));
    const box = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const scrolled = { x: window.scrollX, y: window.scrollY };
      const r = el.getBoundingClientRect();
      const marks = Array.from(document.querySelectorAll('[data-help-mark]')).map((m) => m.getBoundingClientRect());
      const left = Math.min(r.left, ...marks.map((m) => m.left));
      const top = Math.min(r.top, ...marks.map((m) => m.top));
      const right = Math.max(r.right, ...marks.map((m) => m.right));
      const bottom = Math.max(r.bottom, ...marks.map((m) => m.bottom));
      return {
        x: left + scrolled.x,
        y: top + scrolled.y,
        width: right - left,
        height: bottom - top,
        /*
         * Окремо — межі САМИХ МІТОК. Це важливо: елемент обрізки (панель
         * сутностей) вищий за будь-який екран, і якщо вимагати, щоб у кадр
         * вліз він увесь, перевірка буде червоною завжди — при тому, що всі
         * номери видно. Мітка, якої немає в кадрі, — ось справжня вада.
         */
        marks: marks.length
          ? {
              top: Math.min(...marks.map((m) => m.top)) + scrolled.y,
              left: Math.min(...marks.map((m) => m.left)) + scrolled.x,
              bottom: Math.max(...marks.map((m) => m.bottom)) + scrolled.y,
              right: Math.max(...marks.map((m) => m.right)) + scrolled.x,
            }
          : null,
      };
    }, selector);
    const view = page.viewport() || { width: 1680, height: 1200 };
    if (!box) {
      await page.screenshot({ path: path.join(SHOTS, file) });
      t(`кадр ${file} зроблено (без обрізки: елемент не знайдено)`, false, selector);
      return;
    }
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const clip = {
      x,
      y,
      width: Math.min(view.width - Math.max(0, box.x - pad), box.width + pad * 2),
      height: Math.min(view.height - Math.max(0, box.y - pad), box.height + pad * 2),
    };
    await page.screenshot({ path: path.join(SHOTS, file), clip });
    /*
     * Кадр, що зрізає хоч одну мітку, — це зламана довідка: номер у переліку
     * під скріншотом не матиме відповідника на картинці. Раніше таке ловилося
     * тільки оком (кнопку «Зберегти» було зрізано), тому тепер це перевірка.
     */
    const cut = !!box.marks && (box.marks.bottom > clip.y + clip.height + 2 || box.marks.right > clip.x + clip.width + 2);
    t(`кадр ${file}: усі мітки в межах кадру`, !cut,
      cut ? `мітки до ${Math.round(box.marks!.bottom)}, кадр до ${Math.round(clip.y + clip.height)}` : '');
    t(`кадр ${file} зроблено`, true, `${Math.round(clip.width)}×${Math.round(clip.height)}`);
  };

  // ── 1. Панель сутностей ─────────────────────────────────────────────────
  console.log('\nКадр 1: панель «Сутності»');
  await page.click('[data-right-tab="entities"]');
  await page.waitForSelector('[data-core-entity-panel]', { timeout: 20000 });
  /*
   * Спершу ставимо ОДНУ сутність у поточний абзац — тільки так з'являється
   * блок «У розділі заявлено» (мітка 5): порожній розділ його не малює, і
   * перша версія кадру через це виходила без однієї мітки.
   *
   * Беремо ПЕРШИЙ рядок панелі (група A відкрита типово), а не `character`:
   * `character` належить групі C, закритій — її рядків у DOM ще немає, і клік
   * падав з «No element found». Це не дрібниця: панель будує списки лише для
   * розгорнутих груп.
   */
  await page.click('[data-entity-row] [data-entity-button]');
  await new Promise((r) => setTimeout(r, 500));
  await page.click('[data-right-tab="entities"]');
  await page.waitForSelector('[data-entity-section-usage]', { timeout: 10000 });
  await annotateStrict('entities-panel.png', [
    { selector: '[data-entity-search]', n: 1 },
    { selector: '[data-entity-group]', n: 2 },
    { selector: '[data-entity-toggle]', n: 3 },
  ]);
  await shotAround('entities-panel.png', '[data-core-entity-panel]', 10);
  await clearAnnotations();

  /*
   * ДРУГИЙ КАДР ПАНЕЛІ. Панель сутностей вища за екран (у ній 12 груп і 118
   * рядків), тож одним кадром ані верх, ані низ не поміщаються. Замість
   * дрібного «все й одразу» — два кадри, кожен зі своїм переліком міток:
   * верх (пошук, групи, кнопка приховування) і низ (рядок сутності, мітки
   * використання, лічильник абзацу).
   */
  await page.click('[data-right-tab="scene"]');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('[data-right-tab="entities"]');
  await page.waitForSelector('[data-entity-section-usage]', { timeout: 10000 });
  await annotateStrict('entities-panel-rows.png', [
    { selector: '[data-entity-row]', n: 1 },
    { selector: '[data-entity-section-usage]', n: 2 },
    { selector: '[data-entity-paragraph-count]', n: 3 },
  ]);
  await shotAround('entities-panel-rows.png', '[data-entity-section-usage]', 90);
  await clearAnnotations();

  // Прибираємо щойно поставлений тег — далі кадри чисті.
  const undoable = await page.evaluate(() => !!document.querySelector('.nova-entity-chip'));
  t('тег, поставлений для кадру, є в канві', undoable);
  await page.click('.ProseMirror');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 400));

  // ── 2. Блок «Діалоги героя» у вкладці «Сцена» ───────────────────────────
  console.log('\nКадр 2: блок діалогів у «Персонажах сцени»');
  await page.click('[data-right-tab="scene"]');
  await page.waitForSelector('[data-scene-dialogues-panel]', { timeout: 20000 });
  await annotateStrict('scene-dialogues-block.png', [
    { selector: '[data-scene-dialogues-panel]', n: 1 },
    { selector: '[data-open-dialogue-setup]', n: 2 },
  ]);
  await shotAround('scene-dialogues-block.png', '[data-scene-dialogues-panel]', 16);
  await clearAnnotations();

  // ── 3. Вікно налаштування ───────────────────────────────────────────────
  console.log('\nКадр 3: вікно «Діалоги героя»');
  t('вікно «Діалоги героя» відкрилося', await openDialoguesModal());
  await annotateStrict('dialogues-modal.png', [
    { selector: '[data-dialogue-modal-heroes]', n: 1 },
    { selector: '[data-dialogue-modal-input]', n: 2 },
    { selector: '[data-dialogue-modal-count]', n: 3 },
    { selector: '[data-dialogue-modal-save]', n: 4 },
  ]);
  await shotAround('dialogues-modal.png', '[data-character-dialogue-modal] > div', 12);
  await clearAnnotations();
  await page.click('[data-dialogue-modal-close]');
  await new Promise((r) => setTimeout(r, 400));

  // ── 4. Меню підбору репліки в канві ────────────────────────────────────
  console.log('\nКадр 4: слеш-запис і список реплік');
  const editorHandles = await page.$$('.ProseMirror');
  await editorHandles[0].click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/character:Олена:діалог');
  await page.waitForSelector('[data-entity-slash-menu="dialogue"]', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 300));
  await annotateStrict('slash-dialogue-menu.png', [
    { selector: '[data-entity-slash-menu] > div:first-child', n: 1 },
    { selector: '[data-entity-slash-dialogue]', n: 2 },
    { selector: '[data-entity-slash-menu] > div:last-child', n: 3 },
  ]);
  await shotAround('slash-dialogue-menu.png', '[data-entity-slash-menu]', 26);
  await clearAnnotations();

  // ── 5. Результат у канві ───────────────────────────────────────────────
  console.log('\nКадр 5: результат у тексті книги');
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 700));
  /*
   * Шукаємо вставку по ВСЬОМУ тексту канви, а не в останньому абзаці: канва
   * верстається посторінково (`PageColumn`), тож «останній абзац» у DOM — це
   * не обов'язково той, у який лягла репліка. Перша версія перевірки
   * дивилася саме на останній абзац і падала на справному коді.
   */
  const inserted = await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror');
    const paragraphs = Array.from(editor?.querySelectorAll('p') || []);
    const target = paragraphs.find((p) => (p.textContent || '').includes('[/dialogue:'));
    return { found: !!target, text: target?.textContent || '' };
  });
  t('репліка справді вставилася в текст',
    inserted.found && inserted.text.includes('[/character:Олена Савицька]'),
    inserted.text.slice(0, 110) || 'абзацу з тегом діалогу немає');
  await annotateStrict('canvas-result.png', [{ selector: '.ProseMirror p:last-of-type', n: 1 }]);
  await shotAround('canvas-result.png', '.ProseMirror p:last-of-type', 60);
  await clearAnnotations();

  for (const file of ['entities-panel.png', 'entities-panel-rows.png', 'scene-dialogues-block.png', 'dialogues-modal.png', 'slash-dialogue-menu.png', 'canvas-result.png']) {
    const p = path.join(SHOTS, file);
    t(`файл ${file} на диску`, fs.existsSync(p) && fs.statSync(p).size > 5000, `${Math.round(fs.statSync(p).size / 1024)} КБ`);
  }

  // ── 6. Сама сторінка довідки ────────────────────────────────────────────
  console.log('\nКадр 6: сторінка довідки в застосунку');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));

  const sidebarButton = await page.$('#sidebar-help-btn');
  t('кнопка довідки є в сайдбарі (видно без прокрутки)', !!sidebarButton);
  await page.click('#sidebar-help-btn');
  await page.waitForSelector('[data-help-page]', { timeout: 20000 });
  t('сторінка довідки відкрилася кліком у сайдбарі', true);

  /*
   * Головна перевірка САМОЇ сторінки: усі скріншоти мусять справді
   * завантажитись. Якщо шлях до картинки зламався (наприклад, не враховано
   * префікс `/studio/` у проді), сторінка показує рамку-заглушку з командою —
   * і без цієї перевірки така вада не спливла б ані в `tsc`, ані в тестах.
   *
   * Кадри вантажаться ЛІНИВО (`loading="lazy"`), тож спершу прокручуємо
   * сторінку до кінця: інакше нижні знімки ще не почали вантажитись, і
   * перевірка «завантажився» була б хибно червоною.
   */
  const expected = [
    'entities-panel.png',
    'entities-panel-rows.png',
    'scene-dialogues-block.png',
    'dialogues-modal.png',
    'slash-dialogue-menu.png',
    'canvas-result.png',
  ];
  await page.evaluate(() => {
    const el = document.querySelector('[data-help-page]');
    if (el) el.scrollTop = el.scrollHeight;
  });
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => {
    const el = document.querySelector('[data-help-page]');
    if (el) el.scrollTop = 0;
  });
  const images = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-help-screenshot]')).map((el) => ({
      file: el.getAttribute('data-help-screenshot') || '',
      loaded: (el as HTMLImageElement).naturalWidth > 0,
    }))
  );
  const files = images.map((i) => i.file);
  t('на сторінці довідки є всі шість кадрів', expected.every((f) => files.includes(f)),
    `є: ${files.join(', ')}`);
  const notLoaded = images.filter((i) => !i.loaded).map((i) => i.file);
  t('кожен кадр справді завантажився (не заглушка)', notLoaded.length === 0, notLoaded.join(', '));

  const ukTitle = await page.evaluate(() => document.querySelector('[data-help-page] h1')?.textContent || '');
  t('сторінка довідки українською', ukTitle.includes('сутності ядра'), ukTitle.slice(0, 60));
  await page.click('[data-help-lang-toggle]');
  await new Promise((r) => setTimeout(r, 600));
  const enTitle = await page.evaluate(() => document.querySelector('[data-help-page] h1')?.textContent || '');
  t('перемикач мови дає англійську версію сторінки', enTitle.includes('core entities'), enTitle.slice(0, 60));
  await page.click('[data-help-lang-toggle]');
  await new Promise((r) => setTimeout(r, 600));

  await page.evaluate(() => window.scrollTo(0, 0));
  /*
   * Кадр САМОЇ сторінки довідки лягає в `tmp/`, а не в `public/help/`. Він не
   * потрібен застосунку (сторінка показує шість інших кадрів), а важить
   * понад 600 КБ — тримати його в репозиторії означало б ще раз стільки ж у
   * кожному клоні. У `tmp/` він лишається для очей: подивитися, як сторінка
   * виглядає, нічого не запускаючи.
   */
  const pageShotDir = path.join(ROOT, 'tmp');
  fs.mkdirSync(pageShotDir, { recursive: true });
  await page.screenshot({ path: path.join(pageShotDir, 'help-page.png') });
  t('кадр самої сторінки довідки зроблено (tmp/help-page.png)',
    fs.existsSync(path.join(pageShotDir, 'help-page.png')));

  await page.click('[data-help-close]');
  await new Promise((r) => setTimeout(r, 400));
  t('сторінка довідки закривається', (await page.$('[data-help-page]')) === null);

  /**
   * Копіюємо кадри у зібраний застосунок. Причина не косметична: сторінка
   * довідки перевірялася на прод-збірці, і кадр, якого немає в `dist/help/`,
   * показувався заглушкою — прогін падав на власному артефакті. Друга збірка
   * після знімків розв'язала б це, але вимагати її від того, хто просто хоче
   * оновити кадри, — зайвий крок.
   */
  const distHelp = path.join(ROOT, 'dist', 'help');
  if (fs.existsSync(path.join(ROOT, 'dist'))) {
    fs.mkdirSync(distHelp, { recursive: true });
    for (const file of fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png'))) {
      fs.copyFileSync(path.join(SHOTS, file), path.join(distHelp, file));
    }
    t('кадри скопійовано у зібраний застосунок (dist/help)', true, `${fs.readdirSync(distHelp).length} файлів`);
  }

  console.log(`\nСкріншоти: ${SHOTS}`);
} finally {
  await browser.close();
  stopServer();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail > 0 ? 1 : 0);
