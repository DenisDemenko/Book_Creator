/** T5.7 В2: real settings, save → core_sync → queue → Jev → scoped subgraph. */
import assert from "node:assert/strict";
import express from "express";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { MemoryJobStore } from "../server/core/jobs/memoryJobStore";
import { JobQueue } from "../server/core/jobs/queue";
import { coreSyncJobKind, CORE_SYNC_KIND } from "../server/core/sync";
import {
  scheduleSemanticChange,
  semanticChangeJobKind,
  SEMANTIC_CHANGE_KIND,
} from "../server/core/semanticChangeJob";
import { registerWorkflowRunRoutes } from "../server/core/workflows/runRoutes";
import { registerDestinationRoutes } from "../server/core/workflows/destinationRoutes";
import { SEMANTIC_WORKFLOW } from "../src/utils/semanticChange";
import { semanticFixture } from "./lib/semanticChangeFixture";
import { blockHash } from "../src/utils/paragraphIds";
const repo = new MemoryCoreRepository();
const { deps, stored, route, control, observed, changeText } =
  await semanticFixture(repo);
await route("LOCATION", "location_analysis");
const queue = new JobQueue(new MemoryJobStore(), { log: () => {} });
queue.register(
  SEMANTIC_CHANGE_KIND,
  semanticChangeJobKind(() => deps),
);
queue.register(
  CORE_SYNC_KIND,
  coreSyncJobKind({
    repo: () => repo,
    loadBook: async () => stored,
    afterSynchronized: async (result) =>
      scheduleSemanticChange(repo, queue, result),
  }),
);
const save = async (text: string) => {
  const s = (stored.book as any).chapters[0].sections[0];
  s.content = text;
  s.paragraphHashes = [blockHash(text)];
  await queue.enqueue({
    projectId: stored.id,
    kind: CORE_SYNC_KIND,
    createdBy: "user:author",
  });
  await queue.runOnce();
  await queue.runOnce();
  return (
    await repo.listWorkflowRuns({
      workflowId: SEMANTIC_WORKFLOW,
      projectId: stored.id,
    })
  )[0];
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.principal = { id: "author" } as typeof req.principal;
  next();
});
registerDestinationRoutes(app, {
  repo: () => repo,
  requireStudio: (_r, _s, n) => n(),
  requirePublish: (_r, _s, n) => n(),
});
registerWorkflowRunRoutes(app, {
  repo: () => repo,
  engine: () => deps,
  requireStudio: (_r, _s, n) => n(),
  requireControl: (_r, _s, n) => n(),
});
app.get("/api/core/workflows", (_req, res) => res.json({ workflows: [] }));
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{RunsPanel}from'./src/components/graphStudio/RunsPanel';import{DestinationsPanel}from'./src/components/graphStudio/DestinationsPanel';createRoot(document.getElementById('root')).render(<div className="space-y-4"><RunsPanel abilities={{canPublish:true}}/><DestinationsPanel abilities={{canPublish:true}}/></div>);`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  define: { "process.env.NODE_ENV": '"development"' },
});
app.get("/probe.js", (_req, res) =>
  res.type("js").send(bundle.outputFiles[0].text),
);
const css = (await fs.readdir("dist/assets")).filter((x) => x.endsWith(".css"));
const styles = (
  await Promise.all(
    css.map((x) => fs.readFile(path.join("dist/assets", x), "utf8")),
  )
).join("\n");
app.get("/probe.css", (_req, res) => res.type("css").send(styles));
app.get("/", (_req, res) =>
  res.send(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><body style="background:#020617;color:#e2e8f0;padding:12px"><div id="root"></div><script type="module" src="/probe.js"></script>',
  ),
);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const artifact = await fs.mkdtemp(path.join(os.tmpdir(), "semantic-change-"));
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
const results: string[] = [];
const check = (s: string) => {
  results.push(s);
  console.log("✓ " + s);
};
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewport({ width: 1440, height: 1100 });
  await page.goto(base);
  await page.waitForSelector("[data-semantic-destinations-help]");
  assert.match(
    await page.$eval(
      "[data-semantic-destinations-help]",
      (e) => e.textContent ?? "",
    ),
    /semantic_change/,
  );
  await page.waitForFunction(
    () =>
      !!document.querySelector(
        '#gs-registries option[value="semantic_change"]',
      ),
  );
  check("реєстр детектора й пояснення налаштування доступні в UI");
  await page.type("[data-gs-dest-new-registry]", "semantic_change");
  await page.type("[data-gs-dest-new-option]", "event");
  await page.select("[data-gs-dest-new-workflow]", "event_analysis");
  await page.type("[data-gs-dest-new-en]", "Events");
  await page.type("[data-gs-dest-new-uk]", "Події");
  await page.click("[data-gs-dest-add]");
  await page.waitForSelector('[data-gs-dest="semantic_change/event"]');
  assert.equal(
    (await repo.listWorkflowDestinations({ registry: "semantic_change" })).find(
      (d) => d.option === "event",
    )?.workflowId,
    "event_analysis",
  );
  check("напрямок EVENT створено через справжню форму та HTTP API");
  const open = async (id: string) => {
    await page.goto(base);
    await page.waitForSelector(`[data-run-row="${id}"]`);
    await page.click(`[data-run-row="${id}"]`);
    await page.waitForSelector(`[data-run-detail="${id}"]`);
    await page.waitForSelector("[data-run-semantic-change]");
  };
  const run = await save(
    "[/character:Марко] відчиняє двері у браузерному прогоні.",
  );
  assert.equal(run.status, "succeeded");
  await open(run.id);
  assert.match(
    await page.$eval("[data-run-semantic-change]", (e) => e.textContent ?? ""),
    /EVENT/,
  );
  assert.match(
    await page.$eval("[data-run-semantic-change]", (e) => e.textContent ?? ""),
    /лише зачеплений підграф/,
  );
  assert.deepEqual(
    observed.map((o) => o.workflowId),
    ["event_analysis"],
  );
  assert.deepEqual(observed[0].input.paragraphIds, ["p-one"]);
  check(
    "збереження запускає core_sync, Jev та тільки EVENT-підграф з потрібним абзацом",
  );
  await page.screenshot({
    path: path.join(artifact, "event-desktop.png"),
    fullPage: true,
  });
  await page.click('[data-run-subgraph="event_analysis"]');
  await page.waitForSelector("[data-run-detail]");
  await page.waitForFunction(() =>
    document
      .querySelector("[data-run-detail]")
      ?.textContent?.includes("event_analysis"),
  );
  check("дочірній запуск відкривається з батьківської траси");
  await open(run.id);
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => {
      const r = document
        .querySelector("[data-run-semantic-change]")!
        .getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.right <= innerWidth &&
        document.documentElement.scrollWidth <= innerWidth + 2
      );
    }),
    true,
  );
  await page.screenshot({
    path: path.join(artifact, "event-mobile.png"),
    fullPage: true,
  });
  check("390 px: категорія, причина й область зміни вміщуються в екран");
  await page.setViewport({ width: 1440, height: 1100 });
  await page.click(
    '[data-gs-dest="semantic_change/event"] [data-gs-dest-toggle]',
  );
  await page.click(
    '[data-gs-dest="semantic_change/event"] [data-gs-dest-save]',
  );
  await page.waitForSelector(
    '[data-gs-dest="semantic_change/event"][data-gs-dest-enabled="no"]',
  );
  const disabled = await save(
    "[/character:Марко] подія після вимкнення напрямку.",
  );
  await open(disabled.id);
  assert.match(
    await page.$eval("[data-run-semantic-change]", (e) => e.textContent ?? ""),
    /немає увімкненого напрямку/,
  );
  assert.equal(observed.length, 1);
  check("вимкнення через UI зупиняє підграф, причина видима");
  const calls = control.askCount;
  const unchanged = await save(
    "[/character:Марко]  подія після  вимкнення напрямку.",
  );
  await open(unchanged.id);
  assert.match(
    await page.$eval("[data-run-semantic-change]", (e) => e.textContent ?? ""),
    /Зміст не змінився/,
  );
  assert.equal(control.askCount, calls);
  check("правка пробілів показує NO_SEMANTIC_CHANGE без запиту до моделі");
  const stale = await changeText("[/character:Марко] застарілий варіант.");
  await scheduleSemanticChange(repo, queue, stale);
  await changeText("[/character:Марко] актуальний варіант.");
  await queue.runOnce();
  const staleRun = (
    await repo.listWorkflowRuns({
      workflowId: SEMANTIC_WORKFLOW,
      projectId: stored.id,
    })
  )[0];
  await open(staleRun.id);
  assert.match(
    await page.$eval("[data-run-semantic-change]", (e) => e.textContent ?? ""),
    /Джерело вже змінилося/,
  );
  assert.equal(control.askCount, calls);
  check("застаріла черга показує причину пропуску та не витрачає AI");
  assert.deepEqual(errors, []);
  check("без помилок JavaScript");
  await fs.writeFile(
    path.join(artifact, "report.json"),
    JSON.stringify(
      {
        mode: "real RunsPanel + DestinationsPanel + HTTP + sync + queue + LangGraph; controlled Jev; Memory; no production",
        results,
      },
      null,
      2,
    ),
  );
  console.log(results.length + " перевірок; артефакти: " + artifact);
} finally {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
}
