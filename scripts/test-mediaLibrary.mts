/**
 * Тести медіатеки на сервері (задача #100). Запуск: npm run test:media-library
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Сховище зʼявилось не заради зручності: завантажені
 * файли жили як base64 всередині книги (кожне збереження — мегабайти по
 * мережі), згенеровані ШІ — у теці поруч із кодом, яка на хостингу зникає
 * при деплої. Отже перевіряти треба саме те, що робить нове сховище
 * надійнішим за старе:
 *
 *  1. ЧУЖЕ НЕ ВИДНО і чуже НЕ ВИДАЛЯЄТЬСЯ. Це головне: id у посиланні, і
 *     без перевірки власника медіатека стала б спільною.
 *  2. Промпт і модель зберігаються — інакше вдале зображення неможливо
 *     повторити, і воно перетворюється на випадкову картинку.
 *  3. «../» в id користувача не виводить запис за межі DATA_DIR.
 *  4. Непідтримуваний тип відхиляється ДО запису на диск.
 *  5. Обидва бекенди (JSON і SQLite) дають той самий результат.
 */
const DIR = '/tmp/nova-media-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/media/mediaLibraryStore');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function runSuite(label: string) {
  console.log(`\nБекенд ${label}`);

  const uploaded = await store.saveAsset({
    ownerId: 'user-1',
    bookId: 'book-1',
    kind: 'upload',
    filename: 'Обкладинка ескіз.png',
    mimeType: 'image/png',
    bytes: PNG,
  });

  t('URL у книгу — короткий, а не base64', uploaded.url === `/api/media/file/${uploaded.id}`, uploaded.url);
  t('розмір порахований із самих байтів', uploaded.sizeBytes === PNG.length, String(uploaded.sizeBytes));
  t('імʼя автора збережено як є', uploaded.filename === 'Обкладинка ескіз.png', uploaded.filename);
  t('завантаженому файлу промпт не вигадується', uploaded.prompt === null && uploaded.model === null);

  const generated = await store.saveAsset({
    ownerId: 'user-1',
    bookId: 'book-1',
    kind: 'illustration',
    filename: 'scene.png',
    mimeType: 'image/png',
    bytes: PNG,
    prompt: 'нічний Київ у дощ, неон',
    model: 'gemini-3-pro-image',
  });
  t('промпт згенерованого збережено', generated.prompt === 'нічний Київ у дощ, неон', String(generated.prompt));
  t('модель згенерованого збережена', generated.model === 'gemini-3-pro-image', String(generated.model));
  t('вид не втрачено', generated.kind === 'illustration', generated.kind);

  // 1. Чуже.
  const foreign = await store.saveAsset({
    ownerId: 'user-2', kind: 'upload', filename: 'x.png', mimeType: 'image/png', bytes: PNG,
  });
  const mine = await store.listAssets('user-1');
  t('у переліку лише свої', mine.length === 2 && mine.every((a) => a.ownerId === 'user-1'), String(mine.length));
  t('чужий файл не потрапив у мій перелік', !mine.some((a) => a.id === foreign.id));
  t('чуже не видаляється', (await store.deleteAsset(foreign.id, 'user-1')) === false);
  t('чужий файл після спроби видалення на місці', (await store.getAsset(foreign.id)) !== null);

  // Фільтр за книгою.
  const other = await store.saveAsset({
    ownerId: 'user-1', bookId: 'book-2', kind: 'upload', filename: 'y.png', mimeType: 'image/png', bytes: PNG,
  });
  t('фільтр за книгою працює', (await store.listAssets('user-1', { bookId: 'book-2' })).length === 1);
  t('без фільтра — уся медіатека', (await store.listAssets('user-1')).length === 3);

  // Читання байтів.
  const read = await store.readAsset(uploaded.id);
  t('байти повертаються без змін', !!read && Buffer.from(read.bytes).equals(Buffer.from(PNG)));
  t('неіснуючий id → null', (await store.readAsset('md-нема')) === null);

  // Опис є, файл зник — не помилка коду, а «диск очистили».
  fs.rmSync(store.assetPath(other));
  t('опис без файлу → null, а не виняток', (await store.readAsset(other.id)) === null);

  // Видалення свого.
  t('своє видаляється', (await store.deleteAsset(uploaded.id, 'user-1')) === true);
  t('після видалення опису немає', (await store.getAsset(uploaded.id)) === null);
  t('після видалення файлу на диску немає', !fs.existsSync(store.assetPath(uploaded)));
  t('повторне видалення → false', (await store.deleteAsset(uploaded.id, 'user-1')) === false);

  // 4. Тип.
  let rejected = false;
  try {
    await store.saveAsset({
      ownerId: 'user-1', kind: 'upload', filename: 'x.exe',
      mimeType: 'application/x-msdownload', bytes: PNG,
    });
  } catch {
    rejected = true;
  }
  t('непідтримуваний тип відхилено', rejected);

  let empty = false;
  try {
    await store.saveAsset({
      ownerId: 'user-1', kind: 'upload', filename: 'x.png', mimeType: 'image/png', bytes: new Uint8Array(0),
    });
  } catch {
    empty = true;
  }
  t('порожній файл відхилено', empty);

  let noOwner = false;
  try {
    await store.saveAsset({
      ownerId: '', kind: 'upload', filename: 'x.png', mimeType: 'image/png', bytes: PNG,
    });
  } catch {
    noOwner = true;
  }
  t('файл без власника відхилено', noOwner);

  // Сума байтів — для звірки з лічильником тарифу.
  const total = await store.totalBytesForOwner('user-1');
  t('сума байтів рахується по своїх', total === PNG.length * 2, String(total));
}

console.log('SQLite ще не піднято:');
t('бекенд поки JSON', !db.isAvailable());
await runSuite('JSON');

console.log('\nПерехід на SQLite:');
await db.initDb();
t('бекенд = sqlite', db.isAvailable());
store.__resetMediaCacheForTests();
fs.rmSync(`${DIR}/media`, { recursive: true, force: true });
await runSuite('SQLite');

console.log('\nРозпізнавання власного URL');
{
  t('свій URL → id', store.assetIdFromUrl('/api/media/file/md-abc123') === 'md-abc123');
  t('чужий формат → null', store.assetIdFromUrl('/generated/scene-1.png') === null);
  t('data: → null', store.assetIdFromUrl('data:image/png;base64,AAA') === null);
  t('http → null', store.assetIdFromUrl('https://example.com/a.png') === null);
  t('порожнє → null', store.assetIdFromUrl('') === null);
  // Обхід через «..» у сегменті id має відпасти на перевірці символів.
  t('«..» в id → null', store.assetIdFromUrl('/api/media/file/../../etc/passwd') === null);
  t('query відкидається', store.assetIdFromUrl('/api/media/file/md-abc?v=2') === 'md-abc');
}

console.log('\nЗахист шляху');
{
  const evil = await store.saveAsset({
    ownerId: '../../evil', kind: 'upload', filename: 'x.png', mimeType: 'image/png', bytes: PNG,
  });
  t('id власника з «../» не виводить запис за межі медіатеки',
    !fs.existsSync('/tmp/evil') && !fs.existsSync(`${DIR}/../evil`));
  t('файл лежить усередині media/', store.assetPath(evil).startsWith(`${DIR}/media/`), store.assetPath(evil));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
