/**
 * Тести чистої логіки «/Ім'я героя»+Enter (src/utils/slashTrigger.ts) —
 * задачі #50/#51. Сам перехоплювач Enter (createSlashTriggerHandler у
 * EditorView.tsx) вимагає монтованого TipTap-редактора й тут не
 * тестується — лише винесена логіка пошуку кандидата, зіставлення з
 * персонажем і збору вставних фраз.
 * Запуск: npm run test:slash-trigger
 */
import {
  findSlashCandidate,
  matchCharacterBySlashCandidate,
  collectInsertablePatterns,
  MAX_SLASH_CANDIDATE_LENGTH,
} from '../src/utils/slashTrigger.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nfindSlashCandidate:');
{
  t('знаходить кандидата після останнього «/»', findSlashCandidate('Вона глянула. /Марія')?.candidate === 'Марія');
  t('повертає правильний slashIndex', findSlashCandidate('Вона глянула. /Марія')?.slashIndex === 'Вона глянула. /Марія'.indexOf('/'));
  t('бере ОСТАННІЙ «/», якщо їх кілька', findSlashCandidate('1/2 шляху. /Марія')?.candidate === 'Марія');
  t('null, якщо «/» немає взагалі', findSlashCandidate('Звичайний текст без слешу') === null);
  t('null, якщо після «/» порожньо', findSlashCandidate('Текст /') === null);
  t('null, якщо після «/» лише пробіли', findSlashCandidate('Текст /   ') === null);
  t('обрізає пробіли навколо кандидата', findSlashCandidate('Текст /  Марія  ')?.candidate === 'Марія');
  const long = 'A'.repeat(MAX_SLASH_CANDIDATE_LENGTH + 1);
  t('null, якщо кандидат задовгий (захист від випадкового «/» деінде)', findSlashCandidate(`Текст /${long}`) === null);
  const maxOk = 'A'.repeat(MAX_SLASH_CANDIDATE_LENGTH);
  t('кандидат рівно на межі довжини — приймається', findSlashCandidate(`Текст /${maxOk}`)?.candidate === maxOk);
}

console.log('\nmatchCharacterBySlashCandidate:');
{
  const characters = [
    { id: 'c1', name: 'Марія', surname: 'Вовк' },
    { id: 'c2', name: 'Марк', surname: 'Вальц', alias: 'Тінь' },
    { id: 'c3', name: 'Юля' },
  ];
  t('зіставляє за самим ім\'ям', matchCharacterBySlashCandidate(characters, 'Марія')?.id === 'c1');
  t('зіставляє за «ім\'я прізвище»', matchCharacterBySlashCandidate(characters, 'Марк Вальц')?.id === 'c2');
  t('зіставляє за псевдонімом', matchCharacterBySlashCandidate(characters, 'Тінь')?.id === 'c2');
  t('регістронезалежно', matchCharacterBySlashCandidate(characters, 'марія')?.id === 'c1');
  t('саме ім\'я без прізвища теж зіставляється (форма «ім\'я» — окрема з трьох)', matchCharacterBySlashCandidate(characters, 'Марк')?.id === 'c2');
  t('часткові збіги НЕ зіставляються (не фузі-пошук)', matchCharacterBySlashCandidate(characters, 'Мар') === undefined);
  t('невідоме ім\'я — undefined', matchCharacterBySlashCandidate(characters, 'Хтось Інший') === undefined);
  t('порожній кандидат — undefined', matchCharacterBySlashCandidate(characters, '') === undefined);
  t('персонаж без прізвища не ламає перевірку «ім\'я прізвище»', matchCharacterBySlashCandidate(characters, 'Юля')?.id === 'c3');
}

console.log('\ncollectInsertablePatterns:');
{
  t('плоский список без бібліотеки', JSON.stringify(collectInsertablePatterns({ behaviorPatterns: ['А', 'Б'] })) === JSON.stringify(['А', 'Б']));
  t('лише бібліотека без плоского списку',
    JSON.stringify(collectInsertablePatterns({ behaviorPatternLibrary: [{ trigger: 'question', patterns: ['В', 'Г'] }] })) === JSON.stringify(['В', 'Г']));
  t('обидва джерела об\'єднуються',
    collectInsertablePatterns({ behaviorPatterns: ['А'], behaviorPatternLibrary: [{ trigger: 'question', patterns: ['Б'] }] }).length === 2);
  t('дублікати того самого тексту прибираються',
    collectInsertablePatterns({ behaviorPatterns: ['А'], behaviorPatternLibrary: [{ trigger: 'question', patterns: ['А', 'Б'] }] }).length === 2);
  t('порожній персонаж — порожній масив', collectInsertablePatterns({}).length === 0);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
