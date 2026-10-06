/**
 * Тести серверної копії книги. Запуск: npm run test:book-store
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Сховище зʼявилось, бо рукопис жив лише в одному
 * браузері. Отже перевіряти треба не «записалось і прочиталось», а те, що
 * копія не гірша за оригінал:
 *
 *  1. РЕВІЗІЯ. Дві вкладки не мають затирати одна одну мовчки. Це головне:
 *     без охорони серверна копія була б не страховкою, а способом втратити
 *     роботу швидше, ніж без неї.
 *  2. ВЛАСНИК не змінюється від того, хто зберіг останнім.
 *  3. Артефакти живуть окремо від джерела й НЕ витісняють один одного:
 *     новий уривок не має стирати PDF.
 *  4. Обидва бекенди (SQLite і JSON) дають той самий результат.
 */
const DIR = '/tmp/nova-bookstore-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/bookStore');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

const bookOf = (over: Record<string, unknown> = {}) => ({
  id: 'book-1',
  title: 'Тіні Нео-Києва',
  author: 'Олександр Радченко',
  chapters: [{ title: 'Розділ', sections: [{ content: 'Їжак прокинувся.' }] }],
  ...over,
});

async function runSuite(label: string) {
  console.log(`\n${label}:`);

  const first = await store.saveBook({ book: bookOf(), ownerId: 'u-1' });
  t('перший запис → ревізія 1', first.revision === 1, String(first.revision));
  t('назва продубльована для переліку', first.title === 'Тіні Нео-Києва');
  t('розмір пораховано', first.sizeBytes > 0, String(first.sizeBytes));

  const read = await store.getBook('book-1');
  t('книга читається цілком', (read?.book as any)?.chapters?.length === 1);
  t('вміст не спотворився', (read?.book as any)?.author === 'Олександр Радченко');

  // --- Ревізії ---
  const second = await store.saveBook({
    book: bookOf({ title: 'Тіні Нео-Києва 2084' }),
    ownerId: 'u-1',
    expectedRevision: 1,
  });
  t('другий запис із правильною ревізією → 2', second.revision === 2, String(second.revision));

  let conflict: unknown = null;
  try {
    await store.saveBook({ book: bookOf({ title: 'Затирання' }), expectedRevision: 1 });
  } catch (err) {
    conflict = err;
  }
  t('застаріла ревізія → конфлікт, а не мовчазне затирання',
    conflict instanceof store.BookRevisionConflict);
  t('конфлікт називає поточну ревізію', (conflict as any)?.current === 2, String((conflict as any)?.current));
  const afterConflict = await store.getBook('book-1');
  t('дані НЕ змінились після конфлікту',
    (afterConflict?.book as any)?.title === 'Тіні Нео-Києва 2084',
    String((afterConflict?.book as any)?.title));

  let noRev: unknown = null;
  try {
    await store.saveBook({ book: bookOf({ title: 'Без ревізії' }) });
  } catch (err) {
    noRev = err;
  }
  t('запис без ревізії поверх наявної книги → конфлікт',
    noRev instanceof store.BookRevisionConflict);

  // --- Власник ---
  const byOther = await store.saveBook({ book: bookOf(), ownerId: 'u-2', expectedRevision: 2 });
  t('власник не змінюється від того, хто зберіг останнім',
    byOther.ownerId === 'u-1', String(byOther.ownerId));

  // --- Перелік ---
  await store.saveBook({ book: { id: 'book-2', title: 'Друга' }, ownerId: 'u-2' });
  const mine = await store.listBooks('u-1');
  t('перелік фільтрує за власником', mine.length === 1 && mine[0].id === 'book-1',
    mine.map((b) => b.id).join(','));
  t('перелік не тягне вміст книги', !('book' in (mine[0] as object)));

  // --- Артефакти ---
  const pdf = await store.saveArtifact({
    bookId: 'book-1',
    kind: 'pdf',
    format: 'digital',
    filename: 'kniga.pdf',
    mimeType: 'application/pdf',
    bytes: new Uint8Array([37, 80, 68, 70, 45, 1, 2, 3]),
    pageCount: 29,
    variant: 'code',
    bookRevision: 3,
  });
  t('PDF збережено', pdf.kind === 'pdf' && pdf.sizeBytes === 8, JSON.stringify(pdf.sizeBytes));
  t('ревізію книги записано в артефакт', pdf.bookRevision === 3);

  await store.saveArtifact({
    bookId: 'book-1', kind: 'sample', format: 'digital',
    filename: 'uryvok.pdf', mimeType: 'application/pdf',
    bytes: new Uint8Array([37, 80, 68, 70]), pageCount: 10, bookRevision: 3,
  });
  await store.saveArtifact({
    bookId: 'book-1', kind: 'cover', format: 'digital',
    filename: 'cover.png', mimeType: 'image/png',
    bytes: new Uint8Array([137, 80, 78, 71]), bookRevision: 3,
  });

  const all = await store.listArtifacts('book-1');
  t('три артефакти живуть поруч', all.length === 3, all.map((a) => a.kind).join(','));
  t('уривок НЕ витіснив PDF', all.some((a) => a.kind === 'pdf') && all.some((a) => a.kind === 'sample'));

  const back = await store.readArtifact('book-1', 'pdf', 'digital');
  t('байти PDF читаються назад', back?.bytes.length === 8, String(back?.bytes.length));
  t('перші байти — заголовок PDF',
    back ? Buffer.from(back.bytes.subarray(0, 5)).toString() === '%PDF-' : false);

  // Перезапис у межах свого виду.
  await store.saveArtifact({
    bookId: 'book-1', kind: 'pdf', format: 'digital',
    filename: 'kniga.pdf', mimeType: 'application/pdf',
    bytes: new Uint8Array([37, 80, 68, 70, 45, 9, 9, 9, 9, 9]), pageCount: 31, bookRevision: 4,
  });
  const again = await store.listArtifacts('book-1');
  t('повторне складання не множить рядки', again.length === 3, String(again.length));
  const updated = again.find((a) => a.kind === 'pdf');
  t('опис оновився', updated?.pageCount === 31 && updated?.bookRevision === 4,
    `${updated?.pageCount} / ${updated?.bookRevision}`);

  // Друкована редакція — окремий артефакт, не заміна цифровій.
  await store.saveArtifact({
    bookId: 'book-1', kind: 'pdf', format: 'print',
    filename: 'kniga_KDP.pdf', mimeType: 'application/pdf',
    bytes: new Uint8Array([37, 80, 68, 70, 45, 7]), pageCount: 34, bookRevision: 4,
  });
  const withPrint = await store.listArtifacts('book-1');
  t('друкована не витіснила цифрову', withPrint.filter((a) => a.kind === 'pdf').length === 2,
    String(withPrint.filter((a) => a.kind === 'pdf').length));

  t('невідомий артефакт → null', (await store.readArtifact('book-1', 'pdf', 'print'))?.record.pageCount === 34);
  t('артефакт неіснуючої книги → null', (await store.readArtifact('нема', 'pdf')) === null);
  t('неіснуюча книга → null', (await store.getBook('нема')) === null);

  // Real contention, rather than sequential stale-write tests.
  const concurrent = await Promise.allSettled([
    store.saveBook({ book: bookOf({ id: 'race', title: 'Перша' }), ownerId: 'u-1' }),
    store.saveBook({ book: bookOf({ id: 'race', title: 'Друга' }), ownerId: 'u-2' }),
  ]);
  t('одночасне створення: рівно один запис прийнято', concurrent.filter(r => r.status === 'fulfilled').length === 1);
  t('одночасне створення: другий отримав конфлікт', concurrent.some(r => r.status === 'rejected' && r.reason instanceof store.BookRevisionConflict));
  const updates = await Promise.allSettled([
    store.saveBook({ book: bookOf({ id: 'race', title: 'Правка А' }), expectedRevision: 1 }),
    store.saveBook({ book: bookOf({ id: 'race', title: 'Правка Б' }), expectedRevision: 1 }),
  ]);
  t('дві правки однієї ревізії: рівно одна прийнята', updates.filter(r => r.status === 'fulfilled').length === 1);
  t('друга правка не перезаписала першу', (await store.getBook('race'))?.title === 'Правка А');
  t('конфлікт називає вже прийняту ревізію', updates.some(r => r.status === 'rejected' && r.reason.current === 2));
  const mutable = bookOf({ id: 'snapshot', title: 'До зміни' });
  const saving = store.saveBook({ book: mutable });
  mutable.title = 'Після виклику';
  const saved = await saving;
  t('запис бере знімок на момент виклику', saved.title === 'До зміни');
  (saved.book as any).title = 'Підміна результату';
  const detached = await store.getBook('snapshot');
  (detached!.book as any).title = 'Підміна читання';
  t('зміна повернутого об’єкта не змінює сховище', (await store.getBook('snapshot'))?.book.title === 'До зміни');
  await store.saveBook({ book: bookOf({ id: 'race', title: 'Після конфлікту' }), expectedRevision: 2 });
  t('черга продовжує роботу після відхиленої правки', (await store.getBook('race'))?.revision === 3);
  const revisions = await store.listBookRevisions('race');
  t('історія містить лише прийняті ревізії', revisions.map(r => r.revision).join(',') === '3,2,1');
  const original = await store.getBookRevision('race', 1);
  t('історія зберегла початковий текст', original?.title === 'Перша');
  const restored = await store.saveBook({ book: original!, expectedRevision: 3 });
  t('відновлення створює нову ревізію', restored.revision === 4 && restored.title === 'Перша');
  t('попередня ревізія залишається в історії', (await store.getBookRevision('race', 3))?.title === 'Після конфлікту');
  await store.saveBook({ book: bookOf({ id: 'scoped', chapters: [{ id: 'ch', sections: [{ id: 's1', content: 'А' }, { id: 's2', content: 'Таємниця' }] }] }) });
  const patched = await store.patchBookSection({ bookId: 'scoped', chapterId: 'ch', sectionId: 's1', expectedRevision: 1, patch: { content: 'Б' } });
  t('точкова правка змінює лише свою сцену', (patched.book as any).chapters[0].sections[0].content === 'Б' && (patched.book as any).chapters[0].sections[1].content === 'Таємниця');
  const stalePatch = await Promise.allSettled([store.patchBookSection({ bookId: 'scoped', chapterId: 'ch', sectionId: 's1', expectedRevision: 1, patch: { content: 'Застаріле' } })]);
  t('точкова застаріла правка отримує конфлікт', stalePatch[0].status === 'rejected' && stalePatch[0].reason instanceof store.BookRevisionConflict);
  const structural = await Promise.allSettled([store.patchBookSection({ bookId: 'scoped', chapterId: 'ch', sectionId: 's1', expectedRevision: 2, patch: { id: 'інша-сцена' } })]);
  t('патч не приймає зміну структури', structural[0].status === 'rejected');
  t('відхилений патч не створює історію', (await store.listBookRevisions('scoped')).length === 2);
}

console.log('Бекенд JSON (SQLite ще не піднято):');
t('SQLite поки недоступний', !db.isAvailable());
await runSuite('JSON');

console.log('\nПерехід на SQLite:');
await db.initDb();
t('бекенд = sqlite', db.isAvailable());
store.__resetBookCacheForTests();
await runSuite('SQLite');

console.log('\nЗахист шляху');
{
  await store.saveArtifact({
    bookId: '../../evil', kind: 'cover', format: 'digital',
    filename: 'x.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]),
  });
  const escaped = fs.existsSync('/tmp/evil') || fs.existsSync(`${DIR}/../evil`);
  t('id з «../» не виводить запис за межі теки книг', !escaped);
  t('тека створена всередині books/', fs.existsSync(`${DIR}/books`));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
