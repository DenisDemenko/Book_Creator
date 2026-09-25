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
} from './rules';
import { EMBEDDING_DIMENSIONS, isSearchableKind, isValidEmbedding, memoryTextScore } from './search/text';
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
  ParagraphVersionRow,
  ProjectInput,
  ProjectRow,
  RelationInput,
  RelationRow,
  RunCreateInput,
  RunFinishInput,
  RunRow,
  VersionRow,
} from './types';

const key = (projectId: string, id: string) => `${projectId}\u0000${id}`;
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
  private embeddings = new Map<string, { projectId: string; paragraphId: string; model: string; contentHash: string; vector: number[] }>();

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

  // ── Збережені запити (Т1.3) ──────────────────────────────────────────────

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
