import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  calculateCoverGeometry,
  calculatePaperSpineThicknessMm,
} from '../src/utils/coverProduction';

assert.equal(calculatePaperSpineThicknessMm(100, 'white'), 5.72);
assert.equal(calculatePaperSpineThicknessMm(100, 'cream'), 6.35);

const white = calculateCoverGeometry({
  pageWidthMm: 152.4,
  pageHeightMm: 228.6,
  pageCount: 100,
  coverType: 'paperback',
  paperStock: 'white',
});
const cream = calculateCoverGeometry({
  pageWidthMm: 152.4,
  pageHeightMm: 228.6,
  pageCount: 100,
  coverType: 'paperback',
  paperStock: 'cream',
});
assert.equal(white.spineWidthMm, 5.7);
assert.equal(cream.spineWidthMm, 6.4);
assert.notEqual(white.spineWidthMm, cream.spineWidthMm);

const kdp = fs.readFileSync(new URL('../src/utils/kdpHelpers.ts', import.meta.url), 'utf8');
assert.match(kdp, /calculateCoverGeometry/);
assert.match(kdp, /paperStock: cover\.paperStock/);
assert.doesNotMatch(kdp, /calculateKdpSpineThicknessMm\(estimatedPages, 'cream'\)/);
assert.match(kdp, /Paper Stock: \$\{cover\.paperStock \|\| 'white'\}/);
assert.match(kdp, /Cover Material: \$\{cover\.coverMaterial \|\| 'matte-card'\}/);
assert.match(kdp, /Finish: \$\{cover\.finish \|\| 'none'\}/);
assert.match(kdp, /Back Cover Art:/);

console.log('cover production consistency contract: ok');
