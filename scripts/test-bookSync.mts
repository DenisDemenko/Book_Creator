import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  RemoteSyncError, SyncBlockedError, SyncVerifyError, createFileSyncState, createRemoteSide,
  readSyncConfig, syncApply, syncStatus, tokenMatches,
  type BookSyncSide, type SyncStateStore, type SyncedBook,
} from '../server/bookSync';
import { summarizeBook } from '../server/bookSyncPlan';

let count = 0;
const check = async (name: string, run: () => Promise<void>) => { await run(); count++; console.log('✓ ' + name); };

const T0 = Date.parse('2026-10-24T10:00:00.000Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

/** Підставна сторона: тримає одну книгу в пам'яті, як сховище з ревізіями. */
function fakeSide(initial: { text: string; minutes: number; owner?: string } | null, opts: { lossy?: boolean } = {}) {
  let stored: SyncedBook | null = initial ? mkBook(initial.text, 1, initial.minutes) : null;
  const history: string[] = stored ? [JSON.stringify(stored.book)] : [];
  let clock = 1000;
  const side: BookSyncSide = {
    async getBook() { return stored ? structuredClone(stored) : null; },
    async putBook(book, expected) {
      if (stored && expected !== stored.revision) throw new Error('revision conflict');
      if (!stored && expected !== undefined) throw new Error('revision conflict');
      const written = opts.lossy ? { ...book, chapters: [] } : book;
      stored = { id: 'BK-1', title: 'T', revision: (stored?.revision ?? 0) + 1, updatedAt: iso(clock++), book: structuredClone(written) };
      history.push(JSON.stringify(stored.book));
      return { revision: stored.revision, updatedAt: stored.updatedAt };
    },
  };
  return { side, history, get stored() { return stored; } };
}
function mkBook(text: string, revision: number, minutes: number): SyncedBook {
  return { id: 'BK-1', title: 'T', revision, updatedAt: iso(minutes), book: { id: 'BK-1', title: 'T', chapters: [{ id: 'c1', title: 'Г1', text }] } };
}
function memState(): SyncStateStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, async get(id) { return map.get(id) ?? null; }, async set(id, h) { map.set(id, h); } };
}

await check('status показує обидві версії й план', async () => {
  const local = fakeSide({ text: 'a', minutes: 0 });
  const remote = fakeSide({ text: 'b', minutes: 60 });
  const st = await syncStatus(local.side, remote.side, 'BK-1', memState());
  assert.equal(st.plan.action, 'pull');
  assert.notEqual(st.local!.hash, st.remote!.hash);
});

await check('pull: беремо новішу віддалену, обидві сторони зійшлися, стару збережено в історії', async () => {
  const local = fakeSide({ text: 'стара локальна', minutes: 0 });
  const remote = fakeSide({ text: 'нова з проду', minutes: 60 });
  const state = memState();
  const res = await syncApply(local.side, remote.side, 'BK-1', state);
  assert.equal(res.applied, true);
  assert.equal(res.direction, 'pull');
  assert.equal(summarizeBook(local.stored!).hash, summarizeBook(remote.stored!).hash);
  assert.equal(state.map.get('BK-1'), res.hash);
  assert.ok(local.history.some((h) => h.includes('стара локальна')), 'стара версія лишилась в історії');
  assert.equal(local.stored!.revision, 2);
});

await check('push: локальна новіша йде на віддалений', async () => {
  const local = fakeSide({ text: 'нова локальна', minutes: 60 });
  const remote = fakeSide({ text: 'стара на проді', minutes: 0 });
  const res = await syncApply(local.side, remote.side, 'BK-1', memState());
  assert.equal(res.direction, 'push');
  assert.ok(JSON.stringify(remote.stored!.book).includes('нова локальна'));
  assert.ok(remote.history.some((h) => h.includes('стара на проді')));
});

await check('однакові версії — нічого не пишемо', async () => {
  const local = fakeSide({ text: 'x', minutes: 0 });
  const remote = fakeSide({ text: 'x', minutes: 10 });
  const state = memState();
  const res = await syncApply(local.side, remote.side, 'BK-1', state);
  assert.equal(res.applied, false);
  assert.equal(local.stored!.revision, 1);
  assert.equal(remote.stored!.revision, 1);
  assert.ok(state.map.get('BK-1'));
});

await check('книги ще немає тут — створюється з віддаленої', async () => {
  const local = fakeSide(null);
  const remote = fakeSide({ text: 'є на проді', minutes: 5 });
  const res = await syncApply(local.side, remote.side, 'BK-1', memState());
  assert.equal(res.direction, 'pull');
  assert.ok(JSON.stringify(local.stored!.book).includes('є на проді'));
});

await check('blocked без явного напряму кидає SyncBlockedError, з напрямом — виконується', async () => {
  const local = fakeSide({ text: 'a', minutes: 0 });
  const remote = fakeSide({ text: 'b', minutes: 0.5 });
  await assert.rejects(() => syncApply(local.side, remote.side, 'BK-1', memState()), SyncBlockedError);
  assert.equal(local.stored!.revision, 1);
  const res = await syncApply(local.side, remote.side, 'BK-1', memState(), { direction: 'push' });
  assert.equal(res.direction, 'push');
  assert.ok(JSON.stringify(remote.stored!.book).includes('"a"'));
});

await check('приймач, що перекручує книгу, не зараховується', async () => {
  const remote = fakeSide({ text: 'b', minutes: 60 });
  const lossyLocal = fakeSide({ text: 'a', minutes: 0 }, { lossy: true });
  await assert.rejects(() => syncApply(lossyLocal.side, remote.side, 'BK-1', memState()), SyncVerifyError);
});

await check('конфлікт ревізій на приймачі не лишає часткового запису й стану', async () => {
  const local = fakeSide({ text: 'a', minutes: 0 });
  const remote = fakeSide({ text: 'b', minutes: 60 });
  const original = local.side.putBook;
  local.side.putBook = async () => { throw new Error('revision conflict'); };
  const state = memState();
  await assert.rejects(() => syncApply(local.side, remote.side, 'BK-1', state), /revision conflict/);
  assert.equal(state.map.size, 0);
  local.side.putBook = original;
});

await check('конфіг: без змінних усе вимкнено', async () => {
  const c = readSyncConfig({});
  assert.equal(c.remote, null);
  assert.equal(c.receiver, null);
});

await check('конфіг: приймач потребує токен І власника; віддалена — https', async () => {
  assert.equal(readSyncConfig({ BOOK_SYNC_TOKEN: 't' }).receiver, null);
  assert.deepEqual(readSyncConfig({ BOOK_SYNC_TOKEN: 't', BOOK_SYNC_OWNER_ID: 'u1' }).receiver, { token: 't', ownerId: 'u1' });
  assert.equal(readSyncConfig({ BOOK_SYNC_TOKEN: 't', BOOK_SYNC_REMOTE_URL: 'http://example.com' }).remote, null);
  assert.equal(readSyncConfig({ BOOK_SYNC_TOKEN: 't', BOOK_SYNC_REMOTE_URL: 'ftp://example.com' }).remote, null);
  assert.equal(readSyncConfig({ BOOK_SYNC_TOKEN: 't', BOOK_SYNC_REMOTE_URL: 'не url' }).remote, null);
  assert.deepEqual(readSyncConfig({ BOOK_SYNC_TOKEN: 't', BOOK_SYNC_REMOTE_URL: 'https://www.fusionlab.in.ua/studio/ ' }).remote,
    { baseUrl: 'https://www.fusionlab.in.ua/studio', token: 't' });
  assert.ok(readSyncConfig({ BOOK_SYNC_TOKEN: 't', BOOK_SYNC_REMOTE_URL: 'http://localhost:4000' }).remote);
});

await check('токен: лише Bearer і точний збіг', async () => {
  assert.equal(tokenMatches('Bearer секрет', 'секрет'), true);
  assert.equal(tokenMatches('bearer секрет', 'секрет'), true);
  assert.equal(tokenMatches('Bearer інший', 'секрет'), false);
  assert.equal(tokenMatches('секрет', 'секрет'), false);
  assert.equal(tokenMatches(undefined, 'секрет'), false);
  assert.equal(tokenMatches('Bearer ', 'секрет'), false);
  assert.equal(tokenMatches('Bearer x', ''), false);
});

await check('віддалений клієнт: шляхи, заголовок, 404 → null, 409 → помилка з ревізією', async () => {
  const calls: Array<{ url: string; method: string; auth: string | null; body?: any }> = [];
  const fakeFetch = (async (url: string, init: any) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/api/sync/books/MISSING')) return new Response('{}', { status: 404 });
    if (init.method === 'PUT') return new Response(JSON.stringify({ error: 'змінили', current: 7 }), { status: 409 });
    return new Response(JSON.stringify(mkBook('t', 3, 0)), { status: 200 });
  }) as unknown as typeof fetch;
  const side = createRemoteSide({ baseUrl: 'https://prod.example/studio', token: 'ТОКЕН' }, fakeFetch);
  assert.equal(await side.getBook('MISSING'), null);
  assert.equal((await side.getBook('BK 1/2'))!.revision, 3);
  assert.equal(calls[1].url, 'https://prod.example/studio/api/sync/books/BK%201%2F2');
  assert.equal(calls[1].auth, 'Bearer ТОКЕН');
  await assert.rejects(() => side.putBook({ id: 'BK-1' }, 3), (e: any) => e instanceof RemoteSyncError && e.status === 409 && e.current === 7);
  assert.deepEqual(calls[2].body, { book: { id: 'BK-1' }, expectedRevision: 3 });
});

await check('стан у файлі: зберігається й читається, книги не змішуються', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'booksync-'));
  const a = createFileSyncState(dir);
  assert.equal(await a.get('BK-1'), null);
  await Promise.all([a.set('BK-1', 'h1'), a.set('BK-2', 'h2')]);
  const b = createFileSyncState(dir);
  assert.equal(await b.get('BK-1'), 'h1');
  assert.equal(await b.get('BK-2'), 'h2');
  await b.set('BK-1', 'h3');
  assert.equal(await a.get('BK-1'), 'h3');
  await fs.rm(dir, { recursive: true, force: true });
});

console.log('Підсумок: ' + count + ' пройшло.');
