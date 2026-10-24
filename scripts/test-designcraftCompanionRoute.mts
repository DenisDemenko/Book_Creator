/**
 * Маршрут супутніх форматів і вибір автора.
 * Запуск: npm run test:designcraft-companion-route
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Супутні EPUB/HTML існували лише програмно: автор їх
 * ніде не бачив. Тепер є маршрут і кнопки, і важливі три речі:
 *
 *  1. РУШІЙ, ЯКИЙ ЦЬОГО НЕ ВМІЄ, КАЖЕ ЦЕ СЛОВАМИ. Nova не робить супутніх
 *     форматів. Віддати авторові PDF під виглядом EPUB або тихо проігнорувати
 *     прохання — гірше за помилку.
 *  2. ІНТЕРФЕЙС НЕ ВГАДУЄ. Ознаку `supportsCompanions` дає сервер у переліку
 *     рушіїв; кнопки показуються лише під рушієм, який справді вміє.
 *  3. ПОМИЛКА НЕ ПІДМІНЯЄТСЯ ФАЙЛОМ. Якщо рушій не дав супутника, маршрут
 *     віддає 502 з причиною, а не PDF із розширенням .epub.
 *
 * Піднімається справжній Express; `req.principal` підставляється
 * middleware — саме його читає `requireAdmin`. Перевірки, що потребують
 * справжнього бінарника DesignCraft, виконуються лише коли він є.
 */
const DIR = '/tmp/nova-designcraft-companion-route';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

let pass = 0;
let fail = 0;
let skipped = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};
const skip = (n: string, why: string) => {
  skipped++;
  console.log(`  — ${n} — пропущено: ${why}`);
};

/*
 * Шлях до бінарника визначається ДО імпорту рушія: той читає
 * `DESIGNCRAFT_PATH` на рівні модуля, тож виставлене пізніше значення він уже
 * не побачить. На цьому я й спіткнувся — тест «проходив», коли змінна була в
 * оточенні, і падав одинадцятьма перевірками, коли її задавав сам тест.
 *
 * Порожня `DESIGNCRAFT_PATH=` означає «бінарника свідомо немає» — так
 * перевіряється гілка пропуску, бо локальний запасний шлях інакше знайдеться.
 */
const LOCAL_CLI = 'D:/Rama/designcraft/target/release/designcraft-cli.exe';
const envCli = process.env.DESIGNCRAFT_PATH;
const cli =
  envCli === ''
    ? undefined
    : envCli && (envCli === 'designcraft-cli' || fs.existsSync(envCli))
      ? envCli
      : fs.existsSync(LOCAL_CLI)
        ? LOCAL_CLI
        : undefined;
if (cli) process.env.DESIGNCRAFT_PATH = cli;

const db = await import('../server/db');
const { registerPdfRoutes } = await import('../server/pdfRoutesBase');
await db.initDb();

/** Хто робить запит. Тест перемикає роль, щоб перевірити й відмову. */
let role: 'admin' | 'author' = 'admin';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, next) => {
  (req as any).principal = { id: 'u1', role, isGuest: false };
  next();
});
registerPdfRoutes(app, {
  resolveEngine: () => 'claude',
  loadAdminLayer: async () => ({}) as never,
  generateText: async () => ({ text: '{}' }),
});

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;

const book = {
  id: 'COMPANION-ROUTE-TEST',
  title: 'Книга для супутників',
  author: 'Fusion Lab Studio',
  chapters: [
    {
      id: 'c1',
      order: 1,
      title: 'Розділ перший',
      sections: [{ id: 's1', order: 1, title: 'Початок', content: '<p>Текст книги для перевірки маршруту супутніх форматів.</p>' }],
    },
  ],
};

const post = (body: unknown) =>
  fetch(`${base}/api/admin/pdf/companion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
console.log('\nПерелік рушіїв повідомляє про можливість');
{
  const res = await fetch(`${base}/api/pdf/engines`);
  const data: any = await res.json();
  t('перелік віддано', res.status === 200, String(res.status));
  const byId = new Map<string, { supportsCompanions?: boolean }>(
    (data.engines || []).map((e: any) => [String(e.id), e])
  );
  t('nova НЕ вміє супутників', byId.get('nova')?.supportsCompanions === false, JSON.stringify(byId.get('nova')?.supportsCompanions));
  t('designcraft вміє супутників', byId.get('designcraft')?.supportsCompanions === true, JSON.stringify(byId.get('designcraft')?.supportsCompanions));
  t(
    'ознака є в кожного рушія, а не лише в деяких',
    (data.engines || []).every((e: any) => typeof e.supportsCompanions === 'boolean'),
    JSON.stringify((data.engines || []).map((e: any) => [e.id, e.supportsCompanions]))
  );
}

// ---------------------------------------------------------------------------
console.log('\nВідмови — з причиною, а не 500');
{
  const noBook = await post({ kind: 'epub', engineId: 'designcraft' });
  t('без книги — 400', noBook.status === 400, String(noBook.status));

  const badKind = await post({ book, kind: 'mobi', engineId: 'designcraft' });
  t('невідомий формат — 400', badKind.status === 400, String(badKind.status));
  t('сказано, які формати є', /epub.*html|html.*epub/i.test((await badKind.json())?.error || ''));

  const noEngine = await post({ book, kind: 'epub' });
  t('без рушія — 400', noEngine.status === 400, String(noEngine.status));

  const nova = await post({ book, kind: 'epub', engineId: 'nova' });
  t('рушій без такої можливості — не 200', nova.status !== 200, String(nova.status));
  const novaBody: any = await nova.json().catch(() => ({}));
  t('помилка називає рушій і формат', /Nova/i.test(novaBody?.error || '') && /epub/i.test(novaBody?.error || ''), novaBody?.error);
  t('помилка каже, хто це вміє', /DesignCraft/i.test(novaBody?.error || ''), novaBody?.error);

  role = 'author';
  const forbidden = await post({ book, kind: 'epub', engineId: 'designcraft' });
  t('не адміністратор — 403', forbidden.status === 403, String(forbidden.status));
  role = 'admin';
}

// ---------------------------------------------------------------------------
console.log('\nСправжній файл');
{
  if (!cli) {
    skip('EPUB віддається як файл', 'бінарника DesignCraft немає');
    skip('HTML віддається як файл', 'бінарника DesignCraft немає');
  } else {
    const epub = await post({ book, kind: 'epub', engineId: 'designcraft' });
    t('EPUB — 200', epub.status === 200, String(epub.status));
    t('тип відповіді epub+zip', (epub.headers.get('content-type') || '').includes('application/epub+zip'), epub.headers.get('content-type') || '');

    /*
     * Назва книги тут кирилицею НЕ випадково: у заголовок HTTP вона не
     * влазить як є (дозволено лише Latin-1), і перша версія маршруту падала
     * з «Invalid character in header content». Тож перевіряються ОБА
     * варіанти з RFC 6266 — ASCII-запас і справжня назва.
     */
    const disposition = epub.headers.get('content-disposition') || '';
    t('віддається вкладенням', disposition.startsWith('attachment;'), disposition);
    t('ASCII-запас у filename', /filename="[\x20-\x7E]+\.epub"/.test(disposition), disposition);
    t("справжня назва у filename*", /filename\*=UTF-8''\S*%D0/.test(disposition), disposition);
    const bytes = Buffer.from(await epub.arrayBuffer());
    t('це справді zip', bytes.subarray(0, 2).toString('latin1') === 'PK', bytes.subarray(0, 4).toString('latin1'));
    t('mimetype — перший запис', bytes.subarray(0, 80).toString('latin1').includes('mimetypeapplication/epub+zip'));
    t('заголовок із нотаткою рушія є', !!epub.headers.get('x-pdf-note'));

    const html = await post({ book, kind: 'html', engineId: 'designcraft' });
    t('HTML — 200', html.status === 200, String(html.status));
    t('тип відповіді text/html', (html.headers.get('content-type') || '').includes('text/html'), html.headers.get('content-type') || '');
    const text = await html.text();
    t('HTML містить текст книги', text.includes('Розділ перший'));
  }
}

// ---------------------------------------------------------------------------
console.log('\nІнтерфейс не вгадує можливості');
{
  const src = fs.readFileSync('src/components/PublishingHubView.tsx', 'utf8');
  t('тип рушія в інтерфейсі має supportsCompanions', /supportsCompanions: boolean;/.test(src));
  t('кнопки звертаються саме до цього маршруту', src.includes("'/api/admin/pdf/companion'"));
  t('формат передається в тілі запиту', /JSON\.stringify\(\{ book, variant, engineId, theme, kind \}\)/.test(src));
  t(
    'блок показується лише коли рушій вміє',
    /chosenEngine\.available && chosenEngine\.supportsCompanions && \(/.test(src),
    'умова рендера'
  );
  t('є кнопка EPUB', src.includes('Завантажити EPUB'));
  t('є кнопка HTML', src.includes('Завантажити HTML'));
  t('сказано, чим це не є', /не те саме, що «Завантажити EPUB» у меню книги/.test(src));
  t('помилка показує нотатки рушія', /data\.notesUk\.join\(' '\)/.test(src));
}

server.close();
console.log(`\nDesignCraft companion route: ${pass} пройдено, ${fail} провалено${skipped ? `, ${skipped} пропущено` : ''}.`);
if (skipped) console.log('  Пропущене НЕ покрито: без бінарника справжній файл не перевіряється, лише відмови й контракт.');
if (fail > 0) process.exit(1);
