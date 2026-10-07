/** Evidence-backed causal candidates; chronology is world time, then narrative order. */
import { createHash } from "node:crypto";
import { canonicalJson } from "../../src/utils/ontology";
import { EVENT_TYPES } from "./characterProfile";
import { scanScenes, sceneIsBefore } from "./timeline";
import type { CoreRepository, MentionRow } from "./types";
import {
  sourceIsCurrent,
  type SemanticParagraphChange,
} from "./semanticChanges";
export const CAUSALITY_WORKFLOW = "causality_engine";
const CAUSE_TYPES = new Set([...EVENT_TYPES, "goal", "character-state"]);
export async function causalCandidates(
  repo: CoreRepository,
  projectId: string,
  input: Record<string, unknown>,
  limit: number,
) {
  const change = input.change as SemanticParagraphChange | undefined;
  if (change && !(await sourceIsCurrent(repo, projectId, change)))
    return { reason: "stale", effect: null, candidates: [], fingerprint: "" };
  const scan = await scanScenes(
    repo,
    projectId,
    await repo.listTimePoints(projectId),
  );
  const live = scan.mentions.filter(
    (m) =>
      m.status === "confirmed" &&
      scan.entities.get(m.entityId)?.status === "confirmed" &&
      scan.ix.paragraphs.get(m.paragraphId)?.kind !== "draft" &&
      !scan.ix.paragraphs.get(m.paragraphId)?.deletedAt,
  );
  const earlier = (a: MentionRow, b: MentionRow) => {
    const pa = scan.ix.paragraphs.get(a.paragraphId)!,
      pb = scan.ix.paragraphs.get(b.paragraphId)!;
    if (pa.documentId === pb.documentId)
      return (
        pa.order < pb.order || (pa.id === pb.id && a.spanStart < b.spanStart)
      );
    const sa = scan.bySection.get(pa.documentId),
      sb = scan.bySection.get(pb.documentId);
    return !!sa && !!sb && sceneIsBefore(sa, sb);
  };
  const first = new Map<string, MentionRow>();
  for (const m of live)
    if (!first.has(m.entityId) || earlier(m, first.get(m.entityId)!))
      first.set(m.entityId, m);
  const requested =
    typeof input.eventId === "string"
      ? [input.eventId]
      : change
        ? (change.after?.entityIds ?? []).filter(
            (id) => !change.before?.entityIds.includes(id),
          )
        : [];
  const effects = requested.filter(
    (id) => EVENT_TYPES.has(scan.entities.get(id)?.type ?? "") && first.has(id),
  );
  if (effects.length !== 1)
    return {
      reason: effects.length ? "select_event" : "no_new_event",
      effect: null,
      candidates: [],
      fingerprint: "",
    };
  const effectId = effects[0],
    anchor = first.get(effectId)!;
  const evidence = (m: MentionRow) => {
    const p = scan.ix.paragraphs.get(m.paragraphId)!,
      e = scan.entities.get(m.entityId)!;
    return {
      entityId: e.id,
      name: e.name,
      type: e.type,
      canonical: e.canonical,
      paragraphId: p.id,
      sectionId: p.documentId,
      text: p.text,
      version: p.version,
      order: p.order,
      spanStart: m.spanStart,
      time: scan.bySection.get(p.documentId)?.time ?? null,
    };
  };
  const effect = evidence(anchor);
  const relations = (await repo.listRelations(projectId)).filter(
    (r) => r.status === "confirmed",
  );
  if (
    relations.some(
      (r) =>
        (r.type === "caused_by" && r.fromId === effectId) ||
        (["triggers", "leads_to", "consequence"].includes(r.type) &&
          r.toId === effectId),
    )
  )
    return {
      reason: "already_linked",
      effect,
      candidates: [],
      fingerprint: "",
    };
  const candidates = [...first.values()]
    .filter(
      (m) =>
        m.entityId !== effectId &&
        CAUSE_TYPES.has(scan.entities.get(m.entityId)!.type) &&
        earlier(m, anchor),
    )
    .sort((a, b) =>
      earlier(a, b)
        ? 1
        : earlier(b, a)
          ? -1
          : a.entityId.localeCompare(b.entityId),
    )
    .slice(0, limit)
    .map(evidence);
  // Include chronological location: scene moves and time edits invalidate model decisions.
  const snapshot = {
    effect,
    candidates,
    relations,
    positions: [effect, ...candidates].map(
      (e) => scan.bySection.get(e.sectionId)?.narrativeIndex,
    ),
  };
  const fingerprint = createHash("sha256")
    .update(canonicalJson(snapshot))
    .digest("hex");
  return {
    reason: candidates.length ? null : "no_candidates",
    effect,
    candidates,
    fingerprint,
  };
}
