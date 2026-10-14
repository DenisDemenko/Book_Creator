import assert from 'node:assert/strict';
import { bookToPdfInput } from '../server/pdf/pdfFromBook';
import { injectDesigncraftSceneSemantics } from '../server/pdf/designcraft/sceneSemantics';

const book: any = {
  id: 'book-1',
  title: 'Орбіта',
  author: 'Автор',
  layoutConfig: {
    formatPreset: 'A5', pageWidthMm: 148, pageHeightMm: 210,
    margins: { topMm: 15, bottomMm: 15, insideMm: 18, outsideMm: 14, mirrored: false },
    typography: { fontSizePt: 11, lineHeight: 1.45, firstLineIndentMm: 5, paragraphSpacingMm: 0 },
  },
  characters: [],
  illustrations: [],
  chapters: [
    {
      id: 'ch1', title: 'Сигнал', order: 1,
      sections: [
        {
          id: 's1', chapterId: 'ch1', title: 'Шлюз', order: 1, content: 'Марта дивиться на панель.',
          scene: {
            id: 'scene-1', sectionId: 's1', title: 'Шлюз', act: 1,
            summary: 'Аварія.', location: 'Орбітальна станція', timeOfDay: '02:47',
            timelineOrder: 1, intensityScore: 8, conflict: 'Шлюз заблокований', resolution: '', characters: [],
          },
        },
      ],
    },
  ],
};

const neutral = bookToPdfInput(book);
const sciFi = injectDesigncraftSceneSemantics(neutral, book, 'sci-fi');
assert.match(sciFi.chapters[0].sections[0].content, /\[STYLE:LocationTime\]ОРБІТАЛЬНА СТАНЦІЯ · 02:47\[\/STYLE\]/i);
assert.doesNotMatch(sciFi.chapters[0].sections[0].content, /Конфлікт:/);
assert.match(sciFi.chapters[0].sections[0].content, /Марта дивиться на панель\./);

const thriller = injectDesigncraftSceneSemantics(neutral, book, 'thriller');
assert.match(thriller.chapters[0].sections[0].content, /\[STYLE:LocationTime\]ОРБІТАЛЬНА СТАНЦІЯ · 02:47\[\/STYLE\]/i);
assert.match(thriller.chapters[0].sections[0].content, /\[STYLE:Evidence\]Конфлікт: Шлюз заблокований\[\/STYLE\]/);

const classic = injectDesigncraftSceneSemantics(neutral, book, 'classic');
assert.equal(classic.chapters[0].sections[0].content, neutral.chapters[0].sections[0].content);
assert.equal(neutral.chapters[0].sections[0].content, 'Марта дивиться на панель.');

console.log('DesignCraft scene semantic projection tests passed.');
