import assert from 'node:assert/strict';
import {
  BOOK_DESIGN_THEME_CARDS,
  type BookDesignThemeId,
} from '../src/data/bookDesignThemeCatalog';
import {
  EDUCATIONAL_PDF_TEMPLATES,
  educationalPdfTemplatesFor,
  findEducationalPdfTemplate,
} from '../src/data/educationalPdfTemplates';
import {
  EDUCATIONAL_TEMPLATE_RENDER_PROFILES,
  resolveEducationalRendererTheme,
} from '../server/pdf/designcraft/educationalTemplates';

const EXPECTED_IDS = [
  'methodic-classic',
  'methodic-modern',
  'methodic-visual-pro',
  'instruction-clear-steps',
  'instruction-visual-flow',
  'instruction-compact-manual',
  'worksheet-clean',
  'worksheet-interactive',
  'worksheet-project-sheet',
] as const;

assert.equal(EDUCATIONAL_PDF_TEMPLATES.length, 9, 'educational catalog must contain exactly 9 built-ins');
assert.equal(new Set(EDUCATIONAL_PDF_TEMPLATES.map((item) => item.id)).size, 9, 'template ids must be unique');
assert.deepEqual(
  [...EDUCATIONAL_PDF_TEMPLATES.map((item) => item.id)].sort(),
  [...EXPECTED_IDS].sort(),
  'catalog must expose the agreed 9 template ids',
);

for (const type of ['methodic', 'instruction', 'worksheet'] as const) {
  const templates = educationalPdfTemplatesFor(type);
  assert.equal(templates.length, 3, `${type} must have exactly three designs`);
  assert(templates.every((template) => template.documentType === type));
}

const bookThemeIds = new Set<BookDesignThemeId>(BOOK_DESIGN_THEME_CARDS.map((theme) => theme.id));
const expectedBookThemeIds = [
  'classic', 'modern-fiction', 'sci-fi', 'fantasy', 'dark-fantasy',
  'thriller', 'noir-detective', 'romance', 'poetry-literary', 'non-fiction',
  'academic-research', 'business-premium', 'children', 'graphic-story',
  'experimental-art', 'studio-classic', 'studio-editorial',
];
assert.deepEqual([...bookThemeIds].sort(), [...expectedBookThemeIds].sort(), 'educational templates must preserve all 17 built-in book themes');
assert.equal(bookThemeIds.size, BOOK_DESIGN_THEME_CARDS.length, 'book theme ids must remain unique');
assert(EDUCATIONAL_PDF_TEMPLATES.every((template) => !bookThemeIds.has(template.id as BookDesignThemeId)), 'educational template ids must remain separate from book theme ids');

for (const template of EDUCATIONAL_PDF_TEMPLATES) {
  assert(bookThemeIds.has(template.rendererBaseTheme), `${template.id} must resolve to an existing book renderer base`);
  assert(template.defaultEntities.length > 0, `${template.id} must expose educational semantic entities`);
  assert(template.labelUk.length > 0);
  assert(template.descriptionUk.length > 0);
  assert.equal(findEducationalPdfTemplate(template.id)?.id, template.id);
  assert.equal(resolveEducationalRendererTheme(template.id), template.rendererBaseTheme);
}

assert.equal(EDUCATIONAL_TEMPLATE_RENDER_PROFILES.length, 9, 'server renderer mirror must contain all 9 templates');
assert.equal(new Set(EDUCATIONAL_TEMPLATE_RENDER_PROFILES.map((item) => item.id)).size, 9);
assert.equal(resolveEducationalRendererTheme('not-a-template'), null);
assert.equal(findEducationalPdfTemplate('not-a-template'), null);

console.log('Educational PDF templates: OK');

