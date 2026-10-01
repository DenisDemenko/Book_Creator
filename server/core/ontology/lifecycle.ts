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

export const IMPORT_ACTOR = 'system:ontology-import';

export function definitionHash(def: OntologyDefinition): string {
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
 * Перший старт ядра: якщо активної версії немає — імпорт чинного реєстру як
 * Fusion Story Ontology 1.0 (критерій ТЗ §39 №1). Далі — застосування
 * активної версії до реєстру (редактор, теги, правила ядра).
 */
export async function bootstrapOntology(repo: CoreRepository, log: (m: string) => void = () => {}): Promise<OntologyVersionRow> {
  let active = await repo.getActiveOntologyVersion(FUSION_ONTOLOGY_ID);
  if (!active) {
    const def = factoryOntology();
    try {
      active = await repo.addOntologyVersion({
        ontologyId: FUSION_ONTOLOGY_ID,
        label: '1.0',
        status: 'active',
        definition: def as unknown as Record<string, unknown>,
        definitionHash: definitionHash(def),
        createdBy: IMPORT_ACTOR,
        notes: 'Імпорт чинного реєстру (документ власника): 118 типів сутностей, 39 типів зв\'язків, 12 груп A–J3.',
      });
      await repo.addOntologyEvent({ ontologyId: FUSION_ONTOLOGY_ID, versionId: active.id, action: 'import', actor: IMPORT_ACTOR, details: { entityTypes: def.entityTypes.length, relationTypes: def.relationTypes.length, groups: def.groups.length } });
      log(`[ontology] імпортовано Fusion Story Ontology 1.0 (${def.entityTypes.length} типів, ${def.relationTypes.length} зв'язків)`);
    } catch (err) {
      // Інший процес імпортував паралельно — беремо його версію.
      active = await repo.getActiveOntologyVersion(FUSION_ONTOLOGY_ID);
      if (!active) throw err;
    }
  }
  applyActiveVersion(active);
  log(`[ontology] активна версія — ${label(active)}`);
  return active;
}

/** Застосувати версію до реєстру процесу. Зламане визначення в базі не застосовується — лишається попередній реєстр. */
export function applyActiveVersion(v: OntologyVersionRow): void {
  const def = asDef(v);
  const val = validateOntology(def);
  if (!val.ok) throw new CoreRuleError('bad_input', `Активна версія ${label(v)} не проходить перевірку: ${val.errors[0]?.message}`);
  applyOntology(def, label(v));
}

/** Для тестів: повернути заводський реєстр процесу. */
export function resetActiveRegistry(): void {
  resetRegistry();
}

// ---------------------------------------------------------------------------
// Чернетка й правки (EDIT → DRAFT)
// ---------------------------------------------------------------------------

export async function createDraft(repo: CoreRepository, input: { actor: CoreActor; basedOn?: string; label?: string; notes?: string }): Promise<OntologyVersionRow> {
  checkOntologyActor(input.actor);
  const source = input.basedOn ? await requireVersion(repo, input.basedOn) : await requireActive(repo);
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
export async function editDraft(repo: CoreRepository, id: string, input: { actor: CoreActor; ops: OntologyOp[]; expectedRevision?: number }): Promise<OntologyVersionRow> {
  checkOntologyActor(input.actor);
  const draft = await requireDraft(repo, id);
  const next = applyOps(asDef(draft), input.ops);
  const updated = await repo.updateOntologyVersion(
    id,
    { definition: next as unknown as Record<string, unknown>, definitionHash: definitionHash(next), status: 'draft', validation: null, impact: null },
    input.expectedRevision,
  );
  await repo.addOntologyEvent({ ontologyId: draft.ontologyId, versionId: id, action: 'edit', actor: input.actor, details: { ops: input.ops.map((o) => ({ op: o.op, id: 'id' in o ? o.id : 'value' in o ? o.value?.id : undefined })) } });
  return updated;
}

// ---------------------------------------------------------------------------
// VALIDATE · PREVIEW · MIGRATION IMPACT
// ---------------------------------------------------------------------------

export async function validateDraft(repo: CoreRepository, id: string, actor: CoreActor): Promise<{ version: OntologyVersionRow; validation: OntologyValidation }> {
  checkOntologyActor(actor);
  const draft = await requireDraft(repo, id);
  const validation = validateOntology(asDef(draft));
  const stored = { ...validation, hash: draft.definitionHash, at: new Date().toISOString() };
  const version = await repo.updateOntologyVersion(id, { validation: stored, status: validation.ok ? 'validated' : 'draft' });
  await repo.addOntologyEvent({ ontologyId: draft.ontologyId, versionId: id, action: 'validate', actor, details: { ok: validation.ok, errors: validation.errors.length, warnings: validation.warnings.length } });
  return { version, validation };
}

export interface OntologyPreview {
  version: number;
  against: number;
  diff: OntologyDiff;
  /** Як тип виглядатиме в інтерфейсі після публікації — для змінених і доданих. */
  ui: { id: string; before: { name: LocalizedName; color: string; status: OntologyStatus } | null; after: { name: LocalizedName; color: string; status: OntologyStatus } | null }[];
  counts: { entityTypes: number; activeEntityTypes: number; relationTypes: number; groups: number };
}

export async function previewDraft(repo: CoreRepository, id: string): Promise<OntologyPreview> {
  const draft = await requireDraft(repo, id);
  const active = await requireActive(repo, draft.ontologyId);
  const before = asDef(active);
  const after = asDef(draft);
  const diff = diffOntologies(before, after);
  const pick = (d: OntologyDefinition, tid: string) => {
    const t = d.entityTypes.find((x) => x.id === tid);
    return t ? { name: t.name, color: t.ui.color, status: t.status } : null;
  };
  const touched = [...diff.entityTypes.added, ...diff.entityTypes.removed, ...diff.entityTypes.changed.map((c) => c.id)];
  return {
    version: draft.version,
    against: active.version,
    diff,
    ui: touched.map((tid) => ({ id: tid, before: pick(before, tid), after: pick(after, tid) })),
    counts: { entityTypes: after.entityTypes.length, activeEntityTypes: after.entityTypes.filter((t) => t.status === 'active').length, relationTypes: after.relationTypes.length, groups: after.groups.length },
  };
}

export interface OntologyImpactItem {
  kind: 'entity_type' | 'relation_type';
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
  const impact = computeImpact(asDef(active), asDef(draft), await repo.ontologyUsage(), draft.definitionHash, active.version);
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
  const before = asDef(active);
  const after = asDef(draft);
  if (!diffOntologies(before, after).changed) throw new OntologyPublishError('Чернетка нічим не відрізняється від активної версії', { step: 'diff' });
  const fresh = computeImpact(before, after, await repo.ontologyUsage(), draft.definitionHash, active.version);
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
