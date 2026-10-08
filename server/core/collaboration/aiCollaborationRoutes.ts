import type { Express, Request, Response } from "express";
import {
  queryCollaboration,
  proposeCollaborationTask,
  reviewCollaborationTask,
  taskSuggestions,
  collaborationScope,
  type CollaborationAiDeps,
} from "./aiCollaboration";
import { WorkspaceError } from "./workspaceStore";
import { collaborationTargetLevel } from "./workspaceRoutes";
export function registerCollaborationAiRoutes(
  app: Express,
  d: CollaborationAiDeps,
) {
  const base = "/api/core/projects/:projectId/collaboration/ai";
  const handle =
    (
      fn: (
        req: Request,
        res: Response,
        user: string,
        project: string,
      ) => Promise<void>,
    ) =>
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");
      try {
        if (!req.principal?.id || req.principal.isGuest)
          throw new WorkspaceError(401, "Увійдіть у систему.");
        await fn(req, res, req.principal.id, String(req.params.projectId));
      } catch (e) {
        res.status(e instanceof WorkspaceError ? e.status : 500).json({
          error:
            e instanceof WorkspaceError ? e.message : "Помилка співпраці ШІ.",
        });
      }
    };
  app.post(
    `${base}/query`,
    handle(async (req, res, user, project) => {
      res.json(
        await queryCollaboration(
          d,
          user,
          project,
          String(req.body?.operation),
          req.body?.args ?? {},
        ),
      );
    }),
  );
  app.post(
    `${base}/suggestions`,
    handle(async (req, res, user, project) => {
      res.status(201).json({
        suggestion: await proposeCollaborationTask(
          d,
          user,
          project,
          req.body ?? {},
        ),
      });
    }),
  );
  app.get(
    `${base}/suggestions`,
    handle(async (_req, res, user, project) => {
      const { a, b, repo } = await collaborationScope(d, user, project),
        rows = [];
      for (const p of taskSuggestions(project))
        if (
          (p.authorId === user || a.isOwner || a.role === "admin") &&
          (await collaborationTargetLevel(p.target, a, b, repo)) > 0
        )
          rows.push(p);
      res.json({
        suggestions: rows,
        canReview: a.isOwner || a.role === "admin",
      });
    }),
  );
  app.post(
    `${base}/suggestions/:id/:decision`,
    handle(async (req, res, user, project) => {
      res.json({
        suggestion: await reviewCollaborationTask(
          d,
          user,
          project,
          String(req.params.id),
          String(req.params.decision),
          req.body?.assigneeId,
        ),
      });
    }),
  );
}
