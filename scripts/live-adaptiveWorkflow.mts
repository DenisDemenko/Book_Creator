/** T5.7 В3: real policy editor and scoped adaptive analysis. */
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
import { adaptiveFixture } from "./lib/adaptiveWorkflowFixture";
import { ADAPTIVE_WORKFLOW } from "../src/utils/adaptiveWorkflow";
import { registerWorkflowRoutes } from "../server/core/workflows/routes";
import { blockHash } from "../src/utils/paragraphIds";
const repo = new MemoryCoreRepository();
const { deps, stored, control, observed } = await adaptiveFixture(repo);
control.score = 3;
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
registerWorkflowRoutes(app, {
  repo: () => repo,
  requireStudio: (_r, _s, n) => n(),
  requireAdmin: (_r, _s, n) => n(),
  requirePublish: (_r, _s, n) => n(),
});
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{RunsPanel}from'./src/components/graphStudio/RunsPanel';import{WorkflowEditor}from'./src/components/graphStudio/WorkflowEditor';createRoot(document.getElementById('root')).render(<div className="space-y-4"><RunsPanel abilities={{canPublish:true}}/><WorkflowEditor abilities={{role:"admin",canEdit:true,canPublish:true}}/></div>);`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  bundle: true,
  outdir: "/tmp/adaptive-browser-bundle",
  write: false,
  platform: "browser",
  format: "esm",
  define: { "process.env.NODE_ENV": '"development"' },
});
app.get("/probe.js", (_req, res) =>
  res
    .type("js")
    .send(bundle.outputFiles.find((x) => x.path.endsWith(".js"))!.text),
);
const css = (await fs.readdir("dist/assets")).filter((x) => x.endsWith(".css"));
const styles =
  (
    await Promise.all(
      css.map((x) => fs.readFile(path.join("dist/assets", x), "utf8")),
    )
  ).join("\n") +
  "\n" +
  (bundle.outputFiles.find((x) => x.path.endsWith(".css"))?.text ?? "");
app.get("/probe.css", (_req, res) => res.type("css").send(styles));
app.get("/", (_req, res) =>
  res.send(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><body style="background:#020617;color:#e2e8f0;padding:12px"><div id="root"></div><script type="module" src="/probe.js"></script>',
  ),
);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const artifact = await fs.mkdtemp(path.join(os.tmpdir(), "adaptive-workflow-"));
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
  await page.waitForSelector('[data-wf-item="adaptive_workflow"]');
  await page.click('[data-wf-item="adaptive_workflow"]');
  await page.waitForSelector('[data-wf-env="production"]');
  await page.click('[data-wf-node="dispatch"]');
  await page.waitForSelector('[data-wf-param="adaptive_policy"]');
  assert.equal(
    await page.$eval(
      '[data-wf-param="adaptive_policy"]',
      (e) => (e as HTMLTextAreaElement).disabled,
    ),
    true,
  );
  check("опублікована політика доступна лише для перегляду");
  await page.click('[data-wf-action="edit"]');
  await page.waitForSelector('[data-wf-env="draft"]');
  await page.click('[data-wf-node="dispatch"]');
  const field = '[data-wf-param="adaptive_policy"]';
  const original = await page.$eval(field, (e) =>
    JSON.parse((e as HTMLTextAreaElement).value),
  );
  const replace = async (value: string) => {
    await page.click(field);
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.sendCharacter(value);
    await page.click("[data-wf-node-label]");
  };
  await replace(
    JSON.stringify({ ...original, medium: 2, high: 1, critical: 5 }),
  );
  await page.click('[data-wf-action="validate"]');
  await page.waitForSelector('[data-wf-issue="bad_adaptive_policy"]');
  check("неправильний порядок порогів показує помилку в інспекторі");
  await replace(
    JSON.stringify({ ...original, medium: 2, high: 4, critical: 5 }),
  );
  await page.click('[data-wf-action="save"]');
  await page.waitForFunction(() => !document.querySelector("[data-wf-dirty]"));
  await page.click('[data-wf-action="validate"]');
  await page.waitForFunction(
    () =>
      !(document.querySelector('[data-wf-action="test"]') as HTMLButtonElement)
        ?.disabled,
  );
  await page.click('[data-wf-action="test"]');
  await page.waitForSelector('[data-wf-env="test"]');
  await page.click('[data-wf-action="publish"]');
  await page.waitForSelector('[data-wf-env="production"]');
  check(
    "змінені пороги збережено, перевірено й опубліковано через справжній UI та HTTP",
  );
  const parent = await save(
    "[/character:Марко] важлива подія у браузерному прогоні.",
  );
  assert.equal(parent.status, "succeeded");
  const id = String((parent.output as any).semanticChange.childRunId);
  const child = await repo.getWorkflowRun(id);
  assert.equal((child!.output as any).adaptiveWorkflow.tier, "CRITICAL");
  assert.equal((child!.output as any).adaptiveWorkflow.depth, "deep");
  assert.deepEqual(
    observed.map((o) => o.workflowId),
    ["time_analysis"],
  );
  check("нові пороги змінюють реальний маршрут черги на deep");
  const open = async (runId: string) => {
    await page.goto(base);
    await page.waitForSelector(`[data-run-row="${runId}"]`);
    await page.click(`[data-run-row="${runId}"]`);
    await page.waitForSelector("[data-run-adaptive]");
  };
  await open(id);
  assert.match(
    await page.$eval("[data-run-adaptive]", (e) => e.textContent ?? ""),
    /CRITICAL.*deep/,
  );
  assert.match(
    await page.$eval("[data-run-adaptive]", (e) => e.textContent ?? ""),
    /2 \/ 4 \/ 5/,
  );
  await page.screenshot({
    path: path.join(artifact, "desktop.png"),
    fullPage: true,
  });
  check("звіт показує оцінку, глибину і саме опубліковані пороги");
  await page.click('[data-run-subgraph="time_analysis"]');
  await page.waitForSelector(
    `[data-run-detail="${(child!.output as any).adaptiveWorkflow.childRunId}"]`,
  );
  check("із траси відкривається підграф вибраної глибини");
  await page.setViewport({ width: 390, height: 844 });
  await open(id);
  const box = await page.$eval("[data-run-adaptive]", (e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right };
  });
  assert.ok(box.left >= 0 && box.right <= 391);
  await page.screenshot({
    path: path.join(artifact, "mobile.png"),
    fullPage: true,
  });
  check("звіт читається на ширині 390 px");
  control.score = 0;
  const low = await save("[/character:Марко] незначна правка.");
  const lowId = String((low.output as any).semanticChange.childRunId);
  await open(lowId);
  assert.match(
    await page.$eval("[data-run-adaptive]", (e) => e.textContent ?? ""),
    /пропуск за політикою/,
  );
  assert.equal(observed.length, 1);
  check("LOW пропускає аналіз і пояснює причину");
  assert.deepEqual(errors, []);
  check("браузерний сценарій завершено без помилок JavaScript");
  await fs.writeFile(
    path.join(artifact, "report.json"),
    JSON.stringify({ passed: results.length, results }, null, 2),
  );
  console.log(`${results.length} браузерних перевірок пройшло; ${artifact}`);
} finally {
  await browser?.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
}
