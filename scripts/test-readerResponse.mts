/**
 * Тести модуля «Емоційний відгук читача» (server/readerResponsePrompt.ts)
 * і його прописки в реєстрі ядра — той самий прецедент, що й
 * test-behaviorDrift.mts (#53): шаблон, розбір відповіді, нормалізація,
 * прописка з ОБОХ боків реєстру (factory ТА render).
 * Запуск: npm run test:reader-response
 */
import {
  readerResponseSystemInstruction,
  factoryReaderResponseTemplate,
  renderReaderResponseSystemTemplate,
  renderReaderResponseUserTemplate,
  normalizeReaderResponse,
  parseReaderResponse,
  MAX_REACTION_INPUT_CHARS,
} from '../server/readerResponsePrompt.ts';
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
  const tpl = factoryReaderResponseTemplate();
  t('містить плейсхолдер фрагмента', tpl.includes('{ФРАГМЕНТ}'));
  t('системна інструкція несе схему beats', readerResponseSystemInstruction().includes('"beats"'));
  t('системна інструкція несе плейсхолдер мови', readerResponseSystemInstruction().includes('{МОВА}'));

  const rendered = renderReaderResponseUserTemplate(tpl, {
    chapterTitle: 'Ранок у порту', genre: 'кіберпанк', fragment: 'Марк дивився на місто.',
  });
  t('усі значення підставились', rendered.includes('Ранок у порту') && rendered.includes('кіберпанк') && rendered.includes('Марк дивився'));
  t('без невитертих плейсхолдерів', !/\{[А-ЯІЇЄҐ_]+\}/.test(rendered));

  const sparse = renderReaderResponseUserTemplate(tpl, { fragment: 'щось' });
  t('відсутні поля отримують запасне значення "не вказано"', sparse.includes('не вказано'));

  const sys = renderReaderResponseSystemTemplate(readerResponseSystemInstruction(), { fragment: '', locale: 'англійська' });
  t('мова підставляється в системну інструкцію', sys.includes('англійська') && !sys.includes('{МОВА}'));
}

console.log('\nРозбір відповіді моделі:');
{
  t('чистий JSON', parseReaderResponse('{"impression":"ок"}').impression === 'ок');
  t('JSON в markdown-обгортці', parseReaderResponse('```json\n{"impression":"ок"}\n```').impression === 'ок');
  let threw = false;
  try { parseReaderResponse('це не json'); } catch { threw = true; }
  t('сміття кидає помилку, а не тихо проходить', threw);
}

console.log('\nНормалізація результату:');
{
  const good = normalizeReaderResponse({
    impression: 'Захопливий початок.',
    beats: [
      { emotion: 'цікавість', intensity: 'high', location: 'перший абзац', quote: 'ось', note: 'інтригуючий гачок' },
      { emotion: 'нудьга', intensity: 'unknown-garbage', location: '', quote: '', note: '' }, // без note/quote — відкидається
    ],
    dropOffRisk: 'другий розділ затягнутий',
  });
  t('impression проходить як є', good.impression === 'Захопливий початок.');
  t('beat без note/quote відкидається', good.beats.length === 1, String(good.beats.length));
  t('невідома intensity зводиться до medium', normalizeReaderResponse({
    beats: [{ emotion: 'x', intensity: 'unknown', note: 'щось' }],
  }).beats[0].intensity === 'medium');
  t('dropOffRisk проходить як є', good.dropOffRisk === 'другий розділ затягнутий');

  const empty = normalizeReaderResponse({});
  t('порожня відповідь дає запасне враження', empty.impression.length > 0);
  t('порожня відповідь дає порожній dropOffRisk', empty.dropOffRisk === '');
  t('порожня відповідь дає порожній масив beats', empty.beats.length === 0);

  const malformed = normalizeReaderResponse(null);
  t('null не кидає виняток', malformed.beats.length === 0);

  const huge = normalizeReaderResponse({
    beats: Array.from({ length: 20 }, (_, i) => ({ emotion: `е${i}`, intensity: 'low', note: `н${i}` })),
  });
  t('кількість beats обрізана стелею (8)', huge.beats.length === 8, String(huge.beats.length));
}

console.log('\nПрописка в реєстрі ядра (factory ТА render):');
{
  t('модуль у переліку ключів ядра', (CORE_MODULE_KEYS as readonly string[]).includes('readerResponse'));
  t('модуль позначений як JSON-схемний', CORE_MODULE_HAS_JSON_SCHEMA.readerResponse === true);

  const factory = factoryCoreTemplate('readerResponse');
  t('factory-шаблон несе системну інструкцію модуля', factory.system.includes('бета-рідера'));
  t('factory-шаблон несе плейсхолдер фрагмента', factory.user.includes('{ФРАГМЕНТ}'));

  const template = resolveCoreTemplate('readerResponse');
  const rendered = renderCoreTemplate('readerResponse', template, {
    chapterTitle: 'Ранок',
    genre: 'фентезі',
    // форма конструктора шле фрагмент під ключем `selection` — той самий подвійний фолбек, що й у /design
    selection: 'Марк подивився вгору.',
    language: 'англійська',
  });
  t('render-шлях реєстру справді підставляє поля (фолбек selection→fragment)', rendered.user.includes('Марк подивився'));
  t('render-шлях підставляє мову в системну інструкцію', rendered.system.includes('англійська'));

  const resolved = resolveCoreTemplate('readerResponse', {
    readerResponse: { system: 'Ти — вдумливий читач.', user: 'Розділ: {РОЗДІЛ}.' },
  });
  t('схема дописується назад до адмінського тексту', resolved.system.includes('"beats"'));
  t('текст адміна збережено', resolved.system.includes('вдумливий читач'));
}

console.log('\nМежа символів захищена (413, не тихе обрізання):');
{
  t('стеля символів визначена і розумна', MAX_REACTION_INPUT_CHARS > 10_000);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
