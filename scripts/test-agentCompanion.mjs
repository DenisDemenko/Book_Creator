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
