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
import { syncBookToCore, coreSyncJobKind } from "../server/core/sync";
import {
  scheduleSemanticChange,
  semanticChangeJobKind,
  SEMANTIC_CHANGE_KIND,
} from "../server/core/semanticChangeJob";
import {
  SEMANTIC_WORKFLOW,
  SEMANTIC_CATEGORIES,
  assertAnalysisWorkflow,
} from "../server/core/workflows/semanticChange";
import { sourceIsCurrent } from "../server/core/semanticChanges";
import { startRun } from "../server/core/workflows/engine/runner";
import {
  createWorkflow,
  saveDraft,
  validateVersion,
  promoteToTest,
  publishVersion,
} from "../server/core/workflows/lifecycle";
import { blockHash } from "../src/utils/paragraphIds";
import { semanticFixture } from "./lib/semanticChangeFixture";
let count = 0;
const check = (s: string) => {
  count++;
  console.log("✓ " + s);
};
async function suite(repo: CoreRepository, store: JobStore) {
  const { stored, baseline, route, control, observed, deps, changeText } =
    await semanticFixture(repo);
  const queue = new JobQueue(store, { log: () => {} });
  queue.register(
    SEMANTIC_CHANGE_KIND,
    semanticChangeJobKind(() => deps),
  );
  assert.equal(baseline.semanticChanges.baseline, true);
  assert.equal((await scheduleSemanticChange(repo, queue, baseline)).queued, 0);
  check("перша індексація — базовий знімок без AI");
  const same = await syncBookToCore(repo, stored);
  assert.equal(same.wroteAnything, false);
  assert.deepEqual(same.semanticChanges.paragraphs, []);
  check("незмінне збереження не створює дельт і записів");
  let result = await changeText("[/character:Марко] відчиняє двері.");
  assert.equal(result.semanticChanges.paragraphs.length, 1);
  const change = result.semanticChanges.paragraphs[0];
  assert.equal(change.paragraphId, "p-one");
  assert.match(change.before!.text, /входить/);
  assert.match(change.after!.text, /відчиняє/);
  assert.ok(change.after!.entityIds.length);
  check("дельта містить старий/новий текст і сутності лише зміненого абзацу");
  const reordered = structuredClone(change);
  reordered.after = Object.fromEntries(
    Object.entries(reordered.after!).reverse(),
  ) as typeof reordered.after;
  assert.equal(await sourceIsCurrent(repo, stored.id, reordered), true);
  check("порядок JSON-полів не робить актуальне джерело застарілим");
  assert.equal(
    (await scheduleSemanticChange(repo, queue, result)).reason,
    "no_destinations",
  );
  assert.equal(control.askCount, 0);
  check("без напрямків немає платних запитів");
  await route("EVENT", "event_analysis");
  await route("LOCATION", "location_analysis");
  await route("STYLE_ONLY", "style_analysis");
  await route("TIMELINE", "time_analysis");
  await assert.rejects(route("NO_SEMANTIC_CHANGE", "event_analysis"));
  check("NO_SEMANTIC_CHANGE не може запускати аналіз через реєстр");
  assert.equal((await scheduleSemanticChange(repo, queue, result)).queued, 1);
  assert.equal((await scheduleSemanticChange(repo, queue, result)).queued, 0);
  check("повторне планування тієї самої дельти ідемпотентне");
  await queue.runOnce();
  const firstJob = (
    await store.list(stored.id, { kind: SEMANTIC_CHANGE_KIND })
  )[0];
  assert.equal(
    firstJob.status,
    "succeeded",
    firstJob.error ?? JSON.stringify(firstJob.result),
  );
  assert.equal(observed.length, 1, JSON.stringify(firstJob.result));
  assert.equal(observed[0].workflowId, "event_analysis");
  assert.deepEqual(observed[0].input.paragraphIds, ["p-one"]);
  assert.deepEqual(observed[0].input.sectionIds, ["scene"]);
  assert.ok(!JSON.stringify(control.states).includes("Незалежна сцена"));
  check("Jev EVENT запускає тільки відповідний підграф, без незалежної сцени");
  const jobs = await store.list(stored.id, { kind: SEMANTIC_CHANGE_KIND });
  assert.equal(jobs[0].status, "succeeded");
  assert.equal(jobs[0].usedTokens, 25);
  assert.equal(jobs[0].usedRequests, 1);
  check("Jev врахований у бюджеті черги");
  const parent = (
    await repo.listWorkflowRuns({
      workflowId: SEMANTIC_WORKFLOW,
      projectId: stored.id,
    })
  )[0];
  const children = await repo.listWorkflowRuns({ parentRunId: parent.id });
  assert.equal(children.length, 1);
  assert.equal(children[0].mode, "subgraph");
  const steps = await repo.listWorkflowSteps(parent.id);
  assert.ok(steps.find((s) => s.nodeId === "dispatch")?.details.semanticChange);
  check("батьківський запуск, дочірній підграф і рішення збережені в трасі");
  for (const category of SEMANTIC_CATEGORIES) {
    control.category = category;
    const r = await changeText("[/character:Марко] зміна " + category + ".");
    const before = observed.length;
    const out = await startRun(deps, {
      workflowId: SEMANTIC_WORKFLOW,
      projectId: stored.id,
      input: { change: r.semanticChanges.paragraphs[0] },
      trigger: "manual",
      actor: "system:semantic_change",
    });
    assert.equal(out.run.status, "succeeded");
    const report = (out.run.output as any).semanticChange;
    assert.equal(report.category, category);
    assert.equal(
      observed.length - before,
      ["EVENT", "LOCATION", "STYLE_ONLY", "TIMELINE"].includes(category)
        ? 1
        : 0,
    );
  }
  check(
    "усі вісім категорій: тільки зареєстровані напрямки, no-change без аналізу",
  );
  const old = await changeText("[/character:Марко] старий варіант.");
  const fresh = await changeText("[/character:Марко] новий варіант.");
  assert.equal(
    await sourceIsCurrent(repo, stored.id, old.semanticChanges.paragraphs[0]),
    false,
  );
  let calls = control.askCount;
  let out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: old.semanticChanges.paragraphs[0] },
    trigger: "manual",
    actor: "system:semantic_change",
  });
  assert.equal((out.run.output as any).semanticChange.reason, "stale");
  assert.equal(control.askCount, calls);
  check("застаріла задача не викликає Jev і підграф");
  const whitespace = await changeText("[/character:Марко]  новий   варіант.");
  calls = control.askCount;
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: whitespace.semanticChanges.paragraphs[0] },
    trigger: "manual",
    actor: "system:semantic_change",
  });
  assert.equal(
    (out.run.output as any).semanticChange.reason,
    "no_semantic_change",
  );
  assert.equal(control.askCount, calls);
  check("лише пробіли — без семантичної зміни й без AI");
  control.category = "EVENT";
  control.confidence = 0.2;
  result = await changeText("[/character:Марко] невпевнена класифікація.");
  const n = observed.length;
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: result.semanticChanges.paragraphs[0] },
    trigger: "manual",
    actor: "system:semantic_change",
  });
  assert.equal(
    (out.run.output as any).semanticChange.reason,
    "classification_review",
  );
  assert.equal(observed.length, n);
  check("низька впевненість не запускає повний чи запасний аналіз книги");
  control.confidence = 0.99;
  await route("EVENT", "event_analysis", false);
  result = await changeText("[/character:Марко] вимкнений напрямок.");
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: result.semanticChanges.paragraphs[0] },
    trigger: "manual",
    actor: "system:semantic_change",
  });
  assert.equal((out.run.output as any).semanticChange.reason, "no_destination");
  assert.equal(observed.length, n);
  check("вимкнений напрямок не виконується");
  await route("EVENT", "event_analysis");
  control.onAsk = async () => {
    await changeText("[/character:Марко] правка під час класифікації.");
  };
  result = await changeText("[/character:Марко] до одночасної правки.");
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: result.semanticChanges.paragraphs[0] },
    trigger: "manual",
    actor: "system:semantic_change",
  });
  assert.equal((out.run.output as any).semanticChange.reason, "stale");
  assert.equal(observed.length, n);
  control.onAsk = null;
  check("повторна перевірка джерела після Jev захищає від одночасної правки");
  result = await changeText("[/character:Марко] перед видаленням.");
  const removedScene = (stored.book as any).chapters[0].sections.shift();
  result = await syncBookToCore(repo, stored);
  const deleted = result.semanticChanges.paragraphs.find(
    (c) => c.paragraphId === "p-one",
  )!;
  assert.equal(deleted.after, null);
  assert.ok(deleted.before!.entityIds.length);
  assert.equal(await sourceIsCurrent(repo, stored.id, deleted), true);
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: deleted },
    trigger: "manual",
    actor: "system:semantic_change",
  });
  assert.equal(out.run.status, "succeeded");
  assert.deepEqual((out.run.output as any).semanticChange.paragraphIds, [
    "p-one",
  ]);
  check("видалення зберігає старі докази й сутності для обмеженого аналізу");
  (stored.book as any).chapters[0].sections.unshift(removedScene);
  await changeText("[/character:Марко] поновлений абзац.");
  const chapter = (stored.book as any).chapters[0];
  chapter.sections[0].order = 5;
  result = await syncBookToCore(repo, stored);
  const move = result.semanticChanges.paragraphs.find(
    (c) => c.paragraphId === "p-one",
  )!;
  assert.equal(move.before!.text, move.after!.text);
  assert.notEqual(move.before!.position, move.after!.position);
  check("переміщення сцени виявляється навіть без зміни тексту");
  control.down = true;
  result = await changeText("[/character:Марко] провайдер недоступний.");
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: result.semanticChanges.paragraphs[0] },
    trigger: "manual",
    actor: "system:semantic_change",
  });
  assert.equal(
    (out.run.output as any).semanticChange.reason,
    "classification_review",
  );
  control.down = false;
  check(
    "збій Jev та LLM залишає видиму потребу перевірки без широкого аналізу",
  );
  result = await changeText("[/character:Марко] бюджет перевищено.");
  calls = control.fallbackCount;
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: result.semanticChanges.paragraphs[0] },
    trigger: "manual",
    actor: "system:semantic_change",
    recordUsage: async () => {
      throw new JobFatalError("budget");
    },
  });
  assert.equal(out.run.status, "failed");
  assert.match(out.run.error!, /budget/);
  assert.equal(control.fallbackCount, calls);
  check("бюджетний збій не викликає запасну платну модель");
  await repo.updateWorkflow("event_analysis", { status: "archived" });
  await assert.rejects(assertAnalysisWorkflow(repo, "event_analysis"));
  await repo.updateWorkflow("event_analysis", { status: "active" });
  await assert.rejects(assertAnalysisWorkflow(repo, SEMANTIC_WORKFLOW));
  check("архівний процес і самовиклик детектора заборонені");
  control.fallback = true;
  control.fallbackAnswer = true;
  result = await changeText(
    "[/character:Марко] успішний запасний класифікатор.",
  );
  let usage = 0;
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: result.semanticChanges.paragraphs[0] },
    trigger: "manual",
    actor: "system:semantic_change",
    recordUsage: async (u) => {
      usage += u.tokens;
    },
  });
  assert.equal(out.run.status, "succeeded");
  assert.equal(usage, 20);
  assert.equal((out.run.output as any).semanticChange.source, "llm_fallback");
  assert.equal(
    (out.run.output as any).semanticChange.reason,
    "classification_review",
  );
  check(
    "успішний LLM fallback врахований; невідома впевненість лишається на перевірку",
  );
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: result.semanticChanges.paragraphs[0] },
    trigger: "manual",
    actor: "system:semantic_change",
    recordUsage: async () => {
      throw new JobFatalError("fallback budget");
    },
  });
  assert.equal(out.run.status, "failed");
  assert.match(out.run.error!, /fallback budget/);
  control.fallback = false;
  control.fallbackAnswer = false;
  check(
    "бюджетний збій LLM fallback зупиняє задачу, не маскується як невпевненість",
  );
  const { draft: unsafe } = await createWorkflow(repo, {
    id: "unsafe_analysis",
    name: { en: "Unsafe", uk: "Unsafe" },
    actor: "user:admin",
  });
  await saveDraft(repo, {
    workflowId: "unsafe_analysis",
    versionId: unsafe.id,
    actor: "user:admin",
    definition: {
      format: "fusion-workflow/1",
      id: "unsafe_analysis",
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
    (await validateVersion(repo, "unsafe_analysis", unsafe.id, "user:admin"))
      .validation.ok,
    true,
  );
  await promoteToTest(repo, "unsafe_analysis", unsafe.id, "user:admin");
  await publishVersion(repo, "unsafe_analysis", unsafe.id, "user:admin");
  await assert.rejects(assertAnalysisWorkflow(repo, "unsafe_analysis"));
  check("автоматичний підграф не може записати канон");
  await route("EVENT", "unsafe_analysis");
  result = await changeText("[/character:Марко] спроба канонічного запису.");
  const priorEntities = await repo.listEntities(stored.id);
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: result.semanticChanges.paragraphs[0] },
    trigger: "manual",
    actor: "system:semantic_change",
  });
  assert.equal(out.run.status, "failed");
  assert.match(out.run.error!, /HUMAN_REVIEW|CANON_WRITE/);
  assert.deepEqual(await repo.listEntities(stored.id), priorEntities);
  await route("EVENT", "event_analysis");
  check(
    "небезпечний напрямок блокується під час справжнього запуску, канон незмінний",
  );
  out = await startRun(deps, {
    workflowId: "unsafe_analysis",
    projectId: stored.id,
    input: { semanticAutomatic: true },
    trigger: "manual",
    actor: "user:author",
  });
  assert.equal(out.run.status, "failed");
  assert.match(out.run.error!, /Автоматичний аналіз не виконує HUMAN_REVIEW/);
  check(
    "обмеження автоматичного аналізу діє у виконавці навіть при повторі людиною",
  );

  const big = structuredClone(result.semanticChanges.paragraphs[0]);
  big.after!.text = "x".repeat(4001);
  out = await startRun(deps, {
    workflowId: SEMANTIC_WORKFLOW,
    projectId: stored.id,
    input: { change: big },
    trigger: "manual",
    actor: "system:semantic_change",
  });
  assert.equal(out.run.status, "failed");
  assert.match(out.run.error!, /4000/);
  check("завеликий абзац не класифікується після мовчазного обрізання");
  result = await changeText("[/character:Марко] hook після sync.");
  const hook = coreSyncJobKind({
    repo: () => repo,
    loadBook: async () => stored,
    afterSynchronized: async (r) => scheduleSemanticChange(repo, queue, r),
  });
  const core = await hook.handler({
    job: { projectId: stored.id },
    checkpoint: async () => {},
    setProgress: async () => {},
  });
  assert.equal((core as any).semanticDispatch.reason, "no_changes");
  check("реальний core_sync hook викликає планувальник після синхронізації");

  (stored.book as any).chapters[0].sections[0].content =
    "[/character:Марко] ще одна зміна для hook.";
  (stored.book as any).chapters[0].sections[0].paragraphHashes = [
    blockHash("[/character:Марко] ще одна зміна для hook."),
  ];
  const hooked = await hook.handler({
    job: { projectId: stored.id },
    checkpoint: async () => {},
    setProgress: async () => {},
  });
  assert.equal((hooked as any).semanticDispatch.queued, 1);
  check("core_sync справді ставить нову дельту в чергу");
  await repo.updateWorkflow(SEMANTIC_WORKFLOW, { status: "archived" });
  assert.equal(
    (await scheduleSemanticChange(repo, queue, hooked as any)).reason,
    "detector_unpublished",
  );
  const priorCalls = control.askCount;
  await queue.runOnce();
  assert.equal(control.askCount, priorCalls);
  await repo.updateWorkflow(SEMANTIC_WORKFLOW, { status: "active" });
  check(
    "архівування детектора вимикає нові й уже заплановані автоматичні запуски",
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    semanticChangeJobKind(() => deps).handler({
      job: {
        projectId: stored.id,
        payload: { change: result.semanticChanges.paragraphs[0] },
      } as any,
      signal: aborted.signal,
      checkpoint: async () => {
        throw new Error("cancelled");
      },
      setProgress: async () => {},
      recordUsage: async () => {},
    }),
  );
  assert.equal(control.askCount, priorCalls);
  check("скасована задача не викликає модель");
  const beforeBook = JSON.stringify(stored.book);
  const failedHook = coreSyncJobKind({
    repo: () => repo,
    loadBook: async () => stored,
    afterSynchronized: async () => {
      throw new Error("schedule offline");
    },
  });
  const done = await failedHook.handler({
    job: { projectId: stored.id },
    checkpoint: async () => {},
    setProgress: async () => {},
  });
  assert.match((done as any).semanticDispatch.reason, /schedule_failed/);
  assert.equal(JSON.stringify(stored.book), beforeBook);
  check("збій планування не ламає збереження й не переписує рукопис");
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
console.log(count + " перевірок Semantic Change Detector пройшло.");
