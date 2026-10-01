/**
 * Т6.2 В3 (`PLAN_ACCESS.md`): API наданого доступу —
 * `/api/core/projects/:projectId/access` (мій доступ, учасники з доступами,
 * цілі), надання, відкликання, журнал. Керує власник, адмін або учасник із
 * правом керування; зміна доступу перепідключає людину в кімнаті.
 *
 * Сховище в пам'яті, express на випадковому порту. Запуск: npm run test:access-routes
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { registerParticipantRoutes } from '../server/core/collaboration/routes.ts';
import { makeEffectiveResolver } from '../server/core/collaboration/access.ts';
import { assignRole } from '../server/core/collaboration/participants.ts';
import { resetActiveRegistry, bootstrapOntology } from '../server/core/ontology/lifecycle.ts';
import type { RealtimeAccessDeps } from '../server/realtimeAuth.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const P = 'BK-ACC-API';
const repo = new MemoryCoreRepository();
resetActiveRegistry();
await bootstrapOntology(repo);
await repo.upsertProject({ id: P, ownerId: 'u-owner', title: 'Маяк' });
const olena = await repo.createEntity({ projectId: P, type: 'character', name: 'Олена', externalRef: 'studio:character:char-1', createdBy: 'system:core_sync' });
const port = await repo.createEntity({ projectId: P, type: 'location', name: 'Порт', createdBy: 'system:core_sync' });
for (const [uid, role] of [['u-owner', 'project_owner'], ['u-iryna', 'illustrator'], ['u-taras', 'translator'], ['u-mgr', 'translator'], ['u-new', 'beta_reader']] as const) {
  await assignRole(repo, { projectId: P, userId: uid, roleId: role, actor: 'user:u-owner', source: uid === 'u-owner' ? 'owner' : 'manual' });
}

const access: RealtimeAccessDeps = {
  async getBookOwnerId(id) { return id === P ? 'u-owner' : null; },
  async getCollabOwnerId() { return undefined; },
  async listAcceptedInvites(id) { return id === P ? [{ id: 'inv-des', acceptedUserId: 'u-des', role: 'designer' }] : []; },
  effectiveAccess: makeEffectiveResolver(() => repo, () => 'ready'),
};
const OUTLINE = {
  chapters: [
    { id: 'chap-1', title: 'Скляний світанок', sections: [{ id: 'sec-1-1', title: 'Пробудження' }, { id: 'sec-1-2', title: 'Дніпро' }] },
    { id: 'chap-2', title: 'Гідропарк', sections: [{ id: 'sec-2-1', title: 'Лабіринт' }] },
  ],
};
const changed: string[] = [];
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers['x-who'] || '');
  (req as any).principal = id ? { id, role: id === 'u-admin' ? 'admin' : 'writer', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
registerParticipantRoutes(app, {
  repo: () => repo,
  access,
  bookOutline: async (id) => (id === P ? OUTLINE : null),
  describeUser: async (uid) => ({ 'u-iryna': { name: 'Ірина', email: 'iryna@test.ua' }, 'u-taras': { name: 'Тарас', email: 'taras@test.ua' } } as Record<string, any>)[uid] ?? null,
  onAccessChanged: (projectId, userId) => changed.push(`${projectId}:${userId}`),
});
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/core/projects/${P}/access`;
const call = async (method: string, path: string, who: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-who': who }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

console.log('\nМій доступ і панель керівника:');
{
  const o = await call('GET', '', 'u-owner');
  t('власник: керує, повний доступ', o.status === 200 && o.body.canManage === true && o.body.me.effective.full === true);
  t('учасники з ролями, іменами й (поки порожніми) доступами', o.body.participants.length === 5 && o.body.participants.find((p: any) => p.participant.userId === 'u-iryna')?.user?.name === 'Ірина' && o.body.participants.every((p: any) => Array.isArray(p.grants)));
  t('цілі: розділи зі сценами (серверна копія), герої й локації ядра', o.body.targets.chapters.length === 2 && o.body.targets.chapters[0].sections.length === 2 && o.body.targets.characters[0]?.name === 'Олена' && o.body.targets.locations[0]?.name === 'Порт');
  t('області — шість чинних, у моделі — ще стиль-біблія, завдання, результати', o.body.scopes.length === 6 && o.body.modelScopes.includes('style_bible'));
  t('учасниця з роллю, але без наданого доступу — до книги не допущена (403: роль не дає прав)', (await call('GET', '', 'u-iryna')).status === 403);
  t('чужий — 403', (await call('GET', '', 'u-stranger')).status === 403);
  t('гість — 401', (await call('GET', '', '')).status === 401);
}

console.log('\nНадання:');
{
  const g1 = await call('POST', '', 'u-owner', { userId: 'u-iryna', level: 'view', scopeType: 'scene', scopeRef: 'sec-2-1' });
  t('власник надав ілюстраторці сцену «Лабіринт» — 201', g1.status === 201 && g1.body.grant.scopeRef === 'sec-2-1' && g1.body.grant.source === 'manual' && g1.body.grant.grantedBy === 'user:u-owner');
  t('…і її з\'єднання з кімнатою перепідключається', changed.includes(`${P}:u-iryna`));
  t('героїню Олену — 201', (await call('POST', '', 'u-owner', { userId: 'u-iryna', level: 'view', scopeType: 'character', scopeRef: olena.id })).status === 201);
  t('робочий доступ до медіатеки — 201', (await call('POST', '', 'u-owner', { userId: 'u-iryna', level: 'work', scopeType: 'media_library' })).status === 201);
  const until = new Date(Date.now() + 7 * 864e5).toISOString();
  const tr = await call('POST', '', 'u-owner', { userId: 'u-taras', level: 'edit', scopeType: 'chapter', scopeRef: 'chap-1', validUntil: until });
  t('перекладачеві — розділ 1 до дати', tr.status === 201 && tr.body.grant.validUntil === until);
  const noScene = await call('POST', '', 'u-owner', { userId: 'u-iryna', level: 'view', scopeType: 'scene', scopeRef: 'sec-9-9' });
  t('сцени, якої немає в книзі, — 404', noScene.status === 404 && noScene.body.kind === 'not_found');
  t('персонаж за id локації — 404', (await call('POST', '', 'u-owner', { userId: 'u-iryna', level: 'view', scopeType: 'character', scopeRef: port.id })).status === 404);
  const style = await call('POST', '', 'u-owner', { userId: 'u-iryna', level: 'view', scopeType: 'style_bible', scopeRef: 'sb' });
  t('стиль-біблія поки не застосовується — 422', style.status === 422 && /Т7/.test(style.body.error));
  t('робочий доступ до сцени — 422', (await call('POST', '', 'u-owner', { userId: 'u-iryna', level: 'work', scopeType: 'scene', scopeRef: 'sec-2-1' })).status === 422);
  t('не учаснику — 404', (await call('POST', '', 'u-owner', { userId: 'u-nobody', level: 'view', scopeType: 'book' })).status === 404);
  t('ілюстраторка сама доступу не надає — 403', (await call('POST', '', 'u-iryna', { userId: 'u-taras', level: 'view', scopeType: 'book' })).status === 403);

  t('власник дає менеджерові право керування книгою', (await call('POST', '', 'u-owner', { userId: 'u-mgr', level: 'manage', scopeType: 'book' })).status === 201);
  const mg = await call('GET', '', 'u-mgr');
  t('менеджер тепер керує (бачить учасників і цілі)', mg.body.canManage === true && mg.body.participants.length === 5);
  t('менеджер надає новачкові перегляд книги', (await call('POST', '', 'u-mgr', { userId: 'u-new', level: 'view', scopeType: 'book' })).status === 201);
  t('…але не право керування — 403', (await call('POST', '', 'u-mgr', { userId: 'u-new', level: 'manage', scopeType: 'book' })).status === 403);
  t('адміністратор теж надає (джерело — адмін)', (await call('POST', '', 'u-admin', { userId: 'u-new', level: 'comment', scopeType: 'chapter', scopeRef: 'chap-2' })).body.grant?.source === 'admin');

  const iAfter = await call('GET', '', 'u-iryna');
  t('ілюстраторка з доступом бачить лише себе, не керує', iAfter.status === 200 && iAfter.body.canManage === false && iAfter.body.participants.length === 0 && iAfter.body.targets === null && iAfter.body.me.effective.restricted === true);
  t('ілюстраторка бачить свій доступ: сцена, героїня, медіатека', iAfter.body.me.effective.scenes['sec-2-1'] === 'view' && iAfter.body.me.effective.characters[olena.id] === 'view' && iAfter.body.me.effective.media === 'work');
}

console.log('\nВідкликання й журнал:');
{
  const o = await call('GET', '', 'u-owner');
  const iryna = o.body.participants.find((p: any) => p.participant.userId === 'u-iryna');
  const scene = iryna.grants.find((g: any) => g.scopeType === 'scene');
  const mgrGrant = o.body.participants.find((p: any) => p.participant.userId === 'u-mgr').grants[0];
  changed.length = 0;
  t('менеджер не відкликає право керування — 403', (await call('DELETE', `/${mgrGrant.id}`, 'u-mgr')).status === 403);
  const r = await call('DELETE', `/${scene.id}`, 'u-mgr');
  t('менеджер відкликав сцену ілюстраторки', r.status === 200 && r.body.grant.status === 'revoked' && r.body.grant.revokedBy === 'user:u-mgr');
  t('…і її з\'єднання перепідключається', changed.includes(`${P}:u-iryna`));
  t('повторне відкликання — 409', (await call('DELETE', `/${scene.id}`, 'u-owner')).status === 409);
  t('неіснуючий — 404', (await call('DELETE', '/00000000-0000-4000-8000-000000000000', 'u-owner')).status === 404);
  const after = await call('GET', '', 'u-owner');
  const ig = after.body.participants.find((p: any) => p.participant.userId === 'u-iryna').grants;
  t('у переліку відкликаний — останнім, з позначкою', ig[ig.length - 1].id === scene.id && ig[ig.length - 1].status === 'revoked');
  const ev = await call('GET', '/events', 'u-owner');
  t('журнал: надання й відкликання з людьми й областями', ev.status === 200 && ev.body.events.some((e: any) => e.action === 'access_revoked' && e.actor === 'user:u-mgr' && e.details.userId === 'u-iryna' && e.details.scopeRef === 'sec-2-1') && ev.body.events.filter((e: any) => e.action === 'access_granted').length === 7);
  t('журнал — лише тим, хто керує (ілюстраторці 403)', (await call('GET', '/events', 'u-iryna')).status === 403);
  const legacy = await call('GET', '', 'u-des');
  t('старе запрошення дизайнера: доступ на книгу (перенесено) — редагування', legacy.status === 200 && legacy.body.me.effective.book === 'edit' && legacy.body.canManage === false);
}

server.close();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
