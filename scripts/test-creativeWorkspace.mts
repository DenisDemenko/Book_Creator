import type { ElementHandle } from "puppeteer-core";
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
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "creative-workspace-"));
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
let hook = async () => {};
let quotaFail = false;
const { registerCreativeWorkspaceRoutes, creativeWorkspaceDb } =
  await import("../server/core/creative/workspace");
const app = express();
app.use(express.json({ limit: "40mb" }));
app.use((q, _r, n) => {
  const id = String(q.headers["x-user"] ?? "owner");
  q.principal = {
    id,
    role: id === "admin" ? "admin" : "writer",
    isGuest: id === "guest",
  } as any;
  n();
});
registerCreativeWorkspaceRoutes(app, {
  ...deps,
  chargeUpload: async () => {
    await hook();
    if (quotaFail)
      throw new (
        await import("../server/core/collaboration/workspaceStore")
      ).WorkspaceError(402, "quota");
  },
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  base = `/api/creative/projects/${p.id}/workspace`;
const req = async (path = "", user = "owner", body?: unknown) => {
  const r = await fetch(origin + base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-user": user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zX8AAAAASUVORK5CYII=";
const upload = (user = "designer", body: Record<string, unknown> = {}) =>
  req("/assets", user, { filename: "cover.png", dataUrl: png, ...body });
let n = 0;
const check = (label: string) => {
  n++;
  console.log("✓ " + label);
};
let file: any, version2: any;
try {
  assert.equal((await req("", "guest")).status, 401);
  assert.equal((await req("", "other")).status, 403);
  assert.equal((await req("", "admin")).status, 403);
  assert.equal((await req("", "designer")).status, 403);
  check("guest, outsider, admin and selected specialist without grant denied");
  assert.equal(
    (await req("/access", "owner", { userId: "designer", level: "WORK" }))
      .status,
    422,
  );
  assert.equal(
    (
      await req("/access", "other", {
        userId: "designer",
        level: "WORK",
        confirmed: true,
      })
    ).status,
    403,
  );
  let ownGrant = await req("/access", "owner", {
    userId: "designer",
    level: "VIEW",
    confirmed: true,
  });
  assert.equal(ownGrant.status, 201);
  const ownGrantId = ownGrant.body.grant.id;
  assert.equal(ownGrant.body.bookAccessChanged, false);
  const limited = await req("", "designer");
  assert.equal(limited.status, 200);
  assert.deepEqual(limited.body.references, []);
  assert.deepEqual(
    (await req("/context", "designer")).body.context.chapters,
    [],
  );
  assert.equal((await upload()).status, 403);
  assert.equal(
    (await req(`/access/${ownGrantId}/revoke`, "owner", { confirmed: true }))
      .status,
    200,
  );
  ownGrant = await req("/access", "owner", {
    userId: "designer",
    level: "WORK",
    confirmed: true,
  });
  assert.equal(ownGrant.status, 201);
  const scopedUpload = await upload();
  assert.equal(scopedUpload.status, 201);
  const { queryCollaboration: queryOnlyWorkspace } =
    await import("../server/core/collaboration/aiCollaboration");
  const scopedResult = await queryOnlyWorkspace(
    deps,
    "designer",
    bid,
    "GET_DELIVERABLES",
    {},
  );
  assert.ok(
    scopedResult.deliverables.some(
      (a: any) => a.id === scopedUpload.body.asset.id,
    ),
  );

  assert.equal(
    (
      await req(`/access/${ownGrant.body.grant.id}/revoke`, "owner", {
        confirmed: true,
      })
    ).status,
    200,
  );
  assert.equal((await req("", "designer")).status, 403);
  check(
    "explicit per-workspace VIEW/WORK grants without manuscript or library access; audited revocation",
  );
  let media = await grant("media_library", "view");
  assert.equal((await req("", "designer")).status, 200);
  assert.equal((await upload()).status, 403);
  assert.equal(
    (await req("/chat", "designer", { text: "view-only cannot chat" })).status,
    403,
  );
  check("VIEW can read but cannot upload or comment");
  await repo.revokeAccessGrant(media.id, "user:owner");
  const future = await grant("media_library", "work", null, {
    validFrom: new Date(Date.now() + 3600000).toISOString(),
    validUntil: new Date(Date.now() + 7200000).toISOString(),
  });
  assert.equal((await req("", "designer")).status, 403);
  await repo.revokeAccessGrant(future.id, "user:owner");
  check("future media grant does not work early");
  media = await grant("media_library", "work");
  await grant("scene", "view", "s");
  const ctx = await req("/context", "designer");
  assert.equal(ctx.status, 200);
  assert.ok(JSON.stringify(ctx.body).includes("ALLOWED TEXT"));
  assert.ok(!JSON.stringify(ctx.body).includes("SECRET"));
  check("scoped manuscript excludes hidden scene and private notes");
  const usersBefore = await repo.listParticipants(bid),
    grantsBefore = await repo.listAccessGrants({ projectId: bid });
  assert.equal(
    (
      await upload("designer", {
        dataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
      })
    ).status,
    422,
  );
  assert.equal(
    (await upload("designer", { dataUrl: "data:image/png;base64,SGVsbG8=" }))
      .status,
    422,
  );
  check("active SVG and fake MIME signatures rejected");
  let r = await upload();
  assert.equal(r.status, 201);
  file = r.body.asset;
  assert.equal(file.status, "DRAFT");
  const bytes = await fetch(origin + base + `/assets/${file.id}/file`, {
    headers: { "x-user": "designer" },
  });
  assert.equal(bytes.status, 200);
  assert.equal(
    Buffer.from(await bytes.arrayBuffer()).toString("base64"),
    png.split(",")[1],
  );
  check("private upload/file bytes persist correctly");
  const second = await createCreativeProject(deps, "owner", bid, {
    title: "Another workspace",
  });
  const remoteUpload = await fetch(
    `${origin}/api/creative/projects/${second.id}/workspace/assets`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "owner" },
      body: JSON.stringify({ filename: "foreign.png", dataUrl: png }),
    },
  );
  assert.equal(remoteUpload.status, 201);
  const foreign = (await remoteUpload.json()).asset;
  assert.equal(
    (
      await fetch(origin + base + `/assets/${foreign.id}/file`, {
        headers: { "x-user": "owner" },
      })
    ).status,
    404,
  );
  assert.equal(
    (await upload("owner", { parentId: foreign.id, expectedRevision: 1 }))
      .status,
    404,
  );
  assert.equal(
    (
      await req("/annotations", "owner", {
        assetId: foreign.id,
        text: "foreign",
        x: 0.2,
        y: 0.3,
      })
    ).status,
    404,
  );
  check(
    "real asset IDs from another workspace do not cross file/version/annotation boundaries",
  );

  assert.equal(
    (
      await req(`/assets/${file.id}/state`, "designer", {
        status: "APPROVED",
        expectedRevision: 1,
        confirmed: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req(`/assets/${file.id}/state`, "designer", {
        status: "SUBMITTED_FOR_REVIEW",
        expectedRevision: 1,
      })
    ).status,
    422,
  );
  check("specialist cannot approve, submission needs confirmation");
  r = await req(`/assets/${file.id}/state`, "designer", {
    status: "SUBMITTED_FOR_REVIEW",
    expectedRevision: 1,
    confirmed: true,
  });
  assert.equal(r.status, 200);
  file = r.body.asset;
  assert.equal(
    (
      await req(`/assets/${file.id}/state`, "owner", {
        status: "CHANGES_REQUESTED",
        expectedRevision: 2,
        confirmed: true,
      })
    ).status,
    422,
  );
  r = await req(`/assets/${file.id}/state`, "owner", {
    status: "CHANGES_REQUESTED",
    expectedRevision: 2,
    confirmed: true,
    note: "Please correct title",
  });
  assert.equal(r.status, 200);
  file = r.body.asset;
  check("owner requests changes with required reason");
  r = await req("/annotations", "owner", {
    assetId: file.id,
    text: "Change this point",
    x: 0.3,
    y: 0.6,
  });
  assert.equal(r.status, 201);
  const ann = r.body.annotation;
  assert.equal(
    (
      await req("/annotations", "designer", {
        assetId: file.id,
        text: "invalid",
        x: 2,
        y: 0,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await req(`/annotations/${ann.id}/resolve`, "designer", {
        expectedRevision: 1,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req(`/annotations/${ann.id}/resolve`, "owner", {
        expectedRevision: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await req(`/annotations/${ann.id}/resolve`, "owner", {
        expectedRevision: 1,
      })
    ).status,
    409,
  );
  check("image pins validated, author resolves with CAS");
  const concurrent = await Promise.all([
    upload("designer", { parentId: file.id, expectedRevision: 3 }),
    upload("designer", { parentId: file.id, expectedRevision: 3 }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
  version2 = concurrent.find((r) => r.status === 201)!.body.asset;
  assert.equal(version2.version, 2);
  assert.equal(version2.parentId, file.id);
  assert.equal(
    (await req()).body.assets.find((a: any) => a.id === file.id).status,
    "CHANGES_REQUESTED",
  );
  const oldBytes = await fetch(origin + base + `/assets/${file.id}/file`, {
    headers: { "x-user": "designer" },
  });
  assert.equal(
    Buffer.from(await oldBytes.arrayBuffer()).toString("base64"),
    png.split(",")[1],
  );
  check("concurrent new revisions: one winner; old status and file preserved");
  assert.equal(
    (
      await req(`/assets/${file.id}/state`, "owner", {
        status: "APPROVED",
        expectedRevision: 3,
        confirmed: true,
      })
    ).status,
    409,
  );
  check("old version cannot be approved after a newer upload");
  r = await req(`/assets/${version2.id}/state`, "designer", {
    status: "SUBMITTED_FOR_REVIEW",
    expectedRevision: 1,
    confirmed: true,
  });
  assert.equal(r.status, 200);
  const choices = await Promise.all(
    ["APPROVED", "REJECTED"].map((status) =>
      req(`/assets/${version2.id}/state`, "owner", {
        status,
        expectedRevision: 2,
        confirmed: true,
        note: "Reviewed",
      }),
    ),
  );
  assert.deepEqual(choices.map((r) => r.status).sort(), [200, 409]);
  check("concurrent review has exactly one decision and audit");
  const decided = choices.find((r) => r.status === 200)!.body.asset;
  assert.ok(decided.status === "APPROVED" || decided.status === "REJECTED");
  if (decided.status === "APPROVED") {
    r = await req(`/assets/${version2.id}/state`, "owner", {
      status: "FINAL",
      expectedRevision: 3,
      confirmed: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.canonChanged, false);
  } else {
    r = await req(`/assets/${version2.id}/state`, "owner", {
      status: "ARCHIVED",
      expectedRevision: 3,
      confirmed: true,
    });
    assert.equal(r.status, 200);
  }
  check("final/archive is explicit and never writes canon");
  const { queryCollaboration } =
    await import("../server/core/collaboration/aiCollaboration");
  const readable = await queryCollaboration(
    deps,
    "designer",
    bid,
    "GET_DELIVERABLES",
    {},
  );
  assert.ok(readable.available);
  assert.ok(readable.deliverables.some((a: any) => a.id === file.id));
  const denied = await queryCollaboration(
    deps,
    "other",
    bid,
    "GET_DELIVERABLES",
    {},
  ).then(
    () => false,
    () => true,
  );
  assert.ok(denied);
  check("collaboration/AI deliverable query is scoped to authorized Workspace");
  const ownerFile = await upload("owner");
  assert.equal(ownerFile.status, 201);
  assert.equal(
    (
      await upload("designer", {
        parentId: ownerFile.body.asset.id,
        expectedRevision: 1,
      })
    ).status,
    403,
  );
  check("specialist cannot replace another creator’s work");
  const video = await upload("designer", {
    filename: "movie.webm",
    dataUrl: "data:video/webm;base64,GkXfow==",
  });
  assert.equal(video.status, 201);
  const v = video.body.asset;
  assert.equal(
    (
      await req("/annotations", "designer", {
        assetId: v.id,
        text: "At this frame",
        timecode: 12.5,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await req("/annotations", "designer", {
        assetId: v.id,
        text: "bad",
        timecode: -1,
      })
    ).status,
    422,
  );
  check("video timecode annotations");
  let vr = await req(`/assets/${v.id}/state`, "designer", {
    status: "SUBMITTED_FOR_REVIEW",
    expectedRevision: 1,
    confirmed: true,
  });
  assert.equal(vr.status, 200);
  vr = await req(`/assets/${v.id}/state`, "owner", {
    status: "CHANGES_REQUESTED",
    expectedRevision: 2,
    confirmed: true,
    note: "Shorten video",
  });
  assert.equal(vr.status, 200);
  vr = await req(`/assets/${v.id}/state`, "designer", {
    status: "RESUBMITTED",
    expectedRevision: 3,
    confirmed: true,
  });
  assert.equal(vr.status, 200);
  vr = await req(`/assets/${v.id}/state`, "owner", {
    status: "APPROVED",
    expectedRevision: 4,
    confirmed: true,
  });
  assert.equal(vr.status, 200);
  check("same-file changes requested → resubmitted → approved");

  assert.equal(
    (
      await req("/chat", "designer", {
        text: "Ready https://example.org",
        assetIds: [v.id],
        mentions: ["owner"],
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await req("/chat", "designer", {
        text: "bad attachment",
        assetIds: ["foreign-id"],
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await req("/chat", "designer", {
        text: "bad mention",
        mentions: ["other"],
      })
    ).status,
    422,
  );
  const chat = (await req("/chat")).body;
  assert.ok(
    chat.events.some(
      (e: any) => e.type === "CHAT_MESSAGE" && e.assetIds[0] === v.id,
    ),
  );
  check("chat persists links, private attachments, mentions and system events");
  assert.ok((await req()).body.unread > 0);
  assert.equal(
    (await req("/read", "owner", { seq: chat.events.at(-1).seq })).status,
    200,
  );
  assert.equal((await req()).body.unread, 0);
  assert.equal((await req("/read", "owner", { seq: 1 })).status, 200);
  assert.equal((await req()).body.unread, 0);
  assert.equal((await req("/read", "owner", { seq: 999999 })).status, 422);
  check("read cursor monotonic and bounded");
  const conn = creativeWorkspaceDb();
  for (let i = 0; i < 105; i++)
    conn
      .prepare(
        "INSERT INTO creative_workspace_events(project_id,payload) VALUES(?,?)",
      )
      .run(
        p.id,
        JSON.stringify({
          id: "page-" + i,
          type: "CHAT_MESSAGE",
          actorId: "owner",
          text: "history " + i,
          createdAt: new Date().toISOString(),
        }),
      );
  const page = (await req("/chat")).body;
  assert.equal(page.events.length, 100);
  assert.ok(page.nextBefore);
  assert.ok(
    (await req("/chat?before=" + page.nextBefore)).body.events.length > 0,
  );
  check("bounded chat history paginates without losing old records");
  quotaFail = true;
  assert.equal((await upload()).status, 402);
  quotaFail = false;
  check("quota rejection persists no new file");
  hook = async () => {
    await repo.revokeAccessGrant(media.id, "user:owner");
  };
  assert.equal((await upload()).status, 403);
  hook = async () => {};
  assert.equal((await req("", "designer")).status, 403);
  assert.equal(
    (
      await fetch(origin + base + `/assets/${file.id}/file`, {
        headers: { "x-user": "designer" },
      })
    ).status,
    403,
  );
  check(
    "revocation during async quota check blocks upload and subsequent file read",
  );
  media = await grant("media_library", "work");
  setProject({ ...selected, status: "CANCELLED" });
  assert.equal((await upload()).status, 403);
  assert.equal((await req("", "designer")).status, 200);
  check("cancelled project retains history but forbids writes");
  setProject(selected);
  assert.deepEqual(await repo.listParticipants(bid), usersBefore);
  assert.equal((await books.getBook(bid))?.revision, 1);
  check("no automatic participants, grants, manuscript or canon writes");
  await repo.setParticipantStatus(
    (await repo.getParticipant(bid, "designer"))!.id,
    "suspended",
  );
  assert.equal((await req("", "designer")).status, 403);
  await repo.setParticipantStatus(
    (await repo.getParticipant(bid, "designer"))!.id,
    "active",
  );
  check("inactive specialist denied even with a grant");
  db.closeDb();
  await db.initDb();
  assert.ok((await req()).body.assets.some((x: any) => x.id === file.id));
  assert.ok((await req("/chat")).body.events.length > 0);
  check("files and chat survive database close/reopen");
  if (process.argv.includes("--browser")) {
    const { build } = await import("esbuild");
    const built = await build({
      stdin: {
        contents: `import React from'react';import{createRoot}from'react-dom/client';import{CreativeWorkspace}from'./src/components/CreativeWorkspace';createRoot(document.getElementById('root')).render(<CreativeWorkspace creativeProjectId="${p.id}"/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      define: { "import.meta.env": JSON.stringify({ BASE_URL: "/" }) },
    });
    const css = (await fs.readdir("dist/assets")).find((f) =>
      /^index-.*\.css$/.test(f),
    );
    assert.ok(css);
    const cssText = await fs.readFile(path.join("dist/assets", css), "utf8");
    app.get("/probe.js", (_q, r) =>
      r.type("js").send(built.outputFiles[0].text),
    );
    app.get("/style.css", (_q, r) => r.type("css").send(cssText));
    app.get("/probe", (_q, r) =>
      r.send(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><main id="root" class="bg-slate-950 text-slate-100 p-4"></main><script src="/probe.js"></script>',
      ),
    );
    const { launch } = await import("puppeteer-core");
    const browser = await launch({
      protocolTimeout: 30000,
      executablePath: process.env.CHROME_PATH ?? "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(origin + "/probe");
      await page.waitForSelector('[aria-label="Нова робота"]');
      const uploadPath = path.join(dir, "browser.png");
      await fs.writeFile(uploadPath, Buffer.from(png.split(",")[1], "base64"));
      await (
        (await page.$(
          '[aria-label="Нова робота"]',
        )) as ElementHandle<HTMLInputElement>
      ).uploadFile(uploadPath);
      await page.waitForFunction(() =>
        document
          .querySelector("[role=status]")
          ?.textContent?.includes("Нову роботу"),
      );
      await page.waitForSelector('img[alt*="browser.png"]');
      check("BROWSER real UI uploads private image and displays it");
      await page.click('img[alt*="browser.png"]');
      const input = await page.$("textarea");
      assert.ok(input); // review and pin areas use dedicated labels below
      await page.evaluate(() => {
        const label = [...document.querySelectorAll("label")].find(
          (l) => l.textContent?.trim() === "Коментар",
        );
        const ta = label?.querySelector("textarea");
        if (!ta) throw Error("no annotation");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!;
        setter.call(ta, "Browser pin");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const click = async (text: string) => {
        const handles = await page.$$("button");
        for (const h of handles)
          if ((await h.evaluate((e) => e.textContent))?.trim() === text) {
            await h.click();
            return;
          }
        throw Error("button " + text);
      };
      await click("Додати коментар");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Browser pin"),
      );
      check("BROWSER image pin is saved and appears in annotations");
      await page.click('input[aria-label="Підтвердити рішення"]');
      await click("На перевірці");
      await page.waitForFunction(() =>
        document
          .querySelector("[role=status]")
          ?.textContent?.includes("На перевірці"),
      );
      await page.click('input[aria-label="Підтвердити рішення"]');
      await click("Затверджено");
      await page.waitForFunction(() =>
        document
          .querySelector("[role=status]")
          ?.textContent?.includes("Затверджено"),
      );
      await page.click('input[aria-label="Підтвердити рішення"]');
      await click("Фінальний");
      await page.waitForFunction(() =>
        document
          .querySelector("[role=status]")
          ?.textContent?.includes("Фінальний"),
      );
      check(
        "BROWSER confirmed submit → approve → final, no automatic approval",
      );
      await click("Версії");
      await page.select('select[aria-label="Матеріал"]', version2.id);
      await page.select('select[aria-label="Порівняти з версією"]', file.id);
      await page.waitForFunction(
        () => document.querySelectorAll("img").length === 2,
      );
      await page.select('select[aria-label="Режим порівняння"]', "overlay");
      assert.ok(
        await page.$eval(
          'img[alt^="Попередня"]',
          (e) => Number((e as HTMLImageElement).style.opacity) === 0.5,
        ),
      );
      await page.select('select[aria-label="Режим порівняння"]', "before");
      assert.ok(
        await page.$eval('img[alt^="Попередня"]', (e) =>
          (e as HTMLImageElement).style.clipPath.includes("inset"),
        ),
      );
      check(
        "BROWSER immutable versions compare side-by-side, overlay and before/after",
      );
      const { execFileSync } = await import("node:child_process");
      const videoFile = path.join(dir, "browser.webm");
      execFileSync("ffmpeg", [
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=teal:s=128x128:r=10",
        "-t",
        "2",
        "-c:v",
        "libvpx",
        "-y",
        videoFile,
      ]);
      await (
        (await page.$(
          '[aria-label="Нова робота"]',
        )) as ElementHandle<HTMLInputElement>
      ).uploadFile(videoFile);
      await page.waitForSelector("video");
      await page.waitForFunction(() => {
        const v = document.querySelector("video");
        return v && v.readyState >= 1;
      });
      await click("Огляд");
      await page.type("input[type=number]", "0.5");
      await page.evaluate(() => {
        const label = [...document.querySelectorAll("label")].find(
          (l) => l.textContent?.trim() === "Коментар",
        );
        const ta = label?.querySelector("textarea");
        if (!ta) throw Error("no comment");
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(ta, "Video frame");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click("Додати коментар");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Video frame"),
      );
      await click("Коментарі");
      await click("До таймкоду");
      await page.waitForFunction(() => {
        const v = document.querySelector("video");
        return v && v.currentTime > 0.4;
      });
      check("BROWSER real video preview and annotation seek across tabs");
      await click("Учасники");
      assert.ok(
        await page.$$eval("button", (bs) =>
          bs.some(
            (b) =>
              b.textContent?.trim() === "Надати доступ Workspace" &&
              (b as HTMLButtonElement).disabled,
          ),
        ),
      );
      await page.click('[aria-label="Підтвердження доступу Workspace"]');
      await click("Надати доступ Workspace");
      await page.waitForFunction(() =>
        document
          .querySelector("[role=status]")
          ?.textContent?.includes("надано окремо"),
      );
      page.once("dialog", (d) => void d.accept());
      await click("Відкликати");
      await page.waitForFunction(() =>
        document
          .querySelector("[role=status]")
          ?.textContent?.includes("відкликано"),
      );
      check("BROWSER owner explicitly grants and revokes per-workspace access");
      const specialist = await browser.newPage();
      specialist.on("pageerror", (e) => errors.push(String(e)));
      await specialist.setExtraHTTPHeaders({ "x-user": "designer" });
      await specialist.goto(origin + "/probe");
      await specialist.waitForSelector('[aria-label="Нова робота"]');
      assert.equal(
        await specialist.evaluate(() =>
          [...document.querySelectorAll("button")].some(
            (b) => b.textContent?.trim() === "Затверджено",
          ),
        ),
        false,
      );
      check("BROWSER specialist sees work access, cannot approve");
      await page.bringToFront();
      await click("Чат");
      await page.type(
        'textarea[aria-label="Повідомлення"]',
        "Live message from author",
      );
      await click("Надіслати");
      await specialist.bringToFront();
      await specialist.waitForFunction(
        () => document.body.textContent?.includes("Live message from author"),
        { timeout: 10000 },
      );
      check("BROWSER chat synchronizes between two authorized sessions");
      await repo.revokeAccessGrant(media.id, "user:owner");
      await specialist.waitForSelector("[role=alert]", { timeout: 10000 });
      assert.equal(await specialist.$("img"), null);
      assert.equal(await specialist.$('[aria-label="Нова робота"]'), null);
      check("BROWSER revocation removes private workspace and cached viewer");
      await specialist.close();
      await page.bringToFront();
      await page.setViewport({ width: 390, height: 844 });
      await click("Чат");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(dir, "workspace-mobile.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      check("BROWSER tabs at 390px without overflow or JS errors");
    } finally {
      await browser.close();
    }
  }
  console.log(
    `Підсумок: ${n} пройшло (${pool ? "PostgreSQL" : "Memory"}). Артефакти: ${dir}`,
  );
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.closeDb();
  if (pool) {
    await pool
      .query("DELETE FROM core_projects WHERE id=$1", [bid])
      .catch(() => {});
    await pool.end();
  }
}
