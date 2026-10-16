import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBookPageMap, spreadIndexForPage } from '../src/utils/bookPageMap';
import type { Book } from '../src/types';
import type { BookPage } from '../src/utils/helpers';

const book = {
  chapters: [
    { id: 'c1', title: 'Початок' },
    { id: 'c2', title: 'Поріг' },
    { id: 'c3', title: 'Повернення' },
  ],
} as unknown as Book;

const pages: BookPage[] = [
  { type: 'title-page', title: 'Книга' },
  { type: 'toc-page', title: 'Зміст' },
  { type: 'chapter-title', chapterId: 'c1', chapterIndex: 1, title: 'Початок' },
  { type: 'body-page', chapterId: 'c1', chapterIndex: 1, sectionId: 's1' },
  { type: 'chapter-title', chapterId: 'c2', chapterIndex: 2, title: 'Поріг' },
  { type: 'body-page', chapterId: 'c2', chapterIndex: 2, sectionId: 's2' },
  { type: 'body-page', chapterId: 'c2', chapterIndex: 2, sectionId: 's2' },
  { type: 'chapter-title', chapterId: 'c3', chapterIndex: 3, title: 'Повернення' },
];

const map = buildBookPageMap(book, pages, 'measured-preview');
assert.equal(map.totalPages, 8);
assert.equal(map.chapterMilestones.length, 3);
assert.deepEqual(map.chapterMilestones.map((m) => [m.chapterId, m.pageIndex, m.pageNumber]), [
  ['c1', 2, 3],
  ['c2', 4, 5],
  ['c3', 7, 8],
]);
assert.equal(map.pages[5]?.chapterTitle, 'Поріг');
assert.equal(map.source, 'measured-preview');

assert.equal(spreadIndexForPage(0, 8), 0);
assert.equal(spreadIndexForPage(2, 8), 2);
assert.equal(spreadIndexForPage(7, 8), 6);
assert.equal(spreadIndexForPage(99, 8), 6);

const slider = await readFile(new URL('../src/components/ChapterPaginationSlider.tsx', import.meta.url), 'utf8');
assert.match(slider, /chapterMilestones/);
assert.match(slider, /Глава/);
assert.match(slider, /spreadIndexForPage/);
assert.match(slider, /title=.*стор\./s);

console.log('✓ Book PageMap: chapter milestones, labels and spread snapping');
