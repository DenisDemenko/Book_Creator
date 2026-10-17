import assert from 'node:assert/strict';
import { buildDesigncraftSemanticPagination } from '../server/pdf/designcraftSemanticPagination';

const book = {
  title: 'Test',
  chapters: [
    {
      id: 'ch-1',
      title: 'Chapter One',
      sections: [
        { id: 's-1', title: 'Section A', content: 'a' },
        { id: 's-untitled', content: 'b' },
      ],
    },
    {
      id: 'ch-2',
      title: 'Chapter Two',
      sections: [{ id: 's-2', title: 'Section B', content: 'c' }],
    },
  ],
};

const pagination = buildDesigncraftSemanticPagination({
  book,
  tocEntries: [
    { level: 1, text: 'Chapter One', page: '1' },
    { level: 2, text: 'Section A', page: '2' },
    { level: 1, text: 'Chapter Two', page: 'A-3' },
    { level: 2, text: 'Section B', page: 'A-3' },
  ],
  chapterEntries: [
    { level: 1, text: 'Chapter One', page: '1' },
    { level: 1, text: 'Chapter Two', page: 'A-3' },
  ],
  inspect: {
    pageCount: 5,
    spreads: [
      { pages: [{ index: 0, name: 'i' }, { index: 1, name: 'Contents' }] },
      { pages: [{ index: 2, name: '1' }, { index: 3, name: '2' }] },
      { pages: [{ index: 4, name: 'A-3' }] },
    ],
  },
  titlePageShown: true,
  tocPageIndex: 1,
});

assert.equal(pagination.mappingLevel, 'semantic');
assert.equal(pagination.exportAuthoritative, true);
assert.equal(pagination.pageMap[0].pageType, 'title');
assert.equal(pagination.pageMap[1].pageType, 'toc');
assert.equal(pagination.pageMap[2].chapterId, 'ch-1');
assert.equal(pagination.pageMap[2].isChapterStart, true);
assert.equal(pagination.pageMap[3].sectionId, 's-1');
assert.equal(pagination.pageMap[4].chapterId, 'ch-2');
assert.equal(pagination.pageMap[4].sectionId, 's-2');
assert.equal(pagination.pageMap[4].pageType, 'chapter-start');

console.log('✓ DesignCraft visible page names map through document.inspect to physical indexes');
console.log('✓ section metadata never erases chapter-start on a shared page');
