/**
 * «Моя роль у проєкті» (Т6.4 В1, `PLAN_ROLE_STUDIO.md`; ТЗ Role Onboarding
 * §23; критерії №23, 24, 27): перегляд і простори, додати роль (власник —
 * одразу, учасник — запит), рішення за запитом ролі (схвалити / змінити /
 * відхилити, свій — ні), зміна спеціалізації, відмова від ролі (доступ
 * лишається), вихід із проєкту, вибір простору.
 * Запуск: npm run test:my-role (з CORE_TEST_DATABASE_URL — ще й на
 * PostgreSQL; схема ядра в цій базі видаляється — лише тестова база!).
 */
import { createCorePool } from '../server/core/index.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { bootstrapOntology, resetActiveRegistry } from '../server/core/ontology/lifecycle.ts';
import { grantAccess, resolveEffectiveAccess } from '../server/core/collaboration/access.ts';
import { assignRole, ensureOwnerParticipant, rolesOf } from '../server/core/collaboration/participants.ts';
import * as O from '../server/core/collaboration/onboarding.ts';
import * as M from '../server/core/collaboration/myRole.ts';
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

console.log('\nПростори ролей (чиста перевірка):');
t('ілюстратор — простір ілюстратора', M.workspacesOf([{ roleId: 'illustrator', workspace: 'illustrator' }], false).join() === 'illustrator');
t('власник без інших ролей — автор', M.workspacesOf([{ roleId: 'project_owner', workspace: 'author' }], true).join() === 'author');
t('власник + менеджер книги — автор, менеджер', M.workspacesOf([{ roleId: 'project_owner', workspace: 'author' }, { roleId: 'book_manager', workspace: 'manager' }], true).join() === 'author,manager');
t('кілька ролей — простори без повторів у порядку ролей', M.workspacesOf([{ roleId: 'designer', workspace: 'designer' }, { roleId: 'cover_designer', workspace: 'designer' }, { roleId: 'translator', workspace: 'translator' }], false).join() === 'designer,translator');

const P = 'book-myrole';
const BOOK_INDEX = new Map([['ch-1', ['sec-1', 'sec-2']]]);
const OWNER = { userId: 'u-owner', isOwner: true, isAdmin: false };
const owner = (repo: CoreRepository) => ({ projectId: P, ...OWNER });
const member = (userId: string) => ({ projectId: P, userId, isOwner: false, isAdmin: false });

async function suite(name: string, repo: CoreRepository, raw?: (sql: string, params?: unknown[]) => Promise<any>) {
  resetActiveRegistry();
  await bootstrapOntology(repo);
  await repo.upsertProject({ id: P, ownerId: 'u-owner', title: 'Маяк' });
  await repo.upsertDocument({ projectId: P, id: 'ch-1', kind: 'chapter', order: 0, title: 'Глава' });
  await repo.upsertDocument({ projectId: P, id: 'sec-1', kind: 'section', parentId: 'ch-1', order: 0, title: 'Сцена 1' });
  await ensureOwnerParticipant(repo, P, 'u-owner');
  const granter = { userId: 'u-owner', isOwner: true, isAdmin: false };
  const actor = 'user:u-owner' as const;
  // Ілюстратор: сцена 1 на перевірку; керівник: керування книгою.
  await assignRole(repo, { projectId: P, userId: 'u-ill', roleId: 'illustrator', actor, source: 'access_request' });
  await grantAccess(repo, { projectId: P, granter, userId: 'u-ill', level: 'review', scopeType: 'scene', scopeRef: 'sec-1', bookIndex: BOOK_INDEX });
  await assignRole(repo, { projectId: P, userId: 'u-mgr', roleId: 'book_manager', actor, source: 'manual' });
  await grantAccess(repo, { projectId: P, granter, userId: 'u-mgr', level: 'manage', scopeType: 'book' });
  const effOf = (userId: string) => resolveEffectiveAccess(repo, { projectId: P, userId, isOwner: false, isAdmin: false });
  const effStr = async (userId: string) => JSON.stringify(await effOf(userId));
  const illEff0 = await effStr('u-ill');

  console.log(`\n${name} — перегляд «Моя роль у проєкті»:`);
  let v = await M.myRoleView(repo, member('u-ill'));
  t('ілюстратор: роль із назвою й простором', v.roles.length === 1 && v.roles[0].roleId === 'illustrator' && v.roles[0].label?.uk === 'Ілюстратор' && v.roles[0].workspace === 'illustrator');
  t('ілюстратор: простір — ілюстратора, сам ролі не додає', v.activeWorkspace === 'illustrator' && v.workspaces.join() === 'illustrator' && !v.selfAssign);
  let ov = await M.myRoleView(repo, owner(repo));
  t('власник: роль власника, простір автора, додає сам', ov.roles.some((r) => r.roleId === 'project_owner') && ov.activeWorkspace === 'author' && ov.selfAssign);

  console.log(`\n${name} — додати роль у чужому проєкті — лише запитом (рішення §2 п.2, №23, №24):`);
  const add = await M.addMyRole(repo, member('u-ill'), { roleId: 'designer' });
  t('запит ролі, а не призначення', add.kind === 'requested' && add.request!.kind === 'role' && add.request!.level === null && add.request!.status === 'pending');
  t('роль до схвалення не з\'явилась', (await rolesOf(repo, P, 'u-ill')).join() === 'illustrator');
  t('доступ не змінився (зміна ролі не дає прав, №24)', (await effStr('u-ill')) === illEff0);
  t('нерозглянутий запит ролі видно в «Моїй ролі»', add.view.pending.role?.id === add.request!.id && add.view.pending.access === null);
  t('другий запит ролі поки перший чекає — конфлікт', (await errOf(() => M.addMyRole(repo, member('u-ill'), { roleId: 'translator' })))?.code === 'conflict');
  t('роль, яка вже є — конфлікт', (await errOf(() => M.addMyRole(repo, member('u-mgr'), { roleId: 'book_manager' })))?.code === 'conflict');
  t('роль не з реєстру — відмова', (await errOf(() => M.addMyRole(repo, member('u-mgr'), { roleId: 'astronaut' })))?.code === 'bad_input');
  t('фрілансер без спеціалізації — відмова (№5)', (await errOf(() => M.addMyRole(repo, member('u-mgr'), { roleId: 'freelancer' })))?.code === 'bad_input');
  t('власнику — сповіщення про запит ролі', (await repo.listNotifications(P, 50)).some((n) => (n.payload as any)?.requestId === add.request!.id));
  const g = await O.onboardingGate(repo, { async ownerOf() { return 'u-owner'; } }, { userId: 'u-ill', isAdmin: false }, { projectId: P, enabled: true });
  t('шлюз входу не плутає запит ролі з запитом доступу', g.request === null && !g.required);

  console.log(`\n${name} — рішення за запитом ролі:`);
  const decider = (userId: string, isOwner = false) => ({ userId, isOwner, isAdmin: false });
  t('свій запит не розглядає ніхто сам', (await errOf(() => O.decideAccessRequest(repo, { projectId: P, requestId: add.request!.id, decider: decider('u-ill'), action: 'approve' })))?.code === 'bad_actor');
  const ok1 = await O.decideAccessRequest(repo, { projectId: P, requestId: add.request!.id, decider: decider('u-mgr'), action: 'approve' });
  t('керівник схвалив — роль з\'явилась', ok1.status === 'approved' && (await rolesOf(repo, P, 'u-ill')).sort().join() === 'designer,illustrator');
  t('схвалений запит ролі — без записів доступу, доступ той самий', ok1.grantIds.length === 0 && (await effStr('u-ill')) === illEff0);
  v = await M.myRoleView(repo, member('u-ill'));
  t('тепер два простори — ілюстратор, дизайнер', v.workspaces.join() === 'illustrator,designer');
  // Запит ролі з доступом, власник змінює: лише частина ролей, без доступу.
  const add2 = await M.addMyRole(repo, member('u-ill'), { roleId: 'proofreader', scope: 'whole_project', capabilities: ['view', 'comment', 'propose'], message: 'Можу вичитати' });
  t('запит ролі з доступом: рівень за можливостями', add2.kind === 'requested' && add2.request!.level === 'review' && add2.request!.scope === 'whole_project');
  const mod = await O.decideAccessRequest(repo, { projectId: P, requestId: add2.request!.id, decider: decider('u-owner', true), action: 'modify', noAccess: true });
  t('«змінити»: роль — так, доступ — ні', mod.status === 'modified' && mod.grantIds.length === 0 && (await rolesOf(repo, P, 'u-ill')).includes('proofreader') && (await effStr('u-ill')) === illEff0);
  const add3 = await M.addMyRole(repo, member('u-ill'), { roleId: 'translator' });
  const rej = await O.decideAccessRequest(repo, { projectId: P, requestId: add3.request!.id, decider: decider('u-owner', true), action: 'reject', reason: 'Перекладача вже маємо' });
  t('відхилено — ролі немає', rej.status === 'rejected' && !(await rolesOf(repo, P, 'u-ill')).includes('translator'));
  // Запит ролі з доступом — схвалено як є: доступ додано.
  await assignRole(repo, { projectId: P, userId: 'u-rev', roleId: 'beta_reader', actor, source: 'manual' });
  await grantAccess(repo, { projectId: P, granter, userId: 'u-rev', level: 'view', scopeType: 'book' });
  const add4 = await M.addMyRole(repo, member('u-rev'), { roleId: 'reviewer', scope: 'whole_project', capabilities: ['view', 'comment', 'review'] });
  const ok4 = await O.decideAccessRequest(repo, { projectId: P, requestId: add4.request!.id, decider: decider('u-owner', true), action: 'approve' });
  t('запит ролі з доступом схвалено — роль і доступ', ok4.status === 'approved' && ok4.grantIds.length === 1 && (await rolesOf(repo, P, 'u-rev')).includes('reviewer') && (await effOf('u-rev')).book === 'review');
  const evs = await repo.listCollabEvents(P, { limit: 500 });
  t('журнал співпраці: запит і рішення ролі (№27)', evs.some((e) => e.action === 'access_requested' && (e.details as any).kind === 'role') && evs.some((e) => e.action === 'access_request_decided' && (e.details as any).kind === 'role'));

  console.log(`\n${name} — зміна спеціалізації:`);
  await assignRole(repo, { projectId: P, userId: 'u-fl', roleId: 'freelancer', specialization: 'illustrator', actor, source: 'freelance_order' });
  await grantAccess(repo, { projectId: P, granter, userId: 'u-fl', level: 'view', scopeType: 'book' });
  let fv = await M.myRoleView(repo, member('u-fl'));
  t('фрілансер-ілюстратор — простір ілюстратора', fv.activeWorkspace === 'illustrator');
  const flId = fv.roles[0].assignmentId;
  t('та сама спеціалізація — конфлікт', (await errOf(() => M.changeMySpecialization(repo, member('u-fl'), { assignmentId: flId, specialization: 'illustrator' })))?.code === 'conflict');
  t('недозволена спеціалізація — відмова', (await errOf(() => M.changeMySpecialization(repo, member('u-fl'), { assignmentId: flId, specialization: 'astronaut' })))?.code === 'bad_input');
  const ch = await M.changeMySpecialization(repo, member('u-fl'), { assignmentId: flId, specialization: 'cover_designer' });
  t('у чужому проєкті — запит із заміною', ch.kind === 'requested' && ch.request!.replaces.join() === flId);
  await O.decideAccessRequest(repo, { projectId: P, requestId: (ch as any).request.id, decider: decider('u-owner', true), action: 'approve' });
  fv = await M.myRoleView(repo, member('u-fl'));
  t('схвалено: стара спеціалізація знята, нова — активна, простір дизайнера', fv.roles.length === 1 && fv.roles[0].specialization === 'cover_designer' && fv.roles[0].assignmentId !== flId && fv.activeWorkspace === 'designer');
  t('чужа роль — не знайдено', (await errOf(() => M.changeMySpecialization(repo, member('u-ill'), { assignmentId: fv.roles[0].assignmentId, specialization: 'designer' })))?.code === 'not_found');

  console.log(`\n${name} — власник змінює свої ролі одразу:`);
  const oa = await M.addMyRole(repo, owner(repo), { roleId: 'book_designer' });
  t('власник додав роль — одразу', oa.kind === 'assigned' && (await rolesOf(repo, P, 'u-owner')).includes('book_designer'));
  ov = oa.view;
  const ownerRole = ov.roles.find((r) => r.roleId === 'project_owner')!;
  t('від ролі власника не відмовляються', (await errOf(() => M.removeMyRole(repo, owner(repo), { assignmentId: ownerRole.assignmentId })))?.code === 'conflict');
  t('власник не виходить із власного проєкту', (await errOf(() => M.leaveProject(repo, owner(repo))))?.code === 'conflict');

  console.log(`\n${name} — відмова від ролі: доступ лишається (рішення §2 п.3):`);
  v = await M.myRoleView(repo, member('u-ill'));
  const des = v.roles.find((r) => r.roleId === 'designer')!;
  const notesBefore = (await repo.listNotifications(P, 200)).length;
  v = await M.removeMyRole(repo, member('u-ill'), { assignmentId: des.assignmentId });
  t('роль знято', !v.roles.some((r) => r.roleId === 'designer') && v.roles.length === 2);
  t('доступ без змін', (await effStr('u-ill')) === illEff0);
  t('керівникам — сповіщення', (await repo.listNotifications(P, 200)).length === notesBefore + 1);
  const pr = v.roles.find((r) => r.roleId === 'proofreader')!;
  v = await M.removeMyRole(repo, member('u-ill'), { assignmentId: pr.assignmentId });
  t('останню роль не знімають — «Вийти з проєкту»', (await errOf(() => M.removeMyRole(repo, member('u-ill'), { assignmentId: v.roles[0].assignmentId })))?.code === 'conflict');

  console.log(`\n${name} — простір:`);
  t('простір чужої ролі — відмова', (await errOf(() => M.setMyWorkspace(repo, member('u-ill'), 'manager')))?.code === 'bad_input');
  t('простору немає в реєстрі — відмова', (await errOf(() => M.setMyWorkspace(repo, owner(repo), 'astronaut')))?.code === 'bad_input');
  ov = await M.setMyWorkspace(repo, owner(repo), 'designer');
  t('власник обрав простір дизайнера — запам\'ятовано', ov.activeWorkspace === 'designer' && (await repo.getParticipantPreference('u-owner', P))?.aiProfile === 'designer_default');

  console.log(`\n${name} — вихід із проєкту:`);
  const pend = await M.addMyRole(repo, member('u-ill'), { roleId: 'designer' });
  const left = await M.leaveProject(repo, member('u-ill'));
  t('ролі й доступ відкликано', left.revokedRoles === 1 && left.revokedGrants === 1 && (await rolesOf(repo, P, 'u-ill')).length === 0);
  const effLeft = await effOf('u-ill');
  t('доступу більше немає', effLeft.book === 'none' && Object.keys(effLeft.scenes ?? {}).length === 0, JSON.stringify(effLeft));
  t('участь — «вийшов», нерозглянутий запит скасовано', (await repo.getParticipant(P, 'u-ill'))?.status === 'left' && (await repo.getAccessRequest(pend.request!.id))?.status === 'cancelled');
  t('учасник, який вийшов, повертається з новим призначенням', (await assignRole(repo, { projectId: P, userId: 'u-ill', roleId: 'illustrator', actor, source: 'invitation' })).participant.status === 'active');

  if (raw) {
    console.log(`\n${name} — обмеження бази:`);
    const part = (await repo.getParticipant(P, 'u-rev'))!;
    t('запит ролі без ролей — CHECK', await raw(`INSERT INTO ${CORE_SCHEMA}.access_requests (project_id, participant_id, user_id, scope, level, kind) VALUES ($1, $2, 'u-rev', 'none', NULL, 'role')`, [P, part.id]).then(() => false, () => true));
    t('запит доступу без рівня — CHECK', await raw(`INSERT INTO ${CORE_SCHEMA}.access_requests (project_id, participant_id, user_id, scope, level) VALUES ($1, $2, 'u-rev', 'whole_project', NULL)`, [P, part.id]).then(() => false, () => true));
    t('схвалений запит доступу без записів доступу — CHECK і далі', await raw(`UPDATE ${CORE_SCHEMA}.access_requests SET status = 'approved', decided_by = 'user:x', decided_at = now(), grant_ids = '{}' WHERE kind = 'access'`).then((r: any) => r.rowCount === 0, () => true));
    t('два нерозглянуті запити ролі — UNIQUE', await raw(`INSERT INTO ${CORE_SCHEMA}.access_requests (project_id, participant_id, user_id, scope, kind, roles) VALUES ($1, $2, 'u-rev', 'none', 'role', '[{"roleId":"editor"}]'), ($1, $2, 'u-rev', 'none', 'role', '[{"roleId":"proofreader"}]')`, [P, part.id]).then(() => false, () => true));
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
    t('схема ядра — v25 (запит ролі)', Number(rows[0].v) >= 25, `v${rows[0].v}`);
    await suite('PostgreSQL', new PgCoreRepository(pool), (sql, params) => pool.query(sql, params as any[]));
  } catch (err) {
    t('«Моя роль» на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
} else {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано)');
}
resetActiveRegistry();

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
