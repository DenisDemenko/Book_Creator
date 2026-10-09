import { createHash } from "node:crypto";
import type {
  LabyrinthDefinition,
  LabyrinthRunState,
  ObjectCondition,
  StructuralAction,
} from "../../../shared/labyrinth";
export class LabyrinthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LabyrinthError";
  }
}
const bad = (message: string): never => {
  throw new LabyrinthError(422, message);
};
const record = (v: unknown, keys: string[]) => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    bad("Потрібен об’єкт даних.");
  const r = v as Record<string, unknown>;
  if (Object.keys(r).some((k) => !keys.includes(k)))
    bad("Невідомі поля даних.");
  return r;
};
const text = (v: unknown, max = 160, empty = false) => {
  if (
    typeof v !== "string" ||
    v.length > max ||
    v.includes("\u0000") ||
    (!empty && !v.trim())
  )
    bad("Некоректний текст.");
  return (v as string).trim();
};
const id = (v: unknown) => {
  const s = text(v, 128);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s) ||
    ["constructor", "prototype", "__proto__"].includes(s)
  )
    bad("Некоректний стабільний ідентифікатор.");
  return s;
};
const optionalId = (v: unknown) => (v === null ? idNull : id(v));
const idNull = null;
const num = (v: unknown, min = 0, max = 1000000) => {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max)
    bad("Некоректне ціле число.");
  return Number(v);
};
const bool = (v: unknown) => {
  if (typeof v !== "boolean") bad("Потрібне логічне значення.");
  return v as boolean;
};
const choice = <T extends string>(v: unknown, values: readonly T[]): T => {
  if (!values.includes(v as T)) bad("Невідоме значення.");
  return v as T;
};
const list = <T>(v: unknown, max: number, fn: (v: unknown) => T): T[] => {
  if (!Array.isArray(v) || v.length > max)
    bad("Некоректний або завеликий список.");
  return (v as unknown[]).map(fn);
};
const strings = (v: unknown) => list(v, 100, (x) => text(x, 500));
const resources = (v: unknown) => {
  const r = record(v, Object.keys(v && typeof v === "object" ? v : {}));
  if (Object.keys(r).length > 30) bad("Забагато ресурсів.");
  return Object.fromEntries(Object.entries(r).map(([k, n]) => [id(k), num(n)]));
};
const conditions = (v: unknown) =>
  list(v, 50, (x) => {
    const r = record(x, ["objectId", "state"]);
    return { objectId: id(r.objectId), state: id(r.state) };
  });
function unique<T extends { id: string }>(items: T[]) {
  if (new Set(items.map((x) => x.id)).size !== items.length)
    bad("Повторний ідентифікатор.");
  return new Map(items.map((x) => [x.id, x]));
}
export function validateDefinition(input: unknown): LabyrinthDefinition {
  const r = record(input, [
    "schemaVersion",
    "title",
    "startNodeId",
    "exitNodeIds",
    "nodes",
    "edges",
    "objects",
    "heroes",
    "events",
  ]);
  if (r.schemaVersion !== 1) bad("Невідома версія схеми лабіринта.");
  const nodes = list(r.nodes, 1000, (x) => {
    const n = record(x, [
      "id",
      "title",
      "level",
      "x",
      "y",
      "sceneId",
      "description",
      "cover",
    ]);
    return {
      id: id(n.id),
      title: text(n.title),
      level: choice(n.level, ["lower", "upper"] as const),
      x: num(n.x, -100000, 100000),
      y: num(n.y, -100000, 100000),
      sceneId: optionalId(n.sceneId),
      description: text(n.description, 8000, true),
      cover: bool(n.cover),
    };
  });
  if (!nodes.length) bad("Лабіринт має містити вузли.");
  const byNode = unique(nodes);
  const exists = (s: string) => {
    if (!byNode.has(s)) bad("Посилання на відсутній вузол.");
    return s;
  };
  const objects = list(r.objects, 1000, (x) => {
    const o = record(x, [
      "id",
      "nodeId",
      "entityId",
      "kind",
      "states",
      "initialState",
      "transitions",
    ]);
    return {
      id: id(o.id),
      nodeId: exists(id(o.nodeId)),
      entityId: optionalId(o.entityId),
      kind: choice(o.kind, [
        "door",
        "gate",
        "switch",
        "generator",
        "barrier",
        "cache",
        "bridge_mechanism",
      ] as const),
      states: list(o.states, 30, id),
      initialState: id(o.initialState),
      transitions: list(o.transitions, 100, (x) => {
        const t = record(x, ["from", "to", "conditions", "effects"]);
        return {
          from: id(t.from),
          to: id(t.to),
          conditions: conditions(t.conditions),
          effects: conditions(t.effects),
        };
      }),
    };
  });
  const byObject = unique(objects);
  const validCondition = (c: ObjectCondition) => {
    const o = byObject.get(c.objectId);
    if (!o || !o.states.includes(c.state))
      bad("Невідомий об’єкт або стан у правилі.");
  };
  for (const o of objects) {
    if (
      !o.states.length ||
      new Set(o.states).size !== o.states.length ||
      !o.states.includes(o.initialState)
    )
      bad("Некоректні стани об’єкта.");
    const pairs = new Set<string>();
    for (const t of o.transitions) {
      if (
        !o.states.includes(t.from) ||
        !o.states.includes(t.to) ||
        t.from === t.to
      )
        bad("Некоректний перехід стану.");
      const key = JSON.stringify([t.from, t.to]);
      if (pairs.has(key)) bad("Неоднозначний перехід стану.");
      pairs.add(key);
      t.conditions.forEach(validCondition);
      t.effects.forEach(validCondition);
      if (
        new Set(t.effects.map((e) => e.objectId)).size !== t.effects.length ||
        t.effects.some((e) => e.objectId === o.id)
      )
        bad("Конфлікт ефектів механізму.");
    }
  }
  const edges = list(r.edges, 4000, (x) => {
    const e = record(x, [
      "id",
      "from",
      "to",
      "kind",
      "bidirectional",
      "duration",
      "costs",
      "conditions",
      "overNodeIds",
    ]);
    return {
      id: id(e.id),
      from: exists(id(e.from)),
      to: exists(id(e.to)),
      kind: choice(e.kind, [
        "corridor",
        "bridge",
        "stairs",
        "ladder",
        "lift",
      ] as const),
      bidirectional: bool(e.bidirectional),
      duration: num(e.duration, 1, 10000),
      costs: resources(e.costs),
      conditions: conditions(e.conditions),
      overNodeIds: list(e.overNodeIds, 100, (x) => exists(id(x))),
    };
  });
  unique(edges);
  for (const e of edges) {
    const a = byNode.get(e.from)!,
      b = byNode.get(e.to)!;
    if (a.id === b.id) bad("Перехід має з’єднувати різні вузли.");
    if (["corridor", "bridge"].includes(e.kind) && a.level !== b.level)
      bad("Горизонтальний перехід не змінює рівень.");
    if (e.kind === "corridor" && a.level !== "lower")
      bad("Коридор належить нижньому рівню.");
    if (e.kind === "bridge" && a.level !== "upper")
      bad("Міст належить верхньому рівню.");
    if (["stairs", "ladder", "lift"].includes(e.kind) && a.level === b.level)
      bad("Вертикальний перехід з’єднує різні рівні.");
    if (e.kind !== "bridge" && e.overNodeIds.length)
      bad("Лише міст має нижні вузли під собою.");
    if (
      new Set(e.overNodeIds).size !== e.overNodeIds.length ||
      e.overNodeIds.some((n) => byNode.get(n)!.level !== "lower")
    )
      bad("Під мостом мають бути нижні вузли.");
    e.conditions.forEach(validCondition);
  }
  const heroes = list(r.heroes, 20, (x) => {
    const h = record(x, [
      "id",
      "entityId",
      "name",
      "startNodeId",
      "resources",
      "inventory",
      "goals",
      "fears",
      "knowledge",
    ]);
    return {
      id: id(h.id),
      entityId: optionalId(h.entityId),
      name: text(h.name),
      startNodeId: exists(id(h.startNodeId)),
      resources: resources(h.resources),
      inventory: strings(h.inventory),
      goals: strings(h.goals),
      fears: strings(h.fears),
      knowledge: strings(h.knowledge),
    };
  });
  unique(heroes);
  if (!heroes.length) bad("Потрібен хоча б один герой.");
  const events = list(r.events, 500, (x) => {
    const e = record(x, [
      "id",
      "nodeIds",
      "conditions",
      "warning",
      "preparation",
      "duration",
      "cooldown",
      "effects",
      "avoidance",
    ]);
    return {
      id: id(e.id),
      nodeIds: list(e.nodeIds, 100, (x) => exists(id(x))),
      conditions: conditions(e.conditions),
      warning: text(e.warning, 2000),
      preparation: num(e.preparation, 1, 10000),
      duration: num(e.duration, 1, 10000),
      cooldown: num(e.cooldown),
      effects: conditions(e.effects),
      avoidance: text(e.avoidance, 2000),
    };
  });
  unique(events);
  events.forEach((e) => {
    e.conditions.forEach(validCondition);
    e.effects.forEach(validCondition);
    if (new Set(e.effects.map((c) => c.objectId)).size !== e.effects.length)
      bad("Конфлікт ефектів події.");
  });
  const exitNodeIds = list(r.exitNodeIds, 100, (x) => exists(id(x)));
  if (!exitNodeIds.length || new Set(exitNodeIds).size !== exitNodeIds.length)
    bad("Потрібні унікальні виходи.");
  return {
    schemaVersion: 1,
    title: text(r.title),
    startNodeId: exists(id(r.startNodeId)),
    exitNodeIds,
    nodes,
    edges,
    objects,
    heroes,
    events,
  };
}
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  return v;
}
export const stateHash = (state: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(state)))
    .digest("hex");
export function initialState(d: LabyrinthDefinition): LabyrinthRunState {
  return {
    turn: 0,
    storyTime: 0,
    heroes: Object.fromEntries(
      d.heroes.map((h) => [
        h.id,
        {
          nodeId: h.startNodeId,
          resources: { ...h.resources },
          inventory: [...h.inventory],
          knowledge: [...h.knowledge],
        },
      ]),
    ),
    objects: Object.fromEntries(d.objects.map((o) => [o.id, o.initialState])),
  };
}
/** Structural preview only. Hazard scheduling, director, full safety and group turns belong to T9.3–T9.7. */
export function structuralAction(
  d: LabyrinthDefinition,
  state: LabyrinthRunState,
  input: unknown,
): { state: LabyrinthRunState; action: StructuralAction } {
  const r = record(input, ["kind", "heroId", "edgeId", "objectId", "to"]);
  const heroId = id(r.heroId),
    next = structuredClone(state),
    h = next.heroes[heroId];
  if (!h) bad("Невідомий герой.");
  const allowed = (cs: ObjectCondition[]) =>
    cs.every((c) => next.objects[c.objectId] === c.state);
  let action: StructuralAction,
    duration = 1;
  if (r.kind === "move") {
    if (r.objectId !== undefined || r.to !== undefined)
      bad("Невідомі поля переходу.");
    const edgeId = id(r.edgeId),
      e = d.edges.find((e) => e.id === edgeId);
    if (!e) bad("Невідомий перехід.");
    const to =
      e.from === h.nodeId
        ? e.to
        : e.bidirectional && e.to === h.nodeId
          ? e.from
          : null;
    if (!to || !allowed(e.conditions))
      throw new LabyrinthError(409, "Цей перехід зараз недоступний.");
    for (const [key, cost] of Object.entries(e.costs)) {
      if ((h.resources[key] ?? 0) < cost)
        throw new LabyrinthError(409, "Недостатньо ресурсів для переходу.");
      h.resources[key] = (h.resources[key] ?? 0) - cost;
    }
    h.nodeId = to;
    duration = e.duration;
    action = { kind: "move", heroId, edgeId };
  } else if (r.kind === "interact") {
    if (r.edgeId !== undefined) bad("Невідомі поля взаємодії.");
    const objectId = id(r.objectId),
      to = id(r.to),
      o = d.objects.find((o) => o.id === objectId);
    if (!o || o.nodeId !== h.nodeId)
      throw new LabyrinthError(409, "Об’єкт не знаходиться поруч із героєм.");
    const transition = o.transitions.find(
      (t) => t.from === next.objects[o.id] && t.to === to,
    );
    if (!transition || !allowed(transition.conditions))
      throw new LabyrinthError(409, "Ця зміна стану недоступна.");
    next.objects[o.id] = to;
    transition.effects.forEach((e) => (next.objects[e.objectId] = e.state));
    action = { kind: "interact", heroId, objectId, to };
  } else bad("Невідома структурна дія.");
  next.turn++;
  next.storyTime += duration;
  return { state: next, action };
}
