/** T7.1: project shell only. It never grants access or publishes a brief. */
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { contributionDb } from "../collaboration/contributionStore";
import {
  collaborationScope,
  type CollaborationAiDeps,
} from "../collaboration/aiCollaboration";
import { WorkspaceError } from "../collaboration/workspaceStore";
export interface CreativeProject {
  id: string;
  orderId: string | null;
  ownerId: string;
  specialistId: null;
  sourceProjectId: string;
  bookId: string;
  title: string;
  status: "DRAFT";
  startedAt: null;
  completedAt: null;
  createdAt: string;
}
export function creativeProjectDb() {
  const db = contributionDb();
  db.exec(
    `CREATE TABLE IF NOT EXISTS creative_projects(id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, owner_id TEXT NOT NULL, payload TEXT NOT NULL);`,
  );
  return db;
}
export function listCreativeProjects(
  bookId: string,
  ownerId: string,
): CreativeProject[] {
  return creativeProjectDb()
    .prepare(
      "SELECT payload FROM creative_projects WHERE book_id=? AND owner_id=? ORDER BY rowid DESC",
    )
    .all(bookId, ownerId)
    .map((r: any) => JSON.parse(r.payload));
}
export async function createCreativeProject(
  d: CollaborationAiDeps,
  userId: string,
  bookId: string,
  input: unknown,
) {
  const { a, b } = await collaborationScope(d, userId, bookId);
  if (!a.isOwner || b.ownerId !== userId)
    throw new WorkspaceError(403, "Творчий проєкт створює власник книги.");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new WorkspaceError(422, "Вкажіть назву проєкту.");
  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).some((k) => k !== "title") ||
    typeof body.title !== "string" ||
    body.title.trim().length < 2 ||
    body.title.trim().length > 160
  )
    throw new WorkspaceError(
      422,
      "Назва має містити 2–160 символів. Інші поля ще не підтримуються.",
    );
  const project: CreativeProject = {
    id: randomUUID(),
    orderId: null,
    ownerId: userId,
    specialistId: null,
    sourceProjectId: bookId,
    bookId,
    title: body.title.trim(),
    status: "DRAFT",
    startedAt: null,
    completedAt: null,
    createdAt: new Date().toISOString(),
  };
  creativeProjectDb()
    .prepare(
      "INSERT INTO creative_projects(id,book_id,owner_id,payload) VALUES(?,?,?,?)",
    )
    .run(project.id, bookId, userId, JSON.stringify(project));
  return project;
}
export function registerCreativeProjectRoutes(
  app: Express,
  d: CollaborationAiDeps,
) {
  const base = "/api/core/projects/:projectId/creative-projects";
  const handle =
    (
      fn: (
        req: Request,
        res: Response,
        user: string,
        book: string,
      ) => Promise<void>,
    ) =>
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");
      try {
        if (!req.principal?.id || req.principal.isGuest)
          throw new WorkspaceError(401, "Увійдіть у систему.");
        await fn(req, res, req.principal.id, String(req.params.projectId));
      } catch (e) {
        res
          .status(e instanceof WorkspaceError ? e.status : 500)
          .json({
            error:
              e instanceof WorkspaceError
                ? e.message
                : "Не вдалося відкрити творчі проєкти.",
          });
      }
    };
  app.get(
    base,
    handle(async (_req, res, user, book) => {
      const { a, b } = await collaborationScope(d, user, book);
      if (!a.isOwner || b.ownerId !== user)
        throw new WorkspaceError(
          403,
          "Творчі проєкти доступні власнику книги.",
        );
      res.json({ projects: listCreativeProjects(book, user) });
    }),
  );
  app.post(
    base,
    handle(async (req, res, user, book) => {
      res
        .status(201)
        .json({
          project: await createCreativeProject(d, user, book, req.body),
        });
    }),
  );
}
