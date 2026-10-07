import assert from "node:assert/strict";
import type { CoreRepository } from "../../server/core/types";
import {
  bootstrapOntology,
  resetActiveRegistry,
} from "../../server/core/ontology/lifecycle";
import {
  createWorkflow,
  saveDraft,
  validateVersion,
  promoteToTest,
  publishVersion,
} from "../../server/core/workflows/lifecycle";
import { type EngineDeps } from "../../server/core/workflows/engine/runner";
import {
  defaultParams,
  type WorkflowDefinition,
} from "../../src/utils/workflowGraph";

export async function reviewFixture(
  repo: CoreRepository,
  target: "entity" | "relation" = "entity",
  withModel = false,
) {
  resetActiveRegistry();
  await bootstrapOntology(repo);
  await repo.upsertProject({
    id: "book",
    ownerId: "author",
    title: "Review fixture",
  });
  await repo.upsertDocument({
    projectId: "book",
    id: "scene",
    kind: "section",
    order: 0,
  });
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
  const def: WorkflowDefinition = {
    format: "fusion-workflow/1",
    id: withModel
      ? "review_model"
      : target === "entity"
        ? "review_fixture"
        : "review_relation",
    name: { uk: "Перевірка", en: "Review" },
    description: "",
    nodes: [
      { id: "start", type: "START", params: {} },
      {
        id: "jev",
        type: "JEV_GATE",
        params: {
          ...defaultParams("JEV_GATE"),
          question: "Чи достатньо доказів?",
        },
      },
      {
        id: "proposal",
        type: "PROPOSAL",
        params: { target, min_confidence: 0 },
      },
      { id: "review", type: "HUMAN_REVIEW", params: { reviewer: "author" } },
      { id: "canon", type: "CANON_WRITE", params: { target } },
      { id: "end", type: "END", params: {} },
    ],
    edges: [
      { id: "a", from: "start", fromPort: "out", to: "jev" },
      { id: "jev_pass", from: "jev", fromPort: "pass", to: "proposal" },
      { id: "jev_block", from: "jev", fromPort: "block", to: "end" },
      { id: "jev_fallback", from: "jev", fromPort: "fallback", to: "end" },
      { id: "b", from: "proposal", fromPort: "out", to: "review" },
      { id: "c", from: "review", fromPort: "accept", to: "canon" },
      { id: "d", from: "review", fromPort: "edit", to: "canon" },
      { id: "e", from: "review", fromPort: "reject", to: "end" },
      { id: "f", from: "canon", fromPort: "out", to: "end" },
    ],
  };
  if (withModel) {
    def.nodes.push(
      {
        id: "prompt",
        type: "PROMPT",
        params: {
          template: "Створи пропозицію героя з evidence.",
          prompt_version: "fixture-v1",
        },
      },
      { id: "model", type: "LLM", params: defaultParams("LLM") },
      { id: "validate", type: "VALIDATOR", params: {} },
    );
    def.edges[0].to = "prompt";
    def.edges.push(
      { id: "prompt_model", from: "prompt", fromPort: "out", to: "model" },
      { id: "model_validate", from: "model", fromPort: "out", to: "validate" },
      { id: "validate_jev", from: "validate", fromPort: "valid", to: "jev" },
      { id: "invalid_end", from: "validate", fromPort: "invalid", to: "end" },
    );
  }
  const draft = (
    await createWorkflow(repo, {
      id: def.id,
      name: def.name,
      actor: "user:author",
    })
  ).draft;
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
  const deps: EngineDeps = {
    repo,
    services: {
      generate: async () => {
        if (!withModel) throw new Error("No provider needed");
        return {
          text: JSON.stringify({
            payload: { type: "character", name: "AI герой", canonical: {} },
            evidence: ["evidence"],
            confidence: 0.9,
          }),
          modelId: "controlled-text",
          engine: "mock",
          inputTokens: 10,
          outputTokens: 20,
          costUsd: 0,
        };
      },
      resolveModel: async () => undefined,
      jev: async () => ({
        name: "jev",
        evaluate: async () => {
          throw new Error("unused");
        },
        askState: async (_state, questions) => ({
          answers: Object.fromEntries(
            questions.map((q) => [q.id, { probability: 1, confidence: 1 }]),
          ),
          model: "controlled-jev",
          usage: { input_tokens: 10, output_tokens: 0 },
          latency_ms: 1,
        }),
      }),
    },
  };
  return { deps, def };
}
