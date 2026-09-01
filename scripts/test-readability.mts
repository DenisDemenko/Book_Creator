/**
 * Тести чистої логіки «підсвітки читабельності»
 * (src/components/manuscriptEditor/ReadabilityHighlightPlugin.ts):
 * підрахунок слів (countWords) і пошук діапазонів задовгих речень
 * (findLongSentenceRanges). Обидві функції — чисті рядкові обчислення
 * без ProseMirror-стану чи DOM, тож, на відміну від решти декорацій
 * канви (FocusParagraphPlugin.ts, CharacterMentionPlugin.ts), тут МОЖНА
 * і варто мати юніт-тести без браузера — саме ці тести на етапі
 * розробки зловили реальну помилку (латинський апостроф '\'' не
 * розпізнавався регуляркою, яка мала лише криву лапку '\u2019', тож
 * "don't" рахувалося як два слова).
 * Запуск: npm run test:readability
 */
import { countWords, findLongSentenceRanges } from '../src/components/manuscriptEditor/ReadabilityHighlightPlugin.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

function nWordsUa(n: number): string {
  return Array.from({ length: n }, (_, i) => `слово${i}`).join(' ') + '.';
}

console.log('\nПідрахунок слів (countWords):');
{
  t('порожній рядок — 0 слів', countWords('') === 0);
  t('кирилиця рахується так само, як латиниця', countWords('Привіт світ') === 2);
  t(
    'англійський апострофер та дефіс — одне слово (не розбиває на два)',
    countWords("don't stop believing well-known state-of-the-art") === 5
  );
  t(
    'український апостроф (об\'єднання, з\'їзд) — одне слово, а не два',
    countWords("об'єднання і з'їзд") === 3
  );
}

console.log('\nПошук задовгих речень (findLongSentenceRanges):');
{
  t('короткі речення — жодного діапазону', findLongSentenceRanges('Коротке речення. Ще одне.', 30).length === 0);

  const long = nWordsUa(30);
  const withContext = `Коротко. ${long} Знову коротко.`;
  const ranges = findLongSentenceRanges(withContext, 30);
  t('рівно одне задовге речення серед коротких знайдено', ranges.length === 1);
  if (ranges.length === 1) {
    const [s, e] = ranges[0];
    const slice = withContext.slice(s, e);
    t('діапазон починається з самого речення, а не з пробілу перед ним', slice.startsWith('слово0'));
    t('діапазон закінчується крапкою речення', slice.endsWith('.'));
  }

  const tail = Array.from({ length: 30 }, (_, i) => `слово${i}`).join(' ');
  t(
    'незавершене речення в кінці абзацу (курсор посеред речення) теж підсвічується',
    findLongSentenceRanges(`Коротко. ${tail}`, 30).length === 1
  );

  t('29 слів < порогу 30 — НЕ підсвічується', findLongSentenceRanges(nWordsUa(29), 30).length === 0);
  t('рівно 30 слів = порогу — підсвічується', findLongSentenceRanges(nWordsUa(30), 30).length === 1);

  t(
    'лапки/дужки після знаку оклику не створюють зайвого розриву речення',
    findLongSentenceRanges('Він сказав: «Це працює!» Потім пішов.', 3).length >= 1
  );

  t('порожній текст не кидає помилку', findLongSentenceRanges('', 5).length === 0);
  t('текст із самих пробілів не кидає помилку', findLongSentenceRanges('   ', 5).length === 0);

  const longer = nWordsUa(35);
  const [s, e] = findLongSentenceRanges(longer, 30)[0];
  t('початок/кінець діапазону — коректні індекси в межах рядка', s >= 0 && e <= longer.length && s < e);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
