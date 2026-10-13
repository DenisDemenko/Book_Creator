import type {
  LabyrinthDefinition,
  LabyrinthRunState,
  LabyrinthEventTemplate,
} from "./labyrinth";
export function eventPhase(
  d: LabyrinthDefinition,
  s: LabyrinthRunState,
  eventId: string,
): "ready" | "warning" | "active" | "cooldown" {
  const scheduled = s.engine?.events.find((e) => e.eventId === eventId);
  const event = d.events.find((e) => e.id === eventId);
  if (!scheduled || !event) return "ready";
  if (scheduled.resolvedAt !== undefined && s.storyTime >= scheduled.resolvedAt)
    return s.storyTime < scheduled.resolvedAt + event.cooldown
      ? "cooldown"
      : "ready";
  const elapsed = s.storyTime - scheduled.startedAt;
  return elapsed < event.preparation
    ? "warning"
    : elapsed < event.preparation + event.duration
      ? "active"
      : elapsed < event.preparation + event.duration + event.cooldown
        ? "cooldown"
        : "ready";
}
export function effectiveObjects(d: LabyrinthDefinition, s: LabyrinthRunState) {
  const objects = { ...s.objects };
  for (const event of d.events)
    if (eventPhase(d, s, event.id) === "active")
      for (const effect of event.effects)
        objects[effect.objectId] = effect.state;
  return objects;
}
export function hazardCosts(
  event: LabyrinthEventTemplate,
  startedAt: number,
  time: number,
) {
  const age = Math.max(0, time - startedAt - event.preparation);
  const growth = event.hazard?.growthPerTick ?? {};
  const base = event.hazard?.resourceCosts ?? {};
  return Object.fromEntries(
    [...new Set([...Object.keys(base), ...Object.keys(growth)])].map((key) => [
      key,
      (base[key] ?? 0) + age * (growth[key] ?? 0),
    ]),
  );
}
