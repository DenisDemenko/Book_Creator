import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repositoryOf, validateServer, git, snapshot, execute } from './agent-companion.mjs';

test('allowlist rejects wrong repositories and credential-bearing URLs', () => {
  assert.equal(repositoryOf('https://github.com/DenisDemenko/Book_Creator.git'), 'DenisDemenko/Book_Creator');
  assert.equal(repositoryOf('git@github.com:DenisDemenko/Fusion-Lab-Marketplaes.git'), 'DenisDemenko/Fusion-Lab-Marketplaes');
  for (const url of ['https://github.com/DenisDemenko/FusionLabPush.git','https://evil.test/DenisDemenko/Book_Creator.git','https://token@github.com/DenisDemenko/Book_Creator.git'])
    assert.equal(repositoryOf(url), null);
  assert.equal(validateServer('https://example.test/studio/'), 'https://example.test/studio');
  assert.throws(() => validateServer('http://example.test'));
  assert.throws(() => validateServer('https://token@example.test'));
  assert.equal(validateServer('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
});

test('real Git transport: verified push, receive and rejection of divergent history', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'companion-transport-')));
  const remote = path.join(dir, 'remote.git');
  const source = path.join(dir, 'source');
  const receiver = path.join(dir, 'receiver');
  const githubUrl = 'https://github.com/DenisDemenko/Book_Creator.git';
  async function prepare(root) {
    fs.mkdirSync(root);
    await git(root, ['init', '-b', 'test-handoff']);
    await git(root, ['config', 'user.email', 'test@example.invalid']);
    await git(root, ['config', 'user.name', 'Transport Test']);
    await git(root, ['config', 'commit.gpgsign', 'false']);
    // Exercise actual Git transport without writing to the owner's GitHub.
    await git(root, ['remote', 'add', 'bookcreator', githubUrl]);
  }
  function expected(state) { return { expectedHead: state.head, expectedBranch: state.branch }; }
  async function commitFile(root, text) {
    fs.writeFileSync(path.join(root, 'file.txt'), text);
    await git(root, ['add', 'file.txt']);
    await git(root, ['commit', '-m', text]);
  }
  try {
    await git(dir, ['init', '--bare', remote]);
    await prepare(source);
    await commitFile(source, 'base');
    const transport = (root, args, timeout) => git(root, args.map(arg => arg === githubUrl ? remote : arg), timeout);
    const before = await snapshot(source);
    const pushed = await execute(source, { action: 'push', payload: expected(before) }, transport);
    assert.equal(pushed.verifiedPush, true);
    assert.equal(pushed.remoteHead, before.head);
    assert.equal(pushed.pushedHead, before.head);
    assert.equal(pushed.pushedRepository, 'DenisDemenko/Book_Creator');
    await prepare(receiver);
    await git(receiver, ['fetch', remote, 'refs/heads/test-handoff']);
    await git(receiver, ['reset', '--hard', 'FETCH_HEAD']);
    await commitFile(source, 'remote update');
    const next = await snapshot(source);
    await execute(source, { action: 'push', payload: expected(next) }, transport);
    const received = await execute(receiver, { action: 'receive', payload: expected(await snapshot(receiver)) }, transport);
    assert.equal(received.state.head, next.head);
    assert.equal(fs.readFileSync(path.join(receiver, 'file.txt'), 'utf8'), 'remote update');
    await commitFile(receiver, 'local divergence');
    const divergent = await snapshot(receiver);
    await commitFile(source, 'remote divergence');
    const latest = await snapshot(source);
    await execute(source, { action: 'push', payload: expected(latest) }, transport);
    await assert.rejects(execute(receiver, { action: 'push', payload: expected(divergent) }, transport));
    await assert.rejects(execute(receiver, { action: 'receive', payload: expected(divergent) }, transport));
    assert.equal((await snapshot(receiver)).head, divergent.head);
    assert.equal((await git(dir, ['--git-dir', remote, 'rev-parse', 'refs/heads/test-handoff'])).trim(), latest.head);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real Git: selected-file staging, index guard, commit, stale state and no shell injection', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-companion-')));
  try {
    await git(dir, ['init','-b','test-handoff']);
    await git(dir, ['config','user.email','test@example.invalid']);
    await git(dir, ['config','user.name','Companion Test']);
    await git(dir, ['config','commit.gpgsign','false']);
    await git(dir, ['remote','add','bookcreator','https://github.com/DenisDemenko/Book_Creator.git']);
    fs.writeFileSync(path.join(dir,'file.txt'), 'base');
    await git(dir, ['add','file.txt']); await git(dir, ['commit','-m','base']);
    const before = await snapshot(dir);
    fs.writeFileSync(path.join(dir,'file.txt'), 'next');
    fs.writeFileSync(path.join(dir,'other.txt'), 'leave untracked');
    const p = { expectedHead:before.head, expectedBranch:before.branch };
    await assert.rejects(execute(dir, {action:'stage-file',payload:{...p,path:'../outside.txt'}}));
    await assert.rejects(execute(dir, {action:'stage-file',payload:{...p,path:'.'}}));
    await execute(dir, {action:'stage-file',payload:{...p,path:'file.txt'}});
    const staged = await snapshot(dir);
    assert.match(staged.staged, /file\.txt/); assert.doesNotMatch(staged.staged, /other\.txt/);
    await assert.rejects(execute(dir, {action:'commit',payload:{...p,message:'test',expectedIndexHash:'wrong'}}));
    await assert.rejects(execute(dir, {action:'receive',payload:p}), /Save or commit/);
    const message = 'literal $(touch SHOULD_NOT_EXIST) and "quotes"';
    const result = await execute(dir, {action:'commit',payload:{...p,message,expectedIndexHash:staged.stagedHash}});
    assert.equal(result.ok, true);
    assert.notEqual(result.state.head, before.head);
    assert.equal((await git(dir, ['log','-1','--format=%s'])).trim(), message);
    assert.equal(fs.existsSync(path.join(dir,'SHOULD_NOT_EXIST')), false);
    await assert.rejects(execute(dir, {action:'push',payload:p}), /changed/);
    fs.mkdirSync(path.join(dir,'tmp'));
    fs.writeFileSync(path.join(dir,'tmp','session.lock'), 'another agent');
    await assert.rejects(execute(dir, {action:'commit',payload:{expectedHead:result.state.head,expectedBranch:result.state.branch}}), /session.lock/);
    await git(dir, ['remote','set-url','bookcreator','https://github.com/DenisDemenko/FusionLabPush.git']);
    await assert.rejects(snapshot(dir), /not an allowed target/);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});
