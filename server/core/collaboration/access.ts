/**
 * Наданий доступ і фактичні права (Т6.2 В1, `PLAN_ACCESS.md`; ТЗ Graph
 * Studio §49; Role Onboarding §19: учасник + проєкт + роль + область +
 * наданий доступ = фактичні права).
 *
 * Роль нічого не дозволяє — дозволяє лише запис `access_grants` (або
 * власність книги / адміністратор платформи). Фактичні права — об'єднання
 * дійсних (не відкликаних, у строку) записів учасника:
 *   • рівень на книгу покриває всі розділи, сцени й сутності;
 *   • доступ до розділу — усі його сцени;
 *   • ОБМЕЖЕНИЙ доступ — коли на всю книгу немає навіть перегляду: тоді
 *     людина бачить лише дозволене, а все інше закрите (сервер).
 * Прийняте запрошення без жодного запису доступу один раз стає доступом на
 * книгу (рішення власника §2 п.1); відкликаний доступ не відновлюється.
 */

import type { AccessGrantRow, AccessLevel, AccessScope, CoreActor, CoreRepository, ParticipantRow } from '../types';
import { ACCESS_LEVELS } from '../types';
import { CoreRuleError } from '../rules';
import { assignRole } from './participants';
import { studioRoleFor } from '../../../src/utils/collabOntology';

/** Ранг рівня доступу до змісту. `work` — окремий, лише для медіатеки (= перегляд + власні завантаження). */
const RANK: Record<AccessLevel | 'none', number> = { none: 0, view: 1, comment: 2, review: 3, edit: 4, create: 5, approve: 6, manage: 7, work: 1 };
export const MIGRATION_ACTOR = 'system:access-migration';

export function levelRank(l: AccessLevel | 'none' | undefined | null): number {
  return RANK[l ?? 'none'] ?? 0;
}
const maxLevel = (a: AccessLevel | 'none', b: AccessLevel | 'none'): AccessLevel | 'none' => (levelRank(b) > levelRank(a) ? b : a);
export const canRead = (l: AccessLevel | 'none') => levelRank(l) >= RANK.view;
export const canWrite = (l: AccessLevel | 'none') => levelRank(l) >= RANK.edit;

export interface EffectiveAccess {
  projectId: string;
  userId: string;
  /** Власник книги чи адмін — усе. */
  full: boolean;
  book: AccessLevel | 'none';
  chapters: Record<string, AccessLevel>;
  scenes: Record<string, AccessLevel>;
  characters: Record<string, AccessLevel>;
  locations: Record<string, AccessLevel>;
  /** Медіатека книги: `none`, `view` або `work` (перегляд + власні завантаження). */
  media: 'none' | 'view' | 'work';
  /** На всю книгу немає навіть перегляду — бачить лише дозволене. */
  restricted: boolean;
  /** Хоч щось у тексті можна редагувати. */
  canWriteAny: boolean;
  /** Чинні записи доступу, з яких це складено. */
  grants: AccessGrantRow[];
}

const isLive = (g: AccessGrantRow, now: number) => g.status === 'active' && Date.parse(g.validFrom) <= now && (!g.validUntil || Date.parse(g.validUntil) > now);

/** Фактичні права з чинних записів доступу (чиста функція). */
export function computeEffective(projectId: string, userId: string, grants: AccessGrantRow[], opts: { full: boolean; now?: number }): EffectiveAccess {
  const now = opts.now ?? Date.now();
  const eff: EffectiveAccess = { projectId, userId, full: opts.full, book: opts.full ? 'manage' : 'none', chapters: {}, scenes: {}, characters: {}, locations: {}, media: opts.full ? 'work' : 'none', restricted: false, canWriteAny: opts.full, grants: [] };
  if (opts.full) return eff;
  const live = grants.filter((g) => isLive(g, now));
  eff.grants = live;
  const put = (m: Record<string, AccessLevel>, k: string, l: AccessLevel) => {
    m[k] = maxLevel(m[k] ?? 'none', l) as AccessLevel;
  };
  for (const g of live) {
    switch (g.scopeType) {
      case 'book': eff.book = maxLevel(eff.book, g.level); break;
      case 'chapter': put(eff.chapters, g.scopeRef!, g.level); break;
      case 'scene': put(eff.scenes, g.scopeRef!, g.level); break;
      case 'character': put(eff.characters, g.scopeRef!, g.level); break;
      case 'location': put(eff.locations, g.scopeRef!, g.level); break;
      case 'media_library': eff.media = g.level === 'work' || eff.media === 'work' ? 'work' : 'view'; break;
      default: break; // style_bible, task, deliverable — у моделі; застосування — Т7.
    }
  }
  if (canRead(eff.book) && eff.media === 'none') eff.media = 'view';
  eff.restricted = !canRead(eff.book);
  eff.canWriteAny = canWrite(eff.book) || [...Object.values(eff.chapters), ...Object.values(eff.scenes)].some((l) => canWrite(l));
  return eff;
}

/** Рівень на сцену (підрозділ рукопису) з урахуванням книги й розділу. */
export function sceneLevel(eff: EffectiveAccess, chapterId: string, sectionId: string): AccessLevel | 'none' {
  if (eff.full) return 'manage';
  const levels: Array<AccessLevel | 'none'> = [eff.book, eff.chapters[chapterId] ?? 'none', eff.scenes[sectionId] ?? 'none'];
  return levels.reduce<AccessLevel | 'none'>((a, b) => maxLevel(a, b), 'none');
}

/** Рівень на сутність ядра (персонаж, локація; решта — лише через книгу). */
export function entityLevel(eff: EffectiveAccess, type: string, entityId: string): AccessLevel | 'none' {
  if (eff.full) return 'manage';
  const own = type === 'character' ? eff.characters[entityId] : type === 'location' ? eff.locations[entityId] : undefined;
  return maxLevel(eff.book, own ?? 'none');
}

// ---------------------------------------------------------------------------
// Надання й відкликання
// ---------------------------------------------------------------------------

export interface Granter {
  userId: string;
  isOwner: boolean;
  isAdmin: boolean;
}

/** Структура книги для перевірки id розділів і сцен: розділ → його сцени. */
export type BookIndex = Map<string, string[]>;

export interface GrantInput {
  projectId: string;
  granter: Granter;
  /** Кому — людина, що вже є учасником проєкту. */
  userId: string;
  level: AccessLevel;
  scopeType: AccessScope;
  scopeRef?: string | null;
  validUntil?: string | null;
  bookIndex?: BookIndex | null;
}

async function granterAuthority(repo: CoreRepository, projectId: string, g: Granter): Promise<AccessLevel | 'none'> {
  if (g.isOwner || g.isAdmin) return 'manage';
  const p = await repo.getParticipant(projectId, g.userId);
  if (!p || p.status !== 'active') return 'none';
  return computeEffective(projectId, g.userId, await repo.listAccessGrants({ participantId: p.id, status: 'active' }), { full: false }).book;
}

export async function grantAccess(repo: CoreRepository, input: GrantInput): Promise<AccessGrantRow> {
  const actor: CoreActor = `user:${input.granter.userId}`;
  const authority = await granterAuthority(repo, input.projectId, input.granter);
  if (authority !== 'manage') throw new CoreRuleError('bad_actor', 'Надавати доступ може власник книги, адміністратор або учасник із правом керування');
  const privileged = input.granter.isOwner || input.granter.isAdmin;
  if (!privileged && input.level === 'manage') throw new CoreRuleError('bad_actor', 'Право керування надає лише власник книги чи адміністратор');
  if (!(ACCESS_LEVELS as readonly string[]).includes(input.level)) throw new CoreRuleError('bad_input', `Невідомий рівень доступу «${input.level}»`);
  if (input.userId === input.granter.userId && !input.granter.isAdmin) throw new CoreRuleError('bad_input', 'Собі доступ не надають');
  const participant = await repo.getParticipant(input.projectId, input.userId);
  if (!participant) throw new CoreRuleError('not_found', 'Спершу додайте людину учасником проєкту (запрошення чи роль)');
  if (participant.status !== 'active') throw new CoreRuleError('conflict', `Учасник — «${participant.status}», доступ не надається`);

  const ref = input.scopeRef ?? null;
  if (input.bookIndex && (input.scopeType === 'chapter' || input.scopeType === 'scene')) {
    const ok = input.scopeType === 'chapter' ? input.bookIndex.has(String(ref)) : [...input.bookIndex.values()].some((s) => s.includes(String(ref)));
    if (!ok) throw new CoreRuleError('not_found', `${input.scopeType === 'chapter' ? 'Розділу' : 'Сцени'} «${ref}» у книзі немає`);
  }
  if (input.scopeType === 'character' || input.scopeType === 'location') {
    const e = ref ? await repo.getEntity(input.projectId, ref) : null;
    if (!e || e.type !== input.scopeType) throw new CoreRuleError('not_found', `Сутності «${ref}» типу ${input.scopeType} у книзі немає`);
  }

  const row = await repo.addAccessGrant({
    projectId: input.projectId,
    participantId: participant.id,
    level: input.level,
    scopeType: input.scopeType,
    scopeRef: ref,
    validUntil: input.validUntil ?? null,
    source: input.granter.isAdmin && !input.granter.isOwner ? 'admin' : 'manual',
    grantedBy: actor,
  });
  await repo.addCollabEvent({ projectId: input.projectId, participantId: participant.id, action: 'access_granted', actor, details: { grantId: row.id, userId: input.userId, level: row.level, scopeType: row.scopeType, scopeRef: row.scopeRef, validUntil: row.validUntil } });
  return row;
}

export async function revokeAccess(repo: CoreRepository, input: { projectId: string; grantId: string; granter: Granter }): Promise<AccessGrantRow> {
  const authority = await granterAuthority(repo, input.projectId, input.granter);
  if (authority !== 'manage') throw new CoreRuleError('bad_actor', 'Відкликати доступ може власник книги, адміністратор або учасник із правом керування');
  const g = await repo.getAccessGrant(input.grantId);
  if (!g || g.projectId !== input.projectId) throw new CoreRuleError('not_found', 'Доступ не знайдено');
  if (g.level === 'manage' && !input.granter.isOwner && !input.granter.isAdmin) throw new CoreRuleError('bad_actor', 'Право керування відкликає лише власник книги чи адміністратор');
  const actor: CoreActor = `user:${input.granter.userId}`;
  const out = await repo.revokeAccessGrant(g.id, actor);
  const who = await repo.getParticipantById(g.participantId);
  await repo.addCollabEvent({ projectId: input.projectId, participantId: g.participantId, action: 'access_revoked', actor, details: { grantId: g.id, userId: who?.userId ?? null, level: g.level, scopeType: g.scopeType, scopeRef: g.scopeRef } });
  return out;
}

// ---------------------------------------------------------------------------
// Фактичні права людини в проєкті
// ---------------------------------------------------------------------------

export interface ResolveInput {
  projectId: string;
  userId: string;
  isOwner: boolean;
  isAdmin: boolean;
  /** Прийняте запрошення (старий шлях) — якщо записів доступу ще немає, стає доступом на книгу. */
  acceptedInvite?: { id: string; role: string } | null;
  now?: number;
}

/**
 * Перенести прийняте запрошення в наданий доступ (рішення власника §2 п.1):
 * читач — перегляд книги, решта — редагування книги. Лише якщо в учасника ще
 * немає жодного запису доступу (відкликаний теж рахується — його не
 * відновлюємо).
 */
async function migrateInvite(repo: CoreRepository, projectId: string, userId: string, invite: { id: string; role: string }): Promise<ParticipantRow | null> {
  let p = await repo.getParticipant(projectId, userId);
  if (!p) {
    try {
      p = (await assignRole(repo, { projectId, userId, roleId: invite.role, actor: MIGRATION_ACTOR, source: 'invitation', sourceRef: invite.id || null })).participant;
    } catch {
      p = (await repo.upsertParticipant({ projectId, userId, source: 'invitation', sourceRef: invite.id || null, createdBy: MIGRATION_ACTOR })).participant;
    }
  }
  const any = await repo.listAccessGrants({ participantId: p.id });
  if (any.length) return p;
  const level: AccessLevel = (studioRoleFor(invite.role) ?? 'reader') === 'reader' ? 'view' : 'edit';
  const row = await repo.addAccessGrant({ projectId, participantId: p.id, level, scopeType: 'book', source: 'legacy_invite', sourceRef: invite.id || null, grantedBy: MIGRATION_ACTOR });
  await repo.addCollabEvent({ projectId, participantId: p.id, action: 'access_granted', actor: MIGRATION_ACTOR, details: { grantId: row.id, userId, level, scopeType: 'book', source: 'legacy_invite', inviteRole: invite.role } });
  return p;
}

export async function resolveEffectiveAccess(repo: CoreRepository, input: ResolveInput): Promise<EffectiveAccess> {
  if (input.isOwner || input.isAdmin) return computeEffective(input.projectId, input.userId, [], { full: true, now: input.now });
  let p = await repo.getParticipant(input.projectId, input.userId);
  if (input.acceptedInvite) p = (await migrateInvite(repo, input.projectId, input.userId, input.acceptedInvite)) ?? p;
  if (!p || p.status !== 'active') return computeEffective(input.projectId, input.userId, [], { full: false, now: input.now });
  return computeEffective(input.projectId, input.userId, await repo.listAccessGrants({ participantId: p.id, status: 'active' }), { full: false, now: input.now });
}

/**
 * Права за старою схемою — коли ядра немає зовсім (`disabled`): прийняте
 * запрошення = вся книга (читач — перегляд, решта — редагування). Записів
 * доступу без ядра не буває, тож і звужувати нічого.
 */
export function legacyEffective(projectId: string, userId: string, inviteRole: string): EffectiveAccess {
  const level: AccessLevel = (studioRoleFor(inviteRole) ?? 'reader') === 'reader' ? 'view' : 'edit';
  const eff = computeEffective(projectId, userId, [], { full: false });
  eff.book = level;
  eff.media = 'view';
  eff.restricted = false;
  eff.canWriteAny = level === 'edit';
  return eff;
}

/** Чи є хоч щось, що людина може бачити в книзі. */
export function hasAnyAccess(eff: EffectiveAccess): boolean {
  return eff.full || !eff.restricted || eff.media !== 'none' ||
    [eff.chapters, eff.scenes, eff.characters, eff.locations].some((m) => Object.values(m).some((l) => canRead(l)));
}

/** Частковий доступ: книгу не можна редагувати цілком — правки й видача потребують фільтра. */
export function isScoped(eff: EffectiveAccess): boolean {
  return !eff.full && !canWrite(eff.book);
}

/**
 * Фактичні права для каналів (API ядра, кімната): `null` — ядра немає зовсім
 * (стара схема, лише запрошення), `'unavailable'` — ядро налаштоване, але
 * зараз недоступне (тоді учасникам — закрито, а не «все»).
 */
export type EffectiveResolver = (input: { projectId: string; userId: string; isAdmin?: boolean; invite: { id?: string; role: string } | null }) => Promise<EffectiveAccess | 'unavailable' | null>;

export function makeEffectiveResolver(repo: () => CoreRepository | null, coreState: () => string): EffectiveResolver {
  return async ({ projectId, userId, isAdmin, invite }) => {
    if (coreState() === 'disabled') return null;
    const r = repo();
    if (!r) return 'unavailable';
    return resolveEffectiveAccess(r, { projectId, userId, isOwner: false, isAdmin: !!isAdmin, acceptedInvite: invite ? { id: invite.id ?? '', role: invite.role } : null });
  };
}

const STUDIO_CHARACTER_PREFIX = 'studio:character:';

/** Id карток героїв у Студії (з `externalRef` сутностей) персонажів, які людина може бачити. */
export async function visibleCharacterRefs(repo: CoreRepository, eff: EffectiveAccess): Promise<Set<string>> {
  const out = new Set<string>();
  if (!eff.restricted) return out;
  for (const id of Object.keys(eff.characters)) {
    if (!canRead(eff.characters[id])) continue;
    const e = await repo.getEntity(eff.projectId, id);
    // Синхронізація пише `studio:character:<id картки>` (server/core/sync.ts, characterRef).
    const ref = e?.externalRef ? String(e.externalRef) : '';
    if (ref) out.add(ref.startsWith(STUDIO_CHARACTER_PREFIX) ? ref.slice(STUDIO_CHARACTER_PREFIX.length) : ref);
  }
  return out;
}

/** Короткий опис прав для клієнта (без самих записів). */
export function describeAccess(eff: EffectiveAccess) {
  return {
    full: eff.full,
    restricted: eff.restricted,
    book: eff.book,
    chapters: eff.chapters,
    scenes: eff.scenes,
    characters: eff.characters,
    locations: eff.locations,
    media: eff.media,
    canWriteAny: eff.canWriteAny,
  };
}
