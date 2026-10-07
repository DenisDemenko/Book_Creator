import {collaborationDomainEvents} from './domainEvents';
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { CoreRepository } from "../types";
import type { RealtimeAccessDeps } from "../../realtimeAuth";
import { resolveProjectAccess, type ProjectAccess } from "../projectRoutes";
import {
  BookRevisionConflict,
  getBook,
  patchBookSection,
  type StoredBook,
} from "../../bookStore";
import { canEditSection, SECTION_CONTENT_FIELDS } from "./accessView";
import { canRead, sceneLevel } from "./access";
import { WorkspaceError } from "./workspaceStore";
import {
  changeProposal,
  changeProposals,
  contributionDb,
  contributionEvents,
  contributions,
  createChangeProposal,
  newContribution,
  recordContribution,
  rejectChangeProposal,
  type SceneProposal,
} from "./contributionStore";
export interface ContributionRoutesDeps {
  repo: () => CoreRepository | null;
  access: RealtimeAccessDeps;
  onSaved?: (stored: StoredBook, access: ProjectAccess) => void;
}
export async function contributionIdentity(
  repo: CoreRepository | null,
  projectId: string,
  userId: string,
) {
  const p = await repo?.getParticipant(projectId, userId);
  return {
    participantId: p?.status === "active" ? p.id : null,
    roleIds:
      p?.status === "active"
        ? (
            await repo!.listParticipantRoles({
              participantId: p.id,
              status: "active",
            })
          ).map((r) => r.roleId)
        : [],
  };
}
export function registerContributionRoutes(
  app: Express,
  d: ContributionRoutesDeps,
) {
  const base = "/api/core/projects/:projectId/collaboration";
  const handle =
    (
      fn: (
        req: Request,
        res: Response,
        a: ProjectAccess,
        b: StoredBook,
      ) => Promise<void>,
    ) =>
    async (req: Request, res: Response) => {
      try {
        const a = await resolveProjectAccess(
          req.principal as never,
          String(req.params.projectId),
          d.access,
        );
        if (!a)
          throw new WorkspaceError(
            req.principal && !req.principal.isGuest ? 403 : 401,
            "Немає доступу до книги.",
          );
        const b = await getBook(a.projectId);
        const owner =
          (await d.access.getCollabOwnerId(a.projectId)) ??
          (await d.access.getBookOwnerId(a.projectId));
        if (!b || b.ownerId !== owner)
          throw new WorkspaceError(404, "Серверну книгу не знайдено.");
        contributionDb();
        res.setHeader("Cache-Control", "no-store");
        await fn(req, res, a, b);
      } catch (e) {
        if (e instanceof BookRevisionConflict) {
          res
            .status(409)
            .json({
              error: e.message,
              kind: "revision_conflict",
              current: e.current,
            });
          return;
        }
        const status = e instanceof WorkspaceError ? e.status : 500;
        res
          .status(status)
          .json({
            error:
              status === 500
                ? "Помилка журналу співпраці."
                : (e as Error).message,
          });
      }
    };
  const visible = (
    a: ProjectAccess,
    p: { chapterId: string; sectionId?: string; resourceId?: string },
  ) =>
    canRead(
      sceneLevel(a.effective, p.chapterId, p.sectionId ?? p.resourceId ?? ""),
    );
  app.get(
    `${base}/contributions`,
    handle(async (_req, res, a) => {
      res.json({
        contributions: contributions(a.projectId).filter((c) => visible(a, c)),
        legalAuthorship: false,
        limit: 1000,
      });
    }),
  );
  app.get(
    `${base}/proposals`,
    handle(async (_req, res, a) => {
      res.json({
        proposals: changeProposals(a.projectId).filter((p) => visible(a, p)),
        canApprove: a.isOwner || a.role === "admin",
      });
    }),
  );
  app.post(
    `${base}/proposals`,
    handle(async (req, res, a, b) => {
      const x = req.body ?? {},
        chapterId = String(x.chapterId ?? ""),
        sectionId = String(x.sectionId ?? "");
      if (!canEditSection(a.effective, chapterId, sectionId))
        throw new WorkspaceError(
          403,
          "Немає права пропонувати правки цієї сцени.",
        );
      const section = (b.book.chapters as any[])
        ?.find((c) => c.id === chapterId)
        ?.sections?.find((s: any) => s.id === sectionId);
      if (!section) throw new WorkspaceError(404, "Сцену не знайдено.");
      if (
        !Number.isSafeInteger(x.sourceRevision) ||
        x.sourceRevision !== b.revision
      )
        throw new WorkspaceError(409, "Ревізія змінилася. Оновіть джерело.");
      const patch = x.patch;
      if (
        !patch ||
        typeof patch !== "object" ||
        Array.isArray(patch) ||
        !Object.keys(patch).length ||
        Object.keys(patch).some((k) => !SECTION_CONTENT_FIELDS.includes(k)) ||
        JSON.stringify(patch).length > 200000
      )
        throw new WorkspaceError(
          422,
          "Потрібна правка змісту сцени до 200 KB.",
        );
      for (const key of ["content", "contentEn", "lastModified"])
        if (patch[key] !== undefined && typeof patch[key] !== "string")
          throw new WorkspaceError(422, "Некоректний текст.");
      for (const key of ["wordCount", "characterCount"])
        if (
          patch[key] !== undefined &&
          (!Number.isFinite(patch[key]) || patch[key] < 0)
        )
          throw new WorkspaceError(422, "Некоректний лічильник.");
      for (const key of ["paragraphIds", "paragraphHashes", "footnotes"])
        if (patch[key] !== undefined && !Array.isArray(patch[key]))
          throw new WorkspaceError(422, "Некоректний список.");
      if (
        changeProposals(a.projectId).filter((p) => p.status === "pending")
          .length >= 500
      )
        throw new WorkspaceError(409, "Досягнуто ліміту відкритих пропозицій.");
      const identity = await contributionIdentity(
        d.repo(),
        a.projectId,
        a.userId,
      );
      const p: SceneProposal = {
        id: randomUUID(),
        projectId: a.projectId,
        chapterId,
        sectionId,
        userId: a.userId,
        ...identity,
        sourceRevision: x.sourceRevision,
        patch: structuredClone(patch),
        note: typeof x.note === "string" ? x.note.slice(0, 2000) : "",
        status: "pending",
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        reviewedBy: null,
        resultRevision: null,
      };
      res.status(201).json({ proposal: createChangeProposal(p) });
    }),
  );
  app.post(
    `${base}/proposals/:id/:decision`,
    handle(async (req, res, a) => {
      if (!a.isOwner && a.role !== "admin")
        throw new WorkspaceError(
          403,
          "Пропозиції схвалює власник або адміністратор.",
        );
      const p = changeProposal(a.projectId, String(req.params.id));
      if (!p) throw new WorkspaceError(404, "Пропозицію не знайдено.");
      if (p.status !== "pending")
        throw new WorkspaceError(409, "Пропозиція вже розглянута.");
      if (req.params.decision === "reject") {
        res.json({ proposal: rejectChangeProposal(p, a.userId) });
        return;
      }
      if (req.params.decision !== "merge")
        throw new WorkspaceError(422, "Оберіть merge або reject.");
      // Recheck current rights of the contributor: revoked or expired edit grants cannot be merged.
      const author = await resolveProjectAccess(
        { id: p.userId, role: "writer", isGuest: false } as never,
        a.projectId,
        d.access,
      );
      if (
        !author ||
        !canEditSection(author.effective, p.chapterId, p.sectionId)
      )
        throw new WorkspaceError(403, "Право автора пропозиції відкликано.");
      const saved = await patchBookSection({
        bookId: a.projectId,
        chapterId: p.chapterId,
        sectionId: p.sectionId,
        expectedRevision: p.sourceRevision,
        patch: p.patch,
        onSqlCommit: (s) =>
          recordContribution(
            newContribution({
              projectId: a.projectId,
              participantId: p.participantId,
              userId: p.userId,
              roleIds: p.roleIds,
              actionType: "EDITED",
              resourceType: "scene",
              resourceId: p.sectionId,
              chapterId: p.chapterId,
              sourceRevision: p.sourceRevision,
              resultRevision: s.revision,
              taskId: null,
              deliverableId: null,
              approvedBy: a.userId,
              provenance: { source: "change_proposal", proposalId: p.id },
            }),
            p,
          ),
      });
      d.onSaved?.(saved, a);
      res.json({
        proposal: changeProposal(a.projectId, p.id),
        revision: saved.revision,
      });
    }),
  );
  app.get(
    `${base}/graph`,
    handle(async (_req, res, a) => {
      if (!a.effective.full)
        throw new WorkspaceError(
          403,
          "Граф учасників і доступу доступний лише з повним доступом книги.",
        );
      const repo = d.repo();
      if (!repo) throw new WorkspaceError(503, "Ядро недоступне.");
      const participants = await repo.listParticipants(a.projectId),
        roles = await repo.listParticipantRoles({ projectId: a.projectId }),
        access = await repo.listAccessGrants({ projectId: a.projectId }),
        events = await repo.listCollabEvents(a.projectId, { limit: 500 });
      res.json({
        projectId: a.projectId,
        participants,
        roles,
        access,
        contributions: contributions(a.projectId),
        production: changeProposals(a.projectId).map(({ patch, ...p }) => p),
        events: await collaborationDomainEvents(repo,a.projectId),
      legalAuthorship: false,
        limit: 1000,
      });
    }),
  );
}
