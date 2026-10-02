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
  /** Т6.3: `book` чи `course` (курс — проєкт `course-<id>`). */
  projectType: string;
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
  /** Типово — `book`; змінюється лише явно. */
  projectType?: string;
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

/** Емоційна точка героя поза тегами (Т2.2): поставив автор або підтвердив з пропозиції AI-2. */
export interface EmotionPointRow {
  id: string;
  projectId: string;
  characterId: string;
  paragraphId: string;
  /** Назва емоції як у тексті, малими літерами («страх», «сором»). */
  emotion: string;
  /** Родина емоції (`src/utils/emotionScale.ts`): fear, joy, guilt… */
  family: string;
  /** Основна, другорядна чи прихована емоція. */
  layer: 'primary' | 'secondary' | 'hidden';
  /** Сила емоції героя 0…10. */
  intensity: number;
  /** Майстерність передачі в тексті 0…10; null — не оцінено. */
  craft: number | null;
  /** Вплив на сюжет 0…10; null — не оцінено. */
  impact: number | null;
  note: string;
  source: 'author' | 'ai';
  status: CoreStatus;
  findingId: string | null;
  createdBy: CoreActor;
  updatedAt: string;
}

export type EmotionPointInput = Omit<EmotionPointRow, 'id' | 'updatedAt' | 'note' | 'source' | 'findingId' | 'layer' | 'craft' | 'impact' | 'status'> & {
  layer?: EmotionPointRow['layer'];
  craft?: number | null;
  impact?: number | null;
  note?: string;
  source?: EmotionPointRow['source'];
  status?: CoreStatus;
  findingId?: string | null;
};

/** Роль зображення щодо сутності чи сцени (Т2.3 В2). */
export type AssetRole = 'portrait' | 'full_body' | 'reference' | 'depicts' | 'location' | 'object' | 'scene';
export const ASSET_ROLES: readonly AssetRole[] = ['portrait', 'full_body', 'reference', 'depicts', 'location', 'object', 'scene'];

/** Зв'язок зображення Медіатеки з сутністю книги або сценою (Т2.3 В2). */
export interface AssetLinkRow {
  id: string;
  projectId: string;
  /** URL зображення (`/api/media/file/<id>` чи зовнішній; `data:` — ні). */
  assetUrl: string;
  /** id файлу Медіатеки, якщо URL — її. */
  assetId: string | null;
  entityId: string | null;
  sectionId: string | null;
  role: AssetRole;
  status: CoreStatus;
  source: 'author' | 'ai' | 'legacy';
  needsReview: boolean;
  checkedHash: string | null;
  evidence: string[];
  note: string;
  /** Версія зовнішності (Т2.3 В3): портрет саме цього етапу героя. */
  appearanceVersionId: string | null;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
}

export type AssetLinkInput = Pick<AssetLinkRow, 'projectId' | 'assetUrl' | 'role' | 'createdBy'> & {
  entityId?: string | null;
  sectionId?: string | null;
  status?: CoreStatus;
  source?: AssetLinkRow['source'];
  evidence?: string[];
  note?: string;
  /** Відбиток опису, з яким автор звірив зображення (Т2.3 В5); задано — позначка «перевірити» знімається. */
  checkedHash?: string | null;
  /** undefined — не змінювати; null — зняти позначку версії. */
  appearanceVersionId?: string | null;
};

/**
 * Версія зовнішності героя (Т2.3 В3): етап за віком чи подіями з власним
 * описом і портретом. Глави дії `fromChapter`–`toChapter` (null — з початку /
 * до кінця). Діють лише затверджені автором (`approved`).
 */
export interface AppearanceVersionRow {
  id: string;
  projectId: string;
  entityId: string;
  label: string;
  age: string;
  fromChapter: number | null;
  toChapter: number | null;
  description: string;
  /** Відбиток опису — для «перевірити» після зміни (етап В5). */
  descriptionHash: string;
  approved: boolean;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
}

export type AppearanceVersionInput = Pick<AppearanceVersionRow, 'projectId' | 'entityId' | 'label' | 'createdBy'> & {
  /** Є — оновити цю версію; немає — створити. */
  id?: string;
  age?: string;
  fromChapter?: number | null;
  toChapter?: number | null;
  description?: string;
  approved?: boolean;
};

export type AppearanceHistoryAction = 'created' | 'updated' | 'deleted' | 'portrait' | 'portrait_removed';

export interface AppearanceHistoryRow {
  id: string;
  projectId: string;
  versionId: string;
  entityId: string;
  action: AppearanceHistoryAction;
  snapshot: Record<string, unknown>;
  actor: CoreActor;
  at: string;
}

// ── Безперервність і Knowledge Check (Т2.4) ─────────────────────────────────

/** Риса сутності — мітка → значення (вік, колір, розмір…). */
export interface EntityTraitRow {
  id: string;
  projectId: string;
  entityId: string;
  label: string;
  value: string;
  /** Розділ, де риса встановлена/згадана — для «раніше/пізніше» без часу світу. */
  sectionId: string | null;
  /** Ключ часу світу (`story_time_points.sort_key`), якщо є — точніший порядок, ніж розділ. */
  storyTimeKey: number | null;
  status: CoreStatus;
  source: 'author' | 'ai';
  /** Ця риса явно заміняє попередню (автор позначив «змінилось», не суперечність). */
  supersedes: string | null;
  /** Риса «вік» живиться з версії зовнішності (Т2.3 В3, Т2.4 В3) — версію видалено, риса зникає разом з нею. */
  appearanceVersionId: string | null;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
}

export type EntityTraitInput = Pick<EntityTraitRow, 'projectId' | 'entityId' | 'label' | 'value' | 'createdBy'> & {
  /** Є — оновити цю рису; немає, але є `appearanceVersionId` з наявною похідною рисою — оновити її; інакше — нова. */
  id?: string;
  sectionId?: string | null;
  storyTimeKey?: number | null;
  status?: CoreStatus;
  source?: 'author' | 'ai';
  supersedes?: string | null;
  appearanceVersionId?: string | null;
};

export const CONTINUITY_ISSUE_KINDS = ['object', 'knowledge', 'place', 'age', 'time'] as const;
export type ContinuityIssueKind = (typeof CONTINUITY_ISSUE_KINDS)[number];

export const CONTINUITY_ISSUE_STATUSES = ['suggested', 'confirmed', 'dismissed', 'resolved', 'needs_review'] as const;
export type ContinuityIssueStatus = (typeof CONTINUITY_ISSUE_STATUSES)[number];

/** Одна сторона доказу суперечності: конкретне місце тексту. */
export interface ContinuityEvidence {
  sectionId: string;
  paragraphId: string | null;
  quote: string;
  entityId: string | null;
}

/**
 * Проблема безперервності (Т2.4): суперечність між двома доказами
 * (`evidenceA`/`evidenceB`), знайдена правилом (`source: 'rule'`) чи AI-2
 * (`source: 'ai'`). `evidenceB` — `null` лише коли `insufficientData`.
 */
export interface ContinuityIssueRow {
  id: string;
  projectId: string;
  kind: ContinuityIssueKind;
  /** Головна сутність, якої стосується проблема (герой, локація, предмет) — якщо є одна. */
  entityId: string | null;
  summary: string;
  evidenceA: ContinuityEvidence;
  evidenceB: ContinuityEvidence | null;
  status: ContinuityIssueStatus;
  source: 'rule' | 'ai';
  /** Відбиток тексту доказів на момент останньої перевірки (В6: «повторна перевірка лише змінених місць»). */
  checkedHash: string | null;
  insufficientData: boolean;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
}

export type ContinuityIssueInput = Pick<ContinuityIssueRow, 'projectId' | 'kind' | 'summary' | 'evidenceA' | 'createdBy'> & {
  /** Є — оновити цю проблему (типово: перевірка за хешем); немає — створити нову. */
  id?: string;
  entityId?: string | null;
  evidenceB?: ContinuityEvidence | null;
  status?: ContinuityIssueStatus;
  source?: 'rule' | 'ai';
  checkedHash?: string | null;
  insufficientData?: boolean;
};

/**
 * Знахідка перевірки чернетки (Т2.4 В7, ТЗ-H): у чернетці героя згадано факт
 * (розкриття таємниці чи подію), якого він станом на сцену ще не знає.
 */
export interface DraftCheckFinding {
  entityId: string;
  entityName: string;
  entityType: string;
  kind: 'revelation' | 'event';
  /** Як знайдено в чернетці: тег `[/revelation:…]` чи назва / псевдонім у тексті. */
  match: 'tag' | 'name';
  /** Уривок чернетки навколо згадки. */
  quote: string;
  /** Позиція згадки в тексті чернетки. */
  offset: number;
  /** learns_later — дізнається пізніше (сцена нижче); never_learns — у книзі не дізнається зовсім. */
  reason: 'learns_later' | 'never_learns';
  learnsAt: { sectionId: string; paragraphId: string; title: string; chapterNumber: number | null; via: 'subject' | 'present' } | null;
}

/**
 * Збережена перевірка чернетки (Т2.4 В7, рішення власника §6 п.4): історія
 * перевірок, НЕ факти книги — у `continuity_issues` не пишеться. `sectionId` —
 * сцена, станом на початок якої рахується знання героя (немає — кінець книги);
 * `simulationId` — порожнє, доки немає Т2.7 («Допит живого персонажа»).
 */
export interface ContinuityDraftCheckRow {
  id: string;
  projectId: string;
  characterId: string;
  sectionId: string | null;
  draftText: string;
  findings: DraftCheckFinding[];
  simulationId: string | null;
  createdBy: CoreActor;
  createdAt: string;
}

export type ContinuityDraftCheckInput = Pick<ContinuityDraftCheckRow, 'projectId' | 'characterId' | 'draftText' | 'findings' | 'createdBy'> & {
  sectionId?: string | null;
  simulationId?: string | null;
};

// ── Журнал рішень героя (Т2.5 В2, ТЗ-H §10 `character_decisions`) ──────────

export const CHARACTER_DECISION_LEVELS = ['strategic', 'scene', 'tactical'] as const;
export type CharacterDecisionLevel = (typeof CHARACTER_DECISION_LEVELS)[number];
export const CHARACTER_DECISION_SOURCES = ['jev', 'mock', 'llm_fallback', 'author'] as const;
export type CharacterDecisionSource = (typeof CHARACTER_DECISION_SOURCES)[number];
export const CHARACTER_DECISION_STATUSES = ['active', 'superseded', 'awaiting_author'] as const;
export type CharacterDecisionStatus = (typeof CHARACTER_DECISION_STATUSES)[number];

/** Підстави рішення — лише посилання (id абзаців і сутностей), без змісту знімка. */
export interface CharacterDecisionBasis {
  paragraphIds?: string[];
  entityIds?: string[];
  /** З чого зібрано ключ кешу (напр. «значущі події: 3»). */
  note?: string;
}

/**
 * Рішення героя одного з трьох рівнів (FLC 2.0 §3) — і водночас кеш рівня:
 * доки `cacheKey` той самий, рішення використовується повторно (В3).
 */
export interface CharacterDecisionRow {
  id: string;
  projectId: string;
  characterId: string;
  level: CharacterDecisionLevel;
  sceneId: string | null;
  simulationId: string | null;
  turnIndex: number | null;
  cacheKey: string;
  parentId: string | null;
  questions: unknown[];
  /** Дозволені / заборонені варіанти, поріг впевненості — з чим порівнював валідатор. */
  options: Record<string, unknown>;
  /** Нормалізований результат (`DecisionResult`); null — поки чекає автора. */
  result: Record<string, unknown> | null;
  selectedAction: string | null;
  /** Що перевірив і що виправив серверний валідатор. */
  validation: Record<string, unknown>;
  snapshotHash: string;
  modelVersion: string;
  source: CharacterDecisionSource;
  fallbackReason: string | null;
  basis: CharacterDecisionBasis;
  status: CharacterDecisionStatus;
  usage: Record<string, unknown>;
  latencyMs: number;
  createdBy: CoreActor;
  createdAt: string;
  resolvedBy: CoreActor | null;
  resolvedAt: string | null;
}

export type CharacterDecisionInput = Pick<CharacterDecisionRow, 'projectId' | 'characterId' | 'level' | 'cacheKey' | 'snapshotHash' | 'modelVersion' | 'source' | 'createdBy'> & {
  sceneId?: string | null;
  simulationId?: string | null;
  turnIndex?: number | null;
  parentId?: string | null;
  questions?: unknown[];
  options?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  selectedAction?: string | null;
  validation?: Record<string, unknown>;
  fallbackReason?: string | null;
  basis?: CharacterDecisionBasis;
  status?: CharacterDecisionStatus;
  usage?: Record<string, unknown>;
  latencyMs?: number;
};

export interface CharacterDecisionFilter {
  characterId?: string;
  level?: CharacterDecisionLevel;
  status?: CharacterDecisionStatus;
  simulationId?: string;
  sceneId?: string;
  cacheKey?: string;
  limit?: number;
}

// ── Пам'ять героя (Т2.6 В1, ТЗ-H §5.1, §10; FLC 2.0 §2, §4) ────────────────

export const CHARACTER_MEMORY_TYPES = ['world_fact', 'knowledge', 'belief', 'recollection', 'consequence'] as const;
export type CharacterMemoryType = (typeof CHARACTER_MEMORY_TYPES)[number];
export const CHARACTER_MEMORY_LAYERS = ['world_truth', 'character_belief', 'reader_knowledge'] as const;
export type CharacterMemoryLayer = (typeof CHARACTER_MEMORY_LAYERS)[number];
export const BELIEF_STATUSES = ['knows', 'believes', 'doubts', 'abandoned'] as const;
export type BeliefStatus = (typeof BELIEF_STATUSES)[number];
export const MEMORY_TRUTHS = ['true', 'false', 'unknown'] as const;
export type MemoryTruth = (typeof MEMORY_TRUTHS)[number];
export const MEMORY_SOURCE_KINDS = ['entity', 'paragraph', 'decision', 'simulation_event', 'author'] as const;
export type MemorySourceKind = (typeof MEMORY_SOURCE_KINDS)[number];
export const MEMORY_ORIGINS = ['tag', 'ai', 'author', 'simulation'] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];
export const CHARACTER_MEMORY_STATUSES = ['suggested', 'confirmed', 'needs_review', 'rejected', 'superseded'] as const;
export type CharacterMemoryStatus = (typeof CHARACTER_MEMORY_STATUSES)[number];

/** Наслідок події (FLC 2.0 §2): як змінились довіра, страх, цілі, стосунки — щодо кого. */
export interface MemoryEffects {
  trust?: { towards: string; delta: number }[];
  fear?: number;
  goals?: string[];
  relationship?: { with: string; change: string }[];
  [k: string]: unknown;
}

/** Час у світі на момент запису — для показу; порядок рахується наживо (Т2.1). */
export interface MemoryStoryTime {
  label?: string | null;
  key?: number | null;
  chapter?: number | null;
  narrativeIndex?: number | null;
}

export interface CharacterMemoryRow {
  id: string;
  projectId: string;
  characterId: string;
  memoryType: CharacterMemoryType;
  layer: CharacterMemoryLayer;
  content: string;
  aboutEntityIds: string[];
  effects: MemoryEffects;
  beliefStatus: BeliefStatus;
  truth: MemoryTruth;
  sourceEventKind: MemorySourceKind;
  sourceEventId: string | null;
  sourceParagraphIds: string[];
  evidenceHash: string | null;
  sceneId: string | null;
  storyTime: MemoryStoryTime;
  /** Рівно одне з двох: спогад прогону чи спогад канону з ревізією книги. */
  simulationId: string | null;
  canonRevision: number | null;
  visibility: Visibility;
  origin: MemoryOrigin;
  status: CharacterMemoryStatus;
  dedupeKey: string | null;
  reviewNote: string | null;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
  reviewedBy: CoreActor | null;
  reviewedAt: string | null;
}

export type CharacterMemoryInput = Pick<CharacterMemoryRow, 'projectId' | 'characterId' | 'memoryType' | 'content' | 'sourceEventKind' | 'origin' | 'createdBy'> & {
  layer?: CharacterMemoryLayer;
  aboutEntityIds?: string[];
  effects?: MemoryEffects;
  beliefStatus?: BeliefStatus;
  truth?: MemoryTruth;
  sourceEventId?: string | null;
  sourceParagraphIds?: string[];
  evidenceHash?: string | null;
  sceneId?: string | null;
  storyTime?: MemoryStoryTime;
  simulationId?: string | null;
  canonRevision?: number | null;
  visibility?: Visibility;
  status?: CharacterMemoryStatus;
  dedupeKey?: string | null;
};

/** Що може змінити автор чи перевірка (В3): зміст, певність, правда, видимість, наслідки, докази, ревізія. */
export type CharacterMemoryPatch = Partial<Pick<CharacterMemoryRow, 'content' | 'effects' | 'beliefStatus' | 'truth' | 'visibility' | 'evidenceHash' | 'canonRevision' | 'aboutEntityIds'>>;

export interface CharacterMemoryFilter {
  characterId?: string;
  memoryType?: CharacterMemoryType;
  status?: CharacterMemoryStatus;
  /** Лише цей прогін (`null` — лише канон). */
  simulationId?: string | null;
  dedupeKey?: string;
  /** Спогади, серед абзаців-доказів яких є хоч один із цих. */
  paragraphIds?: string[];
  limit?: number;
}

export interface CharacterStateRow {
  id: string;
  projectId: string;
  characterId: string;
  sceneId: string | null;
  simulationId: string | null;
  canonRevision: number;
  goals: unknown[];
  emotions: unknown[];
  beliefs: unknown[];
  relationships: unknown[];
  memoryIds: string[];
  stateVersion: number;
  snapshotHash: string;
  createdBy: CoreActor;
  createdAt: string;
}

export type CharacterStateInput = Pick<CharacterStateRow, 'projectId' | 'characterId' | 'canonRevision' | 'snapshotHash' | 'createdBy'> &
  Partial<Pick<CharacterStateRow, 'sceneId' | 'simulationId' | 'goals' | 'emotions' | 'beliefs' | 'relationships' | 'memoryIds' | 'stateVersion'>>;

// ── Допит живого персонажа (Т2.7 В1, ТЗ-H §10; FLC 2.0 §7) ──────────────────

export const AUTONOMY_LEVELS = ['off', 'interview', 'scene'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export interface CharacterAgentRow {
  id: string;
  projectId: string;
  characterId: string;
  enabled: boolean;
  autonomyLevel: AutonomyLevel;
  agentConfig: Record<string, unknown>;
  modelPolicy: Record<string, unknown>;
  createdBy: CoreActor;
  createdAt: string;
  updatedBy: CoreActor;
  updatedAt: string;
}

export interface CharacterAgentInput {
  projectId: string;
  characterId: string;
  autonomyLevel: AutonomyLevel;
  agentConfig?: Record<string, unknown>;
  modelPolicy?: Record<string, unknown>;
  actor: CoreActor;
}

export const SIMULATION_KINDS = ['interview', 'scene'] as const;
export type SimulationKind = (typeof SIMULATION_KINDS)[number];
export const SIMULATION_STATUSES = ['active', 'paused', 'closed', 'stale'] as const;
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];

export interface SimulationRow {
  id: string;
  projectId: string;
  kind: SimulationKind;
  characterId: string | null;
  sceneId: string | null;
  asOfChapter: number | null;
  baseBookRevision: number;
  title: string;
  config: Record<string, unknown>;
  status: SimulationStatus;
  currentTurn: number;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
}

export type SimulationInput = Pick<SimulationRow, 'projectId' | 'kind' | 'baseBookRevision' | 'createdBy'> &
  Partial<Pick<SimulationRow, 'characterId' | 'sceneId' | 'asOfChapter' | 'title' | 'config'>>;

export type SimulationPatch = Partial<Pick<SimulationRow, 'status' | 'currentTurn' | 'config' | 'title'>>;

export const SIMULATION_EVENT_TYPES = ['question', 'answer', 'awaiting', 'failed', 'note'] as const;
export type SimulationEventType = (typeof SIMULATION_EVENT_TYPES)[number];
export const SIMULATION_ACTORS = ['author', 'character', 'system'] as const;
export type SimulationActor = (typeof SIMULATION_ACTORS)[number];

export interface SimulationEventRow {
  id: string;
  projectId: string;
  simulationId: string;
  turnIndex: number;
  actor: SimulationActor;
  actorCharacterId: string | null;
  eventType: SimulationEventType;
  publicPayload: Record<string, unknown>;
  privatePayloadRef: string | null;
  sourceDecisionId: string | null;
  createdBy: CoreActor;
  createdAt: string;
}

export type SimulationEventInput = Pick<SimulationEventRow, 'projectId' | 'simulationId' | 'turnIndex' | 'actor' | 'eventType' | 'createdBy'> &
  Partial<Pick<SimulationEventRow, 'actorCharacterId' | 'publicPayload' | 'privatePayloadRef' | 'sourceDecisionId'>>;

export const CANON_PROPOSAL_KINDS = ['memory', 'fact', 'fragment', 'tag'] as const;
export type CanonProposalKind = (typeof CANON_PROPOSAL_KINDS)[number];
export const CANON_PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type CanonProposalStatus = (typeof CANON_PROPOSAL_STATUSES)[number];

export interface CanonProposalRow {
  id: string;
  projectId: string;
  simulationId: string;
  characterId: string;
  sourceEventIds: string[];
  kind: CanonProposalKind;
  proposedChange: Record<string, unknown>;
  parentId: string | null;
  status: CanonProposalStatus;
  result: Record<string, unknown>;
  createdBy: CoreActor;
  createdAt: string;
  reviewedBy: CoreActor | null;
  reviewedAt: string | null;
}

export type CanonProposalInput = Pick<CanonProposalRow, 'projectId' | 'simulationId' | 'characterId' | 'kind' | 'proposedChange' | 'createdBy'> &
  Partial<Pick<CanonProposalRow, 'sourceEventIds' | 'parentId'>>;

// ── Якість живих персонажів (Т2.8 В3) ────────────────────────────────────────

export const QUALITY_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type QualityRunStatus = (typeof QUALITY_RUN_STATUSES)[number];

export interface QualityRunRow {
  id: string;
  setId: string;
  setVersion: number;
  status: QualityRunStatus;
  label: string;
  passed: boolean | null;
  summary: Record<string, unknown>;
  report: Record<string, unknown> | null;
  models: Record<string, unknown>;
  costUsd: number;
  budgetUsd: number | null;
  error: string | null;
  createdBy: CoreActor;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type QualityRunInput = Pick<QualityRunRow, 'setId' | 'setVersion' | 'createdBy'> & Partial<Pick<QualityRunRow, 'label' | 'budgetUsd' | 'models'>>;
export type QualityRunPatch = Partial<Pick<QualityRunRow, 'status' | 'passed' | 'summary' | 'report' | 'models' | 'costUsd' | 'error' | 'label'>>;

// ── Реєстр схем: версії онтології (Т5.1 В2) ─────────────────────────────────

/** draft → validated → active → deprecated → archived; відкинута чернетка — archived. */
export const ONTOLOGY_VERSION_STATUSES = ['draft', 'validated', 'active', 'deprecated', 'archived'] as const;
export type OntologyVersionStatus = (typeof ONTOLOGY_VERSION_STATUSES)[number];

export interface OntologyVersionRow {
  id: string;
  ontologyId: string;
  /** ontology_version (ТЗ §34): 1, 2, 3… у межах онтології. */
  version: number;
  label: string;
  status: OntologyVersionStatus;
  basedOn: string | null;
  /** Визначення `fusion-ontology/1`; у переліку версій — null (воно важке). */
  definition: Record<string, unknown> | null;
  definitionHash: string;
  validation: Record<string, unknown> | null;
  impact: Record<string, unknown> | null;
  notes: string;
  /** Лічильник правок чернетки. */
  revision: number;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
  publishedBy: CoreActor | null;
  publishedAt: string | null;
}

export type OntologyVersionInput = Pick<OntologyVersionRow, 'ontologyId' | 'definitionHash' | 'createdBy'> & {
  definition: Record<string, unknown>;
  label?: string;
  notes?: string;
  basedOn?: string | null;
  /** `active` — лише для імпорту першої версії (одразу опублікована системою). */
  status?: 'draft' | 'active';
};

export type OntologyVersionPatch = Partial<Pick<OntologyVersionRow, 'status' | 'definitionHash' | 'validation' | 'impact' | 'label' | 'notes'>> & {
  definition?: Record<string, unknown>;
};

export const ONTOLOGY_EVENT_ACTIONS = ['import', 'create_draft', 'edit', 'validate', 'impact', 'publish', 'rollback', 'archive', 'discard'] as const;
export type OntologyEventAction = (typeof ONTOLOGY_EVENT_ACTIONS)[number];

export interface OntologyEventRow {
  id: string;
  ontologyId: string;
  versionId: string | null;
  action: OntologyEventAction;
  actor: CoreActor;
  details: Record<string, unknown>;
  createdAt: string;
}

/** Скільки даних у всіх книгах має кожен тип — для MIGRATION IMPACT (ТЗ §4.5). */
export interface OntologyUsage {
  entities: Record<string, number>;
  aliases: Record<string, number>;
  mentions: Record<string, number>;
  relations: Record<string, number>;
}

// ── Учасники проєкту й ролі (Т6.1 В2) ─────────────────────────────────────────

export const PARTICIPANT_STATUSES = ['active', 'suspended', 'left'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];
export const PARTICIPANT_SOURCES = ['owner', 'invitation', 'access_request', 'freelance_order', 'admin', 'manual', 'legacy_member', 'onboarding'] as const;
export type ParticipantSource = (typeof PARTICIPANT_SOURCES)[number];

export interface ParticipantRow {
  id: string;
  projectId: string;
  userId: string;
  status: ParticipantStatus;
  source: ParticipantSource;
  sourceRef: string | null;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
}

export interface ParticipantRoleRow {
  id: string;
  participantId: string;
  projectId: string;
  roleId: string;
  specialization: string | null;
  status: 'active' | 'revoked';
  assignedBy: CoreActor;
  registryVersion: number | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: CoreActor | null;
}

export const COLLAB_EVENT_ACTIONS = ['participant_added', 'participant_status', 'role_assigned', 'role_revoked', 'legacy_import', 'access_granted', 'access_revoked', 'access_requested', 'access_request_decided'] as const;
export type CollabEventAction = (typeof COLLAB_EVENT_ACTIONS)[number];

export interface CollabEventRow {
  id: string;
  projectId: string;
  participantId: string | null;
  action: CollabEventAction;
  actor: CoreActor;
  details: Record<string, unknown>;
  createdAt: string;
}

// ── Наданий доступ (Т6.2 В1) ─────────────────────────────────────────────────

/** Рівні за зростанням; `work` — робочий доступ до медіатеки (перегляд і власні завантаження). */
export const ACCESS_LEVELS = ['view', 'comment', 'review', 'edit', 'create', 'approve', 'manage', 'work'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export const ACCESS_SCOPES = ['book', 'chapter', 'scene', 'character', 'location', 'media_library', 'style_bible', 'task', 'deliverable'] as const;
export type AccessScope = (typeof ACCESS_SCOPES)[number];
export const ACCESS_SOURCES = ['manual', 'admin', 'legacy_invite'] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

export interface AccessGrantRow {
  id: string;
  projectId: string;
  participantId: string;
  level: AccessLevel;
  scopeType: AccessScope;
  scopeRef: string | null;
  validFrom: string;
  validUntil: string | null;
  status: 'active' | 'revoked';
  source: AccessSource;
  sourceRef: string | null;
  grantedBy: CoreActor;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: CoreActor | null;
}

export type AccessGrantInput = Pick<AccessGrantRow, 'projectId' | 'participantId' | 'level' | 'scopeType' | 'grantedBy'> &
  Partial<Pick<AccessGrantRow, 'scopeRef' | 'validFrom' | 'validUntil' | 'source' | 'sourceRef'>>;

// ── Role Onboarding (Т6.3 В1) ───────────────────────────────────────────────

export const ONBOARDING_SOURCES = ['first_login', 'marketplace', 'create_project', 'import_project', 'open_project', 'invitation', 'freelance_order', 'new_studio', 'manual'] as const;
export type OnboardingSource = (typeof ONBOARDING_SOURCES)[number];
export type OnboardingStatus = 'draft' | 'completed' | 'cancelled';

export interface OnboardingSessionRow {
  id: string;
  userId: string;
  projectId: string | null;
  projectType: string | null;
  entryIntent: string | null;
  source: OnboardingSource;
  sourceOrderId: string | null;
  sourceRef: string | null;
  currentStep: number;
  status: OnboardingStatus;
  answers: Record<string, unknown>;
  result: Record<string, unknown> | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type OnboardingSessionInput = Pick<OnboardingSessionRow, 'userId' | 'source'> &
  Partial<Pick<OnboardingSessionRow, 'projectId' | 'projectType' | 'entryIntent' | 'sourceOrderId' | 'sourceRef' | 'answers' | 'currentStep'>>;
export type OnboardingSessionPatch = Partial<Pick<OnboardingSessionRow, 'projectId' | 'projectType' | 'entryIntent' | 'currentStep' | 'answers' | 'status' | 'result' | 'sourceOrderId'>>;

export const ACCESS_REQUEST_STATUSES = ['pending', 'approved', 'modified', 'rejected', 'cancelled'] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

export const ACCESS_REQUEST_KINDS = ['access', 'role'] as const;
/** Вид запиту: доступ (Т6.3) чи роль / спеціалізація (Т6.4, «Моя роль у проєкті»). */
export type AccessRequestKind = (typeof ACCESS_REQUEST_KINDS)[number];

export interface AccessRequestRow {
  id: string;
  kind: AccessRequestKind;
  projectId: string;
  participantId: string;
  userId: string;
  sessionId: string | null;
  roles: { roleId: string; specialization: string | null }[];
  scope: string;
  scopeRefs: string[];
  capabilities: string[];
  /** Запит ролі може бути без доступу — тоді null. */
  level: AccessLevel | null;
  /** Призначення ролей, які замінює запит (зміна спеціалізації). */
  replaces: string[];
  message: string;
  orderId: string | null;
  status: AccessRequestStatus;
  decision: Record<string, unknown> | null;
  grantIds: string[];
  decidedBy: CoreActor | null;
  decidedAt: string | null;
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export type AccessRequestInput = Pick<AccessRequestRow, 'projectId' | 'participantId' | 'userId' | 'scope' | 'level'> &
  Partial<Pick<AccessRequestRow, 'kind' | 'sessionId' | 'roles' | 'scopeRefs' | 'capabilities' | 'message' | 'orderId' | 'replaces'>>;
export interface AccessRequestDecision {
  status: 'approved' | 'modified' | 'rejected' | 'cancelled';
  decision?: Record<string, unknown> | null;
  grantIds?: string[];
  decidedBy?: CoreActor | null;
  reason?: string;
}

export interface ParticipantPreferenceRow {
  userId: string;
  /** `*` — загальні налаштування першого входу. */
  projectId: string;
  roles: { roleId: string; specialization: string | null }[];
  workspace: string | null;
  aiProfile: string | null;
  aiAssistance: string[];
  roleDetails: Record<string, string[]>;
  updatedAt: string;
}

export const ONBOARDING_EVENTS = ['onboarding_started', 'onboarding_step_completed', 'role_selected', 'role_changed', 'onboarding_completed', 'onboarding_abandoned', 'access_requested', 'access_approved', 'access_rejected', 'studio_entered'] as const;
export type OnboardingEventName = (typeof ONBOARDING_EVENTS)[number];

export interface OnboardingEventRow {
  id: string;
  userId: string;
  sessionId: string | null;
  projectId: string | null;
  event: OnboardingEventName;
  details: Record<string, unknown>;
  createdAt: string;
}

// ── Процеси ШІ й розкладка канви (Т5.2 В2) ──────────────────────────────────

export const WORKFLOW_ENVIRONMENTS = ['draft', 'test', 'production', 'archived'] as const;
export type WorkflowEnvironment = (typeof WORKFLOW_ENVIRONMENTS)[number];
export const WORKFLOW_EVENT_ACTIONS = ['create', 'create_draft', 'edit', 'validate', 'to_test', 'publish', 'rollback', 'archive', 'discard', 'rename'] as const;
export type WorkflowEventAction = (typeof WORKFLOW_EVENT_ACTIONS)[number];

export interface WorkflowRow {
  id: string;
  name: { en: string; uk: string };
  description: string;
  status: 'active' | 'archived';
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersionRow {
  id: string;
  workflowId: string;
  version: number;
  environment: WorkflowEnvironment;
  basedOn: string | null;
  /** У переліку версій — null (визначення лише в однієї версії). */
  definition: Record<string, unknown> | null;
  definitionHash: string;
  validation: Record<string, unknown> | null;
  notes: string;
  revision: number;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
  testedBy: CoreActor | null;
  testedAt: string | null;
  publishedBy: CoreActor | null;
  publishedAt: string | null;
}

export interface WorkflowVersionInput {
  workflowId: string;
  definition: Record<string, unknown>;
  definitionHash: string;
  basedOn?: string | null;
  notes?: string;
  createdBy: CoreActor;
  /** `test` — лише для відкату (копія опублікованої версії, одразу замороженої); стара тестова йде в архів. */
  environment?: 'draft' | 'test';
}

export interface WorkflowEventRow {
  id: string;
  workflowId: string;
  versionId: string | null;
  action: WorkflowEventAction;
  actor: CoreActor;
  details: Record<string, unknown>;
  createdAt: string;
}

// ── Виконання процесів ШІ (Т5.4 В1) ──────────────────────────────────────────

export const WORKFLOW_RUN_STATUSES = ['running', 'paused', 'succeeded', 'failed', 'cancelled'] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
export const WORKFLOW_RUN_MODES = ['normal', 'replay', 'fork'] as const;
export type WorkflowRunMode = (typeof WORKFLOW_RUN_MODES)[number];

export interface WorkflowRunRow {
  id: string;
  workflowId: string;
  versionId: string;
  version: number;
  definitionHash: string;
  projectId: string | null;
  status: WorkflowRunStatus;
  mode: WorkflowRunMode;
  parentRunId: string | null;
  forkStep: number | null;
  /** `job:<kind>`, `interview`, `manual`, `replay`, `fork`. */
  trigger: string;
  jobId: string | null;
  input: Record<string, unknown>;
  inputHash: string;
  output: Record<string, unknown> | null;
  currentNode: string | null;
  pauseRequested: boolean;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  startedBy: CoreActor;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export type WorkflowRunInput = Pick<WorkflowRunRow, 'workflowId' | 'versionId' | 'version' | 'definitionHash' | 'trigger' | 'input' | 'inputHash' | 'startedBy'> &
  Partial<Pick<WorkflowRunRow, 'projectId' | 'mode' | 'parentRunId' | 'forkStep' | 'jobId'>>;

export interface WorkflowRunPatch {
  status?: WorkflowRunStatus;
  output?: Record<string, unknown> | null;
  currentNode?: string | null;
  pauseRequested?: boolean;
  error?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs?: number;
}

export interface WorkflowStepRow {
  id: string;
  runId: string;
  seq: number;
  nodeId: string;
  nodeType: string;
  status: 'succeeded' | 'failed' | 'paused';
  retryCount: number;
  branch: string | null;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  decision: string | null;
  confidence: number | null;
  validationResult: string | null;
  humanResult: string | null;
  error: string | null;
  warnings: string[];
  details: Record<string, unknown>;
}

export type WorkflowStepInput = Omit<WorkflowStepRow, 'id' | 'seq'>;

export interface GraphLayoutRow {
  graphKind: 'workflow' | 'ontology';
  graphId: string;
  versionRef: string;
  layout: Record<string, { x: number; y: number }>;
  updatedBy: CoreActor;
  updatedAt: string;
}

// ── Пропозиції до канону (Т5.3 В1; ТЗ Graph Studio §24–25) ───────────────────

export const PROPOSAL_STATES = ['detected', 'proposed', 'validated', 'approved', 'canon', 'rejected', 'superseded'] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];
/** Відкриті — ще чекають рішення; решта кінцеві. */
export const OPEN_PROPOSAL_STATES: readonly ProposalState[] = ['detected', 'proposed', 'validated', 'approved'];
export type ProposalKind = 'entity' | 'relation';
export const PROPOSAL_EVENT_ACTIONS = ['create', 'edit', 'propose', 'validate', 'approve', 'reject', 'write_canon', 'supersede'] as const;
export type ProposalEventAction = (typeof PROPOSAL_EVENT_ACTIONS)[number];

export interface EntityProposalPayload {
  type: string;
  name: string;
  canonical: Record<string, unknown>;
  /** Уточнення наявної сутності (правка назви чи полів), а не нова сутність. */
  targetId?: string | null;
}
export interface RelationProposalPayload {
  type: string;
  fromId: string;
  toId: string;
  note: string;
}

/** Походження §25: хто й чим запропонував. */
export interface ProposalProvenance {
  /** `author` — вручну; `ai` — роль AI поза процесом; `workflow` — вузол процесу ШІ (Т5.4). */
  source?: 'author' | 'ai' | 'workflow' | 'import';
  workflowId?: string;
  workflowVersion?: number;
  nodeId?: string;
  ontologyVersion?: number;
  model?: string;
  promptVersion?: string;
  runId?: string;
  jevDecisions?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface ProposalIssue {
  code: string;
  message: string;
  field?: string;
}

export interface ProposalValidation {
  ok: boolean;
  errors: ProposalIssue[];
  warnings: ProposalIssue[];
  ontologyVersion: number | null;
  at: string;
}

export interface StoryProposalRow {
  id: string;
  projectId: string;
  kind: ProposalKind;
  state: ProposalState;
  payload: EntityProposalPayload | RelationProposalPayload;
  dedupeKey: string;
  evidence: string[];
  confidence: number | null;
  provenance: ProposalProvenance;
  validation: ProposalValidation | null;
  authorEdit: { before: Record<string, unknown>; after: Record<string, unknown>; fields: string[] } | null;
  canonRef: string | null;
  supersededBy: string | null;
  revision: number;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
  decidedBy: CoreActor | null;
  decidedAt: string | null;
  reason: string;
}

export interface StoryProposalInput {
  projectId: string;
  kind: ProposalKind;
  payload: EntityProposalPayload | RelationProposalPayload;
  dedupeKey: string;
  /** Типово — `proposed`. */
  state?: 'detected' | 'proposed';
  evidence?: string[];
  confidence?: number | null;
  provenance?: ProposalProvenance;
  createdBy: CoreActor;
}

export type StoryProposalPatch = Partial<Pick<StoryProposalRow, 'state' | 'payload' | 'dedupeKey' | 'evidence' | 'validation' | 'authorEdit' | 'canonRef' | 'supersededBy' | 'reason'>>;

export interface StoryProposalEventRow {
  id: string;
  projectId: string;
  proposalId: string;
  action: ProposalEventAction;
  actor: CoreActor;
  fromState: ProposalState | null;
  toState: ProposalState | null;
  details: Record<string, unknown>;
  createdAt: string;
}

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
  /**
   * Т5.3 В2: книги в ядрі (за назвою). Без фільтра — усі; `ownerId` і/або
   * `participantUserId` — власні АБО ті, де людина — активний учасник.
   */
  listProjects(filter?: { ownerId?: string; participantUserId?: string; limit?: number }): Promise<ProjectRow[]>;
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

  /** Емоційний монітор (Т2.2): точки героїв поза тегами. Той самий герой, абзац і емоція — заміна. */
  listEmotionPoints(projectId: string, characterId?: string): Promise<EmotionPointRow[]>;
  upsertEmotionPoint(input: EmotionPointInput): Promise<EmotionPointRow>;
  deleteEmotionPoint(projectId: string, id: string): Promise<boolean>;

  /**
   * Бібліотека ілюстрацій (Т2.3 В2): зв'язки зображень із сутностями й
   * сценами. Той самий URL, ціль і роль — оновлення (статус, джерело, примітка).
   */
  listAssetLinks(projectId: string, filter?: { entityId?: string; sectionId?: string; assetUrl?: string; source?: AssetLinkRow['source'] }): Promise<AssetLinkRow[]>;
  upsertAssetLink(input: AssetLinkInput): Promise<AssetLinkRow>;
  getAssetLink(projectId: string, id: string): Promise<AssetLinkRow | null>;
  setAssetLinkStatus(projectId: string, id: string, status: CoreStatus): Promise<AssetLinkRow>;
  deleteAssetLink(projectId: string, id: string): Promise<boolean>;
  /**
   * «Перевірити» (Т2.3 В5): позначка й відбиток опису, з яким зображення
   * звірено. Відбиток у `upsertAssetLink` теж означає «звірено» — позначка знімається.
   */
  setAssetLinkReview(projectId: string, id: string, review: { needsReview: boolean; checkedHash?: string | null }): Promise<AssetLinkRow>;

  /**
   * Версії зовнішності (Т2.3 В3). Кожна зміна пише рядок історії; видалення
   * версії лишає її портрети загальними портретами героя.
   */
  listAppearanceVersions(projectId: string, entityId?: string): Promise<AppearanceVersionRow[]>;
  getAppearanceVersion(projectId: string, id: string): Promise<AppearanceVersionRow | null>;
  upsertAppearanceVersion(input: AppearanceVersionInput): Promise<AppearanceVersionRow>;
  deleteAppearanceVersion(projectId: string, id: string, actor: CoreActor): Promise<boolean>;
  addAppearanceHistory(input: Omit<AppearanceHistoryRow, 'id' | 'at'>): Promise<void>;
  listAppearanceHistory(projectId: string, entityId: string, limit?: number): Promise<AppearanceHistoryRow[]>;

  /** Риси сутностей (Т2.4 В1): матеріал для правила `trait_contradiction` (В3). */
  listEntityTraits(projectId: string, entityId?: string): Promise<EntityTraitRow[]>;
  upsertEntityTrait(input: EntityTraitInput): Promise<EntityTraitRow>;
  setEntityTraitStatus(projectId: string, id: string, status: CoreStatus, actor: CoreActor): Promise<EntityTraitRow>;
  deleteEntityTrait(projectId: string, id: string): Promise<boolean>;

  /** Проблеми безперервності (Т2.4 В1): сторінка 8. */
  listContinuityIssues(projectId: string, filter?: { kind?: ContinuityIssueKind; status?: ContinuityIssueStatus; entityId?: string }): Promise<ContinuityIssueRow[]>;
  getContinuityIssue(projectId: string, id: string): Promise<ContinuityIssueRow | null>;
  upsertContinuityIssue(input: ContinuityIssueInput): Promise<ContinuityIssueRow>;
  /** Автор змінює статус (стає новим `createdBy` — «хто востаннє вирішив», за зразком CHECK у базі). */
  setContinuityIssueStatus(projectId: string, id: string, status: ContinuityIssueStatus, actor: CoreActor): Promise<ContinuityIssueRow>;
  deleteContinuityIssue(projectId: string, id: string): Promise<boolean>;

  /** Перевірки чернеток (Т2.4 В7): лише додати й прочитати — історія, не редагується. */
  addContinuityDraftCheck(input: ContinuityDraftCheckInput): Promise<ContinuityDraftCheckRow>;
  /** Новіші першими; фільтр за героєм і симуляцією. */
  listContinuityDraftChecks(projectId: string, filter?: { characterId?: string; simulationId?: string; limit?: number }): Promise<ContinuityDraftCheckRow[]>;
  getContinuityDraftCheck(projectId: string, id: string): Promise<ContinuityDraftCheckRow | null>;

  /** Журнал рішень героя (Т2.5 В2): додати, знайти, перелік (новіші першими), змінити статус. */
  addCharacterDecision(input: CharacterDecisionInput): Promise<CharacterDecisionRow>;
  getCharacterDecision(projectId: string, id: string): Promise<CharacterDecisionRow | null>;
  listCharacterDecisions(projectId: string, filter?: CharacterDecisionFilter): Promise<CharacterDecisionRow[]>;
  /** Позначити чинні рішення рівня героя заміненими (крім `exceptId`); повертає кількість. */
  supersedeCharacterDecisions(projectId: string, filter: { characterId: string; level: CharacterDecisionLevel; sceneId?: string | null; exceptId?: string }): Promise<number>;
  /** Рішення автора (В4): чекало автора → чинне, з дією автора, джерелом `author` і хто / коли. */
  resolveCharacterDecision(projectId: string, id: string, input: { selectedAction: string; result: Record<string, unknown>; actor: CoreActor }): Promise<CharacterDecisionRow>;

  /**
   * Пам'ять героя (Т2.6 В1): додати, знайти, перелік (новіші першими),
   * рішення автора щодо статусу (підтвердити / відхилити / «перевірити» /
   * замінено). AI лише пропонує — підтверджує людина.
   */
  addCharacterMemory(input: CharacterMemoryInput): Promise<CharacterMemoryRow>;
  getCharacterMemory(projectId: string, id: string): Promise<CharacterMemoryRow | null>;
  listCharacterMemories(projectId: string, filter?: CharacterMemoryFilter): Promise<CharacterMemoryRow[]>;
  setCharacterMemoryStatus(projectId: string, id: string, status: CharacterMemoryStatus, actor: CoreActor, note?: string | null): Promise<CharacterMemoryRow>;
  /** Змінити поля спогаду (не вид, не шар, не прогін / канон, не джерело); замінений — conflict. */
  updateCharacterMemory(projectId: string, id: string, patch: CharacterMemoryPatch, actor: CoreActor): Promise<CharacterMemoryRow>;
  /** Стан героя на сцену (кеш будівника знімка, В5): додати й узяти найновіший за героєм, сценою, прогоном і ревізією. */
  addCharacterState(input: CharacterStateInput): Promise<CharacterStateRow>;
  getCharacterState(projectId: string, key: { characterId: string; sceneId: string | null; simulationId: string | null; canonRevision: number }): Promise<CharacterStateRow | null>;

  /** Т2.7 В1: «AI-персонаж» героя — один запис на героя (увімкнено ⇔ рівень не off). */
  getCharacterAgent(projectId: string, characterId: string): Promise<CharacterAgentRow | null>;
  upsertCharacterAgent(input: CharacterAgentInput): Promise<CharacterAgentRow>;
  listCharacterAgents(projectId: string): Promise<CharacterAgentRow[]>;
  /** Дослідницькі прогони (допит, далі — сцена): новіші першими. */
  addSimulation(input: SimulationInput): Promise<SimulationRow>;
  getSimulation(projectId: string, id: string): Promise<SimulationRow | null>;
  listSimulations(projectId: string, filter?: { characterId?: string; kind?: SimulationKind; status?: SimulationStatus; limit?: number }): Promise<SimulationRow[]>;
  updateSimulation(projectId: string, id: string, patch: SimulationPatch): Promise<SimulationRow>;
  /** Ходи прогону — лише дописуються; у порядку ходу й часу. */
  addSimulationEvent(input: SimulationEventInput): Promise<SimulationEventRow>;
  listSimulationEvents(projectId: string, simulationId: string): Promise<SimulationEventRow[]>;
  /** Пропозиції в канон: додати, знайти, перелік, рішення автора (лише з pending). */
  addCanonProposal(input: CanonProposalInput): Promise<CanonProposalRow>;
  getCanonProposal(projectId: string, id: string): Promise<CanonProposalRow | null>;
  listCanonProposals(projectId: string, filter?: { simulationId?: string; characterId?: string; status?: CanonProposalStatus; kind?: CanonProposalKind; limit?: number }): Promise<CanonProposalRow[]>;
  resolveCanonProposal(projectId: string, id: string, input: { status: 'accepted' | 'rejected'; actor: CoreActor; result?: Record<string, unknown> }): Promise<CanonProposalRow>;

  /** Т2.8 В3: прогони набору якості (рівень платформи), новіші першими; час старту й завершення ставить сховище за статусом. */
  addQualityRun(input: QualityRunInput): Promise<QualityRunRow>;
  getQualityRun(id: string): Promise<QualityRunRow | null>;
  listQualityRuns(filter?: { setId?: string; limit?: number }): Promise<QualityRunRow[]>;
  updateQualityRun(id: string, patch: QualityRunPatch): Promise<QualityRunRow>;

  /**
   * Т5.1 В2: версії онтології (реєстр схем) — рівень платформи. Номер версії
   * ставить сховище (наступний у межах онтології); опубліковане визначення
   * не змінюється; `updateOntologyVersion` з `expectedRevision` — лише якщо
   * чернетку ніхто не змінив; `activateOntologyVersion` — одна транзакція:
   * попередня активна стає `deprecated`, ця — `active`.
   */
  addOntologyVersion(input: OntologyVersionInput): Promise<OntologyVersionRow>;
  getOntologyVersion(id: string): Promise<OntologyVersionRow | null>;
  getActiveOntologyVersion(ontologyId: string): Promise<OntologyVersionRow | null>;
  listOntologyVersions(ontologyId: string, filter?: { limit?: number }): Promise<OntologyVersionRow[]>;
  updateOntologyVersion(id: string, patch: OntologyVersionPatch, expectedRevision?: number): Promise<OntologyVersionRow>;
  activateOntologyVersion(id: string, actor: CoreActor): Promise<OntologyVersionRow>;
  addOntologyEvent(input: { ontologyId: string; versionId?: string | null; action: OntologyEventAction; actor: CoreActor; details?: Record<string, unknown> }): Promise<OntologyEventRow>;
  listOntologyEvents(ontologyId: string, filter?: { versionId?: string; limit?: number }): Promise<OntologyEventRow[]>;
  /** Використання типів сутностей і зв'язків у всіх книгах. */
  ontologyUsage(): Promise<OntologyUsage>;

  /**
   * Т6.1 В2: учасники проєкту й їхні ролі. `upsertParticipant` — ідемпотентно
   * (є — повертає наявного); правила ролей (реєстр, один власник, фрілансер зі
   * спеціалізацією) перевіряє сервіс участі, сховище — формат і унікальність.
   */
  upsertParticipant(input: { projectId: string; userId: string; source: ParticipantSource; sourceRef?: string | null; createdBy: CoreActor }): Promise<{ participant: ParticipantRow; created: boolean }>;
  getParticipant(projectId: string, userId: string): Promise<ParticipantRow | null>;
  getParticipantById(id: string): Promise<ParticipantRow | null>;
  listParticipants(projectId: string): Promise<ParticipantRow[]>;
  setParticipantStatus(id: string, status: ParticipantStatus): Promise<ParticipantRow>;
  addParticipantRole(input: { participantId: string; projectId: string; roleId: string; specialization?: string | null; assignedBy: CoreActor; registryVersion?: number | null }): Promise<ParticipantRoleRow>;
  revokeParticipantRole(id: string, actor: CoreActor): Promise<ParticipantRoleRow>;
  getParticipantRole(id: string): Promise<ParticipantRoleRow | null>;
  listParticipantRoles(filter: { projectId?: string; participantId?: string; roleId?: string; status?: 'active' | 'revoked' }): Promise<ParticipantRoleRow[]>;
  /** Скільки активних призначень кожної ролі в усіх проєктах — для впливу зміни реєстру ролей. */
  countActiveRoleAssignments(): Promise<Record<string, number>>;
  addCollabEvent(input: { projectId: string; participantId?: string | null; action: CollabEventAction; actor: CoreActor; details?: Record<string, unknown> }): Promise<CollabEventRow>;
  listCollabEvents(projectId: string, filter?: { limit?: number }): Promise<CollabEventRow[]>;
  /** Рядки старої таблиці `project_members` (для перенесення в учасників). */
  listMembers(projectId: string): Promise<{ userId: string; role: MemberRole }[]>;

  /** Т6.2 В1: наданий доступ. Перелік — у порядку створення; без `status` — усі записи (зокрема відкликані). */
  addAccessGrant(input: AccessGrantInput): Promise<AccessGrantRow>;
  getAccessGrant(id: string): Promise<AccessGrantRow | null>;
  listAccessGrants(filter: { projectId?: string; participantId?: string; status?: 'active' | 'revoked' }): Promise<AccessGrantRow[]>;
  revokeAccessGrant(id: string, actor: CoreActor): Promise<AccessGrantRow>;
  /**
   * Т5.2 В2: процеси ШІ. `addWorkflowVersion` — нова чернетка (одна на
   * процес); `updateWorkflowDraft` — лише чернетка, з `expectedRevision`;
   * `transitionWorkflowVersion` — одна транзакція: `test` (заморозити, стара
   * тестова — в архів), `production` (стара робоча — в архів), `archived`.
   */
  addWorkflow(input: { id: string; name: { en: string; uk: string }; description?: string; createdBy: CoreActor }): Promise<WorkflowRow>;
  getWorkflow(id: string): Promise<WorkflowRow | null>;
  listWorkflows(): Promise<WorkflowRow[]>;
  updateWorkflow(id: string, patch: { name?: { en: string; uk: string }; description?: string; status?: 'active' | 'archived' }): Promise<WorkflowRow>;
  addWorkflowVersion(input: WorkflowVersionInput): Promise<WorkflowVersionRow>;
  getWorkflowVersion(id: string): Promise<WorkflowVersionRow | null>;
  listWorkflowVersions(workflowId: string, filter?: { limit?: number }): Promise<WorkflowVersionRow[]>;
  updateWorkflowDraft(id: string, patch: { definition?: Record<string, unknown>; definitionHash?: string; validation?: Record<string, unknown> | null; notes?: string }, expectedRevision?: number): Promise<WorkflowVersionRow>;
  transitionWorkflowVersion(id: string, to: 'test' | 'production' | 'archived', actor: CoreActor): Promise<WorkflowVersionRow>;
  addWorkflowEvent(input: { workflowId: string; versionId?: string | null; action: WorkflowEventAction; actor: CoreActor; details?: Record<string, unknown> }): Promise<WorkflowEventRow>;
  listWorkflowEvents(filter: { workflowId?: string; limit?: number }): Promise<WorkflowEventRow[]>;
  /**
   * Т5.4 В1: запуски процесів ШІ, кроки (трасування §27) і контрольні точки
   * LangGraph (§31). `addWorkflowStep` сам дає наступний номер кроку.
   */
  addWorkflowRun(input: WorkflowRunInput): Promise<WorkflowRunRow>;
  getWorkflowRun(id: string): Promise<WorkflowRunRow | null>;
  listWorkflowRuns(filter: { workflowId?: string; projectId?: string; status?: WorkflowRunStatus; limit?: number }): Promise<WorkflowRunRow[]>;
  updateWorkflowRun(id: string, patch: WorkflowRunPatch): Promise<WorkflowRunRow>;
  addWorkflowStep(input: WorkflowStepInput): Promise<WorkflowStepRow>;
  listWorkflowSteps(runId: string): Promise<WorkflowStepRow[]>;
  saveWorkflowCheckpoint(runId: string, data: Record<string, unknown>): Promise<void>;
  getWorkflowCheckpoint(runId: string): Promise<Record<string, unknown> | null>;
  getGraphLayout(kind: 'workflow' | 'ontology', graphId: string, versionRef: string): Promise<GraphLayoutRow | null>;
  saveGraphLayout(input: { graphKind: 'workflow' | 'ontology'; graphId: string; versionRef: string; layout: Record<string, { x: number; y: number }>; updatedBy: CoreActor }): Promise<GraphLayoutRow>;

  /**
   * Т5.3 В1: пропозиції до канону (§24). `updateStoryProposal` перевіряє
   * перехід стану (`checkProposalPatch`) і, з `expectedRevision`, що
   * пропозицію ніхто не змінив; кінцеві стани незмінні.
   */
  addStoryProposal(input: StoryProposalInput): Promise<StoryProposalRow>;
  getStoryProposal(projectId: string, id: string): Promise<StoryProposalRow | null>;
  listStoryProposals(projectId: string, filter?: { states?: ProposalState[]; kind?: ProposalKind; dedupeKey?: string; limit?: number }): Promise<StoryProposalRow[]>;
  updateStoryProposal(projectId: string, id: string, patch: StoryProposalPatch, actor: CoreActor, expectedRevision?: number): Promise<StoryProposalRow>;
  addStoryProposalEvent(input: { projectId: string; proposalId: string; action: ProposalEventAction; actor: CoreActor; fromState?: ProposalState | null; toState?: ProposalState | null; details?: Record<string, unknown> }): Promise<StoryProposalEventRow>;
  listStoryProposalEvents(projectId: string, filter?: { proposalId?: string; limit?: number }): Promise<StoryProposalEventRow[]>;
  /**
   * Т6.3 В1: опитувальник ролі. Одна чернетка на людину й проєкт;
   * `updateOnboardingSession` — лише чернетку, з `expectedRevision`.
   */
  addOnboardingSession(input: OnboardingSessionInput): Promise<OnboardingSessionRow>;
  getOnboardingSession(id: string): Promise<OnboardingSessionRow | null>;
  findOnboardingDraft(userId: string, projectId: string | null): Promise<OnboardingSessionRow | null>;
  listOnboardingSessions(filter: { userId?: string; projectId?: string; status?: OnboardingStatus; limit?: number }): Promise<OnboardingSessionRow[]>;
  updateOnboardingSession(id: string, patch: OnboardingSessionPatch, expectedRevision?: number): Promise<OnboardingSessionRow>;
  /** Запит доступу: один нерозглянутий на людину й проєкт; рішення — лише з `pending`. */
  addAccessRequest(input: AccessRequestInput): Promise<AccessRequestRow>;
  getAccessRequest(id: string): Promise<AccessRequestRow | null>;
  listAccessRequests(filter: { projectId?: string; userId?: string; status?: AccessRequestStatus; kind?: AccessRequestKind; limit?: number }): Promise<AccessRequestRow[]>;
  decideAccessRequest(id: string, decision: AccessRequestDecision): Promise<AccessRequestRow>;
  getParticipantPreference(userId: string, projectId: string): Promise<ParticipantPreferenceRow | null>;
  saveParticipantPreference(input: Omit<ParticipantPreferenceRow, 'updatedAt'>): Promise<ParticipantPreferenceRow>;
  addOnboardingEvent(input: { userId: string; sessionId?: string | null; projectId?: string | null; event: OnboardingEventName; details?: Record<string, unknown> }): Promise<OnboardingEventRow>;
  listOnboardingEvents(filter: { userId?: string; event?: OnboardingEventName; sessionId?: string; limit?: number }): Promise<OnboardingEventRow[]>;
  /** Одна транзакція: стара відкрита пропозиція → `superseded`, нова (з тим самим чи іншим ключем) — на її місце. */
  supersedeStoryProposal(projectId: string, oldId: string, input: StoryProposalInput, actor: CoreActor): Promise<{ old: StoryProposalRow; created: StoryProposalRow }>;

  /** Збережені запити автора в книзі (Т1.3), новіші першими. */
  listSavedSearches(projectId: string, userId: string): Promise<SavedSearchRow[]>;
  addSavedSearch(input: { projectId: string; userId: string; name: string; params: Record<string, unknown> }): Promise<SavedSearchRow>;
  /** Видаляє лише свій запит; false — такого немає (або він чужий). */
  deleteSavedSearch(projectId: string, userId: string, id: string): Promise<boolean>;

  addNotification(input: NotificationInput): Promise<NotificationRow>;
  listNotifications(projectId: string, limit?: number): Promise<NotificationRow[]>;

  close(): Promise<void>;
}
