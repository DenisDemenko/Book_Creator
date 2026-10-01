/**
 * Сховище ядра в пам'яті — для тестів і для запуску без PostgreSQL.
 *
 * Поводиться так само, як PostgreSQL-реалізація, включно з тим, що в базі
 * тримають обмеження: записи іншого проєкту «не існують», згадка не може
 * посилатися на відсутній абзац, дубль псевдоніма відхиляється. Це
 * перевіряє спільний набір тестів (`scripts/test-coreDb.mts`).
 */

import { randomUUID } from 'node:crypto';
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
  assertActor,
} from './rules';
import { EMBEDDING_DIMENSIONS, isSearchableKind, isValidEmbedding, memoryTextScore } from './search/text';
import { CORE_STATUSES, CONTINUITY_ISSUE_STATUSES } from './types';
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
  ContinuityDraftCheckInput,
  ContinuityDraftCheckRow,
  CharacterDecisionInput,
  CharacterDecisionRow,
  CharacterDecisionFilter,
  CharacterDecisionLevel,
  ContinuityIssueKind,
  ContinuityIssueStatus,
  ParagraphVersionRow,
  ProjectInput,
  ProjectRow,
  RelationInput,
  RelationRow,
  RunCreateInput,
  RunFinishInput,
  RunRow,
  VersionRow,
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
  QualityRunInput,
  QualityRunPatch,
  QualityRunRow,
} from './types';

const key = (projectId: string, id: string) => `${projectId}\u0000${id}`;
/** id файлу Медіатеки з URL зображення (Т2.3 В2). */
export const assetIdOf = (url: string): string | null => /^\/api\/media\/file\/([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? null;
const now = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);

export class MemoryCoreRepository implements CoreRepository {
  readonly kind = 'memory' as const;

  private projects = new Map<string, ProjectRow>();
  private members = new Map<string, { role: MemberRole; scopes: Record<string, unknown> }>();
  private documents = new Map<string, DocumentRow>();
  private paragraphs = new Map<string, ParagraphRow>();
  private paragraphVersions = new Map<string, ParagraphVersionRow[]>();
  private entities = new Map<string, EntityRow>();
  private entityVersions = new Map<string, VersionRow<EntityRow>[]>();
  private aliases = new Map<string, AliasRow>();
  private mentions = new Map<string, MentionRow>();
  private relations = new Map<string, RelationRow>();
  private relationVersions = new Map<string, VersionRow<RelationRow>[]>();
  private runs = new Map<string, RunRow>();
  private findings = new Map<string, FindingRow>();
  private findingVersions = new Map<string, VersionRow<FindingRow>[]>();
  private notifications: NotificationRow[] = [];
  /** Ключ — проєкт, абзац, модель. */
  private savedSearches: SavedSearchRow[] = [];
  private timePoints = new Map<string, TimePointRow>();
  private emotionPoints = new Map<string, EmotionPointRow>();
  private assetLinks = new Map<string, AssetLinkRow>();
  private appearanceVersions = new Map<string, AppearanceVersionRow>();
  private appearanceHistory: AppearanceHistoryRow[] = [];
  private embeddings = new Map<string, { projectId: string; paragraphId: string; model: string; contentHash: string; vector: number[] }>();
  private entityTraits = new Map<string, EntityTraitRow>();
  private continuityIssues = new Map<string, ContinuityIssueRow>();
  private draftChecks: ContinuityDraftCheckRow[] = [];
  private decisions: CharacterDecisionRow[] = [];
  private memories: CharacterMemoryRow[] = [];
  private states: CharacterStateRow[] = [];
  private agents: CharacterAgentRow[] = [];
  private simulations: SimulationRow[] = [];
  private simEvents: SimulationEventRow[] = [];
  private proposals: CanonProposalRow[] = [];
  private qualityRuns: QualityRunRow[] = [];

  private requireProject(projectId: string): ProjectRow {
    const p = this.projects.get(projectId);
    if (!p) throw notFound(`Проєкт «${projectId}»`);
    return p;
  }

  private pushVersion<T extends { version: number; projectId: string; id: string }>(
    store: Map<string, VersionRow<T>[]>,
    row: T,
    actor: CoreActor,
    reason = '',
  ): void {
    const list = store.get(row.id) ?? [];
    list.push({
      projectId: row.projectId,
      recordId: row.id,
      version: row.version,
      snapshot: clone(row),
      changedBy: actor,
      changedAt: now(),
      reason,
    });
    store.set(row.id, list);
  }

  // ── Проєкти й учасники ───────────────────────────────────────────────────

  async upsertProject(input: ProjectInput): Promise<ProjectRow> {
    const prev = this.projects.get(input.id);
    const t = now();
    const row: ProjectRow = {
      id: input.id,
      ownerId: input.ownerId,
      title: input.title ?? prev?.title ?? '',
      languages: input.languages ?? prev?.languages ?? ['uk'],
      revision: prev?.revision ?? 0,
      createdAt: prev?.createdAt ?? t,
      updatedAt: t,
    };
    this.projects.set(row.id, row);
    return clone(row);
  }

  async getProject(id: string) {
    const p = this.projects.get(id);
    return p ? clone(p) : null;
  }

  async bumpProjectRevision(id: string) {
    const p = this.requireProject(id);
    p.revision += 1;
    p.updatedAt = now();
    return p.revision;
  }

  async setMember(projectId: string, userId: string, role: MemberRole, scopes: Record<string, unknown> = {}) {
    this.requireProject(projectId);
    checkMemberRole(role);
    this.members.set(key(projectId, userId), { role, scopes: clone(scopes) });
  }

  async removeMember(projectId: string, userId: string) {
    this.members.delete(key(projectId, userId));
  }

  async getMemberRole(projectId: string, userId: string) {
    return this.members.get(key(projectId, userId))?.role ?? null;
  }

  // ── Документи й абзаци ───────────────────────────────────────────────────

  async upsertDocument(input: DocumentInput): Promise<DocumentRow> {
    this.requireProject(input.projectId);
    const k = key(input.projectId, input.id);
    const prev = this.documents.get(k);
    const title = input.title ?? '';
    const changed = !prev || prev.title !== title || prev.kind !== input.kind || prev.parentId !== (input.parentId ?? null);
    const row: DocumentRow = {
      deletedAt: null,
      projectId: input.projectId,
      id: input.id,
      kind: input.kind,
      parentId: input.parentId ?? null,
      order: input.order,
      title,
      version: prev ? prev.version + (changed ? 1 : 0) : 1,
      updatedAt: now(),
    };
    this.documents.set(k, row);
    return clone(row);
  }

  async markDocumentDeleted(projectId: string, id: string) {
    const d = this.documents.get(key(projectId, id));
    if (!d || d.deletedAt) return false;
    d.deletedAt = now();
    d.updatedAt = d.deletedAt;
    return true;
  }

  async listDocuments(projectId: string) {
    return [...this.documents.values()]
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map(clone);
  }

  async upsertParagraph(input: ParagraphInput, actor: CoreActor) {
    checkParagraph(input, actor);
    if (!this.documents.has(key(input.projectId, input.documentId))) throw notFound(`Документ «${input.documentId}»`);
    const k = key(input.projectId, input.id);
    const prev = this.paragraphs.get(k);
    const hash = paragraphTextHash(input.text);
    const t = now();
    const changed = !prev || prev.textHash !== hash;
    const row: ParagraphRow = {
      projectId: input.projectId,
      id: input.id,
      documentId: input.documentId,
      order: input.order,
      kind: input.kind,
      text: input.text,
      textHash: hash,
      version: prev ? prev.version + (changed ? 1 : 0) : 1,
      deletedAt: null,
      editorPid: input.editorPid ?? null,
      updatedAt: changed || prev?.deletedAt || prev?.order !== input.order ? t : prev!.updatedAt,
    };
    this.paragraphs.set(k, row);
    if (changed) {
      const list = this.paragraphVersions.get(k) ?? [];
      list.push({
        projectId: row.projectId,
        paragraphId: row.id,
        version: row.version,
        text: row.text,
        textHash: hash,
        changedBy: actor,
        changedAt: t,
      });
      this.paragraphVersions.set(k, list);
    }
    return { row: clone(row), changed };
  }

  async markParagraphDeleted(projectId: string, id: string) {
    const p = this.paragraphs.get(key(projectId, id));
    if (!p || p.deletedAt) return false;
    p.deletedAt = now();
    return true;
  }

  async getParagraph(projectId: string, id: string) {
    const p = this.paragraphs.get(key(projectId, id));
    return p ? clone(p) : null;
  }

  async listParagraphs(projectId: string, documentId: string) {
    return [...this.paragraphs.values()]
      .filter((p) => p.projectId === projectId && p.documentId === documentId && !p.deletedAt)
      .sort((a, b) => a.order - b.order)
      .map(clone);
  }

  async listAllParagraphs(projectId: string) {
    return [...this.paragraphs.values()]
      .filter((p) => p.projectId === projectId)
      .sort((a, b) => a.documentId.localeCompare(b.documentId) || a.order - b.order)
      .map(clone);
  }

  async listParagraphVersions(projectId: string, id: string) {
    return clone(this.paragraphVersions.get(key(projectId, id)) ?? []);
  }

  // ── Сутності ─────────────────────────────────────────────────────────────

  private entityIn(projectId: string, id: string): EntityRow | undefined {
    const e = this.entities.get(id);
    return e && e.projectId === projectId ? e : undefined;
  }

  async createEntity(input: EntityInput) {
    const status = checkNewEntity(input);
    this.requireProject(input.projectId);
    const t = now();
    const row: EntityRow = {
      id: randomUUID(),
      projectId: input.projectId,
      type: input.type,
      name: input.name.trim(),
      canonical: clone(input.canonical ?? {}),
      status,
      version: 1,
      externalRef: input.externalRef ?? null,
      createdBy: input.createdBy,
      createdAt: t,
      updatedAt: t,
    };
    if (row.externalRef && (await this.findEntityByExternalRef(row.projectId, row.type, row.externalRef))) {
      throw new CoreRuleError('bad_input', `Сутність із зв'язком «${row.externalRef}» уже є`);
    }
    this.entities.set(row.id, row);
    this.pushVersion(this.entityVersions, row, input.createdBy, 'створено');
    return clone(row);
  }

  async getEntity(projectId: string, id: string) {
    const e = this.entityIn(projectId, id);
    return e ? clone(e) : null;
  }

  async findEntityByExternalRef(projectId: string, type: string, externalRef: string) {
    const e = [...this.entities.values()].find((x) => x.projectId === projectId && x.type === type && x.externalRef === externalRef);
    return e ? clone(e) : null;
  }

  async listEntities(projectId: string, type?: string) {
    return [...this.entities.values()]
      .filter((e) => e.projectId === projectId && (!type || e.type === type))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
      .map(clone);
  }

  async updateEntity(projectId: string, id: string, patch: EntityPatch, actor: CoreActor, reason = '') {
    const e = this.entityIn(projectId, id);
    if (!e) throw notFound('Сутність');
    checkEntityUpdate(e, actor);
    if (patch.name !== undefined) e.name = patch.name.trim();
    if (patch.canonical !== undefined) e.canonical = clone(patch.canonical);
    if (patch.externalRef !== undefined) {
      const other = patch.externalRef ? await this.findEntityByExternalRef(projectId, e.type, patch.externalRef) : null;
      if (other && other.id !== e.id) throw new CoreRuleError('bad_input', `Сутність із зв'язком «${patch.externalRef}» уже є`);
      e.externalRef = patch.externalRef;
    }
    e.version += 1;
    e.updatedAt = now();
    this.pushVersion(this.entityVersions, e, actor, reason);
    return clone(e);
  }

  async setEntityStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor, reason = '') {
    checkStatusChange(status, actor);
    const e = this.entityIn(projectId, id);
    if (!e) throw notFound('Сутність');
    e.status = status;
    e.version += 1;
    e.updatedAt = now();
    this.pushVersion(this.entityVersions, e, actor, reason);
    return clone(e);
  }

  async listEntityVersions(projectId: string, id: string) {
    return clone((this.entityVersions.get(id) ?? []).filter((v) => v.projectId === projectId));
  }

  async addAlias(projectId: string, entityId: string, alias: string, kind: AliasRow['kind'] = 'alias') {
    const e = this.entityIn(projectId, entityId);
    if (!e) throw notFound('Сутність');
    const aliasNorm = normalizeAlias(alias);
    if (!aliasNorm) throw new CoreRuleError('bad_input', 'Псевдонім не може бути порожнім');
    const k = `${projectId}\u0000${e.type}\u0000${aliasNorm}`;
    const prev = this.aliases.get(k);
    if (prev) {
      if (prev.entityId === entityId) return clone(prev);
      throw new CoreRuleError('duplicate_alias', `Псевдонім «${alias}» уже належить іншій сутності цього типу`);
    }
    const row: AliasRow = { id: randomUUID(), projectId, entityId, entityType: e.type, alias: alias.trim(), aliasNorm, kind };
    this.aliases.set(k, row);
    return clone(row);
  }

  async listAliases(projectId: string, entityId?: string) {
    return [...this.aliases.values()]
      .filter((a) => a.projectId === projectId && (entityId === undefined || a.entityId === entityId))
      .sort((x, y) => x.alias.localeCompare(y.alias))
      .map(clone);
  }

  async resolveAlias(projectId: string, type: string, alias: string) {
    return this.aliases.get(`${projectId}\u0000${type}\u0000${normalizeAlias(alias)}`)?.entityId ?? null;
  }

  // ── Згадки ───────────────────────────────────────────────────────────────

  async replaceParagraphMentions(projectId: string, paragraphId: string, mentions: MentionInput[]) {
    if (!this.paragraphs.has(key(projectId, paragraphId))) throw notFound(`Абзац «${paragraphId}»`);
    for (const m of mentions) {
      checkMention(m);
      if (!this.entityIn(projectId, m.entityId)) throw notFound('Сутність згадки');
      if (m.subjectEntityId && !this.entityIn(projectId, m.subjectEntityId)) throw notFound('Суб\'єкт згадки');
    }
    for (const [id, m] of this.mentions) {
      if (m.projectId === projectId && m.paragraphId === paragraphId) this.mentions.delete(id);
    }
    const out: MentionRow[] = mentions.map((m) => ({
      id: randomUUID(),
      projectId,
      entityId: m.entityId,
      paragraphId,
      spanStart: m.spanStart,
      spanEnd: m.spanEnd,
      source: m.source,
      status: m.status ?? (m.source === 'ai' ? 'suggested' : 'confirmed'),
      subjectEntityId: m.subjectEntityId ?? null,
      fields: clone(m.fields ?? {}),
    }));
    for (const m of out) this.mentions.set(m.id, m);
    return clone(out);
  }

  async listMentionsByParagraphs(projectId: string, paragraphIds: string[]) {
    const ids = new Set(paragraphIds);
    return [...this.mentions.values()]
      .filter((m) => m.projectId === projectId && ids.has(m.paragraphId))
      .sort((a, b) => a.paragraphId.localeCompare(b.paragraphId) || a.spanStart - b.spanStart)
      .map(clone);
  }

  async listSubjectMentions(projectId: string) {
    return [...this.mentions.values()]
      .filter((m) => m.projectId === projectId && m.subjectEntityId && !this.paragraphs.get(key(projectId, m.paragraphId))?.deletedAt)
      .sort((a, b) => a.paragraphId.localeCompare(b.paragraphId) || a.spanStart - b.spanStart)
      .map(clone);
  }

  async countMentionsByEntity(projectId: string) {
    const out: Record<string, number> = {};
    for (const m of this.mentions.values()) {
      if (m.projectId !== projectId) continue;
      if (this.paragraphs.get(key(projectId, m.paragraphId))?.deletedAt) continue;
      out[m.entityId] = (out[m.entityId] ?? 0) + 1;
    }
    return out;
  }

  async listMentionsByEntity(projectId: string, entityId: string) {
    return [...this.mentions.values()]
      .filter((m) => m.projectId === projectId && m.entityId === entityId)
      .sort((a, b) => a.paragraphId.localeCompare(b.paragraphId) || a.spanStart - b.spanStart)
      .map(clone);
  }

  // ── Зв'язки ──────────────────────────────────────────────────────────────

  async createRelation(input: RelationInput) {
    const status = checkNewRelation(input);
    if (!this.entityIn(input.projectId, input.fromId) || !this.entityIn(input.projectId, input.toId)) {
      throw notFound('Сутність зв\'язку');
    }
    const t = now();
    const row: RelationRow = {
      id: randomUUID(),
      projectId: input.projectId,
      type: input.type,
      fromId: input.fromId,
      toId: input.toId,
      status,
      evidence: [...(input.evidence ?? [])],
      note: input.note ?? '',
      version: 1,
      createdBy: input.createdBy,
      createdAt: t,
      updatedAt: t,
    };
    this.relations.set(row.id, row);
    this.pushVersion(this.relationVersions, row, input.createdBy, 'створено');
    return clone(row);
  }

  async setRelationStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor, reason = '') {
    checkStatusChange(status, actor);
    const r = this.relations.get(id);
    if (!r || r.projectId !== projectId) throw notFound('Зв\'язок');
    r.status = status;
    r.version += 1;
    r.updatedAt = now();
    this.pushVersion(this.relationVersions, r, actor, reason);
    return clone(r);
  }

  async listRelations(projectId: string, entityId?: string) {
    return [...this.relations.values()]
      .filter((r) => r.projectId === projectId && (!entityId || r.fromId === entityId || r.toId === entityId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async listRelationVersions(projectId: string, id: string) {
    return clone((this.relationVersions.get(id) ?? []).filter((v) => v.projectId === projectId));
  }

  // ── Прогони й висновки ───────────────────────────────────────────────────

  async createRun(input: RunCreateInput) {
    checkNewRun(input);
    this.requireProject(input.projectId);
    const row: RunRow = {
      id: randomUUID(),
      projectId: input.projectId,
      role: input.role,
      module: input.module,
      model: input.model ?? '',
      promptVersion: input.promptVersion ?? '',
      inputs: clone(input.inputs ?? []),
      status: 'running',
      cost: {},
      error: null,
      createdBy: input.createdBy,
      createdAt: now(),
      finishedAt: null,
    };
    this.runs.set(row.id, row);
    return clone(row);
  }

  async finishRun(projectId: string, id: string, input: RunFinishInput) {
    const r = this.runs.get(id);
    if (!r || r.projectId !== projectId) throw notFound('Прогін AI');
    r.status = input.status;
    r.cost = clone(input.cost ?? r.cost);
    r.error = input.error ?? null;
    r.finishedAt = now();
    return clone(r);
  }

  async getRun(projectId: string, id: string) {
    const r = this.runs.get(id);
    return r && r.projectId === projectId ? clone(r) : null;
  }

  async addFinding(input: FindingInput) {
    const status = checkNewFinding(input);
    this.requireProject(input.projectId);
    if (input.entityId && !this.entityIn(input.projectId, input.entityId)) throw notFound('Сутність висновку');
    if (input.runId && !(await this.getRun(input.projectId, input.runId))) throw notFound('Прогін AI');
    const t = now();
    const row: FindingRow = {
      id: randomUUID(),
      projectId: input.projectId,
      runId: input.runId ?? null,
      entityId: input.entityId ?? null,
      kind: input.kind,
      payload: clone(input.payload ?? {}),
      sourceParagraphIds: [...(input.sourceParagraphIds ?? [])],
      sourceAssetIds: [...(input.sourceAssetIds ?? [])],
      sourceRevision: input.sourceRevision ?? null,
      validStoryTime: input.validStoryTime ? clone(input.validStoryTime) : null,
      status,
      needsReview: false,
      insufficientData: !!input.insufficientData,
      visibility: input.visibility ?? 'project',
      version: 1,
      createdBy: input.createdBy,
      createdAt: t,
      updatedAt: t,
    };
    this.findings.set(row.id, row);
    this.pushVersion(this.findingVersions, row, input.createdBy, 'створено');
    return clone(row);
  }

  async getFinding(projectId: string, id: string) {
    const f = this.findings.get(id);
    return f && f.projectId === projectId ? clone(f) : null;
  }

  async setFindingStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor, reason = '') {
    checkStatusChange(status, actor);
    const f = this.findings.get(id);
    if (!f || f.projectId !== projectId) throw notFound('Висновок');
    f.status = status;
    // Рішення автора щодо висновку й є його перегляд.
    f.needsReview = false;
    f.version += 1;
    f.updatedAt = now();
    this.pushVersion(this.findingVersions, f, actor, reason);
    return clone(f);
  }

  async markFindingsNeedReview(projectId: string, paragraphIds: string[]) {
    if (!paragraphIds.length) return 0;
    const ids = new Set(paragraphIds);
    let n = 0;
    for (const f of this.findings.values()) {
      if (f.projectId !== projectId || f.needsReview) continue;
      if (f.sourceParagraphIds.some((p) => ids.has(p))) {
        f.needsReview = true;
        f.updatedAt = now();
        n++;
      }
    }
    return n;
  }

  async listFindings(projectId: string, filter: { entityId?: string; status?: CoreStatus } = {}) {
    return [...this.findings.values()]
      .filter(
        (f) =>
          f.projectId === projectId &&
          (!filter.entityId || f.entityId === filter.entityId) &&
          (!filter.status || f.status === filter.status),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async listFindingVersions(projectId: string, id: string) {
    return clone((this.findingVersions.get(id) ?? []).filter((v) => v.projectId === projectId));
  }

  // ── Пошук (Т1.2) ─────────────────────────────────────────────────────────

  /** Живий абзац живого розділу, у якому є текст. */
  private searchable(p: ParagraphRow): boolean {
    if (p.deletedAt || !isSearchableKind(p.kind)) return false;
    const d = this.documents.get(key(p.projectId, p.documentId));
    return !!d && !d.deletedAt;
  }

  async searchParagraphsByText(projectId: string, stems: string[], limit: number): Promise<ParagraphScore[]> {
    if (!stems.length) return [];
    const out: ParagraphScore[] = [];
    for (const p of this.paragraphs.values()) {
      if (p.projectId !== projectId || !this.searchable(p)) continue;
      const score = memoryTextScore(p.text, stems);
      if (score > 0) out.push({ paragraphId: p.id, score });
    }
    return out.sort((a, b) => b.score - a.score || a.paragraphId.localeCompare(b.paragraphId)).slice(0, limit);
  }

  async searchParagraphsByVector(projectId: string, model: string, vector: number[], limit: number): Promise<ParagraphScore[]> {
    const out: ParagraphScore[] = [];
    for (const e of this.embeddings.values()) {
      if (e.projectId !== projectId || e.model !== model) continue;
      const p = this.paragraphs.get(key(projectId, e.paragraphId));
      if (!p || !this.searchable(p)) continue;
      out.push({ paragraphId: e.paragraphId, score: cosine(vector, e.vector) });
    }
    return out.sort((a, b) => b.score - a.score || a.paragraphId.localeCompare(b.paragraphId)).slice(0, limit);
  }

  async listEmbeddingHashes(projectId: string, model: string) {
    return [...this.embeddings.values()]
      .filter((e) => e.projectId === projectId && e.model === model)
      .map((e) => ({ paragraphId: e.paragraphId, contentHash: e.contentHash }));
  }

  async upsertParagraphEmbeddings(projectId: string, model: string, rows: EmbeddingInput[]) {
    for (const r of rows) {
      if (!isValidEmbedding(r.vector)) throw new CoreRuleError('bad_input', `Вектор має складатися з ${EMBEDDING_DIMENSIONS} скінченних чисел`);
      if (!this.paragraphs.has(key(projectId, r.paragraphId))) throw notFound(`Абзац «${r.paragraphId}»`);
    }
    for (const r of rows) {
      this.embeddings.set(`${key(projectId, r.paragraphId)}\u0000${model}`, {
        projectId,
        paragraphId: r.paragraphId,
        model,
        contentHash: r.contentHash,
        vector: [...r.vector],
      });
    }
    return rows.length;
  }

  async pruneParagraphEmbeddings(projectId: string, keepModel: string) {
    let n = 0;
    for (const [k, e] of this.embeddings) {
      if (e.projectId !== projectId) continue;
      const p = this.paragraphs.get(key(projectId, e.paragraphId));
      if (e.model !== keepModel || !p || p.deletedAt) {
        this.embeddings.delete(k);
        n++;
      }
    }
    return n;
  }

  // ── Хронологія (Т2.1) ────────────────────────────────────────────────────

  async listTimePoints(projectId: string) {
    return [...this.timePoints.values()].filter((p) => p.projectId === projectId).map(clone);
  }

  async upsertTimePoint(input: TimePointInput) {
    this.requireProject(input.projectId);
    checkTimePoint(input);
    const k = `${input.projectId}\u0000${input.subjectKind}\u0000${input.subjectId}`;
    const prev = this.timePoints.get(k);
    const row: TimePointRow = {
      id: prev?.id ?? randomUUID(),
      projectId: input.projectId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      kind: input.kind,
      start: input.start ?? null,
      end: input.end ?? null,
      sortKey: input.sortKey ?? null,
      endKey: input.endKey ?? null,
      label: input.label ?? '',
      status: input.status ?? 'confirmed',
      source: input.source ?? 'author',
      evidence: [...(input.evidence ?? [])],
      createdBy: input.createdBy,
      updatedAt: now(),
    };
    this.timePoints.set(k, row);
    return clone(row);
  }

  async deleteTimePoint(projectId: string, subjectKind: TimePointRow['subjectKind'], subjectId: string) {
    return this.timePoints.delete(`${projectId}\u0000${subjectKind}\u0000${subjectId}`);
  }

  // ── Емоційний монітор (Т2.2) ─────────────────────────────────────────────

  async listEmotionPoints(projectId: string, characterId?: string) {
    return [...this.emotionPoints.values()]
      .filter((p) => p.projectId === projectId && (!characterId || p.characterId === characterId))
      .map(clone);
  }

  async upsertEmotionPoint(input: EmotionPointInput) {
    this.requireProject(input.projectId);
    checkEmotionPoint(input);
    // Як зовнішні ключі в базі: герой і абзац — з цього ж проєкту.
    if (!this.entityIn(input.projectId, input.characterId)) throw notFound(`Герой «${input.characterId}»`);
    if (!this.paragraphs.get(key(input.projectId, input.paragraphId))) throw notFound(`Абзац «${input.paragraphId}»`);
    const emotion = input.emotion.trim();
    const prev = [...this.emotionPoints.values()].find(
      (p) => p.projectId === input.projectId && p.characterId === input.characterId && p.paragraphId === input.paragraphId && p.emotion === emotion,
    );
    const row: EmotionPointRow = {
      id: prev?.id ?? randomUUID(),
      projectId: input.projectId,
      characterId: input.characterId,
      paragraphId: input.paragraphId,
      emotion,
      family: input.family,
      layer: input.layer ?? 'primary',
      intensity: input.intensity,
      craft: input.craft ?? null,
      impact: input.impact ?? null,
      note: input.note ?? '',
      source: input.source ?? 'author',
      status: input.status ?? 'confirmed',
      findingId: input.findingId ?? null,
      createdBy: input.createdBy,
      updatedAt: now(),
    };
    this.emotionPoints.set(row.id, row);
    return clone(row);
  }

  async deleteEmotionPoint(projectId: string, id: string) {
    const p = this.emotionPoints.get(id);
    if (!p || p.projectId !== projectId) return false;
    return this.emotionPoints.delete(id);
  }

  // ── Бібліотека ілюстрацій (Т2.3 В2) ──────────────────────────────────────

  async listAssetLinks(projectId: string, filter: { entityId?: string; sectionId?: string; assetUrl?: string; source?: AssetLinkRow['source'] } = {}) {
    return [...this.assetLinks.values()]
      .filter((l) => l.projectId === projectId)
      .filter((l) => (!filter.entityId || l.entityId === filter.entityId) && (!filter.sectionId || l.sectionId === filter.sectionId))
      .filter((l) => (!filter.assetUrl || l.assetUrl === filter.assetUrl) && (!filter.source || l.source === filter.source))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(clone);
  }

  async upsertAssetLink(input: AssetLinkInput) {
    this.requireProject(input.projectId);
    checkAssetLink(input);
    // Як зовнішні ключі в базі: сутність і розділ — з цього ж проєкту.
    if (input.entityId && !this.entityIn(input.projectId, input.entityId)) throw notFound(`Сутність «${input.entityId}»`);
    if (input.sectionId && !this.documents.get(key(input.projectId, input.sectionId))) throw notFound(`Розділ «${input.sectionId}»`);
    if (input.appearanceVersionId) {
      const v = this.appearanceVersions.get(input.appearanceVersionId);
      if (!v || v.projectId !== input.projectId) throw notFound(`Версію зовнішності «${input.appearanceVersionId}»`);
      if (v.entityId !== input.entityId) throw new CoreRuleError('bad_input', 'Версія зовнішності належить іншому героєві');
    }
    const target = input.entityId ? `e:${input.entityId}` : `s:${input.sectionId}`;
    const prev = [...this.assetLinks.values()].find(
      (l) => l.projectId === input.projectId && l.assetUrl === input.assetUrl && (l.entityId ? `e:${l.entityId}` : `s:${l.sectionId}`) === target && l.role === input.role,
    );
    const at = now();
    const row: AssetLinkRow = {
      id: prev?.id ?? randomUUID(),
      projectId: input.projectId,
      assetUrl: input.assetUrl,
      assetId: assetIdOf(input.assetUrl),
      entityId: input.entityId ?? null,
      sectionId: input.sectionId ?? null,
      role: input.role,
      status: input.status ?? 'confirmed',
      source: input.source ?? 'author',
      needsReview: input.checkedHash != null ? false : prev?.needsReview ?? false,
      checkedHash: input.checkedHash !== undefined ? input.checkedHash : prev?.checkedHash ?? null,
      evidence: [...(input.evidence ?? prev?.evidence ?? [])],
      note: input.note ?? prev?.note ?? '',
      appearanceVersionId: input.appearanceVersionId !== undefined ? input.appearanceVersionId : prev?.appearanceVersionId ?? null,
      createdBy: input.createdBy,
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
    };
    this.assetLinks.set(row.id, row);
    return clone(row);
  }

  async getAssetLink(projectId: string, id: string) {
    const l = this.assetLinks.get(id);
    return l && l.projectId === projectId ? clone(l) : null;
  }

  async setAssetLinkStatus(projectId: string, id: string, status: CoreStatus) {
    const l = this.assetLinks.get(id);
    if (!l || l.projectId !== projectId) throw notFound(`Зв'язок зображення «${id}»`);
    if (!['suggested', 'confirmed', 'rejected'].includes(status)) throw new CoreRuleError('bad_input', `Невідомий статус «${status}»`);
    const row = { ...l, status, updatedAt: now() };
    this.assetLinks.set(id, row);
    return clone(row);
  }

  async setAssetLinkReview(projectId: string, id: string, review: { needsReview: boolean; checkedHash?: string | null }) {
    const l = this.assetLinks.get(id);
    if (!l || l.projectId !== projectId) throw notFound(`Зв'язок зображення «${id}»`);
    const row = { ...l, needsReview: !!review.needsReview, checkedHash: review.checkedHash !== undefined ? review.checkedHash : l.checkedHash, updatedAt: now() };
    this.assetLinks.set(id, row);
    return clone(row);
  }

  async deleteAssetLink(projectId: string, id: string) {
    const l = this.assetLinks.get(id);
    if (!l || l.projectId !== projectId) return false;
    return this.assetLinks.delete(id);
  }

  // ── Версії зовнішності (Т2.3 В3) ─────────────────────────────────────────

  async listAppearanceVersions(projectId: string, entityId?: string) {
    return [...this.appearanceVersions.values()]
      .filter((v) => v.projectId === projectId && (!entityId || v.entityId === entityId))
      .sort((a, b) => (a.fromChapter ?? 0) - (b.fromChapter ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(clone);
  }

  async getAppearanceVersion(projectId: string, id: string) {
    const v = this.appearanceVersions.get(id);
    return v && v.projectId === projectId ? clone(v) : null;
  }

  async upsertAppearanceVersion(input: AppearanceVersionInput) {
    this.requireProject(input.projectId);
    const n = checkAppearanceVersion(input);
    const prev = input.id ? this.appearanceVersions.get(input.id) : undefined;
    if (input.id && (!prev || prev.projectId !== input.projectId)) throw notFound(`Версію зовнішності «${input.id}»`);
    if (prev && prev.entityId !== input.entityId) throw new CoreRuleError('bad_input', 'Версію не можна перенести до іншого героя');
    if (!this.entityIn(input.projectId, input.entityId)) throw notFound(`Сутність «${input.entityId}»`);
    const at = now();
    const row: AppearanceVersionRow = {
      id: prev?.id ?? randomUUID(),
      projectId: input.projectId,
      entityId: input.entityId,
      ...n,
      descriptionHash: appearanceHash(n.description),
      createdBy: prev?.createdBy ?? input.createdBy,
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
    };
    this.appearanceVersions.set(row.id, row);
    await this.addAppearanceHistory({ projectId: row.projectId, versionId: row.id, entityId: row.entityId, action: prev ? 'updated' : 'created', snapshot: { ...row }, actor: input.createdBy });
    return clone(row);
  }

  async deleteAppearanceVersion(projectId: string, id: string, actor: string) {
    const v = this.appearanceVersions.get(id);
    if (!v || v.projectId !== projectId) return false;
    this.appearanceVersions.delete(id);
    // Як ON DELETE SET NULL: портрети версії лишаються загальними портретами героя.
    for (const l of this.assetLinks.values()) if (l.appearanceVersionId === id) l.appearanceVersionId = null;
    // Як ON DELETE CASCADE (Т2.4 В3): рисі «вік» цієї версії нема звідки взяти значення без неї.
    for (const [tid, t] of [...this.entityTraits]) if (t.appearanceVersionId === id) await this.deleteEntityTrait(projectId, tid);
    await this.addAppearanceHistory({ projectId, versionId: id, entityId: v.entityId, action: 'deleted', snapshot: { ...v }, actor });
    return true;
  }

  async addAppearanceHistory(input: Omit<AppearanceHistoryRow, 'id' | 'at'>) {
    if (!/^(user|ai|system):.+/.test(input.actor)) throw new CoreRuleError('bad_actor', `Автор запису «${input.actor}»`);
    this.appearanceHistory.push({ ...clone(input), id: String(this.appearanceHistory.length + 1), at: now() });
  }

  async listAppearanceHistory(projectId: string, entityId: string, limit = 50) {
    return this.appearanceHistory
      .filter((h) => h.projectId === projectId && h.entityId === entityId)
      .slice(-limit)
      .reverse()
      .map(clone);
  }

  // ── Риси сутностей (Т2.4 В1) ─────────────────────────────────────────────

  async listEntityTraits(projectId: string, entityId?: string) {
    return [...this.entityTraits.values()]
      .filter((t) => t.projectId === projectId && (!entityId || t.entityId === entityId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(clone);
  }

  async upsertEntityTrait(input: EntityTraitInput) {
    this.requireProject(input.projectId);
    const n = checkEntityTrait(input);
    if (!this.entityIn(input.projectId, input.entityId)) throw notFound(`Сутність «${input.entityId}»`);
    if (input.sectionId && !this.documents.get(key(input.projectId, input.sectionId))) throw notFound(`Розділ «${input.sectionId}»`);
    if (input.supersedes) {
      const s = this.entityTraits.get(input.supersedes);
      if (!s || s.projectId !== input.projectId) throw notFound(`Риса «${input.supersedes}»`);
      if (s.entityId !== input.entityId || s.label.trim().toLocaleLowerCase('uk') !== input.label.trim().toLocaleLowerCase('uk')) {
        throw new CoreRuleError('bad_input', 'Заміняти можна лише рису тієї самої сутності з тією самою міткою');
      }
    }
    if (input.appearanceVersionId) {
      const v = this.appearanceVersions.get(input.appearanceVersionId);
      if (!v || v.projectId !== input.projectId) throw notFound(`Версію зовнішності «${input.appearanceVersionId}»`);
      if (v.entityId !== input.entityId) throw new CoreRuleError('bad_input', 'Версія зовнішності належить іншій сутності');
    }
    let prev = input.id ? this.entityTraits.get(input.id) : undefined;
    if (input.id && (!prev || prev.projectId !== input.projectId)) throw notFound(`Риса «${input.id}»`);
    // Без явного id, але з версією зовнішності — та сама похідна риса (Т2.4 В3): оновити, не дублювати.
    if (!prev && input.appearanceVersionId) {
      prev = [...this.entityTraits.values()].find((t) => t.projectId === input.projectId && t.appearanceVersionId === input.appearanceVersionId);
    }
    const at = now();
    const row: EntityTraitRow = {
      id: prev?.id ?? randomUUID(),
      projectId: input.projectId,
      entityId: input.entityId,
      label: n.label,
      value: n.value,
      sectionId: input.sectionId !== undefined ? input.sectionId : prev?.sectionId ?? null,
      storyTimeKey: input.storyTimeKey !== undefined ? input.storyTimeKey : prev?.storyTimeKey ?? null,
      status: n.status,
      source: n.source,
      supersedes: input.supersedes !== undefined ? input.supersedes : prev?.supersedes ?? null,
      appearanceVersionId: input.appearanceVersionId !== undefined ? input.appearanceVersionId : prev?.appearanceVersionId ?? null,
      createdBy: input.createdBy,
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
    };
    this.entityTraits.set(row.id, row);
    return clone(row);
  }

  async setEntityTraitStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor) {
    const t = this.entityTraits.get(id);
    if (!t || t.projectId !== projectId) throw notFound(`Риса «${id}»`);
    if (!(CORE_STATUSES as readonly string[]).includes(status)) throw new CoreRuleError('bad_input', `Невідомий статус «${status}»`);
    const row = { ...t, status, createdBy: actor, updatedAt: now() };
    this.entityTraits.set(id, row);
    return clone(row);
  }

  async deleteEntityTrait(projectId: string, id: string) {
    const t = this.entityTraits.get(id);
    if (!t || t.projectId !== projectId) return false;
    // Як ON DELETE SET NULL у базі: риси, що заміняли цю, більше не заміняють неіснуючу.
    for (const other of this.entityTraits.values()) if (other.supersedes === id) other.supersedes = null;
    return this.entityTraits.delete(id);
  }

  // ── Проблеми безперервності (Т2.4 В1) ────────────────────────────────────

  async listContinuityIssues(projectId: string, filter: { kind?: ContinuityIssueKind; status?: ContinuityIssueStatus; entityId?: string } = {}) {
    return [...this.continuityIssues.values()]
      .filter((i) => i.projectId === projectId)
      .filter((i) => (!filter.kind || i.kind === filter.kind) && (!filter.status || i.status === filter.status) && (!filter.entityId || i.entityId === filter.entityId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(clone);
  }

  async getContinuityIssue(projectId: string, id: string) {
    const i = this.continuityIssues.get(id);
    return i && i.projectId === projectId ? clone(i) : null;
  }

  async upsertContinuityIssue(input: ContinuityIssueInput) {
    this.requireProject(input.projectId);
    const n = checkContinuityIssue(input);
    if (input.entityId && !this.entityIn(input.projectId, input.entityId)) throw notFound(`Сутність «${input.entityId}»`);
    const prev = input.id ? this.continuityIssues.get(input.id) : undefined;
    if (input.id && (!prev || prev.projectId !== input.projectId)) throw notFound(`Проблема «${input.id}»`);
    const at = now();
    const row: ContinuityIssueRow = {
      id: prev?.id ?? randomUUID(),
      projectId: input.projectId,
      kind: input.kind,
      entityId: input.entityId !== undefined ? input.entityId : prev?.entityId ?? null,
      summary: n.summary,
      evidenceA: clone(input.evidenceA),
      evidenceB: input.evidenceB !== undefined ? (input.evidenceB ? clone(input.evidenceB) : null) : prev?.evidenceB ?? null,
      status: n.status,
      source: n.source,
      checkedHash: input.checkedHash !== undefined ? input.checkedHash : prev?.checkedHash ?? null,
      insufficientData: n.insufficientData,
      createdBy: input.createdBy,
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
    };
    this.continuityIssues.set(row.id, row);
    return clone(row);
  }

  async setContinuityIssueStatus(projectId: string, id: string, status: ContinuityIssueStatus, actor: CoreActor) {
    const i = this.continuityIssues.get(id);
    if (!i || i.projectId !== projectId) throw notFound(`Проблема «${id}»`);
    if (!(CONTINUITY_ISSUE_STATUSES as readonly string[]).includes(status)) throw new CoreRuleError('bad_input', `Невідомий статус «${status}»`);
    const row = { ...i, status, createdBy: actor, updatedAt: now() };
    this.continuityIssues.set(id, row);
    return clone(row);
  }

  async deleteContinuityIssue(projectId: string, id: string) {
    const i = this.continuityIssues.get(id);
    if (!i || i.projectId !== projectId) return false;
    return this.continuityIssues.delete(id);
  }

  // ── Перевірки чернеток (Т2.4 В7) ───────────────────────────────────────────

  async addContinuityDraftCheck(input: ContinuityDraftCheckInput) {
    this.requireProject(input.projectId);
    const n = checkContinuityDraftCheck(input);
    if (!this.entityIn(input.projectId, input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    const row: ContinuityDraftCheckRow = {
      id: randomUUID(),
      projectId: input.projectId,
      characterId: input.characterId,
      sectionId: input.sectionId ?? null,
      draftText: n.draftText,
      findings: clone(input.findings),
      simulationId: input.simulationId ?? null,
      createdBy: input.createdBy,
      createdAt: now(),
    };
    this.draftChecks.push(row);
    return clone(row);
  }

  async listContinuityDraftChecks(projectId: string, filter: { characterId?: string; simulationId?: string; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));
    return this.draftChecks
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.projectId === projectId && (!filter.characterId || c.characterId === filter.characterId) && (!filter.simulationId || c.simulationId === filter.simulationId))
      .sort((a, b) => b.c.createdAt.localeCompare(a.c.createdAt) || b.i - a.i)
      .slice(0, limit)
      .map(({ c }) => clone(c));
  }

  async getContinuityDraftCheck(projectId: string, id: string) {
    const c = this.draftChecks.find((x) => x.id === id && x.projectId === projectId);
    return c ? clone(c) : null;
  }

  // ── Журнал рішень героя (Т2.5 В2) ─────────────────────────────────────────

  async addCharacterDecision(input: CharacterDecisionInput) {
    this.requireProject(input.projectId);
    const n = checkCharacterDecision(input);
    if (!this.entityIn(input.projectId, input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    if (input.parentId && !this.decisions.some((d) => d.id === input.parentId && d.projectId === input.projectId)) throw notFound(`Рішення «${input.parentId}»`);
    const row: CharacterDecisionRow = {
      id: randomUUID(),
      projectId: input.projectId,
      characterId: input.characterId,
      level: input.level,
      sceneId: input.sceneId ?? null,
      simulationId: input.simulationId ?? null,
      turnIndex: input.turnIndex ?? null,
      cacheKey: input.cacheKey,
      parentId: input.parentId ?? null,
      questions: clone(input.questions ?? []),
      options: clone(input.options ?? {}),
      result: input.result ? clone(input.result) : null,
      selectedAction: n.selectedAction,
      validation: clone(input.validation ?? {}),
      snapshotHash: input.snapshotHash,
      modelVersion: input.modelVersion,
      source: input.source,
      fallbackReason: input.fallbackReason ?? null,
      basis: clone(input.basis ?? {}),
      status: n.status,
      usage: clone(input.usage ?? {}),
      latencyMs: Math.max(0, Math.round(input.latencyMs ?? 0)),
      createdBy: input.createdBy,
      createdAt: now(),
      resolvedBy: null,
      resolvedAt: null,
    };
    this.decisions.push(row);
    return clone(row);
  }

  async getCharacterDecision(projectId: string, id: string) {
    const d = this.decisions.find((x) => x.id === id && x.projectId === projectId);
    return d ? clone(d) : null;
  }

  async listCharacterDecisions(projectId: string, f: CharacterDecisionFilter = {}) {
    const limit = Math.max(1, Math.min(f.limit ?? 100, 500));
    return this.decisions
      .map((d, i) => ({ d, i }))
      .filter(({ d }) =>
        d.projectId === projectId && (!f.characterId || d.characterId === f.characterId) && (!f.level || d.level === f.level) && (!f.status || d.status === f.status) &&
        (!f.simulationId || d.simulationId === f.simulationId) && (f.sceneId === undefined || d.sceneId === f.sceneId) && (!f.cacheKey || d.cacheKey === f.cacheKey))
      .sort((a, b) => b.d.createdAt.localeCompare(a.d.createdAt) || b.i - a.i)
      .slice(0, limit)
      .map(({ d }) => clone(d));
  }

  async supersedeCharacterDecisions(projectId: string, f: { characterId: string; level: CharacterDecisionLevel; sceneId?: string | null; exceptId?: string }) {
    let n = 0;
    for (const d of this.decisions) {
      if (d.projectId !== projectId || d.characterId !== f.characterId || d.level !== f.level || d.status !== 'active' || d.id === f.exceptId) continue;
      if (f.sceneId !== undefined && d.sceneId !== f.sceneId) continue;
      d.status = 'superseded';
      n++;
    }
    return n;
  }

  async resolveCharacterDecision(projectId: string, id: string, input: { selectedAction: string; result: Record<string, unknown>; actor: CoreActor }) {
    const d = this.decisions.find((x) => x.id === id && x.projectId === projectId);
    if (!d) throw notFound(`Рішення «${id}»`);
    if (d.status !== 'awaiting_author') throw new CoreRuleError('conflict', 'Рішення вже прийнято — вибір автора потрібен лише для «чекає автора»');
    if (!/^user:.+/.test(input.actor)) throw new CoreRuleError('bad_input', 'Рішення автора — лише від користувача');
    const action = String(input.selectedAction ?? '').trim();
    if (!action || action.length > 60) throw new CoreRuleError('bad_input', 'Обрана дія — від 1 до 60 символів');
    Object.assign(d, { status: 'active', source: 'author', selectedAction: action, result: clone(input.result), resolvedBy: input.actor, resolvedAt: now() });
    return clone(d);
  }

  // ── Пам'ять героя (Т2.6 В1) ──────────────────────────────────────────────

  async addCharacterMemory(input: CharacterMemoryInput) {
    this.requireProject(input.projectId);
    const n = checkCharacterMemory(input);
    if (!this.entityIn(input.projectId, input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    const dedupeKey = input.dedupeKey ?? null;
    if (dedupeKey && this.memories.some((m) => m.projectId === input.projectId && m.characterId === input.characterId && m.dedupeKey === dedupeKey && m.status !== 'rejected' && m.status !== 'superseded')) {
      throw new CoreRuleError('conflict', 'Такий спогад героя вже є (той самий ключ повтору)');
    }
    const t = now();
    const row: CharacterMemoryRow = {
      id: randomUUID(),
      projectId: input.projectId,
      characterId: input.characterId,
      memoryType: input.memoryType,
      layer: n.layer,
      content: n.content,
      aboutEntityIds: clone(input.aboutEntityIds ?? []),
      effects: clone(input.effects ?? {}),
      beliefStatus: n.beliefStatus,
      truth: n.truth,
      sourceEventKind: input.sourceEventKind,
      sourceEventId: input.sourceEventId ?? null,
      sourceParagraphIds: clone(input.sourceParagraphIds ?? []),
      evidenceHash: input.evidenceHash ?? null,
      sceneId: input.sceneId ?? null,
      storyTime: clone(input.storyTime ?? {}),
      simulationId: input.simulationId || null,
      canonRevision: input.canonRevision ?? null,
      visibility: n.visibility,
      origin: input.origin,
      status: n.status,
      dedupeKey,
      reviewNote: null,
      createdBy: input.createdBy,
      createdAt: t,
      updatedAt: t,
      reviewedBy: null,
      reviewedAt: null,
    };
    this.memories.push(row);
    return clone(row);
  }

  async getCharacterMemory(projectId: string, id: string) {
    const m = this.memories.find((x) => x.id === id && x.projectId === projectId);
    return m ? clone(m) : null;
  }

  async listCharacterMemories(projectId: string, f: CharacterMemoryFilter = {}) {
    const limit = Math.max(1, Math.min(f.limit ?? 200, 1000));
    const paras = f.paragraphIds ? new Set(f.paragraphIds) : null;
    return this.memories
      .map((m, i) => ({ m, i }))
      .filter(({ m }) =>
        m.projectId === projectId && (!f.characterId || m.characterId === f.characterId) && (!f.memoryType || m.memoryType === f.memoryType) &&
        (!f.status || m.status === f.status) && (f.simulationId === undefined || m.simulationId === f.simulationId) && (!f.dedupeKey || m.dedupeKey === f.dedupeKey) &&
        (!paras || m.sourceParagraphIds.some((p) => paras.has(p))))
      .sort((a, b) => b.m.createdAt.localeCompare(a.m.createdAt) || b.i - a.i)
      .slice(0, limit)
      .map(({ m }) => clone(m));
  }

  async setCharacterMemoryStatus(projectId: string, id: string, status: CharacterMemoryStatus, actor: CoreActor, note?: string | null) {
    const m = this.memories.find((x) => x.id === id && x.projectId === projectId);
    if (!m) throw notFound(`Спогад «${id}»`);
    checkCharacterMemoryStatus(m, status, actor, note);
    const t = now();
    const reviewed = status === 'confirmed' || status === 'rejected' || status === 'needs_review';
    Object.assign(m, {
      status,
      updatedAt: t,
      ...(reviewed ? { reviewedBy: actor, reviewedAt: t } : {}),
      ...(note !== undefined ? { reviewNote: note ?? null } : {}),
    });
    return clone(m);
  }

  async updateCharacterMemory(projectId: string, id: string, patch: CharacterMemoryPatch, actor: CoreActor) {
    const m = this.memories.find((x) => x.id === id && x.projectId === projectId);
    if (!m) throw notFound(`Спогад «${id}»`);
    checkCharacterMemoryPatch(m, patch, actor);
    const next = clone(patch) as Record<string, unknown>;
    if (typeof next.content === 'string') next.content = next.content.trim();
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    Object.assign(m, next, { updatedAt: now() });
    return clone(m);
  }

  async addCharacterState(input: CharacterStateInput) {
    this.requireProject(input.projectId);
    assertActor(input.createdBy);
    if (!this.entityIn(input.projectId, input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    if (!Number.isInteger(input.canonRevision) || input.canonRevision < 0) throw new CoreRuleError('bad_input', 'Ревізія канону — ціле ≥ 0');
    if (!/^[0-9a-f]{16,64}$/.test(String(input.snapshotHash ?? ''))) throw new CoreRuleError('bad_input', 'Відбиток знімка — 16–64 шістнадцяткових символи');
    const row: CharacterStateRow = {
      id: randomUUID(),
      projectId: input.projectId,
      characterId: input.characterId,
      sceneId: input.sceneId ?? null,
      simulationId: input.simulationId ?? null,
      canonRevision: input.canonRevision,
      goals: clone(input.goals ?? []),
      emotions: clone(input.emotions ?? []),
      beliefs: clone(input.beliefs ?? []),
      relationships: clone(input.relationships ?? []),
      memoryIds: clone(input.memoryIds ?? []),
      stateVersion: input.stateVersion ?? 1,
      snapshotHash: input.snapshotHash,
      createdBy: input.createdBy,
      createdAt: now(),
    };
    this.states.push(row);
    return clone(row);
  }

  async getCharacterState(projectId: string, k: { characterId: string; sceneId: string | null; simulationId: string | null; canonRevision: number }) {
    for (let i = this.states.length - 1; i >= 0; i--) {
      const s = this.states[i];
      if (s.projectId === projectId && s.characterId === k.characterId && s.sceneId === k.sceneId && s.simulationId === k.simulationId && s.canonRevision === k.canonRevision) return clone(s);
    }
    return null;
  }

  // ── Допит (Т2.7 В1) ──────────────────────────────────────────────────────

  async getCharacterAgent(projectId: string, characterId: string) {
    const a = this.agents.find((x) => x.projectId === projectId && x.characterId === characterId);
    return a ? clone(a) : null;
  }

  async upsertCharacterAgent(input: CharacterAgentInput) {
    this.requireProject(input.projectId);
    checkCharacterAgent(input);
    if (!this.entityIn(input.projectId, input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    const t = now();
    const prev = this.agents.find((x) => x.projectId === input.projectId && x.characterId === input.characterId);
    if (prev) {
      Object.assign(prev, {
        autonomyLevel: input.autonomyLevel,
        enabled: input.autonomyLevel !== 'off',
        ...(input.agentConfig !== undefined ? { agentConfig: clone(input.agentConfig) } : {}),
        ...(input.modelPolicy !== undefined ? { modelPolicy: clone(input.modelPolicy) } : {}),
        updatedBy: input.actor,
        updatedAt: t,
      });
      return clone(prev);
    }
    const row: CharacterAgentRow = {
      id: randomUUID(),
      projectId: input.projectId,
      characterId: input.characterId,
      enabled: input.autonomyLevel !== 'off',
      autonomyLevel: input.autonomyLevel,
      agentConfig: clone(input.agentConfig ?? {}),
      modelPolicy: clone(input.modelPolicy ?? {}),
      createdBy: input.actor,
      createdAt: t,
      updatedBy: input.actor,
      updatedAt: t,
    };
    this.agents.push(row);
    return clone(row);
  }

  async listCharacterAgents(projectId: string) {
    return this.agents.filter((a) => a.projectId === projectId).map(clone);
  }

  async addSimulation(input: SimulationInput) {
    this.requireProject(input.projectId);
    checkSimulation(input);
    if (input.characterId && !this.entityIn(input.projectId, input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    const t = now();
    const row: SimulationRow = {
      id: randomUUID(),
      projectId: input.projectId,
      kind: input.kind,
      characterId: input.characterId ?? null,
      sceneId: input.sceneId ?? null,
      asOfChapter: input.asOfChapter ?? null,
      baseBookRevision: input.baseBookRevision,
      title: input.title ?? '',
      config: clone(input.config ?? {}),
      status: 'active',
      currentTurn: 0,
      createdBy: input.createdBy,
      createdAt: t,
      updatedAt: t,
    };
    this.simulations.push(row);
    return clone(row);
  }

  async getSimulation(projectId: string, id: string) {
    const s = this.simulations.find((x) => x.projectId === projectId && x.id === id);
    return s ? clone(s) : null;
  }

  async listSimulations(projectId: string, f: { characterId?: string; kind?: SimulationKind; status?: SimulationStatus; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(f.limit ?? 50, 500));
    return this.simulations
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.projectId === projectId && (!f.characterId || s.characterId === f.characterId) && (!f.kind || s.kind === f.kind) && (!f.status || s.status === f.status))
      .sort((a, b) => b.s.createdAt.localeCompare(a.s.createdAt) || b.i - a.i)
      .slice(0, limit)
      .map(({ s }) => clone(s));
  }

  async updateSimulation(projectId: string, id: string, patch: SimulationPatch) {
    const s = this.simulations.find((x) => x.projectId === projectId && x.id === id);
    if (!s) throw notFound(`Прогін «${id}»`);
    checkSimulationPatch(patch);
    const next = clone(patch) as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    Object.assign(s, next, { updatedAt: now() });
    return clone(s);
  }

  async addSimulationEvent(input: SimulationEventInput) {
    checkSimulationEvent(input);
    if (!this.simulations.some((x) => x.projectId === input.projectId && x.id === input.simulationId)) throw notFound(`Прогін «${input.simulationId}»`);
    if (input.sourceDecisionId && !this.decisions.some((d) => d.projectId === input.projectId && d.id === input.sourceDecisionId)) throw notFound(`Рішення «${input.sourceDecisionId}»`);
    const row: SimulationEventRow = {
      id: randomUUID(),
      projectId: input.projectId,
      simulationId: input.simulationId,
      turnIndex: input.turnIndex,
      actor: input.actor,
      actorCharacterId: input.actorCharacterId ?? null,
      eventType: input.eventType,
      publicPayload: clone(input.publicPayload ?? {}),
      privatePayloadRef: input.privatePayloadRef ?? null,
      sourceDecisionId: input.sourceDecisionId ?? null,
      createdBy: input.createdBy,
      createdAt: now(),
    };
    this.simEvents.push(row);
    return clone(row);
  }

  async listSimulationEvents(projectId: string, simulationId: string) {
    return this.simEvents
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.projectId === projectId && e.simulationId === simulationId)
      .sort((a, b) => a.e.turnIndex - b.e.turnIndex || a.e.createdAt.localeCompare(b.e.createdAt) || a.i - b.i)
      .map(({ e }) => clone(e));
  }

  async addCanonProposal(input: CanonProposalInput) {
    checkCanonProposal(input);
    if (!this.simulations.some((x) => x.projectId === input.projectId && x.id === input.simulationId)) throw notFound(`Прогін «${input.simulationId}»`);
    if (!this.entityIn(input.projectId, input.characterId)) throw notFound(`Сутність «${input.characterId}»`);
    if (input.parentId && !this.proposals.some((p) => p.projectId === input.projectId && p.id === input.parentId)) throw notFound(`Пропозиція «${input.parentId}»`);
    const row: CanonProposalRow = {
      id: randomUUID(),
      projectId: input.projectId,
      simulationId: input.simulationId,
      characterId: input.characterId,
      sourceEventIds: clone(input.sourceEventIds ?? []),
      kind: input.kind,
      proposedChange: clone(input.proposedChange),
      parentId: input.parentId ?? null,
      status: 'pending',
      result: {},
      createdBy: input.createdBy,
      createdAt: now(),
      reviewedBy: null,
      reviewedAt: null,
    };
    this.proposals.push(row);
    return clone(row);
  }

  async getCanonProposal(projectId: string, id: string) {
    const p = this.proposals.find((x) => x.projectId === projectId && x.id === id);
    return p ? clone(p) : null;
  }

  async listCanonProposals(projectId: string, f: { simulationId?: string; characterId?: string; status?: CanonProposalStatus; kind?: CanonProposalKind; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(f.limit ?? 200, 1000));
    return this.proposals
      .filter((p) => p.projectId === projectId && (!f.simulationId || p.simulationId === f.simulationId) && (!f.characterId || p.characterId === f.characterId) && (!f.status || p.status === f.status) && (!f.kind || p.kind === f.kind))
      .slice(0, limit)
      .map(clone);
  }

  async resolveCanonProposal(projectId: string, id: string, input: { status: 'accepted' | 'rejected'; actor: CoreActor; result?: Record<string, unknown> }) {
    const p = this.proposals.find((x) => x.projectId === projectId && x.id === id);
    if (!p) throw notFound(`Пропозиція «${id}»`);
    if (!/^user:.+/.test(input.actor)) throw new CoreRuleError('confirmed_is_author_only', 'Приймає чи відхиляє пропозицію лише автор');
    if (input.status !== 'accepted' && input.status !== 'rejected') throw new CoreRuleError('bad_input', 'Рішення — accepted або rejected');
    if (p.status !== 'pending') throw new CoreRuleError('conflict', 'Пропозицію вже вирішено');
    Object.assign(p, { status: input.status, result: clone(input.result ?? {}), reviewedBy: input.actor, reviewedAt: now() });
    return clone(p);
  }

  // ── Збережені запити (Т1.3) ──────────────────────────────────────────────

  async addQualityRun(input: QualityRunInput) {
    checkQualityRun(input);
    const row: QualityRunRow = {
      id: randomUUID(),
      setId: input.setId,
      setVersion: input.setVersion,
      status: 'queued',
      label: input.label ?? '',
      passed: null,
      summary: {},
      report: null,
      models: clone(input.models ?? {}),
      costUsd: 0,
      budgetUsd: input.budgetUsd ?? null,
      error: null,
      createdBy: input.createdBy,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
    };
    this.qualityRuns.push(row);
    return clone(row);
  }

  async getQualityRun(id: string) {
    const r = this.qualityRuns.find((x) => x.id === id);
    return r ? clone(r) : null;
  }

  async listQualityRuns(f: { setId?: string; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(f.limit ?? 50, 200));
    return this.qualityRuns
      .filter((r) => !f.setId || r.setId === f.setId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((r) => ({ ...clone(r), report: null }));
  }

  async updateQualityRun(id: string, patch: QualityRunPatch) {
    const r = this.qualityRuns.find((x) => x.id === id);
    if (!r) throw notFound(`Прогін якості «${id}»`);
    checkQualityRunPatch(patch);
    const t = now();
    if (patch.status === 'running' && !r.startedAt) r.startedAt = t;
    if (patch.status === 'succeeded' || patch.status === 'failed') r.finishedAt = t;
    for (const k of ['status', 'passed', 'summary', 'report', 'models', 'costUsd', 'error', 'label'] as const) {
      if (patch[k] !== undefined) (r as any)[k] = clone(patch[k] as any);
    }
    return clone(r);
  }

  async listSavedSearches(projectId: string, userId: string) {
    return this.savedSearches
      .filter((s) => s.projectId === projectId && s.userId === userId)
      .slice()
      .reverse()
      .map(clone);
  }

  async addSavedSearch(input: { projectId: string; userId: string; name: string; params: Record<string, unknown> }) {
    this.requireProject(input.projectId);
    const name = input.name.trim();
    if (!name || name.length > 200) throw new CoreRuleError('bad_input', 'Назва запиту — від 1 до 200 символів');
    const row: SavedSearchRow = { id: randomUUID(), projectId: input.projectId, userId: input.userId, name, params: clone(input.params ?? {}), createdAt: now() };
    this.savedSearches.push(row);
    return clone(row);
  }

  async deleteSavedSearch(projectId: string, userId: string, id: string) {
    const i = this.savedSearches.findIndex((s) => s.projectId === projectId && s.userId === userId && s.id === id);
    if (i < 0) return false;
    this.savedSearches.splice(i, 1);
    return true;
  }

  async addNotification(input: NotificationInput) {
    this.requireProject(input.projectId);
    const row: NotificationRow = {
      id: randomUUID(),
      projectId: input.projectId,
      kind: input.kind,
      message: input.message,
      paragraphIds: [...(input.paragraphIds ?? [])],
      payload: clone(input.payload ?? {}),
      createdAt: now(),
      readAt: null,
    };
    this.notifications.push(row);
    return clone(row);
  }

  async listNotifications(projectId: string, limit = 50) {
    return this.notifications
      .filter((n) => n.projectId === projectId)
      .slice()
      .reverse()
      .slice(0, limit)
      .map(clone);
  }

  async close() {}
}

/** Косинусна близькість; вектори з ембедера вже нормовані, але тест може дати й ненормовані. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
