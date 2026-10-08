/** Real provider dispatch and upload transport, with HTTP stubs; no paid calls. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "creative-provider-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, "db.sqlite");
const db = await import("../server/db");
await db.initDb();
const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zX8AAAAASUVORK5CYII=",
  png = Buffer.from(b64, "base64");
const { generateImage } = await import("../server/imageGeneration");
let input: any;
await generateImage(
  {
    interactions: {
      create: async (p: any) => {
        input = p;
        return { output_image: { data: b64, mime_type: "image/png" } };
      },
    },
  } as any,
  {
    prompt: "private edit",
    engine: "nano-banana-2-lite",
    referenceImageUrls: [`data:image/png;base64,${b64}`],
  },
);
assert.equal(input.input[1].data, b64);
assert.equal(input.input[1].mime_type, "image/png");
assert.equal(input.input[1].uri, undefined);
console.log(
  "✓ Gemini отримує inline bytes у нативному форматі SDK, без публічного URL",
);
const oldKey = process.env.LEONARDO_API_KEY;
process.env.LEONARDO_API_KEY = "test-provider-only";
const native = globalThis.fetch;
let uploaded = false,
  submitted = false;
const seen: string[] = [];
globalThis.fetch = async (url: any, init?: any) => {
  const u = String(url);
  if (u.startsWith("data:")) return native(url, init);
  seen.push(u);
  if (u.endsWith("/init-image"))
    return Response.json({
      uploadInitImage: {
        id: "private-ref-id",
        url: "https://upload.test/image",
        fields: JSON.stringify({ key: "private-test" }),
      },
    });
  if (u === "https://upload.test/image") {
    const file = init.body.get("file");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
    uploaded = true;
    return new Response(null, { status: 204 });
  }
  if (u.endsWith("/generations") && init?.method === "POST") {
    assert.ok(uploaded);
    assert.ok(JSON.stringify(JSON.parse(init.body)).includes("private-ref-id"));
    submitted = true;
    return Response.json({ id: "test-generation" });
  }
  if (u.includes("/generations/test-generation"))
    return Response.json({
      generations_by_pk: {
        status: "COMPLETE",
        generated_images: [{ url: "https://result.test/image.png" }],
      },
    });
  if (u === "https://result.test/image.png")
    return new Response(png, { headers: { "content-type": "image/png" } });
  throw Error("Unexpected HTTP destination " + u);
};
try {
  const { generateCreativeMedia } =
    await import("../server/core/creative/aiProvider");
  const out = await generateCreativeMedia({
    operation: "creative:image:edit",
    model: "leonardo-nano-banana-2-lite",
    prompt: "private scoped context",
    references: [`data:image/png;base64,${b64}`],
    settings: { size: "1K", aspectRatio: "1:1" },
    bookId: "test-book",
    req: {
      principal: { id: "test-user", role: "writer", email: "test@local" },
    } as any,
  });
  assert.ok(submitted);
  assert.deepEqual(out.bytes, png);
  assert.equal(out.provider, "leonardo");
  assert.ok(
    !seen.some((u) => u.includes("/generated") || u.includes("/api/media")),
  );
  console.log(
    "✓ Реальний Leonardo adapter: приватний reference upload, submit, poll, bytes і usage без публічного файла",
  );
  console.log("Підсумок: 2 пройшло.");
} finally {
  globalThis.fetch = native;
  if (oldKey === undefined) delete process.env.LEONARDO_API_KEY;
  else process.env.LEONARDO_API_KEY = oldKey;
  db.closeDb();
  await fs.rm(dir, { recursive: true, force: true });
}
