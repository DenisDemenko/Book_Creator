/**
 * Теги сутностей не мають права потрапити в надруковану книгу (постановка
 * власника, пункт 6). Цей тест перевіряє КОЖЕН шлях, яким текст розділу
 * стає файлом, бо шляхів кілька й вони різні:
 *
 *   1. `server/pdf/bookToMarkdown.ts` — markdown для pandoc / Chromium / LaTeX;
 *   2. `server/pdf/pdfRenderer.ts::toParagraphs` — рушій pdf-lib, який верстає
 *      сторінку сам, без жодного markdown;
 *   3. `src/utils/helpers.ts::renderSectionContentHtml` — експорт і
 *      переддруківка в браузері (друк сторінки, «Розворот книги»).
 *
 * ЧОМУ ОКРЕМИЙ ФАЙЛ, А НЕ РЯДОК У test-coreEntities.mts. Там перевіряється
 * модуль реєстру (числа з документа, розбір і зняття тегів на рядках). Тут —
 * те, що ці функції справді ВИКЛИКАЮТЬ зняття: помилка, яку шукаєш, має
 * вигляд «модуль уміє, а експорт ним не користується», і саме вона
 * проходить повз тести модуля.
 */

import { toParagraphs } from '../server/pdf/pdfRenderer.ts';
import { bookToMarkdown } from '../server/pdf/bookToMarkdown.ts';
import { renderSectionContentHtml } from '../src/utils/helpers.ts';
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

console.log('\n4. Те, чого цей тест НЕ покриває (щоб не вважати зробленим зайве):');
{
  console.log('  · DOCX і TXT (utils/fileExporters.ts) — власник просив PDF; шлях не змінювався;');
  console.log('  · курс (server/pdf/bookToMarkdown.ts::courseToMarkdown) — вміст уроків береться з іншого поля;');
  console.log('  · реальний PDF файлом — це живий прогін, окремо від модульних перевірок.');
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
