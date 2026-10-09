import assert from "node:assert/strict";
import { labyrinthDemo } from "../shared/labyrinthDemo";
import { validateDefinition, stateHash } from "../server/core/labyrinth/model";
import {
  runtimeInitialState,
  runtimeAction,
  proveExit,
  eventPhase,
  effectiveObjects,
} from "../server/core/labyrinth/runtime";
let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`✓ ${name}`);
}
const world = () => {
  const d = structuredClone(labyrinthDemo);
  d.events[0].conditions = [];
  d.events[0].hazard = {
    resourceCosts: { health: 100 },
    blocksMovement: false,
  };
  return validateDefinition(d);
};
const start = (d: any) =>
  runtimeAction(d, runtimeInitialState(d), {
    kind: "start_event",
    eventId: "gas-warning",
  }).state;
test("Газ: герой встигає драбиною до активації", () => {
  const d = world(),
    s = start(d);
  assert.equal(eventPhase(d, s, "gas-warning"), "warning");
  const moved = runtimeAction(d, s, {
    kind: "move",
    heroId: "hero",
    edgeId: "up",
  });
  assert.equal(moved.state.heroes.hero.resources.health, 100);
  assert.equal(moved.state.heroes.hero.nodeId, "upper-left");
  assert.ok(moved.proof.actions.length);
});
test("Довгий перехід і надто коротке попередження не дають хибної безпеки", () => {
  const d = world();
  d.edges.forEach((e) => (e.duration = 3));
  assert.throws(() => start(d), /досяжного виходу/);
});
test("Прибуття в момент активації передує шкоді", () => {
  const d = world();
  d.edges.find((e) => e.id === "up")!.duration = 2;
  const s = start(d);
  assert.equal(
    runtimeAction(d, s, { kind: "move", heroId: "hero", edgeId: "up" }).state
      .heroes.hero.resources.health,
    100,
  );
});
test("Очікування, яке позбавляє порятунку, не змінює початковий стан", () => {
  const d = world(),
    s = start(d),
    hash = stateHash(s);
  const once = runtimeAction(d, s, { kind: "wait", heroId: "hero" }).state;
  assert.throws(() => runtimeAction(d, once, { kind: "wait", heroId: "hero" }));
  assert.equal(stateHash(s), hash);
});
test("Останній вихід і всі заплановані перекриття перевіряються разом", () => {
  const d = world();
  d.events = [];
  d.edges = d.edges.filter((e) => e.id === "corridor");
  d.edges[0].conditions = [{ objectId: "bridge-gate", state: "open" }];
  d.events = [
    {
      id: "close",
      nodeIds: [],
      conditions: [],
      warning: "Решітка опуститься",
      avoidance: "Пройти до закриття",
      preparation: 1,
      duration: 10,
      cooldown: 0,
      effects: [{ objectId: "bridge-gate", state: "closed" }],
    },
  ];
  d.heroes[0].resources.energy = 2; // waiting until it opens would still save the hero: make danger continuous during closure
  d.events[0].nodeIds = ["lower-entry"];
  d.events[0].hazard = {
    resourceCosts: { health: 100 },
    blocksMovement: false,
  };
  assert.throws(() =>
    runtimeAction(d, runtimeInitialState(d), {
      kind: "start_event",
      eventId: "close",
    }),
  );
});
test("Ефекти події тимчасові, після завершення повертається базовий стан", () => {
  const d = world();
  d.events[0].hazard = undefined;
  d.events[0].effects = [{ objectId: "bridge-gate", state: "closed" }];
  let s = start(d);
  for (let i = 0; i < 5; i++)
    s = runtimeAction(d, s, { kind: "wait", heroId: "hero" }).state;
  assert.equal(eventPhase(d, s, "gas-warning"), "cooldown");
  assert.equal(effectiveObjects(d, s)["bridge-gate"], "open");
  assert.throws(() =>
    runtimeAction(d, s, { kind: "start_event", eventId: "gas-warning" }),
  );
  for (let i = 0; i < 5; i++)
    s = runtimeAction(d, s, { kind: "wait", heroId: "hero" }).state;
  assert.equal(eventPhase(d, s, "gas-warning"), "ready");
});
test("Несумісні перекриття у спільному інтервалі відхиляються", () => {
  const d = world();
  d.events[0].hazard = undefined;
  d.events[0].effects = [{ objectId: "bridge-gate", state: "closed" }];
  d.events.push({
    ...d.events[0],
    id: "opposite",
    effects: [{ objectId: "bridge-gate", state: "open" }],
  });
  assert.throws(
    () =>
      runtimeAction(d, start(d), { kind: "start_event", eventId: "opposite" }),
    /Несумісні/,
  );
});
test("Ключові предмети враховуються в доказі маршруту", () => {
  const d = world();
  d.edges = d.edges.filter((e) => e.id === "corridor");
  d.edges[0].requiredItems = ["Ключ"];
  assert.throws(() => runtimeInitialState(d));
  d.heroes[0].inventory.push("Ключ");
  assert.ok(proveExit(d, runtimeInitialState(d)).actions.length);
});
test("Наслідки механізму додають знання та списують ресурси один раз", () => {
  const d = world();
  d.objects.find((o) => o.id === "generator")!.transitions[0].consequences = {
    resourceDelta: { energy: -1 },
    inventoryAdd: ["Ключ"],
    inventoryRemove: ["Ліхтар"],
    knowledgeAdd: ["Схема мосту"],
  };
  const validated = validateDefinition(d),
    s = runtimeInitialState(validated),
    next = runtimeAction(validated, s, {
      kind: "interact",
      heroId: "hero",
      objectId: "generator",
      to: "off",
    }).state;
  assert.equal(next.heroes.hero.resources.energy, 9);
  assert.deepEqual(next.heroes.hero.inventory, ["Ключ"]);
  assert.deepEqual(next.heroes.hero.knowledge, [
    ...s.heroes.hero.knowledge,
    "Схема мосту",
  ]);
});
test("Втрата єдиного необхідного ключа відхиляється", () => {
  const d = world();
  d.edges = d.edges.filter((e) => e.id === "corridor");
  d.edges[0].requiredItems = ["Ліхтар"];
  d.objects.find((o) => o.id === "generator")!.transitions[0].consequences = {
    resourceDelta: {},
    inventoryAdd: [],
    inventoryRemove: ["Ліхтар"],
    knowledgeAdd: [],
  };
  assert.throws(() =>
    runtimeAction(d, runtimeInitialState(d), {
      kind: "interact",
      heroId: "hero",
      objectId: "generator",
      to: "off",
    }),
  );
});
test("Бюджет перевірки вичерпано: дія не вважається безпечною", () =>
  assert.throws(
    () => proveExit(world(), runtimeInitialState(world()), 1),
    /бюджету/,
  ));
test("Невідомі поля, герої, небезпеки та груповий режим відхиляються", () => {
  const d = world(),
    s = runtimeInitialState(d);
  assert.throws(() =>
    runtimeAction(d, s, { kind: "wait", heroId: "hero", state: {} }),
  );
  assert.throws(() => runtimeAction(d, s, { kind: "wait", heroId: "other" }));
  assert.throws(() =>
    runtimeAction(d, s, { kind: "start_event", eventId: "missing" }),
  );
  d.heroes.push({ ...d.heroes[0], id: "second" });
  assert.throws(() => runtimeInitialState(d));
});

test("Дві заплановані пастки не перекривають останній маршрут разом", () => {
  const d = world();
  d.events = [];
  d.edges.find((e) => e.id === "bridge")!.conditions = [];
  d.edges.find((e) => e.id === "corridor")!.conditions = [
    { objectId: "bridge-gate", state: "open" },
  ];
  d.edges.find((e) => e.id === "up")!.conditions = [
    { objectId: "other-door", state: "closed" },
  ];
  const event = {
    id: "first",
    nodeIds: [],
    conditions: [],
    warning: "Невдовзі опуститься решітка",
    avoidance: "Драбина відкрита",
    preparation: 1,
    duration: 5,
    cooldown: 0,
    effects: [{ objectId: "bridge-gate", state: "closed" }],
  };
  d.events.push(event, {
    ...event,
    id: "second",
    nodeIds: d.nodes.map((n) => n.id),
    hazard: { resourceCosts: { health: 100 }, blocksMovement: false },
    effects: [{ objectId: "other-door", state: "open" }],
  });
  const state = runtimeAction(d, runtimeInitialState(d), {
    kind: "start_event",
    eventId: "first",
  }).state;
  assert.ok(
    proveExit(d, state).actions.some(
      (a) => a.kind === "move" && a.edgeId === "up",
    ),
  );
  assert.throws(() =>
    runtimeAction(d, state, { kind: "start_event", eventId: "second" }),
  );
  assert.equal(state.engine!.events.length, 1);
});
test("Прототипи не використовуються як ідентифікатори героїв", () => {
  const d = world();
  assert.throws(() =>
    runtimeAction(d, runtimeInitialState(d), {
      kind: "wait",
      heroId: "__proto__",
    }),
  );
});
test("Нуль здоров’я не дає почати чи продовжити живий прогін", () => {
  const d = world();
  d.heroes[0].resources.health = 0;
  assert.throws(() => runtimeInitialState(d));
  d.heroes[0].resources.health = 100;
  d.objects.find((o) => o.id === "generator")!.transitions[0].consequences = {
    resourceDelta: { health: -100 },
    inventoryAdd: [],
    inventoryRemove: [],
    knowledgeAdd: [],
  };
  assert.throws(() =>
    runtimeAction(d, runtimeInitialState(d), {
      kind: "interact",
      heroId: "hero",
      objectId: "generator",
      to: "off",
    }),
  );
  d.edges.find((e) => e.id === "corridor")!.costs.health = 100;
  assert.throws(() =>
    runtimeAction(d, runtimeInitialState(d), {
      kind: "move",
      heroId: "hero",
      edgeId: "corridor",
    }),
  );
});
console.log(`Підсумок: ${passed} пройшло.`);
