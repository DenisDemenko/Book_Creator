/** Only observed simulation events become subjective simulation memory. */
import type { CoreActor, CoreRepository } from "./types";
import type { MagicEvent, MagicSceneRun } from "./magicSceneTypes";
import type { MagicSceneDeps } from "./magicScene";
import { buildCharacterSnapshot } from "./characterSnapshot";
import { CoreRuleError } from "./rules";
export async function recordSimulationExperience(
  repo: CoreRepository,
  p: string,
  run: MagicSceneRun,
  event: MagicEvent,
  actor: CoreActor,
  studio?: MagicSceneDeps["studio"],
) {
  if (!run.events.some((e) => e.id === event.id))
    throw new CoreRuleError(
      "bad_input",
      "Досвід потребує збереженої події прогону.",
    );
  const memories: string[] = [],
    states: string[] = [];
  for (const characterId of event.audience) {
    if (!run.participants.includes(characterId))
      throw new CoreRuleError("bad_input", "Спостерігач не належить прогону.");
    const dedupeKey = `experience:${run.simulationId}:${event.id}:${characterId}`;
    let memory = (
      await repo.listCharacterMemories(p, {
        characterId,
        simulationId: run.simulationId,
        dedupeKey,
        limit: 1,
      })
    )[0];
    if (!memory) {
      try {
        memory = await repo.addCharacterMemory({
          projectId: p,
          characterId,
          memoryType: "recollection",
          layer: "character_belief",
          content:
            `${event.characterName}: ${event.speech} ${event.actionText}`
              .trim()
              .slice(0, 2000) || "Спостерігав мовчання.",
          aboutEntityIds: [event.characterId],
          truth: "unknown",
          sourceEventKind: "simulation_event",
          sourceEventId: event.id,
          sceneId: run.sceneId,
          simulationId: run.simulationId,
          canonRevision: null,
          visibility: "hidden",
          origin: "simulation",
          status: "suggested",
          dedupeKey,
          createdBy: actor,
        });
      } catch (error) {
        if (
          !["23505", "conflict"].includes(
            (error as { code?: string }).code ?? "",
          )
        )
          throw error;
        memory = (
          await repo.listCharacterMemories(p, {
            characterId,
            simulationId: run.simulationId,
            dedupeKey,
            limit: 1,
          })
        )[0];
        if (!memory) throw error;
      }
    }
    memories.push(memory.id);
    const hero = await repo.getEntity(p, characterId);
    const snapshot = await buildCharacterSnapshot(repo, {
      projectId: p,
      characterId,
      sceneId: run.sceneId,
      asOfChapter: run.asOfChapter,
      simulationId: run.simulationId,
      situation: run.goal,
      allowedActions: ["answer", "ask", "act", "silence", "deflect", "confess"],
      persist: actor,
      studio: hero ? await studio?.(p, hero) : undefined,
    });
    if (snapshot.state) states.push(snapshot.state.id);
  }
  return { memoryIds: memories, stateIds: states };
}
