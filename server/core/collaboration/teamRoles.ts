import { CoreRuleError } from "../rules";
import type { Express, Request } from "express";
import type { ParticipantRoutesDeps } from "./routes";
import { resolveProjectAccess } from "../projectRoutes";
import {
  activeCollabOntology,
  roleById,
} from "../../../src/utils/collabOntology";
import {
  definitionHash,
  activeCollabRegistryVersion,
} from "../ontology/lifecycle";
import { assignRole } from "./participants";
export function teamRoleRegistry() {
  const d = activeCollabOntology();
  return {
    version: `${activeCollabRegistryVersion() ?? d.id}:${definitionHash(d as unknown as Record<string, unknown>)}`,
    roles: d.roles.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      projectTypes: r.projectTypes,
      requiresSpecialization: r.requiresSpecialization,
      specializations: r.specializations,
      combinable: r.combinable,
      singleHolder: r.singleHolder,
    })),
  };
}
export interface TeamRoleSnapshot {
  teamId: string;
  revision: number;
  members: Array<{
    id: string;
    firebaseUid: string;
    name: string;
    roles: Array<{
      id: string;
      roleId: string;
      specialization: string | null;
      registryVersion: string;
    }>;
  }>;
}
interface Deps extends ParticipantRoutesDeps {
  identity: (
    req: Request,
  ) => Promise<{ firebaseUid: string; disabled?: boolean } | null>;
  fetchTeam: (req: Request, teamId: string) => Promise<TeamRoleSnapshot>;
  findUser: (
    firebaseUid: string,
  ) => Promise<{ id: string; disabled?: boolean } | undefined>;
}
export function registerTeamRoleRoutes(app: Express, d: Deps) {
  // Public schema only: no members, book identifiers, capabilities or AI prompts.
  app.get("/api/collaboration/team-role-registry", (_q, r) => {
    r.set("Cache-Control", "no-store");
    r.json(teamRoleRegistry());
  });
  const base = "/api/core/projects/:projectId/team-roles";
  const busy = new Set<string>();
  for (const op of ["preview", "import"] as const)
    app.post(`${base}/${op}`, async (q, r) => {
      r.set("Cache-Control", "no-store");
      let locked = false;
      const projectId = String(q.params.projectId);
      const fail = (status: number, error: string) => {
        r.status(status).json({ error });
      };
      try {
        const access = await resolveProjectAccess(
          q.principal,
          projectId,
          d.access,
        );
        if (!access || !access.isOwner)
          return fail(
            q.principal && !q.principal.isGuest ? 403 : 401,
            "Підтверджує лише власник книги.",
          );
        const identity = await d.identity(q);
        if (!identity || identity.disabled)
          return fail(403, "Потрібен активний Firebase-акаунт власника.");
        const repo = d.repo();
        if (!repo) return fail(503, "Ядро недоступне.");
        const project = await repo.getProject(projectId);
        if (!project || project.projectType !== "book")
          return fail(422, "Цей імпорт підтримує лише збережену книгу.");
        const b = q.body || {};
        const allowed =
          op === "preview"
            ? ["teamId"]
            : [
                "teamId",
                "memberId",
                "assignmentId",
                "expectedRevision",
                "registryVersion",
                "confirmed",
              ];
        if (
          !b ||
          typeof b !== "object" ||
          Array.isArray(b) ||
          Object.keys(b).some((k) => !allowed.includes(k))
        )
          return fail(422, "Некоректні поля запиту.");
        if (
          typeof b.teamId !== "string" ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(b.teamId)
        )
          return fail(422, "Некоректний ID команди.");
        if (op === "import") {
          if (b.confirmed !== true)
            return fail(422, "Підтвердьте призначення ролі в цій книзі.");
          if (busy.has(projectId))
            return fail(409, "Попереднє призначення ще виконується.");
          busy.add(projectId);
          locked = true;
        }
        const remote = await d.fetchTeam(q, b.teamId);
        if (
          remote.teamId !== b.teamId ||
          !Number.isInteger(remote.revision) ||
          remote.revision < 0 ||
          !Array.isArray(remote.members)
        )
          return fail(502, "Невідповідний snapshot команди.");
        const registry = teamRoleRegistry();
        if (op === "preview") {
          r.json({
            team: remote,
            registryVersion: registry.version,
            notice: "Ролі команди не надають доступу до книги.",
          });
          return;
        }
        if (
          b.expectedRevision !== remote.revision ||
          b.registryVersion !== registry.version
        )
          return fail(409, "Команда або реєстр змінилися. Оновіть перегляд.");
        const member = remote.members.find((m) => m.id === b.memberId),
          role = member?.roles.find((a) => a.id === b.assignmentId);
        if (!member || !role || role.registryVersion !== registry.version)
          return fail(
            409,
            "Призначення відкликане або реєстр змінився. Перепризначте роль команди.",
          );
        if (role.roleId === "project_owner")
          return fail(422, "Власність книги не імпортується з команди.");
        const def = roleById(role.roleId);
        if (
          !def ||
          def.status !== "active" ||
          !def.projectTypes.includes("book")
        )
          return fail(422, "Ця роль не застосовується до книги.");
        const target = await d.findUser(member.firebaseUid);
        if (!target || target.disabled)
          return fail(
            422,
            "Учасник має спочатку увійти в Studio активним акаунтом.",
          );
        // Recheck both authorities after remote IO; book permissions are never granted here.
        const latest = await resolveProjectAccess(
            q.principal,
            projectId,
            d.access,
          ),
          freshIdentity = await d.identity(q);
        if (
          !latest?.isOwner ||
          !freshIdentity ||
          freshIdentity.disabled ||
          freshIdentity.firebaseUid !== identity.firebaseUid
        )
          return fail(403, "Повноваження змінилися.");
        const current = await d.fetchTeam(q, b.teamId);
        if (current.revision !== remote.revision)
          return fail(409, "Команду вже змінили. Повторіть перегляд.");
        if (teamRoleRegistry().version !== registry.version)
          return fail(409, "Реєстр змінився під час перевірки.");
        const freshTarget = await d.findUser(member.firebaseUid);
        if (
          !freshTarget ||
          freshTarget.disabled ||
          freshTarget.id !== target.id
        )
          return fail(403, "Акаунт учасника змінився.");
        const saved = await assignRole(repo, {
          projectId,
          userId: target.id,
          roleId: role.roleId,
          specialization: role.specialization,
          projectType: "book",
          actor: `user:${access.userId}`,
          source: "manual",
          sourceRef: `steam:${b.teamId}:${role.id}`,
        });
        await repo.addCollabEvent({
          projectId,
          participantId: saved.participant.id,
          action: "role_assigned",
          actor: `user:${access.userId}`,
          details: {
            source: "steam_team",
            teamId: b.teamId,
            memberId: member.id,
            teamAssignmentId: role.id,
            teamRevision: remote.revision,
            assignmentId: saved.role.id,
            registryVersion: registry.version,
            permissionsGranted: false,
          },
        });
        r.json({
          role: saved.role,
          permissionsGranted: false,
          notice:
            "Роль призначено. Доступ до тексту надайте окремо у «Доступ і ролі».",
        });
      } catch (e) {
        const err = e as any;
        fail(
          err.code === "conflict"
            ? 409
            : err.code === "bad_actor"
              ? 403
              : err.code === "bad_input"
                ? 422
                : 502,
          err instanceof CoreRuleError
            ? err.message
            : "Не вдалося отримати або застосувати підтверджені ролі команди.",
        );
      } finally {
        if (locked) busy.delete(projectId);
      }
    });
}
