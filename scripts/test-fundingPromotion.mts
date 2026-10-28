import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "funding-promotion-studio-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = path.join(dir, "studio.db");
process.env.USER_API_KEY_SECRET = "isolated-promotion-test-key";
const db = await import("../server/db");
await db.initDb();
const { saveUser, createSession } = await import("../server/store");
const { attachPrincipal } = await import("../server/auth");
const { saveBook, getBook, readArtifact } = await import("../server/bookStore");
const { saveBridgeSettings } = await import("../server/marketplaceBridge");
const { registerPdfRoutes } = await import("../server/pdfRoutes");
const { registerBookRoutes } = await import("../server/bookRoutes");
const { registerFundingPromotionRoutes } =
  await import("../server/fundingPromotionRoutes");
const now = new Date().toISOString();
await saveUser({
  id: "promotion-owner",
  firebaseUid: "uid-promotion-owner",
  name: "Автор проєкту",
  email: "promotion-owner@test.dev",
  role: "writer",
  createdAt: now,
});
await saveUser({
  id: "promotion-other",
  firebaseUid: "uid-promotion-other",
  name: "Інший автор",
  email: "promotion-other@test.dev",
  role: "writer",
  createdAt: now,
});
async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await createSession({
    token,
    userId,
    createdAt: now,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  return `nova_session=${token}`;
}
const cookie = await session("promotion-owner"),
  outsiderCookie = await session("promotion-other");
const campaignId = randomUUID(),
  letterId = randomUUID(),
  bookId = randomUUID(),
  key = "isolated-promotion-bridge";
const material = (id: string, kind: "letter" | "book") => ({
  document: {
    id,
    campaignId,
    kind,
    revision: 1,
    title: kind === "book" ? "Історія STEAM проєкту" : "Мотиваційний лист",
    subject: "Запрошуємо підтримати проєкт",
    body:
      kind === "book"
        ? "# Наша ідея\n\nМи створюємо навчальну станцію якості повітря разом із командою.\n\n# Як підтримати\n\nПрочитайте паспорт проєкту, дізнайтеся про етапи та поділіться історією."
        : "Вітаємо! Ми створюємо навчальний прототип станції якості повітря. Запрошуємо ознайомитися з проєктом і підтримати команду.",
  },
  authorName: "Автор проєкту",
  campaignTitle: "Навчальна станція",
  returnUrl: `https://www.fusionlab.in.ua/account/crowdfunding/${campaignId}/promotion`,
});
const sources = new Map<string, ReturnType<typeof material>>([
  [letterId, material(letterId, "letter")],
  [bookId, material(bookId, "book")],
]);
let allowed = true;
const payloads: Array<Record<string, string>> = [],
  files: Buffer[] = [];
const market = express();
market.use((req, res, next) => {
  if (req.headers["x-bridge-key"] !== key)
    return res.status(401).json({ message: "Bad bridge key" });
  next();
});
market.post(
  "/bridge/tables/designer-access/lookup",
  express.json(),
  (req, res) =>
    res.json({
      role: "buyer",
      allowed: false,
      firebaseUid: req.body.firebaseUid,
    }),
);
market.get("/bridge/funding-promotions/documents/:id", (req, res) => {
  if (!allowed)
    return res.status(403).json({ message: "Project is not published" });
  if (req.query.actorFirebaseUid !== "uid-promotion-owner")
    return res.status(404).json({ message: "Not found" });
  const item = sources.get(req.params.id);
  if (!item) return res.status(404).json({ message: "Not found" });
  res.json(item);
});
market.post(
  "/bridge/funding-promotions/documents/:id/return",
  express.raw({ type: () => true, limit: "12mb" }),
  async (req, res) => {
    const form = await new Request("http://127.0.0.1/return", {
      method: "POST",
      headers: { "content-type": req.headers["content-type"]! },
      body: req.body,
    }).formData();
    const fields: Record<string, string> = {};
    for (const [k, v] of form)
      if (typeof v === "string") fields[k] = v;
      else files.push(Buffer.from(await v.arrayBuffer()));
    assert.equal(fields.actorFirebaseUid, "uid-promotion-owner");
    const source = sources.get(req.params.id)!;
    const applied = Number(fields.baseRevision) === source.document.revision;
    if (applied) {
      source.document.body = fields.body;
      source.document.revision++;
    }
    payloads.push(fields);
    res.json({
      id: randomUUID(),
      applied,
      revision: source.document.revision,
      returnUrl: source.returnUrl,
    });
  },
);
const marketServer = market.listen(0, "127.0.0.1");
await new Promise<void>((r) => marketServer.once("listening", r));
await saveBridgeSettings({
  url: `http://127.0.0.1:${(marketServer.address() as { port: number }).port}`,
  key,
});
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(attachPrincipal);
let aiCalls = 0;
const operations = registerPdfRoutes(app, {
  resolveEngine: () => "",
  loadAdminLayer: async () => ({}) as never,
  generateText: async () => {
    aiCalls++;
    throw Error("AI must not be used for promotion layout");
  },
});
registerBookRoutes(app, operations);
registerFundingPromotionRoutes(app, operations);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
let checks = 0;
const ok = (text: string) => {
  checks++;
  console.log("✓ " + text);
};
async function call(
  p: string,
  status: number,
  method = "GET",
  body?: object,
  auth = cookie,
) {
  const response = await fetch(base + p, {
    method,
    headers: { cookie: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.status, status, p + ": " + JSON.stringify(data));
  return data;
}
try {
  const anonymous = await fetch(
    base + `/api/funding-promotions/${letterId}/open`,
    { method: "POST" },
  );
  assert([401, 403].includes(anonymous.status));
  ok("Anonymous entry is rejected");
  await call(
    `/api/funding-promotions/${letterId}/open`,
    404,
    "POST",
    undefined,
    outsiderCookie,
  );
  ok("Marketplace ownership is checked before creating a Studio book");
  const opened = await call(
    `/api/funding-promotions/${letterId}/open`,
    200,
    "POST",
  );
  const book = opened.book;
  assert.equal(
    book.chapters[0].sections[0].content,
    sources.get(letterId)!.document.body,
  );
  assert.equal(book.characters.length, 0);
  assert.equal(book.illustrations.length, 0);
  ok(
    "The exact letter template becomes a private Book & text manuscript without demo content",
  );
  const reopened = await call(
    `/api/funding-promotions/${letterId}/open`,
    200,
    "POST",
  );
  assert.equal(reopened.book.id, book.id);
  assert.equal(reopened.revision, opened.revision);
  ok("Repeated entry preserves the same saved manuscript");
  book.chapters[0].sections[0].content =
    "Вітаємо! Це відредагований автором лист про команду та нашу навчальну станцію. Дякуємо за увагу до проєкту!";
  book.subtitle = "Лист від засновника проєкту";
  await call(`/api/books/${book.id}`, 200, "PUT", {
    book,
    expectedRevision: opened.revision,
  });
  await call(
    `/api/funding-promotions/books/${book.id}/return`,
    404,
    "POST",
    undefined,
    outsiderCookie,
  );
  ok("Another writer cannot return the owner manuscript");
  const returned = await call(
    `/api/funding-promotions/books/${book.id}/return`,
    200,
    "POST",
    { actorFirebaseUid: "forged-client-uid" },
  );
  assert.equal(returned.applied, true);
  assert.equal(payloads[0].subject, book.subtitle);
  assert.equal(payloads[0].body, book.chapters[0].sections[0].content);
  assert.equal(payloads[0].baseRevision, "1");
  ok(
    "Edited text and email subject return with the server-bound Firebase identity",
  );
  const stored = await getBook(book.id);
  assert(stored);
  book.chapters[0].sections[0].content += " Друге редагування збережено.";
  await call(`/api/books/${book.id}`, 200, "PUT", {
    book,
    expectedRevision: stored.revision,
  });
  await call(`/api/funding-promotions/books/${book.id}/return`, 200, "POST");
  assert.equal(payloads[1].baseRevision, "2");
  ok(
    "The next round-trip uses the new marketplace revision rather than stale browser metadata",
  );
  const long = await call(
    `/api/funding-promotions/${bookId}/open`,
    200,
    "POST",
  );
  assert.equal(long.book.chapters.length, 2);
  assert(
    process.env.DESIGNCRAFT_PATH && fs.existsSync(process.env.DESIGNCRAFT_PATH),
    "Pinned DesignCraft CLI required: a skipped render is not a pass",
  );
  await call(
    `/api/funding-promotions/books/${long.book.id}/return`,
    200,
    "POST",
  );
  const pdf = await readArtifact(long.book.id, "pdf", "digital");
  assert(pdf && pdf.record.pageCount! > 0);
  assert.equal(pdf.record.variant, "designcraft");
  assert(files.some((f) => f.equals(Buffer.from(pdf.bytes))));
  assert.equal(aiCalls, 0);
  ok(
    "A writer renders with actual DesignCraft and returns the exact PDF, without an AI call or book-store publication",
  );
  allowed = false;
  await call(
    `/api/funding-promotions/books/${long.book.id}/return`,
    403,
    "POST",
  );
  ok("Revoked publication access is rechecked before rendering or returning");
  console.log(
    `${checks} passed; SMTP, payment and book-store publish were not called.`,
  );
} finally {
  await Promise.all([
    new Promise<void>((r) => server.close(() => r())),
    new Promise<void>((r) => marketServer.close(() => r())),
  ]);
  db.getDb()?.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
