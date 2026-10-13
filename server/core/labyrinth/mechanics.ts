import type {
  LabyrinthDefinition,
  LabyrinthObject,
  LabyrinthEventTemplate,
} from "../../../shared/labyrinth";
import {
  MECHANIC_KINDS,
  MECHANIC_LIBRARY,
  type MechanicBinding,
  type MechanicKind,
} from "../../../shared/labyrinthMechanics";
import { LabyrinthError, validateDefinition } from "./model";
const bad = (message: string): never => {
  throw new LabyrinthError(422, message);
};
function path(
  d: LabyrinthDefinition,
  from: string,
  to: string,
  excludedBridge?: string,
  visitLower = false,
) {
  const queue: Array<[string, boolean]> = [
    [from, d.nodes.find((n) => n.id === from)?.level === "lower"],
  ];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const [node, lower] = queue[i],
      key = `${node}:${lower}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (node === to && (!visitLower || lower)) return true;
    for (const e of d.edges) {
      if (e.id === excludedBridge) continue;
      const next =
        e.from === node
          ? e.to
          : e.bidirectional && e.to === node
            ? e.from
            : null;
      if (next)
        queue.push([
          next,
          lower || d.nodes.find((n) => n.id === next)?.level === "lower",
        ]);
    }
  }
  return false;
}
/** Compiles a draft only; persistence, project references and all runtime safety stay in the existing private flow. */
export function compileMechanic(input: unknown, raw: unknown) {
  const d = validateDefinition(input);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    bad("Потрібні параметри механіки.");
  const b = raw as Record<string, unknown>;
  const keys = [
    "id",
    "kind",
    "bridgeId",
    "responseNodeId",
    "preparation",
    "duration",
    "cooldown",
    "damage",
  ];
  if (
    Object.keys(b).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(b, k)) ||
    Object.keys(b).some((k) => !keys.includes(k))
  )
    bad("Некоректні поля механіки.");
  if (
    typeof b.id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(b.id) ||
    ["constructor", "prototype", "__proto__"].includes(b.id)
  )
    bad("Некоректний ID механіки.");
  if (!MECHANIC_KINDS.includes(b.kind as MechanicKind))
    bad("Невідома механіка.");
  for (const [key, min, max] of [
    ["preparation", 1, 20],
    ["duration", 1, 20],
    ["cooldown", 0, 100],
    ["damage", 0, 100],
  ] as const)
    if (
      !Number.isSafeInteger(b[key]) ||
      Number(b[key]) < min ||
      Number(b[key]) > max
    )
      bad("Час або шкода виходять за межі шаблону.");
  const binding = b as unknown as MechanicBinding;
  const bridge = d.edges.find(
    (e) => e.id === binding.bridgeId && e.kind === "bridge",
  );
  const responseNode = d.nodes.find((n) => n.id === binding.responseNodeId);
  if (!bridge || !bridge.overNodeIds.length)
    bad("Виберіть міст із реально пов’язаними нижніми вузлами.");
  const spec = MECHANIC_LIBRARY[binding.kind];
  if (
    !responseNode ||
    (binding.kind === "false_route"
      ? responseNode.id !== bridge.from
      : responseNode.level !== "lower")
  )
    bad("Відповідь має бути внизу; дослідження підказки — біля початку мосту.");
  if (
    !path(d, bridge.from, responseNode.id) ||
    !path(d, responseNode.id, bridge.to)
  )
    bad("Місце відповіді не з’єднане з обома краями мосту.");
  const gated = ["bridge_block", "drawbridge", "barrier"].includes(
    binding.kind,
  );
  if (gated && !path(d, bridge.from, bridge.to, bridge.id, true))
    bad("Потрібен реальний нижній обхід мосту.");
  if (
    binding.kind === "flood" &&
    !d.edges.some(
      (e) =>
        ["stairs", "ladder", "lift"].includes(e.kind) &&
        ((bridge.overNodeIds.includes(e.from) &&
          d.nodes.find((n) => n.id === e.to)?.level === "upper") ||
          (e.bidirectional &&
            bridge.overNodeIds.includes(e.to) &&
            d.nodes.find((n) => n.id === e.from)?.level === "upper")),
    )
  )
    bad(
      "Для затоплення потрібні реальні сходи, драбина або підйомник із небезпечної зони.",
    );
  const responseId = `${binding.id}:response`,
    eventId = `${binding.id}:event`,
    gateId = `${binding.id}:gate`;
  const reserved = new Set(
    [...d.nodes, ...d.edges, ...d.objects, ...d.heroes, ...d.events].map(
      (x) => x.id,
    ),
  );
  if (
    [responseId, eventId, ...(gated ? [gateId] : [])].some((id) =>
      reserved.has(id),
    )
  )
    bad("ID цієї механіки вже зайнятий.");
  const response: LabyrinthObject = {
    id: responseId,
    nodeId: responseNode.id,
    entityId: null,
    kind:
      binding.kind === "barrier"
        ? "generator"
        : binding.kind === "false_route"
          ? "cache"
          : "switch",
    states: ["armed", "resolved"],
    initialState: "armed",
    transitions: [
      {
        from: "armed",
        to: "resolved",
        conditions: [],
        effects: [],
        consequences: {
          resourceDelta: {},
          inventoryAdd: [],
          inventoryRemove: [],
          knowledgeAdd: [spec.resolved],
        },
      },
      { from: "resolved", to: "armed", conditions: [], effects: [] },
    ],
  };
  const objects = [...d.objects, response];
  if (gated)
    objects.push({
      id: gateId,
      nodeId: bridge.to,
      entityId: null,
      kind:
        binding.kind === "drawbridge"
          ? "bridge_mechanism"
          : binding.kind === "barrier"
            ? "barrier"
            : "gate",
      states: ["open", "closed"],
      initialState: "open",
      transitions: [],
    });
  let nodeIds = gated
    ? [bridge.from, bridge.to]
    : binding.kind === "false_route"
      ? [bridge.to]
      : [...bridge.overNodeIds];
  if (["falling_hazard", "crossfire"].includes(binding.kind))
    nodeIds = nodeIds.filter((id) => !d.nodes.find((n) => n.id === id)!.cover);
  if (!nodeIds.length)
    bad("Немає відкритої зони небезпеки: усі вузли мають укриття.");
  const event: LabyrinthEventTemplate = {
    id: eventId,
    nodeIds,
    conditions: [{ objectId: responseId, state: "armed" }],
    warning: spec.warning,
    avoidance: `${spec.response} у «${responseNode.title}» або скористатися реальним обходом.`,
    preparation: binding.preparation,
    duration: binding.duration,
    cooldown: binding.cooldown,
    effects: gated ? [{ objectId: gateId, state: "closed" }] : [],
    director: { intent: "challenge", priority: 50 },
    mechanic: {
      kind: binding.kind,
      bridgeId: bridge.id,
      responseObjectId: responseId,
      ...(binding.kind === "false_route"
        ? {
            belief: {
              claim: "Підсвічений міст здається цілком безпечним.",
              clues: [
                "Біля вказівника немає слідів мандрівників.",
                "Під настилом чути металевий брязкіт.",
              ],
            },
          }
        : {}),
    },
    resolution: {
      conditions: [{ objectId: responseId, state: "resolved" }],
      description: spec.resolved,
    },
    ...(!gated
      ? {
          hazard: {
            resourceCosts: { health: binding.damage },
            blocksMovement: binding.kind === "ambush",
            ...(binding.kind === "flood"
              ? { growthPerTick: { health: 1 } }
              : {}),
          },
        }
      : {}),
  };
  const definition = validateDefinition({
    ...d,
    objects,
    edges: d.edges.map((e) =>
      e.id === bridge.id && gated
        ? {
            ...e,
            conditions: [...e.conditions, { objectId: gateId, state: "open" }],
          }
        : e,
    ),
    events: [...d.events, event],
  });
  return {
    definition,
    eventId,
    createdObjectIds: gated ? [responseId, gateId] : [responseId],
  };
}
