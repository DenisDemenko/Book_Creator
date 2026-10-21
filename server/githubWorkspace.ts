const REPO = 'DenisDemenko/Book_Creator';
export interface WorkspacePull {
  number: number; title: string; branch: string; head: string; base: string;
  repository: string; state: 'draft' | 'open' | 'merged' | 'closed'; url: string;
}
export interface GithubWorkspace {
  branches: { name: string; head: string }[];
  pulls: WorkspacePull[];
  truncated: boolean;
  checkedAt: string;
}
export interface GithubComparison {
  masterHead: string; branchHead: string; ahead: number; behind: number;
  unpublished: string[]; complete: boolean;
}

/** Bounded, cached GitHub reads; credentials and API locations never come from HTTP input. */
export function createGithubWorkspaceReader(options: {
  request?: typeof fetch; token?: string; now?: () => number;
} = {}) {
  const request = options.request ?? fetch;
  const token = options.token ?? process.env.GIT_HISTORY_GITHUB_TOKEN;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expires: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();
  async function cached<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const saved = cache.get(key);
    if (saved && saved.expires > now()) return saved.value as T;
    if (pending.has(key)) return pending.get(key) as Promise<T>;
    const running = operation().then(value => {
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: now() + 300000, value }); return value;
    });
    pending.set(key, running);
    try { return await running; } finally { pending.delete(key); }
  }
  async function json(route: string, signal: AbortSignal): Promise<any> {
    const response = await request(`https://api.github.com/repos/${REPO}/${route}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Book-Creator-History', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal, redirect: 'error',
    });
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429
      ? 'GitHub обмежив запити. Повторіть пізніше.' : `GitHub: не вдалося прочитати гілки або PR (HTTP ${response.status}).`);
    return response.json();
  }
  function catalog(): Promise<GithubWorkspace> {
    return cached('catalog', async () => {
      const signal = AbortSignal.timeout(25000);
      async function list(route: string) {
        const rows: any[] = [];
        for (let page = 1; page <= 10; page++) {
          const batch = await json(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`, signal);
          if (!Array.isArray(batch)) throw new Error('GitHub: некоректний список.');
          rows.push(...batch);
          if (batch.length < 100) return { rows, truncated: false };
        }
        return { rows, truncated: true };
      }
      const [branches, pulls] = await Promise.all([list('branches'), list('pulls?state=all&sort=updated&direction=desc')]);
      return {
        branches: branches.rows.filter(b => typeof b.name === 'string' && /^[a-f0-9]{40}$/i.test(b.commit?.sha))
          .map(b => ({ name: b.name, head: b.commit.sha })),
        pulls: pulls.rows.filter(p => Number.isInteger(p.number) && p.head && p.base).map(p => ({
          number: p.number, title: String(p.title), branch: p.head.ref, head: p.head.sha,
          repository: p.head.repo?.full_name || '', base: p.base.ref,
          state: p.merged_at ? 'merged' : p.state === 'closed' ? 'closed' : p.draft ? 'draft' : 'open',
          url: `https://github.com/${REPO}/pull/${p.number}`,
        })),
        truncated: branches.truncated || pulls.truncated, checkedAt: new Date(now()).toISOString(),
      };
    });
  }
  function compare(masterHead: string, branchHead: string): Promise<GithubComparison> {
    if (![masterHead, branchHead].every(sha => /^[a-f0-9]{40}$/i.test(sha))) throw new Error('GitHub: некоректний SHA.');
    if (masterHead === branchHead) return Promise.resolve({ masterHead, branchHead, ahead: 0, behind: 0, unpublished: [], complete: true });
    return cached(`${masterHead}:${branchHead}`, async () => {
      const signal = AbortSignal.timeout(25000);
      const unpublished: string[] = [];
      let ahead = 0, behind = 0;
      for (let page = 1; page <= 20; page++) {
        const data = await json(`compare/${masterHead}...${branchHead}?per_page=100&page=${page}`, signal);
        if (!Array.isArray(data.commits) || !Number.isInteger(data.total_commits) ||
          !Number.isInteger(data.ahead_by) || !Number.isInteger(data.behind_by)) throw new Error('GitHub: некоректне порівняння.');
        ahead = data.ahead_by; behind = data.behind_by;
        for (const commit of data.commits) {
          if (!/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error('GitHub: некоректний SHA.');
          unpublished.push(commit.sha);
        }
        if (unpublished.length >= data.total_commits || data.commits.length < 100)
          return { masterHead, branchHead, ahead, behind, unpublished, complete: unpublished.length === data.total_commits };
      }
      return { masterHead, branchHead, ahead, behind, unpublished, complete: false };
    });
  }
  return { catalog, compare };
}
