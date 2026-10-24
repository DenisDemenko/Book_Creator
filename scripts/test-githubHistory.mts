import assert from 'node:assert/strict';
import express from 'express';
import { createGithubHistoryReader } from '../server/githubHistory.ts';
import { registerGitHistoryRoutes } from '../server/gitHistoryRoutes.ts';

function row(n: number) {
  return { sha: n.toString(16).padStart(40, '0'), parents: [{ sha: 'parent' }],
    commit: { author: { name: 'Writer', date: '2026-10-20T10:00:00Z' },
      committer: { date: '2026-10-20T11:00:00Z' }, message: 'History test (#471)\nBody' } };
}
let now = 1000, calls = 0;
const requests: URL[] = [];
const request: typeof fetch = async (input, init) => {
  calls++;
  const url = new URL(String(input)); requests.push(url);
  assert.equal(url.origin, 'https://api.github.com');
  assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-token');
  return new Response(JSON.stringify(url.searchParams.get('page') === '1'
    ? Array.from({ length: 100 }, (_, i) => row(200 - i)) : [row(100)]));
};
const read = createGithubHistoryReader({ request, ref: 'test/branch', token: 'private-token', now: () => now });
const [first, concurrent] = await Promise.all([read(200), read(200)]);
assert.equal(calls, 2, 'concurrent requests share one pagination operation');
assert.equal(first, concurrent);
assert.equal(first.commits.length, 101);
assert.equal(first.hasMore, false);
assert.equal(requests[0].searchParams.get('sha'), 'test/branch');
assert.equal(requests[1].searchParams.get('sha'), row(200).sha, 'subsequent pages pin the head SHA');
assert.equal(first.commits[0].journalEntry, 471);
assert.equal(first.commits[0].insertions, null, 'unknown stats are not zeros');
assert.equal(JSON.stringify(first).includes('private-token'), false);
await read(200); assert.equal(calls, 2, 'cache prevents repeat requests');
now += 300001; await read(200); assert.equal(calls, 4, 'cache expires');
const partial = await read(1);
assert.equal(partial.commits.length, 1); assert.equal(partial.hasMore, true);

for (const status of [403, 429, 404, 500]) {
  const fail = createGithubHistoryReader({ request: async () => new Response('secret upstream body', { status }) });
  await assert.rejects(fail(100), error => {
    assert.equal((error as Error).message.includes('secret upstream body'), false); return true;
  });
}
let attempts = 0;
const retry = createGithubHistoryReader({ request: async () => {
  if (!attempts++) throw new Error('network');
  return new Response('[]');
} });
await assert.rejects(retry(100));
assert.equal((await retry(100)).commits.length, 0, 'failed request does not poison cache');
const malformed = createGithubHistoryReader({ request: async () => new Response('[{"sha":"bad"}]') });
await assert.rejects(malformed(100), /некоректний/);

let principal: any = { id: 'admin', role: 'admin', isGuest: false };
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => { req.principal = principal; next(); });
const limits: number[] = [];
registerGitHistoryRoutes(app, { localAvailable: () => false, readGithub: async limit => {
  limits.push(limit); return first;
} });
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + (server.address() as any).port;
try {
  let res = await fetch(base + '/api/admin/git/commits');
  const data = await res.json();
  assert.equal(res.status, 200); assert.equal(data.available, true);
  assert.equal(data.source, 'github'); assert.equal(data.statsAvailable, false);
  assert.equal(data.commits.length, 101); assert.equal(limits[0], 100);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  await fetch(base + '/api/admin/git/commits?limit=999999');
  assert.equal(limits.at(-1), 2000);
  assert.equal((await fetch(base + '/api/admin/git/verify-remotes', { method: 'POST' })).status, 400);
  principal = { id: 'writer', role: 'writer', isGuest: false };
  res = await fetch(base + '/api/admin/git/commits');
  assert.equal(res.status, 403);
  assert.equal(limits.length, 2, 'unauthorized requests never reach GitHub');
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }

const failingApp = express();
failingApp.use((req: any, _res, next) => { req.principal = { id: 'admin', role: 'admin' }; next(); });
registerGitHistoryRoutes(failingApp, { localAvailable: () => false,
  readGithub: async () => { throw new Error('private-token upstream details'); } });
const failureServer = failingApp.listen(0, '127.0.0.1');
await new Promise<void>(resolve => failureServer.once('listening', resolve));
try {
  const res = await fetch('http://127.0.0.1:' + (failureServer.address() as any).port + '/api/admin/git/commits');
  assert.equal(res.status, 503);
  assert.equal((await res.text()).includes('private-token'), false);
} finally { await new Promise<void>(resolve => failureServer.close(() => resolve())); }
console.log('GitHub history passed: no-Git HTTP, auth, pagination, pinned SHA, cache, unknown stats, errors and recovery.');
