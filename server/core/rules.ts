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
  if ((l.source === 'ai' || isAiActor(l.createdBy)) && l.status && l.status !== 'suggested') {
    throw new CoreRuleError('ai_suggests_only', 'Зв\'язок від AI — лише пропозиція (suggested)');
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
