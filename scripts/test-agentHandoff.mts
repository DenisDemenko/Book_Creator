import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'agent-handoff-'));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir,'test.db');
const { initDb, closeDb, getDb } = await import('../server/db.ts');
const { registerAgentHandoffRoutes } = await import('../server/agentHandoffRoutes.ts');
assert.equal(await initDb(), true);
let principal: any = { id:'admin-test',role:'admin',isGuest:false };
const app = express();
app.use(express.json());
app.use((req: any,_res,next) => { req.principal = principal; next(); });
registerAgentHandoffRoutes(app);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening',resolve));
const base = 'http://127.0.0.1:' + (server.address() as any).port;
async function call(method: string, url: string, body?: unknown, token?: string) {
  const r = await fetch(base+url, {method,headers:{'Content-Type':'application/json',...(token ? {Authorization:'Bearer '+token} : {})},
    body: body === undefined ? undefined : JSON.stringify(body)});
  return { status:r.status, body:await r.json() as any };
}
try {
  const draft = {repository:'DenisDemenko/Book_Creator',agent:'Codex',session:'one',environment:'test',branch:'test',commit:'',
    task:'Transfer',done:'Code',checks:'Not deployed',remaining:'Windows test',next:'Review',evidence:'Not pushed'};
  let r = await call('POST','/api/admin/agent-handoffs',draft);
  assert.equal(r.status,201); const entryId = r.body.entry.id;
  assert.equal(r.body.entry.recordedBy,'admin-test');
  assert.equal(r.body.entry.acceptedAt,null);
  assert.equal((await call('POST','/api/admin/agent-handoffs',{...draft,repository:'wrong'})).status,400);
  assert.equal((await call('POST','/api/admin/agent-handoffs/'+entryId+'/accept',{})).status,400);
  const accepted = await call('POST','/api/admin/agent-handoffs/'+entryId+'/accept',{agent:'Next',session:'two',notes:'Checked branch and context'});
  assert.equal(accepted.status,200);
  assert.equal((await call('POST','/api/admin/agent-handoffs/'+entryId+'/accept',{agent:'Next',session:'three',notes:'Again'})).status,409);
  closeDb(); assert.equal(await initDb(),true);
  assert.equal((await call('GET','/api/admin/agent-handoffs')).body.entries[0].receivingSession,'two');
  principal = {id:'writer',role:'writer',isGuest:false};
  assert.equal((await call('GET','/api/admin/agent-handoffs')).status,403);
  assert.equal((await call('POST','/api/admin/agent-companion/pair',{name:'PC'})).status,403);
  principal = {id:'admin-test',role:'admin',isGuest:false};
  const pair = await call('POST','/api/admin/agent-companion/pair',{name:'PC'});
  assert.equal(pair.status,201);
  const {id,token} = pair.body;
  assert.equal((await call('POST','/api/agent-companion/poll',{state:{}},'a'.repeat(64))).status,401);
  assert.equal((await call('POST','/api/agent-companion/poll',{state:{head:'a'.repeat(40),branch:'test'}},token)).status,200);
  const listing = await call('GET','/api/admin/agent-companion');
  assert.equal(JSON.stringify(listing.body).includes(token),false);
  assert.equal((await call('POST','/api/admin/agent-companion/'+id+'/jobs',{action:'shell'})).status,400);
  const queued = await call('POST','/api/admin/agent-companion/'+id+'/jobs',{action:'status'});
  assert.equal(queued.status,201);
  assert.equal((await call('POST','/api/admin/agent-companion/'+id+'/jobs',{action:'status'})).status,409);
  const poll = await call('POST','/api/agent-companion/poll',{state:{}},token);
  assert.equal(poll.body.job.id,queued.body.id);
  assert.equal((await call('POST','/api/agent-companion/poll',{state:{}},token)).body.job,null);
  const endpoint = '/api/agent-companion/jobs/'+queued.body.id+'/result';
  assert.equal((await call('POST',endpoint,{ok:true,output:'Done'},token)).status,200);
  assert.equal((await call('POST',endpoint,{ok:false,output:'Do not overwrite'},token)).status,200);
  assert.equal((await call('GET','/api/admin/agent-companion')).body.jobs[0].result.output,'Done');
  const second = await call('POST','/api/admin/agent-companion/'+id+'/jobs',{action:'status'});
  await call('POST','/api/agent-companion/poll',{state:{}},token);
  getDb()!.prepare('UPDATE agent_companion_jobs SET started_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',second.body.id);
  await call('GET','/api/admin/agent-companion');
  assert.equal((await call('POST','/api/admin/agent-companion/'+id+'/jobs',{action:'push',expectedHead:'a'.repeat(40),expectedBranch:'test'})).status,409);
  const revoked = await call('POST','/api/admin/agent-companion/'+id+'/revoke',{});
  assert.equal(revoked.status,200);
  assert.equal((await call('POST','/api/agent-companion/poll',{state:{}},token)).status,401);
  console.log('Agent handoff HTTP/SQLite tests passed: auth, persistence, acceptance, allowlist, claim, idempotent result, unknown state, revoke.');
} finally {
  await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  closeDb(); fs.rmSync(dir,{recursive:true,force:true});
}
