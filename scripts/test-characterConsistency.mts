/**
 * Тести модуля «Хранитель цілісності персонажа»
 * (server/characterConsistencyPrompt.ts) і його прописки в реєстрі ядра
 * (server/coreAiRegistry.ts) — той самий прецедент, що й
 * test-designLayout.mts: шаблон, розбір відповіді моделі й нормалізація
 * знахідок, плюс перевірка, що новий модуль реально видно з обох боків
 * реєстру (factory ТА render — на відміну від /diagn, де render-side для
 * підмодулів мовчки відсутній; для цього модуля таку діру навмисно не
 * повторено).
 * Запуск: npm run test:character-consistency
 */
import {
  characterConsistencySystemInstruction,
  factoryCharacterConsistencyTemplate,
  renderCharacterConsistencySystemTemplate,
  renderCharacterConsistencyUserTemplate,
  normalizeConsistencyResult,
  parseConsistencyResponse,
  MAX_MENTIONS_CHARS,
} from '../server/characterConsistencyPrompt.ts';
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
  const tpl = factoryCharacterConsistencyTemplate();
  t('містить усі плейсхолдери картки', ['{ІМ_Я}', '{ПРІЗВИЩЕ}', '{ПСЕВДО}', '{РОЛЬ}', '{ВІК}', '{СТАТЬ}', '{ПРОФЕСІЯ}', '{ЗОВНІШНІСТЬ}', '{ХАРАКТЕР}', '{БІОГРАФІЯ}', '{СТОСУНКИ}', '{ПАТЕРНИ_ПОВЕДІНКИ}', '{ЗГАДУВАННЯ_У_КНИЗІ}'].every((p) => tpl.includes(p)));
  t('системна інструкція несе схему findings', characterConsistencySystemInstruction().includes('"findings"'));
  t('системна інструкція несе плейсхолдер мови', characterConsistencySystemInstruction().includes('{МОВА}'));

  const rendered = renderCharacterConsistencyUserTemplate(tpl, {
    name: 'Марк', surname: 'Вальц', alias: 'Грім', role: 'protagonist', age: '32', gender: 'чоловіча',
    profession: 'хакер', appearance: '{"eyes":"карі"}', personality: '{"strengths":["хоробрість"]}',
    biography: 'Виріс у нижніх кварталах.', relationships: 'Олена — союзник', behaviorPatterns: 'Дивиться в очі',
    mentions: '[Розділ 1 → Сцена]\n…Марк подивився…',
  });
  t('усі значення підставились', rendered.includes('Марк') && rendered.includes('Вальц') && rendered.includes('карі') && rendered.includes('хоробрість'));
  t('без невитертих плейсхолдерів', !/\{[А-ЯІЇЄҐ_]+\}/.test(rendered));

  const sparse = renderCharacterConsistencyUserTemplate(tpl, { mentions: 'щось' });
  t('відсутні поля отримують запасні значення, а не порожнечу', sparse.includes('не вказано') && sparse.includes('не описано в картці') && sparse.includes('не задано'));

  const sys = renderCharacterConsistencySystemTemplate(characterConsistencySystemInstruction(), { mentions: '', locale: 'англійська' });
  t('мова підставляється в системну інструкцію', sys.includes('англійська') && !sys.includes('{МОВА}'));
  const sysDefault = renderCharacterConsistencySystemTemplate(characterConsistencySystemInstruction(), { mentions: '' });
  t('мова за замовчуванням — українська', sysDefault.includes('українська'));
}

console.log('\nРозбір відповіді моделі:');
{
  t('чистий JSON', parseConsistencyResponse('{"summary":"ок","findings":[]}').summary === 'ок');
  t('JSON в markdown-обгортці', parseConsistencyResponse('```json\n{"summary":"ок"}\n```').summary === 'ок');
  let threw = false;
  try { parseConsistencyResponse('це не json'); } catch { threw = true; }
  t('сміття кидає помилку, а не тихо проходить', threw);
}

console.log('\nНормалізація результату:');
{
  const good = normalizeConsistencyResult({
    summary: 'Персонаж загалом послідовний.',
    findings: [
      { severity: 'high', field: 'Очі', location: 'Розділ 3', quote: 'сірі очі', issue: 'у картці карі, у тексті сірі' },
      { severity: 'unknown-garbage', field: 'Вік', location: '', quote: '', issue: 'вік не сходиться' },
      { severity: 'low', field: '', location: '', quote: '', issue: 'щось не так, хоч поле не назване' },
      { severity: 'low', field: 'X', location: '', quote: '', issue: '' }, // без issue — відкидається
    ],
  });
  t('валідна відповідь проходить як є', good.summary === 'Персонаж загалом послідовний.');
  t('невідома severity зводиться до medium', good.findings.find((f) => f.field === 'Вік')?.severity === 'medium');
  t('знахідка без issue відкидається', good.findings.length === 3, String(good.findings.length));
  t('поле без значення отримує запасне "загальне"', good.findings.find((f) => f.issue.includes('хоч поле'))?.field === 'загальне');

  const empty = normalizeConsistencyResult({});
  t('порожня відповідь дає запасний висновок', empty.summary.length > 0);
  t('порожня відповідь дає порожній масив знахідок', empty.findings.length === 0);

  const huge = normalizeConsistencyResult({
    summary: 'x',
    findings: Array.from({ length: 30 }, (_, i) => ({ severity: 'low', field: 'f', location: 'l', quote: 'q', issue: `issue${i}` })),
  });
  t('кількість знахідок обрізана стелею', huge.findings.length === 20, String(huge.findings.length));

  const malformed = normalizeConsistencyResult(null);
  t('null не кидає виняток, а дає порожній результат', malformed.findings.length === 0);
}

console.log('\nПрописка в реєстрі ядра (factory ТА render):');
{
  t('модуль у переліку ключів ядра', (CORE_MODULE_KEYS as readonly string[]).includes('characterConsistency'));
  t('модуль позначений як JSON-схемний', CORE_MODULE_HAS_JSON_SCHEMA.characterConsistency === true);

  const factory = factoryCoreTemplate('characterConsistency');
  t('factory-шаблон несе системну інструкцію модуля', factory.system.includes('редактор-фактчекер'));
  t('factory-шаблон несе картку персонажа', factory.user.includes('Картка персонажа'));

  const template = resolveCoreTemplate('characterConsistency');
  const rendered = renderCoreTemplate('characterConsistency', template, {
    characterName: 'Марк',
    characterSurname: 'Вальц',
    appearanceJson: '{"eyes":"карі"}',
    personalityJson: '{"strengths":["хоробрість"]}',
    biography: 'Минуле героя.',
    behaviorPatterns: 'Дивиться в очі',
    mentions: '[Розділ 1 → Сцена]\n…Марк…',
    language: 'англійська',
  });
  t('render-шлях реєстру справді підставляє поля (на відміну від діри в /diagn)', rendered.user.includes('Марк') && rendered.user.includes('карі'));
  t('render-шлях підставляє мову в системну інструкцію', rendered.system.includes('англійська'));

  // Адмін «переписав» системну інструкцію без схеми — вона має повернутись.
  const resolved = resolveCoreTemplate('characterConsistency', {
    characterConsistency: { system: 'Ти — прискіпливий редактор.', user: 'Персонаж: {ІМ_Я}.' },
  });
  t('схема дописується назад до адмінського тексту', resolved.system.includes('"findings"'));
  t('текст адміна збережено', resolved.system.includes('прискіпливий редактор'));
}

console.log('\nМежа символів захищена (413, не тихе обрізання):');
{
  t('стеля символів визначена і розумна', MAX_MENTIONS_CHARS > 10_000);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
