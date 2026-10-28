/**
 * Сховище чернеток за фото (GrabFusion, контракт docs/photo-drafts-api.md).
 *
 * Чернетка — один документ: кадри, описи викладача, структура, припущення ШІ
 * змінюються разом і завжди читаються цілком. Тому в SQLite вона лежить одним
 * JSON-рядком, а статус і ревізія винесені в колонки для переліку й лічильників.
 * Контракт як у решті сховищ: SQLite основний, JSON у DATA_DIR — запасний.
 *
 * ЗАПИС ЛИШЕ ЧЕРЕЗ mutateDraft. Чернетку змінюють і запити застосунку, і фонові
 * проходи ШІ (опис кадру закінчується, поки викладач уже додає наступний).
 * «Прочитати — змінити — записати» без черги загубило б одну з двох змін, тож
 * кожна чернетка має власну чергу змін у межах процесу.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, isAvailable, DATA_DIR } from '../db';
import type {
  DraftAssumption,
  DraftJob,
  DraftNote,
  DraftPhoto,
  DraftStructure,
  PhotoDraftKind,
  PhotoDraftLevel,
  PhotoDraftStatus,
  SubmitTarget,
} from '../../shared/photoDraftContract';

/** Кадр, як він лежить на сервері: публічні поля + де саме фото в медіатеці. */
export interface StoredPhoto extends Omit<DraftPhoto, 'imageUrl'> {
  assetId: string;
  mimeType: string;
  modelId: string | null;
}

export interface StoredDraft {
  id: string;
  ownerId: string;
  kind: PhotoDraftKind;
  status: PhotoDraftStatus;
  revision: number;
  title: string | null;
  craft: string | null;
  audience: string | null;
  level: PhotoDraftLevel | null;
  bookId: string | null;
  photos: StoredPhoto[];
  notes: DraftNote[];
  structure: DraftStructure | null;
  assumptions: DraftAssumption[];
  job: DraftJob | null;
  submitted: SubmitTarget | null;
  /** Яким токеном створено — для журналу, назовні не йде. */
  tokenId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function newPhotoDraftId(): string {
  return `pd_${crypto.randomBytes(6).toString('hex')}`;
}

export function newPhotoId(): string {
  return `ph_${crypto.randomBytes(5).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// JSON-бекенд
// ---------------------------------------------------------------------------

const JSON_FILE = 'photo-drafts.json';
let jsonCache: { drafts: StoredDraft[] } | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function useJson(): boolean {
  return !isAvailable();
}

async function loadJson(): Promise<{ drafts: StoredDraft[] }> {
  if (jsonCache) return jsonCache;
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(DATA_DIR, JSON_FILE), 'utf8'));
    jsonCache = { drafts: Array.isArray(parsed?.drafts) ? parsed.drafts : [] };
  } catch {
    jsonCache = { drafts: [] };
  }
  return jsonCache;
}

function persistJson(): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const target = path.join(DATA_DIR, JSON_FILE);
      const temp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(jsonCache, null, 2), 'utf8');
      await fs.rename(temp, target);
    })
    .catch((err) => console.error('[photoDrafts] Не вдалося зберегти photo-drafts.json:', err));
  return writeChain as Promise<void>;
}

/** Лише для тестів: скидає кеш JSON-бекенду. */
export function __resetPhotoDraftCacheForTests(): void {
  jsonCache = null;
}

// ---------------------------------------------------------------------------
// Читання
// ---------------------------------------------------------------------------

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fromRow(row: any): StoredDraft {
  const payload = JSON.parse(String(row.payload)) as StoredDraft;
  return { ...payload, id: String(row.id), ownerId: String(row.owner_id), revision: Number(row.revision) };
}

/** Чернетка власника. Чужа або неіснуюча — `null` (маршрут відповідає 404). */
export async function getDraft(id: string, ownerId: string): Promise<StoredDraft | null> {
  if (!id || !ownerId) return null;
  if (useJson()) {
    const found = (await loadJson()).drafts.find((d) => d.id === id && d.ownerId === ownerId);
    return found ? clone(found) : null;
  }
  const row = getDb()!.prepare('SELECT * FROM photo_drafts WHERE id = ? AND owner_id = ?').get(id, ownerId);
  return row ? fromRow(row) : null;
}

/** Усі чернетки власника, новіші перші. */
export async function listDrafts(ownerId: string): Promise<StoredDraft[]> {
  if (!ownerId) return [];
  if (useJson()) {
    return (await loadJson()).drafts
      .filter((d) => d.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone);
  }
  const rows = getDb()!.prepare('SELECT * FROM photo_drafts WHERE owner_id = ? ORDER BY updated_at DESC').all(ownerId);
  return (rows as any[]).map(fromRow);
}

/** Чернетки, що ще не відправлені й не відкинуті. */
export async function countOpenDrafts(ownerId: string): Promise<number> {
  return (await listDrafts(ownerId)).filter((d) => d.status !== 'submitted' && d.status !== 'discarded').length;
}

/** Скільки фото автор додав з моменту `sinceIso` — для ліміту на годину. */
export async function countPhotosSince(ownerId: string, sinceIso: string): Promise<number> {
  let drafts: StoredDraft[];
  if (useJson()) {
    drafts = (await loadJson()).drafts.filter((d) => d.ownerId === ownerId && d.updatedAt >= sinceIso);
  } else {
    drafts = (getDb()!
      .prepare('SELECT * FROM photo_drafts WHERE owner_id = ? AND updated_at >= ?')
      .all(ownerId, sinceIso) as any[]).map(fromRow);
  }
  return drafts.reduce((sum, d) => sum + d.photos.filter((p) => p.createdAt >= sinceIso).length, 0);
}

// ---------------------------------------------------------------------------
// Запис
// ---------------------------------------------------------------------------

async function write(draft: StoredDraft, isNew: boolean): Promise<void> {
  if (useJson()) {
    const data = await loadJson();
    const index = data.drafts.findIndex((d) => d.id === draft.id);
    if (index >= 0) data.drafts[index] = clone(draft);
    else data.drafts.push(clone(draft));
    await persistJson();
    return;
  }
  const db = getDb()!;
  const payload = JSON.stringify(draft);
  if (isNew) {
    db.prepare(
      `INSERT INTO photo_drafts (id, owner_id, kind, status, revision, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(draft.id, draft.ownerId, draft.kind, draft.status, draft.revision, payload, draft.createdAt, draft.updatedAt);
  } else {
    db.prepare('UPDATE photo_drafts SET status = ?, revision = ?, payload = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(
      draft.status,
      draft.revision,
      payload,
      draft.updatedAt,
      draft.id,
      draft.ownerId
    );
  }
}

export async function insertDraft(draft: StoredDraft): Promise<StoredDraft> {
  await write(draft, true);
  return clone(draft);
}

const queues = new Map<string, Promise<unknown>>();

/** Черга змін однієї чернетки: наступна зміна читає вже записаний результат попередньої. */
function enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  queues.set(id, tail);
  void tail.then(() => {
    if (queues.get(id) === tail) queues.delete(id);
  });
  return run;
}

/** Відмова всередині зміни: маршрут перетворює її на `{ error, kind }`. */
export class DraftChangeError extends Error {
  constructor(
    public status: number,
    public kind: string,
    message: string
  ) {
    super(message);
    this.name = 'DraftChangeError';
  }
}

/**
 * Змінити чернетку. `change` мутує копію; кинута DraftChangeError скасовує зміну.
 * `byTeacher` — дія викладача: ревізія +1. Фонові результати ШІ ревізію не
 * змінюють (див. контракт), але `updatedAt` оновлюють.
 * Повертає `null`, якщо чернетки немає або вона чужа.
 */
export async function mutateDraft<T>(
  id: string,
  ownerId: string,
  change: (draft: StoredDraft) => T | Promise<T>,
  options: { byTeacher: boolean; now?: () => Date }
): Promise<{ draft: StoredDraft; result: T } | null> {
  return enqueue(id, async () => {
    const draft = await getDraft(id, ownerId);
    if (!draft) return null;
    const result = await change(draft);
    if (options.byTeacher) draft.revision += 1;
    draft.updatedAt = (options.now?.() ?? new Date()).toISOString();
    await write(draft, false);
    return { draft: clone(draft), result };
  });
}
