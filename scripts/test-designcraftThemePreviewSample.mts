import assert from 'node:assert/strict';
import { buildDesigncraftThemePreviewSample } from '../server/pdf/designcraft/themePreviewSample';

const source: any = {
  id: 'preview-book',
  title: 'Preview',
  chapters: [{
    id: 'ch1',
    title: 'Chapter',
    sections: [{
      id: 's1',
      title: 'Scene section',
      content: 'Meaningful manuscript text.',
      scene: {
        id: 'scene:with:colon',
        sectionId: 's1',
        title: 'Airlock',
        location: 'Station',
        timeOfDay: '02:47',
        conflict: 'Door locked',
        characters: [],
      },
      customMetadata: { preserved: true },
    }],
  }],
  illustrations: [{ id: 'i1', chapterId: 'ch1', sectionId: 's1' }],
};

const sample = buildDesigncraftThemePreviewSample(source, { charBudget: 1_000, maxChapters: 1 });
const section: any = (sample.book as any).chapters[0].sections[0];

assert.equal(section.id, 's1');
assert.equal(section.content, 'Meaningful manuscript text.');
assert.equal(section.scene.id, 'scene:with:colon');
assert.equal(section.scene.location, 'Station');
assert.equal(section.scene.conflict, 'Door locked');
assert.deepEqual(section.customMetadata, { preserved: true });
assert.equal((sample.book as any).illustrations.length, 1);
assert.deepEqual(sample.sectionIds, ['s1']);

// Sampling must not mutate the source object.
assert.equal(source.chapters[0].sections[0].scene.id, 'scene:with:colon');
assert.equal(source.chapters[0].sections[0].content, 'Meaningful manuscript text.');

console.log('DesignCraft theme preview sample metadata tests passed.');
