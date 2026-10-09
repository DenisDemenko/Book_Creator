import type { LabyrinthDefinition, ObjectCondition } from "./labyrinth";
export interface DesignIssue {
  code: string;
  targetId: string;
  message: string;
}
/** Static author checks, not a proof of resource/timing safety (T9.3).
 * Checks directed topology, initial gates and individual mechanisms/events.
 * No traversal through other hazard nodes while escaping an event. */
export function analyzeLabyrinth(d: LabyrinthDefinition): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const states = Object.fromEntries(
    d.objects.map((o) => [o.id, o.initialState]),
  );
  const adjacency = new Map<
    string,
    Array<{ to: string; conditions: ObjectCondition[] }>
  >();
  for (const n of d.nodes) adjacency.set(n.id, []);
  for (const e of d.edges) {
    adjacency.get(e.from)?.push({ to: e.to, conditions: e.conditions });
    if (e.bidirectional)
      adjacency.get(e.to)?.push({ to: e.from, conditions: e.conditions });
  }
  const reach = (
    start: string,
    state?: Record<string, string>,
    hazard = new Set<string>(),
  ) => {
    const seen = new Set([start]),
      queue = [start];
    for (let i = 0; i < queue.length; i++) {
      for (const e of adjacency.get(queue[i]) ?? []) {
        if (state && e.conditions.some((c) => state[c.objectId] !== c.state))
          continue;
        const next = e.to;
        if (next && !seen.has(next) && !hazard.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  const add = (code: string, targetId: string, message: string) =>
    issues.push({ code, targetId, message });
  for (const hero of d.heroes) {
    const possible = reach(hero.startNodeId),
      initial = reach(hero.startNodeId, states);
    for (const exit of d.exitNodeIds)
      if (!possible.has(exit))
        add(
          "unreachable_exit",
          exit,
          `Вихід «${d.nodes.find((n) => n.id === exit)?.title}» недосяжний для «${hero.name}» навіть без обмежень механізмів.`,
        );
    if (!d.exitNodeIds.some((id) => initial.has(id)))
      add(
        "initial_exit_blocked",
        hero.id,
        `«${hero.name}»: у початкових станах усі виходи заблоковані. Перевірте доступність перемикача.`,
      );
  }
  const changed = (
    effects: ObjectCondition[],
    conditions: ObjectCondition[] = [],
  ) =>
    Object.assign(
      {},
      states,
      Object.fromEntries(conditions.map((c) => [c.objectId, c.state])),
      Object.fromEntries(effects.map((c) => [c.objectId, c.state])),
    );
  for (const object of d.objects)
    for (const t of object.transitions) {
      const state = changed(
        [{ objectId: object.id, state: t.to }, ...t.effects],
        t.conditions,
      );
      const reachable = reach(object.nodeId, state);
      if (!d.exitNodeIds.some((id) => reachable.has(id)))
        add(
          "mechanism_no_exit",
          object.id,
          `«${object.id}»: після ${t.from} → ${t.to} немає шляху до виходу без зміни інших механізмів.`,
        );
    }
  for (const event of d.events) {
    if (!event.nodeIds.length)
      add("event_no_zone", event.id, `«${event.id}»: не вибрано зону події.`);
    if (!event.avoidance.trim())
      add("missing_avoidance", event.id, `«${event.id}»: немає опису обходу.`);
    const danger = new Set(event.nodeIds),
      state = changed(event.effects, event.conditions);
    for (const node of event.nodeIds) {
      const seen = reach(node, state, danger);
      if (![...seen].some((id) => !danger.has(id)))
        add(
          "event_no_escape",
          event.id,
          `«${event.id}»: із «${d.nodes.find((n) => n.id === node)?.title}» немає обходу за станів цієї події.`,
        );
    }
  }
  return issues;
}
export function blankLabyrinth(title: string): LabyrinthDefinition {
  return {
    schemaVersion: 1,
    title,
    startNodeId: "entry",
    exitNodeIds: ["entry"],
    nodes: [
      {
        id: "entry",
        title: "Вхід",
        level: "lower",
        x: 0,
        y: 0,
        sceneId: null,
        description: "",
        cover: true,
      },
    ],
    edges: [],
    objects: [],
    events: [],
    heroes: [
      {
        id: "hero",
        entityId: null,
        name: "Мандрівник",
        startNodeId: "entry",
        resources: { health: 100, energy: 10 },
        inventory: [],
        goals: [],
        fears: [],
        knowledge: [],
      },
    ],
  };
}
