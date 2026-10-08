import type { Express, Request, Response } from "express";
import type { CollaborationAiDeps } from "../collaboration/aiCollaboration";
import { collaborationScope } from "../collaboration/aiCollaboration";
import { WorkspaceError } from "../collaboration/workspaceStore";
import { creativeProjectDb, type CreativeProject } from "./projects";
export interface OrderSelection {
  orderId: string;
  externalId: string;
  version: number;
  status: string;
  specialist: { firebaseUid: string; name: string } | null;
}
interface BindingDeps extends CollaborationAiDeps {
  fetchSelection: (req: Request, orderId: string) => Promise<OrderSelection>;
  specialistUser: (
    firebaseUid: string,
  ) => Promise<{ id: string; disabled?: boolean } | undefined>;
}
function project(id: string): CreativeProject {
  const row = creativeProjectDb()
    .prepare("SELECT payload FROM creative_projects WHERE id=?")
    .get(id) as { payload: string } | undefined;
  if (!row) throw new WorkspaceError(404, "Творчий проєкт не знайдено.");
  return JSON.parse(row.payload);
}
async function owned(d: BindingDeps, user: string, id: string) {
  const p = project(id),
    ctx = await collaborationScope(d, user, p.bookId);
  if (p.ownerId !== user || !ctx.a.isOwner || ctx.b.ownerId !== user)
    throw new WorkspaceError(
      403,
      "Синхронізувати замовлення може власник книги.",
    );
  return p;
}
export function registerCreativeOrderBindingRoutes(
  app: Express,
  d: BindingDeps,
) {
  app.post(
    "/api/creative/projects/:id/order-sync",
    async (q: Request, r: Response) => {
      r.set("Cache-Control", "no-store");
      try {
        if (!q.principal?.id || q.principal.isGuest)
          throw new WorkspaceError(401, "Увійдіть у систему.");
        if (q.body?.confirmed !== true)
          throw new WorkspaceError(422, "Підтвердьте синхронізацію вибору.");
        const id = String(q.params.id),
          user = q.principal.id;
        const first = await owned(d, user, id);
        if (!first.orderId)
          throw new WorkspaceError(
            422,
            "Спершу надішліть підтверджений бриф у Marketplace.",
          );
        let remote: OrderSelection;
        try {
          remote = await d.fetchSelection(q, first.orderId);
        } catch {
          throw new WorkspaceError(
            502,
            "Marketplace не відповів. Проєкт не змінено.",
          );
        }
        if (
          remote.orderId !== first.orderId ||
          remote.externalId !== id ||
          !Number.isInteger(remote.version) ||
          remote.version < 1 ||
          ![
            "MODERATION",
            "OPEN",
            "SPECIALIST_SELECTED",
            "IN_PROGRESS",
            "REVIEW",
            "COMPLETED",
            "CANCELLED",
            "ARCHIVED",
          ].includes(remote.status)
        )
          throw new WorkspaceError(502, "Невідповідне замовлення Marketplace.");
        if (
          remote.status === "SPECIALIST_SELECTED" &&
          (!remote.specialist?.firebaseUid ||
            typeof remote.specialist.name !== "string")
        )
          throw new WorkspaceError(
            502,
            "Marketplace не повернув обраного фахівця.",
          );
        const local = remote.specialist
          ? await d.specialistUser(remote.specialist.firebaseUid)
          : undefined;
        if (local?.disabled)
          throw new WorkspaceError(403, "Обліковий запис фахівця вимкнено.");
        const current = await owned(d, user, id);
        if (
          current.orderId !== remote.orderId ||
          (current.marketplaceVersion ?? 0) > remote.version
        )
          throw new WorkspaceError(
            409,
            "Замовлення вже змінилося. Повторіть синхронізацію.",
          );
        const uid = remote.specialist?.firebaseUid ?? null;
        if (
          current.marketplaceVersion === remote.version &&
          (current.specialistFirebaseUid ?? null) !== uid
        )
          throw new WorkspaceError(
            409,
            "Вибір фахівця суперечить збереженій версії.",
          );
        const updated: CreativeProject = {
          ...current,
          marketplaceVersion: remote.version,
          status: remote.status as CreativeProject["status"],
          specialistId: local?.id ?? null,
          specialistFirebaseUid: uid,
          specialistName: remote.specialist?.name ?? null,
        };
        const result = creativeProjectDb()
          .prepare(
            "UPDATE creative_projects SET payload=? WHERE id=? AND payload=?",
          )
          .run(JSON.stringify(updated), id, JSON.stringify(current)) as {
          changes: number;
        };
        if (result.changes !== 1)
          throw new WorkspaceError(409, "Проєкт змінився. Повторіть дію.");
        r.json({
          project: updated,
          waitingForStudioLogin: !!uid && !local,
          accessGranted: false,
        });
      } catch (e) {
        r.status(e instanceof WorkspaceError ? e.status : 500).json({
          error:
            e instanceof WorkspaceError
              ? e.message
              : "Не вдалося синхронізувати творчий проєкт.",
        });
      }
    },
  );
}
