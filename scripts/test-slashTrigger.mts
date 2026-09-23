/**
 * Тести чистої логіки слеш-записів (src/utils/slashTrigger.ts) —
 * задачі #50/#51 і #230 (режим діалогів героя). Сам перехоплювач Enter
 * (був `createSlashTriggerHandler` у EditorView.tsx) прибраний рішенням
 * власника 23.09.2026: його замінив тег сутності `/character:Ім'я:діалог`,
 * розбір якого перевіряється тут. Меню (`EntitySlashMenu.tsx`) вимагає
 * монтованого TipTap-редактора, тому перевіряємо саме чисту логіку.
 * Запуск: npm run test:slash-trigger
 */
import {
  findSlashCandidate,
  matchCharacterBySlashCandidate,
  collectInsertablePatterns,
  collectDialogueTemplates,
  parseDialogueSlashSyntax,
  isDialogueModeKeyword,
  dialogueTagValue,
  buildDialogueInsertText,
  DIALOGUE_MODE_KEYWORDS,
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

console.log('\nparseDialogueSlashSyntax — «/character:Ім\'я:діалог»:');
{
  const en = parseDialogueSlashSyntax('/character:Serhii:dialog');
  t('розбирає три сегменти', en?.key === 'character' && en?.heroName === 'Serhii' && en?.modeQuery === 'dialog');
  t('повертає позицію слеша', parseDialogueSlashSyntax('Він сказав. /character:Serhii:діа')?.slashIndex === 'Він сказав. '.length);
  t('український ключ сутності теж працює', parseDialogueSlashSyntax('/персонаж:Сергій:діалог')?.heroName === 'Сергій');
  t('ім\'я з пробілом (ім\'я + прізвище) не рветься',
    parseDialogueSlashSyntax('/character:Сергій Коваль:діалог')?.heroName === 'Сергій Коваль');
  t('незакінчений ключ-режим теж розпізнається (автор ще набирає)',
    parseDialogueSlashSyntax('/character:Сергій:ді')?.modeQuery === 'ді');
  t('ДВА сегменти — не цей запис (звичайний підбір сутності)', parseDialogueSlashSyntax('/character:Сергій') === null);
  t('порожнє ім\'я героя — не запис', parseDialogueSlashSyntax('/character::діалог') === null);
  /*
   * РОЗБІР СИНТАКСИЧНИЙ, ВОРОТА — СЕМАНТИЧНІ. `стор./2:3:4` справді лягає під
   * форму «/ключ:значення:режим» — і це нормально, бо меню відкриває список
   * лише коли ВСІ три умови виконані: ключ є в реєстрі 118 сутностей
   * (`entityBySlug`) і є сутністю «персонаж», а третій сегмент — префікс
   * «діалог». Тут перевіряємо саме другу половину воріт.
   */
  const numeric = parseDialogueSlashSyntax('стор./2:3:4');
  t('«стор./2:3:4» не проходить ворота меню (третій сегмент — не режим діалогу)',
    !!numeric && !isDialogueModeKeyword(numeric.modeQuery));
  t('звичайна характеристика замість режиму теж не відкриває діалоги',
    !isDialogueModeKeyword('характеристика'));
  t('звичайний текст — null', parseDialogueSlashSyntax('Просто речення без слеша') === null);
}

console.log('\nisDialogueModeKeyword:');
{
  t('повний український ключ', isDialogueModeKeyword('діалог'));
  t('повний англійський ключ', isDialogueModeKeyword('dialog'));
  t('префікс під час набору', isDialogueModeKeyword('ді'));
  t('регістр не важливий', isDialogueModeKeyword('ДІАЛОГ'));
  t('порожній сегмент — НЕ режим (інакше ламався б другий крок підбору)', !isDialogueModeKeyword(''));
  t('сегмент із самих пробілів — теж не режим', !isDialogueModeKeyword('   '));
  t('чуже слово — не режим', !isDialogueModeKeyword('репліка'));
  t('усі ключі режиму (укр. + англ.) працюють', DIALOGUE_MODE_KEYWORDS.every((w) => isDialogueModeKeyword(w)));
}

console.log('\ncollectDialogueTemplates — власні діалоги або фолбек:');
{
  t('власні діалоги мають пріоритет',
    JSON.stringify(collectDialogueTemplates({ dialogueTemplates: ['— А', '— Б'], behaviorPatterns: ['дива'] })) === JSON.stringify(['— А', '— Б']));
  t('порожнє поле — падаємо на поведінкові шаблони',
    JSON.stringify(collectDialogueTemplates({ behaviorPatterns: ['дивиться в очі'] })) === JSON.stringify(['дивиться в очі']));
  t('порожні рядки не вважаються діалогами (і не блокують фолбек)',
    JSON.stringify(collectDialogueTemplates({ dialogueTemplates: ['  ', ''], behaviorPatterns: ['патерн'] })) === JSON.stringify(['патерн']));
  t('дублікати прибираються', collectDialogueTemplates({ dialogueTemplates: ['— А', '— А'] }).length === 1);
  t('порожній персонаж — порожній список', collectDialogueTemplates({}).length === 0);
}

console.log('\ndialogueTagValue — перші три слова репліки (рішення власника):');
{
  t('бере три слова', dialogueTagValue('— Ти й досі не віриш мені?') === 'Ти й досі');
  t('провідне тире репліки у значення не входить', !dialogueTagValue('— Привіт').startsWith('—'));
  t('коротша репліка віддається цілком', dialogueTagValue('— Так') === 'Так');
  t('розділові знаки в кінці не лишаються', dialogueTagValue('Привіт, світе!') === 'Привіт, світе');
  t('порожній текст — порожнє значення', dialogueTagValue('   ') === '');
}

console.log('\nbuildDialogueInsertText — те, що лягає в текст:');
{
  const text = buildDialogueInsertText('Сергій', '— Ти й досі не віриш мені?');
  t('є тег героя', text.includes('[/character:Сергій]'));
  t('є тег діалогу з першими трьома словами', text.includes('[/dialogue:Ти й досі]'));
  t('текст репліки збережено', text.includes('— Ти й досі не віриш мені?'));
  t('теги стоять ПЕРЕД текстом', text.indexOf('[/dialogue:') < text.indexOf('— Ти й досі'));
  t('ім\'я з прізвищем лягає в тег героя цілком',
    buildDialogueInsertText('Сергій Коваль', '— Так.').includes('[/character:Сергій Коваль]'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
