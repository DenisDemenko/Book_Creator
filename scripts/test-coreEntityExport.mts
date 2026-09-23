/**
 * Теги сутностей не мають права потрапити в надруковану книгу (постановка
 * власника, пункт 6). Цей тест перевіряє КОЖЕН шлях, яким текст розділу
 * стає файлом, бо шляхів кілька й вони різні:
 *
 *   1. `server/pdf/bookToMarkdown.ts` — markdown для pandoc / Chromium / LaTeX;
 *   2. `server/pdf/pdfRenderer.ts::toParagraphs` — рушій pdf-lib, який верстає
 *      сторінку сам, без жодного markdown;
 *   3. `src/utils/helpers.ts::renderSectionContentHtml` — експорт і
 *      переддруківка в браузері (друк сторінки, «Розворот книги»);
 *   4. `src/utils/fileExporters.ts::exportParagraphs` — спільна підготовка
 *      абзаців для DOCX, EPUB і TXT-фолбеку (додано 23.09.2026: власник
 *      попросив знімати теги й там, бо в цих трьох форматах вони лишалися).
 *
 * ЧОМУ ОКРЕМИЙ ФАЙЛ, А НЕ РЯДОК У test-coreEntities.mts. Там перевіряється
 * модуль реєстру (числа з документа, розбір і зняття тегів на рядках). Тут —
 * те, що ці функції справді ВИКЛИКАЮТЬ зняття: помилка, яку шукаєш, має
 * вигляд «модуль уміє, а експорт ним не користується», і саме вона
 * проходить повз тести модуля.
 */

import JSZip from 'jszip';
import { toParagraphs } from '../server/pdf/pdfRenderer.ts';
import { bookToMarkdown } from '../server/pdf/bookToMarkdown.ts';
import { renderSectionContentHtml } from '../src/utils/helpers.ts';
import { exportBookToDocx, exportBookToEpub, exportParagraphs, bookToPlainText } from '../src/utils/fileExporters.ts';
import { buildEntityTag, stripEntityTags } from '../src/utils/coreEntities.ts';
import type { Book, Section } from '../src/types.ts';

let pass = 0, fail = 0;
const t = (name: string, condition: boolean, extra = '') => {
  condition ? pass++ : fail++;
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const TAGGED_PARAGRAPH = [
  `${buildEntityTag('character', 'Serhii')} ${buildEntityTag('emotion', 'страх')}`,
  'Сергій вийшов із будинку, коли біля нього зупинився чорний автомобіль.',
].join('\n');

function section(content: string, id = 's1'): Section {
  return {
    id,
    chapterId: 'ch1',
    title: 'Перший розділ',
    order: 1,
    content,
    wordCount: 0,
    lastModified: new Date('2026-09-22T00:00:00.000Z').toISOString(),
  } as Section;
}

function bookWith(content: string): Book {
  return {
    id: 'BK-TEST',
    title: 'Тестова книга',
    author: 'Автор',
    genre: 'Роман',
    language: 'uk',
    chapters: [
      {
        id: 'ch1',
        bookId: 'BK-TEST',
        title: 'Частина перша',
        order: 1,
        sections: [section(content)],
      } as Book['chapters'][number],
    ],
    characters: [],
    footnotes: [],
    illustrations: [],
    qrTags: [],
    versionHistory: [],
  } as unknown as Book;
}

console.log('\nТег у тексті: що саме прибирається');
{
  t('тег узагалі є в підготовленому тексті', TAGGED_PARAGRAPH.includes('[/character:Serhii]'));
  t('зняття лишає текст абзацу недоторканим',
    stripEntityTags(TAGGED_PARAGRAPH).includes('Сергій вийшов із будинку, коли біля нього зупинився чорний автомобіль.'));
  t('після зняття в тексті немає жодного «[/»',
    !stripEntityTags(TAGGED_PARAGRAPH).includes('[/'));
}

console.log('\n1. Рушій pdf-lib — toParagraphs:');
{
  const paragraphs = toParagraphs(TAGGED_PARAGRAPH);
  t('абзац лишився один', paragraphs.length === 1, String(paragraphs.length));
  t('у надрукованому абзаці немає тегів',
    !paragraphs.join(' ').includes('[/'), paragraphs[0]?.slice(0, 60));
  t('текст абзацу починається з тексту, а не з пропуску',
    paragraphs[0]?.startsWith('Сергій'), paragraphs[0]?.slice(0, 40));
  t('тег по сусідству зі звичайною текстовою дужкою не ламає текст',
    toParagraphs('[/character:Serhii] Він сказав «привіт».').join('').includes('«привіт»'));
}

console.log('\n2. Markdown-шлях — bookToMarkdown:');
{
  const md = bookToMarkdown(bookWith(TAGGED_PARAGRAPH), { withImages: false, frontmatter: false });
  const all = md.markdown || JSON.stringify(md);
  t('markdown не містить тегів сутностей', !all.includes('[/character'), all.slice(0, 80));
  t('markdown зберіг сам текст абзацу', all.includes('Сергій вийшов із будинку'));
  t('на місці тега не лишилося подвійного пропуску на початку абзацу',
    !/:\s*\n\n\s{2,}Сергій/.test(all));

  // Абзац із самих тегів не має стати порожнім місцем у книзі.
  const onlyTags = bookToMarkdown(bookWith('[/character:Serhii]\n\nСправжній абзац.'), {
    withImages: false,
    frontmatter: false,
  });
  const onlyText = onlyTags.markdown || JSON.stringify(onlyTags);
  t('абзац із самих тегів не лишає по собі порожнього рядка-сліду',
    onlyText.includes('Справжній абзац.') && !onlyText.includes('[/character'));
}

console.log('\n3. Експорт і переддруківка в браузері — renderSectionContentHtml:');
{
  const html = renderSectionContentHtml(TAGGED_PARAGRAPH, bookWith(TAGGED_PARAGRAPH), [], []);
  t('HTML не містить тегів', !html.includes('[/character'), html.slice(0, 80));
  t('HTML містить текст абзацу', html.includes('Сергій вийшов із будинку'));

  const onlyTags = renderSectionContentHtml('[/character:Serhii]', bookWith(''), [], []);
  t('абзац із самих тегів у верстку не потрапляє як порожній рядок',
    stripEntityTags('[/character:Serhii]').trim() === '' && (onlyTags === '' || onlyTags.trim() === ''),
    JSON.stringify(onlyTags));
}

console.log('\n4. DOCX / EPUB / TXT — exportParagraphs:');
{
  /*
   * Це саме те, що раніше було записано рядком «не покривається». Тепер
   * перевіряється тому, що власник попросив знімати теги й у DOCX/TXT:
   * функція — єдина точка, куди дивляться всі три формати.
   */
  const paragraphs = exportParagraphs(TAGGED_PARAGRAPH);
  t('DOCX/EPUB/TXT бачать абзац як текст, а не як текст із тегом',
    paragraphs.length === 1, String(paragraphs.length));
  t('у підготовлених абзацах немає «[/»', !paragraphs.join(' ').includes('[/'));
  t('текст абзацу не втрачено', paragraphs[0]?.includes('Сергій вийшов із будинку') === true);
  t('абзац починається з тексту, а не з пропуску', paragraphs[0]?.startsWith('Сергій') === true);

  // Абзац із самих тегів (типове: автор поставив мітки над новою сценою і ще
  // не написав текст) не має лишити по собі порожній рядок у файлі.
  const onlyTags = exportParagraphs('[/character:Serhii]\n\n[/character:Serhii]\n\nСправжній абзац.');
  t('абзац із самих тегів не стає порожнім рядком у файлі',
    onlyTags.length === 1 && onlyTags[0] === 'Справжній абзац.', JSON.stringify(onlyTags));

  t('порожній вміст не падає і не дає абзаців', exportParagraphs(undefined).length === 0);

  // Та сама «сира» форма тега, яку знімає нормалізація в редакторі: у файлі
  // вона теж не має права лишитися, інакше текст відрізнявся б від PDF.
  t('«сира» форма тега теж не потрапляє у файл',
    exportParagraphs('/character:Serhii Він сказав «привіт».')[0] === 'Він сказав «привіт».');

  /*
   * Текстова версія книги — той фолбек, яким «Експорт» користується, якщо
   * бінарний .docx не зібрався. Власник просив зняти теги й тут.
   */
  const txt = bookToPlainText(bookWith(TAGGED_PARAGRAPH));
  t('TXT не містить тегів сутностей', !txt.includes('[/character'), txt.slice(0, 60));
  t('TXT зберіг текст абзацу', txt.includes('Сергій вийшов із будинку'));
  t('TXT зберіг заголовки глави й розділу',
    txt.includes('ГЛАВА 1: Частина перша') && txt.includes('### Перший розділ'));

  const txtEn = bookToPlainText(bookWith(TAGGED_PARAGRAPH), { isEnglish: true });
  t('англомовний TXT теж без тегів', !txtEn.includes('[/character'));
  t('англомовний TXT каже CHAPTER, а не ГЛАВА', txtEn.includes('CHAPTER 1'));
}

console.log('\n5. Справжні файли DOCX і EPUB — жодного тега в байтах:');
{
  /*
   * ПЕРЕВІРКА НА СПРАВЖНЬОМУ АРТЕФАКТІ, А НЕ НА ФУНКЦІЇ.
   *
   * Секція 4 доводить, що підготовка тексту правильна. Але між «правильна
   * підготовка» і «у файлі немає тега» стоїть ще сам генератор: якщо він бере
   * `sec.content` (наприклад, для колонтитула), тег усе одно потрапить у
   * книгу. Тому тут файли будуються по-справжньому — і розпаковуються.
   *
   * Експортери браузерні (наприкінці вони «клікають» по невидимому `<a>`),
   * тож DOM підмінюється мінімально: нам потрібен лише сам Blob, який
   * приїжджає в `URL.createObjectURL`.
   */
  const captured: Blob[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const originalCreateObjectURL = (g.URL as { createObjectURL?: unknown }).createObjectURL;
  const originalRevokeObjectURL = (g.URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  const originalDocument = g.document;
  (g.URL as Record<string, unknown>).createObjectURL = (blob: Blob) => {
    captured.push(blob);
    return 'blob:nova-test';
  };
  (g.URL as Record<string, unknown>).revokeObjectURL = () => {};
  g.document = {
    createElement: () => ({ click: () => {} }),
    body: { appendChild: () => {}, removeChild: () => {} },
  };

  const zipEntry = async (blob: Blob, path: string): Promise<string> => {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const entry = zip.file(path);
    return entry ? await entry.async('string') : '';
  };

  let docxXml = '';
  let epubChapter = '';
  try {
    await exportBookToDocx(bookWith(TAGGED_PARAGRAPH), { isEnglish: false });
    await exportBookToEpub(bookWith(TAGGED_PARAGRAPH), { isEnglish: false });
    docxXml = await zipEntry(captured[0], 'word/document.xml');
    epubChapter = await zipEntry(captured[1], 'OEBPS/chapter_1.xhtml');
  } finally {
    (g.URL as Record<string, unknown>).createObjectURL = originalCreateObjectURL;
    (g.URL as Record<string, unknown>).revokeObjectURL = originalRevokeObjectURL;
    g.document = originalDocument;
  }

  t('DOCX справді згенеровано (у ньому є word/document.xml)', docxXml.length > 0);
  t('у справжньому .docx немає тегів сутностей', !docxXml.includes('[/character'), docxXml.slice(0, 60));
  t('у справжньому .docx збережено текст абзацу', docxXml.includes('Сергій вийшов із будинку'));

  t('EPUB справді згенеровано (у ньому є chapter_1.xhtml)', epubChapter.length > 0);
  t('у справжньому .epub немає тегів сутностей', !epubChapter.includes('[/character'), epubChapter.slice(0, 60));
  t('у справжньому .epub збережено текст абзацу', epubChapter.includes('Сергій вийшов із будинку'));
}

console.log('\n6. Те, чого цей тест НЕ покриває (щоб не вважати зробленим зайве):');
{
  console.log('  · читання самого кліку завантаження — перевіряється вміст файлу, а не поведінка браузера;');
  console.log('  · курс (server/pdf/bookToMarkdown.ts::courseToMarkdown) — вміст уроків береться з іншого поля;');
  console.log('  · озвучення (NarrationView) — там свій stripManuscriptMarkup, теги сутностей він не знає;');
  console.log('  · реальний PDF файлом — це живий прогін, окремо від модульних перевірок.');
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
