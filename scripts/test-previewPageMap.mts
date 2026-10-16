import { buildPreviewChapterMarkers, nearestPreviewChapter } from '../src/utils/previewPageMap';
import type { BookPage } from '../src/utils/helpers';

let pass = 0;
let fail = 0;
const t = (name: string, condition: boolean, detail = '') => {
  condition ? pass++ : fail++;
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const pages: BookPage[] = [
  { type: 'title-page', title: 'Книга' },
  { type: 'toc-page', title: 'Зміст' },
  { type: 'chapter-title', chapterId: 'c1', chapterIndex: 1, title: 'Початок' },
  { type: 'body-page', chapterId: 'c1', sectionId: 's1', title: 'Сцена 1' },
  { type: 'body-page', chapterId: 'c1', sectionId: 's2', title: 'Сцена 2' },
  { type: 'chapter-title', chapterId: 'c2', chapterIndex: 2, title: 'Перелом' },
  { type: 'body-page', chapterId: 'c2', sectionId: 's3', title: 'Сцена 3' },
  { type: 'chapter-title', chapterId: 'c3', chapterIndex: 3, title: 'Фінал' },
];

console.log('Preview page map: chapter markers from measured pages');
const markers = buildPreviewChapterMarkers(pages);
t('знайдено три глави', markers.length === 3, String(markers.length));
t('перша глава на фактичній сторінці 3', markers[0]?.pageNumber === 3, String(markers[0]?.pageNumber));
t('глава на непарній сторінці веде на початок її розвороту', markers[1]?.pageIndex === 5 && markers[1]?.spreadStartPageIndex === 4);
t('остання точка має нормалізовану позицію', markers[2]?.progress === 1, String(markers[2]?.progress));
t('назва глави зберігається', markers[1]?.title === 'Перелом');

console.log('\nPreview page map: current chapter');
t('до першої глави повертається найближча перша мітка', nearestPreviewChapter(markers, 0)?.chapterId === 'c1');
t('в середині першої глави активна c1', nearestPreviewChapter(markers, 4)?.chapterId === 'c1');
t('після title c2 активна c2', nearestPreviewChapter(markers, 6)?.chapterId === 'c2');
t('на фіналі активна c3', nearestPreviewChapter(markers, 7)?.chapterId === 'c3');

console.log('\nPreview page map: edge cases');
t('порожні сторінки → без міток', buildPreviewChapterMarkers([]).length === 0);
t('дубль chapter-title не дублює marker', buildPreviewChapterMarkers([
  { type: 'chapter-title', chapterId: 'c1', title: 'A' },
  { type: 'chapter-title', chapterId: 'c1', title: 'A copy' },
]).length === 1);
t('без marker nearest повертає null', nearestPreviewChapter([], 3) === null);

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
