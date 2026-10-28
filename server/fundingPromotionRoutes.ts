import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { requireAuth } from "./auth";
import { getDb } from "./db";
import { readBridgeSettings } from "./marketplaceBridge";
import {
  getBook,
  saveBook,
  listArtifacts,
  readArtifact,
  BookRevisionConflict,
} from "./bookStore";
import type { BookRoutesDeps } from "./bookRoutes";
import { buildStarterBook } from "../src/utils/starterBook";
import { stripEntityTags } from "../src/utils/coreEntities";
import type { Book } from "../src/types";

type Source = {
  document: {
    id: string;
    campaignId: string;
    revision: number;
    kind: "letter" | "book";
    title: string;
    subject: string;
    body: string;
  };
  authorName: string;
  campaignTitle: string;
  returnUrl: string;
};
type LinkRow = {
  book_id: string;
  document_id: string;
  owner_id: string;
  actor_uid: string;
  base_revision: number;
  return_url: string;
  kind: "letter" | "book";
};
class PromotionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function bridge(path: string, init: RequestInit = {}) {
  const settings = await readBridgeSettings();
  if (!settings.url || !settings.key)
    throw new PromotionError(
      503,
      "З’єднання з маркетплейсом ще не налаштовано.",
    );
  const response = await fetch(
    settings.url.replace(/\/$/, "") + "/bridge/funding-promotions" + path,
    {
      ...init,
      headers: { "x-bridge-key": settings.key, ...init.headers },
      signal: AbortSignal.timeout(30000),
    },
  );
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new PromotionError(
      response.status,
      Array.isArray(data.message)
        ? data.message.join("; ")
        : String(data.message || "Не вдалося зв’язатися з маркетплейсом."),
    );
  return data;
}
export function promotionBook(source: Source, id: string): Book {
  const book = buildStarterBook({
    bookId: id,
    title: source.document.title,
    author: source.authorName,
    role: "writer",
  });
  book.subtitle = source.document.subject;
  book.fundingPromotion = {
    documentId: source.document.id,
    campaignId: source.document.campaignId,
    kind: source.document.kind,
  };
  const sections =
    source.document.kind === "book"
      ? source.document.body.split(/^#\s+/m).filter((s) => s.trim())
      : [source.document.body];
  book.chapters = sections.map((part, i) => {
    const lines = part.trim().split("\n"),
      title =
        source.document.kind === "book" ? lines.shift()! : "Мотиваційний лист";
    const chapterId = `${id}-chapter-${i + 1}`,
      text = source.document.kind === "book" ? lines.join("\n").trim() : part;
    return {
      id: chapterId,
      bookId: id,
      title,
      order: i + 1,
      sections: [
        {
          id: `${id}-section-${i + 1}`,
          chapterId,
          title,
          order: 1,
          content: text,
          wordCount: text.trim().split(/\s+/).length,
          lastModified: new Date().toISOString(),
        },
      ],
    };
  });
  return book;
}
export function promotionText(book: Book, kind: "letter" | "book") {
  return [...book.chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) =>
      [
        kind === "book" ? `# ${stripEntityTags(chapter.title)}` : "",
        ...[...chapter.sections]
          .sort((a, b) => a.order - b.order)
          .map((section) =>
            stripEntityTags(section.content || "")
              .replace(/\r\n?/g, "\n")
              .trim(),
          ),
      ]
        .filter(Boolean)
        .join("\n\n"),
    )
    .join("\n\n");
}
function linkDb() {
  const db = getDb();
  if (!db)
    throw new PromotionError(503, "Сховище матеріалів тимчасово недоступне.");
  db.exec(
    `CREATE TABLE IF NOT EXISTS funding_promotion_links (book_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, owner_id TEXT NOT NULL, actor_uid TEXT NOT NULL, base_revision INTEGER NOT NULL, return_url TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('letter','book')))`,
  );
  return db;
}
function identity(req: Request) {
  const user = req.principal;
  const uid = user && "firebaseUid" in user ? user.firebaseUid : undefined;
  if (!user || user.isGuest || !uid)
    throw new PromotionError(
      403,
      "Увійдіть у Студію тим самим обліковим записом, що й у маркетплейс.",
    );
  return { id: user.id, firebaseUid: uid };
}
function ownLink(req: Request, bookId: string) {
  const user = identity(req),
    row = linkDb()
      .prepare(
        "SELECT * FROM funding_promotion_links WHERE book_id=? AND owner_id=? AND actor_uid=?",
      )
      .get(bookId, user.id, user.firebaseUid) as LinkRow | undefined;
  if (!row) throw new PromotionError(404, "Матеріал не знайдено.");
  return row;
}
function fail(response: Response, error: unknown) {
  const status =
    error instanceof PromotionError
      ? error.status
      : error instanceof BookRevisionConflict
        ? 409
        : 500;
  response.status(status).json({
    error:
      error instanceof Error ? error.message : "Не вдалося обробити матеріал.",
  });
}
export interface PromotionRouteDeps {
  buildArtifacts: BookRoutesDeps["buildArtifacts"];
  source?: (documentId: string, uid: string) => Promise<Source>;
  returned?: (
    documentId: string,
    body: FormData,
  ) => Promise<Record<string, unknown>>;
}
export function registerFundingPromotionRoutes(
  app: Express,
  deps: PromotionRouteDeps,
) {
  const source =
    deps.source ||
    (async (id, uid) =>
      (await bridge(
        `/documents/${encodeURIComponent(id)}?actorFirebaseUid=${encodeURIComponent(uid)}`,
      )) as unknown as Source);
  const returned =
    deps.returned ||
    (async (id, body) =>
      bridge(`/documents/${encodeURIComponent(id)}/return`, {
        method: "POST",
        body,
      }));
  app.post(
    "/api/funding-promotions/:id/open",
    requireAuth,
    async (req, res) => {
      try {
        const user = identity(req),
          documentId = String(req.params.id);
        if (!UUID.test(documentId))
          throw new PromotionError(400, "Некоректний матеріал.");
        const data = await source(documentId, user.firebaseUid!);
        const id =
          "BK-CFP-" +
          documentId +
          "-" +
          createHash("sha256")
            .update(user.firebaseUid!)
            .digest("hex")
            .slice(0, 12);
        let stored = await getBook(id);
        if (stored && stored.ownerId !== user.id)
          throw new PromotionError(404, "Матеріал не знайдено.");
        const db = linkDb();
        if (!stored) {
          db.prepare(
            "INSERT INTO funding_promotion_links (book_id,document_id,owner_id,actor_uid,base_revision,return_url,kind) VALUES (?,?,?,?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET base_revision=excluded.base_revision,return_url=excluded.return_url",
          ).run(
            id,
            documentId,
            user.id,
            user.firebaseUid,
            data.document.revision,
            data.returnUrl,
            data.document.kind,
          );
          try {
            stored = await saveBook({
              book: promotionBook(data, id) as unknown as Record<
                string,
                unknown
              >,
              ownerId: user.id,
            });
          } catch (e) {
            if (!(e instanceof BookRevisionConflict)) throw e;
            stored = await getBook(id);
          }
        }
        if (!stored || stored.ownerId !== user.id)
          throw new PromotionError(404, "Матеріал не знайдено.");
        const link = ownLink(req, id);
        res.json({
          book: stored.book,
          revision: stored.revision,
          returnUrl: link.return_url,
        });
      } catch (e) {
        fail(res, e);
      }
    },
  );
  app.get(
    "/api/funding-promotions/books/:bookId/context",
    requireAuth,
    async (req, res) => {
      try {
        const row = ownLink(req, String(req.params.bookId));
        await source(row.document_id, row.actor_uid);
        res.json({
          documentId: row.document_id,
          kind: row.kind,
          returnUrl: row.return_url,
        });
      } catch (e) {
        fail(res, e);
      }
    },
  );
  app.post(
    "/api/funding-promotions/books/:bookId/return",
    requireAuth,
    async (req, res) => {
      try {
        const id = String(req.params.bookId),
          link = ownLink(req, id),
          data = await source(link.document_id, link.actor_uid);
        const stored = await getBook(id);
        if (!stored || stored.ownerId !== req.principal?.id)
          throw new PromotionError(404, "Книгу не знайдено.");
        const book = stored.book as unknown as Book;
        const text = promotionText(book, link.kind);
        if (text.length < 30 || text.length > 100000)
          throw new PromotionError(
            400,
            "Текст має містити від 30 до 100000 символів.",
          );
        let pdf: Buffer | undefined;
        if (link.kind === "book") {
          let artifact = (await listArtifacts(id)).find(
            (a) =>
              a.kind === "pdf" &&
              a.format === "digital" &&
              a.bookRevision === stored.revision,
          );
          if (!artifact) {
            await deps.buildArtifacts({
              bookId: id,
              variant: "code",
              formats: ["digital"],
              engineId: "designcraft",
              trimId: "A5",
              withSample: false,
              req,
            });
            artifact = (await listArtifacts(id)).find(
              (a) =>
                a.kind === "pdf" &&
                a.format === "digital" &&
                a.bookRevision === stored.revision,
            );
          }
          if (!artifact)
            throw new PromotionError(
              503,
              "Не вдалося підготувати актуальний PDF книги.",
            );
          const file = await readArtifact(id, "pdf", "digital");
          if (!file)
            throw new PromotionError(503, "PDF книги тимчасово недоступний.");
          if (file.record.bookRevision !== stored.revision)
            throw new PromotionError(
              409,
              "Книгу змінено під час верстки. Збережіть правки й повторіть повернення.",
            );
          pdf = Buffer.from(file.bytes);
          if (
            pdf.length > 8 * 1024 * 1024 ||
            pdf.subarray(0, 5).toString() !== "%PDF-"
          )
            throw new PromotionError(400, "Для розсилки потрібен PDF до 8 МБ.");
        }
        if ((await getBook(id))?.revision !== stored.revision)
          throw new PromotionError(
            409,
            "Книгу змінено під час підготовки. Збережіть правки й повторіть повернення.",
          );
        const form = new FormData();
        const fields = {
          actorFirebaseUid: link.actor_uid,
          baseRevision: link.base_revision,
          studioBookId: id,
          studioRevision: stored.revision,
          title: book.title,
          subject: book.subtitle || data.document.subject,
          body: text,
        };
        for (const [key, value] of Object.entries(fields))
          form.set(key, String(value));
        if (pdf)
          form.set(
            "pdf",
            new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
            "project-book.pdf",
          );
        const result = await returned(link.document_id, form);
        if (result.applied && typeof result.revision === "number")
          linkDb()
            .prepare(
              "UPDATE funding_promotion_links SET base_revision=? WHERE book_id=? AND owner_id=?",
            )
            .run(result.revision, id, req.principal?.id);
        res.json({ ...result, returnUrl: link.return_url });
      } catch (e) {
        fail(res, e);
      }
    },
  );
}
