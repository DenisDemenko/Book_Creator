/** Т5.7 В1: RunsPanel → real HTTP routes/LangGraph, controlled canonical data. */
import assert from "node:assert/strict";
import express from "express";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { registerWorkflowRunRoutes } from "../server/core/workflows/runRoutes";
import { startRun } from "../server/core/workflows/engine/runner";
import { rejectProposal } from "../server/core/storyCore/proposals";
import { continuityFixture } from "./lib/continuityGateFixture";
const repo = new MemoryCoreRepository(),
  fixture = await continuityFixture(repo),
  { deps, def, hero, trait, input } = fixture;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.principal = { id: "author" } as typeof req.principal;
  next();
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
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{RunsPanel}from'./src/components/graphStudio/RunsPanel';createRoot(document.getElementById('root')).render(<RunsPanel abilities={{canPublish:true}}/>);`,
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
const artifact = await fs.mkdtemp(path.join(os.tmpdir(), "continuity-gate-"));
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
  await page.setViewport({ width: 1440, height: 1000 });
  const open = async (id: string) => {
    await page.goto(base);
    await page.waitForSelector(`[data-run-row="${id}"]`);
    await page.click(`[data-run-row="${id}"]`);
    await page.waitForSelector(`[data-run-detail="${id}"]`);
  };
  const blocked = (
    await startRun(deps, {
      workflowId: def.id,
      projectId: "book",
      input: input("Browser blocked", 40),
      trigger: "manual",
      actor: "user:author",
    })
  ).run;
  await open(blocked.id);
  await page.waitForSelector(
    '[data-run-continuity="gate"][data-continuity-result="block"]',
  );
  check("заблокований шлюз видно в трасі");
  assert.match(
    await page.$eval("[data-continuity-blocker]", (e) => e.textContent ?? ""),
    /вік/,
  );
  assert.equal(await page.$("[data-human-review]"), null);
  check("причина блокування видима, людського схвалення немає");
  assert.equal((await repo.getEntity("book", hero.id))?.name, hero.name);
  check("браузерне відкриття не змінює канон");
  await page.screenshot({
    path: path.join(artifact, "blocked-desktop.png"),
    fullPage: true,
  });
  await page.setViewport({ width: 390, height: 844 });
  assert.ok(await page.$("[data-continuity-blocker]"));
  assert.equal(
    await page.evaluate(
      () => {
        const reason = document.querySelector('[data-continuity-blocker]')!.getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth + 2 &&
          reason.left >= 0 && reason.right <= innerWidth;
      },
    ),
    true,
  );
  check("390 px: причина доступна, сторінка не виходить за ширину");
  await page.screenshot({
    path: path.join(artifact, "blocked-mobile.png"),
    fullPage: true,
  });
  await page.setViewport({ width: 1440, height: 1000 });
  const bp = await repo.getStoryProposal(
    "book",
    String(blocked.output?.proposalId),
  );
  await rejectProposal(repo, "book", bp!.id, {
    actor: "user:author",
    expectedRevision: bp!.revision,
  });
  const passed = (
    await startRun(deps, {
      workflowId: def.id,
      projectId: "book",
      input: input("Browser approved", 30),
      trigger: "manual",
      actor: "user:author",
    })
  ).run;
  await open(passed.id);
  await page.waitForSelector(
    '[data-run-continuity="gate"][data-continuity-result="pass"]',
  );
  await page.waitForSelector("[data-human-review]");
  check("pass відкриває форму людського рішення");
  const accept = async () => {
    await page.evaluate(() => {
      const b = Array.from(
        document.querySelectorAll("[data-human-review] button"),
      ).find((b) => b.textContent === "Прийняти") as HTMLButtonElement;
      b.click();
    });
  };
  await accept();
  await page.waitForSelector(
    '[data-run-continuity="canon"][data-continuity-result="pass"]',
  );
  assert.equal(
    (await repo.getEntity("book", hero.id))?.name,
    "Browser approved",
  );
  check("прийняття записує канон після другої перевірки");
  const drift = (
    await startRun(deps, {
      workflowId: def.id,
      projectId: "book",
      input: input("Browser drift", 30),
      trigger: "manual",
      actor: "user:author",
    })
  ).run;
  await open(drift.id);
  await page.waitForSelector("[data-human-review]");
  await repo.setEntityTraitStatus("book", trait.id, "rejected", "user:author");
  await repo.upsertEntityTrait({
    projectId: "book",
    entityId: hero.id,
    label: "вік",
    value: "45",
    sectionId: "scene",
    status: "confirmed",
    createdBy: "user:author",
  });
  await accept();
  await page.waitForSelector(
    '[data-run-continuity="canon"][data-continuity-result="block"]',
  );
  assert.equal((await repo.getWorkflowRun(drift.id))?.status, "failed");
  check("зміна канону під час очікування зупиняє CANON_WRITE");
  assert.equal(
    (await repo.getEntity("book", hero.id))?.name,
    "Browser approved",
  );
  assert.ok(await page.$("[data-run-error]"));
  check("канон збережений, помилка видима");
  await page.screenshot({
    path: path.join(artifact, "changed-canon.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  check("немає помилок JavaScript");
  await fs.writeFile(
    path.join(artifact, "report.json"),
    JSON.stringify(
      {
        mode: "real RunsPanel/routes/engine + Memory; no production or paid AI",
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
