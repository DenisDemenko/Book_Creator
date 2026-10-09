import { analyzeLabyrinth } from "../../../shared/labyrinthDesign";
import type { Express, Request, Response } from "express";
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
  d: { access: RealtimeAccessDeps; store: () => PgLabyrinthStore | null },
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
      const b = body(q, ["mapRevision", "seed"]);
      r.status(201).json(
        await s.createRun(
          p,
          String(q.params.mapId),
          revisionNumber(b.mapRevision),
          a,
          b.seed,
        ),
      );
    }),
  );
  app.get(
    `${base}/runs/:runId`,
    handle(async (q, r, s, p) => {
      r.json(await s.getRun(p, String(q.params.runId)));
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
}
