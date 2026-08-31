/**
 * Тести модуля /diagn (diagn-module-tech-spec-v1.0.md).
 * Запуск: npm run test:diagn
 *
 * Що саме стережеться. Картка малює прогрес-бари, радар і кольорові
 * бейджі — тобто перетворює числа моделі на твердження про автора.
 * Відповідь моделі з score 140, порожнім масивом метрик чи severity
 * «критично» замість «high» не викликає жодної помилки: вона просто
 * дає бар довжиною півтора екрана й сірий бейдж без пояснення. Тому
 * тут перевіряється не «чи розібрався JSON», а чи кожне поле схеми має
 * межі й запасне значення.
 */
import {
  parseDiagnCommand,
  countWords,
  normalizeStyleResult,
  normalizeStructureResult,
  normalizeCompetencyResult,
  parseDiagnResponse,
  diagnSystemInstruction,
  factoryDiagnTemplate,
  renderDiagnTemplate,
  COMPETENCY_AXES,
  DIAGN_MODULES,
} from '../server/diagnPrompt.ts';
import { diagnCacheKey } from '../server/diagnStore.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nРозбір команди:');
{
  const a = parseDiagnCommand('/diagn --module=style');
  t('один модуль', a.modules.join() === 'style');
  t('формат за замовчуванням — картка', a.format === 'card');

  const b = parseDiagnCommand('/diagn "Уривок роману..." --module=all --format=pdf');
  t('all розкривається у три модулі', b.modules.join() === 'style,structure,competency');
  t('формат прочитано', b.format === 'pdf');
  t('лапки з тексту знято', b.input === 'Уривок роману...');

  const c = parseDiagnCommand('/diagn doc:manuscript_ch3 --module=structure');
  t('посилання на документ упізнано', c.inputKind === 'document_ref' && c.input === 'doc:manuscript_ch3');
  t('звичайний текст — не документ', parseDiagnCommand('/diagn просто текст').inputKind === 'raw_text');

  t('без прапорців — усі три модулі', parseDiagnCommand('/diagn текст').modules.length === 3);
  t('без слова /diagn теж працює', parseDiagnCommand('текст --module=style').modules.join() === 'style');
  t('кілька модулів через кому', parseDiagnCommand('/diagn --module=style,competency').modules.join() === 'style,competency');
  t('дублікат модуля не задвоюється', parseDiagnCommand('/diagn --module=style,style').modules.length === 1);
  t('регістр не має значення', parseDiagnCommand('/diagn --MODULE=STYLE').modules.join() === 'style');

  // ТЗ §4 вимагає 422 на невідомий модуль — отже, «all» тут заборонено.
  const bad = parseDiagnCommand('/diagn --module=стиль');
  t('невідомий модуль НЕ стає «усі»', bad.modules.length === 0);
  t('невідомий модуль повідомлено', bad.unknownFlags.join() === '--module=стиль');
  const badFmt = parseDiagnCommand('/diagn --format=xls');
  t('невідомий формат відкинуто до картки', badFmt.format === 'card');
  t('невідомий формат повідомлено', badFmt.unknownFlags.length === 1);
  t('чужий прапорець повідомлено', parseDiagnCommand('/diagn --depth=3').unknownFlags.join() === '--depth=3');
  t('прапорці вирізано з тексту', !parseDiagnCommand('/diagn текст --module=style').input.includes('--'));
  t('порожня команда не кидає', parseDiagnCommand('').input === '');
}

console.log('\nПідрахунок слів:');
{
  t('порожньо — нуль', countWords('   ') === 0);
  t('три слова', countWords('одне два три') === 3);
  t('переноси рядків рахуються як розділювач', countWords('одне\n\nдва') === 2);
}

console.log('\nСтиль — нормалізація:');
{
  const r = normalizeStyleResult({
    summary: '  Щільна проза.  ',
    metrics: { sentence_rhythm: { score: 140, label: 'рвана' }, lexical_diversity: { score: -20, label: '' } },
    highlights: [{ excerpt: 'цитата', note: 'нота' }, { excerpt: '', note: 'без цитати' }],
    recommendations: ['раз', '', 'два'],
  });
  t('score понад 100 обрізано', r.metrics.sentence_rhythm.score === 100);
  t('відʼємний score обрізано до нуля', r.metrics.lexical_diversity.score === 0);
  t('відсутня метрика має запасне значення', r.metrics.dialogue_ratio.score === 50);
  t('порожній label підписано', r.metrics.lexical_diversity.label === 'без характеристики');
  t('summary обрізано по краях', r.summary === 'Щільна проза.');
  t('цитата без тексту відкинута', r.highlights.length === 1);
  t('порожні рекомендації відкинуті', r.recommendations.join() === 'раз,два');

  // Найважливіший випадок: модель поля не дала.
  const empty = normalizeStyleResult({});
  t('порожня відповідь не кидає', empty.metrics.sentence_rhythm.score === 50);
  t('відсутній score — 50, а не 0', empty.metrics.dialogue_ratio.score === 50);
  t('null не стає нулем', normalizeStyleResult({ metrics: { sentence_rhythm: { score: null } } }).metrics.sentence_rhythm.score === 50);
  t('score рядком приймається', normalizeStyleResult({ metrics: { sentence_rhythm: { score: '77' } } }).metrics.sentence_rhythm.score === 77);
  t('дробовий score округлено', normalizeStyleResult({ metrics: { sentence_rhythm: { score: 61.6 } } }).metrics.sentence_rhythm.score === 62);
  t('сміття замість масиву не кидає', normalizeStyleResult({ highlights: 'ні' }).highlights.length === 0);
  t('надлишок цитат обрізано до чотирьох',
    normalizeStyleResult({ highlights: Array.from({ length: 9 }, () => ({ excerpt: 'ц', note: 'н' })) }).highlights.length === 4);
}

console.log('\nСтруктура — нормалізація:');
{
  const r = normalizeStructureResult({
    summary: 'Дуга тримається.',
    detected_archetype: 'Польті 33',
    deviations: [
      { type: 'провал', description: 'середина провисає', severity: 'HIGH' },
      { type: 'темп', description: 'затягнуто', severity: 'критично' },
      { type: 'без опису', description: '' },
    ],
  });
  t('severity у верхньому регістрі прийнято', r.deviations[0].severity === 'high');
  t('невідома severity → medium, не «low»', r.deviations[1].severity === 'medium');
  t('відхилення без опису відкинуто', r.deviations.length === 2);
  t('відсутня стадія дуги підписана', r.arc_position === 'не визначено');
  t('відсутній архетип не вигадується', normalizeStructureResult({}).detected_archetype === 'не визначено');
  t('порожня відповідь не кидає', normalizeStructureResult({}).deviations.length === 0);
  t('надлишок відхилень обрізано',
    normalizeStructureResult({ deviations: Array.from({ length: 20 }, () => ({ type: 'т', description: 'о' })) }).deviations.length === 8);
}

console.log('\nКомпетенції — нормалізація:');
{
  const r = normalizeCompetencyResult({
    summary: 'Сильний у діалогах.',
    radar: [{ skill: 'Персонажі', score: 88 }, { skill: 'Вигадана вісь', score: 99 }],
    gaps: ['редактура'],
  });
  t('осей рівно стільки, скільки в карті платформи', r.radar.length === COMPETENCY_AXES.length);
  t('порядок осей сталий', r.radar.map((x) => x.skill).join() === COMPETENCY_AXES.join());
  t('оцінку моделі підхоплено', r.radar.find((x) => x.skill === 'Персонажі')!.score === 88);
  t('чужа вісь не потрапила в радар', !r.radar.some((x) => x.skill === 'Вигадана вісь'));
  t('неоцінена вісь — 50, а не дірка', r.radar.find((x) => x.skill === 'Редактура')!.score === 50);
  t('регістр назви осі не заважає',
    normalizeCompetencyResult({ radar: [{ skill: 'персонажі', score: 70 }] }).radar.find((x) => x.skill === 'Персонажі')!.score === 70);
  t('порожня відповідь дає повний радар', normalizeCompetencyResult({}).radar.length === COMPETENCY_AXES.length);
  t('прогалини збережено', r.gaps.join() === 'редактура');
}

console.log('\nВідповідь моделі:');
{
  t('чистий JSON', parseDiagnResponse('{"a":1}').a === 1);
  t('markdown-огорожу знято', parseDiagnResponse('```json\n{"a":2}\n```').a === 2);
  t('огорожа без назви мови', parseDiagnResponse('```\n{"a":3}\n```').a === 3);
  let threw = false;
  try { parseDiagnResponse('не json'); } catch { threw = true; }
  t('не-JSON кидає, а не мовчить', threw);
}

console.log('\nПромти:');
{
  for (const m of DIAGN_MODULES) {
    t(`${m}: схема в системній інструкції`, diagnSystemInstruction(m).includes('⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ'));
    t(`${m}: заборона markdown у промті`, diagnSystemInstruction(m).toLowerCase().includes('без markdown'));
  }
  const rendered = renderDiagnTemplate(factoryDiagnTemplate('style'), {
    bookTitle: 'Кристал', genre: 'фентезі', fragment: 'ТЕКСТ',
  });
  t('фрагмент підставлено', rendered.includes('ТЕКСТ'));
  t('назву підставлено', rendered.includes('Кристал'));
  t('плейсхолдерів не лишилось', !/\{[А-ЯІЇЄҐ_]+\}/.test(rendered));
  const comp = renderDiagnTemplate(factoryDiagnTemplate('competency'), { fragment: 'Т' });
  t('карта компетенцій підставлена', comp.includes('Мислення') && comp.includes('Автор та розвиток'));
  t('порожня назва книги не лишає дірки', renderDiagnTemplate(factoryDiagnTemplate('style'), { fragment: 'Т' }).includes('без назви'));
}

console.log('\nКлюч кешу:');
{
  const k = (txt: string, mods: any, loc = 'uk') => diagnCacheKey(txt, mods, loc);
  t('той самий вхід — той самий ключ', k('текст', ['style']) === k('текст', ['style']));
  t('інший текст — інший ключ', k('текст', ['style']) !== k('інший', ['style']));
  t('інший склад модулів — інший ключ', k('текст', ['style']) !== k('текст', ['style', 'structure']));
  t('порядок модулів не має значення', k('текст', ['style', 'structure']) === k('текст', ['structure', 'style']));
  t('інша мова — інший ключ', k('текст', ['style'], 'uk') !== k('текст', ['style'], 'en'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
