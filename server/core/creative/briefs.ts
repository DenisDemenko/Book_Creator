import { randomUUID } from "node:crypto";
import type { Express, Request, RequestHandler, Response } from "express";
import { contributionDb } from "../collaboration/contributionStore";
import {
  collaborationScope,
  type CollaborationAiDeps,
} from "../collaboration/aiCollaboration";
import { WorkspaceError } from "../collaboration/workspaceStore";
import {
  canRead,
  entityLevel,
  sceneLevel,
  assetLevel,
  grantAccess,
  revokeAccess,
} from "../collaboration/access";
import type { AccessScope, AccessLevel } from "../types";
import { getAsset, listAssets } from "../../media/mediaLibraryStore";
import { CoreRuleError } from "../rules";
import { creativeProjectDb, type CreativeProject } from "./projects";
export const CREATIVE_WORK_TYPES = [
  "cover",
  "illustration",
  "character",
  "location",
  "world_map",
  "object",
  "booktrailer",
  "promo_video",
  "social",
  "advertising",
  "layout",
  "3d",
  "other",
] as const;
export interface BriefData {
  language?: "uk" | "en" | "other";
  type: (typeof CREATIVE_WORK_TYPES)[number];
  title: string;
  description: string;
  result: string;
  format: string;
  dimensions: string;
  style: string;
  concepts: number;
  revisionRounds: number;
  deadline: string;
  budgetTerms: string;
  references: string[];
  aiPolicy: "ALLOWED" | "FORBIDDEN" | "DISCLOSE";
  sourceFiles: string;
}
export interface Selection {
  scope: AccessScope;
  ref: string | null;
  level: "VIEW" | "COMMENT" | "WORK" | "MANAGE";
}
export interface CreativeBrief {
  id: string;
  creativeProjectId: string;
  bookId: string;
  version: number;
  status: "DRAFT" | "CONFIRMED" | "MODERATION";
  publishingAt?: string;
  data: BriefData;
  scope: Selection[];
  published: { id: string; revision: number; data: BriefData } | null;
}
export interface CreativeBriefDeps extends CollaborationAiDeps {
  aiGuard?: RequestHandler;
  publishGuard?: RequestHandler;
  generate?: (req: Request, data: BriefData, bookId: string) => Promise<string>;
  publish?: (
    req: Request,
    input: {
      externalId: string;
      sourceRevision: number;
      publicBrief: BriefData;
    },
  ) => Promise<{ id: string; status: string }>;
  onAccessChanged?: (book: string, user: string) => void;
}
function database() {
  const db = creativeProjectDb();
  db.exec(
    "CREATE TABLE IF NOT EXISTS creative_briefs(project_id TEXT PRIMARY KEY REFERENCES creative_projects(id) ON DELETE CASCADE,version INTEGER NOT NULL,payload TEXT NOT NULL);",
  );
  return db;
}
function getProject(id: string): CreativeProject {
  const row = creativeProjectDb()
    .prepare("SELECT payload FROM creative_projects WHERE id=?")
    .get(id) as any;
  if (!row) throw new WorkspaceError(404, "Творчий проєкт не знайдено.");
  return JSON.parse(row.payload);
}
export function getCreativeBrief(id: string): CreativeBrief | null {
  const r = database()
    .prepare("SELECT payload FROM creative_briefs WHERE project_id=?")
    .get(id) as any;
  return r ? JSON.parse(r.payload) : null;
}
async function owner(d: CreativeBriefDeps, user: string, id: string) {
  const p = getProject(id),
    ctx = await collaborationScope(d, user, p.bookId);
  if (p.ownerId !== user || !ctx.a.isOwner || ctx.b.ownerId !== user)
    throw new WorkspaceError(403, "Бриф і доступ налаштовує власник книги.");
  return { p, ...ctx };
}
function obj(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new WorkspaceError(422, "Некоректні дані брифу.");
  return raw as Record<string, unknown>;
}
export function validateBrief(raw: unknown): BriefData {
  const r = obj(raw),
    out: Record<string, unknown> = {};
  const limits = {
    title: 160,
    description: 8000,
    result: 3000,
    format: 300,
    dimensions: 300,
    style: 2000,
    deadline: 32,
    budgetTerms: 1000,
    sourceFiles: 1000,
  };
  if (
    Object.keys(r).some(
      (k) =>
        ![
          "type",
          "concepts",
          "revisionRounds",
          "references",
          "language",
          "aiPolicy",
          ...Object.keys(limits),
        ].includes(k),
    )
  )
    throw new WorkspaceError(422, "Бриф містить невідомі поля.");
  for (const [k, max] of Object.entries(limits)) {
    if (typeof r[k] !== "string" || r[k].length > max)
      throw new WorkspaceError(422, `Перевірте поле ${k}.`);
    out[k] = r[k].trim();
  }
  if (
    !(CREATIVE_WORK_TYPES as readonly unknown[]).includes(r.type) ||
    !["ALLOWED", "FORBIDDEN", "DISCLOSE"].includes(String(r.aiPolicy))
  )
    throw new WorkspaceError(422, "Оберіть тип роботи та AI policy.");
  for (const k of ["concepts", "revisionRounds"])
    if (
      !Number.isInteger(r[k]) ||
      Number(r[k]) < (k === "concepts" ? 1 : 0) ||
      Number(r[k]) > 50
    )
      throw new WorkspaceError(
        422,
        "Кількість концептів/правок має бути цілим числом до 50.",
      );
  if (out.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(String(out.deadline)))
    throw new WorkspaceError(422, "Дедлайн — дата YYYY-MM-DD.");
  if (
    !Array.isArray(r.references) ||
    r.references.length > 20 ||
    r.references.some(
      (u) =>
        typeof u !== "string" || u.length > 2000 || !/^https?:\/\//i.test(u),
    )
  )
    throw new WorkspaceError(
      422,
      "Референси — до 20 публічних HTTP(S) посилань.",
    );
  for (const rawUrl of r.references as string[]) {
    try {
      const u = new URL(rawUrl);
      if (
        u.username ||
        u.password ||
        u.pathname.includes("/api/media/") ||
        u.pathname.includes("/api/core/")
      )
        throw new Error();
    } catch {
      throw new WorkspaceError(
        422,
        "Приватні посилання/токени не публікуються як референси.",
      );
    }
  }
  if(r.language!==undefined&&!['uk','en','other'].includes(String(r.language)))throw new WorkspaceError(422,'Оберіть мову брифу.');
  return {
    ...out,
    ...(r.language===undefined?{}:{language:r.language}),
    type: r.type,
    concepts: r.concepts,
    revisionRounds: r.revisionRounds,
    references: r.references,
    aiPolicy: r.aiPolicy,
  } as unknown as BriefData;
}
export interface CreativeTarget {
  scope: AccessScope;
  ref: string | null;
  label: string;
  parent?: string;
}
async function targets(
  ctx: Awaited<ReturnType<typeof owner>>,
): Promise<CreativeTarget[]> {
  const { b, repo } = ctx,
    book = b.book as any;
  const list: CreativeTarget[] = [
    { scope: "book", ref: null, label: book.title || b.id },
  ];
  for (const ch of book.chapters ?? []) {
    list.push({
      scope: "chapter",
      ref: ch.id,
      label: ch.title || ch.id,
      parent: "book",
    });
    for (const s of ch.sections ?? [])
      list.push({
        scope: "scene",
        ref: s.id,
        label: s.title || s.id,
        parent: ch.id,
      });
  }
  for (const type of ["character", "location", "object"] as const)
    for (const e of await repo.listEntities(b.id, type))
      if (e.status !== "rejected")
        list.push({ scope: type, ref: e.id, label: e.name });
  for (const a of await listAssets(b.ownerId, { bookId: b.id }))
    list.push({
      scope: "media_asset",
      ref: a.id,
      label: a.title || a.filename,
    });
  if (book.visualBible)
    list.push({ scope: "visual_bible", ref: b.id, label: "Visual Bible" });
  if (book.styleBible)
    list.push({ scope: "style_bible", ref: b.id, label: "Style Bible" });
  return list;
}
async function selection(raw: unknown, ctx: Awaited<ReturnType<typeof owner>>) {
  if (!Array.isArray(raw) || raw.length > 200)
    throw new WorkspaceError(422, "Оберіть до 200 матеріалів.");
  const allowed = await targets(ctx),
    keys = new Set<string>();
  return raw.map((value) => {
    const x = obj(value),
      key = JSON.stringify([x.scope, x.ref]);
    if (
      Object.keys(x).some((k) => !["scope", "ref", "level"].includes(k)) ||
      !allowed.some((t) => t.scope === x.scope && t.ref === x.ref) ||
      !["VIEW", "COMMENT", "WORK", "MANAGE"].includes(String(x.level)) ||
      keys.has(key)
    )
      throw new WorkspaceError(
        422,
        "Невідома/повторна ціль або рівень доступу.",
      );
    keys.add(key);
    return { scope: x.scope, ref: x.ref, level: x.level } as Selection;
  });
}
function cas(row: CreativeBrief, expected: number) {
  const db = database();
  if (expected === 0) {
    try {
      db.prepare(
        "INSERT INTO creative_briefs(project_id,version,payload) VALUES(?,?,?)",
      ).run(row.creativeProjectId, row.version, JSON.stringify(row));
    } catch (e) {
      if (getCreativeBrief(row.creativeProjectId))
        throw new WorkspaceError(409, "Бриф змінився. Оновіть сторінку.");
      throw e;
    }
  } else if (
    (
      db
        .prepare(
          "UPDATE creative_briefs SET version=?,payload=? WHERE project_id=? AND version=?",
        )
        .run(
          row.version,
          JSON.stringify(row),
          row.creativeProjectId,
          expected,
        ) as { changes: number }
    ).changes !== 1
  )
    throw new WorkspaceError(409, "Бриф змінився. Оновіть сторінку.");
  return row;
}
function expected(raw: unknown) {
  if (!Number.isInteger(raw) || Number(raw) < 0)
    throw new WorkspaceError(422, "Потрібна поточна версія брифу.");
  return Number(raw);
}
function current(id: string, version: number) {
  const row = getCreativeBrief(id);
  if (!row || row.version !== version)
    throw new WorkspaceError(409, "Бриф змінився. Оновіть сторінку.");
  if (
    row.status === "CONFIRMED" &&
    Date.now() - Date.parse(row.publishingAt ?? new Date().toISOString()) <
      60000
  )
    throw new WorkspaceError(
      409,
      "Підтверджений бриф надсилається. Дочекайтеся результату.",
    );
  return row;
}
const passthrough: RequestHandler = (_q, _r, next) => next();
export function registerCreativeBriefRoutes(
  app: Express,
  d: CreativeBriefDeps,
) {
  const base = "/api/creative/projects/:id";
  const handle =
    (
      fn: (
        req: Request,
        res: Response,
        user: string,
        id: string,
      ) => Promise<void>,
    ) =>
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");
      try {
        if (!req.principal?.id || req.principal.isGuest)
          throw new WorkspaceError(401, "Увійдіть у систему.");
        await fn(req, res, req.principal.id, String(req.params.id));
      } catch (e) {
        const status =
          e instanceof WorkspaceError
            ? e.status
            : e instanceof CoreRuleError
              ? e.code === "not_found"
                ? 404
                : e.code === "bad_actor"
                  ? 403
                  : 422
              : 500;
        res.status(status).json({
          error:
            e instanceof WorkspaceError || e instanceof CoreRuleError
              ? e.message
              : "Не вдалося виконати дію Creative Studio.",
        });
      }
    };
  app.get(
    base,
    handle(async (_q, r, u, id) => {
      const ctx = await owner(d, u, id);
      r.json({
        project: ctx.p,
        bookTitle: ctx.b.book.title,
        brief: getCreativeBrief(id),
        targets: await targets(ctx),
        participants: (await ctx.repo.listParticipants(ctx.b.id))
          .filter((p) => p.status === "active")
          .map((p) => ({ id: p.id, userId: p.userId })),
        unavailable: [
          "parts",
          ...(ctx.b.book.styleBible ? [] : ["style_bible"]),
        ],
      });
    }),
  );
  app.put(
    `${base}/brief`,
    handle(async (q, r, u, id) => {
      const ctx = await owner(d, u, id),
        v = expected(q.body?.expectedVersion),
        old = getCreativeBrief(id);
      if ((old?.version ?? 0) !== v || old?.status === "CONFIRMED")
        throw new WorkspaceError(409, "Бриф змінився або надсилається.");
      const data = validateBrief(q.body?.data),
        scope = await selection(q.body?.scope, ctx);
      r.json({
        brief: cas(
          {
            id: old?.id ?? randomUUID(),
            creativeProjectId: id,
            bookId: ctx.b.id,
            version: v + 1,
            status: "DRAFT",
            data,
            scope,
            published: old?.published ?? null,
          },
          v,
        ),
      });
    }),
  );
  app.post(
    `${base}/brief/ai`,
    d.aiGuard ?? passthrough,
    handle(async (q, r, u, id) => {
      const ctx = await owner(d, u, id);
      const v = expected(q.body?.expectedVersion);
      if ((getCreativeBrief(id)?.version ?? 0) !== v)
        throw new WorkspaceError(409, "Бриф змінився.");
      if (!d.generate) throw new WorkspaceError(503, "AI не налаштований.");
      const input = validateBrief(q.body?.data);
      const raw = await d.generate(q, input, ctx.b.id);
      await owner(d, u, id);
      if ((getCreativeBrief(id)?.version ?? 0) !== v)
        throw new WorkspaceError(409, "Бриф змінився під час AI-запиту.");
      let result: unknown;
      try {
        result = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        throw new WorkspaceError(502, "AI повернув некоректну чернетку.");
      }
      r.json({
        draft: validateBrief(result),
        basedOnVersion: v,
        saved: false,
        published: false,
      });
    }),
  );
  app.post(
    `${base}/brief/publish`,
    d.publishGuard ?? passthrough,
    handle(async (q, r, u, id) => {
      await owner(d, u, id);
      if (q.body?.confirmed !== true)
        throw new WorkspaceError(
          422,
          "Потрібне явне підтвердження публічного брифу.",
        );
      const row = current(id, expected(q.body?.expectedVersion));
      if (
        [
          "title",
          "description",
          "result",
          "format",
          "budgetTerms",
          "sourceFiles",
        ].some((k) => !(row.data as any)[k])
      )
        throw new WorkspaceError(
          422,
          "Заповніть назву, опис, результат, формат, умови та вихідні файли.",
        );
      if (!d.publish)
        throw new WorkspaceError(503, "Міст до Marketplace не налаштовано.");
      const reserved = cas(
        {
          ...row,
          status: "CONFIRMED",
          publishingAt: new Date().toISOString(),
          version: row.version + 1,
        },
        row.version,
      );
      try {
        const sent = await d.publish(q, {
          externalId: id,
          sourceRevision: row.version,
          publicBrief: row.data,
        });
        if (typeof sent.id !== "string" || sent.status !== "MODERATION")
          throw new Error("Bad bridge reply");
        const saved = (() => {
          const conn = database();
          conn.exec("BEGIN IMMEDIATE");
          try {
            const saved = cas(
              {
                ...reserved,
                status: "MODERATION",
                published: {
                  id: sent.id,
                  revision: row.version,
                  data: row.data,
                },
                version: reserved.version + 1,
              },
              reserved.version,
            );
            const project = getProject(id);
            database()
              .prepare("UPDATE creative_projects SET payload=? WHERE id=?")
              .run(JSON.stringify({ ...project, orderId: sent.id }), id);
            conn.exec("COMMIT");
            return saved;
          } catch (e) {
            conn.exec("ROLLBACK");
            throw e;
          }
        })();
        r.json({ brief: saved });
      } catch {
        cas(
          { ...reserved, status: "DRAFT", version: reserved.version + 1 },
          reserved.version,
        );
        throw new WorkspaceError(
          502,
          "Бриф не підтверджено в Marketplace. Повторіть надсилання; підтверджена версія не дублюється.",
        );
      }
    }),
  );
  app.get(
    `${base}/access`,
    handle(async (_q, r, u, id) => {
      const ctx = await owner(d, u, id);
      r.json({
        grants: await ctx.repo.listAccessGrants({ projectId: ctx.b.id }),
        events: (
          await ctx.repo.listCollabEvents(ctx.b.id, { limit: 200 })
        ).filter((e) =>
          ["access_granted", "access_revoked"].includes(e.action),
        ),
      });
    }),
  );
  app.post(
    `${base}/access`,
    handle(async (q, r, u, id) => {
      if (q.body?.confirmed !== true)
        throw new WorkspaceError(422, "Підтвердьте надання доступу.");
      const ctx = await owner(d, u, id),
        x = (await selection([q.body?.target], ctx))[0];
      const levels: Record<Selection["level"], AccessLevel> = {
        VIEW: "view",
        COMMENT: "comment",
        WORK: x.scope === "media_asset" ? "work" : "view",
        MANAGE: "manage",
      };
      const grant = await grantAccess(ctx.repo, {
        projectId: ctx.b.id,
        granter: { userId: u, isOwner: true, isAdmin: false },
        userId: String(q.body?.userId ?? ""),
        level: levels[x.level],
        scopeType: x.scope,
        scopeRef: x.ref,
        validFrom: q.body?.validFrom,
        validUntil: q.body?.validUntil,
        bookIndex: new Map(
          ((ctx.b.book.chapters ?? []) as any[]).map((c: any) => [
            c.id,
            c.sections.map((s: any) => s.id),
          ]),
        ),
      });
      d.onAccessChanged?.(ctx.b.id, String(q.body.userId));
      r.status(201).json({ grant });
    }),
  );
  app.delete(
    `${base}/access/:grantId`,
    handle(async (q, r, u, id) => {
      const ctx = await owner(d, u, id),
        g = await revokeAccess(ctx.repo, {
          projectId: ctx.b.id,
          grantId: String(q.params.grantId),
          granter: { userId: u, isOwner: true, isAdmin: false },
        });
      const p = await ctx.repo.getParticipantById(g.participantId);
      if (p) d.onAccessChanged?.(ctx.b.id, p.userId);
      r.json({ grant: g });
    }),
  );
  // Members can read only a chosen resource, never the owner's brief/scope/tree.
  app.get(
    `${base}/resources/:scope/:ref`,
    handle(async (q, r, u, id) => {
      const p = getProject(id),
        ctx = await collaborationScope(d, u, p.bookId),
        scope = String(q.params.scope),
        ref = String(q.params.ref);
      const book = ctx.b.book as any;
      let value: unknown;
      if (scope === "scene") {
        for (const ch of book.chapters ?? [])
          for (const s of ch.sections ?? [])
            if (
              s.id === ref &&
              canRead(sceneLevel(ctx.a.effective, ch.id, s.id))
            )
              value = { id: s.id, title: s.title, content: s.content };
      } else if (["character", "location", "object"].includes(scope)) {
        const e = await ctx.repo.getEntity(p.bookId, ref);
        if (
          e?.type === scope &&
          canRead(entityLevel(ctx.a.effective, scope, ref))
        )
          value = e;
      } else if (scope === "media_asset") {
        const a = await getAsset(ref);
        if (
          a?.bookId === p.bookId &&
          a.ownerId === ctx.b.ownerId &&
          canRead(assetLevel(ctx.a.effective, ref))
        )
          value = a;
      } else if (
        ["visual_bible", "style_bible"].includes(scope) &&
        ref === p.bookId
      ) {
        const allowed =
          ctx.a.effective.full ||
          canRead(ctx.a.effective.book) ||
          canRead(
            (scope === "visual_bible"
              ? ctx.a.effective.visualBibles
              : ctx.a.effective.styleBibles)?.[ref] ?? "none",
          );
        if (allowed)
          value = scope === "visual_bible" ? book.visualBible : book.styleBible;
      }
      if (value === undefined)
        throw new WorkspaceError(404, "Матеріал недоступний.");
      r.json({ resource: value });
    }),
  );
}
