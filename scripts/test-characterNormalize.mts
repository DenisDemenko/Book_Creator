/**
 * Тести normalizeCharacter (src/utils/characterNormalize.ts) — захист від
 * краху вкладки «Персонажі», коли AI-згенерований персонаж приходить БЕЗ
 * tags/personality.goals тощо (модель не тримає JSON-схему так строго, як
 * компілятор типу Character вимагає). Запуск: npm run test:character-normalize
 *
 * Чиста функція, без React/DOM — той самий підхід, що для scripts/test-bookText.mts.
 */
import type { Character } from '../src/types.ts';
import { normalizeCharacter, normalizeCharacterOrUndefined } from '../src/utils/characterNormalize.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

/** Мінімальний валідний персонаж — база для «псування» окремих полів у тестах. */
function baseCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    bookId: 'book-1',
    name: 'Тест',
    role: 'protagonist',
    appearance: { height: '180 см' },
    personality: {
      strengths: ['сила'],
      weaknesses: ['слабкість'],
      fears: ['страх'],
      desires: ['бажання'],
      goals: ['мета'],
      motivation: 'мотивація',
      internalConflict: 'конфлікт',
    },
    biography: 'Біографія.',
    relationships: [],
    tags: ['тег'],
    ...overrides,
  } as Character;
}

console.log('\nnormalizeCharacter — коректний персонаж лишається незмінним:');
{
  const valid = baseCharacter();
  const result = normalizeCharacter(valid);
  t('tags той самий масив за значенням', JSON.stringify(result.tags) === JSON.stringify(valid.tags));
  t('personality.goals той самий', JSON.stringify(result.personality.goals) === JSON.stringify(valid.personality.goals));
  t('appearance той самий', JSON.stringify(result.appearance) === JSON.stringify(valid.appearance));
  t('інші поля (name, biography) не чіпаються', result.name === 'Тест' && result.biography === 'Біографія.');
}

console.log('\nnormalizeCharacter — модель зовсім не повернула tags:');
{
  const broken = baseCharacter({ tags: undefined as any });
  const result = normalizeCharacter(broken);
  t('tags стає порожнім масивом, не undefined', Array.isArray(result.tags) && result.tags.length === 0);
}

console.log('\nnormalizeCharacter — tags прийшов рядком, не масивом (реальна модельна помилка):');
{
  const broken = baseCharacter({ tags: 'AI Створено, Ключовий герой' as any });
  const result = normalizeCharacter(broken);
  t('нестроковий tags замінюється на порожній масив (не намагаємось вгадати розбиття)',
    Array.isArray(result.tags) && result.tags.length === 0);
}

console.log('\nnormalizeCharacter — personality відсутній ЦІЛКОМ (найпоширеніший реальний збій):');
{
  const broken = baseCharacter({ personality: undefined as any });
  const result = normalizeCharacter(broken);
  t('personality — об\'єкт, не undefined', typeof result.personality === 'object' && result.personality !== null);
  t('усі масиви особистості — порожні масиви',
    Array.isArray(result.personality.strengths) && Array.isArray(result.personality.weaknesses) &&
    Array.isArray(result.personality.fears) && Array.isArray(result.personality.desires) &&
    Array.isArray(result.personality.goals));
  t('текстові поля особистості — порожні рядки, не undefined',
    result.personality.motivation === '' && result.personality.internalConflict === '');
}

console.log('\nnormalizeCharacter — personality є, але БЕЗ одного поля (goals):');
{
  // Саме цей випадок раніше пролітав повз старий фолбек `data.personality || {дефолт}`
  // у CharactersView.tsx: personality — правдивий об'єкт, фолбек не спрацьовує,
  // а selectedChar.personality.goals.map(...) далі падає на undefined.
  const broken = baseCharacter({
    personality: {
      strengths: ['сила'], weaknesses: ['слабкість'], fears: ['страх'],
      desires: ['бажання'], motivation: 'м', internalConflict: 'к',
    } as any,
  });
  const result = normalizeCharacter(broken);
  t('goals, якого не було, стає порожнім масивом', Array.isArray(result.personality.goals) && result.personality.goals.length === 0);
  t('strengths, яке БУЛО, не зникає', JSON.stringify(result.personality.strengths) === JSON.stringify(['сила']));
}

console.log('\nnormalizeCharacter — appearance відсутній:');
{
  const broken = baseCharacter({ appearance: undefined as any });
  const result = normalizeCharacter(broken);
  t('appearance — порожній об\'єкт, не undefined', typeof result.appearance === 'object' && result.appearance !== null);
}

console.log('\nnormalizeCharacter — relationships відсутній:');
{
  const broken = baseCharacter({ relationships: undefined as any });
  const result = normalizeCharacter(broken);
  t('relationships — порожній масив', Array.isArray(result.relationships) && result.relationships.length === 0);
}

console.log('\nnormalizeCharacterOrUndefined — пропускає відсутнього персонажа (порожня книга):');
{
  t('undefined лишається undefined', normalizeCharacterOrUndefined(undefined) === undefined);
  const result = normalizeCharacterOrUndefined(baseCharacter({ tags: undefined as any }));
  t('справжній персонаж все одно нормалізується', Array.isArray(result?.tags));
}

console.log(`\n${pass} пройдено, ${fail} провалено\n`);
if (fail > 0) process.exit(1);
