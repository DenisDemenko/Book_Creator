/** Private T7.4 workspace. Files and revisions stay in Studio; approval is not canon. */
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { CollaborationAiDeps } from "../collaboration/aiCollaboration";
import { getBook } from "../../bookStore";
import { CoreRuleError } from "../rules";
import { restrictBook } from "../collaboration/accessView";
import {
  grantAccess,
  revokeAccess,
  resolveEffectiveAccess,
  visibleCharacterRefs,
} from "../collaboration/access";
import { WorkspaceError } from "../collaboration/workspaceStore";
import { creativeProjectDb, type CreativeProject } from "./projects";
import { getCreativeBrief } from "./briefs";
import {
  assetLevel,
  canRead,
  entityLevel,
  levelRank,
} from "../collaboration/access";
import { listAssets } from "../../media/mediaLibraryStore";
export const CREATIVE_ASSET_STATES = [
  "DRAFT",
  "SUBMITTED_FOR_REVIEW",
  "CHANGES_REQUESTED",
  "RESUBMITTED",
  "APPROVED",
  "FINAL",
  "REJECTED",
  "ARCHIVED",
] as const;
export interface CreativeAsset {
  id: string;
  projectId: string;
  rootId: string;
  parentId: string | null;
  version: number;
  revision: number;
  status: (typeof CREATIVE_ASSET_STATES)[number];
  filename: string;
  mimeType: string;
  bytes: number;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}
export interface CreativeAnnotation {
  id: string;
  assetId: string;
  authorId: string;
  text: string;
  x: number | null;
  y: number | null;
  timecode: number | null;
  status: "open" | "resolved";
  revision: number;
  createdAt: string;
  resolvedAt: string | null;
}
export interface CreativeWorkspaceDeps extends CollaborationAiDeps {
  chargeUpload?: (
    req: Request,
    bytes: number,
    bookId: string,
    filename: string,
  ) => Promise<void>;
  describeUser?: (userId: string) => Promise<string | null>;
}
const initialized = new WeakSet<object>();
export function creativeWorkspaceDb() {
  const db = creativeProjectDb();
  if (!initialized.has(db)) {
    db.exec(`CREATE TABLE IF NOT EXISTS creative_workspace_assets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,root_id TEXT NOT NULL,version INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,content BLOB NOT NULL,UNIQUE(project_id,root_id,version));
 CREATE TABLE IF NOT EXISTS creative_workspace_annotations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,asset_id TEXT NOT NULL REFERENCES creative_workspace_assets(id) ON DELETE CASCADE,revision INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS creative_workspace_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS creative_workspace_events_project ON creative_workspace_events(project_id,seq);
 CREATE TABLE IF NOT EXISTS creative_workspace_reads(project_id TEXT NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,user_id TEXT NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(project_id,user_id));`);
    initialized.add(db);
  }
  return db;
}
function text(v: unknown, max = 4000) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw new WorkspaceError(422, "Вкажіть текст допустимого розміру.");
  return v.trim();
}
function revision(v: unknown) {
  if (!Number.isInteger(v) || Number(v) < 1)
    throw new WorkspaceError(422, "Потрібна поточна ревізія.");
  return Number(v);
}
function asset(project: string, id: string): CreativeAsset {
  const row = creativeWorkspaceDb()
    .prepare(
      "SELECT payload FROM creative_workspace_assets WHERE project_id=? AND id=?",
    )
    .get(project, id) as any;
  if (!row) throw new WorkspaceError(404, "Матеріал не знайдено.");
  return JSON.parse(row.payload);
}
function assets(id: string): CreativeAsset[] {
  return creativeWorkspaceDb()
    .prepare(
      "SELECT payload FROM creative_workspace_assets WHERE project_id=? ORDER BY rowid DESC",
    )
    .all(id)
    .map((r: any) => JSON.parse(r.payload));
}
function event(
  id: string,
  actorId: string,
  type: string,
  data: Record<string, unknown> = {},
) {
  const e = {
    id: randomUUID(),
    type,
    actorId,
    createdAt: new Date().toISOString(),
    ...data,
  };
  creativeWorkspaceDb()
    .prepare(
      "INSERT INTO creative_workspace_events(project_id,payload) VALUES(?,?)",
    )
    .run(id, JSON.stringify(e));
}
function transaction<T>(fn: () => T): T {
  const db = creativeWorkspaceDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
async function scope(d: CreativeWorkspaceDeps, user: string, id: string) {
  const row = creativeProjectDb()
    .prepare("SELECT payload FROM creative_projects WHERE id=?")
    .get(id) as any;
  if (!row) throw new WorkspaceError(404, "Творчий проєкт не знайдено.");
  const p: CreativeProject = JSON.parse(row.payload);
  const principal = await d.principal(user),
    repo = d.repo(),
    b = await getBook(p.bookId);
  if (!principal || principal.isGuest)
    throw new WorkspaceError(403, "Обліковий запис недоступний.");
  if (!repo) throw new WorkspaceError(503, "Ядро недоступне.");
  const actualOwner =
    (await d.access.getCollabOwnerId(p.bookId)) ??
    (await d.access.getBookOwnerId(p.bookId));
  if (!b || b.ownerId !== actualOwner || p.ownerId !== b.ownerId)
    throw new WorkspaceError(403, "Власність проєкту змінилася.");
  const owner = p.ownerId === user;
  const effective = await resolveEffectiveAccess(repo, {
    projectId: p.bookId,
    userId: user,
    isOwner: owner,
    isAdmin: false,
  });
  const ctx = {
    b,
    repo,
    a: {
      projectId: p.bookId,
      userId: user,
      role: owner ? "owner" : "participant",
      isOwner: owner,
      canWrite: effective.canWriteAny,
      effective,
    },
  };
  const grant = ctx.a.effective.grants
    .filter((g) => g.scopeType === "deliverable" && g.scopeRef === id)
    .map((g) => g.level);
  const isSpecialist =
    p.specialistId === user &&
    (await ctx.repo.getParticipant(p.bookId, user))?.status === "active";
  const eff = ctx.a.effective;
  if (
    !owner &&
    (!isSpecialist || (eff.media === "none" && !grant.some(canRead)))
  )
    throw new WorkspaceError(
      403,
      "Workspace доступний власнику й обраному активному фахівцю з явним доступом до матеріалів.",
    );
  const work =
    owner ||
    eff.media === "work" ||
    grant.some((l) => l === "work" || levelRank(l) >= 4);
  const comment = work || grant.some((l) => levelRank(l) >= 2);
  const writable = !["CANCELLED", "ARCHIVED", "COMPLETED"].includes(p.status);
  return {
    p,
    ...ctx,
    owner,
    work: work && writable,
    comment: comment && writable,
    writable,
  };
}
function requireRight(ok: boolean) {
  if (!ok) throw new WorkspaceError(403, "Немає права виконувати цю дію.");
}
function payload(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new WorkspaceError(422, "Некоректний запит.");
  return raw as Record<string, any>;
}
function decode(data: unknown) {
  if (typeof data !== "string" || data.length > 29 * 1024 * 1024)
    throw new WorkspaceError(413, "Максимум 20 МБ за файл.");
  const m = data.match(
    /^data:(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm)|application\/(?:pdf|zip)|model\/gltf-binary);base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!m)
    throw new WorkspaceError(
      422,
      "Підтримуються PNG/JPEG/WEBP/GIF, MP4/WEBM, PDF, ZIP і GLB.",
    );
  const bytes = Buffer.from(m[2], "base64");
  if (
    !bytes.length ||
    bytes.length > 20 * 1024 * 1024 ||
    bytes.toString("base64") !== m[2]
  )
    throw new WorkspaceError(422, "Некоректний або завеликий файл.");
  const hex = bytes.subarray(0, 12).toString("hex"),
    ascii = bytes.subarray(0, 12).toString("ascii");
  const valid =
    m[1] === "image/png"
      ? hex.startsWith("89504e470d0a1a0a")
      : m[1] === "image/jpeg"
        ? hex.startsWith("ffd8ff")
        : m[1] === "image/gif"
          ? ascii.startsWith("GIF8")
          : m[1] === "image/webp"
            ? ascii.startsWith("RIFF") && ascii.slice(8) === "WEBP"
            : m[1] === "application/pdf"
              ? ascii.startsWith("%PDF-")
              : m[1] === "video/mp4"
                ? ascii.slice(4, 8) === "ftyp"
                : m[1] === "video/webm"
                  ? hex.startsWith("1a45dfa3")
                  : m[1] === "application/zip"
                    ? hex.startsWith("504b0304")
                    : ascii.startsWith("glTF");
  if (!valid)
    throw new WorkspaceError(422, "Вміст не відповідає формату файла.");
  return { bytes, mimeType: m[1] };
}
/** Scoped summaries for the existing collaboration/AI query; content uses guarded file endpoints. */
export async function readableCreativeDeliverables(
  d: CreativeWorkspaceDeps,
  userId: string,
  bookId: string,
) {
  const rows = creativeProjectDb()
    .prepare("SELECT id FROM creative_projects WHERE book_id=?")
    .all(bookId) as { id: string }[];
  const out: CreativeAsset[] = [];
  let authorized = 0;
  for (const row of rows) {
    try {
      await scope(d, userId, row.id);
      authorized++;
      out.push(...assets(row.id));
    } catch (e) {
      if (!(e instanceof WorkspaceError && e.status === 403)) throw e;
    }
  }
  if (!authorized) {
    const { collaborationScope } =
      await import("../collaboration/aiCollaboration");
    await collaborationScope(d, userId, bookId);
  }
  return out.slice(0, 200);
}
export function registerCreativeWorkspaceRoutes(
  app: Express,
  d: CreativeWorkspaceDeps,
) {
  const base = "/api/creative/projects/:id/workspace";
  const handle =
    (fn: (q: Request, r: Response, u: string, id: string) => Promise<void>) =>
    async (q: Request, r: Response) => {
      r.set("Cache-Control", "no-store");
      try {
        if (!q.principal?.id || q.principal.isGuest)
          throw new WorkspaceError(401, "Увійдіть у систему.");
        await fn(q, r, q.principal.id, String(q.params.id));
      } catch (e) {
        r.status(
          e instanceof WorkspaceError
            ? e.status
            : e instanceof CoreRuleError
              ? e.code === "bad_actor"
                ? 403
                : e.code === "not_found"
                  ? 404
                  : 422
              : 500,
        ).json({
          error:
            e instanceof WorkspaceError || e instanceof CoreRuleError
              ? e.message
              : "Не вдалося виконати дію Workspace.",
        });
      }
    };
  app.get(
    base,
    handle(async (_q, r, u, id) => {
      const ctx = await scope(d, u, id),
        brief = getCreativeBrief(id),
        all = assets(id);
      const annotations = creativeWorkspaceDb()
        .prepare(
          "SELECT payload FROM creative_workspace_annotations WHERE project_id=? ORDER BY rowid",
        )
        .all(id)
        .map((x: any) => JSON.parse(x.payload));
      const entities = (await ctx.repo.listEntities(ctx.p.bookId))
        .filter(
          (e) =>
            e.status !== "rejected" &&
            canRead(entityLevel(ctx.a.effective, e.type, e.id)),
        )
        .map((e) => ({ id: e.id, type: e.type, name: e.name }));
      const refs = (await listAssets(ctx.b.ownerId, { bookId: ctx.p.bookId }))
        .filter((a) => canRead(assetLevel(ctx.a.effective, a.id)))
        .map((a) => ({
          id: a.id,
          title: a.title || a.filename,
          url: `/api/media/file/${a.id}`,
        }));
      const users = [
        ctx.p.ownerId,
        ...(ctx.p.specialistId ? [ctx.p.specialistId] : []),
      ];
      const participants = await Promise.all(
        users.map(async (id) => ({
          id,
          name: (await d.describeUser?.(id)) || id,
          role: id === ctx.p.ownerId ? "Автор" : "Фахівець",
        })),
      );
      const read =
        (
          creativeWorkspaceDb()
            .prepare(
              "SELECT seq FROM creative_workspace_reads WHERE project_id=? AND user_id=?",
            )
            .get(id, u) as any
        )?.seq ?? 0;
      const unread = (
        creativeWorkspaceDb()
          .prepare(
            "SELECT count(*) n FROM creative_workspace_events WHERE project_id=? AND seq>?",
          )
          .get(id, read) as any
      ).n;
      const workspaceGrants = ctx.owner
        ? (await ctx.repo.listAccessGrants({ projectId: ctx.p.bookId })).filter(
            (g) => g.scopeType === "deliverable" && g.scopeRef === id,
          )
        : [];
      await scope(d, u, id);
      r.json({
        project: {
          id: ctx.p.id,
          title: ctx.p.title,
          bookId: ctx.p.bookId,
          status: ctx.p.status,
        },
        brief: brief?.published?.data ?? brief?.data ?? null,
        assets: all,
        annotations,
        entities,
        references: refs,
        participants,
        userId: u,
        permissions: { owner: ctx.owner, work: ctx.work, comment: ctx.comment },
        unread,
        workspaceGrants,
      });
    }),
  );
  app.post(
    `${base}/access`,
    handle(async (q, r, u, id) => {
      const ctx = await scope(d, u, id);
      requireRight(ctx.owner);
      const b = payload(q.body);
      if (b.confirmed !== true)
        throw new WorkspaceError(
          422,
          "Підтвердьте окремий доступ до Workspace.",
        );
      if (!ctx.p.specialistId || b.userId !== ctx.p.specialistId)
        throw new WorkspaceError(
          422,
          "Оберіть синхронізованого фахівця цього проєкту.",
        );
      const levels = {
        VIEW: "view",
        COMMENT: "comment",
        WORK: "edit",
      } as const;
      if (!Object.hasOwn(levels, String(b.level)))
        throw new WorkspaceError(422, "Оберіть VIEW, COMMENT або WORK.");
      const grant = await grantAccess(ctx.repo, {
        projectId: ctx.p.bookId,
        granter: { userId: u, isOwner: true, isAdmin: false },
        userId: b.userId,
        scopeType: "deliverable",
        scopeRef: id,
        level: levels[b.level as keyof typeof levels],
        validFrom: b.validFrom || undefined,
        validUntil: b.validUntil || null,
      });
      event(id, u, "WORKSPACE_ACCESS_GRANTED", {
        grantId: grant.id,
        level: b.level,
      });
      r.status(201).json({ grant, bookAccessChanged: false });
    }),
  );
  app.post(
    `${base}/access/:grantId/revoke`,
    handle(async (q, r, u, id) => {
      const ctx = await scope(d, u, id);
      requireRight(ctx.owner);
      if (q.body?.confirmed !== true)
        throw new WorkspaceError(422, "Підтвердьте відкликання.");
      const g = await ctx.repo.getAccessGrant(String(q.params.grantId));
      if (
        !g ||
        g.projectId !== ctx.p.bookId ||
        g.scopeType !== "deliverable" ||
        g.scopeRef !== id
      )
        throw new WorkspaceError(404, "Доступ Workspace не знайдено.");
      const grant = await revokeAccess(ctx.repo, {
        projectId: ctx.p.bookId,
        grantId: g.id,
        granter: { userId: u, isOwner: true, isAdmin: false },
      });
      event(id, u, "WORKSPACE_ACCESS_REVOKED", { grantId: g.id });
      r.json({ grant });
    }),
  );
  app.get(
    `${base}/context`,
    handle(async (_q, r, u, id) => {
      const ctx = await scope(d, u, id);
      const filtered = restrictBook(
        ctx.b.book,
        ctx.a.effective,
        await visibleCharacterRefs(ctx.repo, ctx.a.effective),
      );
      const result = {
        revision: ctx.b.revision,
        context: {
          id: ctx.b.id,
          title: filtered.title,
          chapters: filtered.chapters ?? [],
          characters: filtered.characters ?? [],
        },
        scope: ctx.a.effective.full ? "book" : "restricted",
      };
      await scope(d, u, id);
      r.json(result);
    }),
  );
  app.get(
    `${base}/assets/:assetId/file`,
    handle(async (q, r, u, id) => {
      await scope(d, u, id);
      const a = asset(id, String(q.params.assetId));
      const row = creativeWorkspaceDb()
        .prepare(
          "SELECT content FROM creative_workspace_assets WHERE id=? AND project_id=?",
        )
        .get(a.id, id) as any;
      const inline =
        a.mimeType.startsWith("image/") ||
        a.mimeType.startsWith("video/") ||
        a.mimeType === "application/pdf";
      r.set({
        "Content-Type": a.mimeType,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
        "Content-Security-Policy": "sandbox; default-src 'none'",
      });
      r.send(Buffer.from(row.content));
    }),
  );
  app.post(
    `${base}/assets`,
    handle(async (q, r, u, id) => {
      let ctx = await scope(d, u, id);
      requireRight(ctx.work);
      const b = payload(q.body),
        file = decode(b.dataUrl),
        filename = text(b.filename, 200).replace(/[\r\n\\/]/g, "_");
      let parent: CreativeAsset | null = null;
      if (b.parentId) {
        parent = asset(id, String(b.parentId));
        revision(b.expectedRevision);
        requireRight(ctx.owner || parent.createdBy === u);
        if (
          parent.revision !== b.expectedRevision ||
          assets(id).some(
            (a) => a.rootId === parent!.rootId && a.version > parent!.version,
          ) ||
          ["FINAL", "ARCHIVED"].includes(parent.status)
        )
          throw new WorkspaceError(
            409,
            "Попередня версія змінилася або вже фінальна.",
          );
      }
      await d.chargeUpload?.(q, file.bytes.length, ctx.p.bookId, filename);
      ctx = await scope(d, u, id);
      requireRight(ctx.work);
      const at = new Date().toISOString(),
        aid = randomUUID();
      const a: CreativeAsset = {
        id: aid,
        projectId: id,
        rootId: parent?.rootId ?? aid,
        parentId: parent?.id ?? null,
        version: (parent?.version ?? 0) + 1,
        revision: 1,
        status: "DRAFT",
        filename,
        mimeType: file.mimeType,
        bytes: file.bytes.length,
        createdBy: u,
        createdAt: at,
        approvedBy: null,
        approvedAt: null,
      };
      transaction(() => {
        if (parent) {
          const fresh = asset(id, parent.id);
          if (
            fresh.revision !== b.expectedRevision ||
            assets(id).some(
              (x) => x.rootId === parent!.rootId && x.version > parent!.version,
            )
          )
            throw new WorkspaceError(409, "Версія змінилася.");
        }
        creativeWorkspaceDb()
          .prepare(
            "INSERT INTO creative_workspace_assets(id,project_id,root_id,version,revision,payload,content) VALUES(?,?,?,?,?,?,?)",
          )
          .run(a.id, id, a.rootId, a.version, 1, JSON.stringify(a), file.bytes);
        event(id, u, "ASSET_UPLOADED", { assetId: a.id, version: a.version });
      });
      r.status(201).json({ asset: a });
    }),
  );
  app.post(
    `${base}/assets/:assetId/state`,
    handle(async (q, r, u, id) => {
      const ctx = await scope(d, u, id),
        b = payload(q.body),
        a = asset(id, String(q.params.assetId)),
        expected = revision(b.expectedRevision);
      if (a.revision !== expected)
        throw new WorkspaceError(409, "Матеріал змінився. Оновіть сторінку.");
      const target = String(b.status);
      if (!(CREATIVE_ASSET_STATES as readonly string[]).includes(target))
        throw new WorkspaceError(422, "Невідомий статус.");
      requireRight(ctx.writable);
      if (
        assets(id).some((x) => x.rootId === a.rootId && x.version > a.version)
      )
        throw new WorkspaceError(
          409,
          "Рішення можливе тільки для останньої версії.",
        );
      const ownerTransitions: Record<string, string[]> = {
        SUBMITTED_FOR_REVIEW: ["CHANGES_REQUESTED", "APPROVED", "REJECTED"],
        RESUBMITTED: ["CHANGES_REQUESTED", "APPROVED", "REJECTED"],
        APPROVED: ["FINAL", "CHANGES_REQUESTED"],
        REJECTED: ["ARCHIVED"],
        FINAL: ["ARCHIVED"],
        DRAFT: ["ARCHIVED"],
        CHANGES_REQUESTED: ["ARCHIVED"],
      };
      const submit =
        ctx.work &&
        (ctx.owner || a.createdBy === u) &&
        ((a.status === "DRAFT" && target === "SUBMITTED_FOR_REVIEW") ||
          (a.status === "CHANGES_REQUESTED" && target === "RESUBMITTED"));
      requireRight(
        submit || (ctx.owner && ownerTransitions[a.status]?.includes(target)),
      );
      if (b.confirmed !== true)
        throw new WorkspaceError(422, "Підтвердьте зміну статусу.");
      const note = ["CHANGES_REQUESTED", "REJECTED"].includes(target)
        ? text(b.note)
        : typeof b.note === "string"
          ? b.note.slice(0, 4000)
          : "";

      const next = {
        ...a,
        status: target as CreativeAsset["status"],
        revision: a.revision + 1,
        ...(target === "APPROVED"
          ? { approvedBy: u, approvedAt: new Date().toISOString() }
          : {}),
      };
      transaction(() => {
        const result = creativeWorkspaceDb()
          .prepare(
            "UPDATE creative_workspace_assets SET revision=?,payload=? WHERE id=? AND project_id=? AND revision=?",
          )
          .run(next.revision, JSON.stringify(next), a.id, id, expected) as {
          changes: number;
        };
        if (result.changes !== 1)
          throw new WorkspaceError(409, "Матеріал змінився. Оновіть сторінку.");
        event(id, u, "ASSET_STATE_CHANGED", {
          assetId: a.id,
          from: a.status,
          to: target,
          note,
        });
      });
      r.json({ asset: next, canonChanged: false });
    }),
  );
  app.post(
    `${base}/annotations`,
    handle(async (q, r, u, id) => {
      const ctx = await scope(d, u, id);
      requireRight(ctx.comment);
      const b = payload(q.body),
        a = asset(id, text(b.assetId, 128));
      const point = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
      let x: number | null = null,
        y: number | null = null,
        timecode: number | null = null;
      if (a.mimeType.startsWith("image/")) {
        if (!point(b.x) || !point(b.y) || b.timecode != null)
          throw new WorkspaceError(
            422,
            "Pin зображення потребує x/y від 0 до 1.",
          );
        x = b.x;
        y = b.y;
      } else if (a.mimeType.startsWith("video/")) {
        if (
          typeof b.timecode !== "number" ||
          !Number.isFinite(b.timecode) ||
          b.timecode < 0 ||
          b.timecode > 86400 ||
          b.x != null ||
          b.y != null
        )
          throw new WorkspaceError(422, "Вкажіть таймкод відео.");
        timecode = b.timecode;
      } else if (b.x != null || b.y != null || b.timecode != null)
        throw new WorkspaceError(
          422,
          "Цей формат має тільки текстовий коментар.",
        );
      const aNote: CreativeAnnotation = {
        id: randomUUID(),
        assetId: a.id,
        authorId: u,
        text: text(b.text),
        x,
        y,
        timecode,
        status: "open",
        revision: 1,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      transaction(() => {
        creativeWorkspaceDb()
          .prepare(
            "INSERT INTO creative_workspace_annotations(id,project_id,asset_id,revision,payload) VALUES(?,?,?,?,?)",
          )
          .run(aNote.id, id, a.id, 1, JSON.stringify(aNote));
        event(id, u, "ANNOTATION_ADDED", {
          assetId: a.id,
          annotationId: aNote.id,
        });
      });
      r.status(201).json({ annotation: aNote });
    }),
  );
  app.post(
    `${base}/annotations/:annotationId/resolve`,
    handle(async (q, r, u, id) => {
      const ctx = await scope(d, u, id);
      requireRight(ctx.comment);
      const b = payload(q.body),
        expected = revision(b.expectedRevision),
        row = creativeWorkspaceDb()
          .prepare(
            "SELECT payload FROM creative_workspace_annotations WHERE id=? AND project_id=?",
          )
          .get(String(q.params.annotationId), id) as any;
      if (!row) throw new WorkspaceError(404, "Коментар не знайдено.");
      const a: CreativeAnnotation = JSON.parse(row.payload);
      requireRight(ctx.owner || a.authorId === u);
      if (a.status !== "open")
        throw new WorkspaceError(409, "Коментар уже закрито.");
      const next = {
        ...a,
        status: "resolved",
        revision: a.revision + 1,
        resolvedAt: new Date().toISOString(),
      };
      transaction(() => {
        if (
          (
            creativeWorkspaceDb()
              .prepare(
                "UPDATE creative_workspace_annotations SET revision=?,payload=? WHERE id=? AND project_id=? AND revision=?",
              )
              .run(next.revision, JSON.stringify(next), a.id, id, expected) as {
              changes: number;
            }
          ).changes !== 1
        )
          throw new WorkspaceError(409, "Коментар змінився.");
        event(id, u, "ANNOTATION_RESOLVED", {
          annotationId: a.id,
          assetId: a.assetId,
        });
      });
      r.json({ annotation: next });
    }),
  );
  app.get(
    `${base}/chat`,
    handle(async (q, r, u, id) => {
      await scope(d, u, id);
      const cursor = Number(q.query.before ?? Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(cursor) || cursor < 1)
        throw new WorkspaceError(422, "Некоректний курсор історії.");
      const rows = creativeWorkspaceDb()
        .prepare(
          "SELECT seq,payload FROM creative_workspace_events WHERE project_id=? AND seq<? ORDER BY seq DESC LIMIT 100",
        )
        .all(id, cursor) as any[];
      r.json({
        events: rows
          .reverse()
          .map((x) => ({ seq: x.seq, ...JSON.parse(x.payload) })),
        nextBefore: rows.length === 100 ? rows[0].seq : null,
      });
    }),
  );
  app.post(
    `${base}/chat`,
    handle(async (q, r, u, id) => {
      const ctx = await scope(d, u, id);
      requireRight(ctx.comment);
      const b = payload(q.body),
        message = text(b.text);
      const attached = b.assetIds ?? [],
        mentions = b.mentions ?? [];
      if (
        !Array.isArray(attached) ||
        attached.length > 10 ||
        !Array.isArray(mentions) ||
        mentions.length > 2
      )
        throw new WorkspaceError(422, "Забагато вкладень чи згадувань.");
      for (const v of attached) {
        if (typeof v !== "string")
          throw new WorkspaceError(422, "Некоректне вкладення.");
        asset(id, v);
      }
      for (const v of mentions)
        if (![ctx.p.ownerId, ctx.p.specialistId].includes(v))
          throw new WorkspaceError(
            422,
            "Згадувати можна учасників цього Workspace.",
          );
      transaction(() =>
        event(id, u, "CHAT_MESSAGE", {
          text: message,
          assetIds: [...new Set(attached)],
          mentions: [...new Set(mentions)],
        }),
      );
      r.status(201).json({ sent: true });
    }),
  );
  app.post(
    `${base}/read`,
    handle(async (q, r, u, id) => {
      await scope(d, u, id);
      const seq = revision(q.body?.seq),
        max =
          (
            creativeWorkspaceDb()
              .prepare(
                "SELECT max(seq) n FROM creative_workspace_events WHERE project_id=?",
              )
              .get(id) as any
          ).n ?? 0;
      if (seq > max) throw new WorkspaceError(422, "Невідомий запис.");
      creativeWorkspaceDb()
        .prepare(
          "INSERT INTO creative_workspace_reads(project_id,user_id,seq) VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET seq=max(seq,excluded.seq)",
        )
        .run(id, u, seq);
      r.json({ read: true });
    }),
  );
}
