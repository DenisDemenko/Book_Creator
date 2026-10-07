import { NodeError } from "./types";
export type ModelTier = "cheap" | "standard" | "strong";
export interface CostCandidate {
  modelId: string;
  tier: ModelTier;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  latencyMs: number;
}
export interface CostPolicy {
  version: string;
  budgetUsd: number;
  latencyTargetMs: number;
  complexity: number;
  risk: number;
  humanRiskThreshold?: number;
  candidates: CostCandidate[];
}
const ranks = { cheap: 0, standard: 1, strong: 2 };
const number = (v: unknown, min: number, max = Infinity) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
/** Prices and latency estimates are versioned author configuration, not invented provider prices. */
export function validateCostPolicy(raw: unknown): CostPolicy {
  const p = raw as CostPolicy;
  if (
    !p ||
    typeof p.version !== "string" ||
    !p.version.trim() ||
    p.version.length > 100 ||
    !number(p.budgetUsd, 0) ||
    !number(p.latencyTargetMs, 1) ||
    !number(p.complexity, 0, 1) ||
    !number(p.risk, 0, 1) ||
    (p.humanRiskThreshold !== undefined &&
      !number(p.humanRiskThreshold, 0, 1)) ||
    !Array.isArray(p.candidates) ||
    !p.candidates.length ||
    p.candidates.length > 12
  )
    throw new NodeError(
      "Некоректна cost_policy: версія, бюджет, затримка, складність/ризик 0–1 та 1–12 моделей.",
      "bad_input",
    );
  const ids = new Set<string>();
  for (const c of p.candidates) {
    if (
      !c ||
      typeof c.modelId !== "string" ||
      !c.modelId.trim() ||
      c.modelId.length > 200 ||
      ids.has(c.modelId) ||
      !Object.hasOwn(ranks, c.tier) ||
      !number(c.inputUsdPerMillion, 0) ||
      !number(c.outputUsdPerMillion, 0) ||
      !number(c.latencyMs, 1)
    )
      throw new NodeError(
        "Некоректний або дубльований кандидат cost_policy.",
        "bad_input",
      );
    ids.add(c.modelId);
  }
  return p;
}
export function routeByCost(
  raw: unknown,
  request: {
    system: string;
    user: string;
    maxTokens: number;
    spentUsd: number;
    reservedUsd?: number;
    costLimit?: number;
    override?: unknown;
    preferredModel?: string;
  },
) {
  if (
    !number(request.maxTokens, 1, 200000) ||
    !Number.isInteger(request.maxTokens) ||
    !number(request.spentUsd, 0) ||
    !number(request.reservedUsd ?? 0, 0)
  )
    throw new NodeError(
      "Некоректні токени або використаний бюджет.",
      "bad_input",
    );
  const p = validateCostPolicy(raw),
    o = (request.override ?? {}) as Record<string, unknown>;
  for (const key of ["complexity", "risk"])
    if (o[key] !== undefined && !number(o[key], 0, 1))
      throw new NodeError("Складність і ризик 0–1.", "bad_input");
  for (const key of ["budgetUsd", "latencyTargetMs"])
    if (o[key] !== undefined && !number(o[key], key === "budgetUsd" ? 0 : 1))
      throw new NodeError("Некоректний бюджет або ціль затримки.", "bad_input");
  const complexity = Math.max(p.complexity, Number(o.complexity ?? 0)),
    risk = Math.max(p.risk, Number(o.risk ?? 0));
  const budget = Math.min(
    p.budgetUsd,
    Number(o.budgetUsd ?? Infinity),
    request.costLimit && request.costLimit > 0 ? request.costLimit : Infinity,
  );
  const remaining = Math.max(
    0,
    budget - request.spentUsd - (request.reservedUsd ?? 0),
  );
  const latencyTargetMs = Math.min(
    p.latencyTargetMs,
    Number(o.latencyTargetMs ?? Infinity),
  );
  const tier: ModelTier =
    Math.max(complexity, risk) >= 0.7
      ? "strong"
      : Math.max(complexity, risk) >= 0.35
        ? "standard"
        : "cheap";
  // UTF-8 byte count conservatively bounds token count; output is provider capped.
  const inputTokensBound = new TextEncoder().encode(
    request.system + request.user,
  ).length;
  const candidates = p.candidates.map((c) => {
    const estimatedUsd =
      (inputTokensBound * c.inputUsdPerMillion +
        request.maxTokens * c.outputUsdPerMillion) /
      1e6;
    const reasons = [];
    if (ranks[c.tier] < ranks[tier]) reasons.push("insufficient_tier");
    if (estimatedUsd > remaining) reasons.push("budget");
    if (c.latencyMs > latencyTargetMs) reasons.push("latency");
    return { ...c, estimatedUsd, eligible: !reasons.length, reasons };
  });
  const eligible = candidates
    .filter((c) => c.eligible)
    .sort(
      (a, b) =>
        a.estimatedUsd - b.estimatedUsd ||
        a.latencyMs - b.latencyMs ||
        a.modelId.localeCompare(b.modelId),
    );
  const selected = request.preferredModel
    ? eligible.find((c) => c.modelId === request.preferredModel)
    : eligible[0];
  const human = risk >= (p.humanRiskThreshold ?? 0.8);
  return {
    policyVersion: p.version,
    complexity,
    risk,
    requiredTier: tier,
    budgetUsd: budget,
    remainingUsd: remaining,
    latencyTargetMs,
    inputTokensBound,
    maxOutputTokens: request.maxTokens,
    candidates,
    selectedModel: selected?.modelId ?? null,
    estimatedUsd: selected?.estimatedUsd ?? null,
    route: selected ? (human ? "human_review" : selected.tier) : "human_review",
    reason: selected
      ? human
        ? "high_risk"
        : "lowest_cost_eligible"
      : "no_eligible_model",
    reviewRequired: human || !selected,
  };
}
