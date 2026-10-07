import { canonicalJson } from "../../src/utils/ontology";
import { createHash } from "node:crypto";
import type { CoreSyncResult } from "./sync";
import type { CoreRepository } from "./types";
import type { JobQueue, JobKind } from "./jobs/queue";
import { JobFatalError } from "./jobs/queue";
import {
  startRun,
  publishedVersion,
  type EngineDeps,
} from "./workflows/engine/runner";
import {
  SEMANTIC_REGISTRY,
  SEMANTIC_WORKFLOW,
} from "./workflows/semanticChange";
export const SEMANTIC_CHANGE_KIND = "semantic_change";
export async function scheduleSemanticChange(
  repo: CoreRepository,
  queue: JobQueue | null,
  result: CoreSyncResult,
) {
  const changes = result.semanticChanges;
  if (result.skipped || changes.baseline || !changes.paragraphs.length)
    return { queued: 0, reason: changes.baseline ? "baseline" : "no_changes" };
  if (!queue) return { queued: 0, reason: "queue_unavailable" };
  const routes = await repo.listWorkflowDestinations({
    registry: SEMANTIC_REGISTRY,
    enabledOnly: true,
  });
  if (!routes.length) return { queued: 0, reason: "no_destinations" };
  if (
    (await repo.getWorkflow(SEMANTIC_WORKFLOW))?.status !== "active" ||
    !(await publishedVersion(repo, SEMANTIC_WORKFLOW))
  )
    return { queued: 0, reason: "detector_unpublished" };
  let queued = 0;
  for (const change of changes.paragraphs) {
    const key = createHash("sha256")
      .update(canonicalJson(change))
      .digest("hex");
    try {
      const out = await queue.enqueue({
        projectId: result.projectId,
        kind: SEMANTIC_CHANGE_KIND,
        payload: { change, revision: result.revision },
        idempotencyKey: `semantic:${key}`,
        estimatedTokens: 2000,
        maxAttempts: 1,
        createdBy: "system:semantic_change",
      });
      if (out.created) queued++;
    } catch (err) {
      return { queued, reason: `schedule_failed: ${(err as Error).message}` };
    }
  }
  return { queued, reason: null };
}
export function semanticChangeJobKind(
  engine: () => EngineDeps | null,
): JobKind {
  return {
    maxAttempts: 1,
    handler: async (ctx) => {
      const deps = engine();
      if (!deps) throw new JobFatalError("Ядро детектора недоступне.");
      if ((await deps.repo.getWorkflow(SEMANTIC_WORKFLOW))?.status !== "active")
        return { skipped: "detector_disabled" };
      await ctx.checkpoint();
      await ctx.setProgress({ step: "semantic_classification" });
      const out = await startRun(deps, {
        workflowId: SEMANTIC_WORKFLOW,
        input: { ...ctx.job.payload, semanticAutomatic: true },
        projectId: ctx.job.projectId,
        trigger: `job:${SEMANTIC_CHANGE_KIND}`,
        jobId: ctx.job.id,
        actor: "system:semantic_change",
        recordUsage: (u) => ctx.recordUsage(u),
        signal: ctx.signal,
      });
      if (out.run.status !== "succeeded")
        throw new JobFatalError(out.run.error ?? "Детектор не завершився.");
      await ctx.setProgress({
        step: "done",
        done: 1,
        total: 1,
        runId: out.run.id,
      });
      return { runId: out.run.id, ...out.run.output };
    },
  };
}
