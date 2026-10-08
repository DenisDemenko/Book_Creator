import type { ElementHandle } from "puppeteer-core";
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
const { createCreativeProject, creativeProjectDb } =
  await import("../server/core/creative/projects");
const p = await createCreativeProject(deps, "owner", bid, {
  title: "Book cover",
});
const conn = creativeProjectDb();
const selected = {
  ...p,
  specialistId: "designer",
  status: "SPECIALIST_SELECTED",
};
const setProject = (v: any) =>
  conn
    .prepare("UPDATE creative_projects SET payload=? WHERE id=?")
    .run(JSON.stringify(v), p.id);
setProject(selected);
const grant = async (
  scopeType: any,
  level: any,
  ref: string | null = null,
  dates = {},
) =>
  grantAccess(repo, {
    projectId: bid,
    granter: { userId: "owner", isOwner: true, isAdmin: false },
    userId: "designer",
    scopeType,
    scopeRef: ref,
    level,
    bookIndex: new Map([["c", ["s", "h"]]]),
    ...dates,
  });
let hook = async () => {};
let quotaFail = false;
let charges = 0;
const { registerCreativeWorkspaceRoutes, creativeWorkspaceDb } =
  await import("../server/core/creative/workspace");
const app = express();
app.use(express.json({ limit: "40mb" }));
app.use((q, _r, n) => {
  const id = String(q.headers["x-user"] ?? "owner");
  q.principal = {
    id,
    role: id === "admin" ? "admin" : "writer",
    isGuest: id === "guest",
  } as any;
  n();
});
registerCreativeWorkspaceRoutes(app, {
  ...deps,
  chargeUpload: async () => {
    charges++;
    await hook();
    if (quotaFail)
      throw new (
        await import("../server/core/collaboration/workspaceStore")
      ).WorkspaceError(402, "quota");
  },
});
const media = await import("../server/media/mediaLibraryStore");
const { registerMediaRoutes } = await import("../server/mediaRoutes");
registerMediaRoutes(app);
const { registerProjectRoutes } = await import("../server/core/projectRoutes");
registerProjectRoutes(app, { ...deps, coreState: () => "ready" });
const { emptyAi, normalizeAi, normalizeMediaMetadata, mediaMatches } =
  await import("../shared/mediaProvenance");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  base = `/api/creative/projects/${p.id}/workspace`;
const req = async (path = "", user = "owner", body?: unknown) => {
  const r = await fetch(origin + base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-user": user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zX8AAAAASUVORK5CYII=";
const upload = (user = "designer", body: Record<string, unknown> = {}) =>
  req("/assets", user, { filename: "cover.png", dataUrl: png, ...body });
let n = 0;
const check = (label: string) => {
  n++;
  console.log("✓ " + label);
};
const status = async (a: any, target: string) => {
  const r = await req(`/assets/${a.id}/state`, "owner", {
    status: target,
    expectedRevision: a.revision,
    confirmed: true,
    note: "test decision",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.asset;
};
const approve = async (a: any) =>
  status(await status(a, "SUBMITTED_FOR_REVIEW"), "APPROVED");
const transfer = (a: any, user = "owner", extra: any = {}) =>
  req(`/assets/${a.id}/library`, user, {
    expectedRevision: a.revision,
    confirmed: true,
    ...extra,
  });
const metadataPatch = async (a: any, body: any, user = "owner") => {
  const r = await fetch(origin + `/api/media/${a.id}/provenance`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user": user },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
};
const filterList = async (query: string, user = "owner") =>
  (
    await fetch(origin + "/api/media/list?" + query, {
      headers: { "x-user": user },
    })
  ).json() as Promise<any>;
try {
  await req("/access", "owner", {
    userId: "designer",
    level: "WORK",
    confirmed: true,
  });
  const participantsBefore = await repo.listParticipants(bid),
    grantsBefore = await repo.listAccessGrants({ projectId: bid });
  const character = await repo.createEntity({
    projectId: bid,
    type: "character",
    name: "Hero",
    createdBy: "user:owner",
  });
  const location = await repo.createEntity({
    projectId: bid,
    type: "location",
    name: "City",
    createdBy: "user:owner",
  });
  let a = (
    await upload("designer", {
      ai: {
        used: true,
        provider: "deepseek",
        model: "deepseek-chat",
        settings: { seed: 42, aspectRatio: "1:1" },
        generationId: "gen-1",
        promptReference: "prompt-1",
      },
    })
  ).body.asset;
  assert.equal(a.ai.provider, "deepseek");
  assert.equal((await transfer(a)).status, 409);
  assert.equal((await transfer(a, "guest")).status, 401);
  assert.equal((await transfer(a, "designer")).status, 403);
  assert.equal((await transfer(a, "other")).status, 403);
  assert.equal((await transfer(a, "admin")).status, 403);
  assert.equal((await media.listAssets("owner")).length, 0);
  check(
    "transfer is explicit, owner-only, approved-only; guest/outsider/admin denied",
  );
  a = await approve(a);
  assert.equal((await transfer(a, "owner", { confirmed: false })).status, 422);
  assert.equal(
    (await transfer(a, "owner", { expectedRevision: 1 })).status,
    409,
  );
  assert.equal(
    (await transfer(a, "owner", { metadata: { createdBy: "owner" } })).status,
    422,
  );
  assert.equal(
    (await transfer(a, "owner", { metadata: { status: "CANON" } })).status,
    422,
  );
  for (const metadata of [
    { characterIds: [location.id] },
    { locationIds: [character.id] },
    { sceneIds: ["foreign-scene"] },
    { characterIds: ["foreign-character"] },
  ])
    assert.equal((await transfer(a, "owner", { metadata })).status, 422);
  check(
    "confirmation/CAS/immutable identity and typed same-book provenance relations enforced",
  );
  const beforeCharges = charges;
  const imported = await Promise.all([
    transfer(a, "owner", {
      metadata: {
        type: "COVER",
        characterIds: [character.id],
        locationIds: [location.id],
        sceneIds: ["s"],
        tags: ["cover", "AI"],
      },
    }),
    transfer(a, "owner", {
      metadata: {
        type: "COVER",
        characterIds: [character.id],
        locationIds: [location.id],
        sceneIds: ["s"],
        tags: ["cover", "AI"],
      },
    }),
  ]);
  assert.deepEqual(imported.map((r) => r.status).sort(), [200, 201]);
  const first = imported.find((r) => r.status === 201)!.body.asset;
  assert.equal(charges, beforeCharges + 1);
  assert.equal((await media.listAssets("owner")).length, 1);
  assert.equal(first.provenance.createdBy, "designer");
  assert.equal(first.ownerId, "owner");
  assert.equal(first.bookId, bid);
  assert.equal(first.provenance.createdAt, a.createdAt);
  assert.equal(first.provenance.workspace.version, 1);
  assert.equal(first.provenance.approval.by, "owner");
  assert.equal(first.provenance.approval.at, a.approvedAt);
  assert.equal(first.provenance.approval.assetId, a.id);
  assert.equal(first.provenance.ai.provider, "deepseek");
  assert.equal(first.provenance.ai.settings.seed, 42);
  assert.equal(first.provenance.declaration.by, "designer");
  assert.equal(first.provenance.canon, null);
  assert.deepEqual(first.provenance.characterIds, [character.id]);
  assert.equal((await media.readAsset(first.id))!.bytes.length, a.bytes);
  assert.equal(
    (await req("/chat")).body.events.filter(
      (e: any) => e.type === "ASSET_IMPORTED_TO_LIBRARY" && e.assetId === a.id,
    ).length,
    1,
  );
  check(
    "concurrent retry imports once, charges once, preserves creator/AI/approval/exact bytes, audits once",
  );
  assert.equal(
    (
      await fetch(origin + `/api/media/file/${first.id}`, {
        headers: { "x-user": "designer" },
      })
    ).status,
    404,
  );
  assert.equal((await filterList("", "designer")).assets.length, 0);
  assert.deepEqual(await repo.listParticipants(bid), participantsBefore);
  assert.deepEqual(
    await repo.listAccessGrants({ projectId: bid }),
    grantsBefore,
  );
  assert.equal((await books.getBook(bid))!.revision, 1);
  check(
    "Workspace grant does not grant media access; no new grants/participants/manuscript/canon changes",
  );
  let v2 = (
    await upload("designer", {
      parentId: a.id,
      expectedRevision: a.revision,
      ai: { used: false },
    })
  ).body.asset;
  v2 = await approve(v2);
  const second = (await transfer(v2)).body.asset;
  await assert.rejects(
    media.saveAsset({
      ownerId: "owner",
      bookId: bid,
      kind: "upload",
      filename: "bypass.png",
      mimeType: "image/png",
      bytes: Buffer.from(png.split(",")[1], "base64"),
      parentId: first.id,
    }),
    /Workspace/,
  );
  assert.equal(second.parentId, first.id);
  assert.equal(second.rootId, first.rootId);
  assert.equal(second.version, 2);
  assert.equal(second.provenance.workspace.parentId, a.id);
  assert.equal(second.provenance.ai.used, false);
  assert.equal((await media.readAsset(first.id))!.bytes.length, a.bytes);
  let v3 = (
    await upload("designer", { parentId: v2.id, expectedRevision: v2.revision })
  ).body.asset;
  v3 = await approve(v3);
  const third = (await transfer(v3)).body.asset;
  assert.equal(third.version, 3);
  assert.equal(third.provenance.ai.used, null);
  assert.equal(
    (await media.getAssetPassport(third.id, "owner"))!.versions.length,
    3,
  );
  check(
    "approved v1/v2/v3 keep original files, root/parent chain and independent AI declarations",
  );
  for (const [query, id] of [
    ["type=COVER", first.id],
    ["status=APPROVED", first.id],
    ["author=designer", first.id],
    ["project=" + p.id, first.id],
    ["ai=yes", first.id],
    ["ai=no", second.id],
    ["ai=unknown", third.id],
    ["tag=cover", first.id],
    ["character=" + character.id, first.id],
    ["location=" + location.id, first.id],
    ["scene=s", first.id],
    [
      "from=" + a.createdAt.slice(0, 10) + "&to=" + a.createdAt.slice(0, 10),
      first.id,
    ],
  ])
    assert.ok(
      (await filterList(query)).assets.some((x: any) => x.id === id),
      query,
    );
  assert.equal((await filterList("author=other")).assets.length, 0);
  assert.equal((await filterList("from=2999-01-01")).assets.length, 0);
  check(
    "all type/status/creator/project/AI/manual/entity/date/tag filters work through HTTP",
  );
  const edit = {
    expectedRevision: 1,
    confirmed: true,
    metadata: {
      type: "REFERENCE",
      status: "REVIEW",
      tags: ["updated"],
      characterIds: [character.id],
      locationIds: [location.id],
      sceneIds: ["s"],
    },
  };
  assert.equal((await metadataPatch(first, edit, "designer")).status, 404);
  assert.equal(
    (await metadataPatch(first, { ...edit, confirmed: false })).status,
    422,
  );
  assert.equal(
    (await metadataPatch(first, { ...edit, metadata: { createdBy: "fake" } }))
      .status,
    422,
  );
  assert.equal(
    (await metadataPatch(first, { ...edit, ai: { used: false } })).status,
    422,
  );
  assert.equal(
    (await metadataPatch(first, { ...edit, metadata: { status: "CANON" } }))
      .status,
    422,
  );
  assert.equal(
    (
      await metadataPatch(first, {
        ...edit,
        metadata: { sceneIds: ["not-this-book"] },
      })
    ).status,
    422,
  );
  const edits = await Promise.all([
    metadataPatch(first, edit),
    metadataPatch(first, edit),
  ]);
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
  const updated = (await media.getAsset(first.id))!;
  assert.equal(updated.provenance.revision, 2);
  assert.equal(updated.provenance.status, "REVIEW");
  assert.deepEqual(updated.provenance.workspace, first.provenance.workspace);
  assert.deepEqual(updated.provenance.approval, first.provenance.approval);
  assert.ok(
    (await media.getAssetPassport(first.id, "owner"))!.history.some(
      (h) => h.action === "provenance",
    ),
  );
  const targetsResponse = await fetch(
    origin + `/api/media/${first.id}/provenance-targets`,
  );
  const targetsData = (await targetsResponse.json()) as any;
  assert.equal(targetsResponse.status, 200);
  assert.ok(
    targetsData.entities.some(
      (e: any) => e.id === character.id && e.name === "Hero",
    ),
  );
  assert.ok(
    targetsData.sections.some(
      (e: any) => e.id === "s" && e.title === "Allowed scene",
    ),
  );
  assert.equal(
    (
      await fetch(origin + `/api/media/${first.id}/provenance-targets`, {
        headers: { "x-user": "designer" },
      })
    ).status,
    404,
  );
  const linkResponse = await fetch(
    origin + `/api/projects/${bid}/visual/links`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetUrl: first.url,
        entityId: character.id,
        role: "portrait",
      }),
    },
  );
  assert.equal(linkResponse.status, 201);
  const links = (await (
    await fetch(
      origin +
        `/api/projects/${bid}/visual/links?assetUrl=${encodeURIComponent(first.url)}`,
    )
  ).json()) as any;
  assert.ok(
    links.links.some(
      (l: any) => l.entityId === character.id && l.assetUrl === first.url,
    ),
  );
  check(
    "metadata edits use confirmed CAS and typed Studio targets; existing visual links work; outsider/forgery/canon denied",
  );
  for (const ai of [
    { used: true, provider: "deepseek", model: "m", apiKey: "SECRET" },
    {
      used: true,
      provider: "deepseek",
      model: "m",
      settings: { token: "SECRET" },
    },
    {
      used: true,
      provider: "deepseek",
      model: "m",
      settings: { seed: { apiKey: "SECRET" } },
    },
    { used: true, provider: "deepseek", model: "sk-12345678901234567890" },
  ]) {
    assert.equal((await upload("designer", { ai })).status, 422);
    assert.throws(() => normalizeAi(ai));
  }
  assert.throws(() =>
    normalizeAi({
      used: true,
      provider: "deepseek",
      model: "m",
      settings: { seed: Infinity },
    }),
  );
  assert.throws(() => normalizeMediaMetadata({ status: "CANON" }));
  assert.throws(() =>
    normalizeAi({
      used: true,
      provider: "deepseek",
      model: "m",
      promptReference: "https://example.invalid/?key=SECRET",
    }),
  );
  check(
    "credential fields/nested settings/secret-shaped tokens/non-finite settings rejected",
  );
  for (const [mime, bytes] of [
    ["audio/mpeg", Buffer.from("ID3local")],
    ["audio/wav", Buffer.from("RIFF0000WAVEdata")],
    ["audio/ogg", Buffer.from("OggSlocal")],
    ["video/webm", Buffer.from("1a45dfa300", "hex")],
    ["application/pdf", Buffer.from("%PDF-1.4\nlocal")],
    ["application/zip", Buffer.from("504b030400", "hex")],
    ["model/gltf-binary", Buffer.from("glTF1234")],
  ] as const) {
    let f = (
      await upload("owner", {
        filename: "result",
        dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
        ai: { used: false },
      })
    ).body.asset;
    f = await approve(f);
    const saved = (await transfer(f)).body.asset;
    const result = await fetch(origin + `/api/media/file/${saved.id}`);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("content-type")!.split(";")[0], mime);
    assert.equal(result.headers.get("x-content-type-options"), "nosniff");
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
    if (mime.startsWith("application/") || mime.startsWith("model/"))
      assert.ok(
        result.headers.get("content-disposition")!.startsWith("attachment;"),
      );
  }
  check(
    "MP3/WAV/OGG/WEBM/PDF/ZIP/GLB transfers preserve MIME/bytes, force safe document downloads and private cache",
  );
  let race = (await upload("owner")).body.asset;
  race = await approve(race);
  quotaFail = true;
  assert.equal((await transfer(race)).status, 402);
  quotaFail = false;
  assert.equal(await media.getAsset("cw-" + race.id), null);
  hook = async () => {
    await status(race, "CHANGES_REQUESTED");
  };
  assert.equal((await transfer(race)).status, 409);
  hook = async () => {};
  assert.equal(await media.getAsset("cw-" + race.id), null);
  assert.equal(
    creativeWorkspaceDb()
      .prepare("SELECT * FROM creative_workspace_imports WHERE asset_id=?")
      .get(race.id),
    undefined,
  );
  check(
    "quota denial and review changing during async charge leave no imported metadata/map/file",
  );
  let frozen = (await upload("owner")).body.asset;
  frozen = await approve(frozen);
  hook = async () => {
    setProject({ ...selected, status: "CANCELLED" });
  };
  assert.equal((await transfer(frozen)).status, 403);
  hook = async () => {};
  setProject(selected);
  assert.equal(await media.getAsset("cw-" + frozen.id), null);
  check("project frozen during async charge denies persistence");
  const read = await req();
  assert.ok(read.body.assets.find((x: any) => x.id === a.id).libraryAssetId);
  db.closeDb();
  await db.initDb();
  assert.deepEqual(
    (await media.getAsset(third.id))!.provenance,
    third.provenance,
  );
  assert.equal((await transfer(v3)).status, 200);
  check("SQLite metadata and idempotence survive database restart");
  await media.deleteAsset(second.id, "owner");
  assert.equal((await transfer(v2)).status, 410);
  assert.ok(
    (await media.getAssetPassport(third.id, "owner"))!.history.some(
      (h) => h.action === "deleted",
    ),
  );
  check(
    "deletion preserves version history/import tombstone and does not silently recreate a result",
  );
  const raw = await media.saveAsset({
    ownerId: "owner",
    bookId: bid,
    kind: "upload",
    filename: "manual.png",
    mimeType: "image/png",
    bytes: Buffer.from(png.split(",")[1], "base64"),
  });
  assert.equal(raw.provenance.ai.used, null);
  const declared = await metadataPatch(raw, {
    expectedRevision: 1,
    confirmed: true,
    metadata: { status: "APPROVED" },
    ai: { used: false },
  });
  assert.equal(declared.status, 200);
  assert.equal(declared.body.asset.provenance.ai.used, false);
  assert.equal(declared.body.asset.provenance.approval.by, "owner");
  const generated = await media.saveAsset({
    ownerId: "owner",
    bookId: bid,
    kind: "illustration",
    filename: "generated.png",
    mimeType: "image/png",
    bytes: Buffer.from(png.split(",")[1], "base64"),
    actor: "ai:example-model",
    ai: {
      ...emptyAi(),
      used: true,
      provider: "google",
      model: "example-model",
      settings: { imageSize: "2K" },
    },
  });
  assert.equal(generated.provenance.origin, "ai");
  assert.equal(
    (
      await metadataPatch(generated, {
        expectedRevision: 1,
        confirmed: true,
        ai: { used: false },
      })
    ).status,
    422,
  );
  check(
    "ordinary uploads receive honest unknown provenance; explicit manual declaration and approval audited",
  );
  const { getCreativeBrief } = await import("../server/core/creative/briefs");
  getCreativeBrief(p.id);
  const policy = (draft: string, published: string | null) =>
    creativeWorkspaceDb()
      .prepare(
        "INSERT OR REPLACE INTO creative_briefs(project_id,version,payload) VALUES(?,?,?)",
      )
      .run(
        p.id,
        1,
        JSON.stringify({
          data: { aiPolicy: draft },
          published: published ? { data: { aiPolicy: published } } : null,
        }),
      );
  let beforePolicy = (
    await upload("owner", {
      ai: { used: true, provider: "deepseek", model: "deepseek-chat" },
    })
  ).body.asset;
  beforePolicy = await approve(beforePolicy);
  policy("ALLOWED", "FORBIDDEN");
  assert.equal((await upload("owner")).status, 422);
  assert.equal(
    (
      await upload("owner", {
        ai: { used: true, provider: "deepseek", model: "m" },
      })
    ).status,
    422,
  );
  assert.equal((await transfer(beforePolicy)).status, 422);
  policy("DISCLOSE", null);
  assert.equal((await upload("owner")).status, 422);
  assert.equal((await upload("owner", { ai: { used: false } })).status, 201);
  creativeWorkspaceDb()
    .prepare("DELETE FROM creative_briefs WHERE project_id=?")
    .run(p.id);
  check(
    "published FORBIDDEN takes precedence over draft; DISCLOSE requires declared AI/manual choice",
  );
  let original = (await upload("owner")).body.asset;
  original = await approve(original);
  let newer = (
    await upload("owner", {
      parentId: original.id,
      expectedRevision: original.revision,
    })
  ).body.asset;
  newer = await approve(newer);
  const high = (await transfer(newer)).body.asset,
    low = (await transfer(original)).body.asset;
  assert.equal(high.version, 2);
  assert.equal(low.version, 1);
  assert.equal(high.rootId, low.rootId);
  assert.equal(media.latestVersionsOnly([high, low])[0].id, high.id);
  check(
    "out-of-order imports preserve original version numbers and root; latest does not regress",
  );
  if (process.argv.includes("--browser")) {
    let browserAsset = (
      await upload("designer", {
        filename: "browser-cover.png",
        ai: { used: false },
      })
    ).body.asset;
    browserAsset = await approve(browserAsset);
    const { build } = await import("esbuild");
    const bundle = await build({
      stdin: {
        contents: `import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{CreativeWorkspace}from'./src/components/CreativeWorkspace';import{CreativeMediaLibrary}from'./src/components/CreativeMediaLibrary';import{LanguageProvider}from'./src/i18n/LanguageContext';function App(){const[mode,setMode]=useState('workspace'),[assets,setAssets]=useState([]);const reload=()=>fetch('/api/media/list').then(r=>r.json()).then(d=>setAssets(d.assets));useEffect(()=>{if(mode==='library')void reload()},[mode]);return <LanguageProvider><button onClick={()=>setMode('workspace')}>Workspace probe</button><button onClick={()=>setMode('library')}>Library probe</button>{mode==='workspace'?<CreativeWorkspace creativeProjectId="${p.id}"/>:<CreativeMediaLibrary assets={assets} onChanged={a=>setAssets(v=>v.map(x=>x.id===a.id?a:x))} onReload={reload} onToast={()=>{}}/>}</LanguageProvider>}createRoot(document.getElementById('root')).render(<App/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      define: { "import.meta.env": JSON.stringify({ BASE_URL: "/" }) },
    });
    const css = (await fs.readdir("dist/assets")).find((f) =>
      /^index-.*\.css$/.test(f),
    );
    assert.ok(css);
    app.get("/probe.js", (_q, r) =>
      r.type("js").send(bundle.outputFiles[0].text),
    );
    app.get("/style.css", async (_q, r) =>
      r
        .type("css")
        .send(await fs.readFile(path.join("dist/assets", css), "utf8")),
    );
    app.get("/probe", (_q, r) =>
      r.send(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><main id="root" class="p-4 bg-slate-950 text-slate-100"></main><script src="/probe.js"></script>',
      ),
    );
    const { launch } = await import("puppeteer-core");
    const browser = await launch({
      executablePath: process.env.CHROME_PATH ?? "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
      protocolTimeout: 30000,
    });
    try {
      const page = await browser.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const click = async (label: string) => {
        const h = await page.evaluateHandle(
          (label) =>
            Array.from(document.querySelectorAll("button")).find(
              (b) => b.textContent?.trim() === label,
            ),
          label,
        );
        assert.ok(h.asElement(), label);
        await (h.asElement() as ElementHandle<Element>).click();
        await h.dispose();
      };
      await page.goto(origin + "/probe");
      await page.waitForSelector('[aria-label="Нова робота"]');
      await click("Роботи");
      await page.select('[aria-label="Матеріал"]', browserAsset.id);
      const save = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (b) => b.textContent === "Зберегти в медіатеку",
          )?.disabled,
      );
      assert.equal(save, true);
      await page.select('[aria-label="Тип результату"]', "COVER");
      await page.select('[aria-label="Сцени результату"]', "s");
      await page.type('input[aria-label="Теги результату"]', "browser");
      await page.click('input[aria-label="Підтвердити перенесення"]');
      await click("Зберегти в медіатеку");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("Версію v1 збережено в медіатеці"),
      );
      assert.ok(
        (
          await media.getAsset("cw-" + browserAsset.id)
        )?.provenance.tags.includes("browser"),
      );
      check(
        "BROWSER confirmed approved result transfers with chosen type/scene/tag and visible saved state",
      );
      await click("Library probe");
      await page.waitForSelector('[aria-label="Фільтр: тип"]');
      await page.select('[aria-label="Фільтр: тип"]', "COVER");
      await page.select('[aria-label="Фільтр: ШІ"]', "no");
      await page.type('[aria-label="Фільтр: тег"]', "browser");
      const cards = await page.$$("[data-provenance-asset]");
      assert.equal(cards.length, 1);
      await page.click(`[data-provenance-asset="cw-${browserAsset.id}"]`);
      await page.waitForSelector('[aria-label="Походження матеріалу"]');
      assert.ok(
        await page.evaluate(() =>
          document.body.textContent?.includes("designer"),
        ),
      );
      assert.ok(
        await page.evaluate(() =>
          document.body.textContent?.includes(
            "Не додано. Окрема дія Visual Bible",
          ),
        ),
      );
      check(
        "BROWSER library type/manual/tag filters find exact result; creator/approval/canon separation visible",
      );
      await page.select('[aria-label="Статус матеріалу"]', "REVIEW");
      await page.click('[aria-label="Підтвердити метадані"]');
      await click("Зберегти метадані");
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("[data-provenance-asset]")).some(
          (b) => b.textContent?.includes("REVIEW"),
        ),
      );
      assert.equal(
        (await media.getAsset("cw-" + browserAsset.id))!.provenance.status,
        "REVIEW",
      );
      await page.waitForSelector('[data-passport-history-item="provenance"]');
      assert.ok(
        await page.evaluate(() =>
          document
            .querySelector('[data-passport-history-item="provenance"]')
            ?.textContent?.includes("Змінено метадані"),
        ),
      );
      assert.equal(
        await page.evaluate(
          () =>
            document.querySelector<HTMLButtonElement>(
              "[data-passport-new-version]",
            )?.disabled,
        ),
        true,
      );
      check(
        "BROWSER metadata review status saves after confirmation through real HTTP",
      );
      await page.setViewport({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(dir, "media-provenance-mobile.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      check(
        "BROWSER library/provenance at 390px without horizontal overflow or JS errors",
      );
    } finally {
      await browser.close();
    }
  }
  db.closeDb();
  media.__resetMediaCacheForTests();
  const jsonAsset = await media.saveAsset({
    ownerId: "json-owner",
    kind: "upload",
    filename: "manual.png",
    mimeType: "image/png",
    bytes: Buffer.from(png.split(",")[1], "base64"),
    ai: { ...emptyAi(), used: false },
  });
  assert.equal(jsonAsset.provenance.ai.used, false);
  const next = {
    ...jsonAsset.provenance,
    revision: 2,
    tags: ["json"],
    status: "REVIEW" as const,
  };
  await media.updateMediaProvenance(jsonAsset.id, "json-owner", 1, next);
  media.__resetMediaCacheForTests();
  const loaded = (await media.getAsset(jsonAsset.id))!;
  assert.deepEqual(loaded.provenance, next);
  assert.ok(
    mediaMatches(loaded.provenance, {
      ai: "no",
      tag: "json",
      status: "REVIEW",
    }),
  );
  await assert.rejects(
    media.updateMediaProvenance(jsonAsset.id, "json-owner", 1, {
      ...next,
      revision: 3,
    }),
  );
  assert.equal(
    await media.updateMediaProvenance(jsonAsset.id, "other", 2, {
      ...next,
      revision: 3,
    }),
    null,
  );
  check(
    "JSON fallback persists metadata/declarations/history; CAS and owner isolation survive cache reset",
  );
  const jsonPath = path.join(dir, "media-assets.json"),
    savedJson = await fs.readFile(jsonPath);
  await fs.unlink(jsonPath);
  await fs.mkdir(jsonPath);
  await assert.rejects(
    media.updateMediaProvenance(jsonAsset.id, "json-owner", 2, {
      ...next,
      revision: 3,
    }),
  );
  await fs.rmdir(jsonPath);
  await fs.writeFile(jsonPath, savedJson);
  media.__resetMediaCacheForTests();
  assert.equal((await media.getAsset(jsonAsset.id))!.provenance.revision, 2);
  await media.updateMediaProvenance(jsonAsset.id, "json-owner", 2, {
    ...next,
    revision: 3,
  });
  assert.equal((await media.getAsset(jsonAsset.id))!.provenance.revision, 3);
  check(
    "JSON disk failure propagates, does not report success, and a later write recovers",
  );
  console.log(
    `Підсумок: ${n} пройшло (${pool ? "PostgreSQL" : "Memory"}). Артефакти: ${dir}`,
  );
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.closeDb();
  if (pool) {
    await pool
      .query("DELETE FROM core_projects WHERE id=$1", [bid])
      .catch(() => {});
    await pool.end();
  }
}
