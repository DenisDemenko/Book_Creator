import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { reviewFixture } from "./lib/workflowHumanReviewFixture";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { PgCoreRepository } from "../server/core/pgRepository";
import type { CoreRepository } from "../server/core/types";
import { createCorePool } from "../server/core";
import {
  runMigrations,
  loadMigrations,
  resolveMigrationsDir,
} from "../server/core/migrate";
import {
  startRun,
  resumeRun,
  type EngineDeps,
} from "../server/core/workflows/engine/runner";
import {
  validateOnServer,
  createWorkflow,
  saveDraft,
  validateVersion,
  promoteToTest,
  publishVersion,
} from "../server/core/workflows/lifecycle";
import {
  workflowFeedback,
  workflowAnalytics,
  evaluateFeedback,
} from "../server/core/workflows/observability";
import { registerWorkflowRunRoutes } from "../server/core/workflows/runRoutes";
import {
  validateCostPolicy,
  type CostPolicy,
} from "../server/core/workflows/engine/costRouting";
import { JobFatalError } from "../server/core/jobs/queue";
import type { WorkflowDefinition } from "../src/utils/workflowGraph";
import type { AddressInfo } from "node:net";
let count = 0;
const check = (s: string) => {
  count++;
  console.log("✓ " + s);
};
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-observability-"));
async function suite(repo: CoreRepository) {
  const { deps, def } = await reviewFixture(repo, "entity", true);
  deps.services.canInspectWorkflowProject = async (a, p) =>
    a === "user:author" && p === "book";
  let generated = 0;
  deps.services.generate = async () => ({
    text: JSON.stringify({
      payload: {
        type: "character",
        name: `AI герой ${++generated}`,
        canonical: {},
      },
      evidence: ["evidence"],
      confidence: 0.9,
    }),
    modelId: "controlled-model",
    engine: "controlled",
    inputTokens: 12,
    outputTokens: 15,
    costUsd: 0.0001,
  });
  const versionRef = (await repo.listWorkflowVersions(def.id)).find(
    (v) => v.environment === "production",
  )!;
  const originalVersion = (await repo.getWorkflowVersion(versionRef.id))!;
  const bookBefore = await repo.getProject("book");
  const reviewRuns = [];
  for (const action of ["accept", "edit", "edit", "reject"] as const) {
    const started = await startRun(deps, {
      workflowId: def.id,
      projectId: "book",
      actor: "user:author",
      trigger: "manual",
      input: { user_prompt: "Контекст автора" },
    });
    assert.equal(started.run.status, "paused", started.run.error ?? "");
    const review = started.run.output!.review as any;
    const done = await resumeRun(deps, started.run.id, "user:author", {
      review: {
        action,
        expectedRevision: review.expectedRevision,
        ...(action === "edit"
          ? {
              payload: {
                type: "character",
                name: `Правка ${generated}`,
                canonical: {},
              },
            }
          : {}),
      },
    });
    assert.equal(done.run.status, "succeeded", done.run.error ?? "");
    reviewRuns.push(done.run);
  }
  const feedback = await workflowFeedback(repo, "book", def.id);
  assert.equal(feedback.length, 4);
  assert.equal(feedback.filter((f) => f.authorAction === "edit").length, 2);
  const edited = feedback.find((f) => f.authorAction === "edit")!;
  assert.match((edited.aiProposal as any).name, /AI герой/);
  assert.match((edited.finalCanon as any).payload.name, /Правка/);
  assert.equal(
    (edited.inputContext.prompt as any).system,
    "Створи пропозицію героя з evidence.",
  );
  assert.equal(
    (edited.inputContext.input as any).user_prompt,
    "Контекст автора",
  );
  assert.equal(edited.aiConfidence, 0.9);
  assert.ok(edited.jevDecisions.length);
  assert.ok(edited.complete);
  assert.equal(
    feedback.find((f) => f.authorAction === "reject")?.finalCanon,
    null,
  );
  check(
    "durable feedback: контекст, AI до правки, Jev, дія автора, правка й фінальний канон",
  );
  const immutable = JSON.stringify(feedback);
  const entity = await repo.getEntity(
    "book",
    (edited.finalCanon as any).recordId,
  );
  await repo.updateEntity(
    "book",
    entity!.id,
    { name: "Подальша незалежна редакція" },
    "user:author",
  );
  assert.equal(
    JSON.stringify(await workflowFeedback(repo, "book", def.id)),
    immutable,
  );
  check("фінальний приклад не переписується наступною редакцією канону");
  const analytics = await workflowAnalytics(repo, {
    projectId: "book",
    workflowId: def.id,
  });
  assert.equal(analytics.metrics.acceptanceRate, 0.75);
  assert.equal(analytics.metrics.rejectionRate, 0.25);
  assert.equal(analytics.metrics.correctionRate, 0.5);
  assert.equal(analytics.metrics.runs, 4);
  assert.equal(analytics.metrics.confidenceSamples > 0, true);
  assert.equal(
    analytics.suggestions[0]?.kind,
    "review_prompt_context_threshold",
  );
  assert.deepEqual(
    await repo.getWorkflowVersion(originalVersion.id),
    originalVersion,
  );
  check(
    "optimizer: реальні знаменники, докази й рекомендація без зміни production",
  );
  const evaluate = await evaluateFeedback(repo, "book", def.id, [
    {
      proposalId: edited.proposalId,
      payload: (edited.finalCanon as any).payload,
    },
    {
      proposalId: feedback.find((f) => f.authorAction === "reject")!.proposalId,
      payload: {},
    },
  ]);
  assert.equal(evaluate.evaluated, 1);
  assert.equal(evaluate.exactMatchRate, 1);
  assert.equal(evaluate.results[1].status, "not_applied");
  const wrong = await evaluateFeedback(repo, "book", def.id, [
    { proposalId: edited.proposalId, payload: edited.aiProposal },
  ]);
  assert.equal(wrong.exactMatchRate, 0);
  await assert.rejects(() =>
    evaluateFeedback(repo, "book", def.id, [
      { proposalId: "other-book", payload: {} },
    ]),
  );
  await assert.rejects(() =>
    evaluateFeedback(repo, "book", def.id, [
      { proposalId: edited.proposalId, payload: {} },
      { proposalId: edited.proposalId, payload: {} },
    ]),
  );
  check(
    "регресійне оцінювання: правильний/хибний результат, відмова без канону, чужі й дубльовані приклади",
  );
  const empty = await workflowAnalytics(repo, {
    projectId: "book",
    workflowId: "unknown",
  });
  assert.equal(empty.metrics.averageConfidence, null);
  assert.equal(empty.metrics.acceptanceRate, null);
  check("немає даних: null, без підроблених нульових часток");
  const steps = await repo.listWorkflowSteps(reviewRuns[0].id);
  assert.ok(
    steps.some(
      (s) =>
        s.nodeType === "LLM" &&
        s.model === "controlled-model" &&
        s.tokensIn === 12 &&
        s.tokensOut === 15 &&
        s.costUsd === 0.0001,
    ),
  );
  assert.ok(steps.some((s) => s.humanResult === "accept"));
  assert.ok(steps.every((s) => s.startedAt && s.endedAt && s.latencyMs >= 0));
  check(
    "trace зберігає час, модель, токени, вартість, рішення й результат людини",
  );
  const policy: CostPolicy = {
    version: "prices-test-1",
    budgetUsd: 0.01,
    latencyTargetMs: 1000,
    complexity: 0.1,
    risk: 0.1,
    candidates: [
      {
        modelId: "cheap-model",
        tier: "cheap",
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 1,
        latencyMs: 100,
      },
      {
        modelId: "standard-model",
        tier: "standard",
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 2,
        latencyMs: 200,
      },
      {
        modelId: "strong-model",
        tier: "strong",
        inputUsdPerMillion: 5,
        outputUsdPerMillion: 5,
        latencyMs: 300,
      },
    ],
  };
  let calls: string[] = [];
  let reportedCost = 0.00001,
    reportedModel: string | null = null;
  let provider: (model: string) => void = () => {};
  const costDeps: EngineDeps = {
    repo,
    services: {
      ...deps.services,
      sleep: async () => {},
      resolveModel: async () => "unrouted-default",
      generate: async (input) => {
        calls.push(input.modelId!);
        provider(input.modelId!);
        return {
          text: "{}",
          modelId: reportedModel ?? input.modelId!,
          engine: "controlled",
          inputTokens: 10,
          outputTokens: 10,
          costUsd: reportedCost,
        };
      },
    },
  };
  const publish = async (id: string, extra: Record<string, unknown> = {}) => {
    const d: WorkflowDefinition = {
      format: "fusion-workflow/1",
      id,
      name: { en: id, uk: id },
      description: "",
      nodes: [
        { id: "s", type: "START", params: {} },
        { id: "p", type: "PROMPT", params: { template: "Оціни." } },
        {
          id: "m",
          type: "LLM",
          params: {
            model_provider: "core_module",
            max_tokens: 100,
            retry_count: 0,
            cost_policy: policy,
            ...extra,
          },
        },
        { id: "e", type: "END", params: {} },
      ],
      edges: [
        { id: "a", from: "s", fromPort: "out", to: "p" },
        { id: "b", from: "p", fromPort: "out", to: "m" },
        { id: "c", from: "m", fromPort: "out", to: "e" },
      ],
    };
    const draft = (
      await createWorkflow(repo, { id, name: d.name, actor: "user:author" })
    ).draft;
    await saveDraft(repo, {
      workflowId: id,
      versionId: draft.id,
      definition: d,
      actor: "user:author",
    });
    const valid = await validateVersion(repo, id, draft.id, "user:author");
    assert.equal(valid.validation.ok, true, JSON.stringify(valid.validation));
    await promoteToTest(repo, id, draft.id, "user:author");
    await publishVersion(repo, id, draft.id, "user:author");
    return id;
  };
  const launch = (workflowId: string, input: Record<string, unknown> = {}) =>
    startRun(costDeps, {
      workflowId,
      projectId: "book",
      actor: "user:author",
      trigger: "manual",
      input,
    });
  const cheap = await launch(await publish("cost_cheap"));
  assert.equal(cheap.run.status, "succeeded", cheap.run.error ?? "");
  assert.equal(calls.at(-1), "cheap-model");
  const cheapStep = (await repo.listWorkflowSteps(cheap.run.id)).find(
    (s) => s.nodeType === "LLM",
  )!;
  assert.equal(
    (cheapStep.details.costRouting as any).policyVersion,
    policy.version,
  );
  assert.equal(
    (cheapStep.details.costRouting as any).actualModel,
    "cheap-model",
  );
  assert.equal((cheapStep.details.costRouting as any).actualUsd, 0.00001);
  check(
    "низький ризик: найдешевша придатна модель з версією тарифів і фактичною вартістю в аудиті",
  );
  const medium = await launch(
    await publish("cost_medium", {
      cost_policy: { ...policy, complexity: 0.5 },
    }),
  );
  assert.equal(medium.run.status, "succeeded");
  assert.equal(calls.at(-1), "standard-model");
  check("складніша задача не потрапляє до слабшого дешевого класу");
  const beforeHuman = calls.length;
  const human = await launch(
    await publish("cost_human", { cost_policy: { ...policy, risk: 0.9 } }),
    { costRouting: { risk: 0, budgetUsd: 100 } },
  );
  assert.equal(human.run.status, "paused");
  assert.equal(calls.length, beforeHuman);
  assert.equal(
    (human.run.output?.costRoutingApproval as any).selectedModel,
    "strong-model",
  );
  await assert.rejects(() => resumeRun(costDeps, human.run.id, "user:author"));
  await assert.rejects(() =>
    resumeRun(costDeps, human.run.id, "user:stranger", {
      review: { approve: true },
    }),
  );
  assert.equal((await repo.getWorkflowRun(human.run.id))?.status, "paused");
  const approved = await resumeRun(costDeps, human.run.id, "user:author", {
    review: { approve: true },
  });
  assert.equal(approved.run.status, "succeeded", approved.run.error ?? "");
  assert.equal(calls.length, beforeHuman + 1);
  assert.equal(calls.at(-1), "strong-model");
  check(
    "високий ризик: пауза без оплати, явне схвалення з правами; input не знижує ризик/збільшує бюджет",
  );
  const noMoney = await launch(
    await publish("cost_zero", { cost_policy: { ...policy, budgetUsd: 0 } }),
  );
  assert.equal(noMoney.run.status, "paused");
  assert.equal(
    (noMoney.run.output?.costRoutingApproval as any).selectedModel,
    null,
  );
  const countNoMoney = calls.length;
  await assert.rejects(() =>
    resumeRun(costDeps, noMoney.run.id, "user:author", {
      review: { approve: true },
    }),
  );
  assert.equal(calls.length, countNoMoney);
  check("нульовий бюджет: жодного запиту та немає обходу через resume");
  const latency = await launch(
    await publish("cost_latency", {
      cost_policy: { ...policy, latencyTargetMs: 50 },
    }),
  );
  assert.equal(latency.run.status, "paused");
  assert.ok(
    (latency.run.output?.costRoutingApproval as any).candidates.every(
      (c: any) => c.reasons.includes("latency"),
    ),
  );
  check("ціль затримки відсіює повільні моделі з причиною");
  provider = () => {
    throw new Error("controlled provider failure");
  };
  const retryBefore = calls.length;
  const limited = await launch(
    await publish("cost_retry", {
      retry_count: 3,
      backoff: "none",
      cost_policy: { ...policy, budgetUsd: 0.00012 },
    }),
  );
  assert.equal(limited.run.status, "failed");
  assert.equal(calls.length, retryBefore + 1);
  assert.ok(
    (await repo.listWorkflowSteps(limited.run.id)).some(
      (s) => s.status === "failed" && !!s.details.costRouting,
    ),
  );
  check(
    "резерв вартості невдалого запиту не дозволяє неоплачений бюджетом повтор",
  );
  const alternateBefore = calls.length;
  const alt = await launch(
    await publish("cost_alternate", {
      alternate_model: "outside-policy",
      on_provider_error: "alternate_model",
    }),
  );
  assert.equal(alt.run.status, "failed");
  assert.equal(calls.length, alternateBefore + 1);
  check("резервна модель поза політикою не обходить бюджет/якість");
  provider = () => {
    throw new JobFatalError("budget exhausted");
  };
  const fatalBefore = calls.length;
  const fatal = await launch(await publish("cost_fatal", { retry_count: 3 }));
  assert.equal(fatal.run.status, "failed");
  assert.equal(calls.length, fatalBefore + 1);
  provider = () => {};
  check("фатальний бюджет не повторюється");
  reportedCost = 0.02;
  const actualOverBudget = await launch("cost_cheap");
  assert.equal(actualOverBudget.run.status, "failed");
  assert.equal(actualOverBudget.run.costUsd, 0.02);
  reportedCost = 0.00001;
  reportedModel = "outside-policy";
  const mismatched = await launch("cost_cheap");
  reportedModel = null;
  assert.equal(mismatched.run.status, "failed");
  assert.equal(
    (await repo.listWorkflowSteps(mismatched.run.id)).find(
      (s) => s.nodeType === "LLM",
    )?.model,
    "outside-policy",
  );
  check(
    "відхилення фактичної моделі або вартості зупиняє граф і лишає витрати в аудиті",
  );
  assert.throws(() =>
    validateCostPolicy({
      ...policy,
      candidates: [{ ...policy.candidates[0], tier: "constructor" }],
    }),
  );
  assert.throws(() =>
    validateCostPolicy({
      ...policy,
      candidates: [policy.candidates[0], policy.candidates[0]],
    }),
  );
  const invalidDefinition = (await repo.getWorkflowVersion(
    (await repo.listWorkflowVersions("cost_cheap")).find(
      (v) => v.environment === "production",
    )!.id,
  ))!.definition as unknown as WorkflowDefinition;
  const invalidCostDef = structuredClone(invalidDefinition);
  invalidCostDef.nodes.find((n) => n.type === "LLM")!.params.cost_policy = {
    ...policy,
    budgetUsd: -1,
  };
  assert.equal((await validateOnServer(repo, invalidCostDef)).ok, false);
  check("некоректна/дубльована політика відхиляється");
  const feeDef = structuredClone(
    (await repo.getWorkflowVersion(
      (await repo.listWorkflowVersions("cost_cheap")).find(
        (v) => v.environment === "production",
      )!.id,
    ))!.definition,
  ) as unknown as WorkflowDefinition;
  feeDef.id = "cost_after_tool";
  feeDef.nodes.push({
    id: "fee",
    type: "TOOL",
    params: { tool: "known_model_cost" },
  });
  feeDef.edges.find((e) => e.from === "s")!.to = "fee";
  feeDef.edges.push({
    id: "fee-prompt",
    from: "fee",
    fromPort: "out",
    to: "p",
  });
  const feeDraft = (
    await createWorkflow(repo, {
      id: feeDef.id,
      name: feeDef.name,
      actor: "user:author",
    })
  ).draft;
  await saveDraft(repo, {
    workflowId: feeDef.id,
    versionId: feeDraft.id,
    definition: feeDef,
    actor: "user:author",
  });
  assert.equal(
    (await validateVersion(repo, feeDef.id, feeDraft.id, "user:author"))
      .validation.ok,
    true,
  );
  await promoteToTest(repo, feeDef.id, feeDraft.id, "user:author");
  await publishVersion(repo, feeDef.id, feeDraft.id, "user:author");
  const callsBeforeFee = calls.length;
  const feeRun = await startRun(
    {
      ...costDeps,
      bindings: {
        [feeDef.id]: {
          workflowId: feeDef.id,
          prepare: async () => ({
            executors: {
              TOOL: async () => ({
                trace: { model: "controlled-tool-model", costUsd: 0.00999 },
              }),
            },
          }),
        },
      },
    },
    {
      workflowId: feeDef.id,
      projectId: "book",
      actor: "user:author",
      trigger: "manual",
      input: {},
    },
  );
  assert.equal(feeRun.run.status, "paused");
  assert.equal(calls.length, callsBeforeFee);
  assert.equal(feeRun.run.costUsd, 0.00999);
  check(
    "вартість попереднього TOOL з trace враховується у залишку бюджету LLM",
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = {
      id: req.get("x-test-user") ?? "author",
      role: "admin",
      isGuest: false,
    } as any;
    next();
  });
  registerWorkflowRunRoutes(app, {
    repo: () => repo,
    engine: () => costDeps,
    requireStudio: (_r, _s, n) => n(),
    requireControl: (_r, _s, n) => n(),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const q = `projectId=book&workflowId=${def.id}`;
    assert.equal(
      (
        await fetch(`${origin}/api/core/workflow-runs/feedback?${q}`, {
          headers: { "x-test-user": "stranger" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(
          `${origin}/api/core/workflow-runs/feedback?projectId=another`,
          { headers: { "x-test-user": "author" } },
        )
      ).status,
      403,
    );
    assert.equal(
      (await fetch(`${origin}/api/core/workflow-runs/feedback`)).status,
      422,
    );
    const dataset = await fetch(
      `${origin}/api/core/workflow-runs/feedback?${q}`,
    );
    assert.equal(dataset.headers.get("cache-control"), "no-store");
    assert.equal(((await dataset.json()) as any).rows.length, 4);
    const details = (await (
      await fetch(`${origin}/api/core/workflow-runs/${reviewRuns[0].id}`)
    ).json()) as any;
    assert.equal(details.records.entities.length, 1);
    check(
      "HTTP: feedback лише своєї книги з повним доступом, no-store; сутності у run trace",
    );
    if (process.argv.includes("--browser")) {
      const browserHuman = await launch("cost_human");
      assert.equal(browserHuman.run.status, "paused");
      const { build } = await import("esbuild");
      const built = await build({
        stdin: {
          contents:
            "import React from'react';import{createRoot}from'react-dom/client';import{RunsPanel}from'./src/components/graphStudio/RunsPanel';createRoot(document.getElementById('root')).render(<RunsPanel abilities={{canPublish:true}}/>);",
          resolveDir: process.cwd(),
          loader: "tsx",
        },
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
      });
      const assetPath = path.join(process.cwd(), "dist/assets"),
        cssName = (await fs.readdir(assetPath)).find((f) =>
          /^index-.*\.css$/.test(f),
        );
      assert.ok(cssName, "npm run build перед live");
      const css = await fs.readFile(path.join(assetPath, cssName), "utf8");
      app.get("/probe.js", (_q, res) =>
        res.type("js").send(built.outputFiles[0].text),
      );
      app.get("/style.css", (_q, res) => res.type("css").send(css));
      app.get("/probe", (_q, res) =>
        res.send(
          '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/probe.js"></script>',
        ),
      );
      const { launch: launchBrowser } = await import("puppeteer-core");
      const browser = await launchBrowser({
        executablePath: "/usr/bin/chromium",
        headless: true,
        args: ["--no-sandbox"],
      });
      try {
        const page = await browser.newPage(),
          errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.setViewport({ width: 390, height: 844 });
        await page.goto(origin + "/probe");
        await page.waitForSelector(`[data-run-row="${reviewRuns[0].id}"]`);
        await page.click(`[data-run-row="${reviewRuns[0].id}"]`);
        await page.waitForSelector("[data-insights-load]");
        await page.click("[data-insights-load]");
        await page.waitForSelector("[data-insights-metrics]");
        assert.match(
          await page.$eval(
            "[data-insights-metrics]",
            (e) => e.textContent ?? "",
          ),
          /75.0%/,
        );
        check(
          "БРАУЗЕР: аналітика й рекомендація оптимізатора у справжньому RunsPanel",
        );
        await page.click("[data-feedback-load]");
        await page.waitForSelector("[data-feedback-dataset]");
        assert.match(
          await page.$eval(
            "[data-feedback-dataset]",
            (e) => e.textContent ?? "",
          ),
          /Набір: 4/,
        );
        await page.$eval(
          "[data-feedback-cases]",
          (e, text) => {
            const setter = Object.getOwnPropertyDescriptor(
              HTMLTextAreaElement.prototype,
              "value",
            )!.set!;
            setter.call(e, text);
            e.dispatchEvent(new Event("input", { bubbles: true }));
          },
          JSON.stringify([
            {
              proposalId: edited.proposalId,
              payload: (edited.finalCanon as any).payload,
            },
          ]),
        );
        await page.click("[data-feedback-evaluate]");
        await page.waitForSelector("[data-feedback-evaluation]");
        assert.match(
          await page.$eval(
            "[data-feedback-evaluation]",
            (e) => e.textContent ?? "",
          ),
          /100.0%/,
        );
        check(
          "БРАУЗЕР: feedback і регресійне порівняння без модельного запиту",
        );
        await page.click(`[data-run-row="${cheap.run.id}"]`);
        await page.waitForSelector("[data-run-cost-routing]");
        assert.match(
          await page.$eval(
            "[data-run-cost-routing]",
            (e) => e.textContent ?? "",
          ),
          /prices-test-1/,
        );
        check(
          "БРАУЗЕР: причина вибору, ціни, фактична модель і вартість в аудиті",
        );
        await page.click(`[data-run-row="${browserHuman.run.id}"]`);
        await page.waitForSelector("[data-cost-approve]");
        const callsBeforeApproval = calls.length;
        await page.click("[data-cost-approve]");
        await page.waitForFunction(
          (id) =>
            document
              .querySelector(`[data-run-detail="${id}"]`)
              ?.textContent?.includes("Succeeded (Успішно)"),
          {},
          browserHuman.run.id,
        );
        assert.equal(calls.length, callsBeforeApproval + 1);
        assert.equal(calls.at(-1), "strong-model");
        check(
          "БРАУЗЕР: явне схвалення дорогого високоризикового маршруту виконує рівно один запит",
        );
        const size = await page.evaluate(() => ({
          w: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert.ok(size.scroll <= size.w);
        assert.deepEqual(errors, []);
        await page.screenshot({
          path: path.join(dir, "insights-mobile.png"),
          fullPage: true,
        });
        check("БРАУЗЕР: справжній CSS, 390px, без переповнення та JS-помилок");
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  assert.ok((await repo.getProject("book"))!.revision >= bookBefore!.revision);
  console.log(repo.kind + " завершено");
}
try {
  await suite(new MemoryCoreRepository());
  if (process.env.CORE_TEST_DATABASE_URL) {
    const pool = createCorePool(process.env.CORE_TEST_DATABASE_URL);
    try {
      await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
      await suite(new PgCoreRepository(pool));
    } finally {
      await pool.end();
    }
  }
  console.log(`Підсумок: ${count} пройшло. Артефакти: ${dir}`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
