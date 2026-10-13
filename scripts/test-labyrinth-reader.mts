import { canAccessTab, getRolePermissions } from "../src/utils/rbac";
import { buildAppPath, parseAppPath } from "../src/utils/appRoutes";
import assert from "node:assert/strict";
import { labyrinthDemo } from "../shared/labyrinthDemo";
import { readerAction, readerProjection, readerWorld } from "../server/core/labyrinth/reader";
import { runtimeInitialState, runtimeAction } from "../server/core/labyrinth/runtime";
import { stateHash } from "../server/core/labyrinth/model";
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log("✓ " + name); };
const d = structuredClone(labyrinthDemo);
d.heroes.push({ ...structuredClone(d.heroes[0]), id: "other", name: "OTHER_HERO", knowledge: ["OTHER_PRIVATE"] });
d.nodes.find((n) => n.id === "isolated-room")!.title = "SECRET_TITLE";
d.nodes.find((n) => n.id === "upper-right")!.title = "FUTURE_BRIDGE_END";
d.events[0].conditions = [];
d.events.push({ ...structuredClone(d.events[0]), id: "secret-event", nodeIds: ["isolated-room"], warning: "FUTURE_EVENT", avoidance: "SECRET_SOLUTION" });
const world = readerWorld(d, "hero"), initial = runtimeInitialState(world);
const view = (state = initial, visited = ["lower-entry"]) =>
  readerProjection(d, state, "hero", visited, "north", {});
test("Перший вузол відкриває лише поточне місце та сусідні переходи", () => {
  assert.deepEqual(new Set(view().map.nodes.map((n) => n.id)), new Set(["lower-entry","lower-exit","upper-left"]));
  assert.equal(view().map.currentNodeId, "lower-entry");
});
test("Інший герой, далека кімната, план подій і майбутній край мосту не витікають", () => {
  const json = JSON.stringify(view());
  for (const s of ["OTHER_HERO","OTHER_PRIVATE","SECRET_TITLE","FUTURE_EVENT","SECRET_SOLUTION","FUTURE_BRIDGE_END"])
    assert.ok(!json.includes(s), s);
  for (const key of ["state","engine","definition","events","proof","trace"]) assert.ok(!Object.hasOwn(view(),key));
  assert.match(view().description, /невідкрите місце/);
});
test("Знання та предмети власного героя доступні", () => {
  assert.deepEqual(view().hero.knowledge, ["Вхід під мостом"]);
  assert.deepEqual(view().hero.inventory, ["Ліхтар"]);
});
test("Відвідані вузли зберігають відкриті сусідства та обидва рівні", () => {
  const state = runtimeAction(world, initial, { kind: "move", heroId: "hero", edgeId: "up" }).state;
  const v = view(state, ["lower-entry","upper-left"]);
  assert.equal(v.map.currentNodeId, "upper-left");
  assert.ok(v.map.nodes.some((n) => n.id === "upper-right"));
  assert.ok(!v.map.nodes.some((n) => n.id === "isolated-room"));
  assert.equal(v.map.nodes.filter((n) => n.current).length, 1);
});
test("Закритий перехід має нейтральну причину, без таємних умов чи ефектів", () => {
  const state = structuredClone(initial); state.heroes.hero.nodeId = "upper-left"; state.objects["bridge-gate"] = "closed";
  const v = view(state, ["upper-left"]);
  const choice = v.choices.find((c) => c.edgeId === "bridge")!;
  assert.equal(choice.available, false); assert.equal(choice.reason, "прохід зараз закритий");
  assert.ok(!JSON.stringify(choice).includes("bridge-gate"));
});
test("Показується лише вже запущене локальне попередження", () => {
  assert.equal(view().warnings.length, 0);
  const started = runtimeAction(world, initial, { kind: "start_event", eventId: "gas-warning" }).state;
  assert.deepEqual(view(started).warnings, [{ phase: "warning", text: "У коридорі чути шипіння.", avoidance: "Піднятися драбиною" }]);
});
test("Віддалені взаємодії та ефекти не включені в DTO", () => {
  const v = view(); assert.equal(v.interactions.length, 1);
  assert.equal(v.interactions[0].objectId, "generator");
  assert.ok(!JSON.stringify(v.interactions).includes("bridge-gate"));
  assert.ok(!JSON.stringify(v).includes("other-door"));
});
test("Вихід завершує читання й прибирає дії", () => {
  const state = runtimeAction(world, initial, { kind: "move", heroId: "hero", edgeId: "corridor" }).state;
  const v = view(state, ["lower-entry","lower-exit"]);
  assert.equal(v.completed, true); assert.deepEqual(v.choices, []); assert.deepEqual(v.interactions, []);
});
test("Сервер сам призначає героя; авторські та сторонні поля заборонені", () => {
  assert.deepEqual(readerAction({kind:"wait"},"hero"), {kind:"wait",heroId:"hero"});
  for (const action of [{kind:"wait",heroId:"other"}, {kind:"start_event",eventId:"gas-warning"},
    {kind:"director",useAI:true}, {kind:"move",edgeId:"up",state:{}}, {kind:"interact",objectId:"generator",to:"off",seed:"x"}])
    assert.throws(() => readerAction(action,"hero"), /Некоректна/);
});
test("Проєкція та вибір героя не змінюють стан або канон", () => {
  const before = stateHash([d,initial]); view(); readerWorld(d,"other");
  assert.equal(stateHash([d,initial]), before);
  assert.throws(() => readerWorld(d,"missing"), /Виберіть героя/);
});
test("Роль читача має окремий пункт меню без прав авторського конструктора", () => {
  assert.equal(canAccessTab("reader","labyrinth-reader"),true);
  assert.equal(canAccessTab("reader","structure"),false);
  assert.equal(canAccessTab("guest","labyrinth-reader"),false);
  assert.equal(getRolePermissions("reader").canEditContent,false);
});
test("Пряме посилання читача розбирається і зберігає book id під /studio", () => {
  const path = buildAppPath({projectId:"test-book",tab:"labyrinth-reader"},"/studio")!;
  assert.equal(path,"/studio/projects/test-book/labyrinth-reader");
  assert.equal(parseAppPath(path,"/studio")?.tab,"labyrinth-reader");
});
console.log("Підсумок: " + passed + " пройшло.");
