import assert from "node:assert/strict";
import { analyzeLabyrinth, blankLabyrinth } from "../shared/labyrinthDesign";
import { labyrinthDemo } from "../shared/labyrinthDemo";
import { validateDefinition } from "../server/core/labyrinth/model";
let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("✓ " + name);
}
const copy = () => structuredClone(labyrinthDemo);
test("Нова карта з форм має валідну модель", () =>
  assert.equal(validateDefinition(blankLabyrinth("Книга")).nodes.length, 1));
test("Дворівневий приклад має вихід і обхід події", () =>
  assert.deepEqual(analyzeLabyrinth(labyrinthDemo), []));
test("Перевірка не змінює визначення карти", () => {
  const d = copy(),
    before = JSON.stringify(d);
  analyzeLabyrinth(d);
  assert.equal(JSON.stringify(d), before);
});
test("Вихід в ізольованій кімнаті недосяжний", () => {
  const d = copy();
  d.exitNodeIds = ["isolated-room"];
  assert.ok(analyzeLabyrinth(d).some((i) => i.code === "unreachable_exit"));
});
test("Напрямок ребра впливає на досяжність", () => {
  const d = copy();
  d.edges = [
    {
      ...d.edges[0],
      from: "lower-exit",
      to: "lower-entry",
      bidirectional: false,
    },
  ];
  assert.ok(analyzeLabyrinth(d).some((i) => i.code === "unreachable_exit"));
});
test("Початкові заблоковані виходи відрізняються від відсутніх переходів", () => {
  const d = copy();
  d.edges = d.edges.filter((e) => e.id === "corridor");
  d.edges[0].conditions = [{ objectId: "bridge-gate", state: "closed" }];
  const issues = analyzeLabyrinth(d);
  assert.ok(issues.some((i) => i.code === "initial_exit_blocked"));
  assert.ok(!issues.some((i) => i.code === "unreachable_exit"));
});
test("Ефект механізму перекриває останній вихід", () => {
  const d = copy();
  d.edges = d.edges.filter((e) => e.id === "corridor");
  d.edges[0].conditions = [{ objectId: "bridge-gate", state: "open" }];
  assert.ok(
    analyzeLabyrinth(d).some(
      (i) => i.code === "mechanism_no_exit" && i.targetId === "generator",
    ),
  );
});
test("Опис обходу не приховує відсутній маршрут", () => {
  const d = copy();
  d.edges = [];
  assert.ok(analyzeLabyrinth(d).some((i) => i.code === "event_no_escape"));
});
test("Наслідки події перевіряються при пошуку обходу", () => {
  const d = copy();
  d.edges = d.edges.filter((e) => e.id === "up");
  d.edges[0].conditions = [{ objectId: "bridge-gate", state: "open" }];
  d.events[0].effects = [{ objectId: "bridge-gate", state: "closed" }];
  assert.ok(analyzeLabyrinth(d).some((i) => i.code === "event_no_escape"));
});
test("Умови активації події враховані", () => {
  const d = copy();
  d.edges = d.edges.filter((e) => e.id === "up");
  d.edges[0].conditions = [{ objectId: "generator", state: "on" }];
  assert.ok(analyzeLabyrinth(d).some((i) => i.code === "event_no_escape"));
});
test("Небезпечна зона не вважається обходом", () => {
  const d = copy();
  d.events[0].nodeIds = d.nodes.map((n) => n.id);
  assert.ok(analyzeLabyrinth(d).some((i) => i.code === "event_no_escape"));
});
test("Порожня зона та відсутня підказка показані окремо", () => {
  const d = copy();
  d.events[0].nodeIds = [];
  d.events[0].avoidance = "";
  const issues = analyzeLabyrinth(d);
  assert.ok(issues.some((i) => i.code === "event_no_zone"));
  assert.ok(issues.some((i) => i.code === "missing_avoidance"));
});
test("Доданий автором обхід усуває конкретне зауваження", () => {
  const d = copy();
  d.edges = [];
  assert.ok(analyzeLabyrinth(d).some((i) => i.code === "event_no_escape"));
  d.edges = [copy().edges.find((e) => e.id === "up")!];
  assert.ok(!analyzeLabyrinth(d).some((i) => i.code === "event_no_escape"));
});
console.log(`Підсумок: ${passed} пройшло.`);
