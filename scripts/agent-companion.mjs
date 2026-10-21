import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const KNOWN = ['Book_Creator', 'Fusion-Lab-Marketplaes'];
export function repositoryOf(url) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)DenisDemenko\/([^/]+?)\/?$/i.exec(url.trim());
  const name = match?.[1]?.replace(/\.git$/i, '');
  const canonical = KNOWN.find(value => value.toLowerCase() === name?.toLowerCase());
  return canonical ? 'DenisDemenko/' + canonical : null;
}
export function validateServer(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error('Use a server URL without credentials, query or fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))
    throw new Error('HTTPS is required except on localhost.');
  return url.href.replace(/\/$/, '');
}
export function git(root, args, timeout = 15000) {
  return new Promise((resolve, reject) => execFile('git', ['-c','core.quotepath=false', ...args], {
    cwd: root, timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
      GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=10' },
  }, (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message).slice(0, 4000)));
    else resolve(String(stdout || ''));
  }));
}
export async function snapshot(root) {
  const directory = fs.realpathSync((await git(root, ['rev-parse','--show-toplevel'])).trim());
  // Windows may expose one directory through long/8.3 names or junctions.
  // Compare filesystem identities, rather than two differently spelled paths.
  const requested = fs.statSync(root, { bigint: true });
  const actual = fs.statSync(directory, { bigint: true });
  if (requested.dev !== actual.dev || requested.ino !== actual.ino || !requested.isDirectory())
    throw new Error('RepositoryPath must be the repository root: requested=' + root + '; Git=' + directory);
  const branch = (await git(root, ['symbolic-ref','--quiet','--short','HEAD'])).trim();
  await git(root, ['check-ref-format','--branch',branch]);
  const head = (await git(root, ['rev-parse','HEAD'])).trim();
  const remotes = (await git(root, ['remote'])).trim().split(/\r?\n/).filter(Boolean);
  let selected;
  for (const remote of [...new Set(['bookcreator','production','origin', ...remotes])]) {
    if (!remotes.includes(remote) || !/^[a-zA-Z0-9_-]+$/.test(remote)) continue;
    const urls = (await git(root, ['remote','get-url','--push','--all',remote])).trim().split(/\r?\n/);
    if (urls.length === 1 && repositoryOf(urls[0])) {
      selected = { remote, pushUrl: urls[0], repository: repositoryOf(urls[0]) }; break;
    }
  }
  if (!selected) throw new Error('No single push URL for Book_Creator or Fusion-Lab-Marketplaes. FusionLabPush is not an allowed target.');
  const status = await git(root, ['status','--short']);
  const staged = await git(root, ['diff','--cached','--stat']);
  const raw = await git(root, ['diff','--cached','--raw','--no-abbrev']);
  return { directory, computer: os.hostname(), branch, head, ...selected,
    status: status.slice(0, 10000), staged: staged.slice(0, 10000),
    stagedHash: createHash('sha256').update(raw).digest('hex') };
}
async function assertWritable(root) {
  if (fs.existsSync(path.join(root, 'tmp', 'session.lock'))) throw new Error('Another session owns tmp/session.lock. Finish that session before writing.');
  for (const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply']) {
    const file = (await git(root, ['rev-parse','--git-path', name])).trim();
    if (fs.existsSync(path.resolve(root, file))) throw new Error('Unfinished Git operation: ' + name);
  }
}
// The optional transport lets tests use an isolated bare repository for network
// operations. It is never taken from a queued job or server configuration.
export async function execute(root, job, transport = git) {
  const p = job.payload || {};
  const state = await snapshot(root);
  const writable = !['status','staged-diff'].includes(job.action);
  if (writable) {
    if (p.expectedHead !== state.head || p.expectedBranch !== state.branch) throw new Error('Branch or HEAD changed. Refresh Git status before retrying.');
    await assertWritable(root);
  }
  let output = '', verifiedPush = false, remoteHead = '';
  switch (job.action) {
    case 'status': output = state.status || 'Working tree clean.'; break;
    case 'staged-diff': output = (await git(root, ['diff','--cached','--no-color'])).slice(0, 16000); break;
    case 'stage-file': {
      const name = p.path;
      if (typeof name !== 'string' || !name.trim() || path.isAbsolute(name) || /(^|[\\/])\.\.([\\/]|$)|[\x00-\x1f]/.test(name) || name.startsWith('-'))
        throw new Error('Use a relative path to one file inside the repository.');
      const target = path.resolve(root, name);
      let check = target;
      while (!fs.existsSync(check) && path.dirname(check) !== check) check = path.dirname(check);
      const real = fs.realpathSync(check);
      if (real !== root && !real.startsWith(root + path.sep)) throw new Error('Path escapes repository.');
      if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) throw new Error('Select one regular file, not a directory or symbolic link.');
      output = await git(root, ['--literal-pathspecs','add','--', name]);
      break;
    }
    case 'commit':
      if (typeof p.message !== 'string' || !p.message.trim() || p.message.length > 2000 || /[\x00-\x1f]/.test(p.message)) throw new Error('Invalid commit message.');
      if (!state.staged.trim()) throw new Error('No staged changes.');
      if (p.expectedIndexHash !== state.stagedHash) throw new Error('Staged files changed. Review the staged diff again.');
      output = await git(root, ['commit','-m',p.message], 120000); break;
    case 'push':
      output = await transport(root, ['-c','push.followTags=false','push','--porcelain','--',state.pushUrl,state.head + ':refs/heads/' + state.branch], 120000);
      remoteHead = (await transport(root, ['ls-remote','--heads',state.pushUrl,'refs/heads/' + state.branch],30000)).trim().split(/\s+/)[0] || '';
      verifiedPush = remoteHead === state.head;
      if (!verifiedPush) throw new Error('Push finished, but the remote SHA differs. Inspect the branch before another push.');
      break;
    case 'receive': {
      if (state.status.trim()) throw new Error('Save or commit local changes before receiving.');
      await transport(root, ['fetch','--no-tags','--', state.pushUrl,'refs/heads/' + state.branch],60000);
      const fetched = (await git(root, ['rev-parse','--verify','FETCH_HEAD^{commit}'])).trim();
      const again = await snapshot(root);
      if (again.head !== state.head || again.branch !== state.branch || again.status.trim()) throw new Error('Local state changed during fetch. Nothing merged.');
      output = await git(root, ['merge','--ff-only',fetched],60000); break;
    }
    default: throw new Error('Command not allowed.');
  }
  return { ok: true, output: output.slice(0,16000), verifiedPush, remoteHead,
    pushedHead: verifiedPush ? state.head : null, pushedBranch: verifiedPush ? state.branch : null,
    pushedRepository: verifiedPush ? state.repository : null,
    checkedAt: new Date().toISOString(), state: await snapshot(root) };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function main(config) {
  const base = validateServer(config.server);
  if (!/^[a-f0-9]{64}$/.test(config.token || '')) throw new Error('Invalid pairing token.');
  const root = fs.realpathSync(config.repositoryPath);
  await snapshot(root);
  const lockPath = path.resolve(root, (await git(root, ['rev-parse','--git-path','agent-companion.lock'])).trim());
  const lock = fs.openSync(lockPath, 'wx');
  fs.writeFileSync(lock, String(process.pid));
  let stopped = false, pendingResult = null;
  const stop = () => { stopped = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  async function api(endpoint, body) {
    const response = await fetch(base + endpoint, { method:'POST', redirect:'error',
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + config.token, 'Content-Type':'application/json' },
      body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { stopped = true; throw new Error('Connection expired or revoked. Pair again in Studio.'); }
    if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
    return data;
  }
  console.log('Companion ready for ' + root + '. Keep this window open. Ctrl+C stops it.');
  try {
    while (!stopped) {
      try {
        // Retry delivery only, never repeat a Git command after a lost HTTP response.
        if (pendingResult) {
          await api('/api/agent-companion/jobs/' + pendingResult.id + '/result', pendingResult.result);
          pendingResult = null;
        }
        const state = await snapshot(root);
        const { job } = await api('/api/agent-companion/poll', { state });
        if (job) {
          let result;
          console.log('Executing ' + job.action + ' (' + job.id + ')');
          try { result = await execute(root, job); }
          catch (error) {
            result = { ok: false, output: String(error.message).slice(0,4000), verifiedPush: false,
              state: await snapshot(root).catch(() => null), checkedAt: new Date().toISOString() };
          }
          pendingResult = { id: job.id, result };
          // Save response before polling for any next command.
          continue;
        }
      } catch (error) { console.error(String(error.message).replaceAll(config.token, '[redacted]')); }
      if (!stopped) await delay(2500);
    }
  } finally {
    fs.closeSync(lock); fs.unlinkSync(lockPath);
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 10000) throw new Error('Configuration too large.'); }
  main(JSON.parse(input.replace(/^\uFEFF/, ''))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
