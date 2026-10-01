/**
 * Життєвий цикл реєстру схем (Т5.1 В2, `PLAN_ONTOLOGY.md`; ТЗ Graph Studio
 * v3.0 §4.5):
 *
 *   EDIT → DRAFT → VALIDATE → PREVIEW → MIGRATION IMPACT → PUBLISH → ACTIVE
 *   і ROLLBACK / DEPRECATED / ARCHIVED.
 *
 * Одна онтологія на платформу (рішення власника §2 п.1). Опублікована
 * версія незмінна — будь-яка зміна, і відкат теж, іде НОВОЮ версією, тож
 * `ontology_version`, записаний у прогоні аналізу, завжди означає одне.
 *
 * **Руйнівне видалення заборонено.** Тип сутності чи зв'язку, що має дані
 * хоч у одній книзі (сутності, аліаси, згадки, зв'язки), вилучити не можна —
 * лише зробити застарілим. Змінити машинний ID — це те саме вилучення.
 * Перевірка — на кроці MIGRATION IMPACT і ще раз безпосередньо перед
 * публікацією (дані могли з'явитися між кроками).
 */

import { createHash } from 'node:crypto';
import type { CoreActor, CoreRepository, OntologyUsage, OntologyVersionRow } from '../types';
import { CoreRuleError, checkOntologyActor } from '../rules';
import {
  FUSION_ONTOLOGY_ID,
  applyOntology,
  canonicalJson,
  diffOntologies,
  factoryOntology,
  validateOntology,
  type OntologyDefinition,
  type OntologyDiff,
  type OntologyEntityType,
  type OntologyEnum,
  type OntologyFamily,
  type OntologyGroup,
  type OntologyRelationType,
  type OntologyStatus,
  type OntologyValidation,
  type OntologyValidationRule,
  type LocalizedName,
} from '../../../src/utils/ontology';
import { resetRegistry } from '../../../src/utils/coreEntities';
import {
  COLLAB_ONTOLOGY_ID,
  applyCollabOntology,
  diffCollabOntologies,
  factoryCollabOntology,
  resetCollabOntology,
  storyTypesReferenced,
  activeCollabOntology,
  validateCollabOntology,
  type CollabOntologyDefinition,
  type RoleDefinition,
  type CollabEntityType,
  type CrossDomainRelationType,
  type CollabOption,
  type CollabWorkspace,
} from '../../../src/utils/collabOntology';

export const IMPORT_ACTOR = 'system:ontology-import';

export function definitionHash(def: OntologyDefinition | Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(def)).digest('hex');
}

const asDef = (v: OntologyVersionRow): OntologyDefinition => {
  if (!v.definition) throw new CoreRuleError('bad_input', `Версія ${v.version} без визначення`);
  return v.definition as unknown as OntologyDefinition;
};
const label = (v: OntologyVersionRow) => `${v.ontologyId}@${v.version}`;

async function requireVersion(repo: CoreRepository, id: string): Promise<OntologyVersionRow> {
  const v = await repo.getOntologyVersion(id);
  if (!v) throw new CoreRuleError('not_found', `Версію онтології «${id}» не знайдено`);
  return v;
}

async function requireDraft(repo: CoreRepository, id: string): Promise<OntologyVersionRow> {
  const v = await requireVersion(repo, id);
  if (v.status !== 'draft' && v.status !== 'validated') throw new CoreRuleError('conflict', `Версія ${v.version} — «${v.status}», а не чернетка; зміни йдуть новою чернеткою`);
  return v;
}

async function requireActive(repo: CoreRepository, ontologyId = FUSION_ONTOLOGY_ID): Promise<OntologyVersionRow> {
  const v = await repo.getActiveOntologyVersion(ontologyId);
  if (!v) throw new CoreRuleError('not_found', 'Активної версії онтології ще немає');
  return v;
}

// ---------------------------------------------------------------------------
// Імпорт і застосування
// ---------------------------------------------------------------------------

/**
 * Домен реєстру схем: онтологія твору (`fusion-story`, Т5.1) чи співпраці
 * (`fusion-collab`, Т6.1). Життєвий цикл один; різні — формат, перевірка,
 * різниця, вплив на дані й застосування до реєстру процесу.
 */
export interface OntologyDomain {
  ontologyId: string;
  title: string;
  factory(): Record<string, unknown>;
  importNotes(def: Record<string, unknown>): { notes: string; details: Record<string, unknown> };
  validate(def: Record<string, unknown>): OntologyValidation;
  diff(before: Record<string, unknown>, after: Record<string, unknown>): { changed: boolean } & Record<string, unknown>;
  impact(repo: CoreRepository, before: Record<string, unknown>, after: Record<string, unknown>, hash: string, against: number): Promise<OntologyImpact>;
  applyOps(def: Record<string, unknown>, ops: unknown[]): Record<string, unknown>;
  preview(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown>;
  apply(def: Record<string, unknown>, label: string): void;
  reset(): void;
}

/** Остання застосована онтологія твору — проти неї перевіряються міждоменні зв'язки співпраці. */
let activeStoryDef: OntologyDefinition = factoryOntology();
/** Номер активної версії реєстру ролей (для `participant_roles.registry_version`). */
let activeCollabVersion: number | null = null;
export const activeCollabRegistryVersion = () => activeCollabVersion;

const STORY_DOMAIN: OntologyDomain = {
  ontologyId: FUSION_ONTOLOGY_ID,
  title: 'Fusion Story Ontology',
  factory: () => factoryOntology() as unknown as Record<string, unknown>,
  importNotes: (d) => {
    const def = d as unknown as OntologyDefinition;
    return {
      notes: 'Імпорт чинного реєстру (документ власника): 118 типів сутностей, 39 типів зв\'язків, 12 груп A–J3.',
      details: { entityTypes: def.entityTypes.length, relationTypes: def.relationTypes.length, groups: def.groups.length },
    };
  },
  validate: (d) => validateOntology(d as unknown as OntologyDefinition),
  diff: (a, b) => diffOntologies(a as unknown as OntologyDefinition, b as unknown as OntologyDefinition) as unknown as { changed: boolean } & Record<string, unknown>,
  impact: async (repo, a, b, hash, against) => {
    const imp = computeImpact(a as unknown as OntologyDefinition, b as unknown as OntologyDefinition, await repo.ontologyUsage(), hash, against);
    // Тип твору, на який посилається активний міждоменний зв'язок співпраці, не вилучається (Т6.1).
    const refs = storyTypesReferenced(activeCollabOntology());
    const removed = diffOntologies(a as unknown as OntologyDefinition, b as unknown as OntologyDefinition).entityTypes.removed;
    for (const tid of removed) {
      const by = refs.get(tid);
      if (!by) continue;
      const item: OntologyImpactItem = { kind: 'cross_domain_ref', id: tid, change: 'removed', usage: { entities: 0, aliases: 0, mentions: 0, relations: 0 }, blocking: true, message: `Тип «${tid}» використовують міждоменні зв'язки співпраці (${by.join(', ')}) — спершу змініть онтологію співпраці` };
      imp.affected.push(item);
      imp.blockers.push(item);
    }
    return imp;
  },
  applyOps: (d, ops) => applyOps(d as unknown as OntologyDefinition, ops as OntologyOp[]) as unknown as Record<string, unknown>,
  preview: (a, b) => storyPreview(a as unknown as OntologyDefinition, b as unknown as OntologyDefinition),
  apply: (d, l) => {
    applyOntology(d as unknown as OntologyDefinition, l);
    activeStoryDef = JSON.parse(JSON.stringify(d));
  },
  reset: () => {
    resetRegistry();
    activeStoryDef = factoryOntology();
  },
};

const COLLAB_DOMAIN: OntologyDomain = {
  ontologyId: COLLAB_ONTOLOGY_ID,
  title: 'Fusion Collaboration Ontology',
  factory: () => factoryCollabOntology() as unknown as Record<string, unknown>,
  importNotes: (d) => {
    const def = d as unknown as CollabOntologyDefinition;
    return {
      notes: `Онтологія співпраці 1.0: ${def.entityTypes.length} сутностей (ТЗ v3 §45), ${def.crossDomainRelations.length} міждоменних зв'язків (§48), ${def.roles.length} ролей (Onboarding §7 + бета-рідер).`,
      details: { entityTypes: def.entityTypes.length, roles: def.roles.length, crossDomainRelations: def.crossDomainRelations.length },
    };
  },
  validate: (d) => validateCollabOntology(d as unknown as CollabOntologyDefinition, { story: activeStoryDef }),
  diff: (a, b) => diffCollabOntologies(a as unknown as CollabOntologyDefinition, b as unknown as CollabOntologyDefinition) as unknown as { changed: boolean } & Record<string, unknown>,
  impact: async (repo, a, b, hash, against) => collabImpact(a as unknown as CollabOntologyDefinition, b as unknown as CollabOntologyDefinition, await repo.countActiveRoleAssignments(), hash, against),
  applyOps: (d, ops) => applyCollabOps(d as unknown as CollabOntologyDefinition, ops as CollabOp[]) as unknown as Record<string, unknown>,
  preview: (a, b) => {
    const before = a as unknown as CollabOntologyDefinition;
    const after = b as unknown as CollabOntologyDefinition;
    const diff = diffCollabOntologies(before, after);
    const pick = (d: CollabOntologyDefinition, id: string) => {
      const r = d.roles.find((x) => x.id === id);
      return r ? { label: r.label, category: r.category, status: r.status, invitable: r.invitable } : null;
    };
    const touched = [...diff.roles.added, ...diff.roles.removed, ...diff.roles.changed.map((c) => c.id)];
    return { diff, roles: touched.map((id) => ({ id, before: pick(before, id), after: pick(after, id) })), counts: { roles: after.roles.length, activeRoles: after.roles.filter((r) => r.status === 'active').length, crossDomainRelations: after.crossDomainRelations.length } };
  },
  apply: (d, l) => applyCollabOntology(d as unknown as CollabOntologyDefinition, l),
  reset: () => resetCollabOntology(),
};

export const ONTOLOGY_DOMAINS: Record<string, OntologyDomain> = { [FUSION_ONTOLOGY_ID]: STORY_DOMAIN, [COLLAB_ONTOLOGY_ID]: COLLAB_DOMAIN };

export function domainOf(ontologyId: string): OntologyDomain {
  const d = ONTOLOGY_DOMAINS[ontologyId];
  if (!d) throw new CoreRuleError('not_found', `Онтології «${ontologyId}» немає в реєстрі схем`);
  return d;
}

async function bootstrapDomain(repo: CoreRepository, domain: OntologyDomain, log: (m: string) => void): Promise<OntologyVersionRow> {
  let active = await repo.getActiveOntologyVersion(domain.ontologyId);
  if (!active) {
    const def = domain.factory();
    const { notes, details } = domain.importNotes(def);
    try {
      active = await repo.addOntologyVersion({ ontologyId: domain.ontologyId, label: '1.0', status: 'active', definition: def, definitionHash: definitionHash(def), createdBy: IMPORT_ACTOR, notes });
      await repo.addOntologyEvent({ ontologyId: domain.ontologyId, versionId: active.id, action: 'import', actor: IMPORT_ACTOR, details });
      log(`[ontology] імпортовано ${domain.title} 1.0 (${Object.entries(details).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    } catch (err) {
      // Інший процес імпортував паралельно — беремо його версію.
      active = await repo.getActiveOntologyVersion(domain.ontologyId);
      if (!active) throw err;
    }
  }
  applyActiveVersion(active);
  log(`[ontology] активна версія — ${label(active)}`);
  return active;
}

/**
 * Перший старт ядра: для кожної онтології без активної версії — імпорт 1.0
 * (твір — чинний реєстр, критерій ТЗ §39 №1; співпраця — реєстр ролей Т6.1).
 * Далі активні версії застосовуються до реєстрів процесу. Повертає активну
 * версію онтології твору; збій онтології співпраці твору не заважає.
 */
export async function bootstrapOntology(repo: CoreRepository, log: (m: string) => void = () => {}): Promise<OntologyVersionRow> {
  const story = await bootstrapDomain(repo, STORY_DOMAIN, log);
  try {
    await bootstrapDomain(repo, COLLAB_DOMAIN, log);
  } catch (err) {
    log(`[ontology] онтологію співпраці не застосовано, працює вбудований реєстр ролей: ${(err as Error).message}`);
  }
  return story;
}

/** Застосувати версію до реєстру процесу. Зламане визначення в базі не застосовується — лишається попередній реєстр. */
export function applyActiveVersion(v: OntologyVersionRow): void {
  const domain = domainOf(v.ontologyId);
  const def = asDef(v) as unknown as Record<string, unknown>;
  const val = domain.validate(def);
  if (!val.ok) throw new CoreRuleError('bad_input', `Активна версія ${label(v)} не проходить перевірку: ${val.errors[0]?.message}`);
  domain.apply(def, label(v));
  if (v.ontologyId === COLLAB_ONTOLOGY_ID) activeCollabVersion = v.version;
}

/** Для тестів: повернути заводські реєстри процесу (твір і співпраця). */
export function resetActiveRegistry(): void {
  STORY_DOMAIN.reset();
  COLLAB_DOMAIN.reset();
  activeCollabVersion = null;
}

// ---------------------------------------------------------------------------
// Чернетка й правки (EDIT → DRAFT)
// ---------------------------------------------------------------------------

export async function createDraft(repo: CoreRepository, input: { actor: CoreActor; basedOn?: string; label?: string; notes?: string; ontologyId?: string }): Promise<OntologyVersionRow> {
  checkOntologyActor(input.actor);
  if (input.ontologyId) domainOf(input.ontologyId);
  const source = input.basedOn ? await requireVersion(repo, input.basedOn) : await requireActive(repo, input.ontologyId ?? FUSION_ONTOLOGY_ID);
  if (input.basedOn && input.ontologyId && source.ontologyId !== input.ontologyId) throw new CoreRuleError('bad_input', 'Версія належить іншій онтології');
  if (!source.publishedAt) throw new CoreRuleError('conflict', 'Чернетку будують з опублікованої версії');
  const def = asDef(source);
  const draft = await repo.addOntologyVersion({
    ontologyId: source.ontologyId,
    basedOn: source.id,
    label: input.label ?? '',
    notes: input.notes ?? '',
    definition: def as unknown as Record<string, unknown>,
    definitionHash: definitionHash(def),
    createdBy: input.actor,
  });
  await repo.addOntologyEvent({ ontologyId: draft.ontologyId, versionId: draft.id, action: 'create_draft', actor: input.actor, details: { basedOn: source.version } });
  return draft;
}

/**
 * Правка чернетки — операціями (те саме API знадобиться канві Т5.2).
 * `set_*` — додати чи замінити запис цілком за id; `remove_*` — вилучити
 * (чи можна — вирішує MIGRATION IMPACT); `set_*_status` — active / deprecated.
 */
export type OntologyOp =
  | { op: 'set_entity_type'; value: OntologyEntityType }
  | { op: 'remove_entity_type'; id: string }
  | { op: 'set_entity_status'; id: string; status: OntologyStatus }
  | { op: 'set_relation_type'; value: OntologyRelationType }
  | { op: 'remove_relation_type'; id: string }
  | { op: 'set_relation_status'; id: string; status: OntologyStatus }
  | { op: 'set_group'; value: OntologyGroup }
  | { op: 'remove_group'; id: string }
  | { op: 'set_family'; value: OntologyFamily }
  | { op: 'remove_family'; id: string }
  | { op: 'set_enum'; value: OntologyEnum }
  | { op: 'remove_enum'; id: string }
  | { op: 'set_rule'; value: OntologyValidationRule }
  | { op: 'remove_rule'; id: string }
  | { op: 'set_name'; name: LocalizedName }
  | { op: 'replace_definition'; definition: OntologyDefinition };

export const ONTOLOGY_OPS = [
  'set_entity_type', 'remove_entity_type', 'set_entity_status',
  'set_relation_type', 'remove_relation_type', 'set_relation_status',
  'set_group', 'remove_group', 'set_family', 'remove_family',
  'set_enum', 'remove_enum', 'set_rule', 'remove_rule', 'set_name', 'replace_definition',
] as const;

type ListKey = 'entityTypes' | 'relationTypes' | 'groups' | 'families' | 'enums' | 'validationRules';

function upsert<T extends { id: string }>(list: T[], value: T): void {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) throw new CoreRuleError('bad_input', 'Запис без id');
  const i = list.findIndex((x) => x.id === value.id);
  if (i >= 0) list[i] = value;
  else list.push(value);
}
function remove(def: OntologyDefinition, key: ListKey, id: string): void {
  const list = def[key] as { id: string }[];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new CoreRuleError('not_found', `«${id}» немає в ${key}`);
  list.splice(i, 1);
}
function setStatus(list: { id: string; status: OntologyStatus }[], id: string, status: OntologyStatus): void {
  if (status !== 'active' && status !== 'deprecated') throw new CoreRuleError('bad_input', `Статус — active чи deprecated, а не «${status}»`);
  const x = list.find((e) => e.id === id);
  if (!x) throw new CoreRuleError('not_found', `«${id}» немає`);
  x.status = status;
}

export function applyOps(def: OntologyDefinition, ops: OntologyOp[]): OntologyDefinition {
  if (!Array.isArray(ops) || !ops.length) throw new CoreRuleError('bad_input', 'Немає жодної операції');
  if (ops.length > 500) throw new CoreRuleError('bad_input', 'Забагато операцій за раз (до 500)');
  let next: OntologyDefinition = JSON.parse(JSON.stringify(def));
  for (const [i, o] of ops.entries()) {
    if (!o || !(ONTOLOGY_OPS as readonly string[]).includes((o as { op: string }).op)) throw new CoreRuleError('bad_input', `Операція №${i + 1}: невідома «${(o as { op?: string })?.op}»`);
    switch (o.op) {
      case 'set_entity_type': upsert(next.entityTypes, o.value); break;
      case 'remove_entity_type': remove(next, 'entityTypes', o.id); break;
      case 'set_entity_status': setStatus(next.entityTypes, o.id, o.status); break;
      case 'set_relation_type': upsert(next.relationTypes, o.value); break;
      case 'remove_relation_type': remove(next, 'relationTypes', o.id); break;
      case 'set_relation_status': setStatus(next.relationTypes, o.id, o.status); break;
      case 'set_group': upsert(next.groups, o.value); break;
      case 'remove_group': remove(next, 'groups', o.id); break;
      case 'set_family': upsert(next.families, o.value); break;
      case 'remove_family': remove(next, 'families', o.id); break;
      case 'set_enum': upsert(next.enums, o.value); break;
      case 'remove_enum': remove(next, 'enums', o.id); break;
      case 'set_rule': upsert(next.validationRules, o.value); break;
      case 'remove_rule': remove(next, 'validationRules', o.id); break;
      case 'set_name': next.name = o.name; break;
      case 'replace_definition':
        if (!o.definition || typeof o.definition !== 'object') throw new CoreRuleError('bad_input', 'replace_definition без визначення');
        next = JSON.parse(JSON.stringify(o.definition));
        break;
    }
  }
  return next;
}

/** Правка чернетки: будь-яка зміна скидає перевірку й вплив — їх треба пройти знову. */
export async function editDraft(repo: CoreRepository, id: string, input: { actor: CoreActor; ops: (OntologyOp | CollabOp)[]; expectedRevision?: number }): Promise<OntologyVersionRow> {
  checkOntologyActor(input.actor);
  const draft = await requireDraft(repo, id);
  const next = domainOf(draft.ontologyId).applyOps(asDef(draft) as unknown as Record<string, unknown>, input.ops as unknown[]);
  const updated = await repo.updateOntologyVersion(
    id,
    { definition: next as unknown as Record<string, unknown>, definitionHash: definitionHash(next), status: 'draft', validation: null, impact: null },
    input.expectedRevision,
  );
  await repo.addOntologyEvent({ ontologyId: draft.ontologyId, versionId: id, action: 'edit', actor: input.actor, details: { ops: input.ops.map((o) => ({ op: o.op, id: 'id' in o ? o.id : 'value' in o ? (o.value as { id?: string })?.id : undefined })) } });
  return updated;
}

// ---------------------------------------------------------------------------
// VALIDATE · PREVIEW · MIGRATION IMPACT
// ---------------------------------------------------------------------------

export async function validateDraft(repo: CoreRepository, id: string, actor: CoreActor): Promise<{ version: OntologyVersionRow; validation: OntologyValidation }> {
  checkOntologyActor(actor);
  const draft = await requireDraft(repo, id);
  const validation = domainOf(draft.ontologyId).validate(asDef(draft) as unknown as Record<string, unknown>);
  const stored = { ...validation, hash: draft.definitionHash, at: new Date().toISOString() };
  const version = await repo.updateOntologyVersion(id, { validation: stored, status: validation.ok ? 'validated' : 'draft' });
  await repo.addOntologyEvent({ ontologyId: draft.ontologyId, versionId: id, action: 'validate', actor, details: { ok: validation.ok, errors: validation.errors.length, warnings: validation.warnings.length } });
  return { version, validation };
}

export interface OntologyPreview {
  ontologyId: string;
  version: number;
  against: number;
  diff: Record<string, unknown>;
  [k: string]: unknown;
}

function storyPreview(before: OntologyDefinition, after: OntologyDefinition): Record<string, unknown> {
  const diff = diffOntologies(before, after);
  const pick = (d: OntologyDefinition, tid: string) => {
    const t = d.entityTypes.find((x) => x.id === tid);
    return t ? { name: t.name, color: t.ui.color, status: t.status } : null;
  };
  const touched = [...diff.entityTypes.added, ...diff.entityTypes.removed, ...diff.entityTypes.changed.map((c) => c.id)];
  return {
    diff,
    // Як тип виглядатиме в інтерфейсі після публікації — для змінених і доданих.
    ui: touched.map((tid) => ({ id: tid, before: pick(before, tid), after: pick(after, tid) })),
    counts: { entityTypes: after.entityTypes.length, activeEntityTypes: after.entityTypes.filter((t) => t.status === 'active').length, relationTypes: after.relationTypes.length, groups: after.groups.length },
  };
}

export async function previewDraft(repo: CoreRepository, id: string): Promise<OntologyPreview> {
  const draft = await requireDraft(repo, id);
  const active = await requireActive(repo, draft.ontologyId);
  const body = domainOf(draft.ontologyId).preview(asDef(active) as unknown as Record<string, unknown>, asDef(draft) as unknown as Record<string, unknown>);
  return { ontologyId: draft.ontologyId, version: draft.version, against: active.version, diff: body.diff as Record<string, unknown>, ...body };
}

export interface OntologyImpactItem {
  kind: 'entity_type' | 'relation_type' | 'cross_domain_ref' | 'role' | 'cross_domain_relation' | 'collab_type';
  id: string;
  change: 'removed' | 'deprecated' | 'changed';
  usage: { entities: number; aliases: number; mentions: number; relations: number };
  /** Чи блокує публікацію (вилучення типу з даними). */
  blocking: boolean;
  message: string;
}

export interface OntologyImpact {
  hash: string;
  at: string;
  against: number;
  blockers: OntologyImpactItem[];
  affected: OntologyImpactItem[];
}

export function computeImpact(before: OntologyDefinition, after: OntologyDefinition, usage: OntologyUsage, hash: string, against: number): OntologyImpact {
  const diff = diffOntologies(before, after);
  const items: OntologyImpactItem[] = [];
  const typeUsage = (tid: string) => ({ entities: usage.entities[tid] ?? 0, aliases: usage.aliases[tid] ?? 0, mentions: usage.mentions[tid] ?? 0, relations: 0 });
  const relUsage = (rid: string) => ({ entities: 0, aliases: 0, mentions: 0, relations: usage.relations[rid] ?? 0 });
  const total = (u: OntologyImpactItem['usage']) => u.entities + u.aliases + u.mentions + u.relations;
  for (const tid of diff.entityTypes.removed) {
    const u = typeUsage(tid);
    const blocking = total(u) > 0;
    items.push({ kind: 'entity_type', id: tid, change: 'removed', usage: u, blocking, message: blocking ? `Тип «${tid}» має дані (сутностей ${u.entities}, згадок ${u.mentions}, аліасів ${u.aliases}) — вилучити не можна, лише зробити застарілим` : `Тип «${tid}» без даних — вилучення безпечне` });
  }
  for (const rid of diff.relationTypes.removed) {
    const u = relUsage(rid);
    const blocking = u.relations > 0;
    items.push({ kind: 'relation_type', id: rid, change: 'removed', usage: u, blocking, message: blocking ? `Зв'язок «${rid}» має ${u.relations} записів — вилучити не можна, лише зробити застарілим` : `Зв'язок «${rid}» без даних — вилучення безпечне` });
  }
  for (const tid of diff.entityTypes.deprecated) {
    const u = typeUsage(tid);
    items.push({ kind: 'entity_type', id: tid, change: 'deprecated', usage: u, blocking: false, message: `Застаріє: наявні ${total(u)} записів лишаються дійсними, нових панель і AI не пропонуватимуть` });
  }
  for (const rid of diff.relationTypes.deprecated) {
    const u = relUsage(rid);
    items.push({ kind: 'relation_type', id: rid, change: 'deprecated', usage: u, blocking: false, message: `Застаріє: наявні ${u.relations} зв'язків лишаються, нових AI не пропонуватиме` });
  }
  for (const c of diff.entityTypes.changed) {
    if (diff.entityTypes.deprecated.includes(c.id)) continue;
    const u = typeUsage(c.id);
    items.push({ kind: 'entity_type', id: c.id, change: 'changed', usage: u, blocking: false, message: `Змінено ${c.fields.join(', ')} — машинний ID той самий, дані не змінюються` });
  }
  for (const c of diff.relationTypes.changed) {
    if (diff.relationTypes.deprecated.includes(c.id)) continue;
    items.push({ kind: 'relation_type', id: c.id, change: 'changed', usage: relUsage(c.id), blocking: false, message: `Змінено ${c.fields.join(', ')} — дані не змінюються` });
  }
  return { hash, at: new Date().toISOString(), against, blockers: items.filter((i) => i.blocking), affected: items };
}

export async function impactDraft(repo: CoreRepository, id: string, actor: CoreActor): Promise<{ version: OntologyVersionRow; impact: OntologyImpact }> {
  checkOntologyActor(actor);
  const draft = await requireDraft(repo, id);
  const active = await requireActive(repo, draft.ontologyId);
  const impact = await domainOf(draft.ontologyId).impact(repo, asDef(active) as unknown as Record<string, unknown>, asDef(draft) as unknown as Record<string, unknown>, draft.definitionHash, active.version);
  const version = await repo.updateOntologyVersion(id, { impact: impact as unknown as Record<string, unknown> });
  await repo.addOntologyEvent({ ontologyId: draft.ontologyId, versionId: id, action: 'impact', actor, details: { blockers: impact.blockers.map((b) => b.id), affected: impact.affected.length } });
  return { version, impact };
}

// ---------------------------------------------------------------------------
// PUBLISH · ROLLBACK · ARCHIVE
// ---------------------------------------------------------------------------

export class OntologyPublishError extends CoreRuleError {
  constructor(message: string, readonly details: Record<string, unknown>) {
    super('conflict', message);
  }
}

/**
 * Публікація: лише перевірена чернетка, перевірка й вплив — для того самого
 * визначення (хеш), вплив перераховується ще раз саме зараз; блокерів немає;
 * є зміни. Попередня активна → `deprecated`. Реєстр процесу — одразу нова версія.
 */
export async function publishDraft(repo: CoreRepository, id: string, actor: CoreActor, opts: { action?: 'publish' | 'rollback'; details?: Record<string, unknown> } = {}): Promise<OntologyVersionRow> {
  checkOntologyActor(actor);
  const draft = await requireDraft(repo, id);
  const validation = draft.validation as unknown as (OntologyValidation & { hash?: string }) | null;
  if (draft.status !== 'validated' || !validation?.ok || validation.hash !== draft.definitionHash) {
    throw new OntologyPublishError('Спершу перевірка (VALIDATE) цього самого визначення', { step: 'validate' });
  }
  const impact = draft.impact as unknown as OntologyImpact | null;
  if (!impact || impact.hash !== draft.definitionHash) {
    throw new OntologyPublishError('Спершу вплив на дані (MIGRATION IMPACT) цього самого визначення', { step: 'impact' });
  }
  const active = await requireActive(repo, draft.ontologyId);
  const domain = domainOf(draft.ontologyId);
  const before = asDef(active) as unknown as Record<string, unknown>;
  const after = asDef(draft) as unknown as Record<string, unknown>;
  if (!domain.diff(before, after).changed) throw new OntologyPublishError('Чернетка нічим не відрізняється від активної версії', { step: 'diff' });
  const fresh = await domain.impact(repo, before, after, draft.definitionHash, active.version);
  if (fresh.blockers.length) {
    await repo.updateOntologyVersion(id, { impact: fresh as unknown as Record<string, unknown> });
    throw new OntologyPublishError(`Руйнівне видалення заборонено: ${fresh.blockers.map((b) => b.message).join('; ')}`, { step: 'impact', blockers: fresh.blockers });
  }
  const published = await repo.activateOntologyVersion(id, actor);
  await repo.addOntologyEvent({ ontologyId: published.ontologyId, versionId: id, action: opts.action ?? 'publish', actor, details: { version: published.version, replaced: active.version, ...(opts.details ?? {}) } });
  applyActiveVersion(published);
  return published;
}

/**
 * Відкат (ROLLBACK): нова версія з визначенням обраної минулої — через ті
 * самі перевірку, вплив і публікацію. Якщо щось не пускає (вилучений тип уже
 * має дані) — чернетка лишається, щоб автор бачив чому.
 */
export async function rollbackTo(repo: CoreRepository, versionId: string, actor: CoreActor): Promise<OntologyVersionRow> {
  checkOntologyActor(actor);
  const source = await requireVersion(repo, versionId);
  if (!source.publishedAt) throw new CoreRuleError('conflict', 'Відкат — лише до опублікованої версії');
  if (source.status === 'active') throw new CoreRuleError('conflict', 'Ця версія вже активна');
  const draft = await createDraft(repo, { actor, basedOn: source.id, label: `відкат до ${source.version}`, notes: `Відкат до версії ${source.version}${source.label ? ` (${source.label})` : ''}` });
  const { validation } = await validateDraft(repo, draft.id, actor);
  if (!validation.ok) throw new OntologyPublishError(`Версія ${source.version} не проходить перевірку: ${validation.errors[0]?.message}`, { step: 'validate', draftId: draft.id });
  await impactDraft(repo, draft.id, actor);
  try {
    return await publishDraft(repo, draft.id, actor, { action: 'rollback', details: { to: source.version } });
  } catch (err) {
    if (err instanceof OntologyPublishError) throw new OntologyPublishError(err.message, { ...err.details, draftId: draft.id });
    throw err;
  }
}

/** Архів: відкинути чернетку чи прибрати застарілу версію з ужитку. Активну — ні. */
export async function archiveVersion(repo: CoreRepository, id: string, actor: CoreActor): Promise<OntologyVersionRow> {
  checkOntologyActor(actor);
  const v = await requireVersion(repo, id);
  if (v.status === 'active') throw new CoreRuleError('conflict', 'Активну версію не архівують — спершу опублікуйте іншу');
  if (v.status === 'archived') return v;
  const discarded = v.status === 'draft' || v.status === 'validated';
  const out = await repo.updateOntologyVersion(id, { status: 'archived' });
  await repo.addOntologyEvent({ ontologyId: v.ontologyId, versionId: id, action: discarded ? 'discard' : 'archive', actor, details: { version: v.version } });
  return out;
}

/** Відкрита чернетка онтології (не більше однієї), якщо є. */
export async function openDraft(repo: CoreRepository, ontologyId = FUSION_ONTOLOGY_ID): Promise<OntologyVersionRow | null> {
  const list = await repo.listOntologyVersions(ontologyId, { limit: 200 });
  const d = list.find((v) => v.status === 'draft' || v.status === 'validated');
  return d ? repo.getOntologyVersion(d.id) : null;
}

// ---------------------------------------------------------------------------
// Онтологія співпраці: правки й вплив (Т6.1 В2)
// ---------------------------------------------------------------------------

/** Правки чернетки онтології співпраці — ролі, типи, міждоменні зв'язки, довідники. */
export type CollabOp =
  | { op: 'set_role'; value: RoleDefinition }
  | { op: 'remove_role'; id: string }
  | { op: 'set_role_status'; id: string; status: OntologyStatus }
  | { op: 'set_collab_entity_type'; value: CollabEntityType }
  | { op: 'remove_collab_entity_type'; id: string }
  | { op: 'set_cross_domain_relation'; value: CrossDomainRelationType }
  | { op: 'remove_cross_domain_relation'; id: string }
  | { op: 'set_option'; list: 'roleCategories' | 'projectTypes' | 'entryIntents' | 'scopeTypes' | 'capabilities'; value: CollabOption }
  | { op: 'set_workspace'; value: CollabWorkspace }
  | { op: 'replace_definition'; definition: CollabOntologyDefinition };

export const COLLAB_OPS = ['set_role', 'remove_role', 'set_role_status', 'set_collab_entity_type', 'remove_collab_entity_type', 'set_cross_domain_relation', 'remove_cross_domain_relation', 'set_option', 'set_workspace', 'replace_definition'] as const;
const OPTION_LISTS = ['roleCategories', 'projectTypes', 'entryIntents', 'scopeTypes', 'capabilities'] as const;

export function applyCollabOps(def: CollabOntologyDefinition, ops: CollabOp[]): CollabOntologyDefinition {
  if (!Array.isArray(ops) || !ops.length) throw new CoreRuleError('bad_input', 'Немає жодної операції');
  if (ops.length > 500) throw new CoreRuleError('bad_input', 'Забагато операцій за раз (до 500)');
  let next: CollabOntologyDefinition = JSON.parse(JSON.stringify(def));
  const removeFrom = (list: { id: string }[], id: string, what: string) => {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new CoreRuleError('not_found', `«${id}» немає в ${what}`);
    list.splice(i, 1);
  };
  for (const [i, o] of ops.entries()) {
    if (!o || !(COLLAB_OPS as readonly string[]).includes((o as { op: string }).op)) throw new CoreRuleError('bad_input', `Операція №${i + 1}: невідома «${(o as { op?: string })?.op}»`);
    switch (o.op) {
      case 'set_role': upsert(next.roles, o.value); break;
      case 'remove_role': removeFrom(next.roles, o.id, 'roles'); break;
      case 'set_role_status': setStatus(next.roles, o.id, o.status); break;
      case 'set_collab_entity_type': upsert(next.entityTypes, o.value); break;
      case 'remove_collab_entity_type': removeFrom(next.entityTypes, o.id, 'entityTypes'); break;
      case 'set_cross_domain_relation': upsert(next.crossDomainRelations, o.value); break;
      case 'remove_cross_domain_relation': removeFrom(next.crossDomainRelations, o.id, 'crossDomainRelations'); break;
      case 'set_option':
        if (!(OPTION_LISTS as readonly string[]).includes(o.list)) throw new CoreRuleError('bad_input', `Довідника «${o.list}» немає`);
        upsert(next[o.list], o.value);
        break;
      case 'set_workspace': upsert(next.workspaces, o.value); break;
      case 'replace_definition':
        if (!o.definition || typeof o.definition !== 'object') throw new CoreRuleError('bad_input', 'replace_definition без визначення');
        next = JSON.parse(JSON.stringify(o.definition));
        break;
    }
  }
  return next;
}

/**
 * Вплив зміни реєстру ролей: вилучена роль (чи спеціалізація) з активними
 * призначеннями — блокер (лише застаріти); застаріла — наявні призначення
 * лишаються, нових не буде; міждоменні зв'язки поки без даних — інформація.
 */
export function collabImpact(before: CollabOntologyDefinition, after: CollabOntologyDefinition, assignments: Record<string, number>, hash: string, against: number): OntologyImpact {
  const diff = diffCollabOntologies(before, after);
  const items: OntologyImpactItem[] = [];
  const usage = (n: number) => ({ entities: 0, aliases: 0, mentions: 0, relations: n });
  for (const id of diff.roles.removed) {
    const n = assignments[id] ?? 0;
    items.push({ kind: 'role', id, change: 'removed', usage: usage(n), blocking: n > 0, message: n > 0 ? `Роль «${id}» мають ${n} учасників — вилучити не можна, лише зробити застарілою` : `Роль «${id}» нікому не призначена — вилучення безпечне` });
  }
  for (const id of diff.roles.deprecated) {
    items.push({ kind: 'role', id, change: 'deprecated', usage: usage(assignments[id] ?? 0), blocking: false, message: `Застаріє: ${assignments[id] ?? 0} наявних призначень лишаються, нових не буде` });
  }
  for (const c of diff.roles.changed) {
    if (diff.roles.deprecated.includes(c.id)) continue;
    items.push({ kind: 'role', id: c.id, change: 'changed', usage: usage(assignments[c.id] ?? 0), blocking: false, message: `Змінено ${c.fields.join(', ')} — id ролі той самий, призначення не змінюються` });
  }
  for (const id of diff.crossDomainRelations.removed) items.push({ kind: 'cross_domain_relation', id, change: 'removed', usage: usage(0), blocking: false, message: `Міждоменний зв'язок «${id}» вилучено — записів таких зв'язків ще немає (Т6.5)` });
  for (const id of diff.entityTypes.removed) {
    const core = ['PERSON', 'PARTICIPANT', 'ROLE', 'BOOK_PROJECT'].includes(id);
    items.push({ kind: 'collab_type', id, change: 'removed', usage: usage(0), blocking: core, message: core ? `Тип «${id}» уже має дані (учасники, ролі) — вилучити не можна` : `Тип співпраці «${id}» ще без даних` });
  }
  return { hash, at: new Date().toISOString(), against, blockers: items.filter((i) => i.blocking), affected: items };
}
