import assert from 'node:assert/strict';
import { WizardDraftSession, type WizardDraft } from '../src/utils/expressDraftSession';

type Payload = {
  framework: string;
  synopsis: string;
  reviewConfirmed: boolean;
  structureConfirmed: boolean;
  parts: unknown[];
  cast: Array<{ id: string; firstName: string; lastName: string }>;
  heroArc: {
    selectedHeroId?: string;
    answers: Record<string, string>;
    intensities: number[];
    analysis?: {
      source: 'jev';
      status: 'fresh' | 'stale';
      heroId?: string;
      points: Array<{ beatIndex: number; jevValue: number }>;
    };
  };
};

console.log('\nExpress Hero Arc session contract:');

const initial: Payload = {
  framework: 'hero_journey',
  synopsis: 'Confirmed synopsis',
  reviewConfirmed: true,
  structureConfirmed: true,
  parts: [{}, {}, {}],
  cast: [
    { id: 'hero-1', firstName: 'A', lastName: 'Hero' },
    { id: 'hero-2', firstName: 'B', lastName: 'Other' },
  ],
  heroArc: {
    selectedHeroId: 'hero-1',
    answers: {},
    intensities: Array(14).fill(0),
    analysis: {
      source: 'jev',
      status: 'fresh',
      heroId: 'hero-1',
      points: [{ beatIndex: 0, jevValue: -2 }],
    },
  },
};

let serverDraft: WizardDraft<Payload> = {
  id: 'draft-1',
  userId: 'user-1',
  revision: 10,
  step: 5,
  payload: structuredClone(initial),
};
const calls: string[] = [];

const fakeApi = async <T>(path: string, init?: RequestInit): Promise<T> => {
  calls.push(path);
  if (path === '/api/express/draft/draft-1') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { payload: Payload; step?: number };
    serverDraft = {
      ...serverDraft,
      revision: serverDraft.revision + 1,
      step: body.step ?? serverDraft.step,
      payload: structuredClone(body.payload),
    };
    return structuredClone(serverDraft) as T;
  }
  if (path === '/api/express/hero-arc/analyze') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { heroId: string };
    assert.equal(body.heroId, 'hero-1');
    serverDraft = {
      ...serverDraft,
      revision: serverDraft.revision + 1,
      payload: {
        ...serverDraft.payload,
        heroArc: {
          ...serverDraft.payload.heroArc,
          analysis: {
            source: 'jev',
            status: 'fresh',
            heroId: body.heroId,
            points: [{ beatIndex: 0, jevValue: -6 }],
          },
          intensities: [-6, ...serverDraft.payload.heroArc.intensities.slice(1)],
        },
      },
    };
    return { draft: structuredClone(serverDraft) } as T;
  }
  throw new Error(`Unexpected API call: ${path}`);
};

const session = new WizardDraftSession<Payload>(structuredClone(initial), fakeApi);
session.open(structuredClone(serverDraft));

session.edit({ synopsis: 'Confirmed synopsis, revised by author' });
assert.equal(session.view.payload.heroArc.analysis?.status, 'stale');
console.log('  ✓ canonical synopsis edit marks the previous JEV analysis stale');

await session.flush();
assert.ok(calls.includes('/api/express/hero-arc/analyze'));
assert.equal(session.view.payload.heroArc.analysis?.status, 'fresh');
assert.equal(session.view.payload.heroArc.analysis?.heroId, 'hero-1');
assert.equal(session.view.payload.heroArc.intensities[0], -6);
console.log('  ✓ confirmed three-part canon automatically refreshes JEV for selected CharacterID');

calls.length = 0;
await session.flush();
assert.equal(calls.includes('/api/express/hero-arc/analyze'), false);
console.log('  ✓ fresh analysis is not requested again without a canon change');

session.edit({ cast: [{ id: 'hero-2', firstName: 'B', lastName: 'Other' }] });
assert.equal(session.view.payload.heroArc.selectedHeroId, undefined);
assert.equal(session.view.payload.heroArc.analysis?.status, 'stale');
console.log('  ✓ removing the selected protagonist clears its CharacterID and invalidates analysis');

console.log('\nExpress Hero Arc session contract passed.');
