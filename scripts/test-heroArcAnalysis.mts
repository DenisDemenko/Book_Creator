import assert from 'node:assert/strict';
import {
  applyHeroArcOverride,
  clearHeroArcOverride,
  displayHeroArcIntensities,
  markHeroArcAnalysisStale,
  type HeroArcStateWithAnalysis,
} from '../src/utils/heroArcAnalysis';

console.log('\nHero arc analysis contract:');

const base: HeroArcStateWithAnalysis = {
  answers: {},
  intensities: Array(14).fill(0),
  analysis: {
    source: 'jev',
    status: 'fresh',
    heroId: 'hero-1',
    points: [
      { beatIndex: 0, jevValue: -6, confidence: 0.8 },
      { beatIndex: 1, jevValue: 4, confidence: 0.7 },
    ],
  },
};

assert.deepEqual(displayHeroArcIntensities(base).slice(0, 3), [-6, 4, 0]);
console.log('  ✓ JEV values override legacy intensities');

const overridden = applyHeroArcOverride(base, 1, 2);
assert.equal(displayHeroArcIntensities(overridden)[1], 2);
assert.equal(overridden.analysis?.points[1].authorOverride, 2);
console.log('  ✓ author override has priority over JEV');

const reset = clearHeroArcOverride(overridden, 1);
assert.equal(displayHeroArcIntensities(reset)[1], 4);
assert.equal(reset.analysis?.points[1].authorOverride, undefined);
console.log('  ✓ author can return a point to the JEV value');

const stale = markHeroArcAnalysisStale(reset);
assert.equal(stale?.analysis?.status, 'stale');
console.log('  ✓ structural edits can invalidate old JEV analysis');

console.log('\nHero arc analysis contract passed.');
