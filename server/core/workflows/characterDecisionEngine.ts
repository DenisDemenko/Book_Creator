/** Simulation workflow. Public trace contains ids and typed decision metrics only. */
import { simulationFailure } from "../characterSimulation";
import {
  WORKFLOW_FORMAT,
  type WorkflowDefinition,
} from "../../../src/utils/workflowGraph";
import { NodeError, type BindingDef } from "./engine/types";
export const CHARACTER_DECISION_WORKFLOW = "character_decision_engine";
export function characterDecisionWorkflowDefinition(): WorkflowDefinition {
  return {
    format: WORKFLOW_FORMAT,
    id: CHARACTER_DECISION_WORKFLOW,
    name: { en: "Character Decision Engine", uk: "Рішення героя — симуляція" },
    description:
      "Character State → Scene State → Jev Choice/Score/Noul → реалізація → досвід → пам’ять і стан лише прогону. Без канону.",
    nodes: [
      { id: "start", type: "START", params: {} },
      {
        id: "turn",
        type: "TOOL",
        label: "Simulation decision → experience",
        params: { tool: "character_simulation_turn" },
      },
      { id: "end", type: "END", params: {} },
    ],
    edges: [
      { id: "e-start", from: "start", fromPort: "out", to: "turn" },
      { id: "e-turn", from: "turn", fromPort: "out", to: "end" },
    ],
  };
}
export function characterDecisionBinding(): BindingDef {
  return {
    workflowId: CHARACTER_DECISION_WORKFLOW,
    prepare: async ({ run, input, services }) => {
      if (
        !run.projectId ||
        !run.startedBy.startsWith("user:") ||
        input.semanticAutomatic === true ||
        input.mode !== "simulation" ||
        typeof input.simulationId !== "string" ||
        !Number.isSafeInteger(input.expectedRevision) ||
        !services.simulateCharacterTurn
      )
        throw new NodeError(
          "Потрібні mode: simulation, simulationId, expectedRevision і доступ власника або адміністратора.",
          "bad_input",
        );
      return {
        executors: {
          TOOL: async (node, _state, env) => {
            if (node.params.tool !== "character_simulation_turn")
              throw new NodeError(
                "Невідомий інструмент симуляції.",
                "bad_input",
              );
            const report = await services.simulateCharacterTurn!({
              projectId: run.projectId!,
              actor: run.startedBy,
              input: { ...input, requestId: input.requestId ?? run.id },
              signal: env.signal,
              recordUsage: env.recordUsage,
            }).catch(simulationFailure);
            return {
              patch: { result: { characterDecision: report } },
              trace: {
                decision: report.status,
                details: { characterDecision: report },
              },
            };
          },
        },
      };
    },
  };
}
