import { createHash } from "node:crypto";
import type { Express, RequestHandler } from "express";
import type { JevAdapter, JevQuestion } from "./ai/adapters/jev";
import { normalizeAnswer } from "./core/workflows/engine/jev";
export type KittenAction = "chase" | "wander" | "rest";
export interface KittenContext {
  speed: number;
  distance: number;
  onBridge: boolean;
}
export const KITTEN_USAGE_CONTEXT = "portfolio-maze-kitten";
export function kittenContext(raw: unknown): {
  requestId: string;
  context: KittenContext;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Некоректний стан кошеняти.");
  const b = raw as any;
  if (
    Object.keys(b).some(
      (k) => !["requestId", "speed", "distance", "onBridge"].includes(k),
    ) ||
    typeof b.requestId !== "string" ||
    !/^[a-zA-Z0-9_-]{8,80}$/.test(b.requestId) ||
    !Number.isFinite(b.speed) ||
    b.speed < 0 ||
    b.speed > 30 ||
    !Number.isFinite(b.distance) ||
    b.distance < 0 ||
    b.distance > 10000 ||
    typeof b.onBridge !== "boolean"
  )
    throw new Error("Некоректний стан кошеняти.");
  return {
    requestId: b.requestId,
    context: { speed: b.speed, distance: b.distance, onBridge: b.onBridge },
  };
}
export const kittenRules = (c: KittenContext): KittenAction =>
  c.onBridge || c.speed < 0.3 ? "rest" : c.distance > 240 ? "wander" : "chase";
export async function decideKitten(
  context: KittenContext,
  adapter: JevAdapter | null,
  reserve: () => Promise<boolean>,
  record: (raw: any) => Promise<void>,
  timeoutMs = 1200,
) {
  const fallback = {
    action: kittenRules(context),
    source: "rules",
    reason: "provider_unavailable",
  };
  if (!adapter?.askState) return fallback;
  if (!(await reserve())) return { ...fallback, reason: "budget" };
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const questions: JevQuestion[] = [
    {
      id: "play",
      kind: "choice",
      instructions:
        "Choose only a listed action for a fictional playful kitten. Never push the ball on a bridge. No map changes.",
      options: {
        chase: "Playfully approach the moving ball",
        wander: "Wander without approaching the player",
        rest: "Stop and let the ball proceed",
      },
    },
    {
      id: "safe",
      kind: "noul",
      instructions:
        "Is approaching this ball appropriate? If the ball is on a bridge or nearly stationary, answer no.",
    },
  ];
  try {
    const raw = await Promise.race([
      adapter.askState({ game: "MazeFinal", ...context }, questions, {
        signal: abort.signal,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error("timeout"));
        }, timeoutMs);
      }),
    ]);
    await record(raw);
    const choice = normalizeAnswer(questions[0], raw.answers?.play, "jev"),
      safe = normalizeAnswer(questions[1], raw.answers?.safe, "jev");
    if (
      !choice ||
      !safe ||
      (choice.confidence ?? 0) < 0.6 ||
      (safe.probability ?? 0) < 0.7 ||
      !["chase", "wander", "rest"].includes(choice.selected ?? "")
    )
      return { ...fallback, reason: "uncertain" };
    // Physics/safety are authoritative regardless of model answer.
    const action: KittenAction =
      context.onBridge || context.speed < 0.3
        ? "rest"
        : (choice.selected as KittenAction);
    return {
      action,
      source: adapter.name === "mock" ? "mock" : "jev",
      reason: "checked",
    };
  } catch (e) {
    return {
      ...fallback,
      reason:
        e instanceof Error && e.message === "timeout"
          ? "timeout"
          : "provider_error",
    };
  } finally {
    clearTimeout(timer!);
    abort.abort();
  }
}
export function registerMazeKittenRoutes(
  app: Express,
  d: {
    guard: RequestHandler;
    adapter: () => Promise<JevAdapter | null>;
    recheck: (userId: string) => Promise<boolean>;
    reserve: (
      userId: string,
      requestId: string,
      hash: string,
    ) => Promise<"ok" | "duplicate" | "budget">;
    record: (userId: string, requestId: string, raw: any) => Promise<void>;
  },
) {
  const pending = new Set<string>(),
    receipts = new Map<string, { hash: string; at: number; result: unknown }>();
  app.post("/api/maze-final/kitten", d.guard, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const uid = req.principal?.id;
    if (!uid || req.principal?.isGuest) {
      res
        .status(401)
        .json({
          error: "Увійдіть у систему. Гра без Jev залишається доступною.",
        });
      return;
    }
    let ownsPending = false;
    let parsed: ReturnType<typeof kittenContext>;
    try {
      parsed = kittenContext(req.body);
    } catch {
      res.status(422).json({ error: "Некоректний стан кошеняти." });
      return;
    }
    const { requestId, context } = parsed,
      hash = createHash("sha256").update(JSON.stringify(context)).digest("hex"),
      key = `${uid}:${requestId}`;
    for (const [k, v] of receipts)
      if (Date.now() - v.at > 3600000) receipts.delete(k);
    try {
      if (!(await d.recheck(uid))) {
        res.status(403).json({ error: "Доступ до ШІ відкликано." });
        return;
      }
      const cached = receipts.get(key);
      if (cached) {
        if (cached.hash !== hash)
          res
            .status(409)
            .json({ error: "Ключ повтору вже використано з іншим станом." });
        else res.json(cached.result);
        return;
      }
      if (pending.has(uid)) {
        res
          .status(429)
          .json({ error: "Попереднє рішення кошеняти ще виконується." });
        return;
      }
      pending.add(uid);
      ownsPending = true;
      const adapter = await d.adapter();
      let duplicate = false;
      const result = await decideKitten(
        context,
        adapter,
        async () => {
          const r = await d.reserve(uid, requestId, hash);
          duplicate = r === "duplicate";
          return r === "ok";
        },
        (raw) => d.record(uid, requestId, raw),
      );
      if (!(await d.recheck(uid))) {
        res.status(403).json({ error: "Доступ до ШІ відкликано." });
        return;
      }
      const out = {
        ...result,
        ...(duplicate ? { reason: "already_reserved" } : {}),
      };
      if (receipts.size >= 2000) receipts.delete(receipts.keys().next().value!);
      receipts.set(key, { hash, at: Date.now(), result: out });
      res.json(out);
    } catch {
      res
        .status(503)
        .json({
          error: "Jev тимчасово недоступний. Використайте локальні правила.",
        });
    } finally {
      if (ownsPending) pending.delete(uid);
    }
  });
}
