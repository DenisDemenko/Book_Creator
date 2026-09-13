/**
 * Живий прогін експорту книги у PDF для вітрини магазину.
 *
 * Запуск:
 *   npm run live:storefront-export                       — усі кроки
 *   npm run live:storefront-export -- --book=BK-2084-CYBER
 *   npm run live:storefront-export -- --stages=build,cover
 *
 * ЧОМУ ЦЕ ОКРЕМИЙ СКРИПТ, А НЕ ЩЕ ОДИН `test:*`. Юніт-тести перевіряють
 * ланки на фікстурах і з підміненою мережею. Тут усе навпаки: береться
 * СПРАВЖНЯ книга зі сховища Студії, піднімається СПРАВЖНІЙ Express із тими
 * самими маршрутами, які натискає автор у вкладці «Вітрина», і кожен крок
 * лишає по собі файл, який можна відкрити очима. Саме тому скрипт падає з
 * кодом 1, коли котрийсь зі кроків не відбувся, — «зелений» тут означає
 * «книга справді зверстана й готова до вітрини», а не «код не кинув
 * винятку».
 *
 * Що робить:
 *   1. `POST /api/books/:id/render`   — верстає й ЗБЕРІГАЄ PDF (електронна
 *      редакція, друкована під KDP, безкоштовний уривок);
 *   2. `GET  /api/books/:id/artifact/pdf` — забирає зібраний PDF назад і
 *      міряє його (сторінки, формат у міліметрах) через pdf-lib;
 *   3. обкладинку картки — перша сторінка того самого PDF → PNG. У браузері
 *      це робить клієнт (`src/utils/pdfCover.ts`); тут той самий pdfjs
 *      запускається в Node через `@napi-rs/canvas`, і готовий PNG кладеться
 *      маршрутом `POST /api/books/:id/artifact/cover`;
 *   4. читає зібраний PDF назад і перевіряє ВМІСТ: назву, присвяту, епіграф,
 *      перший розділ і вбудовану ілюстрацію — щоб «зібралось» не означало
 *      лише «народилося багато байтів»;
 *   5. `POST /api/books/:id/publish` — відправляє зібране у вітрину.
 *
 * КРОК 5 ПОТРЕБУЄ НАЛАШТОВАНОГО МОСТУ І НЕ ЛОКАЛЬНОЇ МАШИНИ. Адреса й ключ маркетплейсу лежать у
 * налаштуваннях Студії (Адмінка → «Міст до вітрини»); на цій машині їх немає,
 * і скрипт про це скаже прямо, а не вдасть, що прогін удався. Якщо треба
 * прогнати локально до кінця — впишіть адресу й ключ у змінні середовища
 * `NOVA_BRIDGE_URL` і `NOVA_BRIDGE_KEY` (скрипт збереже їх так само, як це
 * робить адмінка) або введіть у самій адмінці локальної Студії.
 *
 * ПОБІЧНІ ЕФЕКТИ, ЯКІ ТРЕБА ЗНАТИ. Це не пісочниця: скрипт пише артефакти в
 * робоче сховище (`data/books/<id>/`) і дописує рядки в `book_artifacts`.
 * Саме це і є «експорт для вітрини» — просто не треба дивуватись, що після
 * прогону в книзі зʼявились зверстані файли.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { coverScaleFor } from '../src/utils/pdfCover';
import { isLocalHost } from '../server/publicOrigin';
const args = process.argv.slice(2);
const argOf = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const requestedStages = (argOf('stages') || 'build,cover,content,publish')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const stageRequested = (stage: string) => requestedStages.includes(stage);

let ok = 0;
let bad = 0;
const t = (name: string, passed: boolean, extra = '') => {
  if (passed) ok += 1;
  else bad += 1;
  console.log(`${passed ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const mm = (points: number) => Math.round((points / 72) * 25.4 * 10) / 10;
const kb = (bytes: number) => `${Math.round(bytes / 1024)} КБ`;

// --- 1. Реальна книга зі сховища ------------------------------------------
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const dbPath = path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'nova-studio.db'));
if (!fs.existsSync(dbPath)) {
  console.error(`Немає сховища Студії за шляхом ${dbPath} — прогін неможливий.`);
  process.exit(1);
}

const wantedId = argOf('book');
const db = new DatabaseSync(dbPath);
const bookRow = (wantedId
  ? db.prepare('SELECT id, owner_id, title, revision, updated_at FROM books WHERE id = ?').get(wantedId)
  : db.prepare('SELECT id, owner_id, title, revision, updated_at FROM books ORDER BY updated_at DESC LIMIT 1').get()) as
  | { id: string; owner_id: string | null; title: string; revision: number; updated_at: string }
  | undefined;
if (!bookRow) {
  db.close();
  console.error(wantedId ? `У сховищі немає книги ${wantedId}.` : 'У сховищі немає жодної книги.');
  process.exit(1);
}
const ownerRow = (bookRow.owner_id
  ? db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(bookRow.owner_id)
  : null) as { id: string; email: string; role: string } | null;
db.close();

console.log('Живий прогін експорту у PDF для вітрини');
console.log(`  сховище: ${dbPath}`);
console.log(`  книга: «${bookRow.title}» (${bookRow.id}), ревізія ${bookRow.revision}, збережена ${bookRow.updated_at}`);
console.log(`  власник: ${ownerRow ? `${ownerRow.email} (${ownerRow.role})` : 'не вказаний'} — від його імені йдуть запити`);
console.log(`  кроки: ${requestedStages.join(', ')}\n`);

// --- 2. Справжній сервер із тими самими маршрутами ------------------------
const store = await import('../server/store');
const bridge = await import('../server/marketplaceBridge');
const pdfRoutes = await import('../server/pdfRoutes');
const bookRoutes = await import('../server/bookRoutes');

await store.initStore();

const app = express();
app.use(express.json({ limit: '64mb' }));
app.use((req, _res, next) => {
  // Той самий principal, який у бою ставить сесія: маршрути нижче перевіряють
  // ролі через requireAuth/requireAdmin і не знають, що запит не з браузера.
  (req as { principal?: unknown }).principal = {
    id: ownerRow?.id || 'live-run',
    email: ownerRow?.email || 'live-run@local',
    role: ownerRow?.role || 'admin',
    isGuest: false,
  };
  next();
});

const ops = pdfRoutes.registerPdfRoutes(app, {
  resolveEngine: () => 'gemini',
  defaultModelId: process.env.NOVA_LIVE_MODEL || 'gemini-2.5-flash',
  loadAdminLayer: async () => ({}),
  // Макет береться з налаштувань книги (variant: 'code'), тож модель тут не
  // потрібна. Якщо її все-таки спитають — хай це буде гучно, а не тихо
  // витраченим викликом.
  generateText: async () => {
    throw new Error('живий прогін не має витрачати виклики моделі: очікувався макет із книги');
  },
});
bookRoutes.registerBookRoutes(app, ops);

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

const call = async (method: 'GET' | 'POST', urlPath: string, body?: unknown) => {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/pdf')) {
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* не JSON — лишаємо текстом */
  }
  return { status: res.status, json, text, headers: res.headers };
};

const artifactsBefore = await call('GET', `/api/books/${bookRow.id}/artifacts`);
console.log(`Артефактів до прогону: ${(artifactsBefore.json?.artifacts || []).length}`);

let pdfBytes: Uint8Array | null = null;
/**
 * Один розібраний PDF на весь прогін.
 *
 * Друге `getDocument` у тому самому процесі падає з «Cannot transfer object
 * of unsupported type» — перевірено: кроки `cover` і `content` разом давали
 * помилку, а кожен окремо працював. Тому документ відкривається раз і
 * живеться до кінця процесу; `destroy()` тут не потрібен — процес і так
 * завершується, а воркер забирає з собою.
 */
let pdfjsDoc: { numPages: number; getPage: (n: number) => Promise<any> } | null = null;
const openPdf = async () => {
  if (pdfjsDoc) return pdfjsDoc;
  if (!pdfBytes) {
    const file = await call('GET', `/api/books/${bookRow.id}/artifact/pdf?format=digital`);
    pdfBytes = file.bytes || null;
  }
  if (!pdfBytes) throw new Error('PDF не знайдено в сховищі — читати нема чого');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Без явного воркер-джерела pdfjs піднімає фальшивий і валиться на читанні
  // тексту («Cannot transfer object of unsupported type»).
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
  ).href;
  const fontsUrl = `${pathToFileURL(path.resolve('node_modules/pdfjs-dist/standard_fonts')).href}/`;
  // `slice()` — не зайва копія: pdfjs ВІДДАЄ буфер воркеру як transferable, і
  // без копії `pdfBytes` лишається від'єднаним (нульової довжини) — саме через
  // це pdf-lib потім казав «No PDF header found» на власних же байтах.
  const data = pdfBytes.slice();
  const task = pdfjs.getDocument({ data, useWorkerFetch: false, standardFontDataUrl: fontsUrl } as never);
  pdfjsDoc = (await task.promise) as never;
  return pdfjsDoc!;
};

try {
  // --- 3. Верстка й збереження файлів ------------------------------------
  if (stageRequested('build')) {
    console.log('\nКрок 1 — верстка й збереження (POST /api/books/:id/render):');
    const started = Date.now();
    const rendered = await call('POST', `/api/books/${bookRow.id}/render`, {
      formats: ['digital', 'print'],
      variant: 'code',
      sample: true,
      samplePages: 5,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    if (rendered.status !== 200) {
      t('верстка віддала 200', false, `HTTP ${rendered.status}: ${rendered.text?.slice(0, 200)}`);
    } else {
      t('верстка віддала 200', true, `${seconds} с`);
      const built = (rendered.json?.built || []) as Array<Record<string, any>>;
      t('зібрано дві редакції', built.length === 2, built.map((b) => b.format).join(', '));
      for (const item of built) {
        const pdf = item.pdf || {};
        const sample = item.sample || null;
        console.log(
          `  · ${item.format}: ${pdf.pageCount} стор., ${pdf.sizeBytes} Б, варіант «${pdf.variant}»` +
            (item.layout?.trimId ? `, обріз ${item.layout.trimId}, корінець ${item.layout.gutterMm} мм` : '') +
            (sample ? `, уривок ${sample.pageCount} стор.` : '') +
            (item.sampleNoteUk ? ` (${item.sampleNoteUk})` : '')
        );
        if (item.warningsUk?.length) console.log(`    попередження: ${item.warningsUk.join(' | ')}`);
      }
      const digital = built.find((b) => b.format === 'digital');
      t('електронна редакція має сторінки', Number(digital?.pdf?.pageCount) > 0, String(digital?.pdf?.pageCount));
      t('друкована редакція має корінець KDP', Number(built.find((b) => b.format === 'print')?.layout?.gutterMm) >= 0);
      t('уривок зібрано', built.some((b) => b.sample));
    }
  }

  // --- 4. Файл назад зі сховища й вимір ----------------------------------
  if (stageRequested('build')) {
    console.log('\nКрок 2 — файл із сховища (GET /api/books/:id/artifact/pdf):');
    const file = await call('GET', `/api/books/${bookRow.id}/artifact/pdf?format=digital`);
    const signature = file.bytes ? Buffer.from(file.bytes.subarray(0, 5)).toString() : '';
    t('маршрут віддає справжній PDF', file.status === 200 && signature === '%PDF-', signature);
    if (file.bytes) {
      pdfBytes = file.bytes;
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(file.bytes);
      const first = doc.getPage(0).getSize();
      t(
        'формат сторінки = A5 із конфігурації книги (148×210 мм)',
        Math.abs(mm(first.width) - 148) < 1 && Math.abs(mm(first.height) - 210) < 1,
        `${mm(first.width)}×${mm(first.height)} мм`
      );
      t('сторінок у файлі стільки ж, скільки в звіті верстки', doc.getPageCount() > 0, String(doc.getPageCount()));
      console.log(`  · файл на диску: ${path.join(dataDir, 'books', bookRow.id, 'pdf-digital.pdf')} (${kb(file.bytes.length)})`);

      // Друкована редакція міряється окремо: саме вона їде у вітрину як
      // «друковане видання», і саме в неї обріз KDP, а не формат книги.
      const printFile = await call('GET', `/api/books/${bookRow.id}/artifact/pdf?format=print`);
      if (printFile.status === 200 && printFile.bytes) {
        const { PDFDocument: PdfDoc } = await import('pdf-lib');
        const printDoc = await PdfDoc.load(printFile.bytes);
        const size = printDoc.getPage(0).getSize();
        t(
          'друкована редакція зверстана під обріз 6×9 дюймів (152×229 мм)',
          Math.abs(mm(size.width) - 152.4) < 1 && Math.abs(mm(size.height) - 228.6) < 1,
          `${mm(size.width)}×${mm(size.height)} мм, ${printDoc.getPageCount()} стор.`
        );
      } else {
        t('друкована редакція читається зі сховища', false, `HTTP ${printFile.status}`);
      }
    }
  }

  // --- 5. Обкладинка картки ----------------------------------------------
  if (stageRequested('cover')) {
    console.log('\nКрок 3 — обкладинка з першої сторінки (pdfjs + @napi-rs/canvas → POST artifact/cover):');
    try {
      const { createCanvas } = await import('@napi-rs/canvas');
      const pdf = await openPdf();
      const first = await pdf.getPage(1);
      const view = first.getViewport({ scale: 1 });
      const viewport = first.getViewport({ scale: coverScaleFor(view.width, view.height, 1600) });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await first.render({ canvasContext: ctx, viewport } as never).promise;
      const png = canvas.toBuffer('image/png');

      t('перша сторінка растеризувалась', png.length > 0, `${png.length} Б, ${canvas.width}×${canvas.height} px`);
      const stored = await call('POST', `/api/books/${bookRow.id}/artifact/cover`, {
        imageBase64: `data:image/png;base64,${png.toString('base64')}`,
        format: 'digital',
      });
      t('обкладинка збережена як артефакт книги', stored.status === 200, JSON.stringify(stored.json).slice(0, 120));
    } catch (err) {
      t('обкладинка картки', false, (err as Error).message);
    }
  }

  // --- 6. Що саме всередині PDF ------------------------------------------
  if (stageRequested('content')) {
    console.log('\nКрок 4 — вміст PDF (pdfjs читає текст і картинки):');
    try {
      if (!pdfBytes) {
        const file = await call('GET', `/api/books/${bookRow.id}/artifact/pdf?format=digital`);
        pdfBytes = file.bytes || null;
      }
      if (!pdfBytes) throw new Error('PDF не знайдено в сховищі');

      const stored = await call('GET', `/api/books/${bookRow.id}`);
      const book = (stored.json?.book || {}) as Record<string, any>;
      const front = book.layoutConfig?.frontMatter || {};

      const pdf = await openPdf();
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const content = await (await pdf.getPage(i)).getTextContent();
        pages.push(content.items.map((item: any) => String(item.str || '')).join(' '));
      }
      const all = pages.join(' \n ');

      t('титульна сторінка несе назву книги', all.includes(String(book.title || '').slice(0, 20)), String(book.title));
      const chapterTitle = String(book.chapters?.[0]?.title || '').split(':')[0];
      t('перший розділ у PDF', chapterTitle ? all.includes(chapterTitle) : false, chapterTitle);
      t('текст розділу не порожній', all.replace(/\s+/g, '').length > 1000, `${all.replace(/\s+/g, '').length} символів у ${pdf.numPages} стор.`);

      /*
        РЕШТА БЛОКІВ ПЕРЕДМОВИ. Книга просить сторінку копірайту, присвяту,
        епіграф і зміст (`layoutConfig.frontMatter`), і автор бачить ці
        перемикачі в «Верстка & Поля». Серверна верстка Nova малює з них ЛИШЕ
        титул: у `PdfLayoutSpec` (server/pdf/pdfTypes.ts) для решти полів
        просто немає місця. Перевірка тут не для того, щоб «упасти», а щоб це
        перестало бути невидимим: у PDF, який їде у вітрину, цих блоків немає.
      */
      const fmNote = 'серверна верстка Nova малює лише титул — у PdfLayoutSpec немає полів для цих блоків';
      if (front.showCopyright && front.copyrightText) {
        t('сторінка копірайту в PDF', all.includes(String(front.copyrightText).slice(0, 25)), fmNote);
      }
      if (front.showDedication && front.dedicationText) {
        t('присвята в PDF', all.includes(String(front.dedicationText).slice(0, 30)), fmNote);
      }
      if (front.showEpigraph && front.epigraphText) {
        t('епіграф у PDF', all.includes(String(front.epigraphText).slice(0, 30)), fmNote);
      }
      if (front.showTableOfContents) {
        t('зміст у PDF', /(^|\s)(Зміст|ЗМІСТ|Contents)(\s|$)/.test(all), fmNote);
      }

      /*
        ІЛЮСТРАЦІЇ. Шукати `/Subtype /Image` у сирих байтах НЕ МОЖНА: pdf-lib
        типово зберігає документ зі стисненими об'єктними потоками, і словник
        картинки в тексті файлу просто не видно (перша редакція цієї
        перевірки саме на цьому й помилилась, показавши «0 зображень»).
        Тому питаємо в розібраного документа.
      */
      const { PDFDocument: PdfLib, PDFName } = await import('pdf-lib');
      const parsed = await PdfLib.load(pdfBytes);
      let images = 0;
      let maxWidth = 0;
      let maxHeight = 0;
      for (const [, object] of parsed.context.enumerateIndirectObjects()) {
        const dict = (object as { dict?: { get?: (name: unknown) => unknown } }).dict;
        if (!dict?.get) continue;
        if (String(dict.get(PDFName.of('Subtype'))) !== '/Image') continue;
        images += 1;
        maxWidth = Math.max(maxWidth, Number(String(dict.get(PDFName.of('Width')))) || 0);
        maxHeight = Math.max(maxHeight, Number(String(dict.get(PDFName.of('Height')))) || 0);
      }
      const expectedImages = Array.isArray(book.illustrations) ? book.illustrations.length : 0;
      console.log(
        `  · вбудованих зображень: ${images} (у книзі ілюстрацій: ${expectedImages}), найбільше ${maxWidth}×${maxHeight} px`
      );
      t(
        'ілюстрації книги вбудовані',
        images >= expectedImages,
        `${images} у PDF проти ${expectedImages} у книзі`
      );
    } catch (err) {
      t('вміст PDF', false, (err as Error).message);
    }
  }

  // --- 7. Публікація у вітрину -------------------------------------------
  if (stageRequested('publish')) {
      console.log('\nКрок 5 — публікація у вітрину (POST /api/books/:id/publish):');
    const view = await bridge.readBridgeSettingsView();
    const configured = Boolean(view?.url) && Boolean(view?.keySet || view?.keyFingerprint);
    if (!configured) {
      const envUrl = process.env.NOVA_BRIDGE_URL;
      const envKey = process.env.NOVA_BRIDGE_KEY;
      if (envUrl && envKey) {
        await bridge.saveBridgeSettings({ url: envUrl, key: envKey });
        console.log('  · налаштування мосту взято зі змінних середовища й збережено');
      } else {
        t(
          'міст до вітрини налаштований',
          false,
          'немає ані в налаштуваннях Студії (Адмінка → «Міст до вітрини»), ані в NOVA_BRIDGE_URL/NOVA_BRIDGE_KEY'
        );
        console.log(
          '  Вітрина — зовнішній сервіс: без адреси й ключа крок не виконується за побутової причини,\n' +
            '  і вдавати, що книга поїхала, було б гірше за чесну зупинку.'
        );
      }
    }

    if (await bridge.readBridgeSettings().then((s) => Boolean(s.url && s.key)).catch(() => false)) {
      /*
        АДРЕСА ОБКЛАДИНКИ В КАРТЦІ — ЦЕ ПОСИЛАННЯ НА НАС.
        `publishStored` кладе в картку `coverUrl` на кшталт
        `<публічна адреса Студії>/api/public/books/<id>/cover`, і цю адресу
        відкриває браузер ПОКУПЦЯ. Локальний прогін дав би
        `http://127.0.0.1:<порт>/...` — маркетплейс таку адресу не дістане,
        і в каталозі зʼявилась би картка без обкладинки, тобто рівно те, від
        чого захищає перевірка `cover_required` у маршруті публікації.
        Тому локальна публікація вимагає свідомого прапорця.
      */
      const host = new URL(base).hostname;
      if (isLocalHost(host) && !args.includes('--allow-local-publish')) {
        t(
          'публікація у вітрину',
          false,
          'локальна машина: обкладинка в картці посилалась би на 127.0.0.1 і не відкрилась би покупцю — ' +
            'публікуйте зі Студії, яку бачить маркетплейс (або додайте --allow-local-publish свідомо)'
        );
      } else {
        const published = await call('POST', `/api/books/${bookRow.id}/publish`, {
          editions: [
            { format: 'digital', priceMinor: 599, variant: 'code' },
            { format: 'print', priceMinor: 1499, variant: 'code' },
          ],
        });
        t('вітрина прийняла книгу', published.status === 200, `HTTP ${published.status} ${published.text?.slice(0, 200)}`);
        if (published.json) console.log(`  · редакції: ${JSON.stringify(published.json).slice(0, 400)}`);
      }
    }
  }
} finally {
  server.close();
}

console.log(`\nПідсумок: ${ok} перевірок пройдено, ${bad} не пройдено.`);
if (bad > 0) process.exit(1);
