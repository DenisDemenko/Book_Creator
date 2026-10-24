import assert from 'node:assert/strict';
import { coverSpreadDimensions, hasCoverTrim } from '../src/utils/coverPhysical';

let count = 0;
const check = (name: string, run: () => void) => { run(); count++; console.log('✓ ' + name); };

check('розгортка 6×9" (152,4×228,6 мм), корінець 15 мм, bleed 3,2 мм', () => {
  const d = coverSpreadDimensions({ pageWidthMm: 152.4, pageHeightMm: 228.6, bleedMm: 3.2 }, 15);
  assert.equal(d.fullWidthMm, 326.2); // 2·152,4 + 15 + 2·3,2
  assert.equal(d.fullHeightMm, 235);  // 228,6 + 2·3,2
});

check('без bleed і без корінця розгортка = дві сторінки', () => {
  const d = coverSpreadDimensions({ pageWidthMm: 100, pageHeightMm: 150 }, 0);
  assert.equal(d.fullWidthMm, 200);
  assert.equal(d.fullHeightMm, 150);
  assert.equal(d.pagePercent, 50);
});

check('частки: дві сторінки + корінець дають 100 %', () => {
  const d = coverSpreadDimensions({ pageWidthMm: 140, pageHeightMm: 210, bleedMm: 0 }, 20);
  const spineShare = (20 / 300) * 100;
  assert.ok(Math.abs(d.spinePercent - spineShare) < 1e-9);
  assert.ok(Math.abs(d.pagePercent * 2 + d.spinePercent - 100) < 1e-9);
});

check('тонкий корінець показується мінімум 0,8 % ширини', () => {
  const d = coverSpreadDimensions({ pageWidthMm: 150, pageHeightMm: 200 }, 0.1);
  assert.equal(d.spinePercent, 0.8);
});

check('некоректні вхідні дані не дають NaN', () => {
  for (const spine of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
    const d = coverSpreadDimensions({ pageWidthMm: 150, pageHeightMm: 200, bleedMm: Number.NaN }, spine);
    assert.ok(Number.isFinite(d.fullWidthMm), 'ширина скінченна при корінці ' + spine);
    assert.ok(Number.isFinite(d.fullHeightMm), 'висота скінченна при корінці ' + spine);
  }
  const d = coverSpreadDimensions({ pageWidthMm: 150, pageHeightMm: 200, bleedMm: -3 }, Number.NaN);
  assert.equal(d.fullWidthMm, 300);
});

check('розмір книги вказано лише коли ширина й висота додатні', () => {
  assert.equal(hasCoverTrim({ pageWidthMm: 148, pageHeightMm: 210 }), true);
  assert.equal(hasCoverTrim({ pageWidthMm: 0, pageHeightMm: 210 }), false);
  assert.equal(hasCoverTrim({ pageWidthMm: 148 }), false);
  assert.equal(hasCoverTrim(undefined), false);
  assert.equal(hasCoverTrim(null), false);
});

console.log('Підсумок: ' + count + ' пройшло.');
