import type { CoreActor, CoreRepository } from "./types";
import { getMagic, stepMagic, type MagicSceneDeps } from "./magicScene";
import { recordSimulationExperience } from "./simulationExperience";
import { scheduleScene } from "./sceneScheduler";
import { CoreRuleError } from "./rules";
import { JobCancelledError, JobFatalError } from "./jobs/queue";
export interface CharacterSimulationReport {
  mode: "simulation";
  status: "completed" | "awaiting_author";
  simulationId: string;
  sceneId: string;
  characterId: string | null;
  eventId: string | null;
  turn: number;
  action: string | null;
  source: string;
  decisionId: string | null;
  scores: Record<string, number>;
  checks: Record<string, number>;
  memoryIds: string[];
  stateIds: string[];
  canonChanged: false;
  revision: number;
}
export async function characterSimulationTurn(
  d: MagicSceneDeps,
  p: string,
  input: Record<string, unknown>,
  actor: CoreActor,
  signal?: AbortSignal,
): Promise<CharacterSimulationReport> {
  const check = () => {
    if (signal?.aborted) throw new JobCancelledError();
  };
  if (
    input.mode !== "simulation" ||
    !actor.startsWith("user:") ||
    typeof input.simulationId !== "string"
  )
    throw new CoreRuleError(
      "bad_input",
      "Лише авторський Simulation Mode з simulationId.",
    );
  return scheduleScene(p, async () => {
    check();
    const before = await getMagic(d.repo, p, input.simulationId as string);
    const authorize = async () => {
      const characterId =
        before.participants[before.events.length % before.participants.length];
      if (
        d.authorizeTools &&
        !(await d.authorizeTools({
          projectId: p,
          actorId: actor,
          characterId,
          sceneId: before.sceneId,
          simulationId: before.simulationId,
        }))
      )
        throw new CoreRuleError("bad_actor", "Доступ до симуляції відкликано.");
    };
    await authorize();
    // Repair a partially saved experience before the next model sees its own run.
    for (const event of before.events) {
      check();
      await recordSimulationExperience(
        d.repo,
        p,
        before,
        event,
        actor,
        d.studio,
      );
    }
    const guarded = {
      ...d,
      voice: async (context: Record<string, unknown>) => {
        check();
        const out = await d.voice(context);
        check();
        await authorize();
        return out;
      },
    };
    const run = await stepMagic(guarded, p, before.simulationId, input, actor);
    check();
    const request = run.requests.find(
      (r) => r.id === input.requestId && r.operation === "step",
    );
    const event = request?.eventId
      ? run.events.find((e) => e.id === request.eventId)
      : undefined;
    const base: CharacterSimulationReport = {
      mode: "simulation",
      status: event ? "completed" : "awaiting_author",
      simulationId: run.simulationId,
      sceneId: run.sceneId,
      characterId: event?.characterId ?? null,
      eventId: event?.id ?? null,
      turn: event?.turn ?? run.events.length + 1,
      action: event?.action ?? null,
      source: "unknown",
      decisionId: null,
      scores: {},
      checks: {},
      memoryIds: [],
      stateIds: [],
      canonChanged: false,
      revision: run.revision,
    };
    if (!event) {
      if (run.status !== "paused")
        throw new CoreRuleError(
          "conflict",
          "Старий запит не має прив’язки до події. Почніть новий хід.",
        );
      return base;
    }
    const privateStep = run.privateSteps.find((s) => s.eventId === event.id);
    const decision = privateStep?.decision;
    base.source = [
      "jev",
      "mock",
      "llm_fallback",
      "author",
      "sealed-private-choice",
    ].includes(String(decision?.source))
      ? String(decision!.source)
      : "unknown";
    if (typeof decision?.decisionId === "string") {
      const row = await d.repo.getCharacterDecision(p, decision.decisionId);
      if (
        row?.simulationId === run.simulationId &&
        row.characterId === event.characterId
      ) {
        base.decisionId = row.id;
        const result = row.result as any;
        const numbers = (v: any) =>
          Object.fromEntries(
            Object.entries(v ?? {}).filter(
              ([key, n]) =>
                [
                  "style_fit",
                  "fear",
                  "trust",
                  "risk",
                  "motive_conflict",
                  "check_1",
                  "check_2",
                  "check_3",
                  "check_4",
                ].includes(key) &&
                typeof n === "number" &&
                Number.isFinite(n),
            ),
          ) as Record<string, number>;
        base.scores = numbers(result?.scores);
        base.checks = numbers(result?.checks);
      }
    }
    const experience = await recordSimulationExperience(
      d.repo,
      p,
      run,
      event,
      actor,
      d.studio,
    );
    base.memoryIds = experience.memoryIds;
    base.stateIds = experience.stateIds;
    return base;
  });
}
export function simulationFailure(error: unknown): never {
  if (error instanceof JobFatalError)
    throw new JobFatalError("Бюджет симуляції вичерпано.");
  if (error instanceof JobCancelledError) throw new JobCancelledError();
  if (error instanceof CoreRuleError) throw error;
  throw new CoreRuleError(
    "conflict",
    "Симуляцію не завершено. Приватний вміст не журналюється.",
  );
}
