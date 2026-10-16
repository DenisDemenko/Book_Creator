import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveBookPdfEngineId } from '../server/pdf/enginePreference.ts';

console.log('\nPDF engine preference contract:');

const bookWithPandoc = {
  id: 'book-1',
  layoutConfig: {
    preferredPdfEngineId: 'pandoc',
  },
};

assert.equal(
  resolveBookPdfEngineId(bookWithPandoc, 'chromium'),
  'chromium',
  'Explicit edition/operation engine must override the book preference.'
);
console.log('  ✓ explicit operation/edition override has highest priority');

assert.equal(
  resolveBookPdfEngineId(bookWithPandoc),
  'pandoc',
  'Book preference must be used when there is no explicit override.'
);
console.log('  ✓ book.layoutConfig.preferredPdfEngineId is the normal render source');

assert.equal(
  resolveBookPdfEngineId({ id: 'legacy-book', layoutConfig: {} }),
  'nova',
  'Legacy books without a renderer preference must remain compatible with Nova.'
);
console.log('  ✓ legacy books fall back to Nova');

assert.equal(resolveBookPdfEngineId(bookWithPandoc, '  nova  '), 'nova');
assert.equal(resolveBookPdfEngineId({ layoutConfig: { preferredPdfEngineId: '  designcraft ' } }), 'designcraft');
console.log('  ✓ engine ids are normalized without changing their meaning');

assert.equal(resolveBookPdfEngineId(bookWithPandoc, ''), 'pandoc');
assert.equal(resolveBookPdfEngineId({ layoutConfig: { preferredPdfEngineId: '   ' } }), 'nova');
console.log('  ✓ empty values do not create a fake renderer');

const routes = await readFile(new URL('../server/pdfRoutesBase.ts', import.meta.url), 'utf8');
assert.match(routes, /resolveBookPdfEngineId\(book, req\.body\?\.engineId\)/);
assert.match(routes, /resolveBookPdfEngineId\(book, edition\.engineId\)/);
assert.match(routes, /resolveBookPdfEngineId\(book, params\.engineId\)/);
assert.doesNotMatch(
  routes,
  /renderWithEngine\(DEFAULT_PDF_ENGINE,\s*\{/,
  'Server-side artifact building must not silently force Nova.'
);
assert.match(routes, /return \{ bookId: stored\.id, revision: stored\.revision, engineId, built \}/);
console.log('  ✓ preview, publish and stored artifact builds share one renderer resolution rule');

console.log('\nPDF engine preference contract passed.');
