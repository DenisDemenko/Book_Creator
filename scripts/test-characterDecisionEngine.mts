import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { PgCoreRepository } from "../server/core/pgRepository";
import type { CoreRepository } from "../server/core/types";
import { createCorePool } from "../server/core";
import {
  loadMigrations,
  resolveMigrationsDir,
  runMigrations,
} from "../server/core/migrate";
import {
  startMagic,
  getMagic,
  pauseMagic,
  SCENE_ACTIONS,
  type MagicSceneDeps,
} from "../server/core/magicScene";
import { characterSimulationTurn } from "../server/core/characterSimulation";
import { JevDecisionAdapter } from "../server/core/jevLevels";
import { snapshotHash } from "../server/ai/contracts";
import type { JevAdapter } from "../server/ai/adapters/jev";
import { buildCharacterSnapshot } from "../server/core/characterSnapshot";
import { branchCanonHash } from "../server/core/branches";
import { ensureSystemWorkflows } from "../server/core/workflows/seeds";
import { systemBindings } from "../server/core/workflows/bindings";
import { startRun, replayRun } from "../server/core/workflows/engine/runner";
import { registerWorkflowRunRoutes } from "../server/core/workflows/runRoutes";
import { executorFor } from "../server/core/workflows/engine/executors";
import { SceneTokenBudget } from "../server/core/sceneScheduler";
import { CoreRuleError } from "../server/core/rules";
import { JobFatalError } from "../server/core/jobs/queue";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "character-decision-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { saveBook, getBook } = await import("../server/bookStore");
const { syncBookToCore } = await import("../server/core/sync");
let count = 0;
const check = (name: string) => {
  count++;
  console.log("✓ " + name);
};
async function suite(repo: CoreRepository) {
  const p = "decision-" + randomUUID(),
    actor = "user:owner" as const,
    privateThought = "PRIVATE_THOUGHT_CDE_9z",
    future = "FUTURE_CDE_9z";
  const stored = await saveBook({
    ownerId: "owner",
    book: {
      id: p,
      title: "Рішення",
      chapters: [
        {
          id: "chapter",
          sections: [
            {
              id: "past",
              content:
                "[/character:Олена] [/character:Марко] [/goal:Знайти лист] [/event:Зустріч] Герої чекають.",
            },
            { id: "scene", content: "Герої стоять біля столу." },
            {
              id: "future",
              content: `[/revelation:Таємниця @Олена] ${future}`,
            },
          ],
        },
      ],
    } as any,
  });
  await syncBookToCore(repo, stored);
  const heroes = (await repo.listEntities(p))
    .sort((a, b) =>
      a.name === "Олена"
        ? -1
        : b.name === "Олена"
          ? 1
          : a.name.localeCompare(b.name),
    )
    .filter((e) => e.type === "character");
  for (const h of heroes)
    await repo.upsertCharacterAgent({
      projectId: p,
      characterId: h.id,
      autonomyLevel: "scene",
      actor,
      agentConfig: {},
    });
  const canon = async () =>
    JSON.stringify({
      book: (await getBook(p))!.book,
      hash: await branchCanonHash(repo, p),
      memories: await repo.listCharacterMemories(p, {
        simulationId: null,
        limit: 1000,
      }),
      states: await Promise.all(
        heroes.map(async (h) =>
          repo.getCharacterState(p, {
            characterId: h.id,
            sceneId: "scene",
            simulationId: null,
            canonRevision: (await repo.getProject(p))!.revision,
          }),
        ),
      ),
    });
  const original = await canon();
  const begin = () =>
    startMagic(
      repo,
      p,
      "scene",
      {
        participants: heroes.map((h) => h.id),
        goal: "Знайти лист",
        constraints: "Не змінювати канон",
        maxTurns: 6,
      },
      actor,
    );
  const control = {
    confidence: 0.99,
    down: false,
    badVoice: false,
    audience: "both",
    onVoice: null as null | (() => Promise<void>),
    calls: 0,
    voices: [] as any[],
    snapshots: [] as any[],
  };
  const jev: JevAdapter = {
    name: "jev",
    evaluate: async (snapshot, questions) => {
      control.calls++;
      control.snapshots.push({ snapshot, questions });
      if (control.down) throw new Error("controlled unavailable");
      const choices = Object.fromEntries(
        questions
          .filter((q) => q.kind === "choice")
          .map((q) => [
            q.id,
            q.id === "next_action" ? "answer" : Object.keys(q.options)[0],
          ]),
      );
      return {
        selected_action: choices.next_action ?? Object.values(choices)[0],
        scores: Object.fromEntries(
          questions.filter((q) => q.kind === "score").map((q) => [q.id, 5]),
        ),
        checks: Object.fromEntries(
          questions.filter((q) => q.kind === "noul").map((q) => [q.id, 0.9]),
        ),
        choices,
        raw_distributions: Object.fromEntries(
          Object.entries(choices).map(([id, v]) => [id, { [v]: 1 }]),
        ),
        confidence: control.confidence,
        model_version: "controlled-jev",
        snapshot_hash: snapshotHash(snapshot),
        decision_trace_id: randomUUID(),
        source: "jev",
        corrected: false,
        usage: { input_tokens: 10, output_tokens: 2 },
        latency_ms: 1,
      };
    },
  };
  const d: MagicSceneDeps = {
    repo,
    decide: async ({ run, characterId, situation, actor }) => {
      const result = await new JevDecisionAdapter({
        repo,
        jev,
        fallback: null,
      }).decide({
        projectId: p,
        characterId,
        level: "tactical",
        sceneId: run.sceneId,
        asOfChapter: run.asOfChapter,
        simulationId: run.simulationId,
        turnIndex: run.events.length + 1,
        situation,
        allowedActions: SCENE_ACTIONS,
        checks: [
          "Дія не потребує невідомих знань.",
          "Дія відповідає межам сцени.",
        ],
        actor,
      });
      return {
        action: result.decision.selectedAction ?? "silence",
        awaitingAuthor: result.awaitingAuthor,
        decisionId: result.decision.id,
        source: result.decision.source,
      };
    },
    voice: async (ctx) => {
      control.voices.push(ctx);
      if (control.onVoice) {
        const f = control.onVoice;
        control.onVoice = null;
        await f();
      }
      if (control.badVoice) return { speech: "invalid" };
      return {
        speech: "Я бачу лист.",
        actionText: "Дивиться на стіл.",
        privateThought,
        intent: "Знайти лист",
        audience:
          control.audience === "self"
            ? [(ctx.hero as any).id]
            : heroes.map((h) => h.id),
      };
    },
    writer: async () => {
      throw new Error("No automatic literary draft");
    },
  };
  await ensureSystemWorkflows(repo);
  const deps = {
    repo,
    bindings: systemBindings(),
    services: {
      resolveModel: async () => undefined,
      generate: async () => {
        throw new Error("unused");
      },
      simulateCharacterTurn: async ({
        projectId,
        actor: a,
        input,
        signal,
      }: any) => {
        if (a !== actor || projectId !== p) throw new Error("denied");
        return characterSimulationTurn(d, projectId, input, a, signal);
      },
    },
  };
  const start = async (sim: any, extra: Record<string, unknown> = {}) =>
    startRun(deps, {
      workflowId: "character_decision_engine",
      projectId: p,
      actor,
      trigger: "manual",
      input: {
        mode: "simulation",
        simulationId: sim.simulationId,
        expectedRevision: (await getMagic(repo, p, sim.simulationId)).revision,
        ...extra,
      },
    });
  const sim = await begin(),
    first = await start(sim, { requestId: "first-request" });
  assert.equal(first.run.status, "succeeded", first.run.error ?? "");
  const r = (first.run.output as any).characterDecision;
  assert.equal(r.action, "answer");
  assert.deepEqual(r.checks, { check_1: 0.9, check_2: 0.9 });
  assert.ok(Object.keys(r.scores).length);
  check("Choice / Score / Noul → реалізація й досвід симуляції");
  assert.equal(r.memoryIds.length, 2);
  assert.equal(r.stateIds.length, 2);
  for (const id of r.memoryIds) {
    const m = await repo.getCharacterMemory(p, id);
    assert.equal(m?.simulationId, sim.simulationId);
    assert.equal(m?.canonRevision, null);
    assert.equal(m?.truth, "unknown");
    assert.equal(m?.layer, "character_belief");
    assert.ok(!m?.content.includes(privateThought));
  }
  check(
    "новий досвід — суб’єктивна пам’ять лише власного прогону, без приватної думки",
  );
  assert.equal(await canon(), original);
  check("канонічні сутності, зв’язки, стани, пам’ять і рукопис не змінились");
  const trace = JSON.stringify({
    run: first.run,
    state: first.state,
    steps: await repo.listWorkflowSteps(first.run.id),
    checkpoint: await repo.getWorkflowCheckpoint(first.run.id),
  });
  assert.ok(!trace.includes(privateThought));
  assert.ok(!trace.includes("Я бачу лист"));
  assert.ok(!trace.includes(future));
  check(
    "Graph Studio / checkpoint не отримують думки, репліку й майбутні знання",
  );

  assert.ok(!JSON.stringify(control.snapshots).includes(future));
  check("межа знань героя не пропускає майбутню сцену");
  const oldCalls = control.calls,
    oldVoices = control.voices.length;
  const replay = await replayRun(deps, first.run.id, actor);
  assert.equal(replay.run.status, "succeeded");
  assert.equal((replay.run.output as any).characterDecision.eventId, r.eventId);
  assert.equal(control.calls, oldCalls);
  assert.equal(control.voices.length, oldVoices);
  assert.equal(
    (await repo.listCharacterMemories(p, { simulationId: sim.simulationId }))
      .length,
    2,
  );
  check("REPLAY з requestId не дублює подію, моделі, спогад чи стан");
  const repairSim = await begin();
  const addMemory = repo.addCharacterMemory.bind(repo);
  let memoryWrites = 0;
  repo.addCharacterMemory = async (...args: Parameters<typeof addMemory>) => {
    if (++memoryWrites === 2) throw new Error("controlled write failure");
    return addMemory(...args);
  };
  const partialFailure = await start(repairSim, {
    requestId: "repair-request",
  });
  repo.addCharacterMemory = addMemory;
  assert.equal(partialFailure.run.status, "failed");
  const saved = await getMagic(repo, p, repairSim.simulationId);
  assert.equal(saved.events.length, 1);
  assert.equal(
    (
      await repo.listCharacterMemories(p, {
        simulationId: repairSim.simulationId,
      })
    ).length,
    1,
  );
  const voicesBeforeRepair = control.voices.length;
  const repaired = await replayRun(deps, partialFailure.run.id, actor);
  assert.equal(repaired.run.status, "succeeded", repaired.run.error ?? "");
  assert.equal(
    (
      await repo.listCharacterMemories(p, {
        simulationId: repairSim.simulationId,
      })
    ).length,
    2,
  );
  assert.equal(
    (await getMagic(repo, p, repairSim.simulationId)).events.length,
    1,
  );
  assert.equal(control.voices.length, voicesBeforeRepair);
  assert.equal(await canon(), original);
  check(
    "частковий збій пам’яті: повтор ремонтує досвід без нової події чи LLM",
  );
  const second = await start(sim);
  assert.equal(second.run.status, "succeeded");
  assert.ok(
    JSON.stringify(control.voices.at(-1).snapshot.memories).includes(
      "Я бачу лист",
    ),
  );
  assert.ok(!JSON.stringify(control.voices.at(-1)).includes(privateThought));
  check("інший спостерігач використовує спогад прогону без чужих думок");
  const separate = await begin(),
    snap = await buildCharacterSnapshot(repo, {
      projectId: p,
      characterId: heroes[0].id,
      sceneId: "scene",
      simulationId: separate.simulationId,
      situation: "Інший прогін",
      allowedActions: SCENE_ACTIONS,
    });
  assert.ok(!JSON.stringify(snap.snapshot).includes("Я бачу лист"));
  check("інша симуляція не успадковує досвід попередньої");
  control.audience = "self";
  const privateSim = await begin(),
    own = await start(privateSim);
  assert.equal(own.run.status, "succeeded");
  assert.equal((own.run.output as any).characterDecision.memoryIds.length, 1);
  const foreign = await buildCharacterSnapshot(repo, {
    projectId: p,
    characterId: heroes[1].id,
    sceneId: "scene",
    simulationId: privateSim.simulationId,
    situation: "Не чув",
    allowedActions: SCENE_ACTIONS,
  });
  assert.ok(!JSON.stringify(foreign.snapshot).includes("Я бачу лист"));
  control.audience = "both";
  check("неприсутній герой не отримує нового спогаду");
  control.confidence = 0.1;
  const waitingSim = await begin(),
    waiting = await start(waitingSim);
  assert.equal(waiting.run.status, "succeeded");
  assert.equal(
    (waiting.run.output as any).characterDecision.status,
    "awaiting_author",
  );
  assert.equal(
    (await getMagic(repo, p, waitingSim.simulationId)).events.length,
    0,
  );
  assert.equal(
    (
      await repo.listCharacterMemories(p, {
        simulationId: waitingSim.simulationId,
      })
    ).length,
    0,
  );
  control.confidence = 0.99;
  check("низька впевненість зупиняє дію до рішення автора");
  const paused = await getMagic(repo, p, waitingSim.simulationId);
  await pauseMagic(repo, p, paused.simulationId, paused.revision, "active");
  const authored = await start(waitingSim, { authorAction: "silence" });
  assert.equal(authored.run.status, "succeeded");
  assert.equal((authored.run.output as any).characterDecision.source, "author");
  check("після відновлення автор може явно обрати дозволену дію");
  control.badVoice = true;
  const brokenSim = await begin(),
    broken = await start(brokenSim);
  assert.equal(broken.run.status, "failed");
  assert.equal(
    (await getMagic(repo, p, brokenSim.simulationId)).events.length,
    0,
  );
  assert.equal(
    (
      await repo.listCharacterMemories(p, {
        simulationId: brokenSim.simulationId,
      })
    ).length,
    0,
  );
  control.badVoice = false;
  check("некоректна реалізація не створює досвіду й пам’яті");
  const freshSim = await begin();
  const invalid = await start(freshSim, { mode: "canon" });
  assert.equal(invalid.run.status, "failed");
  const automatic = await start(freshSim, { semanticAutomatic: true });
  assert.equal(automatic.run.status, "failed");
  check("Canonical Mode й автоматичний semantic запуск заборонені");
  const outsider = await startRun(deps, {
    workflowId: "character_decision_engine",
    projectId: p,
    actor: "user:stranger",
    trigger: "manual",
    input: {
      mode: "simulation",
      simulationId: freshSim.simulationId,
      expectedRevision: freshSim.revision,
    },
  });
  assert.equal(outsider.run.status, "failed");
  check("workflow не обходить авторизацію симуляції");
  await assert.rejects(
    () =>
      executorFor({ id: "canon", type: "CANON_WRITE", params: {} }, {
        run: { workflowId: "character_decision_engine" },
      } as any)({} as any, {} as any, {} as any),
    /не записує канон/,
  );
  check("CANON_WRITE заборонено навіть у зміненій версії процесу");
  let fallbackCalls = 0;
  const budgetAdapter = new JevDecisionAdapter({
    repo,
    jev: {
      name: "jev",
      evaluate: async () => {
        throw new JobFatalError("controlled budget stop");
      },
    },
    fallback: {
      name: "llm_fallback",
      evaluate: async () => {
        fallbackCalls++;
        throw new Error("must not run");
      },
    },
  });
  await assert.rejects(
    () =>
      budgetAdapter.decide({
        projectId: p,
        characterId: heroes[0].id,
        level: "tactical",
        sceneId: "scene",
        simulationId: randomUUID(),
        turnIndex: 1,
        actor,
        allowedActions: SCENE_ACTIONS,
      }),
    JobFatalError,
  );
  const tokenBudget = new SceneTokenBudget(0);
  const sceneBudgetAdapter = new JevDecisionAdapter({
    repo,
    jev: {
      name: "jev",
      evaluate: async (snapshot, questions) => {
        tokenBudget.reserve("Jev", { snapshot, questions });
        throw new Error("unreachable");
      },
    },
    fallback: {
      name: "llm_fallback",
      evaluate: async () => {
        fallbackCalls++;
        throw new Error("must not run");
      },
    },
  });
  await assert.rejects(
    () =>
      sceneBudgetAdapter.decide({
        projectId: p,
        characterId: heroes[0].id,
        level: "tactical",
        sceneId: "scene",
        simulationId: randomUUID(),
        turnIndex: 1,
        actor,
        allowedActions: SCENE_ACTIONS,
      }),
    CoreRuleError,
  );
  assert.equal(fallbackCalls, 0);
  check("вичерпаний бюджет не запускає запасну модель");
  control.down = true;
  const noProviderSim = await begin();
  const noProvider = await start(noProviderSim);
  control.down = false;
  assert.equal(noProvider.run.status, "succeeded");
  assert.equal(
    (noProvider.run.output as any).characterDecision.status,
    "awaiting_author",
  );
  assert.equal(
    (await getMagic(repo, p, noProviderSim.simulationId)).events.length,
    0,
  );
  check("без провайдера хід чекає автора без вигаданої дії");
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(() =>
    characterSimulationTurn(
      d,
      p,
      {
        mode: "simulation",
        simulationId: freshSim.simulationId,
        expectedRevision: freshSim.revision,
        requestId: "cancel-request",
      },
      actor,
      cancelled.signal,
    ),
  );
  assert.equal(
    (await getMagic(repo, p, freshSim.simulationId)).events.length,
    0,
  );
  check("скасована операція не виконує ходу");
  const revoked = await begin();
  let permitted = true;
  control.onVoice = async () => {
    permitted = false;
  };
  await assert.rejects(() =>
    characterSimulationTurn(
      { ...d, authorizeTools: async () => permitted },
      p,
      {
        mode: "simulation",
        simulationId: revoked.simulationId,
        expectedRevision: revoked.revision,
        requestId: "revoked-request",
      },
      actor,
    ),
  );
  assert.equal(
    (await getMagic(repo, p, revoked.simulationId)).events.length,
    0,
  );
  check("відкликаний під час LLM доступ не записує подію");
  const concurrent = await begin(),
    rev = concurrent.revision;
  const outcomes = await Promise.all(
    ["concurrent-one", "concurrent-two"].map((requestId) =>
      characterSimulationTurn(
        d,
        p,
        {
          mode: "simulation",
          simulationId: concurrent.simulationId,
          expectedRevision: rev,
          requestId,
        },
        actor,
      ).then(
        () => true,
        () => false,
      ),
    ),
  );
  assert.deepEqual(outcomes.sort(), [false, true]);
  check("конкурентні запити не записують два ходи з однієї ревізії");
  const stale = await begin();
  control.onVoice = async () => {
    const entity = heroes[0];
    await repo.updateEntity(
      p,
      entity.id,
      { canonical: { changed: true } },
      actor,
    );
  };
  const staleResult = await start(stale);
  assert.equal(staleResult.run.status, "failed");
  assert.equal((await getMagic(repo, p, stale.simulationId)).events.length, 0);
  check("зміна основи під час моделі відхиляє досвід");
  if (process.argv.includes("--browser")) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.principal = { id: "owner", role: "admin", isGuest: false } as any;
      next();
    });
    registerWorkflowRunRoutes(app, {
      repo: () => repo,
      engine: () => deps,
      requireStudio: (_r, _s, n) => n(),
      requireControl: (_r, _s, n) => n(),
    });
    const { build } = await import("esbuild");
    const bundle = await build({
      stdin: {
        contents: `import React from'react';import{createRoot}from'react-dom/client';import{RunsPanel}from'./src/components/graphStudio/RunsPanel';createRoot(document.getElementById('root')).render(<RunsPanel abilities={{canPublish:true}}/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
    });
    app.get("/probe.js", (_q, res) =>
      res.type("application/javascript").send(bundle.outputFiles[0].text),
    );
    const assetsDir = path.join(process.cwd(), "dist/assets");
    const cssName = (await fs.readdir(assetsDir)).find((name) =>
      /^index-.*\.css$/.test(name),
    );
    assert.ok(
      cssName,
      "Спочатку npm run build: потрібен справжній CSS застосунку",
    );
    const css = await fs.readFile(path.join(assetsDir, cssName), "utf8");
    app.get("/style.css", (_req, res) => res.type("css").send(css));
    app.get("/probe", (_q, res) =>
      res.send(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/probe.js"></script>',
      ),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { launch } = await import("puppeteer-core");
    const browser = await launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(origin + "/probe");
      await page.waitForSelector(`[data-run-row="${first.run.id}"]`);
      await page.click(`[data-run-row="${first.run.id}"]`);
      await page.waitForSelector("[data-run-character-decision]");
      const txt = await page.$eval(
        "[data-run-character-decision]",
        (e) => e.textContent ?? "",
      );
      assert.ok(txt.includes("Simulation Mode"));
      assert.ok(txt.includes("спогадів прогону: 2"));
      check(
        "БРАУЗЕР: реальний RunsPanel / HTTP показує рішення, Noul, досвід і стан",
      );
      assert.ok(!(await page.content()).includes(privateThought));
      assert.ok(!(await page.content()).includes("Я бачу лист"));
      check("БРАУЗЕР: приватна думка й реалізація не потрапляють у трасу");
      const box = await page.$eval("[data-run-character-decision]", (e) => ({
        right: e.getBoundingClientRect().right,
        width: innerWidth,
        border: getComputedStyle(e).borderStyle,
        pageWidth: document.documentElement.scrollWidth,
      }));
      assert.equal(box.border, "solid", "справжній CSS завантажено");
      assert.ok(box.right <= box.width);
      assert.ok(box.pageWidth <= box.width);
      assert.deepEqual(errors, []);
      check("БРАУЗЕР: 390px без переповнення та JS-помилок");
      await page.screenshot({
        path: path.join(dir, "simulation-mobile.png"),
        fullPage: true,
      });
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }
  console.log(repo.kind + " завершено");
}
try {
  await suite(new MemoryCoreRepository());
  if (process.env.CORE_TEST_DATABASE_URL) {
    const pool = createCorePool(process.env.CORE_TEST_DATABASE_URL);
    try {
      await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
      await suite(new PgCoreRepository(pool));
    } finally {
      await pool.end();
    }
  }
  console.log(`Підсумок: ${count} пройшло. Артефакти: ${dir}`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
