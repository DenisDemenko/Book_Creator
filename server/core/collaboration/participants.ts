/**
 * Участь у проєкті й ролі учасника (Т6.1 В2, `PLAN_COLLABORATION.md`; ТЗ
 * Graph Studio §46: роль належить участі в конкретному проєкті; ТЗ Role
 * Onboarding §17–19: ProjectParticipant, ParticipantRole; роль ≠ дозвіл).
 *
 * Кожне призначення перевіряється АКТИВНОЮ версією реєстру ролей (онтологія
 * `fusion-collab`):
 *   • роль існує й не застаріла (старі значення — `reader`, `coauthor`,
 *     `owner` — приймаються й зводяться до id реєстру);
 *   • тип проєкту дозволений для ролі;
 *   • фрілансер — лише зі спеціалізацією з дозволених (Onboarding №5);
 *     спеціалізація без потреби — відмова;
 *   • роль з одним власником (власник проєкту) — у одного учасника;
 *   • «не поєднувана» роль — без інших ролей того самого учасника;
 *   • призначає людина чи система, не AI (Onboarding №22, v3 №44);
 *   • останнього власника проєкту не відкликають.
 * Кожна зміна — подія в `collab_events` (Onboarding №27).
 *
 * Доступ до книги це не змінює (Т6.2): роль пропонує, а не дозволяє.
 */

import type { CoreActor, CoreRepository, MemberRole, ParticipantRoleRow, ParticipantRow, ParticipantSource } from '../types';
import { CoreRuleError } from '../rules';
import { activeCollabOntology, canonicalRoleId, roleById, type RoleDefinition } from '../../../src/utils/collabOntology';
import { activeCollabRegistryVersion } from '../ontology/lifecycle';

export interface AssignRoleInput {
  projectId: string;
  userId: string;
  /** id реєстру або старе значення (`reader`, `coauthor`, `owner`). */
  roleId: string;
  specialization?: string | null;
  /** Тип проєкту (`book`, `course`…); типово — книга. */
  projectType?: string;
  actor: CoreActor;
  source: ParticipantSource;
  sourceRef?: string | null;
}

export interface ParticipantView {
  participant: ParticipantRow;
  roles: (ParticipantRoleRow & { label: RoleDefinition['label'] | null; category: string | null; deprecated: boolean })[];
}

function resolveRole(roleId: string): RoleDefinition {
  const role = roleById(roleId);
  if (!role) throw new CoreRuleError('bad_input', `Ролі «${roleId}» немає в реєстрі ролей`);
  return role;
}

/** Призначити роль (учасника створює, якщо його ще немає). Те саме призначення вдруге — повертає наявне. */
export async function assignRole(repo: CoreRepository, input: AssignRoleInput): Promise<{ participant: ParticipantRow; role: ParticipantRoleRow; created: boolean }> {
  if (typeof input.actor === 'string' && input.actor.startsWith('ai:')) throw new CoreRuleError('bad_actor', 'Роль призначає людина чи система, не AI');
  const role = resolveRole(input.roleId);
  if (role.status !== 'active') throw new CoreRuleError('conflict', `Роль «${role.id}» застаріла — нових призначень немає`);
  const projectType = input.projectType ?? 'book';
  if (!activeCollabOntology().projectTypes.some((p) => p.id === projectType)) throw new CoreRuleError('bad_input', `Типу проєкту «${projectType}» немає в реєстрі`);
  if (!role.projectTypes.includes(projectType)) throw new CoreRuleError('bad_input', `Роль «${role.id}» не для проєкту типу «${projectType}»`);

  let specialization: string | null = null;
  if (role.requiresSpecialization) {
    if (!input.specialization) throw new CoreRuleError('bad_input', `Роль «${role.id}» вимагає спеціалізації (${role.specializations.slice(0, 6).join(', ')}…)`);
    specialization = canonicalRoleId(input.specialization);
    if (!specialization || !role.specializations.includes(specialization)) throw new CoreRuleError('bad_input', `Спеціалізація «${input.specialization}» не дозволена для ролі «${role.id}»`);
    if (roleById(specialization)?.status !== 'active') throw new CoreRuleError('conflict', `Спеціалізація «${specialization}» застаріла`);
  } else if (input.specialization) {
    throw new CoreRuleError('bad_input', `Роль «${role.id}» не має спеціалізацій`);
  }

  // Усі перевірки — ДО створення учасника: невдале призначення не лишає порожньої участі.
  const existing = await repo.getParticipant(input.projectId, input.userId);
  if (existing && existing.status !== 'active') throw new CoreRuleError('conflict', `Учасник «${input.userId}» — «${existing.status}», ролі не призначаються`);
  const mine = existing ? await repo.listParticipantRoles({ participantId: existing.id, status: 'active' }) : [];
  const same = mine.find((r) => r.roleId === role.id && r.specialization === specialization);
  if (existing && same) return { participant: existing, role: same, created: false };
  if (!role.combinable && mine.length) throw new CoreRuleError('conflict', `Роль «${role.id}» не поєднується з іншими ролями учасника`);
  const blocker = mine.map((r) => roleById(r.roleId)).find((r) => r && !r.combinable);
  if (blocker) throw new CoreRuleError('conflict', `У учасника вже є роль «${blocker.id}», яка не поєднується з іншими`);
  if (role.singleHolder) {
    const holders = await repo.listParticipantRoles({ projectId: input.projectId, roleId: role.id, status: 'active' });
    if (holders.some((h) => h.participantId !== existing?.id)) throw new CoreRuleError('conflict', `Роль «${role.id}» у проєкті вже має інший учасник — вона одна на проєкт`);
  }

  const { participant, created } = await repo.upsertParticipant({ projectId: input.projectId, userId: input.userId, source: input.source, sourceRef: input.sourceRef ?? null, createdBy: input.actor });
  if (created) await repo.addCollabEvent({ projectId: input.projectId, participantId: participant.id, action: 'participant_added', actor: input.actor, details: { userId: input.userId, source: input.source, sourceRef: input.sourceRef ?? null } });

  const row = await repo.addParticipantRole({ participantId: participant.id, projectId: input.projectId, roleId: role.id, specialization, assignedBy: input.actor, registryVersion: activeCollabRegistryVersion() });
  await repo.addCollabEvent({ projectId: input.projectId, participantId: participant.id, action: 'role_assigned', actor: input.actor, details: { roleId: role.id, specialization, requested: input.roleId, registryVersion: row.registryVersion } });
  return { participant, role: row, created: true };
}

/** Відкликати роль учасника. Останнього власника проєкту — ні. */
export async function revokeRole(repo: CoreRepository, input: { projectId: string; assignmentId: string; actor: CoreActor }): Promise<ParticipantRoleRow> {
  if (typeof input.actor === 'string' && input.actor.startsWith('ai:')) throw new CoreRuleError('bad_actor', 'Роль відкликає людина чи система, не AI');
  const a = await repo.getParticipantRole(input.assignmentId);
  if (!a || a.projectId !== input.projectId) throw new CoreRuleError('not_found', 'Призначення ролі не знайдено');
  if (a.status !== 'active') throw new CoreRuleError('conflict', 'Роль уже відкликано');
  if (roleById(a.roleId)?.singleHolder) {
    const holders = await repo.listParticipantRoles({ projectId: input.projectId, roleId: a.roleId, status: 'active' });
    if (holders.length <= 1) throw new CoreRuleError('conflict', `Не можна відкликати останнього «${a.roleId}» — спершу призначте іншого`);
  }
  const out = await repo.revokeParticipantRole(a.id, input.actor);
  await repo.addCollabEvent({ projectId: input.projectId, participantId: a.participantId, action: 'role_revoked', actor: input.actor, details: { roleId: a.roleId, specialization: a.specialization } });
  return out;
}

/** Учасники проєкту з активними ролями й мітками з реєстру. */
export async function participantsOf(repo: CoreRepository, projectId: string, opts: { includeRevoked?: boolean } = {}): Promise<ParticipantView[]> {
  const people = await repo.listParticipants(projectId);
  const roles = await repo.listParticipantRoles({ projectId, ...(opts.includeRevoked ? {} : { status: 'active' as const }) });
  return people.map((participant) => ({
    participant,
    roles: roles
      .filter((r) => r.participantId === participant.id)
      .map((r) => {
        const def = roleById(r.roleId);
        return { ...r, label: def?.label ?? null, category: def?.category ?? null, deprecated: def?.status === 'deprecated' };
      }),
  }));
}

/** Ролі людини в проєкті (id реєстру) — для «Моя роль у проєкті» (Т6.4) і запрошень. */
export async function rolesOf(repo: CoreRepository, projectId: string, userId: string): Promise<string[]> {
  const p = await repo.getParticipant(projectId, userId);
  if (!p) return [];
  return (await repo.listParticipantRoles({ participantId: p.id, status: 'active' })).map((r) => r.roleId);
}

const LEGACY_SOURCE: ParticipantSource = 'legacy_member';

/**
 * Перенести рядки старої `project_members` в учасників (рішення власника §2
 * п.1): `owner` → власник проєкту, `coauthor` → співавтор, `reader` →
 * бета-рідер, решта — ті самі id. Ідемпотентно.
 */
export async function importLegacyMembers(repo: CoreRepository, projectId: string, actor: CoreActor = 'system:collab-import'): Promise<{ imported: number; skipped: { userId: string; role: MemberRole; reason: string }[] }> {
  const members = await repo.listMembers(projectId);
  let imported = 0;
  const skipped: { userId: string; role: MemberRole; reason: string }[] = [];
  for (const m of members) {
    try {
      const r = await assignRole(repo, { projectId, userId: m.userId, roleId: m.role, actor, source: LEGACY_SOURCE, sourceRef: `project_members:${m.role}` });
      if (r.created) imported++;
    } catch (err) {
      skipped.push({ userId: m.userId, role: m.role, reason: (err as Error).message });
    }
  }
  if (imported) await repo.addCollabEvent({ projectId, action: 'legacy_import', actor, details: { imported, skipped: skipped.length } });
  return { imported, skipped };
}

/**
 * Власник книги — учасник проєкту з ролями «власник проєкту» й «автор»
 * (ТЗ v3 §46: «Denis → AUTHOR + OWNER»). Викликається синхронізацією книги
 * в ядро; повторно нічого не робить. Збій тут синхронізацію не зупиняє.
 */
export async function ensureOwnerParticipant(repo: CoreRepository, projectId: string, userId: string, actor: CoreActor = 'system:collab-sync'): Promise<boolean> {
  const have = await rolesOf(repo, projectId, userId);
  let wrote = false;
  for (const roleId of ['project_owner', 'author']) {
    if (have.includes(roleId)) continue;
    const r = await assignRole(repo, { projectId, userId, roleId, actor, source: 'owner' });
    wrote = wrote || r.created;
  }
  return wrote;
}
