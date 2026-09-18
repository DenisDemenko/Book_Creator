/**
 * Тести реєстру типів документа конструктора інструкцій.
 * Запуск: npm run test:instruction-types
 *
 * Головне, що тут стережеться: усі 4 типи мають однаковий каркас розділів
 * (ту саму множину ключів `InstructionSectionKey`) — бо компонент
 * (InstructionBuilderView.tsx) індексує `type.sections[key]` без перевірки
 * на існування; якщо в новому типі забракне ключа, це впаде тільки в
 * браузері при перемиканні на нього, а не одразу.
 */
import {
  INSTRUCTION_TYPES,
  INSTRUCTION_SECTION_ORDER,
  findInstructionType,
} from '../src/data/instructionTypes.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nСклад реєстру:');
{
  t('чотири типи документа', INSTRUCTION_TYPES.length === 4);
  t('ідентифікатори — саме ті чотири розгалуження',
    INSTRUCTION_TYPES.map((x) => x.id).join() === 'assembly,usage,safety,sequence');
  t('ідентифікатори унікальні', new Set(INSTRUCTION_TYPES.map((x) => x.id)).size === 4);
  t('назви карток не порожні', INSTRUCTION_TYPES.every((x) => x.cardTitle.trim().length > 0));
  t('підзаголовки карток не порожні', INSTRUCTION_TYPES.every((x) => x.cardSubtitle.trim().length > 0));
  t('підпис документа — ВЕЛИКИМИ літерами (як у зразку)',
    INSTRUCTION_TYPES.every((x) => x.docBadge === x.docBadge.toUpperCase()));
}

console.log('\nКожен тип покриває всі 9 розділів (жодного undefined при type.sections[key]):');
{
  t('дев\'ять ключів у спільному порядку', INSTRUCTION_SECTION_ORDER.length === 9);
  for (const type of INSTRUCTION_TYPES) {
    const keys = Object.keys(type.sections).sort();
    t(`${type.id}: усі 9 розділів присутні`,
      keys.join() === [...INSTRUCTION_SECTION_ORDER].sort().join(),
      keys.join(', '));
    for (const key of INSTRUCTION_SECTION_ORDER) {
      const labels = type.sections[key];
      t(`${type.id}.${key}: nav і heading не порожні`,
        !!labels && labels.nav.trim().length > 0 && labels.heading.trim().length > 0);
    }
  }
}

console.log('\nПідписи розділів різняться між типами (перемикання типу справді щось міняє):');
{
  const overviewHeadings = new Set(INSTRUCTION_TYPES.map((x) => x.sections.overview.heading));
  t('заголовок розділу 1 унікальний для кожного типу', overviewHeadings.size === 4);
  const stepPrefixes = new Set(INSTRUCTION_TYPES.map((x) => x.stepPrefix));
  t('префікс кроку унікальний для кожного типу', stepPrefixes.size === 4);
  // «База знань» — єдиний розділ, що НАВМИСНО однаковий у всіх типів
  // (спільний дослідницький розділ, не частина самого документа).
  const kbHeadings = new Set(INSTRUCTION_TYPES.map((x) => x.sections.knowledgeBase.heading));
  t('«База знань» однакова у всіх типів (навмисно)', kbHeadings.size === 1 && kbHeadings.has('База знань'));
}

console.log('\nfindInstructionType:');
{
  t('знаходить складання', findInstructionType('assembly').id === 'assembly');
  t('знаходить використання', findInstructionType('usage').id === 'usage');
  t('знаходить техніку безпеки', findInstructionType('safety').id === 'safety');
  t('знаходить послідовність дій', findInstructionType('sequence').id === 'sequence');
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
