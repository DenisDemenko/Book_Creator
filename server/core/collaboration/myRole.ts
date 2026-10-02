/**
 * «Моя роль у проєкті» (Т6.4 В1, `PLAN_ROLE_STUDIO.md`; ТЗ Role Onboarding §23).
 *
 *   • Додати роль, змінити спеціалізацію — власнику книги й адміністратору
 *     одразу; решті — запит ролі власнику (`access_requests.kind = 'role'`,
 *     рішення власника §2 п.2): роль з'являється після схвалення, доступ — лише
 *     якщо його просили (роль ≠ дозвіл, №24).
 *   • Відмовитися від ролі — одразу; доступ лишається, керівники отримують
 *     сповіщення (рішення §2 п.3). Останню роль не знімають — «Вийти з проєкту».
 *   • Вийти з проєкту — людина сама звужує собі доступ: ролі відкликаються,
 *     наданий доступ — теж, участь — «вийшов». Власник книги не виходить.
 *   • Простір — налаштування учасника на проєкт (`participant_preferences`).
 * Кожна зміна — у журналі співпраці (`collab_events`, №27).
 */

import type { AccessLevel, AccessRequestRow, CoreActor, CoreRepository, ParticipantRoleRow } from '../types';
import { CoreRuleError } from '../rules';
import { activeCollabOntology, roleById } from '../../../src/utils/collabOntology';
import { requestedAccess } from '../../../src/utils/roleOnboarding';
import { assignRole, planRoleAssignment, revokeRole } from './participants';
import { projectTypeById } from './onboarding';

export interface MyRoleContext {
  projectId: string;
  userId: string;
  isOwner: boolean;
  isAdmin: boolean;
}

export interface MyRoleEntry {
  assignmentId: string;
  roleId: string;
  specialization: string | null;
  workspace: string | null;
  label: { en: string; uk: string } | null;
  combinable: boolean;
  requiresSpecialization: boolean;
  specializations: string[];
  singleHolder: boolean;
}

export interface MyRoleView {
  projectId: string;
  projectType: string;
  isOwner: boolean;
  isAdmin: boolean;
  /** Власник і адмін додають ролі одразу; решта — запитом. */
  selfAssign: boolean;
  participant: { id: string; status: string } | null;
  roles: MyRoleEntry[];
  /** Простори ролей (у порядку ролей; власнику без ролей — автор). */
  workspaces: string[];
  activeWorkspace: string | null;
  aiAssistance: string[];
  roleDetails: Record<string, string[]>;
  pending: { role: AccessRequestRow | null; access: AccessRequestRow | null };
}

const actorOf = (userId: string): CoreActor => `user:${userId}`;
export const DEFAULT_OWNER_WORKSPACE = 'author';

async function projectTypeOf(repo: CoreRepository, projectId: string): Promise<string> {
  return (await repo.getProject(projectId))?.projectType ?? projectTypeById(projectId) ?? 'book';
}

function entry(r: ParticipantRoleRow): MyRoleEntry {
  const def = roleById(r.roleId);
  return {
    assignmentId: r.id,
    roleId: r.roleId,
    specialization: r.specialization,
    // Фрілансер працює в просторі своєї спеціалізації (дизайнер обкладинки — дизайнер).
    workspace: (r.specialization ? roleById(r.specialization)?.defaultWorkspace : undefined) ?? def?.defaultWorkspace ?? null,
    label: def?.label ?? null,
    combinable: def?.combinable ?? true,
    requiresSpecialization: def?.requiresSpecialization ?? false,
    specializations: def?.specializations ?? [],
    singleHolder: def?.singleHolder ?? false,
  };
}

/** Простори ролей: перша роль із простором — перша; власник без інших ролей — автор. */
export function workspacesOf(roles: Pick<MyRoleEntry, 'roleId' | 'workspace'>[], isOwner: boolean): string[] {
  const out: string[] = [];
  const real = roles.filter((r) => r.roleId !== 'project_owner');
  for (const r of real) if (r.workspace && !out.includes(r.workspace)) out.push(r.workspace);
  if (isOwner && !out.includes(DEFAULT_OWNER_WORKSPACE)) out.unshift(DEFAULT_OWNER_WORKSPACE);
  const owner = roles.find((r) => r.roleId === 'project_owner');
  if (owner?.workspace && !out.includes(owner.workspace)) out.push(owner.workspace);
  return out;
}

export async function myRoleView(repo: CoreRepository, ctx: MyRoleContext): Promise<MyRoleView> {
  const participant = await repo.getParticipant(ctx.projectId, ctx.userId);
  const rows = participant && participant.status === 'active' ? await repo.listParticipantRoles({ participantId: participant.id, status: 'active' }) : [];
  const roles = rows.map(entry);
  const pref = (await repo.getParticipantPreference(ctx.userId, ctx.projectId)) ?? (await repo.getParticipantPreference(ctx.userId, '*'));
  const workspaces = workspacesOf(roles, ctx.isOwner);
  const chosen = pref?.workspace && (workspaces.includes(pref.workspace) || ctx.isOwner || ctx.isAdmin) ? pref.workspace : null;
  const pending = await repo.listAccessRequests({ projectId: ctx.projectId, userId: ctx.userId, status: 'pending', limit: 10 });
  return {
    projectId: ctx.projectId,
    projectType: await projectTypeOf(repo, ctx.projectId),
    isOwner: ctx.isOwner,
    isAdmin: ctx.isAdmin,
    selfAssign: ctx.isOwner || ctx.isAdmin,
    participant: participant ? { id: participant.id, status: participant.status } : null,
    roles,
    workspaces,
    activeWorkspace: chosen ?? workspaces[0] ?? null,
    aiAssistance: pref?.aiAssistance ?? [],
    roleDetails: pref?.roleDetails ?? {},
    pending: { role: pending.find((r) => r.kind === 'role') ?? null, access: pending.find((r) => r.kind === 'access') ?? null },
  };
}

export interface AddRoleInput {
  roleId: string;
  specialization?: string | null;
  /** Лише для запиту: доступ разом із роллю (область опитувальника й можливості). */
  scope?: string | null;
  scopeRefs?: string[];
  capabilities?: string[];
  message?: string;
}

/** `assigned` — одразу (власник, адмін), `request` — null; `requested` — запит ролі. */
export interface RoleChangeResult {
  kind: 'assigned' | 'requested';
  request: AccessRequestRow | null;
  view: MyRoleView;
}

async function notifyManagers(repo: CoreRepository, projectId: string, message: string, payload: Record<string, unknown>): Promise<void> {
  if (!(await repo.getProject(projectId))) return;
  await repo.addNotification({ projectId, kind: 'access_request', message, payload }).catch(() => {});
}

/** Запит ролі: перевірка за реєстром — та сама, що в призначенні; доступ — лише якщо просили. */
async function requestRole(
  repo: CoreRepository,
  ctx: MyRoleContext,
  roles: { roleId: string; specialization: string | null }[],
  input: Pick<AddRoleInput, 'scope' | 'scopeRefs' | 'capabilities' | 'message'>,
  replaces: string[],
): Promise<AccessRequestRow> {
  const participant = await repo.getParticipant(ctx.projectId, ctx.userId);
  if (!participant || participant.status !== 'active') throw new CoreRuleError('bad_actor', 'Запросити роль може учасник проєкту — спершу визначте роль через «Визначення ролі»');
  let level: AccessLevel | null = null;
  let scope = 'none';
  let refs: string[] = [];
  const caps = (input.capabilities ?? []).filter((c) => typeof c === 'string').slice(0, 20);
  if (input.scope) {
    const want = requestedAccess(input.scope, input.scopeRefs ?? [], caps);
    if (!want) throw new CoreRuleError('bad_input', `Область «${input.scope}» ще не застосовується`);
    level = want.level as AccessLevel;
    scope = input.scope;
    refs = want.refs;
  }
  const request = await repo.addAccessRequest({
    kind: 'role',
    projectId: ctx.projectId,
    participantId: participant.id,
    userId: ctx.userId,
    roles,
    scope,
    scopeRefs: refs,
    capabilities: caps,
    level,
    message: String(input.message ?? '').slice(0, 2000),
    replaces,
  });
  await repo.addCollabEvent({ projectId: ctx.projectId, participantId: participant.id, action: 'access_requested', actor: actorOf(ctx.userId), details: { requestId: request.id, kind: 'role', roles, replaces, level, scope } });
  await notifyManagers(repo, ctx.projectId, `Запит ролі: ${ctx.userId} — ${roles.map((r) => (r.specialization ? `${r.roleId} (${r.specialization})` : r.roleId)).join(', ')}`, { requestId: request.id, userId: ctx.userId, kind: 'role' });
  await repo.addOnboardingEvent({ userId: ctx.userId, sessionId: null, projectId: ctx.projectId, event: 'role_selected', details: { requestId: request.id, roles: roles.map((r) => r.roleId), via: 'my_role' } }).catch(() => {});
  return request;
}

/** Додати роль: власник / адмін — одразу; решта — запит ролі. */
export async function addMyRole(repo: CoreRepository, ctx: MyRoleContext, input: AddRoleInput): Promise<RoleChangeResult> {
  if (typeof input.roleId !== 'string' || !input.roleId.trim()) throw new CoreRuleError('bad_input', 'Оберіть роль із реєстру');
  const projectType = await projectTypeOf(repo, ctx.projectId);
  const spec = input.specialization ? String(input.specialization) : null;
  const plan = await planRoleAssignment(repo, { projectId: ctx.projectId, userId: ctx.userId, roleId: input.roleId.trim(), specialization: spec, projectType });
  if (plan.same) throw new CoreRuleError('conflict', 'Ця роль у вас уже є');
  if (ctx.isOwner || ctx.isAdmin) {
    await assignRole(repo, { projectId: ctx.projectId, userId: ctx.userId, roleId: plan.role.id, specialization: plan.specialization, projectType, actor: actorOf(ctx.userId), source: ctx.isOwner ? 'owner' : 'admin' });
    return { kind: 'assigned', request: null, view: await myRoleView(repo, ctx) };
  }
  const request = await requestRole(repo, ctx, [{ roleId: plan.role.id, specialization: plan.specialization }], input, []);
  return { kind: 'requested', request, view: await myRoleView(repo, ctx) };
}

async function ownAssignment(repo: CoreRepository, ctx: MyRoleContext, assignmentId: string): Promise<ParticipantRoleRow> {
  const a = await repo.getParticipantRole(String(assignmentId));
  const p = await repo.getParticipant(ctx.projectId, ctx.userId);
  if (!a || !p || a.projectId !== ctx.projectId || a.participantId !== p.id) throw new CoreRuleError('not_found', 'Такої вашої ролі в проєкті немає');
  if (a.status !== 'active') throw new CoreRuleError('conflict', 'Роль уже знято');
  return a;
}

/** Змінити спеціалізацію (фрілансер): власник / адмін — одразу; решта — запит із заміною. */
export async function changeMySpecialization(repo: CoreRepository, ctx: MyRoleContext, input: { assignmentId: string; specialization: string; message?: string }): Promise<RoleChangeResult> {
  const a = await ownAssignment(repo, ctx, input.assignmentId);
  const def = roleById(a.roleId);
  if (!def?.requiresSpecialization) throw new CoreRuleError('bad_input', `Роль «${a.roleId}» не має спеціалізацій`);
  const projectType = await projectTypeOf(repo, ctx.projectId);
  const plan = await planRoleAssignment(repo, { projectId: ctx.projectId, userId: ctx.userId, roleId: a.roleId, specialization: input.specialization, projectType }, { excluding: [a.id] });
  if (plan.specialization === a.specialization) throw new CoreRuleError('conflict', 'Це та сама спеціалізація');
  if (ctx.isOwner || ctx.isAdmin) {
    const actor = actorOf(ctx.userId);
    await revokeRole(repo, { projectId: ctx.projectId, assignmentId: a.id, actor });
    await assignRole(repo, { projectId: ctx.projectId, userId: ctx.userId, roleId: a.roleId, specialization: plan.specialization, projectType, actor, source: ctx.isOwner ? 'owner' : 'admin' });
    return { kind: 'assigned', request: null, view: await myRoleView(repo, ctx) };
  }
  const request = await requestRole(repo, ctx, [{ roleId: a.roleId, specialization: plan.specialization }], { message: input.message }, [a.id]);
  return { kind: 'requested', request, view: await myRoleView(repo, ctx) };
}

/** Відмовитися від ролі: доступ лишається; останню роль — ні; власник проєкту лишається власником. */
export async function removeMyRole(repo: CoreRepository, ctx: MyRoleContext, input: { assignmentId: string }): Promise<MyRoleView> {
  const a = await ownAssignment(repo, ctx, input.assignmentId);
  if (a.roleId === 'project_owner') throw new CoreRuleError('conflict', 'Власник проєкту не відмовляється від ролі власника');
  const mine = await repo.listParticipantRoles({ participantId: a.participantId, status: 'active' });
  if (mine.length <= 1) throw new CoreRuleError('conflict', 'Це ваша остання роль — щоб піти, оберіть «Вийти з проєкту»');
  await revokeRole(repo, { projectId: ctx.projectId, assignmentId: a.id, actor: actorOf(ctx.userId) });
  if (!ctx.isOwner) {
    await notifyManagers(repo, ctx.projectId, `${ctx.userId} відмовився від ролі ${a.roleId}${a.specialization ? ` (${a.specialization})` : ''} — доступ без змін, перегляньте його в «Доступі»`, { userId: ctx.userId, roleId: a.roleId, kind: 'role_removed' });
  }
  await repo.addOnboardingEvent({ userId: ctx.userId, sessionId: null, projectId: ctx.projectId, event: 'role_changed', details: { removed: a.roleId, via: 'my_role' } }).catch(() => {});
  return myRoleView(repo, ctx);
}

/** Вийти з проєкту: ролі й наданий доступ відкликаються, участь — «вийшов»; нерозглянуті запити скасовуються. */
export async function leaveProject(repo: CoreRepository, ctx: MyRoleContext): Promise<{ left: true; revokedRoles: number; revokedGrants: number }> {
  if (ctx.isOwner) throw new CoreRuleError('conflict', 'Власник книги не виходить із власного проєкту');
  const p = await repo.getParticipant(ctx.projectId, ctx.userId);
  if (!p || p.status !== 'active') throw new CoreRuleError('not_found', 'Ви не учасник цього проєкту');
  const actor = actorOf(ctx.userId);
  const roles = await repo.listParticipantRoles({ participantId: p.id, status: 'active' });
  for (const r of roles) await repo.revokeParticipantRole(r.id, actor).then(() => repo.addCollabEvent({ projectId: ctx.projectId, participantId: p.id, action: 'role_revoked', actor, details: { roleId: r.roleId, specialization: r.specialization, leaving: true } }));
  const grants = await repo.listAccessGrants({ participantId: p.id, status: 'active' });
  // Звузити собі доступ може кожен (не потрібне право керування) — напряму, з тим самим записом у журналі.
  for (const g of grants) {
    await repo.revokeAccessGrant(g.id, actor);
    await repo.addCollabEvent({ projectId: ctx.projectId, participantId: p.id, action: 'access_revoked', actor, details: { grantId: g.id, userId: ctx.userId, level: g.level, scopeType: g.scopeType, scopeRef: g.scopeRef, leaving: true } });
  }
  for (const r of await repo.listAccessRequests({ projectId: ctx.projectId, userId: ctx.userId, status: 'pending' })) await repo.decideAccessRequest(r.id, { status: 'cancelled' });
  await repo.setParticipantStatus(p.id, 'left');
  await repo.addCollabEvent({ projectId: ctx.projectId, participantId: p.id, action: 'participant_status', actor, details: { status: 'left', revokedRoles: roles.length, revokedGrants: grants.length } });
  await notifyManagers(repo, ctx.projectId, `${ctx.userId} вийшов із проєкту`, { userId: ctx.userId, kind: 'participant_left' });
  return { left: true, revokedRoles: roles.length, revokedGrants: grants.length };
}

/** Обрати простір: із просторів своїх ролей (власник і адмін — будь-який із реєстру). */
export async function setMyWorkspace(repo: CoreRepository, ctx: MyRoleContext, workspace: string): Promise<MyRoleView> {
  const view = await myRoleView(repo, ctx);
  const known = activeCollabOntology().workspaces.map((w) => w.id);
  if (!known.includes(workspace)) throw new CoreRuleError('bad_input', `Простору «${workspace}» немає в реєстрі`);
  if (!view.workspaces.includes(workspace) && !ctx.isOwner && !ctx.isAdmin) throw new CoreRuleError('bad_input', 'Цей простір не належить жодній вашій ролі — спершу додайте роль');
  const cur = (await repo.getParticipantPreference(ctx.userId, ctx.projectId)) ?? (await repo.getParticipantPreference(ctx.userId, '*'));
  await repo.saveParticipantPreference({
    userId: ctx.userId,
    projectId: ctx.projectId,
    roles: view.roles.map((r) => ({ roleId: r.roleId, specialization: r.specialization })),
    workspace,
    aiProfile: `${workspace}_default`,
    aiAssistance: cur?.aiAssistance ?? [],
    roleDetails: cur?.roleDetails ?? {},
  });
  return myRoleView(repo, ctx);
}
