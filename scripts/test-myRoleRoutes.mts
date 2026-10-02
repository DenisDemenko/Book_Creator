/**
 * «Моя роль у проєкті» — API (Т6.4 В1, `PLAN_ROLE_STUDIO.md`; ТЗ Role
 * Onboarding §23; критерії №20, 23, 24). Сховище ядра в пам'яті, express на
 * випадковому порту. Запуск: npm run test:my-role-routes
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { makeEffectiveResolver, grantAccess } from '../server/core/collaboration/access.ts';
import { assignRole, ensureOwnerParticipant, rolesOf } from '../server/core/collaboration/participants.ts';
import { resetActiveRegistry, bootstrapOntology } from '../server/core/ontology/lifecycle.ts';
import { registerOnboardingRoutes } from '../server/core/collaboration/onboardingRoutes.ts';
import type { RealtimeAccessDeps } from '../server/realtimeAuth.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const P = 'BK-MYROLE';
const repo = new MemoryCoreRepository();
resetActiveRegistry();
await bootstrapOntology(repo);
await repo.upsertProject({ id: P, ownerId: 'u-owner', title: 'Маяк' });
await ensureOwnerParticipant(repo, P, 'u-owner');
const granter = { userId: 'u-owner', isOwner: true, isAdmin: false };
await assignRole(repo, { projectId: P, userId: 'u-ill', roleId: 'illustrator', actor: 'user:u-owner', source: 'access_request' });
await grantAccess(repo, { projectId: P, granter, userId: 'u-ill', level: 'view', scopeType: 'book' });
await assignRole(repo, { projectId: P, userId: 'u-pending', roleId: 'editor', actor: 'user:u-owner', source: 'access_request' });

const changed: string[] = [];
const access: RealtimeAccessDeps = {
  async getBookOwnerId(id) { return id === P ? 'u-owner' : null; },
  async getCollabOwnerId() { return undefined; },
  async listAcceptedInvites() { return []; },
  effectiveAccess: makeEffectiveResolver(() => repo, () => 'ready'),
};
const ROLES: Record<string, string> = { 'u-admin': 'admin' };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers['x-who'] || '');
  (req as any).principal = id ? { id, role: ROLES[id] ?? 'writer', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
const requireAuth = (req: any, res: any, next: any) => (req.principal?.isGuest ? res.status(401).json({ error: 'auth' }) : next());
registerOnboardingRoutes(app, {
  repo: () => repo,
  access,
  requireAuth,
  onboarding: { async ownerOf(id) { return id === P ? 'u-owner' : null; }, async acceptedInvite() { return null; } },
  enabled: () => true,
  bookOutline: async () => ({ chapters: [{ id: 'ch-1', title: 'Глава', sections: [{ id: 'sec-1', title: 'Сцена 1' }] }] }),
  describeUser: async (uid) => ({ name: `Ім'я ${uid}` }),
  onAccessChanged: (projectId, userId) => changed.push(`${projectId}:${userId}`),
});
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', 'x-who': who }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const R = `/api/core/projects/${P}/my-role`;

console.log('\nПерегляд і охорона (№20):');
t('гість — 401', (await call('GET', R, '')).status === 401);
t('без доступу до книги — 403 (роль без доступу теж)', (await call('GET', R, 'u-stranger')).status === 403 && (await call('GET', R, 'u-pending')).status === 403);
let me = await call('GET', R, 'u-ill');
t('ілюстратор: ролі, простір, нерозглянутих немає', me.status === 200 && me.body.roles[0].roleId === 'illustrator' && me.body.activeWorkspace === 'illustrator' && me.body.pending.role === null && me.body.selfAssign === false);
t('неправильний id проєкту — 422', (await call('GET', '/api/core/projects/..%2F/my-role', 'u-ill')).status >= 400);

console.log('\nДодати роль — запит (№23, №24):');
const add = await call('POST', `${R}/roles`, 'u-ill', { roleId: 'designer', message: 'Зроблю й обкладинку' });
t('202 — запит ролі', add.status === 202 && add.body.kind === 'requested' && add.body.request.kind === 'role');
t('роль поки не з\'явилась', (await rolesOf(repo, P, 'u-ill')).join() === 'illustrator');
t('повторний — 409', (await call('POST', `${R}/roles`, 'u-ill', { roleId: 'translator' })).status === 409);
const list = await call('GET', `/api/core/projects/${P}/access-requests?status=pending`, 'u-owner');
t('власник бачить запит ролі в «Запитах»', list.status === 200 && list.body.requests.some((r: any) => r.id === add.body.request.id && r.kind === 'role' && r.roles[0].roleId === 'designer'));
t('ілюстратор не розглядає запити — 403', (await call('POST', `/api/core/projects/${P}/access-requests/${add.body.request.id}/decide`, 'u-ill', { action: 'approve' })).status === 403);
const dec = await call('POST', `/api/core/projects/${P}/access-requests/${add.body.request.id}/decide`, 'u-owner', { action: 'modify', roles: ['designer'], noAccess: true });
t('власник: «змінити» без доступу — роль додано', dec.status === 200 && dec.body.request.status === 'modified' && (await rolesOf(repo, P, 'u-ill')).includes('designer'));
t('кімнату перепідключено після рішення', changed.includes(`${P}:u-ill`));

console.log('\nВласник і адмін — одразу:');
const oa = await call('POST', `${R}/roles`, 'u-owner', { roleId: 'book_manager' });
t('власник — 201, роль одразу', oa.status === 201 && oa.body.kind === 'assigned' && oa.body.view.roles.some((r: any) => r.roleId === 'book_manager'));
t('недозволена роль — 422', (await call('POST', `${R}/roles`, 'u-owner', { roleId: 'astronaut' })).status === 422);

console.log('\nВідмова, простір, вихід:');
me = await call('GET', R, 'u-ill');
const des = me.body.roles.find((r: any) => r.roleId === 'designer');
const ws = await call('PUT', `${R}/workspace`, 'u-ill', { workspace: 'designer' });
t('простір дизайнера обрано', ws.status === 200 && ws.body.activeWorkspace === 'designer');
t('простір не своєї ролі — 422', (await call('PUT', `${R}/workspace`, 'u-ill', { workspace: 'manager' })).status === 422);
const rm = await call('DELETE', `${R}/roles/${des.assignmentId}`, 'u-ill');
t('відмова від ролі — 200, простір повернувся до ілюстратора', rm.status === 200 && rm.body.roles.length === 1 && rm.body.activeWorkspace === 'illustrator');
t('остання роль — 409', (await call('DELETE', `${R}/roles/${rm.body.roles[0].assignmentId}`, 'u-ill')).status === 409);
t('чужа роль — 404', (await call('DELETE', `${R}/roles/${oa.body.view.roles[0].assignmentId}`, 'u-ill')).status === 404);
t('спеціалізація ролі без спеціалізацій — 422', (await call('PUT', `${R}/roles/${rm.body.roles[0].assignmentId}/specialization`, 'u-ill', { specialization: 'designer' })).status === 422);
changed.length = 0;
const lv = await call('POST', `${R}/leave`, 'u-ill');
t('вихід — ролі й доступ відкликано, кімнату перепідключено', lv.status === 200 && lv.body.revokedGrants === 1 && changed.includes(`${P}:u-ill`));
t('після виходу — 403', (await call('GET', R, 'u-ill')).status === 403);
t('власник не виходить — 409', (await call('POST', `${R}/leave`, 'u-owner')).status === 409);

server.close();
resetActiveRegistry();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
