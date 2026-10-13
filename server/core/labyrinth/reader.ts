import type { LabyrinthDefinition, LabyrinthRunState } from "../../../shared/labyrinth";
import type { ReaderAction, ReaderView, ReaderScene } from "../../../shared/labyrinthReader";
import { describeRoutes, type Heading } from "../../../shared/labyrinthNarration";
import { effectiveObjects, eventPhase } from "../../../shared/labyrinthEventState";
import { LabyrinthError } from "./model";

export function readerWorld(d: LabyrinthDefinition, heroId: string): LabyrinthDefinition {
  const hero = d.heroes.find((h) => h.id === heroId);
  if (!hero) throw new LabyrinthError(422, "Виберіть героя доступної версії.");
  return { ...d, heroes: [hero] };
}
export function readerAction(input: unknown, heroId: string) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new LabyrinthError(422, "Виберіть дію.");
  const a = input as Record<string, unknown>;
  const keys = a.kind === "move" ? ["kind", "edgeId"] :
    a.kind === "interact" ? ["kind", "objectId", "to"] :
    a.kind === "wait" ? ["kind"] : [];
  if (!keys.length || Object.keys(a).length !== keys.length ||
    keys.some((k) => typeof a[k] !== "string" || !a[k] || String(a[k]).length > 128) ||
    Object.keys(a).some((k) => !keys.includes(k)))
    throw new LabyrinthError(422, "Некоректна читацька дія.");
  return { ...(a as ReaderAction), heroId };
}
export const objectNames = {
  door: "Двері", gate: "Решітка", switch: "Перемикач", generator: "Генератор",
  barrier: "Бар'єр", cache: "Схованка", bridge_mechanism: "Механізм мосту",
};
export function readerProjection(
  d: LabyrinthDefinition, state: LabyrinthRunState, heroId: string,
  visited: string[], heading: Heading, scenes: Record<string, ReaderScene>,
): Pick<ReaderView, "hero" | "scene" | "description" | "heading" | "choices" |
  "interactions" | "warnings" | "map" | "completed"> {
  const hero = d.heroes.find((h) => h.id === heroId);
  const hs = state.heroes[heroId];
  const node = d.nodes.find((n) => n.id === hs?.nodeId);
  if (!hero || !hs || !node) throw new LabyrinthError(409, "Проходження пошкоджене.");
  const discovered = new Set([...visited, node.id]);
  // A junction reveals immediate destinations, never the entire connected graph.
  for (const edge of d.edges) {
    if (visited.includes(edge.from)) discovered.add(edge.to);
    if (edge.bidirectional && visited.includes(edge.to)) discovered.add(edge.from);
  }
  const objects = effectiveObjects(d, state);
  // Narration can mention bridge endpoints: redact unseen labels before generating it.
  const narrationWorld = {
    ...d, heroes: [hero],
    nodes: d.nodes.map((n) => ({ ...n, title: discovered.has(n.id) ? n.title : "невідкрите місце" })),
    events: d.events.filter((e) => e.nodeIds.includes(node.id)),
  };
  const route = describeRoutes(narrationWorld, { ...state, objects }, heroId, heading);
  const completed = d.exitNodeIds.includes(node.id);
  return {
    hero: { name: hero.name, resources: { ...hs.resources }, inventory: [...hs.inventory], knowledge: [...hs.knowledge] },
    scene: scenes[node.id] ?? { title: node.title, paragraphs: [{ kind: "paragraph", text: node.description }] },
    description: route.description, heading,
    choices: completed ? [] : route.choices,
    interactions: completed ? [] : d.objects.filter((o) => o.nodeId === node.id).flatMap((o) =>
      o.transitions.filter((t) => t.from === objects[o.id]).map((t) => ({
        objectId: o.id, to: t.to, label: objectNames[o.kind] + " · " + t.to,
        available: t.conditions.every((c) => objects[c.objectId] === c.state),
      }))),
    warnings: d.events.filter((e) => e.nodeIds.includes(node.id)).flatMap((e) => {
      const phase = eventPhase(d, state, e.id);
      return phase === "warning" || phase === "active"
        ? [{ phase, text: e.warning, avoidance: e.avoidance }] : [];
    }),
    completed,
    map: {
      currentNodeId: node.id,
      nodes: d.nodes.filter((n) => discovered.has(n.id)).map((n) => ({
        id: n.id, title: n.title, level: n.level, x: n.x, y: n.y,
        visited: visited.includes(n.id), current: n.id === node.id,
      })),
      edges: d.edges.filter((e) => discovered.has(e.from) && discovered.has(e.to) &&
        (visited.includes(e.from) || visited.includes(e.to)))
        .map((e) => ({ id: e.id, from: e.from, to: e.to, kind: e.kind })),
    },
  };
}
