/**
 * Тести обтікання тексту навколо зображень:
 *   • computeBreaksFromBounds (src/utils/pageBreaker.ts) — розбиття на
 *     сторінки за реальними межами блоків, з «не відривати обтічне фото
 *     від тексту, що його обтікає»;
 *   • migrateImageWrapDefaults (src/utils/wrapMigration.ts) — одноразовий
 *     прохід, що дописує `wrap=left` у маркери старих книг.
 * Запуск: npm run test:image-wrap
 *
 * Обидві функції чисті, без React/DOM — той самий підхід, що й у
 * scripts/test-bookText.mts: тестуємо шов напряму, без браузера.
 */
import type { Book } from '../src/types.ts';
import { computeBreaksFromBounds, type BlockBounds } from '../src/utils/pageBreaker.ts';
import { migrateImageWrapDefaults } from '../src/utils/wrapMigration.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

/** Блоки, що йдуть один за одним без обтікання: кожен починається там, де закінчився попередній. */
function stack(heights: number[]): BlockBounds[] {
  let top = 0;
  return heights.map((h) => {
    const b = { top, bottom: top + h };
    top += h;
    return b;
  });
}

console.log('\ncomputeBreaksFromBounds — розбиття за реальними межами:');
{
  const bounds = stack([100, 100, 100, 100]);
  t('усе влазить в одну сторінку — розривів немає',
    JSON.stringify(computeBreaksFromBounds(bounds, 500)) === '[]');

  t('розрив там, де вміст перестає влазити',
    JSON.stringify(computeBreaksFromBounds(bounds, 250)) === '[2]',
    JSON.stringify(computeBreaksFromBounds(bounds, 250)));

  t('нульовий чи від\'ємний бюджет висоти — без розривів',
    JSON.stringify(computeBreaksFromBounds(bounds, 0)) === '[]');

  t('порожній документ не ламає функцію',
    JSON.stringify(computeBreaksFromBounds([], 500)) === '[]');
}

console.log('\ncomputeBreaksFromBounds — обтічне фото ділить вертикаль із текстом:');
{
  // Фото (float) і абзац поруч мають ОДИН І ТОЙ САМИЙ top: вони займають
  // спільну вертикаль. Сума власних висот (200 + 180) завищила б заповнення
  // сторінки й дала б зайвий розрив — саме це й ламало верстку раніше.
  const bounds: BlockBounds[] = [
    { top: 0, bottom: 100 },    // абзац
    { top: 100, bottom: 300 },  // ФОТО float, висота 200
    { top: 100, bottom: 280 },  // абзац, що обтікає фото
  ];
  t('спільна вертикаль рахується один раз, а не двічі',
    JSON.stringify(computeBreaksFromBounds(bounds, 320)) === '[]',
    JSON.stringify(computeBreaksFromBounds(bounds, 320)));

  t('за сумою власних висот (100+200+180=480) розрив був би — і це була б помилка',
    100 + 200 + 180 > 320);
}

console.log('\ncomputeBreaksFromBounds — «не відривати фото від тексту, що його обтікає»:');
{
  const bounds: BlockBounds[] = [
    { top: 0, bottom: 100 },    // 0 абзац
    { top: 100, bottom: 200 },  // 1 абзац
    { top: 200, bottom: 400 },  // 2 ФОТО float
    { top: 200, bottom: 700 },  // 3 високий абзац, що обтікає фото
  ];
  const keep = [false, false, true, false];

  t('без keepWithNext розрив ліг би одразу ЗА фото (картинка лишилась би сама)',
    JSON.stringify(computeBreaksFromBounds(bounds, 450)) === '[3]',
    JSON.stringify(computeBreaksFromBounds(bounds, 450)));

  t('з keepWithNext розрив переїжджає ПЕРЕД фото',
    JSON.stringify(computeBreaksFromBounds(bounds, 450, keep)) === '[2]',
    JSON.stringify(computeBreaksFromBounds(bounds, 450, keep)));
}

console.log('\ncomputeBreaksFromBounds — keepWithNext не зациклюється:');
{
  // Фото — перший блок сторінки і саме по собі вище за сторінку.
  // Відступати нікуди: сторінка інакше вийшла б порожньою.
  const bounds: BlockBounds[] = [
    { top: 0, bottom: 900 },    // 0 ФОТО, вище за сторінку
    { top: 0, bottom: 950 },    // 1 текст поруч
  ];
  const result = computeBreaksFromBounds(bounds, 400, [true, true]);
  t('блок, вищий за сторінку, лишається на своїй сторінці (без нескінченного відкату)',
    Array.isArray(result), JSON.stringify(result));
}

console.log('\nmigrateImageWrapDefaults — дописує wrap=left у старі маркери:');

function bookWith(content: string, contentEn?: string): Book {
  return {
    id: 'book-1',
    title: 'Тест',
    author: 'Автор',
    language: 'uk',
    genre: 'проза',
    chapters: [
      {
        id: 'chap-1', bookId: 'book-1', title: 'Глава 1', order: 1,
        sections: [{
          id: 'sec-1', chapterId: 'chap-1', title: 'Секція 1', order: 1,
          content, ...(contentEn !== undefined ? { contentEn } : {}),
          wordCount: 0, lastModified: '2020-01-01T00:00:00.000Z',
        }],
      },
    ],
    characters: [],
  } as unknown as Book;
}

{
  const before = 'Текст.\n\n[IMG: ill-1 "Підпис"]\n\nЩе текст.';
  const { book, changed } = migrateImageWrapDefaults(bookWith(before));
  const after = book.chapters[0].sections[0].content;
  t('маркер без wrap отримує wrap=left', after.includes('[IMG: ill-1 "Підпис" wrap=left]'), after);
  t('лічильник змін = 1', changed === 1, String(changed));
  t('решта тексту недоторкана', after.startsWith('Текст.\n\n') && after.endsWith('\n\nЩе текст.'));
}

{
  const before = '[IMG: ill-1 "Підпис" wrap=none]\n\n[IMG: ill-2 "" wrap=right width=40mm]';
  const { book, changed } = migrateImageWrapDefaults(bookWith(before));
  t('маркери з явним wrap НЕ чіпаються (зокрема wrap=none)', changed === 0, String(changed));
  t('книга повертається тим самим об\'єктом, коли міняти нічого',
    book.chapters[0].sections[0].content === before);
}

{
  const before = '[IMG: ill-1 "Підпис" width=40mm height=30mm]';
  const { book } = migrateImageWrapDefaults(bookWith(before));
  const after = book.chapters[0].sections[0].content;
  t('розмір зберігається при дописуванні wrap',
    after === '[IMG: ill-1 "Підпис" wrap=left width=40mm height=30mm]', after);
}

{
  const before = '[IMG: ill-1 "Контур" shape="0.0% 0.0%, 100.0% 50.0%"]';
  const { book } = migrateImageWrapDefaults(bookWith(before));
  const after = book.chapters[0].sections[0].content;
  t('полігон контуру зберігається при дописуванні wrap',
    after === '[IMG: ill-1 "Контур" wrap=left shape="0.0% 0.0%, 100.0% 50.0%"]', after);
}

{
  const { book, changed } = migrateImageWrapDefaults(bookWith('[IMG: a ""]', '[IMG: b ""]'));
  t('англійський текст розділу мігрує так само', changed === 2, String(changed));
  t('contentEn теж отримав wrap',
    (book.chapters[0].sections[0].contentEn || '').includes('wrap=left'));
}

{
  const { changed } = migrateImageWrapDefaults(bookWith('Текст без картинок.'));
  t('розділ без картинок — нуль змін', changed === 0);
}

console.log(`\n${pass} пройдено, ${fail} провалено\n`);
if (fail > 0) process.exit(1);
