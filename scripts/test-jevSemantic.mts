import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildJevEntityBatches,
  classifyExistingEntitiesWithJev,
  readNoulProbability,
} from '../server/jevSemantic';

console.log('\nJEV semantic entity classifier regression contract:');

const candidates = Array.from({ length: 120 }, (_, index) => ({
  id: `entity-${index}`,
  slug: index % 2 ? 'character' : 'location',
  name: `Сутність ${index}`,
}));
const batches = buildJevEntityBatches(candidates);
assert.deepEqual(batches.map((batch) => batch.length), [48, 48, 24]);
console.log('  ✓ candidates are batched below the 64-question JEV limit');

const deduped = buildJevEntityBatches([
  { id: 'a', slug: 'character', name: 'Марина' },
  { id: 'a', slug: 'character', name: 'Дубль' },
  { id: '', slug: 'location', name: 'Без id' },
]);
assert.equal(deduped.flat().length, 1);
console.log('  ✓ malformed and duplicate candidate IDs are filtered before inference');

assert.equal(readNoulProbability(0.82), 0.82);
assert.equal(readNoulProbability({ noul: 0.91 }), 0.91);
assert.equal(readNoulProbability({ probability: 1.4 }), 1);
assert.equal(readNoulProbability({ nope: 1 }), null);
console.log('  ✓ typed yes/no probability parsing is bounded and backward-compatible');

let calls = 0;
const fetchImpl: typeof fetch = async (_input, init) => {
  calls++;
  const body = JSON.parse(String(init?.body || '{}')) as {
    model?: string;
    state?: string;
    questions?: Record<string, unknown>;
  };
  assert.equal(body.model, 'jev-latest');
  assert.equal(body.state, 'Марина увійшла до старої бібліотеки.');
  assert.equal(Object.keys(body.questions ?? {}).length, 2);
  return new Response(JSON.stringify({
    model: 'jev-latest',
    answers: {
      entity_0: { noul: 0.94 },
      entity_1: { noul: 0.21 },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const result = await classifyExistingEntitiesWithJev({
  text: 'Марина увійшла до старої бібліотеки.',
  candidates: [
    { id: 'char-marina', slug: 'character', name: 'Марина' },
    { id: 'loc-park', slug: 'location', name: 'Міський парк' },
  ],
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid',
  model: 'jev-latest',
  threshold: 0.65,
  fetchImpl,
});
assert.equal(calls, 1);
assert.equal(result.matches.length, 1);
assert.equal(result.matches[0]?.id, 'char-marina');
assert.equal(result.matches[0]?.confidence, 0.94);
assert.equal(result.matches[0]?.source, 'jev');
assert.deepEqual(result.proposedNewEntities, []);
console.log('  ✓ only existing book entities above the confidence threshold are returned');

await assert.rejects(
  classifyExistingEntitiesWithJev({
    text: 'Текст',
    candidates: [{ id: 'a', slug: 'character', name: 'Марина' }],
    apiKey: '',
    fetchImpl,
  }),
  /JEV_NOT_CONFIGURED/,
);
console.log('  ✓ missing server-side JEV key fails explicitly instead of silently using another model');

const routes = await readFile(new URL('../server/expressRoutes.ts', import.meta.url), 'utf8');
const jev = await readFile(new URL('../server/jevSemantic.ts', import.meta.url), 'utf8');
assert.match(routes, /registerJevSemanticRoutes\(app\)/);
assert.match(jev, /\/api\/semantic\/jev\/entities/);
assert.match(jev, /requirePermission\('canUseAi'\)/);
assert.match(jev, /JEV_AI_API_KEY/);
assert.doesNotMatch(jev, /generateText\(/);
console.log('  ✓ authenticated JEV endpoint is registered and never falls back to generative AI');

console.log('\nJEV semantic entity classifier regression contract passed.');
