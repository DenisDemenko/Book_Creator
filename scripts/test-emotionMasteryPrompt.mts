/**
 * Тести промпту «Емоційна майстерність письменника»
 * (server/emotionMasteryPrompt.ts) і його прописки в реєстрі ядра — той
 * самий прецедент, що й test-readerResponse.mts: шаблон, розбір
 * відповіді, нормалізація, прописка з ОБОХ боків реєстру.
 * Запуск: npm run test:emotion-mastery-prompt
 */
import {
  emotionMasterySystemInstruction,
  factoryEmotionMasteryTemplate,
  renderEmotionMasterySystemTemplate,
  renderEmotionMasteryUserTemplate,
  normalizeEmotionAnalysis,
  parseEmotionMasteryResponse,
  MAX_EMOTION_FRAGMENT_CHARS,
} from '../server/emotionMasteryPrompt.ts';
import { MASTERY_CRITERIA } from '../server/emotionMasteryScoring.ts';
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
  const tpl = factoryEmotionMasteryTemplate();
  t('містить плейсхолдер фрагмента', tpl.includes('{ФРАГМЕНТ}'));
  t('містить плейсхолдер персонажа', tpl.includes('{ПЕРСОНАЖ}'));
  t('системна інструкція несе схему mastery', emotionMasterySystemInstruction().includes('"mastery"'));
  t('системна інструкція перелічує усі 10 критеріїв', MASTERY_CRITERIA.every((c) => emotionMasterySystemInstruction().includes(c)));
  t('системна інструкція несе плейсхолдер мови', emotionMasterySystemInstruction().includes('{МОВА}'));

  const rendered = renderEmotionMasteryUserTemplate(tpl, {
    characterName: 'Марта', fragment: 'Вона стиснула кулаки.', bookTitle: 'Тінь', genre: 'драма',
  });
  t('усі значення підставились', rendered.includes('Марта') && rendered.includes('Вона стиснула') && rendered.includes('Тінь'));
  t('без невитертих плейсхолдерів', !/\{[А-ЯІЇЄҐ_]+\}/.test(rendered));

  const sparse = renderEmotionMasteryUserTemplate(tpl, { characterName: 'Іван', fragment: 'щось' });
  t('відсутні поля отримують запасне значення', sparse.includes('не надано') || sparse.includes('немає'));

  const sys = renderEmotionMasterySystemTemplate(emotionMasterySystemInstruction(), { characterName: 'Іван', fragment: '', locale: 'англійська' });
  t('мова підставляється в системну інструкцію', sys.includes('англійська') && !sys.includes('{МОВА}'));
}

console.log('\nРозбір відповіді моделі:');
{
  t('чистий JSON', parseEmotionMasteryResponse('{"character":"Марта"}').character === 'Марта');
  t('JSON в markdown-обгортці', parseEmotionMasteryResponse('```json\n{"character":"Марта"}\n```').character === 'Марта');
  let threw = false;
  try { parseEmotionMasteryResponse('це не json'); } catch { threw = true; }
  t('сміття кидає помилку, а не тихо проходить', threw);
}

console.log('\nНормалізація результату:');
{
  const raw = {
    character: 'Марта',
    primary_emotion: { name: 'fear', probability: 0.9, intensity: 8 },
    secondary_emotions: [{ name: 'anger', probability: 0.4, intensity: 5 }, { name: 'x', probability: 0.1, intensity: 1 }, { name: 'y' }, { name: 'z' }],
    hidden_emotions: [{ name: 'guilt', probability: 0.3, intensity: 4 }, { name: 'shame' }, { name: 'dropped' }],
    mastery: { trigger: 8, stakes: 15, body: -2 },
    evidence: [
      { criterion: 'trigger', quote: 'вона завмерла', explanation: 'тілесна реакція' },
      { criterion: '', quote: 'без критерію', explanation: 'відкидається' },
    ],
    threshold_impact: 20,
    timeline: [{ emotion: 'тривога', intensity: 3 }, { emotion: 'страх', intensity: 8 }],
    confidence: 1.5,
  };
  const good = normalizeEmotionAnalysis(raw);
  t('character проходить як є', good.character === 'Марта');
  t('primary_emotion розбирається', good.primaryEmotion.name === 'fear' && good.primaryEmotion.intensity === 8);
  t('secondary_emotions обрізані до 3', good.secondaryEmotions.length === 3, String(good.secondaryEmotions.length));
  t('hidden_emotions обрізані до 2', good.hiddenEmotions.length === 2, String(good.hiddenEmotions.length));
  t('mastery.trigger проходить як є', good.mastery.trigger === 8);
  t('mastery.stakes затиснуто до 10', good.mastery.stakes === 10);
  t('mastery.body затиснуто до 0', good.mastery.body === 0);
  t('відсутній критерій mastery падає до 0', good.mastery.subtext === 0);
  t('evidence без criterion відкидається', good.evidence.length === 1, String(good.evidence.length));
  t('threshold_impact затиснуто до 10', good.thresholdImpact === 10);
  t('confidence затиснуто до 1', good.confidence === 1);
  t('timeline проходить', good.timeline.length === 2);

  const empty = normalizeEmotionAnalysis({});
  t('порожня відповідь не кидає виняток і дає нейтральний primary', empty.primaryEmotion.name === 'undefined');
  t('порожня відповідь дає нульові mastery', MASTERY_CRITERIA.every((c) => empty.mastery[c] === 0));
  t('порожня відповідь дає порожні масиви', empty.secondaryEmotions.length === 0 && empty.evidence.length === 0 && empty.timeline.length === 0);

  const malformed = normalizeEmotionAnalysis(null);
  t('null не кидає виняток', malformed.evidence.length === 0);

  const hugeTimeline = normalizeEmotionAnalysis({
    timeline: Array.from({ length: 30 }, (_, i) => ({ emotion: `е${i}`, intensity: 1 })),
  });
  t('timeline обрізаний стелею (20)', hugeTimeline.timeline.length === 20, String(hugeTimeline.timeline.length));
}

console.log('\nПрописка в реєстрі ядра (factory ТА render):');
{
  t('модуль у переліку ключів ядра', (CORE_MODULE_KEYS as readonly string[]).includes('emotionMastery'));
  t('модуль позначений як JSON-схемний', CORE_MODULE_HAS_JSON_SCHEMA.emotionMastery === true);

  const factory = factoryCoreTemplate('emotionMastery');
  t('factory-шаблон несе системну інструкцію модуля', factory.system.includes('емоцій персонажів'));
  t('factory-шаблон несе плейсхолдер фрагмента', factory.user.includes('{ФРАГМЕНТ}'));

  const template = resolveCoreTemplate('emotionMastery');
  const rendered = renderCoreTemplate('emotionMastery', template, {
    characterName: 'Оксана',
    bookTitle: 'Хроніки',
    genre: 'фентезі',
    // форма конструктора шле фрагмент під ключем `selection` — той самий подвійний фолбек, що й у reader-response
    selection: 'Вона заплющила очі.',
    language: 'англійська',
  });
  t('render-шлях реєстру справді підставляє поля (фолбек selection→fragment)', rendered.user.includes('Вона заплющила'));
  t('render-шлях підставляє персонажа', rendered.user.includes('Оксана'));
  t('render-шлях підставляє мову в системну інструкцію', rendered.system.includes('англійська'));

  const resolved = resolveCoreTemplate('emotionMastery', {
    emotionMastery: { system: 'Ти — тонкий аналітик емоцій.', user: 'Персонаж: {ПЕРСОНАЖ}.' },
  });
  t('схема дописується назад до адмінського тексту', resolved.system.includes('"mastery"'));
  t('текст адміна збережено', resolved.system.includes('тонкий аналітик'));
}

console.log('\nМежа символів захищена:');
{
  t('стеля символів визначена і розумна', MAX_EMOTION_FRAGMENT_CHARS > 5_000);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
