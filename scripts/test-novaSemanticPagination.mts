import assert from 'node:assert/strict';
import { buildNovaSemanticPagination } from '../server/pdf/semanticPagination.ts';

const result = buildNovaSemanticPagination({
  totalPages: 12,
  titlePageShown: true,
  tocInsertIndex: 2,
  insertedTocPages: 2,
  chapterStarts: [
    {
      id: 'chapter-1',
      title: 'Глава 1',
      chapterIndex: 1,
      pageIndex: 2,
      sections: [
        { id: 'section-1', title: 'Секція 1', pageIndex: 2 },
        { id: 'section-2', title: 'Секція 2', pageIndex: 4 },
      ],
    },
    {
      id: 'chapter-2',
      title: 'Глава 2',
      chapterIndex: 2,
      pageIndex: 7,
      sections: [],
    },
  ],
});

assert.equal(result.mappingLevel, 'semantic');
assert.equal(result.exportAuthoritative, true);
assert.equal(result.totalPages, 12);
assert.equal(result.pageMap[0].pageType, 'title');
assert.equal(result.pageMap[2].pageType, 'toc');
assert.equal(result.pageMap[3].pageType, 'toc');

// Chapter 1 was composed at index 2 before two TOC pages were inserted.
assert.equal(result.pageMap[4].chapterId, 'chapter-1');
assert.equal(result.pageMap[4].sectionId, 'section-1');
assert.equal(result.pageMap[4].pageType, 'chapter-start');
assert.equal(result.pageMap[4].pageNumber, 5);

assert.equal(result.pageMap[6].sectionId, 'section-2');
assert.equal(result.pageMap[9].chapterId, 'chapter-2');
assert.equal(result.pageMap[9].pageNumber, 10);

console.log('✓ Nova semantic pagination preserves compositor positions after TOC insertion');
