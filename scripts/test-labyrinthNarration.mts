import assert from "node:assert/strict";
import {
  describeRoutes,
  headingFromEvents,
} from "../shared/labyrinthNarration";
import { labyrinthDemo } from "../shared/labyrinthDemo";
import svg from "../shared/labyrinthSvgExample.json";
import points from "../shared/labyrinthSvgPoints.json";
import {
  initialState,
  validateDefinition,
  structuralAction,
} from "../server/core/labyrinth/model";
import { analyzeLabyrinth } from "../shared/labyrinthDesign";
let count = 0;
const check = (name: string, fn: () => void) => {
  fn();
  count++;
  console.log("✓ " + name);
};
const d = structuredClone(labyrinthDemo),
  s = initialState(d);
check("Напрямок погляду змінює прямо на ліворуч", () => {
  const east = describeRoutes(d, s, "hero", "east"),
    south = describeRoutes(d, s, "hero", "south");
  assert.equal(
    east.choices.find((c) => c.edgeId === "corridor")?.direction,
    "йти прямо",
  );
  assert.equal(
    south.choices.find((c) => c.edgeId === "corridor")?.direction,
    "повернути ліворуч",
  );
});
check("Опис позначає конкретний вузол і міст над ним", () => {
  const v = describeRoutes(d, s, "hero", "east");
  assert.equal(v.nodeId, "lower-entry");
  assert.ok(v.description.includes("перекинутий через стіни"));
  assert.deepEqual(v.visibleBridgeIds, ["bridge"]);
});
check("Ресурси знижують доступність, а не змінюють граф", () => {
  const p = structuredClone(s);
  p.heroes.hero.resources.energy = 0;
  const v = describeRoutes(d, p, "hero", "east");
  assert.ok(v.choices.every((c) => !c.available));
  assert.ok(v.description.includes("бракує ресурсів"));
  assert.equal(d.edges.length, 4);
});
const up = structuralAction(d, s, {
  kind: "move",
  heroId: "hero",
  edgeId: "up",
}).state;
const over = structuralAction(d, up, {
  kind: "move",
  heroId: "hero",
  edgeId: "bridge",
}).state;
check("Після ходу місце й опис оновлюються разом", () => {
  const v = describeRoutes(d, over, "hero", "east");
  assert.equal(v.nodeId, "upper-right");
  assert.ok(v.description.includes("верхньому"));
  assert.ok(v.choices.some((c) => c.direction === "спуститися вниз"));
});
check("Закритий міст не названо доступним вибором", () => {
  const p = structuredClone(up);
  p.objects["bridge-gate"] = "closed";
  const v = describeRoutes(d, p, "hero", "east");
  assert.equal(v.choices.find((c) => c.edgeId === "bridge")?.available, false);
  assert.ok(v.description.includes("прохід зараз закритий"));
});
check("Односторонній зворотний маршрут не вигадується", () => {
  const p = structuredClone(d);
  p.edges.find((e) => e.id === "bridge")!.bidirectional = false;
  assert.ok(
    !describeRoutes(p, over, "hero", "west").choices.some(
      (c) => c.edgeId === "bridge",
    ),
  );
});
check("Опис не показує майбутні пастки, стани чужих героїв чи інвентар", () => {
  const p = structuredClone(d);
  p.events[0].warning = "HIDDEN_EVENT";
  p.heroes.push({ ...p.heroes[0], id: "other", name: "HIDDEN_HERO" });
  assert.ok(
    !JSON.stringify(describeRoutes(p, s, "hero", "east")).includes("HIDDEN"),
  );
});
check("Поворот назад визначено за напрямком погляду", () =>
  assert.equal(
    describeRoutes(d, over, "hero", "east").choices.find(
      (c) => c.edgeId === "bridge",
    )?.direction,
    "повернути назад",
  ),
);
check("Напрямок руху береться з checkpoint зворотного ходу", () => {
  const back = structuralAction(d, over, {
    kind: "move",
    heroId: "hero",
    edgeId: "bridge",
  }).state;
  assert.equal(
    headingFromEvents(
      d,
      [
        {
          action: { kind: "move", heroId: "hero", edgeId: "bridge" },
          state: back,
        },
      ],
      "hero",
    ),
    "west",
  );
});
check("Вертикальний хід без зміщення не скидає останній напрямок", () =>
  assert.equal(
    headingFromEvents(
      d,
      [
        {
          action: { kind: "move", heroId: "hero", edgeId: "down" },
          state: {
            ...over,
            heroes: { hero: { ...over.heroes.hero, nodeId: "lower-exit" } },
          },
        },
        {
          action: { kind: "move", heroId: "hero", edgeId: "bridge" },
          state: over,
        },
      ],
      "hero",
    ),
    "east",
  ),
);
check("Невідомий герой відхилений", () =>
  assert.throws(() => describeRoutes(d, s, "missing", "east")),
);
const actual = validateDefinition(svg);
check("SVG інтерпретація: 775 клітинок і 62 верхніх мости", () => {
  assert.equal(actual.nodes.filter((n) => n.level === "lower").length, 775);
  assert.equal(actual.edges.filter((e) => e.kind === "bridge").length, 62);
  assert.equal(actual.nodes.length, 899);
});
check("Всі вузли SVG мають координату для маркера", () => {
  for (const n of actual.nodes)
    assert.ok((points as Record<string, unknown>)[n.id]);
});
check("У графі SVG є шлях до виходу", () =>
  assert.ok(
    !analyzeLabyrinth(actual).some((i) => i.code === "unreachable_exit"),
  ),
);
check("Розгалуження й міст у реальному SVG описані за геометрією", () => {
  const p = initialState(actual);
  const bridge = actual.edges.find((e) => e.kind === "bridge")!;
  p.heroes.ivan.nodeId = bridge.overNodeIds[0];
  const v = describeRoutes(actual, p, "ivan", "south");
  assert.equal(v.nodeId, bridge.overNodeIds[0]);
  assert.ok(v.description.includes("Іван"));
  assert.ok(v.visibleBridgeIds.includes(bridge.id));
});
check("Опис не пропонує прохід без необхідного предмета", () => {
  const world = structuredClone(d);
  world.edges.find((e) => e.id === "corridor")!.requiredItems = ["Ключ"];
  const view = describeRoutes(world, s, "hero", "east");
  assert.equal(
    view.choices.find((c) => c.edgeId === "corridor")?.available,
    false,
  );
  assert.equal(
    view.choices.find((c) => c.edgeId === "corridor")?.reason,
    "потрібен предмет",
  );
});
console.log(`Підсумок: ${count} пройшло.`);
