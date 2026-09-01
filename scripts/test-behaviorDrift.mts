/**
 * Тести модуля «Детектор дрейфу поведінки» (server/behaviorDriftPrompt.ts)
 * і його прописки в реєстрі ядра — той самий прецедент, що й
 * test-characterConsistency.mts (#51): шаблон, розбір відповіді моделі,
 * нормалізація (тут — по одному запису на ЗАЯВЛЕНИЙ патерн, а не довільний
 * список знахідок, як у «Хранителя цілісності»), і перевірка, що модуль
 * реально прописаний з ОБОХ боків реєстру ядра (factory ТА render).
 * Запуск: npm run test:behavior-drift
 */
import {
  behaviorDriftSystemInstruction,
  factoryBehaviorDriftTemplate,
  renderBehaviorDriftSystemTemplate,
  renderBehaviorDriftUserTemplate,
  normalizeDriftResult,
  parseDriftResponse,
} from '../server/behaviorDriftPrompt.ts';
import {
  CORE_MODULE_KEYS,
  CORE_MODULE_HAS_JSON_SCHEMA,
  factoryCoreTemplate,
  resolveCoreTemplate,
  renderCoreTemplate,
} from '../server/coreAiRegistry.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nШаблон:');
{
  const tpl = factoryBehaviorDriftTemplate();
  t('містить плейсхолдер патернів', tpl.includes('{ПАТЕРНИ_ПОВЕДІНКИ}'));
  t('містить плейсхолдер згадувань', tpl.includes('{ЗГАДУВАННЯ_У_КНИЗІ}'));
  t('системна інструкція несе схему patterns', behaviorDriftSystemInstruction().includes('"patterns"'));
  t('системна інструкція несе плейсхолдер мови', behaviorDriftSystemInstruction().includes('{МОВА}'));

  const rendered = renderBehaviorDriftUserTemplate(tpl, {
    name: 'Марк', surname: 'Вальц',
    behaviorPatterns: '1. Дивиться в очі\n2. Говорить коротко',
    mentions: '[Розділ 1 → Сцена]\n…Марк подивився…',
  });
  t('усі значення підставились', rendered.includes('Марк') && rendered.includes('Дивиться в очі'));
  t('без невитертих плейсхолдерів', !/\{[А-ЯІЇЄҐ_]+\}/.test(rendered));

  const sparse = renderBehaviorDriftUserTemplate(tpl, { behaviorPatterns: '', mentions: 'щось' });
  t('відсутні патерни отримують запасне значення', sparse.includes('не задано'));

  const sys = renderBehaviorDriftSystemTemplate(behaviorDriftSystemInstruction(), { behaviorPatterns: '', mentions: '', locale: 'англійська' });
  t('мова підставляється в системну інструкцію', sys.includes('англійська') && !sys.includes('{МОВА}'));
}

console.log('\nРозбір відповіді моделі:');
{
  t('чистий JSON', parseDriftResponse('{"summary":"ок","patterns":[]}').summary === 'ок');
  t('JSON в markdown-обгортці', parseDriftResponse('```json\n{"summary":"ок"}\n```').summary === 'ок');
  let threw = false;
  try { parseDriftResponse('це не json'); } catch { threw = true; }
  t('сміття кидає помилку, а не тихо проходить', threw);
}

console.log('\nНормалізація результату (по одному запису на ЗАЯВЛЕНИЙ патерн):');
{
  const declared = ['Дивиться в очі', 'Говорить коротко', 'Не підвищує голос'];

  const good = normalizeDriftResult({
    summary: 'Персонаж загалом послідовний.',
    patterns: [
      { pattern: 'Дивиться в очі', status: 'consistent', location: 'Розділ 1', quote: 'подивився прямо', note: 'відповідає' },
      { pattern: '', status: 'unknown-garbage', location: '', quote: '', note: 'патерн загублено моделлю' },
      { pattern: 'Не підвищує голос', status: 'drift', location: 'Розділ 5', quote: 'закричав', note: 'явна суперечність' },
    ],
  }, declared);
  t('валідна відповідь проходить як є', good.summary === 'Персонаж загалом послідовний.');
  t('коректна кількість записів (3 патерни → 3 записи)', good.patterns.length === 3);
  t('невідомий статус зводиться до unclear', good.patterns[1].status === 'unclear');
  t('загублений моделлю текст патерну підставляється з ЗАЯВЛЕНОГО списку за позицією', good.patterns[1].pattern === 'Говорить коротко');
  t('drift-статус зберігається як є', good.patterns[2].status === 'drift');

  const empty = normalizeDriftResult({}, declared);
  t('порожня відповідь дає запасний висновок', empty.summary.length > 0);
  t('порожня відповідь дає порожній масив записів (модель нічого не повернула)', empty.patterns.length === 0);

  const malformed = normalizeDriftResult(null, declared);
  t('null не кидає виняток', malformed.patterns.length === 0);

  const huge = normalizeDriftResult({
    summary: 'x',
    patterns: Array.from({ length: 30 }, (_, i) => ({ pattern: `п${i}`, status: 'consistent', location: '', quote: '', note: '' })),
  }, Array.from({ length: 30 }, (_, i) => `п${i}`));
  t('кількість записів обрізана стелею (20)', huge.patterns.length === 20, String(huge.patterns.length));
}

console.log('\nПрописка в реєстрі ядра (factory ТА render):');
{
  t('модуль у переліку ключів ядра', (CORE_MODULE_KEYS as readonly string[]).includes('behaviorDrift'));
  t('модуль позначений як JSON-схемний', CORE_MODULE_HAS_JSON_SCHEMA.behaviorDrift === true);

  const factory = factoryCoreTemplate('behaviorDrift');
  t('factory-шаблон несе системну інструкцію модуля', factory.system.includes('патерн поведінки'));
  t('factory-шаблон несе плейсхолдер патернів', factory.user.includes('{ПАТЕРНИ_ПОВЕДІНКИ}'));

  const template = resolveCoreTemplate('behaviorDrift');
  const rendered = renderCoreTemplate('behaviorDrift', template, {
    characterName: 'Марк',
    characterSurname: 'Вальц',
    behaviorPatterns: '1. Дивиться в очі',
    mentions: '[Розділ 1 → Сцена]\n…Марк…',
    language: 'англійська',
  });
  t('render-шлях реєстру справді підставляє поля', rendered.user.includes('Марк') && rendered.user.includes('Дивиться в очі'));
  t('render-шлях підставляє мову в системну інструкцію', rendered.system.includes('англійська'));

  const resolved = resolveCoreTemplate('behaviorDrift', {
    behaviorDrift: { system: 'Ти — прискіпливий редактор.', user: 'Патерни: {ПАТЕРНИ_ПОВЕДІНКИ}.' },
  });
  t('схема дописується назад до адмінського тексту', resolved.system.includes('"patterns"'));
  t('текст адміна збережено', resolved.system.includes('прискіпливий редактор'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
