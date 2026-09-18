/**
 * Тести чистої логіки конструктора інструкцій — порожній документ,
 * відсоток готовності, ім'я файлу експорту, короткі ідентифікатори.
 * Запуск: npm run test:instruction-draft
 *
 * localStorage (loadInstructionDraft/saveInstructionDraft/clearInstructionDraft)
 * тут НЕ тестується — вони тонкі обгортки без власної логіки (той самий
 * підхід, що й TRACK_KEY у ExpressStartView.tsx), а Node-скрипт без DOM не
 * має справжнього localStorage. Тестується лише те, що можна перевірити
 * без браузера: побудова документа й арифметика готовності.
 */
import {
  createEmptyInstruction,
  createEmptyStep,
  instructionCompleteness,
  instructionExportFileName,
  instructionUid,
} from '../src/utils/instructionDraft.ts';
import type { Instruction } from '../src/types.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\ninstructionUid:');
{
  t('має префікс', instructionUid('step').startsWith('step-'));
  t('два виклики поспіль різні', instructionUid('x') !== instructionUid('x'));
}

console.log('\ncreateEmptyStep:');
{
  const s = createEmptyStep();
  t('усі текстові поля порожні', s.title === '' && s.description === '' && s.components === '' && s.toolsResources === '' && s.warning === '' && s.successCriterion === '');
  t('має унікальний id', s.id.length > 0);
  t('два кроки мають різні id', createEmptyStep().id !== createEmptyStep().id);
}

console.log('\ncreateEmptyInstruction:');
{
  const d = createEmptyInstruction('assembly');
  t('тип документа збігається з параметром', d.docType === 'assembly');
  t('назва й опис порожні', d.title === '' && d.description === '');
  t('рівно один порожній рядок комплектації', d.materials.length === 1 && d.materials[0].name === '');
  t('перший рядок комплектації має код "A" (як у зразку)', d.materials[0].code === 'A');
  t('рівно один порожній інструмент', d.tools.length === 1 && d.tools[0] === '');
  t('рівно один порожній пункт безпеки', d.warnings.length === 1 && d.warnings[0] === '');
  t('рівно один порожній крок', d.steps.length === 1);
  t('рівно один порожній пункт фінальної перевірки', d.finalChecks.length === 1 && d.finalChecks[0] === '');
  t('рівно один порожній рядок типових помилок', d.troubleshooting.length === 1 && d.troubleshooting[0].issue === '');
  t('гарантія порожня', d.warranty.period === '' && d.warranty.responsible === '' && d.warranty.notes === '');
  t('база знань порожня (не обов\'язковий розділ)', d.knowledgeBase.length === 0);
  t('updatedAt — валідна ISO-дата', !Number.isNaN(Date.parse(d.updatedAt)));
  t('чотири типи дають різні документи', new Set((['assembly', 'usage', 'safety', 'sequence'] as const).map((x) => createEmptyInstruction(x).docType)).size === 4);
}

console.log('\ninstructionCompleteness — порожній і повний документ:');
{
  const empty = createEmptyInstruction('assembly');
  t('порожній документ — 0%', instructionCompleteness(empty) === 0);

  const full: Instruction = {
    ...empty,
    title: 'Стіл письмовий',
    description: 'Складання столу з деталей комплекту.',
    materials: [{ id: 'm1', code: 'A', name: 'Стільниця', qty: '1' }],
    tools: ['Шестигранний ключ'],
    warnings: ['Не залишайте дитину без нагляду під час складання.'],
    steps: [{ ...createEmptyStep(), title: 'Кріплення ніжок', description: 'Прикрутіть чотири ніжки до стільниці.' }],
    finalChecks: ['Стіл стійкий, не хитається.'],
    troubleshooting: [{ id: 'i1', issue: 'Ніжка хитається', cause: 'Недокручений гвинт', action: 'Докрутити гвинт' }],
    warranty: { period: '12 місяців', responsible: '', notes: '' },
  };
  t('повністю заповнений документ — 100%', instructionCompleteness(full) === 100);
}

console.log('\ninstructionCompleteness — кожна перевірка важить свою частку:');
{
  const base = createEmptyInstruction('assembly');
  const withOverview: Instruction = { ...base, title: 'X', description: 'Y' };
  t('лише розділ 1 заповнено — 1/8 ≈ 13%', instructionCompleteness(withOverview) === Math.round((1 / 8) * 100));

  const withTools: Instruction = { ...base, tools: ['Ключ'] };
  t('лише інструменти заповнено — теж 1/8', instructionCompleteness(withTools) === Math.round((1 / 8) * 100));

  const halfEmptyOverview: Instruction = { ...base, title: 'X', description: '' };
  t('назва без опису — розділ 1 НЕ рахується заповненим', instructionCompleteness(halfEmptyOverview) === 0);

  const onlyWhitespace: Instruction = { ...base, tools: ['   '] };
  t('рядок із самих пробілів не рахується заповненим', instructionCompleteness(onlyWhitespace) === 0);
}

console.log('\ninstructionCompleteness — «База знань» свідомо не входить у розрахунок:');
{
  const base = createEmptyInstruction('assembly');
  const withKbOnly: Instruction = {
    ...base,
    knowledgeBase: [{ id: 'k1', title: 'ДСТУ з безпеки', link: '', excerpt: '' }],
  };
  t('лише база знань заповнена — все одно 0%', instructionCompleteness(withKbOnly) === 0);
}

console.log('\ninstructionExportFileName:');
{
  t('назва документа стає slug + .json', instructionExportFileName({ ...createEmptyInstruction('assembly'), title: 'Стіл письмовий' }) === 'стіл-письмовий.json');
  t('порожня назва — резервне "instruction.json"', instructionExportFileName(createEmptyInstruction('assembly')) === 'instruction.json');
  t('лапки прибираються, а не перетворюються на дефіс', !instructionExportFileName({ ...createEmptyInstruction('assembly'), title: 'Стіл "Прем\'єр"' }).includes('"'));
  t('результат завжди закінчується на .json', instructionExportFileName({ ...createEmptyInstruction('assembly'), title: '!!!' }).endsWith('.json'));
  const longTitle = 'а'.repeat(200);
  t('дуже довга назва обрізається', instructionExportFileName({ ...createEmptyInstruction('assembly'), title: longTitle }).length <= 65);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
