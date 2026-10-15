import type { StoryWorld, WizardStepKey } from '../shared/storyWorld';
import { wizardStepKey } from '../shared/storyWorld';
/**
 * Сховище чернеток експрес-майстра (Wisart Book Crealiry.md §3.4).
 *
 * Окремий модуль, а не частина store.ts: чернетка живе годинами, не має
 * власника більшу частину свого життя і зникає сама — у неї інші правила,
 * ніж у решти сутностей, і змішувати їх означало б плутати ці правила.
 */

import { randomUUID } from 'node:crypto';
import type { WizardScenarioState } from '../shared/wizardScenarios';
import { validateWizardPatch } from './wizardValidation';
import { getDb, unavailableMessage } from './db';

/** Доба — досить, щоб повернутись наступного дня, і мало, щоб не накопичувати. */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Сусідні сховища пишуть `getDb()!`, але тут це дало б незрозумілий
 * null-деref у середовищі, де SQLite недоступний і db.ts відкотився на
 * JSON-файли. Майстер без бази працювати не може, тож краще сказати це
 * прямо — маршрут перетворить помилку на зрозумілу відповідь.
 */
function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error(
      `Експрес-майстер потребує SQLite, а сховище недоступне: ${unavailableMessage()}`
    );
  }
  return db;
}

export interface ExpressCastMember {
  /**
   * Стабільна ідентичність героя. Імʼя дозволено редагувати, тому name не
   * може бути ключем між кроками wizard, synopsis, семантичними тегами та
   * майбутньою JEV-оцінкою.
   */
  id?: string;
  firstName: string;
  lastName: string;
  psychotype?: string;
  vedicRole?: string;
  poltiPatternId?: number;
  poltiRoleName?: string;
  hook?: string;
  appearance?: string;
  goal?: string;
  flaw?: string;
  approved?: boolean;
}

export interface ExpressPayload extends WizardScenarioState {
  storyWorld?: StoryWorld;
  navigationVersion?: 2;
  stepKey?: WizardStepKey;
  useAi?: boolean;
  technical?: Record<string, unknown>;
  /**
   * Напрям із розвилки перед майстром (Завдання 4): book | course |
   * instruction | game. Зберігається в чернетці, а не лише в браузері,
   * бо від нього залежатимуть промпти кроків: чернетка, підхоплена без
   * напряму, — це чернетка, про яку сервер не знає, що з неї робити.
   */
  track?: string;
  /** Крок Е1: одне-два речення про те, про що книга. */
  seed?: string;
  genre?: string;
  /** Крок Е2. */
  framework?: string;
  frameworkRationale?: string;
  natureConnection?: boolean;
  archetypes36?: boolean;
  /** Крок Е3. */
  cast?: ExpressCastMember[];
  /**
   * Крива головного героя (13 кроків шляху героя + 14-точкова емоційна
   * крива), заповнювана на тому самому кроці Е3. Форма навмисно дублює
   * `HeroArcState` з src/types.ts, а не імпортує її: сервер і клієнт тут
   * не діляться типами (жоден інший файл server/*.ts не читає з src/), і
   * жорсткий імпорт заради шести рядків типу — зайва залежність.
   */
  heroArc?: { answers?: Record<string, string>; intensities?: number[] };
  /** Крок Е4. */
  synopsis?: string;
  /** Крок Е5: частини, що вже згенерувались. */
  parts?: unknown[];
}

export interface ExpressDraft {
  id: string;
  userId: string | null;
  step: number;
  revision: number;
  payload: ExpressPayload;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

interface Row {
  id: string;
  user_id: string | null;
  step: number;
  revision: number;
  payload: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

function castName(member: ExpressCastMember): string {
  return `${member.firstName ?? ''}\u0000${member.lastName ?? ''}`.trim().toLocaleLowerCase();
}

/** Ідентичність визначає id; для старих клієнтів дозволено лише збіг імені.
 * Індекс не є ідентичністю: видалення або reorder не передають id іншому герою.
 */
export function withStableCastIds(
  incoming: ExpressCastMember[],
  existing: ExpressCastMember[] = []
): ExpressCastMember[] {
  const used = new Set<string>();
  const explicitIds = new Set(incoming.map((m) => m.id?.trim()).filter(Boolean));
  const existingByName = new Map<string, ExpressCastMember[]>();
  for (const member of existing) {
    const key = castName(member);
    const bucket = existingByName.get(key) ?? [];
    bucket.push(member);
    existingByName.set(key, bucket);
  }

  return incoming.map((member) => {
    let id = member.id?.trim() || '';
    if (id && used.has(id)) id = '';

    if (!id) {
      const candidates = existingByName.get(castName(member)) ?? [];
      const match = candidates.find((candidate) => candidate.id && !used.has(candidate.id) && !explicitIds.has(candidate.id));
      if (match?.id) id = match.id;
    }

    if (!id) id = randomUUID();
    used.add(id);
    return { ...member, id };
  });
}

function toDraft(row: Row): ExpressDraft {
  let payload: ExpressPayload = {};
  try {
    payload = JSON.parse(row.payload) as ExpressPayload;
  } catch {
    // Пошкоджений JSON не має валити майстер: краще порожня чернетка, ніж
    // пятисотка на кроці, куди людина щойно повернулась.
    payload = {};
  }
  return {
    id: row.id,
    userId: row.user_id,
    step: row.step,
    revision: row.revision,
    payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

export function createDraft(userId: string | null, payload: ExpressPayload = {}): ExpressDraft {
  const db = requireDb();
  const now = new Date();
  try { validateWizardPatch(payload); } catch (error) { throw new DraftValidationError((error as Error).message); }
  const normalizedPayload = payload.cast
    ? { ...payload, cast: withStableCastIds(payload.cast) }
    : payload;
  const draft: ExpressDraft = {
    id: randomUUID(),
    userId,
    step: 1,
    revision: 1,
    payload: normalizedPayload,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
  };

  db.prepare(
    `INSERT INTO express_drafts (id, user_id, step, payload, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    draft.id,
    draft.userId,
    draft.step,
    JSON.stringify(draft.payload),
    draft.createdAt,
    draft.updatedAt,
    draft.expiresAt
  );

  return draft;
}

/** Прострочена чернетка не повертається, навіть якщо рядок ще на місці. */
export function getDraft(id: string): ExpressDraft | undefined {
  const db = requireDb();
  const row = db.prepare('SELECT * FROM express_drafts WHERE id = ?').get(id) as Row | undefined;
  if (!row) return undefined;
  const draft = toDraft(row);
  if (new Date(draft.expiresAt).getTime() < Date.now()) return undefined;
  // Старі чернетки могли мати cast без id. Нормалізацію зберігаємо один раз,
  // а не генеруємо іншу ідентичність на кожному GET.
  if (draft.payload.cast?.some((c) => !c.id) ||
      new Set(draft.payload.cast?.map((c) => c.id)).size !== (draft.payload.cast?.length ?? 0)) {
    return updateDraft(id, { cast: draft.payload.cast }, draft.revision);
  }
  return draft;
}

export class DraftConflictError extends Error {
  constructor(public readonly current: ExpressDraft) {
    super('Чернетку змінено в іншій вкладці. Ваші правки збережено локально; порівняйте їх із серверною версією.');
  }
}

export class DraftValidationError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function assertDraftRevision(draft: ExpressDraft, expected: unknown): asserts expected is number {
  if (!Number.isSafeInteger(expected) || (expected as number) < 1) {
    throw new DraftValidationError('Оновіть сторінку: для збереження потрібна ревізія чернетки.', 428);
  }
  if (expected !== draft.revision) throw new DraftConflictError(draft);
}

/**
 * Часткове оновлення: майстер надсилає лише те, що змінилось на кроці, і
 * перезапис усього payload затер би відповіді попередніх кроків, якби
 * клієнт їх не надіслав.
 */
export function updateDraft(
  id: string,
  patch: ExpressPayload,
  expectedRevision: number,
  step?: number
): ExpressDraft | undefined {
  const db = requireDb();
  const row = db.prepare('SELECT * FROM express_drafts WHERE id = ?').get(id) as Row | undefined;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return undefined;
  const current = toDraft(row);
  assertDraftRevision(current, expectedRevision);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new DraftValidationError('Некоректні дані чернетки.');
  }
  if (step !== undefined && (!Number.isInteger(step) || step < 1 || step > (patch.navigationVersion === 2 || current.payload.navigationVersion === 2 ? 6 : 5))) {
    throw new DraftValidationError('Некоректний крок майстра.');
  }
  if (patch.cast !== undefined && (!Array.isArray(patch.cast) || patch.cast.some((c) =>
    !c || typeof c.firstName !== 'string' || typeof c.lastName !== 'string' ||
    (c.id !== undefined && typeof c.id !== 'string')))) {
    throw new DraftValidationError('Некоректний склад героїв.');
  }
  try { validateWizardPatch(patch); } catch (error) { throw new DraftValidationError((error as Error).message); }
  const normalizedPatch = patch.cast
    ? { ...patch, cast: withStableCastIds(patch.cast, current.payload.cast ?? []) }
    : patch;
  const payload = { ...current.payload, ...normalizedPatch };
  if (payload.navigationVersion === 2) payload.stepKey = wizardStepKey(step ?? current.step);
  const updatedAt = new Date().toISOString();
  const nextStep = step ?? current.step;
  const result = db.prepare(
    'UPDATE express_drafts SET payload = ?, step = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?'
  ).run(JSON.stringify(payload), nextStep, updatedAt, id, expectedRevision) as { changes: number };
  if (!result.changes) {
    const latest = getDraft(id);
    if (latest) throw new DraftConflictError(latest);
    return undefined;
  }
  return { ...current, payload, step: nextStep, updatedAt, revision: expectedRevision + 1 };
}

/** Привʼязка не змінює payload, але також бере участь у CAS. */
export function claimDraft(id: string, userId: string, expectedRevision: number): ExpressDraft | undefined {
  const current = getDraft(id);
  if (!current || (current.userId && current.userId !== userId)) return undefined;
  assertDraftRevision(current, expectedRevision);
  if (current.userId === userId) return current;
  const db = requireDb();
  const updatedAt = new Date().toISOString();
  const result = db.prepare(
    'UPDATE express_drafts SET user_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?'
  ).run(userId, updatedAt, id, expectedRevision) as { changes: number };
  if (!result.changes) {
    const latest = getDraft(id);
    if (latest) throw new DraftConflictError(latest);
    return undefined;
  }
  return { ...current, userId, updatedAt, revision: expectedRevision + 1 };
}

export function deleteDraft(id: string): boolean {
  const db = requireDb();
  const info = db.prepare('DELETE FROM express_drafts WHERE id = ?').run(id) as { changes?: number };
  return (info.changes ?? 0) > 0;
}

/**
 * Заміна Redis-івському TTL: прострочене прибирається при старті сервера.
 * Ліниве прибирання (лише при читанні) лишало б рядки назавжди для
 * чернеток, до яких ніхто не повернувся, а таких буде більшість.
 */
export function purgeExpiredDrafts(): number {
  const db = requireDb();
  const info = db
    .prepare('DELETE FROM express_drafts WHERE expires_at < ?')
    .run(new Date().toISOString()) as { changes?: number };
  return info.changes ?? 0;
}
