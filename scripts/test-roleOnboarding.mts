/**
 * Role Onboarding — опитувальник ролі, запити доступу, налаштування учасника,
 * аналітика (Т6.3 В1, `PLAN_ROLE_ONBOARDING.md`; ТЗ Role Onboarding v3.1
 * §5–12, §19–20, §24–25, §28; критерії №2, 3, 5–7, 9–16, 22, 27, 28).
 * Запуск: npm run test:role-onboarding (з CORE_TEST_DATABASE_URL — ще й на
 * PostgreSQL; схема ядра в цій базі видаляється — лише тестова база!).
 */
import { createCorePool } from '../server/core/index.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { bootstrapOntology, resetActiveRegistry } from '../server/core/ontology/lifecycle.ts';
import { resolveEffectiveAccess } from '../server/core/collaboration/access.ts';
import { ensureOwnerParticipant, rolesOf } from '../server/core/collaboration/participants.ts';
import * as O from '../server/core/collaboration/onboarding.ts';
import { activeCollabOntology } from '../src/utils/collabOntology.ts';
import { requestedAccess, scopeAvailable, suggestedCapabilities, validateAnswers, detailGroupsFor, aiGroupsFor } from '../src/utils/roleOnboarding.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const errOf = async (f: () => Promise<unknown>): Promise<any> => {
  try { await f(); return null; } catch (e) { return e; }
};
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

console.log('\nВідповіді за реєстром (чиста перевірка):');
{
  const reg = activeCollabOntology();
  t('без типу проєкту й мети — помилки кроків 1–2', codes(validateAnswers(reg, {}, { upTo: 2 })).join() === 'required,required');
  t('кілька ролей в одному проєкті (№2, №7)', validateAnswers(reg, { projectType: 'book', entryIntent: 'create_own_project', roles: [{ roleId: 'author' }, { roleId: 'designer' }] }, { upTo: 3 }).length === 0);
  t('фрілансер без спеціалізації — помилка (№5)', codes(validateAnswers(reg, { projectType: 'book', entryIntent: 'fulfill_freelance_order', roles: [{ roleId: 'freelancer' }] }, { upTo: 3 })).includes('specialization_required'));
  t('фрілансер + ілюстратор — так', validateAnswers(reg, { projectType: 'book', entryIntent: 'fulfill_freelance_order', roles: [{ roleId: 'freelancer', specialization: 'illustrator' }] }, { upTo: 3 }).length === 0);
  t('курс: автор курсу — так, а для книги — ні (№3)', validateAnswers(reg, { projectType: 'course', entryIntent: 'create_own_project', roles: [{ roleId: 'course_author' }] }, { upTo: 3 }).length === 0 && codes(validateAnswers(reg, { projectType: 'book', entryIntent: 'create_own_project', roles: [{ roleId: 'course_author' }] }, { upTo: 3 })).includes('project_type'));
  t('чужий проєкт — потрібні область і можливості', codes(validateAnswers(reg, { projectType: 'book', entryIntent: 'join_existing_project', roles: [{ roleId: 'illustrator' }] }, { joining: true })).join() === 'required,required');
  t('для курсу — без розділів і сцен', !scopeAvailable('selected_scenes', 'course') && scopeAvailable('selected_course', 'course') && !scopeAvailable('selected_course', 'book') && !scopeAvailable('marketing_data', 'book'));
  t('шаблон можливостей ілюстратора — з реєстру (роль ≠ дозвіл, §19)', suggestedCapabilities(reg, [{ roleId: 'illustrator' }]).join() === 'view,comment,create,upload,propose');
  t('параметри ролі й допомога ШІ — за простором (§8, §11)', detailGroupsFor(reg, [{ roleId: 'freelancer', specialization: 'cover_designer' }]).join() === 'designer' && aiGroupsFor(reg, [{ roleId: 'author' }, { roleId: 'sales_manager' }]).join() === 'author,manager');
  const ill = requestedAccess('selected_scenes', ['sec-1'], ['view', 'comment', 'upload', 'propose'])!;
  t('ілюстратор: сцена з переглядом-перевіркою + робоча медіатека', ill.scopeType === 'scene' && ill.level === 'review' && ill.mediaWork && ill.refs.join() === 'sec-1');
  t('«керування» запитом не видається — найвище схвалення', requestedAccess('whole_project', [], ['view', 'manage'])!.level === 'approve' && requestedAccess('whole_project', [], ['manage'])!.manageRequested);
  t('область без застосування (маркетингові дані) — null', requestedAccess('marketing_data', [], ['view']) === null);
}

const P = 'book-onb';
const C = 'course-0000aaaa';
const BOOK_INDEX = new Map([['ch-1', ['sec-1', 'sec-2']]]);

async function suite(name: string, repo: CoreRepository, raw?: (sql: string, params?: unknown[]) => Promise<any>) {
  resetActiveRegistry();
  await bootstrapOntology(repo);
  await repo.upsertProject({ id: P, ownerId: 'u-owner', title: 'Маяк' });
  await repo.upsertProject({ id: C, ownerId: 'u-teacher', title: 'Курс письма', projectType: 'course' });
  await repo.upsertDocument({ projectId: P, id: 'ch-1', kind: 'chapter', order: 0, title: 'Глава' });
  await repo.upsertDocument({ projectId: P, id: 'sec-1', kind: 'section', parentId: 'ch-1', order: 0, title: 'Сцена 1' });
  await ensureOwnerParticipant(repo, P, 'u-owner');
  const invites: Record<string, { id: string; role: string }> = { [`${P}:u-reader`]: { id: 'inv-1', role: 'beta_reader' } };
  const deps: O.OnboardingDeps = {
    async ownerOf(id) { return id === P ? 'u-owner' : id === C ? 'u-teacher' : id === 'book-new' ? null : id === 'book-mine' ? 'u-writer' : null; },
    async acceptedInvite(projectId, userId) { return invites[`${projectId}:${userId}`] ?? null; },
  };
  const who = (userId: string, isAdmin = false) => ({ userId, isAdmin });
  const entitiesBefore = (await repo.listEntities(P)).length;

  console.log(`\n${name} — перший вхід, збереження й продовження (§25, №14):`);
  let g = await O.onboardingGate(repo, deps, who('u-new'), { enabled: true });
  t('перший вхід кожного — майстер потрібен', g.required && g.reason === 'first_login');
  t('вимкнено (ROLE_ONBOARDING=off) — не показується', !(await O.onboardingGate(repo, deps, who('u-new'), { enabled: false })).required);
  const s1 = (await O.startOnboarding(repo, deps, who('u-new'), { userId: 'u-new', source: 'first_login' })).session;
  t('сесія — чернетка з кроку 1', s1.status === 'draft' && s1.currentStep === 1 && s1.projectId === null);
  t('повторний старт — та сама сесія (Resume)', (await O.startOnboarding(repo, deps, who('u-new'), { userId: 'u-new', source: 'first_login' })).resumed);
  const st1 = await O.saveOnboardingStep(repo, deps, who('u-new'), { sessionId: s1.id, step: 1, answers: { projectType: 'book' } });
  t('крок 1 збережено → крок 2', st1.session.currentStep === 2 && st1.issues.length === 0);
  await O.saveOnboardingStep(repo, deps, who('u-new'), { sessionId: s1.id, step: 2, answers: { entryIntent: 'fulfill_freelance_order' } });
  const bad = await O.saveOnboardingStep(repo, deps, who('u-new'), { sessionId: s1.id, step: 3, answers: { roles: [{ roleId: 'freelancer' }] } });
  t('фрілансер без спеціалізації — лишається на кроці 3 (№5)', bad.issues.some((i) => i.code === 'specialization_required') && bad.session.currentStep === 3);
  const good = await O.saveOnboardingStep(repo, deps, who('u-new'), { sessionId: s1.id, step: 3, answers: { roles: [{ roleId: 'freelancer', specialization: 'illustrator' }], otherRole: 'ще й аніматор' } });
  t('зі спеціалізацією — крок 4', good.session.currentStep === 4);
  t('чужа сесія — 404', (await errOf(() => O.saveOnboardingStep(repo, deps, who('u-x'), { sessionId: s1.id, step: 4, answers: {} })))?.code === 'not_found');
  t('стара ревізія — 409', (await errOf(() => O.saveOnboardingStep(repo, deps, who('u-new'), { sessionId: s1.id, step: 4, answers: {}, expectedRevision: 1 })))?.code === 'conflict');
  await O.saveOnboardingStep(repo, deps, who('u-new'), { sessionId: s1.id, step: 7, answers: { roleDetails: { illustrator: ['scene_illustrations', 'maps'] }, aiAssistance: ['scene_context', 'marketing_copy'] } });
  t('незавершений — нічого не надано (№15)', (await repo.listParticipants(P)).every((p) => p.userId !== 'u-new') && (await repo.getParticipantPreference('u-new', '*')) === null);
  const done1 = await O.completeOnboarding(repo, deps, who('u-new'), { sessionId: s1.id });
  const pref = await repo.getParticipantPreference('u-new', '*');
  t('перший вхід завершено → налаштування учасника (простір, профіль ШІ)', done1.outcome.kind === 'preferences' && pref?.workspace === 'illustrator' && pref.aiProfile === 'illustrator_default' && pref.roles[0].specialization === 'illustrator');
  t('допомога ШІ — лише релевантна ролі (§11)', pref?.aiAssistance.join() === 'scene_context' && pref.roleDetails.illustrator?.join() === 'scene_illustrations,maps');
  t('завершену не змінити', (await errOf(() => O.saveOnboardingStep(repo, deps, who('u-new'), { sessionId: s1.id, step: 1, answers: {} })))?.code === 'conflict');
  t('після завершення майстер не потрібен', !(await O.onboardingGate(repo, deps, who('u-new'), { enabled: true })).required);
  const s2 = (await O.startOnboarding(repo, deps, who('u-quit'), { userId: 'u-quit', source: 'first_login' })).session;
  await O.cancelOnboarding(repo, who('u-quit'), s2.id);
  t('скасування — більше не нав\'язуємо, подія abandoned', !(await O.onboardingGate(repo, deps, who('u-quit'), { enabled: true })).required && (await repo.listOnboardingEvents({ sessionId: s2.id })).some((e) => e.event === 'onboarding_abandoned'));

  console.log(`\n${name} — власний проєкт (№6, №16):`);
  const own = (await O.startOnboarding(repo, deps, who('u-writer'), { userId: 'u-writer', source: 'create_project', projectId: 'book-mine' })).session;
  t('тип проєкту з id — книга', own.projectType === 'book');
  await O.saveOnboardingStep(repo, deps, who('u-writer'), { sessionId: own.id, step: 3, answers: { entryIntent: 'create_own_project', roles: [{ roleId: 'author' }, { roleId: 'book_manager' }] } });
  const ownDone = await O.completeOnboarding(repo, deps, who('u-writer'), { sessionId: own.id });
  t('власник — власник проєкту + обрані ролі', ownDone.outcome.kind === 'own' && ['project_owner', 'author', 'book_manager'].every((r) => (ownDone.outcome as any).roles.includes(r)));
  const def = (await O.startOnboarding(repo, deps, who('u-fresh'), { userId: 'u-fresh', source: 'create_project', projectId: 'book-new' })).session;
  await O.saveOnboardingStep(repo, deps, who('u-fresh'), { sessionId: def.id, step: 3, answers: { entryIntent: 'create_own_project', roles: [{ roleId: 'screenwriter' }] } });
  const defDone = await O.completeOnboarding(repo, deps, who('u-fresh'), { sessionId: def.id });
  t('книги ще немає на сервері — ролі відкладено (налаштування проєкту)', defDone.outcome.kind === 'own' && (defDone.outcome as any).deferred && (await rolesOf(repo, 'book-new', 'u-fresh')).length === 0);
  await repo.upsertProject({ id: 'book-new', ownerId: 'u-fresh', title: 'Нова' });
  await ensureOwnerParticipant(repo, 'book-new', 'u-fresh');
  t('синхронізація книги — власник проєкту + обрана роль (а не «автор» за замовчуванням)', (await rolesOf(repo, 'book-new', 'u-fresh')).sort().join() === 'project_owner,screenwriter');

  console.log(`\n${name} — чужий проєкт: запит доступу (§20, №9–11):`);
  g = await O.onboardingGate(repo, deps, who('u-ill'), { projectId: P, enabled: true });
  t('роль у чужому проєкті невідома — майстер', g.required && g.reason === 'no_role');
  const js = (await O.startOnboarding(repo, deps, who('u-ill'), { userId: 'u-ill', source: 'open_project', projectId: P })).session;
  const early = await errOf(() => O.completeOnboarding(repo, deps, who('u-ill'), { sessionId: js.id }));
  t('недозаповнений — не завершується (з переліком кроків)', early?.code === 'bad_input' && Array.isArray(early.issues));
  await O.saveOnboardingStep(repo, deps, who('u-ill'), { sessionId: js.id, step: 6, answers: { entryIntent: 'join_existing_project', roles: [{ roleId: 'illustrator' }], scope: 'selected_scenes', scopeRefs: ['sec-1'], capabilities: ['view', 'comment', 'upload', 'propose'], message: 'Проілюструю сцену 1' } });
  const jd = await O.completeOnboarding(repo, deps, who('u-ill'), { sessionId: js.id });
  const req = (jd.outcome as any).request;
  t('учасник з роллю ілюстратора й запит доступу', jd.outcome.kind === 'access_request' && req.status === 'pending' && req.level === 'review' && req.scopeRefs.join() === 'sec-1');
  let eff = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-ill', isOwner: false, isAdmin: false });
  t('до рішення власника — жодного доступу (роль ≠ дозвіл)', eff.restricted && eff.media === 'none' && !Object.keys(eff.scenes).length);
  t('журнал співпраці: access_requested (№27)', (await repo.listCollabEvents(P, { limit: 500 })).some((e) => e.action === 'access_requested'));
  t('сповіщення власнику', (await repo.listNotifications(P)).some((n) => n.kind === 'access_request'));
  g = await O.onboardingGate(repo, deps, who('u-ill'), { projectId: P, enabled: true });
  t('шлюз: запит чекає рішення', !g.required && g.reason === 'pending_request' && g.request?.id === req.id);
  const again = (await O.startOnboarding(repo, deps, who('u-ill'), { userId: 'u-ill', source: 'open_project', projectId: P })).session;
  await O.saveOnboardingStep(repo, deps, who('u-ill'), { sessionId: again.id, step: 6, answers: { entryIntent: 'join_existing_project', roles: [{ roleId: 'illustrator' }], scope: 'whole_project', capabilities: ['view'] } });
  t('другий запит, поки перший чекає, — 409', (await errOf(() => O.completeOnboarding(repo, deps, who('u-ill'), { sessionId: again.id })))?.code === 'conflict');
  await O.cancelOnboarding(repo, who('u-ill'), again.id);
  t('вирішує не будь-хто — bad_actor', (await errOf(() => O.decideAccessRequest(repo, { projectId: P, requestId: req.id, decider: { userId: 'u-writer', isOwner: false, isAdmin: false }, action: 'approve', bookIndex: BOOK_INDEX })))?.code === 'bad_actor');
  const ap = await O.decideAccessRequest(repo, { projectId: P, requestId: req.id, decider: { userId: 'u-owner', isOwner: true, isAdmin: false }, action: 'approve', bookIndex: BOOK_INDEX });
  eff = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-ill', isOwner: false, isAdmin: false });
  t('схвалено: сцена 1 + робоча медіатека, а не весь рукопис (№11)', ap.status === 'approved' && ap.grantIds.length === 2 && eff.scenes['sec-1'] === 'review' && eff.media === 'work' && eff.restricted && eff.book === 'none');
  t('аудит рішення й аналітика окремо', (await repo.listCollabEvents(P, { limit: 500 })).some((e) => e.action === 'access_request_decided' && e.details.requestId === req.id) && (await repo.listOnboardingEvents({ userId: 'u-ill', event: 'access_approved' })).length === 1);
  t('вдруге — 409', (await errOf(() => O.decideAccessRequest(repo, { projectId: P, requestId: req.id, decider: { userId: 'u-owner', isOwner: true, isAdmin: false }, action: 'reject' })))?.code === 'conflict');

  // Змінити (Modify) і відхилити (Reject).
  const edS = (await O.startOnboarding(repo, deps, who('u-ed'), { userId: 'u-ed', source: 'open_project', projectId: P })).session;
  await O.saveOnboardingStep(repo, deps, who('u-ed'), { sessionId: edS.id, step: 6, answers: { entryIntent: 'review_or_edit', roles: [{ roleId: 'editor' }], scope: 'whole_project', capabilities: ['view', 'edit', 'manage'] } });
  const edReq = ((await O.completeOnboarding(repo, deps, who('u-ed'), { sessionId: edS.id })).outcome as any).request;
  t('запит «керування» → рівень схвалення, не керування', edReq.level === 'approve');
  const md = await O.decideAccessRequest(repo, { projectId: P, requestId: edReq.id, decider: { userId: 'u-admin', isOwner: false, isAdmin: true }, action: 'modify', level: 'comment', reason: 'спершу коментарі' });
  eff = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-ed', isOwner: false, isAdmin: false });
  t('адмін змінив: коментування книги замість схвалення', md.status === 'modified' && (md.decision as any).level === 'comment' && eff.book === 'comment' && md.reason === 'спершу коментарі');
  const rjS = (await O.startOnboarding(repo, deps, who('u-rj'), { userId: 'u-rj', source: 'marketplace', projectId: P, orderId: 'ord-77' })).session;
  t('замовлення з маркетплейсу: мета й order_id у контексті (№13)', rjS.entryIntent === 'fulfill_freelance_order' && rjS.sourceOrderId === 'ord-77');
  await O.saveOnboardingStep(repo, deps, who('u-rj'), { sessionId: rjS.id, step: 6, answers: { projectType: 'book', roles: [{ roleId: 'freelancer', specialization: 'cover_designer' }], scope: 'media_library', capabilities: ['view', 'upload'] } });
  const rjOut = (await O.completeOnboarding(repo, deps, who('u-rj'), { sessionId: rjS.id })).outcome as any;
  const rjPart = await repo.getParticipant(P, 'u-rj');
  t('фрілансер-обкладинка: учасник із замовлення, запит робочої медіатеки', rjPart?.source === 'freelance_order' && rjPart.sourceRef === 'ord-77' && rjOut.request.level === 'work' && rjOut.request.orderId === 'ord-77');
  const rj = await O.decideAccessRequest(repo, { projectId: P, requestId: rjOut.request.id, decider: { userId: 'u-owner', isOwner: true, isAdmin: false }, action: 'reject', reason: 'інший виконавець' });
  eff = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-rj', isOwner: false, isAdmin: false });
  t('відхилено — доступу немає, роль лишилась (можна запросити пізніше, №23)', rj.status === 'rejected' && eff.media === 'none' && (await rolesOf(repo, P, 'u-rj')).includes('freelancer'));
  const nrS = (await O.startOnboarding(repo, deps, who('u-nr'), { userId: 'u-nr', source: 'open_project', projectId: P })).session;
  await O.saveOnboardingStep(repo, deps, who('u-nr'), { sessionId: nrS.id, step: 6, answers: { entryIntent: 'join_existing_project', roles: [{ roleId: 'illustrator' }], scope: 'selected_scenes', capabilities: ['view'], message: 'Сцена з маяком' } });
  const nrReq = ((await O.completeOnboarding(repo, deps, who('u-nr'), { sessionId: nrS.id })).outcome as any).request;
  t('сцени ще невідомі людині — запит без цілей, з повідомленням', nrReq.scopeRefs.length === 0 && nrReq.message === 'Сцена з маяком');
  t('…«схвалити як є» не можна — власник обирає, що саме', (await errOf(() => O.decideAccessRequest(repo, { projectId: P, requestId: nrReq.id, decider: { userId: 'u-owner', isOwner: true, isAdmin: false }, action: 'approve', bookIndex: BOOK_INDEX })))?.code === 'bad_input');
  const nrOk = await O.decideAccessRequest(repo, { projectId: P, requestId: nrReq.id, decider: { userId: 'u-owner', isOwner: true, isAdmin: false }, action: 'modify', scopeType: 'scene', scopeRefs: ['sec-1'], bookIndex: BOOK_INDEX });
  t('…«змінити» з обраною сценою — так', nrOk.status === 'modified' && (nrOk.decision as any).scopeRefs.join() === 'sec-1');
  const cxS = (await O.startOnboarding(repo, deps, who('u-cx'), { userId: 'u-cx', source: 'open_project', projectId: P })).session;
  await O.saveOnboardingStep(repo, deps, who('u-cx'), { sessionId: cxS.id, step: 6, answers: { entryIntent: 'join_existing_project', roles: [{ roleId: 'translator' }], scope: 'selected_chapters', scopeRefs: ['ch-1'], capabilities: ['view', 'edit'] } });
  const cxReq = ((await O.completeOnboarding(repo, deps, who('u-cx'), { sessionId: cxS.id })).outcome as any).request;
  t('людина сама відкликає свій запит', (await O.cancelAccessRequest(repo, who('u-cx'), P, cxReq.id)).status === 'cancelled');
  t('чужий запит не відкликати', (await errOf(() => O.cancelAccessRequest(repo, who('u-ill'), P, cxReq.id)))?.code === 'not_found');

  console.log(`\n${name} — запрошення: пропуск (§24, №12):`);
  const inv = await O.startOnboarding(repo, deps, who('u-reader'), { userId: 'u-reader', source: 'open_project', projectId: P });
  t('запрошення відоме — роль, область і можливості заповнені, одразу підсумок', inv.session.source === 'invitation' && inv.session.currentStep === 8 && (inv.session.answers as any).roles[0].roleId === 'beta_reader' && (inv.session.answers as any).entryIntent === 'accept_invitation');
  const invDone = await O.completeOnboarding(repo, deps, who('u-reader'), { sessionId: inv.session.id });
  t('без запиту доступу (доступ дає запрошення, §20)', invDone.outcome.kind === 'invitation' && (await repo.listAccessRequests({ projectId: P, userId: 'u-reader' })).length === 0 && (await rolesOf(repo, P, 'u-reader')).includes('beta_reader'));

  console.log(`\n${name} — курс як проєкт ядра (№3):`);
  const cs = (await O.startOnboarding(repo, deps, who('u-co'), { userId: 'u-co', source: 'open_project', projectId: C })).session;
  t('тип проєкту — курс', cs.projectType === 'course');
  const badScope = await O.saveOnboardingStep(repo, deps, who('u-co'), { sessionId: cs.id, step: 6, answers: { entryIntent: 'join_existing_project', roles: [{ roleId: 'co_author' }], scope: 'selected_scenes', scopeRefs: ['x'], capabilities: ['view', 'edit'] } });
  t('для курсу сцени недоступні', badScope.issues.some((i) => i.code === 'unavailable'));
  await O.saveOnboardingStep(repo, deps, who('u-co'), { sessionId: cs.id, step: 6, answers: { scope: 'selected_course', scopeRefs: [] } });
  const cReq = ((await O.completeOnboarding(repo, deps, who('u-co'), { sessionId: cs.id })).outcome as any).request;
  await O.decideAccessRequest(repo, { projectId: C, requestId: cReq.id, decider: { userId: 'u-teacher', isOwner: true, isAdmin: false }, action: 'approve' });
  eff = await resolveEffectiveAccess(repo, { projectId: C, userId: 'u-co', isOwner: false, isAdmin: false });
  t('співавтор курсу — редагування курсу після схвалення', eff.book === 'edit' && (await rolesOf(repo, C, 'u-co')).includes('co_author'));

  console.log(`\n${name} — аналітика окремо від канону (№28):`);
  const evs = await repo.listOnboardingEvents({ limit: 1000 });
  const kinds = new Set(evs.map((e) => e.event));
  t('події §28: started, step_completed, role_selected, role_changed, completed, abandoned, access_requested / approved / rejected', ['onboarding_started', 'onboarding_step_completed', 'role_selected', 'role_changed', 'onboarding_completed', 'onboarding_abandoned', 'access_requested', 'access_approved', 'access_rejected'].every((k) => kinds.has(k as any)), [...kinds].join(','));
  t('канон твору не змінився — жодної сутності з людей (№29)', (await repo.listEntities(P)).length === entitiesBefore);

  if (raw) {
    console.log(`\n${name} — обмеження бази:`);
    t('дві чернетки на людину й проєкт — UNIQUE', await raw(`INSERT INTO ${CORE_SCHEMA}.onboarding_sessions (user_id, project_id, source) VALUES ('u-dup', 'p', 'manual'), ('u-dup', 'p', 'manual')`).then(() => false, () => true));
    t('завершена без часу — CHECK', await raw(`INSERT INTO ${CORE_SCHEMA}.onboarding_sessions (user_id, source, status) VALUES ('u-z', 'manual', 'completed')`).then(() => false, () => true));
    t('схвалений запит без доступу — CHECK', await raw(`UPDATE ${CORE_SCHEMA}.access_requests SET status = 'approved', decided_by = 'user:x', decided_at = now(), grant_ids = '{}' WHERE id = $1`, [cxReq.id]).then(() => false, () => true));
    t('рішення від AI — CHECK', await raw(`UPDATE ${CORE_SCHEMA}.access_requests SET decided_by = 'ai:AI-1' WHERE id = $1`, [cxReq.id]).then(() => false, () => true));
  }
}

await suite('Пам\'ять', new MemoryCoreRepository());
const pgUrl = process.env.CORE_TEST_DATABASE_URL?.trim();
if (pgUrl) {
  const pool = createCorePool(pgUrl);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — v24 (опитувальник ролі)', Number(rows[0].v) >= 24, `v${rows[0].v}`);
    await suite('PostgreSQL', new PgCoreRepository(pool), (sql, params) => pool.query(sql, params as any[]));
  } catch (err) {
    t('опитувальник на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
} else {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано)');
}
resetActiveRegistry();

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
