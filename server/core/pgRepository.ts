/**
 * Сховище ядра в PostgreSQL (рішення К1). Схема — `fusion_core`
 * (migrations/0002_core_schema.sql); шлях пошуку з'єднань задає `db.ts`.
 *
 * Кожна зміна разом зі своєю версією йде ОДНІЄЮ транзакцією: або є і новий
 * стан, і рядок історії, або нічого. Перевірки правил — ті самі, що в
 * пам'яті (`rules.ts`); CHECK-обмеження бази — останній рубіж на випадок,
 * якщо хтось запише повз цей шар.
 */

import type { Pool, PoolClient } from 'pg';
import {
  checkEntityUpdate,
  checkMemberRole,
  checkMention,
  checkNewEntity,
  checkNewFinding,
  checkNewRelation,
  checkNewRun,
  checkParagraph,
  checkStatusChange,
  CoreRuleError,
  normalizeAlias,
  notFound,
  paragraphTextHash,
  checkTimePoint,
  checkEmotionPoint,
  checkAssetLink,
  checkAppearanceVersion,
  appearanceHash,
  checkEntityTrait,
  checkContinuityIssue,
  checkContinuityDraftCheck,
  checkCharacterDecision,
  checkCharacterMemory,
  checkCharacterMemoryStatus,
  checkCharacterMemoryPatch,
  checkCharacterAgent,
  checkSimulation,
  checkSimulationPatch,
  checkSimulationEvent,
  checkCanonProposal,
  checkQualityRun,
  checkQualityRunPatch,
  checkOntologyVersion,
  checkOntologyVersionPatch,
  checkOntologyEvent,
  checkOntologyActor,
  checkParticipant,
  checkParticipantStatus,
  checkParticipantRole,
  checkCollabEvent,
  checkAccessGrant,
  checkWorkflow,
  checkWorkflowName,
  checkWorkflowVersion,
  checkWorkflowEvent,
  checkGraphLayout,
  assertActor,
} from './rules';
import { EMBEDDING_DIMENSIONS, isValidEmbedding, SEARCHABLE_KINDS, tsQueryFromStems } from './search/text';
import type {
  AliasRow,
  CoreActor,
  CoreRepository,
  CoreStatus,
  DocumentInput,
  EmbeddingInput,
  DocumentRow,
  EntityInput,
  EntityPatch,
  EntityRow,
  FindingInput,
  FindingRow,
  MemberRole,
  MentionInput,
  MentionRow,
  NotificationInput,
  NotificationRow,
  ParagraphInput,
  ParagraphRow,
  ParagraphScore,
  SavedSearchRow,
  TimePointInput,
  TimePointRow,
  ParagraphVersionRow,
  ProjectInput,
  ProjectRow,
  RelationInput,
  RelationRow,
  RunCreateInput,
  RunFinishInput,
  RunRow,
  VersionRow,
  EmotionPointInput,
  EmotionPointRow,
  AssetLinkInput,
  AssetLinkRow,
  AppearanceVersionInput,
  AppearanceVersionRow,
  AppearanceHistoryRow,
  EntityTraitInput,
  EntityTraitRow,
  ContinuityIssueInput,
  ContinuityIssueRow,
  ContinuityIssueKind,
  ContinuityIssueStatus,
  ContinuityDraftCheckInput,
  ContinuityDraftCheckRow,
  CharacterDecisionInput,
  CharacterDecisionRow,
  CharacterDecisionFilter,
  CharacterMemoryInput,
  CharacterMemoryRow,
  CharacterMemoryFilter,
  CharacterMemoryStatus,
  CharacterMemoryPatch,
  CharacterAgentInput,
  CharacterAgentRow,
  SimulationInput,
  SimulationRow,
  SimulationPatch,
  SimulationKind,
  SimulationStatus,
  SimulationEventInput,
  SimulationEventRow,
  CanonProposalInput,
  CanonProposalRow,
  CanonProposalKind,
  CanonProposalStatus,
  CharacterStateInput,
  CharacterStateRow,
  CharacterDecisionLevel,
  QualityRunInput,
  QualityRunPatch,
  QualityRunRow,
  OntologyVersionInput,
  OntologyVersionPatch,
  OntologyVersionRow,
  OntologyEventRow,
  OntologyEventAction,
  OntologyUsage,
  ParticipantRow,
  ParticipantRoleRow,
  ParticipantSource,
  ParticipantStatus,
  CollabEventRow,
  CollabEventAction,
  AccessGrantInput,
  AccessGrantRow,
  WorkflowRow,
  WorkflowVersionRow,
  WorkflowVersionInput,
  WorkflowEventRow,
  WorkflowEventAction,
  GraphLayoutRow,
} from './types';

type Q = Pool | PoolClient;

/** Вектор у текстовому вигляді pgvector: `[0.1,0.2,…]`. Нечислове значення — помилка вхідних даних, не бази. */
function vectorLiteral(v: number[]): string {
  if (!isValidEmbedding(v)) {
    throw new CoreRuleError('bad_input', `Вектор має складатися з ${EMBEDDING_DIMENSIONS} скінченних чисел`);
  }
  return `[${v.join(',')}]`;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));

function toQualityRun(r: any): QualityRunRow {
  return {
    id: r.id,
    setId: r.set_id,
    setVersion: Number(r.set_version),
    status: r.status,
    label: r.label ?? '',
    passed: r.passed ?? null,
    summary: r.summary ?? {},
    report: r.report ?? null,
    models: r.models ?? {},
    costUsd: Number(r.cost_usd ?? 0),
    budgetUsd: r.budget_usd == null ? null : Number(r.budget_usd),
    error: r.error ?? null,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    startedAt: isoOrNull(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
  };
}
function toOntologyVersion(r: any): OntologyVersionRow {
  return {
    id: r.id,
    ontologyId: r.ontology_id,
    version: Number(r.version),
    label: r.label ?? '',
    status: r.status,
    basedOn: r.based_on ?? null,
    definition: r.definition ?? null,
    definitionHash: r.definition_hash,
    validation: r.validation ?? null,
    impact: r.impact ?? null,
    notes: r.notes ?? '',
    revision: Number(r.revision),
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    publishedBy: r.published_by ?? null,
    publishedAt: isoOrNull(r.published_at),
  };
}
function toParticipant(r: any): ParticipantRow {
  return { id: r.id, projectId: r.project_id, userId: r.user_id, status: r.status, source: r.source, sourceRef: r.source_ref ?? null, createdBy: r.created_by, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
}
function toParticipantRole(r: any): ParticipantRoleRow {
  return {
    id: r.id, participantId: r.participant_id, projectId: r.project_id, roleId: r.role_id, specialization: r.specialization ?? null, status: r.status,
    assignedBy: r.assigned_by, registryVersion: r.registry_version == null ? null : Number(r.registry_version), createdAt: iso(r.created_at), revokedAt: isoOrNull(r.revoked_at), revokedBy: r.revoked_by ?? null,
  };
}
function toWorkflow(r: any): WorkflowRow {
  return { id: r.id, name: r.name, description: r.description ?? '', status: r.status, createdBy: r.created_by, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
}
function toWorkflowVersion(r: any): WorkflowVersionRow {
  return {
    id: r.id, workflowId: r.workflow_id, version: Number(r.version), environment: r.environment, basedOn: r.based_on ?? null,
    definition: r.definition ?? null, definitionHash: r.definition_hash, validation: r.validation ?? null, notes: r.notes ?? '',
    revision: Number(r.revision), createdBy: r.created_by, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    testedBy: r.tested_by ?? null, testedAt: isoOrNull(r.tested_at), publishedBy: r.published_by ?? null, publishedAt: isoOrNull(r.published_at),
  };
}
function toWorkflowEvent(r: any): WorkflowEventRow {
  return { id: r.id, workflowId: r.workflow_id, versionId: r.version_id ?? null, action: r.action, actor: r.actor, details: r.details ?? {}, createdAt: iso(r.created_at) };
}
function toGraphLayout(r: any): GraphLayoutRow {
  return { graphKind: r.graph_kind, graphId: r.graph_id, versionRef: r.version_ref, layout: r.layout ?? {}, updatedBy: r.updated_by, updatedAt: iso(r.updated_at) };
}
function toAccessGrant(r: any): AccessGrantRow {
  return {
    id: r.id, projectId: r.project_id, participantId: r.participant_id, level: r.level, scopeType: r.scope_type, scopeRef: r.scope_ref ?? null,
    validFrom: iso(r.valid_from), validUntil: isoOrNull(r.valid_until), status: r.status, source: r.source, sourceRef: r.source_ref ?? null,
    grantedBy: r.granted_by, createdAt: iso(r.created_at), revokedAt: isoOrNull(r.revoked_at), revokedBy: r.revoked_by ?? null,
  };
}
function toCollabEvent(r: any): CollabEventRow {
  return { id: r.id, projectId: r.project_id, participantId: r.participant_id ?? null, action: r.action, actor: r.actor, details: r.details ?? {}, createdAt: iso(r.created_at) };
}
function toOntologyEvent(r: any): OntologyEventRow {
  return { id: r.id, ontologyId: r.ontology_id, versionId: r.version_id ?? null, action: r.action, actor: r.actor, details: r.details ?? {}, createdAt: iso(r.created_at) };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Рядок, що не є UUID, у колонці `uuid` дав би помилку бази; для ядра це просто «не знайдено». */
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

function toTimePoint(r: any): TimePointRow {
  return {
    id: r.id,
    projectId: r.project_id,
    subjectKind: r.subject_kind,
    subjectId: r.subject_id,
    kind: r.kind,
    start: r.start_value,
    end: r.end_value,
    sortKey: r.sort_key == null ? null : Number(r.sort_key),
    endKey: r.end_key == null ? null : Number(r.end_key),
    label: r.label,
    status: r.status,
    source: r.source,
    evidence: r.evidence ?? [],
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  };
}

function toEmotionPoint(r: any): EmotionPointRow {
  return {
    id: r.id,
    projectId: r.project_id,
    characterId: r.character_id,
    paragraphId: r.paragraph_id,
    emotion: r.emotion,
    family: r.family,
    layer: r.layer,
    intensity: Number(r.intensity),
    craft: r.craft == null ? null : Number(r.craft),
    impact: r.impact == null ? null : Number(r.impact),
    note: r.note,
    source: r.source,
    status: r.status,
    findingId: r.finding_id ?? null,
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  };
}

function toAssetLink(r: any): AssetLinkRow {
  return {
    id: r.id,
    projectId: r.project_id,
    assetUrl: r.asset_url,
    assetId: r.asset_id ?? null,
    entityId: r.entity_id ?? null,
    sectionId: r.section_id ?? null,
    role: r.role,
    status: r.status,
    source: r.source,
    needsReview: !!r.needs_review,
    checkedHash: r.checked_hash ?? null,
    evidence: r.evidence ?? [],
    note: r.note,
    appearanceVersionId: r.appearance_version_id ?? null,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toAppearanceVersion(r: any): AppearanceVersionRow {
  return {
    id: r.id,
    projectId: r.project_id,
    entityId: r.entity_id,
    label: r.label,
    age: r.age,
    fromChapter: r.from_chapter ?? null,
    toChapter: r.to_chapter ?? null,
    description: r.description,
    descriptionHash: r.description_hash,
    approved: !!r.approved,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toAppearanceHistory(r: any): AppearanceHistoryRow {
  return {
    id: String(r.id),
    projectId: r.project_id,
    versionId: r.version_id,
    entityId: r.entity_id,
    action: r.action,
    snapshot: r.snapshot ?? {},
    actor: r.actor,
    at: iso(r.at),
  };
}

function toEntityTrait(r: any): EntityTraitRow {
  return {
    id: r.id,
    projectId: r.project_id,
    entityId: r.entity_id,
    label: r.label,
    value: r.value,
    sectionId: r.section_id ?? null,
    storyTimeKey: r.story_time_key == null ? null : Number(r.story_time_key),
    status: r.status,
    source: r.source,
    supersedes: r.supersedes ?? null,
    appearanceVersionId: r.appearance_version_id ?? null,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toDecision(r: any): CharacterDecisionRow {
  return {
    id: r.id,
    projectId: r.project_id,
    characterId: r.character_id,
    level: r.level,
    sceneId: r.scene_id ?? null,
    simulationId: r.simulation_id ?? null,
    turnIndex: r.turn_index ?? null,
    cacheKey: r.cache_key,
    parentId: r.parent_id ?? null,
    questions: Array.isArray(r.questions) ? r.questions : [],
    options: r.options ?? {},
    result: r.result ?? null,
    selectedAction: r.selected_action ?? null,
    validation: r.validation ?? {},
    snapshotHash: r.snapshot_hash,
    modelVersion: r.model_version,
    source: r.source,
    fallbackReason: r.fallback_reason ?? null,
    basis: r.basis ?? {},
    status: r.status,
    usage: r.usage ?? {},
    latencyMs: Number(r.latency_ms ?? 0),
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    resolvedBy: r.resolved_by ?? null,
    resolvedAt: isoOrNull(r.resolved_at),
  };
}

function toMemory(r: any): CharacterMemoryRow {
  return {
    id: r.id,
    projectId: r.project_id,
    characterId: r.character_id,
    memoryType: r.memory_type,
    layer: r.layer,
    content: r.content,
    aboutEntityIds: Array.isArray(r.about_entity_ids) ? r.about_entity_ids : [],
    effects: r.effects ?? {},
    beliefStatus: r.belief_status,
    truth: r.truth,
    sourceEventKind: r.source_event_kind,
    sourceEventId: r.source_event_id ?? null,
    sourceParagraphIds: Array.isArray(r.source_paragraph_ids) ? r.source_paragraph_ids : [],
    evidenceHash: r.evidence_hash ?? null,
    sceneId: r.scene_id ?? null,
    storyTime: r.story_time ?? {},
    simulationId: r.simulation_id ?? null,
    canonRevision: r.canon_revision ?? null,
    visibility: r.visibility,
    origin: r.origin,
    status: r.status,
    dedupeKey: r.dedupe_key ?? null,
    reviewNote: r.review_note ?? null,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: isoOrNull(r.reviewed_at),
  };
}

function toState(r: any): CharacterStateRow {
  return {
    id: r.id,
    projectId: r.project_id,
    characterId: r.character_id,
    sceneId: r.scene_id ?? null,
    simulationId: r.simulation_id ?? null,
    canonRevision: Number(r.canon_revision),
    goals: r.goals ?? [],
    emotions: r.emotions ?? [],
    beliefs: r.beliefs ?? [],
    relationships: r.relationships ?? [],
    memoryIds: r.memory_ids ?? [],
    stateVersion: Number(r.state_version),
    snapshotHash: r.snapshot_hash,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
  };
}

function toAgent(r: any): CharacterAgentRow {
  return {
    id: r.id,
    projectId: r.project_id,
    characterId: r.character_id,
    enabled: !!r.enabled,
    autonomyLevel: r.autonomy_level,
    agentConfig: r.agent_config ?? {},
    modelPolicy: r.model_policy ?? {},
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedBy: r.updated_by,
    updatedAt: iso(r.updated_at),
  };
}

function toSimulation(r: any): SimulationRow {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    characterId: r.character_id ?? null,
    sceneId: r.scene_id ?? null,
    asOfChapter: r.as_of_chapter ?? null,
    baseBookRevision: Number(r.base_book_revision),
    title: r.title ?? '',
    config: r.config ?? {},
    status: r.status,
    currentTurn: Number(r.current_turn),
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toSimEvent(r: any): SimulationEventRow {
  return {
    id: r.id,
    projectId: r.project_id,
    simulationId: r.simulation_id,
    turnIndex: Number(r.turn_index),
    actor: r.actor,
    actorCharacterId: r.actor_character_id ?? null,
    eventType: r.event_type,
    publicPayload: r.public_payload ?? {},
    privatePayloadRef: r.private_payload_ref ?? null,
    sourceDecisionId: r.source_decision_id ?? null,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
  };
}

function toProposal(r: any): CanonProposalRow {
  return {
    id: r.id,
    projectId: r.project_id,
    simulationId: r.simulation_id,
    characterId: r.character_id,
    sourceEventIds: Array.isArray(r.source_event_ids) ? r.source_event_ids : [],
    kind: r.kind,
    proposedChange: r.proposed_change ?? {},
    parentId: r.parent_id ?? null,
    status: r.status,
    result: r.result ?? {},
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: isoOrNull(r.reviewed_at),
  };
}

function toDraftCheck(r: any): ContinuityDraftCheckRow {
  return {
    id: r.id,
    projectId: r.project_id,
    characterId: r.character_id,
    sectionId: r.section_id ?? null,
    draftText: r.draft_text,
    findings: Array.isArray(r.findings) ? r.findings : [],
    simulationId: r.simulation_id ?? null,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
  };
}

function toContinuityIssue(r: any): ContinuityIssueRow {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    entityId: r.entity_id ?? null,
    summary: r.summary,
    evidenceA: r.evidence_a,
    evidenceB: r.evidence_b ?? null,
    status: r.status,
    source: r.source,
    checkedHash: r.checked_hash ?? null,
    insufficientData: !!r.insufficient_data,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toSavedSearch(r: any): SavedSearchRow {
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    name: r.name,
    params: r.params ?? {},
    createdAt: iso(r.created_at),
  };
}

function toProject(r: any): ProjectRow {
  return {
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    languages: r.languages,
    revision: r.revision,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toDocument(r: any): DocumentRow {
  return {
    projectId: r.project_id,
    id: r.id,
    kind: r.kind,
    parentId: r.parent_id,
    order: r.ord,
    title: r.title,
    version: r.version,
    deletedAt: isoOrNull(r.deleted_at),
    updatedAt: iso(r.updated_at),
  };
}

function toParagraph(r: any): ParagraphRow {
  return {
    projectId: r.project_id,
    id: r.id,
    documentId: r.document_id,
    order: r.ord,
    kind: r.kind,
    text: r.text,
    textHash: r.text_hash,
    version: r.version,
    deletedAt: isoOrNull(r.deleted_at),
    editorPid: r.editor_pid ?? null,
    updatedAt: iso(r.updated_at),
  };
}

function toEntity(r: any): EntityRow {
  return {
    id: r.id,
    projectId: r.project_id,
    type: r.type,
    name: r.name,
    canonical: r.canonical ?? {},
    status: r.status,
    version: r.version,
    externalRef: r.external_ref ?? null,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toAlias(r: any): AliasRow {
  return {
    id: r.id,
    projectId: r.project_id,
    entityId: r.entity_id,
    entityType: r.entity_type,
    alias: r.alias,
    aliasNorm: r.alias_norm,
    kind: r.kind,
  };
}

function toMention(r: any): MentionRow {
  return {
    id: r.id,
    projectId: r.project_id,
    entityId: r.entity_id,
    paragraphId: r.paragraph_id,
    spanStart: r.span_start,
    spanEnd: r.span_end,
    source: r.source,
    status: r.status,
    subjectEntityId: r.subject_entity_id,
    fields: r.fields ?? {},
  };
}

function toRelation(r: any): RelationRow {
  return {
    id: r.id,
    projectId: r.project_id,
    type: r.type,
    fromId: r.from_id,
    toId: r.to_id,
    status: r.status,
    evidence: r.evidence ?? [],
    note: r.note,
    version: r.version,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toRun(r: any): RunRow {
  return {
    id: r.id,
    projectId: r.project_id,
    role: r.role,
    module: r.module,
    model: r.model,
    promptVersion: r.prompt_version,
    inputs: r.inputs ?? [],
    status: r.status,
    cost: r.cost ?? {},
    error: r.error,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    finishedAt: isoOrNull(r.finished_at),
  };
}

function toFinding(r: any): FindingRow {
  return {
    id: r.id,
    projectId: r.project_id,
    runId: r.run_id,
    entityId: r.entity_id,
    kind: r.kind,
    payload: r.payload ?? {},
    sourceParagraphIds: r.source_paragraph_ids ?? [],
    sourceAssetIds: r.source_asset_ids ?? [],
    sourceRevision: r.source_revision,
    validStoryTime: r.valid_story_time,
    status: r.status,
    needsReview: r.needs_review,
    insufficientData: r.insufficient_data,
    visibility: r.visibility,
    version: r.version,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toVersion<T>(r: any, idColumn: string): VersionRow<T> {
  return {
    projectId: r.project_id,
    recordId: r[idColumn],
    version: r.version,
    snapshot: r.snapshot,
    changedBy: r.changed_by,
    changedAt: iso(r.changed_at),
    reason: r.reason,
  };
}

function toNotification(r: any): NotificationRow {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    message: r.message,
    paragraphIds: r.paragraph_ids ?? [],
    payload: r.payload ?? {},
    createdAt: iso(r.created_at),
    readAt: isoOrNull(r.read_at),
  };
}

/** Порушення обмежень бази → ті самі помилки правил, що дає сховище в пам'яті. */
function mapPgError(err: any): never {
  const code = err?.code;
  const constraint: string = err?.constraint ?? '';
  if (code === '23514' && /ai_evidence/.test(constraint)) {
    throw new CoreRuleError('evidence_required', 'Запис AI без доказу база не приймає');
  }
  if (code === '23505' && /external_ref/.test(constraint)) {
    throw new CoreRuleError('bad_input', 'Сутність із таким зв\'язком зі Студією вже є');
  }
  if (code === '23505' && /entity_aliases/.test(constraint)) {
    throw new CoreRuleError('duplicate_alias', 'Псевдонім уже належить іншій сутності цього типу');
  }
  if (code === '23505' && /character_memories_dedupe/.test(constraint)) {
    throw new CoreRuleError('conflict', 'Такий спогад героя вже є (той самий ключ повтору)');
  }
  if (code === '23505' && /ontology_versions_one_active/.test(constraint)) {
    throw new CoreRuleError('conflict', 'Активна версія онтології вже є');
  }
  if (code === '23505' && /ontology_versions_one_draft/.test(constraint)) {
    throw new CoreRuleError('conflict', 'Відкрита чернетка онтології вже є — одна за раз');
  }
  if (code === '23505' && /workflow_versions_one_draft/.test(constraint)) {
    throw new CoreRuleError('conflict', 'Чернетка процесу вже є — одна за раз');
  }
  if (code === '23505' && /workflows_pkey/.test(constraint)) {
    throw new CoreRuleError('conflict', 'Процес із таким id уже є');
  }
  if (code === '23505' && /participant_roles_active/.test(constraint)) {
    throw new CoreRuleError('conflict', 'Ця роль у учасника вже є');
  }
  if (code === '23503') {
    throw new CoreRuleError('not_found', 'Пов\'язаний запис не знайдено в цьому проєкті');
  }
  if (code === '23514' || code === '22P02') {
    throw new CoreRuleError('bad_input', err?.message ?? 'Неправильні дані');
  }
  throw err;
}

export class PgCoreRepository implements CoreRepository {
  readonly kind = 'postgres' as const;

  constructor(private readonly pool: Pool, private readonly ownsPool = false) {}

  private async q(sql: string, params: unknown[] = [], on: Q = this.pool) {
    try {
      return await on.query(sql, params);
    } catch (err) {
      mapPgError(err);
    }
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  // ── Проєкти й учасники ───────────────────────────────────────────────────

  async upsertProject(input: ProjectInput) {
    const { rows } = await this.q(
      `INSERT INTO projects (id, owner_id, title, languages)
       VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, '{uk}'::text[]))
       ON CONFLICT (id) DO UPDATE SET
         owner_id = EXCLUDED.owner_id,
         title = COALESCE($3, projects.title),
         languages = COALESCE($4, projects.languages),
         updated_at = now()
       RETURNING *`,
      [input.id, input.ownerId, input.title ?? null, input.languages ?? null],
    );
    return toProject(rows[0]);
  }

  async getProject(id: string) {
    const { rows } = await this.q('SELECT * FROM projects WHERE id = $1', [id]);
    return rows[0] ? toProject(rows[0]) : null;
  }

  async bumpProjectRevision(id: string) {
    const { rows } = await this.q(
      'UPDATE projects SET revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING revision',
      [id],
    );
    if (!rows[0]) throw notFound(`Проєкт «${id}»`);
    return rows[0].revision as number;
  }

  async setMember(projectId: string, userId: string, role: MemberRole, scopes: Record<string, unknown> = {}) {
    checkMemberRole(role);
    await this.q(
      `INSERT INTO project_members (project_id, user_id, role, scopes) VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, scopes = EXCLUDED.scopes`,
      [projectId, userId, role, JSON.stringify(scopes)],
    );
  }

  async removeMember(projectId: string, userId: string) {
    await this.q('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
  }

  async getMemberRole(projectId: string, userId: string) {
    const { rows } = await this.q('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [
      projectId,
      userId,
    ]);
    return (rows[0]?.role as MemberRole) ?? null;
  }

  // ── Документи й абзаци ───────────────────────────────────────────────────

  async upsertDocument(input: DocumentInput) {
    const { rows } = await this.q(
      `INSERT INTO documents (project_id, id, kind, parent_id, ord, title)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id, id) DO UPDATE SET
         kind = EXCLUDED.kind,
         parent_id = EXCLUDED.parent_id,
         ord = EXCLUDED.ord,
         title = EXCLUDED.title,
         deleted_at = NULL,
         version = documents.version + CASE WHEN
           documents.title IS DISTINCT FROM EXCLUDED.title OR
           documents.kind IS DISTINCT FROM EXCLUDED.kind OR
           documents.parent_id IS DISTINCT FROM EXCLUDED.parent_id THEN 1 ELSE 0 END,
         updated_at = now()
       RETURNING *`,
      [input.projectId, input.id, input.kind, input.parentId ?? null, input.order, input.title ?? ''],
    );
    return toDocument(rows[0]);
  }

  async markDocumentDeleted(projectId: string, id: string) {
    const { rowCount } = await this.q(
      'UPDATE documents SET deleted_at = now(), updated_at = now() WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL',
      [projectId, id],
    );
    return (rowCount ?? 0) > 0;
  }

  async listDocuments(projectId: string) {
    const { rows } = await this.q('SELECT * FROM documents WHERE project_id = $1 ORDER BY ord, id', [projectId]);
    return rows.map(toDocument);
  }

  async upsertParagraph(input: ParagraphInput, actor: CoreActor) {
    checkParagraph(input, actor);
    const hash = paragraphTextHash(input.text);
    try {
      return await this.tx(async (c) => {
        const prev = await c.query(
          'SELECT text_hash, version FROM paragraphs WHERE project_id = $1 AND id = $2 FOR UPDATE',
          [input.projectId, input.id],
        );
        const changed = !prev.rows[0] || prev.rows[0].text_hash !== hash;
        const { rows } = await c.query(
          `INSERT INTO paragraphs (project_id, id, document_id, ord, kind, text, text_hash, editor_pid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (project_id, id) DO UPDATE SET
             document_id = EXCLUDED.document_id,
             editor_pid = EXCLUDED.editor_pid,
             ord = EXCLUDED.ord,
             kind = EXCLUDED.kind,
             text = EXCLUDED.text,
             text_hash = EXCLUDED.text_hash,
             version = paragraphs.version + CASE WHEN paragraphs.text_hash = EXCLUDED.text_hash THEN 0 ELSE 1 END,
             deleted_at = NULL,
             updated_at = CASE
               WHEN paragraphs.text_hash = EXCLUDED.text_hash AND paragraphs.ord = EXCLUDED.ord
                    AND paragraphs.deleted_at IS NULL
               THEN paragraphs.updated_at ELSE now() END
           RETURNING *`,
          [input.projectId, input.id, input.documentId, input.order, input.kind, input.text, hash, input.editorPid ?? null],
        );
        const row = toParagraph(rows[0]);
        if (changed) {
          await c.query(
            `INSERT INTO paragraph_versions (project_id, paragraph_id, version, text, text_hash, changed_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [row.projectId, row.id, row.version, row.text, hash, actor],
          );
        }
        return { row, changed };
      });
    } catch (err) {
      if (err instanceof CoreRuleError) throw err;
      mapPgError(err);
    }
  }

  async markParagraphDeleted(projectId: string, id: string) {
    const { rowCount } = await this.q(
      'UPDATE paragraphs SET deleted_at = now(), updated_at = now() WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL',
      [projectId, id],
    );
    return (rowCount ?? 0) > 0;
  }

  async getParagraph(projectId: string, id: string) {
    const { rows } = await this.q('SELECT * FROM paragraphs WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toParagraph(rows[0]) : null;
  }

  async listParagraphs(projectId: string, documentId: string) {
    const { rows } = await this.q(
      'SELECT * FROM paragraphs WHERE project_id = $1 AND document_id = $2 AND deleted_at IS NULL ORDER BY ord',
      [projectId, documentId],
    );
    return rows.map(toParagraph);
  }

  async listAllParagraphs(projectId: string) {
    const { rows } = await this.q('SELECT * FROM paragraphs WHERE project_id = $1 ORDER BY document_id, ord', [projectId]);
    return rows.map(toParagraph);
  }

  async listParagraphVersions(projectId: string, id: string): Promise<ParagraphVersionRow[]> {
    const { rows } = await this.q(
      'SELECT * FROM paragraph_versions WHERE project_id = $1 AND paragraph_id = $2 ORDER BY version',
      [projectId, id],
    );
    return rows.map((r: any) => ({
      projectId: r.project_id,
      paragraphId: r.paragraph_id,
      version: r.version,
      text: r.text,
      textHash: r.text_hash,
      changedBy: r.changed_by,
      changedAt: iso(r.changed_at),
    }));
  }

  // ── Сутності ─────────────────────────────────────────────────────────────

  private async writeVersion(
    c: PoolClient,
    table: 'entity_versions' | 'entity_relation_versions' | 'analysis_finding_versions',
    idColumn: string,
    row: { projectId: string; id: string; version: number },
    actor: CoreActor,
    reason: string,
  ) {
    await c.query(
      `INSERT INTO ${table} (project_id, ${idColumn}, version, snapshot, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.projectId, row.id, row.version, JSON.stringify(row), actor, reason],
    );
  }

  /** Спільна обгортка «змінити рядок + записати версію» з перекладом помилок бази. */
  private async mutate<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    try {
      return await this.tx(fn);
    } catch (err) {
      if (err instanceof CoreRuleError) throw err;
      mapPgError(err);
    }
  }

  async createEntity(input: EntityInput) {
    const status = checkNewEntity(input);
    return this.mutate(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO entities (project_id, type, name, canonical, status, created_by, external_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [input.projectId, input.type, input.name.trim(), JSON.stringify(input.canonical ?? {}), status, input.createdBy, input.externalRef ?? null],
      );
      const row = toEntity(rows[0]);
      await this.writeVersion(c, 'entity_versions', 'entity_id', row, input.createdBy, 'створено');
      return row;
    });
  }

  async getEntity(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM entities WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async findEntityByExternalRef(projectId: string, type: string, externalRef: string) {
    const { rows } = await this.q('SELECT * FROM entities WHERE project_id = $1 AND type = $2 AND external_ref = $3', [
      projectId,
      type,
      externalRef,
    ]);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async listEntities(projectId: string, type?: string) {
    const { rows } = await this.q(
      `SELECT * FROM entities WHERE project_id = $1 AND ($2::text IS NULL OR type = $2)
       ORDER BY created_at, name`,
      [projectId, type ?? null],
    );
    return rows.map(toEntity);
  }

  async updateEntity(projectId: string, id: string, patch: EntityPatch, actor: CoreActor, reason = '') {
    return this.mutate(async (c) => {
      if (!isUuid(id)) throw notFound('Сутність');
      const cur = await c.query('SELECT * FROM entities WHERE project_id = $1 AND id = $2 FOR UPDATE', [projectId, id]);
      if (!cur.rows[0]) throw notFound('Сутність');
      checkEntityUpdate(toEntity(cur.rows[0]), actor);
      const { rows } = await c.query(
        `UPDATE entities SET
           name = COALESCE($3, name),
           canonical = COALESCE($4::jsonb, canonical),
           external_ref = CASE WHEN $5 THEN $6 ELSE external_ref END,
           version = version + 1,
           updated_at = now()
         WHERE project_id = $1 AND id = $2 RETURNING *`,
        [
          projectId,
          id,
          patch.name?.trim() ?? null,
          patch.canonical ? JSON.stringify(patch.canonical) : null,
          patch.externalRef !== undefined,
          patch.externalRef ?? null,
        ],
      );
      const row = toEntity(rows[0]);
      await this.writeVersion(c, 'entity_versions', 'entity_id', row, actor, reason);
      return row;
    });
  }

  async setEntityStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor, reason = '') {
    checkStatusChange(status, actor);
    return this.mutate(async (c) => {
      if (!isUuid(id)) throw notFound('Сутність');
      const { rows } = await c.query(
        `UPDATE entities SET status = $3, version = version + 1, updated_at = now()
         WHERE project_id = $1 AND id = $2 RETURNING *`,
        [projectId, id, status],
      );
      if (!rows[0]) throw notFound('Сутність');
      const row = toEntity(rows[0]);
      await this.writeVersion(c, 'entity_versions', 'entity_id', row, actor, reason);
      return row;
    });
  }

  async listEntityVersions(projectId: string, id: string) {
    if (!isUuid(id)) return [];
    const { rows } = await this.q(
      'SELECT * FROM entity_versions WHERE project_id = $1 AND entity_id = $2 ORDER BY version',
      [projectId, id],
    );
    return rows.map((r: any) => toVersion<EntityRow>(r, 'entity_id'));
  }

  async addAlias(projectId: string, entityId: string, alias: string, kind: AliasRow['kind'] = 'alias') {
    const aliasNorm = normalizeAlias(alias);
    if (!aliasNorm) throw new CoreRuleError('bad_input', 'Псевдонім не може бути порожнім');
    return this.mutate(async (c) => {
      if (!isUuid(entityId)) throw notFound('Сутність');
      const e = await c.query('SELECT type FROM entities WHERE project_id = $1 AND id = $2', [projectId, entityId]);
      if (!e.rows[0]) throw notFound('Сутність');
      const type = e.rows[0].type as string;
      const existing = await c.query(
        'SELECT * FROM entity_aliases WHERE project_id = $1 AND entity_type = $2 AND alias_norm = $3',
        [projectId, type, aliasNorm],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].entity_id === entityId) return toAlias(existing.rows[0]);
        throw new CoreRuleError('duplicate_alias', `Псевдонім «${alias}» уже належить іншій сутності цього типу`);
      }
      const { rows } = await c.query(
        `INSERT INTO entity_aliases (project_id, entity_id, entity_type, alias, alias_norm, kind)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [projectId, entityId, type, alias.trim(), aliasNorm, kind],
      );
      return toAlias(rows[0]);
    });
  }

  async listAliases(projectId: string, entityId?: string) {
    if (entityId === undefined) {
      const { rows } = await this.q('SELECT * FROM entity_aliases WHERE project_id = $1 ORDER BY alias', [projectId]);
      return rows.map(toAlias);
    }
    if (!isUuid(entityId)) return [];
    const { rows } = await this.q('SELECT * FROM entity_aliases WHERE project_id = $1 AND entity_id = $2 ORDER BY alias', [
      projectId,
      entityId,
    ]);
    return rows.map(toAlias);
  }

  async resolveAlias(projectId: string, type: string, alias: string) {
    const { rows } = await this.q(
      'SELECT entity_id FROM entity_aliases WHERE project_id = $1 AND entity_type = $2 AND alias_norm = $3',
      [projectId, type, normalizeAlias(alias)],
    );
    return (rows[0]?.entity_id as string) ?? null;
  }

  // ── Згадки ───────────────────────────────────────────────────────────────

  async replaceParagraphMentions(projectId: string, paragraphId: string, mentions: MentionInput[]) {
    for (const m of mentions) {
      checkMention(m);
      if (!isUuid(m.entityId) || (m.subjectEntityId && !isUuid(m.subjectEntityId))) throw notFound('Сутність згадки');
    }
    return this.mutate(async (c) => {
      const p = await c.query('SELECT 1 FROM paragraphs WHERE project_id = $1 AND id = $2', [projectId, paragraphId]);
      if (!p.rows[0]) throw notFound(`Абзац «${paragraphId}»`);
      const subjects = [...new Set(mentions.map((m) => m.subjectEntityId).filter(Boolean))] as string[];
      if (subjects.length) {
        // Суб'єкт посилається на entities(id) без project_id — тож чужий проєкт перевіряємо тут.
        const ok = await c.query('SELECT count(*)::int AS n FROM entities WHERE project_id = $1 AND id = ANY($2::uuid[])', [
          projectId,
          subjects,
        ]);
        if (ok.rows[0].n !== subjects.length) throw notFound('Суб\'єкт згадки');
      }
      await c.query('DELETE FROM entity_mentions WHERE project_id = $1 AND paragraph_id = $2', [projectId, paragraphId]);
      const out: MentionRow[] = [];
      for (const m of mentions) {
        const { rows } = await c.query(
          `INSERT INTO entity_mentions
             (project_id, entity_id, paragraph_id, span_start, span_end, source, status, subject_entity_id, fields)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            projectId,
            m.entityId,
            paragraphId,
            m.spanStart,
            m.spanEnd,
            m.source,
            m.status ?? (m.source === 'ai' ? 'suggested' : 'confirmed'),
            m.subjectEntityId ?? null,
            JSON.stringify(m.fields ?? {}),
          ],
        );
        out.push(toMention(rows[0]));
      }
      return out;
    });
  }

  async listMentionsByParagraphs(projectId: string, paragraphIds: string[]) {
    if (!paragraphIds.length) return [];
    const { rows } = await this.q(
      'SELECT * FROM entity_mentions WHERE project_id = $1 AND paragraph_id = ANY($2::text[]) ORDER BY paragraph_id, span_start',
      [projectId, paragraphIds],
    );
    return rows.map(toMention);
  }

  async listSubjectMentions(projectId: string) {
    const { rows } = await this.q(
      `SELECT m.* FROM entity_mentions m
       JOIN paragraphs p ON p.project_id = m.project_id AND p.id = m.paragraph_id AND p.deleted_at IS NULL
       WHERE m.project_id = $1 AND m.subject_entity_id IS NOT NULL
       ORDER BY m.paragraph_id, m.span_start`,
      [projectId],
    );
    return rows.map(toMention);
  }

  async countMentionsByEntity(projectId: string) {
    const { rows } = await this.q(
      `SELECT m.entity_id, count(*)::int AS n
       FROM entity_mentions m
       JOIN paragraphs p ON p.project_id = m.project_id AND p.id = m.paragraph_id AND p.deleted_at IS NULL
       WHERE m.project_id = $1
       GROUP BY m.entity_id`,
      [projectId],
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.entity_id] = r.n;
    return out;
  }

  async listMentionsByEntity(projectId: string, entityId: string) {
    if (!isUuid(entityId)) return [];
    const { rows } = await this.q(
      'SELECT * FROM entity_mentions WHERE project_id = $1 AND entity_id = $2 ORDER BY paragraph_id, span_start',
      [projectId, entityId],
    );
    return rows.map(toMention);
  }

  // ── Зв'язки ──────────────────────────────────────────────────────────────

  async createRelation(input: RelationInput) {
    const status = checkNewRelation(input);
    if (!isUuid(input.fromId) || !isUuid(input.toId)) throw notFound('Сутність зв\'язку');
    return this.mutate(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO entity_relations (project_id, type, from_id, to_id, status, evidence, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          input.projectId,
          input.type,
          input.fromId,
          input.toId,
          status,
          input.evidence ?? [],
          input.note ?? '',
          input.createdBy,
        ],
      );
      const row = toRelation(rows[0]);
      await this.writeVersion(c, 'entity_relation_versions', 'relation_id', row, input.createdBy, 'створено');
      return row;
    });
  }

  async setRelationStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor, reason = '') {
    checkStatusChange(status, actor);
    return this.mutate(async (c) => {
      if (!isUuid(id)) throw notFound('Зв\'язок');
      const { rows } = await c.query(
        `UPDATE entity_relations SET status = $3, version = version + 1, updated_at = now()
         WHERE project_id = $1 AND id = $2 RETURNING *`,
        [projectId, id, status],
      );
      if (!rows[0]) throw notFound('Зв\'язок');
      const row = toRelation(rows[0]);
      await this.writeVersion(c, 'entity_relation_versions', 'relation_id', row, actor, reason);
      return row;
    });
  }

  async listRelations(projectId: string, entityId?: string) {
    if (entityId !== undefined && !isUuid(entityId)) return [];
    const { rows } = await this.q(
      `SELECT * FROM entity_relations
       WHERE project_id = $1 AND ($2::uuid IS NULL OR from_id = $2 OR to_id = $2)
       ORDER BY created_at`,
      [projectId, entityId ?? null],
    );
    return rows.map(toRelation);
  }

  async listRelationVersions(projectId: string, id: string) {
    if (!isUuid(id)) return [];
    const { rows } = await this.q(
      'SELECT * FROM entity_relation_versions WHERE project_id = $1 AND relation_id = $2 ORDER BY version',
      [projectId, id],
    );
    return rows.map((r: any) => toVersion<RelationRow>(r, 'relation_id'));
  }

  // ── Прогони й висновки ───────────────────────────────────────────────────

  async createRun(input: RunCreateInput) {
    checkNewRun(input);
    const { rows } = await this.q(
      `INSERT INTO analysis_runs (project_id, role, module, model, prompt_version, inputs, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'running', $7) RETURNING *`,
      [
        input.projectId,
        input.role,
        input.module,
        input.model ?? '',
        input.promptVersion ?? '',
        JSON.stringify(input.inputs ?? []),
        input.createdBy,
      ],
    );
    return toRun(rows[0]);
  }

  async finishRun(projectId: string, id: string, input: RunFinishInput) {
    if (!isUuid(id)) throw notFound('Прогін AI');
    const { rows } = await this.q(
      `UPDATE analysis_runs SET status = $3, cost = COALESCE($4::jsonb, cost), error = $5, finished_at = now()
       WHERE project_id = $1 AND id = $2 RETURNING *`,
      [projectId, id, input.status, input.cost ? JSON.stringify(input.cost) : null, input.error ?? null],
    );
    if (!rows[0]) throw notFound('Прогін AI');
    return toRun(rows[0]);
  }

  async getRun(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM analysis_runs WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async addFinding(input: FindingInput) {
    const status = checkNewFinding(input);
    if (input.entityId && !isUuid(input.entityId)) throw notFound('Сутність висновку');
    if (input.runId && !isUuid(input.runId)) throw notFound('Прогін AI');
    return this.mutate(async (c) => {
      // entity_id і run_id посилаються на глобальні id — належність проєкту перевіряємо тут.
      if (input.entityId) {
        const e = await c.query('SELECT 1 FROM entities WHERE project_id = $1 AND id = $2', [input.projectId, input.entityId]);
        if (!e.rows[0]) throw notFound('Сутність висновку');
      }
      if (input.runId) {
        const r = await c.query('SELECT 1 FROM analysis_runs WHERE project_id = $1 AND id = $2', [input.projectId, input.runId]);
        if (!r.rows[0]) throw notFound('Прогін AI');
      }
      const { rows } = await c.query(
        `INSERT INTO analysis_findings
           (project_id, run_id, entity_id, kind, payload, source_paragraph_ids, source_revision,
            valid_story_time, status, insufficient_data, visibility, created_by, source_asset_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          input.projectId,
          input.runId ?? null,
          input.entityId ?? null,
          input.kind,
          JSON.stringify(input.payload ?? {}),
          input.sourceParagraphIds ?? [],
          input.sourceRevision ?? null,
          input.validStoryTime ? JSON.stringify(input.validStoryTime) : null,
          status,
          !!input.insufficientData,
          input.visibility ?? 'project',
          input.createdBy,
          input.sourceAssetIds ?? [],
        ],
      );
      const row = toFinding(rows[0]);
      await this.writeVersion(c, 'analysis_finding_versions', 'finding_id', row, input.createdBy, 'створено');
      return row;
    });
  }

  async getFinding(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM analysis_findings WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toFinding(rows[0]) : null;
  }

  async setFindingStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor, reason = '') {
    checkStatusChange(status, actor);
    return this.mutate(async (c) => {
      if (!isUuid(id)) throw notFound('Висновок');
      const { rows } = await c.query(
        `UPDATE analysis_findings SET status = $3, needs_review = false, version = version + 1, updated_at = now()
         WHERE project_id = $1 AND id = $2 RETURNING *`,
        [projectId, id, status],
      );
      if (!rows[0]) throw notFound('Висновок');
      const row = toFinding(rows[0]);
      await this.writeVersion(c, 'analysis_finding_versions', 'finding_id', row, actor, reason);
      return row;
    });
  }

  async markFindingsNeedReview(projectId: string, paragraphIds: string[]) {
    if (!paragraphIds.length) return 0;
    const { rowCount } = await this.q(
      `UPDATE analysis_findings SET needs_review = true, updated_at = now()
       WHERE project_id = $1 AND NOT needs_review AND source_paragraph_ids && $2::text[]`,
      [projectId, paragraphIds],
    );
    return rowCount ?? 0;
  }

  async listFindings(projectId: string, filter: { entityId?: string; status?: CoreStatus } = {}) {
    if (filter.entityId !== undefined && !isUuid(filter.entityId)) return [];
    const { rows } = await this.q(
      `SELECT * FROM analysis_findings
       WHERE project_id = $1 AND ($2::uuid IS NULL OR entity_id = $2) AND ($3::text IS NULL OR status = $3)
       ORDER BY created_at`,
      [projectId, filter.entityId ?? null, filter.status ?? null],
    );
    return rows.map(toFinding);
  }

  async listFindingVersions(projectId: string, id: string) {
    if (!isUuid(id)) return [];
    const { rows } = await this.q(
      'SELECT * FROM analysis_finding_versions WHERE project_id = $1 AND finding_id = $2 ORDER BY version',
      [projectId, id],
    );
    return rows.map((r: any) => toVersion<FindingRow>(r, 'finding_id'));
  }

  // ── Пошук (Т1.2) ─────────────────────────────────────────────────────────
  // Лише живі абзаци живих розділів, із текстом — та сама умова, що в пам'яті.

  async searchParagraphsByText(projectId: string, stems: string[], limit: number): Promise<ParagraphScore[]> {
    if (!stems.length) return [];
    const { rows } = await this.q(
      `SELECT p.id, ts_rank(p.search_tsv, q) AS score
       FROM paragraphs p
       JOIN documents d ON d.project_id = p.project_id AND d.id = p.document_id AND d.deleted_at IS NULL,
            to_tsquery('simple', $2) q
       WHERE p.project_id = $1 AND p.deleted_at IS NULL AND p.kind = ANY($3::text[]) AND p.search_tsv @@ q
       ORDER BY score DESC, p.id
       LIMIT $4`,
      [projectId, tsQueryFromStems(stems), SEARCHABLE_KINDS, limit],
    );
    return rows.map((r: any) => ({ paragraphId: r.id, score: Number(r.score) }));
  }

  async searchParagraphsByVector(projectId: string, model: string, vector: number[], limit: number): Promise<ParagraphScore[]> {
    const { rows } = await this.q(
      `SELECT e.paragraph_id, 1 - (e.embedding <=> $3::vector) AS score
       FROM paragraph_embeddings e
       JOIN paragraphs p ON p.project_id = e.project_id AND p.id = e.paragraph_id AND p.deleted_at IS NULL
       JOIN documents d ON d.project_id = p.project_id AND d.id = p.document_id AND d.deleted_at IS NULL
       WHERE e.project_id = $1 AND e.model = $2 AND p.kind = ANY($4::text[])
       ORDER BY e.embedding <=> $3::vector, e.paragraph_id
       LIMIT $5`,
      [projectId, model, vectorLiteral(vector), SEARCHABLE_KINDS, limit],
    );
    return rows.map((r: any) => ({ paragraphId: r.paragraph_id, score: Number(r.score) }));
  }

  async listEmbeddingHashes(projectId: string, model: string) {
    const { rows } = await this.q(
      'SELECT paragraph_id, content_hash FROM paragraph_embeddings WHERE project_id = $1 AND model = $2',
      [projectId, model],
    );
    return rows.map((r: any) => ({ paragraphId: r.paragraph_id as string, contentHash: r.content_hash as string }));
  }

  async upsertParagraphEmbeddings(projectId: string, model: string, rows: EmbeddingInput[]) {
    if (!rows.length) return 0;
    await this.q(
      `INSERT INTO paragraph_embeddings (project_id, paragraph_id, model, content_hash, embedding)
       SELECT $1, u.pid, $2, u.hash, u.vec::vector
       FROM unnest($3::text[], $4::text[], $5::text[]) AS u(pid, hash, vec)
       ON CONFLICT (project_id, paragraph_id, model)
       DO UPDATE SET content_hash = excluded.content_hash, embedding = excluded.embedding, updated_at = now()`,
      [projectId, model, rows.map((r) => r.paragraphId), rows.map((r) => r.contentHash), rows.map((r) => vectorLiteral(r.vector))],
    );
    return rows.length;
  }

  async pruneParagraphEmbeddings(projectId: string, keepModel: string) {
    const res = await this.q(
      `DELETE FROM paragraph_embeddings e
       USING paragraphs p
       WHERE e.project_id = $1 AND p.project_id = e.project_id AND p.id = e.paragraph_id
         AND (e.model <> $2 OR p.deleted_at IS NOT NULL)`,
      [projectId, keepModel],
    );
    return res?.rowCount ?? 0;
  }

  // ── Хронологія (Т2.1) ────────────────────────────────────────────────────

  async listTimePoints(projectId: string) {
    const { rows } = await this.q('SELECT * FROM story_time_points WHERE project_id = $1 ORDER BY subject_kind, subject_id', [projectId]);
    return rows.map(toTimePoint);
  }

  async upsertTimePoint(input: TimePointInput) {
    checkTimePoint(input);
    const { rows } = await this.q(
      `INSERT INTO story_time_points
         (project_id, subject_kind, subject_id, kind, start_value, end_value, sort_key, end_key, label, status, source, evidence, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (project_id, subject_kind, subject_id) DO UPDATE SET
         kind = excluded.kind, start_value = excluded.start_value, end_value = excluded.end_value,
         sort_key = excluded.sort_key, end_key = excluded.end_key, label = excluded.label,
         status = excluded.status, source = excluded.source, evidence = excluded.evidence,
         created_by = excluded.created_by, updated_at = now()
       RETURNING *`,
      [
        input.projectId, input.subjectKind, input.subjectId, input.kind, input.start ?? null, input.end ?? null,
        input.sortKey ?? null, input.endKey ?? null, input.label ?? '', input.status ?? 'confirmed', input.source ?? 'author',
        input.evidence ?? [], input.createdBy,
      ],
    );
    return toTimePoint(rows[0]);
  }

  async deleteTimePoint(projectId: string, subjectKind: TimePointRow['subjectKind'], subjectId: string) {
    const res = await this.q('DELETE FROM story_time_points WHERE project_id = $1 AND subject_kind = $2 AND subject_id = $3', [projectId, subjectKind, subjectId]);
    return (res?.rowCount ?? 0) > 0;
  }

  // ── Емоційний монітор (Т2.2) ─────────────────────────────────────────────

  async listEmotionPoints(projectId: string, characterId?: string) {
    if (characterId && !isUuid(characterId)) return [];
    const { rows } = characterId
      ? await this.q('SELECT * FROM emotion_points WHERE project_id = $1 AND character_id = $2 ORDER BY updated_at, id', [projectId, characterId])
      : await this.q('SELECT * FROM emotion_points WHERE project_id = $1 ORDER BY updated_at, id', [projectId]);
    return rows.map(toEmotionPoint);
  }

  async upsertEmotionPoint(input: EmotionPointInput) {
    checkEmotionPoint(input);
    if (!isUuid(input.characterId)) throw notFound(`Герой «${input.characterId}»`);
    if (input.findingId != null && !isUuid(input.findingId)) throw new CoreRuleError('bad_input', 'Неправильний id висновку');
    // Зовнішні ключі (герой, абзац цього проєкту) → not_found, як у сховищі в пам'яті.
    const { rows } = await this.q(
      `INSERT INTO emotion_points
         (project_id, character_id, paragraph_id, emotion, family, layer, intensity, craft, impact, note, source, status, finding_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (project_id, character_id, paragraph_id, emotion) DO UPDATE SET
         family = excluded.family, layer = excluded.layer, intensity = excluded.intensity, craft = excluded.craft,
         impact = excluded.impact, note = excluded.note, source = excluded.source, status = excluded.status,
         finding_id = excluded.finding_id, created_by = excluded.created_by, updated_at = now()
       RETURNING *`,
      [
        input.projectId, input.characterId, input.paragraphId, input.emotion.trim(), input.family, input.layer ?? 'primary',
        input.intensity, input.craft ?? null, input.impact ?? null, input.note ?? '', input.source ?? 'author',
        input.status ?? 'confirmed', input.findingId ?? null, input.createdBy,
      ],
    );
    return toEmotionPoint(rows[0]);
  }

  async deleteEmotionPoint(projectId: string, id: string) {
    if (!isUuid(id)) return false;
    const res = await this.q('DELETE FROM emotion_points WHERE project_id = $1 AND id = $2', [projectId, id]);
    return (res?.rowCount ?? 0) > 0;
  }

  // ── Бібліотека ілюстрацій (Т2.3 В2) ──────────────────────────────────────

  async listAssetLinks(projectId: string, filter: { entityId?: string; sectionId?: string; assetUrl?: string; source?: AssetLinkRow['source'] } = {}) {
    if (filter.entityId && !isUuid(filter.entityId)) return [];
    const where = ['project_id = $1'];
    const params: unknown[] = [projectId];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(`${sql} = $${params.length}`);
    };
    if (filter.entityId) add('entity_id', filter.entityId);
    if (filter.sectionId) add('section_id', filter.sectionId);
    if (filter.assetUrl) add('asset_url', filter.assetUrl);
    if (filter.source) add('source', filter.source);
    const { rows } = await this.q(`SELECT * FROM asset_entity_links WHERE ${where.join(' AND ')} ORDER BY created_at, id`, params);
    return rows.map(toAssetLink);
  }

  async upsertAssetLink(input: AssetLinkInput) {
    checkAssetLink(input);
    if (input.entityId && !isUuid(input.entityId)) throw notFound(`Сутність «${input.entityId}»`);
    if (input.appearanceVersionId) {
      const v = await this.getAppearanceVersion(input.projectId, input.appearanceVersionId);
      if (!v) throw notFound(`Версію зовнішності «${input.appearanceVersionId}»`);
      if (v.entityId !== input.entityId) throw new CoreRuleError('bad_input', 'Версія зовнішності належить іншому героєві');
    }
    const target = input.entityId ? `e:${input.entityId}` : `s:${input.sectionId}`;
    const assetId = /^\/api\/media\/file\/([A-Za-z0-9_-]+)/.exec(input.assetUrl)?.[1] ?? null;
    // Зовнішні ключі (сутність, розділ цього проєкту) → not_found, як у сховищі в пам'яті.
    // Версія: undefined — лишити як є ($15 = false), null чи id — записати.
    const { rows } = await this.q(
      `INSERT INTO asset_entity_links
         (project_id, asset_url, asset_id, entity_id, section_id, target, role, status, source, checked_hash, evidence, note, created_by, appearance_version_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (project_id, asset_url, target, role) DO UPDATE SET
         status = excluded.status, source = excluded.source,
         checked_hash = COALESCE(excluded.checked_hash, asset_entity_links.checked_hash),
         needs_review = CASE WHEN excluded.checked_hash IS NOT NULL THEN false ELSE asset_entity_links.needs_review END,
         evidence = CASE WHEN cardinality(excluded.evidence) > 0 THEN excluded.evidence ELSE asset_entity_links.evidence END,
         note = CASE WHEN excluded.note <> '' THEN excluded.note ELSE asset_entity_links.note END,
         appearance_version_id = CASE WHEN $15::boolean THEN excluded.appearance_version_id ELSE asset_entity_links.appearance_version_id END,
         created_by = excluded.created_by, updated_at = now()
       RETURNING *`,
      [
        input.projectId, input.assetUrl, assetId, input.entityId ?? null, input.sectionId ?? null, target, input.role,
        input.status ?? 'confirmed', input.source ?? 'author', input.checkedHash ?? null, input.evidence ?? [], input.note ?? '', input.createdBy,
        input.appearanceVersionId ?? null, input.appearanceVersionId !== undefined,
      ],
    );
    return toAssetLink(rows[0]);
  }

  async getAssetLink(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM asset_entity_links WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toAssetLink(rows[0]) : null;
  }

  async setAssetLinkStatus(projectId: string, id: string, status: CoreStatus) {
    if (!isUuid(id)) throw notFound(`Зв'язок зображення «${id}»`);
    const { rows } = await this.q(
      'UPDATE asset_entity_links SET status = $3, updated_at = now() WHERE project_id = $1 AND id = $2 RETURNING *',
      [projectId, id, status],
    );
    if (!rows[0]) throw notFound(`Зв'язок зображення «${id}»`);
    return toAssetLink(rows[0]);
  }

  async setAssetLinkReview(projectId: string, id: string, review: { needsReview: boolean; checkedHash?: string | null }) {
    if (!isUuid(id)) throw notFound(`Зв'язок зображення «${id}»`);
    const { rows } = await this.q(
      `UPDATE asset_entity_links SET needs_review = $3,
         checked_hash = CASE WHEN $5::boolean THEN $4 ELSE checked_hash END, updated_at = now()
       WHERE project_id = $1 AND id = $2 RETURNING *`,
      [projectId, id, !!review.needsReview, review.checkedHash ?? null, review.checkedHash !== undefined],
    );
    if (!rows[0]) throw notFound(`Зв'язок зображення «${id}»`);
    return toAssetLink(rows[0]);
  }

  async deleteAssetLink(projectId: string, id: string) {
    if (!isUuid(id)) return false;
    const res = await this.q('DELETE FROM asset_entity_links WHERE project_id = $1 AND id = $2', [projectId, id]);
    return (res?.rowCount ?? 0) > 0;
  }

  // ── Версії зовнішності (Т2.3 В3) ─────────────────────────────────────────

  async listAppearanceVersions(projectId: string, entityId?: string) {
    if (entityId && !isUuid(entityId)) return [];
    const { rows } = await this.q(
      `SELECT * FROM appearance_versions WHERE project_id = $1 AND ($2::uuid IS NULL OR entity_id = $2)
       ORDER BY COALESCE(from_chapter, 0), created_at, id`,
      [projectId, entityId ?? null],
    );
    return rows.map(toAppearanceVersion);
  }

  async getAppearanceVersion(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM appearance_versions WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toAppearanceVersion(rows[0]) : null;
  }

  async upsertAppearanceVersion(input: AppearanceVersionInput) {
    const n = checkAppearanceVersion(input);
    if (!isUuid(input.entityId)) throw notFound(`Сутність «${input.entityId}»`);
    const hash = appearanceHash(n.description);
    return this.tx(async (c) => {
      let row: AppearanceVersionRow;
      if (input.id) {
        const prev = isUuid(input.id) ? (await this.q('SELECT * FROM appearance_versions WHERE project_id = $1 AND id = $2 FOR UPDATE', [input.projectId, input.id], c)).rows[0] : null;
        if (!prev) throw notFound(`Версію зовнішності «${input.id}»`);
        if (prev.entity_id !== input.entityId) throw new CoreRuleError('bad_input', 'Версію не можна перенести до іншого героя');
        const { rows } = await this.q(
          `UPDATE appearance_versions SET label = $3, age = $4, from_chapter = $5, to_chapter = $6, description = $7,
             description_hash = $8, approved = $9, updated_at = now()
           WHERE project_id = $1 AND id = $2 RETURNING *`,
          [input.projectId, input.id, n.label, n.age, n.fromChapter, n.toChapter, n.description, hash, n.approved],
          c,
        );
        row = toAppearanceVersion(rows[0]);
      } else {
        const { rows } = await this.q(
          `INSERT INTO appearance_versions (project_id, entity_id, label, age, from_chapter, to_chapter, description, description_hash, approved, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [input.projectId, input.entityId, n.label, n.age, n.fromChapter, n.toChapter, n.description, hash, n.approved, input.createdBy],
          c,
        );
        row = toAppearanceVersion(rows[0]);
      }
      await this.addAppearanceHistory(
        { projectId: row.projectId, versionId: row.id, entityId: row.entityId, action: input.id ? 'updated' : 'created', snapshot: { ...row }, actor: input.createdBy },
        c,
      );
      return row;
    });
  }

  async deleteAppearanceVersion(projectId: string, id: string, actor: string) {
    if (!isUuid(id)) return false;
    return this.tx(async (c) => {
      const { rows } = await this.q('DELETE FROM appearance_versions WHERE project_id = $1 AND id = $2 RETURNING *', [projectId, id], c);
      if (!rows[0]) return false;
      const v = toAppearanceVersion(rows[0]);
      await this.addAppearanceHistory({ projectId, versionId: id, entityId: v.entityId, action: 'deleted', snapshot: { ...v }, actor }, c);
      return true;
    });
  }

  async addAppearanceHistory(input: Omit<AppearanceHistoryRow, 'id' | 'at'>, on?: PoolClient) {
    await this.q(
      `INSERT INTO appearance_version_history (project_id, version_id, entity_id, action, snapshot, actor) VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.projectId, input.versionId, input.entityId, input.action, JSON.stringify(input.snapshot ?? {}), input.actor],
      on ?? this.pool,
    );
  }

  async listAppearanceHistory(projectId: string, entityId: string, limit = 50) {
    if (!isUuid(entityId)) return [];
    const { rows } = await this.q(
      'SELECT * FROM appearance_version_history WHERE project_id = $1 AND entity_id = $2 ORDER BY at DESC, id DESC LIMIT $3',
      [projectId, entityId, limit],
    );
    return rows.map(toAppearanceHistory);
  }

  // ── Риси сутностей (Т2.4 В1) ─────────────────────────────────────────────

  async listEntityTraits(projectId: string, entityId?: string) {
    if (entityId && !isUuid(entityId)) return [];
    const { rows } = await this.q(
      'SELECT * FROM entity_traits WHERE project_id = $1 AND ($2::uuid IS NULL OR entity_id = $2) ORDER BY created_at, id',
      [projectId, entityId ?? null],
    );
    return rows.map(toEntityTrait);
  }

  async upsertEntityTrait(input: EntityTraitInput) {
    const n = checkEntityTrait(input);
    if (!isUuid(input.entityId)) throw notFound(`Сутність «${input.entityId}»`);
    if (input.supersedes) {
      if (!isUuid(input.supersedes)) throw notFound(`Риса «${input.supersedes}»`);
      const { rows: sr } = await this.q('SELECT entity_id, label FROM entity_traits WHERE project_id = $1 AND id = $2', [input.projectId, input.supersedes]);
      if (!sr[0]) throw notFound(`Риса «${input.supersedes}»`);
      if (sr[0].entity_id !== input.entityId || String(sr[0].label).trim().toLocaleLowerCase('uk') !== n.label.toLocaleLowerCase('uk')) {
        throw new CoreRuleError('bad_input', 'Заміняти можна лише рису тієї самої сутності з тією самою міткою');
      }
    }
    if (input.appearanceVersionId) {
      if (!isUuid(input.appearanceVersionId)) throw notFound(`Версію зовнішності «${input.appearanceVersionId}»`);
      const { rows: vr } = await this.q('SELECT entity_id FROM appearance_versions WHERE project_id = $1 AND id = $2', [input.projectId, input.appearanceVersionId]);
      if (!vr[0]) throw notFound(`Версію зовнішності «${input.appearanceVersionId}»`);
      if (vr[0].entity_id !== input.entityId) throw new CoreRuleError('bad_input', 'Версія зовнішності належить іншій сутності');
    }
    let id = input.id;
    if (id && !isUuid(id)) throw notFound(`Риса «${id}»`);
    let prev: any = null;
    if (id) {
      const { rows } = await this.q('SELECT * FROM entity_traits WHERE project_id = $1 AND id = $2', [input.projectId, id]);
      if (!rows[0]) throw notFound(`Риса «${id}»`);
      prev = rows[0];
    } else if (input.appearanceVersionId) {
      // Без явного id, але з версією зовнішності — та сама похідна риса (Т2.4 В3): оновити, не дублювати.
      const { rows } = await this.q('SELECT * FROM entity_traits WHERE project_id = $1 AND appearance_version_id = $2', [input.projectId, input.appearanceVersionId]);
      prev = rows[0] ?? null;
      if (prev) id = prev.id;
    }
    const sectionId = input.sectionId !== undefined ? input.sectionId : prev?.section_id ?? null;
    const storyTimeKey = input.storyTimeKey !== undefined ? input.storyTimeKey : prev?.story_time_key ?? null;
    const supersedes = input.supersedes !== undefined ? input.supersedes : prev?.supersedes ?? null;
    const appearanceVersionId = input.appearanceVersionId !== undefined ? input.appearanceVersionId : prev?.appearance_version_id ?? null;
    if (id) {
      const { rows } = await this.q(
        `UPDATE entity_traits SET label = $3, value = $4, section_id = $5, story_time_key = $6,
           status = $7, source = $8, supersedes = $9, appearance_version_id = $10, created_by = $11, updated_at = now()
         WHERE project_id = $1 AND id = $2 RETURNING *`,
        [input.projectId, id, n.label, n.value, sectionId, storyTimeKey, n.status, n.source, supersedes, appearanceVersionId, input.createdBy],
      );
      if (!rows[0]) throw notFound(`Риса «${id}»`);
      return toEntityTrait(rows[0]);
    }
    const { rows } = await this.q(
      `INSERT INTO entity_traits (project_id, entity_id, label, value, section_id, story_time_key, status, source, supersedes, appearance_version_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [input.projectId, input.entityId, n.label, n.value, sectionId, storyTimeKey, n.status, n.source, supersedes, appearanceVersionId, input.createdBy],
    );
    return toEntityTrait(rows[0]);
  }

  async setEntityTraitStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor) {
    if (!isUuid(id)) throw notFound(`Риса «${id}»`);
    const { rows } = await this.q(
      'UPDATE entity_traits SET status = $3, created_by = $4, updated_at = now() WHERE project_id = $1 AND id = $2 RETURNING *',
      [projectId, id, status, actor],
    );
    if (!rows[0]) throw notFound(`Риса «${id}»`);
    return toEntityTrait(rows[0]);
  }

  async deleteEntityTrait(projectId: string, id: string) {
    if (!isUuid(id)) return false;
    const res = await this.q('DELETE FROM entity_traits WHERE project_id = $1 AND id = $2', [projectId, id]);
    return (res?.rowCount ?? 0) > 0;
  }

  // ── Проблеми безперервності (Т2.4 В1) ────────────────────────────────────

  async listContinuityIssues(projectId: string, filter: { kind?: ContinuityIssueKind; status?: ContinuityIssueStatus; entityId?: string } = {}) {
    if (filter.entityId && !isUuid(filter.entityId)) return [];
    const where = ['project_id = $1'];
    const params: unknown[] = [projectId];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(`${sql} = $${params.length}`);
    };
    if (filter.kind) add('kind', filter.kind);
    if (filter.status) add('status', filter.status);
    if (filter.entityId) add('entity_id', filter.entityId);
    const { rows } = await this.q(`SELECT * FROM continuity_issues WHERE ${where.join(' AND ')} ORDER BY created_at, id`, params);
    return rows.map(toContinuityIssue);
  }

  async getContinuityIssue(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM continuity_issues WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toContinuityIssue(rows[0]) : null;
  }

  async upsertContinuityIssue(input: ContinuityIssueInput) {
    const n = checkContinuityIssue(input);
    if (input.entityId && !isUuid(input.entityId)) throw notFound(`Сутність «${input.entityId}»`);
    const evidenceB = input.evidenceB ?? null;
    if (input.id) {
      if (!isUuid(input.id)) throw notFound(`Проблема «${input.id}»`);
      const { rows } = await this.q(
        `UPDATE continuity_issues SET kind = $3, entity_id = $4, summary = $5, evidence_a = $6,
           evidence_b = COALESCE($7::jsonb, evidence_b), status = $8, source = $9,
           checked_hash = CASE WHEN $11::boolean THEN $10 ELSE checked_hash END,
           insufficient_data = $12, created_by = $13, updated_at = now()
         WHERE project_id = $1 AND id = $2 RETURNING *`,
        [
          input.projectId, input.id, input.kind, input.entityId ?? null, n.summary, JSON.stringify(input.evidenceA),
          evidenceB ? JSON.stringify(evidenceB) : null, n.status, n.source,
          input.checkedHash ?? null, input.checkedHash !== undefined, n.insufficientData, input.createdBy,
        ],
      );
      if (!rows[0]) throw notFound(`Проблема «${input.id}»`);
      return toContinuityIssue(rows[0]);
    }
    const { rows } = await this.q(
      `INSERT INTO continuity_issues
         (project_id, kind, entity_id, summary, evidence_a, evidence_b, status, source, checked_hash, insufficient_data, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        input.projectId, input.kind, input.entityId ?? null, n.summary, JSON.stringify(input.evidenceA),
        evidenceB ? JSON.stringify(evidenceB) : null, n.status, n.source, input.checkedHash ?? null, n.insufficientData, input.createdBy,
      ],
    );
    return toContinuityIssue(rows[0]);
  }

  async setContinuityIssueStatus(projectId: string, id: string, status: ContinuityIssueStatus, actor: CoreActor) {
    if (!isUuid(id)) throw notFound(`Проблема «${id}»`);
    const { rows } = await this.q(
      'UPDATE continuity_issues SET status = $3, created_by = $4, updated_at = now() WHERE project_id = $1 AND id = $2 RETURNING *',
      [projectId, id, status, actor],
    );
    if (!rows[0]) throw notFound(`Проблема «${id}»`);
    return toContinuityIssue(rows[0]);
  }

  async deleteContinuityIssue(projectId: string, id: string) {
    if (!isUuid(id)) return false;
    const res = await this.q('DELETE FROM continuity_issues WHERE project_id = $1 AND id = $2', [projectId, id]);
    return (res?.rowCount ?? 0) > 0;
  }

  // ── Перевірки чернеток (Т2.4 В7) ─────────────────────────────────────────

  async addContinuityDraftCheck(input: ContinuityDraftCheckInput) {
    const n = checkContinuityDraftCheck(input);
    if (!isUuid(input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    const { rows: e } = await this.q('SELECT 1 FROM entities WHERE project_id = $1 AND id = $2', [input.projectId, input.characterId]);
    if (!e[0]) throw notFound(`Сутність «${input.characterId}»`);
    const { rows } = await this.q(
      `INSERT INTO continuity_draft_checks (project_id, character_id, section_id, draft_text, findings, simulation_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [input.projectId, input.characterId, input.sectionId ?? null, n.draftText, JSON.stringify(input.findings), input.simulationId ?? null, input.createdBy],
    );
    return toDraftCheck(rows[0]);
  }

  async listContinuityDraftChecks(projectId: string, filter: { characterId?: string; simulationId?: string; limit?: number } = {}) {
    if (filter.characterId && !isUuid(filter.characterId)) return [];
    const where = ['project_id = $1'];
    const params: unknown[] = [projectId];
    if (filter.characterId) { params.push(filter.characterId); where.push(`character_id = $${params.length}`); }
    if (filter.simulationId) { params.push(filter.simulationId); where.push(`simulation_id = $${params.length}`); }
    params.push(Math.max(1, Math.min(filter.limit ?? 50, 200)));
    const { rows } = await this.q(
      `SELECT * FROM continuity_draft_checks WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(toDraftCheck);
  }

  async getContinuityDraftCheck(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM continuity_draft_checks WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toDraftCheck(rows[0]) : null;
  }

  // ── Журнал рішень героя (Т2.5 В2) ────────────────────────────────────────

  async addCharacterDecision(input: CharacterDecisionInput) {
    const n = checkCharacterDecision(input);
    if (!isUuid(input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    if (input.parentId && !isUuid(input.parentId)) throw notFound(`Рішення «${input.parentId}»`);
    const { rows: e } = await this.q('SELECT 1 FROM entities WHERE project_id = $1 AND id = $2', [input.projectId, input.characterId]);
    if (!e[0]) throw notFound(`Сутність «${input.characterId}»`);
    if (input.parentId) {
      const { rows: p } = await this.q('SELECT 1 FROM character_decisions WHERE project_id = $1 AND id = $2', [input.projectId, input.parentId]);
      if (!p[0]) throw notFound(`Рішення «${input.parentId}»`);
    }
    const json = (v: unknown) => JSON.stringify(v);
    const { rows } = await this.q(
      `INSERT INTO character_decisions
         (project_id, character_id, level, scene_id, simulation_id, turn_index, cache_key, parent_id, questions, options, result,
          selected_action, validation, snapshot_hash, model_version, source, fallback_reason, basis, status, usage, latency_ms, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING *`,
      [
        input.projectId, input.characterId, input.level, input.sceneId ?? null, input.simulationId ?? null, input.turnIndex ?? null, input.cacheKey,
        input.parentId ?? null, json(input.questions ?? []), json(input.options ?? {}), input.result ? json(input.result) : null,
        n.selectedAction, json(input.validation ?? {}), input.snapshotHash, input.modelVersion, input.source, input.fallbackReason ?? null,
        json(input.basis ?? {}), n.status, json(input.usage ?? {}), Math.max(0, Math.round(input.latencyMs ?? 0)), input.createdBy,
      ],
    );
    return toDecision(rows[0]);
  }

  async getCharacterDecision(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM character_decisions WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toDecision(rows[0]) : null;
  }

  async listCharacterDecisions(projectId: string, f: CharacterDecisionFilter = {}) {
    if (f.characterId && !isUuid(f.characterId)) return [];
    const where = ['project_id = $1'];
    const params: unknown[] = [projectId];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(`${sql} = $${params.length}`);
    };
    if (f.characterId) add('character_id', f.characterId);
    if (f.level) add('level', f.level);
    if (f.status) add('status', f.status);
    if (f.simulationId) add('simulation_id', f.simulationId);
    if (f.cacheKey) add('cache_key', f.cacheKey);
    if (f.sceneId !== undefined) {
      if (f.sceneId === null) where.push('scene_id IS NULL');
      else add('scene_id', f.sceneId);
    }
    params.push(Math.max(1, Math.min(f.limit ?? 100, 500)));
    const { rows } = await this.q(`SELECT * FROM character_decisions WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`, params);
    return rows.map(toDecision);
  }

  async supersedeCharacterDecisions(projectId: string, f: { characterId: string; level: CharacterDecisionLevel; sceneId?: string | null; exceptId?: string }) {
    if (!isUuid(f.characterId)) return 0;
    const params: unknown[] = [projectId, f.characterId, f.level];
    let sql = `UPDATE character_decisions SET status = 'superseded' WHERE project_id = $1 AND character_id = $2 AND level = $3 AND status = 'active'`;
    if (f.exceptId && isUuid(f.exceptId)) {
      params.push(f.exceptId);
      sql += ` AND id <> $${params.length}`;
    }
    if (f.sceneId !== undefined) {
      if (f.sceneId === null) sql += ' AND scene_id IS NULL';
      else {
        params.push(f.sceneId);
        sql += ` AND scene_id = $${params.length}`;
      }
    }
    const res = await this.q(sql, params);
    return res?.rowCount ?? 0;
  }

  async resolveCharacterDecision(projectId: string, id: string, input: { selectedAction: string; result: Record<string, unknown>; actor: CoreActor }) {
    if (!isUuid(id)) throw notFound(`Рішення «${id}»`);
    if (!/^user:.+/.test(input.actor)) throw new CoreRuleError('bad_input', 'Рішення автора — лише від користувача');
    const action = String(input.selectedAction ?? '').trim();
    if (!action || action.length > 60) throw new CoreRuleError('bad_input', 'Обрана дія — від 1 до 60 символів');
    const cur = await this.getCharacterDecision(projectId, id);
    if (!cur) throw notFound(`Рішення «${id}»`);
    if (cur.status !== 'awaiting_author') throw new CoreRuleError('conflict', 'Рішення вже прийнято — вибір автора потрібен лише для «чекає автора»');
    const { rows } = await this.q(
      `UPDATE character_decisions SET status = 'active', source = 'author', selected_action = $3, result = $4, resolved_by = $5, resolved_at = now()
       WHERE project_id = $1 AND id = $2 AND status = 'awaiting_author' RETURNING *`,
      [projectId, id, action, JSON.stringify(input.result), input.actor],
    );
    if (!rows[0]) throw new CoreRuleError('conflict', 'Рішення вже прийнято — вибір автора потрібен лише для «чекає автора»');
    return toDecision(rows[0]);
  }

  // ── Пам'ять героя (Т2.6 В1) ──────────────────────────────────────────────

  async addCharacterMemory(input: CharacterMemoryInput) {
    const n = checkCharacterMemory(input);
    if (!isUuid(input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    const { rows: e } = await this.q('SELECT 1 FROM entities WHERE project_id = $1 AND id = $2', [input.projectId, input.characterId]);
    if (!e[0]) throw notFound(`Сутність «${input.characterId}»`);
    const json = (v: unknown) => JSON.stringify(v);
    const { rows } = await this.q(
      `INSERT INTO character_memories
         (project_id, character_id, memory_type, layer, content, about_entity_ids, effects, belief_status, truth, source_event_kind, source_event_id,
          source_paragraph_ids, evidence_hash, scene_id, story_time, simulation_id, canon_revision, visibility, origin, status, dedupe_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING *`,
      [
        input.projectId, input.characterId, input.memoryType, n.layer, n.content, json(input.aboutEntityIds ?? []), json(input.effects ?? {}), n.beliefStatus, n.truth,
        input.sourceEventKind, input.sourceEventId ?? null, json(input.sourceParagraphIds ?? []), input.evidenceHash ?? null, input.sceneId ?? null,
        json(input.storyTime ?? {}), input.simulationId || null, input.canonRevision ?? null, n.visibility, input.origin, n.status, input.dedupeKey ?? null, input.createdBy,
      ],
    );
    return toMemory(rows[0]);
  }

  async getCharacterMemory(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM character_memories WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toMemory(rows[0]) : null;
  }

  async listCharacterMemories(projectId: string, f: CharacterMemoryFilter = {}) {
    if (f.characterId && !isUuid(f.characterId)) return [];
    const where = ['project_id = $1'];
    const params: unknown[] = [projectId];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('$$', `$${params.length}`));
    };
    if (f.characterId) add('character_id = $$', f.characterId);
    if (f.memoryType) add('memory_type = $$', f.memoryType);
    if (f.status) add('status = $$', f.status);
    if (f.simulationId === null) where.push('simulation_id IS NULL');
    else if (f.simulationId !== undefined) add('simulation_id = $$', f.simulationId);
    if (f.dedupeKey) add('dedupe_key = $$', f.dedupeKey);
    if (f.paragraphIds) {
      if (!f.paragraphIds.length) return [];
      add('source_paragraph_ids ?| $$::text[]', f.paragraphIds);
    }
    params.push(Math.max(1, Math.min(f.limit ?? 200, 1000)));
    const { rows } = await this.q(`SELECT * FROM character_memories WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id LIMIT $${params.length}`, params);
    return rows.map(toMemory);
  }

  async setCharacterMemoryStatus(projectId: string, id: string, status: CharacterMemoryStatus, actor: CoreActor, note?: string | null) {
    const cur = await this.getCharacterMemory(projectId, id);
    if (!cur) throw notFound(`Спогад «${id}»`);
    checkCharacterMemoryStatus(cur, status, actor, note);
    const reviewed = status === 'confirmed' || status === 'rejected' || status === 'needs_review';
    const { rows } = await this.q(
      `UPDATE character_memories SET status = $3, updated_at = now(),
         reviewed_by = CASE WHEN $4 THEN $5 ELSE reviewed_by END,
         reviewed_at = CASE WHEN $4 THEN now() ELSE reviewed_at END,
         review_note = CASE WHEN $6 THEN $7 ELSE review_note END
       WHERE project_id = $1 AND id = $2 AND status <> 'superseded' RETURNING *`,
      [projectId, id, status, reviewed, actor, note !== undefined, note ?? null],
    );
    if (!rows[0]) throw new CoreRuleError('conflict', 'Спогад уже замінено новішим');
    return toMemory(rows[0]);
  }

  async updateCharacterMemory(projectId: string, id: string, patch: CharacterMemoryPatch, actor: CoreActor) {
    const cur = await this.getCharacterMemory(projectId, id);
    if (!cur) throw notFound(`Спогад «${id}»`);
    checkCharacterMemoryPatch(cur, patch, actor);
    const cols: Record<string, [string, (v: any) => unknown]> = {
      content: ['content', (v) => String(v).trim()],
      effects: ['effects', (v) => JSON.stringify(v)],
      beliefStatus: ['belief_status', (v) => v],
      truth: ['truth', (v) => v],
      visibility: ['visibility', (v) => v],
      evidenceHash: ['evidence_hash', (v) => v],
      canonRevision: ['canon_revision', (v) => v],
      aboutEntityIds: ['about_entity_ids', (v) => JSON.stringify(v)],
    };
    const sets: string[] = [];
    const params: unknown[] = [projectId, id];
    for (const [k, [col, conv]] of Object.entries(cols)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v === undefined) continue;
      params.push(v === null ? null : conv(v));
      sets.push(`${col} = $${params.length}`);
    }
    if (!sets.length) return cur;
    const { rows } = await this.q(
      `UPDATE character_memories SET ${sets.join(', ')}, updated_at = now() WHERE project_id = $1 AND id = $2 AND status <> 'superseded' RETURNING *`,
      params,
    );
    if (!rows[0]) throw new CoreRuleError('conflict', 'Спогад уже замінено новішим');
    return toMemory(rows[0]);
  }

  async addCharacterState(input: CharacterStateInput) {
    assertActor(input.createdBy);
    if (!isUuid(input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    if (!Number.isInteger(input.canonRevision) || input.canonRevision < 0) throw new CoreRuleError('bad_input', 'Ревізія канону — ціле ≥ 0');
    if (!/^[0-9a-f]{16,64}$/.test(String(input.snapshotHash ?? ''))) throw new CoreRuleError('bad_input', 'Відбиток знімка — 16–64 шістнадцяткових символи');
    const json = (v: unknown) => JSON.stringify(v);
    const { rows } = await this.q(
      `INSERT INTO character_states (project_id, character_id, scene_id, simulation_id, canon_revision, goals, emotions, beliefs, relationships, memory_ids, state_version, snapshot_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        input.projectId, input.characterId, input.sceneId ?? null, input.simulationId ?? null, input.canonRevision, json(input.goals ?? []), json(input.emotions ?? []),
        json(input.beliefs ?? []), json(input.relationships ?? []), json(input.memoryIds ?? []), input.stateVersion ?? 1, input.snapshotHash, input.createdBy,
      ],
    );
    return toState(rows[0]);
  }

  async getCharacterState(projectId: string, k: { characterId: string; sceneId: string | null; simulationId: string | null; canonRevision: number }) {
    if (!isUuid(k.characterId)) return null;
    const { rows } = await this.q(
      `SELECT * FROM character_states WHERE project_id = $1 AND character_id = $2 AND scene_id IS NOT DISTINCT FROM $3 AND simulation_id IS NOT DISTINCT FROM $4 AND canon_revision = $5
       ORDER BY created_at DESC, id LIMIT 1`,
      [projectId, k.characterId, k.sceneId, k.simulationId, k.canonRevision],
    );
    return rows[0] ? toState(rows[0]) : null;
  }

  // ── Допит (Т2.7 В1) ──────────────────────────────────────────────────────

  async getCharacterAgent(projectId: string, characterId: string) {
    if (!isUuid(characterId)) return null;
    const { rows } = await this.q('SELECT * FROM character_agents WHERE project_id = $1 AND character_id = $2', [projectId, characterId]);
    return rows[0] ? toAgent(rows[0]) : null;
  }

  async upsertCharacterAgent(input: CharacterAgentInput) {
    checkCharacterAgent(input);
    if (!isUuid(input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
    const { rows } = await this.q(
      `INSERT INTO character_agents (project_id, character_id, enabled, autonomy_level, agent_config, model_policy, created_by, updated_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb), COALESCE($6::jsonb, '{}'::jsonb), $7, $7)
       ON CONFLICT (project_id, character_id) DO UPDATE SET
         enabled = EXCLUDED.enabled, autonomy_level = EXCLUDED.autonomy_level,
         agent_config = COALESCE($5::jsonb, character_agents.agent_config),
         model_policy = COALESCE($6::jsonb, character_agents.model_policy),
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [input.projectId, input.characterId, input.autonomyLevel !== 'off', input.autonomyLevel, json(input.agentConfig), json(input.modelPolicy), input.actor],
    );
    return toAgent(rows[0]);
  }

  async listCharacterAgents(projectId: string) {
    const { rows } = await this.q('SELECT * FROM character_agents WHERE project_id = $1 ORDER BY created_at, id', [projectId]);
    return rows.map(toAgent);
  }

  async addSimulation(input: SimulationInput) {
    checkSimulation(input);
    if (input.characterId && !isUuid(input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    const { rows } = await this.q(
      `INSERT INTO scene_simulations (project_id, kind, character_id, scene_id, as_of_chapter, base_book_revision, title, config, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [input.projectId, input.kind, input.characterId ?? null, input.sceneId ?? null, input.asOfChapter ?? null, input.baseBookRevision, input.title ?? '', JSON.stringify(input.config ?? {}), input.createdBy],
    );
    return toSimulation(rows[0]);
  }

  async getSimulation(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM scene_simulations WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toSimulation(rows[0]) : null;
  }

  async listSimulations(projectId: string, f: { characterId?: string; kind?: SimulationKind; status?: SimulationStatus; limit?: number } = {}) {
    if (f.characterId && !isUuid(f.characterId)) return [];
    const where = ['project_id = $1'];
    const params: unknown[] = [projectId];
    const add = (col: string, v: unknown) => {
      params.push(v);
      where.push(`${col} = $${params.length}`);
    };
    if (f.characterId) add('character_id', f.characterId);
    if (f.kind) add('kind', f.kind);
    if (f.status) add('status', f.status);
    params.push(Math.max(1, Math.min(f.limit ?? 50, 500)));
    const { rows } = await this.q(`SELECT * FROM scene_simulations WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id LIMIT $${params.length}`, params);
    return rows.map(toSimulation);
  }

  async updateSimulation(projectId: string, id: string, patch: SimulationPatch) {
    const cur = await this.getSimulation(projectId, id);
    if (!cur) throw notFound(`Прогін «${id}»`);
    checkSimulationPatch(patch);
    const { rows } = await this.q(
      `UPDATE scene_simulations SET status = COALESCE($3, status), current_turn = COALESCE($4, current_turn), config = COALESCE($5::jsonb, config), title = COALESCE($6, title), updated_at = now()
       WHERE project_id = $1 AND id = $2 RETURNING *`,
      [projectId, id, patch.status ?? null, patch.currentTurn ?? null, patch.config === undefined ? null : JSON.stringify(patch.config), patch.title ?? null],
    );
    return toSimulation(rows[0]);
  }

  async addSimulationEvent(input: SimulationEventInput) {
    checkSimulationEvent(input);
    if (!isUuid(input.simulationId)) throw notFound(`Прогін «${input.simulationId}»`);
    const sim = await this.getSimulation(input.projectId, input.simulationId);
    if (!sim) throw notFound(`Прогін «${input.simulationId}»`);
    if (input.sourceDecisionId && !isUuid(input.sourceDecisionId)) throw notFound(`Рішення «${input.sourceDecisionId}»`);
    const { rows } = await this.q(
      `INSERT INTO simulation_events (project_id, simulation_id, turn_index, actor, actor_character_id, event_type, public_payload, private_payload_ref, source_decision_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [input.projectId, input.simulationId, input.turnIndex, input.actor, input.actorCharacterId ?? null, input.eventType, JSON.stringify(input.publicPayload ?? {}), input.privatePayloadRef ?? null, input.sourceDecisionId ?? null, input.createdBy],
    );
    return toSimEvent(rows[0]);
  }

  async listSimulationEvents(projectId: string, simulationId: string) {
    if (!isUuid(simulationId)) return [];
    const { rows } = await this.q('SELECT * FROM simulation_events WHERE project_id = $1 AND simulation_id = $2 ORDER BY turn_index, created_at, id', [projectId, simulationId]);
    return rows.map(toSimEvent);
  }

  async addCanonProposal(input: CanonProposalInput) {
    checkCanonProposal(input);
    if (!isUuid(input.simulationId)) throw notFound(`Прогін «${input.simulationId}»`);
    if (!isUuid(input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    if (input.parentId && !isUuid(input.parentId)) throw notFound(`Пропозиція «${input.parentId}»`);
    const sim = await this.getSimulation(input.projectId, input.simulationId);
    if (!sim) throw notFound(`Прогін «${input.simulationId}»`);
    const { rows } = await this.q(
      `INSERT INTO canon_proposals (project_id, simulation_id, character_id, source_event_ids, kind, proposed_change, parent_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [input.projectId, input.simulationId, input.characterId, JSON.stringify(input.sourceEventIds ?? []), input.kind, JSON.stringify(input.proposedChange), input.parentId ?? null, input.createdBy],
    );
    return toProposal(rows[0]);
  }

  async getCanonProposal(projectId: string, id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM canon_proposals WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toProposal(rows[0]) : null;
  }

  async listCanonProposals(projectId: string, f: { simulationId?: string; characterId?: string; status?: CanonProposalStatus; kind?: CanonProposalKind; limit?: number } = {}) {
    if ((f.simulationId && !isUuid(f.simulationId)) || (f.characterId && !isUuid(f.characterId))) return [];
    const where = ['project_id = $1'];
    const params: unknown[] = [projectId];
    const add = (col: string, v: unknown) => {
      params.push(v);
      where.push(`${col} = $${params.length}`);
    };
    if (f.simulationId) add('simulation_id', f.simulationId);
    if (f.characterId) add('character_id', f.characterId);
    if (f.status) add('status', f.status);
    if (f.kind) add('kind', f.kind);
    params.push(Math.max(1, Math.min(f.limit ?? 200, 1000)));
    const { rows } = await this.q(`SELECT * FROM canon_proposals WHERE ${where.join(' AND ')} ORDER BY created_at, id LIMIT $${params.length}`, params);
    return rows.map(toProposal);
  }

  async resolveCanonProposal(projectId: string, id: string, input: { status: 'accepted' | 'rejected'; actor: CoreActor; result?: Record<string, unknown> }) {
    if (!/^user:.+/.test(input.actor)) throw new CoreRuleError('confirmed_is_author_only', 'Приймає чи відхиляє пропозицію лише автор');
    if (input.status !== 'accepted' && input.status !== 'rejected') throw new CoreRuleError('bad_input', 'Рішення — accepted або rejected');
    const cur = await this.getCanonProposal(projectId, id);
    if (!cur) throw notFound(`Пропозиція «${id}»`);
    if (cur.status !== 'pending') throw new CoreRuleError('conflict', 'Пропозицію вже вирішено');
    const { rows } = await this.q(
      `UPDATE canon_proposals SET status = $3, result = $4, reviewed_by = $5, reviewed_at = now() WHERE project_id = $1 AND id = $2 AND status = 'pending' RETURNING *`,
      [projectId, id, input.status, JSON.stringify(input.result ?? {}), input.actor],
    );
    if (!rows[0]) throw new CoreRuleError('conflict', 'Пропозицію вже вирішено');
    return toProposal(rows[0]);
  }

  // ── Збережені запити (Т1.3) ──────────────────────────────────────────────

  // ── Реєстр схем: версії онтології (Т5.1 В2) ───────────────────────────────

  async addOntologyVersion(input: OntologyVersionInput) {
    checkOntologyVersion(input);
    if (input.basedOn != null && !isUuid(input.basedOn)) throw notFound(`Версія онтології «${input.basedOn}»`);
    const status = input.status ?? 'draft';
    try {
      return await this.tx(async (c) => {
        // Номер версії — наступний у межах онтології; замок на онтологію, щоб два записи не взяли один номер.
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ontology:${input.ontologyId}`]);
        const { rows } = await c.query(
          `INSERT INTO ontology_versions (ontology_id, version, label, status, based_on, definition, definition_hash, notes, created_by, published_by, published_at)
           SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5, $6, $7, $8,
                  CASE WHEN $3 = 'active' THEN $8 END, CASE WHEN $3 = 'active' THEN now() END
           FROM ontology_versions WHERE ontology_id = $1
           RETURNING *`,
          [input.ontologyId, input.label ?? '', status, input.basedOn ?? null, JSON.stringify(input.definition), input.definitionHash, input.notes ?? '', input.createdBy],
        );
        return toOntologyVersion(rows[0]);
      });
    } catch (err) {
      mapPgError(err);
    }
  }

  async getOntologyVersion(id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM ontology_versions WHERE id = $1', [id]);
    return rows[0] ? toOntologyVersion(rows[0]) : null;
  }

  async getActiveOntologyVersion(ontologyId: string) {
    const { rows } = await this.q(`SELECT * FROM ontology_versions WHERE ontology_id = $1 AND status = 'active'`, [ontologyId]);
    return rows[0] ? toOntologyVersion(rows[0]) : null;
  }

  async listOntologyVersions(ontologyId: string, f: { limit?: number } = {}) {
    const { rows } = await this.q(
      `SELECT id, ontology_id, version, label, status, based_on, NULL::jsonb AS definition, definition_hash, validation, impact, notes, revision,
              created_by, created_at, updated_at, published_by, published_at
       FROM ontology_versions WHERE ontology_id = $1 ORDER BY version DESC LIMIT $2`,
      [ontologyId, Math.max(1, Math.min(f.limit ?? 50, 200))],
    );
    return rows.map(toOntologyVersion);
  }

  async updateOntologyVersion(id: string, patch: OntologyVersionPatch, expectedRevision?: number) {
    const cur = await this.getOntologyVersion(id);
    if (!cur) throw notFound(`Версія онтології «${id}»`);
    checkOntologyVersionPatch(cur, patch);
    if ((patch.status === 'draft' || patch.status === 'validated') && cur.status !== 'draft' && cur.status !== 'validated') {
      throw new CoreRuleError('conflict', 'Повернути в чернетку можна лише відкриту чернетку');
    }
    const has = (k: keyof OntologyVersionPatch) => patch[k] !== undefined;
    const { rows } = await this.q(
      `UPDATE ontology_versions SET
         status = COALESCE($2, status),
         definition = COALESCE($3::jsonb, definition),
         definition_hash = COALESCE($4, definition_hash),
         validation = CASE WHEN $5 THEN $6::jsonb ELSE validation END,
         impact = CASE WHEN $7 THEN $8::jsonb ELSE impact END,
         label = COALESCE($9, label),
         notes = COALESCE($10, notes),
         revision = revision + 1
       WHERE id = $1 AND ($11::integer IS NULL OR revision = $11) RETURNING *`,
      [
        id,
        patch.status ?? null,
        patch.definition === undefined ? null : JSON.stringify(patch.definition),
        patch.definitionHash ?? null,
        has('validation'),
        patch.validation == null ? null : JSON.stringify(patch.validation),
        has('impact'),
        patch.impact == null ? null : JSON.stringify(patch.impact),
        patch.label ?? null,
        patch.notes ?? null,
        expectedRevision ?? null,
      ],
    );
    if (!rows[0]) throw new CoreRuleError('conflict', `Чернетку вже змінено (ревізія ${cur.revision}, а не ${expectedRevision}) — перечитайте її`);
    return toOntologyVersion(rows[0]);
  }

  async activateOntologyVersion(id: string, actor: CoreActor) {
    checkOntologyActor(actor);
    const cur = await this.getOntologyVersion(id);
    if (!cur) throw notFound(`Версія онтології «${id}»`);
    try {
      return await this.tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ontology:${cur.ontologyId}`]);
        const { rows: me } = await c.query('SELECT status FROM ontology_versions WHERE id = $1 FOR UPDATE', [id]);
        if (me[0]?.status !== 'validated') throw new CoreRuleError('conflict', `Опублікувати можна лише перевірену чернетку, а ця — «${me[0]?.status}»`);
        await c.query(`UPDATE ontology_versions SET status = 'deprecated', revision = revision + 1 WHERE ontology_id = $1 AND status = 'active'`, [cur.ontologyId]);
        const { rows } = await c.query(
          `UPDATE ontology_versions SET status = 'active', published_by = $2, published_at = now(), revision = revision + 1 WHERE id = $1 RETURNING *`,
          [id, actor],
        );
        return toOntologyVersion(rows[0]);
      });
    } catch (err) {
      if (err instanceof CoreRuleError) throw err;
      mapPgError(err);
    }
  }

  async addOntologyEvent(input: { ontologyId: string; versionId?: string | null; action: OntologyEventAction; actor: CoreActor; details?: Record<string, unknown> }) {
    checkOntologyEvent(input);
    const { rows } = await this.q(
      `INSERT INTO ontology_events (ontology_id, version_id, action, actor, details) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.ontologyId, input.versionId ?? null, input.action, input.actor, JSON.stringify(input.details ?? {})],
    );
    return toOntologyEvent(rows[0]);
  }

  async listOntologyEvents(ontologyId: string, f: { versionId?: string; limit?: number } = {}) {
    if (f.versionId && !isUuid(f.versionId)) return [];
    const { rows } = await this.q(
      `SELECT * FROM ontology_events WHERE ontology_id = $1 AND ($2::uuid IS NULL OR version_id = $2) ORDER BY created_at DESC, id LIMIT $3`,
      [ontologyId, f.versionId ?? null, Math.max(1, Math.min(f.limit ?? 100, 500))],
    );
    return rows.map(toOntologyEvent);
  }

  async ontologyUsage(): Promise<OntologyUsage> {
    const count = async (sql: string) => {
      const { rows } = await this.q(sql);
      return Object.fromEntries(rows.map((r: any) => [r.k, Number(r.n)])) as Record<string, number>;
    };
    const [entities, aliases, mentions, relations] = await Promise.all([
      count('SELECT type AS k, count(*) AS n FROM entities GROUP BY type'),
      count('SELECT entity_type AS k, count(*) AS n FROM entity_aliases GROUP BY entity_type'),
      count('SELECT e.type AS k, count(*) AS n FROM entity_mentions m JOIN entities e ON e.id = m.entity_id GROUP BY e.type'),
      count('SELECT type AS k, count(*) AS n FROM entity_relations GROUP BY type'),
    ]);
    return { entities, aliases, mentions, relations };
  }

  // ── Учасники проєкту (Т6.1 В2) ──────────────────────────────────────────

  async upsertParticipant(input: { projectId: string; userId: string; source: ParticipantSource; sourceRef?: string | null; createdBy: CoreActor }) {
    checkParticipant(input);
    const { rows } = await this.q(
      `INSERT INTO project_participants (project_id, user_id, source, source_ref, created_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, user_id) DO NOTHING RETURNING *`,
      [input.projectId, input.userId, input.source, input.sourceRef ?? null, input.createdBy],
    );
    if (rows[0]) return { participant: toParticipant(rows[0]), created: true };
    return { participant: (await this.getParticipant(input.projectId, input.userId))!, created: false };
  }

  async getParticipant(projectId: string, userId: string) {
    const { rows } = await this.q('SELECT * FROM project_participants WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
    return rows[0] ? toParticipant(rows[0]) : null;
  }

  async getParticipantById(id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM project_participants WHERE id = $1', [id]);
    return rows[0] ? toParticipant(rows[0]) : null;
  }

  async listParticipants(projectId: string) {
    const { rows } = await this.q('SELECT * FROM project_participants WHERE project_id = $1 ORDER BY created_at, id', [projectId]);
    return rows.map(toParticipant);
  }

  async setParticipantStatus(id: string, status: ParticipantStatus) {
    checkParticipantStatus(status);
    if (!isUuid(id)) throw notFound(`Учасник «${id}»`);
    const { rows } = await this.q('UPDATE project_participants SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, status]);
    if (!rows[0]) throw notFound(`Учасник «${id}»`);
    return toParticipant(rows[0]);
  }

  async addParticipantRole(input: { participantId: string; projectId: string; roleId: string; specialization?: string | null; assignedBy: CoreActor; registryVersion?: number | null }) {
    checkParticipantRole(input);
    const p = await this.getParticipantById(input.participantId);
    if (!p || p.projectId !== input.projectId) throw notFound(`Учасник «${input.participantId}»`);
    const { rows } = await this.q(
      `INSERT INTO participant_roles (participant_id, project_id, role_id, specialization, assigned_by, registry_version) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.participantId, input.projectId, input.roleId, input.specialization ?? null, input.assignedBy, input.registryVersion ?? null],
    );
    return toParticipantRole(rows[0]);
  }

  async revokeParticipantRole(id: string, actor: CoreActor) {
    checkOntologyActor(actor);
    const cur = await this.getParticipantRole(id);
    if (!cur) throw notFound(`Роль учасника «${id}»`);
    const { rows } = await this.q(`UPDATE participant_roles SET status = 'revoked', revoked_at = now(), revoked_by = $2 WHERE id = $1 AND status = 'active' RETURNING *`, [id, actor]);
    if (!rows[0]) throw new CoreRuleError('conflict', 'Роль уже відкликано');
    return toParticipantRole(rows[0]);
  }

  async getParticipantRole(id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM participant_roles WHERE id = $1', [id]);
    return rows[0] ? toParticipantRole(rows[0]) : null;
  }

  async listParticipantRoles(f: { projectId?: string; participantId?: string; roleId?: string; status?: 'active' | 'revoked' }) {
    if (f.participantId && !isUuid(f.participantId)) return [];
    const { rows } = await this.q(
      `SELECT * FROM participant_roles WHERE ($1::text IS NULL OR project_id = $1) AND ($2::uuid IS NULL OR participant_id = $2) AND ($3::text IS NULL OR role_id = $3) AND ($4::text IS NULL OR status = $4)
       ORDER BY created_at, id`,
      [f.projectId ?? null, f.participantId ?? null, f.roleId ?? null, f.status ?? null],
    );
    return rows.map(toParticipantRole);
  }

  async countActiveRoleAssignments() {
    const { rows } = await this.q(
      `SELECT k, count(*) AS n FROM (
         SELECT role_id AS k FROM participant_roles WHERE status = 'active'
         UNION ALL SELECT specialization AS k FROM participant_roles WHERE status = 'active' AND specialization IS NOT NULL
       ) x GROUP BY k`,
    );
    return Object.fromEntries(rows.map((r: any) => [r.k, Number(r.n)])) as Record<string, number>;
  }

  async addCollabEvent(input: { projectId: string; participantId?: string | null; action: CollabEventAction; actor: CoreActor; details?: Record<string, unknown> }) {
    checkCollabEvent(input);
    const { rows } = await this.q(
      `INSERT INTO collab_events (project_id, participant_id, action, actor, details) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.projectId, input.participantId ?? null, input.action, input.actor, JSON.stringify(input.details ?? {})],
    );
    return toCollabEvent(rows[0]);
  }

  async listCollabEvents(projectId: string, f: { limit?: number } = {}) {
    const { rows } = await this.q('SELECT * FROM collab_events WHERE project_id = $1 ORDER BY created_at DESC, id LIMIT $2', [projectId, Math.max(1, Math.min(f.limit ?? 100, 500))]);
    return rows.map(toCollabEvent);
  }

  // ── Наданий доступ (Т6.2 В1) ────────────────────────────────────────────

  async addAccessGrant(input: AccessGrantInput) {
    checkAccessGrant(input);
    const p = await this.getParticipantById(input.participantId);
    if (!p || p.projectId !== input.projectId) throw notFound(`Учасник «${input.participantId}»`);
    const { rows } = await this.q(
      `INSERT INTO access_grants (project_id, participant_id, level, scope_type, scope_ref, valid_from, valid_until, source, source_ref, granted_by)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8, $9, $10) RETURNING *`,
      [input.projectId, input.participantId, input.level, input.scopeType, input.scopeRef ?? null, input.validFrom ?? null, input.validUntil ?? null, input.source ?? 'manual', input.sourceRef ?? null, input.grantedBy],
    );
    return toAccessGrant(rows[0]);
  }

  async getAccessGrant(id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM access_grants WHERE id = $1', [id]);
    return rows[0] ? toAccessGrant(rows[0]) : null;
  }

  async listAccessGrants(f: { projectId?: string; participantId?: string; status?: 'active' | 'revoked' }) {
    if (f.participantId && !isUuid(f.participantId)) return [];
    const { rows } = await this.q(
      `SELECT * FROM access_grants WHERE ($1::text IS NULL OR project_id = $1) AND ($2::uuid IS NULL OR participant_id = $2) AND ($3::text IS NULL OR status = $3) ORDER BY created_at, id`,
      [f.projectId ?? null, f.participantId ?? null, f.status ?? null],
    );
    return rows.map(toAccessGrant);
  }

  async revokeAccessGrant(id: string, actor: CoreActor) {
    checkOntologyActor(actor);
    if (!(await this.getAccessGrant(id))) throw notFound(`Доступ «${id}»`);
    const { rows } = await this.q(`UPDATE access_grants SET status = 'revoked', revoked_at = now(), revoked_by = $2 WHERE id = $1 AND status = 'active' RETURNING *`, [id, actor]);
    if (!rows[0]) throw new CoreRuleError('conflict', 'Доступ уже відкликано');
    return toAccessGrant(rows[0]);
  }

  // ── Процеси ШІ (Т5.2 В2) ───────────────────────────────────────────────────

  async addWorkflow(input: { id: string; name: { en: string; uk: string }; description?: string; createdBy: CoreActor }) {
    checkWorkflow(input);
    const { rows } = await this.q(`INSERT INTO workflows (id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING *`, [input.id, JSON.stringify(input.name), input.description ?? '', input.createdBy]);
    return toWorkflow(rows[0]);
  }

  async getWorkflow(id: string) {
    const { rows } = await this.q('SELECT * FROM workflows WHERE id = $1', [id]);
    return rows[0] ? toWorkflow(rows[0]) : null;
  }

  async listWorkflows() {
    const { rows } = await this.q('SELECT * FROM workflows ORDER BY id');
    return rows.map(toWorkflow);
  }

  async updateWorkflow(id: string, patch: { name?: { en: string; uk: string }; description?: string; status?: 'active' | 'archived' }) {
    if (patch.name !== undefined) checkWorkflowName(patch.name);
    if (patch.description !== undefined && String(patch.description).length > 2000) throw new CoreRuleError('bad_input', 'Опис процесу — до 2000 символів');
    if (patch.status !== undefined && patch.status !== 'active' && patch.status !== 'archived') throw new CoreRuleError('bad_input', 'Статус процесу — active або archived');
    const { rows } = await this.q(
      `UPDATE workflows SET name = COALESCE($2::jsonb, name), description = COALESCE($3, description), status = COALESCE($4, status), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, patch.name ? JSON.stringify(patch.name) : null, patch.description ?? null, patch.status ?? null],
    );
    if (!rows[0]) throw notFound(`Процес «${id}»`);
    return toWorkflow(rows[0]);
  }

  async addWorkflowVersion(input: WorkflowVersionInput) {
    checkWorkflowVersion(input);
    if (!(await this.getWorkflow(input.workflowId))) throw notFound(`Процес «${input.workflowId}»`);
    if (input.basedOn && (!isUuid(input.basedOn) || (await this.getWorkflowVersion(input.basedOn))?.workflowId !== input.workflowId)) throw notFound(`Версія процесу «${input.basedOn}»`);
    const env = input.environment ?? 'draft';
    if (env !== 'draft' && env !== 'test') throw new CoreRuleError('bad_input', 'Нова версія процесу — чернетка (або тестова при відкаті)');
    try {
      return await this.tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`workflow:${input.workflowId}`]);
        if (env === 'test') await c.query(`UPDATE workflow_versions SET environment = 'archived', revision = revision + 1 WHERE workflow_id = $1 AND environment = 'test'`, [input.workflowId]);
        const { rows } = await c.query(
          `INSERT INTO workflow_versions (workflow_id, version, environment, based_on, definition, definition_hash, notes, created_by, tested_by, tested_at)
           VALUES ($1, (SELECT COALESCE(MAX(version), 0) + 1 FROM workflow_versions WHERE workflow_id = $1), $7, $2, $3, $4, $5, $6,
                   CASE WHEN $7 = 'test' THEN $6 END, CASE WHEN $7 = 'test' THEN now() END) RETURNING *`,
          [input.workflowId, input.basedOn ?? null, JSON.stringify(input.definition), input.definitionHash, input.notes ?? '', input.createdBy, env],
        );
        return toWorkflowVersion(rows[0]);
      });
    } catch (err) {
      if (err instanceof CoreRuleError) throw err;
      mapPgError(err);
    }
  }

  async getWorkflowVersion(id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM workflow_versions WHERE id = $1', [id]);
    return rows[0] ? toWorkflowVersion(rows[0]) : null;
  }

  async listWorkflowVersions(workflowId: string, f: { limit?: number } = {}) {
    const { rows } = await this.q(
      `SELECT id, workflow_id, version, environment, based_on, NULL::jsonb AS definition, definition_hash, validation, notes, revision,
              created_by, created_at, updated_at, tested_by, tested_at, published_by, published_at
       FROM workflow_versions WHERE workflow_id = $1 ORDER BY version DESC LIMIT $2`,
      [workflowId, Math.max(1, Math.min(f.limit ?? 50, 200))],
    );
    return rows.map(toWorkflowVersion);
  }

  async updateWorkflowDraft(id: string, patch: { definition?: Record<string, unknown>; definitionHash?: string; validation?: Record<string, unknown> | null; notes?: string }, expectedRevision?: number) {
    const cur = await this.getWorkflowVersion(id);
    if (!cur) throw notFound(`Версія процесу «${id}»`);
    if (cur.environment !== 'draft') throw new CoreRuleError('conflict', `Правити можна лише чернетку, а ця версія — «${cur.environment}»`);
    if (patch.definition !== undefined || patch.definitionHash !== undefined) {
      checkWorkflowVersion({ workflowId: cur.workflowId, definition: patch.definition ?? cur.definition, definitionHash: patch.definitionHash ?? cur.definitionHash, createdBy: cur.createdBy });
    }
    if (patch.notes !== undefined && String(patch.notes).length > 2000) throw new CoreRuleError('bad_input', 'Нотатки версії — до 2000 символів');
    const { rows } = await this.q(
      `UPDATE workflow_versions SET
         definition = COALESCE($2::jsonb, definition),
         definition_hash = COALESCE($3, definition_hash),
         validation = CASE WHEN $4 THEN $5::jsonb ELSE validation END,
         notes = COALESCE($6, notes),
         revision = revision + 1
       WHERE id = $1 AND environment = 'draft' AND ($7::integer IS NULL OR revision = $7) RETURNING *`,
      [id, patch.definition === undefined ? null : JSON.stringify(patch.definition), patch.definitionHash ?? null, patch.validation !== undefined,
        patch.validation == null ? null : JSON.stringify(patch.validation), patch.notes ?? null, expectedRevision ?? null],
    );
    if (!rows[0]) throw new CoreRuleError('conflict', `Чернетку вже змінено (ревізія ${cur.revision}, а не ${expectedRevision}) — перечитайте її`);
    return toWorkflowVersion(rows[0]);
  }

  async transitionWorkflowVersion(id: string, to: 'test' | 'production' | 'archived', actor: CoreActor) {
    checkOntologyActor(actor);
    const cur = await this.getWorkflowVersion(id);
    if (!cur) throw notFound(`Версія процесу «${id}»`);
    try {
      return await this.tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`workflow:${cur.workflowId}`]);
        const { rows: me } = await c.query('SELECT environment FROM workflow_versions WHERE id = $1 FOR UPDATE', [id]);
        const env = me[0]?.environment;
        let sql: string;
        if (to === 'test') {
          if (env !== 'draft') throw new CoreRuleError('conflict', `У тест переходить лише чернетка, а ця версія — «${env}»`);
          await c.query(`UPDATE workflow_versions SET environment = 'archived', revision = revision + 1 WHERE workflow_id = $1 AND environment = 'test'`, [cur.workflowId]);
          sql = `UPDATE workflow_versions SET environment = 'test', tested_by = $2, tested_at = now(), revision = revision + 1 WHERE id = $1 RETURNING *`;
        } else if (to === 'production') {
          if (env !== 'test') throw new CoreRuleError('conflict', `Опублікувати можна лише тестову версію, а ця — «${env}»`);
          await c.query(`UPDATE workflow_versions SET environment = 'archived', revision = revision + 1 WHERE workflow_id = $1 AND environment = 'production'`, [cur.workflowId]);
          sql = `UPDATE workflow_versions SET environment = 'production', published_by = $2, published_at = now(), revision = revision + 1 WHERE id = $1 RETURNING *`;
        } else {
          if (env === 'archived') throw new CoreRuleError('conflict', 'Версія вже в архіві');
          if (env === 'production') throw new CoreRuleError('conflict', 'Робочу версію замінює лише публікація чи відкат');
          sql = `UPDATE workflow_versions SET environment = 'archived', revision = revision + 1 WHERE id = $1 AND $2::text IS NOT NULL RETURNING *`;
        }
        const { rows } = await c.query(sql, [id, actor]);
        return toWorkflowVersion(rows[0]);
      });
    } catch (err) {
      if (err instanceof CoreRuleError) throw err;
      mapPgError(err);
    }
  }

  async addWorkflowEvent(input: { workflowId: string; versionId?: string | null; action: WorkflowEventAction; actor: CoreActor; details?: Record<string, unknown> }) {
    checkWorkflowEvent(input);
    const { rows } = await this.q(
      `INSERT INTO workflow_events (workflow_id, version_id, action, actor, details) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.workflowId, input.versionId ?? null, input.action, input.actor, JSON.stringify(input.details ?? {})],
    );
    return toWorkflowEvent(rows[0]);
  }

  async listWorkflowEvents(f: { workflowId?: string; limit?: number }) {
    const { rows } = await this.q(
      `SELECT * FROM workflow_events WHERE ($1::text IS NULL OR workflow_id = $1) ORDER BY created_at DESC, id LIMIT $2`,
      [f.workflowId ?? null, Math.max(1, Math.min(f.limit ?? 100, 500))],
    );
    return rows.map(toWorkflowEvent);
  }

  async getGraphLayout(kind: 'workflow' | 'ontology', graphId: string, versionRef: string) {
    const { rows } = await this.q('SELECT * FROM graph_layouts WHERE graph_kind = $1 AND graph_id = $2 AND version_ref = $3', [kind, graphId, versionRef]);
    return rows[0] ? toGraphLayout(rows[0]) : null;
  }

  async saveGraphLayout(input: { graphKind: 'workflow' | 'ontology'; graphId: string; versionRef: string; layout: Record<string, { x: number; y: number }>; updatedBy: CoreActor }) {
    checkGraphLayout(input);
    const { rows } = await this.q(
      `INSERT INTO graph_layouts (graph_kind, graph_id, version_ref, layout, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (graph_kind, graph_id, version_ref) DO UPDATE SET layout = EXCLUDED.layout, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *`,
      [input.graphKind, input.graphId, input.versionRef, JSON.stringify(input.layout), input.updatedBy],
    );
    return toGraphLayout(rows[0]);
  }

  async listMembers(projectId: string) {
    const { rows } = await this.q('SELECT user_id, role FROM project_members WHERE project_id = $1 ORDER BY added_at', [projectId]);
    return rows.map((r: any) => ({ userId: r.user_id, role: r.role }));
  }

  async addQualityRun(input: QualityRunInput) {
    checkQualityRun(input);
    const { rows } = await this.q(
      `INSERT INTO quality_runs (set_id, set_version, label, budget_usd, models, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.setId, input.setVersion, input.label ?? '', input.budgetUsd ?? null, JSON.stringify(input.models ?? {}), input.createdBy],
    );
    return toQualityRun(rows[0]);
  }

  async getQualityRun(id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.q('SELECT * FROM quality_runs WHERE id = $1', [id]);
    return rows[0] ? toQualityRun(rows[0]) : null;
  }

  async listQualityRuns(f: { setId?: string; limit?: number } = {}) {
    const params: unknown[] = [];
    let where = '';
    if (f.setId) {
      params.push(f.setId);
      where = 'WHERE set_id = $1';
    }
    params.push(Math.max(1, Math.min(f.limit ?? 50, 200)));
    // Перелік — без повного звіту (він важкий); звіт — у getQualityRun.
    const { rows } = await this.q(
      `SELECT id, set_id, set_version, status, label, passed, summary, NULL::jsonb AS report, models, cost_usd, budget_usd, error, created_by, created_at, started_at, finished_at
       FROM quality_runs ${where} ORDER BY created_at DESC, id LIMIT $${params.length}`,
      params,
    );
    return rows.map(toQualityRun);
  }

  async updateQualityRun(id: string, patch: QualityRunPatch) {
    const cur = await this.getQualityRun(id);
    if (!cur) throw notFound(`Прогін якості «${id}»`);
    checkQualityRunPatch(patch);
    const { rows } = await this.q(
      `UPDATE quality_runs SET
         status = COALESCE($2, status),
         passed = CASE WHEN $3::boolean IS NULL AND NOT $10 THEN passed ELSE $3::boolean END,
         summary = COALESCE($4::jsonb, summary),
         report = CASE WHEN $11 THEN $5::jsonb ELSE report END,
         models = COALESCE($6::jsonb, models),
         cost_usd = COALESCE($7, cost_usd),
         error = CASE WHEN $12 THEN $8 ELSE error END,
         label = COALESCE($9, label),
         started_at = CASE WHEN $2 = 'running' AND started_at IS NULL THEN now() ELSE started_at END,
         finished_at = CASE WHEN $2 IN ('succeeded', 'failed') THEN now() ELSE finished_at END
       WHERE id = $1 RETURNING *`,
      [
        id,
        patch.status ?? null,
        patch.passed ?? null,
        patch.summary === undefined ? null : JSON.stringify(patch.summary),
        patch.report == null ? null : JSON.stringify(patch.report),
        patch.models === undefined ? null : JSON.stringify(patch.models),
        patch.costUsd ?? null,
        patch.error ?? null,
        patch.label ?? null,
        patch.passed !== undefined,
        patch.report !== undefined,
        patch.error !== undefined,
      ],
    );
    return toQualityRun(rows[0]);
  }

  async listSavedSearches(projectId: string, userId: string) {
    const { rows } = await this.q(
      'SELECT * FROM saved_searches WHERE project_id = $1 AND user_id = $2 ORDER BY created_at DESC, id',
      [projectId, userId],
    );
    return rows.map(toSavedSearch);
  }

  async addSavedSearch(input: { projectId: string; userId: string; name: string; params: Record<string, unknown> }) {
    const name = input.name.trim();
    if (!name || name.length > 200) throw new CoreRuleError('bad_input', 'Назва запиту — від 1 до 200 символів');
    const { rows } = await this.q(
      `INSERT INTO saved_searches (project_id, user_id, name, params) VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.projectId, input.userId, name, JSON.stringify(input.params ?? {})],
    );
    return toSavedSearch(rows[0]);
  }

  async deleteSavedSearch(projectId: string, userId: string, id: string) {
    if (!isUuid(id)) return false;
    const res = await this.q('DELETE FROM saved_searches WHERE project_id = $1 AND user_id = $2 AND id = $3', [projectId, userId, id]);
    return (res?.rowCount ?? 0) > 0;
  }

  async addNotification(input: NotificationInput): Promise<NotificationRow> {
    const { rows } = await this.q(
      `INSERT INTO core_notifications (project_id, kind, message, paragraph_ids, payload)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.projectId, input.kind, input.message, input.paragraphIds ?? [], JSON.stringify(input.payload ?? {})],
    );
    return toNotification(rows[0]);
  }

  async listNotifications(projectId: string, limit = 50) {
    const { rows } = await this.q(
      'SELECT * FROM core_notifications WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2',
      [projectId, limit],
    );
    return rows.map(toNotification);
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}
