import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function classify(files) {
  const code = files.some(p => !(/^(docs|log)\//.test(p) || /^[^/]+\.md$/i.test(p)));
  const common = files.some(p => /^(package(-lock)?\.json|turbo\.json|tsconfig[^/]*|\.npmrc)$/.test(p) || p.startsWith('.github/'));
  return {
    code,
    pdf: code && (common || files.some(p => /^(apps\/web\/(vendor\/geohome|scripts|src)|packages)\//.test(p))),
    furniture: code && (common || files.some(p => /^(apps\/web|apps\/api\/(src\/(tables|room-studio)|test)|packages|scripts)\//.test(p))),
  };
}

if (process.env.GITHUB_OUTPUT && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let scope;
  try {
    const base = process.env.BASE_SHA, head = process.env.HEAD_SHA;
    if (![base, head].every(v => /^[a-f0-9]{40}$/.test(v || '') && !/^0+$/.test(v))) throw Error('Missing comparison base');
    const range = process.env.IS_PR === 'true' ? `${base}...${head}` : `${base}..${head}`;
    const files = execFileSync('git', ['diff', '--name-only', '-z', range], {maxBuffer: 16 * 1024 * 1024}).toString().split('\0').filter(Boolean);
    scope = classify(files);
  } catch {
    // New branch, unavailable base or oversized diff: run checks, never skip silently.
    scope = {code: true, pdf: true, furniture: true};
  }
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(scope).map(([k,v]) => `${k}=${v}\n`).join(''));
}
