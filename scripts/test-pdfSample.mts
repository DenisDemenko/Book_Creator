/**
 * Тести безкоштовного уривка (server/pdf/pdfSample.ts).
 * Запуск: npm run test:pdf-sample
 *
 * Уривок ріжеться з ГОТОВОГО PDF, тому й перевіряється на справжньому файлі,
 * зверстаному тим самим рушієм, що йде покупцеві, — а не на вигаданих
 * байтах. Головне, що тут ловиться:
 *
 *  1. в уривку рівно стільки сторінок, скільки просили, і це перші сторінки;
 *  2. книга, не довша за уривок, уривка НЕ отримує — інакше «уривок» був би
 *     повним текстом безкоштовно;
 *  3. вихід — валідний самостійний PDF, який відкриється в покупця.
 */
import { PDFDocument } from 'pdf-lib';
import { renderBookPdf } from '../server/pdf/pdfRenderer';
import {
  clampSamplePages,
  extractSamplePages,
  SAMPLE_MAX_PAGES,
  SAMPLE_MIN_PAGES,
} from '../server/pdf/pdfSample';

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

console.log('Затискання кількості сторінок');
{
  t(`нижче межі → ${SAMPLE_MIN_PAGES}`, clampSamplePages(1) === SAMPLE_MIN_PAGES, String(clampSamplePages(1)));
  t(`вище межі → ${SAMPLE_MAX_PAGES}`, clampSamplePages(500) === SAMPLE_MAX_PAGES, String(clampSamplePages(500)));
  t('усередині — як просили', clampSamplePages(7) === 7);
  t('дробове округлюється', clampSamplePages(7.6) === 8, String(clampSamplePages(7.6)));
  t('сміття → усталене', clampSamplePages('багато') === 10, String(clampSamplePages('багато')));
  t('відсутнє → усталене', clampSamplePages(undefined) === 10);
  t('відʼємне → нижня межа', clampSamplePages(-5) === SAMPLE_MIN_PAGES);
}

/** Книга, довша за будь-який уривок: кожен розділ дає щонайменше сторінку. */
const longBook = {
  title: 'Тіні Нео-Києва 2084',
  author: 'Олександр Радченко',
  chapters: Array.from({ length: 14 }, (_, i) => ({
    title: `Розділ ${i + 1}`,
    sections: [{ content: 'Їжак прокинувся о шостій, і місто гуділо. '.repeat(60) }],
  })),
};

console.log('\nНарізка з довгої книги');
{
  const full = await renderBookPdf(longBook as never);
  t('повна книга зверстана', full.pageCount > SAMPLE_MAX_PAGES, `${full.pageCount} сторінок`);

  const cut = await extractSamplePages(full.bytes, 10);
  t('уривок зроблено', cut !== null);
  t('рівно 10 сторінок', cut?.pageCount === 10, String(cut?.pageCount));
  t('повний обсяг названо чесно', cut?.totalPages === full.pageCount,
    `${cut?.totalPages} vs ${full.pageCount}`);

  // Найважливіше: результат має відкриватись сам по собі.
  const reopened = await PDFDocument.load(cut!.bytes);
  t('уривок — валідний самостійний PDF', reopened.getPageCount() === 10, String(reopened.getPageCount()));
  t('заголовок PDF на місці', Buffer.from(cut!.bytes.subarray(0, 5)).toString() === '%PDF-');
  t('назва позначає уривок', (reopened.getTitle() || '').includes('уривок'), String(reopened.getTitle()));

  // Перші сторінки, а не будь-які: розмір першої сторінки уривка має
  // збігатися з розміром першої сторінки книги.
  const source = await PDFDocument.load(full.bytes);
  const a = source.getPage(0).getSize();
  const b = reopened.getPage(0).getSize();
  t('перша сторінка того самого формату',
    Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01,
    `${a.width}×${a.height} vs ${b.width}×${b.height}`);

  const five = await extractSamplePages(full.bytes, 5);
  t('вибір автора поважається: 5 сторінок', five?.pageCount === 5, String(five?.pageCount));
  t('уривок легший за книгу', five!.bytes.length < full.bytes.length,
    `${five!.bytes.length} < ${full.bytes.length}`);
}

console.log('\nКоли уривка робити НЕ треба');
{
  const shortBook = {
    title: 'Зовсім коротка',
    author: 'Автор',
    chapters: [{ title: 'Єдиний розділ', sections: [{ content: 'Три слова.' }] }],
  };
  const full = await renderBookPdf(shortBook as never);
  t('коротка книга справді коротка', full.pageCount <= SAMPLE_MAX_PAGES, String(full.pageCount));

  const cut = await extractSamplePages(full.bytes, 10);
  t('книга не довша за уривок → null, а не безкоштовна книга цілком', cut === null, String(cut));

  // Межа рівності: сторінок рівно стільки, скільки просять — теж null.
  const equal = await extractSamplePages(full.bytes, Math.max(SAMPLE_MIN_PAGES, full.pageCount));
  t('рівна кількість сторінок теж не дає уривка', equal === null);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
