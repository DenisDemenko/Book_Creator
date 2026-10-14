import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BOOK_DESIGN_THEME_CARDS } from '../src/data/bookDesignThemeCatalog.ts';
import { emptyCustomBookDesignTheme } from '../src/data/customBookDesignTheme.ts';

const gallery = await readFile(new URL('../src/components/BookDesignThemeGallery.tsx', import.meta.url), 'utf8');
const designer = await readFile(new URL('../src/components/DesignerThemeStudio.tsx', import.meta.url), 'utf8');
const quickSetup = await readFile(new URL('../src/components/BookDesignAuthorQuickSetup.tsx', import.meta.url), 'utf8');
const semanticEditor = await readFile(new URL('../src/components/BookDesignSemanticBlockEditor.tsx', import.meta.url), 'utf8');
const designSuggestion = await readFile(new URL('../src/components/DesignSuggestionPanel.tsx', import.meta.url), 'utf8');

console.log('\nBook Design Studio UI regression contract:');

assert.equal(BOOK_DESIGN_THEME_CARDS.length, 15, 'Gallery must keep all 15 built-in themes.');
assert.equal(new Set(BOOK_DESIGN_THEME_CARDS.map((theme) => theme.id)).size, 15, 'Built-in theme ids must remain unique.');
console.log('  ✓ 15 built-in theme cards stay available');

assert.match(gallery, /type StudioMode = 'author' \| 'designer'/);
assert.match(gallery, />Автор<\/button>/);
assert.match(gallery, /Дизайнер<\/button>/);
assert.match(gallery, /BookDesignAuthorQuickSetup/);
assert.match(gallery, /Розширені налаштування/);
console.log('  ✓ Author → Designer mode transition stays wired');

assert.match(quickSetup, /Літературний/);
assert.match(quickSetup, /Компактний/);
assert.match(quickSetup, /Повітряний/);
assert.match(quickSetup, /Великий шрифт/);
assert.match(quickSetup, /Зберегти як свою тему/);
assert.match(quickSetup, /theme\.basedOn = baseThemeId/);
assert.match(quickSetup, /book-design-studio:custom-themes/);
console.log('  ✓ Author quick setup preserves base theme and saves a custom copy');

const sampleTheme = emptyCustomBookDesignTheme('Regression theme');
sampleTheme.basedOn = 'sci-fi';
assert.ok(sampleTheme.id.startsWith('custom-'));
assert.equal(sampleTheme.basedOn, 'sci-fi');
assert.deepEqual(sampleTheme.editorRoles, ['designer', 'writer']);
console.log('  ✓ custom theme model remains separate from built-in theme ids');

assert.match(designer, /type MobilePanel = 'preview' \| 'structure' \| 'properties' \| 'blocks'/);
for (const label of ['Preview', 'Структура', 'Властивості', 'Блоки']) {
  assert.ok(designer.includes(label), `Responsive panel label is missing: ${label}`);
}
assert.match(designer, /xl:grid-cols-\[260px_minmax\(420px,1fr\)_320px\]/);
console.log('  ✓ responsive Studio keeps mobile panels and desktop three-column workspace');

assert.match(semanticEditor, /DESIGN_ENTITY_FIELDS/);
for (const value of ['scene-opening', 'chapter-opening', 'full-width', 'full-page', 'appendix']) {
  assert.ok(semanticEditor.includes(value), `Placement option is missing: ${value}`);
}
for (const value of ['once', 'per-character', 'per-scene', 'per-conflict', 'matched']) {
  assert.ok(semanticEditor.includes(value), `Repeat option is missing: ${value}`);
}
console.log('  ✓ semantic editor uses shared fields plus the complete placement/repeat contract');

assert.match(designer, /\/api\/pdf\/designcraft\/theme-preview/);
assert.match(designer, /engineId: 'designcraft'/);
assert.match(designer, /theme: theme\.basedOn \|\| 'classic'/);
assert.match(designer, /customTheme: theme/);
console.log('  ✓ custom theme preview payload keeps base theme + customTheme + DesignCraft');

assert.match(designSuggestion, /isThemePreview \? '\/api\/pdf\/designcraft\/theme-preview' : '\/api\/admin\/pdf\/preview'/);
assert.match(designSuggestion, /\? \{ book, engineId: DESIGNCRAFT_ENGINE_ID, theme: themeId \}/);
assert.match(designSuggestion, /: \{ book, variant: 'code', format: 'digital', engineId: pdfEngineId \}/);
assert.ok(!designSuggestion.includes("/api/admin/pdf/preview', requireAuth"), 'Client must not redefine the legacy route.');
console.log('  ✓ built-in DesignCraft preview remains separate from generic legacy PDF preview');

console.log('\nBook Design Studio UI regression contract passed.');
