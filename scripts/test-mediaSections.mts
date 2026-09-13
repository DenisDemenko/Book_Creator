/**
 * Тести розділів медіатеки — `GET /api/media/sections`.
 * Запуск: npm run test:media-sections
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Розділ медіатеки — не окрема сутність, а група файлів
 * за `book_id`. Тому маршрут мусить:
 *   1. рахувати файли й байти ПО КОЖНІЙ книзі окремо (це те, що бачить автор
 *      у списку розділів);
 *   2. підписати розділ назвою книги — вона лежить у книгосховищі, а не в
 *      записі файлу;
 *   3. не показати чужого: файли іншого автора з тим самим `book_id` не
 *      мають ні порахуватися, ні підписатися;
 *   4. віддати файли без книги окремою групою (`bookId: null`), а не
 *      приписати їх до першої-ліпшої книги.
 *
 * Маршрут перевіряється по-справжньому — через HTTP, як його викликає
 * клієнт, а не через переказ логіки в тесті.
 */
const DIR = '/tmp/nova-media-sections-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const store = await import('../server/media/mediaLibraryStore');
const bookStore = await import('../server/bookStore');
const routes = await import('../server/mediaRoutes');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8, 9, 10]);

async function seed() {
  await bookStore.saveBook({ book: { id: 'book-A', title: 'Книга А' }, ownerId: 'u-1' });
  await bookStore.saveBook({ book: { id: 'book-B', title: 'Книга Б' }, ownerId: 'u-1' });

  await store.saveAsset({ ownerId: 'u-1', bookId: 'book-A', kind: 'upload', filename: 'a1.png', mimeType: 'image/png', bytes: PNG });
  await store.saveAsset({ ownerId: 'u-1', bookId: 'book-A', kind: 'illustration', filename: 'a2.png', mimeType: 'image/png', bytes: PNG });
  await store.saveAsset({ ownerId: 'u-1', bookId: 'book-B', kind: 'upload', filename: 'b1.jpg', mimeType: 'image/jpeg', bytes: JPG });
  await store.saveAsset({ ownerId: 'u-1', bookId: null, kind: 'upload', filename: 'free.png', mimeType: 'image/png', bytes: PNG });
  // Чужий файл із ТИМ САМИМ book_id — головна пастка цього маршруту.
  await store.saveAsset({ ownerId: 'u-2', bookId: 'book-A', kind: 'upload', filename: 'other.png', mimeType: 'image/png', bytes: PNG });
}

await seed();

let principal: any = { id: 'u-1', email: 'a@test.ua', name: 'Автор', role: 'writer', isGuest: false };
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req: any, _res, next) => { req.principal = principal; next(); });
routes.registerMediaRoutes(app);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;

const get = async (path: string) => {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

console.log('Розділи власника:');
{
  const { status, data } = await get('/api/media/sections');
  t('маршрут відповідає 200', status === 200, String(status));
  const sections = data?.sections ?? [];
  t('розділів три: дві книги + «без книги»', sections.length === 3, JSON.stringify(sections.map((s: any) => s.bookId)));

  const a = sections.find((s: any) => s.bookId === 'book-A');
  const b = sections.find((s: any) => s.bookId === 'book-B');
  const none = sections.find((s: any) => s.bookId === null);

  t('розділ книги А має 2 файли (чужого не рахує)', a?.count === 2, String(a?.count));
  t('розділ книги А підписано назвою книги', a?.title === 'Книга А', String(a?.title));
  t('байти розділу книги А — лише свої', a?.sizeBytes === PNG.length * 2, String(a?.sizeBytes));
  t('розділ книги Б має 1 файл', b?.count === 1, String(b?.count));
  t('розділ книги Б підписано', b?.title === 'Книга Б', String(b?.title));
  t('файли без книги — окрема група', none?.count === 1 && none?.title === null, JSON.stringify(none));
  t('загальні байти — сума своїх чотирьох файлів', data?.totalBytes === PNG.length * 3 + JPG.length, String(data?.totalBytes));
}

console.log('\nФільтр переліку за книгою:');
{
  const a = await get('/api/media/list?bookId=book-A');
  t('книга А → 2 файли', a.data?.assets?.length === 2, String(a.data?.assets?.length));
  const none = await get('/api/media/list');
  t('без фільтра → усі 4 свої', none.data?.assets?.length === 4, String(none.data?.assets?.length));
}

console.log('\nІзоляція авторів:');
{
  principal = { id: 'u-2', email: 'b@test.ua', name: 'Інший', role: 'writer', isGuest: false };
  const { data } = await get('/api/media/sections');
  const sections = data?.sections ?? [];
  t('інший автор бачить лише свій один розділ', sections.length === 1, JSON.stringify(sections));
  t('і в ньому один файл', sections[0]?.count === 1, String(sections[0]?.count));
  t('байти іншого автора — тільки його', data?.totalBytes === PNG.length, String(data?.totalBytes));
}

console.log('\nГість:');
{
  principal = { id: null, email: 'guest@local', name: 'Гість', role: 'guest', isGuest: true };
  const { status } = await get('/api/media/sections');
  t('гість отримує 401', status === 401, String(status));
}

server.close();

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
