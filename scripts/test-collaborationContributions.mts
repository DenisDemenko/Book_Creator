import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { computeEffective } from "../server/core/collaboration/access";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { bootstrapOntology } from "../server/core/ontology/lifecycle";
import { assignRole } from "../server/core/collaboration/participants";
import type { RealtimeAccessDeps } from "../server/realtimeAuth";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "collab-contributions-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, "book.db");
const store = await import("../server/bookStore");
const db = await import("../server/db");
const { registerContributionRoutes } =
  await import("../server/core/collaboration/contributionRoutes");
const { registerSourceRoutes } =
  await import("../server/core/collaboration/sourceRoutes");
const journal = await import("../server/core/collaboration/contributionStore");
const { registerWorkflowRunRoutes } =
  await import("../server/core/workflows/runRoutes");
const lifecycle = await import("../server/core/workflows/lifecycle");
let count = 0;
const check = (label: string) => {
  count++;
  console.log(`✓ ${label}`);
};
await db.initDb();
assert.equal(db.isAvailable(), true);
const { createCorePool } = await import("../server/core");
const pgPool = process.env.CORE_TEST_DATABASE_URL
  ? createCorePool(process.env.CORE_TEST_DATABASE_URL)
  : null;
if (pgPool) {
  const migration = await import("../server/core/migrate");
  await migration.runMigrations(
    pgPool,
    await migration.loadMigrations(migration.resolveMigrationsDir()),
  );
}
const { PgCoreRepository } = await import("../server/core/pgRepository");
const repo = pgPool ? new PgCoreRepository(pgPool) : new MemoryCoreRepository();
await bootstrapOntology(repo);
await assignRole(repo, {
  projectId: "book",
  userId: "co",
  roleId: "co_author",
  actor: "user:owner",
  source: "admin",
});
await assignRole(repo, {
  projectId: "book",
  userId: "editor",
  roleId: "editor",
  actor: "user:owner",
  source: "admin",
});
let revoked = false;
const access: RealtimeAccessDeps = {
  getBookOwnerId: async (id) => (await store.getBook(id))?.ownerId,
  getCollabOwnerId: async () => undefined,
  listAcceptedInvites: async () => [],
  effectiveAccess: async ({ projectId, userId }) => {
    if (
      (revoked && userId === "co") ||
      !["co", "editor", "reader"].includes(userId)
    )
      return null;
    const eff = computeEffective(projectId, userId, [], { full: false });
    eff.scenes.s1 = userId === "reader" ? "view" : "edit";
    eff.restricted = true;
    eff.canWriteAny = userId !== "reader";
    return eff;
  },
};
await store.saveBook({
  ownerId: "owner",
  book: {
    id: "book",
    title: "Спільна книга",
    characters: [],
    chapters: [
      {
        id: "ch",
        sections: [
          { id: "s1", content: "Початок" },
          { id: "hidden", content: "TAEMNY TEXT" },
        ],
      },
    ],
  },
});
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers["x-user"] ?? "owner");
  req.principal = {
    id: id === "guest" ? null : id,
    role: id === "admin" ? "admin" : "writer",
    isGuest: id === "guest",
  } as any;
  next();
});
let saved = 0;
registerContributionRoutes(app, {
  repo: () => repo,
  access,
  onSaved: () => {
    saved++;
  },
});
registerSourceRoutes(app, {
  repo: () => repo,
  access,
  onSaved: () => {
    saved++;
  },
});
const engine = {
  repo,
  services: {
    resolveModel: async () => undefined,
    generate: async () => {
      throw new Error("no paid calls");
    },
    canInspectWorkflowProject: async (actor: string, project: string) =>
      project === "book" && actor === "user:owner",
  },
};
registerWorkflowRunRoutes(app, {
  repo: () => repo,
  engine: () => engine,
  requireStudio: (_req, _res, next) => next(),
  requireControl: (req, res, next) => {
    if (req.principal?.id !== "owner") {
      res.status(403).json({ error: "control denied" });
      return;
    }
    next();
  },
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function req(
  user: string,
  suffix: string,
  method = "GET",
  body?: unknown,
) {
  const r = await fetch(root + suffix, {
    method,
    headers: { "x-user": user, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await r.json() };
}
const base = "/api/core/projects/book/collaboration";
const propose = (
  user = "co",
  revision = 1,
  section = "s1",
  content = "Новий текст",
) =>
  req(user, base + "/proposals", "POST", {
    chapterId: "ch",
    sectionId: section,
    sourceRevision: revision,
    patch: { content },
    participantId: "spoof",
    approvedBy: "spoof",
  });
try {
  assert.equal((await req("guest", base + "/contributions")).status, 401);
  assert.equal((await req("stranger", base + "/proposals")).status, 403);
  check("гість і сторонній не читають журнал");
  assert.equal((await propose("reader")).status, 403);
  assert.equal((await propose("co", 1, "hidden")).status, 403);
  check("роль і читання не дають edit іншої сцени");
  assert.equal(
    (
      await req(
        "co",
        "/api/core/projects/book/source/chapters/ch/sections/s1",
        "PATCH",
        { expectedRevision: 1, patch: { content: "тиха заміна" } },
      )
    ).body.kind,
    "proposal_required",
  );
  check("співавтор не перезаписує текст без пропозиції");
  assert.equal(
    (
      await req("co", base + "/proposals", "POST", {
        chapterId: "ch",
        sectionId: "s1",
        sourceRevision: 1,
        patch: { id: "hidden" },
      })
    ).status,
    422,
  );
  check("пропозиція не змінює структуру");
  const proposed = await propose();
  assert.equal(proposed.status, 201);
  const p = proposed.body.proposal;
  assert.equal(p.userId, "co");
  assert.notEqual(p.participantId, "spoof");
  assert.deepEqual(p.roleIds, ["co_author"]);
  assert.equal((await store.getBook("book"))!.revision, 1);
  assert.equal(journal.contributions("book").length, 0);
  check("походження серверне; pending не змінює книгу й не створює внеску");
  assert.equal(
    (await req("co", base + `/proposals/${p.id}/merge`, "POST", {})).status,
    403,
  );
  check("автор не схвалює свою участь замість власника");
  const [m1, m2] = await Promise.all([
    req("owner", base + `/proposals/${p.id}/merge`, "POST", {}),
    req("owner", base + `/proposals/${p.id}/merge`, "POST", {}),
  ]);
  assert.deepEqual([m1.status, m2.status].sort(), [200, 409]);
  assert.equal(saved, 1);
  assert.equal((await store.getBook("book"))!.revision, 2);
  assert.equal(journal.contributions("book").length, 1);
  assert.equal(
    journal
      .contributionEvents("book")
      .filter((e) => e.type === "CONTRIBUTION_RECORDED").length,
    1,
  );
  check("одночасне злиття: одна ревізія, внесок і подія, один конфлікт");
  const c = journal.contributions("book")[0];
  assert.equal(c.sourceRevision, 1);
  assert.equal(c.resultRevision, 2);
  assert.equal(c.approvedBy, "owner");
  assert.equal(c.provenance.proposalId, p.id);
  check("внесок має проєкт, участь, ролі, ревізії, час і схвалення");
  const stale = (await propose("co", 2, "s1", "stale")).body.proposal;
  const direct = await req(
    "editor",
    "/api/core/projects/book/source/chapters/ch/sections/s1",
    "PATCH",
    { expectedRevision: 2, patch: { content: "Редакція" } },
  );
  assert.equal(direct.status, 200);
  assert.equal(
    (await req("owner", base + `/proposals/${stale.id}/merge`, "POST", {}))
      .status,
    409,
  );
  assert.equal(journal.changeProposal("book", stale.id)!.status, "pending");
  check("чужа нова ревізія зупиняє stale merge без втрати пропозиції");
  assert.equal(journal.contributions("book").length, 2);
  check("дозволена пряма редакторська правка теж записує внесок");
  const rejected = (await propose("co", 3)).body.proposal;
  await req("owner", base + `/proposals/${rejected.id}/reject`, "POST", {});
  assert.equal(journal.changeProposal("book", rejected.id)!.status, "rejected");
  assert.equal((await store.getBook("book"))!.revision, 3);
  check("відхилення не змінює книгу");
  const revoke = (await propose("co", 3)).body.proposal;
  revoked = true;
  assert.equal(
    (await req("owner", base + `/proposals/${revoke.id}/merge`, "POST", {}))
      .status,
    403,
  );
  revoked = false;
  check("відкликані edit-права перевіряються перед злиттям");
  // Inject a failure inside the same transaction: all book/proposal/journal writes roll back.
  const before = journal.contributions("book").length;
  await assert.rejects(() =>
    store.patchBookSection({
      bookId: "book",
      chapterId: "ch",
      sectionId: "s1",
      expectedRevision: 3,
      patch: { content: "rollback" },
      onSqlCommit: (s) => {
        journal.recordContribution(
          journal.newContribution({
            ...c,
            sourceRevision: 3,
            resultRevision: s.revision,
          }),
        );
        throw new Error("injected audit failure");
      },
    }),
  );
  assert.equal((await store.getBook("book"))!.revision, 3);
  assert.equal(journal.contributions("book").length, before);
  check("збій аудиту відкочує книгу й внесок атомарно");
  const hidden = (
    await req("owner", base + "/proposals", "POST", {
      chapterId: "ch",
      sectionId: "hidden",
      sourceRevision: 3,
      patch: { content: "SECRET PROPOSAL" },
    })
  ).body.proposal;
  const scoped = await req("co", base + "/proposals");
  assert.ok(!JSON.stringify(scoped.body).includes("SECRET PROPOSAL"));
  assert.equal((await req("co", base + "/graph")).status, 403);
  assert.equal((await req("owner", base + "/graph")).status, 200);
  check("scoped журнал не розкриває приховану сцену або повний граф");
  assert.equal(
    (
      await req(
        "owner",
        "/api/core/projects/other/collaboration/proposals/" +
          hidden.id +
          "/merge",
        "POST",
        {},
      )
    ).status,
    403,
  );
  check("id пропозиції не обходить область проєкту");
  const event = journal
    .contributionEvents("book")
    .find((e) => e.type === "CONTRIBUTION_RECORDED")!;
  const draft = (
    await lifecycle.createWorkflow(repo, {
      id: "collab_event",
      name: { uk: "Подія", en: "Event" },
      actor: "user:owner",
    })
  ).draft;
  const definition = {
    format: "fusion-workflow/1",
    id: "collab_event",
    name: { uk: "Подія", en: "Event" },
    nodes: [
      {
        id: "s",
        type: "START",
        params: { collaboration_events: ["CONTRIBUTION_RECORDED"] },
      },
      { id: "end", type: "END", params: {} },
    ],
    edges: [{ id: "e", from: "s", fromPort: "out", to: "end" }],
  };
  await lifecycle.saveDraft(repo, {
    workflowId: "collab_event",
    versionId: draft.id,
    definition: definition as any,
    actor: "user:owner",
  });
  assert.equal(
    (
      await lifecycle.validateVersion(
        repo,
        "collab_event",
        draft.id,
        "user:owner",
      )
    ).validation.ok,
    true,
  );
  await lifecycle.promoteToTest(repo, "collab_event", draft.id, "user:owner");
  await lifecycle.publishVersion(repo, "collab_event", draft.id, "user:owner");
  const run = await req("owner", "/api/core/workflow-runs", "POST", {
    workflowId: "collab_event",
    projectId: "book",
    input: { collaborationEventId: event.id, secret: "spoof" },
  });
  assert.equal(run.status, 202, JSON.stringify(run.body));
  await new Promise((r) => setTimeout(r, 100));
  const runs = await repo.listWorkflowRuns({ projectId: "book" });
  assert.equal(runs[0].trigger, "manual");
  assert.equal(runs[0].input.secret, undefined);
  assert.equal((runs[0].input.collaborationEvent as any).id, event.id);
  check(
    "дозволений published workflow отримує перевірену подію без клієнтського контексту",
  );
  assert.equal(
    (
      await req("owner", "/api/core/workflow-runs", "POST", {
        workflowId: "collab_event",
        projectId: "book",
        input: { collaborationEventId: "foreign" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await req("owner", "/api/core/workflow-runs", "POST", {
        workflowId: "collab_event",
        projectId: "book",
        input: {
          collaborationEventId: journal
            .contributionEvents("book")
            .find((e) => e.type === "CHANGE_PROPOSED")!.id,
        },
      })
    ).status,
    422,
  );
  check("чужа подія та непідписаний тип не запускають workflow");
  if (process.argv.includes("--browser")) {
    const { build } = await import("esbuild");
    const built = await build({
      stdin: {
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CollaborationChanges}from'./src/components/CollaborationChanges';import{CollaborationGraphPanel}from'./src/components/graphStudio/CollaborationGraphPanel';createRoot(document.getElementById('root')).render(location.pathname.includes('graph')?<CollaborationGraphPanel/>:<CollaborationChanges bookId="book"/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      loader: { ".css": "empty" },
    });
    const files = await fs.readdir(path.join(process.cwd(), "dist/assets"));
    const cssName = files.find((x) => /^index-.*\.css$/.test(x));
    assert.ok(cssName);
    const css = await fs.readFile(
      path.join(process.cwd(), "dist/assets", cssName),
      "utf8",
    );
    app.get("/probe.js", (_q, res) =>
      res
        .type("js")
        .send(
          built.outputFiles.find(
            (f) => f.path.endsWith(".js") || f.path === "<stdout>",
          )!.text,
        ),
    );
    app.get("/style.css", (_q, res) => res.type("css").send(css));
    app.get(["/probe", "/probe-graph"], (_q, res) =>
      res.send(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root" class="min-h-screen bg-slate-950 text-slate-100 p-4"></div><script src="/probe.js"></script>',
      ),
    );
    const { launch } = await import("puppeteer-core");
    const browser = await launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setExtraHTTPHeaders({ "x-user": "co" });
      await page.goto(root + "/probe");
      const click = async (label: string) => {
        await page.evaluate((label) => {
          const b = Array.from(document.querySelectorAll("button")).find(
            (b) => b.textContent === label,
          );
          if (!b) throw new Error(label);
          b.click();
        }, label);
      };
      await click("Завантажити зміни");
      await page.waitForSelector('select[aria-label="Сцена пропозиції"]');
      await page.select("select", JSON.stringify(["ch", "s1"]));
      await page.click("textarea");
      await page.keyboard.down("Control");
      await page.keyboard.press("A");
      await page.keyboard.up("Control");
      await page.type("textarea", "Браузерний внесок");
      await click("Надіслати пропозицію");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Пропозицію надіслано"),
      );
      assert.equal((await store.getBook("book"))!.revision, 3);
      assert.ok(!(await page.content()).includes("SECRET PROPOSAL"));
      check("БРАУЗЕР: співавтор надсилає scoped пропозицію без зміни джерела");
      await page.setExtraHTTPHeaders({ "x-user": "owner" });
      await click("Завантажити зміни");
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("article")).some(
          (a) =>
            a.textContent?.includes("Браузерний внесок") &&
            a.textContent.includes("Схвалити та злити"),
        ),
      );
      await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll("article")).find((a) =>
          a.textContent?.includes("Браузерний внесок"),
        );
        Array.from(a!.querySelectorAll("button"))
          .find((b) => b.textContent === "Схвалити та злити")!
          .click();
      });
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Злиття виконано, ревізія 4"),
      );
      assert.equal((await store.getBook("book"))!.revision, 4);
      check(
        "БРАУЗЕР: власник схвалює; нова ревізія й внесок видно в інтерфейсі",
      );
      await page.goto(root + "/probe-graph");
      await page.type('input[aria-label="Проєкт графа співпраці"]', "book");
      await click("Завантажити граф");
      await page.waitForSelector(".react-flow__node");
      for (const v of [
        "Participant",
        "Role",
        "Contribution",
        "Access",
        "Production",
      ]) {
        await click(v);
        await page.waitForSelector(".react-flow__node");
      }
      check("БРАУЗЕР: п’ять представлень реального Collaboration Graph");
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(dir, "collaboration-graph-mobile.png"),
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      );
      await page.goto(root + "/probe");
      await click("Завантажити зміни");
      await page.waitForSelector("article");
      await page.screenshot({
        path: path.join(dir, "collaboration-changes-mobile.png"),
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      );
      assert.deepEqual(errors, []);
      check("БРАУЗЕР: справжній CSS і 390px без переповнення та JS-помилок");
    } finally {
      await browser.close();
    }
  }
  const { resolveRealtimeAccess } = await import("../server/realtimeAuth");
  const rt = await resolveRealtimeAccess(
    { id: "co", role: "writer", isGuest: false } as any,
    "book",
    { ...access, requiresChangeProposal: async () => true },
  );
  assert.equal(rt?.canWrite, false);
  check("квиток realtime не дозволяє співавтору тихий запис");
  console.log(`Підсумок: ${count} пройшло. Артефакти: ${dir}`);
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.closeDb();
  await pgPool?.end();
}
