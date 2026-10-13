import assert from "node:assert/strict";
import type { Express } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { MECHANIC_KINDS, MECHANIC_LIBRARY } from "../shared/labyrinthMechanics";
export async function liveMechanics(
  app: Express,
  origin: string,
  project: string,
) {
  const { build } = await import("esbuild");
  const built = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{LabyrinthBuilder}from'./src/components/labyrinth/LabyrinthBuilder';createRoot(document.getElementById('root')).render(<LabyrinthBuilder book={{id:${JSON.stringify(project)},title:'Т9.5 тест механік',chapters:[]}}/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    outdir: "/tmp/t95-probe",
  });
  const cssFile = (await fs.readdir("dist/assets")).find((f) =>
    /^index-.*\.css$/.test(f),
  );
  assert.ok(cssFile);
  const css = await fs.readFile(path.join("dist/assets", cssFile), "utf8");
  app.get("/t95-probe.js", (_q, r) =>
    r
      .type("js")
      .send(built.outputFiles.find((f) => f.path.endsWith(".js"))!.text),
  );
  app.get("/t95-probe.css", (_q, r) =>
    r
      .type("css")
      .send(
        css +
          (built.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? ""),
      ),
  );
  app.get("/t95-probe", (_q, r) =>
    r.send(
      '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/t95-probe.css"><div id="root"></div><script type="module" src="/t95-probe.js"></script>',
    ),
  );
  const { launch } = await import("puppeteer-core");
  const browser = await launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  let passed = 0;
  const check = (name: string) => {
    passed++;
    console.log(`✓ БРАУЗЕР: ${name}`);
  };
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("dialog", (dialog) => void dialog.accept());
    await page.setExtraHTTPHeaders({ "x-test-user": "owner" });
    await page.setViewport({ width: 1440, height: 1000 });
    const click = async (text: string) => {
      await page.waitForFunction(
        (t) =>
          [...document.querySelectorAll("button")].some(
            (e) =>
              e.textContent?.trim() === t &&
              !e.disabled &&
              !e.closest("fieldset[disabled]"),
          ),
        {},
        text,
      );
      const element = await page.evaluateHandle(
        (t) =>
          [...document.querySelectorAll("button")].find(
            (e) => e.textContent?.trim() === t,
          ),
        text,
      );
      assert.ok(element.asElement());
      await (
        element.asElement() as import("puppeteer-core").ElementHandle<Element>
      ).click();
      await element.dispose();
    };
    for (const kind of MECHANIC_KINDS) {
      await page.goto(origin + "/t95-probe");
      await page.waitForSelector("[data-mechanic-library]");
      await click("Дворівневий приклад");
      await page.evaluate(() => {
        const input = [
          ...document.querySelectorAll("[data-mechanic-library] label"),
        ]
          .find((e) => e.textContent?.startsWith("Механіка з бібліотеки"))
          ?.querySelector("select");
        if (!input) throw new Error("kind select");
        input.setAttribute("data-kind-select", "");
      });
      await page.select("[data-kind-select]", kind);
      await click("Додати механіку до чернетки");
      await page.waitForSelector(`[data-mechanic-kind="${kind}"]`);
      check(`${kind}: реальний preview додав шаблон до чернетки`);
      await click("Зберегти версію");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Збережено v1."),
      );
      await click("Безпечний прогін");
      await page.waitForSelector("[data-runtime-controls]");
      const name = "Запустити: " + MECHANIC_LIBRARY[kind].title;
      await click(name);
      const eventId = await page.evaluate(
        (t) =>
          [
            ...document.querySelectorAll<HTMLDivElement>("[data-event-id]"),
          ].find((e) => e.querySelector("button")?.textContent?.trim() === t)
            ?.dataset.eventId,
        name,
      );
      assert.ok(eventId);
      const eventSelector = `[data-event-id="${eventId}"]`;
      await page.waitForFunction(
        (s) =>
          document.querySelector(s)?.getAttribute("data-phase") === "warning",
        {},
        eventSelector,
      );
      if (kind === "false_route") await click("Йти: Лівий край мосту");
      else await click("Чекати один крок");
      await click("Чекати один крок");
      await page.waitForFunction(
        (s) =>
          document.querySelector(s)?.getAttribute("data-phase") === "active",
        {},
        eventSelector,
      );
      if (kind === "false_route") {
        assert.match(
          await page.$eval(
            "[data-mechanic-belief]",
            (e) => e.textContent ?? "",
          ),
          /переконання/,
        );
        check("Ілюзія: UI показує ознаки обману окремо від фактів карти");
      }
      await click(`${MECHANIC_LIBRARY[kind].response}: armed → resolved`);
      await page.waitForFunction(
        (s) =>
          document.querySelector(s)?.getAttribute("data-resolved") === "true" &&
          document.querySelector(s)?.getAttribute("data-phase") === "cooldown",
        {},
        eventSelector,
      );
      check(
        `${kind}: збережений прогін пройшов warning/active/відповідь/cooldown`,
      );
    }
    await page.setViewport({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    );
    check("390 px: бібліотека та прогін без горизонтального прокручування");
    await page.focus("[data-kind-select]");
    assert.equal(
      await page.evaluate(() => document.activeElement?.tagName),
      "SELECT",
    );
    check("Бібліотека доступна з клавіатури");
    assert.deepEqual(errors, []);
    check("Жодних помилок JavaScript");
    return passed;
  } finally {
    await browser.close();
  }
}
