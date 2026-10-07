import { CoreRuleError } from "../../rules";
import type { ExecEnv } from "./types";
export async function assertCanonPermission(env: ExecEnv, reviewer?: string) {
  const id = env.run.projectId;
  if (!id || !env.actor.startsWith("user:"))
    throw new CoreRuleError(
      "bad_actor",
      "Канон підтверджує авторизована людина.",
    );
  const allowed = env.services.canWriteCanon
    ? await env.services.canWriteCanon(env.actor, id, reviewer)
    : (await env.repo.getProject(id))?.ownerId === env.actor.slice(5);
  if (!allowed)
    throw new CoreRuleError(
      "bad_actor",
      "Потрібен доступ CANON_WRITE до цієї книги.",
    );
}
