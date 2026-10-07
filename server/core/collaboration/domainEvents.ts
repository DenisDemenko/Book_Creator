import type { CoreRepository } from "../types";
import { contributionEvents } from "./contributionStore";
/** Metadata only. Payloads/secret context never travel with domain event dispatch. */
export const COLLABORATION_DOMAIN_EVENTS = [
  "PARTICIPANT_JOINED",
  "ROLE_ASSIGNED",
  "ROLE_REVOKED",
  "ACCESS_GRANTED",
  "ACCESS_REVOKED",
  "CHANGE_PROPOSED",
  "CHANGE_REJECTED",
  "CHANGE_APPROVED",
  "CONTRIBUTION_RECORDED",
  "CANON_CHANGE_PROPOSED",
  "CANON_CHANGE_APPROVED",
] as const;
export async function collaborationDomainEvents(
  repo: CoreRepository,
  projectId: string,
) {
  const mapping: Record<string, string> = {
    participant_added: "PARTICIPANT_JOINED",
    role_assigned: "ROLE_ASSIGNED",
    role_revoked: "ROLE_REVOKED",
    access_granted: "ACCESS_GRANTED",
    access_revoked: "ACCESS_REVOKED",
  };
  const core = (await repo.listCollabEvents(projectId, { limit: 500 }))
    .filter((e) => mapping[e.action])
    .map((e) => ({
      id: e.id,
      type: mapping[e.action],
      actor: e.actor,
      timestamp: e.createdAt,
      projectId,
    }));
  const local = contributionEvents(projectId).map((e) => ({
    id: e.id,
    type: e.type,
    actor: `user:${e.actor}`,
    timestamp: e.timestamp,
    projectId,
  }));
  const canon = [];
  for (const p of await repo.listStoryProposals(projectId, { limit: 200 })) {
    for (const e of await repo.listStoryProposalEvents(projectId, {
      proposalId: p.id,
      limit: 100,
    })) {
      if (e.action !== "create" && e.action !== "approve") continue;
      canon.push({
        id: `story:${e.id}`,
        type:
          e.action === "create"
            ? "CANON_CHANGE_PROPOSED"
            : "CANON_CHANGE_APPROVED",
        actor: e.actor,
        timestamp: e.createdAt,
        projectId,
      });
    }
  }
  return [...core, ...local, ...canon]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 1000);
}
