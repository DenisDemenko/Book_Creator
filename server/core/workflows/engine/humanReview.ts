import { assertCanonPermission } from "./canonPermissions";
/** T5.6: durable human review; no automatic canon permission. */
import {
  evaluateContinuityGate,
  type ContinuityGateReport,
} from "./continuityGate";
import { NodeError } from "./types";
import { parseModelJson } from "../../ai/schema";
import { interrupt } from "@langchain/langgraph";
import {
  createProposal,
  approveProposal,
  rejectProposal,
  writeCanon,
} from "../../storyCore/proposals";
import { CoreRuleError } from "../../rules";
import type { ExecEnv, NodeExecutor } from "./types";
export interface HumanReviewDecision {
  action: "accept" | "edit" | "reject";
  expectedRevision: number;
  payload?: Record<string, unknown>;
  reason?: string;
}
export const CREATE_STORY_PROPOSAL: NodeExecutor = async (node, state, env) => {
  await assertCanonPermission(env);
  const projectId = env.run.projectId;
  if (!projectId)
    throw new CoreRuleError("bad_input", "Оберіть книгу для пропозиції.");
  const raw = state.output ?? state.llm?.text ?? state.input.proposal;
  const data = (typeof raw === "string" ? parseModelJson(raw) : raw) as {
    payload?: unknown;
    evidence?: string[];
    confidence?: number;
  };
  if (!data || typeof data !== "object" || !data.payload)
    throw new CoreRuleError(
      "bad_input",
      "Пропозиція потребує payload і evidence.",
    );
  const confidence = data.confidence ?? state.confidence ?? null;
  if (
    confidence != null &&
    confidence < Number(node.params.min_confidence ?? 0)
  )
    return {
      patch: {
        result: { proposed: false, reason: "low_confidence", confidence },
      },
      trace: { decision: "below_threshold", confidence },
    };
  const decisions = (await env.repo.listWorkflowSteps(env.run.id))
    .filter((step) =>
      [
        "JEV_CHOICE",
        "JEV_SCORE",
        "JEV_NOUL",
        "JEV_GATE",
        "JEV_ROUTER",
        "JEV_EVALUATOR",
        "JEV_DECISION_BUNDLE",
      ].includes(step.nodeType),
    )
    .map((step) => ({
      nodeId: step.nodeId,
      decision: step.decision,
      confidence: step.confidence,
      model: step.model,
      details: step.details,
    }));
  const row = await createProposal(env.repo, {
    projectId,
    kind: node.params.target === "relation" ? "relation" : "entity",
    payload: data.payload,
    evidence: data.evidence,
    confidence,
    actor: "ai:workflow",
    validate: true,
    feedbackContext: state.prompt ? { ...state.prompt } : {inputRef:env.run.id},
    provenance: {
      source: "workflow",
      workflowId: env.run.workflowId,
      workflowVersion: env.run.version,
      nodeId: node.id,
      runId: env.run.id,
      model: state.llm?.model,
      promptVersion: state.prompt?.promptVersion,
      jevDecisions: decisions,
    },
  });
  return {
    patch: {
      vars: { ...state.vars, storyProposalId: row.id },
      result: { proposalId: row.id, state: row.state },
    },
    trace: {
      decision: "proposed",
      details: { proposalId: row.id, revision: row.revision },
    },
  };
};
export const HUMAN_REVIEW: NodeExecutor = async (node, state, env) => {
  const projectId = env.run.projectId,
    id = state.vars.storyProposalId;
  if (!projectId || typeof id !== "string")
    throw new CoreRuleError("bad_input", "Немає пропозиції для перевірки.");
  const proposal = await env.repo.getStoryProposal(projectId, id);
  if (!proposal)
    throw new CoreRuleError("not_found", "Пропозицію не знайдено.");
  await env.repo.updateWorkflowRun(env.run.id, {
    status: "paused",
    currentNode: node.id,
    output: {
      review: {
        proposalId: id,
        expectedRevision: proposal.revision,
        payload: proposal.payload,
        evidence: proposal.evidence,
        validation: proposal.validation,
        confidence: proposal.confidence,
        provenance: proposal.provenance,
      },
    },
  });
  const decision = interrupt({
    review: { proposalId: id, revision: proposal.revision },
  }) as HumanReviewDecision;
  await assertCanonPermission(env, String(node.params.reviewer));
  if (
    !decision ||
    !["accept", "edit", "reject"].includes(decision.action) ||
    !Number.isSafeInteger(decision.expectedRevision)
  )
    throw new CoreRuleError(
      "bad_input",
      "Потрібне явне рішення людини та ревізія.",
    );
  if (
    decision.action === "edit" &&
    (!decision.payload ||
      typeof decision.payload !== "object" ||
      Array.isArray(decision.payload))
  )
    throw new CoreRuleError(
      "bad_input",
      "Вкажіть виправлений зміст пропозиції.",
    );
  const result =
    decision.action === "reject"
      ? await rejectProposal(env.repo, projectId, id, {
          actor: env.actor,
          expectedRevision: decision.expectedRevision,
          reason: decision.reason,
        })
      : (
          await approveProposal(env.repo, projectId, id, {
            actor: env.actor,
            expectedRevision: decision.expectedRevision,
            reason: decision.reason,
            ...(decision.action === "edit"
              ? { edits: { payload: decision.payload } }
              : {}),
          })
        ).proposal;
  await env.repo.updateWorkflowRun(env.run.id, {
    status: "running",
    output: null,
  });
  return {
    branch: decision.action,
    patch: {
      vars: {
        ...state.vars,
        humanReview: {
          proposalId: id,
          actor: env.actor,
          action: decision.action,
          revision: result.revision,
        },
      },
      result: { proposalId: id, state: result.state },
    },
    trace: {
      humanResult: decision.action,
      decision: result.state,
      details: { proposalId: id, actor: env.actor, revision: result.revision },
    },
  };
};
export const CANON_WRITE: NodeExecutor = async (node, state, env) => {
  await assertCanonPermission(env);
  const review = state.vars.humanReview as
    | { proposalId?: string; action?: string; revision?: number }
    | undefined;
  if (!review?.proposalId || !["accept", "edit"].includes(review.action ?? ""))
    throw new CoreRuleError(
      "bad_actor",
      "Запис у канон лише після прийняття людиною.",
    );
  const proposal = await env.repo.getStoryProposal(
    env.run.projectId!,
    review.proposalId,
  );
  if (proposal && node.params.target !== proposal.kind)
    throw new CoreRuleError(
      "bad_input",
      "CANON_WRITE target має відповідати виду пропозиції: entity або relation.",
    );
  if (
    !proposal ||
    proposal.state !== "approved" ||
    proposal.revision !== review.revision
  )
    throw new CoreRuleError(
      "conflict",
      "Схвалену пропозицію змінено — потрібна повторна перевірка.",
    );
  // Recompute after author edits and a potentially long human-review pause.
  const previous = state.vars.continuityGate as
    | ContinuityGateReport
    | undefined;
  const gate = await evaluateContinuityGate(env.repo, proposal, {
    checks: previous?.checks,
    draft: state.input.continuityDraft,
  });
  if (!gate.passed)
    throw new NodeError(
      `Continuity Gate заблокував канон: ${gate.blockers
        .slice(0, 3)
        .map((x) => x.summary)
        .join("; ")}`,
      "schema",
      {
        decision: "block",
        validationResult: "block",
        warnings: gate.warnings.map(x => x.summary),
        details: { continuity: gate },
      },
    );
  const result = await writeCanon(
    env.repo,
    env.run.projectId!,
    review.proposalId,
    { actor: env.actor },
  );
  return {
    patch: {
      result: {
        proposalId: result.proposal.id,
        state: result.proposal.state,
        recordId: result.recordId,
      },
    },
    trace: {
      humanResult: review.action,
      decision: "canon",
      validationResult: "pass",
      warnings: gate.warnings.map(x => x.summary),
      details: {
        proposalId: result.proposal.id,
        recordId: result.recordId,
        continuity: gate,
      },
    },
  };
};
