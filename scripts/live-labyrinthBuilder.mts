import assert from "node:assert/strict";
import type { Express } from "express";
import type { Pool } from "pg";
import fs from "node:fs/promises";
import path from "node:path";
export async function liveLabyrinthBuilder(
  app: Express,
  origin: string,
  project: string,
  pool: Pool,
) {
  const { build } = await import("esbuild");
  const built = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BookStructureBuilder}from'./src/components/BookStructureBuilder';import{LanguageProvider}from'./src/i18n/LanguageContext';const book={id:${JSON.stringify(project)},title:'Жива карта',chapters:[{id:'chapter',title:'Наявний розділ',sections:[{id:'own-scene',title:'Власна сцена',content:'Рукопис лишається в редакторі'}]}]};createRoot(document.getElementById('root')).render(<LanguageProvider><BookStructureBuilder book={book} onUpdateBook={()=>{window.canonWrites=(window.canonWrites||0)+1}} onNavigateToTab={()=>{}} onOpenSection={(c,s)=>{window.openedSection=[c,s]}}/></LanguageProvider>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    outdir: "/tmp/labyrinth-probe",
  });
  app.get("/labyrinth/maze-reference.svg", async (_q, r) =>
    r
      .type("svg")
      .send(await fs.readFile("public/labyrinth/maze-reference.svg", "utf8")),
  );
  app.get("/labyrinth-probe.js", (_q, r) =>
    r
      .type("js")
      .send(built.outputFiles.find((f) => f.path.endsWith(".js"))!.text),
  );
  const cssName = (await fs.readdir("dist/assets")).find((f) =>
    /^index-.*\.css$/.test(f),
  );
  assert.ok(cssName);
  const css =
    (await fs.readFile(path.join("dist/assets", cssName), "utf8")) +
    "\n" +
    (built.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "");
  app.get("/labyrinth-probe.css", (_q, r) => r.type("css").send(css));
  app.get("/labyrinth-probe", (_q, r) =>
    r.send(
      '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/labyrinth-probe.css"><div id="root"></div><script type="module" src="/labyrinth-probe.js"></script>',
    ),
  );
  const { launch } = await import("puppeteer-core");
  const browser = await launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  let count = 0;
  const check = (s: string) => {
    count++;
    console.log("✓ БРАУЗЕР: " + s);
  };
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("dialog", (dialog) => void dialog.accept());
    page.on("pageerror", (e) => errors.push(String(e)));
    let user = "owner";
    await page.setRequestInterception(true);
    page.on("request", (r) =>
      r.continue({ headers: { ...r.headers(), "x-test-user": user } }),
    );
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(origin + "/labyrinth-probe");
    const click = async (text: string) => {
      await page.waitForFunction(
        (t) =>
          [...document.querySelectorAll("button")].some(
            (e) => e.textContent?.trim() === t && !e.disabled,
          ),
        {},
        text,
      );
      const handle = await page.evaluateHandle(
        (t) =>
          [...document.querySelectorAll("button")].find(
            (e) => e.textContent?.trim() === t,
          ),
        text,
      );
      const el = handle.asElement();
      assert.ok(el, `button ${text}`);
      await (el as import("puppeteer-core").ElementHandle<Element>).click();
      await handle.dispose();
    };
    const field = async (label: string) => {
      await page.evaluate((t) => {
        document
          .querySelector("[data-probe-field]")
          ?.removeAttribute("data-probe-field");
        const l = [...document.querySelectorAll("label")].find((e) =>
          e.textContent?.trim().startsWith(t),
        );
        const e = l?.querySelector("input,select,textarea");
        if (!e) throw new Error("field " + t);
        e.setAttribute("data-probe-field", "");
      }, label);
      return "[data-probe-field]";
    };
    const text = async (label: string, value: string) => {
      const selector = await field(label);
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(selector, value);
    };
    const pick = async (label: string, name: string) => {
      const selector = await field(label);
      const value = await page.$eval(
        selector,
        (el, n) =>
          [...(el as HTMLSelectElement).options].find((o) =>
            o.textContent?.startsWith(n),
          )?.value,
        name,
      );
      assert.ok(value !== undefined, `${label}: ${name}`);
      await page.select(selector, value!);
    };
    const waitText = async (t: string) =>
      page.waitForFunction(
        (t) => document.body.textContent?.includes(t),
        {},
        t,
      );
    await click("Книга-лабіринт");
    await page.waitForSelector("[data-labyrinth-builder]");
    check("Режим доповнює існуючий Конструктор структури");
    await text("Назва карти", "T9.2 браузерний конструктор");
    for (const [name, level] of [
      ["Нижній вихід", "Нижній"],
      ["Верхній лівий", "Верхній"],
      ["Верхній правий", "Верхній"],
    ]) {
      await click("Додати сцену");
      await text("Назва сцени", name);
      await pick("Рівень сцени", level);
    }
    check("Автор створив сцени двох рівнів без JSON/коду");
    // Make the new lower node the exit; initial entry is no longer an exit.
    await page.evaluate(() => {
      const f = [...document.querySelectorAll("fieldset")].find(
        (e) =>
          [...e.children].find((c) => c.tagName === "LEGEND")?.textContent ===
          "Виходи",
      )!;
      for (const l of f.querySelectorAll("label")) {
        const i = l.querySelector("input")!;
        const desired = l.textContent?.includes("Нижній вихід") ?? false;
        if (i.checked !== desired) i.click();
      }
    });
    await waitText("недосяжний");
    check("Недосяжний вихід показаний до збереження");
    await click("Переходи");
    for (const [from, to, kind] of [
      ["Вхід", "Нижній вихід", "Коридор"],
      ["Вхід", "Верхній лівий", "Сходи"],
      ["Верхній лівий", "Верхній правий", "Міст"],
      ["Верхній правий", "Нижній вихід", "Драбина"],
    ]) {
      await click("Додати перехід");
      await pick("Звідки", from);
      await pick("Куди", to);
      await pick("Тип переходу", kind);
    }
    check("Форми створили коридор, сходи, міст і драбину");
    await click("Механізми");
    await click("Додати механізм");
    await pick("Тип механізму", "Генератор");
    await click("Додати механізм");
    await pick("Тип механізму", "Решітка");
    // Link the generator transition to the gate through the actual effects form.
    const objectButtons = await page.$$eval("aside button", (els) =>
      els
        .map((e) => e.textContent!.trim())
        .filter((s) => s.startsWith("object-")),
    );
    await click(objectButtons[0]);
    await page.evaluate(() => {
      const f = [...document.querySelectorAll("fieldset")].find(
        (e) =>
          [...e.children].find((c) => c.tagName === "LEGEND")?.textContent ===
          "Зміни пов’язаних об’єктів",
      )!;
      f.querySelector("button")!.click();
    });
    await pick("Стан правила", "off");
    check("Форма зв’язала зміну генератора зі станом решітки");
    await click("Події");
    await click("Додати подію");
    await text("Попередження", "Газ починає підійматися");
    await text("Підказка обходу", "Сходами до верхнього мосту");
    check("Створено механізм і подію з попередженням та обходом");
    // Bind an existing manuscript scene; this uses the existing editor, no canonical text write.
    await click("Сцени");
    await click("Вхід");
    await pick("Сцена з книги", "Наявний розділ");
    await click("Перевірити карту");
    await waitText("Серверна перевірка структури");
    assert.equal(await page.$$eval("[data-design-issue]", (e) => e.length), 0);
    check("Сервер перевірив посилання й прохідність виправленої карти");
    await click("Зберегти версію");
    await waitText("Збережено v1");
    const rows = await pool.query(
      "SELECT map_id,revision,definition FROM labyrinth_versions WHERE project_id=$1 AND definition->>'title'=$2 ORDER BY revision",
      [project, "T9.2 браузерний конструктор"],
    );
    assert.equal(rows.rows.length, 1);
    const map = rows.rows[0];
    assert.equal(map.definition.nodes.length, 4);
    assert.ok(map.definition.edges.some((e: any) => e.kind === "bridge"));
    assert.equal(
      map.definition.nodes.find((n: any) => n.id === "entry").sceneId,
      "own-scene",
    );
    assert.equal(
      map.definition.objects[0].transitions[0].effects[0].objectId,
      map.definition.objects[1].id,
    );
    assert.equal(
      map.definition.objects[0].transitions[0].effects[0].state,
      "off",
    );
    check("Форми зберегли справжню незмінну версію в PostgreSQL");
    await click("Відкрити текст у редакторі");
    assert.deepEqual(await page.evaluate(() => (window as any).openedSection), [
      "chapter",
      "own-scene",
    ]);
    assert.equal(
      await page.evaluate(() => (window as any).canonWrites || 0),
      0,
    );
    check("Перехід у наявний редактор не дублює текст і не переписує канон");
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".react-flow__node").length === 4 &&
        [...document.querySelectorAll(".react-flow__node")].every(
          (e) => getComputedStyle(e).visibility === "visible",
        ),
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".react-flow__edge").length === 4,
    );
    check("Карта відображає всі чотири вузли й переходи, не лише форми");
    await page.screenshot({ path: "/tmp/t92-desktop.png", fullPage: true });
    await click("Тестовий прогін");
    await page.waitForSelector("[data-labyrinth-run]");
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-route-description]")
          ?.getAttribute("data-description-node") === "entry",
    );
    assert.ok(await page.$('.react-flow__node[aria-label*="Герой"]'));
    check("Поточна позиція героя позначена на графі та в описі");
    await click("Йти: Верхній лівий");
    await waitText("хід 1");
    await click("Йти: Верхній правий");
    await waitText("хід 2");
    await click("Йти: Нижній вихід");
    await waitText("хід 3");
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-route-description]")
          ?.getAttribute("data-description-revision") === "3",
    );
    const descriptionNode = await page.$eval("[data-route-description]", (e) =>
      e.getAttribute("data-description-node"),
    );
    assert.ok(
      await page.$(
        `.react-flow__node[data-id="${descriptionNode}"][aria-label*="Герой"]`,
      ),
    );
    check("Після ходу опис і маркер показують одну позицію/ревізію");
    check("Автор пройшов сходи → міст → драбину через справжній API");
    await click("Сцени");
    await click("Вхід");
    // Drag the lower node; persisted grid coordinates must change without hiding nodes.
    await page.$eval('.react-flow__node[data-id="entry"]', (e) =>
      e.scrollIntoView({ block: "center" }),
    );
    const beforeDrag = await page.$eval(
      '.react-flow__node[data-id="entry"]',
      (e) => e.getBoundingClientRect().toJSON(),
    );
    await page.mouse.move(
      beforeDrag.x + beforeDrag.width / 2,
      beforeDrag.y + beforeDrag.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      beforeDrag.x + beforeDrag.width / 2 + 120,
      beforeDrag.y + beforeDrag.height / 2 + 80,
      { steps: 12 },
    );
    await page.mouse.up();
    const gridX = await page.$eval(await field("X"), (e) =>
      Number((e as HTMLInputElement).value),
    );
    assert.notEqual(gridX, 0);
    check("Перетягування вузла оновило координати форми");
    await text("Назва сцени", "Вхід v2");
    assert.equal(await page.$("[data-labyrinth-run]"), null);
    check("Правка відокремлена від прогону з незмінною v1");
    await click("Зберегти версію");
    await waitText("Збережено v2");
    const immutable = await pool.query(
      "SELECT definition FROM labyrinth_versions WHERE project_id=$1 AND map_id=$2 AND revision=1",
      [project, map.map_id],
    );
    assert.equal(immutable.rows[0].definition.nodes[0].title, "Вхід");
    check("Збереження v2 залишило v1 незмінною");
    await page.reload();
    await click("Книга-лабіринт");
    await page.waitForSelector("[data-labyrinth-builder]");
    await pick("Збережена карта", "T9.2 браузерний конструктор");
    await waitText("Відкрита v2");
    await pick("Версія карти", "v1");
    await waitText("Відкрита v1");
    check("Перезавантаження і вибір історичної версії відновили дані");
    // A concurrent author append must not be silently overwritten.
    await text("Назва карти", "Моя незбережена правка");
    const latest = await (
      await fetch(
        `${origin}/api/core/projects/${project}/labyrinth/maps/${map.map_id}/versions/2`,
        { headers: { "x-test-user": "owner" } },
      )
    ).json();
    const race = await fetch(
      `${origin}/api/core/projects/${project}/labyrinth/maps/${map.map_id}/versions`,
      {
        method: "POST",
        headers: { "x-test-user": "owner", "content-type": "application/json" },
        body: JSON.stringify({
          definition: latest.definition,
          expectedRevision: 2,
        }),
      },
    );
    assert.equal(race.status, 201);
    await click("Зберегти версію");
    await waitText("ревіз");
    assert.equal(
      await page.$eval(
        await field("Назва карти"),
        (e) => (e as HTMLInputElement).value,
      ),
      "Моя незбережена правка",
    );
    check("Конфлікт не перезаписав чужу версію й зберіг правку у формі");
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/t92-mobile.png", fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    );
    check(
      "390 px: форми й текстова альтернатива без горизонтального прокручування",
    );
    assert.deepEqual(errors, []);
    check("Немає помилок виконання React");
    await click("Приклад із вашого SVG");
    await click("Зберегти версію");
    await waitText("Збережено v1");
    await click("Тестовий прогін");
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-route-description]")
          ?.getAttribute("data-description-node") === "svg-cell-0-0",
    );
    assert.equal(
      await page.$eval('[data-maze-marker="ivan"]', (e) =>
        e.getAttribute("data-marker-node"),
      ),
      "svg-cell-0-0",
    );
    check("Наданий SVG відображає початкове місце Івана");
    await click("Йти: Коридор 1:2");
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-route-description]")
          ?.getAttribute("data-description-node") === "svg-cell-0-1",
    );
    assert.equal(
      await page.$eval('[data-maze-marker="ivan"]', (e) =>
        e.getAttribute("data-marker-node"),
      ),
      "svg-cell-0-1",
    );
    assert.equal(
      await page.$eval('[data-maze-marker="ivan"] circle', (e) =>
        e.getAttribute("cy"),
      ),
      "60",
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    );
    await (await page.$("figure"))!.screenshot({
      path: "/tmp/maze-description-svg.png",
    });
    check("Хід у SVG оновив точку та словесне розгалуження разом");

    await click("Безпечний прогін");
    await page.waitForSelector("[data-runtime-controls]");
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-route-description]")
          ?.getAttribute("data-description-node") === "svg-cell-0-0",
    );
    check("Безпечний прогін SVG створюється після доказу прохідності");
    await click("Йти: Коридор 1:2");
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-route-description]")
          ?.getAttribute("data-description-node") === "svg-cell-0-1",
    );
    await click("Чекати один крок");
    await page.waitForFunction(() =>
      document
        .querySelector("[data-runtime-controls]")
        ?.textContent?.includes("час 2"),
    );
    check("Рушій рухає героя та час, маркер і опис збігаються");
    const restoreReply = page.waitForResponse((r) =>
      r.url().endsWith("/restore"),
    );
    await click("Відновити як новий прогін");
    const restoreResponse = await restoreReply;
    const restoredBody = await restoreResponse.json();
    assert.equal(restoreResponse.status(), 201, JSON.stringify(restoredBody));
    assert.equal(restoredBody.state.heroes.ivan.nodeId, "svg-cell-0-0");
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-route-description]")
          ?.getAttribute("data-description-node") === "svg-cell-0-0",
    );
    assert.equal(
      await page.$eval('[data-maze-marker="ivan"]', (e) =>
        e.getAttribute("data-marker-node"),
      ),
      "svg-cell-0-0",
    );
    assert.ok(
      await page.$eval("[data-runtime-controls]", (e) =>
        e.textContent?.includes("час 0"),
      ),
    );
    assert.equal(
      await page.$$eval("[data-route-description]", (els) => els.length),
      1,
    );
    assert.deepEqual(errors, []);
    check(
      "Відновлення з контрольної точки повертає позицію, час і словесний опис",
    );
    await page.screenshot({
      path: "/tmp/t93-runtime-browser.png",
      fullPage: true,
    });
    await click("Збережені прогони");
    await page.waitForSelector("[data-saved-runs] button");
    const savedButton = await page.$eval("[data-saved-runs] button", (e) =>
      e.textContent!.trim(),
    );
    const resumeBody = restoredBody;
    await page.reload();
    await click("Книга-лабіринт");
    await page.waitForSelector("[data-labyrinth-builder]");
    const mapSelect = await field("Збережена карта");
    await page.select(mapSelect, resumeBody.mapId);
    await click("Збережені прогони");
    await click(savedButton);
    await page.waitForSelector("[data-runtime-controls]");
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-route-description]")
          ?.getAttribute("data-description-node") === "svg-cell-0-0",
    );
    assert.ok(
      await page.$eval("[data-runtime-controls]", (e) =>
        e.textContent?.includes("час 0"),
      ),
    );
    check(
      "Після перезавантаження збережений прогін відкривається з тим самим часом і позицією",
    );
    user = "reader";
    await page.reload();
    await click("Книга-лабіринт");
    await waitText("лише власнику");
    assert.equal(await page.$("[data-labyrinth-builder]"), null);
    check("Учасник не бачить приховану карту та шаблони подій");
  } finally {
    await browser.close();
  }
  return count;
}
