import type { CoreRepository } from "../types";
import { canonicalJson } from "../../ai/contracts";
import { CoreRuleError } from "../rules";
/** Read-only dataset over durable proposal history. No training or workflow mutation. */
export async function workflowFeedback(
  repo: CoreRepository,
  projectId: string,
  workflowId?: string,
) {
  const proposals = await repo.listStoryProposals(projectId, { limit: 1000 });
  const rows = [];
  for (const p of proposals) {
    if (
      p.provenance.source !== "workflow" ||
      !p.provenance.runId ||
      (workflowId && p.provenance.workflowId !== workflowId)
    )
      continue;
    const events = await repo.listStoryProposalEvents(projectId, {
      proposalId: p.id,
      limit: 1000,
    });
    const review = events
      .filter((e) => e.action === "approve" || e.action === "reject")
      .at(-1);
    if (!review) continue;
    const creation = events.find((e) => e.action === "create");
    const canon = events.find((e) => e.action === "write_canon");
    const run = await repo.getWorkflowRun(p.provenance.runId);
    // A run reference never grants access to another book's input.
    if (!run || run.projectId !== projectId) continue;
    const original =
      creation?.details.aiProposal ?? p.authorEdit?.before ?? null;
    const final =
      canon?.details.finalCanon ??
      (p.state === "canon"
        ? { recordId: p.canonRef, payload: null, legacy: true }
        : null);
    rows.push({
      proposalId: p.id,
      workflowId: run.workflowId,
      workflowVersion: run.version,
      runId: run.id,
      inputContext: {
        input: run.input,
        prompt: creation?.details.inputContext ?? null,
      },
      aiProposal: original,
      aiConfidence: p.confidence,
      jevDecisions: p.provenance.jevDecisions ?? [],
      authorAction:
        review.action === "reject"
          ? "reject"
          : p.authorEdit
            ? "edit"
            : "accept",
      authorCorrection: p.authorEdit ?? null,
      author: review.actor,
      reviewedAt: review.createdAt,
      finalCanon: final,
      complete:
        original !== null &&
        creation?.details.inputContext != null &&
        (final as any)?.payload != null,
    });
  }
  return rows;
}
export async function workflowAnalytics(
  repo: CoreRepository,
  filter: { workflowId?: string; projectId?: string },
) {
  const runs = await repo.listWorkflowRuns({ ...filter, limit: 200 });
  const steps = (
    await Promise.all(runs.map((r) => repo.listWorkflowSteps(r.id)))
  ).flat();
  const feedback = filter.projectId
    ? await workflowFeedback(repo, filter.projectId, filter.workflowId)
    : [];
  const decisions = feedback.length,
    accepted = feedback.filter((f) => f.authorAction !== "reject").length,
    rejected = decisions - accepted,
    corrected = feedback.filter((f) => f.authorCorrection !== null).length;
  const confidence = steps
    .map((s) => s.confidence)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const metrics = {
    runs: runs.length,
    reviewed: decisions,
    accepted,
    rejected,
    corrected,
    acceptanceRate: decisions ? accepted / decisions : null,
    rejectionRate: decisions ? rejected / decisions : null,
    correctionRate: decisions ? corrected / decisions : null,
    averageConfidence: avg(confidence),
    confidenceSamples: confidence.length,
    averageCost: avg(runs.map((r) => r.costUsd)),
    averageLatency: avg(runs.map((r) => r.latencyMs)),
    failures: runs.filter((r) => r.status === "failed").length,
    retries: steps.reduce((n, s) => n + s.retryCount, 0),
  };
  const suggestions: {
    kind: string;
    reason: string;
    evidence: { runIds: string[]; proposalIds: string[] };
    applyAutomatically: false;
  }[] = [];
  const evidence = {
    runIds: runs.map((r) => r.id),
    proposalIds: feedback.map((f) => f.proposalId),
  };
  if (decisions >= 3 && (metrics.correctionRate ?? 0) >= 0.3)
    suggestions.push({
      kind: "review_prompt_context_threshold",
      reason: `Виправлено ${corrected} із ${decisions} перевірених пропозицій. Перевірте prompt, контекст і поріг на регресійному наборі.`,
      evidence,
      applyAutomatically: false,
    });
  if (runs.length >= 3 && metrics.failures / runs.length >= 0.2)
    suggestions.push({
      kind: "review_recovery",
      reason: `Помилки у ${metrics.failures} із ${runs.length} запусків. Перевірте тайм-аути й політику відновлення.`,
      evidence,
      applyAutomatically: false,
    });
  if (runs.length >= 3 && steps.some((s) => s.retryCount > 0))
    suggestions.push({
      kind: "review_cost_latency",
      reason:
        "Є повторні модельні запити. Перевірте їхню вартість та ціль затримки перед зміною політики.",
      evidence,
      applyAutomatically: false,
    });
  return {
    metrics,
    suggestions,
    window: {
      maxRuns: 200,
      maxProposals: 1000,
      returnedRuns: runs.length,
      returnedFeedback: feedback.length,
    },
    feedbackAvailable: !!filter.projectId,
    productionChanged: false,
    selfTraining: false,
  };
}
export async function evaluateFeedback(
  repo: CoreRepository,
  projectId: string,
  workflowId: string | undefined,
  cases: unknown,
) {
  if (
    !Array.isArray(cases) ||
    cases.length < 1 ||
    cases.length > 50 ||
    JSON.stringify(cases).length > 200000
  )
    throw new CoreRuleError(
      "bad_input",
      "Від 1 до 50 результатів, до 200 000 символів.",
    );
  const dataset = await workflowFeedback(repo, projectId, workflowId);
  const seen = new Set<string>();
  const results = cases.map((c) => {
    if (
      !c ||
      typeof c.proposalId !== "string" ||
      seen.has(c.proposalId) ||
      !c.payload ||
      typeof c.payload !== "object" ||
      Array.isArray(c.payload)
    )
      throw new CoreRuleError(
        "bad_input",
        "Вкажіть унікальний proposalId і payload.",
      );
    seen.add(c.proposalId);
    const row = dataset.find((r) => r.proposalId === c.proposalId);
    if (!row)
      throw new CoreRuleError(
        "not_found",
        "Приклад не належить набору цієї книги.",
      );
    const expected = (row.finalCanon as any)?.payload;
    return {
      proposalId: row.proposalId,
      status: expected ? "evaluated" : "not_applied",
      exactMatch: expected
        ? canonicalJson(expected) === canonicalJson(c.payload)
        : null,
    };
  });
  const evaluated = results.filter((r) => r.status === "evaluated");
  return {
    results,
    evaluated: evaluated.length,
    exactMatchRate: evaluated.length
      ? evaluated.filter((r) => r.exactMatch).length / evaluated.length
      : null,
    method: "exact_payload_match",
    productionChanged: false,
    selfTraining: false,
  };
}
