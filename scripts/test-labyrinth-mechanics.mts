import assert from "node:assert/strict";
import { labyrinthDemo } from "../shared/labyrinthDemo";
import {
  MECHANIC_KINDS,
  type MechanicKind,
} from "../shared/labyrinthMechanics";
import { compileMechanic } from "../server/core/labyrinth/mechanics";
import { validateDefinition, stateHash } from "../server/core/labyrinth/model";
import {
  runtimeInitialState,
  runtimeAction,
  eventPhase,
  effectiveObjects,
} from "../server/core/labyrinth/runtime";
import { describeRoutes } from "../shared/labyrinthNarration";
import type { LabyrinthDefinition, RuntimeAction } from "../shared/labyrinth";
let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`✓ ${name}`);
}
const world = () => {
  const d = structuredClone(labyrinthDemo);
  d.events = [];
  d.heroes[0].resources = { health: 200, energy: 100 };
  return d;
};
const binding = (kind: MechanicKind, id = kind) => ({
  id,
  kind,
  bridgeId: "bridge",
  responseNodeId: kind === "false_route" ? "upper-left" : "lower-entry",
  preparation: 2,
  duration: 4,
  cooldown: 3,
  damage: 2,
});
const apply = (
  d: LabyrinthDefinition,
  s: ReturnType<typeof runtimeInitialState>,
  action: RuntimeAction,
) => runtimeAction(d, s, action).state;
for (const kind of MECHANIC_KINDS) {
  const base = world(),
    result = compileMechanic(base, binding(kind)),
    d = result.definition,
    e = d.events[0];
  test(`${kind}: чернетка, рівні й попередження`, () => {
    assert.equal(base.events.length, 0);
    assert.equal(e.mechanic?.kind, kind);
    assert.ok(e.warning);
    assert.ok(e.avoidance);
    assert.equal(e.preparation, 2);
    assert.equal(
      d.objects.find((o) => o.id === e.mechanic?.responseObjectId)?.nodeId,
      binding(kind).responseNodeId,
    );
    assert.deepEqual(base.heroes, d.heroes);
    assert.deepEqual(base.nodes, d.nodes);
  });
  test(`${kind}: попередження → активність → дієва відповідь → cooldown`, () => {
    let s = apply(d, runtimeInitialState(d), {
      kind: "start_event",
      eventId: e.id,
    });
    assert.equal(eventPhase(d, s, e.id), "warning");
    if (kind === "false_route")
      s = apply(d, s, { kind: "move", heroId: "hero", edgeId: "up" });
    else s = apply(d, s, { kind: "wait", heroId: "hero" });
    assert.equal(eventPhase(d, s, e.id), "warning");
    s = apply(d, s, { kind: "wait", heroId: "hero" });
    assert.equal(eventPhase(d, s, e.id), "active");
    const before = stateHash(s),
      resolved = apply(d, s, {
        kind: "interact",
        heroId: "hero",
        objectId: e.mechanic!.responseObjectId,
        to: "resolved",
      });
    assert.equal(stateHash(s), before);
    assert.equal(resolved.engine!.events[0].resolvedAt, 2);
    assert.equal(eventPhase(d, resolved, e.id), "cooldown");
    assert.ok(
      resolved.heroes.hero.knowledge.includes(e.resolution!.description),
    );
    assert.throws(
      () => apply(d, resolved, { kind: "start_event", eventId: e.id }),
      /перезаряджання/,
    );
    assert.deepEqual(effectiveObjects(d, resolved), resolved.objects);
  });
  test(`${kind}: завершення за часом знімає тимчасові ефекти`, () => {
    let s = apply(d, runtimeInitialState(d), {
      kind: "start_event",
      eventId: e.id,
    });
    for (let n = 0; n < 6; n++)
      s = apply(d, s, { kind: "wait", heroId: "hero" });
    assert.equal(eventPhase(d, s, e.id), "cooldown");
    assert.deepEqual(effectiveObjects(d, s), s.objects);
    for (let n = 0; n < 3; n++)
      s = apply(d, s, { kind: "wait", heroId: "hero" });
    assert.equal(eventPhase(d, s, e.id), "ready");
  });
}
test("Газ/вода: шкода наростає лише в активні кроки", () => {
  const d = compileMechanic(world(), binding("flood")).definition;
  let s = apply(d, runtimeInitialState(d), {
    kind: "start_event",
    eventId: d.events[0].id,
  });
  s = apply(d, s, { kind: "wait", heroId: "hero" });
  assert.equal(s.heroes.hero.resources.health, 200);
  s = apply(d, s, { kind: "wait", heroId: "hero" });
  assert.equal(s.heroes.hero.resources.health, 198);
  s = apply(d, s, { kind: "wait", heroId: "hero" });
  assert.equal(s.heroes.hero.resources.health, 195);
});
test("Обстріл/уламки: реальне укриття не отримує шкоду", () => {
  for (const kind of ["crossfire", "falling_hazard"] as const) {
    const d = compileMechanic(world(), binding(kind)).definition;
    assert.ok(!d.events[0].nodeIds.includes("lower-entry"));
    assert.ok(d.events[0].nodeIds.includes("lower-exit"));
    let s = apply(d, runtimeInitialState(d), {
      kind: "start_event",
      eventId: d.events[0].id,
    });
    for (let n = 0; n < 3; n++)
      s = apply(d, s, { kind: "wait", heroId: "hero" });
    assert.equal(s.heroes.hero.resources.health, 200);
  }
});
test("Міст/бар’єр: закритий верхній шлях, реальний нижній обхід", () => {
  for (const kind of ["bridge_block", "drawbridge", "barrier"] as const) {
    const source = world();
    source.heroes[0].startNodeId = "upper-left";
    const d = compileMechanic(source, binding(kind)).definition;
    let s = apply(d, runtimeInitialState(d), {
      kind: "start_event",
      eventId: d.events[0].id,
    });
    for (let n = 0; n < 2; n++)
      s = apply(d, s, { kind: "wait", heroId: "hero" });
    assert.throws(
      () => apply(d, s, { kind: "move", heroId: "hero", edgeId: "bridge" }),
      /недоступний/,
    );
    s = apply(d, s, { kind: "move", heroId: "hero", edgeId: "up" });
    s = apply(d, s, { kind: "move", heroId: "hero", edgeId: "corridor" });
    assert.equal(s.heroes.hero.nodeId, "lower-exit");
  }
});
test("Ілюзія: підказка є переконанням, карта й доступність не підміняються", () => {
  const source = world();
  source.heroes[0].startNodeId = "upper-left";
  const d = compileMechanic(source, binding("false_route")).definition;
  assert.deepEqual(d.edges, source.edges);
  const s = apply(d, runtimeInitialState(d), {
    kind: "start_event",
    eventId: d.events[0].id,
  });
  const view = describeRoutes(d, s, "hero", "east");
  assert.match(view.description, /переконання, не підтверджений факт/);
  assert.match(view.description, /Ознаки обману/);
  assert.ok(view.choices.find((c) => c.edgeId === "bridge")?.available);
});
test("Засада: заборона входу не забороняє втечу нагору", () => {
  const d = compileMechanic(world(), binding("ambush")).definition;
  let s = apply(d, runtimeInitialState(d), {
    kind: "start_event",
    eventId: d.events[0].id,
  });
  for (let n = 0; n < 2; n++) s = apply(d, s, { kind: "wait", heroId: "hero" });
  assert.throws(
    () => apply(d, s, { kind: "move", heroId: "hero", edgeId: "corridor" }),
    /заблокований/,
  );
  assert.equal(
    apply(d, s, { kind: "move", heroId: "hero", edgeId: "up" }).heroes.hero
      .nodeId,
    "upper-left",
  );
});
test("Дві небезпеки: незалежні відповіді та точний стан", () => {
  const a = compileMechanic(world(), binding("bridge_block"));
  const b = compileMechanic(a.definition, binding("flood"));
  const d = b.definition;
  let s = runtimeInitialState(d);
  for (const e of d.events)
    s = apply(d, s, { kind: "start_event", eventId: e.id });
  for (let n = 0; n < 2; n++) s = apply(d, s, { kind: "wait", heroId: "hero" });
  s = apply(d, s, {
    kind: "interact",
    heroId: "hero",
    objectId: d.events[0].mechanic!.responseObjectId,
    to: "resolved",
  });
  assert.equal(eventPhase(d, s, d.events[1].id), "active");
  s = apply(d, s, {
    kind: "interact",
    heroId: "hero",
    objectId: d.events[1].mechanic!.responseObjectId,
    to: "resolved",
  });
  assert.ok(s.engine!.events.every((e) => e.resolvedAt !== undefined));
});
test("Хибні прив’язки, відсутній обхід, підйом і дублікати відхиляються", () => {
  assert.throws(() =>
    compileMechanic(world(), { ...binding("flood"), bridgeId: "corridor" }),
  );
  assert.throws(() =>
    compileMechanic(world(), {
      ...binding("barrier"),
      responseNodeId: "upper-right",
    }),
  );
  assert.throws(() =>
    compileMechanic(world(), {
      ...binding("false_route"),
      responseNodeId: "upper-right",
    }),
  );
  const noBypass = world();
  noBypass.edges = noBypass.edges.filter((e) => !["up", "down"].includes(e.id));
  assert.throws(() => compileMechanic(noBypass, binding("bridge_block")));
  assert.throws(() => compileMechanic(noBypass, binding("flood")));
  const a = compileMechanic(world(), binding("crossfire"));
  assert.throws(
    () => compileMechanic(a.definition, binding("crossfire")),
    /зайнятий/,
  );
});
test("Невалідні поля/час/тип не створюють небезпеку", () => {
  for (const patch of [
    { extra: true },
    { preparation: 0 },
    { duration: 21 },
    { damage: -1 },
    { kind: "random" },
    { id: "__proto__" },
  ])
    assert.throws(() =>
      compileMechanic(world(), { ...binding("flood"), ...patch }),
    );
});
test("Недійсна відповідь/зона/ознаки обману не зберігаються", () => {
  const d = compileMechanic(world(), binding("false_route")).definition;
  const wrong = structuredClone(d);
  wrong.events[0].resolution!.conditions[0].state = "missing";
  assert.throws(() => validateDefinition(wrong));
  const zone = structuredClone(d);
  zone.events[0].nodeIds = ["isolated-room"];
  assert.throws(() => validateDefinition(zone));
  d.events[0].mechanic!.belief!.clues = [];
  assert.throws(() => validateDefinition(d));
});
test("Рятувальна подія не приховує базову шкоду або її наростання", () => {
  const d = compileMechanic(world(), binding("flood")).definition;
  d.events[0].director!.intent = "rescue";
  d.events[0].hazard!.growthPerTick!.health = 0;
  assert.throws(() => validateDefinition(d));
  d.events[0].hazard!.resourceCosts.health = 0;
  d.events[0].hazard!.growthPerTick!.health = 1;
  assert.throws(() => validateDefinition(d));
});
test("Поєднання двох небезпек не перекриває останній порятунок", () => {
  const b = compileMechanic(world(), binding("bridge_block"));
  const f = compileMechanic(b.definition, binding("flood"));
  const d = f.definition;
  d.events.forEach((e) => {
    e.preparation = 1;
    e.duration = 4;
  });
  d.events[1].hazard!.resourceCosts.health = 200;
  const gate = d.events[0].effects[0];
  for (const edge of d.edges.filter((e) => ["corridor", "up"].includes(e.id)))
    edge.conditions.push({ objectId: gate.objectId, state: "open" });
  for (const object of d.objects.filter((o) =>
    d.events.some((e) => e.mechanic?.responseObjectId === o.id),
  ))
    object.transitions[0].consequences!.resourceDelta = { health: -200 };
  const valid = validateDefinition(d),
    first = apply(valid, runtimeInitialState(valid), {
      kind: "start_event",
      eventId: d.events[0].id,
    });
  const hash = stateHash(first);
  assert.throws(
    () => apply(valid, first, { kind: "start_event", eventId: d.events[1].id }),
    /досяжного виходу/,
  );
  assert.equal(stateHash(first), hash);
});
test("Відповідь під час попередження та повторна підготовка не дублюють подію", () => {
  const d = compileMechanic(world(), binding("barrier")).definition,
    e = d.events[0];
  let s = apply(d, runtimeInitialState(d), {
    kind: "start_event",
    eventId: e.id,
  });
  s = apply(d, s, {
    kind: "interact",
    heroId: "hero",
    objectId: e.mechanic!.responseObjectId,
    to: "resolved",
  });
  assert.equal(s.engine!.events[0].resolvedAt, 0);
  for (let i = 0; i < 3; i++) s = apply(d, s, { kind: "wait", heroId: "hero" });
  assert.throws(
    () => apply(d, s, { kind: "start_event", eventId: e.id }),
    /Умови/,
  );
  s = apply(d, s, {
    kind: "interact",
    heroId: "hero",
    objectId: e.mechanic!.responseObjectId,
    to: "armed",
  });
  s = apply(d, s, { kind: "start_event", eventId: e.id });
  assert.equal(s.engine!.events.length, 1);
  assert.equal(s.engine!.events[0].resolvedAt, undefined);
});
console.log(`Підсумок: ${passed} пройшло.`);
