import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import type { AddressInfo } from "node:net";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "creative-projects-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, "books.db");
const db = await import("../server/db");
await db.initDb();
const books = await import("../server/bookStore");
await books.saveBook({
  ownerId: "owner",
  book: {
    id: "book",
    title: "Приватна книга",
    chapters: [{ id: "c", sections: [{ id: "s", content: "SECRET TEXT" }] }],
  },
});
const { registerCreativeProjectRoutes, listCreativeProjects } =
  await import("../server/core/creative/projects");
const repo = new MemoryCoreRepository();
let disabled = false;
const deps = {
  repo: () => repo,
  principal: async (id: string) =>
    disabled
      ? null
      : ({
          id,
          role: id === "admin" ? "admin" : "writer",
          isGuest: false,
        } as any),
  access: {
    getBookOwnerId: async (id: string) => (await books.getBook(id))?.ownerId,
    getCollabOwnerId: async () => undefined,
    listAcceptedInvites: async () => [],
  },
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers["x-user"] ?? "owner");
  req.principal = {
    id,
    role: id === "admin" ? "admin" : "writer",
    isGuest: id === "guest",
  } as any;
  next();
});
registerCreativeProjectRoutes(app, deps);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  url = root + "/api/core/projects/book/creative-projects";
let count = 0;
const check = (s: string) => {
  count++;
  console.log("✓ " + s);
};
async function request(user: string, body?: unknown) {
  return fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-user": user, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
try {
  for (const user of ["outsider", "admin", "guest"]) {
    assert.equal((await request(user)).status, user === "guest" ? 401 : 403);
    assert.equal(
      (await request(user, { title: "Заборонено" })).status,
      user === "guest" ? 401 : 403,
    );
    check(user + " не читає і не створює творчі проєкти власника");
  }
  assert.equal((await request("owner", { title: "x" })).status, 422);
  assert.equal(
    (await request("owner", { title: "Проєкт", specialistId: "outsider" }))
      .status,
    422,
  );
  check("перевірка назви й заборона прихованого призначення фахівця");
  const before = await books.getBook("book");
  const created = await request("owner", { title: "Обкладинка" });
  assert.equal(created.status, 201);
  const p = (await created.json()).project;
  assert.equal(p.status, "DRAFT");
  assert.equal(p.bookId, "book");
  assert.equal(p.ownerId, "owner");
  assert.equal(p.specialistId, null);
  assert.equal(p.orderId, null);
  check("власник створює CreativeProject у стані DRAFT");
  assert.equal(
    (await request("owner")).headers.get("cache-control"),
    "no-store",
  );
  assert.equal((await (await request("owner")).json()).projects[0].id, p.id);
  check("API повертає збережений проєкт без кешування");
  assert.deepEqual(await books.getBook("book"), before);
  assert.deepEqual(await repo.listAccessGrants({ projectId: "book" }), []);
  assert.deepEqual(await repo.listParticipants("book"), []);
  assert.ok(!JSON.stringify(p).includes("SECRET TEXT"));
  check("створення не змінює книгу, учасників чи grants і не копіює текст");
  disabled = true;
  assert.equal((await request("owner", { title: "Вимкнений" })).status, 403);
  disabled = false;
  check("вимкнений обліковий запис не створює проєкт");
  db.closeDb();
  await db.initDb();
  assert.equal(listCreativeProjects("book", "owner")[0].id, p.id);
  check("SQLite зберігає проєкт після повторного відкриття");
  if (process.argv.includes("--browser")) {
    const { build } = await import("esbuild");
    const built = await build({
      stdin: {
        contents: `import React from'react';import{createRoot}from'react-dom/client';import{CreativeProjects}from'./src/components/CreativeProjects';createRoot(document.getElementById('root')).render(<CreativeProjects bookId="book"/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
    });
    const css = (await fs.readdir("dist/assets")).find((f) =>
      /^index-.*\.css$/.test(f),
    );
    assert.ok(css);
    const cssText = await fs.readFile(path.join("dist/assets", css), "utf8");
    app.get("/probe.js", (_q, r) =>
      r.type("js").send(built.outputFiles[0].text),
    );
    app.get("/style.css", (_q, r) => r.type("css").send(cssText));
    app.get("/probe", (_q, r) =>
      r.send(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root" class="p-4 bg-slate-950 text-slate-100"></div><script src="/probe.js"></script>',
      ),
    );
    const { launch } = await import("puppeteer-core");
    const browser = await launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(root + "/probe");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Обкладинка"),
      );
      await page.type("input", "Ілюстрації — браузер");
      await page.click("button");
      await page.waitForFunction(() =>
        document
          .querySelector("ul")
          ?.textContent?.includes("Ілюстрації — браузер"),
      );
      await page.reload();
      await page.waitForFunction(() =>
        document
          .querySelector("ul")
          ?.textContent?.includes("Ілюстрації — браузер"),
      );
      check("БРАУЗЕР: створення та збереження після перезавантаження");
      await page.setViewport({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(dir, "creative-mobile.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      check("БРАУЗЕР: 390px, без переповнення та JS-помилок");
    } finally {
      await browser.close();
    }
  }
  console.log(`Підсумок: ${count} пройшло. Артефакти: ${dir}`);
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.closeDb();
}
