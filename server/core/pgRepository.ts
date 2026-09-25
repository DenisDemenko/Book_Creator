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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Рядок, що не є UUID, у колонці `uuid` дав би помилку бази; для ядра це просто «не знайдено». */
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

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

  // ── Збережені запити (Т1.3) ──────────────────────────────────────────────

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
