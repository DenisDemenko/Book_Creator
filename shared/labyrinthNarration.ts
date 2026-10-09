import type {
  LabyrinthDefinition,
  LabyrinthRunState,
  LabyrinthRunEvent,
} from "./labyrinth";
export type Heading = "north" | "east" | "south" | "west";
export const headings: Heading[] = ["north", "east", "south", "west"];
export interface RouteChoice {
  edgeId: string;
  toNodeId: string;
  direction: string;
  label: string;
  available: boolean;
  reason: string | null;
}
export interface RouteView {
  heroId: string;
  nodeId: string;
  heading: Heading;
  description: string;
  choices: RouteChoice[];
  visibleBridgeIds: string[];
}
const cardinal = (dx: number, dy: number): Heading =>
  Math.abs(dx) > Math.abs(dy)
    ? dx > 0
      ? "east"
      : "west"
    : dy > 0
      ? "south"
      : "north";
export function headingFromEvents(
  d: LabyrinthDefinition,
  events: Pick<LabyrinthRunEvent, "action" | "state">[],
  heroId: string,
): Heading {
  for (const e of events) {
    const action = e.action;
    if (action.kind !== "move" || action.heroId !== heroId) continue;
    const edge = d.edges.find((v) => v.id === action.edgeId);
    if (!edge) continue;
    const to = d.nodes.find((n) => n.id === e.state.heroes[heroId]?.nodeId);
    const from = d.nodes.find(
      (n) => n.id === (to?.id === edge.to ? edge.from : edge.to),
    );
    if (to && from && (to.x !== from.x || to.y !== from.y))
      return cardinal(to.x - from.x, to.y - from.y);
  }
  return "north";
}
export function describeRoutes(
  d: LabyrinthDefinition,
  state: LabyrinthRunState,
  heroId: string,
  heading: Heading,
): RouteView {
  const hero = d.heroes.find((h) => h.id === heroId),
    s = state.heroes[heroId],
    node = d.nodes.find((n) => n.id === s?.nodeId);
  if (!hero || !s || !node || !headings.includes(heading))
    throw new Error("Невідомий герой, позиція або напрямок погляду.");
  const choices: RouteChoice[] = d.edges
    .filter((e) => e.from === node.id || (e.bidirectional && e.to === node.id))
    .map((e) => {
      const to = d.nodes.find(
        (n) => n.id === (e.from === node.id ? e.to : e.from),
      )!;
      let direction: string;
      if (to.level !== node.level)
        direction =
          to.level === "upper" ? "піднятися нагору" : "спуститися вниз";
      else if (to.x === node.x && to.y === node.y) direction = "перейти далі";
      else {
        const turn =
          (headings.indexOf(cardinal(to.x - node.x, to.y - node.y)) -
            headings.indexOf(heading) +
            4) %
          4;
        direction = [
          "йти прямо",
          "повернути праворуч",
          "повернути назад",
          "повернути ліворуч",
        ][turn];
      }
      const blocked = e.conditions.some(
          (c) => state.objects[c.objectId] !== c.state,
        ),
        exhausted = Object.entries(e.costs).some(
          ([k, v]) => (s.resources[k] ?? 0) < v,
        );
      const reason = blocked
        ? "прохід зараз закритий"
        : exhausted
          ? "бракує ресурсів"
          : null;
      const kind = {
        corridor: "коридором",
        bridge: "мостом",
        stairs: "сходами",
        ladder: "драбиною",
        lift: "підйомником",
      }[e.kind];
      return {
        edgeId: e.id,
        toNodeId: to.id,
        direction,
        label: `${direction} ${kind} до «${to.title}»`,
        available: !reason,
        reason,
      };
    });
  const available = choices.filter((c) => c.available),
    adjacent = new Set([node.id, ...choices.map((c) => c.toNodeId)]);
  const bridges = d.edges.filter(
    (e) => e.kind === "bridge" && e.overNodeIds.some((id) => adjacent.has(id)),
  );
  const sentences = [
    `${hero.name} перебуває у місці «${node.title}» на ${node.level === "upper" ? "верхньому" : "нижньому"} рівні.`,
  ];
  sentences.push(
    available.length
      ? `${hero.name} стоїть перед вибором: ${available.map((c) => c.label).join("; ")}.`
      : "Зараз немає доступного переходу.",
  );
  for (const c of choices.filter((c) => !c.available))
    sentences.push(
      `Шлях до «${d.nodes.find((n) => n.id === c.toNodeId)!.title}»: ${c.reason}.`,
    );
  for (const b of bridges) {
    const below = b.overNodeIds.includes(node.id);
    const a = d.nodes.find((n) => n.id === b.from)!,
      z = d.nodes.find((n) => n.id === b.to)!;
    sentences.push(
      `${below ? "Над цим місцем" : "Над сусіднім коридором"} видно міст між «${a.title}» та «${z.title}», перекинутий через стіни.`,
    );
  }
  return {
    heroId,
    nodeId: node.id,
    heading,
    description: sentences.join(" "),
    choices,
    visibleBridgeIds: bridges.map((e) => e.id),
  };
}
