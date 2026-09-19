/**
 * Тести порядку сортування медіатеки (`src/utils/mediaSort.ts`).
 * Запуск: npm run test:media-sort
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Дата появи файлу — не прикраса: за нею автор
 * вибудовує серію кадрів, і помилка тут не видна оком, бо перелік і без
 * неї виглядає «якось відсортованим». Тому перевіряємо не «сортує чи ні»,
 * а три речі, які легко зламати:
 *   1. час беруть із РОЗБОРУ дати, а не з порівняння рядків — інакше
 *      рядок із зсувом часу (`+05:00`) стане в невірне місце;
 *   2. файли без дати (посилання, вбудовані просто в книгу) стоять у
 *      кінці в ОБОХ напрямках — «невідомо коли» не має вдавати давнє;
 *   3. рівні між собою картки не переставляються самі: перелік не має
 *      «стрибати» між відкриттями.
 *
 * Сервер тут не потрібен — це чиста функція над картками.
 */
import {
  DEFAULT_MEDIA_SORT,
  MEDIA_SORT_METHODS,
  formatMediaDate,
  mediaComparator,
  mediaCreatedTime,
  mediaSortIsChronological,
  type MediaSortMethod,
  type SortableMedia,
} from '../src/utils/mediaSort.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

/** Порядок id після сортування обраним способом. */
const order = (items: SortableMedia[], method: MediaSortMethod): string[] =>
  [...items].sort(mediaComparator(method)).map((i) => i.title || '?');

console.log('\nЧас із дати:');
{
  t('ISO-рядок розбирається в мілісекунди', mediaCreatedTime('2026-09-12T10:00:00.000Z') === Date.parse('2026-09-12T10:00:00.000Z'));
  t('порожнє значення → немає дати', mediaCreatedTime(undefined) === null && mediaCreatedTime(null) === null && mediaCreatedTime('') === null);
  t('сміття → немає дати, а не NaN', mediaCreatedTime('не-дата') === null);
}

console.log('\nПорядок генерації:');
{
  const items: SortableMedia[] = [
    { title: 'третя', createdAt: '2026-09-12T12:00:00.000Z' },
    { title: 'перша', createdAt: '2026-09-12T10:00:00.000Z' },
    { title: 'друга', createdAt: '2026-09-12T11:00:00.000Z' },
  ];
  t('від першої до останньої', order(items, 'generationAsc').join(',') === 'перша,друга,третя', order(items, 'generationAsc').join(','));
  t('від останньої до першої', order(items, 'generationDesc').join(',') === 'третя,друга,перша', order(items, 'generationDesc').join(','));
  t('типовий спосіб — саме хронологічний', DEFAULT_MEDIA_SORT === 'generationAsc');
}

console.log('\nДата — це розбір, а не порівняння рядків:');
{
  // «+05:00» — це 19:00 попереднього дня за UTC. Порівняння рядків
  // поставило б його ПІСЛЯ файлу з `2026-01-01T23:00:00Z`, хоча насправді
  // він зʼявився раніше.
  const items: SortableMedia[] = [
    { title: 'Z-файл', createdAt: '2026-01-01T23:00:00.000Z' },
    { title: 'зсув', createdAt: '2026-01-02T00:00:00.000+05:00' },
  ];
  t('зсув часу враховано', order(items, 'generationAsc').join(',') === 'зсув,Z-файл', order(items, 'generationAsc').join(','));
}

console.log('\nФайли без дати:');
{
  const items: SortableMedia[] = [
    { title: 'без дати А' },
    { title: 'з датою пізніша', createdAt: '2026-09-12T12:00:00.000Z' },
    { title: 'без дати Б' },
    { title: 'з датою рання', createdAt: '2026-09-12T10:00:00.000Z' },
  ];
  t('у напрямку «від першої» — у кінці', order(items, 'generationAsc').join(',') === 'з датою рання,з датою пізніша,без дати А,без дати Б', order(items, 'generationAsc').join(','));
  t('у напрямку «від останньої» — теж у кінці, і в тому ж порядку', order(items, 'generationDesc').join(',') === 'з датою пізніша,з датою рання,без дати А,без дати Б', order(items, 'generationDesc').join(','));
  t('хибна дата не «виграє» місце серед справжніх', order([{ title: 'x', createdAt: 'мур' }, { title: 'y', createdAt: '2026-09-12T10:00:00.000Z' }], 'generationAsc').join(',') === 'y,x');
}

console.log('\nРівні дати не переставляються:');
{
  const same = '2026-09-12T10:00:00.000Z';
  const items: SortableMedia[] = [
    { title: 'перший у джерелі', createdAt: same },
    { title: 'другий у джерелі', createdAt: same },
    { title: 'третій у джерелі', createdAt: same },
  ];
  t('порядок джерела збережено (стабільність)', order(items, 'generationAsc').join(',') === order(items, 'generationDesc').join(','));
}

console.log('\nІнші способи:');
{
  const mixed: SortableMedia[] = [
    { title: 'webp-файл', url: 'https://cdn/x.webp', createdAt: '2026-09-12T10:00:00.000Z' },
    { title: 'png-файл', url: 'https://cdn/x.png', createdAt: '2026-09-12T11:00:00.000Z' },
    { title: 'jpg-файл', url: 'https://cdn/x.jpg', createdAt: '2026-09-12T12:00:00.000Z' },
    { title: 'відео', url: '/api/media/file?id=abc', createdAt: '2026-09-12T13:00:00.000Z' },
  ];
  t('за форматом: JPG → PNG → WEBP → решта', order(mixed, 'format').join(',') === 'jpg-файл,png-файл,webp-файл,відео', order(mixed, 'format').join(','));

  const named: SortableMedia[] = [{ title: 'Явір' }, { title: 'Барвінок' }, { title: 'абетка' }];
  t('за назвою — українська абетка, регістр не заважає', order(named, 'title').join(',') === 'абетка,Барвінок,Явір', order(named, 'title').join(','));

  const sized: SortableMedia[] = [
    { title: 'малий', sizeBytes: 10 },
    { title: 'посилання з книги' },
    { title: 'великий', sizeBytes: 5000 },
  ];
  t('за розміром: найважчі спершу', order(sized, 'size').join(',') === 'великий,малий,посилання з книги', order(sized, 'size').join(','));
}

console.log('\nВідео та фото в одному переліку:');
{
  // Те, заради чого все й робилося: усі відео — MP4, тож «за форматом»
  // їх не розрізнити за розширенням і вони шикуються за назвою. Назви ж
  // не мусять збігатися з порядком появи — саме тому автор і просив
  // хронологію окремим способом.
  const videos: SortableMedia[] = [
    { title: 'clip-1.mp4', url: '/api/media/file?id=a', createdAt: '2026-09-12T12:30:00.000Z' },
    { title: 'clip-2.mp4', url: '/api/media/file?id=b', createdAt: '2026-09-12T12:20:00.000Z' },
    { title: 'clip-3.mp4', url: '/api/media/file?id=c', createdAt: '2026-09-12T12:10:00.000Z' },
  ];
  t('за часом генерації — від першого кадру', order(videos, 'generationAsc').join(',') === 'clip-3.mp4,clip-2.mp4,clip-1.mp4', order(videos, 'generationAsc').join(','));
  t('за часом, від останнього кадру', order(videos, 'generationDesc').join(',') === 'clip-1.mp4,clip-2.mp4,clip-3.mp4', order(videos, 'generationDesc').join(','));
  t('а «за форматом» вони рівні — порядок вирішує назва, і він інший', order(videos, 'format').join(',') === 'clip-1.mp4,clip-2.mp4,clip-3.mp4', order(videos, 'format').join(','));
  t('хронологічними вважаються лише два способи', mediaSortIsChronological('generationAsc') && mediaSortIsChronological('generationDesc') && !mediaSortIsChronological('format') && !mediaSortIsChronological('title') && !mediaSortIsChronological('size'));
}

console.log('\nСписок способів і підписи:');
{
  t('способів пʼять', MEDIA_SORT_METHODS.length === 5, String(MEDIA_SORT_METHODS.length));
  t('серед них є типовий', MEDIA_SORT_METHODS.includes(DEFAULT_MEDIA_SORT));
  t('без повторів', new Set(MEDIA_SORT_METHODS).size === MEDIA_SORT_METHODS.length);
  t('невідомий спосіб не ламає сортування', order([{ title: 'б', createdAt: '2026-01-02T00:00:00.000Z' }, { title: 'а', createdAt: '2026-01-01T00:00:00.000Z' }], 'вигадка' as MediaSortMethod).join(',') === 'а,б');
}

console.log('\nПідпис дати на картці:');
{
  const iso = new Date(2026, 8, 12, 14, 32).toISOString(); // локальний час → ISO
  t('день і місяць двоцифрові', formatMediaDate(iso) === '12.09.2026 14:32', formatMediaDate(iso));
  t('хвилини з провідним нулем', formatMediaDate(new Date(2026, 0, 5, 9, 7).toISOString()) === '05.01.2026 09:07', formatMediaDate(new Date(2026, 0, 5, 9, 7).toISOString()));
  t('без дати підпису немає', formatMediaDate(undefined) === '' && formatMediaDate('ні') === '');
}

console.log('\nКомпаратор не мутує вхідні дані:');
{
  const items: SortableMedia[] = [{ title: 'б', createdAt: '2026-01-02T00:00:00.000Z' }, { title: 'а', createdAt: '2026-01-01T00:00:00.000Z' }];
  const cmp = mediaComparator('generationAsc');
  cmp(items[0], items[1]);
  t('обʼєкти картки не змінюються', items[0].title === 'б' && items[1].title === 'а');
  t('сам масив не сортується викликом компаратора', items.map((i) => i.title).join(',') === 'б,а');
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
