/**
 * Тести зовнішнього API (WriterScan). Запуск: npm run test:external-api
 *
 * Піднімається справжній Express із зареєстрованими маршрутами; модель зору
 * підставна — тест не потребує ні мережі, ні ключів. Перевіряється саме те,
 * від чого залежить безпека й довіра автора:
 *
 *  1. Токен у базі лише хешем, показується один раз, відкликаний — не працює.
 *  2. Застосунок входить ЛИШЕ токеном: cookie-сесія на /api/external/v1 не
 *     приймається, а токен не відкриває маршрути Студії (створення токенів,
 *     рішення про скан).
 *  3. Чуже — 404: книги, глави, скани, фото іншого автора.
 *  4. Скан не пише в книгу сам: після submit він лише у «Вхідних».
 *  5. Розпізнавання у фоні: 202 одразу, потім recognized або failed.
 *  6. Обидва бекенди сховища (JSON і SQLite) поводяться однаково.
 */
const DIR = '/tmp/nova-external-api-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const xstore = await import('../server/external/externalApiStore');
const routes = await import('../server/external/externalApiRoutes');
const ocr = await import('../server/external/scanOcrPrompt');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

// ---------------------------------------------------------------------------
// Чисті функції
// ---------------------------------------------------------------------------
console.log('\nОчищення відповіді OCR');
t('```-огорожа знімається', ocr.cleanOcrText('```\nПерший абзац\n```') === 'Перший абзац');
t('«Ось текст:» знімається', ocr.cleanOcrText('Ось розпізнаний текст:\nРядок') === 'Рядок');
t('3+ порожніх рядки → один розрив абзацу', ocr.cleanOcrText('А\n\n\n\nБ') === 'А\n\nБ');
t('CRLF → LF', ocr.cleanOcrText('А\r\nБ') === 'А\nБ');
t('системна інструкція вимагає дослівності', /ДОСЛІВНО/.test(ocr.scanOcrSystemInstruction()));
t('промпт згадує українську', /українськ/.test(ocr.buildScanOcrPrompt()));

console.log('\nРозбір фото');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
t('data:URL JPEG приймається', routes.decodeScanImage(`data:image/jpeg;base64,${JPEG.toString('base64')}`, undefined)?.mimeType === 'image/jpeg');
t('голий base64 + mimeType приймається', routes.decodeScanImage(PNG.toString('base64'), 'image/png')?.mimeType === 'image/png');
t('текст, названий JPEG, відхилено', routes.decodeScanImage(Buffer.from('not an image').toString('base64'), 'image/jpeg') === null);
t('PNG, названий JPEG, відхилено', routes.decodeScanImage(PNG.toString('base64'), 'image/jpeg') === null);
t('HEIC не підтримується', routes.decodeScanImage(JPEG.toString('base64'), 'image/heic') === null);
t('порожнє — null', routes.decodeScanImage('', 'image/jpeg') === null);

// ---------------------------------------------------------------------------
// Сховище — обидва бекенди
// ---------------------------------------------------------------------------
async function storeSuite(label: string) {
  console.log(`\nСховище: ${label}`);
  const { record, token } = await xstore.createToken({ userId: `u-${label}`, name: 'iPhone' });
  t('токен має префікс nst_', token.startsWith('nst_'), token.slice(0, 8));
  t('у записі хеш, а не сам токен', record.tokenHash !== token && record.tokenHash.length === 64);
  t('префікс для впізнавання — початок токена', token.startsWith(record.prefix));
  t('знаходиться за секретом', (await xstore.findActiveTokenBySecret(token))?.id === record.id);
  t('чужий/вигаданий секрет — null', (await xstore.findActiveTokenBySecret('nst_' + 'x'.repeat(40))) === null);
  t('без префікса — null без запиту до бази', (await xstore.findActiveTokenBySecret('abc')) === null);
  t('чужий токен не відкликається', (await xstore.revokeToken(record.id, 'someone-else')) === false);
  t('власник відкликає', (await xstore.revokeToken(record.id, `u-${label}`)) === true);
  t('відкликаний не знаходиться', (await xstore.findActiveTokenBySecret(token)) === null);

  const scan = await xstore.createScan({ ownerId: `u-${label}`, bookId: 'b1', assetId: 'md-1', imageUrl: '/api/media/file/md-1' });
  t('новий скан — processing', scan.status === 'processing');
  t('чужий скан не читається', (await xstore.getScan(scan.id, 'other')) === null);
  const upd = await xstore.updateScan(scan.id, `u-${label}`, { status: 'recognized', recognizedText: 'Текст' });
  t('оновлення зберігає текст', upd?.recognizedText === 'Текст' && upd?.status === 'recognized');
  t('перелік фільтрує за станом', (await xstore.listScans(`u-${label}`, { statuses: ['submitted'] })).length === 0);
  t('лічильник за годину рахує', (await xstore.countScansSince(`u-${label}`, new Date(Date.now() - 3600_000).toISOString())) === 1);
}

t('бекенд поки JSON', !db.isAvailable());
await storeSuite('JSON');
xstore.__resetExternalApiCacheForTests();
await db.initDb();
t('тепер SQLite', db.isAvailable());
await storeSuite('SQLite');

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const storeMod = await import('../server/store');
const bookStore = await import('../server/bookStore');
const media = await import('../server/media/mediaLibraryStore');

const now = new Date().toISOString();
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', createdAt: now } as any);
await storeMod.saveUser({ id: 'u-b', email: 'b@test.ua', name: 'Інший', role: 'writer', createdAt: now } as any);
await bookStore.saveBook({
  ownerId: 'u-a',
  book: {
    id: 'book-a',
    title: 'Книга А',
    chapters: [
      { id: 'ch-2', title: 'Друга', order: 2, sections: [] },
      { id: 'ch-1', title: 'Перша', order: 1, sections: [{ id: 's1' }] },
    ],
  },
});
await bookStore.saveBook({ ownerId: 'u-b', book: { id: 'book-b', title: 'Чужа', chapters: [{ id: 'x', title: 'X', order: 1 }] } });

// Сесія Студії імітується заголовком: реальний attachPrincipal перевіряється в auth-тестах.
const users: Record<string, any> = {
  'u-a': { id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', isGuest: false },
  'u-b': { id: 'u-b', email: 'b@test.ua', name: 'Інший', role: 'writer', isGuest: false },
};
const GUEST = { id: null, email: 'guest@local', name: 'Гість', role: 'guest', isGuest: true };

const tasks: Array<() => Promise<void>> = [];
const flush = async () => {
  while (tasks.length) await tasks.shift()!();
};
let ocrMode: 'ok' | 'fail' = 'ok';
const recognizeCalls: any[] = [];
let storageAllowed = true;

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use((req: any, _res, next) => {
  const u = req.headers['x-test-session'];
  req.principal = typeof u === 'string' && users[u] ? users[u] : GUEST;
  next();
});
routes.registerExternalApiRoutes(app, {
  recognize: async (p) => {
    recognizeCalls.push({ mimeType: p.mimeType, bookId: p.bookId, ownerId: p.ownerId, principal: (p.req as any).principal?.id });
    if (ocrMode === 'fail') throw new Error('Модель перевантажена');
    return { text: '```\nПерший абзац рукопису.\n\n\n\nДругий абзац.\n```', modelId: 'test-vision' };
  },
  checkStorage: async () => (storageAllowed ? { allowed: true } : { allowed: false, reasonUk: 'Ліміт вичерпано' }),
  schedule: (task) => {
    tasks.push(task);
  },
});

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;

async function call(method: string, path: string, opts: { session?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.session) headers['x-test-session'] = opts.session;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data: data as any, type };
}

console.log('\nТокени (Студія)');
t('гість не створює токен', (await call('POST', '/api/external-tokens', { body: { name: 'x' } })).status === 401);
const created = await call('POST', '/api/external-tokens', { session: 'u-a', body: { name: 'iPhone Дениса' } });
t('автор створює токен — 201', created.status === 201, String(created.status));
const tokenA: string = created.data.token;
t('токен повертається один раз у відповіді', typeof tokenA === 'string' && tokenA.startsWith('nst_'));
const listed = await call('GET', '/api/external-tokens', { session: 'u-a' });
t('у переліку є токен з назвою', listed.data.tokens?.[0]?.name === 'iPhone Дениса');
t('у переліку НЕМАЄ ні токена, ні хеша', !JSON.stringify(listed.data).includes(tokenA) && !JSON.stringify(listed.data).includes('tokenHash'));
const tokenB: string = (await call('POST', '/api/external-tokens', { session: 'u-b', body: { name: 'B' } })).data.token;
t('токен не відкриває маршрути Студії', (await call('POST', '/api/external-tokens', { token: tokenA, body: {} })).status === 401);

console.log('\nВхід застосунку');
t('без заголовка — 401', (await call('GET', '/api/external/v1/me')).status === 401);
t('сесія Студії без токена — 401 (cookie тут не приймається)', (await call('GET', '/api/external/v1/me', { session: 'u-a' })).status === 401);
const bad = await call('GET', '/api/external/v1/me', { token: 'nst_' + 'z'.repeat(43) });
t('вигаданий токен — 401 invalid_token', bad.status === 401 && bad.data.kind === 'invalid_token');
const me = await call('GET', '/api/external/v1/me', { token: tokenA });
t('/me — власник токена', me.status === 200 && me.data.user?.id === 'u-a', JSON.stringify(me.data));

console.log('\nКниги й глави');
const books = await call('GET', '/api/external/v1/books', { token: tokenA });
t('лише свої книги', books.data.books?.length === 1 && books.data.books[0].id === 'book-a', JSON.stringify(books.data));
const chapters = await call('GET', '/api/external/v1/books/book-a/chapters', { token: tokenA });
t('глави впорядковані за order', chapters.data.chapters?.map((c: any) => c.id).join(',') === 'ch-1,ch-2', JSON.stringify(chapters.data));
t('кількість секцій у главі', chapters.data.chapters?.[0]?.sectionCount === 1);
t('чужа книга — 404', (await call('GET', '/api/external/v1/books/book-b/chapters', { token: tokenA })).status === 404);

console.log('\nСкан: приймання і розпізнавання');
const image = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
t('погане фото — 400', (await call('POST', '/api/external/v1/books/book-a/scans', { token: tokenA, body: { image: 'abc', mimeType: 'image/jpeg' } })).status === 400);
t('у чужу книгу — 404', (await call('POST', '/api/external/v1/books/book-b/scans', { token: tokenA, body: { image } })).status === 404);
storageAllowed = false;
const quota = await call('POST', '/api/external/v1/books/book-a/scans', { token: tokenA, body: { image } });
t('вичерпаний ліміт сховища — 402', quota.status === 402 && quota.data.kind === 'quota_exceeded');
storageAllowed = true;

const accepted = await call('POST', '/api/external/v1/books/book-a/scans', { token: tokenA, body: { image } });
t('фото прийнято — 202', accepted.status === 202, String(accepted.status));
const scanId: string = accepted.data.scan?.scanId;
t('одразу — processing', accepted.data.scan?.status === 'processing');
t('фото лягло в медіатеку книги', (await media.listAssets('u-a', { bookId: 'book-a' })).length === 1);
const early = await call('POST', `/api/external/v1/scans/${scanId}/submit`, { token: tokenA, body: { text: 'x' } });
t('submit до розпізнавання — 409 not_ready', early.status === 409 && early.data.kind === 'not_ready');

await flush();
const recognized = await call('GET', `/api/external/v1/scans/${scanId}`, { token: tokenA });
t('після фону — recognized', recognized.data.scan?.status === 'recognized', JSON.stringify(recognized.data.scan));
t('текст очищено від огорожі й зайвих рядків', recognized.data.scan?.recognizedText === 'Перший абзац рукопису.\n\nДругий абзац.');
t('записано модель', recognized.data.scan?.modelId === 'test-vision');
t('модель отримала JPEG і власника', recognizeCalls[0]?.mimeType === 'image/jpeg' && recognizeCalls[0]?.ownerId === 'u-a');
t('у фоні req.principal — власник токена (для обліку витрат)', recognizeCalls[0]?.principal === 'u-a');
t('чужим токеном скан не видно — 404', (await call('GET', `/api/external/v1/scans/${scanId}`, { token: tokenB })).status === 404);

const img = await call('GET', `/api/external/v1/scans/${scanId}/image`, { token: tokenA });
t('фото скану віддається токеном', img.status === 200 && img.type.includes('image/jpeg') && (img.data as ArrayBuffer).byteLength === JPEG.length);
t('чужим токеном фото — 404', (await call('GET', `/api/external/v1/scans/${scanId}/image`, { token: tokenB })).status === 404);

console.log('\nСкан: невдале розпізнавання');
ocrMode = 'fail';
const failing = await call('POST', '/api/external/v1/books/book-a/scans', { token: tokenA, body: { image } });
await flush();
const failed = await call('GET', `/api/external/v1/scans/${failing.data.scan.scanId}`, { token: tokenA });
t('невдача — failed з причиною', failed.data.scan?.status === 'failed' && /перевантажена/.test(failed.data.scan?.error || ''));
const manual = await call('POST', `/api/external/v1/scans/${failing.data.scan.scanId}/submit`, { token: tokenA, body: { text: 'Набрано вручну' } });
t('після невдачі автор може надіслати текст вручну', manual.status === 200 && manual.data.scan?.status === 'submitted');
const failing2 = await call('POST', '/api/external/v1/books/book-a/scans', { token: tokenA, body: { image } });
await flush();
ocrMode = 'ok';
t('повтор для розпізнаного — 409', (await call('POST', `/api/external/v1/scans/${scanId}/retry`, { token: tokenA })).status === 409);
const retried = await call('POST', `/api/external/v1/scans/${failing2.data.scan.scanId}/retry`, { token: tokenA });
t('повтор невдалого — 202 processing', retried.status === 202 && retried.data.scan?.status === 'processing');
await flush();
const retriedAfter = await call('GET', `/api/external/v1/scans/${failing2.data.scan.scanId}`, { token: tokenA });
t('після повтору — recognized без помилки', retriedAfter.data.scan?.status === 'recognized' && retriedAfter.data.scan?.error === null);
t('повтор чужим токеном — 404', (await call('POST', `/api/external/v1/scans/${failing2.data.scan.scanId}/retry`, { token: tokenB })).status === 404);
t('мережевий збій — людське пояснення', /недоступний/.test(routes.humanizeOcrError(new Error('fetch failed'))));
t('людська відмова провайдера лишається як є', routes.humanizeOcrError(new Error('Вичерпано ліміт')) === 'Вичерпано ліміт');

console.log('\nСкан: передача в Студію');
t('порожній текст — 400', (await call('POST', `/api/external/v1/scans/${scanId}/submit`, { token: tokenA, body: { text: '   ' } })).status === 400);
t('глава не з цієї книги — 400', (await call('POST', `/api/external/v1/scans/${scanId}/submit`, { token: tokenA, body: { text: 'a', chapterId: 'x' } })).status === 400);
const submitted = await call('POST', `/api/external/v1/scans/${scanId}/submit`, {
  token: tokenA,
  body: { text: 'Виправлений\r\nтекст', chapterId: 'ch-2', chapterTitle: 'підміна', sectionTitle: 'Сторінка 12' },
});
t('submit — 200 submitted', submitted.status === 200 && submitted.data.scan?.status === 'submitted');
t('назва глави береться з книги, а не з запиту', submitted.data.scan?.chapterTitle === 'Друга');
t('CRLF нормалізовано', submitted.data.scan?.text === 'Виправлений\nтекст');
t('розпізнане лишилось незмінним поруч із правкою', submitted.data.scan?.recognizedText === 'Перший абзац рукопису.\n\nДругий абзац.');
const again = await call('POST', `/api/external/v1/scans/${scanId}/submit`, { token: tokenA, body: { text: 'Друга версія', chapterId: 'ch-1' } });
t('повторний submit до вставки оновлює той самий скан', again.data.scan?.scanId === scanId && again.data.scan?.chapterId === 'ch-1');
const storedBook = await bookStore.getBook('book-a');
t('книгу на сервері скан НЕ змінив', JSON.stringify((storedBook!.book as any).chapters).indexOf('Друга версія') === -1);

console.log('\nВхідні Студії');
const inbox = await call('GET', '/api/scans/inbox?bookId=book-a', { session: 'u-a' });
t('у вхідних — обидва передані скани', inbox.data.scans?.length === 2, String(inbox.data.scans?.length));
t('чужі вхідні порожні', (await call('GET', '/api/scans/inbox', { session: 'u-b' })).data.scans?.length === 0);
t('токен не читає вхідні Студії', (await call('GET', '/api/scans/inbox', { token: tokenA })).status === 401);
t('невідома дія — 400', (await call('POST', `/api/scans/${scanId}/resolve`, { session: 'u-a', body: { action: 'x' } })).status === 400);
t('чужий скан не вирішується — 404', (await call('POST', `/api/scans/${scanId}/resolve`, { session: 'u-b', body: { action: 'inserted' } })).status === 404);
const resolved = await call('POST', `/api/scans/${scanId}/resolve`, { session: 'u-a', body: { action: 'inserted' } });
t('вставлено — inserted', resolved.data.scan?.status === 'inserted');
t('повторне «inserted» — ідемпотентно 200', (await call('POST', `/api/scans/${scanId}/resolve`, { session: 'u-a', body: { action: 'inserted' } })).status === 200);
t('після вставки submit — 409 already_resolved', (await call('POST', `/api/external/v1/scans/${scanId}/submit`, { token: tokenA, body: { text: 'z' } })).data.kind === 'already_resolved');
t('вставлений зник із вхідних', (await call('GET', '/api/scans/inbox?bookId=book-a', { session: 'u-a' })).data.scans?.length === 1);

console.log('\nВідкликання');
const tokenId = (await call('GET', '/api/external-tokens', { session: 'u-a' })).data.tokens[0].id;
t('чужий токен не відкликається — 404', (await call('DELETE', `/api/external-tokens/${tokenId}`, { session: 'u-b' })).status === 404);
t('власник відкликає', (await call('DELETE', `/api/external-tokens/${tokenId}`, { session: 'u-a' })).status === 200);
t('відкликаним токеном — 401', (await call('GET', '/api/external/v1/me', { token: tokenA })).status === 401);
const after = await call('GET', '/api/external-tokens', { session: 'u-a' });
t('у переліку відкликаний позначено датою', Boolean(after.data.tokens[0].revokedAt));

server.close();
console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail) process.exit(1);
