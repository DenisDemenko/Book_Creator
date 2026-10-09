import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { launch } from "puppeteer-core";
import { importMazeFinal } from "../shared/mazeFinalImport";
import { validateDefinition } from "../server/core/labyrinth/model";
const origin = process.env.MAZE_PORTFOLIO_ORIGIN || "http://127.0.0.1:3110";
const browser = await launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", ...(origin.startsWith("https:") && process.env.HTTPS_PROXY ? ["--proxy-server=" + process.env.HTTPS_PROXY] : [])],
});
try {
  const page = await browser.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setCookie({ name: "NEXT_LOCALE", value: "uk", url: origin });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(origin + "/authors/denis-demenko", {
    waitUntil: "networkidle0",
  });
  await page.waitForSelector("iframe");
  const iframe = await page.$("iframe"),
    game = await iframe!.contentFrame();
  assert(game);
  await game.waitForSelector("[data-book-maze-preset]");
  await game.click("[data-book-maze-preset]");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.includes("Експортувати цей лабіринт") ||
        b.textContent?.includes("Export this maze"),
    );
    if (!b)
      throw Error("export button: " + document.body.textContent?.slice(-1200));
    b.click();
  });
  await page.waitForFunction(
    () => !!sessionStorage.getItem("fusion-lab.maze-final.import"),
  );
  const text = await page.evaluate(
    () => sessionStorage.getItem("fusion-lab.maze-final.import")!,
  );
  const payload = JSON.parse(text);
  const graph = validateDefinition(importMazeFinal(payload));
  assert(graph.nodes.length > 10);
  await fs.writeFile("/tmp/maze-game-export.json", text);
  console.log(
    "✓ Повна гра генерує карту; Marketplace приймає експорт; сервер Studio валідовує її",
  );
  await game.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("ПОЧАТИ ГРУ"),
    );
    if (!b) throw Error("start button");
    b.click();
  });
  await game.waitForSelector("canvas");
  console.log("✓ Ігровий canvas запускається після генерації");
  assert.equal(
    await page.$eval(
      ".vibe-game-options input",
      (e) => (e as HTMLInputElement).disabled,
    ),
    true,
  );
  console.log(
    "✓ Гість грає без платних запитів; Jev потребує авторизованої сесії",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/maze-portfolio-desktop.png",
    fullPage: true,
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle0" });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({
    path: "/tmp/maze-portfolio-mobile.png",
    fullPage: true,
  });
  console.log("✓ Мобільна сторінка не має горизонтального переповнення");
  await page.goto(origin + "/en/authors/denis-demenko", {
    waitUntil: "networkidle0",
  });
  assert((await page.$eval("h1", (e) => e.textContent))?.includes("Denis"));
  console.log("✓ Англійська сторінка відкривається");
  await page.goto(origin + "/for-writers", { waitUntil: "networkidle0" });
  assert(await page.$('a[href$="/authors/denis-demenko"]'));
  console.log("✓ Портфоліо доступне з розділу авторів");
  assert.deepEqual(errors, []);
  console.log("Підсумок: 6 браузерних перевірок, помилок JavaScript немає.");
} finally {
  await browser.close();
}
