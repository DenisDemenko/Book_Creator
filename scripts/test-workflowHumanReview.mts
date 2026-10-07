import { reviewFixture } from "./lib/workflowHumanReviewFixture";
import assert from "node:assert/strict";
import type { CoreRepository } from "../server/core/types";
import { PgCoreRepository } from "../server/core/pgRepository";
import { createCorePool } from "../server/core/index";
import {
  runMigrations,
  loadMigrations,
  resolveMigrationsDir,
} from "../server/core/migrate";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import {
  startRun,
  resumeRun,
  requestPause,
} from "../server/core/workflows/engine/runner";
let count = 0;
const check = (s: string) => {
  console.log("✓ " + s);
  count++;
};
async function suite(repo: CoreRepository) {
  const { deps, def } = await reviewFixture(repo);
  for (const action of ["accept", "edit", "reject"] as const) {
    const name = "Герой " + action;
    const started = await startRun(deps, {
      workflowId: def.id,
      projectId: "book",
      input: {
        proposal: {
          payload: { type: "character", name, canonical: {} },
          evidence: ["evidence"],
          confidence: 0.9,
        },
      },
      actor: "user:author",
      trigger: "manual",
    });
    assert.equal(started.run.status, "paused", started.error?.message);
    check(action + ": процес зупинився для людини");
    assert.equal(
      (await repo.listEntities("book")).some((e) => e.name === name),
      false,
    );
    check(action + ": канон до підтвердження не змінений");
    const review = started.run.output!.review as {
      proposalId: string;
      expectedRevision: number;
    };
    await assert.rejects(() => resumeRun(deps, started.run.id, "user:author"));
    check(action + ": звичайний resume не схвалює");
    await assert.rejects(() =>
      resumeRun(deps, started.run.id, "user:stranger", {
        review: { action, expectedRevision: review.expectedRevision },
      }),
    );
    check(action + ": чужий користувач не схвалює");
    await assert.rejects(() =>
      resumeRun(deps, started.run.id, "user:author", {
        review: { action, expectedRevision: review.expectedRevision - 1 },
      }),
    );
    check(action + ": стара ревізія відхилена без продовження");
    if (action === "edit") {
      await assert.rejects(() =>
        resumeRun(deps, started.run.id, "user:author", {
          review: {
            action,
            expectedRevision: review.expectedRevision,
            payload: [],
          },
        }),
      );
      assert.equal(
        (await repo.getWorkflowRun(started.run.id))?.status,
        "paused",
      );
      check("некоректна правка залишає можливість повторного рішення");
    }
    await assert.rejects(() =>
      resumeRun(
        {
          ...deps,
          services: { ...deps.services, canWriteCanon: async () => false },
        },
        started.run.id,
        "user:author",
        { review: { action, expectedRevision: review.expectedRevision } },
      ),
    );
    check(action + ": відкликаний CANON_WRITE перевіряється знову");
    const resumed = await resumeRun(
      { ...deps },
      started.run.id,
      "user:author",
      {
        review: {
          action,
          expectedRevision: review.expectedRevision,
          ...(action === "edit"
            ? {
                payload: {
                  type: "character",
                  name: "Виправлений герой",
                  canonical: {},
                },
              }
            : {}),
        },
      },
    );
    assert.equal(resumed.run.status, "succeeded", resumed.error?.message);
    check(action + ": продовження працює з контрольної точки");
    const proposal = await repo.getStoryProposal("book", review.proposalId);
    assert.equal(proposal?.state, action === "reject" ? "rejected" : "canon");
    check(action + ": остаточний стан коректний");
    if (action === "edit") {
      assert.ok(proposal?.authorEdit?.fields.includes("name"));
      check("авторська правка збереглась");
    }
    assert.equal(proposal?.provenance.workflowId, def.id);
    assert.ok(proposal?.provenance.runId);
    assert.equal(proposal?.provenance.nodeId, "proposal");
    check(action + ": походження workflow збережено");
    assert.equal(proposal?.provenance.jevDecisions?.[0]?.nodeId, "jev");
    assert.ok(proposal?.provenance.ontologyVersion);
    assert.equal(proposal?.decidedBy, "user:author");
    check(action + ": рішення Jev, онтологія і автор у походженні/рішенні");
    const steps = await repo.listWorkflowSteps(started.run.id);
    assert.ok(steps.some((s) => s.humanResult === action));
    check(action + ": рішення людини є в трасі");
  }

  const relationFixture = await reviewFixture(repo, "relation");
  const from = await repo.createEntity({
    projectId: "book",
    type: "character",
    name: "Причина",
    status: "confirmed",
    createdBy: "user:author",
  });
  const to = await repo.createEntity({
    projectId: "book",
    type: "event",
    name: "Наслідок",
    status: "confirmed",
    createdBy: "user:author",
  });
  const relationRun = (
    await startRun(relationFixture.deps, {
      workflowId: relationFixture.def.id,
      projectId: "book",
      input: {
        proposal: {
          payload: {
            type: "leads_to",
            fromId: from.id,
            toId: to.id,
            note: "Перевірений зв’язок",
          },
          evidence: ["evidence"],
          confidence: 0.9,
        },
      },
      actor: "user:author",
      trigger: "manual",
    })
  ).run;
  assert.equal(relationRun.status, "paused");
  check("зв’язок очікує рішення, як і сутність");
  const relationReview = relationRun.output!.review as {
    proposalId: string;
    expectedRevision: number;
  };
  const relationDone = await resumeRun(
    relationFixture.deps,
    relationRun.id,
    "user:author",
    {
      review: {
        action: "accept",
        expectedRevision: relationReview.expectedRevision,
      },
    },
  );
  assert.equal(relationDone.run.status, "succeeded");
  assert.equal(
    (await repo.getStoryProposal("book", relationReview.proposalId))?.state,
    "canon",
  );
  assert.ok(
    (await repo.listRelations("book", from.id)).some(
      (r) => r.type === "leads_to" && r.status === "confirmed",
    ),
  );
  check("зв’язок записується у канон лише після прийняття");
  const modelFixture = await reviewFixture(repo, "entity", true);
  const modelRun = (
    await startRun(modelFixture.deps, {
      workflowId: modelFixture.def.id,
      projectId: "book",
      input: {},
      actor: "user:author",
      trigger: "manual",
    })
  ).run;
  assert.equal(modelRun.status, "paused");
  const modelReview = modelRun.output!.review as {
    proposalId: string;
    expectedRevision: number;
  };
  const modelProposal = await repo.getStoryProposal(
    "book",
    modelReview.proposalId,
  );
  assert.equal(modelProposal?.provenance.model, "controlled-text");
  assert.equal(modelProposal?.provenance.promptVersion, "fixture-v1");
  assert.equal(modelProposal?.provenance.jevDecisions?.[0]?.nodeId, "jev");
  check("модель → validator → Jev → пропозиція з повним походженням");
  assert.equal(
    (
      await resumeRun(modelFixture.deps, modelRun.id, "user:author", {
        review: {
          action: "accept",
          expectedRevision: modelReview.expectedRevision,
        },
      })
    ).run.status,
    "succeeded",
  );
  check("модельна пропозиція доходить до канону після людини");
  const addStep = repo.addWorkflowStep.bind(repo);
  try {
    repo.addWorkflowStep = async (input) => {
      const row = await addStep(input);
      if (input.nodeId === "proposal") await requestPause(repo, input.runId);
      return row;
    };
    const paused = (
      await startRun(deps, {
        workflowId: def.id,
        projectId: "book",
        input: {
          proposal: {
            payload: {
              type: "character",
              name: "Пауза перед людиною",
              canonical: {},
            },
            evidence: ["evidence"],
            confidence: 0.9,
          },
        },
        actor: "user:author",
        trigger: "manual",
      })
    ).run;
    assert.equal(paused.status, "paused");
    assert.ok(paused.output?.review);
    check("технічна PAUSE перед HUMAN_REVIEW не приховує форму рішення");
    const pausedReview = paused.output!.review as { expectedRevision: number };
    assert.equal(
      (
        await resumeRun(deps, paused.id, "user:author", {
          review: {
            action: "accept",
            expectedRevision: pausedReview.expectedRevision,
          },
        })
      ).run.status,
      "succeeded",
    );
    check("технічна пауза не підміняє рішення людини");
  } finally {
    repo.addWorkflowStep = addStep;
  }
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
console.log(count + " перевірок HUMAN_REVIEW/CANON_WRITE пройшло.");
