/**
 * Тести автоматичного створення книги з рукопису GrabFusion при відправленні (контракт 1.5.0, журнал #540).
 * Запуск: npm run test:manuscript-book
 *
 *  1. Чисте складання книги (`buildBookFromManuscript`).
 *  2. Справжні маршрути + справжній запис: після `submit` «Набору книги» без книги з'являється книга автора
 *     (перелік книг, глава з текстом), фото привʼязані до її медіатеки, записи «Вхідних» — історія `inserted`.
 *  3. Існуюча книга чи збій створення — пакет, як раніше, у «Вхідних».
 */
const DIR = '/tmp/nova-manuscript-book-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Ajv from 'ajv';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const mb = await import('../src/utils/manuscriptBook');
const routes = await import('../server/external/photoDraftRoutes');
const xroutes = await import('../server/external/externalApiRoutes');
const sinks = await import('../server/external/photoDraftSinks');
const storeMod = await import('../server/store');
const bookStore = await import('../server/bookStore');
const media = await import('../server/media/mediaLibraryStore');
const xstore = await import('../server/external/externalApiStore');
const contract = await import('../shared/photoDraftContract');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/photo-drafts-api/schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(schema, 'pd');
const conforms = (def: string, data: unknown) => {
  const fn = ajv.getSchema(`pd#/definitions/${def}`)!;
  return fn(data) ? '' : ajv.errorsText(fn.errors);
};

// ---------------------------------------------------------------------------
console.log('\nСкладання книги');
{
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const b = mb.buildBookFromManuscript({ title: 'Долина тиші', chapterTitle: 'Розділ 1. Млин', text: 'Вітер ліг на ніч.\n\nУ млині ще горіло світло.', author: 'Авторка', authorRole: 'writer', now, pageCount: 2 });
  t('книга створена з назвою й автором', !!b && b.book.title === 'Долина тиші' && b.book.author === 'Авторка' && b.book.id === `BK-${now.toString(36).toUpperCase()}`);
  t('одна глава з назвою чернетки', !!b && b.book.chapters.length === 1 && b.book.chapters[0].title === 'Розділ 1. Млин' && b.chapterId === `chap-${now}-1`);
  const section = b?.book.chapters[0].sections[0];
  t('текст сторінок у главі', !!section && /Вітер ліг на ніч/.test(section.content) && /У млині ще горіло світло/.test(section.content));
  t('текст приходить AI-чернеткою (автор приймає чи відхиляє)', !!section && /AI-DRAFT|AI-GENERATED/i.test(section.content), String(section?.content).slice(0, 80));
  t('демо-вміст не лишився (персонажі, ілюстрації порожні)', !!b && b.book.characters.length === 0 && (b.book.illustrations ?? []).length === 0);
  t('запис версії створення з позначкою GrabFusion', !!b && b.book.versionHistory?.[0]?.tags?.includes('GrabFusion') === true);
  t('порожній текст — книги немає', mb.buildBookFromManuscript({ title: 'X', text: '   ', author: 'A', authorRole: 'writer', now }) === null);
  const noChapter = mb.buildBookFromManuscript({ title: 'Лише назва', text: 'Текст.', author: 'A', authorRole: 'writer', now });
  t('без назви глави — глава називається як книга', noChapter?.chapterTitle === 'Лише назва');
}

// ---------------------------------------------------------------------------
console.log('\nСправжній submit');
const nowIso = new Date().toISOString();
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Письменниця', role: 'writer', createdAt: nowIso } as any);
const users: Record<string, any> = { 'u-a': { id: 'u-a', email: 'a@test.ua', name: 'Письменниця', role: 'writer', isGuest: false } };
const tasks: Array<() => Promise<void>> = [];
const flush = async () => { while (tasks.length) await tasks.shift()!(); };
const state = { sink: 'real' as 'real' | 'throws' | 'none' };
const realSinks = { createCourse: sinks.createCourseDraft, createExpress: sinks.createExpressInstruction, createInboxScans: sinks.createInboxScans };
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use((req: any, _res, next) => {
  const u = req.headers['x-test-session'];
  req.principal = typeof u === 'string' && users[u] ? users[u] : { id: null, email: 'guest@local', role: 'guest', isGuest: true };
  next();
});
xroutes.registerExternalApiRoutes(app, { recognize: async () => ({ text: 'x', modelId: 'm' }), schedule: () => undefined });
let pageNo = 0;
routes.registerPhotoDraftRoutes(app, {
  describe: async () => ({ description: 'x', tags: [], modelId: 'v' }),
  recognize: async () => ({ text: pageNo++ % 2 === 0 ? 'Вітер ліг на ніч, і вся долина завмерла.' : 'У млині ще горіло світло.', modelId: 'v' }),
  sinks: new Proxy({} as any, {
    get: (_t, prop) => {
      if (prop === 'createManuscriptBook') {
        if (state.sink === 'none') return undefined;
        if (state.sink === 'throws') return async () => { throw new Error('збій запису книги'); };
        return sinks.createBookFromManuscript;
      }
      return (realSinks as any)[prop];
    },
  }),
  schedule: (task) => { tasks.push(task); },
});
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function call(method: string, p: string, opts: { session?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.session) headers['x-test-session'] = opts.session;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + p, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, data: (res.headers.get('content-type') || '').includes('json') ? ((await res.json()) as any) : null };
}
const PD = '/api/external/v1/photo-drafts';
const code = await call('POST', '/api/external-tokens/pairing-code', { session: 'u-a', body: { scope: 'photo-drafts' } });
const tok: string = (await call('POST', '/api/external/v1/pair', { body: { code: code.data.code } })).data.token;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const image = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
let seq = 0;
async function makeManuscript(body: Record<string, unknown>, pages = 2) {
  const created = await call('POST', PD, { token: tok, body: { kind: 'manuscript', ...body } });
  const id: string = created.data.draft.draftId;
  for (let i = 0; i < pages; i++) await call('POST', `${PD}/${id}/photos`, { token: tok, body: { clientId: `mb-${++seq}`, image } });
  await flush();
  return id;
}

{
  const id = await makeManuscript({ title: 'Розділ 1. Млин', newBookTitle: 'Долина тиші' });
  const sub = await call('POST', `${PD}/${id}/submit`, { token: tok });
  t('submit — 201, ціль `book`, відповідь за схемою', sub.status === 201 && sub.data.target.kind === 'book' && conforms('SubmitResponse', sub.data) === '', JSON.stringify(sub.data.target) + ' ' + conforms('SubmitResponse', sub.data));
  const bookId: string = sub.data.target.id;
  t('studioUrl веде на дашборд', sub.data.target.studioUrl === '/');
  const stored = await bookStore.getBook(bookId);
  t('книга є на сервері й належить автору', !!stored && stored.ownerId === 'u-a' && stored.title === 'Долина тиші');
  const listed = await bookStore.listBooks('u-a');
  t('книга є в переліку книг автора (дашборд)', listed.some((b: any) => b.id === bookId));
  const chapter = (stored?.book as any)?.chapters?.[0];
  t('у книзі одна глава з назвою чернетки', (stored?.book as any)?.chapters?.length === 1 && chapter?.title === 'Розділ 1. Млин');
  const text = String(chapter?.sections?.[0]?.content ?? '');
  t('текст обох сторінок у главі (редагується в «Книга & Текст»)', /Вітер ліг на ніч/.test(text) && /У млині ще горіло світло/.test(text), text.slice(0, 120));
  const assets = await media.listAssets('u-a', { bookId });
  t('фото сторінок у медіатеці цієї книги', assets.length === 2, String(assets.length));
  const inbox = await call('GET', '/api/scans/inbox', { session: 'u-a' });
  t('«Вхідні» не пропонують вставити те саме вдруге', !inbox.data?.scans || inbox.data.scans.every((s: any) => s.batchId !== id));
  const history = (await xstore.listScans('u-a', { statuses: ['inserted'], bookId })) as any[];
  t('записи пакета лишились історією зі станом inserted', history.filter((s) => s.batchId === id).length === 2 && history.every((s) => s.chapterId === chapter.id));
  const d = (await call('GET', `${PD}/${id}`, { token: tok })).data.draft;
  t('чернетка відправлена, submitted.kind = book', d.status === 'submitted' && d.submitted.kind === 'book' && d.submitted.id === bookId);
}
{
  state.sink = 'throws';
  const origErr = console.error;
  console.error = () => undefined;
  const id = await makeManuscript({ title: 'Глава', newBookTitle: 'Збій запису' });
  const sub = await call('POST', `${PD}/${id}/submit`, { token: tok });
  console.error = origErr;
  t('збій створення книги — пакет іде у «Вхідні» (як до 1.5.0)', sub.status === 201 && sub.data.target.kind === 'inbox' && sub.data.target.studioUrl === '/media?tab=inbox' && conforms('SubmitResponse', sub.data) === '');
  const inbox = await call('GET', '/api/scans/inbox', { session: 'u-a' });
  t('і пакет справді у «Вхідних»', inbox.data.scans.filter((s: any) => s.batchId === id).length === 2);
  state.sink = 'real';
}
{
  state.sink = 'none';
  const id = await makeManuscript({ title: 'Глава', newBookTitle: 'Без синка' });
  const sub = await call('POST', `${PD}/${id}/submit`, { token: tok });
  t('без синка створення — «Вхідні»', sub.status === 201 && sub.data.target.kind === 'inbox');
  state.sink = 'real';
}
{
  // існуюча книга: нічого не створюємо, пакет у «Вхідні»
  await bookStore.saveBook({ book: { id: 'BK-EXIST', title: 'Моя книга', chapters: [], characters: [] } as any, ownerId: 'u-a' });
  const id = await makeManuscript({ title: 'Глава 2', bookId: 'BK-EXIST' });
  const before = (await bookStore.listBooks('u-a')).length;
  const sub = await call('POST', `${PD}/${id}/submit`, { token: tok });
  t('наявна книга: ціль inbox із bookId, нової книги не створено', sub.status === 201 && sub.data.target.kind === 'inbox' && /bookId=BK-EXIST/.test(sub.data.target.studioUrl) && (await bookStore.listBooks('u-a')).length === before);
}
t('вид `book` є в контракті 1.5.0', (contract.SUBMIT_TARGET_KINDS as readonly string[]).includes('book') && contract.PHOTO_DRAFT_CONTRACT_VERSION === '1.5.0');

(server as any).closeAllConnections?.();
await new Promise((r) => server.close(r));
db.closeDb();
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exitCode = fail ? 1 : 0;
