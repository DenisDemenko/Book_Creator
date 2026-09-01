/**
 * Тести модуля «Автоматичний кодекс персонажа» (server/characterCodexPrompt.ts)
 * і його прописки в реєстрі ядра — той самий прецедент, що й
 * test-behaviorDrift.mts (#53)/test-characterConsistency.mts (#51): шаблон,
 * розбір відповіді моделі, нормалізація (тут — довільний список записів,
 * категоризованих і обмежений стелею 40, а не по одному на щось задане
 * заздалегідь), і перевірка, що модуль реально прописаний з ОБОХ боків
 * реєстру ядра (factory ТА render) — на відміну від діри в /diagn.
 * Запуск: npm run test:character-codex
 */
import {
  characterCodexSystemInstruction,
  factoryCharacterCodexTemplate,
  renderCharacterCodexSystemTemplate,
  renderCharacterCodexUserTemplate,
  normalizeCodexResult,
  parseCodexResponse,
} from '../server/characterCodexPrompt.ts';
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
  const tpl = factoryCharacterCodexTemplate();
  t('містить плейсхолдер згадувань', tpl.includes('{ЗГАДУВАННЯ_У_КНИЗІ}'));
  t('містить плейсхолдер імені', tpl.includes('{ІМ_Я}'));
  t('системна інструкція несе схему entries', characterCodexSystemInstruction().includes('"entries"'));
  t('системна інструкція несе плейсхолдер мови', characterCodexSystemInstruction().includes('{МОВА}'));
  t('системна інструкція явно каже, що картка НЕ надається (кодекс лише з тексту)', characterCodexSystemInstruction().includes('картка тобі не надається'));

  const rendered = renderCharacterCodexUserTemplate(tpl, {
    name: 'Марк', surname: 'Вальц', alias: 'Тінь',
    mentions: '[Розділ 1 → Сцена]\n…Марк подивився…',
  });
  t('усі значення підставились', rendered.includes('Марк') && rendered.includes('Тінь'));
  t('без невитертих плейсхолдерів', !/\{[А-ЯІЇЄҐ_]+\}/.test(rendered));

  const sparse = renderCharacterCodexUserTemplate(tpl, { mentions: 'щось' });
  t('відсутній псевдонім не залишає плейсхолдер', !sparse.includes('{ПСЕВДО}'));

  const sys = renderCharacterCodexSystemTemplate(characterCodexSystemInstruction(), { mentions: '', locale: 'англійська' });
  t('мова підставляється в системну інструкцію', sys.includes('англійська') && !sys.includes('{МОВА}'));
}

console.log('\nРозбір відповіді моделі:');
{
  t('чистий JSON', parseCodexResponse('{"summary":"ок","entries":[]}').summary === 'ок');
  t('JSON в markdown-обгортці', parseCodexResponse('```json\n{"summary":"ок"}\n```').summary === 'ок');
  let threw = false;
  try { parseCodexResponse('це не json'); } catch { threw = true; }
  t('сміття кидає помилку, а не тихо проходить', threw);
}

console.log('\nНормалізація результату (довільний перелік записів, категоризований):');
{
  const good = normalizeCodexResult({
    summary: 'Персонаж постає як стриманий шпигун.',
    entries: [
      { category: 'appearance', fact: 'Шрам над лівою бровою', location: 'Розділ 1', quote: 'шрам розсікав брову' },
      { category: 'unknown-garbage', fact: 'Щось незрозуміле', location: '', quote: '' },
      { category: 'relationships', fact: 'Недовіряє колишньому напарнику', location: 'Розділ 5', quote: 'не довіряв йому більше' },
      { category: 'other', fact: '', location: 'Розділ 2', quote: 'без факту' },
    ],
  });
  t('валідна відповідь проходить як є', good.summary === 'Персонаж постає як стриманий шпигун.');
  t('запис без факту (fact) відкидається', good.entries.length === 3, String(good.entries.length));
  t('невідома категорія зводиться до other', good.entries[1].category === 'other');
  t('категорія relationships зберігається як є', good.entries[2].category === 'relationships');

  const empty = normalizeCodexResult({});
  t('порожня відповідь дає запасний підсумок', empty.summary.length > 0);
  t('порожня відповідь дає порожній масив записів', empty.entries.length === 0);

  const malformed = normalizeCodexResult(null);
  t('null не кидає виняток', malformed.entries.length === 0);

  const huge = normalizeCodexResult({
    summary: 'x',
    entries: Array.from({ length: 60 }, (_, i) => ({ category: 'other', fact: `факт ${i}`, location: '', quote: '' })),
  });
  t('кількість записів обрізана стелею (40)', huge.entries.length === 40, String(huge.entries.length));
}

console.log('\nПрописка в реєстрі ядра (factory ТА render):');
{
  t('модуль у переліку ключів ядра', (CORE_MODULE_KEYS as readonly string[]).includes('characterCodex'));
  t('модуль позначений як JSON-схемний', CORE_MODULE_HAS_JSON_SCHEMA.characterCodex === true);

  const factory = factoryCoreTemplate('characterCodex');
  t('factory-шаблон несе системну інструкцію модуля', factory.system.includes('архіваріус'));
  t('factory-шаблон несе плейсхолдер згадувань', factory.user.includes('{ЗГАДУВАННЯ_У_КНИЗІ}'));

  const template = resolveCoreTemplate('characterCodex');
  const rendered = renderCoreTemplate('characterCodex', template, {
    characterName: 'Марк',
    characterSurname: 'Вальц',
    mentions: '[Розділ 1 → Сцена]\n…Марк…',
    language: 'англійська',
  });
  // render-шлях реєстру справді підставляє поля (на відміну від діри в /diagn)
  t('render-шлях реєстру справді підставляє поля', rendered.user.includes('Марк') && rendered.user.includes('Вальц'));
  t('render-шлях підставляє мову в системну інструкцію', rendered.system.includes('англійська'));

  const resolved = resolveCoreTemplate('characterCodex', {
    characterCodex: { system: 'Ти — уважний архіваріус.', user: 'Згадування: {ЗГАДУВАННЯ_У_КНИЗІ}.' },
  });
  t('схема дописується назад до адмінського тексту', resolved.system.includes('"entries"'));
  t('текст адміна збережено', resolved.system.includes('уважний архіваріус'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
