/** T5.7 В1: hypothetical world, explicit gate and fresh pre-canon check. */
import assert from "node:assert/strict";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { PgCoreRepository } from "../server/core/pgRepository";
import { createCorePool } from "../server/core/index";
import {
  runMigrations,
  loadMigrations,
  resolveMigrationsDir,
} from "../server/core/migrate";
import type {
  CoreRepository,
  EntityProposalPayload,
} from "../server/core/types";
import {
  createProposal,
  rejectProposal,
} from "../server/core/storyCore/proposals";
import {
  evaluateContinuityGate,
  continuityChecks,
} from "../server/core/workflows/engine/continuityGate";
import { startRun, resumeRun } from "../server/core/workflows/engine/runner";
import { validateWorkflow, isExecutableNode } from "../src/utils/workflowGraph";
import { continuityFixture } from "./lib/continuityGateFixture";
let count = 0;
const check = (s: string) => {
  count++;
  console.log("✓ " + s);
};
async function suite(repo: CoreRepository) {
  const { deps, def, hero, trait, input } = await continuityFixture(repo);
  const rejectOpen = async () => {
    for (const row of await repo.listStoryProposals("book", {
      states: ["detected", "proposed", "validated", "approved"],
    }))
      await rejectProposal(repo, "book", row.id, {
        actor: "user:author",
        expectedRevision: row.revision,
      });
  };
  assert.equal(isExecutableNode("CONTINUITY_GATE"), true);
  check("шлюз має виконавця");
  for (const value of [[], ["bogus"], null]) {
    assert.throws(() => continuityChecks(value));
  }
  check("порожня/невідома конфігурація відхилена");
  const invalid = structuredClone(def);
  invalid.nodes.find((n) => n.id === "gate")!.params.checks = ["bogus"];
  assert.equal(validateWorkflow(invalid).ok, false);
  check("редактор не публікує невідомі правила");
  const bad = await startRun(deps, {
    workflowId: def.id,
    projectId: "book",
    input: input("Суперечлива пропозиція", 40),
    trigger: "manual",
    actor: "user:author",
  });
  assert.equal(bad.run.status, "succeeded");
  const output = bad.run.output as {
    continuity: { passed: boolean; blockers: { kind: string }[] };
  };
  assert.equal(output.continuity.passed, false);
  assert.ok(output.continuity.blockers.some((x) => x.kind === "age"));
  check("проєкція нового віку блокується до людського рішення");
  assert.equal((await repo.getEntity("book", hero.id))?.name, hero.name);
  assert.deepEqual(
    (await repo.getEntity("book", hero.id))?.canonical,
    hero.canonical,
  );
  check("заблокована пропозиція не змінює канон");
  assert.equal((await repo.listContinuityIssues("book")).length, 0);
  assert.equal((await repo.listEntityTraits("book", hero.id)).length, 1);
  check("проєкція не записує діагностику або гіпотетичні риси");
  const badSteps = await repo.listWorkflowSteps(bad.run.id);
  assert.ok(
    badSteps.some(
      (s) =>
        s.nodeId === "gate" &&
        s.branch === "block" &&
        s.validationResult === "block",
    ),
  );
  assert.ok(!badSteps.some((s) => s.nodeId === "canon"));
  assert.ok(badSteps.find(s => s.nodeId === "gate")!.warnings.length > 0);
  check("block у трасі, CANON_WRITE не викликано");
  const stranger = await startRun(deps, {
    workflowId: def.id,
    projectId: "book",
    input: input("Чужа", 30),
    trigger: "manual",
    actor: "user:stranger",
  });
  assert.equal(stranger.run.status, "failed");
  check("чужий користувач не аналізує й не записує книгу");
  await rejectOpen();
  const pass = await startRun(deps, {
    workflowId: def.id,
    projectId: "book",
    input: input("Узгоджена пропозиція", 30),
    trigger: "manual",
    actor: "user:author",
  });
  assert.equal(pass.run.status, "paused", pass.run.error ?? "");
  check("узгоджена пропозиція проходить до людини");
  const review = pass.run.output!.review as {
    proposalId: string;
    expectedRevision: number;
  };
  const accepted = await resumeRun(deps, pass.run.id, "user:author", {
    review: { action: "accept", expectedRevision: review.expectedRevision },
  });
  assert.equal(accepted.run.status, "succeeded");
  assert.equal(
    (await repo.getEntity("book", hero.id))?.name,
    "Узгоджена пропозиція",
  );
  check("прийнятий узгоджений стан записано у канон");
  assert.ok(
    (await repo.listWorkflowSteps(pass.run.id)).some(
      (s) =>
        s.nodeId === "canon" &&
        (s.details.continuity as { passed?: boolean })?.passed,
    ),
  );
  check("CANON_WRITE має власну свіжу перевірку у трасі");
  const edit = await startRun(deps, {
    workflowId: def.id,
    projectId: "book",
    input: input("До авторської правки", 30),
    trigger: "manual",
    actor: "user:author",
  });
  assert.equal(edit.run.status, "paused");
  const er = edit.run.output!.review as { expectedRevision: number };
  const changed = await resumeRun(deps, edit.run.id, "user:author", {
    review: {
      action: "edit",
      expectedRevision: er.expectedRevision,
      payload: {
        type: "character",
        targetId: hero.id,
        name: "Небезпечна авторська правка",
        canonical: { вік: 50 },
      },
    },
  });
  assert.equal(changed.run.status, "failed");
  assert.match(changed.run.error ?? "", /Continuity Gate/);
  assert.equal(
    (await repo.getEntity("book", hero.id))?.name,
    "Узгоджена пропозиція",
  );
  check("авторська правка після pass перевіряється і блокується");
  await rejectOpen();
  const drift = await startRun(deps, {
    workflowId: def.id,
    projectId: "book",
    input: input("Канон змінився", 30),
    trigger: "manual",
    actor: "user:author",
  });
  assert.equal(drift.run.status, "paused");
  await repo.setEntityTraitStatus("book", trait.id, "rejected", "user:author");
  await repo.upsertEntityTrait({
    projectId: "book",
    entityId: hero.id,
    label: "вік",
    value: "45",
    sectionId: "scene",
    status: "confirmed",
    createdBy: "user:author",
  });
  const dr = drift.run.output!.review as { expectedRevision: number };
  const failed = await resumeRun(deps, drift.run.id, "user:author", {
    review: { action: "accept", expectedRevision: dr.expectedRevision },
  });
  assert.equal(failed.run.status, "failed");
  assert.match(failed.run.error ?? "", /Continuity Gate/);
  check("зміна канону під час людської паузи блокує запис");
  await rejectOpen();
  const entityPayload: EntityProposalPayload = {
    type: "character",
    targetId: hero.id,
    name: "Пряма перевірка",
    canonical: { вік: 45 },
  };
  const p = await createProposal(repo, {
    projectId: "book",
    kind: "entity",
    payload: entityPayload,
    evidence: ["evidence"],
    actor: "ai:test",
    validate: true,
  });
  const snapshot = JSON.stringify({
    entities: await repo.listEntities("book"),
    traits: await repo.listEntityTraits("book"),
    paragraphs: await repo.listAllParagraphs("book"),
    issues: await repo.listContinuityIssues("book"),
  });
  await evaluateContinuityGate(repo, p);
  await evaluateContinuityGate(repo, p);
  assert.equal(
    JSON.stringify({
      entities: await repo.listEntities("book"),
      traits: await repo.listEntityTraits("book"),
      paragraphs: await repo.listAllParagraphs("book"),
      issues: await repo.listContinuityIssues("book"),
    }),
    snapshot,
  );
  check("повторні перевірки залишають джерело незмінним");
  const problem = await repo.upsertContinuityIssue({
    projectId: "book",
    kind: "age",
    entityId: hero.id,
    summary: "Автор підтвердив суперечність",
    evidenceA: {
      sectionId: "scene",
      paragraphId: "evidence",
      entityId: hero.id,
      quote: "Доказ",
    },
    evidenceB: {
      sectionId: "scene",
      paragraphId: "evidence",
      entityId: hero.id,
      quote: "Інший доказ",
    },
    source: "ai",
    status: "suggested",
    createdBy: "ai:test",
  });
  assert.equal((await evaluateContinuityGate(repo, p)).passed, true);
  check("непідтверджена AI знахідка є попередженням");
  await repo.setContinuityIssueStatus(
    "book",
    problem.id,
    "confirmed",
    "user:author",
  );
  assert.equal((await evaluateContinuityGate(repo, p)).passed, false);
  check("підтверджена автором суперечність блокує");
  await repo.setContinuityIssueStatus(
    "book",
    problem.id,
    "dismissed",
    "user:author",
  );
  assert.equal((await evaluateContinuityGate(repo, p)).passed, true);
  check("відхилена автором знахідка не блокує");
  await repo.setContinuityIssueStatus(
    "book",
    problem.id,
    "needs_review",
    "user:author",
  );
  assert.equal((await evaluateContinuityGate(repo, p)).passed, false);
  check("застаріла релевантна знахідка вимагає перегляду");
  await repo.setContinuityIssueStatus(
    "book",
    problem.id,
    "resolved",
    "user:author",
  );
  assert.equal((await evaluateContinuityGate(repo, p)).passed, true);
  check("вирішена знахідка не блокує");
  await repo.upsertContinuityIssue({
    projectId: "book",
    kind: "age",
    entityId: null,
    summary: "Інша сцена",
    evidenceA: {
      sectionId: "elsewhere",
      paragraphId: "unrelated",
      entityId: null,
      quote: "Інше",
    },
    evidenceB: {
      sectionId: "elsewhere",
      paragraphId: "unrelated",
      quote: "Другий доказ",
      entityId: null,
    },
    source: "rule",
    createdBy: "system:test",
  });
  assert.equal((await evaluateContinuityGate(repo, p)).passed, true);
  check("незалежна сцена не блокує цю пропозицію");
  await repo.markParagraphDeleted("book", "evidence");
  const gone = await evaluateContinuityGate(repo, p);
  assert.equal(gone.passed, false);
  assert.ok(gone.blockers.some((x) => x.code === "missing_evidence"));
  check("видалений доказ блокує");
  await repo.upsertParagraph(
    {
      projectId: "book",
      id: "evidence",
      documentId: "scene",
      order: 0,
      kind: "paragraph",
      text: "Олена відчинила двері.",
    },
    "user:author",
  );
  const noHero = await evaluateContinuityGate(repo, p, {
    checks: ["knowledge"],
    draft: { characterId: "foreign", sectionId: "scene", draftText: "Текст" },
  });
  assert.equal(noHero.passed, false);
  check("Knowledge Check не підміняє невідомого героя");
  await assert.rejects(() =>
    evaluateContinuityGate(repo, p, { draft: { characterId: hero.id } }),
  );
  check("неповний контекст знань відхилено");
  // A published graph cannot bypass the final check by omitting the node.
  await rejectOpen();
  const implicit = await startRun(deps, {
    workflowId: "review_fixture",
    projectId: "book",
    input: input("Без явного шлюзу", 90),
    trigger: "manual",
    actor: "user:author",
  });
  assert.equal(implicit.run.status, "paused");
  const ir = implicit.run.output!.review as { expectedRevision: number };
  const refused = await resumeRun(deps, implicit.run.id, "user:author", {
    review: { action: "accept", expectedRevision: ir.expectedRevision },
  });
  assert.equal(refused.run.status, "failed");
  assert.match(refused.run.error ?? "", /Continuity Gate/);
  check("видалення явного вузла не обходить перевірку CANON_WRITE");
  await rejectOpen();
  for (const [type, kind] of [
    ["location", "place"],
    ["object", "object"],
  ] as const) {
    const target = await repo.createEntity({
      projectId: "book",
      type,
      name: "Риса " + type,
      status: "confirmed",
      createdBy: "user:author",
    });
    await repo.upsertEntityTrait({
      projectId: "book",
      entityId: target.id,
      label: "колір",
      value: "білий",
      sectionId: "scene",
      status: "confirmed",
      createdBy: "user:author",
    });
    const candidate = await createProposal(repo, {
      projectId: "book",
      kind: "entity",
      payload: {
        type,
        targetId: target.id,
        name: "Змінена " + type,
        canonical: { колір: "чорний" },
      },
      evidence: ["evidence"],
      actor: "ai:test",
      validate: true,
    });
    const checked = await evaluateContinuityGate(repo, candidate, {
      checks: [kind],
    });
    assert.equal(checked.passed, false);
    assert.ok(checked.blockers.some((x) => x.kind === kind));
    check(kind + ": гіпотетична риса перевірена правилом Т2.4");
  }
  // Prospective temporal relation: no relation is written to validate it.
  const a = await repo.createEntity({
      projectId: "book",
      type: "event",
      name: "Пізня подія",
      status: "confirmed",
      createdBy: "user:author",
    }),
    b = await repo.createEntity({
      projectId: "book",
      type: "event",
      name: "Рання подія",
      status: "confirmed",
      createdBy: "user:author",
    });
  await repo.upsertDocument({
    projectId: "book",
    id: "second",
    parentId: "chapter",
    kind: "section",
    order: 1,
  });
  await repo.upsertParagraph(
    {
      projectId: "book",
      id: "event-evidence",
      documentId: "second",
      order: 0,
      kind: "paragraph",
      text: "Рання і пізня подія.",
    },
    "user:author",
  );
  for (const [entityId, paragraphId] of [
    [a.id, "evidence"],
    [b.id, "event-evidence"],
  ])
    await repo.replaceParagraphMentions("book", paragraphId, [
      {
        entityId,
        spanStart: 0,
        spanEnd: 1,
        source: "tag",
        status: "confirmed",
      },
    ]);
  for (const [id, time] of [
    [a.id, 20],
    [b.id, 10],
  ] as const)
    await repo.upsertTimePoint({
      projectId: "book",
      subjectKind: "event",
      subjectId: id,
      kind: "exact",
      start: String(time),
      end: null,
      sortKey: time,
      endKey: null,
      label: "",
      status: "confirmed",
      createdBy: "user:author",
    });
  const relation = await createProposal(repo, {
    projectId: "book",
    kind: "relation",
    payload: { type: "precedes", fromId: a.id, toId: b.id, note: "" },
    evidence: ["evidence", "event-evidence"],
    actor: "ai:test",
    validate: true,
  });
  const report = await evaluateContinuityGate(repo, relation, {
    checks: ["time"],
  });
  assert.equal(report.passed, false, JSON.stringify(report));
  assert.ok(report.blockers.some((x) => x.kind === "time"));
  assert.equal((await repo.listRelations("book")).length, 0);
  check("гіпотетичний зв’язок часу блокується без запису в граф");
  for (const [id, time] of [
    ["scene", 20],
    ["second", 10],
  ] as const)
    await repo.upsertTimePoint({
      projectId: "book",
      subjectKind: "scene",
      subjectId: id,
      kind: "exact",
      start: String(time),
      end: null,
      sortKey: time,
      endKey: null,
      label: "",
      status: "confirmed",
      createdBy: "user:author",
    });
  const causal = await createProposal(repo, {
    projectId: "book",
    kind: "relation",
    payload: { type: "leads_to", fromId: a.id, toId: b.id, note: "" },
    evidence: ["evidence", "event-evidence"],
    actor: "ai:test",
    validate: true,
  });
  const causalReport = await evaluateContinuityGate(repo, causal, {
    checks: ["causality"],
  });
  assert.equal(causalReport.passed, false, JSON.stringify(causalReport));
  assert.ok(causalReport.blockers.some((x) => x.kind === "causality"));
  check("гіпотетична причина після наслідку блокується");
  const revelation = await repo.createEntity({
    projectId: "book",
    type: "revelation",
    name: "Пізня правда",
    status: "confirmed",
    createdBy: "user:author",
  });
  await repo.upsertDocument({
    projectId: "book",
    id: "knowledge_future",
    parentId: "chapter",
    kind: "section",
    order: 2,
  });
  await repo.upsertParagraph(
    {
      projectId: "book",
      id: "future-evidence",
      documentId: "knowledge_future",
      order: 0,
      kind: "paragraph",
      text: "[/revelation:Пізня правда]",
    },
    "user:author",
  );
  await repo.upsertTimePoint({
    projectId: "book",
    subjectKind: "scene",
    subjectId: "knowledge_future",
    kind: "exact",
    start: "30",
    end: null,
    sortKey: 30,
    endKey: null,
    label: "",
    status: "confirmed",
    createdBy: "user:author",
  });
  await repo.replaceParagraphMentions("book", "future-evidence", [
    {
      entityId: revelation.id,
      spanStart: 0,
      spanEnd: 1,
      source: "tag",
      status: "confirmed",
      subjectEntityId: hero.id,
    },
  ]);
  const knowledge = await evaluateContinuityGate(repo, p, {
    checks: ["knowledge"],
    draft: {
      characterId: hero.id,
      sectionId: "scene",
      draftText: "[/revelation:Пізня правда]",
    },
  });
  assert.equal(knowledge.passed, false);
  assert.ok(knowledge.blockers.some((x) => x.code === "draft_knowledge"));
  check("знання героя з майбутньої сцени блокується");
}
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
console.log(count + " перевірок Continuity Gate пройшло.");
