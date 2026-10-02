/**
 * Story Core API (Т5.3 В2, `PLAN_STORY_CORE.md`; ТЗ Graph Studio §33, №13).
 *
 * Графи (процеси ШІ, Т5.4) і Graph Studio не отримують довільного SQL — лише
 * ці операції. Кожна має вид, від якого залежить потрібне право:
 *   • read     — читання книги (учасник без обмеженого доступу, власник, адмін);
 *   • propose  — пропозиції (редагування книги);
 *   • decide   — схвалення, відхилення, запис у канон (`CANON_WRITE`): власник
 *                книги, адмін або наданий доступ «схвалення» чи вищий на книгу;
 *   • schema   — публікація й відкат онтології (`PUBLISH_SCHEMA`).
 * AI рішень не ухвалює й схем не публікує за жодних прав (§24, §37).
 *
 * Внутрішній виклик — `callStoryCore(op, ctx, args)`: процес ШІ сам складає
 * права свого запуску; HTTP — `routes.ts` (права з доступу до книги).
 */

import type { CoreActor, CoreRepository, ProposalKind, ProposalState, StoryProposalRow } from '../types';
import { PROPOSAL_STATES } from '../types';
import { CoreRuleError, isAiActor, normalizeAlias } from '../rules';
import { buildStoryGraph, evidenceRefs } from '../storyGraph';
import { MENTION_SUGGESTION, RELATION_SUGGESTION, publicSuggestion } from '../ai/mentions';
import { publishDraft, rollbackTo } from '../ontology/lifecycle';
import { FUSION_ONTOLOGY_ID } from '../../../src/utils/ontology';
import {
  activeOntology,
  approveProposal,
  createProposal,
  normalizePayload,
  proposalDetails,
  rejectProposal,
  validatePayload,
  validateProposal,
  writeCanon,
} from './proposals';

export type StoryCoreOpKind = 'read' | 'propose' | 'decide' | 'schema';

export interface StoryCoreRights {
  read: boolean;
  propose: boolean;
  /** `CANON_WRITE`: схвалення, відхилення, запис у канон. */
  approve: boolean;
  /** `PUBLISH_SCHEMA`. */
  publishSchema: boolean;
  /** Бачить висновки AI з видимістю «лише автор» (власник, адмін). */
  authorOnly?: boolean;
}

export interface StoryCoreContext {
  repo: CoreRepository;
  actor: CoreActor;
  /** Книга; для операцій схеми — не потрібна. */
  projectId: string | null;
  rights: StoryCoreRights;
}

export interface StoryCoreOpDef {
  id: string;
  name: { en: string; uk: string };
  kind: StoryCoreOpKind;
  /** Операція над книгою (потрібен projectId). */
  project: boolean;
  /** Аргументи для довідки (Graph Studio, вузол QUERY). */
  args: string[];
  run(ctx: StoryCoreContext & { projectId: string }, args: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Розбір аргументів
// ---------------------------------------------------------------------------

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const need = (v: unknown, what: string) => {
  const s = str(v);
  if (!s) throw new CoreRuleError('bad_input', `Не вказано ${what}`);
  return s;
};
const list = (v: unknown, max = 50): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);
const int = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? Math.max(min, Math.min(max, n)) : def;
};
const bool = (v: unknown, def = false) => (v === undefined || v === null || v === '' ? def : v === true || v === 'true' || v === '1' || v === 1);
const statesOf = (v: unknown): ProposalState[] => list(v).filter((s): s is ProposalState => (PROPOSAL_STATES as readonly string[]).includes(s));
const revision = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : int(v, 0, 0, 1e9));

async function entityOr404(ctx: StoryCoreContext & { projectId: string }, id: string) {
  const e = await ctx.repo.getEntity(ctx.projectId, id);
  if (!e) throw new CoreRuleError('not_found', 'Сутність не знайдено в цій книзі');
  return e;
}

function proposalArgs(kind: ProposalKind, a: Record<string, unknown>) {
  const payload = kind === 'entity'
    ? { type: a.type, name: a.name, canonical: a.canonical, targetId: a.targetId }
    : { type: a.type, fromId: a.fromId, toId: a.toId, note: a.note };
  return {
    payload,
    evidence: list(a.evidence),
    confidence: a.confidence === undefined || a.confidence === null || a.confidence === '' ? null : Number(a.confidence),
    provenance: (typeof a.provenance === 'object' && a.provenance && !Array.isArray(a.provenance) ? a.provenance : undefined) as Record<string, unknown> | undefined,
    state: a.state === 'detected' ? ('detected' as const) : ('proposed' as const),
    validate: bool(a.validate, true),
  };
}

/** Перевірка: з `proposalId` — змінює стан пропозиції; без нього — лише відповідь (суха перевірка змісту). */
async function validateOp(kind: ProposalKind, ctx: StoryCoreContext & { projectId: string }, a: Record<string, unknown>) {
  if (str(a.proposalId)) {
    const p = await ctx.repo.getStoryProposal(ctx.projectId, str(a.proposalId));
    if (!p || p.kind !== kind) throw new CoreRuleError('not_found', 'Пропозицію не знайдено');
    const actor = isAiActor(ctx.actor) ? 'system:story-core' : ctx.actor;
    const proposal = await validateProposal(ctx.repo, ctx.projectId, p.id, actor);
    return { proposal, validation: proposal.validation };
  }
  const { payload, evidence } = proposalArgs(kind, a);
  return { validation: await validatePayload(ctx.repo, { projectId: ctx.projectId, kind, payload: normalizePayload(kind, payload), evidence }) };
}

// ---------------------------------------------------------------------------
// Реєстр операцій §33 (+ кілька читальних для Graph Studio)
// ---------------------------------------------------------------------------

export const STORY_CORE_OPS: StoryCoreOpDef[] = [
  {
    id: 'get_schema', name: { en: 'Get schema', uk: 'Отримати схему' }, kind: 'read', project: false, args: ['compact'],
    async run(ctx, a) {
      const { def, version } = await activeOntology(ctx.repo);
      if (!bool(a.compact)) return { ontologyId: FUSION_ONTOLOGY_ID, version, definition: def };
      return {
        ontologyId: FUSION_ONTOLOGY_ID,
        version,
        groups: def.groups.map((g) => ({ id: g.id, name: g.name })),
        entityTypes: def.entityTypes.map((t) => ({ id: t.id, name: t.name, groupId: t.groupId, status: t.status, color: t.ui.color, properties: t.properties.map((p) => ({ id: p.id, name: p.name, type: p.type, required: !!p.required, enumId: p.enumId ?? null, refTypes: p.refTypes ?? null })) })),
        relationTypes: def.relationTypes.map((r) => ({ id: r.id, name: r.name, status: r.status, from: r.from, to: r.to, inverse: r.inverse })),
        enums: def.enums,
      };
    },
  },
  {
    id: 'get_schema_version', name: { en: 'Get schema version', uk: 'Отримати версію схеми' }, kind: 'read', project: false, args: [],
    async run(ctx) {
      const v = await ctx.repo.getActiveOntologyVersion(FUSION_ONTOLOGY_ID);
      return v ? { ontologyId: v.ontologyId, version: v.version, label: v.label, hash: v.definitionHash, publishedAt: v.publishedAt, publishedBy: v.publishedBy } : { ontologyId: FUSION_ONTOLOGY_ID, version: null };
    },
  },
  {
    id: 'get_entity', name: { en: 'Get entity', uk: 'Отримати сутність' }, kind: 'read', project: true, args: ['entityId', 'versions'],
    async run(ctx, a) {
      const entity = await entityOr404(ctx, need(a.entityId, 'сутність'));
      const [aliases, versions, mentions] = await Promise.all([
        ctx.repo.listAliases(ctx.projectId, entity.id),
        bool(a.versions, true) ? ctx.repo.listEntityVersions(ctx.projectId, entity.id) : Promise.resolve([]),
        ctx.repo.listMentionsByEntity(ctx.projectId, entity.id),
      ]);
      return { entity, aliases: aliases.map((x) => ({ alias: x.alias, kind: x.kind })), versions, mentions: mentions.filter((m) => m.status !== 'rejected').length };
    },
  },
  {
    id: 'search_entities', name: { en: 'Search entities', uk: 'Знайти сутності' }, kind: 'read', project: true, args: ['query', 'types', 'status', 'limit'],
    async run(ctx, a) {
      const q = normalizeAlias(str(a.query, 200));
      const types = new Set(list(a.types));
      const status = str(a.status);
      const limit = int(a.limit, 50, 1, 500);
      const [entities, aliases, counts] = await Promise.all([ctx.repo.listEntities(ctx.projectId), q ? ctx.repo.listAliases(ctx.projectId) : Promise.resolve([]), ctx.repo.countMentionsByEntity(ctx.projectId)]);
      const byAlias = new Set(aliases.filter((x) => x.aliasNorm.includes(q)).map((x) => x.entityId));
      const out = entities
        .filter((e) => (!types.size || types.has(e.type)) && (status ? e.status === status : e.status !== 'rejected'))
        .filter((e) => !q || normalizeAlias(e.name).includes(q) || byAlias.has(e.id))
        .map((e) => ({ id: e.id, type: e.type, name: e.name, status: e.status, version: e.version, createdBy: e.createdBy, mentions: counts[e.id] ?? 0 }))
        .sort((x, y) => y.mentions - x.mentions || x.name.localeCompare(y.name))
        .slice(0, limit);
      return { entities: out };
    },
  },
  {
    id: 'get_relations', name: { en: 'Get relations', uk: 'Отримати зв\'язки' }, kind: 'read', project: true, args: ['entityId', 'types', 'status'],
    async run(ctx, a) {
      const entityId = str(a.entityId) || undefined;
      const types = new Set(list(a.types));
      const status = str(a.status);
      const rows = (await ctx.repo.listRelations(ctx.projectId, entityId)).filter((r) => (!types.size || types.has(r.type)) && (status ? r.status === status : r.status !== 'rejected'));
      return { relations: rows.slice(0, 1000) };
    },
  },
  {
    id: 'get_mentions', name: { en: 'Get mentions', uk: 'Отримати згадки' }, kind: 'read', project: true, args: ['entityId', 'limit'],
    async run(ctx, a) {
      const entity = await entityOr404(ctx, need(a.entityId, 'сутність'));
      const mentions = (await ctx.repo.listMentionsByEntity(ctx.projectId, entity.id)).filter((m) => m.status !== 'rejected').slice(0, int(a.limit, 100, 1, 1000));
      const sources = await evidenceRefs(ctx.repo, ctx.projectId, [...new Set(mentions.map((m) => m.paragraphId))]);
      const live = new Map(sources.map((s) => [s.paragraphId, s]));
      return { mentions: mentions.filter((m) => live.has(m.paragraphId)).map((m) => ({ ...m, source: live.get(m.paragraphId) })) };
    },
  },
  {
    id: 'get_sources', name: { en: 'Get sources', uk: 'Отримати джерела' }, kind: 'read', project: true, args: ['paragraphIds'],
    async run(ctx, a) {
      return { sources: await evidenceRefs(ctx.repo, ctx.projectId, list(a.paragraphIds, 100)) };
    },
  },
  {
    // Не з §33, але №18: Story Graph — з тих самих справжніх даних.
    id: 'get_graph', name: { en: 'Get story graph', uk: 'Отримати граф твору' }, kind: 'read', project: true, args: ['focus', 'depth', 'types', 'suggested', 'tags', 'limit'],
    async run(ctx, a) {
      return buildStoryGraph(ctx.repo, ctx.projectId, {
        focus: str(a.focus) || undefined,
        depth: int(a.depth, 1, 1, 2),
        types: list(a.types, 200),
        includeSuggested: bool(a.suggested, true),
        includeTagLinks: bool(a.tags, true),
        limit: int(a.limit, 80, 1, 300),
      });
    },
  },
  {
    id: 'list_proposals', name: { en: 'List proposals', uk: 'Перелік пропозицій' }, kind: 'read', project: true, args: ['states', 'kind', 'legacy', 'limit'],
    async run(ctx, a) {
      const kind = a.kind === 'entity' || a.kind === 'relation' ? a.kind : undefined;
      const proposals = await ctx.repo.listStoryProposals(ctx.projectId, { states: statesOf(a.states), kind, limit: int(a.limit, 200, 1, 1000) });
      if (!bool(a.legacy, true)) return { proposals };
      // Пропозиції AI-1 старого шляху (Т1.1) — поруч, як є (рішення власника §2 п.2).
      const [findings, relations] = await Promise.all([ctx.repo.listFindings(ctx.projectId, { status: 'suggested' }), ctx.repo.listRelations(ctx.projectId)]);
      const visible = findings.filter((f) => (f.kind === MENTION_SUGGESTION || f.kind === RELATION_SUGGESTION) && (f.visibility === 'project' || (f.visibility === 'author' && ctx.rights.authorOnly)));
      const paragraphs = new Map((await ctx.repo.listAllParagraphs(ctx.projectId)).map((p) => [p.id, p]));
      const suggestions = visible
        .map((f) => ({ f, p: f.sourceParagraphIds[0] ? paragraphs.get(f.sourceParagraphIds[0]) : undefined }))
        .filter((x) => !x.p?.deletedAt)
        .map((x) => publicSuggestion(x.f, x.p ?? undefined))
        .slice(0, 300);
      const suggestedRelations = relations.filter((r) => r.status === 'suggested').slice(0, 300);
      return { proposals, legacy: { suggestions, relations: suggestedRelations } };
    },
  },
  {
    id: 'get_proposal', name: { en: 'Get proposal', uk: 'Отримати пропозицію' }, kind: 'read', project: true, args: ['proposalId'],
    async run(ctx, a) {
      return proposalDetails(ctx.repo, ctx.projectId, need(a.proposalId, 'пропозицію'));
    },
  },
  {
    id: 'create_entity_proposal', name: { en: 'Create entity proposal', uk: 'Створити пропозицію сутності' }, kind: 'propose', project: true,
    args: ['type', 'name', 'canonical', 'targetId', 'evidence', 'confidence', 'provenance', 'state', 'validate'],
    async run(ctx, a) {
      const p = proposalArgs('entity', a);
      return { proposal: await createProposal(ctx.repo, { projectId: ctx.projectId, kind: 'entity', actor: ctx.actor, ...p }) };
    },
  },
  {
    id: 'create_relation_proposal', name: { en: 'Create relation proposal', uk: 'Створити пропозицію зв\'язку' }, kind: 'propose', project: true,
    args: ['type', 'fromId', 'toId', 'note', 'evidence', 'confidence', 'provenance', 'state', 'validate'],
    async run(ctx, a) {
      const p = proposalArgs('relation', a);
      return { proposal: await createProposal(ctx.repo, { projectId: ctx.projectId, kind: 'relation', actor: ctx.actor, ...p }) };
    },
  },
  {
    id: 'validate_entity', name: { en: 'Validate entity', uk: 'Перевірити сутність' }, kind: 'propose', project: true, args: ['proposalId', 'type', 'name', 'canonical', 'targetId', 'evidence'],
    run: (ctx, a) => validateOp('entity', ctx, a),
  },
  {
    id: 'validate_relation', name: { en: 'Validate relation', uk: 'Перевірити зв\'язок' }, kind: 'propose', project: true, args: ['proposalId', 'type', 'fromId', 'toId', 'note', 'evidence'],
    run: (ctx, a) => validateOp('relation', ctx, a),
  },
  {
    id: 'approve_proposal', name: { en: 'Approve proposal', uk: 'Схвалити пропозицію' }, kind: 'decide', project: true, args: ['proposalId', 'edits', 'reason', 'writeCanon', 'expectedRevision'],
    async run(ctx, a) {
      const edits = typeof a.edits === 'object' && a.edits && !Array.isArray(a.edits) ? (a.edits as { payload?: unknown; evidence?: string[] }) : undefined;
      return approveProposal(ctx.repo, ctx.projectId, need(a.proposalId, 'пропозицію'), { actor: ctx.actor, edits, reason: str(a.reason, 2000), writeCanon: bool(a.writeCanon), expectedRevision: revision(a.expectedRevision) });
    },
  },
  {
    id: 'reject_proposal', name: { en: 'Reject proposal', uk: 'Відхилити пропозицію' }, kind: 'decide', project: true, args: ['proposalId', 'reason', 'expectedRevision'],
    async run(ctx, a) {
      return { proposal: await rejectProposal(ctx.repo, ctx.projectId, need(a.proposalId, 'пропозицію'), { actor: ctx.actor, reason: str(a.reason, 2000), expectedRevision: revision(a.expectedRevision) }) };
    },
  },
  {
    id: 'write_canon', name: { en: 'Write canon', uk: 'Записати в канон' }, kind: 'decide', project: true, args: ['proposalId'],
    async run(ctx, a) {
      return writeCanon(ctx.repo, ctx.projectId, need(a.proposalId, 'пропозицію'), { actor: ctx.actor });
    },
  },
  {
    id: 'publish_schema', name: { en: 'Publish schema', uk: 'Опублікувати схему' }, kind: 'schema', project: false, args: ['draftId'],
    async run(ctx, a) {
      return { version: await publishDraft(ctx.repo, need(a.draftId, 'чернетку онтології'), ctx.actor) };
    },
  },
  {
    id: 'rollback_schema', name: { en: 'Rollback schema', uk: 'Відкотити схему' }, kind: 'schema', project: false, args: ['versionId'],
    async run(ctx, a) {
      return { version: await rollbackTo(ctx.repo, need(a.versionId, 'версію онтології'), ctx.actor) };
    },
  },
];

/** Обов'язкові операції ТЗ §33 — для перевірки повноти реєстру. */
export const SPEC_OPS = [
  'get_schema', 'get_schema_version', 'get_entity', 'search_entities', 'get_relations', 'get_mentions', 'get_sources',
  'create_entity_proposal', 'create_relation_proposal', 'validate_entity', 'validate_relation', 'approve_proposal', 'reject_proposal', 'write_canon',
  'publish_schema', 'rollback_schema',
] as const;

const BY_ID = new Map(STORY_CORE_OPS.map((o) => [o.id, o]));
export const storyCoreOp = (id: string) => BY_ID.get(id);

export class StoryCoreForbidden extends Error {
  constructor(readonly permission: StoryCoreOpKind, message: string) {
    super(message);
    this.name = 'StoryCoreForbidden';
  }
}

const RIGHT_MESSAGE: Record<StoryCoreOpKind, string> = {
  read: 'Немає доступу до цієї книги (або доступ обмежений).',
  propose: 'Пропонувати можуть ті, хто редагує книгу.',
  decide: 'Схвалювати й записувати в канон можуть власник книги, адміністратор або учасник із доступом «схвалення».',
  schema: 'Публікувати й відкочувати схему може лише той, кому надано право «Публікація схем» (PUBLISH_SCHEMA).',
};

/** Чи дозволено операцію цим правам (без виклику). */
export function allowed(op: StoryCoreOpDef, ctx: Pick<StoryCoreContext, 'actor' | 'rights'>): boolean {
  if ((op.kind === 'decide' || op.kind === 'schema') && isAiActor(ctx.actor)) return false;
  const r = ctx.rights;
  return op.kind === 'read' ? r.read : op.kind === 'propose' ? r.read && r.propose : op.kind === 'decide' ? r.read && r.approve : r.publishSchema;
}

/** Виклик операції: невідома — 404, без права — `StoryCoreForbidden`, порушення правил ядра — `CoreRuleError`. */
export async function callStoryCore(opId: string, ctx: StoryCoreContext, args: Record<string, unknown> = {}): Promise<unknown> {
  const op = storyCoreOp(opId);
  if (!op) throw new CoreRuleError('not_found', `Операції «${opId}» у Story Core API немає`);
  if (op.project && !ctx.projectId) throw new CoreRuleError('bad_input', 'Операція над книгою — потрібна книга');
  if (!allowed(op, ctx)) throw new StoryCoreForbidden(op.kind, isAiActor(ctx.actor) && (op.kind === 'decide' || op.kind === 'schema') ? 'AI лише пропонує; рішення й схеми — за людьми (§24, §37).' : RIGHT_MESSAGE[op.kind]);
  return op.run({ ...ctx, projectId: ctx.projectId ?? '' }, args ?? {});
}

/** Зведення пропозицій книги для переліку книг. */
export function proposalCounts(rows: StoryProposalRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.state] = (out[r.state] ?? 0) + 1;
  return out;
}
