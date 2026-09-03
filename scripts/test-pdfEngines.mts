/**
 * Тести вибору рушіїв PDF (#101). Запуск: npm run test:pdf-engines
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Рушіїв стало чотири, і три з них залежать від того,
 * чого може не бути в образі. Отже перевіряти треба не «PDF вийшов» —
 * зібрати байти вміє й один рушій, — а те, що робить вибір безпечним:
 *
 *  1. НЕМАЄ ТИХОГО ВІДКОТУ. Обраний рушій або працює, або каже чому ні.
 *     Підмінити рушій мовчки — видати авторові інший файл під виглядом
 *     замовленого.
 *  2. Недоступний рушій НЕ зникає з переліку: причина корисніша за
 *     відсутню кнопку.
 *  3. Один зламаний рушій не ховає решту.
 *  4. Розмітку автора не втрачено при переході в Markdown — саме заради
 *     неї зовнішні рушії й зʼявились.
 *  5. HTML не виконує текст автора як розмітку.
 */
process.env.DATA_DIR = '/tmp/nova-pdfengines-test';

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

const { htmlToMarkdown, bookToMarkdown, courseToMarkdown } = await import('../server/pdf/bookToMarkdown');
const { buildBookHtml, markdownToHtmlBody, escapeHtml } = await import('../server/pdf/html/bookHtml');
const registry = await import('../server/pdf/engines/registry');
const { PdfEngineError } = await import('../server/pdf/engines/types');
const { chromiumAvailableAt, chromiumEngine, __setBrowserLauncherForTests } = await import(
  '../server/pdf/engines/chromiumEngine'
);

// ---------------------------------------------------------------------------
console.log('\nHTML → Markdown');
{
  t('напівжирний збережено', htmlToMarkdown('<b>Гроза</b>') === '**Гроза**');
  t('курсив збережено', htmlToMarkdown('<em>тихо</em>') === '*тихо*');
  t('заголовок збережено', htmlToMarkdown('<h2>Розділ</h2>') === '## Розділ');
  t('розрив рядка', htmlToMarkdown('а<br>б') === 'а\nб');
  t('абзаци', htmlToMarkdown('<p>перший</p><p>другий</p>') === 'перший\n\nдругий');
  t('список', htmlToMarkdown('<ul><li>раз</li><li>два</li></ul>').includes('- раз'));
  t('цитата', htmlToMarkdown('<blockquote>слово</blockquote>') === '> слово');

  // Втрата тексту гірша за втрату оформлення.
  t('невідомий тег зрізано, текст лишився', htmlToMarkdown('<mark>ключ</mark>') === 'ключ');

  // Порядок розбору сутностей: &amp;lt; не має стати «<».
  t('подвійне екранування не розгортається двічі', htmlToMarkdown('&amp;lt;') === '&lt;');
  t('нерозривний пробіл', htmlToMarkdown('а&nbsp;б') === 'а б');
  t('порожні рядки не множаться', !/\n\n\n/.test(htmlToMarkdown('<p>а</p><p></p><p></p><p>б</p>')));
  t('markdown автора не чіпаємо', htmlToMarkdown('**вже жирний**') === '**вже жирний**');
}

// ---------------------------------------------------------------------------
console.log('\nКнига → Markdown');
const book: any = {
  id: 'b1',
  title: 'Тіні Нео-Києва',
  subtitle: 'Роман',
  author: 'Олександр Радченко',
  chapters: [
    {
      id: 'c1',
      title: 'Розділ перший',
      order: 1,
      sections: [
        { id: 's1', title: 'Ранок', order: 1, content: '<p>Дощ <b>не</b> вщухав.</p>' },
        { id: 's2', title: '', order: 2, content: 'Просто текст.' },
      ],
    },
    { id: 'c0', title: 'Пролог', order: 0, sections: [{ id: 's0', content: 'Спочатку.' }] },
  ],
  illustrations: [
    { id: 'i1', chapterId: 'c1', url: 'data:image/png;base64,AAA', caption: 'Нічний Київ' },
  ],
};

{
  const doc = bookToMarkdown(book, { frontmatter: true });
  t('порядок розділів за order, а не за масивом', doc.markdown.indexOf('# Пролог') < doc.markdown.indexOf('# Розділ перший'));
  t('накреслення дійшло до Markdown', doc.markdown.includes('Дощ **не** вщухав'));
  t('секція без назви не дає порожній заголовок', !doc.markdown.includes('## \n'));
  t('YAML-заголовок є', doc.markdown.startsWith('---\ntitle: "Тіні Нео-Києва"'));
  t('мова за замовчуванням українська', doc.markdown.includes('lang: "uk-UA"'));
  t('ілюстрація стала плейсхолдером, а не URL', doc.markdown.includes('](nova-image-1)'));
  t('ілюстрація потрапила в перелік', doc.images.length === 1 && doc.images[0].url.startsWith('data:'));
  t('ілюстрація привʼязана до свого розділу', doc.markdown.indexOf('nova-image-1') > doc.markdown.indexOf('Розділ перший'));

  const noImg = bookToMarkdown(book, { withImages: false });
  t('вимкнені ілюстрації не потрапляють у текст', !noImg.markdown.includes('nova-image'));
  t('вимкнені ілюстрації не потрапляють у перелік', noImg.images.length === 0);

  const noFm = bookToMarkdown(book, {});
  t('без frontmatter YAML немає', !noFm.markdown.startsWith('---'));

  // Назва з розміткою не має зламати рівень заголовка.
  const tricky = bookToMarkdown({ ...book, chapters: [{ id: 'x', title: '## Не заголовок', order: 1, sections: [] }] } as any, {});
  t('розмітка в назві розділу знешкоджена', tricky.markdown.trim() === '# Не заголовок');

  // Лапки в назві не мають зламати YAML.
  const quoted = bookToMarkdown({ ...book, title: 'Книга "у лапках": том 2' } as any, { frontmatter: true });
  t('лапки в назві екрановані для YAML', quoted.markdown.includes('title: "Книга \\"у лапках\\": том 2"'));
}

// ---------------------------------------------------------------------------
console.log('\nКурс → Markdown');
{
  const course: any = {
    enabled: true,
    title: 'Курс за книгою',
    description: '<p>Про що курс.</p>',
    tags: [{ id: 't1', label: 'Дощ', textSnippet: 'Дощ не вщухав.' }],
    materials: [
      { id: 'm1', tagId: 't1', kind: 'youtube', title: 'Огляд', youtubeUrl: 'https://youtu.be/x' },
      { id: 'm2', tagId: 't1', kind: 'homework', title: 'Вправа', fileName: 'hw.pdf' },
    ],
    modules: [{ id: 'mod1', title: 'Модуль 1', lessons: [{ id: 'l1', title: 'Урок 1', tagIds: ['t1'] }] }],
  };
  const doc = courseToMarkdown(book, course, {});
  t('модуль — заголовок першого рівня', doc.markdown.includes('# Модуль 1'));
  t('урок — другого', doc.markdown.includes('## Урок 1'));
  t('фрагмент книги перенесено', doc.markdown.includes('Дощ не вщухав.'));
  t('відео стало посиланням, а не зникло', doc.markdown.includes('https://youtu.be/x'));
  t('домашнє завдання назване', doc.markdown.includes('Домашнє завдання'));

  const legacy = courseToMarkdown(book, { ...course, modules: [] }, {});
  t('старий курс без модулів усе одно друкується', legacy.markdown.includes('Дощ'));
}

// ---------------------------------------------------------------------------
console.log('\nMarkdown → HTML');
{
  t('екранування', escapeHtml('<b>&"') === '&lt;b&gt;&amp;&quot;');
  const body = markdownToHtmlBody('# Розділ\n\nТекст **жирний**.');
  t('заголовок', body.includes('<h1>Розділ</h1>'));
  t('накреслення', body.includes('<strong>жирний</strong>'));

  // Текст автора не має виконуватись як розмітка.
  const evil = markdownToHtmlBody('<script>alert(1)</script>');
  t('HTML у тексті автора не виконується', !evil.includes('<script>'), evil.trim());

  const html = buildBookHtml('# Розділ\n\nТекст.', { title: 'Назва', author: 'Автор', theme: 'book' });
  t('повна сторінка', html.startsWith('<!DOCTYPE html>') && html.includes('</html>'));
  t('титульна сторінка є', html.includes('title-page') && html.includes('Автор'));
  t('шрифти локальні, не з мережі', !html.includes('fonts.googleapis') && html.includes('DejaVu'));
  t('переноси увімкнені', html.includes('hyphens: auto'));

  const noTitle = buildBookHtml('текст', { title: 'Назва', titlePage: false });
  t('титульну можна вимкнути', !noTitle.includes('<section class="title-page">'));

  const course = buildBookHtml('# Урок', { title: 'Курс', theme: 'course' });
  t('навчальна тема не рве сторінку на кожному розділі', !/h1\s*\{[^}]*break-before: page/.test(course));
  const bookTheme = buildBookHtml('# Розділ', { title: 'Книга', theme: 'book' });
  t('книжкова тема рве', /h1\s*\{[^}]*break-before: page/.test(bookTheme));

  const bad = buildBookHtml('текст', { title: 'Назва', theme: 'невідома' as never });
  t('невідома тема відкочується на книжкову, а не падає', bad.includes('DejaVu Serif'));
}

// ---------------------------------------------------------------------------
console.log('\nДоступність Chromium');
{
  t('порожній шлях → недоступний', chromiumAvailableAt('').ok === false);
  const missing = chromiumAvailableAt('/no/such/chromium');
  t('відсутній бінарник → недоступний', missing.ok === false);
  t('причина названа конкретно', String(missing.reasonUk).includes('/no/such/chromium'), String(missing.reasonUk));
  t('сказано, що робити', !!missing.fixUk);
  t('наявний файл → доступний', chromiumAvailableAt('/bin/sh').ok === true);
}

// ---------------------------------------------------------------------------
console.log('\nРеєстр рушіїв');
{
  const list = await registry.listPdfEngines();
  t('nova в переліку', list.some((e) => e.id === 'nova'));
  t('nova — рушій за замовчуванням', list.find((e) => e.id === 'nova')?.isDefault === true);
  t('у кожного названо і сильний бік, і обмеження', list.every((e) => e.strengthUk && e.limitUk));

  // Зламаний рушій не має ховати решту.
  registry.registerPdfEngine({
    id: 'pandoc',
    label: 'Зламаний',
    strengthUk: 'x',
    limitUk: 'y',
    supportsPrint: false,
    async available() {
      throw new Error('бум');
    },
    async render() {
      throw new Error('не має викликатись');
    },
  } as never);
  const withBroken = await registry.listPdfEngines();
  t('зламаний рушій показано недоступним', withBroken.find((e) => e.id === 'pandoc')?.available === false);
  t('текст винятку донесено', String(withBroken.find((e) => e.id === 'pandoc')?.reasonUk).includes('бум'));
  t('решта рушіїв на місці', withBroken.some((e) => e.id === 'nova' && e.available));

  // Немає тихого відкоту.
  let err: any = null;
  try {
    await registry.renderWithEngine('pandoc', { book: { title: 'x', chapters: [] }, kind: 'book' });
  } catch (e) {
    err = e;
  }
  t('недоступний рушій кидає помилку, а не верстає іншим', err instanceof PdfEngineError);
  t('вид помилки — «недоступний»', err?.kind === 'unavailable', String(err?.kind));

  err = null;
  try {
    await registry.renderWithEngine('вигаданий', { book: { title: 'x', chapters: [] }, kind: 'book' });
  } catch (e) {
    err = e;
  }
  t('невідомий рушій → помилка вводу', err?.kind === 'bad_input');
  t('у помилці перелічено доступні', String(err?.message).includes('nova'));

  err = null;
  try {
    await registry.renderWithEngine('chromium', { book: { title: 'x', chapters: [] }, kind: 'book', print: true });
  } catch (e) {
    err = e;
  }
  t('друк на рушії без підтримки KDP відхилено ДО запуску', err?.kind === 'bad_input');
  t('пояснено, чому саме', String(err?.message).includes('KDP'));
}

// ---------------------------------------------------------------------------
console.log('\nChromium: рендер із підставним браузером');
{
  // Порожній, але справжній PDF — щоб pdf-lib міг порахувати сторінки.
  const { PDFDocument } = await import('pdf-lib');
  const stub = await PDFDocument.create();
  stub.addPage();
  stub.addPage();
  const stubBytes = await stub.save();

  let seenHtml = '';
  let seenOpts: Record<string, unknown> = {};
  let closed = false;
  __setBrowserLauncherForTests(async (): Promise<any> => ({
    async pdf(html: string, opts: Record<string, unknown>) {
      seenHtml = html;
      seenOpts = opts;
      return stubBytes;
    },
    async close() {
      closed = true;
    },
  }));

  registry.registerPdfEngine({ ...chromiumEngine, async available() { return { ok: true }; } } as never);

  const result = await registry.renderWithEngine('chromium', {
    book: book as never,
    kind: 'book',
    theme: 'modern',
  });

  t('кількість сторінок узято з готового PDF', result.pageCount === 2, String(result.pageCount));
  t('рушій названий у результаті', result.engineId === 'chromium');
  t('чесно сказано, що макет виконано не повністю', result.honoredSpec === false);
  t('є примітка про те, що зроблено інакше', result.notesUk.length > 0);
  t('браузер закрито', closed);
  t('обрану тему застосовано', seenHtml.includes('DejaVu Sans'), 'modern');
  t('текст книги дійшов до сторінки', seenHtml.includes('вщухав'));
  t('ілюстрацію вбудовано як data:, а не плейсхолдером', !seenHtml.includes('nova-image-1'));

  /*
    Одиниці розміру сторінки. `page.pdf()` розуміє px, in, cm, mm — і НЕ
    розуміє pt: справжній Chromium відповідає «Failed to parse parameter
    value: 419.53pt» і рендер падає цілком. Саме так і сталося при першому
    живому прогоні на розгорнутому Nova, а цей набір нічого не помітив, бо
    підставний браузер до цієї правки навіть не отримував опцій.
  */
  const acceptedUnit = /(px|in|cm|mm)$/;
  t('ширина сторінки в одиницях, які приймає Chromium',
    acceptedUnit.test(String(seenOpts.width)), String(seenOpts.width));
  t('висота сторінки в одиницях, які приймає Chromium',
    acceptedUnit.test(String(seenOpts.height)), String(seenOpts.height));
  t('розмір не в пунктах — саме на них рендер падав',
    !/pt$/.test(String(seenOpts.width)) && !/pt$/.test(String(seenOpts.height)));

  const { pageFormatFor } = await import('../server/pdf/engines/chromiumEngine');
  t('A5 переведено в міліметри правильно (148×210)',
    pageFormatFor('A5').width === '148mm' && pageFormatFor('A5').height === '210mm',
    `${pageFormatFor('A5').width}×${pageFormatFor('A5').height}`);
  t('A4 переведено в міліметри правильно (210×297)',
    pageFormatFor('A4').width === '210mm' && pageFormatFor('A4').height === '297mm',
    `${pageFormatFor('A4').width}×${pageFormatFor('A4').height}`);
  t('невідомий розмір відкочується на A5, а не на порожнечу',
    pageFormatFor('немаТакого').width === '148mm');
}

// ---------------------------------------------------------------------------
console.log('\npandoc: розбір помилки LaTeX');
{
  const { latexErrorSummary, EISVOGEL_TEMPLATE } = await import('../server/pdf/engines/pandocEngine');

  // Справжня причина стоїть у рядку з «!» серед сотень рядків шуму.
  const noisy = [
    'This is XeTeX, Version 3.141592653',
    'entering extended mode',
    '(./book.tex',
    '! Undefined control sequence.',
    'l.42 \\badcommand',
    '[1] [2] [3]',
  ].join('\n');
  const summary = latexErrorSummary('', noisy);
  t('знайдено рядок з причиною', summary.includes('Undefined control sequence'), summary);
  t('службовий шум не потрапив', !summary.includes('entering extended mode'));

  // Немає жодного маркера — беремо хвіст, а не порожнечу.
  const mute = latexErrorSummary('', 'рядок один\nрядок два\nрядок три');
  t('без маркерів беремо останні рядки', mute.includes('рядок три'), mute);
  t('порожній вивід не дає порожнього пояснення', latexErrorSummary('', '').length > 0);

  const fs = await import('node:fs');
  t('шаблон Eisvogel лежить у репозиторії', fs.existsSync(EISVOGEL_TEMPLATE), EISVOGEL_TEMPLATE);
  const tpl = fs.readFileSync(EISVOGEL_TEMPLATE, 'utf8');
  t('шаблон непорожній і схожий на LaTeX', tpl.includes('documentclass'), String(tpl.length));
  t('ліцензія шаблону поруч', fs.existsSync(EISVOGEL_TEMPLATE.replace('eisvogel.latex', 'EISVOGEL-LICENSE')));
}

// ---------------------------------------------------------------------------
console.log('\nGamma: доступність без підписки');
{
  const { gammaEngine, configureGammaEngine } = await import('../server/pdf/engines/gammaEngine');

  const noClient = await gammaEngine.available({ ownerId: 'u1', role: 'writer' } as never);
  t('без налаштованого клієнта — недоступна', noClient.ok === false);
  t('сказано, що це наша справа, а не автора', String(noClient.fixUk).includes('студію'), String(noClient.fixUk));

  configureGammaEngine({ makeClient: () => ({ request: async () => ({}), lastRate: () => ({ burst: null, remaining: null, daily: null }) }) as never });
  const noKey = await gammaEngine.available({ ownerId: 'user-without-key', ownerRole: 'writer' });
  t('без ключа автора — недоступна', noKey.ok === false);
  t('причина пояснює, де взяти ключ', String(noKey.reasonUk).includes('Settings'), String(noKey.reasonUk).slice(0, 60));
  t('ключ студії не підміняє ключ автора', !String(noKey.reasonUk).includes('студії використ'));

  t('Gamma не може бути рушієм за замовчуванням', gammaEngine.id !== 'nova');
  t('Gamma не робить друк під KDP', gammaEngine.supportsPrint === false);
  t('обмеження називає витрату кредитів автора', gammaEngine.limitUk.includes('кредити'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
