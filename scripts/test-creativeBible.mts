import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import type { AddressInfo } from "node:net";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import { bootstrapOntology } from "../server/core/ontology/lifecycle";
import { assignRole } from "../server/core/collaboration/participants";
import {
  makeEffectiveResolver,
  grantAccess,
} from "../server/core/collaboration/access";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "media-provenance-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, "books.db");
const db = await import("../server/db");
await db.initDb();
const books = await import("../server/bookStore");
const { createCorePool } = await import("../server/core");
const pool = process.env.CORE_TEST_DATABASE_URL
  ? createCorePool(process.env.CORE_TEST_DATABASE_URL)
  : null;
if (pool) {
  const m = await import("../server/core/migrate");
  await m.runMigrations(pool, await m.loadMigrations(m.resolveMigrationsDir()));
}
const { PgCoreRepository } = await import("../server/core/pgRepository");
const repo = pool ? new PgCoreRepository(pool) : new MemoryCoreRepository();
await bootstrapOntology(repo);
const bid = "workspace-" + Date.now();
await repo.upsertProject({ id: bid, ownerId: "owner", title: "Private book" });
await books.saveBook({
  ownerId: "owner",
  book: {
    id: bid,
    title: "Private book",
    notes: "SECRET OWNER NOTES",
    chapters: [
      {
        id: "c",
        title: "Chapter",
        sections: [
          { id: "s", title: "Allowed scene", content: "ALLOWED TEXT" },
          { id: "h", title: "Hidden scene", content: "SECRET MANUSCRIPT" },
        ],
      },
    ],
  },
});
for (const userId of ["designer", "other"])
  await assignRole(repo, {
    projectId: bid,
    userId,
    roleId: "designer",
    actor: "user:owner",
    source: "manual",
  });
const deps = {
  repo: () => repo,
  principal: async (id: string) =>
    ({ id, role: "writer", isGuest: false }) as any,
  access: {
    getBookOwnerId: async (id: string) => (await books.getBook(id))?.ownerId,
    getCollabOwnerId: async () => undefined,
    listAcceptedInvites: async () => [],
    effectiveAccess: makeEffectiveResolver(
      () => repo,
      () => "ready",
    ),
  },
  describeUser: async (id: string) => (id === "owner" ? "Автор" : "Дизайнер"),
};
const { canReadBibleAsset } = await import("../server/core/creative/bible");
const media = await import("../server/media/mediaLibraryStore");
const { registerCreativeWorkspaceRoutes } =
  await import("../server/core/creative/workspace");
const app = express();
app.use(express.json());
let disabled = false;
app.use((q, _r, n) => {
  const id = String(q.headers["x-user"] ?? "owner");
  q.principal = {
    id,
    role: id === "admin" ? "admin" : "writer",
    isGuest: id === "guest",
  } as any;
  n();
});
const bibleDeps = {
  ...deps,
  principal: async (id: string) =>
    id === "blocked" || (disabled && id === "designer")
      ? null
      : deps.principal(id),
};
registerCreativeWorkspaceRoutes(app, bibleDeps);
const { registerMediaRoutes } = await import("../server/mediaRoutes");
registerMediaRoutes(app, {
  canViewBookAsset: async (q, a) =>
    canReadBibleAsset(bibleDeps, q.principal!.id, a as any),
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  base = `/api/creative/bible/${bid}`;
async function req(p = "", u = "owner", body?: unknown, method?: string) {
  const r = await fetch(origin + base + p, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "content-type": "application/json", "x-user": u },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: (await r.json()) as any };
}
let passed = 0;
const check = (s: string) => {
  passed++;
  console.log("✓ " + s);
};
const grant = async (scopeType: any, level: any, scopeRef: string) =>
  grantAccess(repo, {
    projectId: bid,
    granter: { userId: "owner", isOwner: true, isAdmin: false },
    userId: "designer",
    scopeType,
    scopeRef: scopeType === "book" ? null : scopeRef,
    level,
  });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zX8AAAAASUVORK5CYII=",
  "base64",
);
async function file(name: string) {
  const a = await media.saveAsset({
    ownerId: "owner",
    bookId: bid,
    kind: "upload",
    filename: name,
    mimeType: "image/png",
    bytes: png,
  });
  return (await media.updateMediaProvenance(
    a.id,
    "owner",
    a.provenance.revision,
    {
      ...a.provenance,
      revision: 2,
      status: "APPROVED",
      sceneIds: ["s", "h"],
      approval: {
        by: "owner",
        at: new Date().toISOString(),
        version: 1,
        assetId: a.id,
      },
    },
  ))!;
}
const entity = await repo.createEntity({
  projectId: bid,
  type: "character",
  name: "Visible hero",
  canonical: { appearance: "blue eyes" },
  createdBy: "user:owner",
});
const hidden = await repo.createEntity({
  projectId: bid,
  type: "location",
  name: "SECRET LOCATION",
  canonical: {},
  createdBy: "user:owner",
});
const appearance = await repo.upsertAppearanceVersion({
  projectId: bid,
  entityId: entity.id,
  label: "Age 20",
  description: "Blue eyes",
  approved: true,
  createdBy: "user:owner",
});
const a = await file("hero.png"),
  h = await file("secret.png"),
  cover = await file("cover.png");
const link = await repo.upsertAssetLink({
  projectId: bid,
  assetUrl: a.url,
  entityId: entity.id,
  role: "portrait",
  status: "confirmed",
  appearanceVersionId: appearance.id,
  createdBy: "user:owner",
});
const hiddenLink = await repo.upsertAssetLink({
  projectId: bid,
  assetUrl: h.url,
  entityId: hidden.id,
  role: "location",
  status: "confirmed",
  createdBy: "user:owner",
});
const canon = (asset: any, extra = {}) => ({
  confirmed: true,
  assetId: asset.id,
  expectedRevision: asset.provenance.revision,
  category: "character",
  entityId: entity.id,
  linkId: link.id,
  title: "Hero master",
  master: true,
  rules: {
    angle: "front",
    expression: "calm",
    keyFeatures: "blue eyes",
    forbiddenChanges: "No eye recoloring",
  },
  ...extra,
});
try {
  for (const user of ["guest", "blocked", "other", "admin"])
    assert.ok([401, 403].includes((await req("", user)).status));
  check("Гість, вимкнений, сторонній та чужий адміністратор не читають Bible");
  await grant("book", "manage", bid);
  assert.equal((await req("/canon", "designer", canon(a))).status, 403);
  check("MANAGE на книгу не дає окремого права канону");
  // Remove the broad book grant to exercise module-only and entity-scoped access.
  const participant = await repo.getParticipant(bid, "designer");
  for (const g of await repo.listAccessGrants({
    participantId: participant!.id,
    status: "active",
  }))
    await repo.revokeAccessGrant(g.id, "user:owner");
  const viewGrant = await grant("visual_bible", "view", bid);
  await grant("style_bible", "view", bid);
  assert.equal((await req("/canon", "designer", canon(a))).status, 403);
  check("VIEW розділу не дозволяє CANON");
  assert.equal(
    (await req("/canon", "owner", { ...canon(a), confirmed: false })).status,
    422,
  );
  assert.equal(
    (await req("/canon", "owner", { ...canon(a), expectedRevision: 0 })).status,
    409,
  );
  assert.equal(
    (await req("/canon", "owner", { ...canon(a), linkId: hiddenLink.id }))
      .status,
    422,
  );
  check("Окреме підтвердження, CAS та відповідність зв’язку обов’язкові");
  const draft = await media.saveAsset({
    ownerId: "owner",
    bookId: bid,
    kind: "upload",
    filename: "draft.png",
    mimeType: "image/png",
    bytes: png,
  });
  assert.equal((await req("/canon", "owner", canon(draft))).status, 422);
  check("DRAFT не стає каноном");
  let v1 = (
    await req("/style/versions", "owner", {
      confirmed: true,
      title: "Blue style",
      rules: {
        genre: "sci-fi",
        primaryPalette: "blue",
        prohibitedColors: "red",
        lighting: "moonlight",
        titleSafeZones: "top 20%",
      },
    })
  ).body.version;
  assert.equal(
    (
      await req("/style/activate", "owner", {
        confirmed: true,
        versionId: v1.id,
        expectedRevision: 0,
      })
    ).status,
    200,
  );
  const responses = await Promise.all([
    req("/canon", "owner", canon(a)),
    req("/canon", "owner", canon(a)),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  let e = responses.find((r) => r.status === 200)!.body.entry;
  check("Два одночасні CANON-запити: один запис, один конфлікт");
  const stamped = (await media.getAsset(a.id))!;
  assert.equal(stamped.provenance.status, "CANON");
  assert.equal(stamped.provenance.canon?.by, "owner");
  assert.equal(e.styleVersionId, v1.id);
  assert.equal(e.appearanceVersionId, appearance.id);
  assert.equal(e.snapshot.assetVersion, 1);
  assert.equal(e.snapshot.provenance.approval.assetId, a.id);
  check("Канон фіксує точний файл, походження, зовнішність і активний стиль");
  assert.equal(
    (
      await req(
        "/canon",
        "owner",
        canon(h, {
          category: "location",
          entityId: hidden.id,
          linkId: hiddenLink.id,
          title: "SECRET LOCATION",
          master: false,
          rules: { timeOfDay: "night", weather: "rain" },
        }),
      )
    ).status,
    200,
  );
  await grant("scene", "view", "s");
  await grant("character", "view", entity.id);
  let assetGrant = await grant("media_asset", "view", a.id);
  const visible = (await req("", "designer")).body;
  assert.equal(visible.entries.length, 1);
  assert.deepEqual(visible.entries[0].sceneIds, ["s"]);
  assert.ok(!JSON.stringify(visible).includes("SECRET"));
  assert.equal(visible.history.length, 0);
  assert.equal(visible.entries[0].snapshot.provenance, null);
  check("Обмежений учасник не бачить приховану локацію, походження чи аудит");
  assert.equal(await canReadBibleAsset(bibleDeps, "designer", stamped), true);
  assert.equal(await canReadBibleAsset(bibleDeps, "other", stamped), false);
  assert.equal(
    await canReadBibleAsset(
      bibleDeps,
      "designer",
      (await media.getAsset(h.id))!,
    ),
    false,
  );
  check("Приватний файл вимагає дозвіл розділу, матеріалу та сутності");
  const listAppearance = repo.listAppearanceVersions.bind(repo);
  let revokeDuringRead = true;
  repo.listAppearanceVersions = async (
    ...args: Parameters<typeof listAppearance>
  ) => {
    const result = await listAppearance(...args);
    if (revokeDuringRead) {
      revokeDuringRead = false;
      await repo.revokeAccessGrant(assetGrant.id, "user:owner");
    }
    return result;
  };
  try {
    assert.equal((await req("", "designer")).status, 409);
  } finally {
    repo.listAppearanceVersions = listAppearance;
  }
  assetGrant = await grant("media_asset", "view", a.id);
  check(
    "Відкликання права під час читання не повертає застарілі приватні дані",
  );
  await assert.rejects(() => media.deleteAsset(a.id, "owner"), /Visual Bible/);
  let patch = await fetch(origin + `/api/media/${a.id}/provenance`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user": "owner" },
    body: JSON.stringify({
      confirmed: true,
      expectedRevision: 3,
      metadata: { status: "REVIEW" },
    }),
  });
  assert.equal(patch.status, 422);
  check("Канон не видаляється і не змінює статус через звичайну медіатеку");
  assert.equal(
    (
      await req("/style/versions", "designer", {
        confirmed: true,
        title: "Forged",
        rules: { mood: "happy" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req("/style/versions", "owner", {
        confirmed: true,
        title: "Invalid",
        rules: { secret: "x" },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await req("/style/versions", "owner", {
        confirmed: true,
        title: "Invalid object",
        rules: "text",
      })
    ).status,
    422,
  );
  check("Стиль має окремі права і перевіряє структуру правил");
  const v2 = (
    await req("/style/versions", "owner", {
      confirmed: true,
      title: "Green style",
      rules: { primaryPalette: "green", lighting: "sunlight" },
    })
  ).body.version;
  const switches = await Promise.all([
    req("/style/activate", "owner", {
      confirmed: true,
      versionId: v2.id,
      expectedRevision: 1,
    }),
    req("/style/activate", "owner", {
      confirmed: true,
      versionId: v1.id,
      expectedRevision: 1,
    }),
  ]);
  assert.deepEqual(switches.map((r) => r.status).sort(), [200, 409]);
  check("Активація стилю захищена від одночасного перезапису");
  const canonAfter = (await req()).body.entries.find((x: any) => x.id === e.id);
  assert.deepEqual(canonAfter, e);
  assert.equal((await media.getAsset(a.id))!.provenance.revision, 3);
  check("Зміна стилю не переписує канонічний знімок або затверджений файл");
  const ctx = (await req("/context", "designer")).body;
  assert.equal(ctx.references.length, 1);
  assert.deepEqual(ctx.references[0].sceneIds, ["s"]);
  assert.ok(!JSON.stringify(ctx).includes("SECRET"));
  assert.equal(ctx.references[0].assetVersion, 1);
  check(
    "Структурований контекст містить активний стиль і тільки дозволені референси",
  );
  const b = await file("alternate.png");
  await repo.upsertAssetLink({
    projectId: bid,
    assetUrl: b.url,
    entityId: entity.id,
    role: "portrait",
    status: "confirmed",
    createdBy: "user:owner",
  });
  const bl = (await repo.listAssetLinks(bid, { assetUrl: b.url }))[0];
  assert.equal(
    (await req("/canon", "owner", canon(b, { linkId: bl.id }))).status,
    409,
  );
  assert.equal((await media.getAsset(b.id))!.provenance.status, "APPROVED");
  check("Головний образ унікальний; конфлікт відкочує статус файлу");
  assert.equal(
    (
      await req(`/canon/${e.id}/remove`, "owner", {
        confirmed: true,
        reason: "replace",
        expectedRevision: 0,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await req(`/canon/${e.id}/remove`, "owner", {
        confirmed: true,
        reason: "",
        expectedRevision: 1,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await req(`/canon/${e.id}/remove`, "owner", {
        confirmed: true,
        reason: "Updated depiction",
        expectedRevision: 1,
      })
    ).status,
    200,
  );
  assert.equal((await media.getAsset(a.id))!.provenance.status, "APPROVED");
  assert.ok(
    (await req()).body.audit.some((x: any) => x.action === "canon_removed"),
  );
  check(
    "Вилучення: окрема причина, CAS, збережений аудит, повернення APPROVED",
  );
  // Delegation still requires both module permission and per-asset/per-entity visibility.
  const manage = await grant("visual_bible", "manage", bid);
  const delegated = await req(
    "/canon",
    "designer",
    canon((await media.getAsset(a.id))!, { master: false }),
  );
  assert.equal(delegated.status, 200);
  assert.equal((await media.getAsset(a.id))!.provenance.canon?.by, "designer");
  check("Явно делегований MANAGE працює без підвищення ролі користувача");
  await repo.revokeAccessGrant(manage.id, "user:owner");
  await repo.revokeAccessGrant(viewGrant.id, "user:owner");
  assert.equal((await req("", "designer")).status, 403);
  assert.equal((await req("/context", "designer")).status, 403);
  check("Відкликання діє на наступному запиті та закриває контекст");
  disabled = true;
  assert.equal((await req("/style", "designer")).status, 401);
  disabled = false;
  check("Вимкнений учасник утрачає доступ негайно");
  db.closeDb();
  await db.initDb();
  assert.equal((await req()).body.entries.length, 2);
  assert.equal((await req("/style")).body.versions.length, 2);
  check("SQLite перезапуск зберігає канон, стиль та аудит");
  const { creativeProjectDb } =
    await import("../server/core/creative/projects");
  const broken = await file("rollback.png");
  creativeProjectDb().exec(
    "CREATE TRIGGER test_bible_audit_failure BEFORE INSERT ON creative_bible_audit BEGIN SELECT RAISE(ABORT,'test audit failure'); END",
  );
  try {
    assert.equal(
      (
        await req(
          "/canon",
          "owner",
          canon(broken, {
            category: "cover",
            entityId: null,
            linkId: null,
            title: "Rollback cover",
            master: false,
          }),
        )
      ).status,
      500,
    );
  } finally {
    creativeProjectDb().exec("DROP TRIGGER test_bible_audit_failure");
  }
  assert.equal(
    (await media.getAsset(broken.id))!.provenance.status,
    "APPROVED",
  );
  assert.ok(
    !(await req()).body.entries.some((e: any) => e.assetId === broken.id),
  );
  check("Помилка запису аудиту відкочує і канон, і статус медіатеки");
  const { parseCreativeBiblePath, buildCreativeBiblePath } =
    await import("../src/utils/appRoutes");
  assert.deepEqual(
    parseCreativeBiblePath(
      buildCreativeBiblePath(bid, "/studio", true),
      "/studio",
    ),
    { bookId: bid, style: true },
  );
  assert.equal(
    parseCreativeBiblePath("/creative/bible/" + bid, "/studio"),
    null,
  );
  check("Обидві адреси Bible працюють із префіксом /studio");
  if (process.argv.includes("--browser")) {
    const { build } = await import("esbuild");
    const { default: puppeteer } = await import("puppeteer-core");
    const ui = await build({
      stdin: {
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CreativeBible} from './src/components/CreativeBible';createRoot(document.getElementById('root')).render(<CreativeBible bookId="${bid}"/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      format: "iife",
      jsx: "automatic",
      define: {
        "import.meta.env.BASE_URL": JSON.stringify("/"),
        "import.meta.env.VITE_NOVA_WS_URL": "undefined",
      },
    });
    app.get("/bible-test.js", (_q, r) =>
      r.type("js").send(ui.outputFiles[0].text),
    );
    const css = (
      await fs.readdir(path.join(process.cwd(), "dist/assets"))
    ).find((x) => x.endsWith(".css"))!;
    app.get("/bible-test.css", (_q, r) =>
      r.sendFile(path.join(process.cwd(), "dist/assets", css)),
    );
    app.get("/bible-test", (_q, r) =>
      r
        .type("html")
        .send(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bible-test.css"><div id="root"></div><script src="/bible-test.js"></script>',
        ),
    );
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
      headless: true,
    });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(origin + "/bible-test");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Hero master"),
      );
      const click = async (text: string) => {
        await page.evaluate((t) => {
          const b = Array.from(document.querySelectorAll("button")).find(
            (b) => b.textContent === t,
          );
          if (!b) throw Error("Missing " + t);
          b.click();
        }, text);
      };
      await page.select('[aria-label="Категорія канону"]', "cover");
      await page.select('[aria-label="Матеріал канону"]', cover.id);
      await page.type('[aria-label="Назва образу"]', "Browser cover");
      assert.equal(
        await page.evaluate(
          () =>
            Array.from(document.querySelectorAll("button")).find(
              (b) => b.textContent === "Додати до візуального канону",
            )?.disabled,
        ),
        true,
      );
      await page.click('[aria-label="Підтвердити канон"]');
      await click("Додати до візуального канону");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Browser cover"),
      );
      check("Браузер: окреме підтвердження й додавання обкладинки");
      await click("Style Bible");
      await page.type('[aria-label="Назва стилю"]', "Browser style");
      await page.type('[aria-label="Настрій"]', "Calm");
      await page.click('[aria-label="Підтвердити версію стилю"]');
      await click("Зберегти версію стилю");
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("option")).some((x) =>
          x.textContent?.includes("Browser style"),
        ),
      );
      const browserStyle = (await req("/style")).body.versions[0];
      await page.select('[aria-label="Активувати версію"]', browserStyle.id);
      await page.click('[aria-label="Підтвердити активацію"]');
      await click("Активувати стиль");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Активний стиль: Browser style"),
      );
      await click("Показати структурований контекст для людей і ШІ");
      await page.waitForSelector('[aria-label="Стильовий контекст"]');
      check("Браузер: створення, активація й перегляд структурованого стилю");
      const liveGrant = await grant("visual_bible", "view", bid);
      const reader = await browser.newPage();
      await reader.setExtraHTTPHeaders({ "x-user": "designer" });
      await reader.goto(origin + "/bible-test");
      await reader.bringToFront();
      await reader.waitForFunction(() =>
        document.body.textContent?.includes("Hero master"),
      );
      assert.ok(
        !(await reader.evaluate(() =>
          document.body.textContent?.includes("SECRET LOCATION"),
        )),
      );
      assert.ok(
        !(await reader.evaluate(() =>
          document.body.textContent?.includes("Browser cover"),
        )),
      );
      await repo.revokeAccessGrant(liveGrant.id, "user:owner");
      await reader.waitForFunction(
        () => !document.body.textContent?.includes("Hero master"),
        { timeout: 15000 },
      );
      await reader.close();
      await page.bringToFront();
      check(
        "Браузер: другий учасник бачить лише дозволене; відкликання прибирає картки",
      );
      await page.setViewport({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: path.join(dir, "bible-mobile.png"),
        fullPage: true,
      });
      check(
        "Браузер: мобільний екран без горизонтального переповнення та помилок React",
      );
    } finally {
      await browser.close();
    }
  }
  console.log(`Підсумок: ${passed} пройшло.`);
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.closeDb();
  if (pool) {
    await pool.query("DELETE FROM projects WHERE id=$1", [bid]);
    await pool.end();
  }
  await fs.rm(dir, { recursive: true, force: true });
}
