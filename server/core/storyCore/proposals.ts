/**
 * Пропозиції до канону (Т5.3 В1, `PLAN_STORY_CORE.md`; ТЗ Graph Studio
 * §24 стани, §25 походження, §39 №14–16).
 *
 * Шлях пропозиції: detected → proposed → validated → approved → canon;
 * збоку — rejected і superseded. AI (і вузли процесів ШІ) лише створюють
 * пропозиції з доказами; перевірка — щодо АКТИВНОЇ версії онтології;
 * схвалює й записує в канон людина (право — у Story Core API, В2). Запис у
 * канон — це справжні `entities` / `entity_relations` (нова ревізія з
 * журналом версій ядра), а пропозиція лише посилається на запис (§23).
 *
 * Права тут не перевіряються — лише правила ядра (хто з акторів що може);
 * хто з людей має право — вирішує `storyCore/api.ts`.
 */

import type {
  CoreActor,
  CoreRepository,
  EntityProposalPayload,
  EntityRow,
  ProposalIssue,
  ProposalKind,
  ProposalProvenance,
  ProposalValidation,
  RelationProposalPayload,
  StoryProposalRow,
} from '../types';
import { OPEN_PROPOSAL_STATES } from '../types';
import { CoreRuleError, isAiActor, normalizeAlias, assertActor } from '../rules';
import { evidenceRefs } from '../storyGraph';
import { FUSION_ONTOLOGY_ID, factoryOntology, type OntologyDefinition, type OntologyEntityType } from '../../../src/utils/ontology';

export const PROPOSAL_NAME_MAX = 200;
export const PROPOSAL_NOTE_MAX = 1000;
export const PROPOSAL_CANONICAL_MAX_KEYS = 100;

// ---------------------------------------------------------------------------
// Ключі дублів і нормалізація змісту
// ---------------------------------------------------------------------------

export const entityDedupeKey = (type: string, name: string) => `entity:${type}:${normalizeAlias(name)}`.slice(0, 400);
export const entityEditKey = (targetId: string) => `entity-edit:${targetId}`;
export const relationDedupeKey = (type: string, fromId: string, toId: string) => `relation:${type}:${fromId}:${toId}`;

export function dedupeKeyOf(kind: ProposalKind, payload: EntityProposalPayload | RelationProposalPayload): string {
  if (kind === 'entity') {
    const p = payload as EntityProposalPayload;
    return p.targetId ? entityEditKey(p.targetId) : entityDedupeKey(p.type, p.name);
  }
  const r = payload as RelationProposalPayload;
  return relationDedupeKey(r.type, r.fromId, r.toId);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Зміст із запиту → нормалізований зміст пропозиції (структурні помилки — одразу 422). */
export function normalizePayload(kind: ProposalKind, raw: unknown): EntityProposalPayload | RelationProposalPayload {
  if (!isPlainObject(raw)) throw new CoreRuleError('bad_input', 'Зміст пропозиції — обʼєкт');
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (kind === 'entity') {
    const canonical = raw.canonical === undefined ? {} : raw.canonical;
    if (!isPlainObject(canonical)) throw new CoreRuleError('bad_input', 'Канонічні поля — обʼєкт');
    if (Object.keys(canonical).length > PROPOSAL_CANONICAL_MAX_KEYS) throw new CoreRuleError('bad_input', `Канонічних полів — до ${PROPOSAL_CANONICAL_MAX_KEYS}`);
    const out: EntityProposalPayload = { type: str(raw.type), name: str(raw.name), canonical: JSON.parse(JSON.stringify(canonical)) };
    if (!out.type) throw new CoreRuleError('bad_input', 'Не вказано тип сутності');
    if (!out.name) throw new CoreRuleError('bad_input', 'Не вказано назву сутності');
    if (raw.targetId != null && raw.targetId !== '') out.targetId = str(raw.targetId);
    return out;
  }
  if (kind === 'relation') {
    const out: RelationProposalPayload = { type: str(raw.type), fromId: str(raw.fromId), toId: str(raw.toId), note: str(raw.note).slice(0, PROPOSAL_NOTE_MAX) };
    if (!out.type) throw new CoreRuleError('bad_input', 'Не вказано тип зв\'язку');
    if (!out.fromId || !out.toId) throw new CoreRuleError('bad_input', 'Потрібні початок і кінець зв\'язку');
    return out;
  }
  throw new CoreRuleError('bad_input', 'Пропозиція — сутності (entity) чи зв\'язку (relation)');
}

// ---------------------------------------------------------------------------
// Активна онтологія
// ---------------------------------------------------------------------------

export interface ActiveOntology {
  def: OntologyDefinition;
  /** Номер активної версії; null — реєстр схем ще порожній (заводський реєстр). */
  version: number | null;
}

export async function activeOntology(repo: CoreRepository): Promise<ActiveOntology> {
  const v = await repo.getActiveOntologyVersion(FUSION_ONTOLOGY_ID);
  if (v?.definition) return { def: v.definition as unknown as OntologyDefinition, version: v.version };
  return { def: factoryOntology(), version: null };
}

// ---------------------------------------------------------------------------
// Перевірка (validate_entity / validate_relation)
// ---------------------------------------------------------------------------

export interface ValidateInput {
  projectId: string;
  kind: ProposalKind;
  payload: EntityProposalPayload | RelationProposalPayload;
  evidence: string[];
  /** Сама пропозиція (щоб не вважати себе дублем). */
  proposalId?: string | null;
}

const emptyish = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/**
 * Перевірити зміст пропозиції щодо активної онтології й даних книги.
 * Помилки — не можна схвалити; попередження — до відома людині.
 */
export async function validatePayload(repo: CoreRepository, input: ValidateInput, onto?: ActiveOntology): Promise<ProposalValidation> {
  const { def, version } = onto ?? (await activeOntology(repo));
  const errors: ProposalIssue[] = [];
  const warnings: ProposalIssue[] = [];
  const err = (code: string, message: string, field?: string) => errors.push({ code, message, ...(field ? { field } : {}) });
  const warn = (code: string, message: string, field?: string) => warnings.push({ code, message, ...(field ? { field } : {}) });

  // Докази — живі абзаци цієї книги.
  if (input.evidence.length) {
    const live = new Set((await evidenceRefs(repo, input.projectId, input.evidence)).map((e) => e.paragraphId));
    const missing = input.evidence.filter((id) => !live.has(id));
    if (missing.length) err('missing_evidence', `Абзаців-доказів немає в книзі (або їх видалено): ${missing.slice(0, 5).join(', ')}`, 'evidence');
  }

  // Відкриті пропозиції з тим самим ключем.
  const key = dedupeKeyOf(input.kind, input.payload);
  const open = (await repo.listStoryProposals(input.projectId, { dedupeKey: key, states: [...OPEN_PROPOSAL_STATES], limit: 5 })).filter((p) => p.id !== input.proposalId);
  if (open.length) err('duplicate_proposal', 'Така пропозиція вже чекає рішення', 'payload');

  if (input.kind === 'entity') {
    const p = input.payload as EntityProposalPayload;
    const type = def.entityTypes.find((t) => t.id === p.type);
    if (!type) err('unknown_entity_type', `Типу сутності «${p.type}» немає в онтології${version ? ` v${version}` : ''}`, 'type');
    else if (type.status === 'deprecated') err('deprecated_entity_type', `Тип «${type.name.uk}» застарілий — нових сутностей цього типу не створюють`, 'type');
    if (!p.name.trim() || p.name.length > PROPOSAL_NAME_MAX) err('bad_name', `Назва — від 1 до ${PROPOSAL_NAME_MAX} символів`, 'name');

    let target: EntityRow | null = null;
    if (p.targetId) {
      target = await repo.getEntity(input.projectId, p.targetId);
      if (!target || target.status === 'rejected') err('unknown_target', 'Сутності, яку уточнює пропозиція, немає в книзі', 'targetId');
      else if (target.type !== p.type) err('target_type_mismatch', `Сутність «${target.name}» — типу «${target.type}», а не «${p.type}»`, 'type');
    }
    if (type) await checkProperties(repo, input.projectId, def, type, p, target, err, warn);

    // Дубль у каноні — та сама назва того самого типу.
    if (type) {
      const norm = normalizeAlias(p.name);
      const same = (await repo.listEntities(input.projectId, p.type)).find((e) => e.status !== 'rejected' && e.id !== p.targetId && normalizeAlias(e.name) === norm);
      if (same) {
        if (same.status === 'confirmed') err('duplicate_entity', `Сутність «${same.name}» уже є в каноні — запропонуйте уточнення наявної`, 'name');
        else warn('suggested_entity_exists', `Сутність «${same.name}» уже запропонована (AI-1) — запис у канон підтвердить її`, 'name');
      }
    }
  } else {
    const r = input.payload as RelationProposalPayload;
    const rel = def.relationTypes.find((t) => t.id === r.type);
    if (!rel) err('unknown_relation_type', `Типу зв'язку «${r.type}» немає в онтології${version ? ` v${version}` : ''}`, 'type');
    else if (rel.status === 'deprecated') err('deprecated_relation_type', `Зв'язок «${rel.name.uk}» застарілий — нових не створюють`, 'type');
    if (r.fromId === r.toId) err('self_relation', 'Початок і кінець зв\'язку — та сама сутність', 'toId');
    const [from, to] = await Promise.all([repo.getEntity(input.projectId, r.fromId), repo.getEntity(input.projectId, r.toId)]);
    if (!from || from.status === 'rejected') err('unknown_from', 'Початкової сутності немає в книзі', 'fromId');
    if (!to || to.status === 'rejected') err('unknown_to', 'Кінцевої сутності немає в книзі', 'toId');
    if (rel && from && to) {
      const endpoint = (list: string[] | null | undefined, e: EntityRow, end: 'from' | 'to', field: 'fromId' | 'toId') => {
        if (list && list.length && !list.includes(e.type)) err('bad_endpoint', `«${rel.name.uk}»: ${end === 'from' ? 'початок' : 'кінець'} — ${list.join(', ')}, а «${e.name}» — ${e.type}`, field);
      };
      endpoint(rel.from, from, 'from', 'fromId');
      endpoint(rel.to, to, 'to', 'toId');
      for (const rule of def.validationRules ?? []) {
        if (rule.kind !== 'relation_endpoints' || rule.target !== 'relation') continue;
        if (rule.appliesTo && !rule.appliesTo.includes(rel.id)) continue;
        const params = (rule.params ?? {}) as { from?: string[]; to?: string[] };
        const bad = (Array.isArray(params.from) && params.from.length && !params.from.includes(from.type)) || (Array.isArray(params.to) && params.to.length && !params.to.includes(to.type));
        if (bad) err('rule_relation_endpoints', rule.message?.uk || `Правило «${rule.id}»: недозволені кінці зв'язку`, 'type');
      }
      if (from.status === 'suggested' || to.status === 'suggested') warn('suggested_endpoint', 'Один із кінців — ще не підтверджена сутність (запропонована AI-1)', 'fromId');
    }
    if (from && to) {
      const existing = (await repo.listRelations(input.projectId, r.fromId)).find((x) => x.fromId === r.fromId && x.toId === r.toId && x.type === r.type && x.status !== 'rejected');
      if (existing?.status === 'confirmed') err('duplicate_relation', 'Такий зв\'язок уже є в каноні', 'type');
      else if (existing) warn('suggested_relation_exists', 'Такий зв\'язок уже запропонував AI-1 — запис у канон підтвердить його', 'type');
    }
    if (r.note.length > PROPOSAL_NOTE_MAX) err('bad_note', `Примітка — до ${PROPOSAL_NOTE_MAX} символів`, 'note');
  }
  return { ok: errors.length === 0, errors, warnings, ontologyVersion: version, at: new Date().toISOString() };
}

async function checkProperties(
  repo: CoreRepository,
  projectId: string,
  def: OntologyDefinition,
  type: OntologyEntityType,
  p: EntityProposalPayload,
  target: EntityRow | null,
  err: (code: string, message: string, field?: string) => void,
  warn: (code: string, message: string, field?: string) => void,
): Promise<void> {
  const props = new Map(type.properties.map((x) => [x.id, x]));
  // Уточнення наявної сутності — поля зливаються з її каноном.
  const merged: Record<string, unknown> = { ...(target?.canonical ?? {}), ...p.canonical };
  for (const [k, v] of Object.entries(p.canonical)) {
    const prop = props.get(k);
    const field = `canonical.${k}`;
    if (!prop) {
      warn('unknown_property', `У типу «${type.name.uk}» немає властивості «${k}»`, field);
      continue;
    }
    if (emptyish(v)) continue;
    if (prop.type === 'number' && !(typeof v === 'number' && Number.isFinite(v))) err('bad_property', `«${prop.name.uk}» — число`, field);
    if (prop.type === 'text' && typeof v !== 'string' && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) err('bad_property', `«${prop.name.uk}» — текст`, field);
    if (prop.type === 'enum') {
      const values = def.enums.find((e) => e.id === prop.enumId)?.values.map((x) => x.id) ?? [];
      if (!values.includes(String(v))) err('bad_enum_value', `«${prop.name.uk}»: значення «${String(v)}» немає в переліку`, field);
    }
    if (prop.type === 'entity_ref') {
      const ref = typeof v === 'string' ? await repo.getEntity(projectId, v) : null;
      if (!ref || ref.status === 'rejected') err('bad_entity_ref', `«${prop.name.uk}»: сутності «${String(v)}» немає в книзі`, field);
      else if (prop.refTypes?.length && !prop.refTypes.includes(ref.type)) err('bad_entity_ref', `«${prop.name.uk}»: потрібен тип ${prop.refTypes.join(', ')}, а «${ref.name}» — ${ref.type}`, field);
    }
  }
  const required = new Set(type.properties.filter((x) => x.required).map((x) => x.id));
  for (const rule of def.validationRules ?? []) {
    if (rule.kind !== 'required_property' || rule.target !== 'entity') continue;
    if (rule.appliesTo && !rule.appliesTo.includes(type.id)) continue;
    const prop = String((rule.params ?? {}).property ?? '');
    if (props.has(prop)) required.add(prop);
  }
  for (const id of required) if (emptyish(merged[id])) err('required_property', `Обовʼязкова властивість «${props.get(id)?.name.uk ?? id}» не заповнена`, `canonical.${id}`);
}

// ---------------------------------------------------------------------------
// Життєвий цикл
// ---------------------------------------------------------------------------

export interface CreateProposalInput {
  projectId: string;
  kind: ProposalKind;
  payload: unknown;
  evidence?: string[];
  confidence?: number | null;
  provenance?: ProposalProvenance;
  /** AI може залишити пропозицію «виявленою» (нижче порогу впевненості). */
  state?: 'detected' | 'proposed';
  actor: CoreActor;
  /** Одразу перевірити: успіх → `validated`, інакше лишається з результатом перевірки. */
  validate?: boolean;
  /** T5.8: actual prompt used for a public workflow proposal; private tools never pass it. */
  feedbackContext?: Record<string, unknown>;
}

/** Походження §25: джерело, версія онтології, модель і промпт прогону (якщо є). */
async function fillProvenance(repo: CoreRepository, projectId: string, actor: CoreActor, raw: ProposalProvenance | undefined, ontologyVersion: number | null): Promise<ProposalProvenance> {
  const p: ProposalProvenance = isPlainObject(raw) ? JSON.parse(JSON.stringify(raw)) : {};
  if (JSON.stringify(p).length > 20000) throw new CoreRuleError('bad_input', 'Походження — до 20 000 символів');
  if (!p.source) p.source = p.workflowId ? 'workflow' : isAiActor(actor) ? 'ai' : 'author';
  if (p.ontologyVersion == null && ontologyVersion != null) p.ontologyVersion = ontologyVersion;
  if (p.runId) {
    const run = await repo.getRun(projectId, String(p.runId)).catch(() => null);
    if (run) {
      if (!p.model) p.model = run.model;
      if (!p.promptVersion) p.promptVersion = run.promptVersion;
    }
  }
  return p;
}

function cleanEvidence(e: unknown): string[] {
  if (e === undefined || e === null) return [];
  if (!Array.isArray(e)) throw new CoreRuleError('bad_input', 'Докази — масив id абзаців');
  return [...new Set(e.map((x) => String(x).trim()).filter(Boolean))];
}

async function log(repo: CoreRepository, p: StoryProposalRow, action: Parameters<CoreRepository['addStoryProposalEvent']>[0]['action'], actor: CoreActor, fromState: StoryProposalRow['state'] | null, details: Record<string, unknown> = {}) {
  await repo.addStoryProposalEvent({ projectId: p.projectId, proposalId: p.id, action, actor, fromState, toState: p.state, details });
}

/** create_entity_proposal / create_relation_proposal. */
export async function createProposal(repo: CoreRepository, input: CreateProposalInput): Promise<StoryProposalRow> {
  assertActor(input.actor);
  const payload = normalizePayload(input.kind, input.payload);
  const onto = await activeOntology(repo);
  const evidence = cleanEvidence(input.evidence);
  let row = await repo.addStoryProposal({
    projectId: input.projectId,
    kind: input.kind,
    payload,
    dedupeKey: dedupeKeyOf(input.kind, payload),
    state: input.state ?? 'proposed',
    evidence,
    confidence: input.confidence ?? null,
    provenance: await fillProvenance(repo, input.projectId, input.actor, input.provenance, onto.version),
    createdBy: input.actor,
  });
  await log(repo, row, 'create', input.actor, null, { provenance: row.provenance, confidence: row.confidence, aiProposal: row.payload, ...(input.feedbackContext ? {inputContext:input.feedbackContext} : {}) });
  if (input.validate) {
    // Перевірку від імені AI записує система (стан змінює не AI, §24).
    row = await validateProposal(repo, input.projectId, row.id, isAiActor(input.actor) ? 'system:story-core' : input.actor, onto);
  }
  return row;
}

async function requireProposal(repo: CoreRepository, projectId: string, id: string): Promise<StoryProposalRow> {
  const p = await repo.getStoryProposal(projectId, id);
  if (!p) throw new CoreRuleError('not_found', 'Пропозицію не знайдено');
  return p;
}

/** detected → proposed: людина чи система вважає виявлене вартим розгляду. */
export async function promoteProposal(repo: CoreRepository, projectId: string, id: string, actor: CoreActor): Promise<StoryProposalRow> {
  const p = await requireProposal(repo, projectId, id);
  if (p.state !== 'detected') throw new CoreRuleError('conflict', `Висунути можна лише виявлену пропозицію, а ця — «${p.state}»`);
  const out = await repo.updateStoryProposal(projectId, id, { state: 'proposed' }, actor, p.revision);
  await log(repo, out, 'propose', actor, p.state);
  return out;
}

/**
 * validate_entity / validate_relation: перевірка щодо активної онтології.
 * Успіх → `validated`; невдача → лишається (перевірена — повертається в
 * `proposed`), результат зберігається.
 */
export async function validateProposal(repo: CoreRepository, projectId: string, id: string, actor: CoreActor, onto?: ActiveOntology): Promise<StoryProposalRow> {
  const p = await requireProposal(repo, projectId, id);
  if (!OPEN_PROPOSAL_STATES.includes(p.state)) throw new CoreRuleError('conflict', `Пропозиція вже в кінцевому стані «${p.state}»`);
  const validation = await validatePayload(repo, { projectId, kind: p.kind, payload: p.payload, evidence: p.evidence, proposalId: p.id }, onto);
  let state = p.state;
  if (validation.ok && (p.state === 'detected' || p.state === 'proposed')) state = 'validated';
  if (!validation.ok && (p.state === 'validated' || p.state === 'approved')) state = 'proposed';
  const out = await repo.updateStoryProposal(projectId, id, { validation, state }, actor, p.revision);
  await log(repo, out, 'validate', actor, p.state, { ok: validation.ok, errors: validation.errors.map((e) => e.code), ontologyVersion: validation.ontologyVersion });
  return out;
}

/** Правка змісту людиною (Human Review: Edit, №15): перевірка скидається, стан — `proposed`. */
export async function editProposal(
  repo: CoreRepository,
  projectId: string,
  id: string,
  input: { payload?: unknown; evidence?: string[]; actor: CoreActor; expectedRevision?: number },
): Promise<StoryProposalRow> {
  const p = await requireProposal(repo, projectId, id);
  if (isAiActor(input.actor)) throw new CoreRuleError('ai_suggests_only', 'Пропозицію правлять люди; AI пропонує нову');
  if (!OPEN_PROPOSAL_STATES.includes(p.state)) throw new CoreRuleError('conflict', `Пропозиція вже в кінцевому стані «${p.state}»`);
  const merged = input.payload === undefined ? p.payload : normalizePayload(p.kind, { ...(p.payload as unknown as Record<string, unknown>), ...(isPlainObject(input.payload) ? input.payload : {}) });
  const evidence = input.evidence === undefined ? p.evidence : cleanEvidence(input.evidence);
  const before = p.authorEdit?.before ?? (p.payload as unknown as Record<string, unknown>);
  const fields = changedFields(before, merged as unknown as Record<string, unknown>);
  if (input.evidence !== undefined && JSON.stringify(evidence) !== JSON.stringify(p.evidence)) fields.push('evidence');
  const out = await repo.updateStoryProposal(
    projectId,
    id,
    {
      payload: merged,
      evidence,
      dedupeKey: dedupeKeyOf(p.kind, merged),
      validation: null,
      state: 'proposed',
      authorEdit: fields.length ? { before, after: merged as unknown as Record<string, unknown>, fields } : p.authorEdit,
    },
    input.actor,
    input.expectedRevision ?? p.revision,
  );
  await log(repo, out, 'edit', input.actor, p.state, { fields });
  return out;
}

function changedFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'canonical' && isPlainObject(a[k]) && isPlainObject(b[k])) {
      for (const f of changedFields(a[k] as Record<string, unknown>, b[k] as Record<string, unknown>)) out.push(`canonical.${f}`);
    } else if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) out.push(k);
  }
  return out;
}

/**
 * approve_proposal (Human Review: Accept / Edit, №15): з правкою автора,
 * якщо є; перед схваленням — свіжа перевірка; `writeCanon` — одразу й у канон.
 */
export async function approveProposal(
  repo: CoreRepository,
  projectId: string,
  id: string,
  input: { actor: CoreActor; edits?: { payload?: unknown; evidence?: string[] }; reason?: string; writeCanon?: boolean; expectedRevision?: number },
): Promise<{ proposal: StoryProposalRow; canon?: CanonWriteResult }> {
  if (isAiActor(input.actor)) throw new CoreRuleError('ai_suggests_only', 'Схвалює людина, а не AI');
  let p = await requireProposal(repo, projectId, id);
  if (input.expectedRevision !== undefined && p.revision !== input.expectedRevision) throw new CoreRuleError('conflict', `Пропозицію вже змінено (ревізія ${p.revision}, а не ${input.expectedRevision}) — перечитайте її`);
  if (p.state === 'approved' && !input.edits) {
    if (!input.writeCanon) return { proposal: p };
    const w = await writeCanon(repo, projectId, id, { actor: input.actor });
    return { proposal: w.proposal, canon: w };
  }
  if (input.edits && (input.edits.payload !== undefined || input.edits.evidence !== undefined)) p = await editProposal(repo, projectId, id, { ...input.edits, actor: input.actor });
  if (p.state !== 'validated') p = await validateProposal(repo, projectId, id, input.actor);
  if (p.state !== 'validated') {
    const msg = p.validation?.errors.map((e) => e.message).join('; ') || 'перевірка не пройдена';
    throw new CoreRuleError('bad_input', `Пропозицію не схвалено: ${msg}`);
  }
  const out = await repo.updateStoryProposal(projectId, id, { state: 'approved', reason: (input.reason ?? '').slice(0, 2000) }, input.actor, p.revision);
  await log(repo, out, 'approve', input.actor, p.state, { reason: out.reason, authorEdit: out.authorEdit?.fields ?? [] });
  if (!input.writeCanon) return { proposal: out };
  const w = await writeCanon(repo, projectId, id, { actor: input.actor });
  return { proposal: w.proposal, canon: w };
}

/** reject_proposal (Human Review: Reject, №15). */
export async function rejectProposal(repo: CoreRepository, projectId: string, id: string, input: { actor: CoreActor; reason?: string; expectedRevision?: number }): Promise<StoryProposalRow> {
  const p = await requireProposal(repo, projectId, id);
  const out = await repo.updateStoryProposal(projectId, id, { state: 'rejected', reason: (input.reason ?? '').slice(0, 2000) }, input.actor, input.expectedRevision ?? p.revision);
  await log(repo, out, 'reject', input.actor, p.state, { reason: out.reason });
  return out;
}

export interface CanonWriteResult {
  proposal: StoryProposalRow;
  recordKind: ProposalKind;
  recordId: string;
  /** false — підтверджено наявний запис (пропозицію AI-1) чи уточнено сутність. */
  created: boolean;
  recordVersion?: number;
}

/**
 * write_canon (CANON_WRITE, №16): схвалена пропозиція → підтверджений запис
 * ядра від імені людини (нова ревізія в журналі версій ядра) + посилання й
 * подія з походженням. Перед записом — свіжа перевірка: канон міг змінитися.
 */
export async function writeCanon(repo: CoreRepository, projectId: string, id: string, input: { actor: CoreActor }): Promise<CanonWriteResult> {
  if (isAiActor(input.actor)) throw new CoreRuleError('ai_suggests_only', 'У канон записує людина, а не AI');
  assertActor(input.actor);
  const p = await requireProposal(repo, projectId, id);
  if (p.state !== 'approved') throw new CoreRuleError('conflict', `У канон записується лише схвалена пропозиція, а ця — «${p.state}»`);
  const check = await validatePayload(repo, { projectId, kind: p.kind, payload: p.payload, evidence: p.evidence, proposalId: p.id });
  if (!check.ok) {
    const back = await repo.updateStoryProposal(projectId, id, { validation: check, state: 'proposed' }, input.actor, p.revision);
    await log(repo, back, 'validate', input.actor, p.state, { ok: false, errors: check.errors.map((e) => e.code), beforeCanon: true });
    throw new CoreRuleError('conflict', `Канон змінився — пропозицію треба переглянути: ${check.errors.map((e) => e.message).join('; ')}`);
  }
  const reason = `Пропозиція ${p.id} (${String(p.provenance.source ?? 'author')})`;
  let recordId: string;
  let canonPayload:EntityProposalPayload|RelationProposalPayload=p.payload;
  let created = false;
  let recordVersion: number | undefined;
  let undo: (() => Promise<unknown>) | null = null;
  if (p.kind === 'entity') {
    const e = p.payload as EntityProposalPayload;
    const existing = e.targetId
      ? await repo.getEntity(projectId, e.targetId)
      : (await repo.listEntities(projectId, e.type)).find((x) => x.status === 'suggested' && normalizeAlias(x.name) === normalizeAlias(e.name)) ?? null;
    if (existing) {
      let row = existing;
      if (e.targetId || Object.keys(e.canonical).length || existing.name !== e.name) {
        row = await repo.updateEntity(projectId, existing.id, { name: e.name, canonical: { ...existing.canonical, ...e.canonical } }, input.actor, reason);
      }
      if (row.status !== 'confirmed') row = await repo.setEntityStatus(projectId, existing.id, 'confirmed', input.actor, reason);
      canonPayload={...e,type:row.type,name:row.name,canonical:row.canonical};
      recordId = row.id;
      recordVersion = row.version;
    } else {
      const row = await repo.createEntity({ projectId, type: e.type, name: e.name, canonical: e.canonical, status: 'confirmed', createdBy: input.actor });
      canonPayload={...e,type:row.type,name:row.name,canonical:row.canonical};
      recordId = row.id;
      recordVersion = row.version;
      created = true;
      undo = () => repo.setEntityStatus(projectId, row.id, 'rejected', input.actor, `${reason}: запис у канон не завершено`);
    }
  } else {
    const r = p.payload as RelationProposalPayload;
    const existing = (await repo.listRelations(projectId, r.fromId)).find((x) => x.fromId === r.fromId && x.toId === r.toId && x.type === r.type && x.status === 'suggested');
    if (existing) {
      const row = await repo.setRelationStatus(projectId, existing.id, 'confirmed', input.actor, reason);
      canonPayload={type:row.type,fromId:row.fromId,toId:row.toId,note:row.note};
      recordId = row.id;
      recordVersion = row.version;
    } else {
      const row = await repo.createRelation({ projectId, type: r.type, fromId: r.fromId, toId: r.toId, evidence: p.evidence, note: r.note, status: 'confirmed', createdBy: input.actor });
      canonPayload={type:row.type,fromId:row.fromId,toId:row.toId,note:row.note};
      recordId = row.id;
      recordVersion = row.version;
      created = true;
      undo = () => repo.setRelationStatus(projectId, row.id, 'rejected', input.actor, `${reason}: запис у канон не завершено`);
    }
  }
  let out: StoryProposalRow;
  try {
    out = await repo.updateStoryProposal(projectId, id, { state: 'canon', canonRef: recordId }, input.actor, p.revision);
  } catch (err) {
    // Хтось устиг змінити пропозицію — новий запис не лишаємо в каноні.
    if (undo) await undo().catch(() => {});
    throw err;
  }
  await log(repo, out, 'write_canon', input.actor, p.state, { recordKind: p.kind, recordId, created, recordVersion, provenance: p.provenance, authorEdit: p.authorEdit?.fields ?? [], finalCanon:{recordId,payload:canonPayload} });
  return { proposal: out, recordKind: p.kind, recordId, created, recordVersion };
}

/**
 * Заміна (SUPERSEDED, §24): нова пропозиція (новіший прогін, інший процес)
 * стає на місце відкритої — стара закривається з посиланням на нову.
 */
export async function supersedeProposal(
  repo: CoreRepository,
  projectId: string,
  oldId: string,
  input: Pick<CreateProposalInput, 'evidence' | 'confidence' | 'provenance' | 'state' | 'actor'> & { payload?: unknown; by: CoreActor },
): Promise<{ old: StoryProposalRow; created: StoryProposalRow }> {
  assertActor(input.actor);
  const old = await requireProposal(repo, projectId, oldId);
  const payload = normalizePayload(old.kind, input.payload ?? old.payload);
  const onto = await activeOntology(repo);
  const res = await repo.supersedeStoryProposal(projectId, oldId, {
    projectId,
    kind: old.kind,
    payload,
    dedupeKey: dedupeKeyOf(old.kind, payload),
    state: input.state ?? 'proposed',
    evidence: cleanEvidence(input.evidence ?? old.evidence),
    confidence: input.confidence ?? null,
    provenance: { ...(await fillProvenance(repo, projectId, input.actor, input.provenance, onto.version)), supersedes: oldId },
    createdBy: input.actor,
  }, input.by);
  await log(repo, res.old, 'supersede', input.by, old.state, { supersededBy: res.created.id });
  await log(repo, res.created, 'create', input.actor, null, { provenance: res.created.provenance, supersedes: oldId });
  return res;
}

/** Картка пропозиції: сама пропозиція, журнал, докази з уривками. */
export async function proposalDetails(repo: CoreRepository, projectId: string, id: string) {
  const p = await requireProposal(repo, projectId, id);
  const [events, evidence] = await Promise.all([repo.listStoryProposalEvents(projectId, { proposalId: id }), evidenceRefs(repo, projectId, p.evidence)]);
  return { proposal: p, events, evidence };
}
