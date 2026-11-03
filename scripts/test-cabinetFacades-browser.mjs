// Real Studio host + existing calibration editor; local stock fixture only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
const temp = await mkdtemp(path.join(tmpdir(), "cabinet-facade-admin-"));
const bundled = await build({
  stdin: {
    contents:
      "import React from 'react';import{createRoot}from'react-dom/client';import{SlabInventoryPanel}from'./src/components/adminOs/SlabInventoryPanel';createRoot(document.getElementById('root')).render(<SlabInventoryPanel category='cabinet_facade' inventoryOnly/>);",
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  jsx: "automatic",
  define: { "import.meta.env.BASE_URL": JSON.stringify("/") },
});
const calls = [],
  errors = [],
  slabs = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<style>iframe{width:100%;height:1500px;border:0}</style><div id="root"></div><script type="module" src="/host.js"></script>',
      );
      return;
    }
    if (url.pathname === "/host.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundled.outputFiles[0].text);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      let raw = "";
      for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ path: url.pathname, method: req.method, body });
      res.setHeader("Content-Type", "application/json");
      if (
        req.method === "GET" &&
        url.pathname === "/api/admin/slab-tables/facade-state"
      )
        res.end(
          JSON.stringify({
            slabs,
            costs: {},
            legs: {},
            resinTextures: [],
            capabilities: { slabContourMaxPoints: 128 },
          }),
        );
      else if (
        req.method === "POST" &&
        url.pathname === "/api/admin/slab-tables/slabs"
      ) {
        slabs.push({ ...body, id: "facade-one", available: true });
        res.end(JSON.stringify(slabs[0]));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
      return;
    }
    if (!url.pathname.startsWith("/slab-studio/")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        ".js": "text/javascript",
        ".html": "text/html",
        ".css": "text/css",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
      }[path.extname(url.pathname)] || "application/octet-stream",
    );
    res.end(await readFile(path.join(process.cwd(), "public", url.pathname)));
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1050 });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector("iframe");
  const frame = await (await page.$("iframe")).contentFrame();
  await frame.waitForFunction(
    () => document.body.dataset.slabCategory === "cabinet_facade",
  );
  assert.equal(
    await frame.$$eval("[data-view]:not([hidden])", (nodes) =>
      nodes.every((n) => n.dataset.view === "inventory"),
    ),
    true,
  );
  const photo = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 400;
    const x = c.getContext("2d");
    x.fillStyle = "#a17144";
    x.fillRect(0, 0, 120, 400);
    return c.toDataURL("image/png");
  });
  const file = path.join(temp, "slab.png");
  await writeFile(file, Buffer.from(photo.split(",")[1], "base64"));
  await frame.click("#newSlab");
  await (await frame.$("#slabPhoto")).uploadFile(file);
  await frame.waitForFunction(() =>
    document
      .querySelector("#photoHint")
      .textContent.includes("Введіть реальну відстань"),
  );
  await frame.click("#calibrate");
  const clickPoint = async (x, y) =>
    frame.evaluate(
      ([x, y]) => {
        const c = document.querySelector("#photoCanvas"),
          r = c.getBoundingClientRect(),
          fit = Math.min((c.width - 32) / 120, (c.height - 40) / 400),
          xx = c.width / 2 + (x - 60) * fit,
          yy = c.height / 2 + (y - 200) * fit;
        c.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            clientX: r.left + (xx / c.width) * r.width,
            clientY: r.top + (yy / c.height) * r.height,
          }),
        );
        c.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          }),
        );
      },
      [x, y],
    );
  await clickPoint(0, 0);
  await clickPoint(0, 100);
  await frame.$eval("#pointContour", (b) => b.click());
  for (const p of [
    [0, 0],
    [120, 0],
    [120, 400],
    [0, 400],
  ])
    await clickPoint(...p);
  await frame.$eval("#closeContour", (b) => b.click());
  await frame.$eval("#contourVerified", (b) => b.click());
  assert.equal(await frame.$eval("#saveSlab", (b) => b.disabled), false);
  await frame.$eval("#saveSlab", (b) => b.click());
  await frame.waitForFunction(
    () => !document.querySelector("#slabDialog").open,
  );
  const saved = calls.find((c) => c.method === "POST").body;
  assert.equal(saved.category, "cabinet_facade");
  assert.equal(saved.calibration.version, 2);
  assert.equal(saved.calibration.verified, true);
  assert.equal(saved.contourClosed, true);
  assert(Math.abs(saved.w - 60) < 0.001);
  assert(Math.abs(saved.h - 200) < 0.001);
  assert.equal(saved.points.length, 4);
  assert.match(saved.photo, /^data:image\//);
  assert(
    calls
      .filter(
        (c) => c.method === "GET" && /\/(state|facade-state)$/.test(c.path),
      )
      .every((c) => c.path.endsWith("/facade-state")),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Studio facade module, isolated catalog, real photo upload, two-point scale, closed contour, verified 60×200 cm, category forced by host, no provider or live stock calls.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await rm(temp, { recursive: true, force: true });
}
