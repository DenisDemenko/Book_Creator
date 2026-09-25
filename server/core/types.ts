/**
 * Типи семантичного ядра (Т0.3–Т0.4) і договір сховища `CoreRepository`.
 *
 * Договір один — реалізацій дві: PostgreSQL (`pgRepository.ts`, прод) і
 * пам'ять (`memoryRepository.ts`, тести й запуск без бази). Обидві проходять
 * той самий набір тестів (`scripts/test-coreDb.mts`), тож правила ядра
 * (докази, статуси, версії) не можуть розійтися між ними непомітно.
 */

export type CoreStatus = 'suggested' | 'confirmed' | 'rejected';
export const CORE_STATUSES: readonly CoreStatus[] = ['suggested', 'confirmed', 'rejected'];

/** `user:<id>` · `ai:<роль>` (`ai:AI-1`) · `system:<назва>` (`system:core_sync`). */
export type CoreActor = string;

export type MemberRole = 'owner' | 'coauthor' | 'editor' | 'designer' | 'publisher' | 'translator' | 'reader';
export const MEMBER_ROLES: readonly MemberRole[] = [
  'owner', 'coauthor', 'editor', 'designer', 'publisher', 'translator', 'reader',
];

export type DocumentKind = 'chapter' | 'section';
export type ParagraphKind = 'paragraph' | 'heading' | 'blockquote' | 'table' | 'divider' | 'image' | 'draft';
export const PARAGRAPH_KINDS: readonly ParagraphKind[] = [
  'paragraph', 'heading', 'blockquote', 'table', 'divider', 'image', 'draft',
];
export type MentionSource = 'tag' | 'ai' | 'author';
export type AiRole = 'AI-1' | 'AI-2' | 'AI-3';
export const AI_ROLES: readonly AiRole[] = ['AI-1', 'AI-2', 'AI-3'];
export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type Visibility = 'project' | 'author' | 'hidden';
export const VISIBILITIES: readonly Visibility[] = ['project', 'author', 'hidden'];

export interface ProjectRow {
  id: string;
  ownerId: string;
  title: string;
  languages: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRow {
  projectId: string;
  id: string;
  kind: DocumentKind;
  parentId: string | null;
  order: number;
  title: string;
  version: number;
  /** Розділу/глави більше немає в книзі (Т0.6). */
  deletedAt: string | null;
  updatedAt: string;
}

export interface ParagraphRow {
  projectId: string;
  id: string;
  documentId: string;
  order: number;
  kind: ParagraphKind;
  text: string;
  textHash: string;
  version: number;
  deletedAt: string | null;
  /** Номер у редакторі, якщо відрізняється від id (копія розділу з тими самими номерами, Т0.6). */
  editorPid: string | null;
  updatedAt: string;
}

export interface ParagraphVersionRow {
  projectId: string;
  paragraphId: string;
  version: number;
  text: string;
  textHash: string;
  changedBy: CoreActor;
  changedAt: string;
}

export interface EntityRow {
  id: string;
  projectId: string;
  type: string;
  name: string;
  canonical: Record<string, unknown>;
  status: CoreStatus;
  version: number;
  /** Зв'язок з об'єктом Студії: `studio:character:<id>` (Т0.6). */
  externalRef: string | null;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
}

export interface VersionRow<T> {
  projectId: string;
  recordId: string;
  version: number;
  snapshot: T;
  changedBy: CoreActor;
  changedAt: string;
  reason: string;
}

export interface AliasRow {
  id: string;
  projectId: string;
  entityId: string;
  entityType: string;
  alias: string;
  aliasNorm: string;
  kind: 'tag' | 'name' | 'alias';
}

export interface MentionRow {
  id: string;
  projectId: string;
  entityId: string;
  paragraphId: string;
  spanStart: number;
  spanEnd: number;
  source: MentionSource;
  status: CoreStatus;
  subjectEntityId: string | null;
  fields: Record<string, unknown>;
}

export interface RelationRow {
  id: string;
  projectId: string;
  type: string;
  fromId: string;
  toId: string;
  status: CoreStatus;
  evidence: string[];
  note: string;
  version: number;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
}

export interface RunInput {
  paragraphId: string;
  hash: string;
}

export interface RunRow {
  id: string;
  projectId: string;
  role: AiRole;
  module: string;
  model: string;
  promptVersion: string;
  inputs: RunInput[];
  status: RunStatus;
  cost: Record<string, unknown>;
  error: string | null;
  createdBy: CoreActor;
  createdAt: string;
  finishedAt: string | null;
}

export interface StoryTimeRange {
  from?: string;
  to?: string;
}

export interface FindingRow {
  id: string;
  projectId: string;
  runId: string | null;
  entityId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  sourceParagraphIds: string[];
  /** Ілюстрації-докази (AI-3, Т0.9): id з медіатеки. */
  sourceAssetIds: string[];
  sourceRevision: number | null;
  validStoryTime: StoryTimeRange | null;
  status: CoreStatus;
  needsReview: boolean;
  insufficientData: boolean;
  visibility: Visibility;
  version: number;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
}

// ── Вхідні дані ────────────────────────────────────────────────────────────

export interface ProjectInput {
  id: string;
  ownerId: string;
  title?: string;
  languages?: string[];
}

export interface DocumentInput {
  projectId: string;
  id: string;
  kind: DocumentKind;
  parentId?: string | null;
  order: number;
  title?: string;
}

export interface ParagraphInput {
  projectId: string;
  id: string;
  documentId: string;
  order: number;
  kind: ParagraphKind;
  text: string;
  editorPid?: string | null;
}

export interface EntityInput {
  projectId: string;
  type: string;
  name: string;
  canonical?: Record<string, unknown>;
  status?: CoreStatus;
  externalRef?: string | null;
  createdBy: CoreActor;
}

export interface EntityPatch {
  name?: string;
  canonical?: Record<string, unknown>;
  externalRef?: string | null;
}

export interface NotificationRow {
  id: string;
  projectId: string;
  kind: string;
  message: string;
  paragraphIds: string[];
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationInput {
  projectId: string;
  kind: string;
  message: string;
  paragraphIds?: string[];
  payload?: Record<string, unknown>;
}

export interface MentionInput {
  entityId: string;
  spanStart: number;
  spanEnd: number;
  source: MentionSource;
  status?: CoreStatus;
  subjectEntityId?: string | null;
  fields?: Record<string, unknown>;
}

export interface RelationInput {
  projectId: string;
  type: string;
  fromId: string;
  toId: string;
  status?: CoreStatus;
  evidence?: string[];
  note?: string;
  createdBy: CoreActor;
}

export interface RunCreateInput {
  projectId: string;
  role: AiRole;
  module: string;
  model?: string;
  promptVersion?: string;
  inputs?: RunInput[];
  createdBy: CoreActor;
}

export interface RunFinishInput {
  status: Exclude<RunStatus, 'queued' | 'running'>;
  cost?: Record<string, unknown>;
  error?: string | null;
}

export interface FindingInput {
  projectId: string;
  runId?: string | null;
  entityId?: string | null;
  kind: string;
  payload?: Record<string, unknown>;
  sourceParagraphIds?: string[];
  sourceAssetIds?: string[];
  sourceRevision?: number | null;
  validStoryTime?: StoryTimeRange | null;
  status?: CoreStatus;
  insufficientData?: boolean;
  visibility?: Visibility;
  createdBy: CoreActor;
}

/** Час сцени чи події у світі книги (Т2.1). */
export interface TimePointRow {
  id: string;
  projectId: string;
  subjectKind: 'scene' | 'event';
  /** Сцена — id розділу книги; подія — id сутності. */
  subjectId: string;
  kind: 'exact' | 'approximate' | 'interval' | 'unknown';
  start: string | null;
  end: string | null;
  sortKey: number | null;
  endKey: number | null;
  label: string;
  status: CoreStatus;
  source: 'author' | 'ai' | 'tag';
  evidence: string[];
  createdBy: CoreActor;
  updatedAt: string;
}

export type TimePointInput = Omit<TimePointRow, 'id' | 'updatedAt' | 'status' | 'source' | 'evidence'> & {
  status?: CoreStatus;
  source?: TimePointRow['source'];
  evidence?: string[];
};

/** Збережений пошуковий запит автора (Т1.3). */
export interface SavedSearchRow {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  params: Record<string, unknown>;
  createdAt: string;
}

/** Вектор абзацу для пошуку за змістом (Т1.2). */
export interface EmbeddingInput {
  paragraphId: string;
  /** Відбиток «модель + текст без тегів» (`search/text.ts::embeddingContentHash`). */
  contentHash: string;
  vector: number[];
}

/** Абзац у видачі одного з джерел пошуку: чим більше `score`, тим ближче. */
export interface ParagraphScore {
  paragraphId: string;
  score: number;
}

export interface UpsertParagraphResult {
  row: ParagraphRow;
  /** true — з'явилась нова версія тексту (або абзац новий). */
  changed: boolean;
}

// ── Договір сховища ────────────────────────────────────────────────────────

export interface CoreRepository {
  readonly kind: 'postgres' | 'memory';

  upsertProject(input: ProjectInput): Promise<ProjectRow>;
  getProject(id: string): Promise<ProjectRow | null>;
  /** +1 до ревізії книги; повертає нову ревізію. */
  bumpProjectRevision(id: string): Promise<number>;

  setMember(projectId: string, userId: string, role: MemberRole, scopes?: Record<string, unknown>): Promise<void>;
  removeMember(projectId: string, userId: string): Promise<void>;
  getMemberRole(projectId: string, userId: string): Promise<MemberRole | null>;

  /** Створює або оновлює документ; видалений документ повертається в книгу. */
  upsertDocument(input: DocumentInput): Promise<DocumentRow>;
  /** Усі документи, зокрема видалені (`deletedAt`). */
  listDocuments(projectId: string): Promise<DocumentRow[]>;
  markDocumentDeleted(projectId: string, id: string): Promise<boolean>;

  /**
   * Новий абзац — версія 1. Той самий текст — нічого не пише (changed=false),
   * лише порядок і вид. Інший текст — версія +1 і рядок у `paragraph_versions`.
   * Абзац, що був позначений видаленим, повертається в текст.
   */
  upsertParagraph(input: ParagraphInput, actor: CoreActor): Promise<UpsertParagraphResult>;
  markParagraphDeleted(projectId: string, id: string): Promise<boolean>;
  getParagraph(projectId: string, id: string): Promise<ParagraphRow | null>;
  /** Лише живі абзаци, у порядку документа. */
  listParagraphs(projectId: string, documentId: string): Promise<ParagraphRow[]>;
  /** Усі абзаци проєкту, зокрема видалені, — для звірки під час синхронізації. */
  listAllParagraphs(projectId: string): Promise<ParagraphRow[]>;
  listParagraphVersions(projectId: string, id: string): Promise<ParagraphVersionRow[]>;

  createEntity(input: EntityInput): Promise<EntityRow>;
  getEntity(projectId: string, id: string): Promise<EntityRow | null>;
  findEntityByExternalRef(projectId: string, type: string, externalRef: string): Promise<EntityRow | null>;
  listEntities(projectId: string, type?: string): Promise<EntityRow[]>;
  updateEntity(projectId: string, id: string, patch: EntityPatch, actor: CoreActor, reason?: string): Promise<EntityRow>;
  setEntityStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor, reason?: string): Promise<EntityRow>;
  listEntityVersions(projectId: string, id: string): Promise<VersionRow<EntityRow>[]>;

  addAlias(projectId: string, entityId: string, alias: string, kind?: AliasRow['kind']): Promise<AliasRow>;
  /** Сутність за псевдонімом у межах типу (регістр і зайві пробіли не важать). */
  resolveAlias(projectId: string, type: string, alias: string): Promise<string | null>;
  /** Псевдоніми сутності, а без `entityId` — усі псевдоніми проєкту (для розпізнавання імен у запиті, Т1.2). */
  listAliases(projectId: string, entityId?: string): Promise<AliasRow[]>;

  /** Замінює всі згадки абзацу одним рухом (так їх перераховує синхронізація). */
  replaceParagraphMentions(projectId: string, paragraphId: string, mentions: MentionInput[]): Promise<MentionRow[]>;
  listMentionsByEntity(projectId: string, entityId: string): Promise<MentionRow[]>;
  listMentionsByParagraphs(projectId: string, paragraphIds: string[]): Promise<MentionRow[]>;
  /** Згадки з суб'єктом (емоція, стан… героя, П1) у живих абзацах — для графа історії (Т1.4). */
  listSubjectMentions(projectId: string): Promise<MentionRow[]>;
  /** Скільки згадок у живих абзацах має кожна сутність проєкту (Т0.8, для списків). */
  countMentionsByEntity(projectId: string): Promise<Record<string, number>>;

  createRelation(input: RelationInput): Promise<RelationRow>;
  setRelationStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor, reason?: string): Promise<RelationRow>;
  listRelations(projectId: string, entityId?: string): Promise<RelationRow[]>;
  listRelationVersions(projectId: string, id: string): Promise<VersionRow<RelationRow>[]>;

  createRun(input: RunCreateInput): Promise<RunRow>;
  finishRun(projectId: string, id: string, input: RunFinishInput): Promise<RunRow>;
  getRun(projectId: string, id: string): Promise<RunRow | null>;

  addFinding(input: FindingInput): Promise<FindingRow>;
  getFinding(projectId: string, id: string): Promise<FindingRow | null>;
  setFindingStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor, reason?: string): Promise<FindingRow>;
  /** Позначає `needs_review` висновки, що спираються на будь-який із цих абзаців; повертає кількість. */
  markFindingsNeedReview(projectId: string, paragraphIds: string[]): Promise<number>;
  listFindings(projectId: string, filter?: { entityId?: string; status?: CoreStatus }): Promise<FindingRow[]>;
  listFindingVersions(projectId: string, id: string): Promise<VersionRow<FindingRow>[]>;

  // ── Пошук (Т1.2) ── усі методи бачать лише живі абзаци живих розділів,
  // із текстом (без роздільників і картинок).

  /** Пошук за словами: будь-яка з основ (`search/text.ts::searchStems`) як префікс слова. */
  searchParagraphsByText(projectId: string, stems: string[], limit: number): Promise<ParagraphScore[]>;
  /** Пошук за змістом: косинусна близькість до вектора запиту, лише вектори цієї моделі. */
  searchParagraphsByVector(projectId: string, model: string, vector: number[], limit: number): Promise<ParagraphScore[]>;
  /** Які абзаци вже мають вектор цієї моделі і від якого тексту він пораховний. */
  listEmbeddingHashes(projectId: string, model: string): Promise<{ paragraphId: string; contentHash: string }[]>;
  /** Записує (або замінює) вектори абзаців; повертає кількість. */
  upsertParagraphEmbeddings(projectId: string, model: string, rows: EmbeddingInput[]): Promise<number>;
  /** Прибирає вектори інших моделей і видалених абзаців; повертає кількість. */
  pruneParagraphEmbeddings(projectId: string, keepModel: string): Promise<number>;

  /** Хронологія (Т2.1): точки часу сцен і подій. */
  listTimePoints(projectId: string): Promise<TimePointRow[]>;
  upsertTimePoint(input: TimePointInput): Promise<TimePointRow>;
  deleteTimePoint(projectId: string, subjectKind: TimePointRow['subjectKind'], subjectId: string): Promise<boolean>;

  /** Збережені запити автора в книзі (Т1.3), новіші першими. */
  listSavedSearches(projectId: string, userId: string): Promise<SavedSearchRow[]>;
  addSavedSearch(input: { projectId: string; userId: string; name: string; params: Record<string, unknown> }): Promise<SavedSearchRow>;
  /** Видаляє лише свій запит; false — такого немає (або він чужий). */
  deleteSavedSearch(projectId: string, userId: string, id: string): Promise<boolean>;

  addNotification(input: NotificationInput): Promise<NotificationRow>;
  listNotifications(projectId: string, limit?: number): Promise<NotificationRow[]>;

  close(): Promise<void>;
}
