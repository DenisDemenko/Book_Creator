/**
 * Тести промпту «Поріг» (server/thresholdPrompt.ts) і його прописки в
 * реєстрі ядра — той самий прецедент, що й test-emotionMasteryPrompt.mts.
 * Запуск: npm run test:threshold-prompt
 */
import {
  thresholdSystemInstruction,
  factoryThresholdTemplate,
  renderThresholdSystemTemplate,
  renderThresholdUserTemplate,
  normalizeThresholdCandidate,
  parseThresholdResponse,
  MAX_THRESHOLD_FRAGMENT_CHARS,
} from '../server/thresholdPrompt.ts';
import { THRESHOLD_TYPES } from '../server/thresholdScoring.ts';
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
  const tpl = factoryThresholdTemplate();
  t('містить плейсхолдер фрагмента', tpl.includes('{ФРАГМЕНТ}'));
  t('містить плейсхолдер персонажа', tpl.includes('{ПЕРСОНАЖ}'));
  t('системна інструкція несе схему is_threshold_candidate', thresholdSystemInstruction().includes('"is_threshold_candidate"'));
  t('системна інструкція перелічує усі 9 типів порогу', THRESHOLD_TYPES.every((tp) => thresholdSystemInstruction().includes(tp)));
  t('системна інструкція несе плейсхолдер мови', thresholdSystemInstruction().includes('{МОВА}'));

  const rendered = renderThresholdUserTemplate(tpl, {
    characterName: 'Данило', fragment: 'Він стояв на межі.', bookTitle: 'Аура', genre: 'трилер',
  });
  t('усі значення підставились', rendered.includes('Данило') && rendered.includes('Він стояв') && rendered.includes('Аура'));
  t('без невитертих плейсхолдерів', !/\{[А-ЯІЇЄҐ_]+\}/.test(rendered));

  const sparse = renderThresholdUserTemplate(tpl, { characterName: 'Ліна', fragment: 'щось' });
  t('відсутні поля отримують запасне значення', sparse.includes('не надано'));

  const sys = renderThresholdSystemTemplate(thresholdSystemInstruction(), { characterName: 'Ліна', fragment: '', locale: 'англійська' });
  t('мова підставляється в системну інструкцію', sys.includes('англійська') && !sys.includes('{МОВА}'));
}

console.log('\nРозбір відповіді моделі:');
{
  t('чистий JSON', parseThresholdResponse('{"is_threshold_candidate":true}').is_threshold_candidate === true);
  t('JSON в markdown-обгортці', parseThresholdResponse('```json\n{"is_threshold_candidate":false}\n```').is_threshold_candidate === false);
  let threw = false;
  try { parseThresholdResponse('це не json'); } catch { threw = true; }
  t('сміття кидає помилку, а не тихо проходить', threw);
}

console.log('\nНормалізація результату:');
{
  const raw = {
    is_threshold_candidate: true,
    character: 'Данило',
    title: 'Стрибок',
    description: 'Опис порогу',
    types: ['physical', 'existential', 'unknown_type', 'moral', 'spiritual'],
    before_state: 'боїться',
    choice: 'стрибає',
    crossing_action: 'дія',
    after_state: 'подолав страх',
    risks: { physical: 15, emotional: -2, social: 5 },
    cost: 20,
    irreversibility: -5,
    transformation: 7,
    awareness: 100,
    agency: 0,
    evidence_quote: 'цитата з тексту',
    confidence: 2,
  };
  const good = normalizeThresholdCandidate(raw);
  t('isThresholdCandidate проходить як true', good.isThresholdCandidate === true);
  t('character проходить як є', good.character === 'Данило');
  t('types обрізані до 3 і фільтрують невідомі', good.types.length === 3 && !good.types.includes('unknown_type' as any), JSON.stringify(good.types));
  t('risks.physical затиснуто до 10', good.risks.physical === 10);
  t('risks.emotional затиснуто до 1', good.risks.emotional === 1);
  t('risks.material без значення падає до 1', good.risks.material === 1);
  t('cost затиснуто до 10', good.cost === 10);
  t('irreversibility затиснуто до 1', good.irreversibility === 1);
  t('awareness затиснуто до 10', good.awareness === 10);
  t('agency затиснуто до 1', good.agency === 1);
  t('confidence затиснуто до 1', good.confidence === 1);
  t('evidenceQuote проходить як є', good.evidenceQuote === 'цитата з тексту');

  const empty = normalizeThresholdCandidate({});
  t('порожня відповідь не кидає виняток', empty.isThresholdCandidate === false);
  t('порожня відповідь дає character "не визначено"', empty.character === 'не визначено');
  t('порожня відповідь дає порожній types', empty.types.length === 0);
  t('порожня відповідь дає нейтральний awareness/agency (5)', empty.awareness === 5 && empty.agency === 5);

  const malformed = normalizeThresholdCandidate(null);
  t('null не кидає виняток', malformed.isThresholdCandidate === false);
}

console.log('\nПрописка в реєстрі ядра (factory ТА render):');
{
  t('модуль у переліку ключів ядра', (CORE_MODULE_KEYS as readonly string[]).includes('threshold'));
  t('модуль позначений як JSON-схемний', CORE_MODULE_HAS_JSON_SCHEMA.threshold === true);

  const factory = factoryCoreTemplate('threshold');
  t('factory-шаблон несе системну інструкцію модуля', factory.system.includes('ПОРІГ'));
  t('factory-шаблон несе плейсхолдер фрагмента', factory.user.includes('{ФРАГМЕНТ}'));

  const template = resolveCoreTemplate('threshold');
  const rendered = renderCoreTemplate('threshold', template, {
    characterName: 'Оксана',
    bookTitle: 'Хроніки',
    genre: 'фентезі',
    // форма конструктора шле фрагмент під ключем `selection` — той самий подвійний фолбек
    selection: 'Вона переступила поріг.',
    language: 'англійська',
  });
  t('render-шлях реєстру справді підставляє поля (фолбек selection→fragment)', rendered.user.includes('Вона переступила'));
  t('render-шлях підставляє персонажа', rendered.user.includes('Оксана'));
  t('render-шлях підставляє мову в системну інструкцію', rendered.system.includes('англійська'));

  const resolved = resolveCoreTemplate('threshold', {
    threshold: { system: 'Ти — уважний аналітик порогів.', user: 'Персонаж: {ПЕРСОНАЖ}.' },
  });
  t('схема дописується назад до адмінського тексту', resolved.system.includes('"is_threshold_candidate"'));
  t('текст адміна збережено', resolved.system.includes('уважний аналітик'));
}

console.log('\nМежа символів захищена:');
{
  t('стеля символів визначена і розумна', MAX_THRESHOLD_FRAGMENT_CHARS > 5_000);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
