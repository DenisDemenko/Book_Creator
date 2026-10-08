/** T7.6: exact approved assets become canon only by an audited, separately authorized action. */
import { randomUUID } from "node:crypto";
import type { Express, Request } from "express";
import type { CollaborationAiDeps } from "../collaboration/aiCollaboration";
import {
  resolveEffectiveAccess,
  canRead,
  entityLevel,
  assetLevel,
  sceneLevel,
} from "../collaboration/access";
import { getBook } from "../../bookStore";
import {
  getAsset,
  listAssets,
  readAsset,
  type MediaAsset,
} from "../../media/mediaLibraryStore";
import { creativeProjectDb } from "./projects";
import { getDb } from "../../db";
import { WorkspaceError } from "../collaboration/workspaceStore";
import {
  BibleInputError,
  BIBLE_CATEGORIES,
  VISUAL_FIELDS,
  STYLE_FIELDS,
  normalizeRules,
  type BibleEntry,
  type StyleVersion,
} from "../../../shared/creativeBible";
const initialized = new WeakSet<object>();
function db() {
  const c = creativeProjectDb();
  if (c !== getDb())
    throw new WorkspaceError(
      503,
      "Visual Bible потребує спільного SQLite-сховища книги й медіатеки.",
    );
  if (!initialized.has(c)) {
    c.exec(`
 CREATE TABLE IF NOT EXISTS creative_bible_entries(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,asset_id TEXT NOT NULL,entity_id TEXT,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS creative_bible_book ON creative_bible_entries(book_id);
 CREATE UNIQUE INDEX IF NOT EXISTS creative_bible_active_asset ON creative_bible_entries(asset_id) WHERE json_extract(payload,'$.active')=1;
 CREATE TABLE IF NOT EXISTS creative_style_versions(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(book_id,version));
 CREATE TABLE IF NOT EXISTS creative_style_active(book_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,version_id TEXT);
 CREATE TABLE IF NOT EXISTS creative_bible_audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,book_id TEXT NOT NULL,payload TEXT NOT NULL);`);
    initialized.add(c);
  }
  return c;
}
function entries(book: string): BibleEntry[] {
  return db()
    .prepare(
      "SELECT payload FROM creative_bible_entries WHERE book_id=? ORDER BY rowid",
    )
    .all(book)
    .map((r: any) => JSON.parse(r.payload));
}
function styles(book: string): StyleVersion[] {
  return db()
    .prepare(
      "SELECT payload FROM creative_style_versions WHERE book_id=? ORDER BY version DESC",
    )
    .all(book)
    .map((r: any) => JSON.parse(r.payload));
}
function active(book: string) {
  return (
    (db()
      .prepare(
        "SELECT revision,version_id AS versionId FROM creative_style_active WHERE book_id=?",
      )
      .get(book) as
      { revision: number; versionId: string | null } | undefined) ?? {
      revision: 0,
      versionId: null,
    }
  );
}
function audit(book: string, user: string, action: string, details: unknown) {
  db()
    .prepare("INSERT INTO creative_bible_audit(book_id,payload) VALUES(?,?)")
    .run(
      book,
      JSON.stringify({
        id: randomUUID(),
        by: user,
        at: new Date().toISOString(),
        action,
        details,
      }),
    );
}
function transaction<T>(fn: () => T): T {
  const c = db();
  c.exec("BEGIN IMMEDIATE");
  try {
    const v = fn();
    c.exec("COMMIT");
    return v;
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }
}
async function scope(
  d: CollaborationAiDeps,
  user: string,
  bookId: string,
  module: "visual" | "style",
  manage = false,
) {
  const principal = user ? await d.principal(user) : null;
  if (!principal || principal.isGuest || (principal as any).disabled)
    throw new WorkspaceError(401, "Увійдіть у систему.");
  const book = await getBook(bookId),
    repo = d.repo();
  if (!book) throw new WorkspaceError(404, "Книгу не знайдено.");
  if (!repo) throw new WorkspaceError(503, "Ядро недоступне.");
  const owner = book.ownerId === user;
  const eff = await resolveEffectiveAccess(repo, {
    projectId: bookId,
    userId: user,
    isOwner: owner,
    isAdmin: false,
  });
  const level = owner
    ? "manage"
    : ((module === "visual"
        ? eff.visualBibles?.[bookId]
        : eff.styleBibles?.[bookId]) ?? "none");
  if (manage ? level !== "manage" : !canRead(level))
    throw new WorkspaceError(
      403,
      manage
        ? "Потрібен окремий дозвіл MANAGE на цей розділ."
        : "Немає доступу до цього розділу.",
    );
  return { book, repo, eff, owner, level, user };
}
async function ensureUnchangedScope(
  d: CollaborationAiDeps,
  s: Awaited<ReturnType<typeof scope>>,
  module: "visual" | "style",
  manage = false,
) {
  const fresh = await scope(d, s.user, s.book.id, module, manage);
  if (
    fresh.book.ownerId !== s.book.ownerId ||
    fresh.level !== s.level ||
    JSON.stringify(fresh.eff) !== JSON.stringify(s.eff)
  )
    throw new WorkspaceError(409, "Доступ змінився. Повторіть запит.");
  return fresh;
}
async function visible(s: Awaited<ReturnType<typeof scope>>, e: BibleEntry) {
  if (e.entityId) {
    const entity = await s.repo.getEntity(s.book.id, e.entityId);
    if (!entity || !canRead(entityLevel(s.eff, entity.type, entity.id)))
      return false;
  }
  return canRead(assetLevel(s.eff, e.assetId));
}
function allowedScenes(s: Awaited<ReturnType<typeof scope>>, ids: string[]) {
  const allowed = new Set<string>();
  const chapters = Array.isArray(s.book.book.chapters)
    ? s.book.book.chapters
    : [];
  for (const c of chapters)
    for (const section of Array.isArray(c?.sections) ? c.sections : [])
      if (
        typeof c?.id === "string" &&
        typeof section?.id === "string" &&
        canRead(sceneLevel(s.eff, c.id, section.id))
      )
        allowed.add(section.id);
  return ids.filter((id) => allowed.has(id));
}
function confirm(q: Request) {
  if (q.body?.confirmed !== true)
    throw new WorkspaceError(422, "Підтвердіть окрему дію.");
}
function text(v: unknown, label: string, max = 160) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new WorkspaceError(422, `Некоректне поле «${label}».`);
  return v.trim();
}
function setCanon(
  a: MediaAsset,
  status: "CANON" | "APPROVED",
  user: string,
  at: string,
  expected: number,
) {
  const next = {
    ...a.provenance,
    revision: expected + 1,
    status,
    canon: status === "CANON" ? { by: user, at } : null,
  };
  const r = db()
    .prepare(
      "UPDATE media_assets SET provenance=? WHERE id=? AND COALESCE(json_extract(provenance,'$.revision'),1)=?",
    )
    .run(JSON.stringify(next), a.id, expected) as { changes: number };
  if (r.changes !== 1)
    throw new WorkspaceError(409, "Метадані змінилися. Оновіть список.");
  db()
    .prepare(
      "INSERT INTO media_asset_history(asset_id,root_id,owner_id,at,actor,action,details) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      a.id,
      a.rootId,
      a.ownerId,
      at,
      `user:${user}`,
      "provenance",
      JSON.stringify({ before: a.provenance, after: next }),
    );
}
/** Private file authorization stays narrower than module access: also needs entity and asset scope. */
export async function canReadBibleAsset(
  d: CollaborationAiDeps,
  user: string,
  a: MediaAsset,
) {
  try {
    if (!a.bookId) return false;
    const s = await scope(d, user, a.bookId, "visual");
    const permitted = (
      await Promise.all(
        entries(a.bookId)
          .filter((e) => e.active && e.assetId === a.id)
          .map((e) => visible(s, e)),
      )
    ).some(Boolean);
    if (permitted) await ensureUnchangedScope(d, s, "visual");
    return permitted;
  } catch {
    return false;
  }
}
export function registerCreativeBibleRoutes(
  app: Express,
  d: CollaborationAiDeps,
) {
  const prefix = "/api/creative/bible/:bookId";
  const route = (
    method: "get" | "post",
    suffix: string,
    fn: (q: Request) => Promise<unknown>,
  ) =>
    app[method](prefix + suffix, async (q, r) => {
      try {
        if (q.principal?.isGuest)
          throw new WorkspaceError(401, "Увійдіть у систему.");
        const out = await fn(q);
        r.setHeader("Cache-Control", "private, no-store");
        r.json(out);
      } catch (e) {
        r.status(
          e instanceof WorkspaceError
            ? e.status
            : e instanceof BibleInputError
              ? 422
              : 500,
        ).json({
          error:
            e instanceof WorkspaceError || e instanceof BibleInputError
              ? e.message
              : "Не вдалося виконати дію Visual Bible.",
        });
      }
    });
  route("get", "", async (q) => {
    const s = await scope(
      d,
      q.principal?.id ?? "",
      String(q.params.bookId),
      "visual",
    );
    const all = entries(s.book.id),
      allowed: BibleEntry[] = [];
    for (const e of all) if (await visible(s, e)) allowed.push(e);
    const entities = (await s.repo.listEntities(s.book.id))
      .filter(
        (e) =>
          e.status !== "rejected" && canRead(entityLevel(s.eff, e.type, e.id)),
      )
      .map((e) => ({ id: e.id, type: e.type, name: e.name }));
    const allowedIds = new Set(entities.map((e) => e.id));
    const appearances = (await s.repo.listAppearanceVersions(s.book.id)).filter(
      (v) => allowedIds.has(v.entityId) && v.approved,
    );
    const links = (await s.repo.listAssetLinks(s.book.id)).filter(
      (l) =>
        canRead(assetLevel(s.eff, l.assetId ?? "")) &&
        (!l.entityId || allowedIds.has(l.entityId)) &&
        l.status === "confirmed" &&
        !l.needsReview,
    );
    const assets =
      s.level === "manage"
        ? (await listAssets(s.book.ownerId, { bookId: s.book.id }))
            .filter(
              (a) =>
                a.provenance.status === "APPROVED" &&
                a.provenance.approval &&
                canRead(assetLevel(s.eff, a.id)),
            )
            .map((a) => ({
              id: a.id,
              title: a.title || a.filename,
              version: a.version,
              revision: a.provenance.revision,
              url: a.url,
            }))
        : [];
    // Never return raw prompts, manuscript, hidden linked IDs, or full file passport to participants.
    await ensureUnchangedScope(d, s, "visual");
    return {
      bookId: s.book.id,
      title: s.book.book.title,
      entries: allowed
        .filter((e) => e.active)
        .map((e) => ({
          ...e,
          sceneIds: allowedScenes(s, e.sceneIds ?? []),
          snapshot: s.owner
            ? e.snapshot
            : {
                assetVersion: e.snapshot.assetVersion,
                mimeType: e.snapshot.mimeType,
                provenance: null,
                appearance: e.snapshot.appearance,
                link: null,
              },
        })),
      entities,
      appearances,
      links: links.map((l) => ({
        id: l.id,
        assetId: l.assetId,
        entityId: l.entityId,
        appearanceVersionId: l.appearanceVersionId,
        role: l.role,
      })),
      assets,
      permissions: { manage: s.level === "manage" },
      history: s.owner ? all : [],
      audit: s.owner
        ? db()
            .prepare(
              "SELECT payload FROM creative_bible_audit WHERE book_id=? ORDER BY seq DESC LIMIT 100",
            )
            .all(s.book.id)
            .map((x: any) => JSON.parse(x.payload))
        : [],
    };
  });
  route("post", "/canon", async (q) => {
    confirm(q);
    let s = await scope(
      d,
      q.principal?.id ?? "",
      String(q.params.bookId),
      "visual",
      true,
    );
    const a = await getAsset(text(q.body.assetId, "матеріал"));
    if (
      !a ||
      a.ownerId !== s.book.ownerId ||
      a.bookId !== s.book.id ||
      !canRead(assetLevel(s.eff, a.id))
    )
      throw new WorkspaceError(404, "Матеріал недоступний.");
    if (a.provenance.status !== "APPROVED" || !a.provenance.approval)
      throw new WorkspaceError(
        422,
        "У канон можна додати лише окремо затверджений матеріал.",
      );
    if (q.body.expectedRevision !== a.provenance.revision)
      throw new WorkspaceError(409, "Метадані змінилися.");
    const category = q.body.category;
    if (!BIBLE_CATEGORIES.includes(category))
      throw new WorkspaceError(422, "Невідома категорія.");
    const entityId = q.body.entityId || null;
    let entity = null;
    if (entityId) {
      entity = await s.repo.getEntity(s.book.id, String(entityId));
      if (
        !entity ||
        entity.status === "rejected" ||
        !canRead(entityLevel(s.eff, entity.type, entity.id))
      )
        throw new WorkspaceError(422, "Сутність недоступна.");
      if (
        ["character", "location", "object"].includes(category) &&
        entity.type !== category
      )
        throw new WorkspaceError(422, "Категорія не відповідає сутності.");
    }
    if (["character", "location", "object"].includes(category) && !entity)
      throw new WorkspaceError(422, "Виберіть сутність для цієї категорії.");
    const link = q.body.linkId
      ? await s.repo.getAssetLink(s.book.id, String(q.body.linkId))
      : null;
    if (
      entity &&
      (!link ||
        link.assetId !== a.id ||
        link.entityId !== entityId ||
        link.status !== "confirmed" ||
        link.needsReview)
    )
      throw new WorkspaceError(
        422,
        "Спочатку підтвердіть зв’язок матеріалу з сутністю у медіатеці.",
      );
    if (!entity && q.body.linkId)
      throw new WorkspaceError(422, "Зв’язок без сутності не приймається.");
    const appearance = link?.appearanceVersionId
      ? await s.repo.getAppearanceVersion(s.book.id, link.appearanceVersionId)
      : null;
    if (
      link?.appearanceVersionId &&
      (!appearance?.approved || appearance.entityId !== entityId)
    )
      throw new WorkspaceError(422, "Версію зовнішності не затверджено.");
    if (!(await readAsset(a.id)))
      throw new WorkspaceError(410, "Файл матеріалу відсутній.");
    const rules = normalizeRules(q.body.rules ?? {}, VISUAL_FIELDS),
      title = text(q.body.title, "назва");
    s = await scope(d, s.user, s.book.id, "visual", true);
    if (
      (entity && !canRead(entityLevel(s.eff, entity.type, entity.id))) ||
      !canRead(assetLevel(s.eff, a.id))
    )
      throw new WorkspaceError(403, "Доступ змінився.");
    // Recheck mutable Core references after IO; SQLite snapshot is then synchronous.
    if (link) {
      const fresh = await s.repo.getAssetLink(s.book.id, link.id);
      if (!fresh || JSON.stringify(fresh) !== JSON.stringify(link))
        throw new WorkspaceError(409, "Зв’язок змінився.");
    }
    if (appearance) {
      const fresh = await s.repo.getAppearanceVersion(s.book.id, appearance.id);
      if (!fresh || JSON.stringify(fresh) !== JSON.stringify(appearance))
        throw new WorkspaceError(409, "Зовнішність змінилася.");
    }
    s = await scope(d, s.user, s.book.id, "visual", true);
    if (
      s.book.ownerId !== a.ownerId ||
      !canRead(assetLevel(s.eff, a.id)) ||
      (entity && !canRead(entityLevel(s.eff, entity.type, entity.id)))
    )
      throw new WorkspaceError(403, "Доступ змінився.");
    const e: BibleEntry = {
      id: randomUUID(),
      bookId: s.book.id,
      category,
      entityId,
      assetId: a.id,
      linkId: link?.id ?? null,
      appearanceVersionId: appearance?.id ?? null,
      title,
      master: q.body.master === true,
      rules,
      revision: 1,
      active: true,
      addedBy: s.user,
      addedAt: new Date().toISOString(),
      removedBy: null,
      removedAt: null,
      styleVersionId: active(s.book.id).versionId,
      sceneIds: allowedScenes(s, a.provenance.sceneIds),
      snapshot: {
        assetVersion: a.version,
        mimeType: a.mimeType,
        provenance: a.provenance,
        appearance,
        link,
      },
    };
    transaction(() => {
      if (
        e.master &&
        entries(s.book.id).some(
          (x) =>
            x.active &&
            x.master &&
            x.category === e.category &&
            x.entityId === e.entityId,
        )
      )
        throw new WorkspaceError(
          409,
          "Головний образ уже існує. Спочатку вилучіть його з канону.",
        );
      if (entries(s.book.id).some((x) => x.active && x.assetId === a.id))
        throw new WorkspaceError(409, "Матеріал уже в каноні.");
      setCanon(a, "CANON", s.user, e.addedAt, q.body.expectedRevision);
      db()
        .prepare(
          "INSERT INTO creative_bible_entries(id,book_id,asset_id,entity_id,payload) VALUES(?,?,?,?,?)",
        )
        .run(e.id, e.bookId, e.assetId, e.entityId, JSON.stringify(e));
      audit(e.bookId, s.user, "canon_added", { entry: e });
    });
    return { entry: e };
  });
  route("post", "/canon/:entryId/remove", async (q) => {
    confirm(q);
    const s = await scope(
      d,
      q.principal?.id ?? "",
      String(q.params.bookId),
      "visual",
      true,
    );
    const e = entries(s.book.id).find((e) => e.id === q.params.entryId);
    if (!e || !(await visible(s, e)))
      throw new WorkspaceError(404, "Запис недоступний.");
    const reason = text(q.body.reason, "причина", 1000),
      a = await getAsset(e.assetId);
    if (!a) throw new WorkspaceError(410, "Матеріал відсутній.");
    await ensureUnchangedScope(d, s, "visual", true);
    const next = {
      ...e,
      active: false,
      revision: e.revision + 1,
      removedBy: s.user,
      removedAt: new Date().toISOString(),
    };
    transaction(() => {
      const fresh = entries(s.book.id).find((x) => x.id === e.id);
      if (!fresh?.active || fresh.revision !== q.body.expectedRevision)
        throw new WorkspaceError(409, "Канон змінився.");
      setCanon(a, "APPROVED", s.user, next.removedAt, a.provenance.revision);
      db()
        .prepare("UPDATE creative_bible_entries SET payload=? WHERE id=?")
        .run(JSON.stringify(next), e.id);
      audit(s.book.id, s.user, "canon_removed", {
        before: e,
        after: next,
        reason,
      });
    });
    return { entry: next };
  });
  route("get", "/style", async (q) => {
    const s = await scope(
      d,
      q.principal?.id ?? "",
      String(q.params.bookId),
      "style",
    );
    const versions = styles(s.book.id);
    await ensureUnchangedScope(d, s, "style");
    return {
      versions,
      active: active(s.book.id),
      permissions: { manage: s.level === "manage" },
    };
  });
  route("post", "/style/versions", async (q) => {
    confirm(q);
    const s = await scope(
      d,
      q.principal?.id ?? "",
      String(q.params.bookId),
      "style",
      true,
    );
    const rules = normalizeRules(q.body.rules ?? {}, STYLE_FIELDS),
      title = text(q.body.title, "назва");
    if (!Object.values(rules).some(Boolean))
      throw new WorkspaceError(422, "Заповніть правила стилю.");
    const v: StyleVersion = {
      id: randomUUID(),
      bookId: s.book.id,
      version: 0,
      title,
      rules,
      createdBy: s.user,
      createdAt: new Date().toISOString(),
    };
    transaction(() => {
      v.version = (styles(s.book.id)[0]?.version ?? 0) + 1;
      db()
        .prepare(
          "INSERT INTO creative_style_versions(id,book_id,version,payload) VALUES(?,?,?,?)",
        )
        .run(v.id, v.bookId, v.version, JSON.stringify(v));
      audit(s.book.id, s.user, "style_version_created", { version: v });
    });
    return { version: v };
  });
  route("post", "/style/activate", async (q) => {
    confirm(q);
    const s = await scope(
      d,
      q.principal?.id ?? "",
      String(q.params.bookId),
      "style",
      true,
    );
    const v = styles(s.book.id).find((v) => v.id === q.body.versionId);
    if (!v) throw new WorkspaceError(404, "Версію стилю не знайдено.");
    transaction(() => {
      const before = active(s.book.id);
      if (before.revision !== q.body.expectedRevision)
        throw new WorkspaceError(409, "Активний стиль змінився.");
      db()
        .prepare(
          "INSERT INTO creative_style_active(book_id,revision,version_id) VALUES(?,?,?) ON CONFLICT(book_id) DO UPDATE SET revision=excluded.revision,version_id=excluded.version_id",
        )
        .run(s.book.id, before.revision + 1, v.id);
      audit(s.book.id, s.user, "style_activated", {
        before,
        after: { revision: before.revision + 1, versionId: v.id },
      });
    });
    return { active: active(s.book.id) };
  });
  route("get", "/context", async (q) => {
    const s = await scope(
      d,
      q.principal?.id ?? "",
      String(q.params.bookId),
      "style",
    );
    const visual = await scope(d, s.user, s.book.id, "visual");
    const refs = [];
    for (const e of entries(s.book.id))
      if (e.active && (await visible(visual, e)))
        refs.push({
          entryId: e.id,
          category: e.category,
          entityId: e.entityId,
          assetId: e.assetId,
          assetVersion: e.snapshot.assetVersion,
          appearanceVersionId: e.appearanceVersionId,
          master: e.master,
          rules: e.rules,
          styleVersionId: e.styleVersionId,
          sceneIds: allowedScenes(visual, e.sceneIds ?? []),
        });
    await ensureUnchangedScope(d, s, "style");
    await ensureUnchangedScope(d, visual, "visual");
    return {
      schema: 1,
      bookId: s.book.id,
      style:
        styles(s.book.id).find((v) => v.id === active(s.book.id).versionId) ??
        null,
      references: refs,
    };
  });
}
