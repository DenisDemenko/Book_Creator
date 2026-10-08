import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Express, Request } from "express";
import {
  creativeWorkspaceScope,
  creativeWorkspaceDb,
  workspaceAsset,
  workspaceAssets,
  workspaceEvent,
  decodeWorkspaceFile,
  enforceWorkspaceAiPolicy,
  type CreativeWorkspaceDeps,
  type CreativeAsset,
} from "./workspace";
import { readCreativeStyle, readCreativeCanon } from "./bible";
import { entityLevel, canRead, assetLevel } from "../collaboration/access";
import { readAsset } from "../../media/mediaLibraryStore";
import { WorkspaceError } from "../collaboration/workspaceStore";
import { normalizeAi } from "../../../shared/mediaProvenance";
import {
  normalizeRules,
  STYLE_FIELDS,
  BibleInputError,
} from "../../../shared/creativeBible";
import {
  CREATIVE_AI_ACTIONS,
  type CreativeAiAction,
  type CreativeAiContext,
  type CreativeAiJob,
  type CreativeAiModel,
} from "../../../shared/creativeAi";
export interface CreativeProviderInput {
  operation: CreativeAiAction;
  model: string;
  prompt: string;
  references: string[];
  settings: { size: string; aspectRatio: string; duration?: number };
  bookId: string;
  req: Request;
}
export interface CreativeProviderResult {
  bytes: Buffer;
  mimeType: string;
  provider: string;
  model: string;
  settings: Record<string, string | number>;
}
export interface CreativeAiDeps extends CreativeWorkspaceDeps {
  ai?: {
    models: () => Promise<CreativeAiModel[]>;
    generate: (p: CreativeProviderInput) => Promise<CreativeProviderResult>;
    check: (
      req: Request,
      action: CreativeAiAction,
      quota: boolean,
    ) => Promise<void>;
  };
}
interface StoredJob extends CreativeAiJob {
  requestId: string;
  inputHash: string;
  instruction: string;
  expiresAt: number;
  context: CreativeAiContext;
}
interface Access {
  projectId: string;
  userId: string;
  actions: CreativeAiAction[];
  validUntil: string | null;
  revision: number;
}
const initialized = new WeakSet<object>();
function db() {
  const c = creativeWorkspaceDb();
  if (!initialized.has(c)) {
    c.exec(`CREATE TABLE IF NOT EXISTS creative_ai_access(project_id TEXT NOT NULL,user_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,user_id));
 CREATE TABLE IF NOT EXISTS creative_ai_jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id TEXT NOT NULL,request_id TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(user_id,request_id));
 CREATE UNIQUE INDEX IF NOT EXISTS creative_ai_single_active ON creative_ai_jobs(user_id) WHERE status='RUNNING';`);
    initialized.add(c);
  }
  return c;
}
function access(project: string, user: string): Access | null {
  const r = db()
    .prepare(
      "SELECT payload FROM creative_ai_access WHERE project_id=? AND user_id=?",
    )
    .get(project, user) as any;
  return r ? JSON.parse(r.payload) : null;
}
function actions(
  s: Awaited<ReturnType<typeof creativeWorkspaceScope>>,
  u: string,
): CreativeAiAction[] {
  if (!s.work) return [];
  if (s.owner) return [...CREATIVE_AI_ACTIONS];
  const a = access(s.p.id, u);
  return a && (!a.validUntil || Date.parse(a.validUntil) > Date.now())
    ? a.actions
    : [];
}
function job(id: string): StoredJob | null {
  const r = db()
    .prepare("SELECT payload FROM creative_ai_jobs WHERE id=?")
    .get(id) as any;
  return r ? JSON.parse(r.payload) : null;
}
function publicJob(j: StoredJob): CreativeAiJob {
  const { context, instruction, inputHash, expiresAt, requestId, ...v } = j;
  return v;
}
function writeJob(j: StoredJob) {
  db()
    .prepare("UPDATE creative_ai_jobs SET status=?,payload=? WHERE id=?")
    .run(j.status, JSON.stringify(j), j.id);
}
function expire() {
  for (const row of db()
    .prepare("SELECT payload FROM creative_ai_jobs WHERE status='RUNNING'")
    .all() as any[]) {
    const j: StoredJob = JSON.parse(row.payload);
    if (j.expiresAt < Date.now())
      writeJob({
        ...j,
        status: "FAILED",
        finishedAt: new Date().toISOString(),
        error:
          "Завдання перервано або перевищено час очікування. Автоматичної повторної генерації немає.",
      });
  }
}
function transaction<T>(fn: () => T) {
  const c = db();
  c.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    c.exec("COMMIT");
    return out;
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }
}
function requireAction(
  s: Awaited<ReturnType<typeof creativeWorkspaceScope>>,
  u: string,
  op: CreativeAiAction,
) {
  if (!actions(s, u).includes(op))
    throw new WorkspaceError(
      403,
      "Для цієї дії потрібен окремий дозвіл ШІ та робочий доступ до Workspace.",
    );
  enforceWorkspaceAiPolicy(s.p.id, {
    used: true,
    provider: "pending",
    model: "pending",
    generationId: null,
    promptReference: null,
    settings: {},
  });
}
function input(raw: any) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some(
      (k) =>
        ![
          "confirmed",
          "requestId",
          "operation",
          "model",
          "prompt",
          "settings",
          "entityIds",
          "referenceIds",
          "parentId",
          "expectedRevision",
          "styleOverride",
        ].includes(k),
    )
  )
    throw new WorkspaceError(422, "Некоректні параметри ШІ.");
  if (
    raw.confirmed !== true ||
    !CREATIVE_AI_ACTIONS.includes(raw.operation) ||
    typeof raw.requestId !== "string" ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(raw.requestId) ||
    typeof raw.prompt !== "string" ||
    !raw.prompt.trim() ||
    raw.prompt.length > 4000 ||
    typeof raw.model !== "string"
  )
    throw new WorkspaceError(
      422,
      "Заповніть опис, модель та окреме підтвердження.",
    );
  const ids = (v: any) => {
    if (v === undefined) return [];
    if (
      !Array.isArray(v) ||
      v.length > 10 ||
      v.some((x) => typeof x !== "string" || x.length > 200) ||
      new Set(v).size !== v.length
    )
      throw new WorkspaceError(
        422,
        "Некоректний список сутностей або референсів.",
      );
    return v as string[];
  };
  const settings = raw.settings ?? {};
  if (
    Object.keys(settings).some(
      (k) => !["size", "aspectRatio", "duration"].includes(k),
    ) ||
    typeof settings.size !== "string" ||
    typeof settings.aspectRatio !== "string"
  )
    throw new WorkspaceError(422, "Оберіть розмір і формат.");
  return {
    operation: raw.operation as CreativeAiAction,
    model: raw.model,
    prompt: raw.prompt.trim(),
    requestId: raw.requestId,
    settings: {
      size: settings.size,
      aspectRatio: settings.aspectRatio,
      ...(settings.duration !== undefined
        ? { duration: settings.duration }
        : {}),
    },
    entityIds: ids(raw.entityIds),
    referenceIds: ids(raw.referenceIds),
    parentId: raw.parentId ? String(raw.parentId) : null,
    expectedRevision: raw.expectedRevision,
    styleOverride: raw.styleOverride ?? null,
  };
}
async function context(
  d: CreativeAiDeps,
  u: string,
  id: string,
  p: ReturnType<typeof input>,
) {
  const s = await creativeWorkspaceScope(d, u, id);
  requireAction(s, u, p.operation);
  const entities = [];
  for (const eid of p.entityIds) {
    const e = await s.repo.getEntity(s.p.bookId, eid);
    if (
      !e ||
      e.status === "rejected" ||
      !canRead(entityLevel(s.a.effective, e.type, e.id))
    )
      throw new WorkspaceError(403, "Одна із сутностей недоступна.");
    entities.push({ id: e.id, type: e.type, name: e.name });
  }
  const style = await readCreativeStyle(d, u, s.p.bookId);
  let override = null;
  if (p.styleOverride !== null) {
    if (!style.canOverride)
      throw new WorkspaceError(
        403,
        "Змінити стиль для цього завдання може лише керівник Style Bible.",
      );
    override = normalizeRules(p.styleOverride, STYLE_FIELDS);
  }
  if (override && !style.value)
    throw new WorkspaceError(422, "Спочатку активуйте базову версію стилю.");
  const canon = (await readCreativeCanon(d, u, s.p.bookId)).filter(
    (r) => r.entityId && p.entityIds.includes(r.entityId),
  );
  const value: CreativeAiContext = {
    schema: 1,
    style: style.value
      ? {
          id: style.value.id,
          version: style.value.version,
          rules: style.value.rules,
          override,
        }
      : null,
    entities,
    references: canon,
  };
  const fresh = await creativeWorkspaceScope(d, u, id);
  requireAction(fresh, u, p.operation);
  if (JSON.stringify(fresh.a.effective) !== JSON.stringify(s.a.effective))
    throw new WorkspaceError(409, "Доступ змінився.");
  return { s: fresh, value };
}
async function references(
  d: CreativeAiDeps,
  u: string,
  id: string,
  p: ReturnType<typeof input>,
) {
  const s = await creativeWorkspaceScope(d, u, id);
  const refs: string[] = [];
  for (const aid of p.referenceIds) {
    const a = await readAsset(aid);
    if (
      !a ||
      a.record.bookId !== s.p.bookId ||
      !canRead(assetLevel(s.a.effective, aid)) ||
      !/^image\/(png|jpeg|webp|gif)$/.test(a.record.mimeType) ||
      a.bytes.length > 8 * 1024 * 1024
    )
      throw new WorkspaceError(403, "Референс недоступний або завеликий.");
    refs.push(
      `data:${a.record.mimeType};base64,${Buffer.from(a.bytes).toString("base64")}`,
    );
  }
  if (p.operation.endsWith(":edit")) {
    if (!p.parentId) throw new WorkspaceError(422, "Оберіть вихідну версію.");
    const a = workspaceAsset(id, p.parentId);
    if (
      (!s.owner && a.createdBy !== u) ||
      a.revision !== p.expectedRevision ||
      ["FINAL", "ARCHIVED"].includes(a.status) ||
      workspaceAssets(id).some(
        (x) => x.rootId === a.rootId && x.version > a.version,
      )
    )
      throw new WorkspaceError(
        409,
        "Вихідна версія змінилася або недоступна для редагування.",
      );
    const bytes = db()
      .prepare("SELECT content FROM creative_workspace_assets WHERE id=?")
      .get(a.id) as any;
    if (p.operation.includes(":image:")) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(a.mimeType))
        throw new WorkspaceError(422, "Для цієї дії потрібне зображення.");
      refs.unshift(
        `data:${a.mimeType};base64,${Buffer.from(bytes.content).toString("base64")}`,
      );
    } else {
      if (!/^video\/(mp4|webm)$/.test(a.mimeType))
        throw new WorkspaceError(422, "Для цієї дії потрібне відео.");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "creative-frame-"));
      try {
        const source = path.join(
            dir,
            a.mimeType === "video/mp4" ? "source.mp4" : "source.webm",
          ),
          frame = path.join(dir, "frame.png");
        await fs.writeFile(source, bytes.content);
        await promisify(execFile)(
          process.env.FFMPEG_PATH || "ffmpeg",
          [
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-threads",
            "2",
            "-i",
            source,
            "-frames:v",
            "1",
            "-vf",
            "scale=1024:-2",
            frame,
          ],
          { timeout: 20000, maxBuffer: 1024 * 1024 },
        );
        refs.unshift(
          `data:image/png;base64,${(await fs.readFile(frame)).toString("base64")}`,
        );
      } catch {
        throw new WorkspaceError(
          422,
          "Не вдалося прочитати перший кадр відео.",
        );
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  } else if (p.parentId)
    throw new WorkspaceError(
      422,
      "Для нової генерації не задавайте вихідну версію.",
    );
  const fresh = await creativeWorkspaceScope(d, u, id);
  requireAction(fresh, u, p.operation);
  if (JSON.stringify(fresh.a.effective) !== JSON.stringify(s.a.effective))
    throw new WorkspaceError(409, "Доступ до референсів змінився.");
  return refs;
}
export function registerCreativeAiRoutes(app: Express, d: CreativeAiDeps) {
  const base = "/api/creative/projects/:id/workspace/ai";
  const route = (
    method: "get" | "post",
    suffix: string,
    fn: (q: Request, u: string, id: string) => Promise<any>,
  ) =>
    app[method](base + suffix, async (q, r) => {
      r.set("Cache-Control", "private, no-store");
      try {
        if (!q.principal?.id || q.principal.isGuest)
          throw new WorkspaceError(401, "Увійдіть у систему.");
        r.json(await fn(q, q.principal.id, String(q.params.id)));
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
              : "Не вдалося виконати дію ШІ.",
        });
      }
    });
  route("get", "", async (_q, u, id) => {
    const s = await creativeWorkspaceScope(d, u, id);
    expire();
    const models = d.ai ? await d.ai.models() : [];
    const entities = (await s.repo.listEntities(s.p.bookId))
      .filter(
        (e) =>
          e.status !== "rejected" &&
          canRead(entityLevel(s.a.effective, e.type, e.id)),
      )
      .map((e) => ({ id: e.id, name: e.name, type: e.type }));
    const { listAssets } = await import("../../media/mediaLibraryStore");
    const refs = (await listAssets(s.p.ownerId, { bookId: s.p.bookId }))
      .filter(
        (a) =>
          canRead(assetLevel(s.a.effective, a.id)) &&
          a.mimeType.startsWith("image/"),
      )
      .map((a) => ({ id: a.id, title: a.title || a.filename }));
    const fresh = await creativeWorkspaceScope(d, u, id);
    if (JSON.stringify(fresh.a.effective) !== JSON.stringify(s.a.effective))
      throw new WorkspaceError(409, "Доступ змінився.");
    const grants = s.owner
      ? db()
          .prepare("SELECT payload FROM creative_ai_access WHERE project_id=?")
          .all(id)
          .map((r: any) => JSON.parse(r.payload))
      : [];
    return {
      models,
      actions: actions(s, u),
      entities,
      references: refs,
      access: grants,
      jobs: db()
        .prepare(
          "SELECT payload FROM creative_ai_jobs WHERE project_id=? AND user_id=? ORDER BY created_at DESC LIMIT 20",
        )
        .all(id, u)
        .map((r: any) => publicJob(JSON.parse(r.payload))),
      limits: { imagePerDay: 20, videoPerDay: 5, active: 1 },
      available: !!d.ai,
      canOverride:
        s.owner || s.a.effective.styleBibles?.[s.p.bookId] === "manage",
    };
  });
  route("post", "/access", async (q, u, id) => {
    const s = await creativeWorkspaceScope(d, u, id);
    if (!s.owner || !s.writable)
      throw new WorkspaceError(
        403,
        "Дозволи ШІ змінює власник активного Workspace.",
      );
    const b = q.body;
    if (
      b?.confirmed !== true ||
      b.userId !== s.p.specialistId ||
      !b.userId ||
      !Array.isArray(b.actions) ||
      b.actions.some((a: any) => !CREATIVE_AI_ACTIONS.includes(a)) ||
      new Set(b.actions).size !== b.actions.length
    )
      throw new WorkspaceError(422, "Оберіть фахівця й конкретні дії ШІ.");
    if (
      b.validUntil &&
      (!Number.isFinite(Date.parse(b.validUntil)) ||
        Date.parse(b.validUntil) <= Date.now())
    )
      throw new WorkspaceError(422, "Некоректний строк дозволу.");
    const old = access(id, b.userId);
    if (b.expectedRevision !== (old?.revision ?? 0))
      throw new WorkspaceError(409, "Дозволи змінилися.");
    const next: Access = {
      projectId: id,
      userId: b.userId,
      actions: b.actions,
      validUntil: b.validUntil || null,
      revision: (old?.revision ?? 0) + 1,
    };
    transaction(() => {
      if ((access(id, b.userId)?.revision ?? 0) !== b.expectedRevision)
        throw new WorkspaceError(409, "Дозволи змінилися.");
      db()
        .prepare(
          "INSERT INTO creative_ai_access(project_id,user_id,payload) VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET payload=excluded.payload",
        )
        .run(id, b.userId, JSON.stringify(next));
      workspaceEvent(id, u, "AI_ACCESS_CHANGED", { before: old, after: next });
    });
    return { access: next };
  });
  route("post", "/context", async (q, u, id) => {
    const p = input(q.body);
    const result = await context(d, u, id, p);
    return { context: result.value };
  });
  route("get", "/jobs/:jobId", async (q, u, id) => {
    const s = await creativeWorkspaceScope(d, u, id);
    const j = job(String(q.params.jobId));
    if (!j || j.projectId !== id || j.userId !== u)
      throw new WorkspaceError(404, "Завдання не знайдено.");
    requireAction(s, u, j.operation);
    expire();
    return { job: publicJob(job(j.id)!) };
  });
  route("post", "/jobs", async (q, u, id) => {
    if (!d.ai) throw new WorkspaceError(503, "Провайдери ШІ не налаштовані.");
    const p = input(q.body);
    let s = await creativeWorkspaceScope(d, u, id);
    requireAction(s, u, p.operation);
    const hash = createHash("sha256")
      .update(JSON.stringify({ ...p, requestId: undefined }))
      .digest("hex");
    const existing = db()
      .prepare(
        "SELECT payload FROM creative_ai_jobs WHERE user_id=? AND request_id=?",
      )
      .get(u, p.requestId) as any;
    if (existing) {
      const j: StoredJob = JSON.parse(existing.payload);
      if (j.projectId !== id || j.inputHash !== hash)
        throw new WorkspaceError(
          409,
          "Цей ідентифікатор уже використано для іншого запиту.",
        );
      return { job: publicJob(j), reused: true };
    }
    const model = (await d.ai.models()).find(
      (m) =>
        m.id === p.model &&
        m.kind === (p.operation.includes(":video:") ? "video" : "image"),
    );
    if (!model?.available)
      throw new WorkspaceError(
        422,
        "Модель недоступна. Перевірте налаштування провайдера.",
      );
    if (
      !model.aspectRatios.includes(p.settings.aspectRatio) ||
      !model.sizes.includes(p.settings.size) ||
      (model.kind === "video" &&
        !model.durations.includes(p.settings.duration ?? 0)) ||
      (model.kind === "image" && p.settings.duration !== undefined) ||
      (p.operation.endsWith(":edit") && !model.edit)
    )
      throw new WorkspaceError(
        422,
        "Модель не підтримує обрані параметри або редагування.",
      );
    const { value } = await context(d, u, id, p);
    const refs = await references(d, u, id, p);
    if (refs.length > model.maxReferences)
      throw new WorkspaceError(
        422,
        "Модель не підтримує таку кількість референсів.",
      );
    await d.ai.check(q, p.operation, true);
    s = await creativeWorkspaceScope(d, u, id);
    requireAction(s, u, p.operation);
    const j: StoredJob = {
      id: randomUUID(),
      projectId: id,
      userId: u,
      requestId: p.requestId,
      inputHash: hash,
      instruction: p.prompt,
      operation: p.operation,
      status: "RUNNING",
      createdAt: new Date().toISOString(),
      finishedAt: null,
      assetId: null,
      error: null,
      expiresAt: Date.now() + 20 * 60 * 1000,
      context: value,
    };
    transaction(() => {
      expire();
      const replay = db()
        .prepare(
          "SELECT payload FROM creative_ai_jobs WHERE user_id=? AND request_id=?",
        )
        .get(u, p.requestId) as any;
      if (replay) {
        const old: StoredJob = JSON.parse(replay.payload);
        if (old.inputHash !== hash || old.projectId !== id)
          throw new WorkspaceError(409, "Ідентифікатор запиту вже зайнято.");
        throw new WorkspaceError(
          409,
          "Цей запит уже прийнято. Повторіть з тим самим ідентифікатором для отримання стану.",
        );
      }
      if (
        db()
          .prepare(
            "SELECT 1 FROM creative_ai_jobs WHERE user_id=? AND status='RUNNING'",
          )
          .get(u)
      )
        throw new WorkspaceError(409, "У вас уже виконується завдання ШІ.");
      const rows = db()
        .prepare(
          "SELECT payload FROM creative_ai_jobs WHERE user_id=? AND created_at>=?",
        )
        .all(u, new Date().toISOString().slice(0, 10)) as any[];
      const video = p.operation.includes(":video:");
      if (
        rows.filter((r) =>
          JSON.parse(r.payload).operation.includes(
            video ? ":video:" : ":image:",
          ),
        ).length >= (video ? 5 : 20)
      )
        throw new WorkspaceError(429, "Денний ліміт Creative AI вичерпано.");
      db()
        .prepare(
          "INSERT INTO creative_ai_jobs(id,project_id,user_id,request_id,created_at,status,payload) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          j.id,
          id,
          u,
          p.requestId,
          j.createdAt,
          j.status,
          JSON.stringify(j),
        );
      workspaceEvent(id, u, "AI_STARTED", {
        jobId: j.id,
        operation: p.operation,
        model: p.model,
        styleVersionId: value.style?.id ?? null,
      });
    });
    void (async () => {
      try {
        const fresh = await context(d, u, id, p);
        if (JSON.stringify(fresh.value) !== JSON.stringify(value))
          throw new WorkspaceError(
            409,
            "Контекст змінився. Повторіть генерацію.",
          );
        requireAction(fresh.s, u, p.operation);
        await d.ai!.check(q, p.operation, false);
        const currentRefs = await references(d, u, id, p);
        if (JSON.stringify(currentRefs) !== JSON.stringify(refs))
          throw new WorkspaceError(409, "Референси змінилися.");
        const generated = await d.ai!.generate({
          operation: p.operation,
          model: p.model,
          prompt: JSON.stringify({
            instruction: p.prompt,
            styleContext: value,
          }),
          references: refs,
          settings: p.settings,
          bookId: s.p.bookId,
          req: q,
        });
        const after = await context(d, u, id, p);
        if (JSON.stringify(after.value) !== JSON.stringify(value))
          throw new WorkspaceError(
            409,
            "Доступ або стиль змінився під час генерації. Результат не додано.",
          );
        await d.ai!.check(q, p.operation, false);
        const file = decodeWorkspaceFile(
          `data:${generated.mimeType};base64,${generated.bytes.toString("base64")}`,
        );
        if (!file.mimeType.startsWith(model.kind + "/"))
          throw new WorkspaceError(422, "Провайдер повернув інший тип файла.");
        const filename = `creative-ai-${j.id}.${file.mimeType === "video/mp4" ? "mp4" : file.mimeType === "video/webm" ? "webm" : file.mimeType === "image/jpeg" ? "jpg" : file.mimeType === "image/webp" ? "webp" : "png"}`;
        await d.chargeUpload?.(q, file.bytes.length, s.p.bookId, filename);
        const final = await context(d, u, id, p);
        if (JSON.stringify(final.value) !== JSON.stringify(value))
          throw new WorkspaceError(409, "Доступ або контекст змінився.");
        await references(d, u, id, p);
        requireAction(final.s, u, p.operation);
        const finalContext = await context(d, u, id, p);
        if (JSON.stringify(finalContext.value) !== JSON.stringify(value))
          throw new WorkspaceError(409, "Доступ або контекст змінився.");
        const parent = p.parentId ? workspaceAsset(id, p.parentId) : null;
        const aid = randomUUID();
        const asset: CreativeAsset = {
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
          createdAt: new Date().toISOString(),
          approvedBy: null,
          approvedAt: null,
          generationContext: {
            jobId: j.id,
            styleVersionId: value.style?.id ?? null,
            entityIds: p.entityIds,
            referenceAssetIds: p.referenceIds,
            styleOverride: value.style?.override ?? null,
          },
          ai: normalizeAi({
            used: true,
            provider: generated.provider,
            model: generated.model,
            generationId: `cw-ai-${j.id}`,
            promptReference: `cw-prompt-${j.id}`,
            settings: generated.settings,
          }),
        };
        transaction(() => {
          if (job(j.id)?.status !== "RUNNING")
            throw new WorkspaceError(409, "Завдання вже перервано.");
          if (
            parent &&
            (workspaceAsset(id, parent.id).revision !== p.expectedRevision ||
              workspaceAssets(id).some(
                (x) => x.rootId === parent.rootId && x.version > parent.version,
              ))
          )
            throw new WorkspaceError(409, "Вихідна версія змінилася.");
          db()
            .prepare(
              "INSERT INTO creative_workspace_assets(id,project_id,root_id,version,revision,payload,content) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              aid,
              id,
              asset.rootId,
              asset.version,
              asset.revision,
              JSON.stringify(asset),
              file.bytes,
            );
          writeJob({
            ...j,
            status: "COMPLETED",
            finishedAt: new Date().toISOString(),
            assetId: aid,
          });
          workspaceEvent(id, u, "AI_COMPLETED", {
            jobId: j.id,
            assetId: aid,
            operation: p.operation,
          });
        });
      } catch (e) {
        const current = job(j.id);
        if (current?.status === "RUNNING")
          transaction(() => {
            writeJob({
              ...j,
              status: "FAILED",
              finishedAt: new Date().toISOString(),
              error:
                e instanceof WorkspaceError
                  ? e.message
                  : "Провайдер не завершив запит. Перевірте ключ, баланс і доступність моделі.",
            });
            workspaceEvent(id, u, "AI_FAILED", {
              jobId: j.id,
              operation: p.operation,
            });
          });
      }
    })();
    return { job: publicJob(j), reused: false };
  });
}
