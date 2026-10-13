import type { Express, Request, Response } from "express";
import type { RealtimeAccessDeps } from "../../realtimeAuth";
import { canRead } from "../collaboration/access";
import { resolveProjectAccess } from "../projectRoutes";
import { LabyrinthError } from "./model";
import type { PgLabyrinthStore } from "./store";

const body = (q: Request, keys: string[]) => {
  const b = q.body;
  if (!b || typeof b !== "object" || Array.isArray(b) ||
    Object.keys(b).length !== keys.length || Object.keys(b).some((k) => !keys.includes(k)))
    throw new LabyrinthError(422, "Некоректні поля запиту.");
  return b;
};
export function registerLabyrinthReaderRoutes(app: Express, d: {
  access: RealtimeAccessDeps; store: () => PgLabyrinthStore | null;
  refreshPrincipal?: (q: Request) => Promise<void>;
}) {
  const base = "/api/core/projects/:projectId/labyrinth";
  const check = async (q: Request, author: boolean) => {
    if (!q.principal?.id || q.principal.isGuest) throw new LabyrinthError(401, "Увійдіть у систему.");
    await d.refreshPrincipal?.(q);
    if (!q.principal?.id || q.principal.isGuest || (q.principal as any).disabled)
      throw new LabyrinthError(401, "Увійдіть у систему.");
    const a = await resolveProjectAccess(q.principal, String(q.params.projectId), d.access);
    if (!a || (author ? !a.isOwner && a.role !== "admin" : !canRead(a.effective.book)))
      throw new LabyrinthError(403, author ? "Відкривати версію може лише власник книги або адміністратор." :
        "Для читання лабіринта потрібен доступ до перегляду всієї книги.");
    return a;
  };
  const handle = (author: boolean, fn: (q: Request, r: Response, s: NonNullable<ReturnType<typeof d.store>>["reader"],
    p: string, userId: string, recheck: () => Promise<void>) => Promise<void>) =>
    async (q: Request, r: Response) => {
      r.set("Cache-Control", "no-store");
      try {
        const a = await check(q, author);
        const s = d.store()?.reader;
        if (!s) throw new LabyrinthError(503, "Ядро лабіринта недоступне. Потрібен PostgreSQL ядра.");
        await fn(q, r, s, a.projectId, a.userId, async () => { await check(q, author); });
      } catch (e) {
        if (e instanceof LabyrinthError) { r.status(e.status).json({ error: e.message }); return; }
        if ((e as any)?.code === "40001" || (e as any)?.code === "40P01") {
          r.status(409).json({ error: "Стан уже змінився. Оновіть сторінку й повторіть дію." }); return;
        }
        console.error("[labyrinth-reader]", e);
        r.status(500).json({ error: "Не вдалося відкрити або змінити проходження." });
      }
    };
  app.get(base + "/maps/:mapId/reader-publication", handle(true, async (q,r,s,p) => {
    r.json(await s.publication(p, String(q.params.mapId)));
  }));
  app.post(base + "/maps/:mapId/reader-publication", handle(true, async (q,r,s,p,userId,recheck) => {
    const b = body(q, ["expectedRevision","mapRevision","heroIds"]);
    r.status(201).json(await s.publish(p, String(q.params.mapId), b.expectedRevision, b.mapRevision, b.heroIds, "user:" + userId, recheck));
  }));
  app.post(base + "/maps/:mapId/reader-withdraw", handle(true, async (q,r,s,p,_u,recheck) => {
    const b = body(q, ["expectedRevision"]);
    r.json(await s.withdraw(p, String(q.params.mapId), b.expectedRevision, recheck));
  }));
  app.get(base + "/reader/library", handle(false, async (q,r,s,p,userId,recheck) => {
    if (Object.keys(q.query).length) throw new LabyrinthError(422, "Некоректні параметри бібліотеки.");
    const view = await s.library(p, userId); await recheck(); r.json(view);
  }));
  app.post(base + "/reader/maps/:mapId/start", handle(false, async (q,r,s,p,userId,recheck) => {
    const b = body(q, ["publicationRevision","heroId","key"]);
    r.status(201).json(await s.start(p, String(q.params.mapId), b.publicationRevision, b.heroId, userId, b.key, recheck));
  }));
  app.get(base + "/reader/sessions/:runId", handle(false, async (q,r,s,p,userId,recheck) => {
    if (Object.keys(q.query).length) throw new LabyrinthError(422, "Некоректні параметри проходження.");
    const view = await s.get(p, String(q.params.runId), userId); await recheck(); r.json(view);
  }));
  app.post(base + "/reader/sessions/:runId/actions", handle(false, async (q,r,s,p,userId,recheck) => {
    const b = body(q, ["expectedRevision","action","key"]);
    r.json(await s.action(p, String(q.params.runId), b.expectedRevision, b.action, userId, b.key, recheck));
  }));
  app.post(base + "/reader/sessions/:runId/restore", handle(false, async (q,r,s,p,userId,recheck) => {
    const b = body(q, ["expectedRevision","sourceRevision","key"]);
    r.status(201).json(await s.restore(p, String(q.params.runId), b.expectedRevision, b.sourceRevision, userId, b.key, recheck));
  }));
}
