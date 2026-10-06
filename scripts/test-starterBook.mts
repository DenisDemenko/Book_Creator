/**
 * Стартова книга автора: демо-контент зразка не потрапляє в книгу автора.
 * Запуск: npm run test:starter-book
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Власник побачив у медіатеці нового користувача чужі
 * фото — чотири стокові портрети демо-персонажів: Студія давала новому
 * авторові демо-книгу (`src/data/initialBook.ts`) як його власну. Тому тут
 * перевіряється не «функція повертає книгу», а саме те, що ламалося:
 *   1. галерея медіатеки, зібрана з книги (тими самими джерелами, що й у
 *      `MediaLibraryView`), порожня — жодного демо-фото;
 *   2. демо-тексти (підписи обкладинки, синопсис, підзаголовок) не
 *      переходять у книгу автора;
 *   3. налаштування друку (`layoutConfig`) лишаються — на них спирається
 *      `utils/pageGeometry.ts`, і без них нова книга втратила б формат A5;
 *   4. матеріали, покладені автором ПІСЛЯ очищення (майстер перенесення),
 *      лишаються на місці.
 */
import { buildStarterBook, withoutDemoContent } from '../src/utils/starterBook';
import { initialBookData } from '../src/data/initialBook';
import type { Book } from '../src/types';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

/**
 * Джерела карток галереї — ті самі, що в `MediaLibraryView`: обкладинка,
 * портрети персонажів, ілюстрації. Серверні файли тут ні до чого: у нового
 * автора їх немає.
 */
const gallerySources = (book: Book): string[] => {
  const urls: string[] = [];
  if (book.coverConfig.frontArtUrl) urls.push(book.coverConfig.frontArtUrl);
  book.characters.forEach((c) => {
    if (c.avatarUrl) urls.push(c.avatarUrl);
  });
  (book.illustrations || []).forEach((i) => {
    if (i.url) urls.push(i.url);
  });
  return urls;
};

const NOW = 1_760_000_000_000;
const starter = buildStarterBook({
  bookId: 'BK-TEST-1',
  title: 'Маяк',
  author: 'Денис Деменко',
  role: 'writer',
  now: NOW,
});

console.log('\nМедіатека нового автора порожня:');
{
  t('жодного фото в галереї', gallerySources(starter).length === 0, gallerySources(starter).join(', '));
  t('персонажів немає', starter.characters.length === 0);
  t('ілюстрацій немає', (starter.illustrations || []).length === 0);
  t('обкладинка без зображення', !starter.coverConfig.frontArtUrl && !starter.coverConfig.coverImageUrl);
  t('у книзі немає жодного демо-URL', !JSON.stringify(starter).includes('unsplash.com'));
  t('демо-портретів немає навіть у памʼяті процесу', !JSON.stringify(starter).includes('photo-1534528741775'));
}

console.log('\nКнига — саме цього автора, а не зразка:');
{
  t('назва', starter.title === 'Маяк', starter.title);
  t('автор', starter.author === 'Денис Деменко', starter.author);
  t('підпис обкладинки — назва книги', starter.coverConfig.frontTitle === 'Маяк', starter.coverConfig.frontTitle);
  t('підпис обкладинки — автор', starter.coverConfig.authorName === 'Денис Деменко', starter.coverConfig.authorName);
  t('чужий ISBN зразка прибрано', starter.coverConfig.barcode === '', starter.coverConfig.barcode);
  t('анотації зразка немає', starter.coverConfig.backDescription === '' && starter.coverConfig.authorBio === '');
  t('підзаголовок зразка не перенесено', starter.subtitle === '' && starter.targetAudience === '');
  t('текстів зразка немає', starter.synopsis === '' && starter.logline === '' && starter.theme === '' && starter.genre === '');
}

console.log('\nПорожній аркуш і початкова версія:');
{
  t('одна глава', starter.chapters.length === 1, starter.chapters.map((c) => c.title).join(', '));
  t('один порожній розділ', starter.chapters[0]?.sections.length === 1 && starter.chapters[0].sections[0].content === '');
  t('слова не рахуються', starter.chapters[0]?.sections[0].wordCount === 0);
  t('історія версій — лише власний знімок', starter.versionHistory?.length === 1);
  t('знімок підписано автором і роллю', starter.versionHistory?.[0].authorName === 'Денис Деменко' && starter.versionHistory?.[0].authorRole === 'writer');
  t('демо-знімок зразка не перенесено', starter.versionHistory?.[0].id === `snap-init-${NOW}`, String(starter.versionHistory?.[0].id));
}

console.log('\nЩо лишається зі зразка (свідомо):');
{
  t('налаштування друку A5', starter.layoutConfig.formatPreset === initialBookData.layoutConfig.formatPreset, starter.layoutConfig.formatPreset);
  t('ширина сторінки', starter.layoutConfig.pageWidthMm === initialBookData.layoutConfig.pageWidthMm, String(starter.layoutConfig.pageWidthMm));
  t('стиль зразка як типовий', starter.visualBible.styleName === initialBookData.visualBible.styleName);
  t('візуальна біблія привʼязана до нової книги', starter.visualBible.bookId === 'BK-TEST-1' && starter.visualBible.id === `vb-${NOW}`, starter.visualBible.id);
}

console.log('\nЗаглушка чужої книги (запрошення співавтора):');
{
  const stub = withoutDemoContent({ ...initialBookData, id: 'BK-OTHERS', title: 'Маяк — команда', chapters: [] });
  t('медіатека порожня', gallerySources(stub).length === 0);
  t('обкладинка без демо-фото', !stub.coverConfig.coverImageUrl && !stub.coverConfig.frontArtUrl);
  t('назва обкладинки — назва книги автора', stub.coverConfig.frontTitle === 'Маяк — команда', stub.coverConfig.frontTitle);
  t('автора ще не знають — підпис порожній', stub.coverConfig.authorName === '');
  t('глав немає — їх принесе кімната спільної роботи', stub.chapters.length === 0);
}

console.log('\nМатеріали автора, покладені ПІСЛЯ очищення:');
{
  const own = [{ id: 'ill-1', url: 'data:image/png;base64,AAAA', caption: 'Мій малюнок' }] as Book['illustrations'];
  const imported: Book = {
    ...withoutDemoContent(
      { ...initialBookData, id: 'BK-IMP', title: 'Перенесена', author: 'Автор' },
      { title: 'Перенесена', author: 'Автор' }
    ),
    illustrations: own,
  };
  t('перенесені ілюстрації на місці', (imported.illustrations || []).length === 1);
  t('галерея показує лише їх', gallerySources(imported).join(',') === 'data:image/png;base64,AAAA', gallerySources(imported).join(','));
}

console.log('\nЗразок не мутовано:');
{
  t('персонажі зразка на місці', initialBookData.characters.length === 4, String(initialBookData.characters.length));
  t('обкладинка зразка на місці', initialBookData.coverConfig.coverImageUrl?.includes('unsplash.com') === true);
  t('назва зразка на місці', initialBookData.title === 'Тіні Нео-Києва 2084', initialBookData.title);
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
