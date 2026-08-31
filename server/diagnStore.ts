/**
 * Сховище діагностик /diagn (diagn-module-tech-spec-v1.0.md §7, §8).
 *
 * Три обовʼязки, і всі три — про гроші й довіру:
 *   • історія: звіт живе довго, бо порівняння радара компетенцій через
 *     кілька місяців — головна обіцянка модуля;
 *   • кеш на добу: повторна діагностика того самого тексту не має
 *     коштувати ще трьох викликів моделі;
 *   • обмеження частоти: 10 на годину на автора.
 *
 * Чому кеш — це та сама таблиця, а не окрема. Кеш «сирого результату»
 * і збережений звіт відрізняються лише віком запису. Друга таблиця
 * означала б два джерела правди про один текст і питання «а якщо вони
 * розійшлися».
 */

import { createHash, randomUUID } from 'node:crypto';
import { getDb, unavailableMessage } from './db';
import { DIAGN_CACHE_TTL_MS, DIAGN_RATE_LIMIT_PER_HOUR, type DiagnModule } from './diagnPrompt';

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error(`Діагностика потребує SQLite, а сховище недоступне: ${unavailableMessage()}`);
  }
  return db;
}

export interface DiagnRecord {
  id: string;
  userId: string;
  bookId: string | null;
  modules: DiagnModule[];
  result: Record<string, unknown>;
  wordCount: number;
  createdAt: string;
}

interface Row {
  id: string;
  user_id: string;
  book_id: string | null;
  modules: string;
  result_json: string;
  cache_key: string;
  word_count: number;
  created_at: string;
}

/**
 * Ключ кешу — хеш тексту разом зі складом модулів і мовою. Без складу
 * модулів запит `--module=style` віддав би збережену повну діагностику
 * і навпаки: `--module=all` після `style` повернув би звіт без двох
 * третин, і автор вирішив би, що модуль зламався.
 */
export function diagnCacheKey(text: string, modules: DiagnModule[], locale: string): string {
  const h = createHash('sha256');
  h.update(String(text ?? ''));
  h.update(' ');
  h.update([...modules].sort().join(','));
  h.update(' ');
  h.update(locale || 'uk');
  return h.digest('hex');
}

function toRecord(row: Row): DiagnRecord {
  let result: Record<string, unknown> = {};
  let modules: DiagnModule[] = [];
  try {
    result = JSON.parse(row.result_json);
  } catch {
    result = {};
  }
  try {
    modules = JSON.parse(row.modules);
  } catch {
    modules = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    modules,
    result,
    wordCount: row.word_count,
    createdAt: row.created_at,
  };
}

export function saveDiagnostic(input: {
  userId: string;
  bookId: string | null;
  modules: DiagnModule[];
  result: Record<string, unknown>;
  cacheKey: string;
  wordCount: number;
}): DiagnRecord {
  const db = requireDb();
  const rec: DiagnRecord = {
    id: randomUUID(),
    userId: input.userId,
    bookId: input.bookId,
    modules: input.modules,
    result: input.result,
    wordCount: input.wordCount,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO diagnostics (id, user_id, book_id, modules, result_json, cache_key, word_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rec.id,
    rec.userId,
    rec.bookId,
    JSON.stringify(rec.modules),
    JSON.stringify(rec.result),
    input.cacheKey,
    rec.wordCount,
    rec.createdAt
  );
  return rec;
}

/** Свіжий звіт на той самий текст (ТЗ §7: TTL 24 год) або null. */
export function findCachedDiagnostic(userId: string, cacheKey: string): DiagnRecord | null {
  const db = requireDb();
  const since = new Date(Date.now() - DIAGN_CACHE_TTL_MS).toISOString();
  const row = db
    .prepare(
      `SELECT * FROM diagnostics
       WHERE user_id = ? AND cache_key = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId, cacheKey, since) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function getDiagnostic(id: string): DiagnRecord | null {
  const db = requireDb();
  const row = db.prepare('SELECT * FROM diagnostics WHERE id = ?').get(id) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function listDiagnostics(userId: string, bookId?: string | null, limit = 50): DiagnRecord[] {
  const db = requireDb();
  const rows = (
    bookId
      ? db
          .prepare(
            'SELECT * FROM diagnostics WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC LIMIT ?'
          )
          .all(userId, bookId, limit)
      : db
          .prepare('SELECT * FROM diagnostics WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(userId, limit)
  ) as Row[];
  return rows.map(toRecord);
}

export interface RateVerdict {
  allowed: boolean;
  used: number;
  limit: number;
  /** Коли звільниться місце — щоб сказати «спробуйте о 14:20», а не «пізніше». */
  retryAt: string | null;
}

/**
 * Ковзне вікно в годину, а не «скидання о рівній годині»: інакше десять
 * діагностик о 13:59 і ще десять о 14:01 обходять ліміт удвічі.
 */
export function checkDiagnRateLimit(userId: string, limit = DIAGN_RATE_LIMIT_PER_HOUR): RateVerdict {
  const db = requireDb();
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare('SELECT created_at FROM diagnostics WHERE user_id = ? AND created_at >= ? ORDER BY created_at ASC')
    .all(userId, windowStart) as { created_at: string }[];
  const used = rows.length;
  if (used < limit) return { allowed: true, used, limit, retryAt: null };
  const oldest = Date.parse(rows[0].created_at);
  return {
    allowed: false,
    used,
    limit,
    retryAt: Number.isFinite(oldest) ? new Date(oldest + 60 * 60 * 1000).toISOString() : null,
  };
}
