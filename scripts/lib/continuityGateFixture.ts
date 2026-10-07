import assert from "node:assert/strict";
import type { CoreRepository } from "../../server/core/types";
import {
  createWorkflow,
  saveDraft,
  validateVersion,
  promoteToTest,
  publishVersion,
} from "../../server/core/workflows/lifecycle";
import type { WorkflowDefinition } from "../../src/utils/workflowGraph";
import { reviewFixture } from "./workflowHumanReviewFixture";
export async function continuityFixture(repo: CoreRepository) {
  const { deps } = await reviewFixture(repo);
  await repo.upsertDocument({
    projectId: "book",
    id: "chapter",
    kind: "chapter",
    order: 0,
  });
  await repo.upsertDocument({
    projectId: "book",
    id: "scene",
    kind: "section",
    parentId: "chapter",
    order: 0,
  });
  const hero = await repo.createEntity({
    projectId: "book",
    type: "character",
    name: "Герой шлюзу",
    status: "confirmed",
    createdBy: "user:author",
  });
  const trait = await repo.upsertEntityTrait({
    projectId: "book",
    entityId: hero.id,
    label: "вік",
    value: "30",
    sectionId: "scene",
    status: "confirmed",
    createdBy: "user:author",
  });
  const def: WorkflowDefinition = {
    format: "fusion-workflow/1",
    id: "continuity_fixture",
    name: { uk: "Шлюз безперервності", en: "Continuity Gate" },
    description: "",
    nodes: [
      { id: "start", type: "START", params: {} },
      {
        id: "proposal",
        type: "PROPOSAL",
        params: { target: "entity", min_confidence: 0 },
      },
      { id: "gate", type: "CONTINUITY_GATE", params: { checks: ["age"] } },
      { id: "review", type: "HUMAN_REVIEW", params: { reviewer: "author" } },
      { id: "canon", type: "CANON_WRITE", params: { target: "entity" } },
      { id: "end", type: "END", params: {} },
      { id: "blocked", type: "END", params: {} },
    ],
    edges: [
      { id: "a", from: "start", fromPort: "out", to: "proposal" },
      { id: "b", from: "proposal", fromPort: "out", to: "gate" },
      { id: "c", from: "gate", fromPort: "pass", to: "review" },
      { id: "d", from: "gate", fromPort: "block", to: "blocked" },
      { id: "e", from: "review", fromPort: "accept", to: "canon" },
      { id: "f", from: "review", fromPort: "edit", to: "canon" },
      { id: "g", from: "review", fromPort: "reject", to: "end" },
      { id: "h", from: "canon", fromPort: "out", to: "end" },
    ],
  };
  const { draft } = await createWorkflow(repo, {
    id: def.id,
    name: def.name,
    actor: "user:author",
  });
  await saveDraft(repo, {
    workflowId: def.id,
    versionId: draft.id,
    definition: def,
    actor: "user:author",
  });
  const validation = await validateVersion(
    repo,
    def.id,
    draft.id,
    "user:author",
  );
  assert.equal(
    validation.validation.ok,
    true,
    JSON.stringify(validation.validation),
  );
  await promoteToTest(repo, def.id, draft.id, "user:author");
  await publishVersion(repo, def.id, draft.id, "user:author");
  return {
    deps,
    def,
    hero,
    trait,
    input: (name: string, age: number) => ({
      proposal: {
        payload: {
          type: "character",
          targetId: hero.id,
          name,
          canonical: { вік: age },
        },
        evidence: ["evidence"],
        confidence: 0.9,
      },
    }),
  };
}
