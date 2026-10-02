/**
 * Role Onboarding — опитувальник ролі перед входом у Студію (Т6.3 В1,
 * `PLAN_ROLE_ONBOARDING.md`; ТЗ Role Onboarding v3.1).
 *
 *   • Сесія зберігається після кожного кроку (§25); незавершена нічого не
 *     надає — ні ролей, ні доступу (№15).
 *   • Відповіді перевіряються за реєстром ролей (`roleOnboarding.ts`).
 *   • Завершення:
 *       – без проєкту (перший вхід) — налаштування учасника (`*`);
 *       – власний проєкт — учасник-власник із ролями (власника проєкту й
 *         обраними); якщо книги ще немає на сервері — налаштування проєкту,
 *         ролі додасть синхронізація (`ensureOwnerParticipant`);
 *       – запрошення (§24) — ролі, доступ дає саме запрошення (Т6.2);
 *       – чужий проєкт — учасник із ролями БЕЗ доступу й запит доступу
 *         (§20); вирішують власник, адмін або учасник із правом керування.
 *   • Роль ≠ дозвіл (§19), ШІ не розширює доступ (§11, №22): рішення щодо
 *     запиту — лише людина; схвалення = записи наданого доступу Т6.2.
 *   • Аналітика (§28) — `onboarding_events`, окремо від канону (№28); зміни
 *     ролей і доступу — `collab_events` (№27).
 */

import type { AccessLevel, AccessRequestRow, CoreActor, CoreRepository, OnboardingSessionRow, OnboardingSource, ParticipantSource } from '../types';
import { CoreRuleError } from '../rules';
import { activeCollabOntology } from '../../../src/utils/collabOntology';
import {
  AI_ASSIST_SETS,
  JOIN_INTENTS,
  aiGroupsFor,
  detailGroupsFor,
  primaryWorkspace,
  requestedAccess,
  suggestedCapabilities,
  validateAnswers,
  type OnboardingAnswers,
  type OnboardingRoleChoice,
} from '../../../src/utils/roleOnboarding';
import { assignRole, rolesOf } from './participants';
import { computeEffective, grantAccess, levelRank, type BookIndex } from './access';

export interface OnboardingDeps {
  /** Власник проєкту: книга (власник спільної роботи / серверної копії) чи курс (`course-<id>`). null — невідомо (ще не на сервері). */
  ownerOf(projectId: string): Promise<string | null>;
  /** Прийняте запрошення людини до проєкту (Т6.2): тоді доступ дає воно. */
  acceptedInvite?(projectId: string, userId: string): Promise<{ id: string; role: string } | null>;
  /** Тип проєкту за id (`course-…` — курс). */
  projectTypeOf?(projectId: string): string;
}

export interface Who {
  userId: string;
  isAdmin: boolean;
}

const actorOf = (userId: string): CoreActor => `user:${userId}`;
export const COURSE_PREFIX = 'course-';
export const projectTypeById = (projectId: string | null | undefined): string | undefined => (projectId ? (projectId.startsWith(COURSE_PREFIX) ? 'course' : 'book') : undefined);

function asAnswers(v: unknown): OnboardingAnswers {
  return v && typeof v === 'object' && !Array.isArray(v) ? (JSON.parse(JSON.stringify(v)) as OnboardingAnswers) : {};
}

function cleanRoles(v: unknown): OnboardingRoleChoice[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new CoreRuleError('bad_input', 'Ролі — масив');
  return v.slice(0, 20).map((x: any) => ({ roleId: String(x?.roleId ?? '').trim(), specialization: x?.specialization ? String(x.specialization).trim() : null }));
}
const strList = (v: unknown, max = 100): string[] | undefined => (v === undefined ? undefined : (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max));

/** Лише відомі поля відповідей — решта відкидається. */
export function sanitizeAnswers(raw: unknown): OnboardingAnswers {
  const a = asAnswers(raw);
  const out: OnboardingAnswers = {};
  if (a.projectType !== undefined) out.projectType = String(a.projectType);
  if (a.entryIntent !== undefined) out.entryIntent = String(a.entryIntent);
  if (a.roles !== undefined) out.roles = cleanRoles(a.roles);
  if (a.otherRole !== undefined) out.otherRole = String(a.otherRole).slice(0, 200);
  if (a.roleDetails !== undefined) {
    out.roleDetails = {};
    for (const [k, v] of Object.entries(a.roleDetails ?? {}).slice(0, 10)) out.roleDetails[String(k)] = strList(v, 20) ?? [];
  }
  if (a.scope !== undefined) out.scope = String(a.scope);
  if (a.scopeRefs !== undefined) out.scopeRefs = strList(a.scopeRefs);
  if (a.capabilities !== undefined) out.capabilities = strList(a.capabilities, 20);
  if (a.aiAssistance !== undefined) out.aiAssistance = strList(a.aiAssistance, 20);
  if (a.message !== undefined) out.message = String(a.message).slice(0, 2000);
  return out;
}

async function event(repo: CoreRepository, s: Pick<OnboardingSessionRow, 'id' | 'userId' | 'projectId'>, name: Parameters<CoreRepository['addOnboardingEvent']>[0]['event'], details: Record<string, unknown> = {}) {
  await repo.addOnboardingEvent({ userId: s.userId, sessionId: s.id, projectId: s.projectId, event: name, details }).catch(() => {});
}

async function requireOwnSession(repo: CoreRepository, sessionId: string, userId: string): Promise<OnboardingSessionRow> {
  const s = await repo.getOnboardingSession(sessionId);
  if (!s || s.userId !== userId) throw new CoreRuleError('not_found', 'Опитувальник не знайдено');
  return s;
}

/** Чи це робота в чужому проєкті без запрошення (потрібні область, можливості й запит доступу). */
export async function joiningFor(deps: OnboardingDeps, who: Who, projectId: string | null): Promise<boolean> {
  if (!projectId || who.isAdmin) return false;
  const owner = await deps.ownerOf(projectId);
  if (owner === null || owner === who.userId) return false;
  return !(deps.acceptedInvite && (await deps.acceptedInvite(projectId, who.userId)));
}

// ---------------------------------------------------------------------------
// Сесія: старт, крок, скасування
// ---------------------------------------------------------------------------

export interface StartInput {
  userId: string;
  source: OnboardingSource;
  projectId?: string | null;
  projectType?: string | null;
  orderId?: string | null;
  sourceRef?: string | null;
  /** Уже відомо достовірно (запрошення, замовлення): §24 — не питати вдруге. */
  prefill?: OnboardingAnswers;
}

/**
 * Почати або продовжити (§25): незавершена чернетка для цього проєкту
 * повертається як є. Для запрошення з роллю — відповіді заповнені, одразу
 * підтвердження (§24).
 */
export async function startOnboarding(repo: CoreRepository, deps: OnboardingDeps, who: Who, input: StartInput): Promise<{ session: OnboardingSessionRow; resumed: boolean }> {
  const projectId = input.projectId ?? null;
  const draft = await repo.findOnboardingDraft(who.userId, projectId);
  if (draft) return { session: draft, resumed: true };
  const projectType = input.projectType ?? deps.projectTypeOf?.(projectId ?? '') ?? projectTypeById(projectId) ?? null;
  const answers: OnboardingAnswers = { ...(projectType ? { projectType } : {}), ...sanitizeAnswers(input.prefill ?? {}) };
  let currentStep = 1;
  let source = input.source;
  let sourceRef = input.sourceRef ?? null;
  if (projectId && deps.acceptedInvite) {
    const inv = await deps.acceptedInvite(projectId, who.userId);
    if (inv) {
      source = 'invitation';
      sourceRef = inv.id;
      const reg = activeCollabOntology();
      answers.entryIntent = 'accept_invitation';
      answers.roles = answers.roles?.length ? answers.roles : [{ roleId: inv.role, specialization: null }];
      answers.scope = answers.scope ?? 'whole_project';
      answers.capabilities = answers.capabilities ?? suggestedCapabilities(reg, answers.roles);
      if (!validateAnswers(reg, answers, { joining: false, projectType: projectType ?? undefined }).length) currentStep = 8;
    }
  }
  if (input.orderId) answers.entryIntent = answers.entryIntent ?? 'fulfill_freelance_order';
  const session = await repo.addOnboardingSession({
    userId: who.userId,
    projectId,
    projectType,
    entryIntent: answers.entryIntent ?? null,
    source,
    sourceOrderId: input.orderId ?? null,
    sourceRef,
    currentStep,
    answers: answers as Record<string, unknown>,
  });
  await event(repo, session, 'onboarding_started', { source, orderId: input.orderId ?? null, skipped: currentStep === 8 });
  return { session, resumed: false };
}

/** Зберегти відповіді кроку (§25) — перевіряються кроки до цього включно. */
export async function saveOnboardingStep(
  repo: CoreRepository,
  deps: OnboardingDeps,
  who: Who,
  input: { sessionId: string; step: number; answers: unknown; expectedRevision?: number },
): Promise<{ session: OnboardingSessionRow; issues: ReturnType<typeof validateAnswers> }> {
  const s = await requireOwnSession(repo, input.sessionId, who.userId);
  const step = Math.floor(Number(input.step));
  if (!(step >= 1 && step <= 8)) throw new CoreRuleError('bad_input', 'Крок — від 1 до 8');
  const before = asAnswers(s.answers);
  const merged: OnboardingAnswers = { ...before, ...sanitizeAnswers(input.answers) };
  const reg = activeCollabOntology();
  const joining = await joiningFor(deps, who, s.projectId);
  const issues = validateAnswers(reg, merged, { upTo: step, joining, projectType: s.projectType ?? undefined });
  const blocking = issues.filter((i) => i.step <= step);
  const next = blocking.length ? Math.min(...blocking.map((i) => i.step)) : Math.min(8, Math.max(s.currentStep, step + 1));
  const session = await repo.updateOnboardingSession(s.id, { answers: merged as Record<string, unknown>, currentStep: next, projectType: merged.projectType ?? s.projectType, entryIntent: merged.entryIntent ?? s.entryIntent }, input.expectedRevision);
  if (!blocking.length) await event(repo, session, 'onboarding_step_completed', { step });
  const rolesBefore = JSON.stringify(before.roles ?? []);
  const rolesNow = JSON.stringify(merged.roles ?? []);
  if (rolesNow !== rolesBefore && (merged.roles ?? []).length) {
    await event(repo, session, before.roles?.length ? 'role_changed' : 'role_selected', { roles: merged.roles });
  }
  return { session, issues: blocking };
}

export async function cancelOnboarding(repo: CoreRepository, who: Who, sessionId: string): Promise<OnboardingSessionRow> {
  const s = await requireOwnSession(repo, sessionId, who.userId);
  const out = await repo.updateOnboardingSession(s.id, { status: 'cancelled' });
  await event(repo, out, 'onboarding_abandoned', { step: s.currentStep });
  return out;
}

// ---------------------------------------------------------------------------
// Завершення
// ---------------------------------------------------------------------------

export type OnboardingOutcome =
  | { kind: 'preferences'; next: string | null }
  | { kind: 'own'; roles: string[]; deferred: boolean }
  | { kind: 'invitation'; roles: string[] }
  | { kind: 'access_request'; roles: string[]; request: AccessRequestRow }
  | { kind: 'has_access'; roles: string[] };

async function assignAll(repo: CoreRepository, projectId: string, userId: string, roles: OnboardingRoleChoice[], projectType: string, actor: CoreActor, source: ParticipantSource, sourceRef: string | null): Promise<string[]> {
  for (const r of roles) {
    await assignRole(repo, { projectId, userId, roleId: r.roleId, specialization: r.specialization ?? null, projectType, actor, source, sourceRef });
  }
  return rolesOf(repo, projectId, userId);
}

/**
 * Завершити опитувальник: перевірити все за реєстром і застосувати.
 * Незавершене не дає нічого; чужий проєкт — лише запит доступу.
 */
export async function completeOnboarding(repo: CoreRepository, deps: OnboardingDeps, who: Who, input: { sessionId: string; expectedRevision?: number }): Promise<{ session: OnboardingSessionRow; outcome: OnboardingOutcome }> {
  const s = await requireOwnSession(repo, input.sessionId, who.userId);
  if (s.status !== 'draft') throw new CoreRuleError('conflict', 'Опитувальник уже завершено чи скасовано');
  if (input.expectedRevision !== undefined && s.revision !== input.expectedRevision) throw new CoreRuleError('conflict', 'Опитувальник уже змінено — перечитайте його');
  const reg = activeCollabOntology();
  const a = asAnswers(s.answers);
  const projectType = a.projectType ?? s.projectType ?? 'book';
  const invite = s.projectId && deps.acceptedInvite ? await deps.acceptedInvite(s.projectId, who.userId) : null;
  const owner = s.projectId ? await deps.ownerOf(s.projectId) : null;
  const joining = !!s.projectId && !who.isAdmin && !invite && owner !== null && owner !== who.userId;
  const issues = validateAnswers(reg, a, { joining, projectType });
  if (issues.length) {
    const e = new CoreRuleError('bad_input', `Опитувальник не завершено: ${issues.map((i) => i.message.uk).join('; ')}`);
    (e as any).issues = issues;
    throw e;
  }
  const roles = a.roles ?? [];
  const actor = actorOf(who.userId);
  const { workspace, aiProfile } = primaryWorkspace(reg, roles);
  const pref = {
    userId: who.userId,
    roles: roles.map((r) => ({ roleId: r.roleId, specialization: r.specialization ?? null })),
    workspace,
    aiProfile,
    aiAssistance: (a.aiAssistance ?? []).filter((x) => aiGroupsFor(reg, roles).some((g) => AI_ASSIST_SETS[g]?.options.some((o) => o.id === x))),
    roleDetails: Object.fromEntries(Object.entries(a.roleDetails ?? {}).filter(([g]) => detailGroupsFor(reg, roles).includes(g))),
  };
  let outcome: OnboardingOutcome;

  if (!s.projectId) {
    await repo.saveParticipantPreference({ ...pref, projectId: '*' });
    outcome = { kind: 'preferences', next: a.entryIntent ?? null };
  } else if (invite) {
    const mine = await assignAll(repo, s.projectId, who.userId, roles, projectType, actor, 'invitation', invite.id);
    await repo.saveParticipantPreference({ ...pref, projectId: s.projectId });
    outcome = { kind: 'invitation', roles: mine };
  } else if (!joining) {
    // Власний проєкт (чи адмін): власник проєкту + обрані ролі.
    await repo.saveParticipantPreference({ ...pref, projectId: s.projectId });
    if (owner === who.userId || who.isAdmin) {
      const own = owner === who.userId ? [{ roleId: 'project_owner', specialization: null }, ...roles.filter((r) => r.roleId !== 'project_owner')] : roles;
      const mine = await assignAll(repo, s.projectId, who.userId, own, projectType, actor, owner === who.userId ? 'owner' : 'admin', s.id);
      outcome = { kind: 'own', roles: mine, deferred: false };
    } else {
      // Книги ще немає на сервері: ролі додасть синхронізація з налаштувань (ensureOwnerParticipant).
      outcome = { kind: 'own', roles: roles.map((r) => r.roleId), deferred: true };
    }
  } else {
    const source: ParticipantSource = s.sourceOrderId ? 'freelance_order' : 'access_request';
    const mine = await assignAll(repo, s.projectId, who.userId, roles, projectType, actor, source, s.sourceOrderId ?? s.id);
    await repo.saveParticipantPreference({ ...pref, projectId: s.projectId });
    const participant = (await repo.getParticipant(s.projectId, who.userId))!;
    const want = requestedAccess(a.scope!, a.scopeRefs ?? [], a.capabilities ?? [])!;
    const eff = computeEffective(s.projectId, who.userId, await repo.listAccessGrants({ participantId: participant.id, status: 'active' }), { full: false });
    if (want.scopeType === 'book' && levelRank(eff.book) >= levelRank(want.level as AccessLevel) && !want.mediaWork) {
      outcome = { kind: 'has_access', roles: mine };
    } else {
      const request = await repo.addAccessRequest({
        projectId: s.projectId,
        participantId: participant.id,
        userId: who.userId,
        sessionId: s.id,
        roles: roles.map((r) => ({ roleId: r.roleId, specialization: r.specialization ?? null })),
        scope: a.scope!,
        scopeRefs: want.refs,
        capabilities: a.capabilities ?? [],
        level: want.level,
        message: a.message ?? '',
        orderId: s.sourceOrderId,
      });
      await repo.addCollabEvent({ projectId: s.projectId, participantId: participant.id, action: 'access_requested', actor, details: { requestId: request.id, scope: request.scope, scopeRefs: request.scopeRefs, level: request.level, orderId: request.orderId } });
      if (await repo.getProject(s.projectId)) {
        await repo
          .addNotification({ projectId: s.projectId, kind: 'access_request', message: `Запит доступу: ${who.userId} — ${roles.map((r) => r.roleId).join(', ')}`, payload: { requestId: request.id, userId: who.userId } })
          .catch(() => {});
      }
      await event(repo, s, 'access_requested', { requestId: request.id, level: request.level, scope: request.scope });
      outcome = { kind: 'access_request', roles: mine, request };
    }
  }

  const session = await repo.updateOnboardingSession(s.id, { status: 'completed', currentStep: 8, result: { ...outcome, request: undefined, requestId: outcome.kind === 'access_request' ? outcome.request.id : undefined } as Record<string, unknown> });
  await event(repo, session, 'onboarding_completed', { kind: outcome.kind, roles: roles.map((r) => r.roleId) });
  return { session, outcome };
}

// ---------------------------------------------------------------------------
// Запити доступу: рішення власника (§20)
// ---------------------------------------------------------------------------

export interface DecideInput {
  projectId: string;
  requestId: string;
  decider: { userId: string; isOwner: boolean; isAdmin: boolean };
  action: 'approve' | 'modify' | 'reject';
  /** Для «змінити»: інший рівень, область чи цілі. */
  level?: AccessLevel;
  scopeType?: 'book' | 'chapter' | 'scene' | 'character' | 'location' | 'media_library';
  scopeRefs?: string[];
  mediaWork?: boolean;
  validUntil?: string | null;
  reason?: string;
  bookIndex?: BookIndex | null;
}

/**
 * Схвалити / змінити / відхилити запит. Схвалення — записи наданого доступу
 * Т6.2 від імені того, хто вирішує (`grantAccess` перевіряє його право:
 * власник, адмін або керування книгою). Керування запитом не видається.
 */
export async function decideAccessRequest(repo: CoreRepository, input: DecideInput): Promise<AccessRequestRow> {
  const r = await repo.getAccessRequest(input.requestId);
  if (!r || r.projectId !== input.projectId) throw new CoreRuleError('not_found', 'Запит доступу не знайдено');
  if (r.status !== 'pending') throw new CoreRuleError('conflict', 'Запит уже розглянуто');
  const actor = actorOf(input.decider.userId);
  // Право вирішувати — те саме, що й надавати доступ: перевіряємо до будь-якого запису.
  await assertCanDecide(repo, input);
  if (input.action === 'reject') {
    const out = await repo.decideAccessRequest(r.id, { status: 'rejected', decidedBy: actor, reason: (input.reason ?? '').slice(0, 2000), decision: null });
    await repo.addCollabEvent({ projectId: r.projectId, participantId: r.participantId, action: 'access_request_decided', actor, details: { requestId: r.id, status: 'rejected', reason: out.reason } });
    await repo.addOnboardingEvent({ userId: r.userId, sessionId: r.sessionId, projectId: r.projectId, event: 'access_rejected', details: { requestId: r.id, by: input.decider.userId } }).catch(() => {});
    return out;
  }
  const modify = input.action === 'modify';
  const fromRequest = requestedAccessFromRow(r);
  const level = (modify && input.level) || fromRequest.level;
  const scopeType = (modify && input.scopeType) || fromRequest.scopeType;
  const refs = modify && input.scopeRefs ? input.scopeRefs : fromRequest.refs;
  const mediaWork = modify && input.mediaWork !== undefined ? input.mediaWork : fromRequest.mediaWork;
  if (level === 'manage') throw new CoreRuleError('bad_input', 'Керування через запит не надається — надайте його окремо в панелі «Доступ»');
  if (level === 'work' && scopeType !== 'media_library') throw new CoreRuleError('bad_input', 'Робочий доступ (work) — лише до медіатеки');
  const needRefs = scopeType === 'chapter' || scopeType === 'scene' || scopeType === 'character' || scopeType === 'location';
  if (needRefs && !refs.length) throw new CoreRuleError('bad_input', 'Оберіть, що саме відкрити');
  const granter = { userId: input.decider.userId, isOwner: input.decider.isOwner, isAdmin: input.decider.isAdmin };
  const grants: string[] = [];
  for (const ref of needRefs ? refs : [null]) {
    const g = await grantAccess(repo, { projectId: r.projectId, granter, userId: r.userId, level, scopeType, scopeRef: ref, validUntil: input.validUntil ?? null, bookIndex: input.bookIndex ?? null });
    grants.push(g.id);
  }
  if (mediaWork && scopeType !== 'media_library') {
    const g = await grantAccess(repo, { projectId: r.projectId, granter, userId: r.userId, level: 'work', scopeType: 'media_library', validUntil: input.validUntil ?? null });
    grants.push(g.id);
  }
  const decision = { level, scopeType, scopeRefs: needRefs ? refs : [], mediaWork, validUntil: input.validUntil ?? null };
  const out = await repo.decideAccessRequest(r.id, { status: modify ? 'modified' : 'approved', decidedBy: actor, decision, grantIds: grants, reason: (input.reason ?? '').slice(0, 2000) });
  await repo.addCollabEvent({ projectId: r.projectId, participantId: r.participantId, action: 'access_request_decided', actor, details: { requestId: r.id, status: out.status, ...decision, grantIds: grants } });
  await repo.addOnboardingEvent({ userId: r.userId, sessionId: r.sessionId, projectId: r.projectId, event: 'access_approved', details: { requestId: r.id, by: input.decider.userId, modified: modify } }).catch(() => {});
  return out;
}

function requestedAccessFromRow(r: AccessRequestRow): { level: AccessLevel; scopeType: NonNullable<DecideInput['scopeType']>; refs: string[]; mediaWork: boolean } {
  const want = requestedAccess(r.scope, r.scopeRefs, r.capabilities);
  if (!want) throw new CoreRuleError('conflict', `Область «${r.scope}» ще не застосовується — змініть її`);
  return { level: r.level, scopeType: want.scopeType, refs: r.scopeRefs, mediaWork: want.mediaWork };
}

async function assertCanDecide(repo: CoreRepository, input: DecideInput): Promise<void> {
  if (input.decider.isOwner || input.decider.isAdmin) return;
  const p = await repo.getParticipant(input.projectId, input.decider.userId);
  if (p && p.status === 'active') {
    const eff = computeEffective(input.projectId, input.decider.userId, await repo.listAccessGrants({ participantId: p.id, status: 'active' }), { full: false });
    if (eff.book === 'manage') return;
  }
  throw new CoreRuleError('bad_actor', 'Вирішувати запити може власник книги, адміністратор або учасник із правом керування');
}

/** Людина сама відкликає свій нерозглянутий запит. */
export async function cancelAccessRequest(repo: CoreRepository, who: Who, projectId: string, requestId: string): Promise<AccessRequestRow> {
  const r = await repo.getAccessRequest(requestId);
  if (!r || r.projectId !== projectId || r.userId !== who.userId) throw new CoreRuleError('not_found', 'Запит доступу не знайдено');
  return repo.decideAccessRequest(r.id, { status: 'cancelled' });
}

export { assertCanDecide };

// ---------------------------------------------------------------------------
// Шлюз входу (§4)
// ---------------------------------------------------------------------------

export interface GateResult {
  required: boolean;
  reason: 'first_login' | 'resume' | 'no_role' | 'pending_request' | null;
  session: OnboardingSessionRow | null;
  request: AccessRequestRow | null;
  roles: string[];
}

/**
 * Чи потрібен майстер: незавершена чернетка (продовжити), перший вхід
 * людини (жодного завершеного чи скасованого опитувальника), роль у проєкті
 * невідома. Нерозглянутий запит — окремо: людина чекає рішення. `enabled`
 * = false — автоматичний показ вимкнено (ROLE_ONBOARDING=off).
 */
export async function onboardingGate(repo: CoreRepository, deps: OnboardingDeps, who: Who, input: { projectId?: string | null; enabled: boolean }): Promise<GateResult> {
  const projectId = input.projectId ?? null;
  const out: GateResult = { required: false, reason: null, session: null, request: null, roles: [] };
  out.session = await repo.findOnboardingDraft(who.userId, projectId);
  if (projectId) {
    out.roles = await rolesOf(repo, projectId, who.userId);
    out.request = (await repo.listAccessRequests({ projectId, userId: who.userId, status: 'pending', limit: 1 }))[0] ?? null;
  }
  if (!input.enabled) return out;
  if (out.session) return { ...out, required: true, reason: 'resume' };
  if (!projectId) {
    const any = await repo.listOnboardingSessions({ userId: who.userId, limit: 50 });
    const done = any.some((x) => x.status !== 'draft') || (await repo.getParticipantPreference(who.userId, '*')) !== null;
    if (!done) return { ...out, required: true, reason: 'first_login' };
    return out;
  }
  if (out.request) return { ...out, reason: 'pending_request' };
  if (!out.roles.length) {
    const owner = await deps.ownerOf(projectId);
    if (owner === who.userId || who.isAdmin) return out;
    return { ...out, required: true, reason: 'no_role' };
  }
  return out;
}

/** Ролі з налаштувань проєкту власника — для синхронізації, коли книга з'явилась у ядрі. */
export async function ownerRolesFromPreference(repo: CoreRepository, projectId: string, userId: string): Promise<OnboardingRoleChoice[]> {
  const pref = await repo.getParticipantPreference(userId, projectId);
  return (pref?.roles ?? []).filter((r) => r.roleId !== 'project_owner');
}

export { JOIN_INTENTS };
