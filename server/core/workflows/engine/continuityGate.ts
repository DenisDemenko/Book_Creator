/** Т5.7 В1: evaluate the proposed world with T2.4 rules without writing it. */
import { randomUUID } from "node:crypto";
import {
  factoryOntology,
  FUSION_ONTOLOGY_ID,
  type OntologyDefinition,
} from "../../../../src/utils/ontology";
import type {
  CoreRepository,
  StoryProposalRow,
  EntityProposalPayload,
  RelationProposalPayload,
  RelationRow,
  EntityTraitRow,
  ContinuityIssueRow,
  ContinuityIssueInput,
} from "../../types";
import { CoreRuleError } from "../../rules";
import { validatePayload } from "../../storyCore/proposals";
import {
  refreshTimeContinuity,
  refreshTraitContradictions,
  refreshKnowledgeContinuity,
  refreshPlaceContinuity,
  refreshObjectContinuity,
  AGE_TRAIT_LABEL,
} from "../../continuity";
import { refreshCausalityContinuity } from "../../causality";
import { checkDraftKnowledge } from "../../continuityDraft";
import { assertCanonPermission } from "./canonPermissions";
import type { NodeExecutor } from "./types";

import { CONTINUITY_CHECKS } from "../../../../src/utils/workflowGraph";
export { CONTINUITY_CHECKS };
export type ContinuityCheck = (typeof CONTINUITY_CHECKS)[number];
export interface GateIssue {
  code: string;
  kind: string;
  summary: string;
  entityId?: string | null;
  evidence?: string[];
}
export interface ContinuityGateReport {
  passed: boolean;
  proposalId: string;
  revision: number;
  checks: ContinuityCheck[];
  ontologyVersion: number | null;
  blockers: GateIssue[];
  warnings: GateIssue[];
  blockerCount: number;
  warningCount: number;
  checkedAt: string;
}
export interface DraftGateContext {
  characterId: string;
  sectionId: string;
  draftText: string;
}
export function continuityChecks(value: unknown): ContinuityCheck[] {
  if (value === undefined) return [...CONTINUITY_CHECKS];
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some(
      (x) =>
        typeof x !== "string" ||
        !CONTINUITY_CHECKS.includes(x as ContinuityCheck),
    )
  )
    throw new CoreRuleError(
      "bad_input",
      "Continuity Gate: оберіть time, age, knowledge, place, object або causality.",
    );
  return [...new Set(value)] as ContinuityCheck[];
}
const norm = (s: string) => s.trim().toLocaleLowerCase("uk");

/** Only the continuity diagnostics are writable in this ephemeral projection. */
async function projectedWorld(repo: CoreRepository, p: StoryProposalRow) {
  const projectId = p.projectId;
  const rows = structuredClone(await repo.listContinuityIssues(projectId));
  const traits = structuredClone(await repo.listEntityTraits(projectId));
  const paragraphs = await repo.listAllParagraphs(projectId);
  const evidenceSection =
    paragraphs.find((x) => !x.deletedAt && p.evidence.includes(x.id))
      ?.documentId ?? null;
  const now = new Date().toISOString();
  let relation: RelationRow | null = null;
  if (p.kind === "relation") {
    const payload = p.payload as RelationProposalPayload;
    relation = {
      ...payload,
      id: `projection:${p.id}`,
      projectId,
      status: "confirmed",
      evidence: p.evidence,
      version: 1,
      createdBy: "system:continuity-gate",
      createdAt: now,
      updatedAt: now,
    };
  } else {
    const payload = p.payload as EntityProposalPayload;
    if (payload.targetId) {
      const active = await repo.getActiveOntologyVersion(FUSION_ONTOLOGY_ID);
      const definition =
        (active?.definition as unknown as OntologyDefinition | undefined) ??
        factoryOntology();
      const properties =
        definition.entityTypes.find((x) => x.id === payload.type)?.properties ??
        [];
      for (const [key, value] of Object.entries(payload.canonical)) {
        if (!["string", "number", "boolean"].includes(typeof value)) continue;
        const property = properties.find((x) => x.id === key);
        const labels = [key, property?.name.uk, property?.name.en]
          .filter((x): x is string => !!x)
          .map(norm);
        const label = traits.find(
          (t) =>
            t.entityId === payload.targetId &&
            t.status === "confirmed" &&
            labels.includes(norm(t.label)),
        )?.label;
        if (!label) continue;
        traits.push({
          id: `projection:${p.id}:${key}`,
          projectId,
          entityId: payload.targetId,
          label,
          value: String(value),
          sectionId: evidenceSection,
          storyTimeKey: null,
          status: "confirmed",
          source: "ai",
          supersedes: null,
          appearanceVersionId: null,
          createdBy: "system:continuity-gate",
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }
  const view = new Proxy(repo, {
    get(target, key) {
      if (key === "listContinuityIssues")
        return async (_p: string, filter: any = {}) =>
          rows.filter(
            (x) =>
              (!filter.kind || x.kind === filter.kind) &&
              (!filter.status || x.status === filter.status) &&
              (!filter.entityId || x.entityId === filter.entityId),
          );
      if (key === "upsertContinuityIssue")
        return async (input: ContinuityIssueInput) => {
          const previous = input.id
            ? rows.find((x) => x.id === input.id)
            : undefined;
          const row: ContinuityIssueRow = {
            id: input.id ?? randomUUID(),
            projectId,
            entityId: null,
            evidenceB: null,
            status: "suggested",
            source: "rule",
            checkedHash: null,
            insufficientData: false,
            createdAt: now,
            updatedAt: now,
            ...previous,
            ...input,
          };
          const index = rows.findIndex((x) => x.id === row.id);
          if (index < 0) rows.push(row);
          else rows[index] = row;
          return row;
        };
      if (key === "setContinuityIssueStatus")
        return async (
          _p: string,
          id: string,
          status: ContinuityIssueRow["status"],
        ) => {
          const row = rows.find((x) => x.id === id);
          if (!row)
            throw new CoreRuleError("not_found", "Проблему не знайдено.");
          row.status = status;
          return row;
        };
      if (key === "listEntityTraits")
        return async (_p: string, id?: string) =>
          traits.filter((x) => !id || x.entityId === id);
      if (key === "listRelations")
        return async (_p: string, id?: string) => [
          ...(await target.listRelations(projectId, id)),
          ...(relation &&
          (!id || relation.fromId === id || relation.toId === id)
            ? [relation]
            : []),
        ];
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      if (!/^(get|list|resolve)/.test(String(key)))
        return () => {
          throw new Error(
            `Continuity projection forbids mutation: ${String(key)}`,
          );
        };
      return value.bind(target);
    },
  });
  return { view, rows };
}

export async function evaluateContinuityGate(
  repo: CoreRepository,
  p: StoryProposalRow,
  options: { checks?: unknown; draft?: unknown } = {},
): Promise<ContinuityGateReport> {
  const checks = continuityChecks(options.checks);
  const validation = await validatePayload(repo, {
    projectId: p.projectId,
    kind: p.kind,
    payload: p.payload,
    evidence: p.evidence,
    proposalId: p.id,
  });
  const blockers: GateIssue[] = validation.errors.map((x) => ({
    code: x.code,
    kind: "schema",
    summary: x.message,
  }));
  const warnings: GateIssue[] = validation.warnings.map((x) => ({
    code: x.code,
    kind: "schema",
    summary: x.message,
  }));
  // A malformed proposal must not be projected as a valid world.
  if (validation.ok) {
    const { view, rows } = await projectedWorld(repo, p);
    for (const check of checks) {
      if (check === "time") await refreshTimeContinuity(view, p.projectId);
      else if (check === "age")
        await refreshTraitContradictions(view, p.projectId, {
          label: AGE_TRAIT_LABEL,
          kind: "age",
        });
      else if (check === "knowledge")
        await refreshKnowledgeContinuity(view, p.projectId);
      else if (check === "place")
        await refreshPlaceContinuity(view, p.projectId);
      else if (check === "object")
        await refreshObjectContinuity(view, p.projectId);
      else await refreshCausalityContinuity(view, p.projectId);
    }
    const payload = p.payload;
    const ids = new Set(
      p.kind === "relation"
        ? [
            (payload as RelationProposalPayload).fromId,
            (payload as RelationProposalPayload).toId,
          ]
        : [(payload as EntityProposalPayload).targetId].filter(
            (x): x is string => !!x,
          ),
    );
    const related = (x: ContinuityIssueRow) =>
      !!(x.entityId && ids.has(x.entityId)) ||
      [x.evidenceA, x.evidenceB].some(
        (e) =>
          e &&
          ((e.entityId && ids.has(e.entityId)) ||
            (e.paragraphId && p.evidence.includes(e.paragraphId))),
      );
    for (const row of rows) {
      if (
        !checks.includes(row.kind as ContinuityCheck) ||
        ["dismissed", "resolved"].includes(row.status) ||
        !related(row)
      )
        continue;
      const issue: GateIssue = {
        code: `continuity_${row.kind}`,
        kind: row.kind,
        summary: row.summary,
        entityId: row.entityId,
        evidence: [
          row.evidenceA.paragraphId,
          row.evidenceB?.paragraphId,
        ].filter((x): x is string => !!x),
      };
      if (
        row.status === "needs_review" ||
        row.status === "confirmed" ||
        (row.source === "rule" && !row.insufficientData)
      )
        blockers.push(issue);
      else warnings.push(issue);
    }
    if (checks.includes("knowledge") && options.draft !== undefined) {
      const d = options.draft as DraftGateContext;
      if (
        !d ||
        typeof d.characterId !== "string" ||
        !d.characterId.trim() ||
        typeof d.sectionId !== "string" ||
        !d.sectionId.trim() ||
        typeof d.draftText !== "string" ||
        d.draftText.length > 100000
      )
        throw new CoreRuleError(
          "bad_input",
          "Knowledge Check потребує characterId, sectionId і draftText (до 100000 символів).",
        );
      const result = await checkDraftKnowledge(view, p.projectId, d);
      if ("error" in result)
        blockers.push({
          code: result.error,
          kind: "knowledge",
          summary: "Героя або сцени для перевірки знань немає у книзі.",
        });
      else
        for (const f of result.findings)
          blockers.push({
            code: "draft_knowledge",
            kind: "knowledge",
            entityId: f.entityId,
            summary: `«${result.character.name}» не знає «${f.entityName}» на початку цієї сцени.`,
            evidence: f.learnsAt ? [f.learnsAt.paragraphId] : [],
          });
    }
  }
  return {
    passed: blockers.length === 0,
    proposalId: p.id,
    revision: p.revision,
    checks,
    ontologyVersion: validation.ontologyVersion,
    blockers: blockers.slice(0, 100),
    warnings: warnings.slice(0, 100),
    blockerCount: blockers.length,
    warningCount: warnings.length,
    checkedAt: new Date().toISOString(),
  };
}
export const CONTINUITY_GATE: NodeExecutor = async (node, state, env) => {
  await assertCanonPermission(env);
  const id = state.vars.storyProposalId;
  const proposal =
    typeof id === "string" && env.run.projectId
      ? await env.repo.getStoryProposal(env.run.projectId, id)
      : null;
  if (!proposal)
    throw new CoreRuleError(
      "bad_input",
      "Continuity Gate потребує збереженої пропозиції (PROPOSAL перед шлюзом).",
    );
  const report = await evaluateContinuityGate(env.repo, proposal, {
    checks: node.params.checks,
    draft: state.input.continuityDraft,
  });
  const decision = report.passed ? "pass" : "block";
  return {
    branch: decision,
    patch: {
      vars: { ...state.vars, continuityGate: report },
      result: { proposalId: id, continuity: report },
    },
    trace: {
      decision,
      validationResult: decision,
      warnings: report.warnings.map(x => x.summary),
      details: { continuity: report },
    },
  };
};
