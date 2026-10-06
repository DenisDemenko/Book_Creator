import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { computeEffective, type EffectiveAccess } from '../server/core/collaboration/access';
import type { RealtimeAccessDeps } from '../server/realtimeAuth';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'collaboration-source-'));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, 'source.db');
// These modules read DATA_DIR at import, so load routes only after configuring it.
const store = await import('../server/bookStore');
const db = await import('../server/db');
const { registerSourceRoutes } = await import('../server/core/collaboration/sourceRoutes');
let passed = 0;
const check = (label: string, valid: boolean) => { if (!valid) throw new Error(label); passed++; console.log(`✓ ${label}`); };
let revoked = false;
const access: RealtimeAccessDeps = {
  getBookOwnerId: async id => (await store.getBook(id))?.ownerId,
  getCollabOwnerId: async () => undefined,
  listAcceptedInvites: async () => [],
  effectiveAccess: async ({ projectId, userId }) => {
    if (revoked || !['editor', 'reader'].includes(userId)) return null;
    const eff: EffectiveAccess = computeEffective(projectId, userId, [], { full: false });
    eff.scenes.s1 = userId === 'editor' ? 'edit' : 'view';
    eff.restricted = true;
    eff.canWriteAny = userId === 'editor';
    return eff;
  },
};
async function suite(label: string) {
  console.log(label);
  revoked = false;
  await store.saveBook({ ownerId: 'owner', book: {
    id: 'shared', title: 'Спільна книга', characters: [],
    chapters: [{ id: 'ch', sections: [{ id: 's1', content: 'Початок' }, { id: 'secret', content: 'Таємний текст' }] }],
  } });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = String(req.headers['x-user'] || 'guest');
    req.principal = { id: user === 'guest' ? null : user, role: user === 'admin' ? 'admin' : 'writer', isGuest: user === 'guest' } as any;
    next();
  });
  let savedEvents = 0;
  registerSourceRoutes(app, { access, onSaved: () => { savedEvents++; } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/core/projects/shared/source`;
  const request = async (user: string, suffix = '', method = 'GET', data?: unknown) => {
    const res = await fetch(root + suffix, { method, headers: { 'x-user': user, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: res.status, body: await res.json() };
  };
  const patch = (user: string, section: string, expectedRevision: number, content: unknown) => request(user, `/chapters/ch/sections/${section}`, 'PATCH', { expectedRevision, patch: { content } });
  try {
    check('гість не читає джерело', (await request('guest')).status === 401);
    check('сторонній не читає історію', (await request('stranger', '/history')).status === 403);
    const visible = await request('editor');
    check('обмежений редактор бачить тільки дозволену сцену', visible.status === 200 && visible.body.book.chapters[0].sections.length === 1 && !JSON.stringify(visible.body).includes('Таємний текст'));
    check('читач не редагує', (await patch('reader', 's1', 1, 'Атака')).status === 403);
    check('редактор не змінює чужу сцену', (await patch('editor', 'secret', 1, 'Атака')).status === 403);
    check('патч не приймає структуру', (await request('editor', '/chapters/ch/sections/s1', 'PATCH', { expectedRevision: 1, patch: { id: 'secret' } })).status === 400);
    check('патч без ревізії відхилено', (await request('owner', '/chapters/ch/sections/s1', 'PATCH', { patch: { content: 'Атака' } })).status === 400);
    check('невірний тип тексту відхилено', (await patch('owner', 's1', 1, {})).status === 400);
    const writes = await Promise.all([patch('editor', 's1', 1, 'Правка А'), patch('editor', 's1', 1, 'Правка Б')]);
    check('одночасні API-записи: один успіх, один конфлікт', writes.filter(r => r.status === 200).length === 1 && writes.filter(r => r.status === 409).length === 1);
    check('конфлікт повертає поточну ревізію', writes.find(r => r.status === 409)?.body.current === 2);
    check('прихована сцена не змінилась', ((await store.getBook('shared'))?.book as any)?.chapters[0].sections[1].content === 'Таємний текст');
    const old = await request('editor', '/history/1');
    check('історія також приховує недозволений текст', old.status === 200 && old.body.book.chapters[0].sections[0].content === 'Початок' && !JSON.stringify(old.body).includes('Таємний текст'));
    check('учасник не відновлює всю книгу', (await request('editor', '/restore', 'POST', { sourceRevision: 1, expectedRevision: 2 })).status === 403);
    check('власник бачить обидві ревізії', (await request('owner', '/history')).body.revisions.length === 2);
    const restore = await request('owner', '/restore', 'POST', { sourceRevision: 1, expectedRevision: 2 });
    check('відновлення повертає початковий текст новою ревізією', restore.status === 200 && restore.body.revision === 3 && restore.body.book.chapters[0].sections[0].content === 'Початок');
    check('застаріле відновлення не перезаписує книгу', (await request('owner', '/restore', 'POST', { sourceRevision: 1, expectedRevision: 2 })).status === 409);
    check('невідома ревізія повертає 404', (await request('owner', '/history/999')).status === 404);
    revoked = true;
    check('відкликані права діють на наступному запиті', (await patch('editor', 's1', 3, 'Атака')).status === 403);
    check('сповіщення кімнати тільки після успішних записів', savedEvents === 2);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
try {
  await suite('JSON');
  await db.initDb();
  check('SQLite увімкнено', db.isAvailable());
  await suite('SQLite');
  console.log(`Підсумок: ${passed} пройшло.`);
} finally {
  db.closeDb();
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    // Cleanup must not mask assertion failures or fail a successful Windows run.
    console.warn('Не вдалося прибрати тестову папку SQLite:', (error as NodeJS.ErrnoException).code);
  }
}
