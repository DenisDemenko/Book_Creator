/**
 * Т6.2 В2 (`PLAN_ACCESS.md`): наданий доступ діє в каналах — кімната
 * спільного редагування (квиток, видача подій) і API ядра (`/api/projects/:id/*`,
 * білий список для обмеженого доступу, медіатека книги).
 *
 * Без мережі й бази: сховище в пам'яті, express на випадковому порту.
 * Запуск: npm run test:access-enforcement
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import type { CoreRepository } from '../server/core/types.ts';
import { resolveRealtimeAccess, type RealtimeAccessDeps } from '../server/realtimeAuth.ts';
import { makeEffectiveResolver, grantAccess, revokeAccess, resolveEffectiveAccess, visibleCharacterRefs } from '../server/core/collaboration/access.ts';
import { shapeRoomEvent, type RoomView } from '../server/core/collaboration/accessView.ts';
import { resetActiveRegistry, bootstrapOntology } from '../server/core/ontology/lifecycle.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const P = 'BK-ACC';
const OWNER = { userId: 'u-owner', isOwner: true, isAdmin: false };
const repo = new MemoryCoreRepository();
resetActiveRegistry();
await bootstrapOntology(repo);
await repo.upsertProject({ id: P, ownerId: 'u-owner', title: 'Маяк' });
await repo.upsertProject({ id: 'BK-OTHER', ownerId: 'u-other', title: 'Чужа' });
const sofia = await repo.createEntity({ projectId: P, type: 'character', name: 'Софія', externalRef: 'studio:character:char-4', createdBy: 'system:core_sync' });
const taras = await repo.createEntity({ projectId: P, type: 'character', name: 'Тарас', externalRef: 'studio:character:char-2', createdBy: 'system:core_sync' });
const cafe = await repo.createEntity({ projectId: P, type: 'location', name: 'Кав\'ярня', createdBy: 'system:core_sync' });
const fear = await repo.createEntity({ projectId: P, type: 'emotion', name: 'страх', createdBy: 'system:core_sync' });
await repo.upsertDocument({ projectId: P, id: 'sec-2-1', kind: 'section', order: 0 });
await repo.upsertParagraph({ projectId: P, id: 'p1', documentId: 'sec-2-1', order: 0, kind: 'paragraph', text: '[/character:Софія] дивилась на маяк.' }, 'system:core_sync');
await repo.replaceParagraphMentions(P, 'p1', [{ entityId: sofia.id, spanStart: 0, spanEnd: 20, source: 'tag' }]);
await repo.addAlias(P, sofia.id, 'Соня', 'alias');

const BOOK_INDEX = new Map([['chap-1', ['sec-1-1', 'sec-1-2']], ['chap-2', ['sec-2-1']]]);
const member = async (userId: string) => (await repo.upsertParticipant({ projectId: P, userId, source: 'manual', createdBy: 'user:u-owner' })).participant;
await member('u-maria');
await member('u-taras');
await member('u-mgr');
// Марія — ілюстраторка: сцена 2.1 (перегляд), Софія, кав'ярня, медіатека (робочий доступ).
await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'view', scopeType: 'scene', scopeRef: 'sec-2-1', bookIndex: BOOK_INDEX });
await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'view', scopeType: 'character', scopeRef: sofia.id });
await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'view', scopeType: 'location', scopeRef: cafe.id });
await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'work', scopeType: 'media_library' });
// Тарас — перекладач розділу 1 (редагування).
await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-taras', level: 'edit', scopeType: 'chapter', scopeRef: 'chap-1', bookIndex: BOOK_INDEX });
// Менеджер — перегляд книги й медіатека, без права писати.
await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-mgr', level: 'view', scopeType: 'book' });

let coreRepo: CoreRepository | null = repo;
let coreState = 'ready';
const access: RealtimeAccessDeps = {
  async getBookOwnerId(id) { return ({ [P]: 'u-owner', 'BK-OTHER': 'u-other' } as Record<string, string>)[id] ?? null; },
  async getCollabOwnerId() { return undefined; },
  async listAcceptedInvites(id) {
    return id === P ? [{ id: 'inv-des', acceptedUserId: 'u-des', role: 'designer' }, { id: 'inv-rd', acceptedUserId: 'u-rd', role: 'reader' }] : [];
  },
  effectiveAccess: makeEffectiveResolver(() => coreRepo, () => coreState),
};
const who = (id: string, role = 'writer') => ({ id, role, isGuest: false });

console.log('\nКвиток кімнати (Т0.1 + наданий доступ):');
{
  const o = await resolveRealtimeAccess(who('u-owner'), P, access);
  t('власник — спільна кімната, пише, без фільтра', o?.shared === true && o.canWrite && !o.scoped);
  const m = await resolveRealtimeAccess(who('u-maria'), P, access);
  t('ілюстраторка (без запрошення, з наданим доступом) — спільна кімната, обмежено, не пише', m?.roomKey === `book:${P}` && m.scoped === true && m.restricted === true && m.canWrite === false, JSON.stringify(m));
  const tr = await resolveRealtimeAccess(who('u-taras'), P, access);
  t('перекладач розділу — обмежено, але пише (у своєму розділі)', tr?.shared === true && tr.scoped === true && tr.restricted === true && tr.canWrite === true);
  const mg = await resolveRealtimeAccess(who('u-mgr'), P, access);
  t('перегляд книги — бачить усе, не пише, фільтр правок', mg?.shared === true && mg.restricted === false && mg.scoped === true && mg.canWrite === false);
  const d = await resolveRealtimeAccess(who('u-des'), P, access);
  t('старе запрошення дизайнера — як було: уся книга, пише (доступ перенесено)', d?.shared === true && d.canWrite === true && !d.scoped && !d.restricted);
  const migrated = await repo.listAccessGrants({ projectId: P });
  t('…і в ядрі з\'явився доступ на книгу з запрошення', migrated.some((g) => g.source === 'legacy_invite' && g.sourceRef === 'inv-des' && g.level === 'edit' && g.scopeType === 'book'));
  const r = await resolveRealtimeAccess(who('u-rd'), P, access);
  t('старе запрошення читача — читає всю книгу, не пише', r?.shared === true && r.canWrite === false && r.restricted === false);
  const s = await resolveRealtimeAccess(who('u-stranger'), P, access);
  t('чужий — лише приватна кімната', s?.shared === false && s.roomKey.startsWith('private:'));

  coreState = 'failed';
  coreRepo = null;
  t('ядро недоступне: учасниці з наданим доступом — лише приватна кімната (не книга)', (await resolveRealtimeAccess(who('u-maria'), P, access))?.shared === false);
  t('ядро недоступне: старе запрошення — теж закрито', (await resolveRealtimeAccess(who('u-des'), P, access)) === null);
  t('ядро недоступне: власник — як завжди', (await resolveRealtimeAccess(who('u-owner'), P, access))?.canWrite === true);
  coreState = 'disabled';
  t('ядра немає зовсім: старе запрошення — уся книга, як до Т6.2', (await resolveRealtimeAccess(who('u-des'), P, access))?.canWrite === true);
  t('ядра немає зовсім: наданого доступу не існує — приватна кімната', (await resolveRealtimeAccess(who('u-maria'), P, access))?.shared === false);
  coreState = 'ready';
  coreRepo = repo;
}

console.log('\nПодії кімнати очима обмеженого учасника:');
{
  const BOOK = {
    id: P, title: 'Маяк', updatedAt: '2026-10-01T10:00:00.000Z', synopsis: 'ТАЄМНИЙ СИНОПСИС',
    chapters: [
      { id: 'chap-1', title: 'Розділ 1', sections: [{ id: 'sec-1-1', content: 'ТЕКСТ 1' }, { id: 'sec-1-2', content: 'ТЕКСТ 2' }] },
      { id: 'chap-2', title: 'Розділ 2', sections: [{ id: 'sec-2-1', content: 'СЦЕНА МАРІЇ' }] },
    ],
    characters: [{ id: 'char-4', name: 'Софія' }, { id: 'char-2', name: 'Тарас' }],
  };
  const maria = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-maria', isOwner: false, isAdmin: false });
  const view: RoomView = { eff: maria, characterRefs: await visibleCharacterRefs(repo, maria) };
  t('картки героїв ілюстраторки — за externalRef сутностей (лише Софія)', [...view.characterRefs].join() === 'char-4');
  const upd = shapeRoomEvent({ type: 'book:remote_update', payload: { book: BOOK, logEntry: { text: 'ТЕКСТ 1 змінено' } } }, view)!;
  const txt = JSON.stringify(upd);
  t('оновлення книги — обрізане: лише сцена 2.1 і Софія, без журналу правок',
    upd.payload.book.chapters.length === 1 && upd.payload.book.chapters[0].sections[0].content === 'СЦЕНА МАРІЇ' && upd.payload.book.characters.map((c: any) => c.id).join() === 'char-4' && !/ТЕКСТ 1|СИНОПСИС/.test(txt), txt.slice(0, 160));
  t('чужа точкова правка недозволеної сцени — не надходить', shapeRoomEvent({ type: 'section:remote_patch', payload: { patch: { chapterId: 'chap-1', sectionId: 'sec-1-1', content: 'x' } } }, view) === null);
  t('точкова правка своєї сцени — надходить', !!shapeRoomEvent({ type: 'section:remote_patch', payload: { patch: { chapterId: 'chap-2', sectionId: 'sec-2-1', content: 'x' } } }, view));
  const snap = shapeRoomEvent({ type: 'version:snapshot_created', payload: { snapshot: { book: BOOK }, book: BOOK } }, view)!;
  t('знімок версії — без самого знімка, книга обрізана', snap.payload.snapshot === undefined && snap.payload.book.chapters.length === 1);
  t('чат і присутність — без змін', shapeRoomEvent({ type: 'chat:message', payload: { message: { text: 'привіт' } } }, view)?.payload.message.text === 'привіт');
  t('повний доступ — подія без змін', shapeRoomEvent({ type: 'book:remote_update', payload: { book: BOOK } }, null)?.payload.book === BOOK);
}

console.log('\nAPI ядра (/api/projects/:id/*):');
const files = [
  { id: 'a-own', ownerId: 'u-owner', bookId: P, mimeType: 'image/png', name: 'обкладинка' },
  { id: 'a-maria', ownerId: 'u-maria', bookId: P, mimeType: 'image/png', name: 'ескіз Марії' },
  { id: 'a-other-book', ownerId: 'u-owner', bookId: 'BK-OTHER', mimeType: 'image/png', name: 'інша книга' },
  { id: 'a-taras', ownerId: 'u-taras', bookId: P, mimeType: 'image/png', name: 'файл перекладача' },
];
const app = express();
app.use((req, _res, next) => {
  const id = String(req.headers['x-test-user'] || '');
  (req as any).principal = id ? { id, role: id === 'u-admin' ? 'admin' : 'writer', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
registerProjectRoutes(app, {
  access,
  repo: () => coreRepo,
  coreState: () => coreState,
  media: {
    async listAssets(ownerId, { bookId }) { return files.filter((f) => f.ownerId === ownerId && f.bookId === bookId); },
    async readAsset(id) { const f = files.find((x) => x.id === id); return f ? { record: f, bytes: new TextEncoder().encode(`bytes:${id}`) } : null; },
  },
});
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, path: string, user: string, body?: unknown) => {
  const res = await fetch(`${base}/api/projects/${P}${path}`, { method, headers: { 'x-test-user': user, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return {}; } })() as any };
};

{
  const acc = await call('GET', '/access', 'u-maria');
  t('ілюстраторка: «хто я» — обмежений доступ, сцена, Софія, медіатека', acc.status === 200 && acc.body.access.effective.restricted === true && acc.body.access.effective.scenes['sec-2-1'] === 'view' && acc.body.access.effective.media === 'work' && acc.body.access.canWrite === false, JSON.stringify(acc.body.access?.effective));
  t('…записів доступу (хто надав) клієнт не отримує', !('grants' in acc.body.access.effective));
  const ents = await call('GET', '/entities', 'u-maria');
  t('сутності — лише Софія й кав\'ярня (не Тарас, не емоції)', ents.status === 200 && ents.body.entities.map((e: any) => e.name).sort().join() === 'Кав\'ярня,Софія', JSON.stringify(ents.body.entities?.map((e: any) => e.name)));
  const one = await call('GET', `/entities/${sofia.id}?excerpts=1`, 'u-maria');
  t('картка Софії — псевдоніми є, згадок, зв\'язків, висновків і цитат немає', one.status === 200 && one.body.aliases.some((a: any) => a.alias === 'Соня') && one.body.mentions.length === 0 && !one.body.mentionParagraphs && !/маяк/.test(one.text));
  for (const [path, label] of [[`/entities/${taras.id}`, 'чужий герой'], [`/entities/${fear.id}`, 'емоція'], [`/visual/portrait/${taras.id}`, 'портрет чужого героя'], ['/search?q=маяк', 'пошук'], ['/story-graph', 'граф'], ['/timeline', 'хронологія'], ['/summary', 'підсумок'], [`/characters/${sofia.id}/profile`, 'профіль із цитатами'], ['/continuity/issues', 'безперервність'], ['/visual/scene?sectionId=sec-2-1', 'хто в сцені']] as const) {
    const r = await call('GET', path, 'u-maria');
    t(`обмежено: ${label} — 403 scope_restricted`, r.status === 403 && r.body.kind === 'scope_restricted', `${r.status}`);
  }
  const post = await call('POST', '/relations', 'u-maria', { type: 'knows', fromId: sofia.id, toId: taras.id });
  t('обмежено: будь-яка зміна — 403', post.status === 403 && post.body.kind === 'scope_restricted');
  t('портрет Софії — дозволено', (await call('GET', `/visual/portrait/${sofia.id}`, 'u-maria')).status === 200);
  const app2 = await call('GET', `/visual/appearance/${sofia.id}`, 'u-maria');
  t('зовнішність Софії — дозволено, без переліку розділів і без права правити', app2.status === 200 && app2.body.chapters.length === 0 && app2.body.canEdit === false, `${app2.status}`);

  const media = await call('GET', '/media', 'u-maria');
  t('медіатека книги: файли власника й самої ілюстраторки, не з іншої книги', media.status === 200 && media.body.assets.map((a: any) => a.id).sort().join() === 'a-maria,a-own', JSON.stringify(media.body.assets?.map((a: any) => a.id)));
  t('файл медіатеки книги — віддається', (await call('GET', '/media/file/a-own', 'u-maria')).text === 'bytes:a-own');
  t('файл іншої книги через цю — 404', (await call('GET', '/media/file/a-other-book', 'u-maria')).status === 404);
  t('файл учасника без робочого доступу — 404', (await call('GET', '/media/file/a-taras', 'u-maria')).status === 404);
  const trMedia = await call('GET', '/media', 'u-taras');
  t('перекладачеві медіатеку не надано — 403', trMedia.status === 403 && trMedia.body.kind === 'scope_restricted');
  const ownMedia = await call('GET', '/media', 'u-owner');
  t('власник бачить і файли ілюстраторки (робочий доступ)', ownMedia.body.assets.map((a: any) => a.id).sort().join() === 'a-maria,a-own');

  t('перегляд книги (менеджер): пошук і граф — можна', (await call('GET', '/search?q=маяк', 'u-mgr')).status === 200 && (await call('GET', '/story-graph', 'u-mgr')).status === 200);
  t('перегляд книги: змін — ні (403 forbidden)', (await call('POST', '/relations', 'u-mgr', { type: 'knows', fromId: sofia.id, toId: taras.id })).status === 403);
  t('старий дизайнер — як до Т6.2: усе читає, пише', (await call('GET', '/search?q=маяк', 'u-des')).status === 200 && (await call('GET', '/access', 'u-des')).body.access.canWrite === true);
  t('старий читач — читає, не пише', (await call('GET', '/story-graph', 'u-rd')).status === 200 && (await call('GET', '/access', 'u-rd')).body.access.canWrite === false);
  t('власник — без змін', (await call('GET', '/search?q=маяк', 'u-owner')).status === 200 && (await call('GET', '/access', 'u-owner')).body.access.effective.full === true);
  t('чужий — 403 forbidden', (await call('GET', '/access', 'u-stranger')).body.kind === 'forbidden');

  // Відкликання діє одразу.
  const sceneGrant = (await repo.listAccessGrants({ projectId: P, status: 'active' })).find((g) => g.scopeRef === sofia.id)!;
  await revokeAccess(repo, { projectId: P, grantId: sceneGrant.id, granter: OWNER });
  t('відкликано Софію — її картка вже 403, у переліку немає', (await call('GET', `/entities/${sofia.id}`, 'u-maria')).status === 403 && !(await call('GET', '/entities', 'u-maria')).body.entities.some((e: any) => e.name === 'Софія'));

  coreState = 'failed';
  coreRepo = null;
  t('ядро недоступне: учасник — 403 (закрито), власник — «хто я» працює', (await call('GET', '/access', 'u-maria')).status === 403 && (await call('GET', '/access', 'u-owner')).status === 200);
  coreState = 'ready';
  coreRepo = repo;
}

server.close();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
