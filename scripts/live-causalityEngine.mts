/** T5.7 В4: real proposal review UI and author-only canonical write. */
import assert from "node:assert/strict";
import express from "express";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RelationProposalPayload } from "../server/core/types";
import type { AddressInfo } from "node:net";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { registerWorkflowRunRoutes } from "../server/core/workflows/runRoutes";
import { causalityFixture } from "./lib/causalityEngineFixture";
import { startRun } from "../server/core/workflows/engine/runner";
import { CAUSALITY_WORKFLOW } from "../server/core/causalityCandidates";
import { registerStoryCoreRoutes } from "../server/core/storyCore/routes";
const repo = new MemoryCoreRepository();
const { deps, stored, effect, cause } = await causalityFixture(repo);
const execute = () =>
  startRun(deps, {
    workflowId: CAUSALITY_WORKFLOW,
    projectId: stored.id,
    input: { eventId: effect.id },
    actor: "user:author",
    trigger: "manual",
  });
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.principal = {
    id: "author",
    role: "admin",
    isGuest: false,
  } as typeof req.principal;
  next();
});
registerWorkflowRunRoutes(app, {
  repo: () => repo,
  engine: () => deps,
  requireStudio: (_r, _s, n) => n(),
  requireControl: (_r, _s, n) => n(),
});
registerStoryCoreRoutes(app, {
  repo: () => repo,
  requireAuth: (_r, _s, n) => n(),
  canPublishSchema: async () => true,
  access: {
    getBookOwnerId: async () => "author",
    getCollabOwnerId: async () => undefined,
    listAcceptedInvites: async () => [],
  },
});
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{RunsPanel}from'./src/components/graphStudio/RunsPanel';import{StoryGraphPanel}from'./src/components/graphStudio/StoryGraphPanel';createRoot(document.getElementById('root')).render(<div className="space-y-4"><RunsPanel abilities={{canPublish:true}}/><StoryGraphPanel/></div>);`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  bundle: true,
  outdir: "/tmp/causality-browser-bundle",
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
const artifact = await fs.mkdtemp(path.join(os.tmpdir(), "causality-engine-"));
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
  const before = await repo.listRelations(stored.id);
  const output = await execute();
  assert.equal(output.run.status, "succeeded");
  const proposalId = String(
    (output.run.output as any).causalityEngine.proposalId,
  );
  await page.goto(base);
  await page.waitForSelector(`[data-run-row="${output.run.id}"]`);
  await page.click(`[data-run-row="${output.run.id}"]`);
  await page.waitForSelector("[data-run-causality]");
  assert.match(
    await page.$eval("[data-run-causality]", (e) => e.textContent ?? ""),
    /рішення приймає автор/,
  );
  check(
    "у Runs видимі кандидат, підтримка і пропозиція замість автоматичного канону",
  );
  await page.waitForSelector(`[data-gs-proposal="${proposalId}"]`);
  await page.click(`[data-gs-proposal="${proposalId}"]`);
  await page.waitForSelector(
    `[data-gs-proposal="${proposalId}"] [data-gs-proposal-approve]`,
  );
  check("причинна пропозиція доступна у справжній панелі Story Graph");
  assert.deepEqual(await repo.listRelations(stored.id), before);
  check("до рішення автора канонічні зв’язки незмінні");
  await page.screenshot({
    path: path.join(artifact, "proposal-desktop.png"),
    fullPage: true,
  });
  await page.click(
    `[data-gs-proposal="${proposalId}"] [data-gs-proposal-edit-toggle]`,
  );
  await page.type(
    `[data-gs-proposal="${proposalId}"] [data-gs-proposal-edit-name]`,
    " Автор перевірив причинність.",
  );
  await page.click(
    `[data-gs-proposal="${proposalId}"] [data-gs-proposal-approve]`,
  );
  await page.waitForSelector(
    `[data-gs-proposal="${proposalId}"][data-gs-proposal-state="approved"]`,
  );
  assert.match(
    String(((await repo.getStoryProposal(stored.id, proposalId))!.payload as RelationProposalPayload).note),
    /Автор перевірив/,
  );
  assert.deepEqual(await repo.listRelations(stored.id), before);
  check("правка й схвалення автора збережені через HTTP без запису в канон");
  await page.setViewport({ width: 390, height: 844 });
  const box = await page.$eval("[data-run-causality]", (e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right };
  });
  assert.ok(box.left >= 0 && box.right <= 391);
  await page.screenshot({
    path: path.join(artifact, "mobile.png"),
    fullPage: true,
  });
  check("звіт причинності читається на ширині 390 px");
  await page.setViewport({ width: 1440, height: 1100 });
  await page.click(`[data-gs-proposal="${proposalId}"]`);
  await page.waitForSelector(
    `[data-gs-proposal="${proposalId}"] [data-gs-proposal-canon]`,
  );
  await page.click(
    `[data-gs-proposal="${proposalId}"] [data-gs-proposal-canon]`,
  );
  await page.waitForFunction(
    () =>
      !!document
        .querySelector("[data-gs-story-notice]")
        ?.textContent?.includes("Записано в канон"),
  );
  const canonical = (await repo.listRelations(stored.id)).find(
    (r) =>
      r.type === "caused_by" && r.fromId === effect.id && r.toId === cause.id,
  );
  assert.equal(canonical?.status, "confirmed");
  check(
    "лише окрема авторська дія записує перевірений причинний зв’язок у канон",
  );
  assert.deepEqual(errors, []);
  check("браузерний прогін без помилок JavaScript");
  await fs.writeFile(
    path.join(artifact, "report.json"),
    JSON.stringify({ passed: results.length, results }, null, 2),
  );
  console.log(`${results.length} браузерних перевірок пройшло; ${artifact}`);
} finally {
  await browser?.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
}
