import test from 'node:test';
import assert from 'node:assert/strict';
import {classify} from './ci-changes.mjs';
test('documentation does not consume install/build runners', () => {
  assert.deepEqual(classify(['README.md','docs/room-studio-platform.md','log/551-600.md']), {code:false,pdf:false,furniture:false});
});
test('root locks and workflow changes retain all checks', () => {
  for (const p of ['package-lock.json','package.json','.github/workflows/ci.yml','.github/scripts/ci-changes.mjs'])
    assert.deepEqual(classify([p]),{code:true,pdf:true,furniture:true});
});
test('runtime markdown is code, mixed documentation does not hide it', () => {
  assert.equal(classify(['apps/web/src/content/help.md']).code,true);
  assert.equal(classify(['README.md','server/auth.ts']).code,true);
});
test('room geometry and shared inputs preserve specialized jobs', () => {
  for (const p of ['apps/web/src/lib/room-clearance.ts','packages/shared-types/room-styles.json'])
    assert.deepEqual(classify([p]),{code:true,pdf:true,furniture:true});
  assert.equal(classify(['apps/api/src/tables/constructor-products.service.ts']).furniture,true);
});
test('backend-only non-furniture code keeps core tests without browser-only jobs', () => {
  assert.deepEqual(classify(['server/roomStudioBridge.ts']),{code:true,pdf:false,furniture:false});
});

test('missing or zero comparison SHA runs all checks; an empty real diff skips installs', async () => {
  const {execFileSync} = await import('node:child_process');
  const {mkdtempSync,readFileSync,rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {fileURLToPath} = await import('node:url');
  const root = fileURLToPath(new URL('../../',import.meta.url));
  const head = execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim();
  const dir = mkdtempSync(join(tmpdir(),'ci-scope-'));
  try {
    for (const [base,expected] of [['0'.repeat(40),'true'],['invalid','true'],[head,'false']]) {
      const output=join(dir,base);
      execFileSync(process.execPath,[fileURLToPath(new URL('./ci-changes.mjs',import.meta.url))],{
        cwd:root,env:{...process.env,GITHUB_OUTPUT:output,BASE_SHA:base,HEAD_SHA:head,IS_PR:'true'},
      });
      assert.equal(readFileSync(output,'utf8'),`code=${expected}\npdf=${expected}\nfurniture=${expected}\n`);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
