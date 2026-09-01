/**
 * Тести чистої логіки «густоти втілення персонажа»
 * (src/utils/characterDensity.ts) — суто обчислювана метрика (без AI):
 * обсяг згадувань персонажа в тексті книги + широта охоплення розділів,
 * зважено зведені в оцінку 0..100. Той самий прецедент, що й
 * test-characterMentions.mts (#51): чисті рядкові/масивні обчислення,
 * можна реально перевірити логіку без React/DOM/мережі.
 * Запуск: npm run test:character-density
 */
import type { Book } from '../src/types.ts';
import {
  computeCharacterDensity,
  computeAllCharacterDensities,
  densityLabelForScore,
} from '../src/utils/characterDensity.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

function makeBook(chapterTexts: string[][]): Book {
  // chapterTexts[i] — масив текстів секцій i-того розділу (усі в полі `content`).
  return {
    id: 'book1',
    chapters: chapterTexts.map((sections, ci) => ({
      id: `ch${ci}`,
      title: `Розділ ${ci + 1}`,
      sections: sections.map((text, si) => ({ id: `ch${ci}-s${si}`, title: `Сцена ${si + 1}`, content: text, contentEn: '' })),
    })),
  } as unknown as Book;
}

console.log('\ndensityLabelForScore — межі кошиків:');
{
  t('0 → faint', densityLabelForScore(0) === 'faint');
  t('24 → faint (межа знизу)', densityLabelForScore(24) === 'faint');
  t('25 → sketch (межа зверху)', densityLabelForScore(25) === 'sketch');
  t('49 → sketch', densityLabelForScore(49) === 'sketch');
  t('50 → present', densityLabelForScore(50) === 'present');
  t('74 → present', densityLabelForScore(74) === 'present');
  t('75 → vivid', densityLabelForScore(75) === 'vivid');
  t('100 → vivid', densityLabelForScore(100) === 'vivid');
}

console.log('\ncomputeCharacterDensity — персонаж без жодної згадки:');
{
  const book = makeBook([['Тут про когось іншого.'], ['І тут теж.']]);
  const stats = computeCharacterDensity(book, { id: 'ox', name: 'Оксана' });
  t('totalMentions 0', stats.totalMentions === 0);
  t('chaptersWithMentions 0', stats.chaptersWithMentions === 0);
  t('chapterCoverage 0', stats.chapterCoverage === 0);
  t('score 0', stats.score === 0);
  t('label faint', stats.label === 'faint');
}

console.log('\ncomputeCharacterDensity — персонаж у кожному розділі:');
{
  const book = makeBook([
    ['Оксана прокинулась. Оксана вийшла.'],
    ['Оксана думала про минуле.'],
    ['Оксана дивилась у вікно.'],
  ]);
  const stats = computeCharacterDensity(book, { id: 'ox', name: 'Оксана' });
  t('усі 3 розділи з охопленням', stats.chaptersWithMentions === 3);
  t('охоплення 100%', stats.chapterCoverage === 1);
  t('усього 4 згадки', stats.totalMentions === 4, String(stats.totalMentions));
  t('оцінка вища за 0', stats.score > 0);
}

console.log('\ncomputeCharacterDensity — насичення обсягу згадувань не дає нескінченно рости:');
{
  const manyMentions = Array.from({ length: 100 }, () => 'Оксана.').join(' ');
  const bookFew = makeBook([['Оксана.']]);
  const bookMany = makeBook([[manyMentions]]);
  const few = computeCharacterDensity(bookFew, { id: 'ox', name: 'Оксана' });
  const many = computeCharacterDensity(bookMany, { id: 'ox', name: 'Оксана' });
  t('більше згадувань → вища оцінка', many.score > few.score);

  const evenMoreMentions = Array.from({ length: 500 }, () => 'Оксана.').join(' ');
  const bookEvenMore = makeBook([[evenMoreMentions]]);
  const evenMore = computeCharacterDensity(bookEvenMore, { id: 'ox', name: 'Оксана' });
  t('стеля насичення: далеко за порогом оцінка більше не росте', evenMore.score === many.score, `${evenMore.score} vs ${many.score}`);
}

console.log('\ncomputeCharacterDensity — охоплення переважає над концентрацією в одному розділі:');
{
  const concentrated = makeBook([
    ['Оксана. Оксана. Оксана. Оксана. Оксана.'],
    ['Тут про когось іншого.'],
    ['І тут теж.'],
    ['І тут.'],
  ]);
  const spread = makeBook([
    ['Оксана.'],
    ['Оксана.'],
    ['Оксана.'],
    ['Оксана. Оксана.'],
  ]);
  const concStats = computeCharacterDensity(concentrated, { id: 'ox', name: 'Оксана' });
  const spreadStats = computeCharacterDensity(spread, { id: 'ox', name: 'Оксана' });
  t('однакова кількість згадувань (5) в обох випадках', concStats.totalMentions === 5 && spreadStats.totalMentions === 5);
  t('розсіяний по всій книзі персонаж — вища густота за той самий обсяг', spreadStats.score > concStats.score, `${spreadStats.score} vs ${concStats.score}`);
}

console.log('\ncomputeCharacterDensity — порожня книга (без розділів) не ділить на нуль:');
{
  const book = makeBook([]);
  const stats = computeCharacterDensity(book, { id: 'ox', name: 'Оксана' });
  t('totalChapters 0', stats.totalChapters === 0);
  t('coverage 0, без NaN', stats.chapterCoverage === 0);
  t('score 0, без NaN', stats.score === 0 && !Number.isNaN(stats.score));
}

console.log('\ncomputeAllCharacterDensities — рахує для всіх персонажів одразу:');
{
  const book = makeBook([['Оксана. Марк тут.'], ['Оксана думала.']]);
  const map = computeAllCharacterDensities(book, [
    { id: 'ox', name: 'Оксана' },
    { id: 'mk', name: 'Марк' },
    { id: 'nobody', name: 'Дмитро' },
  ]);
  t('мапа містить усіх трьох персонажів', map.size === 3);
  t('Оксана присутня в обох розділах', map.get('ox')?.chaptersWithMentions === 2);
  t('Марк лише в одному розділі', map.get('mk')?.chaptersWithMentions === 1);
  t('персонаж без згадувань — score 0', map.get('nobody')?.score === 0);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
