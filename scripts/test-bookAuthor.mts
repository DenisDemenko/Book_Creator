/**
 * Авторство книги. Запуск: npm run test:book-author
 *
 * Перевіряються рівно ті правила, які потім діють у шапці студії, на
 * обкладинці, в колонтитулах PDF і в картці товару у вітрині — бо всі вони
 * читають одне поле `book.author`.
 *
 * Найважливіше, що тут зафіксовано: СПРАВЖНЬОГО автора не чіпають ніколи.
 * Правка стосується лише службових значень (порожньо / «Невідомий автор» /
 * «Unknown author»), які писав майстер перенесення .docx.
 */
import { isPlaceholderAuthor, resolveBookAuthor, PLACEHOLDER_AUTHORS } from '../src/utils/bookAuthor';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

/** Мінімальна книга: для цих правил потрібні лише три поля. */
const book = (author: string, authorEn?: string, coverAuthor?: string) =>
  ({ author, authorEn, coverConfig: coverAuthor === undefined ? undefined : { authorName: coverAuthor } }) as any;

console.log('Що вважається службовим значенням:');
{
  t('порожній рядок', isPlaceholderAuthor(''));
  t('пробіли замість імені', isPlaceholderAuthor('   '));
  t('«Невідомий автор»', isPlaceholderAuthor('Невідомий автор'));
  t('регістр не має значення', isPlaceholderAuthor('невідомий АВТОР'));
  t('«Unknown author» (англійська)', isPlaceholderAuthor('Unknown author'));
  t('undefined', isPlaceholderAuthor(undefined));
  t('справжнє імʼя — НЕ службове', !isPlaceholderAuthor('Деменко Денис'));
  t('перелік містить три значення', PLACEHOLDER_AUTHORS.length === 3, PLACEHOLDER_AUTHORS.join(' | '));
}

console.log('\nПорядок джерел імені:');
{
  const fromCover = resolveBookAuthor(book('Невідомий автор', '', 'Деменко Денис'), 'Денис Деменко');
  t('обкладинка важливіша за імʼя користувача', fromCover?.author === 'Деменко Денис', String(fromCover?.author));

  const fromUser = resolveBookAuthor(book('Невідомий автор'), 'Денис Деменко');
  t('без обкладинки береться імʼя користувача', fromUser?.author === 'Денис Деменко', String(fromUser?.author));

  const coverPlaceholder = resolveBookAuthor(book('Невідомий автор', '', 'Невідомий автор'), 'Денис Деменко');
  t('службове значення на обкладинці теж пропускається', coverPlaceholder?.author === 'Денис Деменко', String(coverPlaceholder?.author));

  const empty = resolveBookAuthor(book(''), 'Денис Деменко');
  t('порожній автор заповнюється', empty?.author === 'Денис Деменко', String(empty?.author));

  const en = resolveBookAuthor(book('Unknown author'), 'Денис Деменко');
  t('англійське службове значення теж ловиться', en?.author === 'Денис Деменко', String(en?.author));
}

console.log('\nКоли правка НЕ потрібна:');
{
  t('справжній автор лишається як є', resolveBookAuthor(book('Деменко Денис'), 'Інший користувач') === null);
  t('автор «Олександр Радченко» не чіпається', resolveBookAuthor(book('Олександр Радченко'), 'Денис Деменко') === null);
  t('ні обкладинки, ні імені користувача → правки немає', resolveBookAuthor(book('Невідомий автор'), '') === null);
  t('гість без імені → правки немає', resolveBookAuthor(book('Невідомий автор'), null) === null);
}

console.log('\nАнглійське поле:');
{
  const filled = resolveBookAuthor(book('Невідомий автор', '', 'Деменко Денис'), 'Денис Деменко');
  t('порожнє авторEn заповнюється тим самим іменем', filled?.authorEn === 'Деменко Денис', String(filled?.authorEn));

  const preserved = resolveBookAuthor(book('Невідомий автор', 'Denys Demenko'), 'Денис Деменко');
  t('наявний авторEn не перебивається', preserved?.authorEn === 'Denys Demenko', String(preserved?.authorEn));

  const placeholderEn = resolveBookAuthor(book('Невідомий автор', 'Unknown author'), 'Денис Деменко');
  t('службове авторEn замінюється', placeholderEn?.authorEn === 'Денис Деменко', String(placeholderEn?.authorEn));
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
