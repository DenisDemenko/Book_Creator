/** Trusted Marketplace bridge. Provider keys, credit wallet and original media stay in Studio. */
import type { Express } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { readBridgeSettings } from "./marketplaceBridge";
import { findUserByFirebaseUid } from "./store";
import { resolveSubscription } from "./subscriptions";
import { geoHomeAccess } from "./geohome/routes";
import {
  GeoHomeError,
  initGeoHomeStore,
  listProjects,
  readProject,
} from "./geohome/store";
import { getDb, isAvailable } from "./db";
import { GENERATED_DIR, ImageGenerationError } from "./imageGeneration";
import { constructorImageQuotes, generateConstructorImage } from "./constructorImageEngines";
import { hasPaidConstructorPlan } from "./tableAiBilling";
import { TableImageError } from "./tableAiGeneration";
import { creditsEnabled, syncCredits } from "./creditGate";
import { generateImage } from "./aiCore";
import { recognizeRoomPlan } from "./roomPlanRecognition";
import { readAsset, assetIdFromUrl } from "./media/mediaLibraryStore";
async function storedImage(result: any, ownerId: string) {
  let bytes: Buffer | undefined, mimeType: string | undefined;
  const id = assetIdFromUrl(result.url);
  if (id) {
    const asset = await readAsset(id);
    if (asset?.record.ownerId === ownerId) {
      bytes = Buffer.from(asset.bytes);
      mimeType = asset.record.mimeType;
    }
  } else if (/^\/generated\/[^/]+$/.test(result.url))
    bytes = await readFile(resolve(GENERATED_DIR, basename(result.url)));
  if (!bytes) throw Error("Stored image unavailable");
  return {
    ...result,
    image: bytes.toString("base64"),
    mimeType:
      mimeType ||
      (bytes[0] === 137
        ? "image/png"
        : bytes.subarray(0, 4).toString() === "RIFF"
          ? "image/webp"
          : "image/jpeg"),
  };
}
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

const storedImageUnavailable =
  "Рендер завершився, але файл тимчасово недоступний. Повторіть перевірку збереженого результату.";

function renderFailure(error: unknown, engineLabel: string) {
  if (error instanceof TableImageError) return error.message;
  if (error instanceof ImageGenerationError) {
    switch (error.kind) {
      case "no_key":
        return `Провайдер відхилив доступ рушія «${engineLabel}». Оновіть оцінку та виберіть доступний рушій.`;
      case "quota":
        return `Двигун «${engineLabel}» вичерпав квоту провайдера або ліміт запитів.`;
      case "safety":
        return `Двигун «${engineLabel}» відхилив знімки або опис сцени.`;
      case "empty":
        return `Двигун «${engineLabel}» не повернув зображення.`;
    }
  }
  return `Двигун «${engineLabel}» не завершив рендер. Перевірте збережений результат перед новим запуском.`;
}

export function registerRoomStudioBridge(app: Express) {
  app.post("/api/room-studio/bridge/:action", async (req, res) => {
    try {
      const s = await readBridgeSettings(),
        actual = Buffer.from(req.get("x-bridge-key") || ""),
        expected = Buffer.from(s.key);
      if (
        !actual.length ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return res.status(403).json({ error: "Недійсний міст." });
      if (!isAvailable())
        return res.status(503).json({ error: "Сховище Студії недоступне." });
      const uid = req.body?.firebaseUid;
      if (typeof uid !== "string" || !uid || uid.length > 128)
        return res.status(400).json({ error: "Некоректна особа." });
      const user = await findUserByFirebaseUid(uid);
      if (!user || user.disabled)
        return res
          .status(403)
          .json({ error: "Потрібен чинний акаунт Студії." });
      const action = String(req.params.action);
      // The Marketplace server sets this flag from its authenticated DB role.
      // The bridge key and the linked, enabled Studio account are checked above.
      const administrator = user.role === "admin" || req.body.marketplaceAdmin === true;
      if (action === "recognize-plan" && administrator) {
        return await recognizeRoomPlan(req, res, user);
      }
      if (action === "geohome-projects" || action === "geohome-project") {
        if (!administrator && !geoHomeAccess(await resolveSubscription(user.id)))
          return res
            .status(403)
            .json({
              error:
                "Власні проєкти GeoHome доступні адміністраторам та за чинною передплатою Pro або Ultra.",
            });
        initGeoHomeStore();
        if (action === "geohome-projects")
          return res.json({ projects: listProjects(user.id) });
        const { projectId, version } = req.body;
        if (
          typeof projectId !== "string" ||
          !/^[a-zA-Z0-9-]{16,80}$/.test(projectId) ||
          !Number.isInteger(version) ||
          version < 1
        )
          return res
            .status(400)
            .json({ error: "Оберіть конкретну версію власного купола." });
        try {
          return res.json(readProject(user.id, projectId, version));
        } catch (error) {
          if (error instanceof GeoHomeError)
            return res.status(error.status).json({ error: error.message });
          throw error;
        }
      }
      const sub = await resolveSubscription(user.id);
      const activePaidPlan =
        sub.status === "active" &&
        Date.parse(sub.currentPeriodEnd) > Date.now() &&
        ["pro", "ultra"].includes(sub.plan);
      if (action === "recognize-plan") {
        if (!activePaidPlan)
          return res.status(403).json({
            error: "Розпізнавання плану ШІ доступне адміністраторам і за чинною передплатою Pro або Ultra. План можна обвести вручну.",
          });
        return await recognizeRoomPlan(req, res, user);
      }
      if (action === "access")
        return res.json({ plan: sub.plan, active: activePaidPlan });
      if (action === "result") {
        const jobKey = req.body.jobKey;
        if (typeof jobKey !== "string" || !/^room:[a-f0-9-]{36}$/.test(jobKey))
          return res.status(400).json({ error: "Некоректний ключ завдання." });
        const db = getDb()!;
        db.exec(
          "CREATE TABLE IF NOT EXISTS room_image_jobs (job_key TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL)",
        );
        const job = db
          .prepare("SELECT * FROM room_image_jobs WHERE job_key=?")
          .get(jobKey) as
          { user_id: string; status: string; result: string } | undefined;
        if (!job || job.user_id !== user.id)
          return res.status(404).json({ error: "Завдання не знайдено." });
        if (job.status !== "completed") {
          const failure = job.result ? JSON.parse(job.result) : null;
          return res.json({ status: job.status, error: failure?.error });
        }
        try {
          return res.json({
            status: "completed",
            ...(await storedImage(JSON.parse(job.result), user.id)),
          });
        } catch {
          return res.status(503).json({
            error: storedImageUnavailable,
          });
        }
      }
      if (!["quote", "generate"].includes(action))
        return res.status(404).json({ error: "Невідома дія." });
      const externalBilling = req.body.externalBilling === true;
      if (!externalBilling && !creditsEnabled())
        return res
          .status(503)
          .json({ error: "Облік AI-балів тимчасово вимкнено." });
      const balance = externalBilling ? null : await syncCredits(user.id);
      const aspectRatio = req.body.aspectRatio || "1:1";
      const access = await constructorImageQuotes(req.body.imageSize || (externalBilling ? "1K" : "2K"), aspectRatio);
      const engines = access.editions.filter((engine) => engine.available && (externalBilling || engine.id !== "gpt-image")).map((engine) => ({
        ...engine,
        credits: !externalBilling && user.role === "admin" ? 0 : engine.credits,
        quoteHash: externalBilling ? engine.quoteHash : digest({ id: engine.id, model: engine.modelId, size: engine.imageSize, usd: engine.costUsd }),
        referenceInputs: ["image-reference"],
        qualifiedStrict: false,
      }));
      if (action === "quote") {
        if (!engines.length)
          return res.status(503).json({ error: "Студія зараз не має доступного рушія фоторендера." });
        return res.json({ engines, available: balance?.available ?? 0, currency: "AI credits", strictQualification: "pending_benchmark" });
      }
      const b = req.body,
        engine = engines.find((e) => e.id === b.engine);
      if (
        !engine ||
        engine.quoteHash !== b.quoteHash ||
        !Number.isFinite(b.maxCredits) ||
        b.maxCredits < (externalBilling && b.billingMode === "free" ? 0 : engine.credits)
      )
        return res
          .status(409)
          .json({ error: "Тариф або модель змінилися. Оновіть оцінку." });
      if (
        typeof b.jobKey !== "string" ||
        !/^room:[a-f0-9-]{36}$/.test(b.jobKey) ||
        typeof b.prompt !== "string" ||
        b.prompt.length > 50000 ||
        !Array.isArray(b.references) ||
        b.references.length < 1 ||
        b.references.length > engine.maxReferenceImages ||
        b.references.some(
          (v: unknown) =>
            typeof v !== "string" ||
            !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ||
            v.length > 4_000_000,
        ) ||
        !["16:9", "4:3", "1:1", "3:4", "9:16"].includes(b.aspectRatio)
      )
        return res.status(400).json({ error: "Некоректний знімок кімнати." });
      const db = getDb()!;
      db.exec(
        "CREATE TABLE IF NOT EXISTS room_image_jobs (job_key TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL)",
      );
      const h = digest({
        engine: engine.id,
        quote: engine.quoteHash,
        prompt: b.prompt,
        references: b.references,
        aspect: b.aspectRatio,
        ...(externalBilling && { negativePrompt: b.negativePrompt, billingMode: b.billingMode }),
      });
      const old = db
        .prepare("SELECT * FROM room_image_jobs WHERE job_key=?")
        .get(b.jobKey) as
        | {
            user_id: string;
            request_hash: string;
            status: string;
            result: string;
          }
        | undefined;
      const respond = async (result: any) => {
        try {
          return res.json({
            ...(await storedImage(result, user.id)),
            credits: result.credits ?? engine.credits,
            costUsd: result.costUsd ?? engine.costUsd,
          });
        } catch {
          return res.status(503).json({
            error: storedImageUnavailable,
          });
        }
      };
      if (old) {
        if (old.user_id !== user.id || old.request_hash !== h)
          return res
            .status(409)
            .json({ error: "Ключ уже використано з іншими параметрами." });
        if (old.status === "completed") return respond(JSON.parse(old.result));
        return res.status(409).json({
          error:
            "Цей виклик уже запущено або потребує перевірки. Повторної оплати не буде.",
        });
      }
      if (externalBilling) {
        if (b.billingJobKey !== 'table:' + b.jobKey.slice(5))
          return res.status(409).json({ error: "Не підтверджено спільний резерв рендера." });
        const paid = await hasPaidConstructorPlan(user.id);
        if (b.billingMode !== (paid ? "credits" : "free"))
          return res.status(409).json({ error: "Підписка змінилася. Оновіть оцінку." });
        if (paid) {
          const reservation = db.prepare("SELECT user_id, amount, status FROM credit_reservations WHERE job_key = ?").get(b.billingJobKey) as
            { user_id: string; amount: number; status: string } | undefined;
          if (reservation?.user_id !== user.id || reservation.status !== "reserved" || reservation.amount !== engine.credits)
            return res.status(402).json({ error: "Спочатку зарезервуйте AI-бали." });
        }
        const concurrent = db.prepare("SELECT status FROM room_image_jobs WHERE job_key = ?").get(b.jobKey);
        if (concurrent) return res.status(409).json({ error: "Завдання вже прийнято. Перевірте збережений результат." });
      }
      const chargedCredits = externalBilling && b.billingMode === "free" ? 0 : engine.credits;
      db.prepare("INSERT INTO room_image_jobs VALUES (?,?,?,?,?,?)").run(
        b.jobKey,
        user.id,
        h,
        "running",
        null,
        new Date().toISOString(),
      );
      try {
        const result = await generateImage({
          engine: engine.id,
          constructorRender: {
            externallyBilled: externalBilling,
            generate: () => generateConstructorImage(engine, access, {
              prompt: b.prompt, aspectRatio: b.aspectRatio, references: b.references,
              negativePrompt: String(b.negativePrompt || "").slice(0, 4000),
            }),
          },
          prompt: b.prompt,
          aspectRatio: b.aspectRatio,
          imageSize: engine.imageSize,
          negativePrompt: String(b.negativePrompt || "").slice(0, 4000),
          referenceImageUrls: b.references,
          filenameHint: "room-" + b.jobKey.slice(5),
          req: {
            principal: {
              id: user.id,
              email: user.email,
              role: user.role,
              isGuest: false,
            },
          },
          label: "Fusion Room Studio · " + b.jobKey,
        });
        db.prepare(
          "UPDATE room_image_jobs SET status=?,result=? WHERE job_key=?",
        ).run(
          "completed",
          JSON.stringify({
            ...result,
            credits: chargedCredits,
            costUsd: engine.costUsd,
            quoteHash: engine.quoteHash,
          }),
          b.jobKey,
        );
        return respond({ ...result, credits: chargedCredits });
      } catch (error) {
        const message = renderFailure(error, engine.label);
        console.warn("[room-studio] image job failed", {
          jobKey: b.jobKey,
          engine: engine.id,
          kind: error instanceof ImageGenerationError ? error.kind : "unknown",
        });
        db.prepare("UPDATE room_image_jobs SET status=?,result=? WHERE job_key=?").run(
          "needs_review",
          JSON.stringify({ error: message }),
          b.jobKey,
        );
        return res.status(503).json({ error: message });
      }
    } catch {
      return res
        .status(503)
        .json({ error: "Не вдалося виконати запит Студії." });
    }
  });
}
