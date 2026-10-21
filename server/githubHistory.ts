import type { GitCommit } from './gitHistoryRoutes';
import { parseJournalEntry } from './journal';

const REPOSITORY = 'DenisDemenko/Book_Creator';
export interface GithubHistory {
  commits: GitCommit[];
  branch: string;
  hasMore: boolean;
  checkedAt: string;
  repository: string;
}

/** Server-side only: fixed GitHub host/repository; no request-controlled URLs or credentials. */
export function createGithubHistoryReader(options: {
  request?: typeof fetch;
  ref?: string;
  token?: string;
  now?: () => number;
} = {}) {
  const request = options.request ?? fetch;
  const ref = options.ref || process.env.GIT_HISTORY_GITHUB_REF || 'master';
  const token = options.token ?? process.env.GIT_HISTORY_GITHUB_TOKEN;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expires: number; value: GithubHistory }>();
  const pending = new Map<string, Promise<GithubHistory>>();
  async function read(limit: number, selectedRef = ref): Promise<GithubHistory> {
    const key = JSON.stringify([selectedRef, limit]);
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.value;
    const running = pending.get(key);
    if (running) return running;
    const operation = (async () => {
      const commits: GitCommit[] = [];
      let cursor = selectedRef, hasMore = false;
      const deadline = AbortSignal.timeout(25000);
      for (let page = 1; commits.length < limit; page++) {
        const url = new URL(`https://api.github.com/repos/${REPOSITORY}/commits`);
        url.searchParams.set('sha', cursor);
        url.searchParams.set('per_page', '100');
        url.searchParams.set('page', String(page));
        const response = await request(url, {
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Book-Creator-History', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          redirect: 'error', signal: deadline,
        });
        if (!response.ok) {
          // Do not echo upstream bodies: they may contain operational details.
          if (response.status === 403 || response.status === 429)
            throw new Error('GitHub обмежив запити. Спробуйте пізніше; адміністратор може налаштувати серверний GIT_HISTORY_GITHUB_TOKEN.');
          if (response.status === 404)
            throw new Error('GitHub: репозиторій або гілка недоступні. Перевірте серверний GIT_HISTORY_GITHUB_REF і доступ токена.');
          throw new Error(`Не вдалося отримати історію з GitHub (HTTP ${response.status}).`);
        }
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error('GitHub повернув некоректну історію.');
        if (page === 1 && rows.length) cursor = rows[0].sha; // Pin all pages to one snapshot.
        const remaining = limit - commits.length;
        for (const row of rows.slice(0, remaining)) {
          if (!/^[a-f0-9]{40}$/i.test(row?.sha) || typeof row?.commit?.message !== 'string' ||
              !Number.isFinite(Date.parse(row.commit.author?.date)) || !Number.isFinite(Date.parse(row.commit.committer?.date)))
            throw new Error('GitHub повернув некоректний коміт.');
          const subject = row.commit.message.split('\n')[0];
          commits.push({ hash: row.sha, shortHash: row.sha.slice(0, 7),
            date: row.commit.author.date, commitDate: row.commit.committer.date,
            author: row.commit.author.name || row.author?.login || '—', subject,
            // List commits has no file/line statistics; never invent zero changes.
            filesChanged: null, insertions: null, deletions: null,
            journalEntry: /^Merge (?:PR|pull request) #/i.test(subject) ? null : parseJournalEntry(subject), pushedTo: ['GitHub'],
            isMerge: Array.isArray(row.parents) && row.parents.length > 1 });
        }
        // A full page may have a next page; the next request resolves that.
        hasMore = rows.length === 100 || rows.length > remaining;
        if (rows.length < 100) break;
      }
      const value = { commits: commits.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
        branch: selectedRef, hasMore, repository: REPOSITORY, checkedAt: new Date(now()).toISOString() };
      if (cache.size >= 8 && !cache.has(key)) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: now() + 300000, value });
      return value;
    })();
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  }
  return read;
}
