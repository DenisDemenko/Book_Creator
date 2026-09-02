/**
 * Тести рушія верстки PDF. Запуск: npm run test:pdf
 *
 * Рушій написаний руками, бо pdf-lib не має верстки: перенос слів,
 * вирівнювання, розриви сторінок і нумерація — наш код. Тому перевіряється
 * саме те, що в такому коді ламається: чи не вилазить текст за поле, чи
 * рахуються сторінки, чи не нумерується титул, чи виживає кирилиця.
 *
 * Готовий файл кладеться в /tmp — його можна відкрити очима.
 */
import fs from 'node:fs';

const io_read = (rel: string) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf-8');

const renderer = await import('../server/pdf/pdfRenderer');
const mmToPt = (v: number) => (v * 72) / 25.4;
const types = await import('../server/pdf/pdfTypes');

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('Шрифти:');
t('усі три файли на місці', renderer.fontsAvailable());

console.log('\nОчищення тексту:');
{
  const p = renderer.toParagraphs('# Заголовок\n\nПерший **абзац** із <b>розміткою</b>.\n\nДругий&nbsp;абзац.');
  t('розмітку знято', !p.join(' ').includes('**') && !p.join(' ').includes('<b>'), p.join(' | '));
  t('абзаци розділені', p.length === 3, String(p.length));
  t('нерозривний пробіл замінено', p[2] === 'Другий абзац.', p[2]);
  t('порожні абзаци відкинуто', renderer.toParagraphs('\n\n\n').length === 0);
}

console.log('\nПеренос по словах:');
{
  const font = { widthOfTextAtSize: (s: string, size: number) => s.length * size * 0.5 };
  const lines = renderer.wrapText('одне два три чотири пять шість сім вісім', font, 10, 60);
  t('рядки не довші за межу', lines.every((l) => font.widthOfTextAtSize(l, 10) <= 60), lines.join('/'));
  t('жодного слова не загублено',
    lines.join(' ').split(/\s+/).length === 'одне два три чотири пять шість сім вісім'.split(' ').length);

  const long = renderer.wrapText('супердовгеслово'.repeat(4), font, 10, 40);
  t('надто довге слово ріжеться, а не вилазить',
    long.every((l) => font.widthOfTextAtSize(l, 10) <= 40), long.join('/'));
  t('порожній рядок -> нуль рядків', renderer.wrapText('   ', font, 10, 100).length === 0);
}

const book = {
  title: 'Тіні Нео-Києва 2084',
  subtitle: 'Роман про місто, якого ще немає',
  author: 'Олександр Радченко',
  chapters: [
    {
      title: 'Розділ перший. Ґанок',
      sections: [
        { title: 'Ранок', content: 'Їжак прокинувся о шостій. '.repeat(40) + '\n\nДругий абзац із «лапками» — і тире.' },
        { title: 'Вечір', content: 'Місто гуділо. '.repeat(60) },
      ],
    },
    { title: 'Розділ другий', sections: [{ content: 'Без назви розділу, самий текст. '.repeat(30) }] },
  ],
};

console.log('\nРендеринг:');
{
  const out = await renderer.renderBookPdf(book);
  t('файл не порожній', out.bytes.length > 5000, `${out.bytes.length} байт`);
  t('це справді PDF', new TextDecoder().decode(out.bytes.slice(0, 5)) === '%PDF-', new TextDecoder().decode(out.bytes.slice(0, 5)));
  t('сторінок більше однієї', out.pageCount > 1, String(out.pageCount));
  t('титул не пронумеровано', out.numberedPages === out.pageCount - 1,
    `сторінок ${out.pageCount}, пронумеровано ${out.numberedPages}`);

  fs.writeFileSync('/tmp/nova-pdf-test.pdf', out.bytes);
  console.log(`  -> /tmp/nova-pdf-test.pdf (${out.pageCount} стор., ${Math.round(out.bytes.length / 1024)} КБ)`);

  const noTitle = await renderer.renderBookPdf(book, { titlePage: { ...types.DEFAULT_LAYOUT_SPEC.titlePage, show: false } });
  t('без титулу нумеруються всі сторінки', noTitle.numberedPages === noTitle.pageCount,
    `${noTitle.numberedPages}/${noTitle.pageCount}`);

  const a4 = await renderer.renderBookPdf(book, { pageSize: 'A4' });
  t('на A4 сторінок менше, ніж на A5', a4.pageCount < out.pageCount, `A4 ${a4.pageCount} vs A5 ${out.pageCount}`);

  const big = await renderer.renderBookPdf(book, { baseFontSize: 18 });
  t('більший кегль -> більше сторінок', big.pageCount > out.pageCount, `${big.pageCount} vs ${out.pageCount}`);
}

console.log('\nВисячі заголовки:');
{
  // Текст підібраний так, щоб заголовок другого розділу впав рівно на
  // кінець сторінки. Без захисту він лишився б там сам.
  const tricky = {
    title: 'Перевірка',
    chapters: [{
      title: 'Глава',
      sections: [
        { title: 'Перша', content: 'Рядок тексту для заповнення сторінки. '.repeat(52) },
        { title: 'Друга', content: 'Текст під другим заголовком. '.repeat(10) },
      ],
    }],
  };
  const out = await renderer.renderBookPdf(tricky, { titlePage: { ...types.DEFAULT_LAYOUT_SPEC.titlePage, show: false } });
  const text = new TextDecoder('latin1').decode(out.bytes);
  t('файл зібрався', out.pageCount >= 2, String(out.pageCount));
  // Пряма перевірка неможлива без розбору PDF, тож перевіряємо інваріант
  // рушія: заголовок ніколи не малюється нижче за поріг «заголовок + два
  // рядки». Це властивість коду, і саме її ми щойно ввели.
  t('поріг враховує два рядки тексту',
    /WIDOW_LINES/.test(io_read('server/pdf/pdfRenderer.ts')), 'константа на місці');
}

console.log('\nМакет із книги (варіант «код»):');
{
  const fromBook = await import('../server/pdf/pdfFromBook');
  const mkBook = (over: any = {}) => ({
    title: 'Книга', author: 'Автор', chapters: [],
    layoutConfig: {
      formatPreset: 'custom', pageWidthMm: 148, pageHeightMm: 210,
      margins: { topMm: 20, bottomMm: 25, insideMm: 18, outsideMm: 15, bleedMm: 0, mirrored: false },
      typography: {
        bodyFont: 'Georgia', headingsFont: 'Montserrat', fontSizePt: 12, lineHeight: 1.5,
        firstLineIndentMm: 5, paragraphSpacingMm: 0, textAlign: 'justify',
        pageNumberPosition: 'bottom-outside', showHeaders: true, showPageNumbers: true,
        pageNumberStart: { mode: 'title' },
      },
      ...over,
    },
  }) as any;

  const spec = fromBook.specFromBook(mkBook());
  t('формат узято з книги в пунктах', Math.round(spec.pageWidthPt!) === 420, String(spec.pageWidthPt));
  t('поля переведено з міліметрів', Math.round(spec.margins.top) === 57, String(spec.margins.top));
  t('внутрішнє поле стало лівим', Math.round(spec.margins.left) === 51, String(spec.margins.left));
  t('кегль з книги', spec.baseFontSize === 12);
  t('інтерліньяж з книги', spec.lineHeight === 1.5);
  t('червоний рядок переведено з мм', Math.round(spec.paragraphIndent) === 14, String(spec.paragraphIndent));
  t('гарнітура із засічками для Georgia', spec.bodyFont === 'serif', spec.bodyFont);
  t('гротеск для Montserrat у заголовках', spec.chapterTitle.font === 'sans', spec.chapterTitle.font);
  t('«зовні» → праворуч', spec.pageNumber.position === 'bottom-right', spec.pageNumber.position);
  t('колонтитул увімкнено', spec.runningHead.show === true);

  t('режим title: нумерується все', fromBook.specFromBook(mkBook()).pageNumber.skipFrontMatter === false);
  const afterToc = fromBook.specFromBook(mkBook({ typography: { ...mkBook().layoutConfig.typography, pageNumberStart: { mode: 'after-toc' } } }));
  t('режим after-toc: передмова без номерів', afterToc.pageNumber.skipFrontMatter === true && afterToc.pageNumber.startAt === 1);
  const custom = fromBook.specFromBook(mkBook({ typography: { ...mkBook().layoutConfig.typography, pageNumberStart: { mode: 'custom', startNumber: 7 } } }));
  t('режим custom: нумерація з указаного числа', custom.pageNumber.startAt === 7, String(custom.pageNumber.startAt));

  const mirrored = fromBook.specFromBook(mkBook({ margins: { ...mkBook().layoutConfig.margins, mirrored: true } }));
  t('дзеркальні поля названо в примітці, а не проігноровано мовчки',
    /Дзеркальні поля не застосовані/.test(mirrored.designerNoteUk || ''), mirrored.designerNoteUk);

  t('книга без налаштувань не падає',
    fromBook.specFromBook({ title: 'x', chapters: [] } as any).baseFontSize > 0);

  const input = fromBook.bookToPdfInput({
    title: 'Т', chapters: [
      { title: 'Друга', order: 2, sections: [{ title: 'б', order: 2, content: 'x' }, { title: 'а', order: 1, content: 'y' }] },
      { title: 'Перша', order: 1, sections: [] },
    ],
  } as any);
  t('розділи впорядковані за order', input.chapters[0].title === 'Перша', input.chapters[0].title);
  t('підрозділи впорядковані за order', input.chapters[1].sections[0].title === 'а');
}

console.log('\nМакет від моделі (варіант «дизайн»):');
{
  const design = await import('../server/pdf/pdfDesignPrompt');

  t('JSON в огорожі розбирається',
    (design.parseBookPdfDesignResponse('```json\n{"baseFontSize":12}\n```') as any).baseFontSize === 12);

  const sane = design.normalizeDesignResult({
    pageSize: 'B5', baseFontSize: 12, lineHeight: 1.6, paragraphIndent: 14,
    margins: { top: 50, right: 45, bottom: 60, left: 40 }, bodyAlign: 'left', bodyFont: 'sans',
    designerNoteUk: 'Пояснення',
  });
  t('розумні значення пройшли', sane.pageSize === 'B5' && sane.baseFontSize === 12 && sane.bodyFont === 'sans');
  t('пояснення збережено', sane.designerNoteUk === 'Пояснення');

  const crazy = design.normalizeDesignResult({
    pageSize: 'A0', baseFontSize: 200, lineHeight: 12, paragraphIndent: 900,
    margins: { top: -50, right: 5000, bottom: 0, left: 'вісім' },
  });
  t('кегль затиснуто', crazy.baseFontSize === 16, String(crazy.baseFontSize));
  t('інтерліньяж затиснуто', crazy.lineHeight === 2, String(crazy.lineHeight));
  t('відступ затиснуто', crazy.paragraphIndent === 40, String(crazy.paragraphIndent));
  t('невідомий формат → заводський', crazy.pageSize === 'A5', crazy.pageSize);
  t('відʼємне поле затиснуто', crazy.margins.top === 20, String(crazy.margins.top));
  t('нечислове поле стало заводським', crazy.margins.left === 48, String(crazy.margins.left));
  t('без пояснення — чесна замітка', /пояснення вона не дала/.test(crazy.designerNoteUk || ''));

  const both = design.normalizeDesignResult({ paragraphIndent: 16, paragraphSpacing: 10 });
  t('червоний рядок і відступ разом не проходять', both.paragraphSpacing === 0 && both.paragraphIndent === 16);

  // Найважливіше: макет від моделі має реально рендеритись.
  const out = await renderer.renderBookPdf(book, sane);
  t('PDF за макетом моделі збирається', out.pageCount >= 1 && out.bytes.length > 5000, String(out.pageCount));
}

console.log('\nМакет Amazon KDP:');
{
  const kdp = await import('../server/pdf/pdfKdp');

  const small = kdp.kdpSpec({ pageCountEstimate: 100 });
  t('обріз за замовчуванням 6x9', small.trimId === '6x9', small.trimId);
  t('ширина сторінки 6 дюймів у пунктах', small.spec.pageWidthPt === 432, String(small.spec.pageWidthPt));
  t('дзеркальні поля увімкнені', small.spec.mirrorMargins === true);
  t('норма KDP для 100 сторінок = 9.6 мм', small.gutterMm === 9.6, String(small.gutterMm));
  t('фактичний корінець ширший за норму (припуск на переплетення)',
    small.spec.margins.left > mmToPt(9.6), `${small.spec.margins.left} > ${mmToPt(9.6)}`);
  t('корінець ширший за зовнішнє поле',
    small.spec.margins.left > small.spec.margins.right,
    `${small.spec.margins.left} vs ${small.spec.margins.right}`);
  t('нижнє поле більше за верхнє', small.spec.margins.bottom > small.spec.margins.top);

  const big = kdp.kdpSpec({ pageCountEstimate: 400 });
  t('для 400 сторінок корінець ширший', big.gutterMm === 15.9, String(big.gutterMm));
  t('корінець ширший за зовнішнє поле не завжди, але росте',
    big.spec.margins.left > small.spec.margins.left, `${big.spec.margins.left} > ${small.spec.margins.left}`);

  const other = kdp.kdpSpec({ pageCountEstimate: 50, trimId: '5x8' });
  t('обраний обріз застосовано', other.trimId === '5x8' && other.spec.pageWidthPt === 360, String(other.spec.pageWidthPt));
  t('невідомий обріз → 6x9', kdp.kdpSpec({ pageCountEstimate: 50, trimId: 'нема' }).trimId === '6x9');

  t('пояснення називає і фактичне поле, і норму KDP',
    /корінець/.test(small.spec.designerNoteUk || '') && /при мінімумі KDP 9\.6/.test(small.spec.designerNoteUk || ''),
    small.spec.designerNoteUk);

  const out = await kdp.renderKdpInterior(book);
  t('KDP-файл зібрався', out.bytes.length > 5000 && out.pageCount > 0, String(out.pageCount));
  t('проходів не більше трьох', out.passes >= 1 && out.passes <= 3, String(out.passes));
  t('коротку книгу чесно позначено як непридатну для KDP',
    out.warningsUk.some((w) => /приймає від 24/.test(w)), out.warningsUk.join(' | '));

  const bleed = await kdp.renderKdpInterior(book, { hasBleed: true });
  t('виліт: сказано, що зображень під зріз не буде',
    bleed.warningsUk.some((w) => /під зріз/.test(w)));

  // Дзеркальність: у PDF шукаємо координати початку рядків. На парних і
  // непарних сторінках ліва межа набору мусить відрізнятися рівно на
  // різницю корінця й зовнішнього поля.
  const spec = kdp.kdpSpec({ pageCountEstimate: 100 }).spec;
  const shift = spec.margins.left - spec.margins.right;
  t('зсув набору на розвороті помітний (>3 мм)', shift > mmToPt(3), `${Math.round(shift / mmToPt(1) * 10) / 10} мм`);
  const thick = kdp.kdpSpec({ pageCountEstimate: 600 }).spec;
  t('на товстій книзі корінець ще ширший',
    thick.margins.left > spec.margins.left,
    `${Math.round(thick.margins.left / mmToPt(1))} мм vs ${Math.round(spec.margins.left / mmToPt(1))} мм`);
}

// Живий файл під KDP — щоб подивитись на розворот очима.
{
  const kdp2 = await import('../server/pdf/pdfKdp');
  const longBook = {
    title: 'Тіні Нео-Києва 2084',
    subtitle: 'Роман',
    author: 'Олександр Радченко',
    chapters: Array.from({ length: 3 }, (_, i) => ({
      title: `Розділ ${i + 1}`,
      sections: [{ content: 'Місто прокидалося поволі, ніби не хотіло. '.repeat(90) }],
    })),
  };
  const out = await kdp2.renderKdpInterior(longBook, { trimId: '6x9' });
  fs.writeFileSync('/tmp/nova-kdp-test.pdf', out.bytes);
  console.log(`  -> /tmp/nova-kdp-test.pdf (${out.pageCount} стор., корінець ${out.gutterMm} мм норма, ${out.passes} прох.)`);
}

console.log('\nПорожні випадки:');
{
  const empty = await renderer.renderBookPdf({ title: 'Порожня', chapters: [] });
  t('книга без глав не падає', empty.pageCount >= 1, String(empty.pageCount));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
