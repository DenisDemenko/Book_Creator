import assert from 'node:assert/strict';
import {
  BOOK_DESIGN_THEME_CARDS,
  getBookDesignThemeCard,
  recommendBookDesignThemes,
} from '../src/data/bookDesignThemeCatalog';

const baseBook: any = {
  id: 'book-theme-test',
  version: '1.0.0',
  revisionNumber: 1,
  title: 'Тестова книга',
  author: 'Автор',
  language: 'uk',
  genre: '',
  synopsis: '',
  logline: '',
  theme: '',
  status: 'draft',
  chapters: [
    {
      id: 'c1',
      bookId: 'book-theme-test',
      title: 'Початок',
      order: 1,
      sections: [
        {
          id: 's1',
          chapterId: 'c1',
          title: 'Сцена',
          content: 'Звичайний тестовий текст для перевірки каталогу тем.',
          wordCount: 8,
          lastModified: new Date(0).toISOString(),
        },
      ],
    },
  ],
  characters: [],
  visualBible: {},
  layoutConfig: {},
  coverConfig: {},
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

assert.equal(BOOK_DESIGN_THEME_CARDS.length, 15, 'Каталог має містити рівно 15 базових дизайн-систем.');
assert.equal(new Set(BOOK_DESIGN_THEME_CARDS.map((theme) => theme.id)).size, 15, 'Theme ids мають бути унікальні.');
assert.equal(getBookDesignThemeCard('classic').label, 'Classic');
assert.equal(getBookDesignThemeCard('sci-fi').label, 'Sci‑Fi');

const sciFi = recommendBookDesignThemes({
  ...baseBook,
  genre: 'Science fiction / кіберпанк',
  synopsis: 'У Нео-Києві андроїд отримує системне повідомлення з орбіти.',
});
assert.equal(sciFi.length, 3);
assert.equal(sciFi[0].themeId, 'sci-fi', 'Sci-fi книга має насамперед рекомендувати Sci‑Fi.');
assert.ok(sciFi[0].reasonsUk.length > 0, 'Кожна рекомендація повинна пояснювати причину.');

const business = recommendBookDesignThemes({
  ...baseBook,
  genre: 'Бізнес',
  synopsis: 'Практичний посібник для стартапів про менеджмент і маркетинг.',
});
assert.equal(business[0].themeId, 'business-premium', 'Бізнес-книга має насамперед рекомендувати Business / Premium.');
assert.ok(business.some((item) => item.themeId === 'non-fiction'), 'Для бізнес-книги Non-fiction має входити до трійки.');

const children = recommendBookDesignThemes({
  ...baseBook,
  genre: 'Дитяча казка',
  targetAudience: 'Для дітей 7–10 років',
  illustrations: Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, url: 'x', caption: '', aspectRatio: '1:1', style: '' })),
});
assert.equal(children[0].themeId, 'children', 'Дитяча книга має насамперед рекомендувати Children.');
assert.ok(children.some((item) => item.themeId === 'graphic-story'), 'Ілюстрована дитяча книга має отримати Graphic Story серед рекомендацій.');

const neutral = recommendBookDesignThemes(baseBook);
assert.equal(neutral.length, 3);
assert.equal(neutral[0].themeId, 'modern-fiction', 'Порожня жанрова анкета має стабільний нейтральний fallback.');

console.log('✓ Book Design Studio: 15-theme catalog and deterministic recommendations');
