/**
 * Сховище локального сервера: SQLite (вбудований `node:sqlite`) у каталозі даних. Вміст записів (`meta`, `payload`),
 * зображення й службовий стан зберігаються ЗАШИФРОВАНИМИ (AES-256-GCM, ключ із файлу-секрету, див. crypto.mjs); у відкритому
 * вигляді лишаються тільки службові поля для пошуку: id, власник, вид, ревізія, часові позначки, розмір.
 *
 * Кожен запит прив'язаний до власника з токена: чужий запис не видно й не змінити — він для власника просто «не знайдений».
 */
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { open, seal } from './crypto.mjs';

export class RevisionConflict extends Error {
  constructor(current) {
    super('Запис змінено з іншого місця.');
    this.current = current;
  }
}

const AUDIT_KEEP = 5000;

export class Db {
  /** @param {string} dataDir @param {Buffer} key 32-байтовий ключ даних */
  constructor(dataDir, key) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = path.join(dataDir, 'private-store.sqlite3');
    this.key = key;
    this.db = new DatabaseSync(this.file);
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* Windows: права керує Docker-том */
    }
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, size INTEGER NOT NULL, meta TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS docs_owner ON docs(owner_id, kind, updated_at DESC);
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, doc_id TEXT, mime TEXT NOT NULL, size INTEGER NOT NULL,
        created_at TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assets_doc ON assets(owner_id, doc_id);
      CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, event TEXT NOT NULL, subject TEXT, ref TEXT, detail TEXT);
    `);
  }

  close() {
    this.db.close();
  }

  // ---- службовий стан (ключ сервера, звʼязок зі Studio): зашифрований ---------------------------------------------------
  getState(name) {
    const row = this.db.prepare('SELECT v FROM state WHERE k = ?').get(name);
    return row ? JSON.parse(open(this.key, row.v, `state:${name}`).toString('utf8')) : null;
  }

  setState(name, value) {
    this.db.prepare('INSERT INTO state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(name, seal(this.key, JSON.stringify(value), `state:${name}`));
  }

  // ---- записи -------------------------------------------------------------------------------------------------------
  listDocs(owner, kind) {
    const rows = kind
      ? this.db.prepare('SELECT * FROM docs WHERE owner_id = ? AND kind = ? ORDER BY updated_at DESC').all(owner, kind)
      : this.db.prepare('SELECT * FROM docs WHERE owner_id = ? ORDER BY updated_at DESC').all(owner);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      revision: r.revision,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      size: r.size,
      meta: JSON.parse(open(this.key, r.meta, `doc:${r.id}:meta`).toString('utf8')),
    }));
  }

  getDoc(owner, id) {
    const r = this.db.prepare('SELECT * FROM docs WHERE id = ? AND owner_id = ?').get(id, owner);
    if (!r) return null;
    return {
      id: r.id,
      kind: r.kind,
      revision: r.revision,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      size: r.size,
      meta: JSON.parse(open(this.key, r.meta, `doc:${r.id}:meta`).toString('utf8')),
      payload: JSON.parse(open(this.key, r.payload, `doc:${r.id}:payload`).toString('utf8')),
    };
  }

  /**
   * Створює чи оновлює запис. `expectedRevision` (число) — оптимістичне блокування: розбіжність кидає RevisionConflict.
   * Без нього запис просто перезаписується (так само поводиться дзеркало книги в Studio). Чужий id (інший власник) — «зайнятий».
   * @param {string} owner
   * @param {{ id: string, kind: string, meta?: object, payload: object, expectedRevision?: number }} doc
   * @param {Date} [now]
   */
  putDoc(owner, { id, kind, meta, payload, expectedRevision }, now = new Date()) {
    const at = now.toISOString();
    const payloadJson = JSON.stringify(payload);
    const existing = this.db.prepare('SELECT owner_id, kind, revision FROM docs WHERE id = ?').get(id);
    if (existing && existing.owner_id !== owner) throw Object.assign(new Error('Ідентифікатор зайнятий.'), { kind: 'id_taken' });
    if (existing && existing.kind !== kind) throw Object.assign(new Error('Вид запису змінити не можна.'), { kind: 'kind_mismatch' });
    if (existing && Number.isInteger(expectedRevision) && expectedRevision !== existing.revision) throw new RevisionConflict(existing.revision);
    const revision = existing ? existing.revision + 1 : 1;
    const sealedMeta = seal(this.key, JSON.stringify(meta ?? {}), `doc:${id}:meta`);
    const sealedPayload = seal(this.key, payloadJson, `doc:${id}:payload`);
    if (existing) {
      this.db.prepare('UPDATE docs SET revision = ?, updated_at = ?, size = ?, meta = ?, payload = ? WHERE id = ? AND owner_id = ?').run(revision, at, payloadJson.length, sealedMeta, sealedPayload, id, owner);
    } else {
      this.db.prepare('INSERT INTO docs (id, owner_id, kind, revision, created_at, updated_at, size, meta, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, owner, kind, revision, at, at, payloadJson.length, sealedMeta, sealedPayload);
    }
    return { revision, updatedAt: at, created: !existing };
  }

  deleteDoc(owner, id) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM assets WHERE owner_id = ? AND doc_id = ?').run(owner, id);
      const res = this.db.prepare('DELETE FROM docs WHERE id = ? AND owner_id = ?').run(id, owner);
      this.db.exec('COMMIT');
      return Number(res.changes) > 0;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- зображення ------------------------------------------------------------------------------------------------------
  /**
   * @param {string} owner
   * @param {{ id: string, docId?: string|null, mime: string, bytes: Buffer }} asset
   * @param {Date} [now]
   */
  putAsset(owner, { id, docId, mime, bytes }, now = new Date()) {
    const existing = this.db.prepare('SELECT owner_id FROM assets WHERE id = ?').get(id);
    if (existing && existing.owner_id !== owner) throw Object.assign(new Error('Ідентифікатор зайнятий.'), { kind: 'id_taken' });
    const sealed = seal(this.key, bytes, `asset:${id}`);
    this.db.prepare('INSERT INTO assets (id, owner_id, doc_id, mime, size, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc_id = excluded.doc_id, mime = excluded.mime, size = excluded.size, data = excluded.data')
      .run(id, owner, docId ?? null, mime, bytes.length, now.toISOString(), sealed);
  }

  getAsset(owner, id) {
    const r = this.db.prepare('SELECT * FROM assets WHERE id = ? AND owner_id = ?').get(id, owner);
    return r ? { id: r.id, docId: r.doc_id, mime: r.mime, size: r.size, bytes: open(this.key, r.data, `asset:${r.id}`) } : null;
  }

  deleteAsset(owner, id) {
    return Number(this.db.prepare('DELETE FROM assets WHERE id = ? AND owner_id = ?').run(id, owner).changes) > 0;
  }

  stats(owner) {
    const d = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM docs WHERE owner_id = ?').get(owner);
    const a = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM assets WHERE owner_id = ?').get(owner);
    return { docs: Number(d.n), docBytes: Number(d.bytes), assets: Number(a.n), assetBytes: Number(a.bytes) };
  }

  totals() {
    const d = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM docs').get();
    const a = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM assets').get();
    return { docs: Number(d.n), assets: Number(a.n), bytes: Number(d.bytes) + Number(a.bytes) };
  }

  // ---- журнал подій: лише службові дані, без вмісту --------------------------------------------------------------------
  audit(event, { subject = null, ref = null, detail = null } = {}, now = new Date()) {
    this.db.prepare('INSERT INTO audit (at, event, subject, ref, detail) VALUES (?, ?, ?, ?, ?)').run(now.toISOString(), event, subject, ref, detail ? String(detail).slice(0, 200) : null);
    this.db.prepare('DELETE FROM audit WHERE id <= (SELECT MAX(id) FROM audit) - ?').run(AUDIT_KEEP);
  }

  recentAudit(limit = 50) {
    return this.db.prepare('SELECT at, event, subject, ref, detail FROM audit ORDER BY id DESC LIMIT ?').all(Math.min(500, limit));
  }
}
