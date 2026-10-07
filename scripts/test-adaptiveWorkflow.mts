import assert from "node:assert/strict";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { MemoryJobStore } from "../server/core/jobs/memoryJobStore";
import { PgCoreRepository } from "../server/core/pgRepository";
import { PgJobStore } from "../server/core/jobs/pgJobStore";
import { createCorePool } from "../server/core/index";
import {
  runMigrations,
  loadMigrations,
  resolveMigrationsDir,
} from "../server/core/migrate";
import type { CoreRepository } from "../server/core/types";
import type { JobStore } from "../server/core/jobs/types";
import { JobQueue, JobFatalError } from "../server/core/jobs/queue";
import {
  semanticChangeJobKind,
  scheduleSemanticChange,
  SEMANTIC_CHANGE_KIND,
} from "../server/core/semanticChangeJob";
import { ADAPTIVE_WORKFLOW } from "../src/utils/adaptiveWorkflow";
import { validateWorkflow } from "../src/utils/workflowGraph";
import {
  startRun,
  publishedVersion,
  replayRun,
} from "../server/core/workflows/engine/runner";
import {
  createWorkflow,
  saveDraft,
  validateVersion,
  promoteToTest,
  publishVersion,
} from "../server/core/workflows/lifecycle";
import { ensureSystemWorkflows } from "../server/core/workflows/seeds";
import { adaptiveFixture } from "./lib/adaptiveWorkflowFixture";
let count = 0;
const check = (s: string) => {
  count++;
  console.log("✓ " + s);
};
async function suite(repo: CoreRepository, store: JobStore) {
  const f = await adaptiveFixture(repo);
  const { deps, policy, def, publish, control, observed, stored, changeText } =
    f;
  let delta = (await changeText("[/character:Марко] змінює перебіг подій."))
    .semanticChanges.paragraphs[0];
  const run = (
    recordUsage?: (u: { tokens: number; requests: number }) => Promise<void>,
  ) =>
    startRun(deps, {
      workflowId: ADAPTIVE_WORKFLOW,
      projectId: stored.id,
      input: { change: delta },
      actor: "user:author",
      trigger: "manual",
      recordUsage,
    });
  const reportOf = (r: any) => r.run.output.adaptiveWorkflow;
  const before = JSON.stringify(stored.book);
  for (const [value, tier, depth, target] of [
    [2, "LOW", "skip", null],
    [3, "MEDIUM", "light", "location_analysis"],
    [5.9, "MEDIUM", "light", "location_analysis"],
    [6, "HIGH", "normal", "event_analysis"],
    [7.9, "HIGH", "normal", "event_analysis"],
    [8, "CRITICAL", "deep", "time_analysis"],
    [10, "CRITICAL", "deep", "time_analysis"],
  ] as const) {
    control.score = value / 2;
    observed.length = 0;
    const r = await run();
    assert.equal(r.run.status, "succeeded");
    const report = reportOf(r);
    assert.equal(report.tier, tier);
    assert.equal(report.depth, depth);
    assert.deepEqual(
      observed.map((x) => x.workflowId),
      target ? [target] : [],
    );
    if (target) {
      assert.deepEqual(observed[0].input.paragraphIds, [delta.paragraphId]);
      assert.equal(observed[0].input.analysisDepth, depth);
      assert.equal(observed[0].input.semanticAutomatic, true);
      assert.deepEqual(observed[0].input.sectionIds, ["scene"]);
    }
    assert.equal(JSON.stringify(stored.book), before);
    check(`важливість ${value}: ${tier} → ${depth}, лише обраний підграф`);
  }
  policy.low = "minimal";
  await publish();
  control.score = 0;
  observed.length = 0;
  let r = await run();
  assert.equal(reportOf(r).depth, "minimal");
  assert.deepEqual(
    observed.map((x) => x.workflowId),
    ["style_analysis"],
  );
  check("LOW можна змінити з пропуску на minimal через версію");
  const v = await publishedVersion(repo, ADAPTIVE_WORKFLOW);
  await ensureSystemWorkflows(repo);
  assert.equal((await publishedVersion(repo, ADAPTIVE_WORKFLOW))!.id, v!.id);
  check("повторний сід не змінює опубліковану політику");
  policy.medium = 1;
  policy.high = 4;
  policy.critical = 7;
  await publish();
  control.score = 1;
  r = await run();
  assert.equal(reportOf(r).tier, "MEDIUM");
  check("нові пороги змінюють маршрут без зміни коду");
  const score = def.nodes.find((n) => n.id === "importance")!;
  score.params.scale_min = 100;
  score.params.scale_max = 200;
  policy.medium = 120;
  policy.high = 150;
  policy.critical = 180;
  await publish();
  control.score = 4;
  r = await run();
  assert.equal(reportOf(r).value, 180);
  assert.equal(reportOf(r).tier, "CRITICAL");
  check("інша шкала 100…200 працює з власними порогами");
  const bad = structuredClone(def);
  (
    bad.nodes.find((n) => n.id === "dispatch")!.params.adaptive_policy as any
  ).high = 110;
  assert.equal(validateWorkflow(bad).ok, false);
  check("неупорядковані пороги блокують публікацію");
  const missing = structuredClone(def);
  delete (
    missing.nodes.find((n) => n.id === "dispatch")!.params
      .adaptive_policy as any
  ).targets.deep;
  assert.equal(validateWorkflow(missing).ok, false);
  check("неповна політика не проходить перевірку");
  const self = structuredClone(def);
  (
    self.nodes.find((n) => n.id === "dispatch")!.params.adaptive_policy as any
  ).targets.deep = ADAPTIVE_WORKFLOW;
  assert.equal(validateWorkflow(self).ok, false);
  check("самозапуск заборонений конфігурацією");
  policy.targets.deep = "";
  await publish();
  observed.length = 0;
  r = await run();
  assert.equal(reportOf(r).reason, "no_destination");
  assert.equal(observed.length, 0);
  check("без підграфа немає удаваного глибокого аналізу");
  policy.targets.deep = "time_analysis";
  await publish();
  control.scoreConfidence = 0.1;
  observed.length = 0;
  r = await run();
  assert.equal(reportOf(r).reason, "importance_review");
  assert.equal(observed.length, 0);
  check("низька впевненість не запускає підграф");
  control.scoreConfidence = 0.99;
  control.fallback = true;
  control.fallbackAnswer = true;
  let tokens = 0;
  r = await run(async (u) => {
    tokens += u.tokens;
  });
  assert.equal(reportOf(r).source, "llm_fallback");
  assert.equal(reportOf(r).reason, "importance_review");
  assert.equal(tokens, 20);
  check("запасний LLM без впевненості: витрати враховані, потрібна перевірка");
  control.fallbackAnswer = false;
  r = await run();
  assert.equal(reportOf(r).reason, "importance_review");
  check("обидва провайдери недоступні: без запуску аналізу");
  control.fallback = false;
  r = await run(async () => {
    throw new JobFatalError("budget exhausted");
  });
  assert.equal(r.run.status, "failed");
  check("вичерпаний бюджет не маскується запасним провайдером");
  await changeText("[/character:Марко] інший актуальний текст.");
  const calls = control.askCount;
  observed.length = 0;
  r = await run();
  assert.equal(reportOf(r).reason, "stale");
  assert.equal(control.askCount, calls);
  assert.equal(observed.length, 0);
  check("застаріле джерело не викликає модель");
  delta = (await changeText("[/character:Марко] нова важлива подія."))
    .semanticChanges.paragraphs[0];
  control.onAsk = async () => {
    await changeText("[/character:Марко] зміна під час оцінки.");
  };
  r = await run();
  assert.equal(reportOf(r).reason, "stale");
  control.onAsk = null;
  check("зміна під час оцінки скасовує маршрут");
  delta = (await changeText("[/character:Марко] фінальна подія."))
    .semanticChanges.paragraphs[0];
  const queue = new JobQueue(store, { log: () => {} });
  queue.register(
    SEMANTIC_CHANGE_KIND,
    semanticChangeJobKind(() => deps),
  );
  const sync = await changeText("[/character:Марко] фінальна подія для черги.");
  delta = sync.semanticChanges.paragraphs[0];
  assert.equal((await scheduleSemanticChange(repo, queue, sync)).queued, 1);
  observed.length = 0;
  await queue.runOnce();
  const jobs = await store.list(stored.id, { kind: SEMANTIC_CHANGE_KIND });
  assert.equal(jobs[0].status, "succeeded");
  assert.deepEqual(
    observed.map((x) => x.workflowId),
    ["time_analysis"],
  );
  const parents = await repo.listWorkflowRuns({
    workflowId: "semantic_change_detector",
    projectId: stored.id,
  });
  const adaptive = await repo.getWorkflowRun(
    String((parents[0].output as any).semanticChange.childRunId),
  );
  assert.equal((adaptive!.output as any).adaptiveWorkflow.depth, "deep");
  check("core_sync → SQL/Memory черга → детектор → Adaptive → deep");
  tokens = 0;
  r = await run(async (u) => {
    tokens += u.tokens;
  });
  assert.equal(tokens, 25);
  check("оцінка важливості враховується в бюджеті задачі");
  const steps = await repo.listWorkflowSteps(r.run.id);
  assert.ok(steps.some((s) => (s.details as any).adaptiveWorkflow?.childRunId));
  check("траса містить політику, оцінку та дочірній запуск");
  const unsafe = await createWorkflow(repo, {
    id: "unsafe_adaptive_target",
    name: { en: "Unsafe", uk: "Unsafe" },
    actor: "user:admin",
  });
  await saveDraft(repo, {
    workflowId: "unsafe_adaptive_target",
    versionId: unsafe.draft.id,
    actor: "user:admin",
    definition: {
      format: "fusion-workflow/1",
      id: "unsafe_adaptive_target",
      name: { en: "Unsafe", uk: "Unsafe" },
      description: "",
      nodes: [
        { id: "start", type: "START", params: {} },
        { id: "review", type: "HUMAN_REVIEW", params: { reviewer: "author" } },
        { id: "canon", type: "CANON_WRITE", params: { target: "entity" } },
        { id: "end", type: "END", params: {} },
      ],
      edges: [
        { id: "s-r", from: "start", fromPort: "out", to: "review" },
        { id: "r-c", from: "review", fromPort: "accept", to: "canon" },
        { id: "r-edit", from: "review", fromPort: "edit", to: "canon" },
        { id: "r-e", from: "review", fromPort: "reject", to: "end" },
        { id: "c-e", from: "canon", fromPort: "out", to: "end" },
      ],
    },
  });
  assert.equal(
    (
      await validateVersion(
        repo,
        "unsafe_adaptive_target",
        unsafe.draft.id,
        "user:admin",
      )
    ).validation.ok,
    true,
  );
  await promoteToTest(
    repo,
    "unsafe_adaptive_target",
    unsafe.draft.id,
    "user:admin",
  );
  await publishVersion(
    repo,
    "unsafe_adaptive_target",
    unsafe.draft.id,
    "user:admin",
  );
  policy.targets.deep = "unsafe_adaptive_target";
  await publish();
  const entitiesBefore = await repo.listEntities(stored.id);
  r = await run();
  assert.equal(r.run.status, "failed");
  assert.match(r.run.error!, /HUMAN_REVIEW|CANON_WRITE/);
  assert.deepEqual(await repo.listEntities(stored.id), entitiesBefore);
  check("небезпечний підграф відхилено до людського рішення або запису канону");
  policy.targets.deep = "time_analysis";
  await publish();
  control.fallback = true;
  control.fallbackAnswer = true;
  r = await run(async () => {
    throw new JobFatalError("fallback budget");
  });
  assert.equal(r.run.status, "failed");
  assert.match(r.run.error!, /fallback budget/);
  control.fallback = false;
  control.fallbackAnswer = false;
  check("бюджетний збій запасного LLM також зупиняє процес");
  const originalDelta = delta;
  delta = structuredClone(delta);
  delta.after!.text = "x".repeat(4001);
  const beforeLarge = control.askCount;
  r = await run();
  assert.equal(r.run.status, "failed");
  assert.equal(control.askCount, beforeLarge);
  delta = originalDelta;
  check("завеликий абзац відхилено до платного запиту");
  // Change the selected workflow to an archived target after configuration was published.
  await repo.updateWorkflow("time_analysis", { status: "archived" });
  r = await run();
  assert.equal(r.run.status, "failed");
  check("архівований підграф не запускається");
  const replay = await replayRun(deps, parents[0].id, "user:admin");
  assert.equal(replay.run.status, "failed");
  check("повтор автоматичного процесу зберігає захист підграфів");
}
await suite(new MemoryCoreRepository(), new MemoryJobStore());
if (process.env.CORE_TEST_DATABASE_URL) {
  const pool = createCorePool(process.env.CORE_TEST_DATABASE_URL);
  try {
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    await suite(new PgCoreRepository(pool), new PgJobStore(pool));
  } finally {
    await pool.end();
  }
}
console.log(`${count} перевірок Adaptive Workflow пройшло.`);
