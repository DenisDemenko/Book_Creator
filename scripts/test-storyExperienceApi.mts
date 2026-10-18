/**
 * Story & Experience HTTP integration test.
 *
 * Launches a real Express server on an ephemeral localhost port, with an
 * isolated temporary SQLite/JSON store and three independent authenticated
 * session cookies (book owner + two participants). No production services,
 * Firebase credentials, or existing books are involved.
 *
 * Run: npm run test:story-experience-api
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-story-experience-api-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_PATH = path.join(dataDir, 'isolated.db');
process.env.NODE_ENV = 'test';

let server: Server | undefined;
let checks = 0;

try {
  // All storage-backed imports must happen AFTER DATA_DIR is set.
  const [{ initStore, saveUser, createSession }, { saveBook }, { attachPrincipal },
    { registerStoryExperienceRoutes }] = await Promise.all([
    import('../server/store.ts'),
    import('../server/bookStore.ts'),
    import('../server/auth.ts'),
    import('../server/storyExperienceRoutes.ts'),
  ]);

  await initStore();

  const ownerId = 'test-owner-' + randomUUID();
  const firstId = 'test-participant-a-' + randomUUID();
  const secondId = 'test-participant-b-' + randomUUID();
  const outsiderId = 'test-outsider-' + randomUUID();
  const bookId = 'test-book-' + randomUUID();
  const stamp = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();

  const tokens = new Map<string, string>();
  for (const [id, role] of [
    [ownerId, 'writer'], [firstId, 'writer'],
    [secondId, 'writer'], [outsiderId, 'writer'],
  ] as const) {
    await saveUser({
      id, role, email: id + '@example.invalid', name: id,
      createdAt: stamp, lastLoginAt: stamp,
    });
    const token = randomUUID();
    tokens.set(id, token);
    await createSession({ token, userId: id, createdAt: stamp, expiresAt });
  }

  await saveBook({ ownerId, book: { id: bookId, title: 'Ізольована тестова книга', chapters: [] } });

  const app = express();
  app.use(express.json());
  app.use(attachPrincipal);
  registerStoryExperienceRoutes(app);
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;

  type Actor = 'owner' | 'a' | 'b' | 'outsider' | 'guest';
  const identity: Record<Exclude<Actor, 'guest'>, string> = {
    owner: ownerId, a: firstId, b: secondId, outsider: outsiderId,
  };
  const request = async (
    actor: Actor, method: 'GET' | 'POST', route: string, body?: unknown,
  ): Promise<{ status: number; data: any }> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (actor !== 'guest') headers.Cookie = 'nova_session=' + tokens.get(identity[actor]);
    const response = await fetch(base + route, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: any = await response.json();
    return { status: response.status, data };
  };
  const expect = async (
    label: string, actor: Actor, method: 'GET' | 'POST',
    route: string, status: number, body?: unknown,
  ): Promise<any> => {
    const result = await request(actor, method, route, body);
    assert.equal(result.status, status, label + ': ' + JSON.stringify(result.data));
    checks += 1;
    console.log('  ✓ ' + label);
    return result.data;
  };

  const journalPath = '/api/story-experience/journals';
  await expect('Guest cannot create a journal', 'guest', 'POST', journalPath, 401,
    { bookId, kind: 'leela' });
  await expect('Non-owner cannot create a book journal', 'a', 'POST', journalPath, 404,
    { bookId, kind: 'leela' });
  const journal = await expect('Book owner creates journal', 'owner', 'POST', journalPath, 201,
    { bookId, kind: 'leela' });
  const sessionId: string = journal.sessionId;
  assert.ok(sessionId);
  const journalRoute = journalPath + '/' + encodeURIComponent(sessionId);

  await expect('Outsider cannot join without invitation', 'outsider', 'POST',
    journalRoute + '/join', 404, { bookId });
  await expect('Participant cannot invite another person', 'a', 'POST',
    journalRoute + '/invite', 404, { bookId, participantId: outsiderId });

  for (const [actor, id] of [['a', firstId], ['b', secondId]] as const) {
    await expect('Owner invites ' + actor, 'owner', 'POST', journalRoute + '/invite', 201,
      { bookId, participantId: id });
    const invitations = await expect(actor + ' sees own invitation', actor, 'GET',
      '/api/story-experience/my-invitations', 200);
    assert.ok(invitations.invitations.some((invite: any) => invite.sessionId === sessionId));
    await expect(actor + ' joins with own session cookie', actor, 'POST',
      journalRoute + '/join', 200, { bookId });
  }
  const unauthorizedInvites = await expect('Outsider sees no invitations', 'outsider',
    'GET', '/api/story-experience/my-invitations', 200);
  assert.ok(!unauthorizedInvites.invitations.some((invite: any) => invite.sessionId === sessionId));

  const eventId = randomUUID();
  await expect('Owner writes neutral event', 'owner', 'POST',
    journalRoute + '/events', 201, {
      bookId, kind: 'leela-move', eventId,
      label: 'Хід у грі', description: 'Учасники зробили спільний хід.',
    });
  await expect('Participant cannot read owner private journal', 'a', 'GET',
    journalRoute + '/review?bookId=' + encodeURIComponent(bookId), 404);
  await expect('Owner completes journal', 'owner', 'POST',
    journalRoute + '/complete', 200, { bookId });

  const approvedEvent = {
    label: 'Спільний хід', description: 'Герої обрали новий напрямок подорожі.',
    approvedForBook: true, visibility: 'approved',
  };
  const archivePayload = {
    sourceJournalId: sessionId, bookId, title: 'Спільна гра',
    kind: 'leela', confirmedForBook: true,
    events: [approvedEvent], consentRequiredParticipantIds: [firstId, secondId],
  };
  await expect('Duplicated roster is rejected', 'owner', 'POST',
    '/api/story-experience/completed', 422,
    { ...archivePayload, consentRequiredParticipantIds: [firstId, firstId] });
  await expect('Forged roster is rejected', 'owner', 'POST',
    '/api/story-experience/completed', 422,
    { ...archivePayload, consentRequiredParticipantIds: [firstId, outsiderId] });

  const completed = await expect('Owner archives verified journal', 'owner', 'POST',
    '/api/story-experience/completed', 201, archivePayload);
  const archiveId: string = completed.sessionId;
  assert.ok(archiveId);
  const materialPath = '/api/story-experience/completed/' + encodeURIComponent(archiveId);
  const exportUrl = materialPath + '/book-material?bookId=' + encodeURIComponent(bookId);

  await expect('Archive blocked until all consent', 'owner', 'GET', exportUrl, 422);
  await expect('Participant cannot read owner book material', 'a', 'GET', exportUrl, 404);

  const aConsents = await expect('Participant A sees own consent request', 'a', 'GET',
    '/api/story-experience/my-consents', 200);
  const bConsents = await expect('Participant B sees own consent request', 'b', 'GET',
    '/api/story-experience/my-consents', 200);
  const aRecord = aConsents.requests.find((item: any) => item.sessionId === archiveId);
  const bRecord = bConsents.requests.find((item: any) => item.sessionId === archiveId);
  assert.ok(aRecord?.materialHash && bRecord?.materialHash);
  assert.equal(aRecord.materialHash, bRecord.materialHash);
  assert.match(aRecord.materialText, /Герої обрали/);
  assert.ok(!JSON.stringify(aRecord).includes(secondId), 'Other user ID must remain private');
  assert.ok(!JSON.stringify(bRecord).includes(firstId), 'Other user ID must remain private');

  await expect('Wrong material digest cannot be approved', 'a', 'POST',
    materialPath + '/consent', 409,
    { bookId, decision: 'granted', materialHash: 'invalid-digest' });
  await expect('Outsider cannot approve consent', 'outsider', 'POST',
    materialPath + '/consent', 404,
    { bookId, decision: 'granted', materialHash: aRecord.materialHash });
  await expect('Participant A approves own material', 'a', 'POST',
    materialPath + '/consent', 200,
    { bookId, decision: 'granted', materialHash: aRecord.materialHash });
  await expect('Single approval cannot authorize export', 'owner', 'GET', exportUrl, 422);
  await expect('Participant B approves own material', 'b', 'POST',
    materialPath + '/consent', 200,
    { bookId, decision: 'granted', materialHash: bRecord.materialHash });

  const exported = await expect('Both independent approvals authorize export',
    'owner', 'GET', exportUrl, 200);
  assert.match(exported.approvedText, /Герої обрали новий напрямок/);
  assert.ok(!exported.approvedText.includes('test-participant-'));
  await expect('Participant A withdraws consent', 'a', 'POST',
    materialPath + '/consent', 200, { bookId, decision: 'revoked' });
  await expect('Withdrawal immediately blocks owner export', 'owner', 'GET',
    exportUrl, 422);
  await expect('Participant A renews current approval', 'a', 'POST',
    materialPath + '/consent', 200,
    { bookId, decision: 'granted', materialHash: aRecord.materialHash });
  await expect('Both approvals restored', 'owner', 'GET', exportUrl, 200);

  console.log('\nStory & Experience integration API: ' + checks + ' HTTP assertions passed.');
} finally {
  if (server) await new Promise<void>((resolve, reject) =>
    server!.close(error => error ? reject(error) : resolve()));
  await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
