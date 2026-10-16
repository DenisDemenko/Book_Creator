import assert from 'node:assert/strict';
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

console.log('\nPDF engine preference contract passed.');
