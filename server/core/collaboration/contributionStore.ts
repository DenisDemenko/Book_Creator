/** Append-only provenance beside the authoritative SQLite book. Not a copyright ruling. */
import { randomUUID } from "node:crypto";
import { getDb } from "../../db";
import { WorkspaceError } from "./workspaceStore";
export interface Contribution {
  id: string;
  projectId: string;
  participantId: string | null;
  userId: string;
  roleIds: string[];
  actionType:
    | "EDITED"
    | "WROTE"
    | "TRANSLATED"
    | "CREATED"
    | "DESIGNED"
    | "ILLUSTRATED";
  resourceType: "scene";
  resourceId: string;
  chapterId: string;
  sourceRevision: number;
  resultRevision: number;
  taskId: string | null;
  deliverableId: string | null;
  timestamp: string;
  approvalStatus: "approved";
  approvedBy: string;
  provenance: {
    source: "source_patch" | "change_proposal";
    proposalId?: string;
  };
}
export interface SceneProposal {
  id: string;
  projectId: string;
  chapterId: string;
  sectionId: string;
  userId: string;
  participantId: string | null;
  roleIds: string[];
  sourceRevision: number;
  patch: Record<string, unknown>;
  note: string;
  status: "pending" | "rejected" | "merged";
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  resultRevision: number | null;
}
export interface ContributionEvent {
  id: string;
  projectId: string;
  type:
    | "CHANGE_PROPOSED"
    | "CHANGE_REJECTED"
    | "CHANGE_APPROVED"
    | "CONTRIBUTION_RECORDED";
  resourceId: string;
  proposalId: string | null;
  actor: string;
  timestamp: string;
  contributionId?: string;
}
const initialized = new WeakSet<object>();
export function contributionDb() {
  const db = getDb();
  if (!db)
    throw new WorkspaceError(
      503,
      "Для внесків і пропозицій потрібне SQLite-сховище серверної книги.",
    );
  if (!initialized.has(db)) {
    db.exec(`CREATE TABLE IF NOT EXISTS collaboration_contributions(project_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,id));
 CREATE TABLE IF NOT EXISTS collaboration_change_proposals(project_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,id TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,id));
 CREATE TABLE IF NOT EXISTS collaboration_domain_events(project_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,id));`);
    initialized.add(db);
  }
  return db;
}
export function contributions(projectId: string): Contribution[] {
  return contributionDb()
    .prepare(
      "SELECT payload FROM collaboration_contributions WHERE project_id=? ORDER BY rowid DESC LIMIT 1000",
    )
    .all(projectId)
    .map((x: any) => JSON.parse(x.payload));
}
export function changeProposals(projectId: string): SceneProposal[] {
  return contributionDb()
    .prepare(
      "SELECT payload FROM collaboration_change_proposals WHERE project_id=? ORDER BY rowid DESC LIMIT 1000",
    )
    .all(projectId)
    .map((x: any) => JSON.parse(x.payload));
}
export function contributionEvents(projectId: string): ContributionEvent[] {
  return contributionDb()
    .prepare(
      "SELECT payload FROM collaboration_domain_events WHERE project_id=? ORDER BY rowid DESC LIMIT 1000",
    )
    .all(projectId)
    .map((x: any) => JSON.parse(x.payload));
}
export function changeProposal(
  projectId: string,
  id: string,
): SceneProposal | null {
  const row = contributionDb()
    .prepare(
      "SELECT payload FROM collaboration_change_proposals WHERE project_id=? AND id=?",
    )
    .get(projectId, id) as any;
  return row ? JSON.parse(row.payload) : null;
}
function event(
  projectId: string,
  type: ContributionEvent["type"],
  resourceId: string,
  actor: string,
  proposalId: string | null,
  contributionId?: string,
) {
  const e: ContributionEvent = {
    id: randomUUID(),
    projectId,
    type,
    resourceId,
    actor,
    proposalId,
    timestamp: new Date().toISOString(),
    ...(contributionId ? { contributionId } : {}),
  };
  contributionDb()
    .prepare("INSERT INTO collaboration_domain_events VALUES(?,?,?)")
    .run(projectId, e.id, JSON.stringify(e));
}
export function createChangeProposal(p: SceneProposal) {
  const db = contributionDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO collaboration_change_proposals VALUES(?,?,?,?)",
    ).run(p.projectId, p.id, p.status, JSON.stringify(p));
    event(p.projectId, "CHANGE_PROPOSED", p.sectionId, p.userId, p.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return p;
}
function updatePending(p: SceneProposal) {
  const result = contributionDb()
    .prepare(
      "UPDATE collaboration_change_proposals SET status=?,payload=? WHERE project_id=? AND id=? AND status='pending'",
    )
    .run(p.status, JSON.stringify(p), p.projectId, p.id) as { changes: number };
  if (Number(result.changes) !== 1)
    throw new WorkspaceError(409, "Пропозиція вже розглянута.");
}
export function rejectChangeProposal(p: SceneProposal, reviewer: string) {
  const db = contributionDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const next = {
      ...p,
      status: "rejected" as const,
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewer,
    };
    updatePending(next);
    event(p.projectId, "CHANGE_REJECTED", p.sectionId, reviewer, p.id);
    db.exec("COMMIT");
    return next;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
/** Called only inside the book write transaction: book, proposal, contribution and events commit together. */
export function recordContribution(c: Contribution, proposal?: SceneProposal) {
  const db = contributionDb();
  if (proposal) {
    updatePending({
      ...proposal,
      status: "merged",
      reviewedBy: c.approvedBy,
      reviewedAt: c.timestamp,
      resultRevision: c.resultRevision,
    });
    event(
      c.projectId,
      "CHANGE_APPROVED",
      c.resourceId,
      c.approvedBy,
      proposal.id,
    );
  }
  db.prepare("INSERT INTO collaboration_contributions VALUES(?,?,?)").run(
    c.projectId,
    c.id,
    JSON.stringify(c),
  );
  event(
    c.projectId,
    "CONTRIBUTION_RECORDED",
    c.resourceId,
    c.userId,
    proposal?.id ?? null,
    c.id,
  );
}
export function newContribution(
  input: Omit<Contribution, "id" | "timestamp" | "approvalStatus">,
): Contribution {
  return {
    ...input,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    approvalStatus: "approved",
  };
}
