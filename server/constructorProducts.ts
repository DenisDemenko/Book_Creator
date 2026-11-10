import type { Request, Express } from "express";
import { requireAdmin } from "./auth";
import { readBridgeSettings } from "./marketplaceBridge";
import type { FurnitureProduct } from "../src/components/adminOs/furnitureProduct";
import { constructorCard } from "../src/components/adminOs/constructorProductCard";
export { constructorCard } from "../src/components/adminOs/constructorProductCard";
export const constructorId = (id: unknown) =>
  typeof id === "string" && /^CP-[a-f0-9-]{36}$/i.test(id) ? id.slice(3) : null;
export async function constructorBridge(
  req: Request,
  method: string,
  path: string,
  body?: unknown,
) {
  if (
    !/^\/(?:tariffs|[a-f0-9-]{36}(?:\/(?:publish|archive|files|media\/[a-f0-9-]{36}))?)?$/i.test(
      path,
    )
  )
    throw Error("Некоректний маршрут товару.");
  const user = req.principal,
    uid = user && "firebaseUid" in user ? user.firebaseUid : undefined;
  if (user?.role !== "admin" || user.isGuest || !uid)
    throw Object.assign(Error("Потрібен підтверджений акаунт власника."), {
      status: 403,
    });
  const settings = await readBridgeSettings();
  return fetch(settings.url + "/bridge/constructor-products" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-bridge-key": settings.key,
      "x-constructor-actor-uid": uid,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
}
export async function constructorJson(
  req: Request,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await constructorBridge(req, method, path, body),
    v = await r.json();
  if (!r.ok)
    throw Object.assign(
      Error(v.message || v.error || "Помилка конструктора."),
      { status: r.status },
    );
  return v;
}

export async function saveConstructorCard(req: Request, p: FurnitureProduct) {
  const id = constructorId(p.id);
  if (!id) throw Error("Некоректний ID.");
  const source = p.constructorSource;
  if (!source) throw Error("Оновіть картку конструктора.");
  return constructorCard(
    await constructorJson(req, "PUT", "/" + id, {
      expectedRevision: source.revision,
      details: {
        title: p.name,
        summary: p.teaser,
        description: p.description,
        categorySlug: p.marketplaceCategory,
        leadTime: p.leadTime,
        quantities: source.quantities,
        commercial: source.commercial,
        publicAttributes: Object.fromEntries(
          [
            "material",
            "finish",
            "warranty",
            "ledStrip",
            "ledPower",
            "ledControl",
            "functionalZones",
            "woodTones",
            "colors",
            "engraving",
            "engravingPriceMinor",
            "resinColor",
            "phoneFit",
            "electronicsEnabled",
            "electronicsController",
            "electronicsUserProgrammable",
            "electronicsFunctions",
          ]
            .filter((k) => (p as any)[k] !== undefined)
            .map((k) => [k, (p as any)[k]]),
        ),
      },
      extraMedia: p.media
        .filter((m) => m.src.startsWith("data:"))
        .map((m) => ({ id: m.id, name: m.label, src: m.src })),
      mediaOrder: p.media.map((m) => m.id),
    }),
  );
}
export function registerConstructorProductRoutes(app: Express) {
  app.get(
    "/api/admin/constructor-products/tariffs",
    requireAdmin,
    async (req, res) => {
      try {
        res.json(await constructorJson(req, "GET", "/tariffs"));
      } catch (e: any) {
        res.status(e.status || 503).json({ error: e.message });
      }
    },
  );
  app.put(
    "/api/admin/constructor-products/tariffs",
    requireAdmin,
    async (req, res) => {
      try {
        res.json(await constructorJson(req, "PUT", "/tariffs", req.body));
      } catch (e: any) {
        res.status(e.status || 503).json({ error: e.message });
      }
    },
  );
  app.get(
    "/api/admin/constructor-products/:id/files",
    requireAdmin,
    async (req, res) => {
      try {
        res.json(
          await constructorJson(req, "GET", "/" + req.params.id + "/files"),
        );
      } catch (e: any) {
        res.status(e.status || 503).json({ error: e.message });
      }
    },
  );
  app.get(
    "/api/admin/constructor-products/:id/media/:mediaId",
    requireAdmin,
    async (req, res) => {
      try {
        const r = await constructorBridge(
          req,
          "GET",
          "/" + req.params.id + "/media/" + req.params.mediaId,
        );
        res
          .status(r.status)
          .set(
            "Content-Type",
            r.headers.get("content-type") || "application/octet-stream",
          )
          .set("Cache-Control", "private, no-store")
          .send(Buffer.from(await r.arrayBuffer()));
      } catch (e: any) {
        res.status(e.status || 503).json({ error: e.message });
      }
    },
  );
}
