import type { DirectorServices } from "./director";
import { headings, type Heading } from "../../../shared/labyrinthNarration";
import { analyzeLabyrinth } from "../../../shared/labyrinthDesign";
import type { Express, Request, Response, RequestHandler } from "express";
import type { RealtimeAccessDeps } from "../../realtimeAuth";
import { resolveProjectAccess } from "../projectRoutes";
import { LabyrinthError } from "./model";
import { PgLabyrinthStore, revisionNumber } from "./store";
const body = (req: Request, keys: string[]) => {
  const b = req.body;
  if (
    !b ||
    typeof b !== "object" ||
    Array.isArray(b) ||
    Object.keys(b).some((k) => !keys.includes(k))
  )
    throw new LabyrinthError(422, "Некоректні поля запиту.");
  return b;
};
export function registerLabyrinthRoutes(
  app: Express,
  d: {
    access: RealtimeAccessDeps;
    store: () => PgLabyrinthStore | null;
    aiGuard?: RequestHandler;
    directorServices?: (
      req: Request,
      projectId: string,
      actor: string,
    ) => DirectorServices;
    recheckAi?: (req: Request) => Promise<void>;
    refreshPrincipal?: (req: Request) => Promise<void>;
  },
) {
  const base = "/api/core/projects/:projectId/labyrinth";
  const handle =
    (
      fn: (
        req: Request,
        res: Response,
        s: PgLabyrinthStore,
        p: string,
        actor: string,
      ) => Promise<void>,
    ) =>
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");
      try {
        if (
          !req.principal?.id ||
          req.principal.isGuest ||
          (req.principal as any).disabled
        )
          throw new LabyrinthError(401, "Увійдіть у систему.");
        const projectId = String(req.params.projectId),
          a = await resolveProjectAccess(req.principal, projectId, d.access);
        // Full definitions contain hidden nodes and planned events. Participant views are T9.6–T9.7.
        if (!a || (!a.isOwner && a.role !== "admin"))
          throw new LabyrinthError(
            403,
            "Модель лабіринта доступна лише власнику книги або адміністратору.",
          );
        const s = d.store();
        if (!s)
          throw new LabyrinthError(
            503,
            "Ядро лабіринта недоступне. Потрібен PostgreSQL ядра.",
          );
        await fn(req, res, s, projectId, `user:${a.userId}`);
      } catch (e) {
        if (e instanceof LabyrinthError) {
          res.status(e.status).json({ error: e.message });
          return;
        }
        console.error("[labyrinth]", e);
        res
          .status(500)
          .json({ error: "Не вдалося виконати дію з лабіринтом." });
      }
    };
  app.post(
    `${base}/validate`,
    handle(async (q, r, s, p) => {
      const b = body(q, ["definition"]);
      const definition = await s.validateDesign(p, b.definition);
      r.json({ issues: analyzeLabyrinth(definition), scope: "static_design" });
    }),
  );
  app.get(
    `${base}/maps`,
    handle(async (_q, r, s, p) => {
      r.json({
        maps: await s.listMaps(p),
        mode: "author_structural_preview",
        readerAvailable: false,
      });
    }),
  );
  app.post(
    `${base}/maps`,
    handle(async (q, r, s, p, a) => {
      const b = body(q, ["definition", "expectedRevision"]);
      r.status(201).json(
        await s.saveVersion(
          p,
          a,
          b.definition,
          revisionNumber(b.expectedRevision),
        ),
      );
    }),
  );
  app.get(
    `${base}/maps/:mapId/versions`,
    handle(async (q, r, s, p) => {
      r.json({ versions: await s.listVersions(p, String(q.params.mapId)) });
    }),
  );
  app.get(
    `${base}/maps/:mapId/versions/:revision`,
    handle(async (q, r, s, p) => {
      r.json(
        await s.getVersion(
          p,
          String(q.params.mapId),
          revisionNumber(Number(q.params.revision)),
        ),
      );
    }),
  );
  app.post(
    `${base}/maps/:mapId/versions`,
    handle(async (q, r, s, p, a) => {
      const b = body(q, ["definition", "expectedRevision"]);
      r.status(201).json(
        await s.saveVersion(
          p,
          a,
          b.definition,
          revisionNumber(b.expectedRevision),
          String(q.params.mapId),
        ),
      );
    }),
  );
  app.post(
    `${base}/maps/:mapId/runs`,
    handle(async (q, r, s, p, a) => {
      const b = body(q, ["mapRevision", "seed", "mode"]);
      r.status(201).json(
        await s.createRun(
          p,
          String(q.params.mapId),
          revisionNumber(b.mapRevision),
          a,
          b.seed,
          b.mode,
        ),
      );
    }),
  );
  app.get(
    `${base}/maps/:mapId/runs`,
    handle(async (q, r, s, p) => {
      if (
        Object.keys(q.query).some((k) => k !== "mapRevision") ||
        typeof q.query.mapRevision !== "string"
      )
        throw new LabyrinthError(422, "Вкажіть версію карти.");
      r.json({
        runs: await s.listRuns(
          p,
          String(q.params.mapId),
          revisionNumber(Number(q.query.mapRevision)),
        ),
      });
    }),
  );
  app.get(
    `${base}/runs/:runId`,
    handle(async (q, r, s, p) => {
      r.json(await s.getRun(p, String(q.params.runId)));
    }),
  );
  app.get(
    `${base}/runs/:runId/view`,
    handle(async (q, r, s, p) => {
      if (
        Object.keys(q.query).some((k) => !["heroId", "heading"].includes(k)) ||
        typeof q.query.heroId !== "string" ||
        (q.query.heading !== undefined &&
          !headings.includes(q.query.heading as Heading))
      )
        throw new LabyrinthError(422, "Виберіть героя й напрямок погляду.");
      r.json(
        await s.routeView(
          p,
          String(q.params.runId),
          q.query.heroId,
          q.query.heading as Heading | undefined,
        ),
      );
    }),
  );
  app.get(
    `${base}/runs/:runId/events`,
    handle(async (q, r, s, p) => {
      r.json({
        events: await s.getEvents(
          p,
          String(q.params.runId),
          q.query.after === undefined ? -1 : Number(q.query.after),
        ),
      });
    }),
  );
  app.post(
    `${base}/runs/:runId/structural-actions`,
    handle(async (q, r, s, p, a) => {
      const b = body(q, ["expectedRevision", "action"]);
      r.json(
        await s.structuralStep(
          p,
          String(q.params.runId),
          revisionNumber(b.expectedRevision),
          a,
          b.action,
        ),
      );
    }),
  );
  app.post(
    `${base}/runs/:runId/runtime-actions`,
    handle(async (q, r, s, p, a) => {
      const b = body(q, ["expectedRevision", "action", "key"]);
      r.json(
        await s.runtimeStep(
          p,
          String(q.params.runId),
          revisionNumber(b.expectedRevision),
          a,
          b.action,
          b.key,
        ),
      );
    }),
  );
  app.post(
    `${base}/runs/:runId/restore`,
    handle(async (q, r, s, p, a) => {
      const b = body(q, ["expectedRevision", "sourceRevision"]);
      r.status(201).json(
        await s.restoreRun(
          p,
          String(q.params.runId),
          revisionNumber(b.expectedRevision),
          revisionNumber(b.sourceRevision),
          a,
        ),
      );
    }),
  );
  app.post(
    `${base}/runs/:runId/director-actions`,
    (req, res, next) => {
      if (req.body?.useAI !== true) return next();
      if (!d.aiGuard) {
        res.status(503).json({
          error: "ШІ-директор не налаштовано; використайте режим без ШІ.",
        });
        return;
      }
      d.aiGuard(req, res, next);
    },
    handle(async (q, r, s, p, a) => {
      const b = body(q, ["expectedRevision", "key", "useAI"]);
      if (typeof b.useAI !== "boolean")
        throw new LabyrinthError(422, "Виберіть режим директора.");
      await d.refreshPrincipal?.(q);
      if (b.useAI) await d.recheckAi?.(q);
      const currentAccess = await resolveProjectAccess(
        q.principal,
        p,
        d.access,
      );
      if (
        !currentAccess ||
        (!currentAccess.isOwner && currentAccess.role !== "admin")
      )
        throw new LabyrinthError(403, "Доступ до книги відкликано.");
      r.json(
        await s.directorStep(
          p,
          String(q.params.runId),
          revisionNumber(b.expectedRevision),
          a,
          b.useAI,
          b.key,
          b.useAI ? d.directorServices?.(q, p, a) : {},
          async () => {
            await d.refreshPrincipal?.(q);
            if (b.useAI) await d.recheckAi?.(q);
            const latest = await resolveProjectAccess(q.principal, p, d.access);
            if (!latest || (!latest.isOwner && latest.role !== "admin"))
              throw new LabyrinthError(403, "Доступ до книги відкликано.");
          },
        ),
      );
    }),
  );
}
