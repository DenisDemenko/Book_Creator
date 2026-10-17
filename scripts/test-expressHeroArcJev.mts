import assert from 'node:assert/strict';
import {
  HERO_ARC_BEAT_TITLES,
  HERO_ARC_JEV_LEVELS,
  buildHeroArcJevState,
  heroArcJevQuestions,
  jevScoreToHeroArcValue,
} from '../server/expressHeroArcJev';

console.log('\nExpress JEV hero arc contract:');

assert.equal(HERO_ARC_BEAT_TITLES.length, 14);
assert.equal(heroArcJevQuestions().length, 14);
console.log('  ✓ exactly 14 canonical hero-journey beats are scored');

assert.equal(jevScoreToHeroArcValue(0), -10);
assert.equal(jevScoreToHeroArcValue(4), 0);
assert.equal(jevScoreToHeroArcValue(HERO_ARC_JEV_LEVELS.length - 1), 10);
console.log('  ✓ JEV score maps symmetrically to -10..+10');

const payload: any = {
  seed: 'Задум',
  genre: 'Роман',
  framework: 'hero_journey',
  cast: [
    { id: 'hero-1', firstName: 'Олена', lastName: 'Мир', approved: true, goal: 'дістатися дому' },
    { id: 'ally-1', firstName: 'Марко', lastName: 'Ліс', approved: true },
  ],
  synopsis: 'Олена виходить у дорогу, переживає кризу і повертається зміненою.',
  parts: [{ partNumber: 1, chapters: [{ chapterTitle: 'Вихід' }] }],
  heroArc: { answers: { s4: 'Бо боїться втрати.' }, intensities: Array(14).fill(0) },
};
const state = buildHeroArcJevState(payload, 'hero-1');
assert.equal((state.protagonist as any).id, 'hero-1');
assert.equal((state.confirmed_cast as any[]).length, 2);
assert.equal(state.synopsis, payload.synopsis);
assert.deepEqual(state.hero_journey_answers, payload.heroArc.answers);
console.log('  ✓ JEV state is built only from confirmed wizard canon');

assert.throws(() => buildHeroArcJevState(payload, 'unknown-id'));
console.log('  ✓ unknown protagonist IDs are rejected');

console.log('\nExpress JEV hero arc contract passed.');
