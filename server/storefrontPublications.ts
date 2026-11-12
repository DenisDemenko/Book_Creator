/**
 * Журнал публікацій у вітрину Fusion Lab (журнал #554).
 *
 * ЩО ЦЕ ВИРІШУЄ. До цього Studio відправляла книгу, курс чи товар у вітрину — і забувала про це: лишався
 * лише `externalId` у відповіді мосту. На питання «яка версія книги зараз у вітрині і коли її туди поклали»
 * відповіді не було ні в Studio, ні у вітрині (там `publishedAt` ставиться лише при створенні лістингу й
 * більше не змінюється). Тут зберігається кожна спроба: що, якою версією, коли, хто натиснув і що відповів міст.
 *
 * Невдала спроба теж записується — інакше «ми публікували, але нічого не з'явилось» лишалося б без сліду.
 *
 * Номер публікації рахується в межах (вид, джерело, формат): для книги друкована й електронна версії —
 * це два різні лістинги у вітрині, тож і нумерація в них окрема.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from './db';

/**
 * Що саме публікували. `instruction` — окремий вид у ЖУРНАЛІ, хоч у вітрині
 * воно стає книгою (рішення власника 12.11.2026, запис #556): журнал має
 * відповідати на «що ми публікували», а не на «як це виглядає у вітрині»,
 * інакше інструкції розчинилися б серед книг і їх облік був би неможливий.
 */
export type PublicationKind = 'book' | 'course' | 'product' | 'instruction';
export type PublicationStatus = 'ok' | 'failed';

export interface PublicationRecord {
  id: string;
  kind: PublicationKind;
  sourceId: string;
  /** Для книг: digital | print. Для курсів і товарів — null. */
  format: string | null;
  /** Порядковий номер публікації цього джерела: 1, 2, 3… */
  publicationNo: number;
  /** Версія джерела людською мовою: для книги — її власна версія (`v1.2.0`). */
  version: string | null;
  /** Ревізія джерела в Studio: зростає на кожне збереження. */
  sourceRevision: number | null;
  status: PublicationStatus;
  externalId: string | null;
  slug: string | null;
  /** true — лістинг створено, false — оновлено наявний. */
  created: boolean | null;
  error: string | null;
  actorId: string | null;
  title: string | null;
  at: string;
}

export interface PublicationInput {
  kind: PublicationKind;
  sourceId: string;
  format?: string | null;
  version?: string | null;
  sourceRevision?: number | null;
  title?: string | null;
  actorId?: string | null;
}

function database() {
  const db = getDb();
  if (!db) return null;
  db.exec(`CREATE TABLE IF NOT EXISTS storefront_publications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    format TEXT,
    publication_no INTEGER NOT NULL,
    version TEXT,
    source_revision INTEGER,
    status TEXT NOT NULL,
    external_id TEXT,
    slug TEXT,
    created INTEGER,
    error TEXT,
    actor_id TEXT,
    title TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_storefront_pub_source ON storefront_publications(kind, source_id, at DESC);
  CREATE INDEX IF NOT EXISTS idx_storefront_pub_at ON storefront_publications(at DESC);`);
  return db;
}

function toRecord(row: Record<string, any>): PublicationRecord {
  return {
    id: String(row.id),
    kind: row.kind,
    sourceId: String(row.source_id),
    format: row.format ?? null,
    publicationNo: Number(row.publication_no) || 1,
    version: row.version ?? null,
    sourceRevision: row.source_revision === null || row.source_revision === undefined ? null : Number(row.source_revision),
    status: row.status === 'failed' ? 'failed' : 'ok',
    externalId: row.external_id ?? null,
    slug: row.slug ?? null,
    created: row.created === null || row.created === undefined ? null : Number(row.created) === 1,
    error: row.error ?? null,
    actorId: row.actor_id ?? null,
    title: row.title ?? null,
    at: String(row.at),
  };
}

/** Наступний номер публікації для цього джерела й формату. Невдала спроба теж займає номер: так видно, що її робили. */
function nextNumber(kind: string, sourceId: string, format: string | null): number {
  const db = database();
  if (!db) return 1;
  const row = db
    .prepare('SELECT MAX(publication_no) AS n FROM storefront_publications WHERE kind = ? AND source_id = ? AND IFNULL(format, \'\') = ?')
    .get(kind, sourceId, format ?? '') as Record<string, any> | undefined;
  return (Number(row?.n) || 0) + 1;
}

export function recordPublication(
  input: PublicationInput & { status: PublicationStatus; externalId?: string | null; slug?: string | null; created?: boolean | null; error?: string | null },
  now = new Date()
): PublicationRecord | null {
  const db = database();
  if (!db) return null;
  const format = input.format ?? null;
  const record: PublicationRecord = {
    id: `pub_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    kind: input.kind,
    sourceId: String(input.sourceId),
    format,
    publicationNo: nextNumber(input.kind, String(input.sourceId), format),
    version: input.version ?? null,
    sourceRevision: input.sourceRevision ?? null,
    status: input.status,
    externalId: input.externalId ?? null,
    slug: input.slug ?? null,
    created: input.created ?? null,
    error: input.error ? String(input.error).slice(0, 500) : null,
    actorId: input.actorId ?? null,
    title: input.title ? String(input.title).slice(0, 200) : null,
    at: now.toISOString(),
  };
  db.prepare(
    `INSERT INTO storefront_publications (id, kind, source_id, format, publication_no, version, source_revision, status, external_id, slug, created, error, actor_id, title, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.kind,
    record.sourceId,
    record.format,
    record.publicationNo,
    record.version,
    record.sourceRevision,
    record.status,
    record.externalId,
    record.slug,
    record.created === null ? null : record.created ? 1 : 0,
    record.error,
    record.actorId,
    record.title,
    record.at
  );
  return record;
}

export function listPublications(filter: { kind?: PublicationKind; sourceId?: string; status?: PublicationStatus; limit?: number } = {}): PublicationRecord[] {
  const db = database();
  if (!db) return [];
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.kind) {
    where.push('kind = ?');
    args.push(filter.kind);
  }
  if (filter.sourceId) {
    where.push('source_id = ?');
    args.push(filter.sourceId);
  }
  if (filter.status) {
    where.push('status = ?');
    args.push(filter.status);
  }
  const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 500);
  const rows = db
    .prepare(`SELECT * FROM storefront_publications ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT ?`)
    .all(...args, limit) as Array<Record<string, any>>;
  return rows.map(toRecord);
}

/** Остання ВДАЛА публікація: саме її бачить покупець у вітрині. */
export function lastPublication(kind: PublicationKind, sourceId: string, format?: string | null): PublicationRecord | null {
  const db = database();
  if (!db) return null;
  const row = (
    format === undefined
      ? db.prepare("SELECT * FROM storefront_publications WHERE kind = ? AND source_id = ? AND status = 'ok' ORDER BY at DESC LIMIT 1").get(kind, sourceId)
      : db
          .prepare("SELECT * FROM storefront_publications WHERE kind = ? AND source_id = ? AND IFNULL(format, '') = ? AND status = 'ok' ORDER BY at DESC LIMIT 1")
          .get(kind, sourceId, format ?? '')
  ) as Record<string, any> | undefined;
  return row ? toRecord(row) : null;
}

/**
 * Обгортка навколо виклику мосту: записує і вдачу, і відмову, а помилку віддає далі незмінною.
 * Сам запис ніколи не ламає публікацію: якщо журнал не записався, це видно в логах, але товар уже у вітрині.
 */
export async function withPublicationJournal<T extends { externalId?: string; slug?: string; created?: boolean }>(
  input: PublicationInput,
  run: () => Promise<T>
): Promise<T> {
  try {
    const result = await run();
    try {
      recordPublication({ ...input, status: 'ok', externalId: result?.externalId ?? null, slug: result?.slug ?? null, created: result?.created ?? null });
    } catch (err) {
      console.error('[storefrontPublications] не вдалося записати публікацію:', err);
    }
    return result;
  } catch (err) {
    try {
      recordPublication({ ...input, status: 'failed', error: (err as Error)?.message || 'невідома помилка' });
    } catch (logErr) {
      console.error('[storefrontPublications] не вдалося записати невдалу публікацію:', logErr);
    }
    throw err;
  }
}
