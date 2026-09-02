/**
 * Тести модуля «Сила початку» (server/openingStrengthPrompt.ts) —
 * pokraschennya-navychok.md, хвиля 2, задача 8. На відміну від
 * readerResponse/diagn/behaviorDrift цей модуль НЕ реєструється в
 * coreAiRegistry (фіксований чек-лист, а не адмінський тон), тож тестів
 * прописки в реєстрі тут немає — лише промпт, розбір і нормалізація.
 * Запуск: npm run test:opening-strength
 */
import {
  OPENING_STRENGTH_CHECKLIST_ITEMS,
  openingStrengthSystemInstruction,
  buildOpeningStrengthUserPrompt,
  parseOpeningStrengthResponse,
  normalizeOpeningStrengthResult,
  MIN_OPENING_TEXT_CHARS,
  MAX_OPENING_TEXT_CHARS,
} from '../server/openingStrengthPrompt.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nЧек-лист — рівно 4 фіксовані пункти:');
{
  t('рівно 4 пункти', OPENING_STRENGTH_CHECKLIST_ITEMS.length === 4, String(OPENING_STRENGTH_CHECKLIST_ITEMS.length));
  t('id-и відповідають специфікації', OPENING_STRENGTH_CHECKLIST_ITEMS.map((i) => i.id).join(',') === 'conflict,question,promise,emotionalStake');
}

console.log('\nСистемна інструкція та промпт:');
{
  const sys = openingStrengthSystemInstruction('англійська');
  t('несе мову в тексті', sys.includes('англійська'));
  t('несе схему checklist', sys.includes('"checklist"'));
  t('дефолтна мова — українська, коли не вказано', openingStrengthSystemInstruction().includes('українська'));

  const prompt = buildOpeningStrengthUserPrompt({ bookTitle: 'Тіні', genre: 'кіберпанк', logline: 'Герой шукає правду.', text: 'Марк дивився на місто.' });
  t('назва книги підставлена', prompt.includes('Тіні'));
  t('жанр підставлений', prompt.includes('кіберпанк'));
  t('логлайн підставлений', prompt.includes('Герой шукає правду.'));
  t('текст сцени підставлений', prompt.includes('Марк дивився на місто.'));

  const sparse = buildOpeningStrengthUserPrompt({ text: 'Щось.' });
  t('відсутні поля отримують запасне значення', sparse.includes('без назви') && sparse.includes('не вказано'));
}

console.log('\nРозбір відповіді моделі:');
{
  t('чистий JSON', parseOpeningStrengthResponse('{"score":50}').score === 50);
  t('JSON в markdown-обгортці', parseOpeningStrengthResponse('```json\n{"score":50}\n```').score === 50);
  let threw = false;
  try { parseOpeningStrengthResponse('це не json'); } catch { threw = true; }
  t('сміття кидає помилку, а не тихо проходить', threw);
}

console.log('\nНормалізація результату:');
{
  const text = 'Марк дивився на палаюче місто і знав, що вороття немає.';
  const good = normalizeOpeningStrengthResult({
    score: 150, // навмисно поза межами — має обрізатись до 100
    summary: 'Сильний, напружений початок.',
    checklist: [
      { id: 'conflict', present: true, note: 'місто палає', quote: 'Марк дивився на палаюче місто' },
      { id: 'question', present: false, note: 'питання не сформульоване' },
      { id: 'promise', present: true, note: 'обіцяє драму', quote: 'вигадана цитата, якої немає в тексті' },
      { id: 'emotionalStake', present: true, note: 'ставки високі', quote: 'вороття немає' },
      { id: 'ghostField', present: true, note: 'модель вигадала зайвий пункт' },
    ],
  }, text);

  t('score обрізається стелею 100', good.score === 100, String(good.score));
  t('рівно 4 пункти в результаті (зайвий ghostField відкинуто)', good.checklist.length === 4, String(good.checklist.length));
  t('порядок пунктів фіксований', good.checklist.map((c) => c.id).join(',') === 'conflict,question,promise,emotionalStake');
  t('справжня цитата з тексту збережена', good.checklist[0].quote === 'Марк дивився на палаюче місто');
  t('вигадана цитата (якої немає в тексті) відкинута', good.checklist[2].quote === undefined);
  t('цитата для present:false пункту відсутня навіть якщо модель її дала', good.checklist[1].quote === undefined);
  t('present:true передається як є', good.checklist[3].present === true);
  t('present:false передається як є', good.checklist[1].present === false);
  t('note переноситься', good.checklist[0].note === 'місто палає');

  const empty = normalizeOpeningStrengthResult({}, text);
  t('порожня відповідь дає score 0', empty.score === 0);
  t('порожня відповідь дає запасний summary', empty.summary.length > 0);
  t('порожня відповідь усе одно дає 4 пункти, усі present:false', empty.checklist.length === 4 && empty.checklist.every((c) => !c.present));

  const malformed = normalizeOpeningStrengthResult(null, text);
  t('null не кидає виняток', malformed.checklist.length === 4);

  const negativeScore = normalizeOpeningStrengthResult({ score: -30, checklist: [] }, text);
  t('від\'ємний score обрізається до 0', negativeScore.score === 0);
}

console.log('\nМежі символів захищені (400/413, не тихе обрізання чи безмежність):');
{
  t('мінімум розумний (не нуль, не занадто високий)', MIN_OPENING_TEXT_CHARS > 0 && MIN_OPENING_TEXT_CHARS < 1000);
  t('максимум розумний', MAX_OPENING_TEXT_CHARS > MIN_OPENING_TEXT_CHARS);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
