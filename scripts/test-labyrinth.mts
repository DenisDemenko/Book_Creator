import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { labyrinthDemo } from "../shared/labyrinthDemo";
import {
  initialState,
  LabyrinthError,
  stateHash,
  structuralAction,
  validateDefinition,
} from "../server/core/labyrinth/model";
import { PgLabyrinthStore } from "../server/core/labyrinth/store";
import { registerLabyrinthRoutes } from "../server/core/labyrinth/routes";
import {
  createCorePool,
  initCore,
  getLabyrinthStore,
  shutdownCore,
} from "../server/core/index";
import {
  loadMigrations,
  resolveMigrationsDir,
  runMigrations,
} from "../server/core/migrate";
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("✓ " + name);
}
const invalid = (edit: (d: typeof labyrinthDemo) => void) => {
  const d = structuredClone(labyrinthDemo);
  edit(d);
  assert.throws(() => validateDefinition(d), LabyrinthError);
};
const d = validateDefinition(labyrinthDemo),
  start = initialState(d);
check("Структура: два рівні й коридори під мостом", () =>
  assert.deepEqual(d.edges.find((e) => e.id === "bridge")?.overNodeIds, [
    "lower-entry",
    "lower-exit",
  ]),
);
check("Граф і початковий стан не розділяють змінні об’єкти", () => {
  const s = initialState(d);
  s.heroes.hero.resources.energy = 0;
  s.objects.generator = "off";
  assert.equal(d.heroes[0].resources.energy, 10);
  assert.equal(start.objects.generator, "on");
});
let state = structuralAction(d, start, {
  kind: "move",
  heroId: "hero",
  edgeId: "up",
}).state;
state = structuralAction(d, state, {
  kind: "move",
  heroId: "hero",
  edgeId: "bridge",
}).state;
state = structuralAction(d, state, {
  kind: "move",
  heroId: "hero",
  edgeId: "down",
}).state;
check("Драбина → міст над коридором → сходи до виходу", () => {
  assert.equal(state.heroes.hero.nodeId, "lower-exit");
  assert.equal(state.turn, 3);
  assert.equal(state.storyTime, 3);
  assert.equal(state.heroes.hero.resources.energy, 8);
  assert.equal(start.heroes.hero.nodeId, "lower-entry");
});
check("Дія знизу змінює лише генератор і явно пов’язану верхню решітку", () => {
  const s = structuralAction(d, start, {
    kind: "interact",
    heroId: "hero",
    objectId: "generator",
    to: "off",
  }).state;
  assert.equal(s.objects.generator, "off");
  assert.equal(s.objects["bridge-gate"], "closed");
  assert.equal(s.objects["other-door"], "closed");
  const up = structuralAction(d, s, {
    kind: "move",
    heroId: "hero",
    edgeId: "up",
  }).state;
  assert.throws(
    () =>
      structuralAction(d, up, {
        kind: "move",
        heroId: "hero",
        edgeId: "bridge",
      }),
    (e) => e instanceof LabyrinthError && e.status === 409,
  );
});
check("Із нижнього коридору не можна телепортуватися на міст", () =>
  assert.throws(
    () =>
      structuralAction(d, start, {
        kind: "move",
        heroId: "hero",
        edgeId: "bridge",
      }),
    LabyrinthError,
  ),
);
check("Чужий об’єкт не можна перемкнути на відстані", () =>
  assert.throws(
    () =>
      structuralAction(d, start, {
        kind: "interact",
        heroId: "hero",
        objectId: "other-door",
        to: "open",
      }),
    LabyrinthError,
  ),
);
check("Вартість переходу перевіряється до зміни стану", () => {
  const s = initialState(d);
  s.heroes.hero.resources.energy = 0;
  assert.throws(
    () =>
      structuralAction(d, s, { kind: "move", heroId: "hero", edgeId: "up" }),
    LabyrinthError,
  );
  assert.equal(s.heroes.hero.nodeId, "lower-entry");
});
check(
  "Невідомі поля, ШІ-параметри й ідентифікатори prototype не приймаються",
  () => {
    assert.throws(
      () => validateDefinition({ ...d, apiKey: "fake" }),
      LabyrinthError,
    );
    invalid((x) => (x.heroes[0].id = "constructor"));
    assert.throws(
      () =>
        structuralAction(d, start, {
          kind: "move",
          heroId: "hero",
          edgeId: "up",
          objectId: "generator",
        }),
      LabyrinthError,
    );
  },
);
check("Повторні вузли й переходи відхиляються", () => {
  invalid((x) => x.nodes.push(x.nodes[0]));
  invalid((x) => x.edges.push(x.edges[0]));
});
check("Невідомі вузли/об’єкти/стани відхиляються", () => {
  invalid((x) => (x.edges[0].to = "missing"));
  invalid((x) => (x.edges[2].conditions[0].objectId = "missing"));
  invalid((x) => (x.edges[2].conditions[0].state = "missing"));
});
check("Міст не може стати нижнім або з’єднати різні рівні", () => {
  invalid((x) => (x.edges[0].kind = "bridge"));
  invalid((x) => (x.edges[1].kind = "bridge"));
});
check("Під мостом не може бути верхній вузол", () =>
  invalid((x) => (x.edges[2].overNodeIds = ["upper-left"])),
);
check("Вертикальні переходи не з’єднують один рівень", () =>
  invalid((x) => (x.edges[0].kind = "stairs")),
);
check("Конфліктні ефекти та неоднозначні переходи відхиляються", () => {
  invalid((x) => x.objects[1].transitions.push(x.objects[1].transitions[0]));
  invalid((x) =>
    x.objects[1].transitions[0].effects.push(
      x.objects[1].transitions[0].effects[0],
    ),
  );
});
check("Негативні ресурси, NaN і порожні виходи відхиляються", () => {
  invalid((x) => (x.heroes[0].resources.energy = -1));
  invalid((x) => (x.nodes[0].x = NaN));
  invalid((x) => (x.exitNodeIds = []));
});
check("Шаблон небезпеки потребує попередження й часу підготовки", () => {
  invalid((x) => (x.events[0].warning = ""));
  invalid((x) => (x.events[0].preparation = 0));
});
check("Hash стабільний після JSONB-перестановки ключів", () =>
  assert.equal(
    stateHash({ b: 2, a: { z: 1, y: 3 } }),
    stateHash({ a: { y: 3, z: 1 }, b: 2 }),
  ),
);

if (process.env.CORE_TEST_DATABASE_URL) {
  let pool = createCorePool(process.env.CORE_TEST_DATABASE_URL);
  const migrated = await runMigrations(
    pool,
    loadMigrations(resolveMigrationsDir()),
  );
  check("Міграція 35 та її повтор без змін", () =>
    assert.equal(migrated.schemaVersion, 35),
  );
  const again = await runMigrations(
    pool,
    loadMigrations(resolveMigrationsDir()),
  );
  check("Повтор міграцій не додає версії", () =>
    assert.equal(again.applied.length, 0),
  );
  const previousCoreUrl = process.env.CORE_DATABASE_URL;
  process.env.CORE_DATABASE_URL = process.env.CORE_TEST_DATABASE_URL;
  try {
    const status = await initCore(() => {});
    check(
      "Штатний startup ядра підключає store лише після готовності v35",
      () => {
        assert.equal(status.state, "ready");
        assert.equal(status.schemaVersion, 35);
        assert.ok(getLabyrinthStore());
      },
    );
  } finally {
    await shutdownCore();
    if (previousCoreUrl === undefined) delete process.env.CORE_DATABASE_URL;
    else process.env.CORE_DATABASE_URL = previousCoreUrl;
  }
  check("Shutdown ядра закриває доступ до store", () =>
    assert.equal(getLabyrinthStore(), null),
  );
  let store: PgLabyrinthStore | null = new PgLabyrinthStore(pool);
  const project = "labyrinth-" + Date.now(),
    other = project + "-other";
  await pool.query(
    "INSERT INTO projects(id,owner_id,title,revision) VALUES($1,$2,$3,7),($4,$5,$6,0)",
    [project, "owner", "Канон оригіналу", other, "other", "Інша книга"],
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = String(req.headers["x-test-user"] ?? "guest");
    req.principal = {
      id: who === "guest" ? null : who,
      role: who === "admin" ? "admin" : "user",
      isGuest: who === "guest",
      disabled: who === "disabled",
    } as any;
    next();
  });
  registerLabyrinthRoutes(app, {
    store: () => store,
    access: {
      getCollabOwnerId: async () => undefined,
      getBookOwnerId: async (id) =>
        id === project ? "owner" : id === other ? "other" : null,
      listAcceptedInvites: async () => [
        { acceptedUserId: "reader", role: "reader" },
        { acceptedUserId: "editor", role: "editor" },
      ],
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (
    path: string,
    method = "GET",
    body?: unknown,
    who = "owner",
    book = project,
  ) => {
    const response = await fetch(
      `${origin}/api/core/projects/${book}/labyrinth${path}`,
      {
        method,
        headers: { "x-test-user": who, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return {
      status: response.status,
      body: await response.json(),
      cache: response.headers.get("cache-control"),
    };
  };
  const accepted = async (
    name: string,
    promise: Promise<{ status: number; body: any }>,
    status = 200,
  ) => {
    const r = await promise;
    assert.equal(r.status, status, JSON.stringify(r.body));
    passed++;
    console.log("✓ " + name);
    return r.body;
  };
  try {
    for (const who of ["guest", "disabled", "stranger", "reader", "editor"])
      await accepted(
        `${who}: закрито навіть читання повного графа`,
        request("/maps", "GET", undefined, who),
        ["guest", "disabled"].includes(who) ? 401 : 403,
      );
    await accepted(
      "Невірна книга закрита",
      request("/maps", "GET", undefined, "owner", "missing"),
      403,
    );
    for (const who of ["guest", "disabled", "stranger", "reader", "editor"])
      await accepted(
        `${who}: перевірка дизайну теж приватна`,
        request("/validate", "POST", { definition: d }, who),
        ["guest", "disabled"].includes(who) ? 401 : 403,
      );
    const validated = await accepted(
      "Сервер перевіряє дизайн без запису версії",
      request("/validate", "POST", { definition: d }),
    );
    check("Приклад проходить статичну перевірку", () =>
      assert.deepEqual(validated.issues, []),
    );
    const badDesign = structuredClone(d);
    badDesign.exitNodeIds = ["isolated-room"];
    const warning = await accepted(
      "Недосяжний вихід повертається як зауваження",
      request("/validate", "POST", { definition: badDesign }),
    );
    check("Зауваження має код і ціль", () =>
      assert.ok(
        warning.issues.some(
          (i: any) =>
            i.code === "unreachable_exit" && i.targetId === "isolated-room",
        ),
      ),
    );
    const badRef = structuredClone(d);
    badRef.nodes[0].sceneId = "not-in-this-book";
    await accepted(
      "Design API відхиляє чужу/відсутню сцену",
      request("/validate", "POST", { definition: badRef }),
      422,
    );
    await accepted(
      "Design API відхиляє підміну actor",
      request("/validate", "POST", { definition: d, actor: "user:admin" }),
      422,
    );
    const mapsAfterValidation = await request("/maps");
    check("Валідація не створює карту", () =>
      assert.equal(mapsAfterValidation.body.maps.length, 0),
    );
    const v1 = await accepted(
      "Автор зберігає незмінну карту v1",
      request("/maps", "POST", { definition: d, expectedRevision: 0 }),
      201,
    );
    check("Версія має джерело канону та hash", () => {
      assert.equal(v1.bookRevision, 7);
      assert.equal(v1.hash, stateHash(d));
      assert.equal(v1.createdBy, "user:owner");
    });
    const r1 = await accepted(
      "Прогін прив’язаний до v1 та seed",
      request(`/maps/${v1.mapId}/runs`, "POST", {
        mapRevision: 1,
        seed: "repeatable-seed",
      }),
      201,
    );
    check("Авторський preview має явного учасника, героїв і режим", () => {
      assert.equal(r1.difficulty, "author_preview");
      assert.deepEqual(r1.participants, [
        { userId: "owner", heroIds: ["hero"] },
      ]);
    });
    await accepted(
      "Читання чужого run ID не розкриває дані",
      request(`/runs/${r1.id}`, "GET", undefined, "other", other),
      404,
    );
    await accepted(
      "Чужа версія не створює прогін в іншій книзі",
      request(
        `/maps/${v1.mapId}/runs`,
        "POST",
        { mapRevision: 1, seed: "seed" },
        "other",
        other,
      ),
      404,
    );
    await accepted(
      "API не приймає довільну ревізію/стан",
      request(`/runs/${r1.id}/structural-actions`, "POST", {
        expectedRevision: "0",
        action: { kind: "move", heroId: "hero", edgeId: "up" },
      }),
      422,
    );
    const first = await accepted(
      "API: драбина піднімає героя на верхній рівень",
      request(`/runs/${r1.id}/structural-actions`, "POST", {
        expectedRevision: 0,
        action: { kind: "move", heroId: "hero", edgeId: "up" },
      }),
    );
    const second = await accepted(
      "API: прохід мостом над нижнім коридором",
      request(`/runs/${r1.id}/structural-actions`, "POST", {
        expectedRevision: 1,
        action: { kind: "move", heroId: "hero", edgeId: "bridge" },
      }),
    );
    check("Журнал містить причину, автора й фактичні наслідки", () => {
      assert.equal(second.event.mapRevision, 1);
      assert.equal(second.event.actor, "user:owner");
      assert.equal(second.event.beforeHash, first.event.afterHash);
      assert.equal(second.event.afterHash, stateHash(second.run.state));
    });
    const edits = structuredClone(d);
    edits.title = "Нова карта";
    edits.edges = edits.edges.filter((e) => e.id !== "bridge");
    const v2 = await accepted(
      "Нова версія карти додається без підміни старої",
      request(`/maps/${v1.mapId}/versions`, "POST", {
        definition: edits,
        expectedRevision: 1,
      }),
      201,
    );
    check("Дві версії різні", () => assert.notEqual(v1.hash, v2.hash));
    const v1Reload = await accepted(
      "Старий граф з мостом доступний незмінним",
      request(`/maps/${v1.mapId}/versions/1`),
    );
    check("Snapshot v1 збережений", () => assert.equal(v1Reload.hash, v1.hash));
    const old = await accepted(
      "Старий прогін пам’ятає свою версію",
      request(`/runs/${r1.id}`),
    );
    check("Старий прогін лишився на мосту v1", () => {
      assert.equal(old.mapRevision, 1);
      assert.equal(old.state.heroes.hero.nodeId, "upper-right");
    });
    await accepted(
      "Застаріла карта не переписується",
      request(`/maps/${v1.mapId}/versions`, "POST", {
        definition: d,
        expectedRevision: 1,
      }),
      409,
    );
    const race = await Promise.all([
      request(`/runs/${r1.id}/structural-actions`, "POST", {
        expectedRevision: 2,
        action: { kind: "move", heroId: "hero", edgeId: "down" },
      }),
      request(`/runs/${r1.id}/structural-actions`, "POST", {
        expectedRevision: 2,
        action: { kind: "move", heroId: "hero", edgeId: "bridge" },
      }),
    ]);
    check("Одночасні дії: один успіх, один конфлікт", () =>
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]),
    );
    const events = await accepted(
      "Журнал містить initial checkpoint і кожну успішну дію",
      request(`/runs/${r1.id}/events`),
    );
    check("Невдала дія не створила дубля", () =>
      assert.deepEqual(
        events.events.map((e: any) => e.revision),
        [0, 1, 2, 3],
      ),
    );
    const r2 = await accepted(
      "Незалежний другий прогін створено",
      request(`/maps/${v1.mapId}/runs`, "POST", {
        mapRevision: 1,
        seed: "second-seed",
      }),
      201,
    );
    const switched = await accepted(
      "API: дія знизу змінює тільки зв’язані об’єкти",
      request(`/runs/${r2.id}/structural-actions`, "POST", {
        expectedRevision: 0,
        action: {
          kind: "interact",
          heroId: "hero",
          objectId: "generator",
          to: "off",
        },
      }),
    );
    check("Інша кімната не змінена", () =>
      assert.equal(switched.run.state.objects["other-door"], "closed"),
    );
    check("Інший прогін не змінений", () =>
      assert.equal(old.state.objects.generator, "on"),
    );
    const beforeRestart = await accepted(
      "Контрольна точка до перезапуску",
      request(`/runs/${r2.id}`),
    );
    await pool.end();
    pool = createCorePool(process.env.CORE_TEST_DATABASE_URL);
    store = new PgLabyrinthStore(pool);
    const restored = await accepted(
      "Перезапуск пулу/сховища відновлює прогін",
      request(`/runs/${r2.id}`),
    );
    check("Після перезапуску стан, seed і ревізія ті самі", () =>
      assert.deepEqual(restored, beforeRestart),
    );
    await assert.rejects(
      pool.query(
        "UPDATE labyrinth_versions SET definition=$1 WHERE project_id=$2 AND map_id=$3 AND revision=1",
        [JSON.stringify(edits), project, v1.mapId],
      ),
      (e) => (e as any).code === "23514",
    );
    passed++;
    console.log("✓ SQL не дозволяє переписати snapshot");
    await assert.rejects(
      pool.query(
        "UPDATE labyrinth_run_events SET event=$1 WHERE project_id=$2 AND run_id=$3 AND revision=0",
        ["{}", project, r1.id],
      ),
      (e) => (e as any).code === "23514",
    );
    passed++;
    console.log("✓ SQL не дозволяє переписати контрольну точку");
    const ref = structuredClone(d);
    ref.nodes[0].sceneId = "other-scene";
    await pool.query(
      "INSERT INTO documents(project_id,id,kind,title) VALUES($1,'other-scene','section','Чужа сцена')",
      [other],
    );
    await accepted(
      "Чужа сцена не потрапляє у карту",
      request("/maps", "POST", { definition: ref, expectedRevision: 0 }),
      422,
    );
    await accepted(
      "Невалідний граф не створює карту",
      request("/maps", "POST", {
        definition: { ...d, nodes: [] },
        expectedRevision: 0,
      }),
      422,
    );
    const maps = await accepted(
      "Список карт містить метадані без великих приватних графів",
      request("/maps"),
    );
    check("Граф читається окремим версійним endpoint", () =>
      assert.equal(maps.maps[0].definition, undefined),
    );
    await accepted(
      "Адміністратор бачить авторські метадані",
      request("/maps", "GET", undefined, "admin"),
    );
    const versionsRace = await Promise.all([
      request(`/maps/${v1.mapId}/versions`, "POST", {
        definition: edits,
        expectedRevision: 2,
      }),
      request(`/maps/${v1.mapId}/versions`, "POST", {
        definition: d,
        expectedRevision: 2,
      }),
    ]);
    check("Одночасні версії карти: один append, один конфлікт", () =>
      assert.deepEqual(versionsRace.map((r) => r.status).sort(), [201, 409]),
    );
    await pool.query(
      "INSERT INTO documents(project_id,id,kind,title) VALUES($1,'own-scene','section','Власна сцена')",
      [project],
    );
    const entity = await pool.query(
      "INSERT INTO entities(project_id,type,name,status,created_by) VALUES($1,'character','Герой ядра','confirmed','user:owner') RETURNING id",
      [project],
    );
    const linked = structuredClone(d);
    linked.nodes[0].sceneId = "own-scene";
    linked.heroes[0].entityId = entity.rows[0].id;
    await accepted(
      "Сцена та персонаж повторно використовують ідентифікатори цієї книги",
      request("/maps", "POST", { definition: linked, expectedRevision: 0 }),
      201,
    );
    const foreignEntity = await pool.query(
      "INSERT INTO entities(project_id,type,name,status,created_by) VALUES($1,'character','Чужий герой','confirmed','user:other') RETURNING id",
      [other],
    );
    linked.heroes[0].entityId = foreignEntity.rows[0].id;
    await accepted(
      "Чужий персонаж не потрапляє в карту",
      request("/maps", "POST", { definition: linked, expectedRevision: 0 }),
      422,
    );
    const r3 = await accepted(
      "Новий прогін використовує v2",
      request(`/maps/${v1.mapId}/runs`, "POST", {
        mapRevision: 2,
        seed: "version-two",
      }),
      201,
    );
    await accepted(
      "У v2 видаленого мосту немає",
      request(`/runs/${r3.id}/structural-actions`, "POST", {
        expectedRevision: 0,
        action: { kind: "move", heroId: "hero", edgeId: "bridge" },
      }),
      422,
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO labyrinth_runs(project_id,map_id,map_revision,seed,state,created_by,participants) VALUES($1,$2,1,$3,$4,$5,'[]')",
        [other, v1.mapId, "cross-book", JSON.stringify(start), "user:other"],
      ),
      (e) => (e as any).code === "23503",
    );
    passed++;
    console.log("✓ Складений FK бази відхиляє чужу версію навіть повз API");
    const canon = await pool.query(
      "SELECT title,revision FROM projects WHERE id=$1",
      [project],
    );
    check("Канон оригіналу не змінений", () =>
      assert.deepEqual(canon.rows[0], {
        title: "Канон оригіналу",
        revision: 7,
      }),
    );
    if (process.argv.includes("--browser")) {
      const { liveLabyrinthBuilder } =
        await import("./live-labyrinthBuilder.mts");
      passed += await liveLabyrinthBuilder(app, origin, project, pool);
    }
    await pool.query("DELETE FROM projects WHERE id=$1", [project]);
    const removed = await pool.query(
      "SELECT count(*)::int n FROM labyrinth_runs WHERE project_id=$1",
      [project],
    );
    check("Видалення тестового проєкту прибирає його прогін", () =>
      assert.equal(removed.rows[0].n, 0),
    );
    const response = await request("/maps");
    check("Приватні відповіді не кешуються", () =>
      assert.equal(response.cache, "no-store"),
    );
    store = null;
    await accepted("Без PostgreSQL — чесний 503", request("/maps"), 503);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await pool.query("DELETE FROM labyrinth_runs WHERE project_id=$1", [
      project,
    ]);
    await pool.query("DELETE FROM projects WHERE id=ANY($1::text[])", [
      [project, other],
    ]);
    await pool.end();
  }
} else if (process.argv.includes("--browser"))
  throw new Error(
    "Browser acceptance requires an isolated CORE_TEST_DATABASE_URL.",
  );
else
  console.log(
    "PostgreSQL/API: не запускалися; задайте окрему CORE_TEST_DATABASE_URL.",
  );
console.log(`Підсумок: ${passed} пройшло.`);
