/**
 * Правила ядра, спільні для обох сховищ (PostgreSQL і пам'ять).
 *
 * База тримає останній рубіж (CHECK на докази AI, складені ключі за
 * проєктом), але людські повідомлення й правила, які CHECK не виразить
 * (хто може змінювати статус, що AI не переписує затверджене), — тут, в
 * одному місці. Сховище викликає ці перевірки ДО запису.
 */

import { CORE_ENTITIES, CORE_ENTITY_RELATIONS } from '../../src/utils/coreEntities';
import { blockHash } from '../../src/utils/paragraphIds';
import {
  AI_ROLES,
  CORE_STATUSES,
  MEMBER_ROLES,
  PARAGRAPH_KINDS,
  VISIBILITIES,
  type CoreActor,
  type CoreStatus,
  type EntityInput,
  type EntityRow,
  type FindingInput,
  type MemberRole,
  type MentionInput,
  type ParagraphInput,
  type RelationInput,
  type RunCreateInput,
  type TimePointInput,
  type EmotionPointInput,
  type AssetLinkInput,
  type AppearanceVersionInput,
  ASSET_ROLES,
  type EntityTraitInput,
  type ContinuityIssueInput,
  type ContinuityIssueStatus,
  type ContinuityDraftCheckInput,
  type CharacterDecisionInput,
  CHARACTER_DECISION_LEVELS,
  CHARACTER_DECISION_SOURCES,
  CHARACTER_DECISION_STATUSES,
  CONTINUITY_ISSUE_KINDS,
  CONTINUITY_ISSUE_STATUSES,
  type CharacterMemoryInput,
  type CharacterMemoryPatch,
  type CharacterMemoryRow,
  type CharacterMemoryStatus,
  type CharacterMemoryLayer,
  type BeliefStatus,
  type MemoryTruth,
  type Visibility,
  CHARACTER_MEMORY_TYPES,
  CHARACTER_MEMORY_LAYERS,
  CHARACTER_MEMORY_STATUSES,
  BELIEF_STATUSES,
  MEMORY_TRUTHS,
  MEMORY_SOURCE_KINDS,
  MEMORY_ORIGINS,
  type CharacterAgentInput,
  type SimulationInput,
  type SimulationPatch,
  type SimulationEventInput,
  type CanonProposalInput,
  AUTONOMY_LEVELS,
  SIMULATION_KINDS,
  SIMULATION_STATUSES,
  SIMULATION_EVENT_TYPES,
  SIMULATION_ACTORS,
  CANON_PROPOSAL_KINDS,
} from './types';

export type CoreRuleCode =
  | 'bad_actor'
  | 'bad_input'
  | 'unknown_entity_type'
  | 'unknown_relation_type'
  | 'evidence_required'
  | 'ai_suggests_only'
  | 'confirmed_is_author_only'
  | 'not_found'
  | 'duplicate_alias'
  /** Стан уже не той, для якого дія (напр. рішення героя вже прийнято, Т2.5). */
  | 'conflict';

/** Порушення правила ядра. Маршрути віддають його як 422 (або 404 для `not_found`). */
export class CoreRuleError extends Error {
  constructor(readonly code: CoreRuleCode, message: string) {
    super(message);
    this.name = 'CoreRuleError';
  }
}

const ACTOR_RE = /^(user|ai|system):.+/;
const ENTITY_TYPES = new Set(CORE_ENTITIES.map((e) => e.slug));
const RELATION_TYPES = new Set(CORE_ENTITY_RELATIONS.map((r) => r.key));

export function assertActor(actor: CoreActor): void {
  if (typeof actor !== 'string' || !ACTOR_RE.test(actor)) {
    throw new CoreRuleError('bad_actor', `Автор запису має бути «user:…», «ai:…» або «system:…», а не «${actor}»`);
  }
}

export function isAiActor(actor: CoreActor): boolean {
  return typeof actor === 'string' && actor.startsWith('ai:');
}

function assertStatus(status: CoreStatus): void {
  if (!CORE_STATUSES.includes(status)) throw new CoreRuleError('bad_input', `Невідомий статус «${status}»`);
}

function assertNonEmpty(value: unknown, what: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new CoreRuleError('bad_input', `${what} не може бути порожнім`);
}

/** Хеш тексту абзацу — той самий, що в редакторі (Т0.5), щоб сервер і клієнт зіставляли однаково. */
export function paragraphTextHash(text: string): string {
  return blockHash(text);
}

export function normalizeAlias(alias: string): string {
  return String(alias ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');
}

export function checkMemberRole(role: MemberRole): void {
  if (!MEMBER_ROLES.includes(role)) throw new CoreRuleError('bad_input', `Невідома роль учасника «${role}»`);
}

export function checkParagraph(input: ParagraphInput, actor: CoreActor): void {
  assertActor(actor);
  assertNonEmpty(input.id, 'id абзацу');
  assertNonEmpty(input.documentId, 'id документа');
  if (!PARAGRAPH_KINDS.includes(input.kind)) throw new CoreRuleError('bad_input', `Невідомий вид блоку «${input.kind}»`);
  if (typeof input.text !== 'string') throw new CoreRuleError('bad_input', 'Текст абзацу має бути рядком');
  if (!Number.isInteger(input.order)) throw new CoreRuleError('bad_input', 'Порядок абзацу має бути цілим числом');
}

/**
 * Статус нової сутності. AI лише пропонує (`suggested`); автор і системна
 * синхронізація тегів (тег поставив автор) — типово `confirmed`.
 */
export function checkNewEntity(input: EntityInput): CoreStatus {
  assertActor(input.createdBy);
  assertNonEmpty(input.name, 'Назва сутності');
  if (!ENTITY_TYPES.has(input.type)) {
    throw new CoreRuleError('unknown_entity_type', `Тип сутності «${input.type}» відсутній у реєстрі ядра`);
  }
  const ai = isAiActor(input.createdBy);
  const status = input.status ?? (ai ? 'suggested' : 'confirmed');
  assertStatus(status);
  if (ai && status !== 'suggested') {
    throw new CoreRuleError('ai_suggests_only', 'AI може лише запропонувати сутність (suggested); затверджує автор');
  }
  return status;
}

/** Затверджене не перезаписується: зміни затвердженої сутності — лише від людини. */
export function checkEntityUpdate(entity: EntityRow, actor: CoreActor): void {
  assertActor(actor);
  if (isAiActor(actor) && entity.status === 'confirmed') {
    throw new CoreRuleError(
      'confirmed_is_author_only',
      'Затверджену сутність AI не змінює — він може лише запропонувати зміну окремим висновком',
    );
  }
}

/** Затвердити чи відхилити може лише людина (або системна дія від її імені). */
export function checkStatusChange(status: CoreStatus, actor: CoreActor): void {
  assertActor(actor);
  assertStatus(status);
  if (isAiActor(actor)) {
    throw new CoreRuleError('ai_suggests_only', 'Статус змінює автор, а не AI');
  }
}

export function checkNewRelation(input: RelationInput): CoreStatus {
  assertActor(input.createdBy);
  if (!RELATION_TYPES.has(input.type)) {
    throw new CoreRuleError('unknown_relation_type', `Тип зв'язку «${input.type}» відсутній у реєстрі ядра`);
  }
  assertNonEmpty(input.fromId, 'Початок зв\'язку');
  assertNonEmpty(input.toId, 'Кінець зв\'язку');
  const ai = isAiActor(input.createdBy);
  const status = input.status ?? (ai ? 'suggested' : 'confirmed');
  assertStatus(status);
  if (ai && status !== 'suggested') {
    throw new CoreRuleError('ai_suggests_only', 'AI може лише запропонувати зв\'язок (suggested)');
  }
  if (ai && !(input.evidence ?? []).length) {
    throw new CoreRuleError('evidence_required', 'Зв\'язок від AI має посилатися хоча б на один абзац');
  }
  return status;
}

/** Точка часу (Т2.1): ті самі правила, що й CHECK у базі — щоб пам'ять і PostgreSQL не розійшлися. */
export function checkTimePoint(p: TimePointInput): void {
  assertActor(p.createdBy);
  if (p.subjectKind !== 'scene' && p.subjectKind !== 'event') throw new CoreRuleError('bad_input', 'Час задається сцені або події');
  if (!p.subjectId) throw new CoreRuleError('bad_input', 'Не вказано сцену чи подію');
  if (!['exact', 'approximate', 'interval', 'unknown'].includes(p.kind)) throw new CoreRuleError('bad_input', 'Невідомий вид часу');
  if (p.kind !== 'unknown' && (p.sortKey == null || !Number.isFinite(p.sortKey))) throw new CoreRuleError('bad_input', 'Точці часу потрібне значення');
  if (p.kind === 'interval' && (p.endKey == null || p.endKey < (p.sortKey ?? 0))) throw new CoreRuleError('bad_input', 'Кінець інтервалу раніше за початок');
}

/** Емоційна точка (Т2.2): ті самі правила, що й CHECK у базі. */
export function checkEmotionPoint(p: EmotionPointInput): void {
  assertActor(p.createdBy);
  if (!p.characterId) throw new CoreRuleError('bad_input', 'Не вказано героя');
  if (!p.paragraphId) throw new CoreRuleError('bad_input', 'Емоційній точці потрібен абзац-доказ');
  const e = String(p.emotion ?? '').trim();
  if (!e || e.length > 80) throw new CoreRuleError('bad_input', 'Назва емоції — від 1 до 80 знаків');
  if (!/^[a-z]{2,20}$/.test(p.family)) throw new CoreRuleError('bad_input', `Невідома родина емоції «${p.family}»`);
  const score = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10;
  if (!score(p.intensity)) throw new CoreRuleError('bad_input', 'Інтенсивність — ціле число від 0 до 10');
  if (p.craft != null && !score(p.craft)) throw new CoreRuleError('bad_input', 'Майстерність передачі — ціле число від 0 до 10');
  if (p.impact != null && !score(p.impact)) throw new CoreRuleError('bad_input', 'Вплив на сюжет — ціле число від 0 до 10');
  if (p.layer && !['primary', 'secondary', 'hidden'].includes(p.layer)) throw new CoreRuleError('bad_input', `Невідомий шар емоції «${p.layer}»`);
  if (p.source && p.source !== 'author' && p.source !== 'ai') throw new CoreRuleError('bad_input', `Невідоме джерело точки «${p.source}»`);
  if (p.status) assertStatus(p.status);
}

/** URL зображення, яке можна прив'язати: свій файл Медіатеки, http(s) чи шлях сайту; `data:` — ні (Т2.3 В2). */
export function isLinkableAssetUrl(url: unknown): url is string {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s || s.length > 2000 || /^data:/i.test(s)) return false;
  return /^\/api\/media\/file\/[A-Za-z0-9_-]+([?#].*)?$/.test(s) || /^https?:\/\/\S+$/i.test(s) || /^\/[A-Za-z0-9_\-./]+$/.test(s);
}

/** Зв'язок зображення (Т2.3 В2): ті самі правила, що й CHECK у базі. */
export function checkAssetLink(l: AssetLinkInput): void {
  assertActor(l.createdBy);
  if (!isLinkableAssetUrl(l.assetUrl)) throw new CoreRuleError('bad_input', 'Це зображення не можна прив\'язати: потрібен файл Медіатеки або посилання http(s), не вбудований data:-URL');
  if (!ASSET_ROLES.includes(l.role)) throw new CoreRuleError('bad_input', `Невідома роль зображення «${l.role}»`);
  const hasEntity = !!l.entityId;
  const hasSection = !!l.sectionId;
  if (hasEntity === hasSection) throw new CoreRuleError('bad_input', 'Зображення прив\'язується або до сутності, або до сцени');
  if ((l.role === 'scene') !== hasSection) throw new CoreRuleError('bad_input', 'Роль «сцена» — лише для розділу книги, інші ролі — для сутностей');
  if (l.status) assertStatus(l.status);
  if (l.source && !['author', 'ai', 'legacy'].includes(l.source)) throw new CoreRuleError('bad_input', `Невідоме джерело зв'язку «${l.source}»`);
  // AI лише пропонує; затвердити (чи відхилити) пропозицію AI може автор —
  // тоді джерело лишається «ai», а записує зміну вже користувач (як CHECK у базі).
  if (isAiActor(l.createdBy) && l.status && l.status !== 'suggested') {
    throw new CoreRuleError('ai_suggests_only', 'Зв\'язок від AI — лише пропозиція (suggested)');
  }
  if (l.source === 'ai' && !isAiActor(l.createdBy) && l.status === 'suggested') {
    throw new CoreRuleError('ai_suggests_only', 'Пропозицію AI записує лише AI; автор її затверджує чи відхиляє');
  }
  if (l.appearanceVersionId && (!hasEntity || !VERSIONED_ROLES.includes(l.role))) {
    throw new CoreRuleError('bad_input', 'Версію зовнішності можна вказати лише для портрета, повного зросту чи референсу героя');
  }
}

/** Ролі зображення, які можуть належати версії зовнішності (Т2.3 В3). */
export const VERSIONED_ROLES: readonly string[] = ['portrait', 'full_body', 'reference'];

/** Відбиток опису зовнішності: без різниці в пробілах і регістрі (Т2.3 В3/В5). */
export function appearanceHash(description: string): string {
  return blockHash(String(description ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('uk'));
}

/**
 * Версія зовнішності (Т2.3 В3): ті самі правила, що й CHECK у базі.
 * Повертає нормалізовані поля (обрізані рядки, цілі глави).
 */
export function checkAppearanceVersion(v: AppearanceVersionInput): {
  label: string;
  age: string;
  fromChapter: number | null;
  toChapter: number | null;
  description: string;
  approved: boolean;
} {
  assertActor(v.createdBy);
  const label = String(v.label ?? '').trim();
  if (!label || label.length > 120) throw new CoreRuleError('bad_input', 'Назва версії зовнішності — від 1 до 120 символів');
  const age = String(v.age ?? '').trim();
  if (age.length > 40) throw new CoreRuleError('bad_input', 'Вік — до 40 символів');
  const description = String(v.description ?? '').trim();
  if (description.length > 4000) throw new CoreRuleError('bad_input', 'Опис зовнішності — до 4000 символів');
  const chapter = (x: unknown, what: string): number | null => {
    if (x == null || x === '') return null;
    const n = Number(x);
    if (!Number.isInteger(n) || n < 1 || n > 100000) throw new CoreRuleError('bad_input', `${what} — ціле число від 1`);
    return n;
  };
  const fromChapter = chapter(v.fromChapter, 'Глава «від»');
  const toChapter = chapter(v.toChapter, 'Глава «до»');
  if (fromChapter != null && toChapter != null && toChapter < fromChapter) {
    throw new CoreRuleError('bad_input', `Глава «до» (${toChapter}) раніше за «від» (${fromChapter})`);
  }
  const ai = isAiActor(v.createdBy);
  const approved = v.approved ?? !ai;
  if (ai && approved) throw new CoreRuleError('ai_suggests_only', 'Опис зовнішності від AI — лише пропозиція; затверджує автор');
  return { label, age, fromChapter, toChapter, description, approved };
}

/** Риса сутності (Т2.4 В1): ті самі правила, що й CHECK у базі. */
export function checkEntityTrait(t: EntityTraitInput): { label: string; value: string; source: 'author' | 'ai'; status: CoreStatus } {
  assertActor(t.createdBy);
  const label = String(t.label ?? '').trim();
  if (!label || label.length > 80) throw new CoreRuleError('bad_input', 'Мітка риси — від 1 до 80 символів');
  const value = String(t.value ?? '').trim();
  if (!value || value.length > 400) throw new CoreRuleError('bad_input', 'Значення риси — від 1 до 400 символів');
  if (t.source && t.source !== 'author' && t.source !== 'ai') throw new CoreRuleError('bad_input', `Невідоме джерело риси «${t.source}»`);
  const ai = isAiActor(t.createdBy);
  const source = t.source ?? (ai ? 'ai' : 'author');
  const status = t.status ?? (ai ? 'suggested' : 'confirmed');
  assertStatus(status);
  if (ai && status !== 'suggested') {
    throw new CoreRuleError('ai_suggests_only', 'Риса від AI — лише пропозиція (suggested); затверджує автор');
  }
  if (source === 'ai' && !ai && t.status === 'suggested') {
    throw new CoreRuleError('ai_suggests_only', 'Пропозицію AI записує лише AI; автор її підтверджує чи відхиляє');
  }
  return { label, value, source, status };
}

/**
 * Проблема безперервності (Т2.4 В1): ті самі правила, що й CHECK у базі.
 * Доказ Б відсутній лише коли `insufficientData` (та сама вимога, що й
 * висновки AI-3 — `checkNewFinding`, `evidence_required`).
 */
export function checkContinuityIssue(input: ContinuityIssueInput): { summary: string; source: 'rule' | 'ai'; status: ContinuityIssueStatus; insufficientData: boolean } {
  assertActor(input.createdBy);
  if (!CONTINUITY_ISSUE_KINDS.includes(input.kind)) throw new CoreRuleError('bad_input', `Невідомий вид проблеми «${input.kind}»`);
  const summary = String(input.summary ?? '').trim();
  if (!summary || summary.length > 500) throw new CoreRuleError('bad_input', 'Опис проблеми — від 1 до 500 символів');
  const evA = input.evidenceA;
  if (!evA || !evA.sectionId || !String(evA.quote ?? '').trim()) {
    throw new CoreRuleError('bad_input', 'Доказ А — обов\'язковий: розділ і цитата');
  }
  const hasB = !!input.evidenceB && !!input.evidenceB.sectionId && !!String(input.evidenceB.quote ?? '').trim();
  const insufficientData = !!input.insufficientData && !hasB;
  if (!hasB && !insufficientData) {
    throw new CoreRuleError('evidence_required', 'Проблема без другого доказу не зберігається: вкажіть evidenceB або позначку «недостатньо даних»');
  }
  if (input.source && input.source !== 'rule' && input.source !== 'ai') {
    throw new CoreRuleError('bad_input', `Невідоме джерело проблеми «${input.source}»`);
  }
  const ai = isAiActor(input.createdBy);
  const source = input.source ?? (ai ? 'ai' : 'rule');
  const status = input.status ?? (ai ? 'suggested' : 'confirmed');
  if (!CONTINUITY_ISSUE_STATUSES.includes(status)) throw new CoreRuleError('bad_input', `Невідомий статус «${status}»`);
  if (ai && status !== 'suggested') {
    throw new CoreRuleError('ai_suggests_only', 'Проблема від AI — лише пропозиція (suggested); статус змінює автор');
  }
  return { summary, source, status, insufficientData };
}

/** Найдовша чернетка, яку можна перевірити за раз (символів). */
export const DRAFT_TEXT_MAX = 20000;

/** Перевірка чернетки (Т2.4 В7): ті самі правила, що й CHECK у базі. */
export function checkContinuityDraftCheck(input: ContinuityDraftCheckInput): { draftText: string } {
  assertActor(input.createdBy);
  const draftText = String(input.draftText ?? '');
  if (!draftText.trim() || draftText.length > DRAFT_TEXT_MAX) {
    throw new CoreRuleError('bad_input', `Текст чернетки — від 1 до ${DRAFT_TEXT_MAX} символів`);
  }
  if (!Array.isArray(input.findings)) throw new CoreRuleError('bad_input', 'Знахідки перевірки — список');
  if (input.simulationId != null && (typeof input.simulationId !== 'string' || !input.simulationId.trim() || input.simulationId.length > 200)) {
    throw new CoreRuleError('bad_input', 'Ідентифікатор симуляції — рядок до 200 символів');
  }
  return { draftText };
}

/** Рішення героя (Т2.5 В2): ті самі правила, що й CHECK у базі `character_decisions`. */
export function checkCharacterDecision(input: CharacterDecisionInput): { status: CharacterDecisionInput['status'] & string; selectedAction: string | null } {
  assertActor(input.createdBy);
  if (!(CHARACTER_DECISION_LEVELS as readonly string[]).includes(input.level)) throw new CoreRuleError('bad_input', `Невідомий рівень рішення «${input.level}»`);
  if (!(CHARACTER_DECISION_SOURCES as readonly string[]).includes(input.source)) throw new CoreRuleError('bad_input', `Невідоме джерело рішення «${input.source}»`);
  const status = input.status ?? 'active';
  if (!(CHARACTER_DECISION_STATUSES as readonly string[]).includes(status)) throw new CoreRuleError('bad_input', `Невідомий статус рішення «${status}»`);
  const cacheKey = String(input.cacheKey ?? '');
  if (!cacheKey || cacheKey.length > 200) throw new CoreRuleError('bad_input', 'Ключ кешу рішення — від 1 до 200 символів');
  if (!/^[0-9a-f]{16,64}$/.test(String(input.snapshotHash ?? ''))) throw new CoreRuleError('bad_input', 'Відбиток знімка — 16–64 шістнадцяткових символи');
  const model = String(input.modelVersion ?? '');
  if (!model || model.length > 120) throw new CoreRuleError('bad_input', 'Версія моделі — від 1 до 120 символів');
  const action = input.selectedAction == null || input.selectedAction === '' ? null : String(input.selectedAction);
  if (action !== null && action.length > 60) throw new CoreRuleError('bad_input', 'Обрана дія — до 60 символів');
  if (status !== 'awaiting_author' && action === null) throw new CoreRuleError('bad_input', 'Чинне рішення без обраної дії — лише «чекає автора»');
  if (input.source === 'author') throw new CoreRuleError('bad_input', 'Рішення автора записується лише через resolveCharacterDecision');
  if (input.turnIndex != null && (!Number.isInteger(input.turnIndex) || input.turnIndex < 0)) throw new CoreRuleError('bad_input', 'Номер ходу — ціле ≥ 0');
  if (input.fallbackReason != null && String(input.fallbackReason).length > 1000) throw new CoreRuleError('bad_input', 'Причина запасного шляху — до 1000 символів');
  if (input.questions !== undefined && !Array.isArray(input.questions)) throw new CoreRuleError('bad_input', 'Питання рішення — список');
  return { status, selectedAction: action };
}

// ── Пам'ять героя (Т2.6 В1) — дзеркало CHECK міграції 0016 ──────────────────

/** Суб'єктивне героя — лише шар character_belief (переконання ніколи не world_truth, FLC 2.0 §4). */
const SUBJECTIVE_MEMORY = new Set(['belief', 'recollection', 'consequence']);

export function checkCharacterMemory(input: CharacterMemoryInput): {
  layer: CharacterMemoryLayer;
  status: CharacterMemoryStatus;
  beliefStatus: BeliefStatus;
  truth: MemoryTruth;
  visibility: Visibility;
  content: string;
} {
  assertActor(input.createdBy);
  const bad = (msg: string) => new CoreRuleError('bad_input', msg);
  if (!(CHARACTER_MEMORY_TYPES as readonly string[]).includes(input.memoryType)) throw bad(`Невідомий вид спогаду «${input.memoryType}»`);
  if (!(MEMORY_ORIGINS as readonly string[]).includes(input.origin)) throw bad(`Невідоме походження спогаду «${input.origin}»`);
  if (!(MEMORY_SOURCE_KINDS as readonly string[]).includes(input.sourceEventKind)) throw bad(`Невідоме джерело спогаду «${input.sourceEventKind}»`);
  const layer = input.layer ?? (SUBJECTIVE_MEMORY.has(input.memoryType) ? 'character_belief' : 'world_truth');
  if (!(CHARACTER_MEMORY_LAYERS as readonly string[]).includes(layer)) throw bad(`Невідомий шар «${layer}»`);
  if (SUBJECTIVE_MEMORY.has(input.memoryType) && layer !== 'character_belief') throw bad('Переконання, спогад і наслідок — лише шар character_belief (не світова правда)');
  if (input.memoryType === 'knowledge' && layer !== 'world_truth') throw bad('Знання героя — шар world_truth');
  if (input.memoryType === 'world_fact' && layer === 'character_belief') throw bad('Світовий факт — world_truth чи reader_knowledge, не переконання');
  const content = String(input.content ?? '').trim();
  if (!content || content.length > 2000) throw bad('Зміст спогаду — від 1 до 2000 символів');
  const sim = input.simulationId == null || input.simulationId === '' ? null : String(input.simulationId);
  const rev = input.canonRevision ?? null;
  if ((sim === null) === (rev === null)) throw bad('Спогад — або прогону (simulationId), або канону (canonRevision), рівно одне');
  if (sim !== null && sim.length > 100) throw bad('Ідентифікатор прогону — до 100 символів');
  if (rev !== null && (!Number.isInteger(rev) || rev < 0)) throw bad('Ревізія канону — ціле ≥ 0');
  if (input.origin === 'simulation' && sim === null) throw bad('Спогад прогону пишеться лише з його simulationId');
  const status = input.status ?? (input.origin === 'ai' || input.origin === 'simulation' ? 'suggested' : 'confirmed');
  if (!(CHARACTER_MEMORY_STATUSES as readonly string[]).includes(status)) throw bad(`Невідомий статус спогаду «${status}»`);
  if (input.origin === 'ai' && status === 'confirmed') throw new CoreRuleError('ai_suggests_only', 'Спогад від AI можна лише запропонувати — підтверджує автор');
  const beliefStatus = input.beliefStatus ?? (SUBJECTIVE_MEMORY.has(input.memoryType) ? 'believes' : 'knows');
  if (!(BELIEF_STATUSES as readonly string[]).includes(beliefStatus)) throw bad(`Невідома певність «${beliefStatus}»`);
  const truth = input.truth ?? 'unknown';
  if (!(MEMORY_TRUTHS as readonly string[]).includes(truth)) throw bad(`Невідоме відношення до правди «${truth}»`);
  const visibility = input.visibility ?? 'project';
  if (!VISIBILITIES.includes(visibility)) throw bad(`Невідома видимість «${visibility}»`);
  const paras = input.sourceParagraphIds ?? [];
  if (!Array.isArray(paras) || paras.length > 200 || paras.some((p) => typeof p !== 'string' || !p || p.length > 200)) throw bad('Абзаци-докази — список до 200 id');
  const about = input.aboutEntityIds ?? [];
  if (!Array.isArray(about) || about.length > 50 || about.some((p) => typeof p !== 'string' || !p)) throw bad('«Про кого» — список до 50 id сутностей');
  if (input.effects !== undefined && (typeof input.effects !== 'object' || input.effects === null || Array.isArray(input.effects))) throw bad('Наслідки — обʼєкт');
  if (input.evidenceHash != null && !/^[0-9a-f]{16,64}$/.test(input.evidenceHash)) throw bad('Відбиток доказів — 16–64 шістнадцяткових символи');
  if (input.sourceEventId != null && (String(input.sourceEventId).length < 1 || String(input.sourceEventId).length > 200)) throw bad('Джерело спогаду — до 200 символів');
  if (input.sceneId != null && (String(input.sceneId).length < 1 || String(input.sceneId).length > 200)) throw bad('Сцена спогаду — до 200 символів');
  if (input.dedupeKey != null && (String(input.dedupeKey).length < 1 || String(input.dedupeKey).length > 200)) throw bad('Ключ повтору — до 200 символів');
  return { layer, status, beliefStatus, truth, visibility, content };
}

/**
 * Хто й куди може перевести спогад: підтвердити чи відхилити — людина
 * (AI лише пропонує); «перевірити» — людина чи система (правка сцени, В3);
 * «замінено» — будь-хто зі справжнім автором запису.
 */
export function checkCharacterMemoryStatus(row: Pick<CharacterMemoryRow, 'status' | 'origin'>, status: CharacterMemoryStatus, actor: CoreActor, note?: string | null): void {
  assertActor(actor);
  if (!(CHARACTER_MEMORY_STATUSES as readonly string[]).includes(status)) throw new CoreRuleError('bad_input', `Невідомий статус спогаду «${status}»`);
  if ((status === 'confirmed' || status === 'rejected') && !actor.startsWith('user:') && !(row.origin === 'tag' && actor.startsWith('system:'))) {
    throw new CoreRuleError('confirmed_is_author_only', 'Підтвердити чи відхилити спогад може лише автор');
  }
  if (status === 'needs_review' && actor.startsWith('ai:')) throw new CoreRuleError('bad_input', 'Позначку «перевірити» ставить автор чи синхронізація, не AI');
  if (status === 'suggested') throw new CoreRuleError('bad_input', 'Повернути спогад у «пропозицію» не можна — лише підтвердити, відхилити чи позначити «перевірити»');
  if (row.status === 'superseded') throw new CoreRuleError('conflict', 'Спогад уже замінено новішим');
  if (note != null && String(note).length > 500) throw new CoreRuleError('bad_input', 'Примітка — до 500 символів');
}

/** Зміна полів спогаду (В3): те саме, що при записі, для змінених полів; вид, шар, прогін / канон — незмінні. */
export function checkCharacterMemoryPatch(row: Pick<CharacterMemoryRow, 'status' | 'simulationId'>, patch: CharacterMemoryPatch, actor: CoreActor): void {
  assertActor(actor);
  const bad = (msg: string) => new CoreRuleError('bad_input', msg);
  if (row.status === 'superseded') throw new CoreRuleError('conflict', 'Спогад уже замінено новішим');
  if (patch.content !== undefined) {
    const c = String(patch.content ?? '').trim();
    if (!c || c.length > 2000) throw bad('Зміст спогаду — від 1 до 2000 символів');
  }
  if (patch.beliefStatus !== undefined && !(BELIEF_STATUSES as readonly string[]).includes(patch.beliefStatus)) throw bad(`Невідома певність «${patch.beliefStatus}»`);
  if (patch.truth !== undefined && !(MEMORY_TRUTHS as readonly string[]).includes(patch.truth)) throw bad(`Невідоме відношення до правди «${patch.truth}»`);
  if (patch.visibility !== undefined && !VISIBILITIES.includes(patch.visibility)) throw bad(`Невідома видимість «${patch.visibility}»`);
  if (patch.evidenceHash != null && !/^[0-9a-f]{16,64}$/.test(patch.evidenceHash)) throw bad('Відбиток доказів — 16–64 шістнадцяткових символи');
  if (patch.canonRevision !== undefined) {
    if (row.simulationId !== null) throw bad('Спогад прогону не має ревізії канону');
    if (patch.canonRevision === null || !Number.isInteger(patch.canonRevision) || patch.canonRevision < 0) throw bad('Ревізія канону — ціле ≥ 0');
  }
  if (patch.effects !== undefined && (typeof patch.effects !== 'object' || patch.effects === null || Array.isArray(patch.effects))) throw bad('Наслідки — обʼєкт');
  if (patch.aboutEntityIds !== undefined && (!Array.isArray(patch.aboutEntityIds) || patch.aboutEntityIds.length > 50)) throw bad('«Про кого» — список до 50 id сутностей');
}

// ── Допит (Т2.7 В1) — дзеркало CHECK міграції 0017 ────────────────────────

const objectLike = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
const humanOrSystem = (actor: CoreActor, what: string) => {
  assertActor(actor);
  if (!/^(user|system):.+/.test(actor)) throw new CoreRuleError('bad_actor', `${what} — лише людина чи система, не AI`);
};

export function checkCharacterAgent(input: CharacterAgentInput): void {
  humanOrSystem(input.actor, 'Перемикач «AI-персонаж»');
  if (!(AUTONOMY_LEVELS as readonly string[]).includes(input.autonomyLevel)) throw new CoreRuleError('bad_input', `Рівень автономності — один із: ${AUTONOMY_LEVELS.join(', ')}`);
  if (input.agentConfig !== undefined && !objectLike(input.agentConfig)) throw new CoreRuleError('bad_input', 'Налаштування агента — обʼєкт');
  if (input.modelPolicy !== undefined && !objectLike(input.modelPolicy)) throw new CoreRuleError('bad_input', 'Політика моделі — обʼєкт');
}

export function checkSimulation(input: SimulationInput): void {
  humanOrSystem(input.createdBy, 'Прогін');
  if (!(SIMULATION_KINDS as readonly string[]).includes(input.kind)) throw new CoreRuleError('bad_input', `Невідомий вид прогону «${input.kind}»`);
  if (input.kind === 'interview' && !input.characterId) throw new CoreRuleError('bad_input', 'Допит — лише з героєм');
  if (!Number.isInteger(input.baseBookRevision) || input.baseBookRevision < 0) throw new CoreRuleError('bad_input', 'Ревізія книги — ціле ≥ 0');
  if (input.asOfChapter != null && (!Number.isInteger(input.asOfChapter) || input.asOfChapter < 1)) throw new CoreRuleError('bad_input', 'Межа знань — глава ≥ 1');
  if (input.sceneId != null && (String(input.sceneId).length < 1 || String(input.sceneId).length > 200)) throw new CoreRuleError('bad_input', 'Сцена — до 200 символів');
  if (input.title != null && String(input.title).length > 200) throw new CoreRuleError('bad_input', 'Назва прогону — до 200 символів');
  if (input.config !== undefined && !objectLike(input.config)) throw new CoreRuleError('bad_input', 'Налаштування прогону — обʼєкт');
}

export function checkSimulationPatch(patch: SimulationPatch): void {
  if (patch.status !== undefined && !(SIMULATION_STATUSES as readonly string[]).includes(patch.status)) throw new CoreRuleError('bad_input', `Невідомий статус прогону «${patch.status}»`);
  if (patch.currentTurn !== undefined && (!Number.isInteger(patch.currentTurn) || patch.currentTurn < 0)) throw new CoreRuleError('bad_input', 'Номер ходу — ціле ≥ 0');
  if (patch.config !== undefined && !objectLike(patch.config)) throw new CoreRuleError('bad_input', 'Налаштування прогону — обʼєкт');
  if (patch.title !== undefined && String(patch.title).length > 200) throw new CoreRuleError('bad_input', 'Назва прогону — до 200 символів');
}

export function checkSimulationEvent(input: SimulationEventInput): void {
  assertActor(input.createdBy);
  if (!(SIMULATION_EVENT_TYPES as readonly string[]).includes(input.eventType)) throw new CoreRuleError('bad_input', `Невідомий вид ходу «${input.eventType}»`);
  if (!(SIMULATION_ACTORS as readonly string[]).includes(input.actor)) throw new CoreRuleError('bad_input', `Невідомий учасник «${input.actor}»`);
  if (!Number.isInteger(input.turnIndex) || input.turnIndex < 0) throw new CoreRuleError('bad_input', 'Номер ходу — ціле ≥ 0');
  if (input.actor === 'character' && !input.actorCharacterId) throw new CoreRuleError('bad_input', 'Хід героя — з героєм');
  if (input.eventType === 'question' && input.actor !== 'author') throw new CoreRuleError('bad_input', 'Питання ставить лише автор');
  if (input.publicPayload !== undefined && !objectLike(input.publicPayload)) throw new CoreRuleError('bad_input', 'Зміст ходу — обʼєкт');
}

export function checkCanonProposal(input: CanonProposalInput): void {
  assertActor(input.createdBy);
  if (!(CANON_PROPOSAL_KINDS as readonly string[]).includes(input.kind)) throw new CoreRuleError('bad_input', `Невідомий вид пропозиції «${input.kind}»`);
  if (!objectLike(input.proposedChange)) throw new CoreRuleError('bad_input', 'Пропозиція — обʼєкт');
  if (input.kind === 'tag' && !input.parentId) throw new CoreRuleError('bad_input', 'Тег (П7) — лише до фрагмента');
  if (input.sourceEventIds !== undefined && (!Array.isArray(input.sourceEventIds) || input.sourceEventIds.length > 50)) throw new CoreRuleError('bad_input', 'Джерела пропозиції — список до 50 ходів');
}

export function checkMention(m: MentionInput): void {
  if (!Number.isInteger(m.spanStart) || !Number.isInteger(m.spanEnd) || m.spanStart < 0 || m.spanEnd < m.spanStart) {
    throw new CoreRuleError('bad_input', `Неправильний діапазон згадки ${m.spanStart}–${m.spanEnd}`);
  }
  if (!['tag', 'ai', 'author'].includes(m.source)) throw new CoreRuleError('bad_input', `Невідоме джерело згадки «${m.source}»`);
  if (m.status) assertStatus(m.status);
  if (m.source === 'ai' && m.status && m.status !== 'suggested') {
    throw new CoreRuleError('ai_suggests_only', 'Згадку, знайдену AI, можна лише запропонувати');
  }
}

export function checkNewRun(input: RunCreateInput): void {
  assertActor(input.createdBy);
  if (!AI_ROLES.includes(input.role)) throw new CoreRuleError('bad_input', `Невідома роль AI «${input.role}»`);
  assertNonEmpty(input.module, 'Модуль прогону');
}

/**
 * Висновок AI без доказу не зберігається (ТЗ 13.2): потрібен хоча б один
 * абзац-джерело — або чесна позначка «недостатньо даних».
 */
export function checkNewFinding(input: FindingInput): CoreStatus {
  assertActor(input.createdBy);
  assertNonEmpty(input.kind, 'Вид висновку');
  const ai = isAiActor(input.createdBy);
  const status = input.status ?? (ai ? 'suggested' : 'confirmed');
  assertStatus(status);
  if (input.visibility && !VISIBILITIES.includes(input.visibility)) {
    throw new CoreRuleError('bad_input', `Невідома видимість «${input.visibility}»`);
  }
  if (ai && status !== 'suggested') {
    throw new CoreRuleError('ai_suggests_only', 'Висновок AI — лише пропозиція (suggested); затверджує автор');
  }
  if (ai && !(input.sourceParagraphIds ?? []).length && !(input.sourceAssetIds ?? []).length && !input.insufficientData) {
    throw new CoreRuleError(
      'evidence_required',
      'Висновок AI без доказу не зберігається: вкажіть абзаци чи зображення-джерела або позначку «недостатньо даних»',
    );
  }
  return status;
}

export function notFound(what: string): CoreRuleError {
  return new CoreRuleError('not_found', `${what} не знайдено в цьому проєкті`);
}
