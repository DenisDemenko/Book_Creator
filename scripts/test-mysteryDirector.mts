import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
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
  createSecret,
  directMystery,
  decryptVault,
  revealSecret,
} from "../server/core/secretVault";
import {
  evaluatePrivateMystery,
  mysteryKnowledge,
  mysteryRecommendation,
  MYSTERY_QUESTIONS,
} from "../server/core/mysteryDirector";
import { startMagic } from "../server/core/magicScene";
import { ensureSystemWorkflows } from "../server/core/workflows/seeds";
import { systemBindings } from "../server/core/workflows/bindings";
import { startRun } from "../server/core/workflows/engine/runner";
import { registerWorkflowRunRoutes } from "../server/core/workflows/runRoutes";
import { JobFatalError } from "../server/core/jobs/queue";
import { registerSecretVaultRoutes } from "../server/core/secretVaultRoutes";
import { registerMagicSceneRoutes } from "../server/core/magicSceneRoutes";
import type { JevAdapter } from "../server/ai/adapters/jev";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mystery-director-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { saveBook, getBook } = await import("../server/bookStore");
const { syncBookToCore } = await import("../server/core/sync");
let total = 0;
const check = (label: string) => {
  total++;
  console.log("✓ " + label);
};
async function suite(repo: CoreRepository) {
  const p = "mystery-" + randomUUID(),
    actor = "user:owner" as const,
    key = randomBytes(32),
    canary = "PRIVATE_TRUTH_76z",
    future = "FUTURE_TEXT_76z";
  const stored = await saveBook({
    ownerId: "owner",
    book: {
      id: p,
      title: "Загадка",
      chapters: [
        {
          id: "chapter",
          sections: [
            {
              id: "before",
              title: "Підказка",
              content: "[/character:Олена] [/event:Лист] знайдено.",
            },
            { id: "start", title: "Початок", content: "Герої зустрілися." },
            {
              id: "target",
              title: "Розкриття",
              content: "Герої питають про лист.",
            },
            {
              id: "future",
              title: "Флешбек",
              content: `[/character:Марко] [/event:Минуле] ${future}`,
            },
          ],
        },
      ],
    } as any,
  });
  await syncBookToCore(repo, stored);
  let heroes = (await repo.listEntities(p)).filter(
    (e) => e.type === "character",
  );
  for (const h of heroes)
    await repo.upsertCharacterAgent({
      projectId: p,
      characterId: h.id,
      autonomyLevel: "scene",
      actor,
      agentConfig: {},
    });
  const sim = await startMagic(
    repo,
    p,
    "start",
    {
      participants: heroes.map((h) => h.id),
      goal: "Загадка",
      constraints: "Не розкривати",
      maxTurns: 2,
    },
    actor,
  );
  const meta = await createSecret(
    repo,
    key,
    p,
    {
      expectedRevision: 0,
      kind: "world_secret",
      simulationId: sim.simulationId,
      hiddenFromAuthor: true,
      bounds: "Детектив",
      policy: {
        notBeforeSceneId: "target",
        allowedCharacterIds: [heroes[0].id],
      },
    },
    actor,
    async () => ({ text: canary }),
  );
  const id = meta.secrets[0].id;
  const revision = async () => (await repo.getSecretVault(p)).revision;
  let rawAction = "REVEAL",
    rawScore = 2,
    early = 0.2,
    confidence = 0.95,
    down = false,
    contexts: any[] = [],
    onAsk: (() => Promise<void>) | null = null;
  const jev: JevAdapter = {
    name: "jev",
    evaluate: async () => {
      throw new Error("unused");
    },
    askState: async (c, questions) => {
      contexts.push(c);
      assert.deepEqual(
        questions.map((q) => q.kind),
        ["score", "noul", "choice"],
      );
      if (onAsk) {
        const f = onAsk;
        onAsk = null;
        await f();
      }
      if (down) throw new Error(canary);
      return {
        answers: {
          reader: { score: rawScore, confidence },
          early: { noul: early, confidence },
          action: { choice: rawAction, confidence },
        },
        model: "controlled",
        usage: { input_tokens: 12, output_tokens: 3 },
        latency_ms: 1,
      };
    },
  };
  const evaluate = (c: Record<string, unknown>) =>
    evaluatePrivateMystery(c, {
      jev: async () => jev,
      fallback: async () => ({
        answers: {
          reader: { score: 1, confidence: 1 },
          early: { probability: 0.1, confidence: 1 },
          action: { choice: "REVEAL", confidence: 1 },
        },
      }),
    });
  const go = (sceneId = "target") =>
    revision().then((expectedRevision) =>
      directMystery(
        repo,
        key,
        p,
        id,
        { sceneId, expectedRevision },
        actor,
        evaluate,
      ),
    );
  const unchanged = JSON.stringify({
    book: (await getBook(p))!.book,
    entities: await repo.listEntities(p),
    relations: await repo.listRelations(p),
  });
  const target = await go();
  assert.equal(target.director.action, "REVEAL");
  assert.equal(target.director.readerScore, 5);
  assert.equal(target.director.needsReview, false);
  check("Score 0–4 → 0–10, Noul і Choice формують рекомендацію");
  assert.equal(contexts[0].worldTruth.text, canary);
  assert.ok(!JSON.stringify(contexts[0].readerKnowledge).includes(canary));
  assert.ok(!JSON.stringify(contexts[0].characterKnowledge).includes(canary));
  assert.ok(!JSON.stringify(contexts[0].readerKnowledge).includes(future));
  check("World Truth окремо; читач не отримує Vault або майбутній текст");
  assert.ok(
    contexts[0].characterKnowledge.characters.some(
      (c: any) => c.known.length > 0,
    ),
  );
  assert.ok(
    contexts[0].characterKnowledge.characters.some(
      (c: any) => c.known.length === 0,
    ),
  );
  check("різні герої мають різні підтверджені знання");
  assert.ok(!JSON.stringify(target).includes(canary));
  const vault = await repo.getSecretVault(p);
  assert.ok(!JSON.stringify(vault).includes(canary));
  assert.equal(
    decryptVault<any>(key, p, id, 1, vault.plans![0].cipher).recommendation
      .action,
    "REVEAL",
  );
  check("приватний план зашифровано; відповідь без plaintext");
  assert.equal((await repo.getSecretVault(p)).secrets[0].status, "sealed");
  assert.equal(
    JSON.stringify({
      book: (await getBook(p))!.book,
      entities: await repo.listEntities(p),
      relations: await repo.listRelations(p),
    }),
    unchanged,
  );
  check("рекомендація REVEAL не розкриває й не змінює канон");
  assert.equal((await go("start")).director.action, "DELAY");
  check("жорстка найраніша сцена блокує передчасний REVEAL");
  early = 0.7;
  assert.equal((await go()).director.action, "DELAY");
  early = 0.2;
  check("Noul на порозі 0.7 відкладає розкриття");
  for (const action of ["HINT", "MISDIRECT", "HIDE", "DELAY"]) {
    rawAction = action;
    assert.equal((await go()).director.action, action);
    check("дозволена рекомендація " + action);
  }
  rawAction = "REVEAL";
  confidence = 0.59;
  assert.equal((await go()).director.action, "HIDE");
  confidence = 0.95;
  check("низька впевненість — приховати й рішення автора");
  down = true;
  const fallback = await go();
  assert.equal(fallback.director.action, "HIDE");
  assert.equal(fallback.director.source, "llm_fallback");
  assert.equal(fallback.director.needsReview, true);
  down = false;
  check("збій Jev: приватний fallback не підробляє впевненість");
  rawAction = "INVALID";
  assert.equal((await go()).director.source, "llm_fallback");
  rawAction = "REVEAL";
  check("невідомий Choice не стає дозволеною дією мовчки");
  await assert.rejects(() =>
    evaluatePrivateMystery({}, { fallback: async () => ({ answers: {} }) }),
  );
  await assert.rejects(
    () =>
      evaluatePrivateMystery(
        {},
        {
          fallback: async () => {
            throw new Error(canary);
          },
        },
      ),
    (e) => !String(e).includes(canary),
  );
  check("некоректний fallback і приватні помилки відхилено без витоку");
  assert.equal(
    mysteryRecommendation(
      {
        assessment: {
          action: "REVEAL",
          readerScore: 0,
          earlyProbability: 0.1,
          source: "jev",
          confidence: 0.6,
        },
      },
      true,
    ).action,
    "REVEAL",
  );
  check("поріг впевненості 0.6 приймається");
  let fallbackUsed = false;
  await assert.rejects(
    () =>
      evaluatePrivateMystery(
        {},
        {
          jev: async () => jev,
          onUsage: async () => {
            throw new JobFatalError(canary);
          },
          fallback: async () => {
            fallbackUsed = true;
            return {};
          },
        },
      ),
    JobFatalError,
  );
  assert.equal(fallbackUsed, false);
  check("вичерпаний бюджет не запускає запасну модель");
  const blocked = await createSecret(
    repo,
    key,
    p,
    {
      expectedRevision: await revision(),
      kind: "world_secret",
      simulationId: sim.simulationId,
      hiddenFromAuthor: true,
      bounds: "Детектив",
      policy: {
        notBeforeSceneId: "target",
        requiredEventIds: [(await repo.resolveAlias(p, "event", "Минуле"))!],
      },
    },
    actor,
    async () => ({ text: "OTHER_PRIVATE_76z" }),
  );
  const blockedResult = await directMystery(
    repo,
    key,
    p,
    blocked.secrets.at(-1)!.id,
    { sceneId: "target", expectedRevision: await revision() },
    actor,
    evaluate,
  );
  assert.equal(blockedResult.director.action, "DELAY");
  assert.ok(!JSON.stringify(contexts.at(-1)).includes(canary));
  check(
    "без попередніх доказів — DELAY; інша таємниця не потрапляє у приватний виклик",
  );
  const plans = (await repo.getSecretVault(p)).plans!.length;
  onAsk = async () => {
    const entity = heroes[0];
    await repo.updateEntity(p, entity.id, { name: "Олена змінена" }, actor);
  };
  await assert.rejects(() => go(), /змінилися/);
  assert.equal((await repo.getSecretVault(p)).plans!.length, plans);
  check("зміна знань під час моделі відкидає застарілий план");
  await repo.upsertTimePoint({
    projectId: p,
    subjectKind: "scene",
    subjectId: "future",
    kind: "exact",
    start: "1990",
    end: null,
    sortKey: 1990,
    endKey: null,
    label: "",
    createdBy: actor,
  });
  await repo.upsertTimePoint({
    projectId: p,
    subjectKind: "scene",
    subjectId: "target",
    kind: "exact",
    start: "2000",
    end: null,
    sortKey: 2000,
    endKey: null,
    label: "",
    createdBy: actor,
  });
  const flash = await mysteryKnowledge(repo, p, "target");
  assert.ok(!JSON.stringify(flash.context.readerKnowledge).includes(future));
  assert.ok(
    flash.context.characterKnowledge.characters.some((c) =>
      c.known.some((k) => k.name === "Минуле"),
    ),
  );
  check("флешбек: герой знає минуле, читач ще не читав пізнішу сцену");
  await ensureSystemWorkflows(repo);
  const envBefore = process.env.SECRET_VAULT_KEY_BASE64;
  process.env.SECRET_VAULT_KEY_BASE64 = key.toString("base64");
  const deps = {
    repo,
    bindings: systemBindings(),
    services: {
      canDirectMystery: async (a: string) => a === actor,
      jev: async () => jev,
      resolveModel: async () => undefined,
      generate: async () => {
        throw new Error("unused");
      },
    },
  };
  const input = () =>
    revision().then((expectedRevision) => ({
      secretId: id,
      sceneId: "target",
      expectedRevision,
    }));
  let graphRunId = "";
  try {
    const run = await startRun(deps, {
      workflowId: "mystery_director",
      projectId: p,
      input: await input(),
      actor,
      trigger: "manual",
    });
    assert.equal(run.run.status, "succeeded", run.run.error ?? "");
    graphRunId = run.run.id;
    const trace = JSON.stringify({
      run: run.run,
      state: run.state,
      steps: await repo.listWorkflowSteps(run.run.id),
      checkpoint: await repo.getWorkflowCheckpoint(run.run.id),
    });
    assert.ok(!trace.includes(canary));
    assert.ok(!trace.includes(future));
    check(
      "Graph Studio: запуск, траса і контрольна точка без приватного контексту",
    );
    const bad = await startRun(deps, {
      workflowId: "mystery_director",
      projectId: p,
      input: await input(),
      actor: "user:stranger",
      trigger: "manual",
    });
    assert.equal(bad.run.status, "failed");
    check("workflow не обходить права Vault");
    const auto = await startRun(deps, {
      workflowId: "mystery_director",
      projectId: p,
      input: { ...(await input()), semanticAutomatic: true },
      actor,
      trigger: "manual",
    });
    assert.equal(auto.run.status, "failed");
    check("автоматичний семантичний підграф не читає світову таємницю");
  } finally {
    if (envBefore === undefined) delete process.env.SECRET_VAULT_KEY_BASE64;
    else process.env.SECRET_VAULT_KEY_BASE64 = envBefore;
  }
  const access = {
    getBookOwnerId: async () => "owner",
    getCollabOwnerId: async () => undefined,
    listAcceptedInvites: async () => [],
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = {
      id: req.headers["x-user"] === "stranger" ? "stranger" : "owner",
      role: "writer",
      isGuest: false,
    } as any;
    next();
  });
  registerWorkflowRunRoutes(app, {
    repo: () => repo,
    engine: () => deps,
    requireStudio: (_r, _s, next) => next(),
    requireControl: (_r, _s, next) => next(),
  });
  registerSecretVaultRoutes(app, {
    repo: () => repo,
    access,
    key: () => key,
    direct: async (_req, _p, c) => evaluate(c),
  });
  registerMagicSceneRoutes(app, {
    repo: () => repo,
    access,
    engines: async () => ({}) as any,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(
      `${origin}/api/core/projects/${p}/vault/${id}/director`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user": "stranger" },
        body: JSON.stringify(await input()),
      },
    );
    assert.equal(response.status, 403);
    check("приватний HTTP Director недоступний сторонньому");
    if (process.argv.includes("--browser")) {
      const { build } = await import("esbuild");
      const bundle = await build({
        stdin: {
          contents: `import React from 'react';import{createRoot}from'react-dom/client';import{SecretVaultPanel}from'./src/components/SecretVaultPanel';import{RunsPanel}from'./src/components/graphStudio/RunsPanel';createRoot(document.getElementById('root')).render(<><SecretVaultPanel book={{id:${JSON.stringify(p)}}}/><RunsPanel abilities={{canPublish:true}}/></>);`,
          resolveDir: process.cwd(),
          loader: "tsx",
        },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
      });
      app.get("/probe.js", (_req, res) =>
        res.type("application/javascript").send(bundle.outputFiles[0].text),
      );
      app.get("/probe", (_req, res) =>
        res.send(
          '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/probe.js"></script>',
        ),
      );
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
        await page.waitForSelector("[data-vault-secret]");
        await page.select('[aria-label="Сцена розкриття"]', "target");
        for (const b of await page.$$(`[data-vault-secret="${id}"] button`))
          if (
            (await b.evaluate((e) => e.textContent))?.startsWith(
              "Mystery Director:",
            )
          ) {
            await b.click();
            break;
          }
        await page.waitForSelector("[data-mystery-director]");
        const text = await page.$eval(
          "[data-mystery-director]",
          (e) => e.textContent,
        );
        assert.ok(text?.includes("REVEAL"));
        for (const label of [
          "World Truth",
          "Reader Knowledge",
          "Character Knowledge",
        ])
          assert.ok(text?.includes(label));
        check("БРАУЗЕР: реальний UI / HTTP показує три шари та рішення");
        assert.ok(!(await page.content()).includes(canary));
        check("БРАУЗЕР: прихований текст не потрапив у DOM");
        const box = await page.$eval("[data-mystery-director]", (e) => ({
          right: e.getBoundingClientRect().right,
          width: window.innerWidth,
        }));
        assert.ok(box.right <= box.width);
        assert.deepEqual(errors, []);
        check("БРАУЗЕР: телефон 390px без переповнення та JS-помилок");
        await page.waitForSelector(`[data-run-row="${graphRunId}"]`);
        await page.click(`[data-run-row="${graphRunId}"]`);
        await page.waitForSelector("[data-run-mystery]");
        const graphText = await page.$eval(
          "[data-run-mystery]",
          (e) => e.textContent ?? "",
        );
        assert.ok(graphText.includes("REVEAL"));
        assert.ok(graphText.includes("World Truth"));
        assert.ok(!(await page.content()).includes(canary));
        check("БРАУЗЕР: Graph Studio показує безпечну трасу Mystery Director");
        await page.screenshot({
          path: path.join(dir, "mystery-mobile.png"),
          fullPage: true,
        });
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  const fresh = await revision();
  await assert.rejects(() =>
    revealSecret(
      repo,
      key,
      p,
      id,
      { expectedRevision: fresh, sceneId: "target", confirm: false },
      actor,
    ),
  );
  check("рекомендація не замінює явне підтвердження автора");
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
  console.log(`Підсумок: ${total} пройшло. Артефакти: ${dir}`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
