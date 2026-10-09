import assert from "node:assert/strict";
import express from "express";
import { importMazeFinal, MAZE_FINAL_FORMAT } from "../shared/mazeFinalImport";
import { validateDefinition } from "../server/core/labyrinth/model";
import {
  decideKitten,
  kittenContext,
  registerMazeKittenRoutes,
} from "../server/mazeKitten";
import { mazeFinalFixture } from "./mazeFinalFixture.mts";
import type { JevAdapter } from "../server/ai/adapters/jev";
let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("✓ " + name);
};
const raw = mazeFinalFixture(),
  before = JSON.stringify(raw),
  d = importMazeFinal(raw);
check("Сервер приймає імпортований граф із двома рівнями", () => {
  validateDefinition(d);
  assert.equal(d.nodes.length, 11);
  assert.equal(d.edges.filter((e) => e.kind === "stairs").length, 2);
  assert.deepEqual(d.edges.find((e) => e.kind === "bridge")?.overNodeIds, [
    "mf-1-1",
  ]);
});
check(
  "JSON-конверт і сирий MazeData дають одну карту; джерело незмінне",
  () => {
    assert.deepEqual(
      importMazeFinal({ format: MAZE_FINAL_FORMAT, version: 1, maze: raw }),
      d,
    );
    assert.equal(JSON.stringify(raw), before);
  },
);
check("Додаткові метадані не потрапляють у книгу", () =>
  assert.deepEqual(
    importMazeFinal({
      ...raw,
      apiKey: "not-a-secret",
      html: "<script>x</script>",
      progress: { health: 1 },
    }),
    d,
  ),
);
check("Невідома версія відхиляється", () =>
  assert.throws(() =>
    importMazeFinal({ format: MAZE_FINAL_FORMAT, version: 2, maze: raw }),
  ),
);
check("Парольні ключі не губляться мовчки", () =>
  assert.throws(() => importMazeFinal({ ...raw, keys: [{}] }), /Ключі/),
);
check("Неузгоджені стіни відхиляються", () => {
  const r = mazeFinalFixture();
  r.grid[0][0].walls.right = true;
  assert.throws(() => importMazeFinal(r), /стіни/);
});
check("Недосяжний вихід без телепортів відхиляється", () => {
  const r = mazeFinalFixture();
  r.grid[2][2].walls.top = true;
  r.grid[1][2].walls.bottom = true;
  r.grid[2][2].walls.left = true;
  r.grid[2][1].walls.right = true;
  assert.throws(() => importMazeFinal(r), /телепорт/);
});
check("Завелика карта та некоректний стан не приймаються", () => {
  assert.throws(() => importMazeFinal({ ...raw, width: 100, height: 100 }));
  assert.throws(() =>
    kittenContext({
      requestId: "valid-id",
      speed: NaN,
      distance: 1,
      onBridge: false,
    }),
  );
  assert.throws(() =>
    kittenContext({
      requestId: "valid-id",
      speed: 1,
      distance: 1,
      onBridge: false,
      apiKey: "x",
    }),
  );
});
const answer = {
  answers: { play: { choice: "chase", confidence: 0.9 }, safe: { noul: 0.95 } },
  model: "mock",
  usage: { input_tokens: 10, output_tokens: 0 },
  latency_ms: 1,
};
let calls = 0,
  records = 0;
let response = async () => answer;
const adapter: JevAdapter = {
  name: "mock",
  evaluate: async () => {
    throw Error("unused");
  },
  askState: async () => {
    calls++;
    return response();
  },
};
const context = { speed: 2, distance: 100, onBridge: false };
const result = await decideKitten(
  context,
  adapter,
  async () => true,
  async () => {
    records++;
  },
);
check("Контрольований Jev вибирає дозволену дію й обліковує відповідь", () => {
  assert.equal(result.action, "chase");
  assert.equal(result.source, "mock");
  assert.equal(records, 1);
});
check("Правила мосту мають пріоритет над модельним рішенням", () => {});
assert.equal(
  (
    await decideKitten(
      { ...context, onBridge: true },
      adapter,
      async () => true,
      async () => {},
    )
  ).action,
  "rest",
);
const count = calls;
assert.equal(
  (
    await decideKitten(
      context,
      adapter,
      async () => false,
      async () => {},
    )
  ).reason,
  "budget",
);
assert.equal(
  (
    await decideKitten(
      context,
      null,
      async () => {
        throw Error("must not reserve");
      },
      async () => {},
    )
  ).source,
  "rules",
);
check("Без ключа або бюджету модель не викликається", () =>
  assert.equal(calls, count),
);
response = async () => new Promise(() => {});
assert.equal(
  (
    await decideKitten(
      context,
      adapter,
      async () => true,
      async () => {},
      15,
    )
  ).reason,
  "timeout",
);
check("Таймаут повертає локальні правила", () => {});
response = async () => answer;
const app = express();
app.use(express.json());
let allowed = true,
  reservations = 0;
registerMazeKittenRoutes(app, {
  guard: (q, r, next) => {
    if (!q.headers["x-user"]) {
      r.status(401).end();
      return;
    }
    (q as any).principal = { id: "owner", isGuest: false };
    next();
  },
  adapter: async () => adapter,
  recheck: async () => allowed,
  reserve: async () => {
    reservations++;
    return "ok";
  },
  record: async () => {},
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + (server.address() as any).port;
const request = (id: string, extra = {}, auth = true) =>
  fetch(origin + "/api/maze-final/kitten", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { "x-user": "owner" } : {}),
    },
    body: JSON.stringify({ requestId: id, ...context, ...extra }),
  });
try {
  assert.equal((await request("guest-id", {}, false)).status, 401);
  const a = await request("repeat-id");
  assert.equal(a.status, 200);
  const json = await a.json();
  assert.deepEqual(await (await request("repeat-id")).json(), json);
  assert.equal(reservations, 1);
  assert.equal((await request("repeat-id", { distance: 200 })).status, 409);
  check(
    "API закритий гостям; повтор не оплачується; зміна стану конфліктує",
    () => {},
  );
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  response = async () => {
    entered();
    await new Promise<void>((r) => (release = r));
    return answer;
  };
  const pending = request("pending-id");
  await started;
  assert.equal((await request("second-id")).status, 429);
  assert.equal((await request("third-id")).status, 429);
  allowed = false;
  release();
  assert.equal((await pending).status, 403);
  check(
    "Конкурентні запити не знімають блокування; відкликані права відхиляють пізню відповідь",
    () => {},
  );
} finally {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
}
console.log(`Підсумок: ${passed} пройшло.`);
