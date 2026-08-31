/**
 * Сховище чернеток експрес-майстра (Wisart Book Crealiry.md §3.4).
 *
 * Окремий модуль, а не частина store.ts: чернетка живе годинами, не має
 * власника більшу частину свого життя і зникає сама — у неї інші правила,
 * ніж у решти сутностей, і змішувати їх означало б плутати ці правила.
 */

import { randomUUID } from 'node:crypto';
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
  firstName: string;
  lastName: string;
  psychotype?: string;
  vedicRole?: string;
  poltiPatternId?: number;
  poltiRoleName?: string;
  hook?: string;
}

export interface ExpressPayload {
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
  payload: ExpressPayload;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

interface Row {
  id: string;
  user_id: string | null;
  step: number;
  payload: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
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
    payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

export function createDraft(userId: string | null, payload: ExpressPayload = {}): ExpressDraft {
  const db = requireDb();
  const now = new Date();
  const draft: ExpressDraft = {
    id: randomUUID(),
    userId,
    step: 1,
    payload,
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
  return draft;
}

/**
 * Часткове оновлення: майстер надсилає лише те, що змінилось на кроці, і
 * перезапис усього payload затер би відповіді попередніх кроків, якби
 * клієнт їх не надіслав.
 */
export function updateDraft(
  id: string,
  patch: ExpressPayload,
  step?: number
): ExpressDraft | undefined {
  const current = getDraft(id);
  if (!current) return undefined;

  const db = requireDb();
  const payload = { ...current.payload, ...patch };
  const updatedAt = new Date().toISOString();
  const nextStep = step ?? current.step;

  db.prepare('UPDATE express_drafts SET payload = ?, step = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(payload),
    nextStep,
    updatedAt,
    id
  );

  return { ...current, payload, step: nextStep, updatedAt };
}

/** Привʼязка анонімної чернетки до акаунта після реєстрації (§3.4.5). */
export function claimDraft(id: string, userId: string): ExpressDraft | undefined {
  const current = getDraft(id);
  if (!current) return undefined;
  if (current.userId && current.userId !== userId) return undefined;

  const db = requireDb();
  const updatedAt = new Date().toISOString();
  db.prepare('UPDATE express_drafts SET user_id = ?, updated_at = ? WHERE id = ?').run(
    userId,
    updatedAt,
    id
  );

  return { ...current, userId, updatedAt };
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
