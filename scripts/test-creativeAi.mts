import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import type { AddressInfo } from "node:net";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { bootstrapOntology } from "../server/core/ontology/lifecycle";
import { assignRole } from "../server/core/collaboration/participants";
import {
  makeEffectiveResolver,
  grantAccess,
} from "../server/core/collaboration/access";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "media-provenance-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, "books.db");
const db = await import("../server/db");
await db.initDb();
const books = await import("../server/bookStore");
const { createCorePool } = await import("../server/core");
const pool = process.env.CORE_TEST_DATABASE_URL
  ? createCorePool(process.env.CORE_TEST_DATABASE_URL)
  : null;
if (pool) {
  const m = await import("../server/core/migrate");
  await m.runMigrations(pool, await m.loadMigrations(m.resolveMigrationsDir()));
}
const { PgCoreRepository } = await import("../server/core/pgRepository");
const repo = pool ? new PgCoreRepository(pool) : new MemoryCoreRepository();
await bootstrapOntology(repo);
const bid = "workspace-" + Date.now();
await repo.upsertProject({ id: bid, ownerId: "owner", title: "Private book" });
await books.saveBook({
  ownerId: "owner",
  book: {
    id: bid,
    title: "Private book",
    notes: "SECRET OWNER NOTES",
    chapters: [
      {
        id: "c",
        title: "Chapter",
        sections: [
          { id: "s", title: "Allowed scene", content: "ALLOWED TEXT" },
          { id: "h", title: "Hidden scene", content: "SECRET MANUSCRIPT" },
        ],
      },
    ],
  },
});
for (const userId of ["designer", "other"])
  await assignRole(repo, {
    projectId: bid,
    userId,
    roleId: "designer",
    actor: "user:owner",
    source: "manual",
  });
const deps = {
  repo: () => repo,
  principal: async (id: string) =>
    ({ id, role: "writer", isGuest: false }) as any,
  access: {
    getBookOwnerId: async (id: string) => (await books.getBook(id))?.ownerId,
    getCollabOwnerId: async () => undefined,
    listAcceptedInvites: async () => [],
    effectiveAccess: makeEffectiveResolver(
      () => repo,
      () => "ready",
    ),
  },
  describeUser: async (id: string) => (id === "owner" ? "Автор" : "Дизайнер"),
};
const { createCreativeProject, creativeProjectDb } =
  await import("../server/core/creative/projects");
const p = await createCreativeProject(deps, "owner", bid, {
  title: "Book cover",
});
const conn = creativeProjectDb();
const selected = {
  ...p,
  specialistId: "designer",
  status: "SPECIALIST_SELECTED",
};
const setProject = (v: any) =>
  conn
    .prepare("UPDATE creative_projects SET payload=? WHERE id=?")
    .run(JSON.stringify(v), p.id);
setProject(selected);
const grant = async (
  scopeType: any,
  level: any,
  ref: string | null = null,
  dates = {},
) =>
  grantAccess(repo, {
    projectId: bid,
    granter: { userId: "owner", isOwner: true, isAdmin: false },
    userId: "designer",
    scopeType,
    scopeRef: ref,
    level,
    bookIndex: new Map([["c", ["s", "h"]]]),
    ...dates,
  });
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CREATIVE_AI_ACTIONS } from "../shared/creativeAi";
const { registerCreativeWorkspaceRoutes, creativeWorkspaceDb } =
  await import("../server/core/creative/workspace");
const models = [
  {
    id: "test-image",
    label: "Test image",
    kind: "image",
    provider: "test",
    available: true,
    maxReferences: 3,
    edit: true,
    aspectRatios: ["1:1"],
    sizes: ["1K"],
    durations: [],
  },
  {
    id: "test-video",
    label: "Test video",
    kind: "video",
    provider: "test",
    available: true,
    maxReferences: 2,
    edit: true,
    aspectRatios: ["16:9"],
    sizes: ["720"],
    durations: [5],
  },
  {
    id: "no-key",
    label: "Missing key",
    kind: "image",
    provider: "test",
    available: false,
    maxReferences: 0,
    edit: false,
    aspectRatios: ["1:1"],
    sizes: ["1K"],
    durations: [],
  },
];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zX8AAAAASUVORK5CYII=",
  "base64",
);
await promisify(execFile)(process.env.FFMPEG_PATH || "ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=black:s=160x90:d=1",
  "-an",
  "-c:v",
  "libvpx",
  "-y",
  path.join(dir, "sample.webm"),
]);
const video = await fs.readFile(path.join(dir, "sample.webm"));
let calls: any[] = [],
  quotaFail = false,
  providerFail = false,
  disabled = false,
  storageFail = false,
  release: (() => void) | null = null,
  block: Promise<void> | null = null,
  hook = async () => {};
const app = express();
app.use(express.json({ limit: "30mb" }));
app.use((q, _r, n) => {
  const u = String(q.headers["x-user"] ?? "owner");
  q.principal = {
    id: u,
    role: u === "admin" ? "admin" : "writer",
    isGuest: u === "guest",
  } as any;
  n();
});
registerCreativeWorkspaceRoutes(app, {
  ...deps,
  principal: async (u) =>
    u === "disabled" || (disabled && u === "designer")
      ? null
      : deps.principal(u),
  chargeUpload: async () => {
    await hook();
    if (storageFail)
      throw new (
        await import("../server/core/collaboration/workspaceStore")
      ).WorkspaceError(402, "storage quota");
  },
  creativeAi: {
    models: async () => models as any,
    check: async (_q, _a, quota) => {
      if (quota && quotaFail)
        throw new (
          await import("../server/core/collaboration/workspaceStore")
        ).WorkspaceError(402, "subscription quota");
    },
    generate: async (input) => {
      calls.push(input);
      if (block) await block;
      if (providerFail) throw new Error("SECRET_PROVIDER_KEY must not leak");
      return {
        bytes: input.operation.includes(":video:") ? video : png,
        mimeType: input.operation.includes(":video:")
          ? "video/webm"
          : "image/png",
        provider: "test",
        model: "actual-model-v2",
        settings: input.operation.includes(":video:")
          ? { resolution: "720", duration: 5, aspectRatio: "16:9" }
          : { imageSize: "1K", aspectRatio: "1:1" },
      };
    },
  },
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  base = `/api/creative/projects/${p.id}/workspace`;
async function req(suffix = "", u = "owner", body?: unknown) {
  const r = await fetch(origin + base + suffix, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-user": u },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: (await r.json()) as any };
}
const payload = (extra = {}) => ({
  confirmed: true,
  requestId: randomUUID(),
  operation: "creative:image:generate",
  model: "test-image",
  prompt: "Draw the hero",
  settings: { size: "1K", aspectRatio: "1:1" },
  entityIds: [],
  referenceIds: [],
  ...extra,
});
const stored = (id: string) =>
  JSON.parse(
    (
      creativeWorkspaceDb()
        .prepare("SELECT payload FROM creative_ai_jobs WHERE id=?")
        .get(id) as any
    ).payload,
  );
async function wait(id: string) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const j = stored(id);
    if (j.status !== "RUNNING") return j;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("Job timeout");
}
let n = 0;
const check = (s: string) => {
  n++;
  console.log("✓ " + s);
};
const media = await import("../server/media/mediaLibraryStore");
const ch = await repo.createEntity({
    projectId: bid,
    type: "character",
    name: "Allowed hero",
    canonical: { description: "SECRET BIOGRAPHY" },
    createdBy: "user:owner",
  }),
  hidden = await repo.createEntity({
    projectId: bid,
    type: "location",
    name: "SECRET LOCATION",
    canonical: {},
    createdBy: "user:owner",
  });
const imageRef = await media.saveAsset({
  ownerId: "owner",
  bookId: bid,
  kind: "upload",
  filename: "private-ref.png",
  mimeType: "image/png",
  bytes: png,
});
const allow = async (actions: string[], revision = 0) =>
  req("/ai/access", "owner", {
    confirmed: true,
    userId: "designer",
    actions,
    expectedRevision: revision,
  });
try {
  for (const u of ["guest", "other", "admin", "disabled"])
    assert.ok([401, 403].includes((await req("/ai", u)).status));
  check("Guest, сторонній, чужий admin і вимкнений акаунт закриті");
  await grant("deliverable", "edit", p.id);
  assert.equal((await req("/ai/jobs", "designer", payload())).status, 403);
  assert.equal(calls.length, 0);
  check("WORK на Workspace не надає жодної дії ШІ");
  assert.equal((await allow(["creative:image:generate"])).status, 200);
  assert.equal((await req("/ai/jobs", "designer", payload())).status, 403);
  check("Дозвіл дії не обходить відсутній доступ до Style Bible");
  await grant("style_bible", "view", bid);
  await grant("character", "view", ch.id);
  await grant("media_asset", "view", imageRef.id);
  assert.equal(
    (await req("/ai/jobs", "designer", payload({ entityIds: [hidden.id] })))
      .status,
    403,
  );
  assert.equal(calls.length, 0);
  const scoped = await req(
    "/ai/context",
    "designer",
    payload({ entityIds: [ch.id] }),
  );
  assert.equal(scoped.status, 200);
  assert.ok(!JSON.stringify(scoped.body).includes("SECRET"));
  assert.equal(scoped.body.context.entities[0].name, "Allowed hero");
  check(
    "Контекст не містить прихованих сутностей, біографії, сцен або нотаток",
  );
  quotaFail = true;
  assert.equal((await req("/ai/jobs", "designer", payload())).status, 402);
  quotaFail = false;
  assert.equal(calls.length, 0);
  check("Квота перевіряється до виклику провайдера");
  assert.equal(
    (await req("/ai/jobs", "designer", payload({ model: "no-key" }))).status,
    422,
  );
  assert.equal(
    (
      await req(
        "/ai/jobs",
        "designer",
        payload({ referenceImages: ["https://attacker.invalid"] }),
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await req(
        "/ai/jobs",
        "designer",
        payload({ settings: { size: "99K", aspectRatio: "1:1" } }),
      )
    ).status,
    422,
  );
  assert.equal(
    (await req("/ai/jobs", "designer", payload({ confirmed: false }))).status,
    422,
  );
  check("Ключі/URL/довільні параметри/непідтверджені запити відхиляються");
  const b = payload({ entityIds: [ch.id], referenceIds: [imageRef.id] });
  block = new Promise((r) => (release = r));
  const first = await req("/ai/jobs", "designer", b);
  assert.equal(first.status, 200);
  assert.equal(first.body.job.status, "RUNNING");
  const reused = await req("/ai/jobs", "designer", b);
  assert.equal(reused.body.job.id, first.body.job.id);
  assert.equal(reused.body.reused, true);
  assert.equal((await req("/ai/jobs", "designer", payload())).status, 409);
  release!();
  block = null;
  let j = await wait(first.body.job.id);
  assert.equal(j.status, "COMPLETED");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].references[0].startsWith("data:image/png;base64,"));
  assert.ok(!calls[0].prompt.includes("SECRET"));
  let a = (await req("", "owner")).body.assets.find(
    (a: any) => a.id === j.assetId,
  );
  assert.equal(a.status, "DRAFT");
  assert.equal(a.createdBy, "designer");
  assert.equal(a.ai.model, "actual-model-v2");
  assert.equal(a.approvedBy, null);
  assert.ok(a.ai.promptReference.startsWith("cw-prompt-"));
  check(
    "Фоновий запит, idempotency, один активний job; приватні байти й точне походження DRAFT",
  );
  assert.equal((await req("/ai/jobs/" + j.id, "other")).status, 403);
  assert.equal(
    (
      await req(
        "/ai/jobs",
        "designer",
        payload({
          operation: "creative:image:edit",
          parentId: a.id,
          expectedRevision: 1,
        }),
      )
    ).status,
    403,
  );
  check("Job приватний; GENERATE не дає EDIT");
  assert.equal((await allow([...CREATIVE_AI_ACTIONS], 1)).status, 200);
  const edited = await req(
    "/ai/jobs",
    "designer",
    payload({
      operation: "creative:image:edit",
      parentId: a.id,
      expectedRevision: 1,
    }),
  );
  const ej = await wait(edited.body.job.id);
  assert.equal(ej.status, "COMPLETED");
  const next = (await req()).body.assets.find((x: any) => x.id === ej.assetId);
  assert.equal(next.parentId, a.id);
  assert.equal(next.version, 2);
  assert.equal(next.rootId, a.rootId);
  assert.ok(calls.at(-1).references[0].startsWith("data:"));
  assert.equal(
    (
      await req(
        "/ai/jobs",
        "designer",
        payload({
          operation: "creative:image:edit",
          parentId: a.id,
          expectedRevision: 1,
        }),
      )
    ).status,
    409,
  );
  check("Редагування створює v2, зберігає оригінал і відхиляє старий parent");
  providerFail = true;
  const failed = await req("/ai/jobs", "designer", payload());
  j = await wait(failed.body.job.id);
  assert.equal(j.status, "FAILED");
  assert.ok(!j.error.includes("SECRET"));
  providerFail = false;
  check("Помилка провайдера не розкриває секрет і не створює файл");
  storageFail = true;
  const noSpace = await req("/ai/jobs", "designer", payload());
  assert.equal((await wait(noSpace.body.job.id)).status, "FAILED");
  storageFail = false;
  check("Storage quota після генерації не залишає частковий Workspace asset");
  block = new Promise((r) => (release = r));
  const revoked = await req(
    "/ai/jobs",
    "designer",
    payload({ entityIds: [ch.id] }),
  );
  await allow([], 2);
  release!();
  block = null;
  assert.equal((await wait(revoked.body.job.id)).status, "FAILED");
  assert.equal(
    (await req("/ai/jobs/" + revoked.body.job.id, "designer")).status,
    403,
  );
  check("Відкликання дії під час генерації скасовує додавання результату");
  await allow([...CREATIVE_AI_ACTIONS], 3);
  block = new Promise((r) => (release = r));
  const inactive = await req("/ai/jobs", "designer", payload());
  disabled = true;
  release!();
  block = null;
  assert.equal((await wait(inactive.body.job.id)).status, "FAILED");
  disabled = false;
  check("Вимкнення акаунта не дозволяє зберегти пізню відповідь");
  const videoRequest = payload({
    operation: "creative:video:generate",
    model: "test-video",
    settings: { size: "720", aspectRatio: "16:9", duration: 5 },
  });
  const v = await req("/ai/jobs", "designer", videoRequest);
  const vj = await wait(v.body.job.id);
  assert.equal(vj.status, "COMPLETED");
  const va = (await req()).body.assets.find((x: any) => x.id === vj.assetId);
  const ve = await req(
    "/ai/jobs",
    "designer",
    payload({
      operation: "creative:video:edit",
      model: "test-video",
      settings: { size: "720", aspectRatio: "16:9", duration: 5 },
      parentId: va.id,
      expectedRevision: 1,
    }),
  );
  const vej = await wait(ve.body.job.id);
  assert.equal(vej.status, "COMPLETED");
  assert.ok(calls.at(-1).references[0].startsWith("data:image/png;base64,"));
  assert.equal(
    (await req()).body.assets.find((x: any) => x.id === vej.assetId).version,
    2,
  );
  check(
    "Відеогенерація й нова відеоверсія використовують приватний кадр, FFmpeg і version chain",
  );
  const styleReq = async (suffix: string, body: any) =>
    fetch(origin + `/api/creative/bible/${bid}` + suffix, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "owner" },
      body: JSON.stringify(body),
    });
  const style = (await (
    await styleReq("/style/versions", {
      confirmed: true,
      title: "Blue",
      rules: { primaryPalette: "blue", lighting: "night" },
    })
  ).json()) as any;
  await styleReq("/style/activate", {
    confirmed: true,
    versionId: style.version.id,
    expectedRevision: 0,
  });
  assert.equal(
    (
      await req(
        "/ai/context",
        "designer",
        payload({ styleOverride: { primaryPalette: "red" } }),
      )
    ).status,
    403,
  );
  const override = await req(
    "/ai/context",
    "owner",
    payload({ styleOverride: { primaryPalette: "green" } }),
  );
  assert.equal(override.body.context.style.rules.primaryPalette, "blue");
  assert.equal(override.body.context.style.override.primaryPalette, "green");
  check(
    "Активний стиль застосовується; override потребує MANAGE та не змінює версію",
  );
  block = new Promise((r) => (release = r));
  const changed = await req("/ai/jobs", "designer", payload());
  await styleReq("/style/activate", {
    confirmed: true,
    versionId: style.version.id,
    expectedRevision: 1,
  }); // same rules/version must not invalidate
  release!();
  block = null;
  assert.equal((await wait(changed.body.job.id)).status, "COMPLETED");
  check("Повторна активація тієї ж незмінної версії не губить результат");
  const rejected = await req("/ai/access", "owner", {
    confirmed: true,
    userId: "designer",
    actions: [],
    expectedRevision: 0,
  });
  assert.equal(rejected.status, 409);
  check("CAS дозволів захищає від застарілого відкликання");
  const paidBefore = calls.length;
  creativeWorkspaceDb()
    .prepare(
      "INSERT OR REPLACE INTO creative_briefs(project_id,version,payload) VALUES(?,?,?)",
    )
    .run(
      p.id,
      1,
      JSON.stringify({
        data: { aiPolicy: "ALLOWED" },
        published: { data: { aiPolicy: "FORBIDDEN" } },
      }),
    );
  assert.equal((await req("/ai/jobs", "designer", payload())).status, 422);
  assert.equal(calls.length, paidBefore);
  creativeWorkspaceDb()
    .prepare("DELETE FROM creative_briefs WHERE project_id=?")
    .run(p.id);
  check("Опублікований FORBIDDEN блокує платний виклик незалежно від чернетки");
  block = new Promise((r) => (release = r));
  const oldStyle = await req("/ai/jobs", "designer", payload());
  const style2 = (await (
    await styleReq("/style/versions", {
      confirmed: true,
      title: "Green",
      rules: { primaryPalette: "green" },
    })
  ).json()) as any;
  await styleReq("/style/activate", {
    confirmed: true,
    versionId: style2.version.id,
    expectedRevision: 2,
  });
  release!();
  block = null;
  assert.equal((await wait(oldStyle.body.job.id)).status, "FAILED");
  check("Інша активна версія стилю під час генерації відхиляє пізню відповідь");
  await styleReq("/style/activate", {
    confirmed: true,
    versionId: style.version.id,
    expectedRevision: 3,
  });
  const approve = await req(`/assets/${next.id}/state`, "designer", {
    confirmed: true,
    expectedRevision: 1,
    status: "SUBMITTED_FOR_REVIEW",
  });
  assert.equal(approve.status, 200);
  const approved = await req(`/assets/${next.id}/state`, "owner", {
    confirmed: true,
    expectedRevision: 2,
    status: "APPROVED",
  });
  assert.equal(approved.status, 200);
  const imported = await req(`/assets/${next.id}/library`, "owner", {
    confirmed: true,
    expectedRevision: 3,
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.asset.provenance.generationContext.jobId, ej.id);
  assert.equal(imported.body.asset.provenance.ai.model, "actual-model-v2");
  check(
    "Явний review та імпорт зберігають AI job/context; генерація сама не затверджує",
  );
  // Daily counts include accepted failed attempts and apply across creative projects.
  const c = creativeWorkspaceDb(),
    today = new Date().toISOString();
  for (let i = 0; i < 20; i++) {
    const fake = {
      ...stored(first.body.job.id),
      id: randomUUID(),
      requestId: randomUUID(),
      createdAt: today,
      status: "FAILED",
    };
    c.prepare(
      "INSERT INTO creative_ai_jobs(id,project_id,user_id,request_id,created_at,status,payload) VALUES(?,?,?,?,?,?,?)",
    ).run(
      fake.id,
      p.id,
      "designer",
      fake.requestId,
      today,
      fake.status,
      JSON.stringify(fake),
    );
  }
  assert.equal((await req("/ai/jobs", "designer", payload())).status, 429);
  c.prepare(
    "DELETE FROM creative_ai_jobs WHERE user_id=? AND created_at=?",
  ).run("designer", today);
  check("Денний ліміт враховує всі прийняті спроби");
  db.closeDb();
  await db.initDb();
  const restart = await req("/ai/jobs", "designer", b);
  assert.equal(restart.body.reused, true);
  assert.equal(restart.body.job.id, first.body.job.id);
  check("SQLite restart зберігає jobs, permissions та idempotency");
  if (process.argv.includes("--browser")) {
    const { build } = await import("esbuild"),
      { default: puppeteer } = await import("puppeteer-core");
    const built = await build({
      stdin: {
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CreativeWorkspace} from './src/components/CreativeWorkspace';createRoot(document.getElementById('root')).render(<CreativeWorkspace creativeProjectId="${p.id}"/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      format: "iife",
      jsx: "automatic",
      define: {
        "import.meta.env.BASE_URL": JSON.stringify("/"),
        "import.meta.env.VITE_NOVA_WS_URL": "undefined",
      },
    });
    app.get("/test-ai.js", (_q, r) =>
      r.type("js").send(built.outputFiles[0].text),
    );
    const css = (await fs.readdir("dist/assets")).find((f) =>
      f.endsWith(".css"),
    )!;
    app.get("/test-ai.css", (_q, r) =>
      r.sendFile(path.join(process.cwd(), "dist/assets", css)),
    );
    app.get("/test-ai", (_q, r) =>
      r
        .type("html")
        .send(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/test-ai.css"><div id="root"></div><script src="/test-ai.js"></script>',
        ),
    );
    const browser = await puppeteer.launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(origin + "/test-ai");
      await page.waitForSelector('[aria-label="Creative Workspace"]');
      await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent === "AI Tools"));
      await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(b => b.textContent === "AI Tools")!.click());
      await page.waitForSelector('[aria-label="Опис завдання ШІ"]');
      await page.type(
        '[aria-label="Опис завдання ШІ"]',
        "Browser approved scope",
      );
      assert.equal(
        await page.evaluate(
          () =>
            Array.from(document.querySelectorAll("button")).find(
              (b) => b.textContent === "Запустити завдання ШІ",
            )?.disabled,
        ),
        true,
      );
      await page.click('[aria-label="Підтвердити генерацію ШІ"]');
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
          .find((b) => b.textContent === "Перевірити контекст перед запитом")!
          .click(),
      );
      await page.waitForSelector('[aria-label="Контекст Creative AI"]');
      assert.ok(
        (
          await page.$eval(
            '[aria-label="Контекст Creative AI"]',
            (e) => e.textContent,
          )
        )?.includes("blue"),
      );
      await page.click('[aria-label="Підтвердити генерацію ШІ"]');
      await page.click('[aria-label="Підтвердити генерацію ШІ"]');
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
          .find((b) => b.textContent === "Запустити завдання ШІ")!
          .click(),
      );
      await page.waitForFunction(() =>
        document.body.textContent?.includes("COMPLETED"),
      );
      check(
        "Chromium: preview active style, окреме підтвердження, job і DRAFT",
      );
      await page.setViewport({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      check("Chromium: mobile 390px без overflow / React errors");
    } finally {
      await browser.close();
    }
  }
  console.log(`Підсумок: ${n} пройшло.`);
} finally {
  release?.();
  await new Promise<void>((r) => server.close(() => r()));
  db.closeDb();
  if (pool) {
    await pool.query("DELETE FROM projects WHERE id=$1", [bid]);
    await pool.end();
  }
}
