/** T5.6: actual RunsPanel → Express routes → LangGraph → Memory repository.
 * Controlled proposals; no paid AI, production login, or production data. */
import assert from "node:assert/strict";
import express from "express";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { editProposal } from "../server/core/storyCore/proposals";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { registerWorkflowRunRoutes } from "../server/core/workflows/runRoutes";
import { startRun } from "../server/core/workflows/engine/runner";
import { reviewFixture } from "./lib/workflowHumanReviewFixture";
const repo = new MemoryCoreRepository(),
  { deps, def } = await reviewFixture(repo);
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.principal = {
    id: req.header("x-user") || "author",
  } as typeof req.principal;
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
app.get("/", (_req, res) =>
  res.send(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/probe.js"></script>',
  ),
);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const artifact = await fs.mkdtemp(
  path.join(os.tmpdir(), "workflow-human-review-"),
);
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
  await page.setViewport({ width: 1280, height: 1000 });
  for (const action of ["accept", "edit", "reject"] as const) {
    const run = (
      await startRun(deps, {
        workflowId: def.id,
        projectId: "book",
        input: {
          proposal: {
            payload: {
              type: "character",
              name: "Browser " + action,
              canonical: {},
            },
            evidence: ["evidence"],
            confidence: 0.9,
          },
        },
        actor: "user:author",
        trigger: "manual",
      })
    ).run;
    const review = run.output!.review as {
      proposalId: string;
      expectedRevision: number;
    };
    const denied = await fetch(
      `${base}/api/core/workflow-runs/${run.id}/resume`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": "stranger" },
        body: JSON.stringify({
          review: {
            action: "accept",
            expectedRevision: review.expectedRevision,
          },
        }),
      },
    );
    assert.equal(denied.status, 403);
    check(action + ": HTTP відмовляє сторонньому користувачу");
    if (action === "accept") {
      const edited = await editProposal(repo, "book", review.proposalId, {
        actor: "user:author",
        expectedRevision: review.expectedRevision,
        payload: { name: "Оновлена пропозиція" },
      });
      const stale = await fetch(
        `${base}/api/core/workflow-runs/${run.id}/resume`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            review: {
              action: "accept",
              expectedRevision: review.expectedRevision,
            },
          }),
        },
      );
      assert.equal(stale.status, 409);
      check("HTTP конфлікт не перезаписує оновлену пропозицію");
      const refreshed = await fetch(
        `${base}/api/core/workflow-runs/${run.id}`,
      ).then((r) => r.json());
      assert.equal(
        refreshed.run.output.review.expectedRevision,
        edited.revision,
      );
      assert.equal(
        refreshed.run.output.review.payload.name,
        "Оновлена пропозиція",
      );
      check("перечитування форми показує актуальну ревізію та зміст");
    }
    await page.goto(base);
    await page.waitForSelector(`[data-run-row="${run.id}"]`);
    await page.click(`[data-run-row="${run.id}"]`);
    await page.waitForSelector("[data-human-review]");
    if (action === "accept") {
      const current = await repo.getStoryProposal("book", review.proposalId);
      await editProposal(repo, "book", review.proposalId, {
        actor: "user:author",
        expectedRevision: current!.revision,
        payload: { name: "Після відкриття форми" },
      });
      await page.evaluate(() => {
        const button = Array.from(
          document.querySelectorAll("[data-human-review] button"),
        ).find((b) => b.textContent === "Прийняти") as HTMLButtonElement;
        button.click();
      });
      await page.waitForSelector('[data-runs-notice="error"]');
      assert.equal((await repo.getWorkflowRun(run.id))?.status, "paused");
      check("відкрита застаріла форма показує конфлікт і зберігає паузу");
      await page.click("[data-review-refresh]");
      await page.waitForFunction(() =>
        (
          (
            document.querySelector(
              '[aria-label="Виправлений зміст пропозиції"]',
            ) as HTMLTextAreaElement
          )?.value || ""
        ).includes("Після відкриття форми"),
      );
      check("Перечитати оновлює форму перед повторним рішенням");
    }

    assert.equal(await page.$('[data-run-action="resume"]'), null);
    assert.ok(await page.$('[data-run-action="cancel"]'));
    check(
      action + ": форма рішення замінює звичайний resume, скасування доступне",
    );
    assert.equal(
      (await repo.listEntities("book")).some(
        (e) => e.name === "Browser " + action,
      ),
      false,
    );
    check(action + ": відкриття форми не пише канон");
    if (action === "edit") {
      await page.focus('[aria-label="Виправлений зміст пропозиції"]');
      await page.keyboard.down("Control");
      await page.keyboard.press("A");
      await page.keyboard.up("Control");
      await page.keyboard.type(
        JSON.stringify({
          type: "character",
          name: "Browser corrected",
          canonical: {},
        }),
      );
    }
    const labels = {
      accept: "Прийняти",
      edit: "Прийняти з правками",
      reject: "Відхилити",
    };
    await page.evaluate((label) => {
      const b = Array.from(
        document.querySelectorAll("[data-human-review] button"),
      ).find((b) => b.textContent === label) as HTMLButtonElement;
      b.click();
    }, labels[action]);
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(`[data-run-row="${id}"]`)
          ?.getAttribute("data-run-status") === "succeeded",
      {},
      run.id,
    );
    const p = await repo.getStoryProposal("book", review.proposalId);
    assert.equal(p?.state, action === "reject" ? "rejected" : "canon");
    if (action === "edit")
      assert.ok(
        p && "name" in p.payload && p.payload.name === "Browser corrected",
      );
    check(action + ": кнопка доводить процес до правильного стану");
    await page.screenshot({
      path: path.join(artifact, action + ".png"),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  check("немає помилок JavaScript");
  await fs.writeFile(
    path.join(artifact, "report.json"),
    JSON.stringify(
      {
        mode: "RunsPanel + real routes/engine + Memory; no production/paid AI",
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
