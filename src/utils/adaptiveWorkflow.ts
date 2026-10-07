/** Versioned policy shared by Graph Studio validation and the runner. */
export const ADAPTIVE_WORKFLOW = "adaptive_workflow";
export const ADAPTIVE_DEPTHS = ["minimal", "light", "normal", "deep"] as const;
export type AdaptiveDepth = (typeof ADAPTIVE_DEPTHS)[number];
export interface AdaptivePolicy {
  medium: number;
  high: number;
  critical: number;
  low: "skip" | "minimal";
  targets: Record<AdaptiveDepth, string>;
}
export function adaptivePolicyError(
  raw: unknown,
  min: number,
  max: number,
): string | null {
  const p = raw as AdaptivePolicy;
  if (
    !p ||
    typeof p !== "object" ||
    ![p.medium, p.high, p.critical, min, max].every(
      (x) => typeof x === "number" && Number.isFinite(x),
    )
  )
    return "Потрібні числові пороги medium, high, critical і шкала JEV_SCORE";
  if (
    !(
      min < p.medium &&
      p.medium < p.high &&
      p.high < p.critical &&
      p.critical <= max
    )
  )
    return "Пороги: scale_min < medium < high < critical ≤ scale_max";
  if (!["skip", "minimal"].includes(p.low)) return "low: skip або minimal";
  if (
    !p.targets ||
    ADAPTIVE_DEPTHS.some(
      (d) =>
        typeof p.targets[d] !== "string" ||
        (p.targets[d] !== "" &&
          !/^[a-zA-Z][a-zA-Z0-9_]{1,63}$/.test(p.targets[d])),
    )
  )
    return "targets: minimal, light, normal, deep — id процесу або порожній рядок";
  if (
    ADAPTIVE_DEPTHS.some(
      (d) =>
        p.targets[d] === ADAPTIVE_WORKFLOW ||
        p.targets[d] === "semantic_change_detector",
    )
  )
    return "Адаптивний аналіз не запускає себе або детектор";
  return null;
}
export function trustedAnalysisTool(
  workflowId: string,
  type: string,
  tool: unknown,
): boolean {
  return (
    type === "TOOL" &&
    ((workflowId === "semantic_change_detector" &&
      tool === "semantic_dispatch") ||
      (workflowId === ADAPTIVE_WORKFLOW && tool === "adaptive_dispatch") ||
      (workflowId === "causality_engine" && tool === "causality_propose"))
  );
}
