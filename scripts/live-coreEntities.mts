/**
 * ЖИВИЙ прогін сутностей ядра в канві книги (постановка власника, п. 11):
 * «тестуємо сутності шляхом створення тестової книги, в якій будуть
 * застосовані всі 118 сутностей, та показуєм їх в канві набору книги».
 *
 * Запуск: npm run live:core-entities   (потрібен `npm run build`)
 *
 * ЧОМУ ЦЕ ЖИВИЙ ПРОГІН, А НЕ МОДУЛЬНИЙ ТЕСТ. Модульні тести вже довели, що
 * реєстр містить 118 типів, що тег розбирається, що з експорту він зникає.
 * Нез'ясованим лишається найважливіше для автора: чи ПОБАЧИТЬ він ці 118
 * сутностей у канві — чи пофарбується абзац, чи стане чип, чи зникне все за
 * кнопкою приховування. Це властивість збірки (Tailwind, ProseMirror,
 * декорації), а не функції, і ловиться вона лише в браузері.
 *
 * ЩО ТУТ СПРАВЖНЄ: прод-збірка (`dist/server.mjs`), справжня сесія, реальний
 * Chrome, реальна канва. Що НЕ справжнє: тестова книга кладеться в IndexedDB
 * напряму, бо застосунок на першому запуску створює власну книгу з коду й
 * НЕ тягне її із сервера (див. гідратацію в App.tsx). Спосіб запису не
 * впливає на те, що перевіряється: канва читає книгу з того самого сховища.
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

const DIR = path.join(os.tmpdir(), 'nova-live-core-entities');
const PORT = Number(process.env.CORE_ENTITIES_PORT || 34197);
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
const TEST_BOOK_ID = 'BK-ENTITIES-TEST';

const { CORE_ENTITIES } = await import('../src/utils/coreEntities');
const { initialBookData } = await import('../src/data/initialBook');
const { initStore, saveUser, createSession, createChatSession, addChatMessage } = await import('../server/store');
const { indexChatMessageEntities } = await import('../server/coreEntityStore');

await initStore();
await saveUser({
  id: 'u-entities',
  email: ADMIN_EMAIL,
  name: 'Жива перевірка сутностей',
  role: 'admin',
  createdAt: new Date().toISOString(),
} as any);

const TOKEN = crypto.randomBytes(32).toString('hex');
await createSession({
  token: TOKEN,
  userId: 'u-entities',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
});

// ---------------------------------------------------------------------------
// Тестова книга: один розділ, у якому КОЖНА зі 118 сутностей стоїть на
// початку свого абзацу — рівно так, як їх ставить панель.
// ---------------------------------------------------------------------------
const TEST_BOOK = {
  ...initialBookData,
  id: TEST_BOOK_ID,
  title: 'Тестова книга сутностей ядра',
  chapters: [
    {
      id: 'ch-entities',
      bookId: TEST_BOOK_ID,
      title: 'Глава 1. Усі 118 сутностей',
      order: 1,
      sections: [
        {
          id: 'sec-entities',
          chapterId: 'ch-entities',
          title: 'Реєстр у дії',
          order: 1,
          wordCount: 0,
          lastModified: new Date().toISOString(),
          content: CORE_ENTITIES.map(
            (entity, index) =>
              `[/${entity.slug}:${entity.nameUk}] Абзац ${index + 1} позначає сутність «${entity.nameUk}» (${entity.tag}) і перевіряє, що канва бачить її як мітку абзацу.`
          ).join('\n\n'),
        },
      ],
    },
  ],
  characters: [],
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

const cookie = `nova_session=${TOKEN}`;

// ---------------------------------------------------------------------------
console.log('\nСервер: реєстр і тестова книга');
{
  const res = await fetch(`${BASE}/api/core/entities`, { headers: { cookie } });
  const body = (await res.json()) as any;
  t('GET /api/core/entities → 200', res.status === 200, String(res.status));
  t('118 сутностей у відповіді', body.entities?.length === 118, String(body.entities?.length));
  t('37 зв’язків у відповіді', body.relations?.length === 37, String(body.relations?.length));
  t('12 груп у відповіді', body.groups?.length === 12, String(body.groups?.length));

  // Книга з усіма 118 тегами їде на сервер і повертається БЕЗ ВТРАТ.
  const put = await fetch(`${BASE}/api/books/${TEST_BOOK_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ book: TEST_BOOK }),
  });
  t('PUT книги з 118 тегами → 200', put.status === 200, String(put.status));

  const got = await fetch(`${BASE}/api/books/${TEST_BOOK_ID}`, { headers: { cookie } });
  const stored = (await got.json()) as any;
  const content: string = stored?.book?.chapters?.[0]?.sections?.[0]?.content || '';
  const missing = CORE_ENTITIES.filter((e) => !content.includes(`[/${e.slug}:`));
  t('усі 118 тегів збереглися в серверній копії книги', missing.length === 0,
    missing.slice(0, 5).map((e) => e.slug).join(', '));
  t('порядок тегів не змінився', content.indexOf('[/project:') < content.indexOf('[/revision-outcome:'));
}

console.log('\nСервер: згадки сутностей у чаті');
{
  const session = await createChatSession({
    id: 'sess-entities',
    userId: 'u-entities',
    title: 'Розмова з сутностями',
    bookId: TEST_BOOK_ID,
    modelId: 'gemini-3.7-flash',
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    messageCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as any);

  const message = await addChatMessage({
    id: 'msg-entities-1',
    sessionId: session.id,
    role: 'user',
    content: '[/character:Сергій] [/threshold:виживання] Що робити з цим порогом?',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    createdAt: new Date().toISOString(),
  } as any);
  await indexChatMessageEntities({
    messageId: message.id,
    sessionId: session.id,
    userId: 'u-entities',
    text: message.content,
  });

  const res = await fetch(`${BASE}/api/chat/sessions/${session.id}`, { headers: { cookie } });
  const body = (await res.json()) as any;
  t('історія сесії віддає згадки сутностей репліки',
    (body.messages?.[0]?.entities || []).length === 2,
    JSON.stringify((body.messages?.[0]?.entities || []).map((e: any) => e.slug)));
  t('групування розмови порахувало обидві сутності',
    (body.entityGroups || []).length === 2 && (body.entityGroups || []).length > 0,
    JSON.stringify((body.entityGroups || []).map((g: any) => `${g.slug}:${g.count}`)));
  t('значення після двокрапки збережено в групі',
    (body.entityGroups || []).some((g: any) => (g.values || []).includes('Сергій')),
    JSON.stringify(body.entityGroups));
}

// ---------------------------------------------------------------------------
console.log('\nБраузер: канва книги');
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
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

try {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[entity-slash]')) console.log('    BROWSER:', text);
  });
  await page.setViewport({ width: 1600, height: 1200 });
  await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });

  // Тестова книга кладеться в те саме сховище, з якого канва читає рукопис.
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
  // Після перезавантаження застосунок гідратується заново (читає книгу з
  // IndexedDB) — навігація з'являється не одразу, тож чекаємо на неї явно.
  // Без цього очікування клік падає з «No element found», і виглядає це як
  // поломка канви, хоч насправді браузер просто прийшов раніше за React.
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
  await page.click('#nav-tab-editor');
  await page.waitForSelector('.ProseMirror', { timeout: 40000 });

  // СПРАВЖНІЙ клік, а не синтетичний через page.evaluate: каретку в
  // contenteditable ставить лише справжня подія введення. Синтетичний
  // `el.click()` не фокусує канву взагалі, і потім `keyboard.type()` друкує
  // в нікуди — саме на цьому перший прогін і застряг.
  const editorHandles = await page.$$('.ProseMirror');
  await editorHandles[0].click();
  await new Promise((r) => setTimeout(r, 800));

  const countBy = (selector: string) =>
    page.evaluate((sel: string) => document.querySelectorAll(sel).length, selector);

  const paragraphs = await countBy('[data-entity-first]');
  t('канва пофарбувала абзаци з сутностями', paragraphs >= 118, `${paragraphs} абзаців із тлом`);

  const chips = await countBy('.nova-entity-chip');
  t('усі 118 тегів стали чипами в канві', chips >= 118, `${chips} чипів`);

  // ДІАГНОСТИКА (тимчасова): якщо чипів менше, ніж абзаців, треба знати, у
  // ЯКИХ саме абзацах чипа немає — інакше причина лишається здогадом.
  if (chips < 118) {
    const diagnosis = await page.evaluate(() => {
      const editors = Array.from(document.querySelectorAll('.ProseMirror'));
      const perEditor = editors.map((el, i) => ({
        i,
        cls: el.className,
        paragraphs: el.querySelectorAll('p').length,
        tints: el.querySelectorAll('[data-entity-first]').length,
        chips: el.querySelectorAll('.nova-entity-chip').length,
      }));
      const firstTinted = document.querySelector('[data-entity-first]') as HTMLElement | null;
      const parents: string[] = [];
      let cur: HTMLElement | null = firstTinted;
      while (cur && parents.length < 6) {
        parents.push(`${cur.tagName.toLowerCase()}.${(cur.className || '').toString().split(' ').slice(0, 2).join('.')}`);
        cur = cur.parentElement;
      }
      return {
        editorCount: editors.length,
        perEditor,
        firstTintedParents: parents,
        totalTints: document.querySelectorAll('[data-entity-first]').length,
        totalChips: document.querySelectorAll('.nova-entity-chip').length,
        // Які саме абзаци отримали чип: якщо це перші N підряд — причина в
        // рендері/нарізці на сторінки, якщо врозкид — у розборі тегів.
        indexed: Array.from(document.querySelectorAll('[data-entity-first]')).map((el, i) => ({
          i,
          slug: el.getAttribute('data-entity-first'),
          chip: !!el.querySelector('.nova-entity-chip'),
          chips: el.querySelectorAll('.nova-entity-chip').length,
        })).slice(0, 118).map((r) => `${r.i}${r.chip ? '+' : '-'}`).join(' '),
        chipPlaces: Array.from(document.querySelectorAll('.nova-entity-chip')).slice(0, 8).map((el) => {
          const p = el.closest('p, div');
          return {
            text: (el.textContent || '').slice(0, 30),
            parentTag: p?.tagName,
            parentFirst: p?.getAttribute('data-entity-first'),
            parentClass: (p?.className || '').toString().slice(0, 60),
            insideProseMirror: !!el.closest('.ProseMirror'),
          };
        }),
        firstParagraphHtml: (() => {
          const el = document.querySelector('[data-entity-first]') as HTMLElement | null;
          return el ? el.innerHTML.slice(0, 600) : null;
        })(),
        editorBBox: (() => {
          const ed = document.querySelector('.ProseMirror');
          const r = ed?.getBoundingClientRect();
          return r ? { h: Math.round(r.height), top: Math.round(r.top) } : null;
        })(),
      };
    });
    console.log('    діагностика:', JSON.stringify(diagnosis, null, 1).slice(0, 1800));
    console.log('    HTML абзацу 0:\n' + String((diagnosis as any).firstParagraphHtml).slice(0, 700));
  }

  const coloredParagraph = await page.evaluate(() => {
    const el = document.querySelector('[data-entity-first]') as HTMLElement | null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { slug: el.getAttribute('data-entity-first'), background: cs.backgroundColor };
  });
  t('тло абзацу справді пофарбоване (не порожній стиль)',
    !!coloredParagraph && coloredParagraph.background !== 'rgba(0, 0, 0, 0)' && coloredParagraph.background !== 'transparent',
    JSON.stringify(coloredParagraph));

  // Панель сутностей
  await page.click('[data-tour="editor__entities"]');
  await page.waitForSelector('[data-core-entity-panel]', { timeout: 20000 });
  const entityButtons = await countBy('[data-entity-button]');
  t('панель показує кнопки сутностей першої групи', entityButtons > 0, `${entityButtons} кнопок`);

  const groupHeaders = await countBy('[data-entity-group]');
  t('панель згрупована за категоріями (12 груп у списку)', groupHeaders === 12, `${groupHeaders} груп`);

  const toggleLabel = await page.evaluate(() => {
    const el = document.querySelector('[data-entity-toggle]') as HTMLElement | null;
    return el ? { state: el.getAttribute('data-entity-toggle'), text: (el.textContent || '').trim() } : null;
  });
  t('кнопка приховування присутня й у стані «показано»',
    !!toggleLabel && toggleLabel.state === 'shown',
    JSON.stringify(toggleLabel));

  // Пошук у панелі: 2 літери → знайшлась сутність Character
  await page.type('[data-entity-search]', 'char');
  await page.waitForSelector('[data-entity-row="character"]', { timeout: 10000 });
  t('пошук за 4 літерами знайшов character', true);

  // Кнопка = додати до поточного абзацу
  const beforeAdd = await countBy('.nova-entity-chip');
  await page.click('[data-entity-row="character"] [data-entity-button]');
  await new Promise((r) => setTimeout(r, 500));
  const afterAdd = await countBy('.nova-entity-chip');
  t('натискання сутності додало тег у книгу', afterAdd === beforeAdd + 1, `${beforeAdd} → ${afterAdd}`);

  // Приховування: чипи й тло зникають, текст лишається
  await page.click('[data-entity-toggle]');
  await new Promise((r) => setTimeout(r, 500));
  const hiddenChips = await countBy('.nova-entity-chip');
  const hiddenTints = await countBy('[data-entity-first]');
  t('кнопка приховала всі чипи', hiddenChips === 0, `${hiddenChips} чипів`);
  t('кнопка приховала тло абзаців', hiddenTints === 0, `${hiddenTints} абзаців із тлом`);
  const stillHasText = await page.evaluate(() => (document.querySelector('.ProseMirror')?.textContent || '').includes('Абзац 1'));
  t('текст книги при цьому лишився на місці', stillHasText);
  const toggleHiddenState = await page.evaluate(() => (document.querySelector('[data-entity-toggle]') as HTMLElement | null)?.getAttribute('data-entity-toggle'));
  t('стан кнопки перемкнувся на «приховано»', toggleHiddenState === 'hidden', String(toggleHiddenState));

  const shotDir = path.join(ROOT, 'tmp');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, 'core-entities-hidden.png'), fullPage: false });

  await page.click('[data-entity-toggle]');
  await new Promise((r) => setTimeout(r, 500));
  t('повернення сутностей працює', (await countBy('.nova-entity-chip')) > 0);

  // Слеш-команда: набрати /char і натиснути Tab.
  const allParagraphs = await page.$$('.ProseMirror p');
  const lastParagraphElement = allParagraphs[allParagraphs.length - 1];
  await lastParagraphElement.click();
  // End — важливий крок, а не дрібниця: клік по абзацу ставить каретку там,
  // куди прийшла миша (десь усередині тексту), і `/char` приклеївся б до
  // літери. Межа тригера вимагає, щоб перед слешем не було літери — це
  // навмисне правило (інакше тегом ставало б будь-яке «слово/слово»), тож
  // набирати треба так, як набирає людина: від початку слова.
  await page.keyboard.press('End');
  t('курсор поставлено в кінець абзацу канви', true);

  await page.keyboard.type('/char');
  await new Promise((r) => setTimeout(r, 600));
  t('набраний текст дійшов до канви (перевірка, що каретка справді в редакторі)',
    await page.evaluate(() => (document.querySelector('.ProseMirror')?.textContent || '').includes('/char')));
  await page.waitForSelector('[data-entity-slash-menu]', { timeout: 10000 });
  const menuItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-entity-slash-item]')).map((el) => el.getAttribute('data-entity-slash-item'))
  );
  t('слеш-меню підібрало сутності за першими літерами',
    menuItems.length > 0 && menuItems[0] === 'character', JSON.stringify(menuItems.slice(0, 4)));

  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 400));
  const afterTab = await page.evaluate(() => (document.querySelector('.ProseMirror')?.textContent || ''));
  t('Tab підставив сутність у текст (другий крок — характеристика)',
    afterTab.includes('/character:'), afterTab.slice(-80));

  const valueItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-entity-slash-value]')).map((el) => el.textContent)
  );
  t('другий крок пропонує характеристики саме цієї сутності',
    valueItems.length > 0, JSON.stringify(valueItems.slice(0, 3)));

  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 400));
  const afterSecondTab = await page.evaluate(() => {
    const editors = Array.from(document.querySelectorAll('.ProseMirror'));
    return editors[0]?.innerHTML || '';
  });
  t('другий Tab закрив канонічний тег',
    afterSecondTab.includes('[/character:'), afterSecondTab.slice(-160));

  await page.screenshot({ path: path.join(shotDir, 'core-entities-canvas.png'), fullPage: false });
  console.log('\nСкриншоти: tmp/core-entities-canvas.png, tmp/core-entities-hidden.png');
} finally {
  await browser.close();
  stopServer();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail > 0 ? 1 : 0);
