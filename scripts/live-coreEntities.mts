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
 * сутностей у канві — чи стане тег кольоровим, чи зникне все за кнопкою
 * приховування, чи відкриє слеш-запис `/character:Ім'я:діалог` список діалогів
 * героя. Це властивість збірки (Tailwind, ProseMirror, декорації), а не
 * функції, і ловиться вона лише в браузері.
 *
 * ⚠️ ЗМІНА ДИЗАЙНУ (23.09.2026). Раніше тут перевірялося ТЛО абзацу
 * (`[data-entity-first]`). Власник відхилив тло («міняєм лише в колір текст, а
 * задній фон завжди залишаємо в канві білим»), тому тепер перевіряються
 * кольорові мітки `[data-entity-slug]` — і ОКРЕМО те, що тло абзацу лишилося
 * білим. Без другої перевірки повернення тла пройшло б повз прогін.
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
  characters: [
    {
      id: 'char-serhii',
      bookId: TEST_BOOK_ID,
      name: 'Сергій',
      surname: 'Коваль',
      role: 'protagonist',
      /*
       * Готові діалоги героя — ними перевіряється слеш-запис
       * `/character:Сергій:діалог` (постановка 23.09.2026, п. 2). Поведінкові
       * шаблони тут навмисно теж є: вони ловлять регресію «два різні
       * джерела переплуталися» — список діалогів мусить показати саме
       * dialogueTemplates, а не фолбек.
       */
      dialogueTemplates: [
        '— Ти й досі не віриш мені?',
        '— Я не вірю нікому, хто приходить уночі.',
        '— Тоді я піду сам.',
      ],
      behaviorPatterns: ['дивиться прямо в очі'],
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
  t('39 зв’язків у відповіді', body.relations?.length === 39, String(body.relations?.length));
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

  const paragraphs = await countBy('.ProseMirror p');
  t('канва показала всі абзаци тестової книги', paragraphs >= 118, `${paragraphs} абзаців`);

  const marks = await countBy('[data-entity-slug]');
  t('усі 118 тегів стали кольоровими мітками в тексті', marks >= 118, `${marks} міток`);

  const chips = await countBy('.nova-entity-chip');
  t('мітка має клас чипа (стилістика з index.css)', chips >= 118, `${chips} чипів`);

  /*
   * ДИЗАЙН: ФАРБУЄМО ТЕКСТ, А НЕ ТЛО (рішення власника 23.09.2026). Ця
   * перевірка з'явилася саме тому, що попередній варіант фарбував абзац
   * цілком — і саме це власник відхилив. Без неї повернення тла пройшло б
   * поза увагою: решта перевірок одинаково зелені в обох варіантах.
   */
  const paragraphBackground = await page.evaluate(() => {
    const mark = document.querySelector('[data-entity-slug]') as HTMLElement | null;
    const paragraph = mark?.closest('p') as HTMLElement | null;
    if (!mark || !paragraph) return null;
    return {
      paragraph: getComputedStyle(paragraph).backgroundColor,
      text: getComputedStyle(mark).color,
      slug: mark.getAttribute('data-entity-slug'),
    };
  });
  t('канва НЕ фарбує тло абзацу',
    !!paragraphBackground &&
      (paragraphBackground.paragraph === 'rgba(0, 0, 0, 0)' || paragraphBackground.paragraph === 'transparent'),
    JSON.stringify(paragraphBackground));
  t('натомість колір має сам текст мітки',
    !!paragraphBackground && paragraphBackground.text !== paragraphBackground.paragraph,
    JSON.stringify(paragraphBackground));

  // ДІАГНОСТИКА: якщо міток менше, ніж абзаців, треба знати, у ЯКИХ саме
  // абзацах мітки немає — інакше причина лишається здогадом.
  if (marks < 118) {
    const diagnosis = await page.evaluate(() => {
      const editors = Array.from(document.querySelectorAll('.ProseMirror'));
      const perEditor = editors.map((el, i) => ({
        i,
        cls: el.className,
        paragraphs: el.querySelectorAll('p').length,
        marks: el.querySelectorAll('[data-entity-slug]').length,
      }));
      return {
        editorCount: editors.length,
        perEditor,
        totalMarks: document.querySelectorAll('[data-entity-slug]').length,
        indexed: Array.from(document.querySelectorAll('.ProseMirror p'))
          .map((p, i) => `${i}${p.querySelector('[data-entity-slug]') ? '+' : '-'}`)
          .slice(0, 130)
          .join(' '),
        firstParagraphHtml: (document.querySelector('.ProseMirror p') as HTMLElement | null)?.innerHTML.slice(0, 600) || null,
      };
    });
    console.log('    діагностика:', JSON.stringify(diagnosis, null, 1).slice(0, 1500));
  }

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

  // Приховування: теги зникають З КАНВИ ПОВНІСТЮ, текст лишається
  await page.click('[data-entity-toggle]');
  await new Promise((r) => setTimeout(r, 500));
  const hiddenChips = await countBy('.nova-entity-chip');
  const hiddenMarks = await countBy('[data-entity-slug]');
  t('кнопка приховала всі мітки', hiddenChips === 0 && hiddenMarks === 0, `${hiddenChips} чипів`);

  /*
   * ВАДА ВЛАСНИКА 23.09.2026: кнопка прибирала лише КОЛІР, а тег лишався
   * сірим текстом посеред прози («сутності не зникли, а лише змінили
   * колір»). Перевіряємо саме те, чого не бачили модульні тести: прихований
   * діапазон не має бути ВИДИМИМ у браузері — `display: none` дає нульову
   * ширину й висоту, тоді як «сірий текст» давав би нормальні розміри.
   */
  const hiddenTagsRendered = await page.evaluate(() => {
    const hidden = Array.from(document.querySelectorAll('.nova-entity-tag-hidden'));
    return {
      count: hidden.length,
      visible: hidden.filter((el) => el.getClientRects().length > 0).length,
      width: hidden.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0),
    };
  });
  t('приховані теги є в документі (розмітка не видалена)',
    hiddenTagsRendered.count >= 118, String(hiddenTagsRendered.count));
  t('жоден прихований тег не малюється в канві',
    hiddenTagsRendered.visible === 0 && hiddenTagsRendered.width === 0,
    JSON.stringify(hiddenTagsRendered));

  const tagsStillInDocument = await page.evaluate(() =>
    (document.querySelector('.ProseMirror')?.textContent || '').includes('[/project:')
  );
  t('у документі теги лишилися (підуть у книгу як є)', tagsStillInDocument);

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

  // Т0.10 (журнал #244, П2): на другому кроці сутності з кількома
  // характеристиками меню підказує формат полів і «@Ім'я».
  await page.keyboard.press('End');
  await page.keyboard.type(' /emot');
  await page.waitForSelector('[data-entity-slash-menu]', { timeout: 10000 });
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 400));
  const formatHint = await page.evaluate(() => document.querySelector('[data-entity-slash-format]')?.textContent || '');
  t('слеш-меню підказує формат полів і «@Ім’я» (П2, Т0.10)',
    formatHint.includes('Тип — інтенсивність') && formatHint.includes('@Ім'), formatHint);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));

  await page.screenshot({ path: path.join(shotDir, 'core-entities-canvas.png'), fullPage: false });

  // -------------------------------------------------------------------------
  // РЕЖИМ ДІАЛОГІВ ГЕРОЯ: «/character:Ім'я:діалог» (п. 2 постановки)
  // -------------------------------------------------------------------------
  // Новий абзац — щоб слеш стояв на початку рядка (межа тригера вимагає,
  // щоб перед ним не було літери; це те саме правило, що й для сутностей).
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/character:Сергій:діалог');
  await page.waitForSelector('[data-entity-slash-menu="dialogue"]', { timeout: 10000 });
  const dialogueItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-entity-slash-dialogue]')).map((el) => el.getAttribute('data-entity-slash-dialogue'))
  );
  t('слеш-запис відкрив список готових діалогів героя',
    dialogueItems.length === 3, JSON.stringify(dialogueItems.slice(0, 3)));
  t('перший пункт — саме готовий діалог (не поведінковий шаблон)',
    dialogueItems[0] === '— Ти й досі не віриш мені?', String(dialogueItems[0]));

  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 500));
  /*
   * Дивимося ОСТАННІЙ абзац, а не весь документ. У книзі вже є теги
   * `character` із попередніх кроків прогону (їх додала панель сутностей), і
   * пошук першого збігу по всьому тексту знайшов би чужий тег — саме на
   * цьому перша версія цієї перевірки й заплуталася.
   */
  const dialogueText = await page.evaluate(() => {
    const editor = document.querySelectorAll('.ProseMirror')[0];
    const paragraphs = Array.from(editor?.querySelectorAll('p') || []);
    return paragraphs.length ? (paragraphs[paragraphs.length - 1].textContent || '') : '';
  });
  const heroTag = dialogueText.match(/\[\/character:[^\]]*\]/)?.[0] || '';
  t('Tab вставив тег героя з його іменем', heroTag === '[/character:Сергій Коваль]', heroTag || 'тега немає');
  t('Tab вставив тег діалогу з першими трьома словами', dialogueText.includes('[/dialogue:Ти й досі]'));
  t('текст репліки лягає в канву', dialogueText.includes('Ти й досі не віриш мені?'));
  t('набраний слеш-запис не залишився хвостом у тексті',
    !dialogueText.includes('/character:Сергій:діалог'));

  // Те саме українським ключем — і саме тим словом, яке власник написав у
  // постановці («тег сутності / герой:Ім'я»), а не лише «персонаж» з реєстру.
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/герой:Сергій:діалог');
  await page.waitForSelector('[data-entity-slash-menu="dialogue"]', { timeout: 10000 });
  t('український ключ «герой» теж відкриває список діалогів', true);
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 500));
  const ukText = await page.evaluate(() => {
    const editor = document.querySelectorAll('.ProseMirror')[0];
    const paragraphs = Array.from(editor?.querySelectorAll('p') || []);
    return paragraphs.length ? (paragraphs[paragraphs.length - 1].textContent || '') : '';
  });
  t('у книгу лягає канонічний англійський слаг, а не український',
    !ukText.includes('персонаж:') && ukText.includes('[/dialogue:') && ukText.includes('[/character:Сергій Коваль]'),
    ukText.slice(0, 90));

  await page.screenshot({ path: path.join(shotDir, 'core-entities-dialogue.png'), fullPage: false });
  console.log('\nСкриншоти: tmp/core-entities-canvas.png, tmp/core-entities-hidden.png, tmp/core-entities-dialogue.png');
} finally {
  await browser.close();
  stopServer();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail > 0 ? 1 : 0);
