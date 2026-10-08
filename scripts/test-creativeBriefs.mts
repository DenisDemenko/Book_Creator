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
  resolveEffectiveAccess,
  assetLevel,
  entityLevel,
} from "../server/core/collaboration/access";
import { restrictBook } from "../server/core/collaboration/accessView";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "creative-briefs-"));
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
await repo.upsertProject({
  id: "book",
  ownerId: "owner",
  title: "Private book",
});
await books.saveBook({
  ownerId: "owner",
  book: {
    id: "book",
    title: "Private book",
    notes: "SECRET NOTES",
    visualBible: { secret: "PRIVATE BIBLE" },
    chapters: [
      {
        id: "chapter",
        sections: [
          { id: "selected", content: "SELECTED TEXT" },
          { id: "hidden", content: "SECRET MANUSCRIPT" },
        ],
      },
    ],
  },
});
const object = await repo.createEntity({
  projectId: "book",
  type: "object",
  name: "Selected object",
  createdBy: "user:owner",
});
const hiddenObject = await repo.createEntity({
  projectId: "book",
  type: "object",
  name: "SECRET OBJECT",
  createdBy: "user:owner",
});
await assignRole(repo, {
  projectId: "book",
  userId: "designer",
  roleId: "designer",
  actor: "user:owner",
  source: "manual",
});
let disabled = false,
  failBridge = false,
  generateCount = 0,
  publishCount = 0;
let generateHook = async () => {};
const deps = {
  repo: () => repo,
  principal: async (id: string) =>
    disabled ? null : ({ id, role: "writer", isGuest: false } as any),
  access: {
    getBookOwnerId: async (id: string) => (await books.getBook(id))?.ownerId,
    getCollabOwnerId: async () => undefined,
    listAcceptedInvites: async () => [],
    effectiveAccess: makeEffectiveResolver(
      () => repo,
      () => "ready",
    ),
  },
  generate: async (_req: any, input: any) => {
    generateCount++;
    await generateHook();
    return JSON.stringify({ ...input, title: "AI draft" });
  },
  publish: async (_req: any, input: any) => {
    publishCount++;
    assert.deepEqual(Object.keys(input).sort(), [
      "externalId",
      "publicBrief",
      "sourceRevision",
    ]);
    assert.ok(!JSON.stringify(input).includes("SECRET"));
    if (failBridge) throw new Error("offline");
    return { id: "order-one", status: "MODERATION" };
  },
};
const { createCreativeProject } =
  await import("../server/core/creative/projects");
const { registerCreativeBriefRoutes, getCreativeBrief } =
  await import("../server/core/creative/briefs");
const project = await createCreativeProject(deps, "owner", "book", {
  title: "Illustrations",
});
const app = express();
app.use(express.json());
app.use((q, _r, n) => {
  const id = String(q.headers["x-user"] ?? "owner");
  q.principal = {
    id,
    role: id === "admin" ? "admin" : "writer",
    isGuest: id === "guest",
  } as any;
  n();
});
registerCreativeBriefRoutes(app, deps);
const {registerProjectRoutes}=await import('../server/core/projectRoutes');registerProjectRoutes(app,{access:deps.access,repo:()=>repo,coreState:()=> 'ready'});
const {registerSourceRoutes}=await import('../server/core/collaboration/sourceRoutes');registerSourceRoutes(app,{access:deps.access,repo:()=>repo});
const { registerMediaRoutes } = await import("../server/mediaRoutes");
registerMediaRoutes(app, {
  canViewBookAsset: async (q, record) => {
    if (record.bookId !== "book" || record.ownerId !== "owner") return false;
    const eff = await resolveEffectiveAccess(repo, {
      projectId: "book",
      userId: q.principal!.id as string,
      isOwner: q.principal!.id === "owner",
      isAdmin: false,
    });
    return assetLevel(eff, record.id ?? "") !== "none";
  },
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/creative/projects/${project.id}`;
const call = (suffix = "", method = "GET", body?: unknown, user = "owner") =>
  fetch(base + suffix, {
    method,
    headers: { "x-user": user, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
let count = 0;
const check = (name: string) => {
  count++;
  console.log("✓ " + name);
};
const data = {
  type: "illustration",
  title: "Public brief",
  description: "Draw landscape",
  result: "Two illustrations",
  format: "PNG",
  dimensions: "A4",
  style: "Watercolor",
  concepts: 2,
  revisionRounds: 1,
  deadline: "",
  budgetTerms: "Agree budget",
  references: ["https://example.com/reference"],
  aiPolicy: "DISCLOSE",
  sourceFiles: "Layered source",
};
const scope = [{ scope: "scene", ref: "selected", level: "VIEW" }];
try {
  for (const user of ["outsider", "admin", "designer", "guest"])
    assert.equal(
      (await call("", "GET", undefined, user)).status,
      user === "guest" ? 401 : 403,
    );
  check("owner-only brief/tree, including site admin");
  const read = await (await call()).json();
  assert.ok(
    read.targets.some((t: any) => t.scope === "object" && t.ref === object.id),
  );
  assert.ok(read.targets.some((t: any) => t.scope === "visual_bible"));
  check("author selects concrete entities and Visual Bible");
  let r = await call("/brief", "PUT", { expectedVersion: 0, data, scope });
  assert.equal(r.status, 200);
  assert.equal(getCreativeBrief(project.id)?.version, 1);
  assert.deepEqual(await repo.listAccessGrants({ projectId: "book" }), []);
  assert.equal(publishCount, 0);
  check("private save does not grant, publish or edit manuscript");
  assert.equal(
    (await call("/brief", "PUT", { expectedVersion: 0, data, scope })).status,
    409,
  );
  assert.equal(
    (
      await call("/brief", "PUT", {
        expectedVersion: 1,
        data,
        scope: [{ scope: "scene", ref: "foreign", level: "VIEW" }],
      })
    ).status,
    422,
  );
  check("stale version and foreign scope rejected");
  assert.equal(
    (
      await call("/brief", "PUT", {
        expectedVersion: 1,
        data: {
          ...data,
          references: ["https://example.com/api/media/file/private"],
        },
        scope,
      })
    ).status,
    422,
  );
  check("private references cannot publish");
  const ai = await (
    await call("/brief/ai", "POST", { expectedVersion: 1, data })
  ).json();
  assert.equal(ai.draft.title, "AI draft");
  assert.equal(ai.saved, false);
  assert.equal(getCreativeBrief(project.id)?.version, 1);
  check("AI only proposes unsaved draft");
  generateHook = async () => {
    await call("/brief", "PUT", { expectedVersion: 1, data, scope });
  };
  assert.equal(
    (await call("/brief/ai", "POST", { expectedVersion: 1, data })).status,
    409,
  );
  generateHook = async () => {};
  check("AI response rejected after concurrent edit");
  assert.equal(
    (await call("/brief/publish", "POST", { expectedVersion: 2 })).status,
    422,
  );
  assert.equal(publishCount, 0);
  check("explicit confirmation required before bridge call");
  failBridge = true;
  assert.equal(
    (
      await call("/brief/publish", "POST", {
        expectedVersion: 2,
        confirmed: true,
      })
    ).status,
    502,
  );
  assert.equal(getCreativeBrief(project.id)?.status, "DRAFT");
  failBridge = false;
  r = await call("/brief/publish", "POST", {
    expectedVersion: 4,
    confirmed: true,
  });
  assert.equal(r.status, 200);
  assert.equal(getCreativeBrief(project.id)?.published?.id, "order-one");
  check("failed bridge retry and confirmed public snapshot");
  const snapshot = getCreativeBrief(project.id)?.published;
  assert.equal(
    (
      await call("/brief", "PUT", {
        expectedVersion: 6,
        data: { ...data, title: "New private draft" },
        scope,
      })
    ).status,
    200,
  );
  assert.deepEqual(getCreativeBrief(project.id)?.published, snapshot);
  check("new draft never replaces confirmed snapshot");
  assert.equal(
    (
      await call("/access", "POST", {
        userId: "designer",
        target: { scope: "object", ref: object.id, level: "VIEW" },
      })
    ).status,
    422,
  );
  check("API requires explicit grant confirmation");
  const grant = await (
    await call("/access", "POST", {
      confirmed: true,
      userId: "designer",
      target: { scope: "object", ref: object.id, level: "VIEW" },
    })
  ).json();
  assert.ok(grant.grant?.id, JSON.stringify(grant));
  assert.equal(
    (await call(`/resources/object/${object.id}`, "GET", undefined, "designer"))
      .status,
    200,
  );
  assert.equal(
    (
      await call(
        `/resources/object/${hiddenObject.id}`,
        "GET",
        undefined,
        "designer",
      )
    ).status,
    404,
  );
  assert.equal(
    (await call("/resources/scene/hidden", "GET", undefined, "designer"))
      .status,
    404,
  );
  check("specific object grant hides other objects and manuscript");
  const coreEntities=await fetch(new URL('/api/projects/book/entities',base),{headers:{'x-user':'designer'}});assert.equal(coreEntities.status,200);const entityList=await coreEntities.json();assert.deepEqual(entityList.entities.map((e:any)=>e.id),[object.id]);
  const sourceReply=await fetch(new URL('/api/core/projects/book/source',base),{headers:{'x-user':'designer'}});assert.equal(sourceReply.status,200);assert.ok(!(await sourceReply.text()).includes('SECRET'));check('ordinary Core list and book source API obey object scope');

  const eff = await resolveEffectiveAccess(repo, {
    projectId: "book",
    userId: "designer",
    isOwner: false,
    isAdmin: false,
  });
  assert.equal(entityLevel(eff, "object", hiddenObject.id), "none");
  assert.equal(assetLevel(eff, "foreign-file"), "none");
  const visible = restrictBook((await books.getBook("book"))!.book, eff);
  assert.ok(!JSON.stringify(visible).includes("SECRET"));
  assert.ok(!JSON.stringify(visible).includes("PRIVATE BIBLE"));
  check("source projection hides ungranted scenes, notes and Bible");
  assert.equal((await call("/access/" + grant.grant.id, "DELETE")).status, 200);
  assert.equal(
    (await call(`/resources/object/${object.id}`, "GET", undefined, "designer"))
      .status,
    403,
  );
  check("revocation takes effect on next API request");
  const audit = await (await call("/access")).json();
  assert.ok(audit.events.some((e: any) => e.action === "access_granted"));
  assert.ok(audit.events.some((e: any) => e.action === "access_revoked"));
  check("grants and revocations audited");
  const before = generateCount;
  disabled = true;
  assert.equal(
    (await call("/brief/ai", "POST", { expectedVersion: 7, data })).status,
    403,
  );
  assert.equal(generateCount, before);
  disabled = false;
  check("disabled author cannot invoke AI");

  const media = await import("../server/media/mediaLibraryStore");
  const selectedFile = await media.saveAsset({
    ownerId: "owner",
    bookId: "book",
    kind: "upload",
    filename: "Selected reference.png",
    mimeType: "image/png",
    bytes: Buffer.from("test"),
  });
  const hiddenFile = await media.saveAsset({
    ownerId: "owner",
    bookId: "book",
    kind: "upload",
    filename: "Hidden reference.png",
    mimeType: "image/png",
    bytes: Buffer.from("test"),
  });
  const grantTarget = async (target: any, dates = {}) => {
    const r = await call("/access", "POST", {
      confirmed: true,
      userId: "designer",
      target,
      ...dates,
    });
    assert.equal(r.status, 201, await r.clone().text());
    return (await r.json()).grant;
  };
  const fileGrant = await grantTarget({
    scope: "media_asset",
    ref: selectedFile.id,
    level: "WORK",
  });
  assert.equal(
    (
      await call(
        "/resources/media_asset/" + selectedFile.id,
        "GET",
        undefined,
        "designer",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/resources/media_asset/" + hiddenFile.id,
        "GET",
        undefined,
        "designer",
      )
    ).status,
    404,
  );
  check("WORK on one reference does not expose entire library");
  const download = (id: string) =>
    fetch(new URL("/api/media/file/" + id, base), {
      headers: { "x-user": "designer" },
    });
  assert.equal((await download(selectedFile.id)).status, 200);
  assert.equal((await download(hiddenFile.id)).status, 404);
  assert.equal((await call("/access/" + fileGrant.id, "DELETE")).status, 200);
  assert.equal((await download(selectedFile.id)).status, 404);
  check("actual file download obeys individual grant and revocation");
  await grantTarget({ scope: "visual_bible", ref: "book", level: "VIEW" });
  assert.equal(
    (await call("/resources/visual_bible/book", "GET", undefined, "designer"))
      .status,
    200,
  );
  check("explicit Visual Bible grant works");
  await grantTarget(
    { scope: "scene", ref: "selected", level: "VIEW" },
    {
      validFrom: new Date(Date.now() + 3600000).toISOString(),
      validUntil: new Date(Date.now() + 7200000).toISOString(),
    },
  );
  assert.equal(
    (await call("/resources/scene/selected", "GET", undefined, "designer"))
      .status,
    404,
  );
  check("future grant does not work early");
  const expiredEff = await resolveEffectiveAccess(repo, {
    projectId: "book",
    userId: "designer",
    isOwner: false,
    isAdmin: false,
    now: Date.now() + 10800000,
  });
  assert.equal(expiredEff.scenes.selected, undefined);
  check("temporary grant expires");
  const race = await Promise.all([
    call("/brief", "PUT", { expectedVersion: 7, data, scope }),
    call("/brief", "PUT", { expectedVersion: 7, data, scope }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  check("concurrent saves: one success and one conflict");
  assert.equal(
    (await books.getBook("book"))!.book.chapters[0].sections[1].content,
    "SECRET MANUSCRIPT",
  );
  check("book source unchanged");

  const {creativeProjectDb}=await import('../server/core/creative/projects');const pending=getCreativeBrief(project.id)!;
  creativeProjectDb().prepare('UPDATE creative_briefs SET payload=? WHERE project_id=?').run(JSON.stringify({...pending,status:'CONFIRMED',publishingAt:new Date(Date.now()-120000).toISOString()}),project.id);
  assert.equal((await call('/brief/publish','POST',{expectedVersion:pending.version,confirmed:true})).status,200);assert.equal(getCreativeBrief(project.id)?.published?.id,'order-one');check('interrupted publish recovers after lease without duplicate');
  if (process.argv.includes("--browser")) {
    const { build } = await import("esbuild");
    const built = await build({
      stdin: {
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CreativeBriefPanel}from'./src/components/CreativeBriefPanel';createRoot(document.getElementById('root')).render(<CreativeBriefPanel creativeProjectId="${project.id}"/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
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
        '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root" class="p-4 bg-slate-950 text-slate-100"></div><script src="/probe.js"></script>',
      ),
    );
    const { launch } = await import("puppeteer-core");
    const browser = await launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(new URL("/probe", base).href);
      await page.waitForSelector("[data-creative-brief] textarea");
      const click = async (text: string) => {
        await page.evaluate((text) => {
          const b = Array.from(document.querySelectorAll("button")).find(
            (b) => b.textContent?.trim() === text,
          );
          if (!b) throw new Error("Missing button " + text);
          b.click();
        }, text);
      };
      await click("Допомогти скласти ТЗ");
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("textarea")).some(
          (i) => i.value === "AI draft",
        ),
      );
      assert.notEqual(getCreativeBrief(project.id)?.data.title, "AI draft");
      check("BROWSER: AI fills form without automatic save");
      await click("Зберегти бриф і scope");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Бриф збережено"),
      );
      assert.equal(getCreativeBrief(project.id)?.data.title, "AI draft");
      check("BROWSER: explicit private save");
      await click("Переглянути збережений публічний бриф");
      await page.waitForSelector("pre");
      assert.ok(
        await page.evaluate(
          () =>
            Array.from(document.querySelectorAll("button")).find(
              (b) => b.textContent?.trim() === "Надіслати підтверджений бриф",
            )?.disabled,
        ),
      );
      check("BROWSER: publication blocked until confirmation");
      await page.evaluate(()=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent?.includes('Підтверджую надсилання'));(label?.querySelector('input') as HTMLInputElement)?.click();});
      await click('Надіслати підтверджений бриф');await page.waitForFunction(()=>document.body.textContent?.includes('Бриф надіслано на модерацію'));
      assert.equal(getCreativeBrief(project.id)?.status,'MODERATION');check('BROWSER: explicit confirmation sends snapshot');

      await page.setViewport({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(dir, "brief-mobile.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      check("BROWSER: 390px without overflow or JS errors");
    } finally {
      await browser.close();
    }
  }
  console.log(
    `Підсумок: ${count} пройшло (${pool ? "PostgreSQL" : "memory"}).`,
  );
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.closeDb();
  await pool?.end();
}
