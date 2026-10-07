import type { CoreRepository } from "../../server/core/types";
import { syncBookToCore, type StoredBookForSync } from "../../server/core/sync";
import { ensureSystemWorkflows } from "../../server/core/workflows/seeds";
import { systemBindings } from "../../server/core/workflows/bindings";
import {
  createWorkflow,
  saveDraft,
  validateVersion,
  promoteToTest,
  publishVersion,
} from "../../server/core/workflows/lifecycle";
import type { EngineDeps } from "../../server/core/workflows/engine/runner";
import { blockHash } from "../../src/utils/paragraphIds";
import type { JevAdapter } from "../../server/ai/adapters/jev";
import { SEMANTIC_REGISTRY } from "../../src/utils/semanticChange";
export async function semanticFixture(repo: CoreRepository) {
  const stored: StoredBookForSync = {
    id: "semantic-book",
    ownerId: "author",
    book: {
      id: "semantic-book",
      title: "Semantic test",
      characters: [{ id: "hero", name: "Марко" }],
      chapters: [
        {
          id: "chapter",
          sections: [
            {
              id: "scene",
              content: "[/character:Марко] входить до кімнати.",
              paragraphIds: ["p-one"],
              paragraphHashes: [
                blockHash("[/character:Марко] входить до кімнати."),
              ],
            },
            {
              id: "other-scene",
              content: "Незалежна сцена.",
              paragraphIds: ["p-other"],
              paragraphHashes: [blockHash("Незалежна сцена.")],
            },
          ],
        },
      ],
    },
  };
  const baseline = await syncBookToCore(repo, stored);
  await ensureSystemWorkflows(repo);
  for (const id of [
    "event_analysis",
    "location_analysis",
    "style_analysis",
    "time_analysis",
  ]) {
    const { draft } = await createWorkflow(repo, {
      id,
      name: { en: id, uk: id },
      actor: "user:admin",
    });
    const def = {
      format: "fusion-workflow/1",
      id,
      name: { en: id, uk: id },
      description: "Controlled analysis",
      nodes: [
        { id: "start", type: "START", params: {} },
        { id: "end", type: "END", params: {} },
      ],
      edges: [{ id: "edge", from: "start", fromPort: "out", to: "end" }],
    };
    await saveDraft(repo, {
      workflowId: id,
      versionId: draft.id,
      definition: def as any,
      actor: "user:admin",
    });
    const validated = await validateVersion(repo, id, draft.id, "user:admin");
    if (!validated.validation.ok)
      throw new Error(JSON.stringify(validated.validation.errors));
    await promoteToTest(repo, id, draft.id, "user:admin");
    await publishVersion(repo, id, draft.id, "user:admin");
  }
  const route = (category: string, workflowId: string, enabled = true) =>
    repo.saveWorkflowDestination({
      registry: SEMANTIC_REGISTRY,
      option: category.toLowerCase(),
      workflowId,
      enabled,
      label: { en: category, uk: category },
      description: "",
      updatedBy: "user:admin",
    });
  const control = {
    category: "EVENT",
    confidence: 0.99,
    down: false,
    fallback: false,
    fallbackAnswer: false,
    askCount: 0,
    fallbackCount: 0,
    onAsk: null as (() => Promise<void>) | null,
    states: [] as Record<string, unknown>[],
  };
  const jev: JevAdapter = {
    name: "jev",
    evaluate: async () => {
      throw new Error("unused");
    },
    askState: async (state, questions) => {
      control.askCount++;
      control.states.push(state);
      await control.onAsk?.();
      if (control.down) throw new Error("controlled Jev unavailable");
      return {
        model: "controlled-jev",
        answers: Object.fromEntries(
          questions.map((q) => [
            q.id,
            {
              choice: control.category,
              probabilities: { [control.category]: 1 },
              confidence: control.confidence,
            },
          ]),
        ),
        usage: { input_tokens: 25, output_tokens: 0 },
        latency_ms: 1,
      };
    },
  };
  const observed: { workflowId: string; input: Record<string, unknown> }[] = [];
  const bindings = systemBindings();
  for (const id of [
    "event_analysis",
    "location_analysis",
    "style_analysis",
    "time_analysis",
  ])
    bindings[id] = {
      workflowId: id,
      prepare: async () => ({
        executors: {
          START: async (_n, state) => {
            observed.push({ workflowId: id, input: state.input });
            return {};
          },
        },
      }),
    };
  const deps: EngineDeps = {
    repo,
    bindings,
    services: {
      jev: async () => (control.fallback ? null : jev),
      resolveModel: async () => "controlled-deepseek",
      generate: async () => {
        control.fallbackCount++;
        if (!control.fallbackAnswer)
          throw new Error("controlled fallback unavailable");
        return {
          text: JSON.stringify({
            answers: { choice: { choice: control.category } },
          }),
          modelId: "controlled-deepseek",
          engine: "deepseek",
          inputTokens: 15,
          outputTokens: 5,
          costUsd: 0.001,
        };
      },
    },
  };
  const changeText = async (text: string) => {
    const section = (stored.book as any).chapters[0].sections[0];
    section.content = text;
    section.paragraphIds = ["p-one"];
    section.paragraphHashes = [blockHash(text)];
    return syncBookToCore(repo, stored);
  };
  return { stored, baseline, route, control, observed, deps, changeText };
}
