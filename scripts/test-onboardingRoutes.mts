/**
 * Role Onboarding — API, шлюз і спільні курси (Т6.3 В2, `PLAN_ROLE_ONBOARDING.md`;
 * ТЗ Role Onboarding §4, §14, §16, §20, §25; критерії №1, 3, 9, 10, 13, 15, 20).
 * Сховище ядра в пам'яті, курси — у тимчасовій SQLite, express на випадковому
 * порту. Запуск: npm run test:onboarding-routes
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = path.join(os.tmpdir(), 'nova-onboarding-routes');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova.db`;

const { MemoryCoreRepository } = await import('../server/core/memoryRepository.ts');
const { makeEffectiveResolver, grantAccess, levelRank } = await import('../server/core/collaboration/access.ts');
const { ensureOwnerParticipant, rolesOf } = await import('../server/core/collaboration/participants.ts');
const { resetActiveRegistry, bootstrapOntology } = await import('../server/core/ontology/lifecycle.ts');
const { registerOnboardingRoutes } = await import('../server/core/collaboration/onboardingRoutes.ts');
const { COURSE_PREFIX } = await import('../server/core/collaboration/onboarding.ts');
const { registerCourseRoutes } = await import('../server/courseRoutes.ts');
const { resolveProjectAccess } = await import('../server/core/projectRoutes.ts');
const { getCourse } = await import('../server/courseStore.ts');
const { initStore } = await import('../server/store.ts');
type RealtimeAccessDeps = import('../server/realtimeAuth.ts').RealtimeAccessDeps;

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

await initStore();
const P = 'BK-ONB';
const repo = new MemoryCoreRepository();
resetActiveRegistry();
await bootstrapOntology(repo);
await repo.upsertProject({ id: P, ownerId: 'u-owner', title: 'Маяк' });
await ensureOwnerParticipant(repo, P, 'u-owner');
let enabled = true;
const changed: string[] = [];
const access: RealtimeAccessDeps = {
  async getBookOwnerId(id) {
    if (id.startsWith(COURSE_PREFIX)) return getCourse(id.slice(COURSE_PREFIX.length))?.ownerId ?? null;
    return id === P ? 'u-owner' : null;
  },
  async getCollabOwnerId() { return undefined; },
  async listAcceptedInvites() { return []; },
  effectiveAccess: makeEffectiveResolver(() => repo, () => 'ready'),
};
const ensureCourse = async (projectId: string) => {
  if (!projectId.startsWith(COURSE_PREFIX)) return;
  const c = getCourse(projectId.slice(COURSE_PREFIX.length));
  if (!c) return;
  const had = await repo.getProject(projectId);
  await repo.upsertProject({ id: projectId, ownerId: c.ownerId, title: c.title, projectType: 'course' });
  if (!had) await ensureOwnerParticipant(repo, projectId, c.ownerId);
};
const ROLES: Record<string, string> = { 'u-admin': 'admin', 'u-teacher': 'teacher' };
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
  onboarding: {
    async ownerOf(id) { return access.getBookOwnerId(id) as Promise<string | null>; },
    async acceptedInvite() { return null; },
  },
  enabled: () => enabled,
  ensureProject: ensureCourse,
  bookOutline: async (id) => (id === P ? { chapters: [{ id: 'ch-1', title: 'Глава', sections: [{ id: 'sec-1', title: 'Сцена 1' }] }] } : null),
  describeUser: async (uid) => ({ name: `Ім'я ${uid}`, email: `${uid}@test.ua` }),
  onAccessChanged: (projectId, userId) => changed.push(`${projectId}:${userId}`),
});
registerCourseRoutes(app, {
  async courseAccess(principal, course) {
    const projectId = `${COURSE_PREFIX}${course.id}`;
    await ensureCourse(projectId);
    const a = await resolveProjectAccess(principal as any, projectId, access);
    if (!a) return 'none';
    return levelRank(a.effective.book) >= levelRank('edit') ? 'edit' : levelRank(a.effective.book) >= 1 ? 'view' : 'none';
  },
  async sharedCourseIds(userId) {
    const out: string[] = [];
    for (const p of await repo.listProjects({ participantUserId: userId })) {
      if (p.projectType !== 'course' || p.ownerId === userId) continue;
      const a = await resolveProjectAccess({ id: userId, role: 'writer', isGuest: false } as any, p.id, access).catch(() => null);
      if (a && levelRank(a.effective.book) >= 1) out.push(p.id.slice(COURSE_PREFIX.length));
    }
    return out;
  },
  onCourseChanged: (course) => void ensureCourse(`${COURSE_PREFIX}${course.id}`),
});
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', 'x-who': who }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const O = '/api/core/onboarding';

console.log('\nШлюз і перший вхід (§4, §25):');
{
  t('гість — 401', (await call('GET', `${O}/gate`, '')).status === 401);
  const g = await call('GET', `${O}/gate`, 'u-first');
  t('перший вхід — майстер потрібен', g.status === 200 && g.body.required && g.body.reason === 'first_login' && g.body.enabled);
  enabled = false;
  t('ROLE_ONBOARDING=off — не показується', (await call('GET', `${O}/gate`, 'u-first')).body.required === false);
  enabled = true;
  const s = await call('POST', `${O}/sessions`, 'u-first', { source: 'first_login' });
  t('почати — 201, чернетка', s.status === 201 && s.body.session.status === 'draft');
  t('ще раз — та сама (200, resumed)', (await call('POST', `${O}/sessions`, 'u-first', { source: 'first_login' })).body.resumed === true);
  const sid = s.body.session.id;
  t('чужу сесію не прочитати', (await call('GET', `${O}/sessions/${sid}`, 'u-other')).status === 404);
  const bad = await call('PUT', `${O}/sessions/${sid}/steps/3`, 'u-first', { answers: { projectType: 'book', entryIntent: 'create_own_project', roles: [{ roleId: 'freelancer' }] } });
  t('крок із помилкою — 200 з переліком помилок, крок не просувається', bad.status === 200 && bad.body.issues.some((i: any) => i.code === 'specialization_required') && bad.body.session.currentStep === 3);
  await call('PUT', `${O}/sessions/${sid}/steps/3`, 'u-first', { answers: { roles: [{ roleId: 'author' }] } });
  const done = await call('POST', `${O}/sessions/${sid}/complete`, 'u-first');
  t('завершено → налаштування учасника', done.status === 200 && done.body.outcome.kind === 'preferences');
  t('після — шлюз не вимагає', (await call('GET', `${O}/gate`, 'u-first')).body.required === false);
  t('аналітика з клієнта — лише studio_entered', (await call('POST', `${O}/events`, 'u-first', { event: 'access_approved' })).status === 422 && (await call('POST', `${O}/events`, 'u-first', { event: 'studio_entered', tab: 'dashboard' })).status === 201);
}

console.log('\nЧужа книга: запит → рішення в «Команді» (§20, №9, 10):');
let reqId = '';
{
  t('невідома книга для «відкрити» — 404', (await call('POST', `${O}/sessions`, 'u-ill', { source: 'open_project', projectId: 'BK-NOPE' })).status === 404);
  t('…а для «створити» — можна (книги ще немає на сервері)', (await call('POST', `${O}/sessions`, 'u-ill', { source: 'create_project', projectId: 'BK-NEW' })).status === 201);
  t('неправильний id — 422', (await call('POST', `${O}/sessions`, 'u-ill', { source: 'open_project', projectId: 'a b:c' })).status === 422);
  const g = await call('GET', `${O}/gate?projectId=${P}`, 'u-ill');
  t('у чужій книзі ролі немає — майстер', g.body.required && g.body.reason === 'no_role');
  const s = await call('POST', `${O}/sessions`, 'u-ill', { source: 'marketplace', projectId: P, orderId: 'ord-15' });
  t('з маркетплейсу з order_id — контекст замовлення (№13)', s.body.session.sourceOrderId === 'ord-15' && s.body.session.entryIntent === 'fulfill_freelance_order');
  const sid = s.body.session.id;
  await call('PUT', `${O}/sessions/${sid}/steps/6`, 'u-ill', { answers: { roles: [{ roleId: 'freelancer', specialization: 'illustrator' }], scope: 'selected_scenes', scopeRefs: ['sec-1'], capabilities: ['view', 'upload'], message: 'Ілюстрації до сцени 1' } });
  const done = await call('POST', `${O}/sessions/${sid}/complete`, 'u-ill');
  reqId = done.body.outcome?.request?.id;
  t('запит доступу створено', done.status === 200 && done.body.outcome.kind === 'access_request' && !!reqId);
  t('мої запити', (await call('GET', `${O}/requests`, 'u-ill')).body.requests.some((r: any) => r.id === reqId));
  t('запитувач не бачить чужих запитів проєкту — 403', (await call('GET', `/api/core/projects/${P}/access-requests`, 'u-ill')).status === 403);
  const list = await call('GET', `/api/core/projects/${P}/access-requests`, 'u-owner');
  t('власник бачить запит з іменем людини й структурою книги', list.status === 200 && list.body.requests[0].id === reqId && list.body.users['u-ill'].name === "Ім'я u-ill" && list.body.outline.chapters[0].sections[0].id === 'sec-1');
  t('сторонній не вирішує — 403', (await call('POST', `/api/core/projects/${P}/access-requests/${reqId}/decide`, 'u-other', { action: 'approve' })).status === 403);
  t('невідоме рішення — 422', (await call('POST', `/api/core/projects/${P}/access-requests/${reqId}/decide`, 'u-owner', { action: 'maybe' })).status === 422);
  const ap = await call('POST', `/api/core/projects/${P}/access-requests/${reqId}/decide`, 'u-owner', { action: 'modify', scopeType: 'scene', scopeRefs: ['sec-1'], level: 'comment', mediaWork: true, reason: 'коментарі + свої файли' });
  t('власник змінив і схвалив: сцена з коментуванням + робоча медіатека', ap.status === 200 && ap.body.request.status === 'modified' && ap.body.request.grantIds.length === 2, JSON.stringify(ap.body).slice(0, 200));
  t('людину перепідключено в кімнаті', changed.includes(`${P}:u-ill`));
  const eff = (await resolveProjectAccess({ id: 'u-ill', role: 'writer', isGuest: false } as any, P, access))!.effective;
  t('фактичні права — лише сцена й медіатека (№11)', eff.scenes['sec-1'] === 'comment' && eff.media === 'work' && eff.restricted);
  t('вдруге — 409', (await call('POST', `/api/core/projects/${P}/access-requests/${reqId}/decide`, 'u-owner', { action: 'reject' })).status === 409);
  // Керівник із правом керування теж вирішує.
  await repo.upsertParticipant({ projectId: P, userId: 'u-mgr', source: 'manual', createdBy: 'user:u-owner' });
  await grantAccess(repo, { projectId: P, granter: { userId: 'u-owner', isOwner: true, isAdmin: false }, userId: 'u-mgr', level: 'manage', scopeType: 'book' });
  const s2 = await call('POST', `${O}/sessions`, 'u-tr', { source: 'open_project', projectId: P });
  await call('PUT', `${O}/sessions/${s2.body.session.id}/steps/6`, 'u-tr', { answers: { projectType: 'book', entryIntent: 'join_existing_project', roles: [{ roleId: 'translator' }], scope: 'whole_project', capabilities: ['view', 'edit'] } });
  const r2 = (await call('POST', `${O}/sessions/${s2.body.session.id}/complete`, 'u-tr')).body.outcome.request;
  const rj = await call('POST', `/api/core/projects/${P}/access-requests/${r2.id}/decide`, 'u-mgr', { action: 'reject', reason: 'перекладач уже є' });
  t('учасник із правом керування відхиляє', rj.status === 200 && rj.body.request.status === 'rejected' && rj.body.request.decidedBy === 'user:u-mgr');
  const s3 = await call('POST', `${O}/sessions`, 'u-tr', { source: 'open_project', projectId: P });
  await call('PUT', `${O}/sessions/${s3.body.session.id}/steps/6`, 'u-tr', { answers: { projectType: 'book', entryIntent: 'join_existing_project', roles: [{ roleId: 'translator' }], scope: 'whole_project', capabilities: ['view'] } });
  const r3 = (await call('POST', `${O}/sessions/${s3.body.session.id}/complete`, 'u-tr')).body.outcome.request;
  t('пізніше можна запросити знову (№23) і відкликати свій запит', !!r3 && (await call('POST', `/api/core/projects/${P}/access-requests/${r3.id}/cancel`, 'u-tr')).body.request.status === 'cancelled');
}

console.log('\nКурс — проєкт ядра зі співавторами (№3, рішення §2 п.1):');
{
  const c = await call('POST', '/api/courses', 'u-teacher', { title: 'Курс письма' });
  const cid = c.body.course?.id;
  const projectId = `${COURSE_PREFIX}${cid}`;
  await new Promise((r) => setTimeout(r, 50));
  const proj = await repo.getProject(projectId);
  t('новий курс — проєкт ядра типу «курс», власник — учасник', c.status === 201 && proj?.projectType === 'course' && proj.ownerId === 'u-teacher' && (await rolesOf(repo, projectId, 'u-teacher')).includes('project_owner'));
  t('без доступу курс не видно (404) і не в списку (403)', (await call('GET', `/api/courses/${cid}`, 'u-co')).status === 404 && (await call('GET', '/api/courses', 'u-co')).status === 403);
  const s = await call('POST', `${O}/sessions`, 'u-co', { source: 'open_project', projectId });
  t('опитувальник курсу — тип «курс»', s.body.session?.projectType === 'course');
  await call('PUT', `${O}/sessions/${s.body.session.id}/steps/6`, 'u-co', { answers: { entryIntent: 'join_existing_project', roles: [{ roleId: 'co_author' }], scope: 'selected_course', capabilities: ['view', 'comment', 'edit'] } });
  const req = (await call('POST', `${O}/sessions/${s.body.session.id}/complete`, 'u-co')).body.outcome?.request;
  t('запит доступу до курсу', req?.level === 'edit' && req.scope === 'selected_course');
  t('автор курсу бачить запит і схвалює', (await call('POST', `/api/core/projects/${projectId}/access-requests/${req.id}/decide`, 'u-teacher', { action: 'approve' })).body.request?.status === 'approved');
  const got = await call('GET', `/api/courses/${cid}`, 'u-co');
  t('співавтор бачить курс із правом редагування', got.status === 200 && got.body.access === 'edit');
  const put = await call('PUT', `/api/courses/${cid}`, 'u-co', { ...got.body.course, subtitle: 'від співавтора' });
  t('…і править його (без глобального права авторства курсів)', put.status === 200 && getCourse(cid)?.subtitle === 'від співавтора' && getCourse(cid)?.ownerId === 'u-teacher');
  const list = await call('GET', '/api/courses', 'u-co');
  t('у списку — серед спільних', list.status === 200 && list.body.shared.some((x: any) => x.id === cid) && list.body.canAuthor === false);
  t('шлюз знає спільні курси (меню «Створити курс» без ролі експерта)', (await call('GET', `${O}/gate`, 'u-co')).body.sharedCourses?.includes(cid) && !(await call('GET', `${O}/gate`, 'u-teacher')).body.sharedCourses?.includes(cid));
  t('публікує й видаляє — лише власник (співавтору — 403 за правом)', (await call('POST', `/api/courses/${cid}/publish`, 'u-co')).status === 403 && (await call('DELETE', `/api/courses/${cid}`, 'u-co')).status === 403);
}
server.close();
resetActiveRegistry();

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
