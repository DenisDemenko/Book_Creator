/**
 * Тести чистої логіки пошуку згадувань персонажа в сирому тексті книги
 * (src/utils/characterMentions.ts) — спільна утиліта для «Хранителя
 * цілісності персонажа» (#43) і, далі, детектора дрейфу поведінки (#45)
 * та автоматичного кодексу (#47). Той самий прецедент, що й
 * test-readability.mts (#49) / test-bookSearch.mts (#50): чисті рядкові
 * обчислення без React/ProseMirror/DOM — можна реально перевірити логіку.
 * Запуск: npm run test:character-mentions
 */
import type { Book } from '../src/types.ts';
import {
  escapeRegExp,
  buildNameEntries,
  buildMentionRegex,
  findMentionsInText,
  collectCharacterMentions,
  formatMentionsForPrompt,
} from '../src/utils/characterMentions.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nescapeRegExp:');
{
  t('крапка екранується', escapeRegExp('О.Р') === 'О\\.Р');
  const re = new RegExp(escapeRegExp('Т(е)ст?'));
  t('екрановані спецсимволи збігаються лише буквально', re.test('Т(е)ст?'));
}

console.log('\nbuildNameEntries:');
{
  const entries = buildNameEntries([
    { id: 'c1', name: 'Марк', surname: 'Вальц', alias: 'Грім' },
    { id: 'c2', name: 'Ан' }, // < 3 символів — відкидається
  ]);
  const texts = entries.map((e) => e.text);
  t('ім\'я включено', texts.includes('Марк'));
  t('прізвище включено', texts.includes('Вальц'));
  t('псевдонім включено', texts.includes('Грім'));
  t('комбінація "ім\'я прізвище" включена', texts.includes('Марк Вальц'));
  t('закороткий варіант (<3 символів) відкинуто', !texts.includes('Ан'));
  t('найдовші варіанти йдуть першими', entries[0].text === 'Марк Вальц');

  const dup = buildNameEntries([
    { id: 'c1', name: 'Оксана' },
    { id: 'c2', name: 'Оксана' }, // тезка
  ]);
  t('тезка: рядок належить першому персонажу в списку', dup.filter((e) => e.text === 'Оксана').length === 1 && dup[0].id === 'c1');
}

console.log('\nbuildMentionRegex / findMentionsInText:');
{
  t('порожній список варіантів → null', buildMentionRegex([]) === null);

  const entries = buildNameEntries([{ id: 'c1', name: 'Марк', surname: 'Вальц' }]);
  const text = 'Марк Вальц зайшов у кімнату. Марк подивився у вікно. Це не Маркетинг і не якийсь Вальцман.';
  const ranges = findMentionsInText(text, entries);
  t('довший варіант зʼїдає коротший у тому самому місці', ranges.filter((r) => r.matchedText === 'Марк Вальц').length === 1);
  t('окрема згадка самого імені знайдена', ranges.some((r) => r.matchedText === 'Марк' && r.start > 15));
  t('рівно 2 збіги на весь текст (без хибних у "Маркетинг"/"Вальцман")', ranges.length === 2, String(ranges.length));
  t('жоден збіг не зачіпає "Маркетинг"', !ranges.some((r) => r.matchedText === 'Марк' && text.slice(r.start, r.start + 9) === 'Маркетинг'));
}

console.log('\ncollectCharacterMentions:');
{
  const book = {
    id: 'book1',
    chapters: [
      {
        id: 'ch1',
        title: 'Розділ 1',
        sections: [
          { id: 's1', title: 'Ранок', content: 'Оксана прокинулась рано. Оксана вийшла на балкон.', contentEn: '' },
          { id: 's2', title: 'Вечір', content: 'Оксана дивилась на місто.', contentEn: 'Oksana looked at the city.' },
        ],
      },
      {
        id: 'ch2',
        title: 'Розділ 2',
        sections: [
          { id: 's3', title: 'Зустріч', content: 'Оксана зустріла Марка.', contentEn: '' },
        ],
      },
    ],
  } as unknown as Book;

  const { mentions, totalFound, truncated } = collectCharacterMentions(book, { id: 'ox', name: 'Оксана' });
  t('усі згадки знайдені (обидва мовні поля)', totalFound === 4, String(totalFound));
  t('не обрізано, бо менше стелі', !truncated);
  t('розділ/секція прикріплені до кожної згадки', mentions[0].chapterTitle === 'Розділ 1' && mentions[0].sectionTitle === 'Ранок');
  t('контекст навколо цитати зібраний', mentions[0].quote === 'Оксана');

  const emptyResult = collectCharacterMentions(book, { id: 'nobody', name: 'Дмитро' });
  t('персонаж без згадувань → totalFound 0', emptyResult.totalFound === 0);
  t('персонаж без згадувань → порожній масив mentions', emptyResult.mentions.length === 0);

  const { mentions: capped, totalFound: fullCount, truncated: wasTruncated } = collectCharacterMentions(book, { id: 'ox', name: 'Оксана' }, { maxMentions: 2 });
  t('стеля обрізає вибірку', capped.length === 2);
  t('totalFound лишається чесним (до обрізання)', fullCount === 4);
  t('truncated виставлено', wasTruncated);
}

console.log('\nformatMentionsForPrompt:');
{
  t('порожній список дає читабельну заглушку', formatMentionsForPrompt([]).includes('ще не згадується'));

  const book = {
    id: 'book1',
    chapters: [{ id: 'ch1', title: 'Пролог', sections: [{ id: 's1', title: 'Сцена', content: 'Оксана йшла містом.', contentEn: '' }] }],
  } as unknown as Book;
  const { mentions } = collectCharacterMentions(book, { id: 'ox', name: 'Оксана' });
  const formatted = formatMentionsForPrompt(mentions);
  t('локація вказана перед цитатою', formatted.includes('[Пролог → Сцена]'));
  t('сама цитата присутня', formatted.includes('Оксана'));

  const longMentions = Array.from({ length: 5 }, (_, i) => ({
    chapterId: 'c', chapterTitle: `Розділ ${i}`, sectionId: 's', sectionTitle: 'X',
    field: 'content' as const, start: 0, end: 5, quote: 'X'.repeat(20), before: '', after: '',
  }));
  const capped = formatMentionsForPrompt(longMentions, 50);
  t('жорстка стеля символів обрізає підсумковий текст', capped.length <= 50 + 40 && capped.includes('обрізано'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
