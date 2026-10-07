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
  scheduleSemanticChange,
  semanticChangeJobKind,
  SEMANTIC_CHANGE_KIND,
} from "../server/core/semanticChangeJob";
import { syncBookToCore } from "../server/core/sync";
import {
  startRun,
  replayRun,
  publishedVersion,
} from "../server/core/workflows/engine/runner";
import {
  causalCandidates,
  CAUSALITY_WORKFLOW,
} from "../server/core/causalityCandidates";
import {
  approveProposal,
  rejectProposal,
} from "../server/core/storyCore/proposals";
import { ensureSystemWorkflows } from "../server/core/workflows/seeds";
import {
  ensureDraft,
  saveDraft,
  validateVersion,
  promoteToTest,
  publishVersion,
} from "../server/core/workflows/lifecycle";
import { causalityWorkflowDefinition } from "../server/core/workflows/causalityEngine";
import { causalityFixture } from "./lib/causalityEngineFixture";
import { reconcileParagraphIds } from "../src/utils/paragraphIds";
let count = 0;
const check = (s: string) => {
  count++;
  console.log("✓ " + s);
};
async function suite(repo: CoreRepository, store: JobStore) {
  const { deps, stored, effect, cause, named, control, route } =
    await causalityFixture(repo);
  const input = { eventId: effect.id };
  const run = (extra: any = {}) =>
    startRun(deps, {
      workflowId: CAUSALITY_WORKFLOW,
      projectId: stored.id,
      input,
      actor: "user:author",
      trigger: "manual",
      ...extra,
    });
  const report = (r: any) => r.run.output.causalityEngine;
  const initial = await causalCandidates(repo, stored.id, input, 8);
  assert.deepEqual(
    new Set(initial.candidates.map((c) => c.type)),
    new Set(["event", "goal", "character-state", "decision"]),
  );
  assert.ok(
    !initial.candidates.some((c) => c.entityId === named("Знахідка").id),
  );
  check("кандидати: попередні події, рішення, цілі та стани, без майбутнього");
  const setTime = (subjectId: string, start: string) =>
    repo.upsertTimePoint({
      projectId: stored.id,
      subjectKind: "scene",
      subjectId,
      kind: "exact",
      start,
      end: null,
      sortKey: Number(start),
      endKey: null,
      label: "",
      createdBy: "user:author",
    });
  await setTime("effect", "2000");
  await setTime("future", "1990");
  assert.ok(
    (await causalCandidates(repo, stored.id, input, 8)).candidates.some(
      (c) => c.entityId === named("Знахідка").id,
    ),
  );
  await repo.deleteTimePoint(stored.id, "scene", "effect");
  await repo.deleteTimePoint(stored.id, "scene", "future");
  check(
    "флешбек використовує час світу: пізніша сцена може бути попередньою причиною",
  );
  const paragraphs = await repo.listAllParagraphs(stored.id),
    relations = await repo.listRelations(stored.id),
    entities = await repo.listEntities(stored.id);
  let tokens = 0;
  let r = await run({
    recordUsage: async (u: any) => {
      tokens += u.tokens;
    },
  });
  assert.equal(r.run.status, "succeeded");
  assert.equal(tokens, 20);
  const proposal = await repo.getStoryProposal(stored.id, report(r).proposalId);
  assert.equal(proposal!.state, "validated");
  assert.deepEqual(proposal!.payload, {
    type: "caused_by",
    fromId: effect.id,
    toId: cause.id,
    note: "CAUSES: кандидатна причина за Jev Choice/Noul; підтверджує автор.",
  });
  assert.equal(proposal!.evidence.length, 2);
  check(
    "Jev Choice → Noul → перевірена пропозиція caused_by, правильний напрям і два докази",
  );
  assert.deepEqual(await repo.listAllParagraphs(stored.id), paragraphs);
  assert.deepEqual(await repo.listRelations(stored.id), relations);
  assert.deepEqual(await repo.listEntities(stored.id), entities);
  check("пропозиція не змінює рукопис, сутності або канонічні зв’язки");
  const provenance = proposal!.provenance as any;
  assert.equal(provenance.workflowId, CAUSALITY_WORKFLOW);
  assert.equal(provenance.jevDecisions.length, 2);
  assert.ok(
    provenance.jevDecisions.every((d: any) => d.model === "controlled-jev"),
  );
  check("походження зберігає версію процесу та обидва рішення Jev");
  r = await run();
  assert.equal(report(r).reason, "already_proposed");
  assert.equal((await repo.listStoryProposals(stored.id)).length, 1);
  check("повтор не дублює відкриту пропозицію");
  control.selected = named("Схований лист").id;
  const parallel = await Promise.all([run(), run()]);
  assert.ok(parallel.every((r) => r.run.status === "succeeded"));
  assert.equal(
    (await repo.listStoryProposals(stored.id)).filter(
      (p) => (p.payload as any).toId === control.selected,
    ).length,
    1,
  );
  check("одночасні прогони створюють одну пропозицію без збою процесів");
  control.selected = "none";
  const calls = control.calls.length;
  r = await run();
  assert.equal(report(r).reason, "no_cause");
  assert.equal(control.calls.length - calls, 1);
  check("none не викликає Noul і не створює зв’язок");
  control.selected = named("Знайти лист").id;
  control.probability = 0.69;
  r = await run();
  assert.equal(report(r).reason, "insufficient_support");
  check("підтримка нижча за поріг — без пропозиції");
  control.probability = 0.7;
  r = await run();
  assert.ok(report(r).proposalId);
  check("порогове значення Noul включне");
  control.selected = named("Тривога").id;
  control.confidence = 0.1;
  r = await run();
  assert.equal(report(r).reason, "choice_review");
  check("низька впевненість вибору — на перевірку");
  control.confidence = 0.99;
  control.selected = "fabricated";
  r = await run();
  assert.equal(report(r).reason, "choice_review");
  check("недозволений вибір не підміняється автоматично першим кандидатом");
  control.selected = cause.id;
  control.fallback = true;
  r = await run();
  assert.equal(report(r).reason, "choice_review");
  check("резервний LLM без впевненості не створює причинну пропозицію");
  control.fallback = false;
  control.down = true;
  r = await run();
  assert.equal(report(r).reason, "choice_review");
  check("недоступні провайдери — видима причина, без канону");
  control.down = false;
  r = await run({
    recordUsage: async () => {
      throw new JobFatalError("budget");
    },
  });
  assert.equal(r.run.status, "failed");
  check("бюджетний збій зупиняє модельний процес");
  const unknown = await startRun(deps, {
    workflowId: CAUSALITY_WORKFLOW,
    projectId: stored.id,
    input: { eventId: "foreign" },
    actor: "user:author",
    trigger: "manual",
  });
  assert.equal(report(unknown).reason, "no_new_event");
  check("чужа чи невідома подія не читається");
  const noCandidates = await startRun(deps, {
    workflowId: CAUSALITY_WORKFLOW,
    projectId: stored.id,
    input: { eventId: named("Схований лист").id },
    actor: "user:author",
    trigger: "manual",
  });
  assert.equal(report(noCandidates).reason, "no_candidates");
  check("без попередніх причин немає запиту до AI");
  control.onAsk = async () => {
    control.onAsk = null;
    await repo.updateEntity(
      stored.id,
      cause.id,
      { name: "Змінене рішення" },
      "user:author",
    );
  };
  r = await run();
  assert.equal(report(r).reason, "stale");
  check("зміна кандидата під час Choice блокує Noul/пропозицію");
  const beforeReplay = (await repo.listStoryProposals(stored.id)).length;
  await replayRun(deps, r.run.id, "user:admin");
  assert.equal((await repo.listStoryProposals(stored.id)).length, beforeReplay);
  check("повтор зберігає контроль пропозицій");
  const section = (stored.book as any).chapters[0].sections.find(
    (s: any) => s.id === "effect",
  );
  const oldText = section.content;
  let called = 0;
  control.onAsk = async () => {
    called++;
    if (called === 2) {
      control.onAsk = null;
      await repo.updateEntity(
        stored.id,
        cause.id,
        { name: "Ще одне рішення" },
        "user:author",
      );
    }
  };
  r = await run();
  assert.equal(report(r).reason, "stale");
  check("зміна після Noul блокує збереження пропозиції");
  control.onAsk = null;
  const def = causalityWorkflowDefinition();
  def.nodes.find((n) => n.id === "support")!.params.threshold = 0.95;
  def.nodes.find((n) => n.id === "propose")!.params.max_candidates = 1;
  const draft = await ensureDraft(repo, CAUSALITY_WORKFLOW, "user:admin");
  await saveDraft(repo, {
    workflowId: CAUSALITY_WORKFLOW,
    versionId: draft.id,
    definition: def,
    actor: "user:admin",
  });
  assert.equal(
    (await validateVersion(repo, CAUSALITY_WORKFLOW, draft.id, "user:admin"))
      .validation.ok,
    true,
  );
  await promoteToTest(repo, CAUSALITY_WORKFLOW, draft.id, "user:admin");
  await publishVersion(repo, CAUSALITY_WORKFLOW, draft.id, "user:admin");
  control.probability = 0.9;
  r = await run();
  assert.equal(report(r).reason, "insufficient_support");
  assert.equal(report(r).candidateIds.length, 1);
  check("поріг і кількість кандидатів змінюються опублікованою конфігурацією");
  const v = await publishedVersion(repo, CAUSALITY_WORKFLOW);
  await ensureSystemWorkflows(repo);
  assert.equal((await publishedVersion(repo, CAUSALITY_WORKFLOW))!.id, v!.id);
  check("сід не переписує авторську конфігурацію");
  // Automatic path: new tagged Event after core_sync, not a supplied model ID.
  def.nodes.find((n) => n.id === "support")!.params.threshold = 0.7;
  const d2 = await ensureDraft(repo, CAUSALITY_WORKFLOW, "user:admin");
  await saveDraft(repo, {
    workflowId: CAUSALITY_WORKFLOW,
    versionId: d2.id,
    definition: def,
    actor: "user:admin",
  });
  await validateVersion(repo, CAUSALITY_WORKFLOW, d2.id, "user:admin");
  await promoteToTest(repo, CAUSALITY_WORKFLOW, d2.id, "user:admin");
  await publishVersion(repo, CAUSALITY_WORKFLOW, d2.id, "user:admin");
  section.content =
    oldText + " [/event:Результат пошуків] Герой відкрив схованку.";
  const p = reconcileParagraphIds({
    sectionId: section.id,
    content: section.content,
    prevIds: section.paragraphIds,
    prevHashes: section.paragraphHashes,
  });
  section.paragraphIds = p.ids;
  section.paragraphHashes = p.hashes;
  const sync = await syncBookToCore(repo, stored);
  await route("EVENT", CAUSALITY_WORKFLOW);
  // Classifier returns EVENT; causal choice returns a candidate.
  const adapter = await deps.services.jev!();
  const originalAsk = adapter!.askState!.bind(adapter);
  adapter!.askState = async (state, qs) =>
    qs[0].instructions.includes("Порівняй before/after")
      ? {
          model: "classifier",
          answers: { [qs[0].id]: { choice: "EVENT", confidence: 0.99 } },
          usage: { input_tokens: 5, output_tokens: 0 },
          latency_ms: 1,
        }
      : originalAsk(state, qs);
  const queue = new JobQueue(store, { log: () => {} });
  queue.register(
    SEMANTIC_CHANGE_KIND,
    semanticChangeJobKind(() => deps),
  );
  control.selected = effect.id;
  const queued = await scheduleSemanticChange(repo, queue, sync);
  assert.ok(queued.queued > 0);
  for (let i = 0; i < queued.queued; i++) await queue.runOnce();
  assert.ok(
    (await store.list(stored.id, { kind: SEMANTIC_CHANGE_KIND })).every(
      (j) => j.status === "succeeded",
    ),
  );
  assert.ok(
    (await repo.listStoryProposals(stored.id)).some(
      (p) => (p.payload as any).fromId !== effect.id,
    ),
  );
  check("нова подія core_sync → черга → детектор → причинна пропозиція");
  await assert.rejects(
    approveProposal(repo, stored.id, proposal!.id, { actor: "ai:workflow" }),
  );
  check("AI не схвалює власний причинний зв’язок");
  await rejectProposal(repo, stored.id, proposal!.id, {
    actor: "user:author",
    reason: "Автор відхилив",
  });
  assert.deepEqual(await repo.listRelations(stored.id), relations);
  check("відхилення автором залишає канон незмінним");
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
console.log(`${count} перевірок Causality Engine пройшло.`);
