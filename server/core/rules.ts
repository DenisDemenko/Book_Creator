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
  | 'duplicate_alias';

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
  if (ai && !(input.sourceParagraphIds ?? []).length && !input.insufficientData) {
    throw new CoreRuleError(
      'evidence_required',
      'Висновок AI без доказу не зберігається: вкажіть абзаци-джерела або позначку «недостатньо даних»',
    );
  }
  return status;
}

export function notFound(what: string): CoreRuleError {
  return new CoreRuleError('not_found', `${what} не знайдено в цьому проєкті`);
}
