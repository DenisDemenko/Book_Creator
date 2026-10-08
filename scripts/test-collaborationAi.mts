import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import type { AddressInfo } from "node:net";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { computeEffective } from "../server/core/collaboration/access";
import { bootstrapOntology } from "../server/core/ontology/lifecycle";
import { assignRole } from "../server/core/collaboration/participants";
import type { RealtimeAccessDeps } from "../server/realtimeAuth";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "collab-ai-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, "book.db");
const db = await import("../server/db");
await db.initDb();
assert.ok(db.isAvailable());
const store = await import("../server/bookStore");
const ai = await import("../server/core/collaboration/aiCollaboration");
const { registerCollaborationAiRoutes } =
  await import("../server/core/collaboration/aiCollaborationRoutes");
const ws = await import("../server/core/collaboration/workspaceStore");
const { startRun, resumeRun } =
  await import("../server/core/workflows/engine/runner");
const lifecycle = await import("../server/core/workflows/lifecycle");
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
await store.saveBook({
  ownerId: "owner",
  book: {
    id: "book",
    title: "Книга",
    notes: "PRIVATE NOTES",
    characters: [],
    chapters: [
      {
        id: "ch",
        sections: [
          { id: "allowed", content: "PUBLIC SCENE" },
          { id: "hidden", content: "SECRET SCENE" },
        ],
      },
    ],
  },
});
await assignRole(repo, {
  projectId: "book",
  userId: "designer",
  roleId: "designer",
  actor: "user:owner",
  source: "admin",
});
await assignRole(repo, {
  projectId: "book",
  userId: "writer",
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
    if (revoked || !["writer", "designer", "reader"].includes(userId))
      return null;
    const e = computeEffective(projectId, userId, [], { full: false });
    e.scenes.allowed = userId === "reader" ? "view" : "edit";
    e.restricted = true;
    e.canWriteAny = userId !== "reader";
    return e;
  },
};
const deps = {
  repo: () => repo,
  access,
  principal: async (id: string) =>
    ["owner", "writer", "designer", "reader"].includes(id)
      ? ({ id, role: "writer", isGuest: false } as any)
      : null,
};
let count = 0;
const check = (s: string) => {
  console.log("✓ " + s);
  count++;
};
const target = { kind: "scene" as const, chapterId: "ch", id: "allowed" };
const query = (user: string, op: string, args = {}) =>
  ai.queryCollaboration(deps, user, "book", op, args);
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.principal = {
    id: String(req.headers["x-user"] ?? "owner"),
    role: "writer",
    isGuest: false,
  } as any;
  next();
});
registerCollaborationAiRoutes(app, deps);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  await assert.rejects(() => query("outsider", "GET_AVAILABLE_CONTEXT"));
  check("сторонній і неактивний обліковий запис не читають контекст");
  const context = await query("writer", "GET_AVAILABLE_CONTEXT");
  assert.ok(JSON.stringify(context).includes("PUBLIC SCENE"));
  assert.ok(!JSON.stringify(context).includes("SECRET SCENE"));
  assert.ok(!JSON.stringify(context).includes("PRIVATE NOTES"));
  check("контекст обмежено дозволеною сценою, приватні book metadata відсутні");
  const specialists = await query("owner", "FIND_SPECIALIST", {
    roleId: "designer",
  });
  assert.equal((specialists as any).participants[0].userId, "designer");
  assert.equal(
    ((await query("writer", "FIND_SPECIALIST", { roleId: "designer" })) as any)
      .participants.length,
    0,
  );
  check("пошук фахівця не розкриває людей поза областю");
  for (const op of [
    "FIND_PARTICIPANT",
    "GET_PROJECT_ROLES",
    "GET_ACCESS_SCOPE",
    "GET_CONTRIBUTIONS",
    "GET_OPEN_TASKS",
    "GET_DELIVERABLES",
  ])
    assert.ok(await query("writer", op));
  check(
    "усі вісім query-операцій працюють; deliverables повертаються за доступом Workspace",
  );
  await assert.rejects(() => query("owner", "GRANT_ACCESS"));
  check("query не має операції видачі доступу");
  const beforeRoles = await repo.listParticipantRoles({ projectId: "book" }),
    beforeAccess = await repo.listAccessGrants({ projectId: "book" });
  const proposal = await ai.proposeCollaborationTask(deps, "owner", "book", {
    target,
    title: "Створити обкладинку",
    candidateId: "designer",
    reason: "Варіант ШІ",
  });
  assert.equal(ws.workItems("book").length, 0);
  assert.equal(proposal.status, "pending");
  assert.deepEqual(
    await repo.listParticipantRoles({ projectId: "book" }),
    beforeRoles,
  );
  assert.deepEqual(
    await repo.listAccessGrants({ projectId: "book" }),
    beforeAccess,
  );
  check("ШІ лише пропонує: завдання, ролі та доступ не змінюються");
  await assert.rejects(() =>
    ai.reviewCollaborationTask(
      deps,
      "designer",
      "book",
      proposal.id,
      "accept",
      "designer",
    ),
  );
  await assert.rejects(() =>
    ai.reviewCollaborationTask(deps, "owner", "book", proposal.id, "accept"),
  );
  check("кандидат не схвалює; людина має явно обрати виконавця");
  const done = await ai.reviewCollaborationTask(
    deps,
    "owner",
    "book",
    proposal.id,
    "accept",
    "designer",
  );
  assert.equal(done.status, "accepted");
  assert.equal(ws.workItems("book").length, 1);
  assert.equal(ws.workItems("book")[0].assigneeId, "designer");
  await assert.rejects(() =>
    ai.reviewCollaborationTask(
      deps,
      "owner",
      "book",
      proposal.id,
      "accept",
      "designer",
    ),
  );
  assert.equal(ws.workItems("book").length, 1);
  check("підтвердження створює одне завдання, повтор не дублює");
  const p2 = await ai.proposeCollaborationTask(deps, "owner", "book", {
    target,
    title: "Відхилити",
  });
  await ai.reviewCollaborationTask(deps, "owner", "book", p2.id, "reject");
  assert.equal(ws.workItems("book").length, 1);
  check("відхилення не створює завдання");
  await assert.rejects(() =>
    ai.proposeCollaborationTask(deps, "writer", "book", {
      target: { kind: "scene", chapterId: "ch", id: "hidden" },
      title: "Атака",
    }),
  );
  await assert.rejects(() =>
    ai.proposeCollaborationTask(deps, "reader", "book", {
      target,
      title: "Атака",
    }),
  );
  check("недоступна ціль і view без comment не дають пропозиції");
  const hidden = await ai.proposeCollaborationTask(deps, "owner", "book", {
    target: { kind: "scene", chapterId: "ch", id: "hidden" },
    title: "HIDDEN TASK",
  });
  const response = await fetch(
    root + "/api/core/projects/book/collaboration/ai/suggestions",
    { headers: { "x-user": "writer" } },
  );
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes("HIDDEN TASK"));
  await assert.rejects(() =>
    ai.reviewCollaborationTask(
      deps,
      "owner",
      "book",
      hidden.id,
      "accept",
      "designer",
    ),
  );
  check("API приховує чужі пропозиції; виконавцю не відкривають ресурс");
  const p3 = await ai.proposeCollaborationTask(deps, "writer", "book", {
    target,
    title: "Відкликаний автор",
  });
  revoked = true;
  await assert.rejects(() =>
    ai.reviewCollaborationTask(deps, "owner", "book", p3.id, "accept", "owner"),
  );
  revoked = false;
  check("права автора перечитуються перед підтвердженням");
  assert.ok(
    !JSON.stringify(await query("writer", "GET_OPEN_TASKS")).includes(
      "HIDDEN TASK",
    ),
  );
  check("контекст завдань фільтрується за ціллю");
  let modelCalls = 0,
    modelContext = "";
  const engine = {
    repo,
    services: {
      canInspectWorkflowProject: async (actor: string, project: string) =>
        actor === "user:owner" && project === "book",
      resolveModel: async () => undefined,
      generate: async ({ system }: any) => {
        modelContext = system;
        modelCalls++;
        return {
          text: "ok",
          modelId: "controlled",
          engine: "controlled",
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
        };
      },
      queryCollaboration: async ({ actor, projectId, operation, args }: any) =>
        ai.queryCollaboration(deps, actor.slice(5), projectId, operation, args),
      proposeCollaborationTask: async ({ actor, projectId, input }: any) =>
        ai.proposeCollaborationTask(deps, actor.slice(5), projectId, input),
    },
  };
  const { registerWorkflowRunRoutes } =
    await import("../server/core/workflows/runRoutes");
  registerWorkflowRunRoutes(app, {
    repo: () => repo,
    engine: () => engine,
    requireStudio: (_q, _r, next) => next(),
    requireControl: (_q, _r, next) => next(),
  });
  const publish = async (
    id: string,
    revoke = false,
    proposal = false,
    pause = false,
  ) => {
    const draft = (
      await lifecycle.createWorkflow(repo, {
        id,
        name: { uk: id, en: id },
        actor: "user:owner",
      })
    ).draft;
    const nodes: any[] = [
      { id: "s", type: "START", params: {} },
      {
        id: "q",
        type: "COLLAB_QUERY",
        params: { operation: "GET_AVAILABLE_CONTEXT" },
      },
    ];
    if (revoke)
      nodes.push({
        id: "revoke",
        type: "TOOL",
        params: { tool: "controlled_revoke" },
      });
    nodes.push(
      { id: "prompt", type: "PROMPT", params: { template: "{{query_q}}" } },
      {
        id: "llm",
        type: "LLM",
        params: {
          model_provider: "core_module",
          model: "controlled",
          retry_count: 0,
        },
      },
      { id: "e", type: "END", params: {} },
    );
    if (proposal)
      nodes.splice(nodes.length - 1, 0, {
        id: "suggest",
        type: "COLLAB_PROPOSAL",
        params: { title: "Workflow task", target },
      });
    if (pause)
      nodes.find((n) => n.type === "LLM")!.params.cost_policy = {
        version: "controlled",
        budgetUsd: 0.01,
        latencyTargetMs: 1000,
        complexity: 0.9,
        risk: 0.9,
        candidates: [
          {
            modelId: "controlled",
            tier: "strong",
            inputUsdPerMillion: 0,
            outputUsdPerMillion: 0,
            latencyMs: 10,
          },
        ],
      };
    const edges = nodes.slice(1).map((n, i) => ({
      id: "e" + i,
      from: nodes[i].id,
      fromPort: "out",
      to: n.id,
    }));
    const definition = {
      format: "fusion-workflow/1",
      id,
      name: { uk: id, en: id },
      description: "",
      nodes,
      edges,
    };
    await lifecycle.saveDraft(repo, {
      workflowId: id,
      versionId: draft.id,
      definition: definition as any,
      actor: "user:owner",
    });
    const validation = (
      await lifecycle.validateVersion(repo, id, draft.id, "user:owner")
    ).validation;
    assert.ok(validation.ok, JSON.stringify(validation));
    await lifecycle.promoteToTest(repo, id, draft.id, "user:owner");
    await lifecycle.publishVersion(repo, id, draft.id, "user:owner");
  };
  await publish("collab_context");
  const success = await startRun(engine, {
    workflowId: "collab_context",
    projectId: "book",
    actor: "user:writer",
    trigger: "manual",
    input: {},
  });
  assert.equal(success.run.status, "succeeded");
  assert.equal(modelCalls, 1);
  assert.ok(modelContext.includes("PUBLIC SCENE"));
  assert.ok(!modelContext.includes("SECRET SCENE"));
  check("реальний COLLAB_QUERY передає авторизований контекст через workflow");
  await publish("collab_revoke", true);
  const blocked = await startRun(
    {
      ...engine,
      bindings: {
        collab_revoke: {
          workflowId: "collab_revoke",
          prepare: async () => ({
            executors: {
              TOOL: async () => {
                revoked = true;
                return {};
              },
            },
          }),
        },
      },
    },
    {
      workflowId: "collab_revoke",
      projectId: "book",
      actor: "user:writer",
      trigger: "manual",
      input: {},
    },
  );
  assert.equal(blocked.run.status, "failed");
  assert.equal(modelCalls, 1);
  revoked = false;
  check("відкликання після QUERY зупиняє LLM до платного запиту");
  const noTask = ws.workItems("book").length;
  await publish("collab_suggest", false, true);
  const suggested = await startRun(engine, {
    workflowId: "collab_suggest",
    projectId: "book",
    actor: "user:writer",
    trigger: "manual",
    input: {},
  });
  assert.equal(suggested.run.status, "succeeded");
  assert.equal(ws.workItems("book").length, noTask);
  assert.ok(
    ai
      .taskSuggestions("book")
      .some((p) => p.title === "Workflow task" && p.status === "pending"),
  );
  check("COLLAB_PROPOSAL створює лише pending, не призначає завдання");
  const log = await fetch(root + "/api/core/workflow-runs/" + success.run.id, {
    headers: { "x-user": "writer" },
  });
  assert.equal(log.status, 403);
  const list = await fetch(root + "/api/core/workflow-runs", {
    headers: { "x-user": "writer" },
  });
  assert.equal((await list.json()).runs.length, 0);
  assert.equal(
    (
      await fetch(root + "/api/core/workflow-runs/" + success.run.id, {
        headers: { "x-user": "owner" },
      })
    ).status,
    200,
  );
  check("трасування й журнали співпраці не обходять права книги");
  await publish("collab_review", false, false, true);
  const review = await startRun(engine, {
    workflowId: "collab_review",
    projectId: "book",
    actor: "user:writer",
    trigger: "manual",
    input: {},
  });
  assert.equal(review.run.status, "paused");
  const beforeReview = modelCalls;
  const approved = await resumeRun(engine, review.run.id, "user:owner", {
    review: { approve: true },
  });
  assert.equal(approved.run.status, "succeeded");
  assert.equal(modelCalls, beforeReview + 1);
  check(
    "схвалювач не підміняє ініціатора контексту; дозволена пауза відновлюється",
  );
  const stop = await startRun(engine, {
    workflowId: "collab_review",
    projectId: "book",
    actor: "user:writer",
    trigger: "manual",
    input: {},
  });
  assert.equal(stop.run.status, "paused");
  revoked = true;
  const beforeStop = modelCalls;
  const stopped = await resumeRun(engine, stop.run.id, "user:owner", {
    review: { approve: true },
  });
  assert.equal(stopped.run.status, "failed");
  assert.equal(modelCalls, beforeStop);
  revoked = false;
  check("схвалення власником не обходить відкликані права ініціатора");
  if (process.argv.includes("--browser")) {
    const { build } = await import("esbuild");
    const built = await build({
      stdin: {
        contents: `import React from'react';import{createRoot}from'react-dom/client';import{CollaborationTaskSuggestions}from'./src/components/CollaborationTaskSuggestions';createRoot(document.getElementById('root')).render(<CollaborationTaskSuggestions bookId="book"/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
    });
    const cssFile = (await fs.readdir("dist/assets")).find((f) =>
      /^index-.*\.css$/.test(f),
    );
    assert.ok(cssFile);
    const css = await fs.readFile(path.join("dist/assets", cssFile), "utf8");
    app.get("/probe.js", (_q, res) =>
      res.type("js").send(built.outputFiles[0].text),
    );
    app.get("/style.css", (_q, res) => res.type("css").send(css));
    app.get("/probe", (_q, res) =>
      res.send(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root" class="bg-slate-950 text-slate-100 p-4"></div><script src="/probe.js"></script>',
      ),
    );
    const pending = await ai.proposeCollaborationTask(deps, "owner", "book", {
      target,
      title: "Browser task",
      candidateId: "designer",
    });
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
      await page.goto(root + "/probe");
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
          .find((b) => b.textContent === "Завантажити пропозиції ШІ")!
          .click(),
      );
      await page.waitForSelector(
        `input[aria-label="Виконавець ${pending.id}"]`,
      );
      const n = ws.workItems("book").length;
      await page.type(
        `input[aria-label="Виконавець ${pending.id}"]`,
        "designer",
      );
      await page.evaluate(() => {
        const row = Array.from(document.querySelectorAll("article")).find((a) =>
          a.textContent?.includes("Browser task"),
        );
        Array.from(row!.querySelectorAll("button"))
          .find((b) => b.textContent === "Підтвердити завдання")!
          .click();
      });
      await page.waitForFunction(() =>
        document.body.textContent?.includes(
          "Завдання створено після вашого підтвердження",
        ),
      );
      assert.equal(ws.workItems("book").length, n + 1);
      check("БРАУЗЕР: явний вибір виконавця та людське підтвердження");
      await page.setViewport({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(dir, "task-suggestions-mobile.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      check("БРАУЗЕР: 390px, CSS, без JS-помилок");
    } finally {
      await browser.close();
    }
  }
  console.log(`Підсумок: ${count} пройшло. Артефакти: ${dir}`);
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.closeDb();
  await pool?.end();
}
