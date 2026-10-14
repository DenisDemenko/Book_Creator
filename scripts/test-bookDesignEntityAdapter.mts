import assert from 'node:assert/strict';
import { emptyCustomBookDesignTheme } from '../src/data/customBookDesignTheme';
import { resolveBookDesignEntityBlocks, summarizeBookDesignEntityBlocks } from '../src/data/bookDesignEntityAdapter';

const theme = emptyCustomBookDesignTheme('Test theme');
theme.customBlocks = [
  {
    id: 'hero-card',
    name: 'Картка героя',
    source: 'character',
    selector: 'Марта',
    fields: ['name', 'goal', 'emotionalState', 'internalConflict'],
    style: { entity: 'character', enabled: true, fontSlot: 'heading', align: 'left' },
  },
  {
    id: 'scene-card',
    name: 'Картка сцени',
    source: 'scene',
    fields: ['title', 'location', 'timeOfDay', 'participants', 'conflict'],
    style: { entity: 'scene', enabled: true, fontSlot: 'heading', align: 'left' },
  },
  {
    id: 'conflict-card',
    name: 'Картка конфлікту',
    source: 'conflict',
    fields: ['character', 'conflict', 'goal', 'intensityScore'],
    style: { entity: 'conflict', enabled: true, fontSlot: 'mono', align: 'left' },
  },
];

const book: any = {
  id: 'book-1',
  title: 'Test',
  characters: [
    {
      id: 'c1',
      name: 'Марта',
      surname: 'Лис',
      role: 'protagonist',
      age: 31,
      gender: 'female',
      profession: 'інженерка',
      biography: 'Працює на орбітальній станції.',
      personality: {
        strengths: [], weaknesses: [], fears: ['втратити команду'], desires: [],
        goals: ['повернути експедицію'], motivation: 'врятувати екіпаж', internalConflict: 'обов’язок проти страху',
      },
      appearance: {}, relationships: [], tags: ['crew'],
    },
  ],
  chapters: [
    {
      id: 'ch1', order: 1, title: 'Перший контакт', sections: [
        {
          id: 's1', chapterId: 'ch1', order: 1, title: 'Шлюз', content: 'Текст.',
          scene: {
            id: 'scene-1', sectionId: 's1', title: 'Закритий шлюз', act: 1,
            summary: 'Команда не може покинути модуль.', location: 'Орбітальна станція', timeOfDay: '02:47',
            timelineOrder: 1, intensityScore: 8, conflict: 'Шлюз заблокований', resolution: 'Марта бере керування вручну',
            characters: [{ characterId: 'c1', goal: 'відкрити шлюз', emotionalState: 'стривожена', action: 'ламає протокол', conflict: 'ризикує екіпажем' }],
          },
        },
      ],
    },
  ],
};

const blocks = resolveBookDesignEntityBlocks(book, theme);
const summary = summarizeBookDesignEntityBlocks(blocks);

assert.equal(summary.character, 1);
assert.equal(summary.scene, 1);
assert.equal(summary.conflict, 1);

const character = blocks.find((block) => block.source === 'character')!;
assert.equal(character.sourceLabel, 'Марта Лис');
assert.equal(character.fields.goal, 'відкрити шлюз');
assert.equal(character.fields.emotionalState, 'стривожена');
assert.equal(character.fields.internalConflict, 'обов’язок проти страху');

const scene = blocks.find((block) => block.source === 'scene')!;
assert.equal(scene.chapterId, 'ch1');
assert.equal(scene.sectionId, 's1');
assert.equal(scene.fields.participants, 'Марта Лис');
assert.equal(scene.fields.location, 'Орбітальна станція');

const conflict = blocks.find((block) => block.source === 'conflict')!;
assert.equal(conflict.fields.character, 'Марта Лис');
assert.equal(conflict.fields.conflict, 'ризикує екіпажем');
assert.equal(conflict.fields.goal, 'відкрити шлюз');
assert.equal(conflict.fields.intensityScore, '8');

console.log('Book Design entity adapter tests passed.');
