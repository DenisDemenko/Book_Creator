process.env.DATA_DIR ||= '/tmp/nova-designcraft-gateb';

import { PDFDocument } from 'pdf-lib';

let pass = 0;
let fail = 0;
function t(name: string, condition: boolean, details = ''): void {
  if (condition) pass += 1;
  else fail += 1;
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${details ? ` — ${details}` : ''}`);
}

const { designcraftEngineV3: designcraftEngine } = await import('../server/pdf/engines/designcraftEngineV3');
const { listPdfEngines } = await import('../server/pdf/engines/registry');

const PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zk5sAAAAASUVORK5CYII=';

const baseBook: any = {
  id: 'GATE-B-UK-ARHAT-TEST',
  title: 'Самовчитель для Архата або Шлях Додому — ТЕСТ',
  subtitle: 'Перевірка конвеєра Fusion Lab Studio',
  author: 'Fusion Lab Studio',
  chapters: [
    {
      id: 'c1',
      order: 1,
      title: 'Вступ',
      sections: [
        {
          id: 's1',
          order: 1,
          title: 'Початок шляху',
          content:
            '<p>Це український тестовий текст книги. Він перевіряє кирилицю, автоматичне перетікання та зміст.</p>' +
            '\n\n[IMG: img-1 "Тестова ілюстрація" wrap=center]\n\n' +
            '<p>Після ілюстрації текст має продовжитися без втрат і прихованого overset.</p>',
        },
      ],
    },
    {
      id: 'c2',
      order: 2,
      title: 'Практика',
      sections: [
        {
          id: 's2',
          order: 1,
          title: 'Спостереження',
          content: '<p>Другий розділ потрібен для перевірки змісту та переходу між главами.</p>',
        },
      ],
    },
  ],
  illustrations: [
    { id: 'img-1', chapterId: 'c1', url: PNG, caption: 'Тестова ілюстрація' },
  ],
};

const spec: any = {
  pageSize: 'A5',
  bodyAlign: 'justify',
  runningHead: { show: true, content: 'chapter', fontSize: 8 },
  pageNumber: { show: true, position: 'bottom-center', fontSize: 9, startAt: 1, skipFrontMatter: true },
  frontMatter: { contentsTitle: 'Зміст', contentsSections: true, contentsLeader: true, fontSize: 10, upperShare: 0.28 },
};

console.log('\nDesignCraft availability');
const availability = await designcraftEngine.available();
t('CLI доступний', availability.ok, availability.reasonUk || '');
if (!availability.ok) {
  console.error('\nGate B requires a real DesignCraft CLI.');
  process.exit(1);
}

console.log('\nУкраїнська книга + зображення + зміст');
const first = await designcraftEngine.render({ book: baseBook, kind: 'book', spec, print: false });
t('рушій повернув designcraft', first.engineId === 'designcraft');
t('PDF має щонайменше титул, зміст і 2 глави', first.pageCount >= 4, String(first.pageCount));
t('внутрішня перевірка бачить 1 ілюстрацію', first.notesUk.some((n) => n.includes('1 ілюстрацій')), first.notesUk.join(' | '));
t('макет позначено як виконаний', first.honoredSpec === true, first.notesUk.join(' | '));
const firstPdf = await PDFDocument.load(first.bytes);
t('pdf-lib відкриває результат', firstPdf.getPageCount() === first.pageCount);

console.log('\nДинамічне перетікання');
const longParagraph =
  'Архат уважно спостерігає думку, почуття і вчинок, зберігаючи ясність, відповідальність і доброзичливість. ';
const longBook = structuredClone(baseBook);
longBook.illustrations = [];
longBook.chapters[0].sections[0].content = Array.from({ length: 420 }, (_, i) =>
  `<p>${i + 1}. ${longParagraph.repeat(3)}</p>`
).join('');
const long = await designcraftEngine.render({ book: longBook, kind: 'book', spec, print: false });
t('довший рукопис створює більше сторінок', long.pageCount > first.pageCount, `${first.pageCount} → ${long.pageCount}`);
t('довга книга пройшла без overset', long.notesUk.some((n) => n.includes('без overset')), long.notesUk.join(' | '));
t('reflow не створює тисячі порожніх сторінок', long.pageCount < 300, String(long.pageCount));

console.log('\nІзоляція job та повторюваність');
const [repeatA, repeatB] = await Promise.all([
  designcraftEngine.render({ book: baseBook, kind: 'book', spec, print: false }),
  designcraftEngine.render({ book: baseBook, kind: 'book', spec, print: false }),
]);
t('два паралельні job завершилися', repeatA.bytes.length > 1000 && repeatB.bytes.length > 1000);
t('паралельні job мають однакову кількість сторінок', repeatA.pageCount === repeatB.pageCount, `${repeatA.pageCount}/${repeatB.pageCount}`);

console.log('\nРеєстр Studio');
const engines = await listPdfEngines({});
const listed = engines.find((e) => e.id === 'designcraft');
t('DesignCraft є у переліку рушіїв', !!listed);
t('DesignCraft у переліку доступний', listed?.available === true, listed?.reasonUk || '');
t('DesignCraft заявляє KDP print support', listed?.supportsPrint === true);

console.log(`\nDesignCraft Gate B: ${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);
