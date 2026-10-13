import type {
  LabyrinthDefinition as World,
  LabyrinthRunState as State,
  RuntimeAction,
} from "../../../shared/labyrinth";
import {
  initialState,
  LabyrinthError,
  structuralAction,
  stateHash,
} from "./model";
const reject = (message: string): never => {
  throw new LabyrinthError(409, message);
};
export {
  eventPhase,
  effectiveObjects,
} from "../../../shared/labyrinthEventState";
import {
  eventPhase,
  effectiveObjects,
  hazardCosts,
} from "../../../shared/labyrinthEventState";
function resolveEvents(d: World, s: State) {
  for (const scheduled of s.engine!.events) {
    const e = d.events.find((e) => e.id === scheduled.eventId)!;
    if (
      scheduled.resolvedAt === undefined &&
      ["warning", "active"].includes(eventPhase(d, s, e.id)) &&
      e.resolution?.conditions.every((c) => s.objects[c.objectId] === c.state)
    )
      scheduled.resolvedAt = s.storyTime;
  }
}
function compatible(d: World, s: State) {
  const effects = new Map<string, string>();
  for (const scheduled of s.engine!.events) {
    const e = d.events.find((e) => e.id === scheduled.eventId)!;
    const start = scheduled.startedAt + e.preparation,
      end = scheduled.resolvedAt ?? start + e.duration;
    for (const other of s.engine!.events) {
      const o = d.events.find((e) => e.id === other.eventId)!;
      const os = other.startedAt + o.preparation,
        oe = other.resolvedAt ?? os + o.duration;
      if (
        Math.max(start, os) < Math.min(end, oe) &&
        e.effects.some((a) =>
          o.effects.some(
            (b) => a.objectId === b.objectId && a.state !== b.state,
          ),
        )
      )
        reject("Несумісні заплановані небезпеки.");
    }
    if (eventPhase(d, s, e.id) === "active")
      for (const effect of e.effects) {
        if (
          effects.has(effect.objectId) &&
          effects.get(effect.objectId) !== effect.state
        )
          reject("Несумісні ефекти.");
        effects.set(effect.objectId, effect.state);
      }
  }
}
/** Arrival occurs before damage at the arrival tick; the origin is occupied during all earlier ticks. */
export function simulateRuntime(d: World, state: State, action: RuntimeAction, group = false): State {
  const next = structuredClone(state);
  if (action.kind === "start_event") {
    const e = d.events.find((e) => e.id === action.eventId);
    if (!e) throw new LabyrinthError(422, "Невідома подія.");
    if (eventPhase(d, next, e.id) !== "ready")
      reject("Попередження, небезпека або перезаряджання ще тривають.");
    const objects = effectiveObjects(d, next);
    if (!e.conditions.every((c) => objects[c.objectId] === c.state))
      reject("Умови події не виконано.");
    next.engine!.events = next.engine!.events.filter((x) => x.eventId !== e.id);
    next.engine!.events.push({ eventId: e.id, startedAt: next.storyTime });
    next.turn++;
    resolveEvents(d, next);
    compatible(d, next);
    return next;
  }
  const hero = next.heroes[action.heroId];
  if (!Object.hasOwn(next.heroes, action.heroId))
    throw new LabyrinthError(422, "Невідомий герой.");
  const origin = hero.nodeId;
  let duration = 1;
  let destination = origin;
  if (action.kind !== "wait") {
    const effective = { ...next, objects: effectiveObjects(d, next) };
    if (action.kind === "move") {
      const edge = d.edges.find((e) => e.id === action.edgeId);
      if (!edge) throw new LabyrinthError(422, "Невідомий перехід.");
      if (
        !edge.requiredItems?.every((item) => hero.inventory.includes(item)) &&
        edge.requiredItems?.length
      )
        reject("Потрібен предмет для переходу.");
      duration = edge.duration;
    }
    const result = structuralAction(d, effective, action).state;
    destination = result.heroes[action.heroId].nodeId;
    next.heroes[action.heroId] = result.heroes[action.heroId];
    // Event overlays never become permanent mechanism state.
    if (action.kind === "interact") {
      const o = d.objects.find((o) => o.id === action.objectId)!;
      const transition = o.transitions.find(
        (t) => t.from === effective.objects[o.id] && t.to === action.to,
      )!;
      next.objects[o.id] = action.to;
      for (const effect of transition.effects)
        next.objects[effect.objectId] = effect.state;
      const c = transition.consequences,
        h = next.heroes[action.heroId];
      if (c) {
        if (!c.inventoryRemove.every((item) => h.inventory.includes(item)))
          reject("Відсутній предмет для наслідку.");
        for (const [key, delta] of Object.entries(c.resourceDelta)) {
          const value = (h.resources[key] ?? 0) + delta;
          if (value < 0 || value > 1000000 || (key === "health" && value === 0))
            reject("Наслідок виходить за межі ресурсів.");
          h.resources[key] = value;
        }
        h.inventory = [
          ...new Set([
            ...h.inventory.filter((x) => !c.inventoryRemove.includes(x)),
            ...c.inventoryAdd,
          ]),
        ];
        h.knowledge = [...new Set([...h.knowledge, ...c.knowledgeAdd])];
      }
    }
  }
  resolveEvents(d, next);
  const h = next.heroes[action.heroId];
  if (h.resources.health === 0) reject("Дія виснажує здоров’я героя.");
  h.nodeId = origin;
  for (let tick = 1; tick <= duration; tick++) {
    next.storyTime++;
    if (tick === duration) h.nodeId = destination;
    // A gate must remain traversable throughout transit, not only at departure.
    if (action.kind === "move") {
      const edge = d.edges.find((e) => e.id === action.edgeId)!;
      const objects = effectiveObjects(d, next);
      if (!edge.conditions.every((c) => objects[c.objectId] === c.state))
        reject("Маршрут перекривається до завершення переходу.");
    }
    const occupants = group ? d.heroes.map((hero) => next.heroes[hero.id]) : [h];
    for (const occupant of occupants) {
      if (group && d.exitNodeIds.includes(occupant.nodeId)) continue;
    for (const e of d.events)
      if (
        eventPhase(d, next, e.id) === "active" &&
        e.nodeIds.includes(occupant.nodeId)
      ) {
        if (
          e.hazard?.blocksMovement &&
          destination !== origin &&
          occupant === h && occupant.nodeId === destination
        )
          reject("Вхід у небезпечну зону заблокований.");
        for (const [key, cost] of Object.entries(
          hazardCosts(
            e,
            next.engine!.events.find((s) => s.eventId === e.id)!.startedAt,
            next.storyTime,
          ),
        )) {
          const value = (occupant.resources[key] ?? 0) - cost;
          if (value < 0 || (key === "health" && value === 0))
            reject("Небезпека виснажує ресурси до порятунку.");
          occupant.resources[key] = value;
        }
      }
    }
  }
  next.turn++;
  return next;
}
/** Bounded proof search. Unknown/budget exhaustion fails closed; never a claim of safety. */
export function proveExit(
  d: World,
  state: State,
  budget = 10000,
): { actions: RuntimeAction[]; arrivalTime: number } {
  const heroId = d.heroes[0].id;
  const queue: Array<{ state: State; path: RuntimeAction[] }> = [
    { state, path: [] },
  ];
  const seen = new Set<string>();
  let cursor = 0,
    work = 0;
  const horizon = Math.max(
    state.storyTime,
    ...(state.engine?.events ?? []).map((s) => {
      const e = d.events.find((e) => e.id === s.eventId)!;
      return s.resolvedAt ?? s.startedAt + e.preparation + e.duration;
    }),
  );
  while (cursor < queue.length && work++ < budget) {
    const current = queue[cursor++],
      s = current.state,
      h = s.heroes[heroId];
    if (d.exitNodeIds.includes(h.nodeId))
      return { actions: current.path, arrivalTime: s.storyTime };
    const key = stateHash({
      ...s,
      turn: 0,
      storyTime: Math.min(s.storyTime, horizon),
    });
    if (seen.has(key)) continue;
    seen.add(key);
    const actions: RuntimeAction[] = d.edges
      .filter(
        (e) => e.from === h.nodeId || (e.bidirectional && e.to === h.nodeId),
      )
      .map((e) => ({ kind: "move", heroId, edgeId: e.id }));
    for (const o of d.objects.filter((o) => o.nodeId === h.nodeId))
      for (const t of o.transitions)
        actions.push({ kind: "interact", heroId, objectId: o.id, to: t.to });
    if (s.storyTime < horizon) actions.push({ kind: "wait", heroId });
    for (const action of actions) {
      work +=
        (action.kind === "move"
          ? d.edges.find((e) => e.id === action.edgeId)!.duration
          : 1) *
        (d.events.length + 1);
      if (work > budget) break;
      try {
        queue.push({
          state: simulateRuntime(d, s, action),
          path: [...current.path, action],
        });
      } catch (e) {
        if (!(e instanceof LabyrinthError)) throw e;
      }
    }
  }
  reject(
    work >= budget
      ? "Безпеку не доведено в межах бюджету перевірки."
      : "Немає досяжного виходу з урахуванням часу, ресурсів і небезпек.",
  );
}
export function runtimeInitialState(d: World) {
  if (d.heroes.length !== 1)
    throw new LabyrinthError(
      422,
      "Безпечний прогін поки підтримує одного героя; груповий режим — Т9.7.",
    );
  const state = initialState(d);
  if (d.heroes[0].resources.health === 0)
    reject("Герой не може почати прогін без здоров’я.");
  state.engine = { version: 1, events: [] };
  if (d.director?.enabled)
    state.engine.director = {
      decisions: 0,
      modelCalls: 0,
      lastDecisionTime: null,
      recentMoves: [],
    };
  proveExit(d, state);
  return state;
}
export function runtimeAction(d: World, s: State, input: unknown) {
  if (!s.engine || d.heroes.length !== 1)
    throw new LabyrinthError(409, "Потрібен безпечний прогін одного героя.");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new LabyrinthError(422, "Потрібна дія.");
  const r = input as Record<string, unknown>;
  const keys =
    r.kind === "start_event"
      ? ["kind", "eventId"]
      : r.kind === "wait"
        ? ["kind", "heroId"]
        : r.kind === "move"
          ? ["kind", "heroId", "edgeId"]
          : r.kind === "interact"
            ? ["kind", "heroId", "objectId", "to"]
            : [];
  if (
    !keys.length ||
    Object.keys(r).length !== keys.length ||
    keys.some(
      (k) => typeof r[k] !== "string" || !r[k] || String(r[k]).length > 128,
    ) ||
    Object.keys(r).some((k) => !keys.includes(k))
  )
    throw new LabyrinthError(422, "Некоректні поля дії.");
  const action = r as RuntimeAction,
    state = simulateRuntime(d, s, action),
    proof = proveExit(d, state);
  if (action.kind === "move" && state.engine?.director)
    state.engine.director.recentMoves = [
      ...state.engine.director.recentMoves,
      {
        from: s.heroes[action.heroId].nodeId,
        to: state.heroes[action.heroId].nodeId,
        edgeId: action.edgeId,
      },
    ].slice(-8);
  return { action, state, proof };
}
