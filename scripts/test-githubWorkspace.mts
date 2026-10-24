import assert from 'node:assert/strict';
import express from 'express';
import { createGithubWorkspaceReader } from '../server/githubWorkspace.ts';
import { createGithubHistoryReader } from '../server/githubHistory.ts';
import { registerGitHistoryRoutes } from '../server/gitHistoryRoutes.ts';

const sha = (n: number) => n.toString(16).padStart(40, '0');
const master = sha(1), head = sha(2), common = sha(3);
let calls = 0, now = 0;
const workspace = createGithubWorkspaceReader({ token: 'secret', now: () => now, request: async (input, init) => {
  calls++;
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://api.github.com');
  assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer secret');
  let body: unknown;
  if (url.pathname.endsWith('/branches')) body = [{ name: 'master', commit: { sha: master } },
    { name: 'feature/voice-dictation-book-text', commit: { sha: head } }];
  else if (url.pathname.endsWith('/pulls')) body = [
    { number: 19, title: 'Voice dictation', state: 'open', draft: true, head: { ref: 'feature/voice-dictation-book-text', sha: head, repo: { full_name: 'DenisDemenko/Book_Creator' } }, base: { ref: 'master' } },
    { number: 18, title: 'Merged', state: 'closed', merged_at: '2026-10-21', head: { ref: 'old', sha: common, repo: null }, base: { ref: 'master' } },
    { number: 17, title: 'Closed', state: 'closed', head: { ref: 'closed', sha: common }, base: { ref: 'master' } },
  ];
  else { assert.equal(url.pathname.endsWith(`compare/${master}...${head}`), true); body = { total_commits: 1, ahead_by: 1, behind_by: 0, commits: [{ sha: head }] }; }
  return new Response(JSON.stringify(body));
} });
const [catalog, duplicate] = await Promise.all([workspace.catalog(), workspace.catalog()]);
assert.equal(calls, 2); assert.equal(catalog, duplicate);
assert.deepEqual(catalog.pulls.map(p => p.state), ['draft', 'merged', 'closed']);
assert.equal(catalog.branches[1].name, 'feature/voice-dictation-book-text');
assert.equal(JSON.stringify(catalog).includes('secret'), false);
await workspace.catalog(); assert.equal(calls, 2);
const comparison = await workspace.compare(master, head);
assert.deepEqual(comparison.unpublished, [head]); assert.equal(comparison.complete, true);
await workspace.compare(master, head); assert.equal(calls, 3);
await workspace.compare(master, master); assert.equal(calls, 3);
now += 300001; await workspace.catalog(); assert.equal(calls, 5);
assert.throws(() => workspace.compare('../invalid', head));

let pages = 0;
const paginated = createGithubWorkspaceReader({ request: async input => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/pulls')) return new Response('[]');
  pages++;
  return new Response(JSON.stringify(url.searchParams.get('page') === '1'
    ? Array.from({ length: 100 }, (_, n) => ({ name: 'branch-' + n, commit: { sha: sha(n + 1) } }))
    : [{ name: 'last', commit: { sha: head } }]));
} });
assert.equal((await paginated.catalog()).branches.length, 101); assert.equal(pages, 2);
const bounded = createGithubWorkspaceReader({ request: async () => new Response(JSON.stringify({
  total_commits: 2001, ahead_by: 2001, behind_by: 0, commits: Array.from({ length: 100 }, (_, i) => ({ sha: sha(i + 100) })),
})) });
assert.equal((await bounded.compare(master, head)).complete, false, 'partial comparison never proves membership');

let historyRef = '', principal: any = { id: 'admin', role: 'admin', isGuest: false };
let compareUnavailable = false;
const app = express();
app.use((req: any, _res, next) => { req.principal = principal; next(); });
registerGitHistoryRoutes(app, { localAvailable: () => true,
  workspace: { catalog: workspace.catalog, compare: async (...args) => {
    if (compareUnavailable) throw new Error('private error'); return workspace.compare(...args);
  } },
  readGithub: async (_limit, ref) => {
    historyRef = ref!;
    const commit = (hash: string) => ({ hash, shortHash: hash.slice(0, 7), date: '2026-10-21', commitDate: '2026-10-21',
      author: 'Agent', subject: 'Work', filesChanged: null, insertions: null, deletions: null, pushedTo: ['GitHub'], journalEntry: null, isMerge: false });
    return { repository: 'DenisDemenko/Book_Creator', branch: ref!, commits: [commit(head), commit(common)], hasMore: false, checkedAt: '2026-10-21' };
  },
});
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + (server.address() as any).port;
const url = base + '/api/admin/git/commits?branch=' + encodeURIComponent('feature/voice-dictation-book-text');
try {
  const listing = await fetch(base + '/api/admin/git/workspace');
  assert.equal(listing.status, 200); assert.equal(listing.headers.get('Cache-Control'), 'no-store');
  let response = await fetch(url); let body = await response.json();
  assert.equal(response.status, 200); assert.equal(historyRef, head, 'history uses catalog SHA, not a mutable branch name');
  assert.deepEqual(body.commits.map(c => c.masterStatus), ['branch', 'master']);
  assert.equal(body.branch, 'feature/voice-dictation-book-text');
  compareUnavailable = true;
  body = await (await fetch(url)).json();
  assert.deepEqual(body.commits.map(c => c.masterStatus), ['unknown', 'unknown']);
  assert.ok(body.comparisonWarning); assert.equal(JSON.stringify(body).includes('private error'), false);
  assert.equal((await fetch(base + '/api/admin/git/commits?branch=missing')).status, 404);
  assert.equal((await fetch(base + '/api/admin/git/commits?branch[]=master')).status, 400);
  principal = { id: 'writer', role: 'writer', isGuest: false };
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(base + '/api/admin/git/workspace')).status, 403);
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }

let selected = '';
const history = createGithubHistoryReader({ request: async input => {
  selected = new URL(String(input)).searchParams.get('sha')!;
  return new Response(JSON.stringify([{ sha: head, parents: [], commit: { author: { name: 'Agent', date: '2026-10-21' },
    committer: { date: '2026-10-21' }, message: 'Merge PR #19: voice' } }]));
} });
await history(10, 'master'); await history(10, 'feature/voice');
assert.equal(selected, 'feature/voice', 'cache is isolated by ref');
assert.equal((await history(10, 'feature/voice')).commits[0].journalEntry, null, 'PR numbers are not journal entries');
console.log('Workspace passed: branch/PR paging, cache, statuses, SHA pinning, membership, partial/error state, auth and ref-isolated history.');
