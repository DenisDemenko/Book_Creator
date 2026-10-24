import assert from 'node:assert/strict';
import {
  ZOOM_FIT_SCALE,
  ZOOM_MAX_PERCENT,
  ZOOM_MIN_PERCENT,
  ZOOM_PRESETS,
  ZOOM_STEP_PERCENT,
  parseZoomValue,
  snapZoomPercent,
  zoomLabel,
  zoomScaleOf,
} from '../src/utils/zoomPresets';

let count = 0;
const check = (name: string, run: () => void) => { run(); count++; console.log('✓ ' + name); };

check('список масштабу: 15 значень від 10 до 150 з кроком 10', () => {
  assert.equal(ZOOM_PRESETS.length, 15);
  assert.equal(ZOOM_PRESETS[0], 10);
  assert.equal(ZOOM_PRESETS[ZOOM_PRESETS.length - 1], 150);
  ZOOM_PRESETS.forEach((value, index) => {
    assert.equal(value % ZOOM_STEP_PERCENT, 0);
    if (index > 0) assert.equal(value - ZOOM_PRESETS[index - 1], ZOOM_STEP_PERCENT);
  });
  assert.equal(ZOOM_MIN_PERCENT, 10);
  assert.equal(ZOOM_MAX_PERCENT, 150);
});

check('кожен пункт списку дає множник = відсоток / 100', () => {
  for (const value of ZOOM_PRESETS) assert.equal(zoomScaleOf(value), value / 100);
});

check('межі: 10 % і 150 % допустимі, 0 / 5 / 200 прив\'язуються до меж', () => {
  assert.equal(snapZoomPercent(10), 10);
  assert.equal(snapZoomPercent(150), 150);
  assert.equal(snapZoomPercent(0), 10);
  assert.equal(snapZoomPercent(5), 10);
  assert.equal(snapZoomPercent(200), 150);
  assert.equal(snapZoomPercent(-40), 10);
});

check('проміжні значення округлюються до кроку 10', () => {
  assert.equal(snapZoomPercent(74), 70);
  assert.equal(snapZoomPercent(76), 80);
  assert.equal(snapZoomPercent(145), 150);
});

check('NaN і Infinity не дають NaN у множнику', () => {
  assert.equal(snapZoomPercent(Number.NaN), 100);
  assert.equal(snapZoomPercent(Number.POSITIVE_INFINITY), 100);
  assert.ok(Number.isFinite(zoomScaleOf(Number.NaN)));
});

check('режим «Підігнати» лишається окремо: множник 0,82', () => {
  assert.equal(zoomScaleOf('fit'), ZOOM_FIT_SCALE);
  assert.equal(ZOOM_FIT_SCALE, 0.82);
  assert.equal(zoomScaleOf('fit', 0.5), 0.5);
  assert.ok(!ZOOM_PRESETS.includes(ZOOM_FIT_SCALE * 100));
});

check('значення <select>: рядок → ZoomValue', () => {
  assert.equal(parseZoomValue('fit'), 'fit');
  assert.equal(parseZoomValue('70'), 70);
  assert.equal(parseZoomValue('150'), 150);
  assert.equal(parseZoomValue('abc'), 'fit');
  assert.equal(parseZoomValue(''), 'fit');
  assert.equal(parseZoomValue('   '), 'fit');
});

check('підписи пунктів', () => {
  assert.equal(zoomLabel(10), '10%');
  assert.equal(zoomLabel(150), '150%');
  assert.equal(zoomLabel('fit'), 'Підігнати');
});

console.log('Підсумок: ' + count + ' пройшло.');
