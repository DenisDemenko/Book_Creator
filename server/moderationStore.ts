/**
 * Черга модерації публікацій у вітрину.
 *
 * Автор подає готовий твір (книгу, курс, інструкцію чи інтерактивну гру),
 * адміністратор погоджує або відхиляє. Лише після погодження твір
 * публікується в маркетплейс. Черга живе в SQLite (таблиця `moderation`
 * в server/db.ts) — та сама залежність, що й у курсів: без SQLite
 * модерація чесно відмовляється працювати, а не вдає.
 */

import { randomUUID } from 'node:crypto';
import { getDb, unavailableMessage } from './db';

export type ModerationItemType = 'book' | 'course' | 'instruction' | 'game';
/** changes_requested — повернуто автору із зауваженнями: він виправляє й подає знову (новий запис). */
export type ModerationStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested';

export interface ModerationEntry {
  id: string;
  itemType: ModerationItemType;
  itemId: string;
  title: string;
  authorId: string;
  status: ModerationStatus;
  reason?: string;
  createdAt: string;
  decidedAt?: string;
}

const TYPES: ModerationItemType[] = ['book', 'course', 'instruction', 'game'];
const STATUSES: ModerationStatus[] = ['pending', 'approved', 'rejected', 'changes_requested'];

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error(`Модерація потребує SQLite, а сховище недоступне: ${unavailableMessage()}`);
  }
  return db;
}

interface Row {
  id: string;
  item_type: string;
  item_id: string;
  title: string;
  author_id: string;
  status: string;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
  snapshot?: string | null;
}

function toEntry(row: Row): ModerationEntry {
  return {
    id: row.id,
    itemType: (TYPES.includes(row.item_type as ModerationItemType) ? row.item_type : 'book') as ModerationItemType,
    itemId: row.item_id,
    title: row.title,
    authorId: row.author_id,
    status: (STATUSES.includes(row.status as ModerationStatus) ? row.status : 'pending') as ModerationStatus,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
  };
}

/** Подати твір на модерацію. Ідемпотентно: якщо такий твір уже чекає — повертаємо наявний запис. */
export function submitForModeration(input: {
  itemType: ModerationItemType;
  itemId: string;
  title: string;
  authorId: string;
  /**
   * JSON твору на момент подання. Адмін погоджує саме його: правки автора
   * після подання у вітрину не потраплять, доки той не надішле твір ще раз.
   * Повторне подання, поки запис чекає, ОНОВЛЮЄ знімок (автор виправив
   * помилку, не чекаючи рішення).
   */
  snapshot?: string;
}): ModerationEntry {
  const db = requireDb();

  const existing = db
    .prepare('SELECT * FROM moderation WHERE item_type = ? AND item_id = ? AND status = ?')
    .get(input.itemType, input.itemId, 'pending') as Row | undefined;
  if (existing) {
    if (input.snapshot !== undefined) {
      db.prepare('UPDATE moderation SET snapshot = ?, title = ? WHERE id = ?').run(input.snapshot, input.title, existing.id);
      return toEntry(db.prepare('SELECT * FROM moderation WHERE id = ?').get(existing.id) as Row);
    }
    return toEntry(existing);
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO moderation (id, item_type, item_id, title, author_id, status, created_at, snapshot)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(randomUUID(), input.itemType, input.itemId, input.title, input.authorId, now, input.snapshot ?? null);

  const row = db
    .prepare('SELECT * FROM moderation WHERE item_type = ? AND item_id = ? AND status = ?')
    .get(input.itemType, input.itemId, 'pending') as Row;
  return toEntry(row);
}

export function listModeration(status?: ModerationStatus): ModerationEntry[] {
  const db = requireDb();
  const rows = (
    status
      ? db.prepare('SELECT * FROM moderation WHERE status = ? ORDER BY created_at ASC').all(status)
      : db.prepare('SELECT * FROM moderation ORDER BY created_at ASC').all()
  ) as Row[];
  return rows.map(toEntry);
}

/**
 * Останнє рішення (чи очікування) щодо твору — для редактора автора: досі
 * автор не бачив ні того, що курс чекає на модерацію, ні причини відмови.
 */
export function latestModerationFor(itemType: ModerationItemType, itemId: string): ModerationEntry | undefined {
  const db = requireDb();
  const row = db
    .prepare('SELECT * FROM moderation WHERE item_type = ? AND item_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(itemType, itemId) as Row | undefined;
  return row ? toEntry(row) : undefined;
}

/** Знімок твору на момент подання; undefined — запису немає або він старий (без знімка). */
export function getModerationSnapshot(id: string): string | undefined {
  const db = requireDb();
  const row = db.prepare('SELECT snapshot FROM moderation WHERE id = ?').get(id) as { snapshot: string | null } | undefined;
  return row?.snapshot ?? undefined;
}

export function getModeration(id: string): ModerationEntry | undefined {
  const db = requireDb();
  const row = db.prepare('SELECT * FROM moderation WHERE id = ?').get(id) as Row | undefined;
  return row ? toEntry(row) : undefined;
}

export function decideModeration(
  id: string,
  decision: 'approved' | 'rejected' | 'changes_requested',
  reason?: string
): ModerationEntry | undefined {
  const db = requireDb();
  const current = getModeration(id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare('UPDATE moderation SET status = ?, reason = ?, decided_at = ? WHERE id = ?').run(
    decision,
    reason ?? null,
    now,
    id
  );
  return getModeration(id);
}
