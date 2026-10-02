/**
 * Маршрутизатор процесів ШІ за роллю (Т6.4 В2, `PLAN_ROLE_STUDIO.md`; ТЗ Role
 * Onboarding §21–22; критерії №21, 22, 20): чистий маршрут (процес, завдання,
 * відповідність, область, Jev-фокус), проміжний шар сервера (охорона книги,
 * `req.aiRoute`), чат (інструкція в системному промті, 403 без доступу),
 * `GET …/ai-route`. Запуск: npm run test:ai-workflows
 */
const DIR = '/tmp/nova-ai-workflows-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova.db`;

import fs from 'node:fs';
import express from 'express';
import type { AddressInfo } from 'node:net';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const W = await import('../src/utils/aiWorkflows.ts');
const { activeCollabOntology } = await import('../src/utils/collabOntology.ts');
const { MemoryCoreRepository } = await import('../server/core/memoryRepository.ts');
const { makeEffectiveResolver, grantAccess } = await import('../server/core/collaboration/access.ts');
const { assignRole, ensureOwnerParticipant } = await import('../server/core/collaboration/participants.ts');
const { resetActiveRegistry, bootstrapOntology } = await import('../server/core/ontology/lifecycle.ts');
const { aiRouteMiddleware, createAiRouter, projectIdFromRequest, registerAiRouteRoutes } = await import('../server/core/collaboration/aiRoute.ts');
const M = await import('../server/core/collaboration/myRole.ts');
const db = await import('../server/db.ts');
const store = await import('../server/store.ts');
const chat = await import('../server/chatRoutes.ts');
type RealtimeAccessDeps = import('../server/realtimeAuth.ts').RealtimeAccessDeps;

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nЗавдання за точками ШІ:');
t('ілюстрація, обкладинка, верстка, переклад', W.taskForEndpoint('/api/ai/craft-illustration-prompt') === 'illustration' && W.taskForEndpoint('/api/ai/generate-cover-art') === 'cover' && W.taskForEndpoint('/api/ai/design-layout') === 'layout' && W.taskForEndpoint('/api/ai/translate') === 'translation');
t('стан задачі медіа — за першим сегментом', W.taskForEndpoint('/api/ai/generate-media-art/status/abc') === 'media');
t('курсовий майстер, діагностика, експрес', W.taskForEndpoint('/api/courses/wizard/stage') === 'course' && W.taskForEndpoint('/api/v1/diagn') === 'coaching' && W.taskForEndpoint('/api/express/generate') === 'writing');
t('невідома точка — загальне', W.taskForEndpoint('/api/ai/something-new') === 'general');
const regWs = activeCollabOntology().workspaces.map((w) => w.id);
t('кожен простір реєстру має процес ШІ', regWs.every((w) => W.workflowForWorkspace(w)), regWs.filter((w) => !W.workflowForWorkspace(w)).join());
t('завдання процесів — з довідника', W.AI_WORKFLOWS.every((w) => [...w.primary, ...w.secondary, ...w.suggestions.map((x) => x.task)].every((x) => (W.AI_TASKS as readonly string[]).includes(x))));
t('назви процесів uk / en', W.AI_WORKFLOWS.every((w) => w.name.uk && w.name.en && w.suggestions.every((x) => x.label.uk && x.label.en)));

console.log('\nПростори Студії за роллю (§15):');
{
  const RW = await import('../src/utils/roleWorkspaces.ts');
  const AR = await import('../src/utils/appRoutes.ts');
  t('кожен простір реєстру має розділи Студії', regWs.every((w) => RW.workspaceById(w)?.tabs.length), regWs.filter((w) => !RW.workspaceById(w)).join());
  const allTabs = [...new Set([...RW.ROLE_WORKSPACES.flatMap((w) => w.tabs), ...W.AI_WORKFLOWS.flatMap((w) => w.suggestions.map((x) => x.tab))])];
  const bad = allTabs.filter((tab) => { const p = AR.buildAppPath({ projectId: 'b1', tab: tab as any }); return !p || AR.parseAppPath(p)?.tab !== tab; });
  t('розділи просторів і дії ШІ мають адреси Студії', bad.length === 0, bad.join());
  t('«Мій простір» — адреса /projects/<книга>/my-space', AR.buildAppPath({ projectId: 'b1', tab: 'my-space' }) === '/projects/b1/my-space' && AR.parseAppPath('/projects/b1/my-space')?.tab === 'my-space');
  t('простір ілюстратора (обліковий запис дизайнера): ілюстрації, візуальна бібліотека, персонажі, медіатека', RW.workspaceTabs('illustrator', 'designer').join() === 'illustrations,core-visual,characters,media');
  t('права облікового запису фільтрують розділи (читач — без обкладинки)', !RW.workspaceTabs('designer', 'reader').includes('cover'));
  t('ТЗ §15: «з’явиться пізніше» для ілюстратора — завдання й результати', RW.workspaceById('illustrator')!.later.map((x) => x.uk).join() === 'Призначені завдання,Результати');
}

console.log('\nМаршрут (§21):');
const ill = W.routeAiWorkflow({ workspaces: ['illustrator'], task: 'illustration', scope: 'project' })!;
t('ілюстратор + ілюстрація → процес ілюстратора, основне', ill.workflow === 'illustration' && ill.fit === 'primary' && ill.instruction.includes('ІЛЮСТРАТОРУ'));
const out = W.routeAiWorkflow({ workspaces: ['illustrator'], task: 'editing', scope: 'project' })!;
t('ілюстратор + редагування → поза процесом, не заборона', out.workflow === 'illustration' && out.fit === 'outside' && out.instruction.includes('поза основним процесом'));
const multi = W.routeAiWorkflow({ workspaces: ['illustrator', 'designer'], activeWorkspace: 'illustrator', task: 'cover', scope: 'project' })!;
t('кілька ролей: обкладинка — у дизайнерському процесі, хоч обрано ілюстратора', multi.workflow === 'design' && multi.fit === 'primary' && multi.workspace === 'designer');
const act = W.routeAiWorkflow({ workspaces: ['author', 'editor'], activeWorkspace: 'editor', task: 'analysis', scope: 'project' })!;
t('обраний простір — першим серед рівних', act.workflow === 'editorial');
const part = W.routeAiWorkflow({ workspaces: ['illustrator'], task: 'illustration', scope: 'partial', aiAssistance: ['scene_context', 'visual_bible'], projectType: 'course' })!;
t('частина проєкту — інструкція не виходити за фрагмент', part.instruction.includes('лише до частини проєкту'));
t('допомога ШІ з опитувальника — в інструкції', part.instruction.includes('контекст сцени') && part.instruction.includes('візуальну біблію'));
t('курс — у інструкції', part.instruction.includes('навчальний курс'));
t('без просторів — без маршруту (ШІ як раніше)', W.routeAiWorkflow({ workspaces: [], task: 'chat', scope: 'project' }) === null);
t('менеджер + публікація → процес публікації', W.routeAiWorkflow({ workspaces: ['manager'], task: 'publishing', scope: 'project' })!.workflow === 'publishing');
t('перекладач, розробник, рецензент', W.routeAiWorkflow({ workspaces: ['translator'], task: 'translation', scope: 'project' })!.workflow === 'translation' && W.routeAiWorkflow({ workspaces: ['developer'], task: 'technical', scope: 'project' })!.workflow === 'technical' && W.routeAiWorkflow({ workspaces: ['reviewer'], task: 'analysis', scope: 'project' })!.workflow === 'review');
t('інструкція дописується до системної, порожній маршрут — без змін', W.withWorkflowInstruction('SYS', { instruction: 'WF' }) === 'SYS\n\nWF' && W.withWorkflowInstruction('SYS', null) === 'SYS' && W.withWorkflowInstruction(undefined, { instruction: 'WF' }) === 'WF');

console.log('\nШар рішень Jev (§22):');
const jd = W.jevFocus({ workspace: 'designer', projectType: 'book', orderId: 'ord-1' });
t('дизайнер + книга + замовлення → обкладинка, верстка, ілюстрація, маркетинговий дизайн', jd.map((x) => x.id).join() === 'cover_design,book_layout,illustration,marketing_design');
t('обрані параметри ролі — першими', W.jevFocus({ workspace: 'designer', projectType: 'book', orderId: 'o', roleDetails: { designer: ['promotional_materials'] } })[0].id === 'marketing_design');
t('ілюстратор — сцени й персонажі за замовчуванням', W.jevFocus({ workspace: 'illustrator', projectType: 'book' }).map((x) => x.id).join() === 'scene_illustration,character_design');
t('автор — без фокусу', W.jevFocus({ workspace: 'author', projectType: 'book' }).length === 0);

// ── Сервер ──────────────────────────────────────────────────────────────────
await db.initDb();
await store.initStore();
const P = 'BK-AIROUTE';
const repo = new MemoryCoreRepository();
resetActiveRegistry();
await bootstrapOntology(repo);
await repo.upsertProject({ id: P, ownerId: 'u-owner', title: 'Маяк' });
await ensureOwnerParticipant(repo, P, 'u-owner');
const granter = { userId: 'u-owner', isOwner: true, isAdmin: false };
await assignRole(repo, { projectId: P, userId: 'u-ill', roleId: 'illustrator', actor: 'user:u-owner', source: 'access_request' });
await grantAccess(repo, { projectId: P, granter, userId: 'u-ill', level: 'review', scopeType: 'scene', scopeRef: 'sec-1' });
await assignRole(repo, { projectId: P, userId: 'u-fl', roleId: 'freelancer', specialization: 'cover_designer', actor: 'user:u-owner', source: 'freelance_order', sourceRef: 'ord-77' });
await grantAccess(repo, { projectId: P, granter, userId: 'u-fl', level: 'view', scopeType: 'book' });
await assignRole(repo, { projectId: P, userId: 'u-pending', roleId: 'editor', actor: 'user:u-owner', source: 'access_request' });
const access: RealtimeAccessDeps = {
  async getBookOwnerId(id) { return id === P ? 'u-owner' : null; },
  async getCollabOwnerId() { return undefined; },
  async listAcceptedInvites() { return []; },
  effectiveAccess: makeEffectiveResolver(() => repo, () => 'ready'),
};
let clock = 1_000_000;
const router = createAiRouter({ repo: () => repo, access, now: () => clock });
const ROLES: Record<string, string> = { 'u-admin': 'admin' };
let lastSystem = '';
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers['x-who'] || '');
  (req as any).principal = id ? { id, role: ROLES[id] ?? 'writer', isGuest: false, email: `${id}@t.ua`, name: id } : { id: null, role: 'guest', isGuest: true };
  next();
});
app.use(aiRouteMiddleware(router));
app.post(/^\/api\/(ai|courses\/wizard)\/.*/, (req, res) => res.json({ route: req.aiRoute ?? null }));
const requireAuth = (req: any, res: any, next: any) => (req.principal?.isGuest ? res.status(401).json({ error: 'auth' }) : next());
registerAiRouteRoutes(app, { router, requireAuth });
chat.registerChatRoutes(app, {
  generate: async (_prompt: string, system: string) => {
    lastSystem = system;
    return { text: 'ok', inputTokens: 1, outputTokens: 1 };
  },
  defaultModelId: 'gemini-3.7-flash',
  aiRoute: async (req, bookId) => {
    const r = await router.resolve(req.principal, bookId, 'chat');
    return r.kind === 'forbidden' ? 'forbidden' : r.kind === 'route' ? r.route : null;
  },
});
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', 'x-who': who }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any, wf: res.headers.get('x-nova-ai-workflow') };
};

console.log('\nОхорона книги на точках ШІ (№20, №22):');
t('книга з тіла: bookId, book_id, курс майстра', projectIdFromRequest({ body: { bookId: 'a' }, query: {} } as any) === 'a' && projectIdFromRequest({ body: { book_id: 'b' }, query: {} } as any) === 'b' && projectIdFromRequest({ body: { course: { id: 'c1' } }, query: {} } as any) === 'course-c1');
let r = await call('POST', '/api/ai/edit-text', 'u-pending', { bookId: P, text: 'x' });
t('роль без доступу (запит не розглянуто) — 403 no_project_access', r.status === 403 && r.body.kind === 'no_project_access');
t('чужа книга — 403', (await call('POST', '/api/ai/edit-text', 'u-stranger', { bookId: P })).status === 403);
r = await call('POST', '/api/ai/edit-text', 'u-stranger', { bookId: 'local-only-book' });
t('книга поза ядром — як раніше, без маршруту', r.status === 200 && r.body.route === null);
r = await call('POST', '/api/ai/edit-text', 'u-stranger', {});
t('без книги — як раніше', r.status === 200 && r.body.route === null);

console.log('\nМаршрут у запиті (§21, №21):');
r = await call('POST', '/api/ai/craft-illustration-prompt', 'u-ill', { bookId: P });
t('ілюстратор: процес ілюстратора, область — частина книги', r.status === 200 && r.body.route?.workflow === 'illustration' && r.body.route.scope === 'partial' && r.wf?.startsWith('illustration'));
r = await call('POST', '/api/ai/generate-cover', 'u-fl', { bookId: P });
t('фрілансер-дизайнер обкладинки із замовленням: дизайн, фокус Jev §22', r.body.route?.workflow === 'design' && r.body.route.fit === 'primary' && r.body.route.focus.map((x: any) => x.id).join() === 'cover_design,book_layout,illustration,marketing_design');
r = await call('POST', '/api/ai/edit-text', 'u-owner', { bookId: P });
t('власник: письменницький процес, увесь проєкт', r.body.route?.workflow === 'writer' && r.body.route.scope === 'project');
r = await call('POST', '/api/ai/edit-text', 'u-admin', { bookId: P });
t('адмін без ролі — без маршруту, без відмови', r.status === 200 && r.body.route === null);

console.log('\nКеш і зміна простору:');
await M.setMyWorkspace(repo, { projectId: P, userId: 'u-owner', isOwner: true, isAdmin: false }, 'designer');
r = await call('POST', '/api/ai/analyze-scene', 'u-owner', { bookId: P });
t('до скидання кешу — старий маршрут (30 с)', r.body.route?.workflow === 'writer');
router.forget('u-owner');
r = await call('POST', '/api/ai/analyze-scene', 'u-owner', { bookId: P });
t('після скидання: аналіз сцени — не дизайнерське, тож письменницький процес іншої ролі власника', r.body.route?.workspace === 'author' && r.body.route.workflow === 'writer' && r.body.route.fit === 'primary');
r = await call('POST', '/api/ai/generate-cover', 'u-owner', { bookId: P });
t('обкладинка у власника з простором дизайнера — дизайн', r.body.route?.workflow === 'design');
clock += 31_000;
t('кеш живе 30 с', (await call('POST', '/api/ai/generate-cover', 'u-owner', { bookId: P })).body.route?.workflow === 'design');

console.log('\nGET …/ai-route і чат:');
let g = await call('GET', `/api/core/projects/${P}/ai-route?task=illustration`, 'u-ill');
t('маршрут для Студії: процес, причина, запропоновані дії', g.status === 200 && g.body.route.workflow === 'illustration' && g.body.route.reason.includes('основне') && g.body.route.suggestions.length > 0);
t('без доступу — 403', (await call('GET', `/api/core/projects/${P}/ai-route`, 'u-pending')).status === 403);
const sIll = await call('POST', '/api/chat/sessions', 'u-ill', { title: 'Бриф', bookId: P });
const m1 = await call('POST', `/api/chat/sessions/${sIll.body.session.id}/messages`, 'u-ill', { content: 'Опиши сцену для ілюстрації' });
t('чат ілюстратора: інструкція процесу в системному промті', m1.status === 200 && lastSystem.includes('[Процес ШІ Nova: Процес ілюстратора]') && lastSystem.includes('лише до частини проєкту'));
const sPend = await call('POST', '/api/chat/sessions', 'u-pending', { title: 'x', bookId: P });
lastSystem = '';
const m2 = await call('POST', `/api/chat/sessions/${sPend.body.session.id}/messages`, 'u-pending', { content: 'привіт' });
t('чат без доступу до книги сесії — 403, модель не викликана', m2.status === 403 && m2.body.kind === 'no_project_access' && lastSystem === '');
const sFree = await call('POST', '/api/chat/sessions', 'u-pending', { title: 'без книги' });
const m3 = await call('POST', `/api/chat/sessions/${sFree.body.session.id}/messages`, 'u-pending', { content: 'привіт' });
t('чат без книги — як раніше', m3.status === 200 && !lastSystem.includes('[Процес ШІ Nova'));

server.close();
resetActiveRegistry();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
