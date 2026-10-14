import assert from 'node:assert/strict';
import { emptyCustomBookDesignTheme } from '../src/data/customBookDesignTheme';
import {
  applyDesignerBlockRepeatPolicy,
  resolveRenderableBookDesignBlocks,
  groupRenderableBlocksByPlacement,
} from '../src/data/bookDesignRenderableBlocks';

const theme = emptyCustomBookDesignTheme('Placement test');
theme.customBlocks = [
  { id: 'characters', name: 'Characters', source: 'character', fields: ['name'], style: { entity: 'character', enabled: true, align: 'left' }, placement: 'appendix', repeat: 'per-character' },
  { id: 'scenes', name: 'Scenes', source: 'scene', fields: ['title'], style: { entity: 'scene', enabled: true, align: 'left' }, placement: 'scene-opening', repeat: 'per-scene' },
  { id: 'conflicts', name: 'Conflicts', source: 'conflict', fields: ['character', 'conflict'], style: { entity: 'conflict', enabled: true, align: 'left' }, placement: 'full-width', repeat: 'per-conflict' },
];

const person = (id: string, name: string) => ({ id, name, role: 'ally', biography: '', personality: { strengths: [], weaknesses: [], fears: [], desires: [], goals: [], motivation: '', internalConflict: '' }, appearance: {}, relationships: [], tags: [] });
const book: any = {
  id: 'b1', title: 'Test', characters: [person('c1', 'Ada'), person('c2', 'Leo')],
  chapters: [{ id: 'ch1', order: 1, title: 'Chapter', sections: [{ id: 's1', chapterId: 'ch1', order: 1, title: 'Section', content: 'Text', scene: {
    id: 'scene1', sectionId: 's1', title: 'Bridge', act: 1, summary: '', location: 'Bridge', timeOfDay: 'night', timelineOrder: 1, intensityScore: 7,
    conflict: 'Bridge closed', resolution: '', characters: [
      { characterId: 'c1', goal: 'cross', emotionalState: 'tense', action: '', conflict: '' },
      { characterId: 'c2', goal: 'help', emotionalState: 'calm', action: '', conflict: '' },
    ],
  } }]}],
};

const grouped = groupRenderableBlocksByPlacement(resolveRenderableBookDesignBlocks(book, theme));
assert.equal(grouped.appendix.length, 2);
assert.equal(grouped['scene-opening'].length, 1);
assert.equal(grouped['full-width'].length, 1);
assert.equal(grouped['full-width'][0].fields.conflict, 'Bridge closed');
assert.equal(grouped['full-width'][0].fields.character, undefined);
assert.equal(grouped['full-width'][0].sceneId, 'scene1');
assert.match(grouped['full-width'][0].conflictKey || '', /^scene1:scene:/);

const participantConflictBook: any = {
  ...book,
  chapters: [{
    ...book.chapters[0],
    sections: [{
      ...book.chapters[0].sections[0],
      scene: {
        ...book.chapters[0].sections[0].scene,
        conflict: 'Shared pressure',
        characters: [
          { characterId: 'c1', goal: 'cross', emotionalState: 'tense', action: '', conflict: 'Ada refuses' },
          { characterId: 'c2', goal: 'help', emotionalState: 'calm', action: '', conflict: 'Leo waits' },
        ],
      },
    }],
  }],
};

function conflictBlocks(repeat: 'once' | 'per-scene' | 'per-conflict' | 'matched') {
  const repeatTheme = emptyCustomBookDesignTheme(`Repeat ${repeat}`);
  repeatTheme.customBlocks = [{
    id: 'repeat-conflict',
    name: 'Conflict',
    source: 'conflict',
    fields: ['character', 'conflict'],
    style: { entity: 'conflict', enabled: true, align: 'left' },
    placement: 'scene-opening',
    repeat,
  }];
  return applyDesignerBlockRepeatPolicy(resolveRenderableBookDesignBlocks(participantConflictBook, repeatTheme))
    .filter((block) => block.source === 'conflict');
}

assert.equal(conflictBlocks('matched').length, 2);
assert.equal(conflictBlocks('per-conflict').length, 2);
assert.equal(conflictBlocks('per-scene').length, 1);
assert.equal(conflictBlocks('once').length, 1);

const characterBlocks = applyDesignerBlockRepeatPolicy(resolveRenderableBookDesignBlocks(book, theme))
  .filter((block) => block.source === 'character');
assert.equal(characterBlocks.length, 2);
assert.deepEqual(characterBlocks.map((block) => block.characterId), ['c1', 'c2']);

console.log('Book Design placement + repeat tests passed.');
