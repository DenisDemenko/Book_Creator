/**
 * Сутності ядра в 18 тренажерах майстерності (задача #237).
 *
 * Власник попросив перевірити, чи всі сутності реєстру використовуються в
 * тренажерах, і доповнити вправи там, де ні. Цей тест — сама ця перевірка,
 * тільки постійна: якщо хтось видалить вправу чи перейменує сутність у
 * реєстрі, покриття впаде тут, а не мовчки в інтерфейсі.
 *
 * Запуск: npm run test:mastery-entities
 */
import { SKILLS_DATA } from '../src/data/mastery18.ts';
import { EXERCISE_ENTITY_STEPS, ENTITY_EXERCISES } from '../src/data/masteryEntities.ts';
import { CORE_ENTITIES, CORE_ENTITY_COUNT, entityBySlug, parseEntityTags } from '../src/utils/coreEntities.ts';
import {
  normalizePromptEntities,
  buildCoachEntityInstruction,
  normalizeEntityFeedback,
  buildExerciseEntityInstruction,
  normalizeGeneratedEntities,
} from '../server/masteryEntityPrompt.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const allExercises = SKILLS_DATA.flatMap((s) => s.microExercises.map((ex) => ({ skill: s, ex })));

console.log('\nПокриття реєстру:');
{
  const used = new Set(allExercises.flatMap(({ ex }) => ex.entities || []));
  const missing = CORE_ENTITIES.filter((e) => !used.has(e.slug)).map((e) => e.slug);
  t(`усі ${CORE_ENTITY_COUNT} сутностей задіяні хоча б в одній вправі`, missing.length === 0, missing.join(', ') || `${used.size}/${CORE_ENTITIES.length}`);
  t('у тренажерах немає ключів поза реєстром', [...used].every((slug) => !!entityBySlug(slug)));
  const perSkill = SKILLS_DATA.map((s) => `${s.numberStr}:${s.entities?.length || 0}`);
  t('кожен із 18 тренажерів має власні сутності', SKILLS_DATA.length === 18 && SKILLS_DATA.every((s) => (s.entities?.length || 0) > 0), perSkill.join(' '));
}

console.log('\nВправи:');
{
  t('кожна вправа має сутності й крок розмітки',
    allExercises.every(({ ex }) => (ex.entities?.length || 0) > 0 && !!ex.entityStep?.trim()),
    allExercises.filter(({ ex }) => !ex.entities?.length).map(({ ex }) => ex.id).join(', '));

  const mismatched: string[] = [];
  for (const { ex } of allExercises) {
    const tagged = new Set(parseEntityTags(ex.entityStep || '').map((tag) => tag.entity?.slug).filter(Boolean));
    const declared = new Set(ex.entities || []);
    const lost = [...declared].filter((slug) => !tagged.has(slug));
    const extra = [...tagged].filter((slug) => !declared.has(slug as string));
    if (lost.length || extra.length) mismatched.push(`${ex.id}: без тега ${lost.join('/') || '—'}; зайві ${extra.join('/') || '—'}`);
  }
  t('крок розмітки називає тегом рівно сутності своєї вправи', mismatched.length === 0, mismatched.join('; '));

  const ids = allExercises.map(({ ex }) => ex.id);
  t('id вправ унікальні', new Set(ids).size === ids.length);

  const unknownSteps = Object.keys(EXERCISE_ENTITY_STEPS).filter((id) => !ids.includes(id));
  t('кожне доповнення прив’язане до наявної вправи', unknownSteps.length === 0, unknownSteps.join(', '));

  const base = allExercises.filter(({ ex }) => EXERCISE_ENTITY_STEPS[ex.id]).length;
  const added = Object.values(ENTITY_EXERCISES).flat().length;
  t('наявні 19 вправ доповнено, нові дописано', base === 19 && added > 0, `доповнено ${base}, нових ${added}, разом ${allExercises.length}`);

  t('нові вправи стоять ПІСЛЯ наявних (звичні номери не зсуваються)',
    SKILLS_DATA.every((s) => {
      const firstNew = s.microExercises.findIndex((ex) => !EXERCISE_ENTITY_STEPS[ex.id]);
      return firstNew === -1 || s.microExercises.slice(firstNew).every((ex) => !EXERCISE_ENTITY_STEPS[ex.id]);
    }));

  t('нові вправи повні (назва, завдання, підказка, обмеження)',
    Object.values(ENTITY_EXERCISES).flat().every((ex) => ex.title && ex.task && ex.promptPlaceholder && ex.constraint));
}

console.log('\nЛогіка розподілу (вибірково):');
{
  const has = (skillId: number, slug: string) => !!SKILLS_DATA.find((s) => s.id === skillId)?.entities?.includes(slug);
  t('«Персонажі» — персонаж, мета, потреба, арка', ['character', 'goal', 'need', 'character-arc'].every((s) => has(3, s)));
  t('«Конфлікт» — конфлікт, ставка, перешкода, поріг', ['conflict', 'stake', 'obstacle', 'threshold'].every((s) => has(4, s)));
  t('«Діалоги» — діалог, підтекст, мовний портрет', ['dialogue', 'subtext', 'character-voice'].every((s) => has(7, s)));
  t('«Практична цінність» — курси, інструкції, ігри', ['lesson', 'procedure', 'safety-rule', 'quest'].every((s) => has(6, s)));
  t('«Аргументація» — теза, контраргумент, доказ', ['critical-thesis', 'counterargument', 'evidence'].every((s) => has(13, s)));
  t('«Редагування» — проблеми зв’язності й безперервності, результат правки', ['coherence-issue', 'continuity-issue', 'revision-outcome'].every((s) => has(15, s)));
}

console.log('\nПромпт ШІ-коуча:');
{
  const ents = normalizePromptEntities([{ slug: 'character', nameUk: 'ЗЛАМ ПРОМПТУ' }, 'персонаж', 'value', 'nope', { slug: 'decision' }]);
  t('ключі — з реєстру, назви не з клієнта, повтори й невідомі відкинуто',
    ents.map((e) => e.slug).join(',') === 'character,value,decision' && ents[0].nameUk === 'Персонаж',
    ents.map((e) => `${e.slug}:${e.nameUk}`).join(','));

  const withTags = buildCoachEntityInstruction(ents, 'Позначте [/character:ім’я]', 'Він [/character:Андрій] пішов.');
  t('перелічує сутності вправи з характеристиками', withTags.includes('[/character:…] — Персонаж') && withTags.includes('entityFeedback'));
  t('вимагає зберегти теги в тексті, коли вони є', withTags.includes('зберігай кожен тег БЕЗ ЗМІН'));

  const noEntitiesButTags = buildCoachEntityInstruction([], undefined, 'Уривок із книги [/scene:кухня] …');
  t('уривок книги з тегами без сутностей вправи — правило збереження все одно є',
    noEntitiesButTags.includes('БЕЗ ЗМІН') && !noEntitiesButTags.includes('entityFeedback'));
  t('без сутностей і без тегів — промпт не змінюється', buildCoachEntityInstruction([], undefined, 'Звичайний текст.') === '');

  const fb = normalizeEntityFeedback([
    { slug: 'value', used: true, comment: 'добре' },
    { slug: 'goal', used: true, comment: 'не з цієї вправи' },
    { slug: 'character', used: 'так', comment: 'без тега' },
  ], ents);
  t('розбір коуча — лише сутності вправи, у порядку вправи, used лише булеве true',
    JSON.stringify(fb.map((f) => [f.slug, f.used])) === JSON.stringify([['character', false], ['value', true]]), JSON.stringify(fb));
}

console.log('\nГенератор вправи:');
{
  const skill3 = SKILLS_DATA.find((s) => s.id === 3)!;
  const ents = normalizePromptEntities(skill3.entities);
  t('генератор отримує всі сутності тренажера', ents.length === skill3.entities!.length && buildExerciseEntityInstruction(ents).includes('/goal'));
  const gen = normalizeGeneratedEntities({ entities: ['goal', 'lesson', 'need'], entityStep: 'Позначте [/goal:…] і [/need:…]' }, ents);
  t('згенерована вправа тримає лише сутності свого тренажера', gen.entities.join(',') === 'goal,need', gen.entities.join(','));
  t('без кроку розмітки сутності не приписуються', normalizeGeneratedEntities({ entities: ['goal'] }, ents).entities.length === 0);
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
