import assert from 'node:assert/strict';
import type { Book } from '../src/types';
import type { BookPage } from '../src/utils/helpers';
import {
  buildCanonicalPageMap,
  buildPhysicalPaginationResult,
  chapterMilestones,
  spreadStartIndexForPage,
} from '../src/utils/canonicalPageMap';

console.log('\nCanonical page map contract:');

const book = {
  chapters: [
    {
      id: 'c1',
      title: 'Початок',
      sections: [{ id: 's1', title: 'Ранок' }],
    },
    {
      id: 'c2',
      title: 'Поворот',
      sections: [{ id: 's2', title: 'Рішення' }],
    },
  ],
} as unknown as Book;

const pages: BookPage[] = [
  { type: 'title-page', title: 'Книга' },
  { type: 'chapter-title', chapterId: 'c1', chapterIndex: 1, title: 'Початок' },
  { type: 'body-page', chapterId: 'c1', chapterIndex: 1, sectionId: 's1', title: 'Ранок', content: 'A' },
  { type: 'body-page', chapterId: 'c1', chapterIndex: 1, sectionId: 's1', title: 'Ранок', content: 'B' },
  { type: 'chapter-title', chapterId: 'c2', chapterIndex: 2, title: 'Поворот' },
  { type: 'body-page', chapterId: 'c2', chapterIndex: 2, sectionId: 's2', title: 'Рішення', content: 'C' },
];

const result = buildCanonicalPageMap(book, pages, {
  id: 'browser-preview',
  label: 'Browser Preview',
  exportAuthoritative: false,
});

assert.equal(result.totalPages, 6);
assert.equal(result.pageMap[1].pageNumber, 2);
assert.equal(result.pageMap[1].pageType, 'chapter-start');
assert.equal(result.pageMap[2].sectionTitle, 'Ранок');
assert.equal(result.exportAuthoritative, false);
assert.equal(result.mappingLevel, 'semantic');
console.log('  ✓ map preserves actual page order and chapter/section identity');

const milestones = chapterMilestones(result);
assert.deepEqual(
  milestones.map((m) => [m.chapterId, m.pageNumber]),
  [['c1', 2], ['c2', 5]],
);
console.log('  ✓ chapter milestones use real page indexes');

assert.equal(spreadStartIndexForPage(0, 6), 0);
assert.equal(spreadStartIndexForPage(1, 6), 0);
assert.equal(spreadStartIndexForPage(4, 6), 4);
assert.equal(spreadStartIndexForPage(5, 6), 4);
assert.equal(spreadStartIndexForPage(99, 6), 4);
console.log('  ✓ page navigation always lands on the correct spread');

const physical = buildPhysicalPaginationResult(100, {
  id: 'nova',
  label: 'Nova',
  exportAuthoritative: true,
});
assert.equal(physical.totalPages, 100);
assert.equal(physical.pageMap.length, 100);
assert.equal(physical.pageMap[72].pageIndex, 72);
assert.equal(physical.pageMap[72].pageNumber, 73);
assert.equal(physical.pageMap[72].chapterId, undefined);
assert.equal(physical.mappingLevel, 'physical-only');
assert.equal(physical.exportAuthoritative, true);
console.log('  ✓ exported physical page 73 stays page 73 without invented chapter semantics');

console.log('\nCanonical page map contract passed.');
