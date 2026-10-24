import assert from 'node:assert/strict';
import { MemoryCoreRepository } from '../server/core/memoryRepository';
import { startOnboarding } from '../server/core/collaboration/onboarding';

let count = 0;
const check = async (name: string, run: () => Promise<void>) => { await run(); count++; console.log('✓ ' + name); };

const deps = { ownerOf: async () => null };
const who = { userId: 'user-1', isAdmin: false };

await check('повторний старт повертає ту саму чернетку', async () => {
  const repo = new MemoryCoreRepository();
  const first = await startOnboarding(repo, deps, who, { userId: who.userId, source: 'first_login' as any, projectId: 'p1' });
  const second = await startOnboarding(repo, deps, who, { userId: who.userId, source: 'first_login' as any, projectId: 'p1' });
  assert.equal(first.resumed, false);
  assert.equal(second.resumed, true);
  assert.equal(second.session.id, first.session.id);
});

await check('одночасні старти не дають помилки «вже є», а повертають одну чернетку', async () => {
  const repo = new MemoryCoreRepository();
  // Імітуємо гонку: обидва запити не бачать чернетки, поки перший не записав.
  const realFind = repo.findOnboardingDraft.bind(repo);
  let blind = 2;
  repo.findOnboardingDraft = async (userId: string, projectId: string | null) => {
    if (blind > 0) { blind--; return null; }
    return realFind(userId, projectId);
  };
  const [a, b] = await Promise.all([
    startOnboarding(repo, deps, who, { userId: who.userId, source: 'first_login' as any, projectId: 'p1' }),
    startOnboarding(repo, deps, who, { userId: who.userId, source: 'first_login' as any, projectId: 'p1' }),
  ]);
  assert.equal(a.session.id, b.session.id);
  assert.equal([a, b].filter((x) => x.resumed).length, 1);
});

await check('чужа чернетка не підміняє мою', async () => {
  const repo = new MemoryCoreRepository();
  const mine = await startOnboarding(repo, deps, who, { userId: who.userId, source: 'first_login' as any, projectId: 'p1' });
  const other = await startOnboarding(repo, deps, { userId: 'user-2', isAdmin: false }, { userId: 'user-2', source: 'first_login' as any, projectId: 'p1' });
  assert.notEqual(other.session.id, mine.session.id);
});

console.log('Підсумок: ' + count + ' пройшло.');
