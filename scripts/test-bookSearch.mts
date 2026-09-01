/**
 * Тести чистої логіки пошуку/заміни по всій книзі
 * (src/components/BookSearchModal.tsx): екранування спецсимволів регексу
 * (escapeRegExp) і пошук усіх НЕперетинних входжень підрядка
 * (findRanges). Обидві функції — чисті рядкові обчислення без React/DOM,
 * той самий прецедент, що й scripts/test-readability.mts (#49): є
 * можливість реально перевірити логіку, а не лише типізацію й компіляцію.
 * Запуск: npm run test:book-search
 */
import { escapeRegExp, findRanges } from '../src/components/BookSearchModal.tsx';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nЕкранування спецсимволів (escapeRegExp):');
{
  t('крапка екранується', escapeRegExp('a.b') === 'a\\.b');
  {
    const pattern = new RegExp(escapeRegExp('a.b*c?d'));
    t('екранований запит зі спецсимволами regex збігається лише буквально', pattern.test('a.b*c?d'));
    t('той самий запит НЕ трактує "." як "будь-який символ"', !pattern.test('axbxcxd'));
  }
  t(
    'екранований запит як буквальний підрядок у регексі — жодних спецефектів',
    'ціна: 5.99 грн, знижка 5x99'.match(new RegExp(escapeRegExp('5.99'), 'g'))?.length === 1
  );
  t('порожній рядок екранується в порожній рядок', escapeRegExp('') === '');
  t('рядок без спецсимволів лишається незмінним', escapeRegExp('Привіт світ') === 'Привіт світ');
}

console.log('\nПошук неперетинних входжень (findRanges):');
{
  t('запиту нема — жодного діапазону', findRanges('текст', '', true).length === 0);
  t('немає збігів — порожній масив', findRanges('текст', 'xyz', true).length === 0);

  const ranges = findRanges('ababab', 'ab', true);
  t('три неперетинні входження "ab" у "ababab"', ranges.length === 3);
  t('перше входження на позиції [0,2)', ranges[0][0] === 0 && ranges[0][1] === 2);
  t('останнє входження на позиції [4,6)', ranges[2][0] === 4 && ranges[2][1] === 6);

  t(
    'перекривні збіги НЕ рахуються двічі ("аа" у "ааа" — один збіг, а не два)',
    findRanges('ааа', 'аа', true).length === 1
  );

  t('без урахування регістру — знаходить у різних регістрах', findRanges('Привіт ПРИВІТ привіт', 'привіт', false).length === 3);
  t('з урахуванням регістру — лише точний збіг регістру', findRanges('Привіт ПРИВІТ привіт', 'привіт', true).length === 1);

  t('кирилиця так само коректно шукається, як латиниця', findRanges('текст текст текст', 'текст', true).length === 3);

  const single = findRanges('слово', 'слово', true);
  t('запит == весь текст — один збіг на всю довжину', single.length === 1 && single[0][0] === 0 && single[0][1] === 5);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
