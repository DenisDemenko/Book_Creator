import { randomUUID } from "node:crypto";
import type { CoreRepository } from "../types";
import type { RealtimeAccessDeps } from "../../realtimeAuth";
import type { Principal } from "../../auth";
import { getBook } from "../../bookStore";
import { resolveProjectAccess } from "../projectRoutes";
import { restrictBook } from "./accessView";
import { canRead, sceneLevel, visibleCharacterRefs } from "./access";
import { contributions, contributionDb } from "./contributionStore";
import {
  workItems,
  saveWorkItem,
  WorkspaceError,
  type WorkTarget,
  type WorkItem,
} from "./workspaceStore";
import { collaborationTargetLevel } from "./workspaceRoutes";
export const COLLAB_QUERY_OPERATIONS = [
  "FIND_PARTICIPANT",
  "FIND_SPECIALIST",
  "GET_PROJECT_ROLES",
  "GET_ACCESS_SCOPE",
  "GET_CONTRIBUTIONS",
  "GET_OPEN_TASKS",
  "GET_DELIVERABLES",
  "GET_AVAILABLE_CONTEXT",
] as const;
export interface CollaborationAiDeps {
  repo: () => CoreRepository | null;
  access: RealtimeAccessDeps;
  principal: (userId: string) => Promise<Principal | null>;
}
export async function collaborationScope(
  d: CollaborationAiDeps,
  userId: string,
  projectId: string,
) {
  const principal = await d.principal(userId);
  if (!principal || principal.isGuest)
    throw new WorkspaceError(403, "Обліковий запис недоступний.");
  const a = await resolveProjectAccess(principal, projectId, d.access);
  if (!a) throw new WorkspaceError(403, "Немає доступу до книги.");
  const repo = d.repo(),
    b = await getBook(projectId),
    owner =
      (await d.access.getCollabOwnerId(projectId)) ??
      (await d.access.getBookOwnerId(projectId));
  if (!repo) throw new WorkspaceError(503, "Ядро недоступне.");
  if (!b || b.ownerId !== owner)
    throw new WorkspaceError(404, "Книга не знайдена.");
  return { a, b, repo };
}
export async function queryCollaboration(
  d: CollaborationAiDeps,
  userId: string,
  projectId: string,
  operation: string,
  args: Record<string, unknown> = {},
) {
  if (!(COLLAB_QUERY_OPERATIONS as readonly string[]).includes(operation))
    throw new WorkspaceError(422, "Невідома операція співпраці.");
  if(operation==='GET_DELIVERABLES'){
    const {readableCreativeDeliverables}=await import('../creative/workspace');
    return {deliverables:await readableCreativeDeliverables(d,userId,projectId),available:true,limit:200};
  }
  const { a, b, repo } = await collaborationScope(d, userId, projectId);
  switch (operation) {
    case "FIND_PARTICIPANT":
    case "FIND_SPECIALIST":
    case "GET_PROJECT_ROLES": {
      const people = (await repo.listParticipants(projectId)).filter(
        (p) =>
          p.status === "active" && (a.effective.full || p.userId === userId),
      );
      const roles = await repo.listParticipantRoles({
        projectId,
        status: "active",
      });
      const rows = people
        .map((p) => ({
          participantId: p.id,
          userId: p.userId,
          roles: roles
            .filter((r) => r.participantId === p.id)
            .map((r) => ({
              roleId: r.roleId,
              specialization: r.specialization,
            })),
        }))
        .filter(
          (p) => typeof args.userId !== "string" || p.userId === args.userId,
        )
        .filter(
          (p) =>
            operation !== "FIND_SPECIALIST" ||
            (typeof args.roleId === "string" &&
              p.roles.some(
                (r) =>
                  r.roleId === args.roleId || r.specialization === args.roleId,
              )),
        );
      return {
        participants: rows.slice(0, 100),
        limit: 100,
        availability: "active_membership_only",
        assignAutomatically: false,
      };
    }
    case "GET_ACCESS_SCOPE":
      return { projectId, userId, effective: a.effective };
    case "GET_CONTRIBUTIONS":
      return {
        contributions: contributions(projectId).filter((c) =>
          canRead(sceneLevel(a.effective, c.chapterId, c.resourceId)),
        ),
        legalAuthorship: false,
      };
    case "GET_OPEN_TASKS": {
      const tasks = [];
      for (const i of workItems(projectId))
        if (
          i.kind === "task" &&
          i.status === "open" &&
          (await collaborationTargetLevel(i.target, a, b, repo)) > 0
        )
          tasks.push(i);
      return { tasks: tasks.slice(0, 200), limit: 200 };
    }
    case "GET_AVAILABLE_CONTEXT": {
      const filtered = restrictBook(
        b.book,
        a.effective,
        await visibleCharacterRefs(repo, a.effective),
      );
      // Only manuscript and authorized character cards, never arbitrary owner book metadata or vault payloads.
      return {
        revision: b.revision,
        context: {
          id: b.id,
          title: filtered.title,
          chapters: filtered.chapters ?? [],
          characters: filtered.characters ?? [],
        },
        scope: a.effective.full ? "book" : "restricted",
      };
    }
  }
}
export interface TaskSuggestion {
  id: string;
  projectId: string;
  authorId: string;
  target: WorkTarget;
  title: string;
  candidateId: string | null;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  taskId: string | null;
}
const initialized = new WeakSet<object>();
function suggestionDb() {
  const db = contributionDb();
  if (!initialized.has(db)) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS collaboration_task_suggestions(project_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,id TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,id));",
    );
    initialized.add(db);
  }
  return db;
}
export function taskSuggestions(projectId: string): TaskSuggestion[] {
  return suggestionDb()
    .prepare(
      "SELECT payload FROM collaboration_task_suggestions WHERE project_id=? ORDER BY rowid DESC LIMIT 500",
    )
    .all(projectId)
    .map((r: any) => JSON.parse(r.payload));
}
export async function proposeCollaborationTask(
  d: CollaborationAiDeps,
  userId: string,
  projectId: string,
  input: Record<string, unknown>,
) {
  const { a, b, repo } = await collaborationScope(d, userId, projectId),
    target = input.target as WorkTarget;
  if (!target || (await collaborationTargetLevel(target, a, b, repo)) < 2)
    throw new WorkspaceError(
      403,
      "Немає права пропонувати завдання для цієї цілі.",
    );
  if (
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 4000
  )
    throw new WorkspaceError(422, "Потрібна назва завдання до 4000 символів.");
  const candidateId =
    typeof input.candidateId === "string" ? input.candidateId : null;
  if (candidateId) {
    const p = await repo.getParticipant(projectId, candidateId);
    if (
      !p ||
      p.status !== "active" ||
      (!a.effective.full && candidateId !== userId)
    )
      throw new WorkspaceError(403, "Кандидат недоступний.");
  }
  const p: TaskSuggestion = {
    id: randomUUID(),
    projectId,
    authorId: userId,
    target: structuredClone(target),
    title: input.title.trim(),
    candidateId,
    reason: typeof input.reason === "string" ? input.reason.slice(0, 2000) : "",
    status: "pending",
    createdAt: new Date().toISOString(),
    reviewedBy: null,
    reviewedAt: null,
    taskId: null,
  };
  const db = suggestionDb();
  const pending = db
    .prepare(
      "SELECT count(*) n FROM collaboration_task_suggestions WHERE project_id=? AND status='pending'",
    )
    .get(projectId) as any;
  if (pending.n >= 500)
    throw new WorkspaceError(409, "Досягнуто ліміту пропозицій.");
  db.prepare("INSERT INTO collaboration_task_suggestions VALUES(?,?,?,?)").run(
    projectId,
    p.id,
    p.status,
    JSON.stringify(p),
  );
  return p;
}
export async function reviewCollaborationTask(
  d: CollaborationAiDeps,
  userId: string,
  projectId: string,
  id: string,
  decision: string,
  assigneeId?: string,
) {
  const { a, b, repo } = await collaborationScope(d, userId, projectId);
  if (!a.isOwner && a.role !== "admin")
    throw new WorkspaceError(
      403,
      "Завдання підтверджує власник або адміністратор.",
    );
  const db = suggestionDb(),
    row = db
      .prepare(
        "SELECT payload FROM collaboration_task_suggestions WHERE project_id=? AND id=?",
      )
      .get(projectId, id) as any;
  if (!row) throw new WorkspaceError(404, "Пропозицію не знайдено.");
  const p: TaskSuggestion = JSON.parse(row.payload);
  if (p.status !== "pending")
    throw new WorkspaceError(409, "Пропозицію вже розглянуто.");
  if (!["accept", "reject"].includes(decision))
    throw new WorkspaceError(422, "Оберіть accept або reject.");
  const at = new Date().toISOString(),
    next = {
      ...p,
      status:
        decision === "accept" ? ("accepted" as const) : ("rejected" as const),
      reviewedBy: userId,
      reviewedAt: at,
    };
  const update = () => {
    const result = db
      .prepare(
        "UPDATE collaboration_task_suggestions SET status=?,payload=? WHERE project_id=? AND id=? AND status='pending'",
      )
      .run(next.status, JSON.stringify(next), projectId, id) as {
      changes: number;
    };
    if (Number(result.changes) !== 1)
      throw new WorkspaceError(409, "Пропозицію вже розглянуто.");
  };
  if (decision === "reject") {
    update();
    return next;
  }
  const author = await collaborationScope(d, p.authorId, projectId);
  if ((await collaborationTargetLevel(p.target, author.a, b, repo)) < 2)
    throw new WorkspaceError(403, "Доступ автора пропозиції відкликано.");
  if (!assigneeId)
    throw new WorkspaceError(422, "Людина має явно обрати виконавця.");
  const candidate = await collaborationScope(d, assigneeId, projectId);
  if (
    assigneeId !== b.ownerId &&
    (await repo.getParticipant(projectId, assigneeId))?.status !== "active"
  )
    throw new WorkspaceError(403, "Виконавець неактивний.");
  if (!(await collaborationTargetLevel(p.target, candidate.a, b, repo)))
    throw new WorkspaceError(403, "Виконавцю недоступна ціль.");
  const item: WorkItem = {
    id: randomUUID(),
    kind: "task",
    target: p.target,
    text: p.title,
    authorId: userId,
    assigneeId,
    dueAt: null,
    status: "open",
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  next.taskId = item.id;
  saveWorkItem(
    projectId,
    item,
    null,
    [assigneeId].filter((id) => id !== userId),
    update,
  );
  return next;
}
