import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/components/FinalPdfSpread.tsx', import.meta.url), 'utf8');

assert.match(source, /pdfjs-dist/);
assert.match(source, /pdf\.worker\.min\.mjs\?url/);
assert.match(source, /artifact\/pdf\/manifest\?format=/);
assert.match(source, /credentials: 'include'/);
assert.match(source, /new Uint8Array\(await pdfResponse\.arrayBuffer\(\)\)/);
assert.match(source, /bytes\.byteLength !== nextManifest\.sizeBytes/);
assert.match(source, /loadedDocument\.numPages !== nextManifest\.pageCount/);
assert.match(source, /data-final-pdf-spread/);
assert.match(source, /manifest\.pageMap\.precision/);
assert.doesNotMatch(
  source,
  /useBookPreviewMeasurement|computeTableOfContents|buildBookPages/,
  'final PDF renderer must not repaginate manuscript in the browser',
);

console.log('Final PDF spread source-of-truth contract: OK');
