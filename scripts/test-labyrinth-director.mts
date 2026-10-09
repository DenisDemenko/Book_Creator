import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { labyrinthDemo } from "../shared/labyrinthDemo";
import {
  DIRECTOR_DEFAULTS,
  directLabyrinth,
  type DirectorServices,
} from "../server/core/labyrinth/director";
import {
  runtimeInitialState,
  runtimeAction,
} from "../server/core/labyrinth/runtime";
import { validateDefinition, stateHash } from "../server/core/labyrinth/model";
import type { LabyrinthRun } from "../shared/labyrinth";
import { LlmFallbackJevAdapter } from "../server/ai/adapters/jev";
import type { JevAdapter } from "../server/ai/adapters/jev";
let count = 0;
const test = async (name: string, fn: () => unknown) => {
  await fn();
  count++;
  console.log("✓ " + name);
};
function world() {
  const d = structuredClone(labyrinthDemo);
  d.director = {
    ...DIRECTOR_DEFAULTS,
    enabled: true,
    confidenceThreshold: 0.5,
    maxModelCalls: 2,
    timeoutMs: 100,
  };
  d.events[0].conditions = [];
  d.events[0].director = { intent: "challenge", priority: 60 };
  d.events[0].hazard = { resourceCosts: { health: 10 }, blocksMovement: false };
  d.events.push(
    {
      ...d.events[0],
      id: "rescue",
      director: { intent: "rescue", priority: 80 },
      hazard: undefined,
      effects: [{ objectId: "bridge-gate", state: "open" }],
      warning: "Верхній прохід відкриється",
      avoidance: "Піднятися драбиною",
    },
    {
      ...d.events[0],
      id: "rest",
      director: { intent: "rest", priority: 20 },
      hazard: undefined,
      effects: [],
      warning: "Перепочинок",
      avoidance: "Оглянути маршрут",
    },
  );
  return validateDefinition(d);
}
function run(d = world()): LabyrinthRun {
  return {
    id: "test",
    projectId: "p",
    mapId: "m",
    mapRevision: 1,
    revision: 0,
    mode: "runtime",
    difficulty: "author_preview",
    seed: "repeatable",
    state: runtimeInitialState(d),
    participants: [],
    createdBy: "user:owner",
    createdAt: "2026-10-09T00:00:00Z",
  };
}
function adapter(
  choice = "gas-warning",
  name: "mock" | "jev" | "llm_fallback" = "mock",
  extra: any = {},
): JevAdapter {
  return {
    name,
    evaluate: async () => {
      throw new Error("Test uses askState only");
    },
    askState: async () => ({
      answers: {
        tension: { score: 2, confidence: 0.9 },
        fit: { noul: 0.95 },
        next_action: { choice, confidence: 0.95 },
        ...extra,
      },
      model: "controlled-test",
      usage: { input_tokens: 150, output_tokens: 40 },
      latency_ms: 1,
    }),
  } as JevAdapter;
}
await test("Одна карта: здоровий упевнений герой отримує дозволене ускладнення", async () => {
  const d = world(),
    r = run(d),
    out = await directLabyrinth(d, r, false);
  assert.equal(out.trace.eventId, "gas-warning");
  assert.equal(out.trace.source, "rules");
  assert.ok(out.proof.actions.length);
  assert.equal(out.state.engine!.events[0].eventId, "gas-warning");
  assert.deepEqual(r.state.engine!.events, []);
});
await test("Та сама карта: критично слабкому — безпечний шанс порятунку", async () => {
  const d = world(),
    r = run(d);
  r.state.heroes.hero.resources.health = 20;
  const out = await directLabyrinth(d, r, false);
  assert.equal(out.trace.critical, true);
  assert.equal(out.trace.eventId, "rescue");
  assert.ok(!out.trace.candidates.includes("gas-warning"));
  assert.equal(out.state.heroes.hero.resources.health, 20);
});
await test("Низькі ресурси не провокують ескалацію", async () => {
  const d = world(),
    r = run(d);
  r.state.heroes.hero.resources.energy = 1;
  d.edges.forEach((e) => (e.costs = {}));
  assert.equal((await directLabyrinth(d, r, false)).trace.eventId, "rescue");
});
await test("Score/Noul/Choice використовують чинний адаптер та дозволений список", async () => {
  const d = world(),
    out = await directLabyrinth(d, run(d), true, {
      primary: async () => adapter(),
    });
  assert.equal(out.trace.source, "mock");
  assert.equal(out.trace.calls, 1);
  assert.equal(out.trace.modelScore, 50);
  assert.equal(out.trace.noul, 0.95);
  assert.equal(out.state.engine!.director!.modelCalls, 1);
});
await test("Модель не може примусити критичного героя до ускладнення", async () => {
  const d = world(),
    r = run(d);
  r.state.heroes.hero.resources.health = 20;
  const out = await directLabyrinth(d, r, true, {
    primary: async () => adapter("gas-warning"),
  });
  assert.equal(out.trace.source, "rules");
  assert.equal(out.trace.eventId, "rescue");
  assert.equal(out.trace.reason, "uncertain_or_invalid");
});
await test("Збій Jev передає ті самі питання запасному LLM", async () => {
  const d = world(),
    out = await directLabyrinth(d, run(d), true, {
      primary: async () =>
        ({
          name: "jev",
          evaluate: async () => {
            throw new Error("Test uses askState only");
          },
          askState: async () => {
            throw new Error("secret-api-key");
          },
        }) as JevAdapter,
      fallback: async () => adapter("gas-warning", "llm_fallback"),
    });
  assert.equal(out.trace.source, "llm_fallback");
  assert.equal(out.trace.calls, 2);
  assert.ok(!JSON.stringify(out).includes("secret-api-key"));
});
await test("Бюджет обмежує спроби, а не лише успішні відповіді", async () => {
  const d = world();
  d.director!.maxModelCalls = 1;
  let fallback = 0;
  const out = await directLabyrinth(d, run(d), true, {
    primary: async () => adapter("invalid"),
    fallback: async () => {
      fallback++;
      return adapter();
    },
  });
  assert.equal(out.trace.calls, 1);
  assert.equal(fallback, 0);
  assert.equal(out.trace.source, "rules");
});
await test("Вичерпаний бюджет не викликає жоден провайдер", async () => {
  const d = world(),
    r = run(d);
  r.state.engine!.director!.modelCalls = 2;
  let called = 0;
  const out = await directLabyrinth(d, r, true, {
    primary: async () => {
      called++;
      return adapter();
    },
  });
  assert.equal(called, 0);
  assert.equal(out.trace.reason, "budget");
  assert.equal(out.trace.eventId, "gas-warning");
});
await test("Timeout повертає резервний сценарій; пізня відповідь нічого не змінює", async () => {
  const d = world(),
    r = run(d);
  let resolve: any;
  const started = performance.now();
  const out = await directLabyrinth(d, r, true, {
    primary: async () =>
      ({
        name: "jev",
        evaluate: async () => {
          throw new Error("Test uses askState only");
        },
        askState: () => new Promise((done) => (resolve = done)),
      }) as JevAdapter,
  });
  assert.equal(out.trace.reason, "timeout");
  assert.equal(out.trace.source, "rules");
  assert.ok(performance.now() - started < 1000);
  const hash = stateHash(out.state);
  resolve(await adapter("__no_event__").askState!({}, []));
  await Promise.resolve();
  assert.equal(stateHash(out.state), hash);
  assert.equal(out.trace.calls, 1);
});
await test("Невпевнена відповідь та низький Noul лишають безпечні правила", async () => {
  const d = world();
  const out = await directLabyrinth(d, run(d), true, {
    primary: async () =>
      adapter("gas-warning", "jev", {
        next_action: { choice: "gas-warning", confidence: 0.1 },
        fit: { noul: 0.2 },
      }),
  });
  assert.equal(out.trace.reason, "uncertain_or_invalid");
  assert.equal(out.trace.source, "rules");
});
await test("Cooldown не витрачає бюджет та не створює другу небезпеку", async () => {
  const d = world(),
    r = run(d),
    first = await directLabyrinth(d, r, false);
  const second = await directLabyrinth(d, { ...r, state: first.state }, true, {
    primary: async () => {
      throw Error("must not call");
    },
  });
  assert.equal(second.trace.reason, "cooldown");
  assert.equal(second.trace.calls, 0);
  assert.equal(second.state.engine!.events.length, 1);
});
await test("Небезпечний шаблон відкидається до моделі", async () => {
  const d = world();
  d.events[0].effects = [{ objectId: "bridge-gate", state: "closed" }];
  d.events[0].hazard!.resourceCosts.health = 100;
  d.edges.forEach((e) => (e.duration = 3));
  const out = await directLabyrinth(d, run(d), false);
  assert.ok(out.trace.rejected.some((e) => e.eventId === "gas-warning"));
  assert.notEqual(out.trace.eventId, "gas-warning");
});
await test("Без ключів або дозволених подій світ продовжується без ШІ", async () => {
  const d = world();
  d.events.forEach((e) => delete e.director);
  const r = run(d),
    out = await directLabyrinth(d, r, true);
  assert.equal(out.trace.eventId, null);
  assert.equal(out.trace.calls, 0);
  assert.deepEqual(out.state.heroes, r.state.heroes);
  const moved = runtimeAction(d, out.state, {
    kind: "move",
    heroId: "hero",
    edgeId: "up",
  });
  assert.equal(moved.state.heroes.hero.nodeId, "upper-left");
});
await test("Вибір none, завершений прогін і відтворюваний seed", async () => {
  const d = world(),
    r = run(d);
  const none = await directLabyrinth(d, r, true, {
    primary: async () => adapter("__no_event__"),
  });
  assert.equal(none.trace.eventId, null);
  assert.deepEqual(none.state.heroes, r.state.heroes);
  assert.equal(
    (await directLabyrinth(d, r, false)).trace.eventId,
    (await directLabyrinth(d, r, false)).trace.eventId,
  );
  r.state.heroes.hero.nodeId = "lower-exit";
  assert.equal((await directLabyrinth(d, r, false)).trace.reason, "completed");
});
await test("Рятувальний шаблон зі шкодою, невідомі поля та вимкнений директор відхиляються", async () => {
  const d = world();
  d.events.find((e) => e.id === "rescue")!.hazard = {
    resourceCosts: { health: 1 },
    blocksMovement: false,
  };
  assert.throws(() => validateDefinition(d));
  d.events.find((e) => e.id === "rescue")!.hazard = undefined;
  d.director!.enabled = false;
  await assert.rejects(() => directLabyrinth(d, run(d), false));
  assert.throws(() =>
    validateDefinition({
      ...world(),
      director: { ...DIRECTOR_DEFAULTS, timeoutMs: 99999 },
    }),
  );
});
await test("Впевненість маршруту використовує ходи, але не паузи чи швидкість читання", async () => {
  const d = world(),
    r = run(d);
  const moved = runtimeAction(d, r.state, {
    kind: "move",
    heroId: "hero",
    edgeId: "up",
  }).state;
  assert.equal(moved.engine!.director!.recentMoves.length, 1);
  const waited = runtimeAction(d, moved, {
    kind: "wait",
    heroId: "hero",
  }).state;
  assert.deepEqual(
    waited.engine!.director!.recentMoves,
    moved.engine!.director!.recentMoves,
  );
});
await test("Відмова в резервуванні бюджету не запускає модель", async () => {
  const d = world();
  let called = 0;
  const out = await directLabyrinth(d, run(d), true, {
    reserveAttempt: async () => false,
    primary: async () =>
      ({
        name: "jev",
        evaluate: async () => {
          throw new Error("Test uses askState only");
        },
        askState: async () => {
          called++;
          throw Error();
        },
      }) as JevAdapter,
  });
  assert.equal(out.trace.reason, "budget");
  assert.equal(out.trace.calls, 0);
  assert.equal(called, 0);
});
await test("Реальний адаптер запасного LLM працює без вигаданого confidence", async () => {
  const d = world();
  const fallback = new LlmFallbackJevAdapter(async () => ({
    text: JSON.stringify({
      answers: {
        tension: { score: 2 },
        fit: { probability: 0.95 },
        next_action: { choice: "gas-warning" },
      },
    }),
    modelId: "controlled-deepseek",
    inputTokens: 100,
    outputTokens: 40,
  }));
  const out = await directLabyrinth(d, run(d), true, {
    fallback: async () => fallback,
  });
  assert.equal(out.trace.source, "llm_fallback");
  assert.ok(out.trace.confidenceUncertainty.includes("не надав confidence"));
});
await test("Високий модельний Score зупиняє додаткове ускладнення", async () => {
  const d = world();
  const out = await directLabyrinth(d, run(d), true, {
    primary: async () =>
      adapter("gas-warning", "jev", {
        tension: { score: 4, confidence: 0.95 },
      }),
  });
  assert.equal(out.trace.reason, "model_pressure_pause");
  assert.equal(out.trace.eventId, null);
  assert.equal(out.trace.modelScore, 100);
});
await test("Витрати двох відповідей сумуються; невідома витрата позначається", async () => {
  const d = world();
  const out = await directLabyrinth(d, run(d), true, {
    primary: async () => adapter("invalid"),
    fallback: async () => adapter("gas-warning", "llm_fallback"),
  });
  assert.equal(out.trace.usage.inputTokens, 300);
  assert.equal(out.trace.usage.outputTokens, 80);
  assert.equal(out.trace.usage.unknownAttempts, 0);
});
const timings: Record<string, number[]> = {
  offline: [],
  controlled_model: [],
  controlled_timeout: [],
};
for (let i = 0; i < 5; i++) {
  const d = world();
  timings.offline.push(
    (await directLabyrinth(d, run(d), false)).trace.latencyMs,
  );
  timings.controlled_model.push(
    (await directLabyrinth(d, run(d), true, { primary: async () => adapter() }))
      .trace.latencyMs,
  );
}
for (let i = 0; i < 3; i++) {
  const d = world();
  timings.controlled_timeout.push(
    (
      await directLabyrinth(d, run(d), true, {
        primary: async () => ({
          name: "jev",
          evaluate: async () => {
            throw Error();
          },
          askState: () => new Promise(() => {}),
        }),
      })
    ).trace.latencyMs,
  );
}
const timingSummary = Object.fromEntries(
  Object.entries(timings).map(([key, values]) => [
    key,
    {
      samples: values.length,
      minMs: Math.min(...values),
      maxMs: Math.max(...values),
      medianMs: [...values].sort((a, b) => a - b)[
        Math.floor(values.length / 2)
      ],
    },
  ]),
);
writeFileSync(
  "/tmp/t94-director-latency.json",
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      source: "local deterministic/controlled adapters; no real provider",
      ...timingSummary,
    },
    null,
    2,
  ),
);
console.log("Затримки: " + JSON.stringify(timingSummary));
console.log(`Підсумок: ${count} пройшло.`);
