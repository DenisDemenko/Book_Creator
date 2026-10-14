import assert from 'node:assert/strict';
import { emptyCustomBookDesignTheme } from '../src/data/customBookDesignTheme';
import { bookToPdfInput, specFromBook } from '../server/pdf/pdfFromBook';
import { applyCustomThemeBlocksToPdfInput } from '../server/pdf/designcraft/customThemeBlocks';
import { buildDesigncraftParagraphStyles } from '../server/pdf/designcraft/styleCommands';

const book: any = {
  id: 'book-placements',
  title: 'Placement test',
  author: 'Author',
  layoutConfig: {},
  characters: [{
    id: 'c1', bookId: 'book-placements', name: 'Марта', surname: 'Лис', role: 'protagonist',
    appearance: {}, personality: { strengths: [], weaknesses: [], fears: [], desires: [], goals: ['врятувати екіпаж'], motivation: '', internalConflict: '' },
    biography: 'Інженерка станції.', relationships: [], tags: [],
  }],
  chapters: [{
    id: 'ch1', title: 'Перший контакт', order: 1, sections: [{
      id: 's1', chapterId: 'ch1', title: 'Шлюз', order: 1, content: 'Основний текст сцени.',
      scene: {
        id: 'scene1', sectionId: 's1', title: 'Закритий шлюз', act: 1, summary: 'Шлюз не відкривається.',
        location: 'Орбіта', timeOfDay: '02:47', timelineOrder: 1, intensityScore: 8,
        conflict: 'Шлюз заблокований', resolution: 'Ручне керування',
        characters: [{ characterId: 'c1', goal: 'відкрити шлюз', emotionalState: 'тривога', action: 'ламає протокол', conflict: 'ризикує екіпажем' }],
      },
    }],
  }],
  illustrations: [],
};

const theme = emptyCustomBookDesignTheme('Placement theme');
theme.basedOn = 'sci-fi';
theme.fonts = theme.fonts.map((asset) =>
  asset.slot === 'body' ? { ...asset, family: 'DejaVu Sans' } : asset
);
theme.entities.body = {
  entity: 'body', enabled: true, fontSlot: 'body', fontSizePt: 13, align: 'left',
};
theme.entities['heading-1'] = {
  entity: 'heading-1', enabled: true, fontSlot: 'heading', fontSizePt: 26, align: 'center', fontWeight: 700,
};
theme.entities.evidence = {
  entity: 'evidence', enabled: true, fontSlot: 'mono', fontSizePt: 10, align: 'right', italic: true,
};
theme.customBlocks = [
  {
    id: 'scene-card', name: 'Сцена', source: 'scene', placement: 'scene-opening', repeat: 'per-scene',
    fields: ['title', 'location', 'timeOfDay'], style: { entity: 'scene', enabled: true, align: 'left' },
  },
  {
    id: 'conflict-card', name: 'Конфлікт', source: 'conflict', placement: 'full-page', repeat: 'per-conflict',
    fields: ['character', 'conflict', 'goal'], style: { entity: 'conflict', enabled: true, align: 'left' },
  },
  {
    id: 'character-card', name: 'Герой', source: 'character', placement: 'appendix', repeat: 'per-character',
    fields: ['name', 'goal'], style: { entity: 'character', enabled: true, align: 'left' },
  },
];

const result = applyCustomThemeBlocksToPdfInput(bookToPdfInput(book), book, theme);
assert.equal(result.applied, 3);
assert.equal(result.appendix, 1);
assert.equal(result.input.chapters.length, 2);

const sceneContent = result.input.chapters[0].sections[0].content;
assert.match(sceneContent, /Сцена: Закритий шлюз/);
assert.match(sceneContent, /Основний текст сцени/);
assert.match(sceneContent, /Конфлікт: Марта Лис — конфлікт/);
assert.match(sceneContent, /\uE004/);

const appendix = result.input.chapters[1];
assert.equal(appendix.title, 'Додаток');
assert.match(appendix.sections[0].content, /Герой: Марта Лис/);

const baseSpec = specFromBook(book);
const visualSpec = {
  ...baseSpec,
  themeId: 'sci-fi',
  customThemeVisuals: { fonts: theme.fonts, entities: theme.entities },
} as any;
const styles = buildDesigncraftParagraphStyles(visualSpec, ['Evidence']);
const body = styles.find((style) => style.name === 'Body')!;
const h1 = styles.find((style) => style.name === 'Heading 1')!;
const evidence = styles.find((style) => style.name === 'Evidence')!;

assert.equal(body.chars.size, 13);
assert.equal(body.chars.fontFamily, 'DejaVu Sans');
assert.equal(body.para.align, 'left');
assert.equal(h1.chars.size, 26);
assert.equal(h1.para.align, 'center');
assert.equal(evidence.chars.size, 10);
assert.equal(evidence.chars.fontFamily, 'DejaVu Sans Mono');
assert.equal(evidence.para.align, 'right');
assert.equal(evidence.chars.fontStyle, 'Italic');

console.log('DesignCraft custom theme block + typography tests passed.');
