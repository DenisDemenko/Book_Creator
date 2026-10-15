import assert from 'node:assert/strict';
import { withStableCastIds } from '../server/expressStore';

console.log('\nExpress wizard integrity contract:');

const generated = withStableCastIds([
  { firstName: 'Марина', lastName: 'Василенко' },
  { firstName: 'Олександра', lastName: 'Радченко' },
]);

assert.equal(generated.length, 2);
assert.ok(generated[0].id);
assert.ok(generated[1].id);
assert.notEqual(generated[0].id, generated[1].id);
console.log('  ✓ generated cast receives unique stable ids');

const marinaId = generated[0].id;
const oleksandraId = generated[1].id;
const edited = withStableCastIds(
  [
    { id: marinaId, firstName: 'Марія', lastName: 'Василенко' },
    { firstName: 'Олександра', lastName: 'Радченко' },
  ],
  generated,
);
assert.equal(edited[0].id, marinaId, 'rename with explicit id must preserve identity');
assert.equal(edited[1].id, oleksandraId);
console.log('  ✓ renaming a character preserves explicit identity');

const reordered = withStableCastIds(
  [
    { id: oleksandraId, firstName: 'Олександра', lastName: 'Радченко' },
    { id: marinaId, firstName: 'Марія', lastName: 'Василенко' },
  ],
  edited,
);
assert.equal(reordered[0].id, oleksandraId);
assert.equal(reordered[1].id, marinaId);
console.log('  ✓ explicit ids survive reorder');

const duplicateId = withStableCastIds([
  { id: marinaId, firstName: 'A', lastName: 'One' },
  { id: marinaId, firstName: 'B', lastName: 'Two' },
]);
assert.equal(duplicateId[0].id, marinaId);
assert.notEqual(duplicateId[1].id, marinaId);
assert.ok(duplicateId[1].id);
console.log('  ✓ duplicate incoming ids are repaired instead of aliasing two heroes');

console.log('\nExpress wizard integrity contract passed.');

const removedFirst = withStableCastIds([{ firstName: 'Олександра', lastName: 'Радченко' }], generated);
assert.equal(removedFirst[0].id, oleksandraId, 'deletion cannot transfer the removed identity');
const reversedLegacy = withStableCastIds([...generated].reverse().map(({ id: _id, ...c }) => c), generated);
assert.equal(reversedLegacy[0].id, oleksandraId);
assert.equal(reversedLegacy[1].id, marinaId);
console.log('  ✓ deletion and legacy name-based reorder preserve the correct identities');
