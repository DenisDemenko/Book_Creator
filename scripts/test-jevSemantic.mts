import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assessHeroArcWithJev,
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
assert.deepEqual(buildJevEntityBatches(candidates).map((batch) => batch.length), [48, 48, 24]);
console.log('  ✓ candidates are batched below the JEV question limit');

assert.equal(buildJevEntityBatches([
  { id: 'a', slug: 'character', name: 'Марина' },
  { id: 'a', slug: 'character', name: 'Дубль' },
  { id: '', slug: 'location', name: 'Без id' },
]).flat().length, 1);
console.log('  ✓ malformed and duplicate candidate IDs are filtered');

assert.equal(readNoulProbability({ noul: 0.91 }), 0.91);
assert.equal(readNoulProbability({ probability: 1.4 }), 1);
assert.equal(readNoulProbability({ nope: 1 }), null);
console.log('  ✓ typed probability parsing uses the shared core JEV adapter');

let calls = 0;
const fetchImpl: typeof fetch = async (_input, init) => {
  calls++;
  const body = JSON.parse(String(init?.body || '{}')) as {
    model?: string;
    state?: { text?: string; task?: string; constraint?: string };
    questions?: Record<string, unknown>;
  };
  assert.equal(body.model, 'jev-latest');
  assert.equal(body.state?.text, 'Марина увійшла до старої бібліотеки.');
  assert.equal(body.state?.task, 'existing_book_entity_presence');
  assert.equal(body.state?.constraint, 'never_invent_entities');
  assert.equal(Object.keys(body.questions ?? {}).length, 2);
  return new Response(JSON.stringify({
    model: 'jev-latest',
    answers: { entity_0: { noul: 0.94 }, entity_1: { noul: 0.21 } },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const result = await classifyExistingEntitiesWithJev({
  text: 'Марина увійшла до старої бібліотеки.',
  candidates: [
    { id: 'char-marina', slug: 'character', name: 'Марина' },
    { id: 'loc-park', slug: 'location', name: 'Міський парк' },
  ],
  apiKey: 'test-key',
  model: 'jev-latest',
  threshold: 0.65,
  fetchImpl,
});
assert.equal(calls, 1);
assert.equal(result.matches.length, 1);
assert.equal(result.matches[0]?.id, 'char-marina');
assert.equal(result.matches[0]?.confidence, 0.94);
assert.deepEqual(result.proposedNewEntities, []);
console.log('  ✓ only existing entities above threshold are returned');

await assert.rejects(
  classifyExistingEntitiesWithJev({
    text: 'Текст',
    candidates: [{ id: 'a', slug: 'character', name: 'Марина' }],
    apiKey: '',
    fetchImpl,
  }),
  /JEV_NOT_CONFIGURED/,
);
console.log('  ✓ missing server-side JEV key fails explicitly');

let heroCalls = 0;
const heroFetch: typeof fetch = async (_input, init) => {
  heroCalls++;
  const body = JSON.parse(String(init?.body || '{}')) as {
    model?: string;
    state?: { task?: string; hero?: string; context?: string; constraint?: string };
    questions?: Record<string, { type?: string; criteria?: string[] }>;
  };
  assert.equal(body.state?.task, 'hero_arc_emotional_valence');
  assert.equal(body.state?.hero, 'Марина');
  assert.match(String(body.state?.context), /лист/);
  assert.equal(body.state?.constraint, 'use_only_provided_story_evidence');
  assert.equal(Object.keys(body.questions ?? {}).length, 14);
  for (const question of Object.values(body.questions ?? {})) {
    assert.equal(question.type, 'score');
    assert.equal(question.criteria?.length, 9);
  }
  const answers = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [
    `beat_${i}`,
    { type: 'score', score: i % 9, confidence: 0.8 },
  ]));
  return new Response(JSON.stringify({ model: 'jev-latest', answers }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
const arc = await assessHeroArcWithJev({
  heroName: 'Марина',
  context: 'Марина отримує лист і вирушає в дорогу.',
  constructorAnswers: { s3: 'Лист змушує її залишити дім.' },
  apiKey: 'test-key',
  model: 'jev-latest',
  fetchImpl: heroFetch,
});
assert.equal(heroCalls, 1);
assert.equal(arc.intensities.length, 14);
assert.equal(arc.confidences.length, 14);
assert.equal(arc.intensities[0], -10);
assert.equal(arc.intensities[8], 10);
assert.equal(arc.confidences[0], 0.8);
console.log('  ✓ Hero Arc is evaluated as 14 JEV score questions and mapped to -10…10');

const routes = await readFile(new URL('../server/worldPhoto.ts', import.meta.url), 'utf8');
const jev = await readFile(new URL('../server/jevSemantic.ts', import.meta.url), 'utf8');
const extensions = await readFile(new URL('../src/components/manuscriptEditor/extensions.ts', import.meta.url), 'utf8');
const autoTag = await readFile(new URL('../src/components/manuscriptEditor/JevAutoTagPlugin.ts', import.meta.url), 'utf8');
const wizard = await readFile(new URL('../src/components/ExpressStartView.tsx', import.meta.url), 'utf8');
const heroPanel = await readFile(new URL('../src/components/HeroArcPanel.tsx', import.meta.url), 'utf8');
const heroClient = await readFile(new URL('../src/utils/heroArcJevClient.ts', import.meta.url), 'utf8');
const handoff = await readFile(new URL('../src/utils/expressSemanticHandoff.ts', import.meta.url), 'utf8');

assert.match(routes, /registerJevSemanticRoutes\(app\)/);
assert.match(jev, /\/api\/semantic\/jev\/entities/);
assert.match(jev, /\/api\/semantic\/jev\/hero-arc/);
assert.match(jev, /requirePermission\('canUseAi'\)/);
assert.match(jev, /HttpJevAdapter/);
assert.match(jev, /jevKeyFromEnv/);
assert.match(jev, /noulProbability/);
assert.doesNotMatch(jev, /generateText\(/);
console.log('  ✓ semantic and Hero Arc routes reuse the authenticated core TypeSafe adapter');

assert.match(extensions, /JevAutoTagPlugin\.configure/);
assert.match(autoTag, /Проставити теги автоматично/);
assert.match(autoTag, /classifyBookEntitiesWithJev/);
assert.match(autoTag, /empty \|\| from === to/);
assert.doesNotMatch(autoTag, /proposedNewEntities\s*=/);
console.log('  ✓ right-click auto-tagging exists only for selected text and uses JEV classifier');

assert.match(handoff, /\[\/chapter:/);
assert.match(handoff, /\[\/outline:/);
assert.match(handoff, /\[\/character:/);
assert.match(wizard, /withDeterministicSemanticHandoff/);
assert.match(wizard, /withJevSemanticEnrichment/);
assert.match(wizard, /prependMissingJevTags/);
assert.match(wizard, /buildHeroArcAssessmentContext/);
assert.match(wizard, /assessHeroArcWithJev/);
assert.match(wizard, /nova:jev-hero-arc/);
assert.match(heroPanel, /Оцінити JEV/);
assert.match(heroPanel, /Ручна корекція оцінки автора/);
assert.match(heroClient, /\/api\/semantic\/jev\/hero-arc/);
console.log('  ✓ wizard recalculates Hero Arc from final story context while sliders remain manual override');

console.log('\nJEV semantic entity classifier regression contract passed.');
